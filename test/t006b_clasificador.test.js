const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parsear } = require('../src/importacion/CsvHispatecParser');
const { PREFIJOS_SERIES_IMPORTACION } = require('../src/Config');
const { clasificar, agruparEnDocumentos, resumenImportacion } = require('../src/importacion/ClasificadorLineas');

const fixtureDir = path.join(__dirname, 'fixtures/csv');
const compras = parsear(fs.readFileSync(path.join(fixtureDir, 'compras_ejemplo.csv'), 'utf8')).lineas;
const ventas = parsear(fs.readFileSync(path.join(fixtureDir, 'ventas_ejemplo.csv'), 'utf8')).lineas;
let passed = 0;
let failed = 0;

function runTest(descripcion, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${descripcion}`);
    passed++;
  } catch (error) {
    console.error(`  ❌ [FAIL] ${descripcion}`);
    console.error(`     Error: ${error.message}`);
    failed++;
  }
}

function seguimientoSimulado(articulo) {
  if (articulo === 'PRODUCTO DE PRUEBA') return 'NO_SEGUIDA';
  if (articulo === 'ARTÍCULO DE PRUEBA') return 'PENDIENTE';
  return 'SEGUIDA';
}

function lineaCsv(overrides) {
  return Object.assign({
    tipoDoc: 'ENTRADA', serie: 'ACT27', numero: '900', linea: 1,
    fecha: '2026-11-04', entidad: 'PROVEEDOR FICTICIO',
    articulo: 'ARTICULO FICTICIO', envase: 'CAJA FICTICIA', cajas: 5,
    origenDato: 'CSV', filaCsv: 99
  }, overrides || {});
}

runTest('clasificar fixture muestra todos los estados con los recuentos esperados', () => {
  const lineas = compras.concat(ventas, [
    lineaCsv({ serie: 'ACA27', numero: '999', articulo: 'ARTICULO IGNORADO' }),
    lineaCsv({ numero: '777', articulo: 'ARTICULO CON CANTIDAD INVALIDA', cajas: 12.5 })
  ]);
  const clasificadas = clasificar(lineas, PREFIJOS_SERIES_IMPORTACION, seguimientoSimulado);
  const resumen = resumenImportacion(clasificadas, agruparEnDocumentos(clasificadas));
  assert.deepStrictEqual(resumen.porEstado, {
    VACIA: 1,
    OK: 1,
    PENDIENTE: 1,
    NO_SEGUIDA: 1,
    ERROR_DATOS: 2,
    SERIE_IGNORADA: 1
  });
  assert.strictEqual(resumen.totalLineas, 7);
  assert.strictEqual(resumen.totalDocumentos, 7);
  assert.ok(resumen.porDocumento.every(documento => documento.totalLineas === 1));
});

runTest('una combinación no seguida con 12,5 cajas queda NO_SEGUIDA antes de validar cantidad', () => {
  const linea = ventas[0];
  assert.strictEqual(linea.cajas, 12.5);
  const resultado = clasificar([linea], PREFIJOS_SERIES_IMPORTACION, seguimientoSimulado);
  assert.strictEqual(resultado[0].estado, 'NO_SEGUIDA');
});

runTest('documentos se ordenan por fecha, tipo, serie y números; sus líneas por número', () => {
  const lineas = [
    lineaCsv({ numero: '10', serie: 'ACT27', linea: 1 }),
    lineaCsv({ numero: '9', serie: 'ACT27', linea: 10 }),
    lineaCsv({ numero: '9', serie: 'ACT27', linea: 9 }),
    lineaCsv({ numero: '2', serie: 'AVT27', tipoDoc: 'SALIDA', origenDato: 'CSV', fecha: '2026-11-04' }),
    lineaCsv({ numero: '1', serie: 'NT27', fecha: '2026-11-03' })
  ];
  const clasificadas = clasificar(lineas, PREFIJOS_SERIES_IMPORTACION, () => 'SEGUIDA');
  const documentos = agruparEnDocumentos(clasificadas);
  assert.deepStrictEqual(documentos.map(documento => `${documento.fecha}|${documento.tipoDoc}|${documento.serie}|${documento.numero}`), [
    '2026-11-03|ENTRADA|NT27|1',
    '2026-11-04|ENTRADA|ACT27|9',
    '2026-11-04|ENTRADA|ACT27|10',
    '2026-11-04|SALIDA|AVT27|2'
  ]);
  assert.deepStrictEqual(documentos[1].lineasOk.map(linea => linea.linea), [9, 10]);
});

runTest('una línea MANUAL sin serie puede quedar OK', () => {
  const manual = lineaCsv({ serie: null, numero: null, linea: null, origenDato: 'MANUAL' });
  const resultado = clasificar([manual], PREFIJOS_SERIES_IMPORTACION, () => 'SEGUIDA');
  assert.strictEqual(resultado[0].estado, 'OK');
});

runTest('prefijos predeterminados vienen de Config y se pueden sobreescribir por importación', () => {
  assert.deepStrictEqual(PREFIJOS_SERIES_IMPORTACION, {
    prefijosEntrada: ['ACT', 'NT'],
    prefijosSalida: ['AVT']
  });
  const resultado = clasificar(
    [lineaCsv({ serie: 'ACT27' })],
    { prefijosEntrada: ['NT'], prefijosSalida: ['AVT'] },
    () => 'SEGUIDA'
  );
  assert.strictEqual(resultado[0].estado, 'SERIE_IGNORADA');
});

console.log(`\nRESULTADOS T-006B: ${passed} SUPERADAS | ${failed} FALLIDAS`);
if (failed) process.exit(1);
