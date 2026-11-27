/**
 * STOCK-LIGHT — Test Suite T-043: cierre del día guiado
 *
 * Cubre los puntos de aceptación de docs/tickets/T-043-cierre-guiado.md:
 * 1. Día vacío → 0 de 6 y siguiente = 1.
 * 2. Importación de recepciones de hoy → paso 1 HECHO; «Hoy no hubo entradas» → SALTADO.
 * 3. Pendiente abierto → PENDIENTE; al resolverlo → HECHO; si entra otro → PENDIENTE.
 * 4. Cuadre de todas las familias → HECHO; falta una → PENDIENTE.
 * 5. Aviso de orden al pedir el cuadre con cambios/pendientes sin hacer.
 * 6. marcarPaso rechaza pasos automáticos; sin sesión → "Acceso no autorizado".
 * 7. El parte incluye «Cierre incompleto» si falta un paso y no lo incluye si están todos.
 * 8. Albaranes en espera con el detalle del artículo que falta y sello de hora.
 *
 * Datos 100 % ficticios (D-015). Ejecutable: node test/t043_cierre.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { crearEntorno } = require('./helpers/mockSheets');
const { CierreService } = require('../src/CierreService');
const { CuadreService } = require('../src/CuadreService');
const { CatalogoService } = require('../src/CatalogoService');
const { InicioService } = require('../src/InicioService');
const { ParteService, enviarParteDiario_ } = require('../src/ParteService');
const { SCHEMA_DEFINITIONS } = require('../src/Repository');
const codigo = require('../src/Código');
const { conContextoDePrueba_, PERMISOS_API } = require('../src/Seguridad');

const SRC_DIR = path.resolve(__dirname, '../src');
const FECHA = '2026-11-27';
const FIJO = '2026-11-27T21:00:00.000Z';
const ENVASE = 'CAJA FICTICIA 10X500';

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
// Utilidades de datos ficticios
// ---------------------------------------------------------------------------

function configurarFamilias(repo) {
  repo.saveAtributos([{ nombre: 'FAMILIA', descripcion: 'Familia ficticia', activo: true }]);
  repo.saveReglasClasificacion([
    { id: 'R-SOLAR', atributo: 'FAMILIA', valor: 'SOLAR', prioridad: 1, articulo_contiene: 'SOLAR', activo: true },
    { id: 'R-LUNAR', atributo: 'FAMILIA', valor: 'LUNAR', prioridad: 2, articulo_contiene: 'LUNAR', activo: true }
  ]);
  repo.saveAgrupaciones([
    { agrupacion: 'COMERCIAL', orden: 10, grupo: 'SOLAR', subgrupo: '', filtro: 'FAMILIA=SOLAR', activo: true, color: '#4FA37C' },
    { agrupacion: 'COMERCIAL', orden: 20, grupo: 'LUNAR', subgrupo: '', filtro: 'FAMILIA=LUNAR', activo: true, color: '#F2553D' }
  ]);
}

function crearEntrada(env, articulo, cajas = 10, numero = '1') {
  return env.movService.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'ACT90',
    numero: String(numero),
    fecha_documento: FECHA,
    entidad_nombre: 'PROVEEDOR FICTICIO'
  }, [{ codigo_articulo: articulo, codigo_envase: ENVASE, cajas, partida: `P-${numero}` }], 'Ana');
}

function crearCierre(env) {
  return new CierreService({
    repository: env.repo,
    movementService: env.movService,
    reloj: () => new Date(FIJO)
  });
}

function crearCuadre(env) {
  return new CuadreService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: new CatalogoService({ repository: env.repo }),
    reloj: () => new Date(FIJO)
  });
}

function opciones(env) {
  return {
    repository: env.repo,
    movementService: env.movService,
    reloj: () => new Date(FIJO)
  };
}

function filaPendiente(overrides = {}) {
  return Object.assign({
    id_pendiente: 'PEND-' + Math.random().toString(36).slice(2),
    tipo_doc: 'SALIDA',
    serie: 'AVT27',
    numero: '885',
    linea: 1,
    fecha_negocio: FECHA,
    entidad: 'FRUTAS FICTICIAS',
    articulo: 'TOMATE FICTICIO A',
    envase: ENVASE,
    cajas: 60,
    kg: '',
    motivo: 'STOCK_INSUFICIENTE',
    estado: 'PENDIENTE',
    fecha_alta: '2026-11-27T10:00:00.000Z',
    fecha_resolucion: ''
  }, overrides);
}

function inicioFalso(cierre) {
  return {
    repo: null,
    obtenerInicio: () => ({
      fecha_referencia: FECHA,
      total: 0,
      variedades: [],
      pendientes: { totalDocumentos: 0, porMotivo: {} },
      importado_hasta: { compras: null, ventas: null },
      cierre
    })
  };
}

function cargarSLCierre() {
  const html = fs.readFileSync(path.join(SRC_DIR, 'ui', 'cierre.html'), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match && match[1], 'src/ui/cierre.html debe contener un bloque <script>');
  const sandbox = { window: {}, document: {}, Intl, Date, console };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox);
  return sandbox.window.SLCierre;
}

console.log('================================================================');
console.log(' TEST SUITE T-043 — CIERRE DEL DÍA GUIADO');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// 0. Esquema
// ---------------------------------------------------------------------------
runTest('0. CIERRE_DIA está en el esquema y se crea al aprovisionar; USUARIOS sigue al final', () => {
  assert.deepStrictEqual(SCHEMA_DEFINITIONS.CIERRE_DIA, ['fecha', 'paso', 'estado', 'usuario', 'hora', 'nota']);
  const env = crearEntorno();
  assert.ok(env.ss.getSheetByName('CIERRE_DIA'), 'La hoja CIERRE_DIA debe existir');
  assert.deepStrictEqual(env.ss.getSheetByName('CIERRE_DIA').rows[0], SCHEMA_DEFINITIONS.CIERRE_DIA);
  assert.strictEqual(Object.keys(SCHEMA_DEFINITIONS)[Object.keys(SCHEMA_DEFINITIONS).length - 1], 'USUARIOS');
});

// ---------------------------------------------------------------------------
// 1. Día vacío
// ---------------------------------------------------------------------------
runTest('1. Día vacío → 0 de 6, siguiente 1 y todos los pasos pendientes', () => {
  const env = crearEntorno();
  const cierre = crearCierre(env).obtenerCierre(FECHA);
  assert.strictEqual(cierre.fecha, FECHA);
  assert.strictEqual(cierre.hechos, 0);
  assert.strictEqual(cierre.siguiente, 1);
  assert.strictEqual(cierre.pasos.length, 6);
  assert.deepStrictEqual(cierre.pasos.map(paso => paso.estado), Array(6).fill('PENDIENTE'));
  assert.deepStrictEqual(cierre.tareas_dia.destrios, { apuntes: 0, cajas: 0, ultima_hora: '' });
  assert.deepStrictEqual(cierre.tareas_dia.cambios, { apuntes: 0, cajas: 0, ultima_hora: '' });
});

// ---------------------------------------------------------------------------
// 2. Importaciones y «Hoy no hubo entradas»
// ---------------------------------------------------------------------------
runTest('2. Recepciones de hoy confirmadas → HECHO; «Hoy no hubo entradas» → SALTADO', () => {
  const env = crearEntorno();
  env.repo.appendImportaciones([{
    id_importacion: 'IMP-1',
    fecha_hora: '2026-11-27T18:00:00.000Z',
    usuario: 'Ana',
    tipo_csv: 'RECEPCIONES',
    estado: 'CONFIRMADA',
    documentos_nuevos: 2,
    documentos_saltados: 0,
    documentos_pendientes: 0,
    documentos_modificados: 0
  }]);
  const conImportacion = crearCierre(env).obtenerCierre(FECHA);
  assert.strictEqual(conImportacion.pasos[0].estado, 'HECHO');
  assert.strictEqual(conImportacion.pasos[0].usuario, 'Ana');
  assert.ok(conImportacion.pasos[0].detalle.includes('2 documentos'));
  assert.strictEqual(conImportacion.pasos[1].estado, 'PENDIENTE');

  const env2 = crearEntorno();
  const servicio = crearCierre(env2);
  servicio.marcarPaso(FECHA, 'recepciones', 'SALTADO', 'Ana');
  const sinEntradas = servicio.obtenerCierre(FECHA);
  assert.strictEqual(sinEntradas.pasos[0].estado, 'SALTADO');
  assert.strictEqual(sinEntradas.pasos[0].detalle, 'Hoy no hubo entradas');
  assert.strictEqual(sinEntradas.siguiente, 2);
});

// ---------------------------------------------------------------------------
// 3. Pendientes: abierto, resuelto y nuevo
// ---------------------------------------------------------------------------
runTest('3. Pendiente abierto → PENDIENTE; resuelto → HECHO; si entra otro → PENDIENTE', () => {
  const env = crearEntorno();
  env.repo.appendPendientes([filaPendiente({ id_pendiente: 'P-1', estado: 'PENDIENTE' })]);
  const servicio = crearCierre(env);
  assert.strictEqual(servicio.obtenerCierre(FECHA).pasos[3].estado, 'PENDIENTE');

  env.repo.savePendientes([filaPendiente({ id_pendiente: 'P-1', estado: 'RESUELTA', fecha_resolucion: '2026-11-27T18:30:00.000Z' })]);
  assert.strictEqual(servicio.obtenerCierre(FECHA).pasos[3].estado, 'HECHO');

  env.repo.appendPendientes([filaPendiente({ id_pendiente: 'P-2', estado: 'PENDIENTE', numero: '886' })]);
  assert.strictEqual(servicio.obtenerCierre(FECHA).pasos[3].estado, 'PENDIENTE');
});

// ---------------------------------------------------------------------------
// 4. Cuadre de todas las familias
// ---------------------------------------------------------------------------
runTest('4. Cuadre de todas las familias hoy → HECHO; falta una → PENDIENTE', () => {
  const env = crearEntorno();
  configurarFamilias(env.repo);
  crearEntrada(env, 'TOMATE FICTICIO SOLAR I G', 10, '1');
  crearEntrada(env, 'TOMATE FICTICIO LUNAR I G', 5, '2');
  const cuadre = crearCuadre(env).obtenerCuadre();
  assert.deepStrictEqual(cuadre.familias.map(familia => familia.familia), ['SOLAR', 'LUNAR']);

  for (const familia of cuadre.familias) {
    env.repo.appendCuadre({
      id_cuadre: 'CUADRE-TEST',
      familia: familia.familia,
      fecha_hora: '2026-11-27T20:00:00.000Z',
      usuario: 'Ana',
      lineas_contadas: familia.articulos.length,
      lineas_con_diferencia: 0,
      cajas_diferencia: 0,
      ids_ajustes: ''
    });
  }
  const completo = crearCierre(env).obtenerCierre(FECHA);
  assert.strictEqual(completo.pasos[4].estado, 'HECHO');
  assert.ok(completo.pasos[4].detalle.includes('2 familias'));

  const env2 = crearEntorno();
  configurarFamilias(env2.repo);
  crearEntrada(env2, 'TOMATE FICTICIO SOLAR I G', 10, '3');
  crearEntrada(env2, 'TOMATE FICTICIO LUNAR I G', 5, '4');
  env2.repo.appendCuadre({
    id_cuadre: 'CUADRE-TEST-2',
    familia: 'SOLAR',
    fecha_hora: '2026-11-27T20:00:00.000Z',
    usuario: 'Ana',
    lineas_contadas: 1,
    lineas_con_diferencia: 0,
    cajas_diferencia: 0,
    ids_ajustes: ''
  });
  const faltaUna = crearCierre(env2).obtenerCierre(FECHA);
  assert.strictEqual(faltaUna.pasos[4].estado, 'PENDIENTE');
  assert.ok(faltaUna.pasos[4].detalle.includes('LUNAR'));
});

// ---------------------------------------------------------------------------
// 5. Aviso de orden
// ---------------------------------------------------------------------------
runTest('5. Con cambios y pendientes sin hacer, el paso 5 avisa antes de cuadrar', () => {
  const env = crearEntorno();
  env.repo.appendPendientes([filaPendiente({ id_pendiente: 'P-1', estado: 'PENDIENTE' })]);
  const cierre = crearCierre(env).obtenerCierre(FECHA);
  assert.strictEqual(cierre.pasos[2].estado, 'PENDIENTE');
  assert.strictEqual(cierre.pasos[3].estado, 'PENDIENTE');
  assert.strictEqual(cierre.pasos[4].estado, 'PENDIENTE');
  assert.ok(cierre.pasos[4].aviso.includes('Antes de cuadrar faltan pasos: 3 y 4'));
  assert.ok(cierre.pasos[4].aviso.includes('las diferencias saldrán falsas'));
  assert.ok(cierre.avisos.some(aviso => /Antes de cuadrar/.test(aviso)));
});

// ---------------------------------------------------------------------------
// 6. Marcas manuales y acceso
// ---------------------------------------------------------------------------
runTest('6. marcarPaso rechaza automáticos; sin sesión → «Acceso no autorizado»', () => {
  const env = crearEntorno();
  const servicio = crearCierre(env);
  for (const clave of ['ventas', 'pendientes', 'cuadre']) {
    assert.throws(
      () => servicio.marcarPaso(FECHA, clave, 'HECHO', 'Ana'),
      /automático/i,
      `El paso ${clave} no debe poder marcarse a mano`
    );
  }

  servicio.marcarPaso(FECHA, 'recepciones', 'SALTADO', 'Ana');
  servicio.marcarPaso(FECHA, 'cambios', 'HECHO', 'Ana');
  const cierre = servicio.obtenerCierre(FECHA);
  assert.strictEqual(cierre.pasos[0].estado, 'SALTADO');
  assert.strictEqual(cierre.pasos[2].estado, 'HECHO');

  assert.throws(() => codigo.apiObtenerCierre({ repository: env.repo }), /Acceso no autorizado/);
  assert.throws(() => codigo.apiMarcarPasoCierre('parte', 'HECHO', { repository: env.repo }), /Acceso no autorizado/);

  assert.strictEqual(PERMISOS_API.apiObtenerCierre, 'ENCARGADO');
  assert.strictEqual(PERMISOS_API.apiMarcarPasoCierre, 'ENCARGADO');
  const api = conContextoDePrueba_('Ana', 'ENCARGADO', () => codigo.apiObtenerCierre(opciones(env)));
  assert.strictEqual(api.fecha, FECHA);
});

// ---------------------------------------------------------------------------
// 7. Parte: línea de cierre incompleto
// ---------------------------------------------------------------------------
runTest('7. El parte incluye «Cierre incompleto» si falta un paso y no lo incluye si están todos', () => {
  const env = crearEntorno();
  const pasosPendientes = [
    { n: 1, estado: 'HECHO' },
    { n: 2, estado: 'HECHO' },
    { n: 3, estado: 'PENDIENTE' },
    { n: 4, estado: 'HECHO' },
    { n: 5, estado: 'HECHO' },
    { n: 6, estado: 'PENDIENTE' }
  ];
  const parteIncompleto = new ParteService({
    inicioService: inicioFalso({ pasos: pasosPendientes }),
    repository: env.repo,
    clock: () => new Date(FIJO)
  }).generarParte({ hoy: FECHA });
  assert.ok(parteIncompleto.texto.includes('Cierre incompleto: falta el paso 3.'));
  assert.ok(parteIncompleto.html.includes('Cierre incompleto: falta el paso 3.'));

  const parteCompleto = new ParteService({
    inicioService: inicioFalso({
      pasos: [
        { n: 1, estado: 'HECHO' }, { n: 2, estado: 'HECHO' }, { n: 3, estado: 'HECHO' },
        { n: 4, estado: 'HECHO' }, { n: 5, estado: 'HECHO' }, { n: 6, estado: 'PENDIENTE' }
      ]
    }),
    repository: env.repo,
    clock: () => new Date(FIJO)
  }).generarParte({ hoy: FECHA });
  assert.ok(!parteCompleto.texto.includes('Cierre incompleto'));
  assert.ok(!parteCompleto.html.includes('Cierre incompleto'));
});

// ---------------------------------------------------------------------------
// 8. Albaranes en espera y sello de hora
// ---------------------------------------------------------------------------
runTest('8. Albarán en espera: entero espera, con el artículo que falta y sus cajas', () => {
  const env = crearEntorno();
  crearEntrada(env, 'TOMATE FICTICIO A', 10, '10');
  env.repo.appendPendientes([
    filaPendiente({ id_pendiente: 'P-1', articulo: 'TOMATE FICTICIO A', envase: ENVASE, cajas: 10, linea: 1 }),
    filaPendiente({ id_pendiente: 'P-2', articulo: 'TOMATE FICTICIO B', envase: ENVASE, cajas: 60, linea: 2 })
  ]);
  const cierre = crearCierre(env).obtenerCierre(FECHA);
  assert.strictEqual(cierre.pasos[3].estado, 'PENDIENTE');
  assert.strictEqual(cierre.pasos[3].espera.length, 1);
  const espera = cierre.pasos[3].espera[0];
  assert.strictEqual(espera.espera_entera, true);
  assert.strictEqual(espera.lineas.length, 2, 'El albarán entero espera, también la línea con stock');
  assert.strictEqual(espera.faltantes.length, 1);
  assert.strictEqual(espera.faltantes[0].articulo, 'TOMATE FICTICIO B');
  assert.strictEqual(espera.faltantes[0].faltan, 60);
});

runTest('9. Sello: hora del último movimiento y texto de otro día', () => {
  const env = crearEntorno();
  env.repo.appendMovimientos([{
    id_movimiento: 'MOV-FICTICIO-1',
    fecha_hora: '2026-11-26T19:05:00.000Z',
    tipo_movimiento: 'ENTRADA',
    codigo_articulo: 'TOMATE FICTICIO A',
    codigo_envase: ENVASE,
    cajas: 1,
    signo: 1,
    motivo_ajuste: '',
    usuario: 'Ana',
    observaciones: '',
    estado: 'CONFIRMADO',
    fecha_negocio: '2026-11-26',
    secuencia: 1,
    origen_dato: 'CSV'
  }]);
  const inicio = new InicioService({ repository: env.repo, reloj: () => new Date(FIJO) }).obtenerInicio({ hoy: FECHA });
  assert.strictEqual(inicio.ultimo_movimiento_hora, '2026-11-26T19:05:00.000Z');

  const SLCierre = cargarSLCierre();
  const mismoDia = SLCierre.textoSello('2026-11-27T19:05:00.000Z', '2026-11-27T21:00:00.000Z');
  assert.strictEqual(mismoDia.texto, 'Actualizado a las 20:05');
  assert.strictEqual(mismoDia.otroDia, false);
  const otroDia = SLCierre.textoSello('2026-11-26T19:05:00.000Z', '2026-11-27T21:00:00.000Z');
  assert.strictEqual(otroDia.texto, 'Actualizado el 26/11 a las 20:05');
  assert.strictEqual(otroDia.otroDia, true);
});

// ---------------------------------------------------------------------------
// 10. Envío del parte y pantalla
// ---------------------------------------------------------------------------
runTest('10. El correo del parte marca el paso 6 y la pantalla/parte usan la API de cierre', () => {
  const env = crearEntorno();
  const parteSvc = new ParteService({
    inicioService: inicioFalso({ pasos: [
      { n: 1, estado: 'HECHO' }, { n: 2, estado: 'HECHO' }, { n: 3, estado: 'HECHO' },
      { n: 4, estado: 'HECHO' }, { n: 5, estado: 'HECHO' }, { n: 6, estado: 'PENDIENTE' }
    ] }),
    repository: env.repo,
    clock: () => new Date(FIJO)
  });
  const properties = {
    getProperty: (clave) => (clave === 'PARTE_DESTINATARIOS' ? 'destino@ficticio.test' : null)
  };
  let enviados = 0;
  const resultado = enviarParteDiario_({
    parteService: parteSvc,
    repository: env.repo,
    propertiesService: properties,
    mailApp: { sendEmail: () => { enviados++; } },
    reloj: () => new Date(FIJO)
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(enviados, 1);
  const marcas = env.repo.getCierreDia();
  assert.strictEqual(marcas.length, 1);
  assert.strictEqual(marcas[0].paso, 'parte');
  assert.strictEqual(marcas[0].estado, 'HECHO');
  assert.strictEqual(marcas[0].fecha, FECHA);

  const indexHtml = fs.readFileSync(path.join(SRC_DIR, 'Index.html'), 'utf8');
  const appHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'app.html'), 'utf8');
  const parteHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'parte.html'), 'utf8');
  const cierreHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'cierre.html'), 'utf8');
  const estilosHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'estilos.html'), 'utf8');
  assert.ok(indexHtml.includes("include_('ui/cierre')"));
  assert.ok(indexHtml.includes('id="navCierre"'));
  assert.ok(appHtml.includes('window.SLCierre') && appHtml.includes('abrirCierre'));
  assert.ok(parteHtml.includes('apiMarcarPasoCierre') && parteHtml.includes("'parte', 'HECHO'"));
  assert.ok(cierreHtml.includes('aria-live="polite"'));
  assert.ok(!/\sstyle=/.test(cierreHtml), 'La pantalla nueva no debe usar style=""');
  assert.ok(estilosHtml.includes('.sl-cierre-paso'));
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-043: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
