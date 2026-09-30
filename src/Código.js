/**
 * STOCK-LIGHT — Código.js
 * 
 * Punto de Entrada y API para Google Apps Script.
 * Expone las funciones de inicialización, reconstrucción y servicio de inventario.
 */

// Importaciones condicionales para entorno Node.js / Testing
if (typeof SheetsRepository === 'undefined' && typeof require !== 'undefined') {
  var { SheetsRepository } = require('./Repository');
  var { MovementService } = require('./MovementService');
  var { MaestroResolver } = require('./MaestroResolver');
  var { DocumentValidator } = require('./DocumentValidator');
  var { DocumentParserRegistry } = require('./parsers/DocumentParserRegistry');
  var { processMovement, buildStockKey } = require('./InventoryEngine');
  var { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps } = require('./DeduplicationService');
  var { setSpreadsheetIdConfig, getSpreadsheetIdConfig, setDriveFolderIdConfig, getDriveFolderIdConfig, resolveDatabaseSpreadsheet } = require('./Config');
  var { DriveService } = require('./DriveService');
}

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
  const user = typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR';
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
 * @param {Object} [fileMeta] 
 * @param {Object} [options] - Opciones de inyección para dependencias/testing
 * @returns {Object} ReviewPayload estructurado
 */
function revisarDocumentoHispatec(rawText, fileMeta, options = {}) {
  const repo = options.repository || (typeof SheetsRepository !== 'undefined' ? new SheetsRepository() : null);
  const existingDocs = repo ? repo.getDocumentos() : [];
  const maestro = repo ? repo.getMaestro() : [];
  
  const resolver = options.maestroResolver || new MaestroResolver(maestro);
  const validator = options.validator || new DocumentValidator({ maestroResolver: resolver });
  const registry = options.registry || new DocumentParserRegistry({ validator, maestroResolver: resolver });

  return registry.reviewDocument(rawText, {
    fileMeta: fileMeta || {},
    existingDocuments: existingDocs
  });
}

/**
 * Confirma un documento a partir de su ENTRADA CANÓNICA (rawText + fileMeta).
 * Reconstruye y revalida íntegramente el documento en el servidor para garantizar
 * que el cliente NO sea autoridad sobre ningún dato de inventario (Trust Boundary cerrado).
 * 
 * @param {string|Object} canonicalInput - rawText (string) o { rawText, fileMeta }
 * @param {Object|string} [fileMetaOrUser] - fileMeta si arg1 es rawText, o usuario
 * @param {string|Object} [usuarioOrOptions] - usuario o config options
 * @param {Object} [optionsParam] - Opciones de inyección para testing
 * @returns {Object} Resultado de la confirmación en MovementService
 */
function confirmarDocumentoRevisado(canonicalInput, fileMetaOrUser, usuarioOrOptions, optionsParam) {
  let rawText = '';
  let fileMeta = {};
  let usuario = 'OPERADOR';
  let options = {};

  if (typeof canonicalInput === 'string') {
    rawText = canonicalInput;
    if (typeof fileMetaOrUser === 'object' && fileMetaOrUser !== null) {
      fileMeta = fileMetaOrUser;
      usuario = typeof usuarioOrOptions === 'string' ? usuarioOrOptions : (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
      options = typeof optionsParam === 'object' && optionsParam !== null ? optionsParam : {};
    } else {
      usuario = typeof fileMetaOrUser === 'string' ? fileMetaOrUser : (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
      options = typeof usuarioOrOptions === 'object' && usuarioOrOptions !== null ? usuarioOrOptions : {};
    }
  } else if (typeof canonicalInput === 'object' && canonicalInput !== null) {
    rawText = canonicalInput.rawText || '';
    fileMeta = canonicalInput.fileMeta || {};
    usuario = canonicalInput.usuario || (typeof fileMetaOrUser === 'string' ? fileMetaOrUser : (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR'));
    options = (typeof fileMetaOrUser === 'object' && fileMetaOrUser !== null && !Array.isArray(fileMetaOrUser))
      ? fileMetaOrUser
      : (typeof usuarioOrOptions === 'object' && usuarioOrOptions !== null ? usuarioOrOptions : {});
  }

  // REGLA DE TRUST BOUNDARY 1: La confirmación exige ENTRADA CANÓNICA (rawText)
  if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
    throw new Error('Trust Boundary violado: La confirmación requiere la entrada canónica original (rawText) para reconstruir y validar el documento en el servidor.');
  }

  // REGLA DE TRUST BOUNDARY 2: El servidor reconstruye y valida el documento de forma autónoma
  const review = revisarDocumentoHispatec(rawText, fileMeta, options);

  // REGLA DE TRUST BOUNDARY 3: Si no es apto para confirmar, o está en revisión o duplicado, bloquear antes de MovementService
  if (!review.aptoParaConfirmar || review.estadoValidacion !== 'VALIDO') {
    const errorDetails = (review.errores && review.errores.length > 0) ? review.errores.join('; ') : review.estadoValidacion;
    throw new Error(`Trust Boundary violado: No se puede confirmar un documento no válido o en revisión. Estado: ${review.estadoValidacion}. Detalle: ${errorDetails}`);
  }

  // REGLA DE TRUST BOUNDARY 4: En el MVP activo solo se aceptan COMPRA y SALIDA (RECEPCION bloqueada)
  if (review.documentoDetectado !== 'COMPRA' && review.documentoDetectado !== 'SALIDA') {
    throw new Error(`Trust Boundary violado: Tipo de documento no admitido en el MVP activo: '${review.documentoDetectado}'`);
  }

  const normDoc = review.normalizedDocument;
  if (!normDoc || !normDoc.lines || normDoc.lines.length === 0) {
    throw new Error('Trust Boundary violado: El documento canónico no contiene líneas de stock válidas.');
  }

  const service = options.movementService || new MovementService({
    repository: options.repository,
    lockService: options.lockService,
    deduplicationService: options.deduplicationService || (typeof checkDocumentDuplicate !== 'undefined' ? { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps } : null),
    inventoryEngine: options.inventoryEngine || (typeof processMovement !== 'undefined' ? { buildStockKey, processMovement, rebuildStockFromMovements } : null)
  });
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');

  if (normDoc.documentType === 'COMPRA') {
    return service.registrarEntrada({
      id_documento: normDoc.sourceFileId || `DOC-${Date.now()}`,
      sha256_hash: normDoc.sha256Hash,
      tipo_documento: 'COMPRA',
      serie: normDoc.series,
      numero: normDoc.number,
      fecha_documento: normDoc.date,
      entidad_nombre: normDoc.entityName,
      drive_file_id: normDoc.sourceFileId,
      drive_url: ''
    }, review.lineasDetectadas.map(l => ({
      codigo_articulo: l.codigoArticulo,
      codigo_envase: l.codigoEnvase,
      cajas: l.cajas,
      partida: l.partida && l.partida !== '-' ? l.partida : '',
      descripcion_articulo: l.nombreArticulo,
      descripcion_envase: l.nombreEnvase
    })), user);
  } else if (normDoc.documentType === 'SALIDA') {
    return service.registrarSalida({
      id_documento: normDoc.sourceFileId || `DOC-${Date.now()}`,
      sha256_hash: normDoc.sha256Hash,
      tipo_documento: 'SALIDA',
      serie: normDoc.series,
      numero: normDoc.number,
      fecha_documento: normDoc.date,
      entidad_nombre: normDoc.entityName,
      drive_file_id: normDoc.sourceFileId,
      drive_url: ''
    }, review.lineasDetectadas.map(l => ({
      codigo_articulo: l.codigoArticulo,
      codigo_envase: l.codigoEnvase,
      cajas: l.cajas,
      descripcion_articulo: l.nombreArticulo,
      descripcion_envase: l.nombreEnvase
    })), user);
  }
}

/**
 * Utilidad administrativa para configurar el ID del Google Spreadsheet de forma persistente
 * en ScriptProperties, evitando hardcodear credenciales en el código fuente.
 * 
 * @param {string} spreadsheetId 
 * @returns {string} Mensaje de confirmación
 */
function configurarSpreadsheetId(spreadsheetId) {
  setSpreadsheetIdConfig(spreadsheetId);
  return `✅ SPREADSHEET_ID configurado correctamente en ScriptProperties: ${spreadsheetId}`;
}

/**
 * Utilidad administrativa para configurar el ID de la carpeta de almacenamiento de Google Drive
 * en ScriptProperties, evitando hardcodear credenciales en el código fuente.
 * 
 * @param {string} driveFolderId 
 * @returns {string} Mensaje de confirmación
 */
function configurarDriveFolderId(driveFolderId) {
  setDriveFolderIdConfig(driveFolderId);
  return `✅ DRIVE_FOLDER_ID configurado correctamente en ScriptProperties: ${driveFolderId}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initDatabase,
    ejecutarReconstruccionStock,
    registrarAjusteManual,
    testNucleoAppsScript,
    revisarDocumentoHispatec,
    confirmarDocumentoRevisado,
    configurarSpreadsheetId,
    configurarDriveFolderId
  };
}
