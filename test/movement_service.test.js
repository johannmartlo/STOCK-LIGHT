/**
 * STOCK-LIGHT — Test Suite de Integración: MovementService
 * Ejecutable localmente con Node.js: `node test/movement_service.test.js`
 */

const assert = require('assert');
const { MovementService } = require('../src/MovementService');
const {
  buildStockKey,
  processMovement,
  rebuildStockFromMovements
} = require('../src/InventoryEngine');
const {
  checkDocumentDuplicate,
  buildDocumentIdentityKey,
  buildLineIdentityKey,
  filterBatchForOverlaps
} = require('../src/DeduplicationService');

/**
 * Mock en memoria de SheetsRepository para pruebas rápidas aisladas.
 */
class InMemoryRepository {
  constructor() {
    this.maestro = [
      { codigo_articulo: '2112000', codigo_envase: 'EPS104', nombre_articulo: 'TOMATE ROSA M', descripcion_envase: 'EPS 104' },
      { codigo_articulo: '2112000', codigo_envase: 'EPS106', nombre_articulo: 'TOMATE ROSA M', descripcion_envase: 'EPS 106 9x500' }
    ];
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
}

/**
 * Mock de LockService
 */
class MockLock {
  constructor() {
    this.isLocked = false;
  }
  waitLock() { this.isLocked = true; return true; }
  releaseLock() { this.isLocked = false; }
}

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${e.message}`);
    failed++;
  }
}

console.log('====================================================');
console.log(' INICIANDO TESTS DE INTEGRACIÓN: MOVEMENT SERVICE');
console.log('====================================================\n');

runTest('MovementService: Registrar Entrada incrementa stock y crea capas', () => {
  const repo = new InMemoryRepository();
  const lock = new MockLock();
  const service = new MovementService({
    repository: repo,
    lockService: lock,
    deduplicationService: { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps },
    inventoryEngine: { buildStockKey, processMovement, rebuildStockFromMovements }
  });

  const res = service.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '101',
    fecha_documento: '2026-09-22',
    entidad_nombre: 'AGRICULTOR ALHAMBRA'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100 }
  ], 'operador1@almacen.com');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.totalCajas, 100);
  assert.strictEqual(repo.documentos.length, 1);
  assert.strictEqual(repo.movimientos.length, 1);
  assert.strictEqual(repo.capasFifo.length, 1);
  assert.strictEqual(repo.stockActual[0].cajas_actuales, 100);
  assert.strictEqual(repo.stockActual[0].nombre_articulo, 'TOMATE ROSA M');
});

runTest('MovementService: Registrar Salida deduce capas y stock', () => {
  const repo = new InMemoryRepository();
  const lock = new MockLock();
  const service = new MovementService({
    repository: repo,
    lockService: lock,
    deduplicationService: { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps },
    inventoryEngine: { buildStockKey, processMovement, rebuildStockFromMovements }
  });

  // Entrada inicial
  service.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '101',
    fecha_documento: '2026-09-22'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100 }]);

  // Salida de 40 cajas
  const resSalida = service.registrarSalida({
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '501',
    fecha_documento: '2026-09-23',
    entidad_nombre: 'HERMANOS MONTES'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 40 }]);

  assert.strictEqual(resSalida.success, true);
  assert.strictEqual(resSalida.totalCajas, 40);
  assert.strictEqual(repo.stockActual[0].cajas_actuales, 60);
  assert.strictEqual(repo.capasFifo[0].cajas_restantes, 60);
});

runTest('MovementService: Salida con stock insuficiente frena mutación y marca PENDIENTE_REVISION', () => {
  const repo = new InMemoryRepository();
  const lock = new MockLock();
  const service = new MovementService({
    repository: repo,
    lockService: lock,
    deduplicationService: { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps },
    inventoryEngine: { buildStockKey, processMovement, rebuildStockFromMovements }
  });

  // Entrada de 50
  service.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '101',
    fecha_documento: '2026-09-22'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 50 }]);

  // Intento de salida de 80 (Déficit de 30)
  const resSalida = service.registrarSalida({
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '502',
    fecha_documento: '2026-09-23'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 80 }]);

  assert.strictEqual(resSalida.success, false);
  assert.strictEqual(resSalida.status, 'PENDIENTE_REVISION');
  assert.strictEqual(resSalida.errorCode, 'STOCK_INSUFICIENTE');
  assert.strictEqual(resSalida.deficits[0].deficit, 30);

  // Stock debe permanecer intacto en 50
  assert.strictEqual(repo.stockActual[0].cajas_actuales, 50);
  assert.strictEqual(repo.capasFifo[0].cajas_restantes, 50);

  // El documento debe figurar en DOCUMENTOS como PENDIENTE_REVISION
  const docPendiente = repo.documentos.find(d => d.numero === '502');
  assert.strictEqual(docPendiente.estado_proceso, 'PENDIENTE_REVISION');
});

runTest('MovementService: rebuildStock recalcula capas y stock desde cero con fidelidad matemática', () => {
  const repo = new InMemoryRepository();
  const lock = new MockLock();
  const service = new MovementService({
    repository: repo,
    lockService: lock,
    deduplicationService: { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps },
    inventoryEngine: { buildStockKey, processMovement, rebuildStockFromMovements }
  });

  // Operaciones normales
  service.registrarEntrada({ tipo_documento: 'COMPRA', serie: 'ACT26', numero: '1', fecha_documento: '2026-09-20' },
    [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100 }]);
  service.registrarEntrada({ tipo_documento: 'COMPRA', serie: 'ACT26', numero: '2', fecha_documento: '2026-09-21' },
    [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 176 }]);
  service.registrarSalida({ tipo_documento: 'SALIDA', serie: 'AVT26', numero: '10', fecha_documento: '2026-09-22' },
    [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 150 }]);
  service.registrarAjuste({
    codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 5, signo: -1, motivo: 'MERMA', observaciones: 'Rotura'
  });

  // Estado esperado antes de rebuild: 100 + 176 - 150 - 5 = 121
  assert.strictEqual(repo.stockActual[0].cajas_actuales, 121);

  // Simulamos corrupción manual en la vista materializada de stock
  repo.stockActual[0].cajas_actuales = 999;
  repo.capasFifo = []; // Borramos capas

  // Ejecutamos rebuild
  const rebuildRes = service.rebuildStock();
  assert.strictEqual(rebuildRes.success, true);
  assert.strictEqual(rebuildRes.report.isConsistent, true);
  assert.strictEqual(rebuildRes.report.totalCajasPorStock, 121);
  assert.strictEqual(repo.stockActual[0].cajas_actuales, 121);
});

console.log('\n====================================================');
console.log(` RESULTADOS INTEGRACIÓN: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('====================================================\n');

if (failed > 0) {
  process.exit(1);
}
