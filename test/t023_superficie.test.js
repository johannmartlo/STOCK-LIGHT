/**
 * STOCK-LIGHT — Test Suite T-023: Superficie del servidor
 *
 * Verifica:
 * 1. El guardia de administración con Session simulado (propietario, visitante, otro usuario).
 * 2. Que cada función ADMIN se rechaza antes de escribir y se ejecuta con el propietario.
 * 3. Que las funciones de escritura ignoran el usuario que envía el navegador.
 * 4. Que toda función global no privada está clasificada en docs/API_PUBLICA.md.
 *
 * Ejecutable: node test/t023_superficie.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const codigo = require('../src/Código');
const Config = require('../src/Config');
const { exigirPropietario_, usuarioActual_, conContextoDePrueba_ } = require('../src/Seguridad');
const { crearEntorno } = require('./helpers/mockSheets');

const MENSAJE_ADMIN = 'Operación reservada al administrador';

const SESIONES = {
  propietario: {
    getActiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' }),
    getEffectiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' })
  },
  visitante: {
    getActiveUser: () => ({ getEmail: () => '' }),
    getEffectiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' })
  },
  otroUsuario: {
    getActiveUser: () => ({ getEmail: () => 'ana@empresa.es' }),
    getEffectiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' })
  }
};

let passed = 0;
let failed = 0;

function runTest(nombre, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${nombre}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${nombre}`);
    console.error(`     Error: ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    failed++;
  }
}

/** Ejecuta fn con una Session global simulada y restaura la anterior. */
function conSesion(sesion, fn) {
  const anterior = global.Session;
  global.Session = sesion;
  try {
    return fn();
  } finally {
    global.Session = anterior;
  }
}

/** Sustituye SheetsRepository para que las funciones sin opciones usen el repo de prueba. */
function conRepositorioFalso(repo, fn) {
  const anterior = global.SheetsRepository;
  global.SheetsRepository = function RepositorioFalso() {
    return repo;
  };
  try {
    return fn();
  } finally {
    global.SheetsRepository = anterior;
  }
}

/**
 * Crea un entorno de prueba y los dobles de entorno que necesitan las funciones ADMIN
 * que no aceptan opciones (PropertiesService, Logger y SheetsRepository).
 */
function crearContexto() {
  const entorno = crearEntorno();
  const store = { SPREADSHEET_ID: 'PRODUCCION_DISTINTA_DE_PRUEBAS_1234567890' };
  const propService = {
    getProperty: (clave) => (Object.prototype.hasOwnProperty.call(store, clave) ? store[clave] : null),
    setProperty: (clave, valor) => { store[clave] = String(valor); }
  };

  const anteriorRepo = global.SheetsRepository;
  const anteriorProps = global.PropertiesService;
  const anteriorLogger = global.Logger;

  global.SheetsRepository = function RepositorioFalso() { return entorno.repo; };
  global.PropertiesService = { getScriptProperties: () => propService };
  global.Logger = { log: () => {} };

  return {
    entorno,
    store,
    restaurar() {
      global.SheetsRepository = anteriorRepo;
      global.PropertiesService = anteriorProps;
      global.Logger = anteriorLogger;
    }
  };
}

/** Hace fallar cualquier escritura en las hojas y cuenta los intentos. */
function blindarEscrituras(spreadsheet) {
  let intentos = 0;
  const fallar = (metodo) => {
    intentos++;
    throw new Error(`Escritura bloqueada por la prueba: ${metodo}`);
  };

  for (const hoja of spreadsheet.sheets.values()) {
    const getRangeOriginal = hoja.getRange.bind(hoja);
    hoja.getRange = (...args) => {
      const rango = getRangeOriginal(...args);
      rango.setValues = () => fallar('setValues');
      rango.clearContent = () => fallar('clearContent');
      return rango;
    };
    hoja.clear = () => fallar('clear');
  }

  return { intentos: () => intentos };
}

/** Casos de las funciones ADMIN, con una invocación que funciona con el propietario. */
function casosAdmin() {
  return [
    {
      nombre: 'initDatabase',
      ejecutar: (c) => c.initDatabase(),
      verificar: (res) => assert.ok(res && typeof res === 'object', 'initDatabase debe devolver un objeto')
    },
    {
      nombre: 'ejecutarReconstruccionStock',
      ejecutar: (c) => c.ejecutarReconstruccionStock(),
      verificar: (res) => assert.strictEqual(res.success, true)
    },
    {
      nombre: 'registrarAjusteManual',
      ejecutar: (c) => c.registrarAjusteManual({
        codigo_articulo: 'ARTICULO T023',
        codigo_envase: 'ENVASE T023',
        cajas: 3,
        signo: 1,
        motivo: 'T023'
      }),
      verificar: (res) => assert.strictEqual(res.success, true)
    },
    {
      nombre: 'testNucleoAppsScript',
      ejecutar: (c) => c.testNucleoAppsScript(),
      verificar: (res) => assert.strictEqual(res.ok, true)
    },
    {
      nombre: 'configurarSpreadsheetId',
      ejecutar: (c) => c.configurarSpreadsheetId('HOJA_DE_TRABAJO_1234567890'),
      verificar: (res, ctx) => {
        assert.ok(String(res).includes('HOJA_DE_TRABAJO_1234567890'));
        assert.strictEqual(ctx.store.SPREADSHEET_ID, 'HOJA_DE_TRABAJO_1234567890');
      }
    },
    {
      nombre: 'configurarDriveFolderId',
      ejecutar: (c) => c.configurarDriveFolderId('CARPETA_DE_DRIVE_1234567890'),
      verificar: (res, ctx) => {
        assert.ok(String(res).includes('CARPETA_DE_DRIVE_1234567890'));
        assert.strictEqual(ctx.store.DRIVE_FOLDER_ID, 'CARPETA_DE_DRIVE_1234567890');
      }
    },
    {
      nombre: 'setSpreadsheetIdConfig',
      ejecutar: () => Config.setSpreadsheetIdConfig('HOJA_CONFIG_DIRECTA_1234567890'),
      verificar: (res, ctx) => {
        assert.strictEqual(res, true);
        assert.strictEqual(ctx.store.SPREADSHEET_ID, 'HOJA_CONFIG_DIRECTA_1234567890');
      }
    },
    {
      nombre: 'setDriveFolderIdConfig',
      ejecutar: () => Config.setDriveFolderIdConfig('CARPETA_CONFIG_DIRECTA_1234567890'),
      verificar: (res, ctx) => {
        assert.strictEqual(res, true);
        assert.strictEqual(ctx.store.DRIVE_FOLDER_ID, 'CARPETA_CONFIG_DIRECTA_1234567890');
      }
    },
    {
      nombre: 'apiIngestarMatrizArticuloEnvase',
      ejecutar: (c, ctx) => c.apiIngestarMatrizArticuloEnvase('', { repository: ctx.entorno.repo }),
      verificar: (res) => assert.ok(res && typeof res === 'object')
    },
    {
      nombre: 'apiCambiarEnvasePredeterminado',
      ejecutar: (c, ctx) => c.apiCambiarEnvasePredeterminado('ARTICULO T023', 'ENVASE T023', { repository: ctx.entorno.repo }),
      verificar: (res) => assert.strictEqual(res.success, true)
    },
    {
      nombre: 'apiCargarCatalogoHistorico',
      ejecutar: (c, ctx) => c.apiCargarCatalogoHistorico([], { repository: ctx.entorno.repo }),
      verificar: (res) => assert.ok(res && typeof res.totalProcesados === 'number')
    },
    {
      nombre: 'apiConciliarStock',
      ejecutar: (c, ctx) => c.apiConciliarStock([], {
        repository: ctx.entorno.repo,
        movementService: ctx.entorno.movService,
        commercialResolver: ctx.entorno.resolver,
        stockQueryService: ctx.entorno.queryService
      }),
      verificar: (res) => assert.ok(res && typeof res.totalLineas === 'number')
    },
    {
      nombre: 'apiEjecutarPruebaAisladaInicializacion',
      ejecutar: (c) => c.apiEjecutarPruebaAisladaInicializacion(undefined, {}),
      verificar: (res) => assert.ok(res && typeof res === 'object')
    }
  ];
}

function assertErrorAdmin(fn, etiqueta) {
  assert.throws(
    fn,
    (err) => err instanceof Error && err.message === MENSAJE_ADMIN,
    `${etiqueta} debe lanzar exactamente "${MENSAJE_ADMIN}"`
  );
}

// --------------------------------------------------------------------------
// BLOQUE 1: Guardia y usuario del servidor
// --------------------------------------------------------------------------
console.log('\n================================================================');
console.log(' TEST SUITE T-023 — SUPERFICIE DEL SERVIDOR');
console.log('================================================================\n');

runTest('1. exigirPropietario_ acepta al propietario y rechaza visitante y otro usuario', () => {
  assert.doesNotThrow(() => exigirPropietario_(SESIONES.propietario));
  assertErrorAdmin(() => exigirPropietario_(SESIONES.visitante), 'visitante');
  assertErrorAdmin(() => exigirPropietario_(SESIONES.otroUsuario), 'otro usuario');
  assertErrorAdmin(() => exigirPropietario_({}), 'Session vacía');
});

runTest('2. usuarioActual_ lee el email activo y cae en SIN_IDENTIFICAR', () => {
  assert.strictEqual(usuarioActual_(SESIONES.propietario), 'dueno@stocklight.test');
  assert.strictEqual(usuarioActual_(SESIONES.otroUsuario), 'ana@empresa.es');
  assert.strictEqual(usuarioActual_(SESIONES.visitante), 'SIN_IDENTIFICAR');
  assert.strictEqual(usuarioActual_({}), 'SIN_IDENTIFICAR');
});

// --------------------------------------------------------------------------
// BLOQUE 2: Funciones ADMIN protegidas y sin escrituras
// --------------------------------------------------------------------------
runTest('3. Visitante y otro usuario: cada ADMIN lanza el mensaje y no escribe nada', () => {
  for (const sesion of [SESIONES.visitante, SESIONES.otroUsuario]) {
    for (const caso of casosAdmin()) {
      const ctx = crearContexto();
      const probe = blindarEscrituras(ctx.entorno.ss);
      try {
        conSesion(sesion, () => {
          assertErrorAdmin(() => conRepositorioFalso(ctx.entorno.repo, () => caso.ejecutar(codigo, ctx)), caso.nombre);
        });
      } finally {
        ctx.restaurar();
      }
      assert.strictEqual(probe.intentos(), 0, `${caso.nombre} intentó escribir sin ser propietario`);
    }
  }
});

runTest('4. Con el propietario, cada ADMIN se ejecuta', () => {
  for (const caso of casosAdmin()) {
    const ctx = crearContexto();
    try {
      const res = conSesion(SESIONES.propietario, () => conRepositorioFalso(ctx.entorno.repo, () => caso.ejecutar(codigo, ctx)));
      caso.verificar(res, ctx);
    } finally {
      ctx.restaurar();
    }
  }
});

// --------------------------------------------------------------------------
// BLOQUE 3: El usuario de auditoría lo decide el servidor
// --------------------------------------------------------------------------
runTest('5. apiRegistrarAjusteNegativo ignora "HACKER" y firma con el email del servidor', () => {
  const ctx = crearContexto();
  try {
    ctx.entorno.movService.registrarAjustePositivo({
      codigo_articulo: 'ARTICULO USUARIO',
      codigo_envase: 'ENVASE USUARIO',
      cajas: 10,
      motivo: 'SEMILLA'
    }, 'SEMILLA');

    const res = conSesion(SESIONES.otroUsuario, () => conRepositorioFalso(ctx.entorno.repo, () => (
      conContextoDePrueba_(null, 'ENCARGADO', () => codigo.apiRegistrarAjusteNegativo({
        codigo_articulo: 'ARTICULO USUARIO',
        codigo_envase: 'ENVASE USUARIO',
        cajas: 2,
        motivo: 'T023'
      }, 'HACKER'))
    )));
    assert.strictEqual(res.success, true);

    const movs = ctx.entorno.repo.getMovimientos();
    assert.strictEqual(movs[movs.length - 1].usuario, 'ana@empresa.es');
  } finally {
    ctx.restaurar();
  }
});

runTest('6. Sin email, apiRegistrarAjusteNegativo firma con SIN_IDENTIFICAR', () => {
  const ctx = crearContexto();
  try {
    ctx.entorno.movService.registrarAjustePositivo({
      codigo_articulo: 'ARTICULO USUARIO',
      codigo_envase: 'ENVASE USUARIO',
      cajas: 10,
      motivo: 'SEMILLA'
    }, 'SEMILLA');

    const res = conSesion(SESIONES.visitante, () => conRepositorioFalso(ctx.entorno.repo, () => (
      conContextoDePrueba_(null, 'ENCARGADO', () => codigo.apiRegistrarAjusteNegativo({
        codigo_articulo: 'ARTICULO USUARIO',
        codigo_envase: 'ENVASE USUARIO',
        cajas: 2,
        motivo: 'T023'
      }, 'HACKER'))
    )));
    assert.strictEqual(res.success, true);

    const movs = ctx.entorno.repo.getMovimientos();
    assert.strictEqual(movs[movs.length - 1].usuario, 'SIN_IDENTIFICAR');
  } finally {
    ctx.restaurar();
  }
});

// --------------------------------------------------------------------------
// BLOQUE 4: Cobertura de la superficie global
// --------------------------------------------------------------------------
function listarArchivosJs(dir) {
  let resultado = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) resultado = resultado.concat(listarArchivosJs(completo));
    else if (entrada.isFile() && entrada.name.endsWith('.js')) resultado.push(completo);
  }
  return resultado;
}

function extraerFuncionesGlobales(codigoFuente) {
  const nombres = [];
  for (const linea of codigoFuente.split(/\r?\n/)) {
    const match = linea.match(/^function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (match && !match[1].endsWith('_')) nombres.push(match[1]);
  }
  return nombres;
}

function leerClasificadas(documento) {
  const clasificadas = new Set();
  for (const linea of documento.split(/\r?\n/)) {
    const match = linea.match(/^\|\s*`([A-Za-z0-9_$]+)`\s*\|/);
    if (match) clasificadas.add(match[1]);
  }
  return clasificadas;
}

function funcionesSinClasificar(fuentes, clasificadas) {
  const sinClasificar = [];
  for (const fuente of fuentes) {
    for (const nombre of extraerFuncionesGlobales(fuente.contenido)) {
      if (!clasificadas.has(nombre) && !sinClasificar.includes(nombre)) sinClasificar.push(nombre);
    }
  }
  return sinClasificar;
}

runTest('7. Toda función global no privada está clasificada en docs/API_PUBLICA.md', () => {
  const srcDir = path.join(__dirname, '..', 'src');
  const fuentes = listarArchivosJs(srcDir).map((archivo) => ({
    archivo: path.relative(srcDir, archivo),
    contenido: fs.readFileSync(archivo, 'utf8')
  }));
  const documento = fs.readFileSync(path.join(__dirname, '..', 'docs', 'API_PUBLICA.md'), 'utf8');
  const clasificadas = leerClasificadas(documento);

  const totalGlobales = fuentes.reduce((total, fuente) => total + extraerFuncionesGlobales(fuente.contenido).length, 0);
  assert.ok(totalGlobales > 80, `Se esperaban más de 80 funciones globales, hay ${totalGlobales}`);
  assert.deepStrictEqual(funcionesSinClasificar(fuentes, clasificadas), []);
});

runTest('8. La comprobación de cobertura falla si aparece una función global sin clasificar', () => {
  const sintetico = [
    { archivo: 'sintetico.js', contenido: 'function nuevaExpuesta() {}\nfunction privada_() {}\nfunction otraExpuesta() {}' }
  ];
  const clasificadas = new Set(['nuevaExpuesta']);
  assert.deepStrictEqual(funcionesSinClasificar(sintetico, clasificadas), ['otraExpuesta']);
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-023: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
