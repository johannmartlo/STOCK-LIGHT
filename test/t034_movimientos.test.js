/**
 * STOCK-LIGHT — Test Suite T-034: Movimientos, búsqueda ⌘K, parte y «Aplicar la versión nueva»
 *
 * Cubre los puntos de aceptación 1 y 3 de docs/tickets/T-034-movimientos-buscar-parte.md:
 * 1. Cliente:
 *    - sin vista previa no hay confirmación de anular ni de aplicar versión;
 *    - posible:false oculta el botón de confirmar y enseña el motivo en lenguaje llano;
 *    - motivo obligatorio;
 *    - con sin_movimientos_stock:true se ve «La versión nueva no mueve stock»;
 *    - CONSULTA no tiene Anular ni «Aplicar la versión nueva»;
 *    - «Copiar texto» copia exactamente parte.texto.
 * 3. node test/run_all.js sin fallos.
 *
 * Ejecutable: node test/t034_movimientos.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_DIR = path.resolve(__dirname, '../src');

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

function leerParcial(nombre) {
  return fs.readFileSync(path.join(SRC_DIR, 'ui', nombre), 'utf8');
}

function extraerScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match && match[1], 'El parcial debe contener un bloque <script>');
  return match[1];
}

function documentoMinimo(opciones) {
  const opts = opciones || {};
  const clases = new Set(opts.clasesBody || []);
  return {
    readyState: 'loading',
    body: {
      classList: {
        contains: (clase) => clases.has(clase),
        toggle: (clase, fuerza) => {
          if (fuerza) clases.add(clase);
          else clases.delete(clase);
        }
      }
    },
    documentElement: { scrollHeight: 0 },
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      style: {},
      setAttribute: () => {},
      appendChild: () => {},
      select: () => {},
      parentNode: null
    })
  };
}

function cargarParcial(nombre, opciones) {
  const opts = opciones || {};
  const html = leerParcial(nombre);
  const script = extraerScript(html);
  const sandbox = {
    window: opts.window || {},
    document: opts.document || documentoMinimo(opts),
    navigator: opts.navigator || {},
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return sandbox.window;
}

function cargarSLAppEnVm(elementosEscritura, elementosAdmin) {
  const appHtml = leerParcial('app.html');
  const script = extraerScript(appHtml);
  const clasesBody = new Set();
  const nodosEsc = Array.isArray(elementosEscritura) ? elementosEscritura : [];
  const nodosAdm = Array.isArray(elementosAdmin) ? elementosAdmin : [];
  const sandbox = {
    window: { innerWidth: 1440, addEventListener: () => {}, removeEventListener: () => {}, scrollY: 0 },
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
  vm.runInContext(script, sandbox);
  return { SLApp: sandbox.window.SLApp, clasesBody };
}

console.log('================================================================');
console.log(' TEST SUITE T-034 — MOVIMIENTOS, BUSCAR, PARTE Y VERSIONES');
console.log('================================================================\n');

// --------------------------------------------------------------------------
// 1. Sin vista previa no hay confirmación de anular ni de aplicar versión
// --------------------------------------------------------------------------
runTest('1. Sin vista previa no aparece botón de confirmar anulación ni de aplicar versión', () => {
  const mov = cargarParcial('movimientos.html').SLMov;
  const pend = cargarParcial('pendientes.html').SLPendientes;

  const anulacionHtml = mov.renderPreviewAnulacion(null);
  assert.ok(!anulacionHtml.includes('data-confirmar-anulacion="1"'), 'Sin vista previa no debe haber confirmación de anular');
  assert.ok(/vista previa/i.test(anulacionHtml), 'Debe explicar que primero se calcula la vista previa');
  assert.strictEqual(mov.puedeConfirmarAnulacion(null, 'motivo válido'), false, 'Sin vista previa no se puede confirmar la anulación');

  const versionHtml = pend.renderPreviewVersion(null);
  assert.ok(!versionHtml.includes('data-confirmar-version="1"'), 'Sin vista previa no debe haber confirmación de versión');
  assert.ok(/vista previa/i.test(versionHtml), 'Debe explicar que primero se calcula la vista previa');
  assert.strictEqual(pend.puedeConfirmarVersion(null, 'motivo válido'), false, 'Sin vista previa no se puede aplicar la versión');
});

// --------------------------------------------------------------------------
// 2. posible:false oculta confirmar y enseña el motivo en lenguaje llano
// --------------------------------------------------------------------------
runTest('2. posible:false oculta el botón de confirmar y enseña el motivo en lenguaje llano', () => {
  const mov = cargarParcial('movimientos.html').SLMov;
  const pend = cargarParcial('pendientes.html').SLPendientes;

  const ajuste = mov.renderPreviewAnulacion({ posible: false, motivo: 'AJUSTE_CON_CONSUMOS' });
  assert.ok(!ajuste.includes('data-confirmar-anulacion="1"'), 'Un ajuste con consumos no debe ofrecer confirmar');
  assert.ok(/consumos posteriores/.test(ajuste), 'Debe traducir AJUSTE_CON_CONSUMOS a lenguaje llano');

  const pendiente = pend.renderPreviewVersion({ posible: false, motivo: 'PENDIENTE_NO_PENDIENTE' });
  assert.ok(!pendiente.includes('data-confirmar-version="1"'), 'Un pendiente resuelto no debe ofrecer confirmar');
  assert.ok(/ya está resuelto/.test(pendiente), 'Debe traducir PENDIENTE_NO_PENDIENTE a lenguaje llano');

  const stock = pend.renderPreviewVersion({ posible: false, motivo: 'STOCK_INSUFICIENTE' });
  assert.ok(/stock suficiente/.test(stock), 'Debe traducir STOCK_INSUFICIENTE a lenguaje llano');

  const desconocido = pend.renderPreviewVersion({ posible: false, motivo: 'CODIGO_RARO' });
  assert.ok(desconocido.includes('CODIGO_RARO'), 'Con un código desconocido debe mostrarse el código');
});

// --------------------------------------------------------------------------
// 3. Motivo obligatorio
// --------------------------------------------------------------------------
runTest('3. El motivo es obligatorio para anular y para aplicar una versión', () => {
  const mov = cargarParcial('movimientos.html').SLMov;
  const pend = cargarParcial('pendientes.html').SLPendientes;
  const preview = {
    posible: true,
    partidas_vuelven: [],
    partidas_bajan: [],
    partidas_desaparecen: [],
    efecto_variedades: []
  };

  assert.strictEqual(mov.validarMotivo(''), false);
  assert.strictEqual(mov.validarMotivo('   '), false);
  assert.strictEqual(mov.validarMotivo('ok'), false);
  assert.strictEqual(mov.validarMotivo('motivo válido'), true);
  assert.strictEqual(mov.puedeConfirmarAnulacion(preview, ''), false);
  assert.strictEqual(mov.puedeConfirmarAnulacion(preview, 'motivo válido'), true);
  assert.strictEqual(mov.puedeConfirmarAnulacion({ posible: false }, 'motivo válido'), false);

  assert.strictEqual(pend.validarMotivo(''), false);
  assert.strictEqual(pend.validarMotivo('motivo válido'), true);
  assert.strictEqual(pend.puedeConfirmarVersion(preview, ''), false);
  assert.strictEqual(pend.puedeConfirmarVersion(preview, 'motivo válido'), true);

  const html = mov.renderPreviewAnulacion(preview, { tipo: 'salida' });
  assert.ok(html.includes('data-confirmar-anulacion="1"'));
  assert.ok(html.includes('disabled'), 'El botón debe empezar deshabilitado hasta escribir el motivo');
});

// --------------------------------------------------------------------------
// 4. sin_movimientos_stock:true se ve el aviso gris
// --------------------------------------------------------------------------
runTest('4. Con sin_movimientos_stock:true se ve «La versión nueva no mueve stock» junto a lo que se deshace', () => {
  const pend = cargarParcial('pendientes.html').SLPendientes;
  const html = pend.renderPreviewVersion({
    posible: true,
    sin_movimientos_stock: true,
    lineas_cambian: [
      {
        linea: 1,
        antes: { articulo: 'TOMATE ROSA', envase: 'CAJA', cajas: 10 },
        despues: { articulo: 'TOMATE ROSA', envase: 'CAJA', cajas: 10 },
        cambios: ['entidad']
      }
    ],
    operaciones_rehechas: [],
    partidas_cambian: [],
    ventas_a_pendientes: [],
    efecto_variedades: []
  });
  assert.ok(html.includes('La versión nueva no mueve stock'), 'Debe mostrarse el aviso exacto');
  assert.ok(html.indexOf('La versión nueva no mueve stock') < html.indexOf('Líneas: antes'), 'El aviso debe ir arriba, junto a lo que se deshace');
  assert.ok(html.includes('data-version-motivo="1"'), 'Aun sin mover stock se puede aplicar la versión con motivo');
  const htmlParcial = leerParcial('pendientes.html');
  assert.ok(htmlParcial.includes('data-confirmar-version="1"'), 'El modal debe tener botón de aplicar la versión');
});

// --------------------------------------------------------------------------
// 5. CONSULTA no tiene Anular ni «Aplicar la versión nueva»
// --------------------------------------------------------------------------
runTest('5. CONSULTA no tiene Anular ni «Aplicar la versión nueva»', () => {
  const mov = cargarParcial('movimientos.html').SLMov;
  const tx = {
    id: 'DOC-S-1',
    tipo: 'salida',
    texto: 'Salida · TOMATE ROSA · CAJA · MERCADO',
    detalle: 'AVT27/700',
    cajas: -30,
    variedad: 'ROSA',
    variedades: ['ROSA'],
    documento: 'AVT27/700',
    usuario: 'Ana',
    fecha_hora: '2026-11-26T08:00:00.000Z',
    anulable: true,
    anulado: false,
    anulado_por: '',
    anula_id: ''
  };
  const preview = { posible: true, partidas_vuelven: [], partidas_bajan: [], partidas_desaparecen: [], efecto_variedades: [] };

  const htmlConsulta = mov.renderDetalleHtml(tx, { esConsulta: true, preview });
  assert.ok(!htmlConsulta.includes('data-confirmar-anulacion="1"'), 'CONSULTA no debe ver confirmar anulación');
  assert.ok(!htmlConsulta.includes('Anular la salida'), 'CONSULTA no debe ver el botón de anular');

  const txAnulable = Object.assign({}, tx, { anulado: false, anulado_por: '' });
  const htmlEncargado = mov.renderDetalleHtml(txAnulable, { esConsulta: false, preview });
  assert.ok(htmlEncargado.includes('data-confirmar-anulacion="1"'), 'ENCARGADO sí debe ver confirmar anulación');

  const appHtml = leerParcial('app.html');
  assert.ok(/data-aplicar-version="[^"]*"[^>]*data-solo-escritura="1"/.test(appHtml), 'El botón de aplicar versión debe llevar data-solo-escritura');

  const escEstado = [{ hidden: false }];
  const admEstado = [{ hidden: false }];
  const mkMock = arr => arr.map(o => ({
    setAttribute: k => { if (k === 'hidden') o.hidden = true; },
    removeAttribute: k => { if (k === 'hidden') o.hidden = false; }
  }));
  const { SLApp, clasesBody } = cargarSLAppEnVm(mkMock(escEstado), mkMock(admEstado));
  SLApp.aplicarRol('CONSULTA');
  assert.strictEqual(clasesBody.has('sl-rol-consulta'), true);
  assert.strictEqual(escEstado[0].hidden, true, 'Los botones de escritura deben ocultarse a CONSULTA');

  const pendConsulta = cargarParcial('pendientes.html', { clasesBody: ['sl-rol-consulta'] }).SLPendientes;
  pendConsulta._estado.idPendiente = '';
  pendConsulta.abrirVersion('PEND-1');
  assert.strictEqual(pendConsulta._estado.idPendiente, '', 'CONSULTA no debe abrir el flujo de aplicar versión');
});

// --------------------------------------------------------------------------
// 6. «Copiar texto» copia exactamente parte.texto
// --------------------------------------------------------------------------
runTest('6. «Copiar texto» copia exactamente parte.texto, sin recortes ni formato añadido', () => {
  const copiado = [];
  const sandbox = cargarParcial('parte.html', {
    navigator: {
      clipboard: {
        writeText: (texto) => {
          copiado.push(texto);
          return Promise.resolve();
        }
      }
    }
  });
  const parte = {
    fecha: '26/11',
    hora: '20:05',
    texto: 'STOCK · 26/11 · 20:05\nTotal: 1.234 cajas\n\nROSA · 234\nROSA GRANEL · 200 · CAJA · 34\n\nImportado hasta: C 26/11 · V 26/11',
    datos: { total: 1234, variedades: [], pendientes: {}, importado_hasta: {} }
  };
  sandbox.SLParte.render(parte);
  assert.strictEqual(sandbox.SLParte.textoParaCopiar(parte), parte.texto, 'Debe devolver el texto exacto del parte');
  sandbox.SLParte.copiarTexto(parte);
  assert.strictEqual(copiado.length, 1, 'Debe llamar una vez al portapapeles');
  assert.strictEqual(copiado[0], parte.texto, 'Debe copiar exactamente parte.texto');
});

// --------------------------------------------------------------------------
// 7. Ventas a pendientes: todas las líneas del albarán, resaltadas
// --------------------------------------------------------------------------
runTest('7. La vista previa de versión lista todas las líneas de las ventas que pasarán a pendientes', () => {
  const pend = cargarParcial('pendientes.html').SLPendientes;
  const html = pend.renderPreviewVersion({
    posible: true,
    sin_movimientos_stock: false,
    lineas_cambian: [],
    operaciones_rehechas: [],
    partidas_cambian: [],
    ventas_a_pendientes: [
      { id_documento: 'DOC-S-3', serie: 'AVT27', numero: '300', linea: 1, articulo: 'TOMATE A', envase: 'CAJA', cajas: 2, motivo: 'STOCK_INSUFICIENTE' },
      { id_documento: 'DOC-S-3', serie: 'AVT27', numero: '300', linea: 2, articulo: 'TOMATE B', envase: 'CAJA', cajas: 2, motivo: 'STOCK_INSUFICIENTE' },
      { id_documento: 'DOC-S-3', serie: 'AVT27', numero: '300', linea: 3, articulo: 'TOMATE C', envase: 'CAJA', cajas: 2, motivo: 'STOCK_INSUFICIENTE' }
    ],
    efecto_variedades: []
  });
  assert.ok(html.includes('Ventas que pasarán a pendientes'), 'Debe haber un bloque de ventas a pendientes');
  assert.ok(html.includes('AVT27/300'), 'Debe identificar el albarán');
  ['TOMATE A', 'TOMATE B', 'TOMATE C'].forEach((articulo) => {
    assert.ok(html.includes(articulo), `Debe listar la línea ${articulo}`);
  });
  assert.ok(/sl-ver-bloque peligro/.test(html), 'El bloque de ventas debe ir resaltado');
});

// --------------------------------------------------------------------------
// 8. Movimientos: día, total y anulados enlazados
// --------------------------------------------------------------------------
runTest('8. Movimientos agrupa por día, calcula el total y enlaza lo anulado con su anulación', () => {
  const mov = cargarParcial('movimientos.html').SLMov;
  assert.strictEqual(mov.formatearDia('2026-11-26', '2026-11-26'), 'HOY · JUEVES 26/11');
  assert.strictEqual(mov.formatearDia('2026-11-25', '2026-11-26'), 'MIÉRCOLES 25/11');
  assert.strictEqual(mov.formatearHora('2026-11-26T08:40:00.000Z'), '08:40');

  const elementos = [
    { tipo: 'entrada', cajas: 30, anulado: false },
    { tipo: 'salida', cajas: -12, anulado: false },
    { tipo: 'entrada', cajas: 20, anulado: true },
    { tipo: 'anulacion', cajas: 0, anulado: false }
  ];
  assert.strictEqual(mov.totalDia(elementos), 18, 'El total del día no debe sumar movimientos anulados ni anulaciones');

  const tx = {
    id: 'DOC-S-1', tipo: 'salida', texto: 'Salida', detalle: '', cajas: -10,
    variedad: 'ROSA', variedades: ['ROSA'], documento: 'AVT27/1', usuario: 'Ana',
    fecha_hora: '2026-11-26T08:00:00.000Z', anulable: false, anulado: true,
    anulado_por: 'MOV-ANUL-1', anula_id: ''
  };
  const html = mov.renderDetalleHtml(tx, { esConsulta: true });
  assert.ok(html.includes('data-abrir-anulacion="MOV-ANUL-1"'), 'Lo anulado debe enlazar con su anulación');
  assert.ok(html.includes('anulado'), 'Debe indicar que está anulado');
});

// --------------------------------------------------------------------------
// 9. Búsqueda: grupos y resultados
// --------------------------------------------------------------------------
runTest('9. La búsqueda agrupa variedades, partidas, albaranes y cambios, y normaliza acentos', () => {
  const buscar = cargarParcial('buscar.html').SLBuscar;
  const vista = buscar.construirGrupos({
    variedades: [{ id: 'ROS', grupo: 'Rosa', cajas: 100 }],
    partidas: [{ id: 'CAPA-1', articulo: 'TOMATE ROSA', envase: 'CAJA', proveedor: 'FINCA', fecha: '2026-11-20', cajas: 40 }],
    albaranes: [{ id: 'DOC-1', serie: 'AVT27', numero: '700', entidad: 'MERCADO', fecha: '2026-11-26' }],
    cambios: [{ id: 'REP-1', texto: '10 ROSA → 12 ROSA 500', fecha: '2026-11-25' }],
    total: 4
  });
  assert.strictEqual(vista.items.length, 4);
  assert.strictEqual(vista.grupos.map(g => g.clave).join(','), 'variedades,partidas,albaranes,cambios');
  assert.strictEqual(buscar.normalizar('ROSA'), 'rosa');

  const html = buscar.renderResultadosHtml(vista, 'rosa', 0);
  assert.ok(html.includes('Variedades') && html.includes('Partidas') && html.includes('Albaranes') && html.includes('Cambios'));
  assert.ok(html.includes('sl-buscar-activo'), 'El primer resultado debe quedar activo para Intro');
  assert.ok(html.includes('AVT27/700'));
});

// --------------------------------------------------------------------------
// 10. Cableado: parciales incluidos, navegación y atajo ⌘K
// --------------------------------------------------------------------------
runTest('10. Index incluye los parciales y la navegación/atajo ⌘K están cableados', () => {
  const index = fs.readFileSync(path.join(SRC_DIR, 'Index.html'), 'utf8');
  const app = leerParcial('app.html');
  ['ui/movimientos', 'ui/buscar', 'ui/parte'].forEach((parcial) => {
    assert.ok(index.includes(`include_('${parcial}')`), `Falta include_('${parcial}')`);
    const html = leerParcial(`${parcial.replace('ui/', '')}.html`);
    assert.ok(html.includes('<style>') && html.includes('<script>'), `${parcial} debe llevar su propio CSS y JS`);
  });
  assert.ok(index.includes('id="navMovimientos"'), 'Debe existir la entrada Movimientos en la barra lateral');
  assert.ok(index.includes('id="navParte"'), 'Debe existir la entrada Parte en la barra lateral');
  assert.ok(index.includes('id="btnBuscarGlobalMob"'), 'Debe existir la lupa móvil');
  assert.ok(index.includes('id="btnParteMob"'), 'Debe existir el acceso móvil al parte');
  assert.ok(app.includes("tecla === 'k'") && app.includes('abrirBuscar'), 'Debe existir el atajo ⌘K / Ctrl+K');
  assert.ok(app.includes("txt.indexOf('Ver todos') === 0"), '«Ver todos» de Existencias debe abrir Movimientos');
});

console.log('\n================================================================');
console.log(` RESULTADOS T-034: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
