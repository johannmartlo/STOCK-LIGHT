/**
 * STOCK-LIGHT — Test Suite T-044: recepciones agrupadas por almacén
 *
 * Cubre los puntos de aceptación de docs/tickets/T-044-recepciones-agrupado.md:
 * - el informe agrupado se detecta como RECEPCIONES;
 * - da las mismas líneas que el mismo contenido con columna Almacen;
 * - el proveedor es correcto con varios grupos NombreProveedor seguidos;
 * - el almacén de la línea manda sobre el último grupo;
 * - las filas de grupo y las vacías no generan líneas;
 * - un fichero sin Almacen ni filas de grupo sigue fallando con el mensaje actual.
 *
 * Datos 100 % ficticios (D-015). Ejecutable: node test/t044_recepciones_agrupado.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  detectarTipo,
  parsear
} = require('../src/importacion/CsvHispatecParser');
const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'csv');
const GRUPO_TEXTO = fs.readFileSync(path.join(FIXTURE_DIR, 'recepciones_agrupado_almacen.csv'), 'utf8');
const COLUMNA_TEXTO = fs.readFileSync(path.join(FIXTURE_DIR, 'recepciones_agrupado_almacen_columna.csv'), 'utf8');
const RECEPCIONES_FORMATO_REAL = fs.readFileSync(path.join(FIXTURE_DIR, 'recepciones_formato_real.csv'), 'utf8');

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

const CAMPOS_COMPARADOS = ['articulo', 'envase', 'cajas', 'partida', 'entidad', 'fecha', 'almacen'];

/**
 * Reduce una línea a los campos que fija la aceptación de T-044.
 * @param {Object} linea
 * @returns {Object}
 */
function camposLinea(linea) {
  const salida = {};
  for (const campo of CAMPOS_COMPARADOS) salida[campo] = linea[campo];
  return salida;
}

function lineasComparables(texto) {
  return parsear(texto).lineas.map(camposLinea);
}

function crearCatalogo(repo) {
  repo.replaceTable('ATRIBUTOS', [{ nombre: 'SEGUIMIENTO', descripcion: 'Seguimiento', activo: true }]);
  repo.replaceTable('REGLAS_CLASIFICACION', [{
    id: 'R-TOMATE',
    atributo: 'SEGUIMIENTO',
    valor: 'SI',
    prioridad: 30,
    articulo_contiene: 'TOMATE',
    activo: true
  }]);
  return new CatalogoService({ repository: repo });
}

function crearImportador(env, catalogo) {
  return new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogo,
    fuenteEntradas: 'RECEPCIONES'
  });
}

function importar(importador, texto, usuario = 'operador@test') {
  const preview = importador.previsualizar(texto);
  const confirmada = importador.confirmar(texto, preview.hash, usuario);
  assert.strictEqual(confirmada.success, true, confirmada.error || 'La importación debe confirmarse');
  return { preview, confirmada };
}

function capasComparables(env) {
  return env.repo.getCapasFifo()
    .map(capa => ({
      partida: capa.partida,
      articulo: capa.codigo_articulo,
      envase: capa.codigo_envase,
      cajas: Number(capa.cajas_iniciales),
      proveedor: capa.proveedor,
      fecha: capa.fecha_capa
    }))
    .sort((a, b) => String(a.partida).localeCompare(String(b.partida)));
}

function stockTotal(env) {
  return env.repo.getStockActual().reduce((total, fila) => total + Number(fila.cajas_actuales || 0), 0);
}

console.log('================================================================');
console.log(' TEST SUITE T-044 — RECEPCIONES AGRUPADAS POR ALMACEN');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// 1. Detección del informe agrupado
// ---------------------------------------------------------------------------
runTest('1. La cabecera sin Almacen y con fila de grupo se detecta como RECEPCIONES', () => {
  assert.ok(GRUPO_TEXTO.includes('\r\n'), 'El fixture agrupado debe usar CRLF');
  assert.ok(GRUPO_TEXTO.includes('Recepción'), 'El fixture agrupado debe ser UTF-8 con tilde');
  assert.ok(!/^FechaCreacion;;;Almacen;/m.test(GRUPO_TEXTO), 'La cabecera agrupada NO debe nombrar Almacen');
  assert.ok(/^; - ;Almacen: /m.test(GRUPO_TEXTO), 'Debe haber una fila de grupo Almacen:');

  assert.strictEqual(detectarTipo(GRUPO_TEXTO), 'RECEPCIONES');
  assert.strictEqual(detectarTipo(COLUMNA_TEXTO), 'RECEPCIONES');

  const grupo = parsear(GRUPO_TEXTO);
  const columna = parsear(COLUMNA_TEXTO);
  assert.strictEqual(grupo.tipo, 'RECEPCIONES');
  assert.strictEqual(columna.tipo, 'RECEPCIONES');
  assert.strictEqual(grupo.lineas.length, 4, 'Solo las 4 líneas de datos son líneas');
  assert.strictEqual(columna.lineas.length, 4);
  assert.deepStrictEqual(grupo.errores, []);
  assert.deepStrictEqual(columna.errores, []);
});

// ---------------------------------------------------------------------------
// 2. Mismas líneas que el informe con columna Almacen
// ---------------------------------------------------------------------------
runTest('2. El fixture agrupado da las mismas líneas que su equivalente con columna Almacen', () => {
  assert.deepStrictEqual(lineasComparables(GRUPO_TEXTO), lineasComparables(COLUMNA_TEXTO));

  const lineas = parsear(GRUPO_TEXTO).lineas;
  assert.deepStrictEqual(
    lineas.map(linea => linea.entidad),
    [
      'PROVEEDOR FICTICIO UNO SL',
      'PROVEEDOR FICTICIO UNO SL',
      'PROVEEDOR FICTICIO DOS SL',
      'PROVEEDOR FICTICIO TRES SL'
    ],
    'Cada línea debe llevar el último grupo NombreProveedor'
  );
  assert.deepStrictEqual(
    lineas.map(linea => linea.almacen),
    [
      'ALMACEN FICTICIO UNO',
      'ALMACEN FICTICIO DOS',
      'ALMACEN FICTICIO UNO',
      'ALMACEN FICTICIO DOS'
    ],
    'La columna de la línea manda sobre el último grupo Almacen'
  );
  assert.deepStrictEqual(
    lineas.map(linea => linea.cajas),
    [10, 5, 7, 3]
  );
  assert.deepStrictEqual(
    lineas.map(linea => linea.partida),
    ['900101', '900102', '900103', '900104']
  );
});

// ---------------------------------------------------------------------------
// 3. Filas de grupo y vacías
// ---------------------------------------------------------------------------
runTest('3. Las filas vacías y las de grupo no generan líneas', () => {
  const lineas = parsear(GRUPO_TEXTO).lineas;
  assert.strictEqual(lineas.length, 4);
  for (const linea of lineas) {
    assert.ok(linea.fecha, 'Toda línea debe tener fecha');
    assert.ok(linea.numero, 'Toda línea debe venir de una recepción');
    assert.ok(linea.articulo, 'Toda línea debe tener artículo');
    assert.ok(linea.envase, 'Toda línea debe tener envase');
    assert.ok(linea.entidad, 'Toda línea debe tener proveedor');
    assert.ok(linea.almacen, 'Toda línea debe tener almacén');
  }
  assert.ok(!lineas.some(linea => /Almacen:|NombreProveedor:|Empresa:/.test(String(linea.articulo || ''))));
  assert.deepStrictEqual(
    lineas.map(linea => linea.filaCsv),
    [5, 6, 8, 11],
    'Las filas de grupo y las vacías se saltan'
  );
});

// ---------------------------------------------------------------------------
// 4. Sin Almacen ni filas de grupo sigue fallando
// ---------------------------------------------------------------------------
runTest('4. Sin columna Almacen ni filas de grupo se mantiene el error actual', () => {
  const sinGrupoAlmacen = GRUPO_TEXTO
    .split('\r\n')
    .filter(linea => !/^; - ;Almacen: /m.test(linea))
    .join('\r\n');

  assert.ok(!/Almacen:/.test(sinGrupoAlmacen), 'La prueba debe quitar todas las filas Almacen:');
  const mensaje = 'Cabecera CSV de Hispatec incompleta: faltan columnas obligatorias de RECEPCIONES: Almacen.';
  assert.throws(() => detectarTipo(sinGrupoAlmacen), (err) => err instanceof Error && err.message === mensaje);
  assert.throws(() => parsear(sinGrupoAlmacen), (err) => err instanceof Error && err.message === mensaje);
});

// ---------------------------------------------------------------------------
// 5. El informe sin agrupar de siempre no cambia
// ---------------------------------------------------------------------------
runTest('5. El fixture de recepciones de siempre sigue dando 5 líneas y no se debilita', () => {
  const resultado = parsear(RECEPCIONES_FORMATO_REAL);
  assert.strictEqual(resultado.tipo, 'RECEPCIONES');
  assert.strictEqual(resultado.lineas.length, 5);
  assert.deepStrictEqual(
    resultado.lineas.map(linea => linea.entidad),
    [
      null,
      'PROVEEDOR FICTICIO ÑANDÚ SL',
      'PROVEEDOR FICTICIO ÑANDÚ SL',
      'PROVEEDOR FICTICIO DOS SL',
      'PROVEEDOR FICTICIO TRES SL'
    ]
  );
  assert.ok(resultado.lineas.every(linea => linea.almacen === 'ALMACEN UNO'));
  assert.deepStrictEqual(
    resultado.lineas.map(linea => linea.cajas),
    [3, 10, 5, 4, 2]
  );
});

// ---------------------------------------------------------------------------
// 6. De punta a punta: el agrupado se importa igual que el de columna
// ---------------------------------------------------------------------------
runTest('6. Importación de punta a punta: agrupado y columna dejan las mismas capas', () => {
  const envGrupo = crearEntorno();
  const catalogoGrupo = crearCatalogo(envGrupo.repo);
  const importadorGrupo = crearImportador(envGrupo, catalogoGrupo);
  const { preview } = importar(importadorGrupo, GRUPO_TEXTO);
  assert.strictEqual(preview.tipoCsv, 'RECEPCIONES');
  assert.strictEqual(preview.resumen.porEstado.OK, 4);
  assert.strictEqual(preview.documentos.length, 4);
  assert.strictEqual(stockTotal(envGrupo), 25);
  assert.strictEqual(envGrupo.movService.comprobarConsistencia().consistente, true);

  const envColumna = crearEntorno();
  const catalogoColumna = crearCatalogo(envColumna.repo);
  const importadorColumna = crearImportador(envColumna, catalogoColumna);
  importar(importadorColumna, COLUMNA_TEXTO);
  assert.strictEqual(stockTotal(envColumna), 25);
  assert.strictEqual(envColumna.movService.comprobarConsistencia().consistente, true);

  assert.deepStrictEqual(capasComparables(envGrupo), capasComparables(envColumna));
  assert.strictEqual(envColumna.repo.getMovimientos().length, 4);
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-044: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
