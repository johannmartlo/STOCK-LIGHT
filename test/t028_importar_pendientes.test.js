/**
 * STOCK-LIGHT — Test Suite T-028: Importar y Pendientes (Servidor + Cliente)
 *
 * Cubre los puntos de aceptación 1, 2 y 5 de docs/tickets/T-028-importar-pendientes.md:
 * 1. Servidor (SeguimientoService + apiDecidirSeguimiento):
 *    - SEGUIR aplica las líneas pendientes y el documento pasa a CONFIRMADO;
 *    - IGNORAR las deja en IGNORADA sin movimientos;
 *    - decidir dos veces no duplica nada;
 *    - sin sesión se rechaza; CONSULTA no puede llamarla y ENCARGADO sí.
 * 2. Cliente (src/ui/importar.html, src/ui/pendientes.html, src/ui/app.html):
 *    - orden automático pone compras antes que ventas;
 *    - detección de codificación decodifica windows-1252 sin U+FFFD;
 *    - CONSULTA no tiene botones de confirmar, reintentar, decidir ni marcar;
 *      Stock inicial solo es visible para ADMIN.
 *
 * Ejecutable: node test/t028_importar_pendientes.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');
const { PendientesService } = require('../src/importacion/PendientesService');
const { SeguimientoService } = require('../src/SeguimientoService');
const { conContextoDePrueba_, PERMISOS_API, crearServicioAcceso_ } = require('../src/Seguridad');
const codigo = require('../src/Código');

const SRC_DIR = path.resolve(__dirname, '../src');
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/csv');

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

function configurarCatalogoBase(repo) {
  repo.saveAtributos([
    { nombre: 'SEGUIMIENTO', descripcion: 'Seguimiento en stock', activo: true }
  ]);
  repo.saveReglasClasificacion([
    { id: 'R-TOM', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 1, articulo_contiene: 'TOMATE', activo: true }
  ]);
}

function crearCompraConDesconocido(env, articulo, envase, numero, cajas) {
  const csv = [
    'FechaAlbaran;NombreEmisor;NumeroAlbaran;SerieAlbaran;OrdenLinea;NumeracionProveedor;ReferenciaAC;NombreArticulo;DescripcionArticulo;UnidadesEnvase;CantidadLineaAlbaran;CantidadTotal;ReferenciaLineaAlbaran;ObservacionesLineaAlbaran;CantidadPrecioPor;Factor;PorCada;PesoBrutoLACCA;PesoNetoLACCA;NroPaletsAC;PaletAC;NombrePaletAC;CodigoEnvaseAC;NombreEnvaseAC;CantidadEnvasesAC',
    `04/11/2026;Proveedor Prueba;${numero};ACT27;1;NP-${numero};REF-${numero};${articulo};Desc;${cajas};${cajas},000;${cajas};REF-L1;;1;1;1;100,000;80,000;0;;;ENV-1;${envase};${cajas},000`
  ].join('\n');
  const catalogoSvc = new CatalogoService({ repository: env.repo });
  const pendSvc = new PendientesService({ repository: env.repo, movementService: env.movService, catalogoService: catalogoSvc, lockService: env.lock });
  const impSvc = new ImportacionService({ repository: env.repo, movementService: env.movService, catalogoService: catalogoSvc, pendientesService: pendSvc, lockService: env.lock });
  const prev = impSvc.previsualizar(csv);
  const res = impSvc.confirmar(csv, prev.hash, 'Ana');
  assert.strictEqual(res.success, true);
  return { catalogoSvc, pendSvc, impSvc };
}

function cargarSLAppEnVm(elementosEscritura, elementosAdmin) {
  const appHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'app.html'), 'utf8');
  const match = appHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match && match[1], 'src/ui/app.html debe contener bloque <script>');
  const clasesBody = new Set();
  const nodosEsc = Array.isArray(elementosEscritura) ? elementosEscritura : [];
  const nodosAdm = Array.isArray(elementosAdmin) ? elementosAdmin : [];
  const sandbox = {
    window: { innerWidth: 1440, addEventListener: () => {}, removeEventListener: () => {} },
    document: {
      readyState: 'loading',
      body: {
        classList: {
          toggle: (cls, force) => { if (force) clasesBody.add(cls); else clasesBody.delete(cls); },
          contains: (cls) => clasesBody.has(cls)
        }
      },
      addEventListener: () => {},
      getElementById: () => null,
      querySelectorAll: (sel) => {
        if (sel === '[data-solo-escritura="1"]') return nodosEsc;
        if (sel === '[data-solo-admin="1"]') return nodosAdm;
        return [];
      }
    },
    navigator: { onLine: true },
    TextDecoder,
    Uint8Array,
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox);
  return { SLApp: sandbox.window.SLApp, clasesBody };
}

console.log('================================================================');
console.log(' TEST SUITE T-028 — IMPORTAR Y PENDIENTES (SERVIDOR + CLIENTE)');
console.log('================================================================\n');

// --------------------------------------------------------------------------
// 1. SERVIDOR: SEGUIR aplica pendientes y confirma documento
// --------------------------------------------------------------------------
runTest('1. decidirSeguimiento(SEGUIR) crea excepción SI, aplica pendientes y confirma el documento', () => {
  const env = crearEntorno();
  configurarCatalogoBase(env.repo);
  const { catalogoSvc, pendSvc } = crearCompraConDesconocido(env, 'CALABACIN NUEVO', 'CAJA VERDE', '501', 30);

  // Antes: 1 pendiente SEGUIMIENTO_DESCONOCIDO y 0 movimientos
  assert.strictEqual(env.repo.getMovimientos().length, 0);
  assert.strictEqual(pendSvc.listarPendientes({ estado: 'PENDIENTE' }).totalFilas, 1);

  const segSvc = new SeguimientoService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogoSvc,
    pendientesService: pendSvc,
    lockService: env.lock
  });

  const res = segSvc.decidirSeguimiento('CALABACIN NUEVO', 'CAJA VERDE', 'SEGUIR', '', 'Carlos');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.valor, 'SI');
  assert.strictEqual(res.aplicados.SEGUIMIENTO_DESCONOCIDO, 1);
  assert.strictEqual(res.siguenPendientes.total, 0);

  // El documento pasa a CONFIRMADO y se crea movimiento + stock
  const docs = env.repo.getDocumentos();
  const doc501 = docs.find(d => String(d.numero) === '501');
  assert.ok(doc501, 'Debe existir el documento 501');
  assert.strictEqual(doc501.estado_proceso, 'CONFIRMADO');
  assert.strictEqual(env.repo.getMovimientos().length, 1);
  assert.strictEqual(env.repo.getCapasFifo()[0].cajas_restantes, 30);

  // Log registrado con quién y cuándo
  const logs = env.repo.getLogOperaciones();
  assert.ok(logs.some(l => l.operacion === 'DECIDIR_SEGUIMIENTO' && l.usuario === 'Carlos' && l.destino === 'SEGUIMIENTO=SI'));
});

// --------------------------------------------------------------------------
// 2. SERVIDOR: IGNORAR deja pendientes en IGNORADA sin crear movimientos
// --------------------------------------------------------------------------
runTest('2. decidirSeguimiento(IGNORAR) crea excepción NO y deja pendientes en IGNORADA sin movimientos', () => {
  const env = crearEntorno();
  configurarCatalogoBase(env.repo);
  const { catalogoSvc, pendSvc } = crearCompraConDesconocido(env, 'PEPINO DESCONOCIDO', 'CAJA AZUL', '502', 20);

  const res = conContextoDePrueba_('Elena', 'ENCARGADO', () =>
    codigo.apiDecidirSeguimiento('PEPINO DESCONOCIDO', 'CAJA AZUL', 'IGNORAR', {
      repository: env.repo,
      movementService: env.movService,
      catalogoService: catalogoSvc,
      pendientesService: pendSvc,
      lockService: env.lock
    })
  );

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.valor, 'NO');
  assert.strictEqual(res.ignorados.SEGUIMIENTO_DESCONOCIDO, 1);
  assert.strictEqual(env.repo.getMovimientos().length, 0);

  const pendientesTodas = env.repo.getPendientes();
  assert.strictEqual(pendientesTodas[0].estado, 'IGNORADA');
});

// --------------------------------------------------------------------------
// 3. SERVIDOR: Idempotencia — decidir dos veces no duplica nada
// --------------------------------------------------------------------------
runTest('3. decidirSeguimiento llamado dos veces no duplica movimientos ni excepciones', () => {
  const env = crearEntorno();
  configurarCatalogoBase(env.repo);
  const { catalogoSvc, pendSvc } = crearCompraConDesconocido(env, 'PIMIENTO NUEVO', 'CAJA ROJA', '503', 15);

  const opts = {
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogoSvc,
    pendientesService: pendSvc,
    lockService: env.lock
  };

  const r1 = conContextoDePrueba_('Ana', 'ENCARGADO', () => codigo.apiDecidirSeguimiento('PIMIENTO NUEVO', 'CAJA ROJA', 'SEGUIR', opts));
  const r2 = conContextoDePrueba_('Ana', 'ENCARGADO', () => codigo.apiDecidirSeguimiento('PIMIENTO NUEVO', 'CAJA ROJA', 'SEGUIR', opts));

  assert.strictEqual(r1.aplicados.total, 1);
  assert.strictEqual(r2.aplicados.total, 0);
  assert.strictEqual(env.repo.getMovimientos().length, 1);
  assert.strictEqual(env.repo.getCapasFifo().length, 1);
  assert.strictEqual(env.repo.getCatalogo().filter(c => c.articulo === 'PIMIENTO NUEVO').length, 1);
});

// --------------------------------------------------------------------------
// 4. SEGURIDAD T-020: sin sesión se rechaza; CONSULTA denegado, ENCARGADO permitido
// --------------------------------------------------------------------------
runTest('4. apiDecidirSeguimiento exige sesión, rechaza CONSULTA y permite ENCARGADO', () => {
  assert.strictEqual(PERMISOS_API.apiDecidirSeguimiento, 'ENCARGADO');
  assert.throws(() => codigo.apiDecidirSeguimiento('ART', 'ENV', 'SEGUIR'), /Acceso no autorizado/);

  const env = crearEntorno();
  configurarCatalogoBase(env.repo);
  const cacheMap = new Map();
  const acceso = crearServicioAcceso_({
    repository: env.repo,
    cache: {
      get: k => cacheMap.get(k) || null,
      put: (k, v) => cacheMap.set(k, v),
      remove: k => cacheMap.delete(k)
    },
    lock: env.lock,
    urlImplementacion: 'https://ejemplo.local/exec'
  });

  const uCons = acceso.crearUsuario('Lucia', 'CONSULTA');
  const tCons = new URL(uCons.enlace).searchParams.get('k');
  const sCons = acceso.establecerPin(tCons, '1234');

  const uEnc = acceso.crearUsuario('Mario', 'ENCARGADO');
  const tEnc = new URL(uEnc.enlace).searchParams.get('k');
  const sEnc = acceso.establecerPin(tEnc, '5678');

  const origCrear = global.crearServicioAcceso_;
  global.crearServicioAcceso_ = () => acceso;
  try {
    const resCons = codigo.apiLlamar(sCons.sesion, 'apiDecidirSeguimiento', ['ART', 'ENV', 'SEGUIR']);
    assert.strictEqual(resCons.success, false);
    assert.strictEqual(resCons.errorCode, 'PERMISO_DENEGADO');

    const resEnc = codigo.apiLlamar(sEnc.sesion, 'apiDecidirSeguimiento', ['ART NUEVO', 'ENV', 'IGNORAR', { repository: env.repo, movementService: env.movService, lockService: env.lock }]);
    assert.strictEqual(resEnc.success, true);
    assert.strictEqual(resEnc.valor, 'NO');
  } finally {
    global.crearServicioAcceso_ = origCrear;
  }
});

// --------------------------------------------------------------------------
// 5. CLIENTE: Orden automático compras antes que ventas
// --------------------------------------------------------------------------
runTest('5. ordenarArchivosImportacion coloca compras antes que ventas aunque se suelten al revés', () => {
  const { SLApp } = cargarSLAppEnVm();
  const ventasTxt = fs.readFileSync(path.join(FIXTURES_DIR, 'ventas_t007.csv'), 'utf8');
  const comprasTxt = fs.readFileSync(path.join(FIXTURES_DIR, 'compras_t007.csv'), 'utf8');

  const entrada = [
    { nombre: 'ventas_t007.csv', texto: ventasTxt },
    { nombre: 'compras_t007.csv', texto: comprasTxt }
  ];
  const ordenados = SLApp.ordenarArchivosImportacion(entrada);
  assert.strictEqual(ordenados[0].nombre, 'compras_t007.csv');
  assert.strictEqual(ordenados[1].nombre, 'ventas_t007.csv');
});

// --------------------------------------------------------------------------
// 6. CLIENTE: Detección de codificación windows-1252 y UTF-8
// --------------------------------------------------------------------------
runTest('6. decodificarBytesCsv detecta windows-1252 cuando UTF-8 produce caracteres de reemplazo', () => {
  const { SLApp } = cargarSLAppEnVm();

  // "Albarán;Cartón;Destrío" en Windows-1252: á=0xE1, ó=0xF3, í=0xED
  const bytesWin1252 = new Uint8Array([
    0x41, 0x6c, 0x62, 0x61, 0x72, 0xe1, 0x6e, 0x3b,
    0x43, 0x61, 0x72, 0x74, 0xf3, 0x6e, 0x3b,
    0x44, 0x65, 0x73, 0x74, 0x72, 0xed, 0x6f
  ]);
  const resWin = SLApp.decodificarBytesCsv(bytesWin1252);
  assert.strictEqual(resWin.codificacion, 'windows-1252');
  assert.strictEqual(resWin.texto, 'Albarán;Cartón;Destrío');
  assert.ok(!resWin.texto.includes('\uFFFD'), 'No debe contener caracteres de reemplazo');

  // Fixture UTF-8 real
  const bufUtf8 = fs.readFileSync(path.join(FIXTURES_DIR, 'ventas_t007.csv'));
  const resUtf8 = SLApp.decodificarBytesCsv(new Uint8Array(bufUtf8));
  assert.strictEqual(resUtf8.codificacion, 'utf-8');
  assert.ok(resUtf8.texto.includes('Albarán'));
});

// --------------------------------------------------------------------------
// 7. CLIENTE: CONSULTA sin botones de acción y Stock inicial solo ADMIN
// --------------------------------------------------------------------------
runTest('7. CONSULTA no tiene botones de confirmar, reintentar, decidir ni marcar; Stock inicial solo ADMIN', () => {
  const importarHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'importar.html'), 'utf8');
  const pendientesHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'pendientes.html'), 'utf8');
  const appHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'app.html'), 'utf8');
  const combinado = importarHtml + '\n' + pendientesHtml + '\n' + appHtml;

  // Botones estáticos en importar.html y pendientes.html
  assert.ok(/id="btnConfirmarImportacion"[^>]*data-solo-escritura="1"/.test(importarHtml));
  assert.ok(/id="btnReintentarPendientes"[^>]*data-solo-escritura="1"/.test(pendientesHtml));
  assert.ok(/id="tabImpStockInicial"[^>]*data-solo-admin="1"/.test(importarHtml));
  assert.ok(/id="panelStockInicial"[^>]*data-solo-admin="1"/.test(importarHtml));

  // Botones dinámicos generados en app.html para decidir y marcar revisado
  assert.ok(combinado.includes('data-pedir-decision="SEGUIR"') && combinado.includes('data-solo-escritura="1"'));
  assert.ok(combinado.includes('data-marcar-revisado=') && combinado.includes('Aplicar la versión nueva'));

  // Comportamiento de aplicarRol
  const escEstado = [{ hidden: false }];
  const admEstado = [{ hidden: false }];
  const mkMock = arr => arr.map(o => ({
    setAttribute: k => { if (k === 'hidden') o.hidden = true; },
    removeAttribute: k => { if (k === 'hidden') o.hidden = false; }
  }));
  const { SLApp, clasesBody } = cargarSLAppEnVm(mkMock(escEstado), mkMock(admEstado));

  SLApp.aplicarRol('CONSULTA');
  assert.strictEqual(clasesBody.has('sl-rol-consulta'), true);
  assert.strictEqual(clasesBody.has('sl-rol-admin'), false);
  assert.strictEqual(escEstado[0].hidden, true);
  assert.strictEqual(admEstado[0].hidden, true);

  SLApp.aplicarRol('ENCARGADO');
  assert.strictEqual(clasesBody.has('sl-rol-consulta'), false);
  assert.strictEqual(clasesBody.has('sl-rol-admin'), false);
  assert.strictEqual(escEstado[0].hidden, false);
  assert.strictEqual(admEstado[0].hidden, true);

  SLApp.aplicarRol('ADMIN');
  assert.strictEqual(clasesBody.has('sl-rol-consulta'), false);
  assert.strictEqual(clasesBody.has('sl-rol-admin'), true);
  assert.strictEqual(escEstado[0].hidden, false);
  assert.strictEqual(admEstado[0].hidden, false);
});

// --------------------------------------------------------------------------
// 8. AMPLIACIÓN: SEGUIR con grupo ROSA clasifica las cajas en ROSA y no en «Sin agrupar»
// --------------------------------------------------------------------------
runTest('8. decidirSeguimiento(SEGUIR, ROSA) escribe atributos del filtro y obtenerInicio() las pone en ROSA', () => {
  const env = crearEntorno();
  env.repo.saveAtributos([
    { nombre: 'SEGUIMIENTO', descripcion: 'Seguimiento en stock', activo: true },
    { nombre: 'FAMILIA', descripcion: 'Familia comercial', activo: true }
  ]);
  env.repo.saveReglasClasificacion([
    { id: 'R-TOM', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 1, articulo_contiene: 'TOMATE', activo: true },
    { id: 'R-ROSA', atributo: 'FAMILIA', valor: 'ROSA', prioridad: 10, articulo_contiene: 'ROSA', activo: true }
  ]);
  env.repo.saveAgrupaciones([
    { agrupacion: 'COMERCIAL', orden: 1, grupo: 'ROSA', subgrupo: '', filtro: 'FAMILIA=ROSA', activo: true, color: '#EC4899', dias_aviso: 4, stock_bajo: '' },
    { agrupacion: 'COMERCIAL', orden: 2, grupo: 'MORESCO', subgrupo: '', filtro: 'FAMILIA=MORESCO', activo: true, color: '#4FA37C', dias_aviso: 4, stock_bajo: '' }
  ]);

  const { catalogoSvc, pendSvc } = crearCompraConDesconocido(env, 'CHERRY PERA NUEVO', 'CARTON 40X30', '508', 42);

  const res = conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiDecidirSeguimiento('CHERRY PERA NUEVO', 'CARTON 40X30', 'SEGUIR', 'ROSA', {
      repository: env.repo,
      movementService: env.movService,
      catalogoService: catalogoSvc,
      pendientesService: pendSvc,
      lockService: env.lock
    })
  );

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.grupo, 'ROSA');
  assert.strictEqual(res.aplicados.SEGUIMIENTO_DESCONOCIDO, 1);

  const inicio = conContextoDePrueba_('Mario', 'CONSULTA', () =>
    codigo.apiObtenerInicio({ repository: env.repo, reloj: () => '2026-11-26' })
  );

  const varRosa = inicio.variedades.find(v => v.grupo === 'ROSA');
  const varSinAgrupar = inicio.variedades.find(v => v.grupo === 'Sin agrupar');
  assert.ok(varRosa, 'Debe existir la variedad ROSA en obtenerInicio()');
  assert.strictEqual(varRosa.cajas, 42, 'Las 42 cajas deben caer en la variedad ROSA');
  assert.strictEqual(varSinAgrupar, undefined, 'No debe haber cajas en Sin agrupar');
});

// --------------------------------------------------------------------------
// 9. CORRECCIÓN: pluraliza(n, singular, plural) y fmtSigned sin +0 ni −0
// --------------------------------------------------------------------------
runTest('9. pluraliza(n, singular, plural) formatea singular/plural y fmtSigned nunca devuelve +0 ni −0', () => {
  const { SLApp } = cargarSLAppEnVm();
  assert.strictEqual(typeof SLApp.pluraliza, 'function');
  assert.strictEqual(SLApp.pluraliza(0, 'línea', 'líneas'), '0 líneas');
  assert.strictEqual(SLApp.pluraliza(1, 'línea', 'líneas'), '1 línea');
  assert.strictEqual(SLApp.pluraliza(2, 'línea', 'líneas'), '2 líneas');
  assert.strictEqual(SLApp.pluraliza(1, 'albarán', 'albaranes'), '1 albarán');
  assert.strictEqual(SLApp.pluraliza(3, 'albarán', 'albaranes'), '3 albaranes');
  assert.strictEqual(SLApp.pluraliza(1, 'serie ignorada', 'series ignoradas'), '1 serie ignorada');
  assert.strictEqual(SLApp.pluraliza(2, 'serie ignorada', 'series ignoradas'), '2 series ignoradas');
  assert.strictEqual(SLApp.pluraliza(1, 'ya importado', 'ya importados'), '1 ya importado');
  assert.strictEqual(SLApp.pluraliza(1200, 'caja', 'cajas'), '1.200 cajas');

  assert.strictEqual(SLApp.fmtSigned(0), '0');
  assert.strictEqual(SLApp.fmtSigned(-0), '0');
  assert.strictEqual(SLApp.fmtSigned(15), '+15');
  assert.strictEqual(SLApp.fmtSigned(-15), '−15');
});

// --------------------------------------------------------------------------
// 10. CORRECCIÓN: Previsualización multiarchivo (compras + ventas vs ventas solas)
// --------------------------------------------------------------------------
runTest('10. Previsualización con compras y ventas juntas difiere stock en gris y muestra «hasta N cajas salen»', () => {
  const { SLApp } = cargarSLAppEnVm();
  const env = crearEntorno();
  configurarCatalogoBase(env.repo);
  const catalogoSvc = new CatalogoService({ repository: env.repo });
  const pendSvc = new PendientesService({ repository: env.repo, movementService: env.movService, catalogoService: catalogoSvc, lockService: env.lock });
  const impSvc = new ImportacionService({ repository: env.repo, movementService: env.movService, catalogoService: catalogoSvc, pendientesService: pendSvc, lockService: env.lock });

  const comprasTxt = fs.readFileSync(path.join(FIXTURES_DIR, 'compras_t007.csv'), 'utf8');
  const ventasTxt = fs.readFileSync(path.join(FIXTURES_DIR, 'ventas_t007.csv'), 'utf8');

  const prevCompras = impSvc.previsualizar(comprasTxt);
  const prevVentas = impSvc.previsualizar(ventasTxt);

  const itemCompras = { nombre: 'compras_t007.csv', texto: comprasTxt, codificacion: 'utf-8', preview: prevCompras, error: null };
  const itemVentas = { nombre: 'ventas_t007.csv', texto: ventasTxt, codificacion: 'utf-8', preview: prevVentas, error: null };

  // Caso A: ventas + compras juntas
  const resJuntos = SLApp.construirHtmlPrevisualizacionImportacion([itemVentas, itemCompras]);
  assert.strictEqual(resJuntos.hayAlgoConfirmable, true);
  assert.ok(resJuntos.html.includes('Se comprueba al aplicar las compras de esta importación'), 'Debe mostrar mensaje gris al haber compras en el lote');
  assert.ok(!resJuntos.html.includes('sin stock</b>'), 'No debe mostrar bloque rojo «X sin stock» cuando hay compras en el lote');
  assert.ok(!resJuntos.html.includes('class="sl-imp-details danger"'), 'No debe pintar bloque danger en rojo para ventas diferidas');
  assert.ok(resJuntos.html.includes('hasta 18') && resJuntos.html.includes('cajas salen'), 'Debe mostrar «hasta 18 cajas salen»');
  assert.ok(!resJuntos.html.includes('−0') && !resJuntos.html.includes('+0'), 'Nunca debe mostrar −0 ni +0');
  assert.ok(resJuntos.html.includes('1 serie ignorada'), 'Debe usar singular «1 serie ignorada»');
  assert.ok(resJuntos.html.includes('1 línea de artículo sin decidir'), 'Debe usar singular «1 línea de artículo sin decidir»');

  // Caso B: ventas solas (sin archivo de compras)
  const resSoloVentas = SLApp.construirHtmlPrevisualizacionImportacion([itemVentas]);
  assert.ok(resSoloVentas.html.includes('2 sin stock</b>'), 'Sin compras en el lote debe mostrar «2 sin stock»');
  assert.ok(resSoloVentas.html.includes('class="sl-imp-details danger"'), 'Sin compras en el lote debe marcar el bloque como danger');
  assert.ok(!resSoloVentas.html.includes('Se comprueba al aplicar las compras de esta importación'));
  assert.ok(!resSoloVentas.html.includes('−0') && !resSoloVentas.html.includes('+0'), 'Nunca debe mostrar −0 ni +0');
});

// --------------------------------------------------------------------------
// 11. CORRECCIÓN: Estado vacío de Existencias
// --------------------------------------------------------------------------
runTest('11. Estado vacío de Existencias menciona el conteo con nombres de Hispatec y no «desde el Excel»', () => {
  const existenciasHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'existencias.html'), 'utf8');
  assert.ok(
    existenciasHtml.includes('Carga el stock inicial (conteo con los nombres de Hispatec) y después importa'),
    'Debe mostrar el texto corregido en el estado vacío de Existencias'
  );
  assert.ok(!existenciasHtml.includes('desde el Excel'), 'No debe quedar referencia a «desde el Excel»');
});

console.log('\n================================================================');
console.log(` RESULTADOS T-028 (IMPORTAR/PENDIENTES): ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
