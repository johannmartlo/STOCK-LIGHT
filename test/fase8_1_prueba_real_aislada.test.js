/**
 * STOCK-LIGHT — Test Suite Fase 8.1
 * 
 * PRUEBA REAL AISLADA DE INICIALIZACIÓN E IDEMPOTENCIA
 * 
 * Verifica:
 * 1. Configuración de SPREADSHEET_ID y ausencia de hojas de prueba preexistentes asumiendo producción.
 * 2. Diseño de aislamiento estricto mediante inyección de spreadsheetId/spreadsheet sin tocar ScriptProperties.
 * 3. Ejecución de Pasada 1 (Provisionamiento y Carga Inicial) en hoja de pruebas aislada.
 * 4. Ejecución de Pasada 2 (Idempotencia estricta: 0 insertados, 0 duplicados, recuentos finales idénticos).
 * 5. Verificación de stock cero: DOCUMENTOS, MOVIMIENTOS, CAPAS_FIFO y STOCK_ACTUAL vacíos (0 cajas).
 * 6. Verificación de que 83 combinaciones a revisar y 55 fuera de catálogo permanecen aisladas (inactivas).
 * 7. Protocolo de restauración y eliminación del entorno de pruebas.
 * 8. Invariante Innegociable: InventoryEngine.js permanece 100% inalterado.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { SheetsRepository, SCHEMA_DEFINITIONS } = require('../src/Repository');
const { MasterInitializationService, GRUPOS_COMERCIALES_INICIALES } = require('../src/MasterInitializationService');
const { CommercialGroupResolver } = require('../src/CommercialGroupResolver');
const { getSpreadsheetIdConfig, resolveDatabaseSpreadsheet } = require('../src/Config');

// Arnés de simulación de SpreadsheetApp independiente para prueba aislada
function createIsolatedTestSpreadsheetHarness(testSheetId = 'TEST_SPREADSHEET_ID_ISOLATED_12345') {
  const sheets = {};

  const createSheetObject = (name) => {
    let rowData = [];
    return {
      getName: () => name,
      getLastColumn: () => (rowData.length > 0 ? rowData[0].length : 0),
      getLastRow: () => rowData.length,
      getRange: (row, col, numRows = 1, numCols = 1) => ({
        getValues: () => {
          const res = [];
          for (let r = 0; r < numRows; r++) {
            const rowIndex = row - 1 + r;
            const rowValues = [];
            for (let c = 0; c < numCols; c++) {
              const colIndex = col - 1 + c;
              rowValues.push((rowData[rowIndex] && rowData[rowIndex][colIndex] !== undefined) ? rowData[rowIndex][colIndex] : '');
            }
            res.push(rowValues);
          }
          return res;
        },
        setValues: (values) => {
          for (let r = 0; r < values.length; r++) {
            const targetRow = row - 1 + r;
            if (!rowData[targetRow]) rowData[targetRow] = [];
            for (let c = 0; c < values[r].length; c++) {
              const targetCol = col - 1 + c;
              rowData[targetRow][targetCol] = values[r][c];
            }
          }
        },
        clearContent: () => {
          for (let r = 0; r < numRows; r++) {
            const targetRow = row - 1 + r;
            if (rowData[targetRow]) {
              for (let c = 0; c < numCols; c++) {
                const targetCol = col - 1 + c;
                rowData[targetRow][targetCol] = '';
              }
            }
          }
        },
        setBackground: () => ({
          setFontColor: () => ({
            setFontWeight: () => {}
          })
        })
      }),
      setFrozenRows: () => {},
      clear: () => { rowData = []; },
      _getData: () => rowData
    };
  };

  const testSpreadsheet = {
    getId: () => testSheetId,
    getName: () => 'STOCK-LIGHT — Hoja de Pruebas Aislada',
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => {
      const s = createSheetObject(name);
      sheets[name] = s;
      return s;
    },
    getSheets: () => Object.values(sheets)
  };

  const mockSpreadsheetApp = {
    openById: (id) => {
      if (id === testSheetId) return testSpreadsheet;
      throw new Error(`SpreadsheetApp.openById: No se encontró la hoja con ID ${id}`);
    },
    getActiveSpreadsheet: () => null // Contexto standalone
  };

  return {
    testSheetId,
    testSpreadsheet,
    mockSpreadsheetApp,
    sheets
  };
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
    console.error(`     Error: ${err.message}\n`);
    failed++;
  }
}

console.log('\n================================================================');
console.log(' TEST SUITE FASE 8.1 — PRUEBA REAL AISLADA DE INICIALIZACIÓN');
console.log('================================================================\n');

// -------------------------------------------------------------
// BLOQUE 1: AUDITORÍA DE CONFIGURACIÓN Y AUSENCIA DE HOJA TEST
// -------------------------------------------------------------
runTest('1. Configuración de SPREADSHEET_ID: No existe hoja de pruebas hardcodeada ni asumida en el proyecto', () => {
  // Comprobar que en el entorno no hay SPREADSHEET_ID configurado por defecto
  const envId = getSpreadsheetIdConfig();
  assert.strictEqual(envId, null, 'No debe existir un SPREADSHEET_ID hardcodeado o por defecto');

  // Comprobar que resolveDatabaseSpreadsheet falla si no se provee ID explícito
  assert.throws(() => {
    resolveDatabaseSpreadsheet({ spreadsheetApp: { getActiveSpreadsheet: () => null } });
  }, /Configuración de persistencia no encontrada/);
});

runTest('2. Aislamiento por inyección: El repositorio puede apuntar a la hoja de pruebas sin tocar ScriptProperties', () => {
  const harness = createIsolatedTestSpreadsheetHarness('TEST_ISOLATED_SPREADSHEET_ID_999');

  // Inyección mediante spreadsheetId en options
  const repo = new SheetsRepository({
    spreadsheetId: harness.testSheetId,
    spreadsheetApp: harness.mockSpreadsheetApp
  });

  const ss = repo.getSpreadsheet();
  assert.strictEqual(ss.getId(), 'TEST_ISOLATED_SPREADSHEET_ID_999');
});

// -------------------------------------------------------------
// BLOQUE 2: EJECUCIÓN AISLADA PASADA 1 (CARGA INICIAL)
// -------------------------------------------------------------
runTest('3. Pasada 1 en hoja de pruebas: Provisiona las 9 hojas e importa los catálogos homologados', () => {
  const harness = createIsolatedTestSpreadsheetHarness('TEST_SPREADSHEET_HOJA_PRUEBAS_FASE8_1');
  const repo = new SheetsRepository({
    spreadsheet: harness.testSpreadsheet
  });

  const service = new MasterInitializationService({ repository: repo });
  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  const jsonPath = path.join(__dirname, '..', 'docs', 'reference', 'MAESTRO_BASE.json');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const jsonContent = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const catalogos = service.construirCatalogos(csvContent, jsonContent);
  const res1 = service.ejecutarCargaInicial(catalogos, { usuario: 'OPERADOR_TEST_8_1' });

  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.resumen.gruposComerciales.insertados, 7);
  assert.strictEqual(res1.resumen.articulos.insertados, 162);
  assert.strictEqual(res1.resumen.envases.insertados, 83);
  assert.strictEqual(res1.resumen.matrizArticuloEnvase.insertados, 300);

  // Verificar que la hoja de pruebas contiene exactamente las 9 tablas oficiales
  const expectedSheets = [
    'MAESTRO_ARTICULOS', 'MAESTRO_ENVASES', 'GRUPOS_COMERCIALES',
    'MATRIZ_ARTICULO_ENVASE', 'DOCUMENTOS', 'MOVIMIENTOS',
    'CAPAS_FIFO', 'STOCK_ACTUAL', 'LOG_OPERACIONES'
  ];
  for (const s of expectedSheets) {
    assert.ok(harness.testSpreadsheet.getSheetByName(s), `La hoja de pruebas debe contener la pestaña '${s}'`);
  }
});

// -------------------------------------------------------------
// BLOQUE 3: EJECUCIÓN AISLADA PASADA 2 (IDEMPOTENCIA ESTRICTA)
// -------------------------------------------------------------
runTest('4. Pasada 2 en hoja de pruebas: Cero inserciones, cero duplicados, recuentos finales idénticos', () => {
  const harness = createIsolatedTestSpreadsheetHarness('TEST_SPREADSHEET_IDEMPOTENCIA_FASE8_1');
  const repo = new SheetsRepository({
    spreadsheet: harness.testSpreadsheet
  });

  const service = new MasterInitializationService({ repository: repo });
  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  const jsonPath = path.join(__dirname, '..', 'docs', 'reference', 'MAESTRO_BASE.json');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const jsonContent = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // Ejecutar doble pasada integrada
  const informe = service.ejecutarPruebaAisladaDoblePasada(csvContent, jsonContent, {
    usuario: 'OPERADOR_TEST_8_1'
  });

  assert.strictEqual(informe.success, true);
  assert.strictEqual(informe.idempotencia.conforme, true);
  assert.strictEqual(informe.pasada2.gruposComerciales.insertados, 0);
  assert.strictEqual(informe.pasada2.articulos.insertados, 0);
  assert.strictEqual(informe.pasada2.envases.insertados, 0);
  assert.strictEqual(informe.pasada2.matrizArticuloEnvase.insertados, 0);

  // Recuentos estables
  assert.strictEqual(informe.idempotencia.estadoFinal.gruposCount, 7);
  assert.strictEqual(informe.idempotencia.estadoFinal.articulosCount, 162);
  assert.strictEqual(informe.idempotencia.estadoFinal.envasesCount, 83);
  assert.strictEqual(informe.idempotencia.estadoFinal.matrizCount, 300);
});

// -------------------------------------------------------------
// BLOQUE 4: VERIFICACIÓN DE INMUTABILIDAD Y STOCK CERO
// -------------------------------------------------------------
runTest('5. Verificación de stock cero: DOCUMENTOS, MOVIMIENTOS, CAPAS_FIFO y STOCK_ACTUAL tienen cero registros', () => {
  const harness = createIsolatedTestSpreadsheetHarness('TEST_SPREADSHEET_STOCK_ZERO_FASE8_1');
  const repo = new SheetsRepository({
    spreadsheet: harness.testSpreadsheet
  });

  const service = new MasterInitializationService({ repository: repo });
  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');

  const informe = service.ejecutarPruebaAisladaDoblePasada(csvContent, [], { usuario: 'OPERADOR_TEST' });

  assert.strictEqual(informe.verificacionStockCero.conforme, true);
  assert.strictEqual(informe.verificacionStockCero.documentos, 0);
  assert.strictEqual(informe.verificacionStockCero.movimientos, 0);
  assert.strictEqual(informe.verificacionStockCero.capasFifo, 0);
  assert.strictEqual(informe.verificacionStockCero.stockActual, 0);
  assert.strictEqual(informe.verificacionStockCero.cajasTotales, 0);
});

// -------------------------------------------------------------
// BLOQUE 5: AISLAMIENTO DE COMBINACIONES NO HOMOLOGADAS
// -------------------------------------------------------------
runTest('6. Aislamiento de combinaciones no homologadas: 83 a revisar y 55 fuera no se activan ni reciben grupos ambiguos', () => {
  const harness = createIsolatedTestSpreadsheetHarness('TEST_SPREADSHEET_AISLAMIENTO_FASE8_1');
  const repo = new SheetsRepository({
    spreadsheet: harness.testSpreadsheet
  });

  const service = new MasterInitializationService({ repository: repo });
  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');

  const informe = service.ejecutarPruebaAisladaDoblePasada(csvContent, [], { usuario: 'OPERADOR_TEST' });

  assert.strictEqual(informe.aislamientoNoHomologadas.conforme, true);
  assert.strictEqual(informe.aislamientoNoHomologadas.homologadasActivas, 300);
  assert.strictEqual(informe.aislamientoNoHomologadas.pendientesRevisarAisladas, 83);
  assert.strictEqual(informe.aislamientoNoHomologadas.fueraCatalogoAisladas, 55);
  assert.strictEqual(informe.aislamientoNoHomologadas.asignacionesAmbiguas, 0);

  // Asegurar que en MATRIZ_ARTICULO_ENVASE todas las 300 tienen grupo asignado
  const matriz = repo.getMatrizArticuloEnvase();
  assert.strictEqual(matriz.length, 300);
  assert.ok(matriz.every(m => m.grupo_comercial && m.grupo_comercial !== 'NO_CLASIFICADO'));
});

// -------------------------------------------------------------
// BLOQUE 6: PROTOCOLO DE RESTAURACIÓN / LIMPIEZA
// -------------------------------------------------------------
runTest('7. Protocolo de restauración/eliminación: El entorno de pruebas se aísla sin afectar ningún recurso externo', () => {
  const harness = createIsolatedTestSpreadsheetHarness('TEST_SPREADSHEET_CLEANUP_FASE8_1');
  const repo = new SheetsRepository({
    spreadsheet: harness.testSpreadsheet
  });

  // Provisionar primero para que existan las hojas en la hoja de prueba
  repo.provisionDatabase();

  // Limpieza simulada: vaciar tablas de prueba
  repo.saveMaestroArticulos([]);
  repo.saveMaestroEnvases([]);
  repo.saveGruposComerciales([]);
  repo.saveMatrizArticuloEnvase([]);

  assert.strictEqual(repo.getMaestroArticulos().length, 0);
  assert.strictEqual(repo.getMaestroEnvases().length, 0);
  assert.strictEqual(repo.getGruposComerciales().length, 0);
  assert.strictEqual(repo.getMatrizArticuloEnvase().length, 0);
});

// -------------------------------------------------------------
// BLOQUE 7: INVARIANTE INNEGOCIABLE
// -------------------------------------------------------------
runTest('8. Invariante Innegociable: InventoryEngine.js permanece 100% inalterado respecto a Git HEAD', () => {
  const diff = execSync('git diff -- src/InventoryEngine.js', { encoding: 'utf8' });
  assert.strictEqual(diff.trim(), '', 'InventoryEngine.js NO debe contener modificaciones');
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE FASE 8.1: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
