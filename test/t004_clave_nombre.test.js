/**
 * STOCK-LIGHT — Test Suite T-004: Clave de stock por nombre normalizado de artículo y envase
 * Ejecutable con Node.js: `node test/t004_clave_nombre.test.js`
 *
 * Cumple los criterios de aceptación 1 a 6 de docs/tickets/T-004-clave-por-nombre.md (D-003, D-022, D-023).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { crearEntorno } = require('./helpers/mockSheets');
const { normalizarNombre } = require('../src/Normalizacion');
const { aplicarMovimiento } = require('../src/Libro');

console.log('================================================================');
console.log(' TEST SUITE T-004 — CLAVE POR NOMBRE NORMALIZADO (D-003)');
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
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
    failed++;
  }
}

// -----------------------------------------------------------------------------
// Aceptación 1: Entrada y salida con espacios y mayúsculas/minúsculas comparten clave
// -----------------------------------------------------------------------------
runTest('1. Entrada "TOMATE ROSA I M" / "EPS 106 9x500" y salida "tomate rosa i m " / "EPS  106 9X500" (U+00A0) comparten clave y consumen FIFO:', () => {
  const env = crearEntorno();

  // Entrada
  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '101',
    fecha_documento: '2026-11-01',
    entidad_nombre: 'PROVEEDOR CENTRAL'
  }, [{
    codigo_articulo: 'TOMATE ROSA I M',
    codigo_envase: 'EPS 106 9x500',
    cajas: 50,
    partida: 'PART-01'
  }], 'operador@almacen');

  // Salida con minúsculas, doble espacio y espacio duro U+00A0
  const salidaRes = env.movService.registrarSalida({
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '201',
    fecha_documento: '2026-11-02',
    entidad_nombre: 'CLIENTE NORTE'
  }, [{
    codigo_articulo: 'tomate rosa i m ',
    codigo_envase: 'EPS \u00a0106 9X500',
    cajas: 20
  }], 'operador@almacen');

  assert.strictEqual(salidaRes.success, true, 'La salida debe registrarse con éxito');

  const stockKeyEsperada = 'TOMATE ROSA I M|EPS 106 9X500';

  // Verificar STOCK_ACTUAL
  const stock = env.repo.getStockActual();
  assert.strictEqual(stock.length, 1, 'Debe haber exactamente 1 registro en STOCK_ACTUAL');
  assert.strictEqual(stock[0].stock_key, stockKeyEsperada);
  assert.strictEqual(stock[0].codigo_articulo, 'TOMATE ROSA I M');
  assert.strictEqual(stock[0].codigo_envase, 'EPS 106 9X500');
  assert.strictEqual(Number(stock[0].cajas_actuales), 30);

  // Verificar CAPAS_FIFO
  const capas = env.repo.getCapasFifo();
  assert.strictEqual(capas.length, 1);
  assert.strictEqual(capas[0].codigo_articulo, 'TOMATE ROSA I M');
  assert.strictEqual(capas[0].codigo_envase, 'EPS 106 9X500');
  assert.strictEqual(Number(capas[0].cajas_iniciales), 50);
  assert.strictEqual(Number(capas[0].cajas_consumidas), 20);
  assert.strictEqual(Number(capas[0].cajas_restantes), 30);

  // Verificar CONSUMOS_FIFO
  const consumos = env.repo.getConsumosFifo();
  assert.strictEqual(consumos.length, 1);
  assert.strictEqual(consumos[0].id_capa, capas[0].id_capa);
  assert.strictEqual(consumos[0].codigo_articulo, 'TOMATE ROSA I M');
  assert.strictEqual(consumos[0].codigo_envase, 'EPS 106 9X500');
  assert.strictEqual(Number(consumos[0].cajas), 20);
});

// -----------------------------------------------------------------------------
// Aceptación 2: normalizarNombre conserva tildes y signos, colapsa espacios
// -----------------------------------------------------------------------------
runTest('2. normalizarNombre conserva tildes y signos y colapsa tabuladores, espacios dobles y duros:', () => {
  assert.strictEqual(normalizarNombre('CARTON 40X30X9,5 MORESCO'), 'CARTON 40X30X9,5 MORESCO');
  assert.strictEqual(normalizarNombre('CORUÑA'), 'CORUÑA');
  assert.strictEqual(normalizarNombre('tomate rosa i m'), 'TOMATE ROSA I M');
  assert.strictEqual(normalizarNombre('  tomate\trosa\u00a0\u00a0i   m  '), 'TOMATE ROSA I M');
  assert.strictEqual(normalizarNombre('eps\t106   9x500'), 'EPS 106 9X500');
  assert.strictEqual(normalizarNombre('PLÁTANO DE CANARIAS - N.º 1'), 'PLÁTANO DE CANARIAS - N.º 1');
  assert.strictEqual(normalizarNombre(null), '');
  assert.strictEqual(normalizarNombre(undefined), '');
});

// -----------------------------------------------------------------------------
// Aceptación 3: Todas las operaciones con nombres en minúsculas y espacios irregulares
// -----------------------------------------------------------------------------
runTest('3. Todas las operaciones funcionan con minúsculas y espacios irregulares, datos normalizados y 0 diferencias:', () => {
  const env = crearEntorno();

  // 1. Entrada inicial
  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '10',
    fecha_documento: '2026-11-01',
    entidad_nombre: 'PROV 1'
  }, [{
    codigo_articulo: '  tomate pera  rojo ',
    codigo_envase: '  caja  10kg ',
    cajas: 100,
    partida: 'P1'
  }], 'user1');

  // 2. registrarAjuste (+)
  env.movService.registrarAjuste({
    codigo_articulo: 'tomate pera rojo',
    codigo_envase: 'caja 10kg',
    cajas: 10,
    signo: 1,
    motivo: 'INVENTARIO_MAS',
    usuario: 'user1'
  });

  // 3. registrarAjuste (−)
  env.movService.registrarAjuste({
    codigo_articulo: '  tomate  pera rojo  ',
    codigo_envase: ' caja 10kg ',
    cajas: 5,
    signo: -1,
    motivo: 'ROTURA',
    usuario: 'user1'
  });

  // 4. registrarReclasificacion
  const recRes = env.movService.registrarReclasificacion({
    articulo_origen: 'tomate pera rojo',
    envase_origen: 'caja 10kg',
    articulo_destino: '  tomate  pera seleccionado ',
    envase_destino: ' caja madera ',
    cajas: 10,
    motivo: 'CALIDAD'
  }, 'user1');
  assert.strictEqual(recRes.success, true);

  // 5. registrarMovimientoPartida
  const movPartRes = env.movService.registrarMovimientoPartida({
    codigo_articulo: 'tomate pera rojo',
    codigo_envase: 'caja 10kg',
    partida_origen: 'P1',
    partida_destino: 'P2',
    cajas: 5
  }, 'user1');
  assert.strictEqual(movPartRes.success, true);

  // 6. dividirCapaEntrada con artículo original en minúsculas
  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '20',
    fecha_documento: '2026-11-01',
    entidad_nombre: 'PROV 2'
  }, [{
    codigo_articulo: 'PEPINO HOLANDES',
    codigo_envase: 'EPS 104',
    cajas: 40,
    partida: 'PEP-01'
  }], 'user1');

  const divRes = env.movService.dividirCapaEntrada({
    serie: 'ACT26',
    numero: '20',
    divisiones: [
      { articulo: 'pepino  holandes ', envase: 'eps 104', cajas: 25 },
      { articulo: 'pepino mini', envase: 'eps 104', cajas: 15 }
    ]
  }, 'user1');
  assert.strictEqual(divRes.success, true);

  // 7. corregirEntradaParcial
  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '30',
    fecha_documento: '2026-11-01',
    entidad_nombre: 'PROV 3'
  }, [{
    codigo_articulo: 'CALABACIN FINO',
    codigo_envase: 'CARTON',
    cajas: 30,
    partida: 'CAL-01'
  }], 'user1');

  const corrRes = env.movService.corregirEntradaParcial({
    serie: 'ACT26',
    numero: '30',
    articulo_destino: 'calabacin grueso',
    envase_destino: 'carton'
  }, 'user1');
  assert.strictEqual(corrRes.success, true);

  // 8. anularEntrada por serie, número y artículo en minúsculas
  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '40',
    fecha_documento: '2026-11-01',
    entidad_nombre: 'PROV 4'
  }, [{
    codigo_articulo: 'BERENJENA NEGRA',
    codigo_envase: 'EPS 154',
    cajas: 20,
    partida: 'BER-01'
  }], 'user1');

  const anulRes = env.movService.anularEntrada({
    serie: 'ACT26',
    numero: '40',
    articulo: '  berenjena  negra  '
  }, 'user1');
  assert.strictEqual(anulRes.success, true);

  // 9. StockQueryService.obtenerDetalleStock con minúsculas y espacios
  const queryItem = env.queryService.obtenerDetalleStock('  tomate pera rojo  ', ' caja  10kg ');
  assert.ok(queryItem, 'obtenerDetalleStock debe encontrar el registro con parámetros sin normalizar');
  assert.strictEqual(queryItem.codigo_articulo, 'TOMATE PERA ROJO');
  assert.strictEqual(queryItem.codigo_envase, 'CAJA 10KG');

  // Verificación exhaustiva: en todas las hojas, normalizarNombre(x) === x
  const movs = env.repo.getMovimientos();
  assert.ok(movs.length > 0);
  for (const m of movs) {
    assert.strictEqual(normalizarNombre(m.codigo_articulo), m.codigo_articulo, `MOVIMIENTOS art no normalizado: ${m.codigo_articulo}`);
    assert.strictEqual(normalizarNombre(m.codigo_envase), m.codigo_envase, `MOVIMIENTOS env no normalizado: ${m.codigo_envase}`);
  }

  const capas = env.repo.getCapasFifo();
  assert.ok(capas.length > 0);
  for (const c of capas) {
    assert.strictEqual(normalizarNombre(c.codigo_articulo), c.codigo_articulo, `CAPAS_FIFO art no normalizado: ${c.codigo_articulo}`);
    assert.strictEqual(normalizarNombre(c.codigo_envase), c.codigo_envase, `CAPAS_FIFO env no normalizado: ${c.codigo_envase}`);
  }

  const stock = env.repo.getStockActual();
  assert.ok(stock.length > 0);
  for (const s of stock) {
    assert.strictEqual(normalizarNombre(s.codigo_articulo), s.codigo_articulo, `STOCK_ACTUAL art no normalizado: ${s.codigo_articulo}`);
    assert.strictEqual(normalizarNombre(s.codigo_envase), s.codigo_envase, `STOCK_ACTUAL env no normalizado: ${s.codigo_envase}`);
  }

  const consumos = env.repo.getConsumosFifo();
  assert.ok(consumos.length > 0);
  for (const k of consumos) {
    assert.strictEqual(normalizarNombre(k.codigo_articulo), k.codigo_articulo, `CONSUMOS_FIFO art no normalizado: ${k.codigo_articulo}`);
    assert.strictEqual(normalizarNombre(k.codigo_envase), k.codigo_envase, `CONSUMOS_FIFO env no normalizado: ${k.codigo_envase}`);
  }

  // comprobarConsistencia() debe dar 0 diferencias
  const audit = env.movService.comprobarConsistencia();
  assert.strictEqual(audit.diferenciasCapas.length, 0, 'No debe haber diferencias en capas');
  assert.strictEqual(audit.diferenciasStock.length, 0, 'No debe haber diferencias en stock');
  assert.strictEqual(audit.diferenciasConsumos.length, 0, 'No debe haber diferencias en consumos');
});

// -----------------------------------------------------------------------------
// Aceptación 4: STOCK_ACTUAL nombres según MAESTRO o fallback a clave
// -----------------------------------------------------------------------------
runTest('4. STOCK_ACTUAL usa nombres de MAESTRO si existe fila, o partes de la clave si no existe:', () => {
  const env = crearEntorno();

  // Configurar MAESTRO con una fila
  env.repo.saveMaestro([
    {
      codigo_articulo: 'SANDIA NEGRA',
      codigo_envase: 'BOX',
      nombre_articulo: 'SANDÍA EXTRA DULCE',
      descripcion_envase: 'BOX CARTÓN 300KG'
    }
  ]);

  // Entrada con clave que ESTÁ en MAESTRO
  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '501',
    fecha_documento: '2026-11-01',
    entidad_nombre: 'PROV'
  }, [{
    codigo_articulo: 'sandia negra',
    codigo_envase: 'box',
    cajas: 10
  }], 'user1');

  // Entrada con clave que NO ESTÁ en MAESTRO
  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '502',
    fecha_documento: '2026-11-01',
    entidad_nombre: 'PROV'
  }, [{
    codigo_articulo: 'melon piel de sapo',
    codigo_envase: 'caja 15kg',
    cajas: 15
  }], 'user1');

  const stock = env.repo.getStockActual();
  const sandia = stock.find(s => s.stock_key === 'SANDIA NEGRA|BOX');
  const melon = stock.find(s => s.stock_key === 'MELON PIEL DE SAPO|CAJA 15KG');

  assert.ok(sandia, 'Debe existir registro de sandía');
  assert.strictEqual(sandia.nombre_articulo, 'SANDÍA EXTRA DULCE', 'Debe tomar nombre de MAESTRO');
  assert.strictEqual(sandia.descripcion_envase, 'BOX CARTÓN 300KG', 'Debe tomar descripción de MAESTRO');

  assert.ok(melon, 'Debe existir registro de melón');
  assert.strictEqual(melon.nombre_articulo, 'MELON PIEL DE SAPO', 'Debe rellenar nombre con el artículo normalizado');
  assert.strictEqual(melon.descripcion_envase, 'CAJA 15KG', 'Debe rellenar envase con el envase normalizado');
});

// -----------------------------------------------------------------------------
// Aceptación 5: Artículo o envase vacío o con "|" devuelve error y no escribe nada
// -----------------------------------------------------------------------------
runTest('5. Artículo o envase vacío o con "|" devuelve error de validación y no escribe nada:', () => {
  const env = crearEntorno();

  // En Libro.aplicarMovimiento
  const res1 = aplicarMovimiento({ capas: [], stock: {}, consumosPorMovimiento: {} }, {
    tipo_movimiento: 'ENTRADA',
    codigo_articulo: 'TOMATE|ROSA',
    codigo_envase: 'EPS 104',
    cajas: 10
  });
  assert.strictEqual(res1.ok, false);
  assert.strictEqual(res1.errorCode, 'VALIDATION_ERROR');

  const res2 = aplicarMovimiento({ capas: [], stock: {}, consumosPorMovimiento: {} }, {
    tipo_movimiento: 'ENTRADA',
    codigo_articulo: '   ',
    codigo_envase: 'EPS 104',
    cajas: 10
  });
  assert.strictEqual(res2.ok, false);
  assert.strictEqual(res2.errorCode, 'VALIDATION_ERROR');

  const res3 = aplicarMovimiento({ capas: [], stock: {}, consumosPorMovimiento: {} }, {
    tipo_movimiento: 'ENTRADA',
    codigo_articulo: 'TOMATE',
    codigo_envase: 'EPS|104',
    cajas: 10
  });
  assert.strictEqual(res3.ok, false);
  assert.strictEqual(res3.errorCode, 'VALIDATION_ERROR');

  // En MovementService._clave
  assert.throws(() => env.movService._clave('TOMATE|ROSA', 'EPS'), /inválida/);
  assert.throws(() => env.movService._clave('', 'EPS'), /inválida/);
  assert.throws(() => env.movService._clave('TOMATE', '   '), /inválida/);
  assert.throws(() => env.movService._clave('TOMATE', 'EPS|104'), /inválida/);

  // En MovementService.registrarEntrada con "|"
  assert.throws(() => {
    env.movService.registrarEntrada({
      tipo_documento: 'COMPRA',
      serie: 'ACT26',
      numero: '999',
      fecha_documento: '2026-11-01',
      entidad_nombre: 'PROV'
    }, [{
      codigo_articulo: 'TOMATE|ROSA',
      codigo_envase: 'EPS 104',
      cajas: 10
    }], 'user1');
  }, /inválida/);

  // No debe haber escrito nada
  assert.strictEqual(env.repo.getMovimientos().length, 0);
  assert.strictEqual(env.repo.getCapasFifo().length, 0);
  assert.strictEqual(env.repo.getStockActual().length, 0);
  assert.strictEqual(env.repo.getConsumosFifo().length, 0);

  // En OperationalSafetyService.validarDocumento con "|"
  const valRes = env.safetyService.validarDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ACT26',
    numero: '999',
    fecha_documento: '2026-11-01'
  }, [{
    codigo_articulo: 'TOMATE|ROSA',
    codigo_envase: 'EPS 104',
    cajas: 10
  }]);
  assert.strictEqual(valRes.semaforo, 'ERROR');
  assert.strictEqual(valRes.lineasValidadas[0].bloqueada, true);
  assert.strictEqual(valRes.puedeProcesar, false);
});

// -----------------------------------------------------------------------------
// Aceptación 6: Comprobaciones estáticas (grep y git diff)
// -----------------------------------------------------------------------------
runTest('6. Comprobaciones de arquitectura (grep y diff limpio en archivos protegidos):', () => {
  const rootDir = path.resolve(__dirname, '..');

  // 1. this.libro.aplicarMovimiento( aparece 1 sola vez en MovementService.js
  const movServiceContent = fs.readFileSync(path.join(rootDir, 'src', 'MovementService.js'), 'utf8');
  const matchesAplicar = movServiceContent.match(/this\.libro\.aplicarMovimiento\(/g) || [];
  assert.strictEqual(matchesAplicar.length, 1, 'this.libro.aplicarMovimiento( debe aparecer exactamente 1 vez en MovementService.js');

  // 2. engine.buildStockKey( aparece 1 sola vez en MovementService.js (en _clave)
  const matchesBuildMov = movServiceContent.match(/engine\.buildStockKey\(/g) || [];
  assert.strictEqual(matchesBuildMov.length, 1, 'engine.buildStockKey( debe aparecer exactamente 1 vez en MovementService.js');

  // 3. engine.buildStockKey( aparece 0 veces en OperationalSafetyService.js
  const safetyContent = fs.readFileSync(path.join(rootDir, 'src', 'OperationalSafetyService.js'), 'utf8');
  const matchesBuildSafety = safetyContent.match(/engine\.buildStockKey\(/g) || [];
  assert.strictEqual(matchesBuildSafety.length, 0, 'engine.buildStockKey( no debe aparecer en OperationalSafetyService.js');

  // 4. git diff main -- src/InventoryEngine.js src/Código.js src/Normalizacion.js está vacío
  const diffOutput = execSync('git diff main -- src/InventoryEngine.js src/Código.js src/Normalizacion.js', {
    cwd: rootDir,
    encoding: 'utf8'
  });
  assert.strictEqual(diffOutput.trim(), '', 'Los archivos protegidos no deben tener cambios respecto a main');
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-004: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
