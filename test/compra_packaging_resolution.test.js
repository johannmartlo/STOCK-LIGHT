/**
 * STOCK-LIGHT — Test Suite: Resolución Controlada de Envases en Albaranes de Compra
 * Ejecutable con Node.js: `node test/compra_packaging_resolution.test.js`
 * 
 * Verifica rigurosamente los 10 requerimientos de negocio y arquitectura:
 * 1. Compra con envase determinista (regla homologada aislada -> confirmación y stock normal).
 * 2. Compra ambigua -> queda estrictamente en PENDIENTE_REVISION (0 movimientos, 0 capas FIFO).
 * 3. Confirmación posterior correcta (operador resuelve envase homologado -> genera movimientos y capas).
 * 4. Confirmación con envase no permitido -> bloqueada estrictamente por el Trust Boundary del servidor.
 * 5. Confirmación duplicada de documento ya confirmado -> bloqueada.
 * 6. Confirmación de documento inexistente -> bloqueada.
 * 7. NUNCA crear ARTICULO|DEFAULT en MOVIMIENTOS, CAPAS_FIFO ni STOCK_ACTUAL.
 * 8. NUNCA crear ARTICULO|ENVASE_NO_DETERMINABLE_DESDE_PDF como codigo_envase en persistencia.
 * 9. Salidas existentes siguen deduciendo con precisión de las capas creadas.
 * 10. Consumo FIFO se mantiene 100% puro e intacto (InventoryEngine intacto).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { MaestroResolver, DETERMINISTIC_COMPRA_RULES } = require('../src/MaestroResolver');
const { DocumentValidator } = require('../src/DocumentValidator');
const { DocumentParserRegistry } = require('../src/parsers/DocumentParserRegistry');
const { MovementService } = require('../src/MovementService');
const { CompraParser } = require('../src/parsers/CompraParser');
const { SalidaParser } = require('../src/parsers/SalidaParser');
const { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps } = require('../src/DeduplicationService');
const { buildStockKey, processMovement, rebuildStockFromMovements } = require('../src/InventoryEngine');

console.log('================================================================');
console.log(' TEST SUITE — RESOLUCIÓN CONTROLADA DE ENVASES EN COMPRAS');
console.log('================================================================\n');

// 1. Cargar Maestro Oficial de Referencia
const maestroPath = path.join(__dirname, '..', 'docs', 'reference', 'MAESTRO_BASE.json');
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
  const txtCompra = fs.readFileSync(path.join(__dirname, '..', 'docs', 'samples', 'COMPRAS', 'COMPRA 3026.pdf.extracted.txt'), 'utf8');

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

// --------------------------------------------------------------------------
// TEST 2: Compra ambigua -> pasa estrictamente a PENDIENTE_REVISION (0 movs, 0 capas)
// --------------------------------------------------------------------------
runTest('2. Compra ambigua -> PENDIENTE_REVISION con 0 movimientos y 0 capas FIFO', () => {
  const env = createEnv();

  // Documento con TOMATE PERA SUELTA M (cajas: 50, sin envase impreso)
  // No tiene regla determinista: puede ser EPS154 o CARTON -> AMBIGUO
  const lineasAmbigua = [
    {
      lineIndex: 1,
      articleCode: '2112003',
      articleName: 'TOMATE PERA SUELTA M',
      envaseCode: '',
      envaseName: '',
      boxes: 50,
      lot: 'PARTIDA-PERA-01'
    }
  ];

  const docNorm = {
    documentType: 'COMPRA',
    series: 'ACT26',
    number: '4001',
    date: '2026-09-30',
    entityName: 'PROVEEDOR PERA SL',
    sha256Hash: 'hash_pera_4001',
    lines: lineasAmbigua,
    rawMetadata: { totalBultosPie: 50, cuadraConPie: true }
  };

  const validation = env.validator.validate(docNorm);
  assert.strictEqual(validation.isValid, false);
  assert.strictEqual(validation.status, 'PENDIENTE_REVISION');
  assert.strictEqual(validation.validatedLines[0].incidencia, 'ENVASE_NO_DETERMINABLE_DESDE_PDF');
  assert.strictEqual(validation.validatedLines[0].envaseCode, null);
  // Opciones permitidas en MAESTRO para este artículo
  assert.ok(validation.validatedLines[0].opcionesPermitidas.some(o => o.codigo_envase === 'EPS154'));

  // Registrar la entrada en MovementService
  const result = env.movementService.registrarEntrada({
    id_documento: 'DOC-PERA-4001',
    sha256_hash: 'hash_pera_4001',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '4001',
    fecha_documento: '2026-09-30',
    entidad_nombre: 'PROVEEDOR PERA SL',
    estado_proceso: 'PENDIENTE_REVISION'
  }, validation.validatedLines.map(l => ({
    lineIndex: l.lineIndex,
    codigo_articulo: l.articleCode,
    nombre_articulo: l.articleName,
    codigo_envase: l.envaseCode, // null
    cajas: l.boxes,
    partida: l.lot,
    incidencia: l.incidencia
  })), 'OPERADOR');

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.status, 'PENDIENTE_REVISION');
  assert.strictEqual(result.requiresReview, true);
  assert.strictEqual(result.movimientosGenerados.length, 0);

  // Verificación crítica de persistencia:
  // 1. Cabecera guardada en DOCUMENTOS con PENDIENTE_REVISION
  const docs = env.repo.getDocumentos();
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].id_documento, 'DOC-PERA-4001');
  assert.strictEqual(docs[0].estado_proceso, 'PENDIENTE_REVISION');

  // 2. CERO movimientos en MOVIMIENTOS
  assert.strictEqual(env.repo.getMovimientos().length, 0);

  // 3. CERO capas en CAPAS_FIFO
  assert.strictEqual(env.repo.getCapasFifo().length, 0);

  // 4. CERO registros en STOCK_ACTUAL
  assert.strictEqual(env.repo.getStockActual().length, 0);
});

// --------------------------------------------------------------------------
// TEST 3: Confirmación posterior correcta
// --------------------------------------------------------------------------
runTest('3. Confirmación posterior correcta -> valida en servidor y materializa movimientos y FIFO', () => {
  const env = createEnv();

  // Documento previo en PENDIENTE_REVISION
  env.repo.appendDocumento({
    id_documento: 'DOC-PERA-4001',
    sha256_hash: 'hash_pera_4001',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '4001',
    fecha_documento: '2026-09-30',
    entidad_nombre: 'PROVEEDOR PERA SL',
    total_lineas: 1,
    total_cajas: 50,
    estado_proceso: 'PENDIENTE_REVISION'
  });

  const canonicalLines = [
    {
      lineIndex: 1,
      articleCode: '2112003',
      articleName: 'TOMATE PERA SUELTA M',
      boxes: 50,
      lot: 'PARTIDA-PERA-01'
    }
  ];

  // El operador resuelve el envase a EPS154 (permitido en MAESTRO)
  const result = env.movementService.confirmarCompraPendiente({
    idDocumento: 'DOC-PERA-4001',
    lineResolutions: [{ lineIndex: 1, codigoEnvase: 'EPS154' }]
  }, 'OPERADOR_REVISION', env.resolver, { canonicalLines });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.status, 'CONFIRMADO');
  assert.strictEqual(result.totalCajas, 50);

  // 1. Estado en DOCUMENTOS actualizado a CONFIRMADO
  const doc = env.repo.getDocumentos().find(d => d.id_documento === 'DOC-PERA-4001');
  assert.strictEqual(doc.estado_proceso, 'CONFIRMADO');

  // 2. Movimiento registrado con EPS154
  const movs = env.repo.getMovimientos();
  assert.strictEqual(movs.length, 1);
  assert.strictEqual(movs[0].codigo_articulo, '2112003');
  assert.strictEqual(movs[0].codigo_envase, 'EPS154');
  assert.strictEqual(movs[0].cajas, 50);

  // 3. Capa FIFO creada
  const capas = env.repo.getCapasFifo();
  assert.strictEqual(capas.length, 1);
  assert.strictEqual(capas[0].codigo_articulo, '2112003');
  assert.strictEqual(capas[0].codigo_envase, 'EPS154');
  assert.strictEqual(capas[0].cajas_restantes, 50);

  // 4. STOCK_ACTUAL materializado
  const stock = env.repo.getStockActual();
  assert.strictEqual(stock.length, 1);
  assert.strictEqual(stock[0].stock_key, '2112003|EPS154');
  assert.strictEqual(stock[0].cajas_actuales, 50);
});

// --------------------------------------------------------------------------
// TEST 4: Confirmación con envase no permitido -> bloqueada por Trust Boundary
// --------------------------------------------------------------------------
runTest('4. Confirmación con envase no permitido -> bloqueada estrictamente por el servidor', () => {
  const env = createEnv();

  env.repo.appendDocumento({
    id_documento: 'DOC-PERA-4002',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '4002',
    fecha_documento: '2026-09-30',
    estado_proceso: 'PENDIENTE_REVISION'
  });

  const canonicalLines = [
    {
      lineIndex: 1,
      articleCode: '2112003',
      articleName: 'TOMATE PERA SUELTA M',
      boxes: 40,
      lot: 'P-02'
    }
  ];

  // Intento de asignar CT4395MAD (envase de Tomate Moresco Madera, no homologado para Tomate Pera)
  assert.throws(() => {
    env.movementService.confirmarCompraPendiente({
      idDocumento: 'DOC-PERA-4002',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'CT4395MAD' }]
    }, 'HACKER_USER', env.resolver, { canonicalLines });
  }, /Trust Boundary violado: El envase 'CT4395MAD' no está permitido para el artículo '2112003'/);

  // Garantía absoluta de inmutabilidad
  assert.strictEqual(env.repo.getMovimientos().length, 0);
  assert.strictEqual(env.repo.getCapasFifo().length, 0);
  assert.strictEqual(env.repo.getStockActual().length, 0);
  const doc = env.repo.getDocumentos().find(d => d.id_documento === 'DOC-PERA-4002');
  assert.strictEqual(doc.estado_proceso, 'PENDIENTE_REVISION');

  // Sub-test 4b: Cliente intenta enviar líneas manipuladas en el payload del cliente
  assert.throws(() => {
    env.movementService.confirmarCompraPendiente({
      idDocumento: 'DOC-PERA-4002',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'EPS154' }],
      canonicalLines: [{ lineIndex: 1, articleCode: '2112003', boxes: 9999 }]
    }, 'HACKER_USER', env.resolver);
  }, /Trust Boundary violado: El cliente no puede suministrar líneas ni cantidades de stock/);

  // Sub-test 4c: Cliente intenta enviar rawText en su payload
  assert.throws(() => {
    env.movementService.confirmarCompraPendiente({
      idDocumento: 'DOC-PERA-4002',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'EPS154' }],
      rawText: 'CONTENIDO DOCUMENTAL ALTERADO'
    }, 'HACKER_USER', env.resolver);
  }, /Trust Boundary violado: El cliente no puede enviar rawText para confirmar compras/);

  // Sub-test 4d: Inconsistencia entre líneas de servidor y cabecera en DOCUMENTOS
  env.repo.appendDocumento({
    id_documento: 'DOC-TAMPER-BOXES',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '4005',
    fecha_documento: '2026-09-30',
    total_lineas: 1,
    total_cajas: 50,
    estado_proceso: 'PENDIENTE_REVISION'
  });

  assert.throws(() => {
    env.movementService.confirmarCompraPendiente({
      idDocumento: 'DOC-TAMPER-BOXES',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'EPS154' }]
    }, 'HACKER_USER', env.resolver, {
      canonicalLines: [{ lineIndex: 1, articleCode: '2112003', boxes: 9999 }]
    });
  }, /Trust Boundary violado: El total de cajas procesadas \(9999\) no coincide con el total de cajas del documento original \(50\)/);
});

// --------------------------------------------------------------------------
// TEST 5: Confirmación duplicada de documento ya confirmado -> bloqueada
// --------------------------------------------------------------------------
runTest('5. Confirmación de documento ya confirmado -> rechazada por el servidor', () => {
  const env = createEnv();

  env.repo.appendDocumento({
    id_documento: 'DOC-CONFIRMADO-YA',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '4003',
    fecha_documento: '2026-09-30',
    estado_proceso: 'CONFIRMADO' // Ya confirmado
  });

  assert.throws(() => {
    env.movementService.confirmarCompraPendiente({
      idDocumento: 'DOC-CONFIRMADO-YA',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'EPS154' }]
    }, 'OPERADOR', env.resolver, {
      canonicalLines: [{ lineIndex: 1, articleCode: '2112003', boxes: 30 }]
    });
  }, /Trust Boundary violado: El documento 'DOC-CONFIRMADO-YA' .* ya ha sido confirmado previamente/);
});

// --------------------------------------------------------------------------
// TEST 6: Confirmación de documento inexistente -> bloqueada
// --------------------------------------------------------------------------
runTest('6. Confirmación de documento inexistente -> rechazada con error descriptivo', () => {
  const env = createEnv();

  assert.throws(() => {
    env.movementService.confirmarCompraPendiente({
      idDocumento: 'DOC-FANTASMA-999',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'EPS154' }]
    }, 'OPERADOR', env.resolver, {
      canonicalLines: [{ lineIndex: 1, articleCode: '2112003', boxes: 30 }]
    });
  }, /Trust Boundary violado: Documento con ID 'DOC-FANTASMA-999' no existe en persistencia/);
});

// --------------------------------------------------------------------------
// TEST 7: NUNCA crear ARTICULO|DEFAULT
// --------------------------------------------------------------------------
runTest('7. NUNCA crear ARTICULO|DEFAULT bajo ninguna circunstancia', () => {
  const env = createEnv();

  // Caso 7a: Resolver envase 'DEFAULT' directamente
  const resEnvDefault = env.resolver.resolveEnvase('DEFAULT', 'CAJA');
  assert.strictEqual(resEnvDefault.resolved, false);

  // Caso 7b: Intento de confirmar compra pendiente indicando DEFAULT
  env.repo.appendDocumento({
    id_documento: 'DOC-DEF-TEST',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '4004',
    fecha_documento: '2026-09-30',
    estado_proceso: 'PENDIENTE_REVISION'
  });

  assert.throws(() => {
    env.movementService.confirmarCompraPendiente({
      idDocumento: 'DOC-DEF-TEST',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'DEFAULT' }]
    }, 'OPERADOR', env.resolver, {
      canonicalLines: [{ lineIndex: 1, articleCode: '2112004', boxes: 240 }]
    });
  }, /Trust Boundary violado: El envase 'DEFAULT' no es un envase comercial válido/);

  // Caso 7c: Auditoría total: 0 DEFAULT en base de datos
  const allStock = env.repo.getStockActual();
  const allCapas = env.repo.getCapasFifo();
  const allMovs = env.repo.getMovimientos();

  assert.strictEqual(allStock.some(s => s.stock_key.includes('DEFAULT') || s.codigo_envase === 'DEFAULT'), false);
  assert.strictEqual(allCapas.some(c => c.stock_key.includes('DEFAULT') || c.codigo_envase === 'DEFAULT'), false);
  assert.strictEqual(allMovs.some(m => m.codigo_envase === 'DEFAULT'), false);
});

// --------------------------------------------------------------------------
// TEST 8: NUNCA crear ARTICULO|ENVASE_NO_DETERMINABLE_DESDE_PDF en stock
// --------------------------------------------------------------------------
runTest('8. NUNCA crear ARTICULO|ENVASE_NO_DETERMINABLE_DESDE_PDF como stock comercial', () => {
  const env = createEnv();

  // Caso 8a: Resolver par con código de incidencia
  assert.strictEqual(env.resolver.isValidStockPair('2112000', 'ENVASE_NO_DETERMINABLE_DESDE_PDF'), false);
  assert.strictEqual(env.resolver.isEnvasePermitidoParaArticulo('2112000', 'ENVASE_NO_DETERMINABLE_DESDE_PDF'), false);

  // Caso 8b: Intento de confirmación con este código
  env.repo.appendDocumento({
    id_documento: 'DOC-INC-TEST',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '4005',
    fecha_documento: '2026-09-30',
    estado_proceso: 'PENDIENTE_REVISION'
  });

  assert.throws(() => {
    env.movementService.confirmarCompraPendiente({
      idDocumento: 'DOC-INC-TEST',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'ENVASE_NO_DETERMINABLE_DESDE_PDF' }]
    }, 'OPERADOR', env.resolver, {
      canonicalLines: [{ lineIndex: 1, articleCode: '2112000', boxes: 100 }]
    });
  }, /Trust Boundary violado: El envase 'ENVASE_NO_DETERMINABLE_DESDE_PDF' no es un envase comercial válido/);

  // Auditoría: 0 existencias bajo este identificador
  assert.strictEqual(env.repo.getStockActual().some(s => s.stock_key.includes('ENVASE_NO_DETERMINABLE')), false);
  assert.strictEqual(env.repo.getCapasFifo().some(c => (c.codigo_envase || '').includes('ENVASE_NO_DETERMINABLE')), false);
});

// --------------------------------------------------------------------------
// TEST 9: Salidas existentes siguen funcionando normalmente
// --------------------------------------------------------------------------
runTest('9. Salidas existentes siguen operando con precisión sobre las capas creadas', () => {
  const env = createEnv();

  // 1. Ingresar compra determinista: 78 cajas de TOMATE MORESCO I M en CT4395
  env.movementService.registrarEntrada({
    id_documento: 'DOC-IN-MORESCO',
    sha256_hash: 'hash_in_m',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '5001',
    fecha_documento: '2026-09-20'
  }, [
    { codigo_articulo: '2112005', codigo_envase: 'CT4395', cajas: 78, partida: 'P-Moresco' }
  ], 'OPERADOR');

  assert.strictEqual(env.repo.getStockActual()[0].cajas_actuales, 78);

  // 2. Registrar salida de 30 cajas de TOMATE MORESCO I M en CT4395
  const resSalida = env.movementService.registrarSalida({
    id_documento: 'DOC-OUT-MORESCO',
    sha256_hash: 'hash_out_m',
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '6001',
    fecha_documento: '2026-09-21',
    entidad_nombre: 'CLIENTE PRUEBAS SL'
  }, [
    { codigo_articulo: '2112005', codigo_envase: 'CT4395', cajas: 30 }
  ], 'OPERADOR');

  assert.strictEqual(resSalida.success, true);
  assert.strictEqual(resSalida.totalCajas, 30);
  assert.strictEqual(env.repo.getStockActual()[0].cajas_actuales, 48); // 78 - 30 = 48
  assert.strictEqual(env.repo.getCapasFifo()[0].cajas_restantes, 48);
});

// --------------------------------------------------------------------------
// TEST 10: FIFO existente sigue funcionando normalmente (InventoryEngine intacto)
// --------------------------------------------------------------------------
runTest('10. FIFO existente sigue consumiendo estrictamente por orden de antigüedad', () => {
  const env = createEnv();

  // Capa 1: 50 cajas TOMATE ROSA I en EPS104 (Fecha: 2026-09-01)
  env.movementService.registrarEntrada({
    id_documento: 'DOC-ROSA-1',
    sha256_hash: 'h1',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '101',
    fecha_documento: '2026-09-01'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 50, partida: 'LOTE-1' }], 'OP');

  // Capa 2: 70 cajas TOMATE ROSA I en EPS104 (Fecha: 2026-09-05)
  env.movementService.registrarEntrada({
    id_documento: 'DOC-ROSA-2',
    sha256_hash: 'h2',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '102',
    fecha_documento: '2026-09-05'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 70, partida: 'LOTE-2' }], 'OP');

  assert.strictEqual(env.repo.getStockActual()[0].cajas_actuales, 120);

  // Salida de 80 cajas (debe agotar Capa 1 por 50 y consumir 30 de Capa 2)
  const resSalida = env.movementService.registrarSalida({
    id_documento: 'DOC-SAL-ROSA',
    sha256_hash: 'h3',
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '201',
    fecha_documento: '2026-09-10'
  }, [{ codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 80 }], 'OP');

  assert.strictEqual(resSalida.success, true);
  assert.strictEqual(env.repo.getStockActual()[0].cajas_actuales, 40); // 120 - 80 = 40

  const capas = env.repo.getCapasFifo();
  // Capa 1 debe estar agotada (0 disponibles, estado AGOTADA)
  const c1 = capas.find(c => c.partida === 'LOTE-1');
  assert.strictEqual(c1.cajas_restantes, 0);
  assert.strictEqual(c1.estado_capa, 'AGOTADA');

  // Capa 2 debe tener 40 disponibles (70 - 30) y seguir ACTIVA
  const c2 = capas.find(c => c.partida === 'LOTE-2');
  assert.strictEqual(c2.cajas_restantes, 40);
  assert.strictEqual(c2.estado_capa, 'ACTIVA');
});

console.log('\n================================================================');
console.log(` RESULTADOS RESOLUCIÓN ENVASES: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
