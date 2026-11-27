/**
 * STOCK-LIGHT — Test Suite T-041: Pulido de lectura (nombres, gráfico honesto, movimientos, contraste, tamaños y carga oscura)
 *
 * Cubre todos los puntos de aceptación de docs/tickets/T-041-pulido-lectura.md (datos ficticios).
 * Ejecutable: node test/t041_pulido.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { crearEntorno } = require('./helpers/mockSheets');
const { nombreLegible } = require('../src/NombresLegibles');
const { InicioService } = require('../src/InicioService');
const { OperacionesService } = require('../src/OperacionesService');

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

function cargarScriptHtml(relPath, propWindow) {
  const html = fs.readFileSync(path.join(SRC_DIR, relPath), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match && match[1], `${relPath} debe contener un bloque <script>`);
  const sandbox = {
    window: {
      innerWidth: 1440,
      addEventListener: () => {}
    },
    document: {
      readyState: 'loading',
      body: { classList: { toggle: () => {}, contains: () => false } },
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    navigator: { onLine: true },
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox);
  return sandbox.window[propWindow];
}

function configurarCatalogoMinimo(repo) {
  repo.saveAtributos([
    { nombre: 'SEGUIMIENTO', descripcion: 'Seguimiento', activo: true },
    { nombre: 'FAMILIA', descripcion: 'Familia', activo: true }
  ]);
  repo.saveReglasClasificacion([
    { id: 'R-SEG', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 1, articulo_contiene: 'TOMATE', activo: true },
    { id: 'R-ROSA', atributo: 'FAMILIA', valor: 'ROSA', prioridad: 10, articulo_contiene: 'ROSA', activo: true }
  ]);
  repo.saveAgrupaciones([
    { agrupacion: 'COMERCIAL', orden: 1, grupo: 'Rosa', subgrupo: '', filtro: 'FAMILIA=ROSA', activo: true, color: '#EC4899', dias_aviso: 4, stock_bajo: '' }
  ]);
}

console.log('================================================================');
console.log(' TEST SUITE T-041 — PULIDO DE LECTURA');
console.log('================================================================\n');

// --------------------------------------------------------------------------
// 1. NOMBRES LEGIBLES EN LAS TRES COPIAS (SERVIDOR, app.html, parte.html)
// --------------------------------------------------------------------------
runTest('1. Nombres legibles: servidor, app.html y parte.html dan exactamente el mismo resultado', () => {
  const SLApp = cargarScriptHtml('ui/app.html', 'SLApp');
  const SLParte = cargarScriptHtml('ui/parte.html', 'SLParte');
  assert.strictEqual(typeof SLApp.nombreLegible, 'function', 'SLApp debe exponer nombreLegible');
  assert.strictEqual(typeof SLParte.nombreLegible, 'function', 'SLParte debe exponer nombreLegible');

  const casos = [
    ['TOMATE HUEVO DE TORO ROJO I GG', 'Huevo de Toro Rojo I GG'],
    ['MADERA 40X30X11 TOMATES DE AUTOR', 'Madera 40x30x11 Tomates de Autor'],
    ['CARTON 40X30X11 VOLLEY HD Q5', 'Cartón 40x30x11 Volley HD Q5'],
    ['NATURFRESH SAT', 'Naturfresh SAT'],
    ['CARTON 40X30X14 GENERICA', 'Cartón 40x30x14 Genérica'],
    ['DE LA HUERTA', 'De la Huerta']
  ];

  for (const [entrada, esperado] of casos) {
    const resSrv = nombreLegible(entrada);
    const resApp = SLApp.nombreLegible(entrada);
    const resParte = SLParte.nombreLegible(entrada);
    assert.strictEqual(resSrv, esperado, `Servidor falló para '${entrada}': '${resSrv}'`);
    assert.strictEqual(resApp, esperado, `app.html falló para '${entrada}': '${resApp}'`);
    assert.strictEqual(resParte, esperado, `parte.html falló para '${entrada}': '${resParte}'`);
  }
});

// --------------------------------------------------------------------------
// 2. SOLO STOCK INICIAL EN DÍA D -> entradas=0, null antes de D, delta=0 cajas
// --------------------------------------------------------------------------
runTest('2. Solo stock inicial el día D: entradas=0 todos los días, null antes de D, fecha_inicio_datos=D y delta 0 cajas', () => {
  const env = crearEntorno();
  configurarCatalogoMinimo(env.repo);
  const SLApp = cargarScriptHtml('ui/app.html', 'SLApp');

  const diaD = '2026-11-26';
  const hoy = '2026-11-27';

  env.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE ROSA I G',
    codigo_envase: 'CARTON 40X30',
    cajas: 500,
    motivo: 'STOCK_INICIAL',
    origen_dato: 'STOCK_INICIAL',
    fecha: diaD
  }, 'admin@ejemplo.test');

  const inicioSvc = new InicioService({ repository: env.repo, reloj: () => hoy });
  const inicio = inicioSvc.obtenerInicio({ hoy });

  assert.strictEqual(inicio.fecha_inicio_datos, diaD, 'fecha_inicio_datos debe ser D');
  assert.strictEqual(inicio.serie.length, 30);

  for (const punto of inicio.serie) {
    assert.strictEqual(punto.entradas, 0, `entradas debe ser 0 el día ${punto.fecha}`);
    if (punto.fecha < diaD) {
      assert.strictEqual(punto.stock, null, `stock debe ser null antes de D (${punto.fecha})`);
    } else {
      assert.strictEqual(punto.stock, 500, `stock debe ser 500 desde D (${punto.fecha})`);
    }
  }

  const delta = SLApp.calcularDeltaSemanal(inicio.serie, inicio.fecha_inicio_datos);
  assert.ok(delta.texto.startsWith('0 cajas'), `Delta esperado «0 cajas…», obtenido: '${delta.texto}'`);
  assert.strictEqual(delta.texto, '0 cajas desde el 26/11');
});

// --------------------------------------------------------------------------
// 3. STOCK INICIAL EN D + ENTRADA DE 10 CAJAS EN D+1 -> entradas=10 y delta +10
// --------------------------------------------------------------------------
runTest('3. Stock inicial en D + entrada de 10 cajas en D+1: entradas de D+1 = 10 y variación +10', () => {
  const env = crearEntorno();
  configurarCatalogoMinimo(env.repo);
  const SLApp = cargarScriptHtml('ui/app.html', 'SLApp');

  const diaD = '2026-11-26';
  const diaD1 = '2026-11-27';

  env.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE ROSA I G',
    codigo_envase: 'CARTON 40X30',
    cajas: 500,
    motivo: 'STOCK_INICIAL',
    origen_dato: 'STOCK_INICIAL',
    fecha: diaD
  }, 'admin@ejemplo.test');

  env.movService.registrarEntrada({
    id_documento: 'DOC-T041-1',
    tipo_documento: 'COMPRA',
    serie: 'ACT27',
    numero: '101',
    fecha_documento: diaD1,
    entidad_nombre: 'FINCA PRUEBA',
    origen_dato: 'CSV',
    firma_lineas: 'F-101'
  }, [{ codigo_articulo: 'TOMATE ROSA I G', codigo_envase: 'CARTON 40X30', cajas: 10, partida: 'P-101' }], 'Ana');

  const inicioSvc = new InicioService({ repository: env.repo, reloj: () => diaD1 });
  const inicio = inicioSvc.obtenerInicio({ hoy: diaD1 });

  const puntoD = inicio.serie.find(p => p.fecha === diaD);
  const puntoD1 = inicio.serie.find(p => p.fecha === diaD1);
  assert.strictEqual(puntoD.entradas, 0, 'El stock inicial no suma a entradas de D');
  assert.strictEqual(puntoD.stock, 500);
  assert.strictEqual(puntoD1.entradas, 10, 'La entrada real suma 10 a entradas de D+1');
  assert.strictEqual(puntoD1.stock, 510);

  const delta = SLApp.calcularDeltaSemanal(inicio.serie, inicio.fecha_inicio_datos);
  assert.strictEqual(delta.texto, '+10 cajas desde el 26/11');
  assert.strictEqual(delta.color, 'var(--sl-green)');
});

// --------------------------------------------------------------------------
// 4. MOVIMIENTOS: DETALLE SIN REPETIR STOCK_INICIAL, MOTIVOS Y AUTOR VISIBLE
// --------------------------------------------------------------------------
runTest('4. Movimientos: detalle sin STOCK_INICIAL, ERROR_CARGA -> Error de carga, autor correo -> único ADMIN o prefijo', () => {
  const env = crearEntorno();
  configurarCatalogoMinimo(env.repo);

  env.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE ROSA I G',
    codigo_envase: 'CARTON 40X30',
    cajas: 100,
    motivo: 'STOCK_INICIAL',
    origen_dato: 'STOCK_INICIAL',
    fecha: '2026-11-26'
  }, 'x@y.com');

  env.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE ROSA I G',
    codigo_envase: 'CARTON 40X30',
    cajas: 5,
    motivo: 'ERROR_CARGA',
    fecha: '2026-11-27'
  }, 'x@y.com');

  // Caso A: un único ADMIN activo ("Ana")
  env.repo.saveUsuarios([
    { id_usuario: 'U1', nombre: 'Ana', rol: 'ADMIN', activo: true, token_hash: 'h1' },
    { id_usuario: 'U2', nombre: 'Luis', rol: 'ENCARGADO', activo: true, token_hash: 'h2' }
  ]);

  const ops = new OperacionesService({ repository: env.repo, movementService: env.movService });
  const res1 = ops.listarMovimientos({ limite: 20 });
  const txs1 = res1.grupos.flatMap(g => g.elementos);

  const txStockIni = txs1.find(t => t.tipo === 'stock inicial');
  assert.ok(txStockIni, 'Debe existir transacción de stock inicial');
  assert.ok(!txStockIni.detalle.includes('STOCK_INICIAL'), `detalle no debe contener STOCK_INICIAL: '${txStockIni.detalle}'`);
  assert.strictEqual(txStockIni.usuario, 'Ana', 'Con un único ADMIN activo, correo se muestra como su nombre');

  const txError = txs1.find(t => t.tipo === 'ajuste');
  assert.ok(txError, 'Debe existir transacción de ajuste');
  assert.ok(txError.detalle.includes('Error de carga'), `detalle debe traducir ERROR_CARGA: '${txError.detalle}'`);
  assert.ok(!txError.detalle.includes('ERROR_CARGA'), 'detalle no debe mostrar código técnico ERROR_CARGA');
  assert.strictEqual(txError.usuario, 'Ana');

  // La búsqueda sigue incluyendo los valores originales
  const busqCorreo = ops.listarMovimientos({ texto: 'x@y.com' });
  assert.strictEqual(busqCorreo.total, 2, 'La búsqueda debe encontrar por correo original');
  const busqCodigo = ops.listarMovimientos({ texto: 'ERROR_CARGA' });
  assert.strictEqual(busqCodigo.total, 1, 'La búsqueda debe encontrar por código original ERROR_CARGA');

  // Caso B: dos ADMIN activos -> parte anterior a la @
  env.repo.saveUsuarios([
    { id_usuario: 'U1', nombre: 'Ana', rol: 'ADMIN', activo: true, token_hash: 'h1' },
    { id_usuario: 'U3', nombre: 'Pedro', rol: 'ADMIN', activo: true, token_hash: 'h3' }
  ]);
  const res2 = ops.listarMovimientos({ limite: 20 });
  const txs2 = res2.grupos.flatMap(g => g.elementos);
  for (const tx of txs2) {
    assert.strictEqual(tx.usuario, 'x', `Con dos ADMIN, x@y.com debe mostrarse como 'x', obtenido '${tx.usuario}'`);
  }
});

// --------------------------------------------------------------------------
// 5. CONTRASTE Y TAMAÑOS: TOKENS NUEVOS Y NINGÚN font-size < 12px
// --------------------------------------------------------------------------
runTest('5. estilos.html tiene tokens de contraste AA y ningún archivo UI/Index tiene font-size < 12px', () => {
  const estilos = fs.readFileSync(path.join(SRC_DIR, 'ui', 'estilos.html'), 'utf8');
  assert.ok(/--sl-text-label\s*:\s*#80858E\b/i.test(estilos), 'Falta --sl-text-label: #80858E');
  assert.ok(/--sl-out\s*:\s*#8B8B94\b/i.test(estilos), 'Falta --sl-out: #8B8B94');

  const uiFiles = fs.readdirSync(path.join(SRC_DIR, 'ui'))
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(SRC_DIR, 'ui', f));
  const todosHtml = [path.join(SRC_DIR, 'Index.html'), ...uiFiles];

  const violaciones = [];
  for (const archivo of todosHtml) {
    const contenido = fs.readFileSync(archivo, 'utf8');
    const lineas = contenido.split(/\r?\n/);
    lineas.forEach((linea, idx) => {
      const matches = linea.match(/font-size\s*:\s*([\d.]+)px|font\s*:[^;"']*?\b([\d.]+)px/gi) || [];
      for (const m of matches) {
        const numMatch = m.match(/([\d.]+)px/i);
        if (numMatch && parseFloat(numMatch[1]) < 12) {
          violaciones.push(`${path.basename(archivo)}:${idx + 1} (${m})`);
        }
      }
    });
  }
  assert.strictEqual(violaciones.length, 0, `Quedan tamaños menores de 12px: ${violaciones.join(', ')}`);
});

// --------------------------------------------------------------------------
// 6. CARGA OSCURA EN Index.html Y ESQUELETO
// --------------------------------------------------------------------------
runTest('6. Index.html tiene <style> de fondo antes de cualquier <link>, fuentes no bloqueantes y esqueleto de 6 filas', () => {
  const indexHtml = fs.readFileSync(path.join(SRC_DIR, 'Index.html'), 'utf8');
  const idxStyle = indexHtml.indexOf('<style>html,body{background:#0A0A0B;color:#EDEDEF}</style>');
  const idxLink = indexHtml.indexOf('<link');
  assert.ok(idxStyle >= 0, 'Index.html debe incluir el <style> de fondo oscuro');
  assert.ok(idxLink > idxStyle, 'El <style> de fondo debe aparecer ANTES de cualquier <link>');
  assert.ok(indexHtml.includes('https://fonts.gstatic.com') && indexHtml.includes('crossorigin'), 'Debe incluir preconnect a fonts.gstatic.com con crossorigin');
  assert.ok(indexHtml.includes('media="print"') && indexHtml.includes("onload=\"this.media='all'\""), 'La hoja de Geist debe cargarse de forma no bloqueante');
  assert.ok(indexHtml.includes('<noscript>'), 'Debe incluir fallback <noscript> para Geist');

  const existenciasHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'existencias.html'), 'utf8');
  const filasSk = (existenciasHtml.match(/data-sk-row=/g) || []).length;
  assert.strictEqual(filasSk, 6, 'El esqueleto de Existencias debe tener 6 filas');
});

console.log('\n================================================================');
console.log(` RESUMEN T-041: ${passed} SUPERADAS, ${failed} FALLIDAS`);
console.log('================================================================\n');

process.exit(failed > 0 ? 1 : 0);
