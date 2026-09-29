/**
 * STOCK-LIGHT — Test Suite: Cierre del Trust Boundary del Backend
 * Ejecutable con Node.js: `node test/trust_boundary.test.js`
 * 
 * Verifica rigurosamente que el cliente / navegador NO tenga autoridad sobre:
 * - Código de artículo
 * - Código de envase
 * - Cantidad de cajas
 * - Tipo documental (bloqueo estricto de RECEPCION)
 * - Validez del documento
 * Y que la confirmación dependa exclusivamente de la entrada canónica (rawText + fileMeta).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { confirmarDocumentoRevisado, revisarDocumentoHispatec } = require('../src/Código');
const { MaestroResolver } = require('../src/MaestroResolver');
const { DocumentValidator } = require('../src/DocumentValidator');
const { DocumentParserRegistry } = require('../src/parsers/DocumentParserRegistry');
const { MovementService } = require('../src/MovementService');

console.log('================================================================');
console.log(' TEST SUITE FASE 3 / PASO 1 — CIERRE DEL TRUST BOUNDARY');
console.log('================================================================\n');

// 1. Cargar Maestro Oficial
const maestroPath = path.join(__dirname, '..', 'docs', 'reference', 'MAESTRO_BASE.json');
const maestroData = JSON.parse(fs.readFileSync(maestroPath, 'utf8'));

// 2. Mock en memoria para aislar la persistencia durante el test
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

const {
  checkDocumentDuplicate,
  buildDocumentIdentityKey,
  buildLineIdentityKey,
  filterBatchForOverlaps
} = require('../src/DeduplicationService');

const {
  buildStockKey,
  processMovement,
  rebuildStockFromMovements
} = require('../src/InventoryEngine');

function createTestEnvironment() {
  const repo = new InMemoryRepository(maestroData);
  const resolver = new MaestroResolver(maestroData);
  const dedupService = { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps };
  const engineService = { buildStockKey, processMovement, rebuildStockFromMovements };
  const validator = new DocumentValidator({ maestroResolver: resolver, deduplicationService: dedupService });
  const registry = new DocumentParserRegistry({ validator, maestroResolver: resolver });
  const lock = new MockLock();
  const movementService = new MovementService({
    repository: repo,
    lockService: lock,
    deduplicationService: dedupService,
    inventoryEngine: engineService
  });

  return {
    repo,
    resolver,
    validator,
    registry,
    movementService,
    options: {
      repository: repo,
      maestroResolver: resolver,
      validator,
      registry,
      lockService: lock,
      movementService,
      deduplicationService: dedupService,
      inventoryEngine: engineService
    }
  };
}

const samplesDir = path.join(__dirname, '..', 'docs', 'samples');
const rawTextCompra3089 = fs.readFileSync(path.join(samplesDir, 'ALBARAN DE COMPRA POR PARTIDAS.pdf.extracted.txt'), 'utf8');
const rawTextRecepcion = fs.readFileSync(path.join(samplesDir, 'ENTRADA RECEPCION.pdf.extracted.txt'), 'utf8');

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
// TEST A: Cliente intenta alterar el artículo respecto al documento canónico
// --------------------------------------------------------------------------
runTest('A. Cliente altera artículo -> servidor rechaza dato alterado y extrae el canónico', () => {
  const env = createTestEnvironment();

  // Caso A1: Cliente intenta enviar un objeto manipulado SIN rawText
  assert.throws(() => {
    confirmarDocumentoRevisado({
      documentType: 'COMPRA',
      lines: [{ articleCode: 'ARTICULO_HACKEADO', envaseCode: 'DEFAULT', boxes: 240 }]
    }, 'OPERADOR', env.options);
  }, /Trust Boundary violado: La confirmación requiere la entrada canónica original/);

  // Caso A2: Cliente envía la entrada canónica pero acompaña líneas falsas en el payload
  const result = confirmarDocumentoRevisado({
    rawText: rawTextCompra3089,
    fileMeta: { fileName: 'COMPRA_3089.pdf', fileId: 'DOC-CANONICAL-A' },
    manipulatedLines: [{ articleCode: 'ARTICULO_HACKEADO', boxes: 240 }]
  }, 'OPERADOR', env.options);

  assert.strictEqual(result.success, true);
  // El movimiento en la base de datos debe ser el código oficial canónico ('2112004'), NUNCA 'ARTICULO_HACKEADO'
  const mov = env.repo.movimientos[0];
  assert.strictEqual(mov.codigo_articulo, '2112004');
  assert.notStrictEqual(mov.codigo_articulo, 'ARTICULO_HACKEADO');
});

// --------------------------------------------------------------------------
// TEST B: Cliente intenta alterar el envase
// --------------------------------------------------------------------------
runTest('B. Cliente altera envase -> servidor ignora envase alterado y extrae el canónico', () => {
  const env = createTestEnvironment();

  const result = confirmarDocumentoRevisado({
    rawText: rawTextCompra3089,
    fileMeta: { fileName: 'COMPRA_3089.pdf', fileId: 'DOC-CANONICAL-B' },
    manipulatedEnvase: 'ENVASE_INEXISTENTE_999'
  }, 'OPERADOR', env.options);

  assert.strictEqual(result.success, true);
  const mov = env.repo.movimientos[0];
  // El envase debe ser DEFAULT según el documento canónico de ACT26/3089
  assert.strictEqual(mov.codigo_envase, 'DEFAULT');
  assert.notStrictEqual(mov.codigo_envase, 'ENVASE_INEXISTENTE_999');
});

// --------------------------------------------------------------------------
// TEST C: Cliente intenta alterar la cantidad de cajas (ej. 9999 cajas)
// --------------------------------------------------------------------------
runTest('C. Cliente altera cajas (9999) -> servidor aplica estrictamente cajas canónicas (240)', () => {
  const env = createTestEnvironment();

  const result = confirmarDocumentoRevisado({
    rawText: rawTextCompra3089,
    fileMeta: { fileName: 'COMPRA_3089.pdf', fileId: 'DOC-CANONICAL-C' },
    cajas: 9999
  }, 'OPERADOR', env.options);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.totalCajas, 240); // 240 cajas reales
  assert.notStrictEqual(result.totalCajas, 9999);

  const mov = env.repo.movimientos[0];
  assert.strictEqual(mov.cajas, 240);

  const stock = env.repo.stockActual.find(s => s.stock_key === '2112004|DEFAULT');
  assert.ok(stock, 'Debe existir registro en stockActual para 2112004|DEFAULT');
  assert.strictEqual(stock.cajas_actuales, 240);
});

// --------------------------------------------------------------------------
// TEST D: Cliente intenta alterar documentType a RECEPCION
// --------------------------------------------------------------------------
runTest('D. Cliente intenta colar RECEPCION -> servidor bloquea antes de MovementService', () => {
  const env = createTestEnvironment();

  // Si envía texto de recepción: el registry no tiene RecepcionParser activo
  assert.throws(() => {
    confirmarDocumentoRevisado({
      rawText: rawTextRecepcion,
      fileMeta: { fileName: 'RECEPCION.pdf' }
    }, 'OPERADOR', env.options);
  }, /No se reconoció el tipo de documento Hispatec dentro del MVP activo/);

  // Cero documentos y cero movimientos registrados
  assert.strictEqual(env.repo.documentos.length, 0);
  assert.strictEqual(env.repo.movimientos.length, 0);
});

// --------------------------------------------------------------------------
// TEST E: Documento inválido / descuadre físico de bultos no llega a MovementService
// --------------------------------------------------------------------------
runTest('E. Documento con descuadre de bultos -> bloqueo antes de MovementService (0 movimientos)', () => {
  const env = createTestEnvironment();

  // Documento real donde se altera el total de bultos del pie para provocar descuadre físico
  const txtDescuadre = rawTextCompra3089.replace(' 240\n 720,00', ' 999\n 720,00');

  assert.throws(() => {
    confirmarDocumentoRevisado({
      rawText: txtDescuadre,
      fileMeta: { fileName: 'DESCUADRE.pdf' }
    }, 'OPERADOR', env.options);
  }, /Trust Boundary violado: No se puede confirmar un documento no válido/);

  // Comprobación de integridad: nada escrito en la BD
  assert.strictEqual(env.repo.documentos.length, 0);
  assert.strictEqual(env.repo.movimientos.length, 0);
  assert.strictEqual(env.repo.stockActual.length, 0);
});

// --------------------------------------------------------------------------
// TEST F: Documento duplicado genera 0 movimientos nuevos
// --------------------------------------------------------------------------
runTest('F. Documento duplicado -> servidor lo rechaza con 0 movimientos nuevos', () => {
  const env = createTestEnvironment();

  // Confirmar por primera vez
  const r1 = confirmarDocumentoRevisado({
    rawText: rawTextCompra3089,
    fileMeta: { fileName: 'COMPRA_3089.pdf', fileId: 'DOC-DUPE-TEST', sha256Hash: 'hash3089' }
  }, 'OPERADOR', env.options);
  assert.strictEqual(r1.success, true);
  assert.strictEqual(env.repo.movimientos.length, 1);

  // Intentar confirmar exactamente el mismo documento de nuevo
  assert.throws(() => {
    confirmarDocumentoRevisado({
      rawText: rawTextCompra3089,
      fileMeta: { fileName: 'COMPRA_3089_COPIA.pdf', fileId: 'DOC-DUPE-TEST-2', sha256Hash: 'hash3089' }
    }, 'OPERADOR', env.options);
  }, /Trust Boundary violado: No se puede confirmar un documento no válido o en revisión. Estado: DUPLICADO/);

  // Garantía absoluta: sigue habiendo exactamente 1 movimiento, 0 movimientos nuevos
  assert.strictEqual(env.repo.movimientos.length, 1);
  assert.strictEqual(env.repo.stockActual.find(s => s.stock_key === '2112004|DEFAULT').cajas_actuales, 240);
});

// --------------------------------------------------------------------------
// TEST G: Documento válido sigue funcionando con exactitud canónica
// --------------------------------------------------------------------------
runTest('G. Documento válido -> confirmación canónica exitosa y stock actualizado', () => {
  const env = createTestEnvironment();

  const res = confirmarDocumentoRevisado(rawTextCompra3089, {
    fileName: 'COMPRA_3089.pdf',
    fileId: 'DOC-VALID-001',
    sha256Hash: 'valid_hash_001'
  }, 'OPERADOR', env.options);

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.status, 'CONFIRMADO');
  assert.strictEqual(res.totalCajas, 240);
  assert.strictEqual(res.lineasProcesadas, 1);
  assert.strictEqual(env.repo.movimientos.length, 1);
  assert.strictEqual(env.repo.stockActual[0].cajas_actuales, 240);
});

console.log('\n================================================================');
console.log(` RESULTADOS TRUST BOUNDARY: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
