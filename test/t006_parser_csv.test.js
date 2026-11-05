const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizarNombre, parsearNumeroEs, parsearFechaDdMmYyyy } = require('../src/Normalizacion');
const { detectarTipo, parsear } = require('../src/importacion/CsvHispatecParser');

const compras = fs.readFileSync(path.join(__dirname, 'fixtures/csv/compras_ejemplo.csv'), 'utf8');
const ventas = fs.readFileSync(path.join(__dirname, 'fixtures/csv/ventas_ejemplo.csv'), 'utf8');
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

runTest('detectarTipo reconoce compras y ventas con o sin BOM y rechaza cabecera incompleta', () => {
  assert.strictEqual(detectarTipo(compras), 'COMPRAS');
  assert.strictEqual(detectarTipo(`\uFEFF${compras}`), 'COMPRAS');
  assert.strictEqual(detectarTipo(ventas), 'VENTAS');
  assert.strictEqual(detectarTipo(`\uFEFF${ventas}`), 'VENTAS');
  assert.throws(() => detectarTipo(ventas.replace(';Palet\n', '\n')), /no reconocida/);
});

runTest('parsear conserva el registro de cabecera, interpreta una compra canónica completa y respeta comillas', () => {
  const resultado = parsear(compras);
  assert.strictEqual(resultado.tipo, 'COMPRAS');
  assert.strictEqual(resultado.lineas.length, 3);
  assert.deepStrictEqual(resultado.lineas[1], {
    tipoDoc: 'ENTRADA', serie: 'ACT27', numero: '160', linea: 2,
    fecha: '2026-11-02', entidad: 'PROVEEDOR INVENTADO DOS',
    articulo: 'EPS 106 9X500', envase: 'EPS 106 9X500', cajas: 44,
    unidades: 44, kg: 45.25, codigoEnvaseHispatec: 'ENV106',
    origenDato: 'CSV', filaCsv: 3
  });
  assert.strictEqual(resultado.lineas[0].serie, 'ACA27');
  assert.strictEqual(resultado.lineas[1].cajas, 44);
  assert.ok(compras.includes('"Revisión; primera"'));
  assert.ok(!resultado.lineas.some(linea => linea.articulo && linea.articulo.includes(';')));
});

runTest('parsear extrae AVT27/160 (2) y deja incompleta la referencia sin paréntesis con aviso', () => {
  const resultado = parsear(ventas);
  assert.strictEqual(resultado.tipo, 'VENTAS');
  assert.deepStrictEqual(
    { serie: resultado.lineas[0].serie, numero: resultado.lineas[0].numero, linea: resultado.lineas[0].linea },
    { serie: 'AVT27', numero: '160', linea: 2 }
  );
  assert.strictEqual(resultado.lineas[1].serie, null);
  assert.strictEqual(resultado.lineas[1].numero, null);
  assert.strictEqual(resultado.lineas[1].linea, null);
  assert.ok(resultado.errores.some(error => error.filaCsv === 3 && error.campo === 'albaran'));
});

runTest('parsearNumeroEs conserva decimales y separadores de miles sin validar reglas de negocio', () => {
  assert.strictEqual(parsearNumeroEs('12,500'), 12.5);
  assert.strictEqual(parsearNumeroEs('1.234,000'), 1234);
  assert.strictEqual(parsearNumeroEs(''), null);
  assert.ok(Number.isNaN(parsearNumeroEs('1,2,3')));
});

runTest('funciones de Normalizacion cubren límites de texto, número y fecha', () => {
  assert.strictEqual(normalizarNombre(null), '');
  assert.strictEqual(normalizarNombre(undefined), '');
  assert.strictEqual(normalizarNombre('  Árbol,   EPS 106 9x500!  '), 'ÁRBOL, EPS 106 9X500!');
  assert.strictEqual(parsearNumeroEs(null), null);
  assert.ok(Number.isNaN(parsearNumeroEs('abc')));
  assert.strictEqual(parsearFechaDdMmYyyy('02/11/2026'), '2026-11-02');
  assert.strictEqual(parsearFechaDdMmYyyy('31/02/2026'), null);
  assert.strictEqual(parsearFechaDdMmYyyy('2/11/2026'), null);
  assert.strictEqual(parsearFechaDdMmYyyy(null), null);
});

console.log(`\nRESULTADOS T-006: ${passed} SUPERADAS | ${failed} FALLIDAS`);
if (failed) process.exit(1);
