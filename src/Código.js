/**
 * STOCK-LIGHT — Código.js
 * 
 * Punto de Entrada y API para Google Apps Script.
 * Expone las funciones de inicialización, reconstrucción y servicio de inventario.
 */

// Importaciones condicionales para entorno Node.js / Testing (aisladas sin 'var' para evitar colisiones en Apps Script V8)
if (typeof require !== 'undefined') {
  const repoMod = require('./Repository');
  const movMod = require('./MovementService');
  const maestroMod = require('./MaestroResolver');
  const valMod = require('./DocumentValidator');
  const regMod = require('./parsers/DocumentParserRegistry');
  const engMod = require('./InventoryEngine');
  const dedupMod = require('./DeduplicationService');
  const confMod = require('./Config');
  const driveMod = require('./DriveService');
  const queryMod = require('./StockQueryService');

  global.SheetsRepository = repoMod.SheetsRepository;
  global.MovementService = movMod.MovementService;
  global.MaestroResolver = maestroMod.MaestroResolver;
  global.DocumentValidator = valMod.DocumentValidator;
  global.DocumentParserRegistry = regMod.DocumentParserRegistry;
  global.processMovement = engMod.processMovement;
  global.buildStockKey = engMod.buildStockKey;
  global.checkDocumentDuplicate = dedupMod.checkDocumentDuplicate;
  global.buildLineIdentityKey = dedupMod.buildLineIdentityKey;
  global.filterBatchForOverlaps = dedupMod.filterBatchForOverlaps;
  global.setSpreadsheetIdConfig = confMod.setSpreadsheetIdConfig;
  global.getSpreadsheetIdConfig = confMod.getSpreadsheetIdConfig;
  global.setDriveFolderIdConfig = confMod.setDriveFolderIdConfig;
  global.getDriveFolderIdConfig = confMod.getDriveFolderIdConfig;
  global.resolveDatabaseSpreadsheet = confMod.resolveDatabaseSpreadsheet;
  global.DriveService = driveMod.DriveService;
  global.StockQueryService = queryMod.StockQueryService;
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

/**
 * Consulta el stock actual completo con su clasificación de grupos de envase.
 * @param {Object} [options]
 */
function apiObtenerStockActual(options) {
  const service = new StockQueryService(options);
  return service.obtenerStockActual();
}

/**
 * Consulta el resumen de existencias agregadas por grupo de envase.
 * @param {Object} [options]
 */
function apiObtenerResumenPorGrupos(options) {
  const service = new StockQueryService(options);
  return service.obtenerResumenPorGrupos();
}

/**
 * Consulta las existencias filtradas por un grupo específico.
 * @param {string} grupo 
 * @param {Object} [options]
 */
function apiObtenerStockPorGrupo(grupo, options) {
  const service = new StockQueryService(options);
  return service.obtenerStockPorGrupo(grupo);
}

/**
 * Consulta el detalle desglosado de un grupo de envase.
 * @param {string} grupo 
 * @param {Object} [options]
 */
function apiObtenerDetalleGrupo(grupo, options) {
  const service = new StockQueryService(options);
  return service.obtenerDetalleGrupo(grupo);
}

/**
 * Consulta el saldo específico para un par artículo + envase.
 * @param {string} codigoArticulo 
 * @param {string} codigoEnvase 
 * @param {Object} [options]
 */
function apiObtenerDetalleStock(codigoArticulo, codigoEnvase, options) {
  const service = new StockQueryService(options);
  return service.obtenerDetalleStock(codigoArticulo, codigoEnvase);
}

/**
 * Confirma un documento de compra en estado PENDIENTE_REVISION tras resolución de envases.
 * Valida en servidor el Trust Boundary:
 * - El cliente envía exclusivamente: { idDocumento, lineResolutions }
 * - El cliente NO puede enviar rawText ni manipular líneas, cajas ni artículos.
 * - Las líneas originales proceden de fuentes controladas por el servidor (Drive o staging).
 * 
 * @param {Object} clientPayload - { idDocumento, lineResolutions } (procedente del cliente)
 * @param {string} [usuario]
 * @param {Object} [options] - Contexto de servidor (repository, driveService, canonicalLines de staging)
 * @returns {Object} Resultado de la confirmación
 */
function confirmarCompraPendiente(clientPayload, usuario, options = {}) {
  const repo = options.repository || (typeof SheetsRepository !== 'undefined' ? new SheetsRepository() : null);
  const maestro = repo ? repo.getMaestro() : [];
  const resolver = options.maestroResolver || (typeof MaestroResolver !== 'undefined' ? new MaestroResolver(maestro) : null);
  const lock = options.lockService || (typeof LockService !== 'undefined' ? LockService.getScriptLock() : null);
  const dedup = options.deduplicationService || (typeof checkDocumentDuplicate !== 'undefined' ? { checkDocumentDuplicate, buildLineIdentityKey, filterBatchForOverlaps } : null);
  const engine = options.inventoryEngine || (typeof processMovement !== 'undefined' ? { buildStockKey, processMovement, rebuildStockFromMovements } : null);

  const service = options.movementService || new MovementService({
    repository: repo,
    lockService: lock,
    deduplicationService: dedup,
    inventoryEngine: engine,
    driveService: options.driveService
  });

  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  return service.confirmarCompraPendiente(clientPayload, user, resolver, options);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initDatabase,
    ejecutarReconstruccionStock,
    registrarAjusteManual,
    testNucleoAppsScript,
    revisarDocumentoHispatec,
    confirmarDocumentoRevisado,
    confirmarCompraPendiente,
    configurarSpreadsheetId,
    configurarDriveFolderId,
    apiObtenerStockActual,
    apiObtenerResumenPorGrupos,
    apiObtenerStockPorGrupo,
    apiObtenerDetalleGrupo,
    apiObtenerDetalleStock
  };
}
