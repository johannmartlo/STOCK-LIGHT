/**
 * STOCK-LIGHT — Test Suite: Resolución Controlada de Envases en Albaranes de Compra (Muestra Real)
 * Ejecutable con Node.js: `node test/manual/compra_packaging_resolution_real.test.js`
 * 
 * Caso 1: Compra con envase determinista (regla homologada aislada -> confirmación y stock normal).
 * Requiere PDF real extraído en docs/samples/.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { MaestroResolver, DETERMINISTIC_COMPRA_RULES } = require('../../src/MaestroResolver');
const { DocumentValidator } = require('../../src/DocumentValidator');
const { DocumentParserRegistry } = require('../../src/parsers/DocumentParserRegistry');
const { MovementService } = require('../../src/MovementService');
const { CompraParser } = require('../../src/parsers/CompraParser');
const { SalidaParser } = require('../../src/parsers/SalidaParser');
const { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps } = require('../../src/DeduplicationService');
const { buildStockKey, processMovement, rebuildStockFromMovements } = require('../../src/InventoryEngine');

console.log('================================================================');
console.log(' TEST SUITE — RESOLUCIÓN CONTROLADA DE ENVASES EN COMPRAS (REAL)');
console.log('================================================================\n');

// 1. Cargar Maestro Oficial de Referencia
const maestroPath = path.join(__dirname, '..', '..', 'docs', 'reference', 'MAESTRO_BASE.json');
const maestroData = JSON.parse(fs.readFileSync(maestroPath, 'utf8'));

// Repositorio en memoria para pruebas
class InMemoryRepository {
  constructor(maestro = []) {
    this.maestro = maestro;
    this.documentos = [];
    this.movimientos = [];
    this.capasFifo = [];
    this.stockActual = [];
  }

  getDocumentos() { return [...this.documentos]; }
  appendDocumento(doc) { this.documentos.push({ ...doc }); return 1; }
  updateDocumentoEstado(idDocumento, nuevoEstado) {
    const doc = this.documentos.find(d => String(d.id_documento || '').trim() === String(idDocumento).trim());
    if (!doc) throw new Error(`Documento con ID '${idDocumento}' no encontrado.`);
    doc.estado_proceso = nuevoEstado;
    return 1;
  }
  replaceTable(tableName, records) {
    if (tableName === 'DOCUMENTOS') this.documentos = records.map(r => ({ ...r }));
    if (tableName === 'CAPAS_FIFO') this.capasFifo = records.map(r => ({ ...r }));
    if (tableName === 'STOCK_ACTUAL') this.stockActual = records.map(r => ({ ...r }));
    return records.length;
  }
  getMovimientos() { return [...this.movimientos]; }
  appendMovimientos(movs) { movs.forEach(m => this.movimientos.push({ ...m })); return movs.length; }
  getCapasFifo() { return [...this.capasFifo]; }
  saveCapasFifo(capas) { this.capasFifo = capas.map(c => ({ ...c })); return capas.length; }
  getStockActual() { return [...this.stockActual]; }
  saveStockActual(records) { this.stockActual = records.map(r => ({ ...r })); return records.length; }
  getMaestro() { return [...this.maestro]; }
}

class MockLock {
  waitLock() { return true; }
  releaseLock() {}
}

function createEnv() {
  const repo = new InMemoryRepository(maestroData);
  const resolver = new MaestroResolver(maestroData);
  const dedupService = { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps };
  const engineService = { buildStockKey, processMovement, rebuildStockFromMovements };
  const validator = new DocumentValidator({ maestroResolver: resolver, deduplicationService: dedupService });
  const registry = new DocumentParserRegistry({ validator, maestroResolver: resolver });
  const movementService = new MovementService({
    repository: repo,
    lockService: new MockLock(),
    deduplicationService: dedupService,
    inventoryEngine: engineService
  });

  return { repo, resolver, validator, registry, movementService };
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
    failed++;
  }
}

// --------------------------------------------------------------------------
// TEST 1: Compra con envase determinista (regla homologada aislada)
// --------------------------------------------------------------------------
runTest('1. Compra con envase determinista -> resuelve envase, crea movimiento y capa FIFO', () => {
  const env = createEnv();

  // Albarán con TOMATE MORESCO I M (78 cajas) y TOMATE MORESCO I MM (6 cajas)
  // Reglas deterministas: CT4395 y CT4395MAD
  const txtCompra = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'samples', 'COMPRAS', 'COMPRA 3026.pdf.extracted.txt'), 'utf8');

  const review = env.registry.reviewDocument(txtCompra, {
    fileMeta: { fileName: 'COMPRA 3026.pdf', sha256Hash: 'hash_c_3026' }
  });

  assert.strictEqual(review.estadoValidacion, 'VALIDO');
  assert.strictEqual(review.aptoParaConfirmar, true);
  assert.strictEqual(review.totalCajasDetectadas, 231);
  assert.strictEqual(review.lineasDetectadas.length, 4);

  // Línea 1: TOMATE MORESCO I M -> CT4395
  assert.strictEqual(review.lineasDetectadas[0].codigoEnvase, 'CT4395');
  assert.strictEqual(review.lineasDetectadas[0].cajas, 78);
  // Línea 4: TOMATE MORESCO I MM -> CT4395MAD
  assert.strictEqual(review.lineasDetectadas[3].codigoEnvase, 'CT4395MAD');
  assert.strictEqual(review.lineasDetectadas[3].cajas, 6);

  // Registrar la entrada
  const result = env.movementService.registrarEntrada({
    id_documento: 'DOC-COMPRA-3026',
    sha256_hash: 'hash_c_3026',
    tipo_documento: 'COMPRA',
    serie: review.serie,
    numero: review.numero,
    fecha_documento: review.fecha,
    entidad_nombre: review.entidad
  }, review.lineasDetectadas.map(l => ({
    codigo_articulo: l.codigoArticulo,
    codigo_envase: l.codigoEnvase,
    cajas: l.cajas,
    partida: l.partida,
    nombre_articulo: l.nombreArticulo
  })), 'OPERADOR');

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.status, 'CONFIRMADO');
  assert.strictEqual(result.totalCajas, 231);

  // Verificar persistencia en DOCUMENTOS
  const docs = env.repo.getDocumentos();
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].estado_proceso, 'CONFIRMADO');

  // Verificar movimientos
  const movs = env.repo.getMovimientos();
  assert.strictEqual(movs.length, 4);
  assert.strictEqual(movs[0].codigo_envase, 'CT4395');
  assert.strictEqual(movs[3].codigo_envase, 'CT4395MAD');

  // Verificar capas FIFO
  const capas = env.repo.getCapasFifo();
  assert.strictEqual(capas.length, 4);
  assert.strictEqual(capas[0].codigo_articulo, '2112005');
  assert.strictEqual(capas[0].codigo_envase, 'CT4395');

  // Verificar STOCK_ACTUAL
  const stock = env.repo.getStockActual();
  const stockMoresco = stock.find(s => s.stock_key === '2112005|CT4395');
  assert.ok(stockMoresco);
  assert.strictEqual(stockMoresco.cajas_actuales, 225); // 78 + 131 + 16
});

console.log('\n================================================================');
console.log(` RESULTADOS RESOLUCIÓN ENVASES REAL: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
