/**
 * STOCK-LIGHT — Test Suite T-024 (Interfaz): Base visual, parciales, tokens y contrato servidor
 *
 * Sustituye a test/fase7_frontend_ux_integration.test.js tras retirar las pantallas antiguas (T-024).
 * Comprueba:
 * 1. doGet(e) y montaje completo con include('ui/...').
 * 2. Tokens CSS en :root de src/ui/estilos.html.
 * 3. Regla @media (prefers-reduced-motion: reduce).
 * 4. Ausencia de librerías externas salvo Google Fonts.
 * 5. Presencia de los id de las pantallas nuevas (PIN, Existencias, Partida, panel, hoja, 4 estados).
 * 6. Invariante de servidor: InventoryEngine.js sin cambios y sin lógica FIFO en cliente.
 *
 * Ejecutable: node test/t024_interfaz.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const SRC_DIR = path.resolve(__dirname, '../src');

// Mock HtmlService para probar doGet e include() en Node
global.HtmlService = {
  XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
  createHtmlOutputFromFile: function (filename) {
    const filePath = path.join(SRC_DIR, `${filename}.html`);
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    return { getContent: () => content };
  },
  createTemplateFromFile: function (filename) {
    const filePath = path.join(SRC_DIR, `${filename}.html`);
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    return {
      k: '',
      tienePin: false,
      evaluate: function () {
        return {
          content,
          title: '',
          metaTags: [],
          xFrameMode: '',
          setTitle: function (t) { this.title = t; return this; },
          addMetaTag: function (name, val) { this.metaTags.push({ name, content: val }); return this; },
          setXFrameOptionsMode: function (mode) { this.xFrameMode = mode; return this; },
          getContent: function () { return this.content; }
        };
      }
    };
  }
};

const codigo = require('../src/Código');

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

const indexHtml = fs.readFileSync(path.join(SRC_DIR, 'Index.html'), 'utf8');
const estilosHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'estilos.html'), 'utf8');
const existenciasHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'existencias.html'), 'utf8');
const partidaHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'partida.html'), 'utf8');
const appHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'app.html'), 'utf8');
const htmlCombinado = [indexHtml, estilosHtml, existenciasHtml, partidaHtml, appHtml].join('\n');

console.log('================================================================');
console.log(' TEST SUITE T-024 — INTERFAZ, TOKENS, INCLUDE Y ESTADOS');
console.log('================================================================\n');

runTest('1. doGet(e) devuelve HtmlOutput válido con viewport y xFrameMode DEFAULT', () => {
  const output = codigo.doGet({});
  assert.ok(output, 'doGet debe devolver output');
  assert.ok(output.title.includes('STOCK-LIGHT'));
  const vp = output.metaTags.find(m => m.name === 'viewport');
  assert.ok(vp && vp.content.includes('width=device-width'));
  assert.strictEqual(output.xFrameMode, 'DEFAULT');
});

runTest('2. Index.html incluye todos los parciales ui/ con include_() y codigo.include_ los resuelve', () => {
  const includesEsperados = ['ui/estilos', 'ui/existencias', 'ui/partida', 'ui/app'];
  for (const inc of includesEsperados) {
    assert.ok(indexHtml.includes(`include_('${inc}')`), `Falta include_('${inc}') en Index.html`);
    const contenido = codigo.include_(inc);
    assert.ok(contenido && contenido.length > 50, `include_('${inc}') devolvió vacío`);
  }
  assert.throws(() => codigo.include_('../Secret'), /inválido/);
});

runTest('3. src/ui/estilos.html define todos los tokens CSS cerrados en :root', () => {
  assert.ok(estilosHtml.includes(':root {'), 'Debe definir :root');
  const colores = [
    '#0A0A0B', '#121214', '#18181B', '#1F1F23', '#27272A',
    '#EDEDEF', '#8A8F98', '#80858E',
    '#4ADE80', '#FBBF24', '#F87171', '#8B8B94', '#F2553D'
  ];
  for (const hex of colores) {
    assert.ok(estilosHtml.toUpperCase().includes(hex.toUpperCase()), `Falta token de color ${hex}`);
  }
});

runTest('4. src/ui/estilos.html respeta prefers-reduced-motion', () => {
  assert.ok(
    /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/.test(estilosHtml),
    'Debe existir regla prefers-reduced-motion: reduce'
  );
});

runTest('5. No hay librerías ni recursos externos salvo Google Fonts (y enlace de acción wa.me)', () => {
  const urlsExternas = htmlCombinado.match(/https?:\/\/[^\s"'<>]+/g) || [];
  assert.ok(urlsExternas.length > 0, 'Debe cargar Google Fonts');
  for (const url of urlsExternas) {
    assert.ok(
      url.startsWith('https://fonts.googleapis.com') ||
      url.startsWith('https://fonts.gstatic.com') ||
      url.startsWith('https://wa.me/'),
      `Recurso externo no permitido: ${url}`
    );
  }
  assert.ok(!/<script[^>]+src=/i.test(htmlCombinado), 'Prohibidos scripts externos');
});

runTest('6. Existen todos los id de las pantallas nuevas (PIN, Existencias, panel, hoja, Partida y 4 estados)', () => {
  const idsRequeridos = [
    'pantallaEntrada',
    'entradaTeclado',
    'viewExistencias',
    'estadoCargando',
    'estadoVacio',
    'estadoSinConexion',
    'estadoError',
    'contenidoExistencias',
    'panelVariedad',
    'hojaVariedad',
    'viewPartida'
  ];
  for (const id of idsRequeridos) {
    assert.ok(htmlCombinado.includes(`id="${id}"`), `Falta id="${id}"`);
  }
});

runTest('7. El cliente no calcula stock ni FIFO y InventoryEngine.js permanece intacto', () => {
  assert.ok(!htmlCombinado.includes('rebuildStockFromMovements'), 'El cliente no reconstruye stock');
  assert.ok(!htmlCombinado.includes('processMovement('), 'El cliente no procesa movimientos');
  const diff = execSync('git diff -- src/InventoryEngine.js', { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.strictEqual(diff.trim(), '', 'InventoryEngine.js debe permanecer intacto');
});

function cargarSLAppEnVm(elementosMock) {
  const match = appHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match && match[1], 'src/ui/app.html debe contener un bloque <script>');
  const clasesBody = new Set();
  const nodos = Array.isArray(elementosMock) ? elementosMock : [];
  const sandbox = {
    window: {
      innerWidth: 1440,
      addEventListener: () => {}
    },
    document: {
      readyState: 'loading',
      body: {
        classList: {
          toggle: (cls, force) => {
            if (force) clasesBody.add(cls);
            else clasesBody.delete(cls);
          },
          contains: (cls) => clasesBody.has(cls)
        }
      },
      addEventListener: () => {},
      getElementById: () => null,
      querySelectorAll: (sel) => (sel === '[data-solo-escritura="1"]' ? nodos : [])
    },
    navigator: { onLine: true },
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox);
  return { SLApp: sandbox.window.SLApp, clasesBody };
}

runTest('8. nombreLegible formatea correctamente 6 ejemplos de productos, calibres, categorías y medidas', () => {
  const { SLApp } = cargarSLAppEnVm();
  const casos = [
    ['TOMATE VOLLEY II M · MADERA 50X30', 'Volley II M · Madera 50x30'],
    ['TOMATE MORESCO I GG · CARTÓN 40X30', 'Moresco I GG · Cartón 40x30'],
    ['TOMATE ROSA GRANEL MMM · EPS 106 9X500', 'Rosa Granel MMM · EPS 106 9x500'],
    ['TOMATE RAMA EXTRA G · POOL 60X40', 'Rama Extra G · POOL 60x40'],
    ['TOMATE COCKTAIL II MM · IFCO 8X300', 'Cocktail II MM · IFCO 8x300'],
    ['TOMATE PERA I GGG → TOMATE ROSA 500G', 'Pera I GGG → Rosa 500g']
  ];
  for (const [entrada, esperado] of casos) {
    assert.strictEqual(SLApp.nombreLegible(entrada), esperado, `Falló para '${entrada}'`);
  }
});

runTest('9. fmtDias y calcularDeltaSemanal formatean días y delta en cajas (verde si sube, gris si baja)', () => {
  const { SLApp } = cargarSLAppEnVm();
  assert.strictEqual(SLApp.fmtDias(0), 'hoy');
  assert.strictEqual(SLApp.fmtDias(1), '1 día');
  assert.strictEqual(SLApp.fmtDias(4), '4 días');

  const serieSube = [
    { stock: 1000 }, { stock: 1100 }, { stock: 1200 }, { stock: 1500 },
    { stock: 1800 }, { stock: 2200 }, { stock: 2800 }, { stock: 3169 }
  ];
  const dSube = SLApp.calcularDeltaSemanal(serieSube);
  assert.strictEqual(dSube.texto, '+2.169 cajas esta semana');
  assert.strictEqual(dSube.color, 'var(--sl-green)');

  const serieBaja = [
    { stock: 2000 }, { stock: 1900 }, { stock: 1800 }, { stock: 1700 },
    { stock: 1600 }, { stock: 1500 }, { stock: 1400 }, { stock: 1250 }
  ];
  const dBaja = SLApp.calcularDeltaSemanal(serieBaja);
  assert.strictEqual(dBaja.texto, '−750 cajas esta semana');
  assert.strictEqual(dBaja.color, 'var(--sl-text-secondary)');
  assert.ok(!dSube.texto.includes('%') && !dBaja.texto.includes('%'), 'El delta no debe ir en %');
});

runTest('10. Texto de WhatsApp formatea miles con punto, ordena desglose por cajas y buscador móvil filtra sin acentos', () => {
  const { SLApp } = cargarSLAppEnVm();
  const variedad = {
    grupo: 'Moresco',
    cajas: 1337,
    sale_primero: '2026-11-10',
    partidas: [
      { articulo: 'TOMATE MORESCO GG', envase: 'CARTÓN 40X30', cajas: 310 },
      { articulo: 'TOMATE MORESCO G', envase: 'MADERA', cajas: 220 },
      { articulo: 'TOMATE MORESCO M', envase: 'CARTÓN 40X30', cajas: 410 },
      { articulo: 'TOMATE MORESCO G', envase: 'MADERA', cajas: 300 },
      { articulo: 'TOMATE MORESCO I', envase: 'EPS 40X30', cajas: 97 }
    ]
  };
  const texto = SLApp.construirTextoWhatsApp(variedad, '2026-11-26');
  const lineas = texto.split('\n');
  assert.strictEqual(lineas[0], 'Moresco · 26/11 · 1.337 cajas');
  assert.strictEqual(lineas[1], 'G Madera 520 · M Cartón 40x30 410 · GG Cartón 40x30 310 · I EPS 40x30 97');
  assert.strictEqual(lineas[2], 'Sale primero: 10/11');

  assert.ok(existenciasHtml.includes('id="inputBuscarMob"'), 'Debe existir el buscador móvil arriba de Variedades');
  const filtradas = SLApp.filtrarVariedades(
    [
      { grupo: 'Moresco', partidas: [{ articulo: 'TOMATE MORESCO I G', envase: 'CARTÓN 40X30', proveedor: 'SOLANA' }] },
      { grupo: 'Rama', partidas: [{ articulo: 'TOMATE RAMA EXTRA', envase: 'MADERA 50X30', proveedor: 'NORTE' }] }
    ],
    { filtroModo: 'todas', busqueda: 'mór' }
  );
  assert.strictEqual(filtradas.length, 1);
  assert.strictEqual(filtradas[0].grupo, 'Moresco');
});

runTest('11. Usuario CONSULTA no ve botones de acción (Cambiar, Importar, Destrío ni en barra lateral)', () => {
  // Verificar que los botones de acción en HTML llevan data-solo-escritura="1"
  const botonesHtml = htmlCombinado.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) || [];
  const etiquetasProhibidasConsulta = ['Cambiar', 'Cambios', 'Importar', 'Importar CSV', 'Destrío', 'Cargar stock inicial'];

  for (const btn of botonesHtml) {
    const textoLimpio = btn.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const esAccionEscritura = etiquetasProhibidasConsulta.some(etq =>
      textoLimpio === etq || textoLimpio === `⇄ ${etq}` || textoLimpio.startsWith(`${etq} `)
    );
    if (esAccionEscritura) {
      assert.ok(
        btn.includes('data-solo-escritura="1"'),
        `El botón de acción '${textoLimpio}' debe tener data-solo-escritura="1" para ocultarse a CONSULTA`
      );
    }
  }

  // Verificar que la regla CSS oculta [data-solo-escritura="1"] cuando body tiene sl-rol-consulta
  assert.ok(
    estilosHtml.includes('body.sl-rol-consulta [data-solo-escritura="1"]'),
    'estilos.html debe ocultar [data-solo-escritura="1"] para CONSULTA'
  );

  // Verificar comportamiento de aplicarRol('CONSULTA') vs aplicarRol('ENCARGADO')
  const attrs = [{ hidden: false }, { hidden: false }];
  const mocks = attrs.map(a => ({
    setAttribute: (k) => { if (k === 'hidden') a.hidden = true; },
    removeAttribute: (k) => { if (k === 'hidden') a.hidden = false; }
  }));
  const { SLApp, clasesBody } = cargarSLAppEnVm(mocks);

  SLApp.aplicarRol('CONSULTA');
  assert.strictEqual(clasesBody.has('sl-rol-consulta'), true);
  assert.ok(attrs.every(a => a.hidden === true), 'Todos los botones de escritura deben quedar ocultos para CONSULTA');

  SLApp.aplicarRol('ENCARGADO');
  assert.strictEqual(clasesBody.has('sl-rol-consulta'), false);
  assert.ok(attrs.every(a => a.hidden === false), 'Los botones de escritura deben mostrarse para ENCARGADO');
});

console.log('\n================================================================');
console.log(` RESULTADOS T-024 (INTERFAZ): ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
