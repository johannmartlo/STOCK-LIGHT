/**
 * STOCK-LIGHT — Test Suite T-011: instalación, stock inicial y puesta en marcha.
 *
 * Cubre los puntos de aceptación 1 a 10 de docs/tickets/T-011-puesta-en-marcha.md.
 * Ejecutable: node test/t011_puesta_en_marcha.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');
const {
  StockInicialService,
  STOCK_INICIAL_CABECERA_KG,
  STOCK_INICIAL_HOJA
} = require('../src/importacion/StockInicialService');
const { adminInstalarStockLight } = require('../src/Instalacion');
const { SCHEMA_DEFINITIONS } = require('../src/Repository');
const { ServicioAcceso, PERMISOS_API, conContextoDePrueba_ } = require('../src/Seguridad');
const codigo = require('../src/Código');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'csv');
const FIXTURE_STOCK_INICIAL = path.join(FIXTURE_DIR, 'stock_inicial_ejemplo.csv');
const HEADER_VENTAS = fs.readFileSync(path.join(FIXTURE_DIR, 'ventas_t007.csv'), 'utf8').split(/\r?\n/)[0];
const URL_IMPLEMENTACION = 'https://script.google.com/macros/s/PRUEBA_T011/exec';

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
// Datos y utilidades de prueba (ficticios, D-015)
// ---------------------------------------------------------------------------

function sesionPropietario() {
  return {
    getActiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' }),
    getEffectiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' })
  };
}

function crearProperties(valores = {}) {
  const store = Object.assign({}, valores);
  return {
    getProperty: (clave) => (Object.prototype.hasOwnProperty.call(store, clave) ? store[clave] : null),
    setProperty: (clave, valor) => { store[clave] = String(valor); },
    _store: store
  };
}

function crearScriptAppFalso() {
  const triggers = [];
  return {
    triggers,
    getProjectTriggers: () => triggers.slice(),
    newTrigger: (handler) => ({
      timeBased: () => ({
        atHour: () => ({
          everyDays: () => ({
            create: () => {
              triggers.push({ getHandlerFunction: () => handler });
            }
          })
        })
      })
    }),
    deleteTrigger: (trigger) => {
      const indice = triggers.indexOf(trigger);
      if (indice >= 0) triggers.splice(indice, 1);
    }
  };
}

function crearOpcionesInstalacion(env, overrides = {}) {
  const props = Object.assign({
    SPREADSHEET_ID: 'HOJA_FICTICIA_T011_1234567890',
    DRIVE_FOLDER_ID: 'CARPETA_FICTICIA_T011_1234567890',
    BACKUP_FOLDER_ID: 'COPIAS_FICTICIAS_T011_1234567890'
  }, overrides.props || {});

  return Object.assign({
    repository: env.repo,
    session: sesionPropietario(),
    propertiesService: crearProperties(props),
    spreadsheet: env.ss,
    scriptApp: crearScriptAppFalso(),
    urlImplementacion: URL_IMPLEMENTACION,
    lock: env.lock
  }, overrides, { props: undefined });
}

function crearCatalogoStockInicial() {
  return new CatalogoService({
    config: {
      atributos: [{ nombre: 'SEGUIMIENTO', descripcion: 'Seguimiento', activo: true }],
      reglas: [
        { id: 'R1', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 1, articulo_contiene: 'TOMATE FICTICIO', activo: true },
        { id: 'R2', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 2, articulo_contiene: 'PEPINO FICTICIO', activo: true },
        { id: 'R3', atributo: 'SEGUIMIENTO', valor: 'NO', prioridad: 3, articulo_contiene: 'CALABACIN NO SEGUIDO', activo: true }
      ],
      catalogo: [
        { articulo: 'TOMATE FICTICIO', envase: 'CAJA FICTICIA', atributo: 'SEGUIMIENTO', valor: 'SI', activo: true },
        { articulo: 'PEPINO FICTICIO', envase: 'CAJA FICTICIA', atributo: 'SEGUIMIENTO', valor: 'SI', activo: true }
      ],
      agrupaciones: []
    }
  });
}

function crearServicioStockInicial(env, overrides = {}) {
  const copias = [];
  const crearCopia = overrides.crearCopiaSeguridad || ((motivo, opciones) => {
    copias.push({ motivo, opciones });
    return { id: `COPIA-FAKE-${copias.length}`, nombre: `STOCK-LIGHT_COPIA_2026-11-25_1000_${motivo}` };
  });

  const servicio = new StockInicialService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: overrides.catalogoService || crearCatalogoStockInicial(),
    crearCopiaSeguridad: crearCopia,
    backupOptions: {},
    clock: () => new Date('2026-11-25T10:00:00Z'),
    ...overrides,
    crearCopiaSeguridad: crearCopia
  });

  return { servicio, copias };
}

function leerFixtureStockInicial() {
  return fs.readFileSync(FIXTURE_STOCK_INICIAL, 'utf8');
}

function numeroEs(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return String(valor).replace('.', ',');
}

function cajasEs(valor) {
  const texto = numeroEs(valor);
  return texto.includes(',') ? texto : `${texto},000`;
}

function filaVenta(opciones = {}) {
  const {
    fecha = '03/11/2026',
    numero = '200',
    serie = 'AVT27',
    linea = 1,
    articulo = 'TOMATE FICTICIO',
    envase = 'CAJA FICTICIA',
    cajas = 12,
    kg = 60,
    cliente = 'CLIENTE FICTICIO'
  } = opciones;
  return [
    fecha, `REF-${serie}-${numero}`, String(numero), `${serie}/${numero} (${linea})`,
    cliente, articulo, cajasEs(cajas), String(cajas), '0', numeroEs(kg), envase, '0', ''
  ].join(';');
}

function crearCsv(header, filas) {
  return [header].concat(filas).join('\n') + '\n';
}

function filaStock(opciones = {}) {
  return {
    Fecha: opciones.fecha || '20/10/2026',
    Proveedor: opciones.proveedor || 'PROVEEDOR FICTICIO UNO',
    Articulo: opciones.articulo || 'TOMATE FICTICIO',
    Envase: opciones.envase || 'CAJA FICTICIA',
    Cajas: opciones.cajas === undefined ? '10' : String(opciones.cajas),
    Kg: opciones.kg === undefined ? '' : String(opciones.kg)
  };
}

function crearCacheFalso() {
  const datos = new Map();
  return {
    get: (clave) => (datos.has(clave) ? datos.get(clave) : null),
    put: (clave, valor) => { datos.set(clave, String(valor)); },
    remove: (clave) => { datos.delete(clave); }
  };
}

function crearAleatorio() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

function crearLaboratorioAcceso(env) {
  const cache = crearCacheFalso();
  const servicio = new ServicioAcceso({
    repository: env.repo,
    cache,
    clock: () => new Date(),
    random: crearAleatorio(),
    lock: { waitLock: () => true, releaseLock: () => {} },
    urlImplementacion: URL_IMPLEMENTACION
  });
  return { servicio, cache };
}

function tokenDeEnlace(enlace) {
  const match = /[?&]k=([^&]+)/.exec(String(enlace || ''));
  return match ? decodeURIComponent(match[1]) : '';
}

function instalarGlobalsT011(env, cache) {
  const anterior = {
    SheetsRepository: global.SheetsRepository,
    CacheService: global.CacheService,
    ScriptApp: global.ScriptApp,
    LockService: global.LockService
  };

  global.SheetsRepository = function RepositorioDePrueba() { return env.repo; };
  global.CacheService = { getScriptCache: () => cache };
  global.ScriptApp = { getService: () => ({ getUrl: () => URL_IMPLEMENTACION }) };
  global.LockService = { getScriptLock: () => ({ waitLock: () => true, releaseLock: () => {} }) };

  return function restaurar() {
    global.SheetsRepository = anterior.SheetsRepository;
    global.CacheService = anterior.CacheService;
    global.ScriptApp = anterior.ScriptApp;
    global.LockService = anterior.LockService;
  };
}

console.log('\n================================================================');
console.log(' TEST SUITE T-011 — INSTALACIÓN, STOCK INICIAL Y PUESTA EN MARCHA');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// Aceptación 1: instalación idempotente y catálogo existente
// ---------------------------------------------------------------------------

runTest('1. adminInstalarStockLight es idempotente, no pisa reglas y crea el primer ADMIN una vez', () => {
  const env = crearEntorno({ skipProvision: true });
  const opciones = crearOpcionesInstalacion(env);

  const primero = adminInstalarStockLight('Ana Ficticia', opciones);
  assert.ok(primero.hecho.some((item) => item.startsWith('hojas_provisionadas:')), 'Debe provisionar hojas');
  assert.ok(primero.hecho.some((item) => item.startsWith('catalogo_sembrado:')), 'Debe sembrar el catálogo vacío');
  assert.ok(primero.hecho.includes('copia_diaria_instalada'), 'Debe instalar la copia diaria');
  assert.ok(primero.hecho.includes('usuario_admin_creado'), 'Debe crear el primer ADMIN');
  assert.ok(String(primero.enlace).includes('?k='), 'Debe devolver el enlace personal del ADMIN');

  const usuarios = env.repo.getUsuarios();
  assert.strictEqual(usuarios.length, 1);
  assert.strictEqual(String(usuarios[0].rol).toUpperCase(), 'ADMIN');
  assert.ok(env.ss.getSheetByName(STOCK_INICIAL_HOJA), 'Debe crear STOCK_INICIAL_ENTRADA');
  assert.deepStrictEqual(
    env.ss.getSheetByName(STOCK_INICIAL_HOJA).rows[0],
    STOCK_INICIAL_CABECERA_KG,
    'La cabecera de STOCK_INICIAL_ENTRADA debe ser la del ticket'
  );

  const reglas = env.repo.getReglasClasificacion();
  assert.ok(reglas.length > 0, 'El catálogo debe quedar sembrado');

  const segundo = adminInstalarStockLight('Ana Ficticia', opciones);
  assert.deepStrictEqual(segundo.hecho, [], 'La segunda ejecución no debe cambiar nada');
  assert.strictEqual(segundo.sinCambios, true);
  assert.strictEqual(segundo.enlace, '');
  assert.ok(segundo.yaEstaba.includes('hojas'));
  assert.ok(segundo.yaEstaba.includes('catalogo'));
  assert.ok(segundo.yaEstaba.includes('copia_diaria'));
  assert.ok(segundo.yaEstaba.includes('usuario_admin'));
  assert.strictEqual(env.repo.getUsuarios().length, 1, 'No debe crear un segundo ADMIN');
  assert.strictEqual(env.repo.getReglasClasificacion().length, reglas.length, 'No debe duplicar reglas');

  // Catálogo ya existente: no se siembra ni se pisa.
  const env2 = crearEntorno();
  env2.repo.replaceTable('ATRIBUTOS', [{ nombre: 'SEGUIMIENTO', descripcion: 'Propia', activo: true }]);
  env2.repo.replaceTable('REGLAS_CLASIFICACION', [{
    id: 'REGLA_PROPIA',
    atributo: 'SEGUIMIENTO',
    valor: 'SI',
    prioridad: 1,
    articulo_contiene: 'ARTICULO PROPIO',
    activo: true
  }]);

  const tercero = adminInstalarStockLight('Beto Ficticio', crearOpcionesInstalacion(env2));
  assert.ok(tercero.yaEstaba.includes('catalogo'), 'Debe respetar el catálogo existente');
  assert.deepStrictEqual(
    env2.repo.getReglasClasificacion().map((regla) => regla.id),
    ['REGLA_PROPIA'],
    'No debe añadir reglas de la semilla si ya hay reglas'
  );
});

// ---------------------------------------------------------------------------
// Aceptación 2: sin configuración no se escribe nada
// ---------------------------------------------------------------------------

runTest('2. Sin Spreadsheet o carpeta de Drive configurados para y dice qué ejecutar, sin escribir', () => {
  const env = crearEntorno({ skipProvision: true });
  const sinSpreadsheet = adminInstalarStockLight('Ana Ficticia', crearOpcionesInstalacion(env, {
    props: { SPREADSHEET_ID: '', DRIVE_FOLDER_ID: '', BACKUP_FOLDER_ID: '' }
  }));
  assert.ok(sinSpreadsheet.falta.some((item) => item.includes('configurarSpreadsheetId')));
  assert.deepStrictEqual(sinSpreadsheet.hecho, []);
  assert.strictEqual(env.ss.sheets.size, 0, 'No debe escribir ninguna hoja');

  const env2 = crearEntorno({ skipProvision: true });
  const sinDrive = adminInstalarStockLight('Ana Ficticia', crearOpcionesInstalacion(env2, {
    props: { DRIVE_FOLDER_ID: '' }
  }));
  assert.ok(sinDrive.falta.some((item) => item.includes('configurarDriveFolderId')));
  assert.deepStrictEqual(sinDrive.hecho, []);
  assert.strictEqual(env2.ss.sheets.size, 0, 'No debe escribir ninguna hoja');
});

// ---------------------------------------------------------------------------
// Aceptación 3: CSV de ejemplo, capas, totales y consistencia
// ---------------------------------------------------------------------------

runTest('3. El CSV de ejemplo crea una capa por fila, los totales cuadran y la consistencia es correcta', () => {
  const env = crearEntorno();
  const { servicio, copias } = crearServicioStockInicial(env);
  const texto = leerFixtureStockInicial();

  const preview = servicio.previsualizar(texto);
  assert.strictEqual(preview.status, 'OK');
  assert.strictEqual(preview.bloquea, false);
  assert.strictEqual(preview.filas.length, 3);
  assert.ok(preview.filas.every((fila) => fila.estado === 'OK'), JSON.stringify(preview.filas));
  assert.strictEqual(preview.totales.general.cajas, 23);
  assert.strictEqual(preview.totales.general.filas, 3);
  assert.deepStrictEqual(
    preview.totales.porArticuloEnvase.map((item) => [item.articulo, item.envase, item.cajas]),
    [['TOMATE FICTICIO', 'CAJA FICTICIA', 15], ['PEPINO FICTICIO', 'CAJA FICTICIA', 8]]
  );
  assert.deepStrictEqual(
    preview.totales.porProveedor.map((item) => [item.proveedor, item.cajas]),
    [['PROVEEDOR FICTICIO UNO', 18], ['PROVEEDOR FICTICIO DOS', 5]]
  );

  const sinKg = [
    'Fecha;Proveedor;Articulo;Envase;Cajas',
    '20/10/2026;PROVEEDOR FICTICIO UNO;TOMATE FICTICIO;CAJA FICTICIA;3'
  ].join('\n') + '\n';
  const previewSinKg = servicio.previsualizar(sinKg);
  assert.strictEqual(previewSinKg.status, 'OK');
  assert.strictEqual(previewSinKg.filas[0].estado, 'OK');
  assert.strictEqual(previewSinKg.filas[0].kg, '');
  assert.strictEqual(previewSinKg.totales.general.cajas, 3);

  const resultado = servicio.confirmar(texto, preview.hash, 'Operador Ficticio', { anadir: false });
  assert.strictEqual(resultado.success, true, resultado.error || '');
  assert.strictEqual(resultado.filasCargadas, 3);
  assert.strictEqual(resultado.cajasCargadas, 23);
  assert.ok(resultado.copia && resultado.copia.id, 'Debe devolver la copia previa');
  assert.strictEqual(copias.length, 1);
  assert.strictEqual(copias[0].motivo, 'PRE_STOCK_INICIAL');
  assert.ok(String(resultado.avisoVueltaAtras).includes('PRE_STOCK_INICIAL'));

  const capas = env.repo.getCapasFifo();
  assert.strictEqual(capas.length, 3, 'Una capa por fila OK');
  const totalCapas = capas.reduce((total, capa) => total + Number(capa.cajas_iniciales), 0);
  assert.strictEqual(totalCapas, preview.totales.general.cajas, 'Los totales deben cuadrar con las capas');
  const capaAntigua = capas.find((capa) => (
    capa.codigo_articulo === 'TOMATE FICTICIO' && String(capa.fecha_capa) === '2026-10-20'
  ));
  assert.ok(capaAntigua, 'Debe existir la capa de la primera partida');
  assert.strictEqual(capaAntigua.proveedor, 'PROVEEDOR FICTICIO UNO');
  assert.strictEqual(String(capaAntigua.fecha_capa), '2026-10-20');

  const movimientos = env.repo.getMovimientos();
  assert.strictEqual(movimientos.length, 3);
  assert.ok(movimientos.every((mov) => (
    mov.tipo_movimiento === 'AJUSTE'
    && Number(mov.signo) === 1
    && mov.motivo_ajuste === 'STOCK_INICIAL'
    && mov.origen_dato === 'STOCK_INICIAL'
  )));

  const log = env.repo.getLogOperaciones();
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].operacion, 'STOCK_INICIAL');
  assert.strictEqual(log[0].referencia, preview.hash);
  assert.strictEqual(Number(log[0].cantidad_cajas), 23);

  const check = env.movService.comprobarConsistencia();
  assert.strictEqual(check.consistente, true, JSON.stringify(check));
});

// ---------------------------------------------------------------------------
// Aceptación 4: bloqueos y avisos
// ---------------------------------------------------------------------------

runTest('4. DESCONOCIDA y ERROR_DATOS bloquean; NO_SEGUIDA se salta; NO_VISTA avisa y se carga', () => {
  const env = crearEntorno();
  const { servicio, copias } = crearServicioStockInicial(env);

  const filas = [
    filaStock({ cajas: 4 }),
    filaStock({ articulo: 'ARTICULO DESCONOCIDO', cajas: 5 }),
    filaStock({ articulo: 'TOMATE FICTICIO', cajas: 0 }),
    filaStock({ articulo: 'CALABACIN NO SEGUIDO', cajas: 6 }),
    filaStock({ articulo: 'TOMATE FICTICIO NUEVO', cajas: 7 })
  ];

  const preview = servicio.previsualizar(filas);
  assert.strictEqual(preview.filas[0].estado, 'OK');
  assert.strictEqual(preview.filas[1].estado, 'DESCONOCIDA');
  assert.strictEqual(preview.filas[2].estado, 'ERROR_DATOS');
  assert.strictEqual(preview.filas[2].motivo, 'CAJAS_INVALIDAS');
  assert.strictEqual(preview.filas[3].estado, 'NO_SEGUIDA');
  assert.strictEqual(preview.filas[4].estado, 'OK');
  assert.strictEqual(preview.filas[4].aviso, 'NO_VISTA');
  assert.strictEqual(preview.bloquea, true);
  assert.strictEqual(preview.bloqueos, 2);

  const bloqueada = servicio.confirmar(filas, preview.hash, 'Operador Ficticio', {});
  assert.strictEqual(bloqueada.success, false);
  assert.strictEqual(bloqueada.status, 'BLOQUEADA');
  assert.strictEqual(env.repo.getMovimientos().length, 0, 'No debe escribir con filas bloqueadas');
  assert.strictEqual(copias.length, 0, 'No debe crear copia si hay bloqueos');

  const buenas = [filas[0], filas[3], filas[4]];
  const previewBuenas = servicio.previsualizar(buenas);
  assert.strictEqual(previewBuenas.bloquea, false);
  assert.strictEqual(previewBuenas.avisos, 2);

  const resultado = servicio.confirmar(buenas, previewBuenas.hash, 'Operador Ficticio', {});
  assert.strictEqual(resultado.success, true, resultado.error || '');
  assert.strictEqual(resultado.filasCargadas, 2);
  assert.strictEqual(resultado.filasSaltadas, 1);
  assert.strictEqual(resultado.filasNoVistas, 2);

  const capas = env.repo.getCapasFifo();
  assert.strictEqual(capas.length, 2);
  assert.ok(capas.some((capa) => capa.codigo_articulo === 'TOMATE FICTICIO NUEVO'));
  assert.ok(!capas.some((capa) => capa.codigo_articulo === 'CALABACIN NO SEGUIDO'));
});

// ---------------------------------------------------------------------------
// Aceptación 5: segunda carga
// ---------------------------------------------------------------------------

runTest('5. Una segunda carga sin anadir se rechaza sin escribir; con anadir se añade', () => {
  const env = crearEntorno();
  const { servicio, copias } = crearServicioStockInicial(env);
  const texto = leerFixtureStockInicial();
  const preview = servicio.previsualizar(texto);

  const primera = servicio.confirmar(texto, preview.hash, 'Operador Ficticio', {});
  assert.strictEqual(primera.success, true);
  const movimientosPrimera = env.repo.getMovimientos().length;
  assert.strictEqual(movimientosPrimera, 3);

  const segunda = servicio.confirmar(texto, preview.hash, 'Operador Ficticio', {});
  assert.strictEqual(segunda.success, false);
  assert.strictEqual(segunda.status, 'YA_HAY_MOVIMIENTOS');
  assert.strictEqual(env.repo.getMovimientos().length, movimientosPrimera);
  assert.strictEqual(copias.length, 1, 'El rechazo no debe crear otra copia');

  const tercera = servicio.confirmar(texto, preview.hash, 'Operador Ficticio', { anadir: true });
  assert.strictEqual(tercera.success, true, tercera.error || '');
  assert.strictEqual(env.repo.getMovimientos().length, movimientosPrimera * 2);
  assert.strictEqual(env.repo.getCapasFifo().length, 6);
  assert.strictEqual(copias.length, 2);
});

// ---------------------------------------------------------------------------
// Aceptación 6: todo o nada
// ---------------------------------------------------------------------------

runTest('6. Si falla la copia o una fila durante la aplicación, no queda ningún movimiento', () => {
  const envCopia = crearEntorno();
  const texto = leerFixtureStockInicial();
  const { servicio: servicioCopia } = crearServicioStockInicial(envCopia, {
    crearCopiaSeguridad: () => { throw new Error('copia rota'); }
  });
  const previewCopia = servicioCopia.previsualizar(texto);
  const falloCopia = servicioCopia.confirmar(texto, previewCopia.hash, 'Operador Ficticio', {});
  assert.strictEqual(falloCopia.success, false);
  assert.strictEqual(falloCopia.status, 'COPIA_FALLIDA');
  assert.strictEqual(envCopia.repo.getMovimientos().length, 0);
  assert.strictEqual(envCopia.repo.getCapasFifo().length, 0);

  const envAplicacion = crearEntorno();
  const { servicio: servicioAplicacion } = crearServicioStockInicial(envAplicacion);
  const original = envAplicacion.movService._aplicar.bind(envAplicacion.movService);
  let llamadas = 0;
  envAplicacion.movService._aplicar = (estado, movimiento) => {
    llamadas += 1;
    if (llamadas === 2) return { ok: false, error: 'fallo simulado' };
    return original(estado, movimiento);
  };

  try {
    const previewAplicacion = servicioAplicacion.previsualizar(texto);
    const falloAplicacion = servicioAplicacion.confirmar(texto, previewAplicacion.hash, 'Operador Ficticio', {});
    assert.strictEqual(falloAplicacion.success, false);
    assert.strictEqual(falloAplicacion.status, 'ERROR_APLICACION');
    assert.strictEqual(envAplicacion.repo.getMovimientos().length, 0);
    assert.strictEqual(envAplicacion.repo.getCapasFifo().length, 0);
  } finally {
    envAplicacion.movService._aplicar = original;
  }
});

// ---------------------------------------------------------------------------
// Aceptación 7: FIFO con dos partidas iniciales y una venta T-007
// ---------------------------------------------------------------------------

runTest('7. Tras dos partidas iniciales, una venta T-007 consume primero la más antigua', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogoStockInicial();
  const { servicio } = crearServicioStockInicial(env, { catalogoService: catalogo });

  const filas = [
    filaStock({ fecha: '01/10/2026', proveedor: 'PROVEEDOR FICTICIO A', cajas: 5 }),
    filaStock({ fecha: '10/10/2026', proveedor: 'PROVEEDOR FICTICIO B', cajas: 10 })
  ];
  const preview = servicio.previsualizar(filas);
  const carga = servicio.confirmar(filas, preview.hash, 'Operador Ficticio', {});
  assert.strictEqual(carga.success, true, carga.error || '');

  const venta = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '15/10/2026', serie: 'AVT27', numero: '701', cajas: 7 })
  ]);
  const importacion = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogo
  });
  const previewVenta = importacion.previsualizar(venta);
  const confirmada = importacion.confirmar(venta, previewVenta.hash, 'Operador Ficticio');
  assert.strictEqual(confirmada.success, true, confirmada.error || '');

  const capas = env.repo.getCapasFifo();
  const capaAntigua = capas.find((capa) => String(capa.fecha_capa) === '2026-10-01');
  const capaNueva = capas.find((capa) => String(capa.fecha_capa) === '2026-10-10');
  assert.ok(capaAntigua && capaNueva);

  const consumosPorCapa = new Map();
  for (const consumo of env.repo.getConsumosFifo()) {
    const id = String(consumo.id_capa);
    consumosPorCapa.set(id, (consumosPorCapa.get(id) || 0) + Number(consumo.cajas));
  }
  assert.strictEqual(consumosPorCapa.get(String(capaAntigua.id_capa)), 5, 'Debe agotar la partida más antigua');
  assert.strictEqual(consumosPorCapa.get(String(capaNueva.id_capa)), 2, 'Debe consumir 2 de la siguiente');

  const stock = env.repo.getStockActual().find((fila) => (
    fila.codigo_articulo === 'TOMATE FICTICIO' && fila.codigo_envase === 'CAJA FICTICIA'
  ));
  assert.strictEqual(Number(stock.cajas_actuales), 8);
  assert.strictEqual(env.movService.comprobarConsistencia().consistente, true);
});

// ---------------------------------------------------------------------------
// Aceptación 8: venta pendiente T-008 aplicada tras la carga
// ---------------------------------------------------------------------------

runTest('8. Una venta pendiente de T-008 se aplica sola después de cargar el stock inicial', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogoStockInicial();
  const importacion = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogo
  });

  const venta = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '20/10/2026', serie: 'AVT27', numero: '801', cajas: 30 })
  ]);
  const previewVenta = importacion.previsualizar(venta);
  const confirmada = importacion.confirmar(venta, previewVenta.hash, 'Operador Ficticio');
  assert.strictEqual(confirmada.success, true);
  assert.strictEqual(env.repo.getPendientes().length, 1);
  assert.strictEqual(env.repo.getPendientes()[0].motivo, 'STOCK_INSUFICIENTE');
  assert.strictEqual(env.repo.getPendientes()[0].estado, 'PENDIENTE');

  const { servicio } = crearServicioStockInicial(env, { catalogoService: catalogo });
  const filas = [filaStock({ fecha: '01/10/2026', cajas: 50 })];
  const preview = servicio.previsualizar(filas);
  const carga = servicio.confirmar(filas, preview.hash, 'Operador Ficticio', {});
  assert.strictEqual(carga.success, true, carga.error || '');
  assert.ok(carga.reintentoPendientes, 'Debe devolver el resultado del reintento');
  assert.strictEqual(carga.reintentoPendientes.aplicados.STOCK_INSUFICIENTE, 1);

  const pendiente = env.repo.getPendientes()[0];
  assert.strictEqual(pendiente.estado, 'APLICADA');
  assert.ok(pendiente.fecha_resolucion);

  const stock = env.repo.getStockActual().find((fila) => (
    fila.codigo_articulo === 'TOMATE FICTICIO' && fila.codigo_envase === 'CAJA FICTICIA'
  ));
  assert.strictEqual(Number(stock.cajas_actuales), 20);
  assert.strictEqual(env.movService.comprobarConsistencia().consistente, true);
});

// ---------------------------------------------------------------------------
// Aceptación 9: API nueva protegida por sesión y rol ADMIN
// ---------------------------------------------------------------------------

runTest('9. Las API de stock inicial rechazan sin sesión y con rol menor que ADMIN', () => {
  const env = crearEntorno();
  const texto = leerFixtureStockInicial();
  const lab = crearLaboratorioAcceso(env);
  const restaurar = instalarGlobalsT011(env, lab.cache);

  try {
    assert.throws(
      () => codigo.apiPrevisualizarStockInicial(texto),
      (err) => err instanceof Error && err.message === 'Acceso no autorizado'
    );
    assert.throws(
      () => codigo.apiConfirmarStockInicial(texto, 'hash', false),
      (err) => err instanceof Error && err.message === 'Acceso no autorizado'
    );

    assert.strictEqual(PERMISOS_API.apiPrevisualizarStockInicial, 'ADMIN');
    assert.strictEqual(PERMISOS_API.apiConfirmarStockInicial, 'ADMIN');
    assert.strictEqual(PERMISOS_API.apiPrevisualizarStockInicial, PERMISOS_API.apiConfirmarStockInicial);

    const encargado = lab.servicio.crearUsuario('Beto Ficticio', 'ENCARGADO');
    const tokenEncargado = tokenDeEnlace(encargado.enlace);
    const sesionEncargado = lab.servicio.establecerPin(tokenEncargado, '1234').sesion;
    const denegada = codigo.apiLlamar(sesionEncargado, 'apiPrevisualizarStockInicial', [texto]);
    assert.strictEqual(denegada.success, false);
    assert.strictEqual(denegada.errorCode, 'PERMISO_DENEGADO');
    const denegadaConfirmar = codigo.apiLlamar(sesionEncargado, 'apiConfirmarStockInicial', [texto, 'hash', false]);
    assert.strictEqual(denegadaConfirmar.success, false);
    assert.strictEqual(denegadaConfirmar.errorCode, 'PERMISO_DENEGADO');

    const admin = lab.servicio.crearUsuario('Ana Ficticia', 'ADMIN');
    const tokenAdmin = tokenDeEnlace(admin.enlace);
    const sesionAdmin = lab.servicio.establecerPin(tokenAdmin, '1234').sesion;
    const permitida = codigo.apiLlamar(sesionAdmin, 'apiPrevisualizarStockInicial', [texto]);
    assert.strictEqual(permitida.status, 'OK');
    assert.strictEqual(permitida.filas.length, 3);
  } finally {
    restaurar();
  }
});

// ---------------------------------------------------------------------------
// Aceptación 10: cobertura de esquema y API pública
// ---------------------------------------------------------------------------

runTest('10. El esquema incluye STOCK_INICIAL_ENTRADA y las API nuevas están clasificadas', () => {
  assert.deepStrictEqual(SCHEMA_DEFINITIONS[STOCK_INICIAL_HOJA], STOCK_INICIAL_CABECERA_KG);
  const documento = fs.readFileSync(path.join(__dirname, '..', 'docs', 'API_PUBLICA.md'), 'utf8');
  for (const nombre of [
    'adminInstalarStockLight',
    'adminPrevisualizarStockInicialDesdeHoja',
    'adminConfirmarStockInicialDesdeHoja',
    'apiPrevisualizarStockInicial',
    'apiConfirmarStockInicial'
  ]) {
    assert.ok(documento.includes(`\`${nombre}\``), `${nombre} debe estar en docs/API_PUBLICA.md`);
  }
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-011: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
