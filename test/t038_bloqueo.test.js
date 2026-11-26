/**
 * STOCK-LIGHT — Test Suite T-038: Bloqueo en Apps Script real (waitLock devuelve undefined)
 *
 * Cubre los puntos de aceptación 1, 2 y 3 de docs/tickets/T-038-bloqueo-apps-script.md:
 * 1. Tres locks simulados (Apps Script undefined, waitLock que lanza, waitLock que devuelve false)
 *    en registrarAjustePositivo, importación CSV, stock inicial (con copia simulada) y reproceso.
 * 2. _escribirLogCopia_ con lock estilo Apps Script escribe en LOG_OPERACIONES; con lock que lanza
 *    o devuelve false, falla sin escribir.
 * 3. Tras cada operación correcta, releaseLock === bloqueos conseguidos (ningún bloqueo queda cogido).
 *
 * Ejecutable: node test/t038_bloqueo.test.js
 */

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const vm = require('vm');

const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');
const { StockInicialService } = require('../src/importacion/StockInicialService');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'csv');
const COMPRAS_CSV = fs.readFileSync(path.join(FIXTURE_DIR, 'compras_t007.csv'), 'utf8');
const STOCK_INICIAL_CSV = fs.readFileSync(path.join(FIXTURE_DIR, 'stock_inicial_ejemplo.csv'), 'utf8');

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
    if (err.stack) console.error(err.stack.split('\n').slice(1, 5).join('\n'));
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Constructores de locks simulados
// ---------------------------------------------------------------------------

function crearLockAppsScript() {
  return {
    adquisiciones: 0,
    liberaciones: 0,
    bloqueado: false,
    waitLock() {
      this.adquisiciones += 1;
      this.bloqueado = true;
      return undefined;
    },
    releaseLock() {
      this.liberaciones += 1;
      this.bloqueado = false;
    }
  };
}

function crearLockQueLanza(mensaje = 'Lock timeout: another process was holding the lock for too long.') {
  return {
    adquisiciones: 0,
    liberaciones: 0,
    bloqueado: false,
    waitLock() {
      throw new Error(mensaje);
    },
    releaseLock() {
      this.liberaciones += 1;
      this.bloqueado = false;
    }
  };
}

function crearLockFalse() {
  return {
    adquisiciones: 0,
    liberaciones: 0,
    bloqueado: false,
    waitLock() {
      return false;
    },
    releaseLock() {
      this.liberaciones += 1;
      this.bloqueado = false;
    }
  };
}

function crearLockSoloTryLock(exito) {
  return {
    adquisiciones: 0,
    liberaciones: 0,
    bloqueado: false,
    tryLock() {
      if (exito) {
        this.adquisiciones += 1;
        this.bloqueado = true;
      }
      return exito;
    },
    releaseLock() {
      this.liberaciones += 1;
      this.bloqueado = false;
    }
  };
}

function fotoTablas(repo) {
  return {
    movimientos: repo.getMovimientos().length,
    capas: repo.getCapasFifo().length,
    stock: repo.getStockActual().length
  };
}

function crearCatalogoPruebas() {
  return new CatalogoService({
    config: {
      atributos: [{ nombre: 'SEGUIMIENTO', descripcion: 'Seguimiento', activo: true }],
      reglas: [
        { id: 'R1', atributo: 'SEGUIMIENTO', valor: 'NO', prioridad: 1, articulo_contiene: 'PRODUCTO NO SEGUIDO', activo: true },
        { id: 'R2', atributo: 'SEGUIMIENTO', valor: 'NO', prioridad: 2, articulo_contiene: 'CALABACIN NO SEGUIDO', activo: true },
        { id: 'R3', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 3, articulo_contiene: 'TOMATE', activo: true },
        { id: 'R4', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 4, articulo_contiene: 'PEPINO', activo: true },
        { id: 'R5', atributo: 'SEGUIMIENTO', valor: 'NO', prioridad: 5, activo: true }
      ],
      catalogo: [],
      agrupaciones: []
    }
  });
}

function cargarEscribirLogCopia() {
  const ruta = path.resolve(__dirname, '..', 'src', 'BackupService.js');
  const codigo = fs.readFileSync(ruta, 'utf8');
  const localRequire = Module.createRequire(ruta);
  const sandbox = {
    console,
    Date,
    Error,
    Math,
    Object,
    String,
    Number,
    Array,
    JSON,
    require: localRequire,
    module: { exports: {} }
  };
  sandbox.global = sandbox;
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(codigo, sandbox, { filename: 'BackupService.js' });
  return sandbox._escribirLogCopia_;
}

function crearServicioStockInicialConCopia(env) {
  const copias = [];
  const servicio = new StockInicialService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: crearCatalogoPruebas(),
    crearCopiaSeguridad: (motivo, opciones) => {
      copias.push({ motivo, opciones });
      return { id: `COPIA-T038-${copias.length}`, nombre: `STOCK-LIGHT_COPIA_2026-11-26_2230_${motivo}` };
    },
    backupOptions: {},
    clock: () => new Date('2026-11-26T22:30:00Z')
  });
  return { servicio, copias };
}

function sembrarCapaParaReproceso(env) {
  const lockSiembra = crearLockAppsScript();
  const lockOriginal = env.movService.lock;
  env.movService.lock = lockSiembra;
  const res = env.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE FICTICIO I',
    codigo_envase: 'CAJA FICTICIA',
    cajas: 50,
    motivo: 'SIEMBRA_T038',
    fecha: '2026-11-20'
  }, 'test@t038');
  env.movService.lock = lockOriginal;
  assert.strictEqual(res.success, true, res.message || res.error || 'Error sembrando capa');
  const capas = env.repo.getCapasFifo();
  assert.ok(capas.length >= 1, 'Debe existir al menos una capa sembrada');
  return capas[0];
}

function verificarFalloBloqueoFn(fn, descripcion) {
  let errorLanzado = null;
  let resultado = null;
  try {
    resultado = fn();
  } catch (e) {
    errorLanzado = e;
  }

  if (errorLanzado) {
    const mensaje = String(errorLanzado.message || errorLanzado);
    assert.ok(
      mensaje.includes('No se pudo adquirir el bloqueo de concurrencia'),
      `${descripcion}: mensaje esperado de bloqueo, obtenido: "${mensaje}"`
    );
    return;
  }

  assert.ok(resultado && resultado.success === false, `${descripcion}: debe lanzar o devolver success=false`);
  const mensaje = String(resultado.message || resultado.error || '');
  assert.ok(
    mensaje.includes('No se pudo adquirir el bloqueo de concurrencia'),
    `${descripcion}: mensaje esperado de bloqueo, obtenido: "${mensaje}"`
  );
}

console.log('================================================================');
console.log(' TEST SUITE T-038 — BLOQUEO EN APPS SCRIPT REAL (waitLock)');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// 1. Simulador por defecto en mockSheets.js
// ---------------------------------------------------------------------------
runTest('0. mockSheets.js usa por defecto un lock estilo Apps Script (waitLock devuelve undefined y cuenta bloqueos)', () => {
  const env = crearEntorno();
  assert.strictEqual(env.lock.waitLock(1000), undefined, 'waitLock debe devolver undefined');
  assert.strictEqual(env.lock.adquisiciones, 1);
  assert.strictEqual(env.lock.bloqueado, true);
  env.lock.releaseLock();
  assert.strictEqual(env.lock.liberaciones, 1);
  assert.strictEqual(env.lock.bloqueado, false);
});

// ---------------------------------------------------------------------------
// 2. Lock estilo Apps Script (waitLock -> undefined): las 4 operaciones funcionan y liberan el lock
// ---------------------------------------------------------------------------
runTest('1a. Lock estilo Apps Script (undefined): registrarAjustePositivo funciona y libera el bloqueo', () => {
  const lock = crearLockAppsScript();
  const env = crearEntorno({ lockService: lock });

  const res = env.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE FICTICIO',
    codigo_envase: 'CAJA FICTICIA',
    cajas: 25,
    motivo: 'PRUEBA_T038',
    fecha: '2026-11-26'
  }, 'operador@t038');

  assert.strictEqual(res.success, true, res.message || '');
  assert.strictEqual(env.repo.getMovimientos().length, 1);
  assert.strictEqual(env.repo.getCapasFifo().length, 1);
  assert.strictEqual(env.repo.getStockActual().length, 1);
  assert.ok(lock.adquisiciones > 0, 'Debe adquirir al menos un bloqueo');
  assert.strictEqual(lock.liberaciones, lock.adquisiciones, 'Debe liberar exactamente los bloqueos adquiridos');
  assert.strictEqual(lock.bloqueado, false, 'No debe quedar bloqueado');
});

runTest('1b. Lock estilo Apps Script (undefined): importación de CSV funciona y libera el bloqueo', () => {
  const lock = crearLockAppsScript();
  const env = crearEntorno({ lockService: lock });
  const servicio = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: crearCatalogoPruebas()
  });

  const previa = servicio.previsualizar(COMPRAS_CSV);
  const res = servicio.confirmar(COMPRAS_CSV, previa.hash, 'operador@t038');

  assert.strictEqual(res.status, 'CONFIRMADA', res.message || res.error || '');
  assert.ok(env.repo.getMovimientos().length > 0, 'Debe registrar movimientos');
  assert.ok(env.repo.getCapasFifo().length > 0, 'Debe crear capas');
  assert.ok(env.repo.getStockActual().length > 0, 'Debe actualizar stock');
  assert.ok(lock.adquisiciones > 0, 'Debe adquirir al menos un bloqueo');
  assert.strictEqual(lock.liberaciones, lock.adquisiciones, 'Debe liberar exactamente los bloqueos adquiridos');
  assert.strictEqual(lock.bloqueado, false, 'No debe quedar bloqueado');
});

runTest('1c. Lock estilo Apps Script (undefined): stock inicial (con copia simulada) funciona y libera el bloqueo', () => {
  const lock = crearLockAppsScript();
  const env = crearEntorno({ lockService: lock });
  const { servicio, copias } = crearServicioStockInicialConCopia(env);

  const preview = servicio.previsualizar(STOCK_INICIAL_CSV);
  assert.strictEqual(preview.status, 'OK');

  const res = servicio.confirmar(STOCK_INICIAL_CSV, preview.hash, 'Operador T038', { anadir: false });
  assert.strictEqual(res.success, true, res.error || res.message || '');
  assert.strictEqual(copias.length, 1, 'Debe haber creado la copia simulada previa');
  assert.strictEqual(env.repo.getMovimientos().length, 3);
  assert.strictEqual(env.repo.getCapasFifo().length, 3);
  assert.ok(env.repo.getStockActual().length > 0);
  assert.ok(lock.adquisiciones > 0, 'Debe adquirir al menos un bloqueo');
  assert.strictEqual(lock.liberaciones, lock.adquisiciones, 'Debe liberar exactamente los bloqueos adquiridos');
  assert.strictEqual(lock.bloqueado, false, 'No debe quedar bloqueado');
});

runTest('1d. Lock estilo Apps Script (undefined): reproceso funciona y libera el bloqueo', () => {
  const lock = crearLockAppsScript();
  const env = crearEntorno({ lockService: lock });
  const capa = sembrarCapaParaReproceso(env);

  const res = env.movService.registrarReproceso({
    origenes: [{ id_capa: capa.id_capa, cajas: 20 }],
    destinos: [{ articulo: 'TOMATE FICTICIO II', envase: 'CAJA FICTICIA', cajas: 18 }],
    destrio_cajas: 2
  }, 'operador@t038');

  assert.strictEqual(res.success, true, res.message || '');
  assert.strictEqual(env.repo.getReprocesos().length, 1);
  assert.ok(lock.adquisiciones > 0, 'Debe adquirir al menos un bloqueo');
  assert.strictEqual(lock.liberaciones, lock.adquisiciones, 'Debe liberar exactamente los bloqueos adquiridos');
  assert.strictEqual(lock.bloqueado, false, 'No debe quedar bloqueado');
});

// ---------------------------------------------------------------------------
// 3. Lock que LANZA: cada operación falla con el mensaje de bloqueo y no escribe nada
// ---------------------------------------------------------------------------
runTest('2a. Lock que lanza: registrarAjustePositivo falla con mensaje de bloqueo y no escribe nada', () => {
  const env = crearEntorno({ lockService: crearLockQueLanza() });
  const antes = fotoTablas(env.repo);

  verificarFalloBloqueoFn(() => env.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE FICTICIO',
    codigo_envase: 'CAJA FICTICIA',
    cajas: 10,
    motivo: 'PRUEBA_T038',
    fecha: '2026-11-26'
  }, 'operador@t038'), 'registrarAjustePositivo (lanza)');
  assert.deepStrictEqual(fotoTablas(env.repo), antes, 'No debe escribir en ninguna tabla');
});

runTest('2b. Lock que lanza: importación CSV falla con mensaje de bloqueo y no escribe nada', () => {
  const env = crearEntorno({ lockService: crearLockQueLanza() });
  const servicio = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: crearCatalogoPruebas()
  });
  const previa = servicio.previsualizar(COMPRAS_CSV);
  const antes = fotoTablas(env.repo);

  verificarFalloBloqueoFn(
    () => servicio.confirmar(COMPRAS_CSV, previa.hash, 'operador@t038'),
    'ImportacionService.confirmar (lanza)'
  );
  assert.deepStrictEqual(fotoTablas(env.repo), antes, 'No debe escribir en ninguna tabla');
});

runTest('2c. Lock que lanza: stock inicial falla con mensaje de bloqueo y no escribe nada', () => {
  const env = crearEntorno({ lockService: crearLockQueLanza() });
  const { servicio } = crearServicioStockInicialConCopia(env);
  const preview = servicio.previsualizar(STOCK_INICIAL_CSV);
  const antes = fotoTablas(env.repo);

  verificarFalloBloqueoFn(
    () => servicio.confirmar(STOCK_INICIAL_CSV, preview.hash, 'Operador T038', { anadir: false }),
    'StockInicialService.confirmar (lanza)'
  );
  assert.deepStrictEqual(fotoTablas(env.repo), antes, 'No debe escribir en ninguna tabla');
});

runTest('2d. Lock que lanza: reproceso falla con mensaje de bloqueo y no escribe nada', () => {
  const env = crearEntorno({ lockService: crearLockQueLanza() });
  const capa = sembrarCapaParaReproceso(env);
  const antes = fotoTablas(env.repo);

  verificarFalloBloqueoFn(() => env.movService.registrarReproceso({
    origenes: [{ id_capa: capa.id_capa, cajas: 10 }],
    destinos: [{ articulo: 'TOMATE FICTICIO II', envase: 'CAJA FICTICIA', cajas: 10 }],
    destrio_cajas: 0
  }, 'operador@t038'), 'registrarReproceso (lanza)');
  assert.deepStrictEqual(fotoTablas(env.repo), antes, 'No debe escribir en ninguna tabla');
});

// ---------------------------------------------------------------------------
// 4. Lock que devuelve FALSE: mismo comportamiento que el que lanza
// ---------------------------------------------------------------------------
runTest('3a. Lock que devuelve false: registrarAjustePositivo falla con mensaje de bloqueo y no escribe nada', () => {
  const env = crearEntorno({ lockService: crearLockFalse() });
  const antes = fotoTablas(env.repo);

  verificarFalloBloqueoFn(() => env.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE FICTICIO',
    codigo_envase: 'CAJA FICTICIA',
    cajas: 10,
    motivo: 'PRUEBA_T038',
    fecha: '2026-11-26'
  }, 'operador@t038'), 'registrarAjustePositivo (false)');
  assert.deepStrictEqual(fotoTablas(env.repo), antes, 'No debe escribir en ninguna tabla');
});

runTest('3b. Lock que devuelve false: importación CSV falla con mensaje de bloqueo y no escribe nada', () => {
  const env = crearEntorno({ lockService: crearLockFalse() });
  const servicio = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: crearCatalogoPruebas()
  });
  const previa = servicio.previsualizar(COMPRAS_CSV);
  const antes = fotoTablas(env.repo);

  verificarFalloBloqueoFn(
    () => servicio.confirmar(COMPRAS_CSV, previa.hash, 'operador@t038'),
    'ImportacionService.confirmar (false)'
  );
  assert.deepStrictEqual(fotoTablas(env.repo), antes, 'No debe escribir en ninguna tabla');
});

runTest('3c. Lock que devuelve false: stock inicial falla con mensaje de bloqueo y no escribe nada', () => {
  const env = crearEntorno({ lockService: crearLockFalse() });
  const { servicio } = crearServicioStockInicialConCopia(env);
  const preview = servicio.previsualizar(STOCK_INICIAL_CSV);
  const antes = fotoTablas(env.repo);

  verificarFalloBloqueoFn(
    () => servicio.confirmar(STOCK_INICIAL_CSV, preview.hash, 'Operador T038', { anadir: false }),
    'StockInicialService.confirmar (false)'
  );
  assert.deepStrictEqual(fotoTablas(env.repo), antes, 'No debe escribir en ninguna tabla');
});

runTest('3d. Lock que devuelve false: reproceso falla con mensaje de bloqueo y no escribe nada', () => {
  const env = crearEntorno({ lockService: crearLockFalse() });
  const capa = sembrarCapaParaReproceso(env);
  const antes = fotoTablas(env.repo);

  verificarFalloBloqueoFn(() => env.movService.registrarReproceso({
    origenes: [{ id_capa: capa.id_capa, cajas: 10 }],
    destinos: [{ articulo: 'TOMATE FICTICIO II', envase: 'CAJA FICTICIA', cajas: 10 }],
    destrio_cajas: 0
  }, 'operador@t038'), 'registrarReproceso (false)');
  assert.deepStrictEqual(fotoTablas(env.repo), antes, 'No debe escribir en ninguna tabla');
});

// ---------------------------------------------------------------------------
// 5. Fallback tryLock (sin waitLock) en MovementService
// ---------------------------------------------------------------------------
runTest('4. MovementService._acquireLock con lock solo tryLock: true funciona y libera; false falla sin escribir', () => {
  const lockOk = crearLockSoloTryLock(true);
  const envOk = crearEntorno({ lockService: lockOk });
  const resOk = envOk.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE FICTICIO',
    codigo_envase: 'CAJA FICTICIA',
    cajas: 5,
    motivo: 'TRYLOCK_OK',
    fecha: '2026-11-26'
  }, 'operador@t038');
  assert.strictEqual(resOk.success, true, resOk.message || '');
  assert.strictEqual(lockOk.adquisiciones, 1);
  assert.strictEqual(lockOk.liberaciones, 1);
  assert.strictEqual(lockOk.bloqueado, false);

  const envFail = crearEntorno({ lockService: crearLockSoloTryLock(false) });
  const antes = fotoTablas(envFail.repo);
  verificarFalloBloqueoFn(() => envFail.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE FICTICIO',
    codigo_envase: 'CAJA FICTICIA',
    cajas: 5,
    motivo: 'TRYLOCK_FAIL',
    fecha: '2026-11-26'
  }, 'operador@t038'), 'registrarAjustePositivo (tryLock false)');
  assert.deepStrictEqual(fotoTablas(envFail.repo), antes);
});

// ---------------------------------------------------------------------------
// 6. BackupService._escribirLogCopia_ (Aceptación 2 y 3)
// ---------------------------------------------------------------------------
runTest('5a. _escribirLogCopia_ con lock estilo Apps Script (undefined) escribe en LOG_OPERACIONES y libera', () => {
  const _escribirLogCopia_ = cargarEscribirLogCopia();
  const env = crearEntorno();
  const lock = crearLockAppsScript();

  const ok = _escribirLogCopia_({
    id_log: 'LOG-T038-1',
    fecha_hora: '2026-11-26T22:30:00.000Z',
    usuario: 'dueno@stocklight.test',
    operacion: 'COPIA_SEGURIDAD',
    motivo: 'PRE_STOCK_INICIAL',
    referencia: 'COPIA-1',
    estado: 'CORRECTA',
    observaciones: 'Copia ficticia T-038'
  }, {
    repository: env.repo,
    lockService: lock
  });

  assert.strictEqual(ok, true);
  const logs = env.repo.getLogOperaciones();
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].id_log, 'LOG-T038-1');
  assert.strictEqual(lock.adquisiciones, 1);
  assert.strictEqual(lock.liberaciones, 1);
  assert.strictEqual(lock.bloqueado, false);
});

runTest('5b. _escribirLogCopia_ con lock que lanza falla sin escribir en LOG_OPERACIONES', () => {
  const _escribirLogCopia_ = cargarEscribirLogCopia();
  const env = crearEntorno();
  const lock = crearLockQueLanza();

  assert.throws(
    () => _escribirLogCopia_({
      id_log: 'LOG-T038-2',
      fecha_hora: '2026-11-26T22:30:00.000Z',
      usuario: 'dueno@stocklight.test',
      operacion: 'COPIA_SEGURIDAD',
      motivo: 'MANUAL',
      referencia: 'COPIA-2',
      estado: 'CORRECTA',
      observaciones: 'No debe escribirse'
    }, {
      repository: env.repo,
      lockService: lock
    }),
    /No se pudo adquirir el bloqueo para registrar la copia de seguridad/
  );

  assert.strictEqual(env.repo.getLogOperaciones().length, 0, 'No debe escribir en LOG_OPERACIONES');
  assert.strictEqual(lock.liberaciones, 0, 'No debe liberar un bloqueo no adquirido');
});

runTest('5c. _escribirLogCopia_ con lock que devuelve false falla sin escribir en LOG_OPERACIONES', () => {
  const _escribirLogCopia_ = cargarEscribirLogCopia();
  const env = crearEntorno();
  const lock = crearLockFalse();

  assert.throws(
    () => _escribirLogCopia_({
      id_log: 'LOG-T038-3',
      fecha_hora: '2026-11-26T22:30:00.000Z',
      usuario: 'dueno@stocklight.test',
      operacion: 'COPIA_SEGURIDAD',
      motivo: 'MANUAL',
      referencia: 'COPIA-3',
      estado: 'CORRECTA',
      observaciones: 'No debe escribirse'
    }, {
      repository: env.repo,
      lockService: lock
    }),
    /No se pudo adquirir el bloqueo para registrar la copia de seguridad/
  );

  assert.strictEqual(env.repo.getLogOperaciones().length, 0, 'No debe escribir en LOG_OPERACIONES');
  assert.strictEqual(lock.liberaciones, 0, 'No debe liberar un bloqueo no adquirido');
});

console.log('\n================================================================');
console.log(` RESULTADOS T-038: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
process.exit(0);
