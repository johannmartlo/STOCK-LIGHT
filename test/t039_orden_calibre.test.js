/**
 * STOCK-LIGHT — Test Suite T-039: Orden por calibre y subtotales por categoría en Existencias
 *
 * Cubre los puntos de aceptación de docs/tickets/T-039-orden-calibre.md:
 * 1. Orden de la ficha: AMARILLO I G · ROJO EXTRA GG · ROJO I GGG · ROJO I GG · ROJO I G · ROJO II S/C,
 *    con tres bloques de ROJO y subtotales 5 / 80 / 300.
 * 2. Mismo artículo + envase: fecha ascendente y, a igualdad, id_capa.
 * 3. sale_primero y dias = partida más antigua aunque no sea la primera del orden nuevo.
 * 4. Artículos sin calibre ni categoría y con peso: no rompen y van detrás de los calibres.
 * 5. compararArticulos es un orden total: 200 artículos barajados de 30 formas dan el mismo orden.
 * 6. Compatibilidad del cliente: sin `desglose` ordena por cajas; con `desglose` respeta su orden,
 *    y los subtotales solo se pintan cuando hay más de un bloque.
 *
 * Ejecutable: node test/t039_orden_calibre.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { crearEntorno } = require('./helpers/mockSheets');
const { conContextoDePrueba_ } = require('../src/Seguridad');
const {
  claveOrdenArticulo,
  compararArticulos,
  construirDesgloseOrdenado
} = require('../src/OrdenExistencias');
const codigo = require('../src/Código');

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

// --------------------------------------------------------------------------
// Utilidades de datos ficticios (misma forma que los reales)
// --------------------------------------------------------------------------

/** Configura una agrupación comercial única «Tomate Ficticio» para todas las variedades ficticias. */
function configurarGrupoFicticio(repo) {
  repo.saveAtributos([
    { nombre: 'FAMILIA', descripcion: 'Familia', activo: true }
  ]);
  repo.saveReglasClasificacion([
    {
      id: 'R-FICTICIO',
      atributo: 'FAMILIA',
      valor: 'FICTICIO',
      prioridad: 1,
      articulo_contiene: 'FICTICIO',
      activo: true
    }
  ]);
  repo.saveAgrupaciones([
    {
      agrupacion: 'COMERCIAL',
      orden: 1,
      grupo: 'Tomate Ficticio',
      subgrupo: '',
      filtro: 'FAMILIA=FICTICIO',
      activo: true,
      color: '#4FA37C',
      dias_aviso: 4,
      stock_bajo: ''
    }
  ]);
}

/** Crea una capa FIFO ficticia completa para la prueba. */
function capaFicticia(idCapa, articulo, envase, cajas, fecha) {
  return {
    id_capa: idCapa,
    id_movimiento_entrada: `MOV-${idCapa}`,
    fecha_capa: fecha,
    codigo_articulo: articulo,
    codigo_envase: envase,
    cajas_iniciales: cajas,
    cajas_consumidas: 0,
    cajas_restantes: cajas,
    estado_capa: 'ACTIVA',
    partida: `P-${idCapa}`,
    documento_ref: `DOC-${idCapa}`,
    proveedor: 'PROVEEDOR FICTICIO',
    id_capa_origen: '',
    origen_dato: 'CSV'
  };
}

/** Monta un entorno con capas y devuelve el payload de inicio (una sola variedad). */
function inicioConCapas(capas) {
  const env = crearEntorno();
  configurarGrupoFicticio(env.repo);
  env.repo.saveCapasFifo(capas);
  return conContextoDePrueba_('Ana', 'CONSULTA', () =>
    codigo.apiObtenerInicio({ repository: env.repo, hoy: '2026-11-20' })
  );
}

/** Carga src/ui/app.html en un contexto vm y devuelve window.SLApp. */
function cargarSLApp() {
  const appHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'app.html'), 'utf8');
  const match = appHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match && match[1], 'src/ui/app.html debe contener un bloque <script>');
  const sandbox = {
    window: { innerWidth: 1440, addEventListener: () => {}, removeEventListener: () => {} },
    document: {
      readyState: 'loading',
      body: { classList: { toggle: () => {}, contains: () => false } },
      addEventListener: () => {},
      getElementById: () => null,
      querySelectorAll: () => []
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
  return sandbox.window.SLApp;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function barajar(lista, rand) {
  const copia = lista.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = copia[i];
    copia[i] = copia[j];
    copia[j] = tmp;
  }
  return copia;
}

console.log('================================================================');
console.log(' TEST SUITE T-039 — ORDEN POR CALIBRE Y SUBTOTALES');
console.log('================================================================\n');

// --------------------------------------------------------------------------
// 1. ORDEN DE LA FICHA Y SUBTOTALES
// --------------------------------------------------------------------------
runTest('1. Orden por variedad/categoría/calibre con tres bloques de ROJO (5 / 80 / 300)', () => {
  const envase = 'CARTON 40X30';
  const capas = [
    capaFicticia('CAPA-1', 'TOMATE FICTICIO ROJO II S/C', envase, 300, '2026-11-15'),
    capaFicticia('CAPA-2', 'TOMATE FICTICIO ROJO I G', envase, 10, '2026-11-15'),
    capaFicticia('CAPA-3', 'TOMATE FICTICIO ROJO I GGG', envase, 50, '2026-11-15'),
    capaFicticia('CAPA-4', 'TOMATE FICTICIO ROJO I GG', envase, 20, '2026-11-15'),
    capaFicticia('CAPA-5', 'TOMATE FICTICIO ROJO EXTRA GG', envase, 5, '2026-11-15'),
    capaFicticia('CAPA-6', 'TOMATE FICTICIO AMARILLO I G', envase, 1, '2026-11-15')
  ];
  const inicio = inicioConCapas(capas);

  assert.strictEqual(inicio.variedades.length, 1, 'Las seis capas deben caer en una sola variedad');
  const v = inicio.variedades[0];
  assert.strictEqual(v.grupo, 'Tomate Ficticio');
  assert.strictEqual(v.cajas, 386);

  // Clave de orden de cada artículo
  const esperadas = {
    'TOMATE FICTICIO AMARILLO I G': { base: 'TOMATE FICTICIO AMARILLO', cat: 1, corta: 'Cat. I', cal: 3 },
    'TOMATE FICTICIO ROJO EXTRA GG': { base: 'TOMATE FICTICIO ROJO', cat: 0, corta: 'Extra', cal: 2 },
    'TOMATE FICTICIO ROJO I GGG': { base: 'TOMATE FICTICIO ROJO', cat: 1, corta: 'Cat. I', cal: 0 },
    'TOMATE FICTICIO ROJO I GG': { base: 'TOMATE FICTICIO ROJO', cat: 1, corta: 'Cat. I', cal: 2 },
    'TOMATE FICTICIO ROJO I G': { base: 'TOMATE FICTICIO ROJO', cat: 1, corta: 'Cat. I', cal: 3 },
    'TOMATE FICTICIO ROJO II S/C': { base: 'TOMATE FICTICIO ROJO', cat: 2, corta: 'Cat. II', cal: 8 }
  };
  for (const articulo of Object.keys(esperadas)) {
    const esperada = esperadas[articulo];
    const clave = claveOrdenArticulo(articulo);
    assert.strictEqual(clave.variedadBase, esperada.base, `variedadBase de ${articulo}`);
    assert.strictEqual(clave.rangoCategoria, esperada.cat, `rangoCategoria de ${articulo}`);
    assert.strictEqual(clave.categoriaCorta, esperada.corta, `categoriaCorta de ${articulo}`);
    assert.strictEqual(clave.rangoCalibre, esperada.cal, `rangoCalibre de ${articulo}`);
  }

  const ordenEsperado = [
    'TOMATE FICTICIO AMARILLO I G',
    'TOMATE FICTICIO ROJO EXTRA GG',
    'TOMATE FICTICIO ROJO I GGG',
    'TOMATE FICTICIO ROJO I GG',
    'TOMATE FICTICIO ROJO I G',
    'TOMATE FICTICIO ROJO II S/C'
  ];
  assert.deepStrictEqual(v.partidas.map((p) => p.articulo), ordenEsperado, 'Orden de las partidas');

  // Bloques y subtotales
  assert.strictEqual(v.desglose.length, 4, 'Un bloque por variedad base + categoría');
  const bloquesRojo = v.desglose.filter((bloque) => bloque.variedadBase === 'TOMATE FICTICIO ROJO');
  assert.deepStrictEqual(bloquesRojo.map((b) => b.categoriaCorta), ['Extra', 'Cat. I', 'Cat. II']);
  assert.strictEqual(bloquesRojo[0].cajas, 5);
  assert.strictEqual(bloquesRojo[1].cajas, 80);
  assert.strictEqual(bloquesRojo[2].cajas, 300);
  assert.deepStrictEqual(
    bloquesRojo[1].lineas.map((linea) => [linea.articulo, linea.cajas]),
    [
      ['TOMATE FICTICIO ROJO I GGG', 50],
      ['TOMATE FICTICIO ROJO I GG', 20],
      ['TOMATE FICTICIO ROJO I G', 10]
    ]
  );
  assert.deepStrictEqual(
    v.desglose.map((bloque) => bloque.cajas),
    [1, 5, 80, 300],
    'El orden de los bloques sigue compararArticulos'
  );

  const desgloseDirecto = construirDesgloseOrdenado(v.partidas);
  assert.deepStrictEqual(desgloseDirecto, v.desglose, 'construirDesgloseOrdenado coincide con la variedad');

  // Cliente: subtotales y orden del texto de WhatsApp
  const SLApp = cargarSLApp();
  const html = SLApp.construirDesgloseHtml(v);
  assert.ok(html.includes('sl-desglose-subtotal'), 'Con más de un bloque debe haber subtotales');
  assert.ok(html.includes('Amarillo · Cat. I</span>'), 'Subtotal de AMARILLO');
  assert.ok(html.includes('Rojo · Extra</span>'), 'Subtotal Extra');
  assert.ok(html.includes('Rojo · Cat. I</span>'), 'Subtotal Cat. I');
  assert.ok(html.includes('Rojo · Cat. II</span>'), 'Subtotal Cat. II');
  assert.ok(html.includes('sl-mono">300</span>'), 'Subtotal de 300 cajas');
  assert.ok(
    html.indexOf('Rojo · Cat. I</span>') < html.indexOf('Rojo I GGG · Carton 40x30'),
    'El subtotal va antes de las líneas de su bloque'
  );

  const texto = SLApp.construirTextoWhatsApp(v, '2026-11-20');
  const posAmarillo = texto.indexOf('Amarillo I G');
  const posExtra = texto.indexOf('Rojo Extra GG');
  const posGgg = texto.indexOf('Rojo I GGG');
  const posG = texto.indexOf('Rojo I G ');
  const posSc = texto.indexOf('Rojo II S/c');
  assert.ok(posAmarillo >= 0 && posExtra > posAmarillo && posGgg > posExtra && posG > posGgg && posSc > posG,
    'El texto de WhatsApp sigue el orden del desglose');
  assert.ok(!texto.includes('Cat. I'), 'El texto de WhatsApp no lleva subtotales');
});

// --------------------------------------------------------------------------
// 2. DESEMPATE POR FECHA E ID_CAPA
// --------------------------------------------------------------------------
runTest('2. Mismo artículo y envase: la partida más antigua primero y, a igual fecha, por id_capa', () => {
  const articulo = 'TOMATE FICTICIO ROJO I G';
  const envase = 'CARTON 40X30';
  const capas = [
    capaFicticia('CAPA-1', articulo, envase, 20, '2026-11-10'),
    capaFicticia('CAPA-2', articulo, envase, 10, '2026-11-05'),
    capaFicticia('CAPA-3', articulo, envase, 40, '2026-11-10'),
    capaFicticia('CAPA-4', articulo, envase, 30, '2026-11-10')
  ];
  const inicio = inicioConCapas(capas);
  const v = inicio.variedades[0];

  assert.deepStrictEqual(
    v.partidas.map((p) => p.id_capa),
    ['CAPA-2', 'CAPA-1', 'CAPA-3', 'CAPA-4'],
    'Fecha ascendente y, a igualdad, id_capa ascendente'
  );
  assert.strictEqual(v.desglose.length, 1, 'Un solo artículo + envase: un bloque y una línea');
  assert.deepStrictEqual(v.desglose[0].lineas, [{ articulo, envase, cajas: 100 }]);
  assert.strictEqual(v.sale_primero, '2026-11-05');
});

// --------------------------------------------------------------------------
// 3. SALE_PRIMERO = FECHA MÍNIMA, NO PARTIDAS[0]
// --------------------------------------------------------------------------
runTest('3. sale_primero y dias son los de la partida más antigua aunque no abra el orden nuevo', () => {
  const envase = 'CARTON 40X30';
  const capas = [
    capaFicticia('CAPA-1', 'TOMATE FICTICIO ZETA I G', envase, 10, '2026-11-08'),
    capaFicticia('CAPA-2', 'TOMATE FICTICIO ALFA I G', envase, 10, '2026-11-18')
  ];
  const inicio = inicioConCapas(capas);
  const v = inicio.variedades[0];

  assert.strictEqual(v.partidas[0].articulo, 'TOMATE FICTICIO ALFA I G', 'El orden nuevo no empieza por la más antigua');
  assert.strictEqual(v.partidas[0].fecha, '2026-11-18');
  assert.strictEqual(v.sale_primero, '2026-11-08', 'sale_primero es el mínimo de la variedad');
  assert.strictEqual(v.dias, 12, 'dias se calcula con la partida más antigua');
  assert.strictEqual(v.desglose.length, 2, 'Cada variedad base tiene su bloque');
  assert.deepStrictEqual(v.desglose.map((bloque) => bloque.cajas), [10, 10]);
  assert.strictEqual(v.desglose[0].variedadBase, 'TOMATE FICTICIO ALFA');
  assert.strictEqual(v.desglose[1].variedadBase, 'TOMATE FICTICIO ZETA');
});

// --------------------------------------------------------------------------
// 4. SIN CALIBRE NI CATEGORÍA, Y CON PESO
// --------------------------------------------------------------------------
runTest('4. Artículos sin calibre/categoría y con peso: no rompen y van detrás de los calibres', () => {
  const envase = 'CARTON 40X30';
  const capas = [
    capaFicticia('CAPA-1', 'TOMATE FICTICIO AZUL I GG', envase, 4, '2026-11-15'),
    capaFicticia('CAPA-2', 'TOMATE FICTICIO AZUL 500G', envase, 3, '2026-11-15'),
    capaFicticia('CAPA-3', 'TOMATE FICTICIO AZUL', envase, 2, '2026-11-15'),
    capaFicticia('CAPA-4', 'TOMATE FICTICIO AZUL UND', envase, 1, '2026-11-15'),
    capaFicticia('CAPA-5', 'TOMATE FICTICIO BLANCO I G', envase, 5, '2026-11-15')
  ];
  const inicio = inicioConCapas(capas);
  const v = inicio.variedades[0];

  assert.deepStrictEqual(
    v.partidas.map((p) => p.articulo),
    [
      'TOMATE FICTICIO AZUL I GG',
      'TOMATE FICTICIO AZUL 500G',
      'TOMATE FICTICIO AZUL',
      'TOMATE FICTICIO AZUL UND',
      'TOMATE FICTICIO BLANCO I G'
    ]
  );
  assert.deepStrictEqual(
    v.desglose.map((bloque) => [bloque.variedadBase, bloque.categoriaCorta, bloque.cajas]),
    [
      ['TOMATE FICTICIO AZUL', 'Cat. I', 4],
      ['TOMATE FICTICIO AZUL', '', 6],
      ['TOMATE FICTICIO BLANCO', 'Cat. I', 5]
    ]
  );
  assert.strictEqual(claveOrdenArticulo('TOMATE FICTICIO AZUL 500G').rangoCalibre, 7);
  assert.strictEqual(claveOrdenArticulo('TOMATE FICTICIO AZUL').rangoCalibre, 8);
  assert.strictEqual(claveOrdenArticulo('TOMATE FICTICIO AZUL UND').rangoCalibre, 9);
  assert.strictEqual(v.cajas, 15);
});

// --------------------------------------------------------------------------
// 5. ORDEN TOTAL (200 ARTÍCULOS, 30 BARAJADOS)
// --------------------------------------------------------------------------
runTest('5. compararArticulos es un orden total: 200 artículos barajados de 30 formas dan el mismo orden', () => {
  const bases = ['TOMATE FICTICIO ROJO', 'TOMATE FICTICIO VERDE', 'TOMATE FICTICIO AMARILLO', 'TOMATE FICTICIO NEGRO', 'TOMATE FICTICIO BLANCO'];
  const categorias = ['', ' I', ' II', ' EXTRA'];
  const calibres = [' GGG', ' GG', ' G', ' M', ' MM', ' MMM', ' S/C', ' 500G', ' 1KG', ' UND'];
  const envases = ['CARTON 40X30', 'MADERA 50X30', 'EPS 106', 'IFCO 8X300'];

  const articulos = [];
  const vistos = new Set();
  for (const base of bases) {
    for (const categoria of categorias) {
      for (const calibre of calibres) {
        for (const envase of envases) {
          const articulo = base + categoria + calibre;
          const clave = articulo + '|' + envase;
          if (vistos.has(clave)) continue;
          vistos.add(clave);
          articulos.push({ articulo, envase });
          if (articulos.length === 200) break;
        }
        if (articulos.length === 200) break;
      }
      if (articulos.length === 200) break;
    }
    if (articulos.length === 200) break;
  }
  assert.strictEqual(articulos.length, 200);

  const referencia = articulos.slice().sort(compararArticulos).map((p) => p.articulo + '|' + p.envase);
  assert.strictEqual(new Set(referencia).size, 200, 'No debe haber empates entre pares distintos');

  for (let semilla = 1; semilla <= 30; semilla++) {
    const barajada = barajar(articulos, rng(semilla * 7919));
    const orden = barajada.slice().sort(compararArticulos).map((p) => p.articulo + '|' + p.envase);
    assert.deepStrictEqual(orden, referencia, `La semilla ${semilla} dio otro orden`);
  }

  for (let i = 1; i < referencia.length; i++) {
    const a = articulos.find((p) => p.articulo + '|' + p.envase === referencia[i - 1]);
    const b = articulos.find((p) => p.articulo + '|' + p.envase === referencia[i]);
    assert.ok(compararArticulos(a, b) < 0, `El orden debe ser estricto en ${referencia[i - 1]} / ${referencia[i]}`);
    assert.ok(compararArticulos(b, a) > 0, 'El comparador debe ser antisimétrico');
  }
});

// --------------------------------------------------------------------------
// 6. CLIENTE: COMPATIBILIDAD Y ORDEN DEL DESGLOSE
// --------------------------------------------------------------------------
runTest('6. El cliente respeta `desglose` si existe y mantiene el orden por cajas si falta', () => {
  const SLApp = cargarSLApp();

  // Sin desglose: comportamiento anterior (más cajas primero).
  const sinDesglose = {
    grupo: 'Moresco',
    cajas: 940,
    partidas: [
      { articulo: 'TOMATE MORESCO GG', envase: 'CARTON 40X30', cajas: 310 },
      { articulo: 'TOMATE MORESCO G', envase: 'CARTON 40X30', cajas: 220 },
      { articulo: 'TOMATE MORESCO M', envase: 'CARTON 40X30', cajas: 410 }
    ]
  };
  assert.deepStrictEqual(
    Array.from(SLApp.calcularDesgloseArticulos(sinDesglose), (linea) => linea.articulo),
    ['TOMATE MORESCO M', 'TOMATE MORESCO GG', 'TOMATE MORESCO G']
  );
  assert.ok(
    !SLApp.construirDesgloseHtml(sinDesglose).includes('sl-desglose-subtotal'),
    'Sin desglose no se pintan subtotales'
  );

  // Con desglose: se respeta el orden aunque no coincida con el de cajas.
  const puente = {
    grupo: 'Tomate Ficticio',
    cajas: 310,
    desglose: [
      {
        variedadBase: 'TOMATE FICTICIO ROJO',
        categoriaCorta: 'Cat. I',
        cajas: 10,
        lineas: [{ articulo: 'TOMATE FICTICIO ROJO I G', envase: 'CARTON 40X30', cajas: 10 }]
      },
      {
        variedadBase: 'TOMATE FICTICIO ROJO',
        categoriaCorta: 'Cat. II',
        cajas: 300,
        lineas: [{ articulo: 'TOMATE FICTICIO ROJO II S/C', envase: 'CARTON 40X30', cajas: 300 }]
      }
    ],
    partidas: [
      { articulo: 'TOMATE FICTICIO ROJO II S/C', envase: 'CARTON 40X30', cajas: 300 },
      { articulo: 'TOMATE FICTICIO ROJO I G', envase: 'CARTON 40X30', cajas: 10 }
    ]
  };
  assert.deepStrictEqual(
    Array.from(SLApp.calcularDesgloseArticulos(puente), (linea) => linea.articulo),
    ['TOMATE FICTICIO ROJO I G', 'TOMATE FICTICIO ROJO II S/C'],
    'Con desglose se respeta su orden'
  );

  const html = SLApp.construirDesgloseHtml(puente);
  assert.ok(html.includes('Rojo · Cat. I</span>'), 'Subtotal del primer bloque');
  assert.ok(html.includes('Rojo · Cat. II</span>'), 'Subtotal del segundo bloque');
  assert.ok(html.indexOf('Rojo · Cat. I</span>') < html.indexOf('Rojo I G · Carton 40x30'), 'Subtotal antes de la línea');

  // Un solo bloque: sin subtotal (no añade ruido).
  const unBloque = {
    grupo: 'Tomate Ficticio',
    cajas: 10,
    desglose: [{
      variedadBase: 'TOMATE FICTICIO ROJO',
      categoriaCorta: 'Cat. I',
      cajas: 10,
      lineas: [{ articulo: 'TOMATE FICTICIO ROJO I G', envase: 'CARTON 40X30', cajas: 10 }]
    }]
  };
  const htmlUnBloque = SLApp.construirDesgloseHtml(unBloque);
  assert.ok(!htmlUnBloque.includes('sl-desglose-subtotal'), 'Con un solo bloque no hay subtotal');
  assert.ok(htmlUnBloque.includes('Rojo I G · Carton 40x30'));
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-039: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
