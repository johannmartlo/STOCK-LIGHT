/**
 * STOCK-LIGHT — Test Suite T-035: recepciones con proveedor en columna
 *
 * Cubre los puntos de aceptación de docs/tickets/T-035-recepciones-proveedor-columna.md.
 * Ejecutable: node test/t035_recepciones_columna.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'csv');
const COLUMNA_TEXTO = fs.readFileSync(path.join(FIXTURE_DIR, 'recepciones_proveedor_columna.csv'), 'utf8');
const GRUPO_TEXTO = fs.readFileSync(path.join(FIXTURE_DIR, 'recepciones_formato_real.csv'), 'utf8');
const HEADER_VENTAS = fs.readFileSync(path.join(FIXTURE_DIR, 'ventas_formato_real.csv'), 'utf8').split(/\r?\n/)[0];

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

function cajasEs(valor) {
  const texto = String(valor).replace('.', ',');
  return texto.includes(',') ? texto : `${texto},000`;
}

function filaVenta(opciones = {}) {
  const {
    fecha = '24/11/2026',
    numero = '8501',
    cliente = 'CLIENTE INVENTADO',
    articulo = 'TOMATE FICTICIO I',
    envase = 'CARTON 40x30x14 FICTICIA',
    cajas = 2
  } = opciones;
  return [
    fecha,
    `AVT26/${numero} (1)`,
    `REF-${numero}`,
    '1',
    cliente,
    articulo,
    cajasEs(cajas),
    '0',
    '1',
    cajasEs(cajas),
    'CARTON',
    '0',
    '0',
    '0',
    '0',
    cajasEs(cajas),
    envase,
    '1',
    'PALET'
  ].join(';');
}

function crearCsv(header, filas) {
  return [header].concat(filas).join('\r\n') + '\r\n';
}

function capaDe(env, partida) {
  return env.repo.getCapasFifo().find(capa => String(capa.partida) === String(partida));
}

function movimientoDe(env, articulo) {
  return env.repo.getMovimientos().find(mov => mov.codigo_articulo === articulo);
}

function stockDe(env, articulo, envase) {
  const fila = env.repo.getStockActual().find(item => (
    item.codigo_articulo === articulo && item.codigo_envase === envase
  ));
  return fila ? Number(fila.cajas_actuales) : 0;
}

console.log('\n================================================================');
console.log(' TEST SUITE T-035 — RECEPCIONES: PROVEEDOR EN COLUMNA');
console.log('================================================================\n');

runTest('1. El fixture con NombreProveedor en columna crea capas con su proveedor y partida', () => {
  assert.ok(COLUMNA_TEXTO.includes('NombreProveedor;FechaRecepcion'), 'La cabecera debe tener NombreProveedor');
  assert.ok(COLUMNA_TEXTO.includes('\r\n'), 'El fixture debe usar CRLF');
  assert.ok(COLUMNA_TEXTO.includes('Ñ'), 'El fixture debe ser UTF-8 con Ñ');
  assert.ok(!/; - ;NombreProveedor:/m.test(COLUMNA_TEXTO), 'No debe haber filas de grupo de proveedor');

  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const importador = crearImportador(env, catalogo);
  const preview = importador.previsualizar(COLUMNA_TEXTO);
  assert.strictEqual(preview.tipoCsv, 'RECEPCIONES');
  assert.strictEqual(preview.resumen.porEstado.OK, 4);
  assert.strictEqual(preview.resumen.porEstado.ERROR_DATOS, 1);

  const confirmada = importador.confirmar(COLUMNA_TEXTO, preview.hash, 'operador@test');
  assert.strictEqual(confirmada.success, true);
  const capas = env.repo.getCapasFifo();
  assert.strictEqual(capas.length, 4);

  const capa1 = capaDe(env, '900001');
  assert.ok(capa1);
  assert.strictEqual(capa1.codigo_articulo, 'TOMATE FICTICIO I');
  assert.strictEqual(capa1.codigo_envase, 'CARTON 40X30X14 FICTICIA');
  assert.strictEqual(Number(capa1.cajas_iniciales), 104);
  assert.strictEqual(capa1.proveedor, 'PROVEEDOR FICTICIO ÑANDÚ UNO SL');
  assert.strictEqual(capa1.fecha_capa, '2026-11-23');
  assert.strictEqual(capaDe(env, '900002').codigo_articulo, 'TOMATE FICTICIO I');
  assert.strictEqual(capaDe(env, '900003').codigo_articulo, 'TOMATE FICTICIO II');
  assert.strictEqual(capaDe(env, '900004').codigo_articulo, 'TOMATE FICTICIO III');
  assert.strictEqual(capaDe(env, '900003').proveedor, 'PROVEEDOR FICTICIO DOS SL');
  assert.strictEqual(capaDe(env, '900004').proveedor, 'PROVEEDOR FICTICIO TRES SL');
  assert.strictEqual(movimientoDe(env, 'TOMATE SIN PROVEEDOR'), undefined);

  const sinProveedor = preview.documentos.find(doc => doc.numero === '11727');
  assert.ok(sinProveedor);
  assert.strictEqual(sinProveedor.lineas[0].estado, 'ERROR_DATOS');
});

runTest('2. El fixture de T-032 con proveedor en filas de grupo sigue funcionando', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const importador = crearImportador(env, catalogo);
  const preview = importador.previsualizar(GRUPO_TEXTO);
  assert.strictEqual(preview.tipoCsv, 'RECEPCIONES');
  assert.strictEqual(preview.resumen.porEstado.OK, 4);
  assert.strictEqual(preview.resumen.porEstado.ERROR_DATOS, 1);
  const confirmada = importador.confirmar(GRUPO_TEXTO, preview.hash, 'operador@test');
  assert.strictEqual(confirmada.success, true);
  assert.strictEqual(capaDe(env, '900001').proveedor, 'PROVEEDOR FICTICIO ÑANDÚ SL');
  assert.strictEqual(capaDe(env, '900003').proveedor, 'PROVEEDOR FICTICIO DOS SL');
});

runTest('3. Una venta pendiente cuenta como pareja y quita SIN_PAREJA_EN_VENTAS', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const importador = crearImportador(env, catalogo);

  const venta = crearCsv(HEADER_VENTAS, [
    filaVenta({
      numero: '8502',
      articulo: 'TOMATE FICTICIO I',
      envase: 'CARTON 40x30x14 FICTICIA',
      cajas: 2
    })
  ]);
  const previewVenta = importador.previsualizar(venta);
  const confirmadaVenta = importador.confirmar(venta, previewVenta.hash, 'operador@test');
  assert.strictEqual(confirmadaVenta.success, true);
  const pendientesSalida = env.repo.getPendientes().filter(p =>
    String(p.tipo_doc || '').toUpperCase() === 'SALIDA'
  );
  assert.ok(pendientesSalida.length > 0, 'La venta sin stock debe quedar en PENDIENTES');

  const preview = importador.previsualizar(COLUMNA_TEXTO);
  const linea = preview.documentos
    .reduce((lista, doc) => lista.concat(doc.lineas || []), [])
    .find(item => item.articulo === 'TOMATE FICTICIO I');
  assert.ok(linea);
  assert.ok(!(linea.avisos || []).includes('SIN_PAREJA_EN_VENTAS'));
  assert.ok(!preview.avisos.some(aviso =>
    aviso.tipo === 'SIN_PAREJA_EN_VENTAS' && aviso.articulo === 'TOMATE FICTICIO I'
  ));
});

runTest('4. Reimportar el fixture nuevo da YA_IMPORTADO sin filas nuevas', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const importador = crearImportador(env, catalogo);
  const preview = importador.previsualizar(COLUMNA_TEXTO);
  importador.confirmar(COLUMNA_TEXTO, preview.hash, 'operador@test');
  const docsAntes = env.repo.getDocumentos().length;
  const movsAntes = env.repo.getMovimientos().length;
  const impsAntes = env.repo.getImportaciones().length;

  const repetida = importador.confirmar(COLUMNA_TEXTO, importador.previsualizar(COLUMNA_TEXTO).hash, 'operador@test');
  assert.strictEqual(repetida.status, 'YA_IMPORTADO');
  assert.strictEqual(env.repo.getDocumentos().length, docsAntes);
  assert.strictEqual(env.repo.getMovimientos().length, movsAntes);
  assert.strictEqual(env.repo.getImportaciones().length, impsAntes);
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-035: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
