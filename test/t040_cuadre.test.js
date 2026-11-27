/**
 * STOCK-LIGHT — Test Suite T-040: Asistente de cuadre de la noche
 *
 * Cubre los puntos de aceptación de docs/tickets/T-040-cuadre-noche.md:
 * 1. Familia con 3 artículos, hay = [igual, −7, vacío] → 1 ajuste RECUENTO de −7 por FIFO
 *    y 1 fila de CUADRES con 3 contadas, 1 con diferencia y −7 cajas.
 * 2. Diferencia positiva +5 → ajuste +5 y libro consistente.
 * 3. Cambia el stock entre obtenerCuadre y confirmarFamilia → STOCK_CAMBIADO sin ajustes.
 * 4. Confirmar dos veces el mismo id_cuadre + familia → los mismos ajustes, ninguno nuevo.
 * 5. `hay` negativo o no numérico → error y nada aplicado.
 * 6. Anular con apiAnularAjuste un ajuste del cuadre devuelve el stock anterior.
 * 7. Sin sesión → «Acceso no autorizado»; con rol CONSULTA → rechazado.
 * 8. Invariantes con 25 semillas: consistencia, consumos FIFO y stock final = hay.
 *
 * Datos 100 % ficticios (D-015). Ejecutable: node test/t040_cuadre.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const codigo = require('../src/Código');
const { crearEntorno } = require('./helpers/mockSheets');
const { SCHEMA_DEFINITIONS } = require('../src/Repository');
const {
  ServicioAcceso,
  PERMISOS_API,
  rolAlcanza_,
  conContextoDePrueba_
} = require('../src/Seguridad');

const SRC_DIR = path.resolve(__dirname, '../src');
const FIJO = '2026-11-27T21:00:00.000Z';
const ENVASE = 'CAJA FICTICIA 10X500';
const ART_A = 'TOMATE FICTICIO SOLAR I G';
const ART_B = 'TOMATE FICTICIO SOLAR I GG';
const ART_C = 'TOMATE FICTICIO SOLAR I MMM';
const ART_LUNAR = 'TOMATE FICTICIO LUNAR I G';
const URL_IMPLEMENTACION = 'https://script.google.com/macros/s/PRUEBA_T040/exec';

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
    if (err.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'));
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Datos ficticios: dos familias COMERCIAL con reglas de catálogo (D-029)
// ---------------------------------------------------------------------------

function configurarCatalogo(repo) {
  repo.saveAtributos([
    { nombre: 'FAMILIA', descripcion: 'Familia ficticia', activo: true }
  ]);
  repo.saveReglasClasificacion([
    {
      id: 'R-SOLAR',
      atributo: 'FAMILIA',
      valor: 'SOLAR',
      prioridad: 1,
      articulo_contiene: 'SOLAR',
      activo: true
    },
    {
      id: 'R-LUNAR',
      atributo: 'FAMILIA',
      valor: 'LUNAR',
      prioridad: 2,
      articulo_contiene: 'LUNAR',
      activo: true
    }
  ]);
  repo.saveAgrupaciones([
    {
      agrupacion: 'COMERCIAL',
      orden: 10,
      grupo: 'SOLAR',
      subgrupo: '',
      filtro: 'FAMILIA=SOLAR',
      activo: true,
      color: '#4FA37C'
    },
    {
      agrupacion: 'COMERCIAL',
      orden: 20,
      grupo: 'LUNAR',
      subgrupo: '',
      filtro: 'FAMILIA=LUNAR',
      activo: true,
      color: '#F2553D'
    }
  ]);
}

function crearCtx() {
  const entorno = crearEntorno();
  configurarCatalogo(entorno.repo);
  return entorno;
}

/**
 * Devuelve una función para registrar entradas ficticias con documento único.
 * @param {Object} env
 * @returns {Function}
 */
function crearEntradas(env) {
  let numero = 0;
  return function (articulo, cajas, fecha) {
    numero += 1;
    return env.movService.registrarEntrada({
      tipo_documento: 'COMPRA',
      serie: 'ACT90',
      numero: String(numero),
      fecha_documento: fecha,
      entidad_nombre: 'PROVEEDOR FICTICIO'
    }, [{
      codigo_articulo: articulo,
      codigo_envase: ENVASE,
      cajas: cajas,
      partida: `P-${numero}`
    }], 'Ana');
  };
}

function opciones(env) {
  return {
    repository: env.repo,
    movementService: env.movService,
    reloj: () => new Date(FIJO)
  };
}

function obtenerCuadre(env) {
  return conContextoDePrueba_('Ana', 'ENCARGADO', () => codigo.apiObtenerCuadre(opciones(env)));
}

function confirmarFamilia(env, params) {
  return conContextoDePrueba_('Ana', 'ENCARGADO', () => codigo.apiConfirmarCuadreFamilia(params, opciones(env)));
}

function lineasConHay(familia, hayPorArticulo) {
  return familia.articulos.map((articulo) => ({
    articulo: articulo.articulo,
    envase: articulo.envase,
    deberia: articulo.deberia,
    hay: Object.prototype.hasOwnProperty.call(hayPorArticulo, articulo.articulo)
      ? hayPorArticulo[articulo.articulo]
      : null
  }));
}

function stockDe(env, articulo) {
  const fila = env.repo.getStockActual().find((fila) => (
    String(fila.codigo_articulo) === articulo && String(fila.codigo_envase) === ENVASE
  ));
  return fila ? Number(fila.cajas_actuales) : 0;
}

function capasDe(env, articulo) {
  return env.repo.getCapasFifo()
    .filter((capa) => String(capa.codigo_articulo) === articulo && String(capa.codigo_envase) === ENVASE)
    .sort((a, b) => {
      const cmpFecha = String(a.fecha_capa || '').localeCompare(String(b.fecha_capa || ''));
      if (cmpFecha !== 0) return cmpFecha;
      return String(a.id_capa || '').localeCompare(String(b.id_capa || ''));
    });
}

function movimientosDe(env) {
  return env.repo.getMovimientos();
}

/**
 * Comprueba que la suma de CONSUMOS_FIFO por capa coincide con cajas_consumidas.
 * @param {Object} env
 */
function comprobarConsumosPorCapa(env) {
  const suma = new Map();
  for (const consumo of env.repo.getConsumosFifo()) {
    const idCapa = String(consumo.id_capa || '').trim();
    if (!idCapa) continue;
    suma.set(idCapa, (suma.get(idCapa) || 0) + Number(consumo.cajas || 0));
  }
  for (const capa of env.repo.getCapasFifo()) {
    assert.strictEqual(
      suma.get(String(capa.id_capa || '').trim()) || 0,
      Number(capa.cajas_consumidas || 0),
      `Consumos FIFO de la capa ${capa.id_capa} deben sumar cajas_consumidas`
    );
  }
}

// Semilla determinista para la prueba de invariantes.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log('================================================================');
console.log(' TEST SUITE T-040 — CUADRE DE LA NOCHE');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// 0. Esquema
// ---------------------------------------------------------------------------
runTest('0. CUADRES está en SCHEMA_DEFINITIONS y se crea al aprovisionar (idempotente)', () => {
  assert.deepStrictEqual(SCHEMA_DEFINITIONS.CUADRES, [
    'id_cuadre', 'familia', 'fecha_hora', 'usuario',
    'lineas_contadas', 'lineas_con_diferencia', 'cajas_diferencia', 'ids_ajustes'
  ]);
  const env = crearCtx();
  assert.ok(env.ss.getSheetByName('CUADRES'), 'La hoja CUADRES debe existir tras provisionar');
  assert.deepStrictEqual(env.ss.getSheetByName('CUADRES').rows[0], SCHEMA_DEFINITIONS.CUADRES);
  const otra = env.repo.provisionDatabase();
  assert.ok(!otra.createdSheets.includes('CUADRES'), 'Provisionar dos veces no recrea CUADRES');
  assert.strictEqual(Object.keys(SCHEMA_DEFINITIONS)[Object.keys(SCHEMA_DEFINITIONS).length - 1], 'USUARIOS');
});

// ---------------------------------------------------------------------------
// 1. Diferencia negativa por FIFO, fila de CUADRES y orden de familias/artículos
// ---------------------------------------------------------------------------
runTest('1. hay = [igual, −7, vacío] → 1 ajuste RECUENTO de −7 por FIFO y 1 fila en CUADRES', () => {
  const env = crearCtx();
  const entrada = crearEntradas(env);
  entrada(ART_A, 10, '2026-01-10');
  entrada(ART_B, 4, '2026-01-10');
  entrada(ART_B, 16, '2026-02-10');
  entrada(ART_C, 5, '2026-01-15');
  entrada(ART_LUNAR, 8, '2026-01-20');

  const cuadre = obtenerCuadre(env);
  assert.ok(cuadre.id_cuadre && cuadre.id_cuadre.startsWith('CUADRE-'), 'Debe generarse un id_cuadre con nuevoId');
  assert.deepStrictEqual(
    cuadre.familias.map((familia) => familia.familia),
    ['SOLAR', 'LUNAR'],
    'Las familias salen en el orden de AGRUPACIONES COMERCIAL'
  );
  assert.strictEqual(cuadre.familias[0].orden, 10);
  assert.strictEqual(cuadre.familias[0].color, '#4FA37C');
  assert.strictEqual(cuadre.familias[1].color, '#F2553D');
  assert.strictEqual(cuadre.familias[0].cajas, 35, '10 + 20 + 5 cajas');

  const solar = cuadre.familias[0];
  assert.strictEqual(solar.articulos.length, 3);
  const { compararArticulos } = require('../src/OrdenExistencias');
  for (let i = 1; i < solar.articulos.length; i++) {
    assert.ok(
      compararArticulos(solar.articulos[i - 1], solar.articulos[i]) <= 0,
      'Los artículos deben salir en el orden de compararArticulos (T-039)'
    );
  }

  const lineas = lineasConHay(solar, { [ART_A]: 10, [ART_B]: 13, [ART_C]: null });
  const resultado = confirmarFamilia(env, {
    id_cuadre: cuadre.id_cuadre,
    familia: solar.familia,
    lineas
  });

  assert.strictEqual(resultado.success, true);
  assert.strictEqual(resultado.ajustes, 1);
  assert.strictEqual(resultado.lineas_contadas, 3);
  assert.strictEqual(resultado.lineas_con_diferencia, 1);
  assert.strictEqual(resultado.cajas_diferencia, -7);
  assert.strictEqual(resultado.ids_ajustes.length, 1);

  const capasB = capasDe(env, ART_B);
  assert.strictEqual(capasB.length, 2);
  assert.strictEqual(Number(capasB[0].cajas_consumidas), 4, 'La partida más antigua se consume primero');
  assert.strictEqual(Number(capasB[0].cajas_restantes), 0);
  assert.strictEqual(Number(capasB[1].cajas_consumidas), 3);
  assert.strictEqual(Number(capasB[1].cajas_restantes), 13);
  assert.strictEqual(stockDe(env, ART_A), 10);
  assert.strictEqual(stockDe(env, ART_B), 13);
  assert.strictEqual(stockDe(env, ART_C), 5);

  const mov = movimientosDe(env).find((m) => m.id_movimiento === resultado.ids_ajustes[0]);
  assert.ok(mov, 'El ajuste debe existir en MOVIMIENTOS');
  assert.strictEqual(mov.motivo_ajuste, 'RECUENTO');
  assert.strictEqual(mov.signo, -1);
  assert.strictEqual(Number(mov.cajas), 7);
  assert.strictEqual(mov.observaciones, `CUADRE:${cuadre.id_cuadre}`);

  const filas = env.repo.getCuadres();
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].id_cuadre, cuadre.id_cuadre);
  assert.strictEqual(filas[0].familia, 'SOLAR');
  assert.strictEqual(Number(filas[0].lineas_contadas), 3);
  assert.strictEqual(Number(filas[0].lineas_con_diferencia), 1);
  assert.strictEqual(Number(filas[0].cajas_diferencia), -7);
  assert.deepStrictEqual(String(filas[0].ids_ajustes).split(','), resultado.ids_ajustes);

  assert.strictEqual(env.movService.comprobarConsistencia().consistente, true);
  comprobarConsumosPorCapa(env);

  // El siguiente obtenerCuadre ya trae el último cuadre de la familia.
  const despues = obtenerCuadre(env);
  const solarDespues = despues.familias.find((familia) => familia.familia === 'SOLAR');
  assert.ok(solarDespues.ultimo_cuadre);
  assert.strictEqual(solarDespues.ultimo_cuadre.usuario, 'Ana');
  assert.strictEqual(solarDespues.ultimo_cuadre.ajustes, 1);
  assert.strictEqual(solarDespues.cajas, 28, 'El debería se recalcula con el stock nuevo');
});

// ---------------------------------------------------------------------------
// 2. Diferencia positiva
// ---------------------------------------------------------------------------
runTest('2. Diferencia positiva +5 → ajuste +5 y libro consistente', () => {
  const env = crearCtx();
  crearEntradas(env)(ART_A, 10, '2026-01-10');
  const cuadre = obtenerCuadre(env);
  const solar = cuadre.familias[0];

  const resultado = confirmarFamilia(env, {
    id_cuadre: cuadre.id_cuadre,
    familia: solar.familia,
    lineas: lineasConHay(solar, { [ART_A]: 15 })
  });

  assert.strictEqual(resultado.success, true);
  assert.strictEqual(resultado.ajustes, 1);
  assert.strictEqual(resultado.cajas_diferencia, 5);
  assert.strictEqual(stockDe(env, ART_A), 15);

  const mov = movimientosDe(env).find((m) => m.id_movimiento === resultado.ids_ajustes[0]);
  assert.strictEqual(mov.signo, 1);
  assert.strictEqual(Number(mov.cajas), 5);
  assert.strictEqual(mov.motivo_ajuste, 'RECUENTO');

  const capaNueva = capasDe(env, ART_A).find((capa) => Number(capa.cajas_iniciales) === 5);
  assert.ok(capaNueva, 'El ajuste positivo crea una capa FIFO nueva');
  assert.strictEqual(Number(capaNueva.cajas_restantes), 5);
  assert.strictEqual(env.movService.comprobarConsistencia().consistente, true);
  comprobarConsumosPorCapa(env);
});

// ---------------------------------------------------------------------------
// 3. Concurrencia: el stock cambia entre abrir y confirmar
// ---------------------------------------------------------------------------
runTest('3. Si el stock cambia entre obtenerCuadre y confirmarFamilia → STOCK_CAMBIADO sin ajustes', () => {
  const env = crearCtx();
  crearEntradas(env)(ART_A, 10, '2026-01-10');
  const cuadre = obtenerCuadre(env);
  const solar = cuadre.familias[0];

  const ajusteExterno = env.movService.registrarAjuste({
    codigo_articulo: ART_A,
    codigo_envase: ENVASE,
    cajas: 2,
    signo: 1,
    motivo: 'OTRO'
  }, 'Ana');
  assert.strictEqual(ajusteExterno.success, true);

  const movimientosAntes = movimientosDe(env).length;
  const resultado = confirmarFamilia(env, {
    id_cuadre: cuadre.id_cuadre,
    familia: solar.familia,
    lineas: lineasConHay(solar, { [ART_A]: 8 })
  });

  assert.strictEqual(resultado.success, false);
  assert.strictEqual(resultado.status, 'STOCK_CAMBIADO');
  assert.strictEqual(resultado.lineas.length, 1);
  assert.strictEqual(resultado.lineas[0].deberia, 10);
  assert.strictEqual(resultado.lineas[0].actual, 12);
  assert.strictEqual(resultado.lineas[0].cambiado, true);
  assert.strictEqual(movimientosDe(env).length, movimientosAntes, 'No debe crearse ningún ajuste');
  assert.strictEqual(env.repo.getCuadres().length, 0, 'Tampoco debe guardarse la familia');
  assert.strictEqual(stockDe(env, ART_A), 12);
});

// ---------------------------------------------------------------------------
// 4. Idempotencia
// ---------------------------------------------------------------------------
runTest('4. Confirmar dos veces el mismo id_cuadre + familia devuelve lo guardado y no crea ajustes', () => {
  const env = crearCtx();
  crearEntradas(env)(ART_A, 10, '2026-01-10');
  const cuadre = obtenerCuadre(env);
  const solar = cuadre.familias[0];
  const params = {
    id_cuadre: cuadre.id_cuadre,
    familia: solar.familia,
    lineas: lineasConHay(solar, { [ART_A]: 7 })
  };

  const primero = confirmarFamilia(env, params);
  assert.strictEqual(primero.success, true);
  assert.strictEqual(primero.ajustes, 1);
  const movimientosTrasPrimero = movimientosDe(env).length;

  const segundo = confirmarFamilia(env, params);
  assert.strictEqual(segundo.success, true);
  assert.strictEqual(segundo.idempotente, true);
  assert.deepStrictEqual(segundo.ids_ajustes, primero.ids_ajustes);
  assert.strictEqual(segundo.ajustes, 1);
  assert.strictEqual(movimientosDe(env).length, movimientosTrasPrimero, 'No debe crear un segundo ajuste');
  assert.strictEqual(env.repo.getCuadres().length, 1, 'No debe crear una segunda fila de CUADRES');
  assert.strictEqual(stockDe(env, ART_A), 7);
});

// ---------------------------------------------------------------------------
// 5. Validación previa
// ---------------------------------------------------------------------------
runTest('5. hay negativo, no numérico o decimal → error y nada aplicado', () => {
  const env = crearCtx();
  crearEntradas(env)(ART_A, 10, '2026-01-10');
  const cuadre = obtenerCuadre(env);
  const solar = cuadre.familias[0];
  const base = {
    id_cuadre: cuadre.id_cuadre,
    familia: solar.familia
  };

  const casos = [
    [{ [ART_A]: -1 }, /entero/i],
    [{ [ART_A]: 'abc' }, /entero/i],
    [{ [ART_A]: 2.5 }, /entero/i],
    [{ [ART_A]: 1.5 }, /entero/i]
  ];
  for (const [hay, patron] of casos) {
    assert.throws(
      () => confirmarFamilia(env, {
        ...base,
        lineas: lineasConHay(solar, hay)
      }),
      patron,
      `hay = ${JSON.stringify(hay)} debe rechazarse`
    );
  }

  assert.strictEqual(movimientosDe(env).length, 1, 'Solo existe la entrada; ningún ajuste');
  assert.strictEqual(env.repo.getCuadres().length, 0);
  assert.strictEqual(stockDe(env, ART_A), 10);
});

// ---------------------------------------------------------------------------
// 6. Anulación del ajuste con apiAnularAjuste
// ---------------------------------------------------------------------------
runTest('6. apiAnularAjuste sobre un ajuste del cuadre devuelve el stock anterior', () => {
  const env = crearCtx();
  crearEntradas(env)(ART_A, 10, '2026-01-10');
  const cuadre = obtenerCuadre(env);
  const solar = cuadre.familias[0];
  const resultado = confirmarFamilia(env, {
    id_cuadre: cuadre.id_cuadre,
    familia: solar.familia,
    lineas: lineasConHay(solar, { [ART_A]: 3 })
  });
  assert.strictEqual(resultado.success, true);
  assert.strictEqual(stockDe(env, ART_A), 3);

  const anulacion = conContextoDePrueba_('Ana', 'ENCARGADO', () => codigo.apiAnularAjuste(
    resultado.ids_ajustes[0],
    'Recuento mal contado',
    opciones(env)
  ));

  assert.strictEqual(anulacion.success, true);
  assert.strictEqual(anulacion.status, 'ANULADO');
  assert.strictEqual(stockDe(env, ART_A), 10, 'El stock vuelve al valor anterior al cuadre');
  assert.strictEqual(env.movService.comprobarConsistencia().consistente, true);
  comprobarConsumosPorCapa(env);
});

// ---------------------------------------------------------------------------
// 7. Acceso: sin sesión y rol CONSULTA
// ---------------------------------------------------------------------------
class CacheFalso {
  constructor() {
    this.datos = new Map();
  }
  get(clave) {
    const entrada = this.datos.get(clave);
    if (!entrada) return null;
    if (Date.now() >= entrada.expira) {
      this.datos.delete(clave);
      return null;
    }
    return entrada.valor;
  }
  put(clave, valor, segundos) {
    this.datos.set(clave, { valor: String(valor), expira: Date.now() + Number(segundos) * 1000 });
  }
  remove(clave) {
    this.datos.delete(clave);
  }
}

function crearSesionConsulta(repo) {
  let n = 0;
  const cache = new CacheFalso();
  const servicio = new ServicioAcceso({
    repository: repo,
    cache,
    clock: () => new Date(FIJO),
    random: () => {
      n += 1;
      return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
    },
    lock: { waitLock: () => true, releaseLock: () => {} },
    urlImplementacion: URL_IMPLEMENTACION
  });
  const creado = servicio.crearUsuario('Lucía', 'CONSULTA');
  const token = /[?&]k=([^&]+)/.exec(creado.enlace);
  assert.ok(token, 'El enlace debe contener el token ?k=');
  const sesion = servicio.establecerPin(decodeURIComponent(token[1]), '1234');
  return { cache, sesion: sesion.sesion };
}

function conGlobalsDeAcceso(repo, cache, fn) {
  const anterior = {
    SheetsRepository: global.SheetsRepository,
    CacheService: global.CacheService,
    ScriptApp: global.ScriptApp,
    LockService: global.LockService
  };
  global.SheetsRepository = function RepositorioDePrueba() { return repo; };
  global.CacheService = { getScriptCache: () => cache };
  global.ScriptApp = { getService: () => ({ getUrl: () => URL_IMPLEMENTACION }) };
  global.LockService = { getScriptLock: () => ({ waitLock: () => true, releaseLock: () => {} }) };
  try {
    return fn();
  } finally {
    global.SheetsRepository = anterior.SheetsRepository;
    global.CacheService = anterior.CacheService;
    global.ScriptApp = anterior.ScriptApp;
    global.LockService = anterior.LockService;
  }
}

runTest('7. Sin sesión → «Acceso no autorizado»; con rol CONSULTA → rechazado en las dos API', () => {
  const env = crearCtx();
  assert.throws(
    () => codigo.apiObtenerCuadre({ repository: env.repo }),
    /Acceso no autorizado/
  );
  assert.throws(
    () => codigo.apiConfirmarCuadreFamilia({}, { repository: env.repo }),
    /Acceso no autorizado/
  );

  assert.strictEqual(PERMISOS_API.apiObtenerCuadre, 'ENCARGADO');
  assert.strictEqual(PERMISOS_API.apiConfirmarCuadreFamilia, 'ENCARGADO');
  assert.strictEqual(rolAlcanza_('CONSULTA', 'ENCARGADO'), false);

  const { cache, sesion } = crearSesionConsulta(env.repo);
  const lectura = conGlobalsDeAcceso(env.repo, cache, () => codigo.apiLlamar(sesion, 'apiObtenerCuadre', []));
  assert.deepStrictEqual(lectura, { success: false, errorCode: 'PERMISO_DENEGADO' });
  const escritura = conGlobalsDeAcceso(env.repo, cache, () => codigo.apiLlamar(sesion, 'apiConfirmarCuadreFamilia', [{}]));
  assert.deepStrictEqual(escritura, { success: false, errorCode: 'PERMISO_DENEGADO' });
});

// ---------------------------------------------------------------------------
// 8. Invariantes con 25 semillas
// ---------------------------------------------------------------------------
runTest('8. 25 semillas: consistencia, consumos FIFO por capa y stock final = hay', () => {
  const articulos = [ART_A, ART_B, ART_C];
  for (let semilla = 1; semilla <= 25; semilla++) {
    const env = crearCtx();
    const entrada = crearEntradas(env);
    const rand = rng(semilla * 7919);

    for (const articulo of articulos) {
      const numeroCapas = 1 + Math.floor(rand() * 3);
      for (let capa = 0; capa < numeroCapas; capa++) {
        const cajas = 1 + Math.floor(rand() * 20);
        const mes = String(1 + Math.floor(rand() * 6)).padStart(2, '0');
        const dia = String(1 + Math.floor(rand() * 27)).padStart(2, '0');
        entrada(articulo, cajas, `2026-${mes}-${dia}`);
      }
    }

    const cuadre = obtenerCuadre(env);
    assert.strictEqual(cuadre.familias.length, 1, `Semilla ${semilla}: solo la familia SOLAR tiene stock`);
    const solar = cuadre.familias[0];
    assert.strictEqual(solar.articulos.length, 3);

    const hays = {};
    for (const articulo of solar.articulos) {
      const modo = rand();
      if (modo < 0.2) {
        hays[articulo.articulo] = null;
      } else if (modo < 0.6) {
        hays[articulo.articulo] = articulo.deberia;
      } else {
        hays[articulo.articulo] = Math.max(0, articulo.deberia + Math.floor(rand() * 21) - 10);
      }
    }

    const resultado = confirmarFamilia(env, {
      id_cuadre: cuadre.id_cuadre,
      familia: solar.familia,
      lineas: lineasConHay(solar, hays)
    });
    assert.strictEqual(resultado.success, true, `Semilla ${semilla}: el cuadre debe confirmarse`);

    assert.strictEqual(env.movService.comprobarConsistencia().consistente, true, `Semilla ${semilla}: libro consistente`);
    comprobarConsumosPorCapa(env);

    for (const articulo of solar.articulos) {
      const hay = hays[articulo.articulo];
      const esperado = hay === null || hay === undefined ? articulo.deberia : hay;
      assert.strictEqual(stockDe(env, articulo.articulo), esperado, `Semilla ${semilla}: stock final de ${articulo.articulo}`);
    }

    const filas = env.repo.getCuadres();
    assert.strictEqual(filas.length, 1);
    assert.strictEqual(Number(filas[0].lineas_contadas), 3);
    assert.strictEqual(Number(filas[0].lineas_con_diferencia), resultado.lineas_con_diferencia);
    assert.strictEqual(Number(filas[0].cajas_diferencia), resultado.cajas_diferencia);
  }
});

// ---------------------------------------------------------------------------
// 9. Pantalla y navegación
// ---------------------------------------------------------------------------
runTest('9. La pantalla Cuadre existe, está incluida y cumple las reglas de accesibilidad', () => {
  const indexHtml = fs.readFileSync(path.join(SRC_DIR, 'Index.html'), 'utf8');
  const appHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'app.html'), 'utf8');
  const cuadreHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'cuadre.html'), 'utf8');
  const estilosHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'estilos.html'), 'utf8');

  assert.ok(indexHtml.includes("include_('ui/cuadre')"), 'Index.html debe incluir ui/cuadre');
  assert.ok(indexHtml.includes('id="navCuadre"'), 'Debe existir la entrada Cuadre en el menú lateral');
  const bloqueNav = indexHtml.slice(indexHtml.indexOf('id="navCuadre"') - 200, indexHtml.indexOf('id="navCuadre"') + 400);
  assert.ok(bloqueNav.includes('data-solo-escritura="1"'), 'La entrada Cuadre se oculta a CONSULTA');
  assert.ok(appHtml.includes("mostrarVista('cuadre')"), 'app.html debe conmutar la vista cuadre');
  assert.ok(appHtml.includes('window.SLCuadre.setVisible'), 'app.html debe ocultar/mostrar SLCuadre');
  assert.ok(appHtml.includes('abrirCuadre'), 'app.html debe tener la acción de abrir el cuadre');
  assert.ok(appHtml.includes('inyectarAccionCuadreMovil'), 'app.html debe añadir la acción del móvil');

  assert.ok(cuadreHtml.includes('inputmode="numeric"'), 'El campo Hay debe ser numérico');
  assert.ok(cuadreHtml.includes('<label class="sl-cuadre-sr" for="cuadreHay-'), 'Cada campo Hay debe tener un label accesible');
  assert.ok(cuadreHtml.includes('aria-live="polite"'), 'El resumen debe ser aria-live="polite"');
  assert.ok(cuadreHtml.includes('STOCK_CAMBIADO'), 'La pantalla debe tratar STOCK_CAMBIADO');
  assert.ok(cuadreHtml.includes('Volver a cargar'), 'Debe existir el botón Volver a cargar');
  assert.ok(cuadreHtml.includes('Saltar'), 'Debe existir el botón Saltar');
  assert.ok(cuadreHtml.includes('Cuadra · siguiente familia'), 'El botón cambia cuando no hay diferencias');
  assert.ok(cuadreHtml.includes('sl-cuadre-'), 'La pantalla usa las clases sl-cuadre-*');
  assert.ok(estilosHtml.includes('.sl-cuadre-page'), 'Las clases sl-cuadre-* viven en estilos.html');

  const tamanos = Array.from(cuadreHtml.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g), (m) => Number(m[1]));
  assert.ok(tamanos.every((valor) => valor >= 12), 'Ningún texto del cuadre baja de 12 px');
});

// ---------------------------------------------------------------------------
console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-040: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
