/**
 * STOCK-LIGHT — Test Suite Oficial Fase 3.9
 * Persistencia de la Matriz Artículo-Envase y Aprendizaje Dinámico de Compras
 * 
 * Ejecutable localmente con Node.js: `node test/articulo_envase_persistence.test.js`
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { SheetsRepository, SCHEMA_DEFINITIONS } = require('../src/Repository');
const { ArticuloEnvaseValidator } = require('../src/ArticuloEnvaseValidator');
const { ArticuloEnvaseIngestionService } = require('../src/ArticuloEnvaseIngestionService');
const { MaestroResolver } = require('../src/MaestroResolver');
const { MovementService } = require('../src/MovementService');
const { DIAGNOSTIC_CODES } = require('../src/ImportDiagnostics');

// --- Mocking SpreadsheetApp para pruebas de persistencia puramente en memoria ---
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
    this.rows = [];
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
  constructor(id = 'SS_FASE_3_9_TEST') {
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

// Catálogo sintético de referencia para validación referencial
const CATALOGO_ARTICULOS = [
  { codigo_articulo: '10127111', nombre_articulo: 'TOMATE ROSA I M', activo: true },
  { codigo_articulo: '19127111', nombre_articulo: 'TOMATE ROSA I', activo: true },
  { codigo_articulo: '2112000', nombre_articulo: 'TOMATE ROSA I', activo: true },
  { codigo_articulo: '2112005', nombre_articulo: 'TOMATE MORESCO I M', activo: true },
  { codigo_articulo: '2112006', nombre_articulo: 'TOMATE MORESCO I MM', activo: true },
  { codigo_articulo: '10101100', nombre_articulo: 'TOMATE LARGA VIDA S/C', activo: true },
  { codigo_articulo: '99999999', nombre_articulo: 'ARTICULO OBSOLETO', activo: false }
];

const CATALOGO_ENVASES = [
  { codigo_envase: 'EPS104', descripcion_envase: 'EPS 104', activo: true },
  { codigo_envase: 'EPS106', descripcion_envase: 'EPS 106 9x500', activo: true },
  { codigo_envase: '3112000', descripcion_envase: 'EPS 104', activo: true },
  { codigo_envase: '3112201', descripcion_envase: 'EPS 106 9x500', activo: true },
  { codigo_envase: 'CT4395', descripcion_envase: 'CT4395 MORESCO', activo: true },
  { codigo_envase: 'CT4395MAD', descripcion_envase: 'CT4395MAD', activo: true },
  { codigo_envase: 'ENV_INACTIVO', descripcion_envase: 'ENV INACTIVO', activo: false }
];

console.log('================================================================');
console.log(' TEST SUITE FASE 3.9 — PERSISTENCIA ARTÍCULO-ENVASE & APRENDIZAJE');
console.log('================================================================\n');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

// --------------------------------------------------------------------------
// TEST 1: Alta de asociación válida
// --------------------------------------------------------------------------
runTest('1. Alta de asociación válida -> persiste en MAESTRO con esquema completo', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const service = new ArticuloEnvaseIngestionService({ repository: repo });
  const csvContent = fs.readFileSync(path.join(__dirname, 'fixtures', 'matriz_articulo_envase_valida.csv'), 'utf8');

  const res = service.ingestarMatriz(csvContent, {
    maestroArticulos: CATALOGO_ARTICULOS,
    maestroEnvases: CATALOGO_ENVASES,
    tenantId: 'DEFAULT'
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.status, 'INGESTADO');
  assert.strictEqual(res.insertedCount, 5);

  const maestro = repo.getMaestro();
  assert.strictEqual(maestro.length, 5);

  const fila1 = maestro.find(m => m.codigo_articulo === '10127111' && m.codigo_envase === '3112201');
  assert.ok(fila1, 'Debe existir la asociación 10127111 | 3112201');
  assert.strictEqual(fila1.nombre_articulo, 'TOMATE ROSA I M');
  assert.strictEqual(fila1.es_predeterminado, true);
  assert.strictEqual(fila1.activo, true);
  assert.strictEqual(fila1.tenant_id, 'DEFAULT');
  assert.ok(fila1.fecha_alta, 'Debe registrar fecha_alta');
});

// --------------------------------------------------------------------------
// TEST 2: Detección de duplicado
// --------------------------------------------------------------------------
runTest('2. Detección de duplicado -> rechaza relaciones duplicadas en el archivo', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const service = new ArticuloEnvaseIngestionService({ repository: repo });
  const csvContent = fs.readFileSync(path.join(__dirname, 'fixtures', 'matriz_articulo_envase_duplicados.csv'), 'utf8');

  const res = service.ingestarMatriz(csvContent, {
    maestroArticulos: CATALOGO_ARTICULOS,
    maestroEnvases: CATALOGO_ENVASES
  });

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.status, 'RECHAZADO');
  assert.ok(res.errors.some(e => e.codigoError === DIAGNOSTIC_CODES.RELACION_DUPLICADA));
});

// --------------------------------------------------------------------------
// TEST 3: Idempotencia
// --------------------------------------------------------------------------
runTest('3. Idempotencia -> segunda ingesta de los mismos datos no duplica filas', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const service = new ArticuloEnvaseIngestionService({ repository: repo });
  const csvContent = fs.readFileSync(path.join(__dirname, 'fixtures', 'matriz_articulo_envase_valida.csv'), 'utf8');

  // Primera ingesta
  const res1 = service.ingestarMatriz(csvContent, {
    maestroArticulos: CATALOGO_ARTICULOS,
    maestroEnvases: CATALOGO_ENVASES
  });
  assert.strictEqual(res1.insertedCount, 5);
  assert.strictEqual(res1.updatedCount, 0);

  // Segunda ingesta idéntica
  const res2 = service.ingestarMatriz(csvContent, {
    maestroArticulos: CATALOGO_ARTICULOS,
    maestroEnvases: CATALOGO_ENVASES
  });
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.insertedCount, 0, 'No debe insertar nuevas filas');
  assert.strictEqual(res2.updatedCount, 5, 'Debe reutilizar/actualizar las 5 filas existentes');

  const maestro = repo.getMaestro();
  assert.strictEqual(maestro.length, 5, 'La tabla MAESTRO debe mantener exactamente 5 filas');
});

// --------------------------------------------------------------------------
// TEST 4: Artículo inexistente
// --------------------------------------------------------------------------
runTest('4. Artículo inexistente -> rechazado con ARTICULO_NO_EXISTE', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const service = new ArticuloEnvaseIngestionService({ repository: repo });
  const csv = 'CodigoArticulo;NombreArticulo;CodigoEnvase;NombreEnvase;EsPredeterminado;Activo\n' +
              '99900011;TOMATE FANTASMA;EPS104;EPS 104;true;true';

  const res = service.ingestarMatriz(csv, {
    maestroArticulos: CATALOGO_ARTICULOS,
    maestroEnvases: CATALOGO_ENVASES
  });

  assert.strictEqual(res.success, false);
  assert.ok(res.errors.some(e => e.codigoError === DIAGNOSTIC_CODES.ARTICULO_NO_EXISTE));
});

// --------------------------------------------------------------------------
// TEST 5: Envase inexistente o DEFAULT
// --------------------------------------------------------------------------
runTest('5. Envase inexistente / DEFAULT -> rechaza envase no comercial', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const service = new ArticuloEnvaseIngestionService({ repository: repo });

  // A. Envase no existente en catálogo
  const csvInexistente = 'CodigoArticulo;NombreArticulo;CodigoEnvase;NombreEnvase;EsPredeterminado;Activo\n' +
                         '10127111;TOMATE ROSA I M;ENV_INVENTADO;CAJA RARA;true;true';
  const res1 = service.ingestarMatriz(csvInexistente, {
    maestroArticulos: CATALOGO_ARTICULOS,
    maestroEnvases: CATALOGO_ENVASES
  });
  assert.strictEqual(res1.success, false);
  assert.ok(res1.errors.some(e => e.codigoError === DIAGNOSTIC_CODES.ENVASE_NO_EXISTE));

  // B. Intento de usar DEFAULT como envase comercial
  const csvDefault = 'CodigoArticulo;NombreArticulo;CodigoEnvase;NombreEnvase;EsPredeterminado;Activo\n' +
                     '10127111;TOMATE ROSA I M;DEFAULT;DEFAULT;true;true';
  const res2 = service.ingestarMatriz(csvDefault, {
    maestroArticulos: CATALOGO_ARTICULOS,
    maestroEnvases: CATALOGO_ENVASES
  });
  assert.strictEqual(res2.success, false);
  assert.ok(res2.errors.some(e => e.codigoError === DIAGNOSTIC_CODES.ENVASE_COMERCIAL_INVALIDO));
});

// --------------------------------------------------------------------------
// TEST 6: Tenant incorrecto
// --------------------------------------------------------------------------
runTest('6. Tenant incorrecto -> rechaza tenant vacío o no coincidente con el autorizado', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const service = new ArticuloEnvaseIngestionService({ repository: repo });

  // A. Tenant vacío
  const resVacio = service.ingestarMatriz('10127111;TOMATE ROSA I M;3112000;EPS 104;true;true', { tenantId: '' });
  assert.strictEqual(resVacio.success, false);
  assert.strictEqual(resVacio.codigoError, 'TENANT_INVALIDO');

  // B. Tenant no coincidente con el autorizado
  const csvMismatch = 'CodigoArticulo;NombreArticulo;CodigoEnvase;NombreEnvase;EsPredeterminado;Activo;TenantId\n' +
                      '10127111;TOMATE ROSA I M;3112000;EPS 104;true;true;TENANT_HACKER';
  const resMismatch = service.ingestarMatriz(csvMismatch, {
    maestroArticulos: CATALOGO_ARTICULOS,
    maestroEnvases: CATALOGO_ENVASES,
    tenantId: 'DEFAULT',
    expectedTenantId: 'DEFAULT'
  });
  assert.strictEqual(resMismatch.success, false);
  assert.ok(resMismatch.errors.some(e => e.codigoError === DIAGNOSTIC_CODES.TENANT_INVALIDO));
});

// --------------------------------------------------------------------------
// TEST 7: Un artículo con múltiples envases
// --------------------------------------------------------------------------
runTest('7. Un artículo con múltiples envases -> cardinalidad MULTIFORMATO con ambos activos', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const service = new ArticuloEnvaseIngestionService({ repository: repo });
  const csv = 'CodigoArticulo;NombreArticulo;CodigoEnvase;NombreEnvase;EsPredeterminado;Activo\n' +
              '10127111;TOMATE ROSA I M;3112201;EPS 106 9x500;true;true\n' +
              '10127111;TOMATE ROSA I M;3112000;EPS 104;false;true';

  const res = service.ingestarMatriz(csv, {
    maestroArticulos: CATALOGO_ARTICULOS,
    maestroEnvases: CATALOGO_ENVASES
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.cardinalidad['10127111'].clasificacion, 'MULTIFORMATO');
  assert.strictEqual(res.cardinalidad['10127111'].envasesActivos, 2);

  const assocs = repo.getAsociacionesArticulo('10127111');
  assert.strictEqual(assocs.length, 2);
});

// --------------------------------------------------------------------------
// TEST 8: Un único predeterminado válido
// --------------------------------------------------------------------------
runTest('8. Un único predeterminado válido -> artículo multiformato tiene solo 1 predeterminado', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const service = new ArticuloEnvaseIngestionService({ repository: repo });
  const csv = 'CodigoArticulo;NombreArticulo;CodigoEnvase;NombreEnvase;EsPredeterminado;Activo\n' +
              '10127111;TOMATE ROSA I M;3112201;EPS 106 9x500;true;true\n' +
              '10127111;TOMATE ROSA I M;3112000;EPS 104;false;true';

  service.ingestarMatriz(csv, {
    maestroArticulos: CATALOGO_ARTICULOS,
    maestroEnvases: CATALOGO_ENVASES
  });

  const assocs = repo.getAsociacionesArticulo('10127111');
  const defaults = assocs.filter(a => a.es_predeterminado === true);
  assert.strictEqual(defaults.length, 1);
  assert.strictEqual(defaults[0].codigo_envase, '3112201');
});

// --------------------------------------------------------------------------
// TEST 9: Dos predeterminados -> conflicto
// --------------------------------------------------------------------------
runTest('9. Dos predeterminados -> detecta conflicto sin resolver arbitrariamente', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const service = new ArticuloEnvaseIngestionService({ repository: repo });
  const csvContent = fs.readFileSync(path.join(__dirname, 'fixtures', 'matriz_articulo_envase_conflicto_defaults.csv'), 'utf8');

  const res = service.ingestarMatriz(csvContent, {
    maestroArticulos: CATALOGO_ARTICULOS,
    maestroEnvases: CATALOGO_ENVASES
  });

  assert.strictEqual(res.success, false);
  assert.ok(res.errors.some(e => e.codigoError === DIAGNOSTIC_CODES.CONFLICTO_PREDETERMINADO_MULTIPLE));
});

// --------------------------------------------------------------------------
// TEST 10: Cambio de predeterminado
// --------------------------------------------------------------------------
runTest('10. Cambio de predeterminado -> actualiza nuevo predeterminado y conserva anterior activo', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const service = new ArticuloEnvaseIngestionService({ repository: repo });
  const csv = 'CodigoArticulo;NombreArticulo;CodigoEnvase;NombreEnvase;EsPredeterminado;Activo\n' +
              '10127111;TOMATE ROSA I M;3112201;EPS 106 9x500;true;true\n' +
              '10127111;TOMATE ROSA I M;3112000;EPS 104;false;true';

  service.ingestarMatriz(csv, {
    maestroArticulos: CATALOGO_ARTICULOS,
    maestroEnvases: CATALOGO_ENVASES
  });

  // Cambio explícito a 3112000 como nuevo predeterminado
  const resCambio = service.cambiarEnvasePredeterminado('10127111', '3112000');
  assert.strictEqual(resCambio.success, true);
  assert.strictEqual(resCambio.nuevoPredeterminado, '3112000');
  assert.strictEqual(resCambio.anteriorPredeterminado, '3112201');

  const assocs = repo.getAsociacionesArticulo('10127111');
  const env3112000 = assocs.find(a => a.codigo_envase === '3112000');
  const env3112201 = assocs.find(a => a.codigo_envase === '3112201');

  assert.strictEqual(env3112000.es_predeterminado, true);
  assert.strictEqual(env3112000.activo, true);

  assert.strictEqual(env3112201.es_predeterminado, false, 'Anterior predeterminado debe quedar en false');
  assert.strictEqual(env3112201.activo, true, 'Anterior predeterminado debe seguir activo comercialmente');
});

// --------------------------------------------------------------------------
// TEST 11: Confirmación con recordar=true
// --------------------------------------------------------------------------
runTest('11. Confirmación con recordar=true -> persiste asociación en MAESTRO', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  // Registrar un artículo en MAESTRO con envase CT4395
  repo.saveMaestro([
    {
      codigo_articulo: '2112005',
      codigo_envase: 'CT4395',
      nombre_articulo: 'TOMATE MORESCO I M',
      descripcion_envase: 'CT4395 MORESCO',
      es_predeterminado: false,
      activo: true,
      tenant_id: 'DEFAULT'
    }
  ]);

  // Insertar un documento PENDIENTE_REVISION
  repo.appendDocumento({
    id_documento: 'DOC-COMPRA-PEND-01',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '4001',
    fecha_documento: '2026-09-30',
    total_lineas: 1,
    total_cajas: 100,
    estado_proceso: 'PENDIENTE_REVISION'
  });

  const movService = new MovementService({ repository: repo });
  const serverContext = {
    canonicalLines: [
      { lineIndex: 1, articleCode: '2112005', articleName: 'TOMATE MORESCO I M', boxes: 100 }
    ],
    tenantId: 'DEFAULT'
  };

  const clientPayload = {
    idDocumento: 'DOC-COMPRA-PEND-01',
    lineResolutions: [
      { lineIndex: 1, codigoEnvase: 'CT4395', recordar: true, esPredeterminado: true }
    ]
  };

  const res = movService.confirmarCompraPendiente(clientPayload, 'OPERADOR', null, serverContext);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.status, 'CONFIRMADO');
  assert.strictEqual(res.asociacionesRecordadas.length, 1);

  // Verificar que MAESTRO fue actualizado con es_predeterminado = true
  const maestro = repo.getMaestro();
  const rel = maestro.find(m => m.codigo_articulo === '2112005' && m.codigo_envase === 'CT4395');
  assert.ok(rel);
  assert.strictEqual(rel.es_predeterminado, true);
});

// --------------------------------------------------------------------------
// TEST 12: Confirmación con recordar=false
// --------------------------------------------------------------------------
runTest('12. Confirmación con recordar=false -> resuelve compra sin alterar MAESTRO', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  repo.saveMaestro([
    {
      codigo_articulo: '2112005',
      codigo_envase: 'CT4395',
      nombre_articulo: 'TOMATE MORESCO I M',
      descripcion_envase: 'CT4395 MORESCO',
      es_predeterminado: false,
      activo: true,
      tenant_id: 'DEFAULT'
    }
  ]);

  repo.appendDocumento({
    id_documento: 'DOC-COMPRA-PEND-02',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '4002',
    fecha_documento: '2026-09-30',
    total_lineas: 1,
    total_cajas: 50,
    estado_proceso: 'PENDIENTE_REVISION'
  });

  const movService = new MovementService({ repository: repo });
  const serverContext = {
    canonicalLines: [
      { lineIndex: 1, articleCode: '2112005', articleName: 'TOMATE MORESCO I M', boxes: 50 }
    ],
    tenantId: 'DEFAULT'
  };

  const clientPayload = {
    idDocumento: 'DOC-COMPRA-PEND-02',
    lineResolutions: [
      { lineIndex: 1, codigoEnvase: 'CT4395', recordar: false }
    ]
  };

  const res = movService.confirmarCompraPendiente(clientPayload, 'OPERADOR', null, serverContext);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.asociacionesRecordadas.length, 0);

  // Verificar que MAESTRO sigue manteniendo es_predeterminado = false
  const maestro = repo.getMaestro();
  const rel = maestro.find(m => m.codigo_articulo === '2112005' && m.codigo_envase === 'CT4395');
  assert.strictEqual(rel.es_predeterminado, false);
});

// --------------------------------------------------------------------------
// TEST 13: Manipulación de codigoArticulo desde cliente
// --------------------------------------------------------------------------
runTest('13. Manipulación de codigoArticulo desde cliente -> bloqueado por Trust Boundary', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  repo.appendDocumento({
    id_documento: 'DOC-COMPRA-PEND-03',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '4003',
    fecha_documento: '2026-09-30',
    total_lineas: 1,
    total_cajas: 50,
    estado_proceso: 'PENDIENTE_REVISION'
  });

  const movService = new MovementService({ repository: repo });

  // Intento de inyectar codigoArticulo en el payload
  assert.throws(() => {
    movService.confirmarCompraPendiente({
      idDocumento: 'DOC-COMPRA-PEND-03',
      codigoArticulo: '10127111',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'EPS104' }]
    });
  }, /Trust Boundary violado.*codigoArticulo/);

  // Intento de inyectar codigoArticulo dentro de lineResolutions
  assert.throws(() => {
    movService.confirmarCompraPendiente({
      idDocumento: 'DOC-COMPRA-PEND-03',
      lineResolutions: [{ lineIndex: 1, codigoArticulo: '10127111', codigoEnvase: 'EPS104' }]
    });
  }, /Trust Boundary violado.*codigoArticulo/);
});

// --------------------------------------------------------------------------
// TEST 14: Manipulación de codigoEnvase desde cliente
// --------------------------------------------------------------------------
runTest('14. Manipulación de codigoEnvase desde cliente -> bloquea DEFAULT o envase no permitido', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  repo.saveMaestro([
    {
      codigo_articulo: '2112005',
      codigo_envase: 'CT4395',
      nombre_articulo: 'TOMATE MORESCO I M',
      descripcion_envase: 'CT4395 MORESCO',
      activo: true
    }
  ]);

  repo.appendDocumento({
    id_documento: 'DOC-COMPRA-PEND-04',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '4004',
    fecha_documento: '2026-09-30',
    total_lineas: 1,
    total_cajas: 50,
    estado_proceso: 'PENDIENTE_REVISION'
  });

  const movService = new MovementService({ repository: repo });
  const serverContext = {
    canonicalLines: [
      { lineIndex: 1, articleCode: '2112005', articleName: 'TOMATE MORESCO I M', boxes: 50 }
    ]
  };

  // A. Cliente envía DEFAULT
  assert.throws(() => {
    movService.confirmarCompraPendiente({
      idDocumento: 'DOC-COMPRA-PEND-04',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'DEFAULT' }]
    }, 'OPERADOR', null, serverContext);
  }, /Trust Boundary violado.*DEFAULT/);

  // B. Cliente envía envase ajeno no permitido para este artículo (ej. EPS104 no existe para 2112005)
  assert.throws(() => {
    movService.confirmarCompraPendiente({
      idDocumento: 'DOC-COMPRA-PEND-04',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'EPS104' }]
    }, 'OPERADOR', null, serverContext);
  }, /Trust Boundary violado.*no está permitido para el artículo/);
});

// --------------------------------------------------------------------------
// TEST 15: Manipulación de tenant_id
// --------------------------------------------------------------------------
runTest('15. Manipulación de tenant_id -> bloquea tenant manipulado por el cliente', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  repo.appendDocumento({
    id_documento: 'DOC-COMPRA-PEND-05',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '4005',
    fecha_documento: '2026-09-30',
    total_lineas: 1,
    total_cajas: 50,
    estado_proceso: 'PENDIENTE_REVISION'
  });

  const movService = new MovementService({ repository: repo });
  const serverContext = {
    canonicalLines: [{ lineIndex: 1, articleCode: '2112005', articleName: 'TOMATE MORESCO I M', boxes: 50 }],
    tenantId: 'TENANT_OFICIAL'
  };

  // Cliente intenta inyectar tenant_id ajeno
  assert.throws(() => {
    movService.confirmarCompraPendiente({
      idDocumento: 'DOC-COMPRA-PEND-05',
      tenant_id: 'TENANT_HACKER',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'CT4395' }]
    }, 'OPERADOR', null, serverContext);
  }, /Trust Boundary violado.*tenant/);
});

// --------------------------------------------------------------------------
// TEST 16: Persistencia únicamente server-side
// --------------------------------------------------------------------------
runTest('16. Persistencia únicamente server-side -> cliente no puede inyectar filas o líneas directas', () => {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository(ss);
  repo.provisionDatabase();

  const movService = new MovementService({ repository: repo });

  // A. Cliente envía rawText
  assert.throws(() => {
    movService.confirmarCompraPendiente({
      idDocumento: 'DOC-001',
      rawText: 'TEXTO MANIPULADO'
    });
  }, /Trust Boundary violado.*rawText/);

  // B. Cliente envía lines directas
  assert.throws(() => {
    movService.confirmarCompraPendiente({
      idDocumento: 'DOC-001',
      lines: [{ boxes: 9999 }]
    });
  }, /Trust Boundary violado.*líneas/);
});

// --------------------------------------------------------------------------
// TEST 17: MaestroResolver encuentra asociación predeterminada
// --------------------------------------------------------------------------
runTest('17. MaestroResolver -> orden 1: resuelve mediante asociación activa y predeterminada en MAESTRO', () => {
  const maestroData = [
    {
      codigo_articulo: '10127111',
      nombre_articulo: 'TOMATE ROSA I M',
      codigo_envase: '3112201',
      descripcion_envase: 'EPS 106 9x500',
      es_predeterminado: true,
      activo: true,
      tenant_id: 'DEFAULT'
    },
    {
      codigo_articulo: '10127111',
      nombre_articulo: 'TOMATE ROSA I M',
      codigo_envase: '3112000',
      descripcion_envase: 'EPS 104',
      es_predeterminado: false,
      activo: true,
      tenant_id: 'DEFAULT'
    }
  ];

  const resolver = new MaestroResolver(maestroData);
  const res = resolver.resolveEnvaseCompra('10127111', 'TOMATE ROSA I M');

  assert.strictEqual(res.resolved, true);
  assert.strictEqual(res.code, '3112201');
  assert.strictEqual(res.method, 'MAESTRO_PREDETERMINADO');
});

// --------------------------------------------------------------------------
// TEST 18: MaestroResolver mantiene fallback a regla determinista
// --------------------------------------------------------------------------
runTest('18. MaestroResolver -> orden 2: mantiene fallback a regla determinista si no hay predeterminado', () => {
  // MAESTRO sin flag es_predeterminado, pero con la combinación válida
  const maestroData = [
    {
      codigo_articulo: '19127111',
      nombre_articulo: 'TOMATE ROSA I',
      codigo_envase: 'EPS104',
      descripcion_envase: 'EPS 104',
      es_predeterminado: false,
      activo: true
    }
  ];

  const resolver = new MaestroResolver(maestroData);
  // Según regla DETERMINISTIC_COMPRA_RULES, 19127111 mapea a EPS104
  const res = resolver.resolveEnvaseCompra('19127111', 'TOMATE ROSA I');

  assert.strictEqual(res.resolved, true);
  assert.strictEqual(res.code, 'EPS104');
  assert.strictEqual(res.method, 'REGLA_COMPRA_ROSA_I_EPS104');
});

// --------------------------------------------------------------------------
// TEST 19: Si no existe asociación -> PENDIENTE_REVISION
// --------------------------------------------------------------------------
runTest('19. Si no existe asociación determinable -> devuelve PENDIENTE_REVISION sin inventar', () => {
  // Artículo multiformato sin predeterminado y sin regla determinista
  const maestroData = [
    {
      codigo_articulo: '2112999',
      nombre_articulo: 'TOMATE DESCONOCIDO',
      codigo_envase: 'EPS104',
      descripcion_envase: 'EPS 104',
      es_predeterminado: false,
      activo: true
    },
    {
      codigo_articulo: '2112999',
      nombre_articulo: 'TOMATE DESCONOCIDO',
      codigo_envase: 'CT4395',
      descripcion_envase: 'CT4395',
      es_predeterminado: false,
      activo: true
    }
  ];

  const resolver = new MaestroResolver(maestroData);
  const res = resolver.resolveEnvaseCompra('2112999', 'TOMATE DESCONOCIDO');

  assert.strictEqual(res.resolved, false);
  assert.strictEqual(res.method, 'REQUIERE_REVISION_HUMANA');
  assert.strictEqual(res.reason, 'ENVASE_NO_DETERMINABLE_DESDE_PDF');
});

// --------------------------------------------------------------------------
// TEST 20: InventoryEngine permanece sin cambios
// --------------------------------------------------------------------------
runTest('20. InventoryEngine permanece 100% inalterado respecto a Git HEAD', () => {
  const enginePath = path.join(__dirname, '..', 'src', 'InventoryEngine.js');
  assert.ok(fs.existsSync(enginePath), 'InventoryEngine.js debe existir');

  // Ejecutar git diff sobre InventoryEngine.js
  const diff = execSync('git diff HEAD -- src/InventoryEngine.js', {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.strictEqual(diff.trim(), '', 'InventoryEngine.js NO debe tener ninguna modificación respecto a HEAD');
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE FASE 3.9: ${passedTests} SUPERADAS | ${failedTests} FALLIDAS`);
console.log('================================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
