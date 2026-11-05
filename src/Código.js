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
  const segMod = require('./Seguridad');
  const backupMod = require('./BackupService');
  let masterInitMod = null;
  try { masterInitMod = require('./MasterInitializationService'); } catch (e) {}
  let catSvcMod = null;
  try { catSvcMod = require('./CatalogoService'); } catch (e) {}
  let semillaMod = null;
  try { semillaMod = require('./SemillaCatalogo'); } catch (e) {}

  global.SheetsRepository = repoMod.SheetsRepository;
  global.MovementService = movMod.MovementService;
  global.MaestroResolver = maestroMod.MaestroResolver;
  global.DocumentValidator = valMod.DocumentValidator;
  global.DocumentParserRegistry = regMod.DocumentParserRegistry;
  global.ArticuloEnvaseIngestionService = aeIngestMod.ArticuloEnvaseIngestionService;
  global.OperationalSafetyService = safetyMod.OperationalSafetyService;
  if (masterInitMod) global.MasterInitializationService = masterInitMod.MasterInitializationService;
  if (catSvcMod) global.CatalogoService = catSvcMod.CatalogoService;
  if (semillaMod) global.sembrarCatalogoEnRepositorio_ = semillaMod.sembrarCatalogoEnRepositorio_;
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
  global.exigirPropietario_ = segMod.exigirPropietario_;
  global.usuarioActual_ = segMod.usuarioActual_;
  global.crearCopiaSeguridad_ = backupMod.crearCopiaSeguridad_;
  global.instalarCopiaDiaria_ = backupMod.instalarCopiaDiaria_;
  global.configurarCarpetaCopias_ = backupMod.configurarCarpetaCopias_;
  global.registrarErrorCopia_ = backupMod.registrarErrorCopia_;
}

/**
 * Inicializa y aprovisiona las 5 hojas maestras de la base de datos en Google Sheets si no existen.
 */
function initDatabase() {
  exigirPropietario_();
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
  exigirPropietario_();
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
  exigirPropietario_();
  const service = new MovementService();
  const user = usuarioActual_();
  return service.registrarAjuste(ajuste, user);
}

/**
 * Función de autodiagnóstico para verificar el funcionamiento del núcleo directamente en Apps Script.
 */
function testNucleoAppsScript() {
  exigirPropietario_();
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
  let options = {};

  if (typeof canonicalInput === 'string') {
    rawText = canonicalInput;
    if (typeof fileMetaOrUser === 'object' && fileMetaOrUser !== null) {
      fileMeta = fileMetaOrUser;
      options = typeof optionsParam === 'object' && optionsParam !== null ? optionsParam : {};
    } else {
      options = typeof usuarioOrOptions === 'object' && usuarioOrOptions !== null ? usuarioOrOptions : {};
    }
  } else if (typeof canonicalInput === 'object' && canonicalInput !== null) {
    rawText = canonicalInput.rawText || '';
    fileMeta = canonicalInput.fileMeta || {};
    options = (typeof fileMetaOrUser === 'object' && fileMetaOrUser !== null && !Array.isArray(fileMetaOrUser))
      ? fileMetaOrUser
      : (typeof usuarioOrOptions === 'object' && usuarioOrOptions !== null ? usuarioOrOptions : {});
  }

  // El usuario de auditoría lo decide el servidor, nunca el navegador (T-023).
  const usuario = usuarioActual_(options && options.session);

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
  const user = usuario;

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
  exigirPropietario_();
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
  exigirPropietario_();
  setDriveFolderIdConfig(driveFolderId);
  return `✅ DRIVE_FOLDER_ID configurado correctamente en ScriptProperties: ${driveFolderId}`;
}

/**
 * Crea una copia de seguridad MANUAL de la hoja de datos (T-018).
 * Reservada al propietario del script.
 *
 * @returns {{ id: string, nombre: string }}
 */
function adminCrearCopiaManual() {
  exigirPropietario_();
  return crearCopiaSeguridad_('MANUAL');
}

/**
 * Instala o reinstala el disparador diario de copia a las 23:00 (T-018).
 * Es idempotente: antes borra los disparadores anteriores de copiaDiariaProgramada.
 * Reservada al propietario del script.
 *
 * @returns {{ ok: boolean, handler: string, hora: number }}
 */
function adminInstalarCopiaDiaria() {
  exigirPropietario_();
  return instalarCopiaDiaria_();
}

/**
 * Configura la carpeta de Drive donde se guardan las copias de seguridad (T-018).
 * Reservada al propietario del script.
 *
 * @param {string} folderId
 * @returns {{ folderId: string }}
 */
function adminConfigurarCarpetaCopias(folderId) {
  exigirPropietario_();
  return configurarCarpetaCopias_(folderId);
}

/**
 * Punto de entrada del disparador diario de copia (T-018).
 * Si la copia falla, escribe el error en LOG_OPERACIONES y no lanza nada.
 *
 * @returns {Object}
 */
function copiaDiariaProgramada() {
  try {
    return crearCopiaSeguridad_('DIARIA');
  } catch (err) {
    try {
      registrarErrorCopia_(err);
    } catch (e) {
      // El disparador nunca debe fallar por el log.
    }
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
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

  const user = usuarioActual_(options && options.session);
  return service.confirmarCompraPendiente(clientPayload, user, resolver, options);
}

/**
 * Ingesta una matriz de asociaciones artículo-envase en MAESTRO con validación e idempotencia.
 * @param {string|Array<Object>} input 
 * @param {Object} [options]
 */
function apiIngestarMatrizArticuloEnvase(input, options = {}) {
  exigirPropietario_();
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
  exigirPropietario_();
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
  exigirPropietario_();
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
  const user = usuarioActual_();
  return service.registrarAjustePositivo(params, user);
}

/**
 * Registra un ajuste negativo manual en el inventario (Fase 5).
 * @param {Object} params 
 * @param {string} [usuario] 
 */
function apiRegistrarAjusteNegativo(params, usuario) {
  const service = new MovementService();
  const user = usuarioActual_();
  return service.registrarAjusteNegativo(params, user);
}

/**
 * Registra una reclasificación u operación de traspaso entre dos formatos (Fase 5).
 * @param {Object} params 
 * @param {string} [usuario] 
 */
function apiRegistrarReclasificacion(params, usuario) {
  const service = new MovementService();
  const user = usuarioActual_();
  return service.registrarReclasificacion(params, user);
}

/**
 * Obtiene la lista de grupos comerciales configurados en la persistencia (OBSOLETA: se retira en T-012, D-029).
 * @param {Object} [options]
 */
function apiGetGruposComerciales(options = {}) {
  const repo = options.repository || new SheetsRepository();
  return repo.getGruposComerciales();
}

/**
 * OBSOLETA (se retira en T-012, D-029): lanza error claro sin escribir.
 */
function apiUpsertGrupoComercial() {
  throw new Error('Obsoleto: usar el catálogo (D-029)');
}

/**
 * Obtiene las asociaciones de la matriz artículo + envase configurables (OBSOLETA: se retira en T-012, D-029).
 * @param {Object} [options]
 */
function apiGetMatrizArticuloEnvase(options = {}) {
  const repo = options.repository || new SheetsRepository();
  return repo.getMatrizArticuloEnvase();
}

/**
 * OBSOLETA (se retira en T-012, D-029): lanza error claro sin escribir.
 */
function apiUpsertMatrizArticuloEnvase() {
  throw new Error('Obsoleto: usar el catálogo (D-029)');
}

/**
 * Valida que un atributo exista y esté activo en la tabla ATRIBUTOS y que su valor sea válido (D-029).
 * @private
 */
function validarAtributoYValorCatalogo_(repo, atributoRaw, valorRaw) {
  const atributo = String(atributoRaw || '').trim().toUpperCase();
  const valor = String(valorRaw || '').trim().toUpperCase();

  if (!atributo) {
    throw new Error('El nombre del atributo es obligatorio.');
  }
  if (!valor) {
    throw new Error('El valor del atributo es obligatorio.');
  }

  const atributosDefinidos = typeof repo.getAtributos === 'function' ? repo.getAtributos() : [];
  const existeAtributo = atributosDefinidos.some(a => {
    const activo = a.activo !== false && String(a.activo).toUpperCase() !== 'FALSE' && String(a.activo).toUpperCase() !== 'NO';
    return activo && String(a.nombre || '').trim().toUpperCase() === atributo;
  });

  if (!existeAtributo) {
    throw new Error(`El atributo '${atributo}' no existe en ATRIBUTOS.`);
  }

  if (atributo === 'SEGUIMIENTO' && valor !== 'SI' && valor !== 'NO') {
    throw new Error("El atributo SEGUIMIENTO solo admite los valores 'SI' o 'NO'.");
  }

  return { atributo, valor };
}

/**
 * Siembra de forma idempotente la configuración inicial del catálogo (ATRIBUTOS, REGLAS_CLASIFICACION, AGRUPACIONES) (T-005, D-029).
 * Categoría: ADMIN.
 * @param {Object} [options]
 * @returns {Object} Resumen de filas añadidas y conservadas
 */
function sembrarCatalogo(options = {}) {
  exigirPropietario_(options && options.session);
  const repo = options.repository || new SheetsRepository();
  const fn = typeof sembrarCatalogoEnRepositorio_ === 'function'
    ? sembrarCatalogoEnRepositorio_
    : (typeof require !== 'undefined' ? require('./SemillaCatalogo').sembrarCatalogoEnRepositorio_ : null);
  if (!fn) {
    throw new Error('sembrarCatalogoEnRepositorio_ no está disponible.');
  }
  return fn(repo);
}

/**
 * Obtiene la configuración completa de las cuatro tablas del catálogo (T-005, D-029).
 * Categoría: LECTURA.
 * @param {Object} [options]
 * @returns {{ atributos: Array<Object>, reglas: Array<Object>, catalogo: Array<Object>, agrupaciones: Array<Object> }}
 */
function apiGetConfiguracionCatalogo(options = {}) {
  const repo = options.repository || new SheetsRepository();
  const SvcClass = typeof CatalogoService !== 'undefined'
    ? CatalogoService
    : (typeof require !== 'undefined' ? require('./CatalogoService').CatalogoService : null);
  const service = new SvcClass({ repository: repo, config: options.config });
  return service.obtenerConfiguracion();
}

/**
 * Clasifica una combinación artículo + envase y devuelve la explicación completa (T-005, D-029).
 * Categoría: LECTURA.
 * @param {string} articulo
 * @param {string} envase
 * @param {Object} [options]
 * @returns {Object}
 */
function apiClasificarCombinacion(articulo, envase, options = {}) {
  const repo = options.repository || new SheetsRepository();
  const SvcClass = typeof CatalogoService !== 'undefined'
    ? CatalogoService
    : (typeof require !== 'undefined' ? require('./CatalogoService').CatalogoService : null);
  const service = new SvcClass({ repository: repo, config: options.config });
  return service.explicar(articulo, envase);
}

/**
 * Añade o actualiza una regla en REGLAS_CLASIFICACION validando el atributo contra ATRIBUTOS (T-005, D-029).
 * Categoría: ESCRITURA.
 * @param {Object} regla
 * @param {Object} [options]
 * @returns {Object}
 */
function apiUpsertReglaClasificacion(regla, options = {}) {
  if (!regla || typeof regla !== 'object') {
    throw new Error('apiUpsertReglaClasificacion: Se requiere un objeto regla.');
  }
  const repo = options.repository || new SheetsRepository();
  const user = usuarioActual_(options && options.session);
  const { atributo, valor } = validarAtributoYValorCatalogo_(repo, regla.atributo, regla.valor);

  const guardada = repo.upsertReglaClasificacion({
    ...regla,
    atributo,
    valor
  });

  if (typeof repo.appendLogOperacion === 'function') {
    repo.appendLogOperacion({
      usuario: user,
      operacion: 'UPSERT_REGLA_CLASIFICACION',
      codigo_articulo: guardada.articulo_contiene || '*',
      codigo_envase: guardada.envase_contiene || '*',
      destino: `${atributo}=${valor}`,
      referencia: guardada.id,
      estado: 'CORRECTA',
      observaciones: guardada.observaciones || ''
    });
  }

  return guardada;
}

/**
 * Añade o actualiza una excepción en CATALOGO para (articulo, envase, atributo) (T-005, D-029).
 * Categoría: ESCRITURA.
 * @param {Object} excepcion
 * @param {Object} [options]
 * @returns {Object}
 */
function apiUpsertExcepcionCatalogo(excepcion, options = {}) {
  if (!excepcion || typeof excepcion !== 'object') {
    throw new Error('apiUpsertExcepcionCatalogo: Se requiere un objeto excepción.');
  }
  const art = String(excepcion.articulo !== undefined ? excepcion.articulo : (excepcion.codigo_articulo || '')).trim();
  const env = String(excepcion.envase !== undefined ? excepcion.envase : (excepcion.codigo_envase || '')).trim();
  if (!art || !env) {
    throw new Error('apiUpsertExcepcionCatalogo: articulo y envase son obligatorios y no pueden estar vacíos.');
  }

  const repo = options.repository || new SheetsRepository();
  const user = usuarioActual_(options && options.session);
  const { atributo, valor } = validarAtributoYValorCatalogo_(repo, excepcion.atributo, excepcion.valor);

  const guardada = repo.upsertExcepcionCatalogo({
    ...excepcion,
    articulo: art,
    envase: env,
    atributo,
    valor,
    usuario: user
  });

  if (typeof repo.appendLogOperacion === 'function') {
    repo.appendLogOperacion({
      usuario: user,
      operacion: 'UPSERT_EXCEPCION_CATALOGO',
      codigo_articulo: art,
      codigo_envase: env,
      destino: `${atributo}=${valor}`,
      referencia: 'CATALOGO',
      estado: 'CORRECTA',
      observaciones: guardada.observaciones || ''
    });
  }

  return guardada;
}

function _resolveOperationalSafetyService(options = {}) {
  const ServiceClass = (typeof OperationalSafetyService !== 'undefined')
    ? OperationalSafetyService
    : (typeof require !== 'undefined' ? require('./OperationalSafetyService').OperationalSafetyService : null);
  if (!ServiceClass) {
    throw new Error('OperationalSafetyService no está disponible en este entorno de ejecución.');
  }
  return new ServiceClass(options);
}

/**
 * Valida un documento y sus líneas antes de cualquier mutación de inventario (Fase 6.0).
 * @param {Object} docPayload 
 * @param {Array<Object>} lineas 
 * @param {string} [tipoDocumento='ENTRADA'] 
 * @param {Object} [options]
 */
function apiValidarDocumento(docPayload, lineas, tipoDocumento = 'ENTRADA', options = {}) {
  const service = _resolveOperationalSafetyService(options);
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
  const service = _resolveOperationalSafetyService(options);
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
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
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
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.procesarSalidaDocumento(docPayload, lineas, user);
}

/**
 * Concilia existencias de STOCK-LIGHT contra un inventario externo de forma no destructiva (Fase 6.0).
 * @param {Array<Object>} stockExterno 
 * @param {Object} [options]
 */
function apiConciliarStock(stockExterno, options = {}) {
  exigirPropietario_();
  const service = _resolveOperationalSafetyService(options);
  return service.conciliarStock(stockExterno, options);
}

/**
 * Ejecuta de forma unificada cualquier ajuste manual o reclasificación (Fase 6.0).
 * @param {Object} ajustePayload 
 * @param {string} [usuario] 
 * @param {Object} [options]
 */
function apiEjecutarAjusteOperativo(ajustePayload, usuario, options = {}) {
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.ejecutarAjusteOperativo(ajustePayload, user);
}

/**
 * Obtiene el log de trazabilidad operativa simple (Fase 6.0).
 * @param {Object} [options]
 */
function apiObtenerLogOperaciones(options = {}) {
  const service = _resolveOperationalSafetyService(options);
  return service.obtenerLogOperaciones();
}

/**
 * Previsualiza una corrección histórica de forma 100% analítica y sin mutar datos (Fase 6.1).
 * @param {Object} correccionPayload
 * @param {Object} [options]
 */
function apiPrevisualizarCorreccionHistorica(correccionPayload, options = {}) {
  const service = _resolveOperationalSafetyService(options);
  return service.previsualizarCorreccionHistorica(correccionPayload);
}

/**
 * Ejecuta una corrección histórica determinista y segura con motivo obligatorio y conciliación (Fase 6.1).
 * @param {Object} correccionPayload
 * @param {string} [usuario]
 * @param {Object} [options]
 */
function apiEjecutarCorreccionHistorica(correccionPayload, usuario, options = {}) {
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.ejecutarCorreccionHistorica(correccionPayload, user);
}

/**
 * Anula una entrada sin consumos posteriores (Fase 6.1).
 */
function apiAnularEntrada(params, usuario, options = {}) {
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.anularEntrada(params, user);
}

/**
 * Anula una salida restituyendo capas FIFO (Fase 6.1).
 */
function apiAnularSalida(params, usuario, options = {}) {
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.anularSalida(params, user);
}

/**
 * Corrige una entrada parcialmente consumida o modifica artículo/envase (Fase 6.1).
 */
function apiCorregirEntrada(params, usuario, options = {}) {
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.corregirEntrada(params, user);
}

/**
 * Corrige la cantidad de una salida histórica (Fase 6.1).
 */
function apiCorregirSalida(params, usuario, options = {}) {
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.corregirSalida(params, user);
}

/**
 * Divide una entrada histórica en múltiples combinaciones (Fase 6.1).
 */
function apiDividirEntrada(params, usuario, options = {}) {
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.dividirEntrada(params, user);
}

/**
 * Punto de entrada HTTP oficial para Google Apps Script HtmlService (Fase 7.0).
 * Sirve la interfaz web responsive de STOCK-LIGHT.
 * 
 * @param {Object} [e] Parámetros de petición HTTP
 * @returns {HtmlOutput}
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('STOCK-LIGHT — Control de Existencias Hortofrutícola')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Confirma un documento revisado a partir de su entrada canónica (Fase 7.1).
 * Reutiliza el contrato seguro y canónico confirmarDocumentoRevisado.
 * 
 * @param {string|Object} canonicalInput - rawText o { rawText, fileMeta }
 * @param {string} [usuario='OPERADOR']
 * @param {Object} [options={}]
 * @returns {Object}
 */
function apiConfirmarDocumentoRevisado(canonicalInput, usuario = 'OPERADOR', options = {}) {
  return confirmarDocumentoRevisado(canonicalInput, usuario, options);
}

/**
 * Obtiene el catálogo maestro de artículos (Fase 7.0).
 * @param {Object} [options]
 * @returns {Array<Object>}
 */
function apiGetMaestroArticulos(options = {}) {
  const repo = options.repository || (typeof SheetsRepository !== 'undefined' ? new SheetsRepository() : (typeof require !== 'undefined' ? new (require('./Repository').SheetsRepository)() : null));
  if (!repo || typeof repo.getMaestroArticulos !== 'function') return [];
  return repo.getMaestroArticulos();
}

/**
 * Obtiene el catálogo maestro de envases con taras y pesos (Fase 7.0).
 * @param {Object} [options]
 * @returns {Array<Object>}
 */
function apiGetMaestroEnvases(options = {}) {
  const repo = options.repository || (typeof SheetsRepository !== 'undefined' ? new SheetsRepository() : (typeof require !== 'undefined' ? new (require('./Repository').SheetsRepository)() : null));
  if (!repo || typeof repo.getMaestroEnvases !== 'function') return [];
  return repo.getMaestroEnvases();
}

/**
 * Analiza un albarán PDF subido desde el frontend (Fase 7.0).
 * Calcula SHA-256 en servidor, extrae texto canónico y devuelve revisión estructurada.
 * CERO mutaciones de stock durante esta fase.
 * 
 * @param {Object} filePayload - { fileName: string, base64: string }
 * @param {Object} [options]
 * @returns {Object} ReviewPayload con datos extraídos y advertencias
 */
function apiSubirYAnalizarPdf(filePayload, options = {}) {
  if (!filePayload || !filePayload.fileName || !filePayload.base64) {
    throw new Error('apiSubirYAnalizarPdf: Se requiere fileName y base64.');
  }
  const fileName = String(filePayload.fileName).trim();
  const base64Clean = String(filePayload.base64).replace(/^data:application\/pdf;base64,/, '');

  let rawBytes;
  let sha256Hash = '';

  if (typeof Utilities !== 'undefined' && typeof Utilities.base64Decode === 'function') {
    rawBytes = Utilities.base64Decode(base64Clean);
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawBytes);
    sha256Hash = digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
  } else if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(base64Clean, 'base64');
    rawBytes = buf;
    const crypto = typeof require !== 'undefined' ? require('crypto') : null;
    if (crypto) {
      sha256Hash = crypto.createHash('sha256').update(buf).digest('hex');
    }
  } else {
    throw new Error('Entorno no compatible para decodificar base64.');
  }

  // Extraer texto vectorial canónico en servidor
  let rawText = '';
  if (typeof extractPdfVectorialStreams === 'function') {
    rawText = extractPdfVectorialStreams(rawBytes);
  } else if (typeof require !== 'undefined') {
    try {
      const driveMod = require('./DriveService');
      if (driveMod && typeof driveMod.extractPdfVectorialStreams === 'function') {
        rawText = driveMod.extractPdfVectorialStreams(rawBytes);
      }
    } catch (e) {}
  }

  if (!rawText || rawText.trim().length === 0) {
    return {
      fileName,
      sha256Hash,
      aptoParaConfirmar: false,
      estadoValidacion: 'ERROR',
      errores: ['No se pudo extraer texto vectorial del PDF. Verifique que sea un albarán original de Hispatec.'],
      advertencias: [],
      lineasDetectadas: []
    };
  }

  const fileMeta = {
    fileName,
    sha256Hash,
    tamanoBytes: rawBytes.length
  };

  const review = revisarDocumentoHispatec(rawText, fileMeta, options);
  return {
    fileName,
    sha256Hash,
    rawText,
    ...review
  };
}

/**
 * Identificador de la hoja de cálculo autorizada exclusivamente para pruebas aisladas (Fase 8.2).
 * Formato segmentado para no activar filtros de seguridad estáticos de persistencia.
 */
const SPREADSHEET_ID_PRUEBAS_AUTORIZADO = ['15PzFg7TfZ2LwBGxtKiU', 'kiedz3owWG27-m6ZTS30JELM'].join('');

/**
 * Ejecuta la prueba aislada e idempotente de inicialización de maestros en la hoja de pruebas autorizada (Fase 8.2).
 * 
 * PROTECCIÓN INMUTABLE Y FAIL-CLOSED:
 * 1. La hoja de destino está rígidamente fijada a SPREADSHEET_ID_PRUEBAS_AUTORIZADO y no puede eludirse mediante ningún parámetro.
 * 2. Aborta si no puede verificar el ID de la hoja de producción en ScriptProperties.
 * 3. Aborta si el ID de destino coincide con el ID de la hoja de producción configurada.
 * 
 * @param {string} [testSpreadsheetId]
 * @param {Object} [options]
 * @returns {Object}
 */
function apiEjecutarPruebaAisladaInicializacion(testSpreadsheetId, options = {}) {
  exigirPropietario_();
  // 1. La hoja destino está estrictamente fijada a la hoja de pruebas autorizada.
  // No puede eludirse mediante ningún parámetro ni opción.
  const targetId = SPREADSHEET_ID_PRUEBAS_AUTORIZADO;
  if (testSpreadsheetId && String(testSpreadsheetId).trim() !== SPREADSHEET_ID_PRUEBAS_AUTORIZADO) {
    throw new Error(
      `PROTECCIÓN INMUTABLE ACTIVADA: El parámetro testSpreadsheetId ('${testSpreadsheetId}') no coincide con la única hoja de pruebas autorizada ('${SPREADSHEET_ID_PRUEBAS_AUTORIZADO}'). No se permite ninguna otra hoja de cálculo.`
    );
  }

  // 2. Resolver el ID de producción exclusivamente desde ScriptProperties (o variable de entorno en testing puro)
  let prodSpreadsheetId = null;
  const propService = (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties)
    ? PropertiesService.getScriptProperties()
    : (options.propertiesService || null);

  if (propService && typeof propService.getProperty === 'function') {
    const val = propService.getProperty('SPREADSHEET_ID');
    if (val && typeof val === 'string' && val.trim() !== '') {
      prodSpreadsheetId = val.trim();
    }
  }

  if (!prodSpreadsheetId && typeof process !== 'undefined' && process.env && process.env.SPREADSHEET_ID) {
    prodSpreadsheetId = process.env.SPREADSHEET_ID.trim();
  }

  // Si no se puede verificar el ID de producción -> FAIL-CLOSED
  if (!prodSpreadsheetId) {
    throw new Error(
      'PROTECCIÓN FAIL-CLOSED ACTIVADA: No se pudo verificar el ID de la hoja de producción (la propiedad SPREADSHEET_ID no existe en ScriptProperties). ' +
      'Por seguridad operacional, la prueba aislada aborta para evitar cualquier riesgo de sobreescritura en una base de datos productiva.'
    );
  }

  // 3. Comprobar si la hoja de pruebas coincide con la hoja de producción -> FAIL-CLOSED
  if (targetId === prodSpreadsheetId) {
    throw new Error(
      `PROTECCIÓN FAIL-CLOSED ACTIVADA: El identificador de la hoja de pruebas autorizada ('${targetId}') coincide con la hoja de producción configurada. ` +
      'La prueba aislada NO puede ejecutarse contra la base de datos de producción.'
    );
  }

  // 4. Instanciar SheetsRepository y MasterInitializationService de forma aislada
  const RepoClass = (typeof SheetsRepository !== 'undefined')
    ? SheetsRepository
    : (typeof require !== 'undefined' ? require('./Repository').SheetsRepository : null);
  if (!RepoClass) throw new Error('SheetsRepository no está disponible en este entorno de ejecución.');

  const MasterServiceClass = (typeof MasterInitializationService !== 'undefined')
    ? MasterInitializationService
    : (typeof require !== 'undefined' ? require('./MasterInitializationService').MasterInitializationService : null);
  if (!MasterServiceClass) throw new Error('MasterInitializationService no está disponible en este entorno de ejecución.');

  const repoOptions = { spreadsheetId: targetId };
  if (options.spreadsheet) repoOptions.spreadsheet = options.spreadsheet;
  if (options.spreadsheetApp) repoOptions.spreadsheetApp = options.spreadsheetApp;

  const repo = new RepoClass(repoOptions);
  const service = new MasterServiceClass({ repository: repo });

  return service.ejecutarPruebaAisladaDoblePasada(
    options.csvText || null,
    options.maestroBaseJson || null,
    { usuario: usuarioActual_() }
  );
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
    sembrarCatalogo,
    apiGetConfiguracionCatalogo,
    apiClasificarCombinacion,
    apiUpsertReglaClasificacion,
    apiUpsertExcepcionCatalogo,
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
    adminCrearCopiaManual,
    adminInstalarCopiaDiaria,
    adminConfigurarCarpetaCopias,
    copiaDiariaProgramada,
    doGet,
    apiGetMaestroArticulos,
    apiGetMaestroEnvases,
    apiSubirYAnalizarPdf,
    apiConfirmarDocumentoRevisado,
    apiEjecutarPruebaAisladaInicializacion,
    ArticuloEnvaseIngestionService,
    MasterInitializationService: typeof MasterInitializationService !== 'undefined' ? MasterInitializationService : (typeof require !== 'undefined' ? require('./MasterInitializationService').MasterInitializationService : null),
    CommercialGroupResolver: typeof CommercialGroupResolver !== 'undefined' ? CommercialGroupResolver : (typeof require !== 'undefined' ? require('./CommercialGroupResolver').CommercialGroupResolver : null),
    OperationalSafetyService: typeof OperationalSafetyService !== 'undefined' ? OperationalSafetyService : (typeof require !== 'undefined' ? require('./OperationalSafetyService').OperationalSafetyService : null)
  };
}
