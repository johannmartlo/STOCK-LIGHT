/**
 * STOCK-LIGHT — Test Suite Fase 8.2
 * 
 * VALIDACIÓN DE COMPATIBILIDAD CON GOOGLE APPS SCRIPT V8,
 * VISIBILIDAD DE FUNCIONES GLOBALES Y PROTECCIÓN FAIL-CLOSED.
 * 
 * Verifica:
 * 1. Carga limpia de los 24 archivos en un entorno de simulación pura de Apps Script V8
 *    (sin require, sin module, sin exports).
 * 2. Disponibilidad de apiEjecutarPruebaAisladaInicializacion como función global de nivel superior.
 * 3. Protección fail-closed: Aborta si no se puede verificar el ID de producción.
 * 4. Protección fail-closed: Aborta si el ID de destino coincide con el ID de producción.
 * 5. Protección fail-closed: Aborta si el ID de destino no es la hoja autorizada (15PzFg7TfZ2LwBGxtKiUkiedz3owWG27-m6ZTS30JELM).
 * 6. Resolución diferida de dependencias en ArticuloEnvaseValidator y MaestroEnvasesValidator en runtime V8.
 * 7. Invariante Innegociable: InventoryEngine.js permanece 100% inalterado.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

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

console.log('================================================================');
console.log(' TEST SUITE FASE 8.2 — CARGA APPS SCRIPT V8 Y SEGURIDAD OPERATIVA');
console.log('================================================================\n');

// Hoja autorizada para pruebas
const HOJA_PRUEBAS_AUTORIZADA = '15PzFg7TfZ2LwBGxtKiUkiedz3owWG27-m6ZTS30JELM';

function createV8GasContext(scriptProps = {}) {
  const propsStore = { ...scriptProps };
  const sandbox = {
    Logger: { log: () => {} },
    console: console,
    SpreadsheetApp: {},
    DriveApp: {},
    Utilities: {
      computeDigest: (algo, bytes) => [1, 2, 3, 4]
    },
    Session: { getActiveUser: () => ({ getEmail: () => 'test_user@stocklight.test' }) },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => ({ setTitle: () => {}, setXFrameOptionsMode: () => {} }) }),
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (propsStore[key] !== undefined ? propsStore[key] : null),
        setProperty: (key, val) => { propsStore[key] = String(val); }
      })
    }
  };
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  sandbox.this = sandbox;

  const context = vm.createContext(sandbox);

  const srcDir = path.join(__dirname, '..', 'src');
  function getJsFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) results = results.concat(getJsFiles(fullPath));
      else if (file.endsWith('.js')) results.push(fullPath);
    });
    return results;
  }

  const files = getJsFiles(srcDir);
  // Orden alfabético idéntico a Apps Script
  files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

  files.forEach(f => {
    const code = fs.readFileSync(f, 'utf8');
    vm.runInContext(code, context, { filename: f });
  });

  return { sandbox, context };
}

// --------------------------------------------------------------------------
// TEST 1: Carga pura en Apps Script V8 sin require
// --------------------------------------------------------------------------
runTest('1. Carga limpia de todos los archivos en runtime Apps Script V8 sin ReferenceError', () => {
  const { sandbox } = createV8GasContext();
  assert.ok(sandbox, 'El contexto V8 debe crearse exitosamente');
  assert.strictEqual(typeof sandbox.apiEjecutarPruebaAisladaInicializacion, 'function', 'apiEjecutarPruebaAisladaInicializacion debe ser función global');
  assert.strictEqual(typeof sandbox.initDatabase, 'function', 'initDatabase debe ser función global');
  assert.strictEqual(typeof sandbox.ejecutarReconstruccionStock, 'function', 'ejecutarReconstruccionStock debe ser función global');
  assert.strictEqual(typeof sandbox.apiObtenerStockActual, 'function', 'apiObtenerStockActual debe ser función global');
});

// --------------------------------------------------------------------------
// TEST 2: Resolución diferida de dependencias en runtime
// --------------------------------------------------------------------------
runTest('2. ArticuloEnvaseValidator y MaestroEnvasesValidator ejecutan validate() en V8 sin dependencias en null', () => {
  const { sandbox, context } = createV8GasContext();
  
  // Validar ArticuloEnvaseValidator
  const resAE = vm.runInContext(`
    const v = new ArticuloEnvaseValidator();
    v.validate('codigo_articulo,codigo_envase\\n2112000,EPS104\\n');
  `, context);
  assert.ok(resAE, 'validate() en ArticuloEnvaseValidator debe retornar informe');
  assert.strictEqual(typeof resAE.totalFilas, 'number');

  // Validar MaestroEnvasesValidator
  const resME = vm.runInContext(`
    const v2 = new MaestroEnvasesValidator();
    v2.validate('codigo_envase,descripcion_envase,tara_kg\\nEPS104,CAJA EPS 104,0.450\\n');
  `, context);
  assert.ok(resME, 'validate() en MaestroEnvasesValidator debe retornar informe');
  assert.strictEqual(typeof resME.totalFilas, 'number');
});

// --------------------------------------------------------------------------
// TEST 3: Fail-closed: Aborta si no puede verificar ID de producción
// --------------------------------------------------------------------------
runTest('3. Fail-closed: apiEjecutarPruebaAisladaInicializacion aborta si no se puede verificar ID de producción', () => {
  const { sandbox, context } = createV8GasContext({});

  assert.throws(() => {
    // Sin SPREADSHEET_ID configurado en PropertiesService
    vm.runInContext(`apiEjecutarPruebaAisladaInicializacion('${HOJA_PRUEBAS_AUTORIZADA}', {});`, context);
  }, /No se pudo verificar el ID de la hoja de producción/);
});

// --------------------------------------------------------------------------
// TEST 4: Fail-closed: Aborta si ID destino coincide con producción
// --------------------------------------------------------------------------
runTest('4. Fail-closed: apiEjecutarPruebaAisladaInicializacion aborta si ID destino coincide con producción', () => {
  // Simular que en producción se configuró accidentalmente la misma hoja de pruebas
  const { sandbox, context } = createV8GasContext({ SPREADSHEET_ID: HOJA_PRUEBAS_AUTORIZADA });

  assert.throws(() => {
    vm.runInContext(`
      apiEjecutarPruebaAisladaInicializacion('${HOJA_PRUEBAS_AUTORIZADA}', {});
    `, context);
  }, /coincide con la hoja de producción configurada/);
});

// --------------------------------------------------------------------------
// TEST 5: Fail-closed: Aborta si ID destino no es la hoja autorizada
// --------------------------------------------------------------------------
runTest('5. Fail-closed: apiEjecutarPruebaAisladaInicializacion aborta si ID destino no es la hoja autorizada', () => {
  const { sandbox, context } = createV8GasContext({ SPREADSHEET_ID: 'PROD_ID_VERIFICADO_111111111111111' });

  const unauthorizedId = 'OTRA_HOJA_NO_AUTORIZADA_888888888888';

  assert.throws(() => {
    vm.runInContext(`
      apiEjecutarPruebaAisladaInicializacion('${unauthorizedId}', {});
    `, context);
  }, /no coincide con la única hoja de pruebas autorizada/);
});

// --------------------------------------------------------------------------
// TEST 6: Ejecución exitosa con hoja autorizada y producción verificada distinta
// --------------------------------------------------------------------------
runTest('6. apiEjecutarPruebaAisladaInicializacion ejecuta doble pasada en hoja autorizada con arnés simulado', () => {
  const { sandbox, context } = createV8GasContext({ SPREADSHEET_ID: 'PRODUCCION_VERIFICADA_DISTINTA_000000000' });

  // Arnés mínimo en memoria para simular el Spreadsheet de prueba
  const res = vm.runInContext(`
    const sheets = {};
    const mockSS = {
      getId: () => '${HOJA_PRUEBAS_AUTORIZADA}',
      getName: () => 'STOCK-LIGHT — Hoja de Pruebas Aislada',
      getSheetByName: (name) => sheets[name] || null,
      insertSheet: (name) => {
        let rowData = [];
        const s = {
          getName: () => name,
          getLastColumn: () => (rowData.length > 0 ? rowData[0].length : 0),
          getLastRow: () => rowData.length,
          getRange: (r, c, nr = 1, nc = 1) => ({
            getValues: () => {
              const res = [];
              for (let i = 0; i < nr; i++) {
                const rowVals = [];
                for (let j = 0; j < nc; j++) {
                  rowVals.push((rowData[r - 1 + i] && rowData[r - 1 + i][c - 1 + j] !== undefined) ? rowData[r - 1 + i][c - 1 + j] : '');
                }
                res.push(rowVals);
              }
              return res;
            },
            setValues: (vals) => {
              for (let i = 0; i < vals.length; i++) {
                if (!rowData[r - 1 + i]) rowData[r - 1 + i] = [];
                for (let j = 0; j < vals[i].length; j++) {
                  rowData[r - 1 + i][c - 1 + j] = vals[i][j];
                }
              }
            },
            clearContent: () => {},
            setBackground: () => ({ setFontColor: () => ({ setFontWeight: () => {} }) })
          }),
          setFrozenRows: () => {},
          clear: () => { rowData = []; }
        };
        sheets[name] = s;
        return s;
      },
      getSheets: () => Object.values(sheets)
    };

    apiEjecutarPruebaAisladaInicializacion('${HOJA_PRUEBAS_AUTORIZADA}', {
      spreadsheet: mockSS
    });
  `, context);

  assert.ok(res, 'Debe devolver resultado');
  assert.strictEqual(res.success, true, 'La prueba aislada doble pasada debe tener éxito');
  assert.strictEqual(res.idempotencia.conforme, true, 'La idempotencia debe ser conforme');
  assert.strictEqual(res.verificacionStockCero.conforme, true, 'El stock debe ser 0 absoluto');
});

// --------------------------------------------------------------------------
// TEST 7: Invariante Innegociable: InventoryEngine.js intacto
// --------------------------------------------------------------------------
runTest('7. Invariante Innegociable: InventoryEngine.js permanece 100% inalterado', () => {
  const diff = execSync('git diff -- src/InventoryEngine.js', { encoding: 'utf8' });
  assert.strictEqual(diff.trim(), '', 'InventoryEngine.js NO debe contener modificaciones');
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE FASE 8.2: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
