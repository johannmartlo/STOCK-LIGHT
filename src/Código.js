/**
 * STOCK-LIGHT — Código.js
 * 
 * Punto de Entrada y API para Google Apps Script.
 * Expone las funciones de inicialización, reconstrucción y servicio de inventario.
 */

/**
 * Inicializa y aprovisiona las 5 hojas maestras de la base de datos en Google Sheets si no existen.
 */
function initDatabase() {
  const repo = new SheetsRepository();
  const res = repo.provisionDatabase();
  Logger.log('Provisionamiento de base de datos completado: ' + JSON.stringify(res));
  return res;
}

/**
 * Reconstruye determinísticamente el stock actual y las capas FIFO a partir de la totalidad
 * de movimientos confirmados.
 */
function ejecutarReconstruccionStock() {
  const service = new MovementService();
  const res = service.rebuildStock();
  Logger.log('Resultado de reconstrucción: ' + JSON.stringify(res));
  return res;
}

/**
 * Registra un ajuste manual (o stock inicial).
 * @param {Object} ajuste
 */
function registrarAjusteManual(ajuste) {
  const service = new MovementService();
  const user = Session.getActiveUser().getEmail() || 'OPERADOR';
  return service.registrarAjuste(ajuste, user);
}

/**
 * Función de autodiagnóstico para verificar el funcionamiento del núcleo directamente en Apps Script.
 */
function testNucleoAppsScript() {
  Logger.log('Iniciando autodiagnóstico del núcleo de STOCK-LIGHT...');
  
  // 1. Probar cálculo puro de InventoryEngine
  const capas = [];
  const stock = {};
  
  // Entrada 100
  const r1 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 100,
    fecha: '2026-09-22',
    partida: 'P-001',
    documentoRef: 'ALB-001'
  }, capas, stock);
  
  // Entrada 176
  const r2 = processMovement({
    tipo: 'ENTRADA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 176,
    fecha: '2026-09-23',
    partida: 'P-002',
    documentoRef: 'ALB-002'
  }, r1.updatedLayers, r1.updatedStock);
  
  // Salida 150
  const r3 = processMovement({
    tipo: 'SALIDA',
    codigoArticulo: '2112000',
    codigoEnvase: 'EPS104',
    cajas: 150,
    fecha: '2026-09-24',
    documentoRef: 'SAL-001'
  }, r2.updatedLayers, r2.updatedStock);
  
  Logger.log('Stock final obtenido: ' + r3.stockNuevo + ' (Esperado: 126)');
  Logger.log('Consumos FIFO: ' + JSON.stringify(r3.fifoConsumptions));
  
  if (r3.stockNuevo === 126) {
    Logger.log('✅ Prueba de autodiagnóstico SUPERADA con éxito.');
    return { ok: true, stockFinal: r3.stockNuevo };
  } else {
    Logger.log('❌ Error en prueba de autodiagnóstico.');
    return { ok: false, stockFinal: r3.stockNuevo };
  }
}

/**
 * Función de Review previa a la confirmación de movimientos.
 * Analiza el texto de un documento sin alterar inventario ni crear movimientos.
 * 
 * @param {string} rawText 
 * @param {Object} fileMeta 
 * @returns {Object} ReviewPayload estructurado
 */
function revisarDocumentoHispatec(rawText, fileMeta) {
  const repo = new SheetsRepository();
  const existingDocs = repo.getDocumentos();
  const maestro = repo.getMaestro();
  
  const resolver = new MaestroResolver(maestro);
  const validator = new DocumentValidator({ maestroResolver: resolver });
  const registry = new DocumentParserRegistry({ validator, maestroResolver: resolver });

  return registry.reviewDocument(rawText, {
    fileMeta: fileMeta || {},
    existingDocuments: existingDocs
  });
}

/**
 * Confirma un documento previamente revisado y aplica sus movimientos al inventario.
 * Acción explícita que conecta el Staging con el MovementService.
 * 
 * @param {Object} normalizedDoc 
 * @param {string} usuario 
 * @returns {Object} Resultado de la confirmación
 */
function confirmarDocumentoRevisado(normalizedDoc, usuario) {
  const service = new MovementService();
  const user = usuario || (typeof Session !== 'undefined' ? Session.getActiveUser().getEmail() : 'OPERADOR');

  if (normalizedDoc.documentType === 'COMPRA' || normalizedDoc.documentType === 'RECEPCION') {
    return service.registrarEntrada({
      id_documento: normalizedDoc.sourceFileId || `DOC-${Date.now()}`,
      sha256_hash: normalizedDoc.sha256Hash,
      tipo_documento: normalizedDoc.documentType,
      serie: normalizedDoc.series,
      numero: normalizedDoc.number,
      fecha_documento: normalizedDoc.date,
      entidad_nombre: normalizedDoc.entityName,
      drive_file_id: normalizedDoc.sourceFileId,
      drive_url: ''
    }, normalizedDoc.lines.map(l => ({
      codigo_articulo: l.articleCode,
      codigo_envase: l.envaseCode,
      cajas: l.boxes,
      partida: l.lot,
      descripcion_articulo: l.articleName,
      descripcion_envase: l.envaseName
    })), user);
  } else if (normalizedDoc.documentType === 'SALIDA') {
    return service.registrarSalida({
      id_documento: normalizedDoc.sourceFileId || `DOC-${Date.now()}`,
      sha256_hash: normalizedDoc.sha256Hash,
      tipo_documento: 'SALIDA',
      serie: normalizedDoc.series,
      numero: normalizedDoc.number,
      fecha_documento: normalizedDoc.date,
      entidad_nombre: normalizedDoc.entityName,
      drive_file_id: normalizedDoc.sourceFileId,
      drive_url: ''
    }, normalizedDoc.lines.map(l => ({
      codigo_articulo: l.articleCode,
      codigo_envase: l.envaseCode,
      cajas: l.boxes,
      descripcion_articulo: l.articleName,
      descripcion_envase: l.envaseName
    })), user);
  } else {
    throw new Error(`Tipo de documento no compatible para confirmación: ${normalizedDoc.documentType}`);
  }
}
