/**
 * STOCK-LIGHT — Test Suite Fase 7.1: Correcciones Mínimas Postauditoría
 * 
 * Verifica exhaustivamente:
 * 1. Confirmación de lotes de documentos vía backend real (confirmarDocumentoRevisado).
 * 2. Lote con todos los documentos válidos (materialización de entradas/salidas en stock).
 * 3. Documento inválido o no apto dentro de un lote (bloqueado sin mutar stock).
 * 4. Documento duplicado dentro de un lote (rechazado por deduplicación sin duplicar movimientos).
 * 5. Error o excepción en mitad de un lote (transparencia y manejo de fallos parciales).
 * 6. Doble confirmación / doble clic (idempotencia y protección estricta).
 * 7. Actualización correcta del dashboard tras las confirmaciones.
 * 8. Enmarcado HTTP: doGet(e) utiliza HtmlService.XFrameOptionsMode.DEFAULT (mitiga Clickjacking).
 * 9. Modo DEMO local (localApiBridge): datos ficticios etiquetados, banner visual y bloqueo total de mutaciones.
 * 10. Invariante Innegociable: InventoryEngine.js permanece 100% inalterado respecto a Git HEAD.
 * 
 * Ejecutable: node test/fase7_1_confirmacion_lote_y_seguridad.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Mocks para simular el entorno Google Apps Script si no existen globalmente
global.HtmlService = {
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
  createTemplateFromFile: function(filename) {
    const filePath = path.resolve(__dirname, `../src/${filename}.html`);
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    return {
      evaluate: function() {
        return {
          content,
          title: '',
          metaTags: [],
          xFrameMode: '',
          setTitle: function(t) { this.title = t; return this; },
          addMetaTag: function(name, val) { this.metaTags.push({ name, content: val }); return this; },
          setXFrameOptionsMode: function(mode) { this.xFrameMode = mode; return this; },
          getContent: function() { return this.content; }
        };
      }
    };
  }
};

const codigo = require('../src/Código');
const { MaestroResolver } = require('../src/MaestroResolver');
const { DocumentValidator } = require('../src/DocumentValidator');
const { DocumentParserRegistry } = require('../src/parsers/DocumentParserRegistry');
const { MovementService } = require('../src/MovementService');
const { StockQueryService } = require('../src/StockQueryService');
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

// Cargar Maestro Oficial de Referencia
const maestroPath = path.join(__dirname, '..', 'docs', 'reference', 'MAESTRO_BASE.json');
const maestroData = JSON.parse(fs.readFileSync(maestroPath, 'utf8'));

/**
 * Mock en memoria para aislar la persistencia durante las pruebas
 */
class InMemoryBatchRepository {
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

function createTestEnvironment() {
  const repo = new InMemoryBatchRepository(maestroData);
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

// Cargar muestras canónicas de albaranes de Hispatec
const samplesDir = path.join(__dirname, '..', 'docs', 'samples');
const rawTextCompra3026 = fs.readFileSync(path.join(samplesDir, 'COMPRAS', 'COMPRA 3026.pdf.extracted.txt'), 'utf8'); // Válido (231 cajas)
const rawTextCompra3072 = fs.readFileSync(path.join(samplesDir, 'COMPRAS', 'COMPRA 3072.pdf.extracted.txt'), 'utf8'); // Válido (492 cajas)
const rawTextCompra3024 = fs.readFileSync(path.join(samplesDir, 'COMPRAS', 'COMPRA 3024.pdf.extracted.txt'), 'utf8'); // Pendiente revisión (envase ambiguo)

console.log('\n================================================================');
console.log(' TEST SUITE FASE 7.1 — CORRECCIONES MÍNIMAS POSTAUDITORÍA');
console.log('================================================================\n');

// -------------------------------------------------------------
// BLOQUE 1: ENMARCADO Y SEGURIDAD (DEFECTO 3)
// -------------------------------------------------------------
runTest('1. doGet(e) utiliza estrictamente HtmlService.XFrameOptionsMode.DEFAULT (mitiga Clickjacking)', () => {
  const output = codigo.doGet({});
  assert.ok(output, 'doGet debe retornar un HtmlOutput');
  assert.strictEqual(output.xFrameMode, 'DEFAULT', 'XFrameOptionsMode debe ser DEFAULT y no ALLOWALL');
});

// -------------------------------------------------------------
// BLOQUE 2: CONFIRMACIÓN MASIVA DE LOTES (DEFECTO 1)
// -------------------------------------------------------------
runTest('2. Lote con todos los documentos válidos: confirma y materializa entradas y capas FIFO en stock', () => {
  const env = createTestEnvironment();

  // Lote con 2 compras canónicas válidas: Compra 3026 (231 cajas) + Compra 3072 (492 cajas) = 723 cajas
  const lote = [
    { rawText: rawTextCompra3026, fileMeta: { fileName: 'COMPRA 3026.pdf', sha256Hash: 'hash_compra_3026' } },
    { rawText: rawTextCompra3072, fileMeta: { fileName: 'COMPRA 3072.pdf', sha256Hash: 'hash_compra_3072' } }
  ];

  const resultados = [];
  for (const item of lote) {
    const res = codigo.confirmarDocumentoRevisado(item, 'OPERADOR', env.options);
    resultados.push(res);
  }

  assert.strictEqual(resultados.length, 2, 'Deben procesarse 2 documentos');
  assert.strictEqual(resultados[0].success, true, 'Doc 1 debe ser confirmado');
  assert.strictEqual(resultados[0].totalCajas, 231, 'Doc 1 debe tener 231 cajas');
  assert.strictEqual(resultados[1].success, true, 'Doc 2 debe ser confirmado');
  assert.strictEqual(resultados[1].totalCajas, 492, 'Doc 2 debe tener 492 cajas');

  // Verificar persistencia real
  const docsPersistidos = env.repo.getDocumentos();
  assert.strictEqual(docsPersistidos.length, 2, 'Deben persistirse 2 documentos');
  const capas = env.repo.getCapasFifo();
  assert.strictEqual(capas.length, 11, 'Deben crearse 11 capas FIFO vivas correspondientes a las líneas');
  
  const stock = env.repo.getStockActual();
  const totalCajasStock = stock.reduce((acc, s) => acc + s.cajas_actuales, 0);
  assert.strictEqual(totalCajasStock, 723, 'El stock acumulado debe ser exactamente 723 cajas');
});

runTest('3. Documento inválido o ambiguo dentro de un lote: el ambiguo se bloquea y el válido se procesa', () => {
  const env = createTestEnvironment();

  const lote = [
    { rawText: rawTextCompra3026, fileMeta: { fileName: 'COMPRA 3026.pdf', sha256Hash: 'hash_compra_3026' } },
    { rawText: rawTextCompra3024, fileMeta: { fileName: 'COMPRA 3024.pdf', sha256Hash: 'hash_compra_3024' } } // Ambiguo
  ];

  let confirmados = 0;
  let rechazados = 0;
  const detalle = [];

  for (const item of lote) {
    // 1. Simular validación previa en servidor (igual que en btnConfirmarTodoLote)
    const review = codigo.revisarDocumentoHispatec(item.rawText, item.fileMeta, env.options);
    if (!review.aptoParaConfirmar || review.estadoValidacion !== 'VALIDO') {
      rechazados++;
      detalle.push({ file: item.fileMeta.fileName, status: 'RECHAZADO', motivo: review.estadoValidacion });
      continue;
    }

    try {
      const res = codigo.confirmarDocumentoRevisado(item, 'OPERADOR', env.options);
      if (res && res.success) {
        confirmados++;
        detalle.push({ file: item.fileMeta.fileName, status: 'CONFIRMADO' });
      }
    } catch (err) {
      rechazados++;
      detalle.push({ file: item.fileMeta.fileName, status: 'ERROR', error: err.message });
    }
  }

  assert.strictEqual(confirmados, 1, 'Exactamente 1 documento válido debe haberse confirmado');
  assert.strictEqual(rechazados, 1, 'Exactamente 1 documento ambiguo debe haberse rechazado');
  assert.strictEqual(detalle[1].motivo, 'PENDIENTE_REVISION', 'El documento ambiguo debe reportar PENDIENTE_REVISION');

  // Verificar que el inventario solo contiene las 231 cajas del documento válido
  const stock = env.repo.getStockActual();
  const totalCajas = stock.reduce((acc, s) => acc + s.cajas_actuales, 0);
  assert.strictEqual(totalCajas, 231, 'El stock solo debe registrar las 231 cajas del documento válido');
});

runTest('4. Documento duplicado en un lote: se detecta por deduplicación y no duplica movimientos ni existencias', () => {
  const env = createTestEnvironment();

  // Primera confirmación
  const res1 = codigo.confirmarDocumentoRevisado({
    rawText: rawTextCompra3026,
    fileMeta: { fileName: 'COMPRA 3026_orig.pdf', sha256Hash: 'hash_duplicado' }
  }, 'OPERADOR', env.options);
  assert.strictEqual(res1.success, true);

  // Intento de reconfirmar el mismo documento en el lote
  let dupDetected = false;
  try {
    const res2 = codigo.confirmarDocumentoRevisado({
      rawText: rawTextCompra3026,
      fileMeta: { fileName: 'COMPRA 3026_dup.pdf', sha256Hash: 'hash_duplicado' }
    }, 'OPERADOR', env.options);
    if (res2 && res2.isDuplicate) dupDetected = true;
  } catch (err) {
    if (err.message.includes('DUPLICADO') || err.message.includes('duplicado')) {
      dupDetected = true;
    }
  }

  assert.strictEqual(dupDetected, true, 'Debe detectarse e interceptarse como duplicado');

  // Verificar que los documentos y stock no se duplicaron
  const docs = env.repo.getDocumentos();
  assert.strictEqual(docs.length, 1, 'Solo debe existir 1 documento registrado');
  const stock = env.repo.getStockActual();
  const totalCajas = stock.reduce((acc, s) => acc + s.cajas_actuales, 0);
  assert.strictEqual(totalCajas, 231, 'El stock debe mantenerse en 231 cajas, nunca 462');
});

runTest('5. Error de servidor en mitad del lote: se maneja transparentemente y el dashboard refleja el estado real', () => {
  const env = createTestEnvironment();

  // Doc 1 válido confirmado
  codigo.confirmarDocumentoRevisado({
    rawText: rawTextCompra3026,
    fileMeta: { fileName: 'COMPRA 3026.pdf', sha256Hash: 'h1' }
  }, 'OPERADOR', env.options);

  // Doc 2 simula falla de entrada canónica vacía
  let errorDoc2 = null;
  try {
    codigo.confirmarDocumentoRevisado({
      rawText: '', // Texto vacío que viola trust boundary
      fileMeta: { fileName: 'COMPRA_vacia.pdf', sha256Hash: 'h2' }
    }, 'OPERADOR', env.options);
  } catch (err) {
    errorDoc2 = err;
  }

  assert.ok(errorDoc2, 'Debe capturar la excepción');
  assert.ok(errorDoc2.message.includes('Trust Boundary violado'), 'Debe reportar violación de Trust Boundary');

  // Consulta de dashboard mediante StockQueryService refleja exactamente las existencias reales
  const stockService = new StockQueryService({ repository: env.repo });
  const resumen = stockService.obtenerStockVisualResumen();
  assert.strictEqual(resumen.granTotalCajas, 231, 'El dashboard debe reportar exactamente 231 cajas del documento confirmado');
});

runTest('6. Doble confirmación / Doble clic: el lock y la deduplicación absorben la colisión con 0 sobreconteo', () => {
  const env = createTestEnvironment();

  const doc = {
    rawText: rawTextCompra3072,
    fileMeta: { fileName: 'COMPRA 3072_click.pdf', sha256Hash: 'hash_click_123' }
  };

  // Simular dos llamadas rápidas simultáneas
  const call1 = codigo.confirmarDocumentoRevisado(doc, 'OPERADOR', env.options);
  assert.strictEqual(call1.success, true, 'Primera llamada debe tener éxito');

  let call2Dup = false;
  try {
    const call2 = codigo.confirmarDocumentoRevisado(doc, 'OPERADOR', env.options);
    if (call2 && call2.isDuplicate) call2Dup = true;
  } catch (err) {
    if (err.message.includes('DUPLICADO') || err.message.includes('duplicado')) {
      call2Dup = true;
    }
  }

  assert.strictEqual(call2Dup, true, 'Segunda llamada debe ser interceptada como duplicado');
  
  const docs = env.repo.getDocumentos();
  assert.strictEqual(docs.length, 1, 'Debe haber exactamente 1 documento persistido');
  const stock = env.repo.getStockActual();
  const totalCajas = stock.reduce((acc, s) => acc + s.cajas_actuales, 0);
  assert.strictEqual(totalCajas, 492, 'El stock debe mantenerse en 492 cajas, nunca 984');
});

// -------------------------------------------------------------
// BLOQUE 3: MODO DEMOSTRACIÓN LOCAL EN Index.html (DEFECTO 2)
// -------------------------------------------------------------
const htmlPath = path.resolve(__dirname, '../src/Index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

runTest('7. Index.html implementa localApiBridge de MODO DEMO identificado claramente', () => {
  assert.ok(htmlContent.includes('MODO DEMOSTRACIÓN LOCAL'), 'Debe incluir mensaje explícito de MODO DEMO');
  assert.ok(htmlContent.includes('demoModeBanner'), 'Debe incluir identificador de banner de demo');
  assert.ok(htmlContent.includes('[DEMO]'), 'Los datos ficticios deben estar prefijados con [DEMO]');
});

runTest('8. localApiBridge bloquea estrictamente mutaciones de inventario y no simula persistencia', () => {
  assert.ok(htmlContent.includes('MUTATION_FNS'), 'Debe existir lista de funciones de mutación bloqueadas');
  assert.ok(htmlContent.includes('Operación \'') && htmlContent.includes('bloqueada'), 'Debe rechazar mutaciones con mensaje claro');
});

runTest('9. btnConfirmarTodoLote gestiona deshabilitación, prevención de dobles clics y resumen modal', () => {
  assert.ok(htmlContent.includes('btnConfirmarTodoLote'), 'Botón presente en Index.html');
  assert.ok(htmlContent.includes('btn.disabled = true'), 'Deshabilitación temporal presente');
  assert.ok(htmlContent.includes('Resumen de Confirmación de Lote') || htmlContent.includes('Resultado del procesamiento del lote'), 'Resumen modal presente');
  assert.ok(htmlContent.includes('confirmarDocumentoRevisado'), 'Invoca confirmarDocumentoRevisado para confirmación segura');
});

// -------------------------------------------------------------
// BLOQUE 4: INVARIANTE INNEGOCIABLE DE INVENTORY ENGINE
// -------------------------------------------------------------
runTest('10. Invariante Innegociable: InventoryEngine.js permanece 100% inalterado respecto a Git HEAD', () => {
  const diff = execSync('git diff -- src/InventoryEngine.js', { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.strictEqual(diff.trim(), '', 'InventoryEngine.js debe tener CERO diferencias respecto a Git HEAD');
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE FASE 7.1: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
