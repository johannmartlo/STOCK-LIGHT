/**
 * STOCK-LIGHT — Test Suite T-030: lector de CSV por nombre de columna
 *
 * Cubre los puntos de aceptación 1 a 6 de docs/tickets/T-030-lector-por-columnas.md.
 * Ejecutable: node test/t030_lector_por_columnas.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');
const { detectarTipo, parsear } = require('../src/importacion/CsvHispatecParser');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'csv');
const COMPRAS_REAL = fs.readFileSync(path.join(FIXTURE_DIR, 'compras_formato_real.csv'), 'utf8');
const VENTAS_REAL = fs.readFileSync(path.join(FIXTURE_DIR, 'ventas_formato_real.csv'), 'utf8');

const HEADER_COMPRAS_ANTIGUO = [
  'FechaAlbaran', 'NombreEmisor', 'NumeroAlbaran', 'SerieAlbaran', 'OrdenLinea',
  'NumeracionProveedor', 'ReferenciaAC', 'NombreArticulo', 'DescripcionArticulo',
  'UnidadesEnvase', 'CantidadLineaAlbaran', 'CantidadTotal', 'ReferenciaLineaAlbaran',
  'ObservacionesLineaAlbaran', 'CantidadPrecioPor', 'Factor', 'PorCada', 'PesoBrutoLACCA',
  'PesoNetoLACCA', 'NroPaletsAC', 'PaletAC', 'NombrePaletAC', 'CodigoEnvaseAC',
  'NombreEnvaseAC', 'CantidadEnvasesAC'
].join(';');

const HEADER_VENTAS_ANTIGUO = [
  'Fecha', 'RefAV', 'Numero', 'Albarán', 'NombreCliente', 'NombreArticulo', 'NroEnvases',
  'Cantidad', 'Piezas', 'PesoNetoEnviado', 'NombreEnvase', 'NroPalets', 'Palet'
].join(';');

const COMPRAS_ANTIGUO = [
  HEADER_COMPRAS_ANTIGUO,
  '02/11/2026;PROVEEDOR FICTICIO UNO;9001;ACT26;1;NUM-P-9001;REF-9001;TOMATE FICTICIO;Tomate ficticio;1;10,000;10,000;L1;Ficticio;1;1;1;52,000;50,000;1;PALET-FICTICIO;PALET FICTICIO;ENV-F;CAJA FICTICIA;10,000',
  '02/11/2026;PROVEEDOR FICTICIO UNO;9001;ACT26;2;NUM-P-9001;REF-9001;TOMATE FICTICIO DOS;Tomate ficticio dos;1;5,000;5,000;L2;Ficticio;1;1;1;26,000;25,000;1;PALET-FICTICIO;PALET FICTICIO;ENV-F;CAJA FICTICIA;5,000'
].join('\n') + '\n';

const VENTAS_ANTIGUO = [
  HEADER_VENTAS_ANTIGUO,
  '03/11/2026;REF-AV-9001;9001;AVT26/9001 (1);CLIENTE FICTICIO ÑANDÚ;TOMATE FICTICIO;3,000;3,000;3;15,000;CAJA FICTICIA;1;PALET-FICTICIO',
  '03/11/2026;REF-AV-9001;9001;AVT26/9001 (2);CLIENTE FICTICIO ÑANDÚ;TOMATE FICTICIO DOS;2,000;2,000;2;10,000;CAJA FICTICIA;1;PALET-FICTICIO'
].join('\n') + '\n';

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

function crearCatalogo(repo) {
  repo.replaceTable('ATRIBUTOS', [{ nombre: 'SEGUIMIENTO', descripcion: 'Seguimiento', activo: true }]);
  repo.replaceTable('REGLAS_CLASIFICACION', [{
    id: 'R-TOMATE',
    atributo: 'SEGUIMIENTO',
    valor: 'SI',
    prioridad: 1,
    articulo_contiene: 'TOMATE FICTICIO',
    activo: true
  }]);
  return new CatalogoService({ repository: repo });
}

function crearImportador(env, catalogo) {
  return new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogo
  });
}

function importar(importador, texto) {
  const preview = importador.previsualizar(texto);
  const confirmada = importador.confirmar(texto, preview.hash, 'operador@test');
  assert.strictEqual(confirmada.success, true, confirmada.error || 'La importación debe confirmarse');
  return { preview, confirmada };
}

function stockDe(env, articulo, envase) {
  const fila = env.repo.getStockActual().find(item => (
    item.codigo_articulo === articulo && item.codigo_envase === envase
  ));
  return fila ? Number(fila.cajas_actuales) : 0;
}

function documentosPorClave(repo) {
  const mapa = new Map();
  for (const doc of repo.getDocumentos()) {
    mapa.set(`${doc.tipo_documento}|${doc.serie}|${doc.numero}`, doc);
  }
  return mapa;
}

function reordenarColumnas(texto, orden) {
  const lineas = texto.split(/\r?\n/).filter(linea => linea !== '');
  const cabecera = lineas[0].split(';');
  const filas = lineas.slice(1).map(linea => linea.split(';'));
  const nuevaCabecera = orden.map(indice => cabecera[indice]);
  const nuevasFilas = filas.map(fila => orden.map(indice => (
    fila[indice] === undefined ? '' : fila[indice]
  )).join(';'));
  return [nuevaCabecera.join(';')].concat(nuevasFilas).join('\n') + '\n';
}

function quitarColumna(texto, nombreColumna) {
  const lineas = texto.split(/\r?\n/).filter(linea => linea !== '');
  const cabecera = lineas[0].split(';');
  const indice = cabecera.indexOf(nombreColumna);
  assert.ok(indice >= 0, `La columna ${nombreColumna} debe existir`);
  return lineas.map(linea => {
    const valores = linea.split(';');
    valores.splice(indice, 1);
    return valores.join(';');
  }).join('\n') + '\n';
}

function anadirColumna(texto, nombreColumna, valor) {
  return texto.split(/\r?\n/).filter(linea => linea !== '').map((linea, indice) => {
    if (indice === 0) return `${linea};${nombreColumna}`;
    if (/^;+$/.test(linea)) return `${linea};`;
    return `${linea};${valor}`;
  }).join('\n') + '\n';
}

console.log('\n================================================================');
console.log(' TEST SUITE T-030 — LECTOR DE CSV POR NOMBRE DE COLUMNA');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// Aceptación 1 y 2: fixtures reales, detección, previsualización y stock
// ---------------------------------------------------------------------------

runTest('1. Los CSV con cabeceras reales se detectan, previsualizan y confirman con el stock esperado', () => {
  assert.ok(COMPRAS_REAL.includes('\r\n'), 'Compras debe usar CRLF');
  assert.ok(VENTAS_REAL.includes('\r\n'), 'Ventas debe usar CRLF');
  assert.ok(VENTAS_REAL.includes('Albarán'), 'Ventas debe ser UTF-8 con tilde');
  assert.ok(VENTAS_REAL.includes('ÑANDÚ'), 'Ventas debe ser UTF-8 con Ñ');
  assert.ok(/^;+$/.test(COMPRAS_REAL.split(/\r\n/).filter(Boolean).pop()), 'Compras debe terminar con fila de separadores');
  assert.ok(/^;+$/.test(VENTAS_REAL.split(/\r\n/).filter(Boolean).pop()), 'Ventas debe terminar con fila de separadores');

  assert.strictEqual(detectarTipo(COMPRAS_REAL), 'COMPRAS');
  assert.strictEqual(detectarTipo(VENTAS_REAL), 'VENTAS');

  const compras = parsear(COMPRAS_REAL);
  const ventas = parsear(VENTAS_REAL);
  assert.strictEqual(compras.tipo, 'COMPRAS');
  assert.strictEqual(ventas.tipo, 'VENTAS');
  assert.strictEqual(compras.lineas.length, 2);
  assert.strictEqual(ventas.lineas.length, 2);
  assert.deepStrictEqual(compras.errores, [], 'Compras no debe tener errores de parseo');
  assert.deepStrictEqual(ventas.errores, [], 'Ventas no debe tener errores de parseo');
  assert.strictEqual(compras.lineas[0].numero, '9001');
  assert.strictEqual(ventas.lineas[0].serie, 'AVT26');
  assert.strictEqual(ventas.lineas[0].linea, 1);
  assert.strictEqual(ventas.lineas[0].cajas, 3);

  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const importador = crearImportador(env, catalogo);

  const previaCompras = importador.previsualizar(COMPRAS_REAL);
  assert.strictEqual(previaCompras.tipoCsv, 'COMPRAS');
  assert.strictEqual(previaCompras.resumen.porEstado.ERROR_DATOS || 0, 0);
  const confCompras = importador.confirmar(COMPRAS_REAL, previaCompras.hash, 'operador@test');
  assert.strictEqual(confCompras.success, true);

  const previaVentas = importador.previsualizar(VENTAS_REAL);
  assert.strictEqual(previaVentas.tipoCsv, 'VENTAS');
  assert.strictEqual(previaVentas.resumen.porEstado.ERROR_DATOS || 0, 0);
  const confVentas = importador.confirmar(VENTAS_REAL, previaVentas.hash, 'operador@test');
  assert.strictEqual(confVentas.success, true);

  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 7);
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO DOS', 'CAJA FICTICIA'), 3);
  assert.strictEqual(env.repo.getDocumentos().length, 2, 'No debe haber documentos fantasma');
  assert.strictEqual(env.repo.getPendientes().length, 0, 'No debe haber pendientes');
});

// ---------------------------------------------------------------------------
// Aceptación 3: misma firma en formato antiguo y real
// ---------------------------------------------------------------------------

runTest('2. El formato antiguo y el real dan la misma firma y el mismo stock; reimportar no crea MODIFICADO_EN_ERP', () => {
  const envReal = crearEntorno();
  const catReal = crearCatalogo(envReal.repo);
  const impReal = crearImportador(envReal, catReal);
  importar(impReal, COMPRAS_REAL);
  importar(impReal, VENTAS_REAL);

  const envAntiguo = crearEntorno();
  const catAntiguo = crearCatalogo(envAntiguo.repo);
  const impAntiguo = crearImportador(envAntiguo, catAntiguo);
  importar(impAntiguo, COMPRAS_ANTIGUO);
  importar(impAntiguo, VENTAS_ANTIGUO);

  const docsReal = documentosPorClave(envReal.repo);
  const docsAntiguo = documentosPorClave(envAntiguo.repo);
  for (const clave of ['COMPRA|ACT26|9001', 'SALIDA|AVT26|9001']) {
    assert.ok(docsReal.has(clave), `Falta ${clave} en el entorno real`);
    assert.ok(docsAntiguo.has(clave), `Falta ${clave} en el entorno antiguo`);
    assert.strictEqual(
      docsReal.get(clave).firma_lineas,
      docsAntiguo.get(clave).firma_lineas,
      `La firma de ${clave} no puede cambiar de formato`
    );
  }
  assert.strictEqual(stockDe(envReal, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 7);
  assert.strictEqual(stockDe(envAntiguo, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 7);
  assert.strictEqual(stockDe(envReal, 'TOMATE FICTICIO DOS', 'CAJA FICTICIA'), 3);
  assert.strictEqual(stockDe(envAntiguo, 'TOMATE FICTICIO DOS', 'CAJA FICTICIA'), 3);

  const movimientosAntes = envReal.repo.getMovimientos().length;
  const reimportCompras = impReal.previsualizar(COMPRAS_ANTIGUO);
  const reimportVentas = impReal.previsualizar(VENTAS_ANTIGUO);
  assert.strictEqual(reimportCompras.documentos[0].estado, 'YA_IMPORTADO');
  assert.strictEqual(reimportVentas.documentos[0].estado, 'YA_IMPORTADO');
  importar(impReal, COMPRAS_ANTIGUO);
  importar(impReal, VENTAS_ANTIGUO);
  assert.strictEqual(envReal.repo.getMovimientos().length, movimientosAntes, 'Reimportar no debe duplicar movimientos');
  assert.strictEqual(
    envReal.repo.getPendientes().filter(p => p.motivo === 'MODIFICADO_EN_ERP').length,
    0,
    'Reimportar el mismo contenido no debe crear MODIFICADO_EN_ERP'
  );
});

// ---------------------------------------------------------------------------
// Aceptación 4: orden, columnas obligatorias y columnas extra
// ---------------------------------------------------------------------------

runTest('3. Columnas en otro orden, una obligatoria eliminada y columnas extra desconocidas', () => {
  const cabeceraCompras = COMPRAS_REAL.split(/\r?\n/)[0].split(';');
  const ordenInverso = cabeceraCompras.map((_, indice) => cabeceraCompras.length - 1 - indice);
  const comprasReordenadas = reordenarColumnas(COMPRAS_REAL, ordenInverso);
  assert.strictEqual(detectarTipo(comprasReordenadas), 'COMPRAS');
  assert.deepStrictEqual(parsear(comprasReordenadas).lineas, parsear(COMPRAS_REAL).lineas);

  const cabeceraVentas = VENTAS_REAL.split(/\r?\n/)[0].split(';');
  const ordenVentas = cabeceraVentas.map((_, indice) => cabeceraVentas.length - 1 - indice);
  const ventasReordenadas = reordenarColumnas(VENTAS_REAL, ordenVentas);
  assert.strictEqual(detectarTipo(ventasReordenadas), 'VENTAS');
  assert.deepStrictEqual(parsear(ventasReordenadas).lineas, parsear(VENTAS_REAL).lineas);

  const sinEnvase = quitarColumna(COMPRAS_REAL, 'NombreEnvaseAC');
  assert.throws(
    () => detectarTipo(sinEnvase),
    (err) => err instanceof Error && err.message.includes('NombreEnvaseAC')
  );

  const sinPaletReal = quitarColumna(VENTAS_REAL, 'Palet');
  assert.strictEqual(detectarTipo(sinPaletReal), 'VENTAS');
  assert.deepStrictEqual(parsear(sinPaletReal).lineas, parsear(VENTAS_REAL).lineas);

  const conExtra = anadirColumna(COMPRAS_REAL, 'COLUMNA_DESCONOCIDA', 'ignorar');
  assert.strictEqual(detectarTipo(conExtra), 'COMPRAS');
  assert.deepStrictEqual(parsear(conExtra).lineas, parsear(COMPRAS_REAL).lineas);

  const ventasNumeroMalo = VENTAS_ANTIGUO.replace(';9001;AVT26/9001 (1);', ';9999;AVT26/9001 (1);');
  const parseMalo = parsear(ventasNumeroMalo);
  assert.ok(parseMalo.errores.some(error => error.campo === 'numero'), 'Numero distinto debe avisar');
  assert.strictEqual(parseMalo.lineas[0].numero, null, 'Numero distinto debe dejar la línea en ERROR_DATOS');

  const mayusculas = COMPRAS_REAL
    .split(/\r?\n/)
    .map(linea => linea.toUpperCase())
    .join('\r\n');
  assert.strictEqual(detectarTipo(mayusculas), 'COMPRAS');
  assert.deepStrictEqual(parsear(mayusculas).lineas, parsear(COMPRAS_REAL).lineas);
});

// ---------------------------------------------------------------------------
// Aceptación 5: columnas de precio e importe ignoradas
// ---------------------------------------------------------------------------

runTest('4. Tras importar ventas con precios, ninguna hoja guarda PrecioFunc, ImporteNetoFunc ni sus valores', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const importador = crearImportador(env, catalogo);
  importar(importador, COMPRAS_REAL);
  importar(importador, VENTAS_REAL);

  const prohibidos = [
    'PrecioFunc', 'UdPrecio', 'ImporteNetoFunc',
    '4321,09', '4321.09', '8765,43', '8765.43'
  ];
  for (const hoja of env.ss.sheets.values()) {
    for (const fila of hoja.rows) {
      for (const celda of fila) {
        const texto = String(celda);
        for (const prohibido of prohibidos) {
          assert.ok(!texto.includes(prohibido), `La hoja ${hoja.name} contiene ${prohibido}: ${texto}`);
        }
      }
    }
  }
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 7);
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-030: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
