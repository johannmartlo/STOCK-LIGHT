/**
 * STOCK-LIGHT — Test Suite: Helper de Mocks (mockSheets)
 * Ejecutable: node test/helpers_mock.test.js
 */

const assert = require('assert');
const { MockRange, MockSheet, MockSpreadsheet, crearEntorno } = require('./helpers/mockSheets');

console.log('================================================================');
console.log(' TEST SUITE — HELPER DE MOCKS (mockSheets.js)');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function runTest(desc, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

runTest('1. MockSpreadsheet y crearEntorno inicializan tablas base correctamente', () => {
  const env = crearEntorno();
  assert.ok(env.repo, 'Repositorio debe existir');
  assert.ok(env.movService, 'MovementService debe existir');
  assert.ok(env.queryService, 'StockQueryService debe existir');

  const sheets = ['DOCUMENTOS', 'MOVIMIENTOS', 'CAPAS_FIFO', 'STOCK_ACTUAL'];
  sheets.forEach(name => {
    const s = env.ss.getSheetByName(name);
    assert.ok(s, `Hoja ${name} debe haber sido creada`);
    assert.ok(s.getLastRow() >= 1, `Hoja ${name} debe tener cabecera`);
  });
});

runTest('2. Registrar entrada en MockSpreadsheet y leer stock actual', () => {
  const env = crearEntorno();

  const res = env.movService.registrarEntrada(
    {
      tipo_documento: 'COMPRA',
      serie: 'ACT26',
      numero: '9001',
      fecha_documento: '2026-10-01',
      entidad_nombre: 'AGRICULTOR MOCK'
    },
    [
      {
        codigo_articulo: '2112000',
        codigo_envase: 'EPS104',
        cajas: 150,
        partida: 'PARTIDA-MOCK-1',
        nombre_articulo: 'TOMATE ROSA I'
      }
    ],
    'operador_mock@almacen.com'
  );

  assert.strictEqual(res.success, true, 'La entrada debe registrarse con éxito');
  assert.strictEqual(res.totalCajas, 150);

  // Leer stock a través de StockQueryService
  const stock = env.queryService.obtenerStockActual();
  assert.ok(stock.length > 0, 'Debe haber registros de stock');

  const item = stock.find(s => s.stock_key === '2112000|EPS104');
  assert.ok(item, 'Debe existir la clave de stock 2112000|EPS104');
  assert.strictEqual(item.cajas_actuales, 150, 'El saldo de cajas debe ser 150');
});

console.log('\n================================================================');
console.log(` RESULTADOS HELPERS MOCK: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
