/**
 * STOCK-LIGHT — Test Suite FASE 3.3: StockQueryService y Agrupación de Existencias
 * 
 * Verifica rigurosamente las 10 reglas de negocio para la capa de consulta:
 * 1. Un artículo con dos envases del mismo grupo (ej. EPS104 y EPS106 -> ambos EPS).
 * 2. Un artículo con dos envases de grupos diferentes.
 * 3. Dos artículos distintos que comparten el mismo grupo.
 * 4. Salida de un envase que actualiza correctamente el total agregado de su grupo.
 * 5. Envase sin grupo asignado -> clasificado estrictamente como SIN_CLASIFICAR.
 * 6. Grupo sin existencias -> retorna 0 cajas sin error.
 * 7. Inexistencia de grupo no altera el stock subyacente.
 * 8. Consulta por grupo devuelve únicamente las líneas correspondientes.
 * 9. Consumo FIFO independiente del grupo.
 * 10. rebuildStock() no depende de grupos.
 * 
 * Ejecutable: `node test/stock_query.test.js`
 */

const assert = require('assert');
const { StockQueryService, DEFAULT_GRUPOS_ENVASE } = require('../src/StockQueryService');
const { MovementService } = require('../src/MovementService');
const { buildStockKey, processMovement, rebuildStockFromMovements } = require('../src/InventoryEngine');
const { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps } = require('../src/DeduplicationService');
const { SCHEMA_DEFINITIONS } = require('../src/Repository');

/**
 * Mock en memoria de repositorio para pruebas aisladas y deterministas.
 */
class InMemoryRepository {
  constructor() {
    this.maestro = [
      { codigo_articulo: '2112000', codigo_envase: 'EPS104', nombre_articulo: 'TOMATE ROSA I', descripcion_envase: 'EPS 104' },
      { codigo_articulo: '2112000', codigo_envase: 'EPS106', nombre_articulo: 'TOMATE ROSA I M', descripcion_envase: 'EPS 106 9x500' },
      { codigo_articulo: '2112001', codigo_envase: 'EPS106', nombre_articulo: 'TOMATE RAMA I M', descripcion_envase: 'EPS 106 9x500' },
      { codigo_articulo: '2112002', codigo_envase: 'EPS104', nombre_articulo: 'TOMATE KUMATO I M', descripcion_envase: 'EPS 104 5x500' },
      { codigo_articulo: '2112003', codigo_envase: 'EPS154', nombre_articulo: 'TOMATE PERA SUELTA M', descripcion_envase: 'EPS 154' },
      { codigo_articulo: '2112004', codigo_envase: 'CARTON', nombre_articulo: 'TOMATE COCKTAIL I M', descripcion_envase: 'CARTON 40x30X9.7 MADERA 8X300' },
      { codigo_articulo: '2112004', codigo_envase: 'EPS104', nombre_articulo: 'TOMATE COCKTAIL I M', descripcion_envase: 'EPS 104' },
      { codigo_articulo: '2112005', codigo_envase: 'CT4395', nombre_articulo: 'TOMATE MORESCO I M', descripcion_envase: 'CT4395 MORESCO' }
    ];
    this.gruposEnvase = [...DEFAULT_GRUPOS_ENVASE];
    this.documentos = [];
    this.movimientos = [];
    this.capasFifo = [];
    this.stockActual = [];
  }

  getDocumentos() { return [...this.documentos]; }
  appendDocumento(doc) { this.documentos.push({ ...doc }); return 1; }
  getMovimientos() { return [...this.movimientos]; }
  appendMovimientos(movs) { movs.forEach(m => this.movimientos.push({ ...m })); return movs.length; }
  getCapasFifo() { return [...this.capasFifo]; }
  saveCapasFifo(capas) { this.capasFifo = capas.map(c => ({ ...c })); return capas.length; }
  getStockActual() { return [...this.stockActual]; }
  saveStockActual(records) { this.stockActual = records.map(r => ({ ...r })); return records.length; }
  getMaestro() { return [...this.maestro]; }
  getGruposEnvase() { return [...this.gruposEnvase]; }
  saveGruposEnvase(grupos) { this.gruposEnvase = grupos.map(g => ({ ...g })); return grupos.length; }
}

class MockLock {
  waitLock() { return true; }
  releaseLock() {}
}

function crearMovementService(repo) {
  return new MovementService({
    repository: repo,
    lockService: new MockLock(),
    deduplicationService: { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps },
    inventoryEngine: { buildStockKey, processMovement, rebuildStockFromMovements }
  });
}

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
    failed++;
  }
}

console.log('================================================================');
console.log(' TEST SUITE FASE 3.3 — CONSULTA Y AGRUPACIÓN DE EXISTENCIAS');
console.log('================================================================\n');

// --------------------------------------------------------------------------
// TEST 1: Un artículo con dos envases del mismo grupo (ej. EPS104 y EPS106 -> ambos EPS)
// --------------------------------------------------------------------------
runTest('Caso 1: Un artículo con dos envases del mismo grupo (EPS104 y EPS106 -> ambos EPS)', () => {
  const repo = new InMemoryRepository();
  repo.saveStockActual([
    {
      stock_key: '2112000|EPS104',
      codigo_articulo: '2112000',
      nombre_articulo: 'TOMATE ROSA I',
      codigo_envase: 'EPS104',
      descripcion_envase: 'EPS 104',
      cajas_actuales: 100,
      fecha_ultima_actualizacion: '2026-09-24T10:00:00Z',
      ultimo_movimiento_id: 'MOV-1'
    },
    {
      stock_key: '2112000|EPS106',
      codigo_articulo: '2112000',
      nombre_articulo: 'TOMATE ROSA I M',
      codigo_envase: 'EPS106',
      descripcion_envase: 'EPS 106 9x500',
      cajas_actuales: 60,
      fecha_ultima_actualizacion: '2026-09-24T11:00:00Z',
      ultimo_movimiento_id: 'MOV-2'
    }
  ]);

  const queryService = new StockQueryService({ repository: repo });
  const stockEps = queryService.obtenerStockPorGrupo('EPS');

  assert.strictEqual(stockEps.length, 2, 'Deben existir 2 líneas de existencias para EPS');
  assert.strictEqual(stockEps[0].codigo_envase, 'EPS104');
  assert.strictEqual(stockEps[0].cajas_actuales, 100);
  assert.strictEqual(stockEps[1].codigo_envase, 'EPS106');
  assert.strictEqual(stockEps[1].cajas_actuales, 60);

  const detalleEps = queryService.obtenerDetalleGrupo('EPS');
  assert.strictEqual(detalleEps.grupo, 'EPS');
  assert.strictEqual(detalleEps.totalCajas, 160, 'El grupo EPS debe sumar exactamente 160 cajas');
  assert.strictEqual(detalleEps.cajas, 160);
  assert.strictEqual(detalleEps.lineas.length, 2);
  assert.strictEqual(detalleEps.lineas[0].stockKey, '2112000|EPS104');
  assert.strictEqual(detalleEps.lineas[1].stockKey, '2112000|EPS106');
});

// --------------------------------------------------------------------------
// TEST 2: Un artículo con dos envases de grupos diferentes
// --------------------------------------------------------------------------
runTest('Caso 2: Un artículo con dos envases de grupos diferentes', () => {
  const repo = new InMemoryRepository();
  repo.saveStockActual([
    {
      stock_key: '2112004|CARTON',
      codigo_articulo: '2112004',
      nombre_articulo: 'TOMATE COCKTAIL I M',
      codigo_envase: 'CARTON',
      descripcion_envase: 'CARTON 40x30X9.7 MADERA 8X300',
      cajas_actuales: 50
    },
    {
      stock_key: '2112004|EPS104',
      codigo_articulo: '2112004',
      nombre_articulo: 'TOMATE COCKTAIL I M',
      codigo_envase: 'EPS104',
      descripcion_envase: 'EPS 104',
      cajas_actuales: 120
    }
  ]);

  const queryService = new StockQueryService({ repository: repo });

  const stockCarton = queryService.obtenerStockPorGrupo('JAPONÉS CARTÓN');
  assert.strictEqual(stockCarton.length, 1);
  assert.strictEqual(stockCarton[0].codigo_envase, 'CARTON');
  assert.strictEqual(stockCarton[0].cajas_actuales, 50);

  const stockEps = queryService.obtenerStockPorGrupo('EPS');
  assert.strictEqual(stockEps.length, 1);
  assert.strictEqual(stockEps[0].codigo_envase, 'EPS104');
  assert.strictEqual(stockEps[0].cajas_actuales, 120);

  const detalleCarton = queryService.obtenerDetalleGrupo('JAPONÉS CARTÓN');
  assert.strictEqual(detalleCarton.totalCajas, 50);
  assert.strictEqual(detalleCarton.lineas.length, 1);

  const detalleEps = queryService.obtenerDetalleGrupo('EPS');
  assert.strictEqual(detalleEps.totalCajas, 120);
  assert.strictEqual(detalleEps.lineas.length, 1);
});

// --------------------------------------------------------------------------
// TEST 3: Dos artículos distintos que comparten el mismo grupo
// --------------------------------------------------------------------------
runTest('Caso 3: Dos artículos distintos que comparten el mismo grupo', () => {
  const repo = new InMemoryRepository();
  repo.saveStockActual([
    {
      stock_key: '2112000|EPS104',
      codigo_articulo: '2112000',
      nombre_articulo: 'TOMATE ROSA I',
      codigo_envase: 'EPS104',
      descripcion_envase: 'EPS 104',
      cajas_actuales: 70
    },
    {
      stock_key: '2112002|EPS104',
      codigo_articulo: '2112002',
      nombre_articulo: 'TOMATE KUMATO I M',
      codigo_envase: 'EPS104',
      descripcion_envase: 'EPS 104 5x500',
      cajas_actuales: 30
    }
  ]);

  const queryService = new StockQueryService({ repository: repo });
  const detalleEps = queryService.obtenerDetalleGrupo('EPS');

  assert.strictEqual(detalleEps.totalCajas, 100, 'Total agregado debe ser 100 (70 + 30)');
  assert.strictEqual(detalleEps.lineas.length, 2);
  const articulosEnGrupo = detalleEps.lineas.map(l => l.codigoArticulo);
  assert.ok(articulosEnGrupo.includes('2112000'));
  assert.ok(articulosEnGrupo.includes('2112002'));
});

// --------------------------------------------------------------------------
// TEST 4: Salida de un envase que actualiza correctamente el total agregado de su grupo
// --------------------------------------------------------------------------
runTest('Caso 4: Salida de un envase que actualiza correctamente el total agregado de su grupo', () => {
  const repo = new InMemoryRepository();
  const movementService = crearMovementService(repo);
  const queryService = new StockQueryService({ repository: repo });

  // 1. Entrada de 100 cajas EPS104 y 60 cajas EPS106
  movementService.registrarEntrada({
    id_documento: 'DOC-ENT-1',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '1001',
    fecha_documento: '2026-09-20'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100 },
    { codigo_articulo: '2112000', codigo_envase: 'EPS106', cajas: 60 }
  ], 'TEST_OPERADOR');

  let detalleEps = queryService.obtenerDetalleGrupo('EPS');
  assert.strictEqual(detalleEps.totalCajas, 160, 'Inicial: 160 cajas en grupo EPS');

  // 2. Salida de 40 cajas de EPS104
  movementService.registrarSalida({
    id_documento: 'DOC-SAL-1',
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '2001',
    fecha_documento: '2026-09-22'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 40 }
  ], 'TEST_OPERADOR');

  // 3. Consultar grupo tras la salida
  detalleEps = queryService.obtenerDetalleGrupo('EPS');
  assert.strictEqual(detalleEps.totalCajas, 120, 'Post-salida: EPS debe sumar 120 cajas (60 + 60)');
  
  const lineaEps104 = detalleEps.lineas.find(l => l.codigoEnvase === 'EPS104');
  const lineaEps106 = detalleEps.lineas.find(l => l.codigoEnvase === 'EPS106');
  assert.strictEqual(lineaEps104.cajas, 60);
  assert.strictEqual(lineaEps106.cajas, 60);
});

// --------------------------------------------------------------------------
// TEST 5: Envase sin grupo asignado -> clasificado como SIN_CLASIFICAR
// --------------------------------------------------------------------------
runTest('Caso 5: Envase sin grupo asignado -> clasificado como SIN_CLASIFICAR', () => {
  const repo = new InMemoryRepository();
  repo.saveStockActual([
    {
      stock_key: '2112000|ENVASE_NUEVO_DESCONOCIDO',
      codigo_articulo: '2112000',
      nombre_articulo: 'TOMATE ROSA I',
      codigo_envase: 'ENVASE_NUEVO_DESCONOCIDO',
      descripcion_envase: 'FORMATO EXPERIMENTAL',
      cajas_actuales: 45
    }
  ]);

  const queryService = new StockQueryService({ repository: repo });
  const stock = queryService.obtenerStockActual();

  assert.strictEqual(stock.length, 1);
  assert.strictEqual(stock[0].grupo_envase, 'SIN_CLASIFICAR');
  assert.strictEqual(stock[0].grupo, 'SIN_CLASIFICAR');

  const stockSinClasificar = queryService.obtenerStockPorGrupo('SIN_CLASIFICAR');
  assert.strictEqual(stockSinClasificar.length, 1);
  assert.strictEqual(stockSinClasificar[0].codigo_envase, 'ENVASE_NUEVO_DESCONOCIDO');

  const detalleSinClasificar = queryService.obtenerDetalleGrupo('SIN_CLASIFICAR');
  assert.strictEqual(detalleSinClasificar.totalCajas, 45);
  assert.strictEqual(detalleSinClasificar.lineas.length, 1);
});

// --------------------------------------------------------------------------
// TEST 6: Grupo sin existencias -> retorna 0 cajas sin error
// --------------------------------------------------------------------------
runTest('Caso 6: Grupo sin existencias -> retorna 0 cajas sin error', () => {
  const repo = new InMemoryRepository();
  repo.saveStockActual([]); // Stock vacío

  const queryService = new StockQueryService({ repository: repo });

  // Grupo que existe en configuración pero tiene 0 stock
  const stockEps = queryService.obtenerStockPorGrupo('EPS');
  assert.deepStrictEqual(stockEps, []);

  const detalleEps = queryService.obtenerDetalleGrupo('EPS');
  assert.strictEqual(detalleEps.grupo, 'EPS');
  assert.strictEqual(detalleEps.totalCajas, 0);
  assert.strictEqual(detalleEps.cajas, 0);
  assert.strictEqual(detalleEps.totalLineas, 0);
  assert.deepStrictEqual(detalleEps.lineas, []);

  // Grupo que ni siquiera existe en configuración
  const detalleInexistente = queryService.obtenerDetalleGrupo('GRUPO_TOTALMENTE_FANTASMA');
  assert.strictEqual(detalleInexistente.totalCajas, 0);
  assert.strictEqual(detalleInexistente.totalLineas, 0);
  assert.deepStrictEqual(detalleInexistente.lineas, []);
});

// --------------------------------------------------------------------------
// TEST 7: Inexistencia de grupo no altera el stock subyacente
// --------------------------------------------------------------------------
runTest('Caso 7: Inexistencia de grupo no altera el stock subyacente', () => {
  const repo = new InMemoryRepository();
  repo.saveStockActual([
    {
      stock_key: '2112000|EPS104',
      codigo_articulo: '2112000',
      nombre_articulo: 'TOMATE ROSA I',
      codigo_envase: 'EPS104',
      descripcion_envase: 'EPS 104',
      cajas_actuales: 85
    }
  ]);

  // Vaciamos por completo la tabla de grupos
  repo.saveGruposEnvase([]);

  const queryService = new StockQueryService({ repository: repo });
  const stock = queryService.obtenerStockActual();

  assert.strictEqual(stock.length, 1);
  assert.strictEqual(stock[0].cajas_actuales, 85, 'El saldo físico de 85 cajas se mantiene intacto');
  assert.strictEqual(stock[0].grupo_envase, 'SIN_CLASIFICAR');

  // Comprobar que en la base de datos física no se modificó cajas_actuales
  const stockRepo = repo.getStockActual();
  assert.strictEqual(stockRepo[0].cajas_actuales, 85);
});

// --------------------------------------------------------------------------
// TEST 8: Consulta por grupo devuelve únicamente las líneas correspondientes
// --------------------------------------------------------------------------
runTest('Caso 8: Consulta por grupo devuelve únicamente las líneas correspondientes', () => {
  const repo = new InMemoryRepository();
  repo.saveStockActual([
    { stock_key: '2112000|EPS104', codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas_actuales: 80 },
    { stock_key: '2112001|EPS106', codigo_articulo: '2112001', codigo_envase: 'EPS106', cajas_actuales: 70 },
    { stock_key: '2112003|EPS154', codigo_articulo: '2112003', codigo_envase: 'EPS154', cajas_actuales: 50 },
    { stock_key: '2112004|CARTON', codigo_articulo: '2112004', codigo_envase: 'CARTON', cajas_actuales: 90 },
    { stock_key: '2112005|CT4395', codigo_articulo: '2112005', codigo_envase: 'CT4395', cajas_actuales: 60 }
  ]);

  const queryService = new StockQueryService({ repository: repo });

  // Consulta grupo EPS (debe retornar 3 líneas: EPS104, EPS106, EPS154)
  const stockEps = queryService.obtenerStockPorGrupo('EPS');
  assert.strictEqual(stockEps.length, 3);
  const totalEps = stockEps.reduce((acc, l) => acc + l.cajas_actuales, 0);
  assert.strictEqual(totalEps, 200, 'EPS total debe ser 80 + 70 + 50 = 200');
  assert.ok(stockEps.every(l => l.grupo_envase === 'EPS'));

  // Consulta grupo JAPONÉS CARTÓN (debe retornar 2 líneas: CARTON, CT4395)
  const stockCarton = queryService.obtenerStockPorGrupo('JAPONÉS CARTÓN');
  assert.strictEqual(stockCarton.length, 2);
  const totalCarton = stockCarton.reduce((acc, l) => acc + l.cajas_actuales, 0);
  assert.strictEqual(totalCarton, 150, 'JAPONÉS CARTÓN total debe ser 90 + 60 = 150');
  assert.ok(stockCarton.every(l => l.grupo_envase === 'JAPONÉS CARTÓN'));

  // Resumen por grupos
  const resumen = queryService.obtenerResumenPorGrupos();
  const resEps = resumen.find(r => r.grupo === 'EPS');
  const resCarton = resumen.find(r => r.grupo === 'JAPONÉS CARTÓN');
  assert.strictEqual(resEps.totalCajas, 200);
  assert.strictEqual(resCarton.totalCajas, 150);
});

// --------------------------------------------------------------------------
// TEST 9: Consumo FIFO independiente del grupo
// --------------------------------------------------------------------------
runTest('Caso 9: Consumo FIFO independiente del grupo', () => {
  const repo = new InMemoryRepository();
  const movementService = crearMovementService(repo);

  // Entrada 1: 50 cajas el día 2026-09-01
  movementService.registrarEntrada({
    id_documento: 'DOC-FIFO-1',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '1',
    fecha_documento: '2026-09-01'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 50, partida: 'P1' }], 'OP');

  // Entrada 2: 50 cajas el día 2026-09-02
  movementService.registrarEntrada({
    id_documento: 'DOC-FIFO-2',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '2',
    fecha_documento: '2026-09-02'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 50, partida: 'P2' }], 'OP');

  // Salida: 30 cajas
  movementService.registrarSalida({
    id_documento: 'DOC-FIFO-3',
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '1',
    fecha_documento: '2026-09-05'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 30 }], 'OP');

  const capas = repo.getCapasFifo();
  assert.strictEqual(capas.length, 2);
  assert.strictEqual(capas[0].partida, 'P1');
  assert.strictEqual(capas[0].cajas_consumidas, 30, 'Capa 1 debe tener 30 consumidas por FIFO estricto');
  assert.strictEqual(capas[0].cajas_restantes, 20);
  assert.strictEqual(capas[1].partida, 'P2');
  assert.strictEqual(capas[1].cajas_consumidas, 0, 'Capa 2 debe permanecer intacta (50 restantes)');
  assert.strictEqual(capas[1].cajas_restantes, 50);

  // Comprobar que en MOVIMIENTOS y CAPAS_FIFO no se registra ni altera por grupo
  const movs = repo.getMovimientos();
  movs.forEach(m => {
    assert.strictEqual(m.grupo_envase, undefined, 'MOVIMIENTOS no debe contener columna de grupo');
  });
});

// --------------------------------------------------------------------------
// TEST 10: rebuildStock() no depende de grupos
// --------------------------------------------------------------------------
runTest('Caso 10: rebuildStock() no depende de grupos', () => {
  const repo = new InMemoryRepository();
  const movementService = crearMovementService(repo);

  // Registrar movimientos en el sistema
  movementService.registrarEntrada({
    id_documento: 'DOC-RB-1', tipo_documento: 'COMPRA', serie: 'ACT26', numero: '1', fecha_documento: '2026-09-10'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100 },
    { codigo_articulo: '2112004', codigo_envase: 'CARTON', cajas: 60 }
  ], 'OP');

  const waitTick = () => { const start = Date.now(); while (Date.now() - start < 10) {} };
  waitTick();

  movementService.registrarSalida({
    id_documento: 'DOC-RB-2', tipo_documento: 'SALIDA', serie: 'AVT26', numero: '1', fecha_documento: '2026-09-15'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 35 }
  ], 'OP');

  // Corromper o vaciar STOCK_ACTUAL manualmente
  repo.saveStockActual([]);
  assert.strictEqual(repo.getStockActual().length, 0);

  // Ejecutar rebuildStock()
  const resRebuild = movementService.rebuildStock();
  assert.strictEqual(resRebuild.success, true);
  assert.strictEqual(resRebuild.report.isConsistent, true);
  assert.strictEqual(resRebuild.report.totalCajasPorStock, 125);

  // Verificar que STOCK_ACTUAL fue reconstruido con éxito
  const stockReconstruido = repo.getStockActual();
  assert.strictEqual(stockReconstruido.length, 2);

  // Consultar a través de StockQueryService el stock reconstruido
  const queryService = new StockQueryService({ repository: repo });
  const detalleEps = queryService.obtenerDetalleGrupo('EPS');
  assert.strictEqual(detalleEps.totalCajas, 65, 'Rebuild: 100 - 35 = 65 cajas en EPS');

  const detalleCarton = queryService.obtenerDetalleGrupo('JAPONÉS CARTÓN');
  assert.strictEqual(detalleCarton.totalCajas, 60, 'Rebuild: 60 cajas en CARTON');

  // Consultar detalle específico
  const itemDetalle = queryService.obtenerDetalleStock('2112000', 'EPS104');
  assert.ok(itemDetalle);
  assert.strictEqual(itemDetalle.cajas_actuales, 65);
  assert.strictEqual(itemDetalle.grupo_envase, 'EPS');
});

console.log('\n================================================================');
console.log(` RESULTADOS CONSULTA Y AGRUPACIÓN: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
