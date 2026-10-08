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
  const aeIngestMod = require('./ArticuloEnvaseIngestionService');
  const safetyMod = require('./OperationalSafetyService');

  global.SheetsRepository = repoMod.SheetsRepository;
  global.MovementService = movMod.MovementService;
  global.MaestroResolver = maestroMod.MaestroResolver;
  global.DocumentValidator = valMod.DocumentValidator;
  global.DocumentParserRegistry = regMod.DocumentParserRegistry;
  global.ArticuloEnvaseIngestionService = aeIngestMod.ArticuloEnvaseIngestionService;
  global.OperationalSafetyService = safetyMod.OperationalSafetyService;
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

/**
 * Ingesta una matriz de asociaciones artículo-envase en MAESTRO con validación e idempotencia.
 * @param {string|Array<Object>} input 
 * @param {Object} [options]
 */
function apiIngestarMatrizArticuloEnvase(input, options = {}) {
  const service = new ArticuloEnvaseIngestionService(options);
  return service.ingestarMatriz(input, options);
}

/**
 * Cambia el envase predeterminado de un artículo en MAESTRO de forma atómica y explícita.
 * @param {string} codigoArticulo 
 * @param {string} nuevoEnvasePredeterminado 
 * @param {Object} [options]
 */
/**
 * Cambia el envase predeterminado de un artículo en MAESTRO de forma atómica y explícita.
 * @param {string} codigoArticulo 
 * @param {string} nuevoEnvasePredeterminado 
 * @param {Object} [options]
 */
function apiCambiarEnvasePredeterminado(codigoArticulo, nuevoEnvasePredeterminado, options = {}) {
  const service = new ArticuloEnvaseIngestionService(options);
  return service.cambiarEnvasePredeterminado(codigoArticulo, nuevoEnvasePredeterminado, options);
}

/**
 * Obtiene el resumen visual simplificado de existencias agrupado comercialmente (Fase 4).
 * Apto para usuarios no técnicos y diseño responsivo móvil/tablet/PC.
 * @param {Object} [options]
 */
function apiObtenerStockVisualResumen(options = {}) {
  const service = new StockQueryService(options);
  return service.obtenerStockVisualResumen();
}

/**
 * Obtiene el desglose detallado de existencias de un grupo comercial (Fase 4).
 * Permite llegar hasta el nivel de Artículo + Envase + Calibre/Categoría + Cajas.
 * @param {string} groupId 
 * @param {string} [subgroupId] 
 * @param {Object} [options] 
 */
function apiObtenerStockVisualDetalle(groupId, subgroupId, options = {}) {
  const service = new StockQueryService(options);
  return service.obtenerStockVisualDetalle(groupId, subgroupId);
}

/**
 * Clasifica una combinación artículo-envase utilizando el CommercialGroupResolver (Fase 4).
 * @param {string|Object} articulo 
 * @param {string} [envase] 
 * @param {Object} [options] 
 */
function apiClasificarArticuloEnvase(articulo, envase, options = {}) {
  const resolver = (typeof CommercialGroupResolver !== 'undefined')
    ? new CommercialGroupResolver(options)
    : (typeof require !== 'undefined' ? new (require('./CommercialGroupResolver').CommercialGroupResolver)(options) : null);
  if (!resolver) throw new Error('CommercialGroupResolver no disponible.');
  return resolver.resolve(articulo, envase, options);
}

/**
 * Carga un catálogo histórico adicional sin inventar asociaciones automáticas.
 * Las combinaciones no contempladas quedan marcadas como 'PENDIENTE DE ASOCIACIÓN'.
 * @param {Array<Object>|string} catalogData
 * @param {Object} [options]
 */
function apiCargarCatalogoHistorico(catalogData, options = {}) {
  const resolver = (typeof CommercialGroupResolver !== 'undefined')
    ? new CommercialGroupResolver(options)
    : (typeof require !== 'undefined' ? new (require('./CommercialGroupResolver').CommercialGroupResolver)(options) : null);
  if (!resolver) throw new Error('CommercialGroupResolver no disponible.');
  return resolver.loadHistoricalCatalog(catalogData, options);
}

/**
 * Obtiene la lista de combinaciones pendientes de asociación para posterior revisión.
 * @param {Object} [options]
 */
function apiObtenerCombinacionesPendientesAsociacion(options = {}) {
  const resolver = (typeof CommercialGroupResolver !== 'undefined')
    ? new CommercialGroupResolver(options)
    : (typeof require !== 'undefined' ? new (require('./CommercialGroupResolver').CommercialGroupResolver)(options) : null);
  if (!resolver) throw new Error('CommercialGroupResolver no disponible.');
  return resolver.getCombinacionesPendientes();
}

/**
 * Consulta las capas FIFO vivas de un artículo + envase concreto para mostrar partidas (Fase 5 - Drill Down Nivel 5).
 * @param {string} codigoArticulo 
 * @param {string} codigoEnvase 
 * @param {Object} [options] 
 */
function apiObtenerDetallePartidas(codigoArticulo, codigoEnvase, options = {}) {
  const service = new StockQueryService(options);
  return service.obtenerDetallePartidas(codigoArticulo, codigoEnvase, options);
}

/**
 * Registra un ajuste positivo manual en el inventario (Fase 5).
 * @param {Object} params 
 * @param {string} [usuario] 
 */
function apiRegistrarAjustePositivo(params, usuario) {
  const service = new MovementService();
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  return service.registrarAjustePositivo(params, user);
}

/**
 * Registra un ajuste negativo manual en el inventario (Fase 5).
 * @param {Object} params 
 * @param {string} [usuario] 
 */
function apiRegistrarAjusteNegativo(params, usuario) {
  const service = new MovementService();
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  return service.registrarAjusteNegativo(params, user);
}

/**
 * Registra una reclasificación u operación de traspaso entre dos formatos (Fase 5).
 * @param {Object} params 
 * @param {string} [usuario] 
 */
function apiRegistrarReclasificacion(params, usuario) {
  const service = new MovementService();
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  return service.registrarReclasificacion(params, user);
}

/**
 * Obtiene la lista de grupos comerciales configurados en la persistencia (Fase 5).
 * @param {Object} [options]
 */
function apiGetGruposComerciales(options = {}) {
  const repo = options.repository || new SheetsRepository();
  return repo.getGruposComerciales();
}

/**
 * Inserta o actualiza un grupo comercial en la persistencia (Fase 5).
 * @param {Object} grupo 
 * @param {Object} [options]
 */
function apiUpsertGrupoComercial(grupo, options = {}) {
  const repo = options.repository || new SheetsRepository();
  return repo.upsertGrupoComercial(grupo);
}

/**
 * Obtiene las asociaciones de la matriz artículo + envase configurables (Fase 5).
 * @param {Object} [options]
 */
function apiGetMatrizArticuloEnvase(options = {}) {
  const repo = options.repository || new SheetsRepository();
  return repo.getMatrizArticuloEnvase();
}

/**
 * Inserta o actualiza una asociación en la matriz artículo + envase (Fase 5).
 * @param {Object} asociacion 
 * @param {Object} [options]
 */
function apiUpsertMatrizArticuloEnvase(asociacion, options = {}) {
  const repo = options.repository || new SheetsRepository();
  return repo.upsertMatrizArticuloEnvase(asociacion);
}

/**
 * Valida un documento y sus líneas antes de cualquier mutación de inventario (Fase 6.0).
 * @param {Object} docPayload 
 * @param {Array<Object>} lineas 
 * @param {string} [tipoDocumento='ENTRADA'] 
 * @param {Object} [options]
 */
function apiValidarDocumento(docPayload, lineas, tipoDocumento = 'ENTRADA', options = {}) {
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.validarDocumento(docPayload, lineas, tipoDocumento);
}

/**
 * Genera la previsualización interactiva con semáforo (OK/PENDIENTE/ERROR) (Fase 6.0).
 * @param {Object} docPayload 
 * @param {Array<Object>} lineas 
 * @param {string} [tipoDocumento='ENTRADA'] 
 * @param {Object} [options]
 */
function apiPrevisualizarDocumento(docPayload, lineas, tipoDocumento = 'ENTRADA', options = {}) {
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.previsualizarDocumento(docPayload, lineas, tipoDocumento);
}

/**
 * Procesa una entrada tras validación previa obligatoria y control de duplicados (Fase 6.0).
 * @param {Object} docPayload 
 * @param {Array<Object>} lineas 
 * @param {string} [usuario] 
 * @param {Object} [options]
 */
function apiProcesarEntradaDocumento(docPayload, lineas, usuario, options = {}) {
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.procesarEntradaDocumento(docPayload, lineas, user);
}

/**
 * Procesa una salida tras validación previa y comprobación estricta de stock disponible (Fase 6.0).
 * @param {Object} docPayload 
 * @param {Array<Object>} lineas 
 * @param {string} [usuario] 
 * @param {Object} [options]
 */
function apiProcesarSalidaDocumento(docPayload, lineas, usuario, options = {}) {
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.procesarSalidaDocumento(docPayload, lineas, user);
}

/**
 * Concilia existencias de STOCK-LIGHT contra un inventario externo de forma no destructiva (Fase 6.0).
 * @param {Array<Object>} stockExterno 
 * @param {Object} [options]
 */
function apiConciliarStock(stockExterno, options = {}) {
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.conciliarStock(stockExterno, options);
}

/**
 * Ejecuta de forma unificada cualquier ajuste manual o reclasificación (Fase 6.0).
 * @param {Object} ajustePayload 
 * @param {string} [usuario] 
 * @param {Object} [options]
 */
function apiEjecutarAjusteOperativo(ajustePayload, usuario, options = {}) {
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.ejecutarAjusteOperativo(ajustePayload, user);
}

/**
 * Obtiene el log de trazabilidad operativa simple (Fase 6.0).
 * @param {Object} [options]
 */
function apiObtenerLogOperaciones(options = {}) {
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.obtenerLogOperaciones();
}

/**
 * Previsualiza una corrección histórica de forma 100% analítica y sin mutar datos (Fase 6.1).
 * @param {Object} correccionPayload
 * @param {Object} [options]
 */
function apiPrevisualizarCorreccionHistorica(correccionPayload, options = {}) {
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.previsualizarCorreccionHistorica(correccionPayload);
}

/**
 * Ejecuta una corrección histórica determinista y segura con motivo obligatorio y conciliación (Fase 6.1).
 * @param {Object} correccionPayload
 * @param {string} [usuario]
 * @param {Object} [options]
 */
function apiEjecutarCorreccionHistorica(correccionPayload, usuario, options = {}) {
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.ejecutarCorreccionHistorica(correccionPayload, user);
}

/**
 * Anula una entrada sin consumos posteriores (Fase 6.1).
 */
function apiAnularEntrada(params, usuario, options = {}) {
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.anularEntrada(params, user);
}

/**
 * Anula una salida restituyendo capas FIFO (Fase 6.1).
 */
function apiAnularSalida(params, usuario, options = {}) {
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.anularSalida(params, user);
}

/**
 * Corrige una entrada parcialmente consumida o modifica artículo/envase (Fase 6.1).
 */
function apiCorregirEntrada(params, usuario, options = {}) {
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.corregirEntrada(params, user);
}

/**
 * Corrige la cantidad de una salida histórica (Fase 6.1).
 */
function apiCorregirSalida(params, usuario, options = {}) {
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.corregirSalida(params, user);
}

/**
 * Divide una entrada histórica en múltiples combinaciones (Fase 6.1).
 */
function apiDividirEntrada(params, usuario, options = {}) {
  const user = usuario || (typeof Session !== 'undefined' ? (Session.getActiveUser().getEmail() || 'OPERADOR') : 'OPERADOR');
  const service = new (typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : require('./OperationalSafetyService').OperationalSafetyService)(options);
  return service.dividirEntrada(params, user);
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
    apiObtenerDetalleStock,
    apiIngestarMatrizArticuloEnvase,
    apiCambiarEnvasePredeterminado,
    apiObtenerStockVisualResumen,
    apiObtenerStockVisualDetalle,
    apiClasificarArticuloEnvase,
    apiCargarCatalogoHistorico,
    apiObtenerCombinacionesPendientesAsociacion,
    apiObtenerDetallePartidas,
    apiRegistrarAjustePositivo,
    apiRegistrarAjusteNegativo,
    apiRegistrarReclasificacion,
    apiGetGruposComerciales,
    apiUpsertGrupoComercial,
    apiGetMatrizArticuloEnvase,
    apiUpsertMatrizArticuloEnvase,
    apiValidarDocumento,
    apiPrevisualizarDocumento,
    apiProcesarEntradaDocumento,
    apiProcesarSalidaDocumento,
    apiConciliarStock,
    apiEjecutarAjusteOperativo,
    apiObtenerLogOperaciones,
    apiPrevisualizarCorreccionHistorica,
    apiEjecutarCorreccionHistorica,
    apiAnularEntrada,
    apiAnularSalida,
    apiCorregirEntrada,
    apiCorregirSalida,
    apiDividirEntrada,
    ArticuloEnvaseIngestionService,
    CommercialGroupResolver: typeof CommercialGroupResolver !== 'undefined' ? CommercialGroupResolver : (typeof require !== 'undefined' ? require('./CommercialGroupResolver').CommercialGroupResolver : null),
    OperationalSafetyService: typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : (typeof require !== 'undefined' ? require('./OperationalSafetyService').OperationalSafetyService : null)
  };
}
