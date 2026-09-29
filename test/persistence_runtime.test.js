/**
 * STOCK-LIGHT — Test Suite: Runtime Real de Google Apps Script y Configuración de Persistencia
 * Ejecutable con Node.js: `node test/persistence_runtime.test.js`
 * 
 * Verifica:
 * A. Ejecución container-bound con spreadsheet activo.
 * B. Ejecución sin spreadsheet activo (resolución por SPREADSHEET_ID en ScriptProperties / Web App).
 * C. Configuración inexistente -> error descriptivo guiado.
 * D. Configuración inválida -> validación de formato y error descriptivo.
 * E. Acceso correcto a las cinco hojas maestras oficiales.
 * F. initDatabase() / provisionDatabase() idempotente y no destructivo.
 * G. Repository continúa funcionando sin modificar InventoryEngine.
 * H. Reconstrucción determinista continúa funcionando.
 * I. Cero referencias hardcodeadas al spreadsheet real en la lógica de negocio.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  CONFIG_KEYS,
  getSpreadsheetIdConfig,
  setSpreadsheetIdConfig,
  resolveDatabaseSpreadsheet
} = require('../src/Config');
const { SheetsRepository, SCHEMA_DEFINITIONS } = require('../src/Repository');
const { MovementService } = require('../src/MovementService');
const {
  buildStockKey,
  processMovement,
  rebuildStockFromMovements
} = require('../src/InventoryEngine');
const {
  checkDocumentDuplicate,
  buildDocumentIdentityKey,
  buildLineIdentityKey,
  filterBatchForOverlaps
} = require('../src/DeduplicationService');

console.log('================================================================');
console.log(' TEST SUITE FASE 3 / PASO 2 — RUNTIME Y PERSISTENCIA DETERMINISTA');
console.log('================================================================\n');

// --------------------------------------------------------------------------
// MOCKS PARA EMULAR ENTORNO APPS SCRIPT (SpreadsheetApp, Sheet, Range, PropertiesService)
// --------------------------------------------------------------------------

class MockRange {
  constructor(sheet, startRow, startCol, numRows, numCols) {
    this.sheet = sheet;
    this.startRow = startRow;
    this.startCol = startCol;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const result = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowIdx = this.startRow - 1 + r;
      const rowData = this.sheet.rows[rowIdx] || [];
      const rowSlice = [];
      for (let c = 0; c < this.numCols; c++) {
        const colIdx = this.startCol - 1 + c;
        rowSlice.push(rowData[colIdx] !== undefined ? rowData[colIdx] : '');
      }
      result.push(rowSlice);
    }
    return result;
  }

  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      const rowIdx = this.startRow - 1 + r;
      if (!this.sheet.rows[rowIdx]) {
        this.sheet.rows[rowIdx] = [];
      }
      for (let c = 0; c < values[r].length; c++) {
        const colIdx = this.startCol - 1 + c;
        this.sheet.rows[rowIdx][colIdx] = values[r][c];
      }
    }
    return this;
  }

  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      const rowIdx = this.startRow - 1 + r;
      if (this.sheet.rows[rowIdx]) {
        for (let c = 0; c < this.numCols; c++) {
          const colIdx = this.startCol - 1 + c;
          this.sheet.rows[rowIdx][colIdx] = '';
        }
      }
    }
    while (this.sheet.rows.length > 1 && this.sheet.rows[this.sheet.rows.length - 1].every(v => v === '' || v === undefined)) {
      this.sheet.rows.pop();
    }
    return this;
  }

  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.rows = []; // rows[0] = headers, rows[1..n] = data
  }

  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.length > 0 ? (this.rows[0] ? this.rows[0].length : 0) : 0; }

  getRange(startRow, startCol, numRows, numCols) {
    return new MockRange(this, startRow, startCol, numRows, numCols);
  }

  clear() {
    this.rows = [];
  }

  setFrozenRows() {}
}

class MockSpreadsheet {
  constructor(id = 'SPREADSHEET_TEST_ID_123456789') {
    this.id = id;
    this.sheets = new Map();
  }

  getId() { return this.id; }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  insertSheet(name) {
    const sheet = new MockSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

class MockPropertiesService {
  constructor(initialProps = {}) {
    this.props = { ...initialProps };
  }

  getProperty(key) {
    return this.props[key] || null;
  }

  setProperty(key, val) {
    this.props[key] = String(val);
  }
}

class MockSpreadsheetApp {
  constructor(activeSS = null) {
    this.activeSS = activeSS;
    this.spreadsheetsById = new Map();
    if (activeSS) {
      this.spreadsheetsById.set(activeSS.getId(), activeSS);
    }
  }

  getActiveSpreadsheet() {
    return this.activeSS;
  }

  openById(id) {
    if (!this.spreadsheetsById.has(id)) {
      throw new Error(`SpreadsheetApp: No existe o no hay permisos para el ID '${id}'`);
    }
    return this.spreadsheetsById.get(id);
  }

  registerSpreadsheet(ss) {
    this.spreadsheetsById.set(ss.getId(), ss);
  }
}

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

// --------------------------------------------------------------------------
// TEST A: Ejecución container-bound con spreadsheet activo
// --------------------------------------------------------------------------
runTest('A. Container-bound -> resuelve getActiveSpreadsheet() automáticamente', () => {
  const activeSS = new MockSpreadsheet('SS_CONTAINER_BOUND_001');
  const ssApp = new MockSpreadsheetApp(activeSS);

  const resolved = resolveDatabaseSpreadsheet({ spreadsheetApp: ssApp });
  assert.strictEqual(resolved.getId(), 'SS_CONTAINER_BOUND_001');

  // Integración con SheetsRepository
  const repo = new SheetsRepository({ spreadsheetApp: ssApp });
  assert.strictEqual(repo.getSpreadsheet().getId(), 'SS_CONTAINER_BOUND_001');
});

// --------------------------------------------------------------------------
// TEST B: Ejecución sin spreadsheet activo (Web App / standalone)
// --------------------------------------------------------------------------
runTest('B. Web App / Standalone (sin active SS) -> resuelve mediante ScriptProperties (openById)', () => {
  const ssApp = new MockSpreadsheetApp(null); // getActiveSpreadsheet() retorna null
  const targetSS = new MockSpreadsheet('SS_WEB_APP_STANDALONE_777');
  ssApp.registerSpreadsheet(targetSS);

  const propService = new MockPropertiesService({
    [CONFIG_KEYS.SPREADSHEET_ID]: 'SS_WEB_APP_STANDALONE_777'
  });

  const resolved = resolveDatabaseSpreadsheet({
    spreadsheetApp: ssApp,
    propertiesService: propService
  });

  assert.strictEqual(resolved.getId(), 'SS_WEB_APP_STANDALONE_777');

  const repo = new SheetsRepository({
    spreadsheetApp: ssApp,
    propertiesService: propService
  });
  assert.strictEqual(repo.getSpreadsheet().getId(), 'SS_WEB_APP_STANDALONE_777');
});

// --------------------------------------------------------------------------
// TEST C: Configuración inexistente
// --------------------------------------------------------------------------
runTest('C. Configuración inexistente -> lanza error descriptivo guiado', () => {
  const ssApp = new MockSpreadsheetApp(null); // Sin activo
  const propService = new MockPropertiesService({}); // Sin propiedades

  assert.throws(() => {
    resolveDatabaseSpreadsheet({
      spreadsheetApp: ssApp,
      propertiesService: propService
    });
  }, /Configuración de persistencia no encontrada.*No existe un Spreadsheet activo.*configurarSpreadsheetId/);
});

// --------------------------------------------------------------------------
// TEST D: Configuración inválida
// --------------------------------------------------------------------------
runTest('D. Configuración inválida -> detecta formato inválido o ID no accesible', () => {
  const ssApp = new MockSpreadsheetApp(null);

  // Caso D1: ID con espacios o muy corto
  assert.throws(() => {
    setSpreadsheetIdConfig('id invalido con espacios');
  }, /El formato del SPREADSHEET_ID.*no parece un identificador válido/);

  // Caso D2: ID inexistente en Google Drive (falla en openById)
  const propService = new MockPropertiesService({
    [CONFIG_KEYS.SPREADSHEET_ID]: '123456789012345_ID_FANTASMA_NO_EXISTE'
  });

  assert.throws(() => {
    resolveDatabaseSpreadsheet({
      spreadsheetApp: ssApp,
      propertiesService: propService
    });
  }, /Configuración inválida o error de acceso.*No se pudo abrir el Spreadsheet/);
});

// --------------------------------------------------------------------------
// TEST E: Acceso correcto a las cinco hojas maestras
// --------------------------------------------------------------------------
runTest('E. Acceso a las cinco hojas oficiales -> lectura y escritura conformes a esquema', () => {
  const ss = new MockSpreadsheet('SS_OFFICIAL_TABLES_TEST');
  const repo = new SheetsRepository(ss);

  // Provisionar tablas
  repo.provisionDatabase();

  const expectedTables = ['MAESTRO', 'DOCUMENTOS', 'MOVIMIENTOS', 'CAPAS_FIFO', 'STOCK_ACTUAL'];
  expectedTables.forEach(t => {
    const sheet = ss.getSheetByName(t);
    assert.ok(sheet, `La hoja ${t} debe existir`);
    assert.deepStrictEqual(sheet.rows[0], SCHEMA_DEFINITIONS[t], `Las cabeceras de ${t} deben coincidir exactamente`);
  });

  // Test de escritura y lectura en DOCUMENTOS
  const docRecord = {
    id_documento: 'DOC-TEST-001',
    sha256_hash: 'hash_test_123',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '3089',
    fecha_documento: '2026-09-24',
    entidad_nombre: 'CONSABOR BS SL',
    total_lineas: 1,
    total_cajas: 240,
    drive_file_id: 'FILE-001',
    drive_url: '',
    estado_proceso: 'CONFIRMADO',
    fecha_subida: '2026-09-24T10:00:00Z',
    usuario_subida: 'OPERADOR'
  };

  repo.appendDocumento(docRecord);
  const docs = repo.getDocumentos();
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].id_documento, 'DOC-TEST-001');
  assert.strictEqual(docs[0].total_cajas, 240);
});

// --------------------------------------------------------------------------
// TEST F: initDatabase() repetible sin destruir datos
// --------------------------------------------------------------------------
runTest('F. initDatabase() repetible -> no sobreescribe ni destruye datos existentes', () => {
  const ss = new MockSpreadsheet('SS_IDEMPOTENCY_TEST');
  const repo = new SheetsRepository(ss);

  // 1ª ejecución: crea tablas
  repo.provisionDatabase();

  // Insertar datos en STOCK_ACTUAL
  repo.saveStockActual([
    {
      stock_key: '2112004|DEFAULT',
      codigo_articulo: '2112004',
      nombre_articulo: 'TOMATE COCKTAIL I M',
      codigo_envase: 'DEFAULT',
      descripcion_envase: 'CAJA COMPRA',
      cajas_actuales: 240,
      fecha_ultima_actualizacion: '2026-09-28T12:00:00Z',
      ultimo_movimiento_id: 'MOV-001'
    }
  ]);

  assert.strictEqual(repo.getStockActual().length, 1);

  // 2ª ejecución de provisionDatabase(): debe ser inocua
  const res2 = repo.provisionDatabase();
  assert.strictEqual(res2.status, 'OK');
  assert.strictEqual(res2.createdSheets.length, 0); // No creó nuevas hojas

  // Verificar que los datos siguen intactos
  const stockPost = repo.getStockActual();
  assert.strictEqual(stockPost.length, 1);
  assert.strictEqual(stockPost[0].stock_key, '2112004|DEFAULT');
  assert.strictEqual(stockPost[0].cajas_actuales, 240);
});

// --------------------------------------------------------------------------
// TEST G: Repository continúa funcionando sin modificar InventoryEngine
// --------------------------------------------------------------------------
runTest('G. Repository integrado con MovementService -> InventoryEngine intacto', () => {
  const ss = new MockSpreadsheet('SS_INTEGRATION_TEST');
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const dedupService = { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps };
  const engineService = { buildStockKey, processMovement, rebuildStockFromMovements };
  const lock = { waitLock: () => true, releaseLock: () => {} };

  const service = new MovementService({
    repository: repo,
    lockService: lock,
    deduplicationService: dedupService,
    inventoryEngine: engineService
  });

  // Entrada 100 cajas
  const resEntrada = service.registrarEntrada({
    id_documento: 'DOC-IN-01',
    sha256_hash: 'hash_in_01',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '1001',
    fecha_documento: '2026-09-20',
    entidad_nombre: 'PROVEEDOR A'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100 }
  ], 'TEST_USER');

  assert.strictEqual(resEntrada.success, true);
  assert.strictEqual(repo.getStockActual()[0].cajas_actuales, 100);

  // Salida 40 cajas
  const resSalida = service.registrarSalida({
    id_documento: 'DOC-OUT-01',
    sha256_hash: 'hash_out_01',
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '5001',
    fecha_documento: '2026-09-21',
    entidad_nombre: 'CLIENTE B'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 40 }
  ], 'TEST_USER');

  assert.strictEqual(resSalida.success, true);
  assert.strictEqual(repo.getStockActual()[0].cajas_actuales, 60);
});

// --------------------------------------------------------------------------
// TEST H: Reconstrucción continúa funcionando determinísticamente
// --------------------------------------------------------------------------
runTest('H. Reconstrucción de stock -> recalcula capas y saldos desde MOVIMIENTOS', () => {
  const ss = new MockSpreadsheet('SS_REBUILD_TEST');
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const dedupService = { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps };
  const engineService = { buildStockKey, processMovement, rebuildStockFromMovements };
  const lock = { waitLock: () => true, releaseLock: () => {} };

  const service = new MovementService({
    repository: repo,
    lockService: lock,
    deduplicationService: dedupService,
    inventoryEngine: engineService
  });

  // Cargar 2 entradas y 1 salida
  service.registrarEntrada({
    id_documento: 'DOC-1', tipo_documento: 'COMPRA', serie: 'ACT26', numero: '1', fecha_documento: '2026-09-01'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100 }], 'TEST');

  service.registrarEntrada({
    id_documento: 'DOC-2', tipo_documento: 'COMPRA', serie: 'ACT26', numero: '2', fecha_documento: '2026-09-02'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 50 }], 'TEST');

  service.registrarSalida({
    id_documento: 'DOC-3', tipo_documento: 'SALIDA', serie: 'AVT26', numero: '3', fecha_documento: '2026-09-03'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 120 }], 'TEST');

  assert.strictEqual(repo.getStockActual()[0].cajas_actuales, 30);

  // Simular pérdida o corrupción borrando las tablas CAPAS_FIFO y STOCK_ACTUAL
  ss.getSheetByName('CAPAS_FIFO').clear();
  ss.getSheetByName('STOCK_ACTUAL').clear();
  assert.strictEqual(repo.getStockActual().length, 0);

  // Reconstruir
  const rebuildRes = service.rebuildStock();
  assert.strictEqual(rebuildRes.success, true);
  assert.strictEqual(rebuildRes.report.totalMovimientosProcesados, 3);
  assert.strictEqual(rebuildRes.report.stockMap['2112000|EPS104'], 30);

  const stockRecuperado = repo.getStockActual();
  assert.strictEqual(stockRecuperado.length, 1);
  assert.strictEqual(stockRecuperado[0].cajas_actuales, 30);
});

// --------------------------------------------------------------------------
// TEST I: No existen referencias hardcodeadas al spreadsheet real en la lógica
// --------------------------------------------------------------------------
runTest('I. Cero IDs o URLs de Google Sheets hardcodeados en el código de producción', () => {
  const srcDir = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

  const hardcodedPattern = /spreadsheets\/d\/[a-zA-Z0-9_-]+|1[a-zA-Z0-9_-]{30,}/g;

  for (const file of files) {
    const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const matches = content.match(hardcodedPattern);
    assert.strictEqual(
      matches,
      null,
      `El archivo src/${file} contiene identificadores o enlaces hardcodeados de Google Sheets: ${matches ? matches.join(', ') : ''}`
    );
  }
});

console.log('\n================================================================');
console.log(` RESULTADOS RUNTIME Y PERSISTENCIA: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
