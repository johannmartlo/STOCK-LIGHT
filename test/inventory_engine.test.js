/**
 * STOCK-LIGHT — Test Suite Oficial del Núcleo de Inventario
 * Ejecutable localmente con Node.js: `node test/inventory_engine.test.js`
 */

const assert = require('assert');
const {
  buildStockKey,
  processMovement,
  rebuildStockFromMovements
} = require('../src/InventoryEngine');

const {
  buildDocumentIdentityKey,
  buildLineIdentityKey,
  checkDocumentDuplicate,
  filterBatchForOverlaps
} = require('../src/DeduplicationService');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

console.log('====================================================');
console.log(' INICIANDO SUITE DE PRUEBAS DE FASE 1: STOCK-LIGHT');
console.log('====================================================\n');

// ----------------------------------------------------
// CASO 1: Entrada 100, Entrada 176, Salida 150 -> Esperado: 126
// ----------------------------------------------------
runTest('Caso 1: Entrada 100 + Entrada 176 - Salida 150 = 126 cajas', () => {
  let layers = [];
  let stock = {};

  // Entrada 1: 100 cajas el 22/09
  const r1 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 100,
    fecha: '2026-09-22',
    idCapa: 'CAPA-001',
    documentoRef: 'ALB-001'
  }, layers, stock);

  assert.strictEqual(r1.stockNuevo, 100);
  assert.strictEqual(r1.updatedLayers.length, 1);

  // Entrada 2: 176 cajas el 23/09
  const r2 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 176,
    fecha: '2026-09-23',
    idCapa: 'CAPA-002',
    documentoRef: 'ALB-002'
  }, r1.updatedLayers, r1.updatedStock);

  assert.strictEqual(r2.stockNuevo, 276);
  assert.strictEqual(r2.updatedLayers.length, 2);

  // Salida: 150 cajas el 24/09
  const r3 = processMovement({
    tipo: 'SALIDA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 150,
    fecha: '2026-09-24',
    documentoRef: 'SAL-001'
  }, r2.updatedLayers, r2.updatedStock);

  assert.strictEqual(r3.success, true);
  assert.strictEqual(r3.stockNuevo, 126);

  // Verificación FIFO: Capa 1 debe estar agotada (consumió 100) y Capa 2 debe tener 126 restantes (consumió 50)
  const c1 = r3.updatedLayers.find(l => l.id_capa === 'CAPA-001');
  const c2 = r3.updatedLayers.find(l => l.id_capa === 'CAPA-002');
  assert.strictEqual(c1.estado_capa, 'AGOTADA');
  assert.strictEqual(c1.cajas_restantes, 0);
  assert.strictEqual(c2.estado_capa, 'ACTIVA');
  assert.strictEqual(c2.cajas_restantes, 126);
  assert.strictEqual(c2.cajas_consumidas, 50);
});

// ----------------------------------------------------
// CASO 2: Entrada 100, Entrada 176, Salida 276 -> Esperado: 0
// ----------------------------------------------------
runTest('Caso 2: Entrada 100 + Entrada 176 - Salida 276 = 0 cajas', () => {
  let layers = [];
  let stock = {};

  const r1 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 100,
    fecha: '2026-09-22',
    idCapa: 'CAPA-001'
  }, layers, stock);

  const r2 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 176,
    fecha: '2026-09-23',
    idCapa: 'CAPA-002'
  }, r1.updatedLayers, r1.updatedStock);

  const r3 = processMovement({
    tipo: 'SALIDA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 276,
    fecha: '2026-09-24'
  }, r2.updatedLayers, r2.updatedStock);

  assert.strictEqual(r3.success, true);
  assert.strictEqual(r3.stockNuevo, 0);

  // Ambas capas deben estar agotadas
  r3.updatedLayers.forEach(l => {
    assert.strictEqual(l.estado_capa, 'AGOTADA');
    assert.strictEqual(l.cajas_restantes, 0);
  });
});

// ----------------------------------------------------
// CASO 3: Entrada 100, Salida 150 -> Esperado: STOCK_INSUFICIENTE
// ----------------------------------------------------
runTest('Caso 3: Salida con stock insuficiente genera STOCK_INSUFICIENTE sin alterar saldo', () => {
  let layers = [];
  let stock = {};

  const r1 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 100,
    fecha: '2026-09-22',
    idCapa: 'CAPA-001'
  }, layers, stock);

  const r2 = processMovement({
    tipo: 'SALIDA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 150,
    fecha: '2026-09-23'
  }, r1.updatedLayers, r1.updatedStock);

  assert.strictEqual(r2.success, false);
  assert.strictEqual(r2.status, 'PENDIENTE_REVISION');
  assert.strictEqual(r2.errorCode, 'STOCK_INSUFICIENTE');
  assert.strictEqual(r2.stockDisponible, 100);
  assert.strictEqual(r2.cajasSolicitadas, 150);
  assert.strictEqual(r2.deficit, 50);

  // Comprobar que las capas originales no sufrieron mutación
  assert.strictEqual(r2.updatedLayers[0].cajas_restantes, 100);
  assert.strictEqual(r2.updatedLayers[0].estado_capa, 'ACTIVA');
  assert.strictEqual(r2.updatedStock['2112000|EPS104'], 100);
});

// ----------------------------------------------------
// CASO 4: Entrada 100, Entrada 176, Salida 150, Ajuste -5 -> Esperado: 121
// ----------------------------------------------------
runTest('Caso 4: Entrada 100 + 176 - 150 + Ajuste -5 (MERMA) = 121 cajas', () => {
  let layers = [];
  let stock = {};

  const r1 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 100,
    fecha: '2026-09-22',
    idCapa: 'CAPA-001'
  }, layers, stock);

  const r2 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 176,
    fecha: '2026-09-23',
    idCapa: 'CAPA-002'
  }, r1.updatedLayers, r1.updatedStock);

  const r3 = processMovement({
    tipo: 'SALIDA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 150,
    fecha: '2026-09-24'
  }, r2.updatedLayers, r2.updatedStock);

  // Ajuste manual de merma: -5 cajas
  const r4 = processMovement({
    tipo: 'AJUSTE',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 5,
    signo: -1,
    motivo: 'MERMA',
    observaciones: 'Fruta deshidratada en cámara',
    usuario: 'operario@almacen.com',
    fecha: '2026-09-25'
  }, r3.updatedLayers, r3.updatedStock);

  assert.strictEqual(r4.success, true);
  assert.strictEqual(r4.stockNuevo, 121);
  assert.strictEqual(r4.generatedMovement.tipo_movimiento, 'AJUSTE');
  assert.strictEqual(r4.generatedMovement.signo, -1);
  assert.strictEqual(r4.generatedMovement.motivo_ajuste, 'MERMA');
});

// ----------------------------------------------------
// CASO 5: Stock inicial 200, Salida 50 -> Esperado: 150
// ----------------------------------------------------
runTest('Caso 5: Stock Inicial 200 (Ajuste +200) - Salida 50 = 150 cajas', () => {
  let layers = [];
  let stock = {};

  // Stock inicial como ajuste positivo
  const r1 = processMovement({
    tipo: 'AJUSTE',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 200,
    signo: 1,
    motivo: 'STOCK_INICIAL',
    observaciones: 'Inventario físico inicial de apertura',
    usuario: 'admin@almacen.com',
    fecha: '2026-09-01'
  }, layers, stock);

  assert.strictEqual(r1.success, true);
  assert.strictEqual(r1.stockNuevo, 200);
  assert.strictEqual(r1.updatedLayers.length, 1);
  assert.strictEqual(r1.newLayer.cajas_restantes, 200);

  // Salida de 50 cajas
  const r2 = processMovement({
    tipo: 'SALIDA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 50,
    fecha: '2026-09-02'
  }, r1.updatedLayers, r1.updatedStock);

  assert.strictEqual(r2.success, true);
  assert.strictEqual(r2.stockNuevo, 150);
  assert.strictEqual(r2.updatedLayers[0].cajas_restantes, 150);
});

// ----------------------------------------------------
// CASO 6: Dos entradas diferentes con mismo artículo/envase/cajas -> Dos capas distintas
// ----------------------------------------------------
runTest('Caso 6: Dos entradas idénticas en cantidad deben generar dos capas FIFO independientes', () => {
  let layers = [];
  let stock = {};

  const r1 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 100,
    fecha: '2026-09-22',
    idCapa: 'CAPA-A',
    documentoRef: 'ALB-A'
  }, layers, stock);

  const r2 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 100,
    fecha: '2026-09-23',
    idCapa: 'CAPA-B',
    documentoRef: 'ALB-B'
  }, r1.updatedLayers, r1.updatedStock);

  assert.strictEqual(r2.updatedLayers.length, 2);
  assert.strictEqual(r2.updatedLayers[0].id_capa, 'CAPA-A');
  assert.strictEqual(r2.updatedLayers[1].id_capa, 'CAPA-B');
  assert.strictEqual(r2.stockNuevo, 200);
  assert.notStrictEqual(r2.updatedLayers[0].id_capa, r2.updatedLayers[1].id_capa);
});

// ----------------------------------------------------
// CASO 7: Misma salida importada dos veces -> Detectada como duplicada
// ----------------------------------------------------
runTest('Caso 7: Deduplicación detecta salida repetida (Nivel 1 y Nivel 2)', () => {
  const existingDocs = [
    {
      id_documento: 'DOC-100',
      sha256_hash: 'a1b2c3d4e5f67890123456789abcdef0',
      tipo_documento: 'SALIDA',
      serie: 'AVT26',
      numero: '9001',
      fecha_documento: '2026-09-25'
    }
  ];

  // Intento 1: Mismo hash SHA-256
  const candidateByHash = {
    sha256_hash: 'a1b2c3d4e5f67890123456789abcdef0',
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '9001',
    fecha_documento: '2026-09-25'
  };
  const check1 = checkDocumentDuplicate(candidateByHash, existingDocs);
  assert.strictEqual(check1.isDuplicate, true);
  assert.strictEqual(check1.duplicateLevel, 1);

  // Intento 2: Distinto hash pero misma identidad compuesta (tipo + serie + numero + fecha)
  const candidateByKey = {
    sha256_hash: 'different_hash_due_to_scan',
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '9001',
    fecha_documento: '2026-09-25'
  };
  const check2 = checkDocumentDuplicate(candidateByKey, existingDocs);
  assert.strictEqual(check2.isDuplicate, true);
  assert.strictEqual(check2.duplicateLevel, 2);
});

// ----------------------------------------------------
// CASO 8: Dos documentos distintos con misma cantidad -> No se confunden
// ----------------------------------------------------
runTest('Caso 8: Dos documentos con la misma cantidad no se confunden si tienen identidad documental distinta', () => {
  const existingDocs = [
    {
      id_documento: 'DOC-001',
      sha256_hash: 'hash_doc_1',
      tipo_documento: 'SALIDA',
      serie: 'AVT26',
      numero: '1001',
      fecha_documento: '2026-09-25'
    }
  ];

  const candidateDoc2 = {
    sha256_hash: 'hash_doc_2',
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '1002', // diferente número
    fecha_documento: '2026-09-25'
  };

  const check = checkDocumentDuplicate(candidateDoc2, existingDocs);
  assert.strictEqual(check.isDuplicate, false);
});

// ----------------------------------------------------
// CASO 9: Importación de período solapado -> Solo incorporar nuevos
// ----------------------------------------------------
runTest('Caso 9: Importación con período solapado filtra duplicados y retiene solo documentos nuevos', () => {
  const existingDocs = [
    { id_documento: 'DOC-1', tipo_documento: 'COMPRA', serie: 'ACT26', numero: '501', fecha_documento: '2026-09-20' },
    { id_documento: 'DOC-2', tipo_documento: 'COMPRA', serie: 'ACT26', numero: '502', fecha_documento: '2026-09-21' }
  ];

  const batchSolapado = [
    { tipo_documento: 'COMPRA', serie: 'ACT26', numero: '502', fecha_documento: '2026-09-21' }, // Ya existe
    { tipo_documento: 'COMPRA', serie: 'ACT26', numero: '503', fecha_documento: '2026-09-22' }, // Nuevo
    { tipo_documento: 'COMPRA', serie: 'ACT26', numero: '504', fecha_documento: '2026-09-23' }  // Nuevo
  ];

  const result = filterBatchForOverlaps(batchSolapado, existingDocs);

  assert.strictEqual(result.totalCandidatos, 3);
  assert.strictEqual(result.totalNuevos, 2);
  assert.strictEqual(result.totalDuplicados, 1);
  assert.strictEqual(result.newDocuments[0].numero, '503');
  assert.strictEqual(result.newDocuments[1].numero, '504');
  assert.strictEqual(result.duplicateDocuments[0].document.numero, '502');
});

// ----------------------------------------------------
// CASO 10: Reconstrucción Determinista (rebuildStockFromMovements)
// ----------------------------------------------------
runTest('Caso 10: rebuildStockFromMovements reconstruye determinísticamente el stock acumulado', () => {
  const movements = [
    {
      id_movimiento: 'MOV-001',
      fecha_hora: '2026-09-01T08:00:00Z',
      tipo_movimiento: 'AJUSTE',
      codigo_articulo: '2112000',
      codigo_envase: 'EPS104',
      cajas: 200,
      signo: 1,
      motivo_ajuste: 'STOCK_INICIAL',
      usuario: 'admin@almacen.com',
      estado: 'CONFIRMADO'
    },
    {
      id_movimiento: 'MOV-002',
      fecha_hora: '2026-09-02T10:00:00Z',
      tipo_movimiento: 'ENTRADA',
      codigo_articulo: '2112000',
      codigo_envase: 'EPS104',
      cajas: 100,
      signo: 1,
      estado: 'CONFIRMADO'
    },
    {
      id_movimiento: 'MOV-003',
      fecha_hora: '2026-09-03T12:00:00Z',
      tipo_movimiento: 'SALIDA',
      codigo_articulo: '2112000',
      codigo_envase: 'EPS104',
      cajas: 120,
      signo: -1,
      estado: 'CONFIRMADO'
    },
    {
      id_movimiento: 'MOV-004',
      fecha_hora: '2026-09-04T15:00:00Z',
      tipo_movimiento: 'AJUSTE',
      codigo_articulo: '2112000',
      codigo_envase: 'EPS104',
      cajas: 5,
      signo: -1,
      motivo_ajuste: 'MERMA',
      usuario: 'operario@almacen.com',
      estado: 'CONFIRMADO'
    }
  ];

  // Cálculo esperado: 200 + 100 - 120 - 5 = 175 cajas
  const report = rebuildStockFromMovements(movements);

  assert.strictEqual(report.isConsistent, true);
  assert.strictEqual(report.totalCajasPorStock, 175);
  assert.strictEqual(report.totalCajasPorCapas, 175);
  assert.strictEqual(report.stockMap['2112000|EPS104'], 175);
});

// ----------------------------------------------------
// CASO 11: Múltiples envases independientes para un mismo artículo (1:N)
// ----------------------------------------------------
runTest('Caso 11: Un artículo con dos envases diferentes mantiene saldos y capas 100% aislados', () => {
  let layers = [];
  let stock = {};

  // Entrada de Tomate Rosa en EPS104
  const r1 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 80,
    fecha: '2026-09-20'
  }, layers, stock);

  // Entrada del MISMO Tomate Rosa en EPS106
  const r2 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS106',
    cajas: 50,
    fecha: '2026-09-20'
  }, r1.updatedLayers, r1.updatedStock);

  // Salida de EPS104 de 30 cajas
  const r3 = processMovement({
    tipo: 'SALIDA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 30,
    fecha: '2026-09-21'
  }, r2.updatedLayers, r2.updatedStock);

  assert.strictEqual(r3.updatedStock['2112000|EPS104'], 50); // 80 - 30 = 50
  assert.strictEqual(r3.updatedStock['2112000|EPS106'], 50); // Intacto en 50
});

console.log('\n====================================================');
console.log(` RESULTADOS: ${passedTests} SUPERADAS | ${failedTests} FALLIDAS`);
console.log('====================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
