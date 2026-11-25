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

runTest('2. Index.html incluye todos los parciales ui/ con include() y codigo.include los resuelve', () => {
  const includesEsperados = ['ui/estilos', 'ui/existencias', 'ui/partida', 'ui/app'];
  for (const inc of includesEsperados) {
    assert.ok(indexHtml.includes(`include('${inc}')`), `Falta include('${inc}') en Index.html`);
    const contenido = codigo.include(inc);
    assert.ok(contenido && contenido.length > 50, `include('${inc}') devolvió vacío`);
  }
  assert.throws(() => codigo.include('../Secret'), /inválido/);
});

runTest('3. src/ui/estilos.html define todos los tokens CSS cerrados en :root', () => {
  assert.ok(estilosHtml.includes(':root {'), 'Debe definir :root');
  const colores = [
    '#0A0A0B', '#121214', '#18181B', '#1F1F23', '#27272A',
    '#EDEDEF', '#8A8F98', '#5C6068',
    '#4ADE80', '#FBBF24', '#F87171', '#71717A', '#F2553D'
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

runTest('5. No hay librerías ni recursos externos salvo Google Fonts', () => {
  const urlsExternas = htmlCombinado.match(/https?:\/\/[^\s"'<>]+/g) || [];
  assert.ok(urlsExternas.length > 0, 'Debe cargar Google Fonts');
  for (const url of urlsExternas) {
    assert.ok(
      url.startsWith('https://fonts.googleapis.com') || url.startsWith('https://fonts.gstatic.com'),
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

console.log('\n================================================================');
console.log(` RESULTADOS T-024 (INTERFAZ): ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
