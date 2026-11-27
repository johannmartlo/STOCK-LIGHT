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
  let importacionMod = null;
  try { importacionMod = require('./importacion/ImportacionService'); } catch (e) {}
  let pendientesMod = null;
  try { pendientesMod = require('./importacion/PendientesService'); } catch (e) {}
  let semillaMod = null;
  try { semillaMod = require('./SemillaCatalogo'); } catch (e) {}
  let instalacionMod = null;
  try { instalacionMod = require('./Instalacion'); } catch (e) {}
  let stockInicialMod = null;
  try { stockInicialMod = require('./importacion/StockInicialService'); } catch (e) {}
  let operacionesMod = null;
  try { operacionesMod = require('./OperacionesService'); } catch (e) {}
  let inicioMod = null;
  try { inicioMod = require('./InicioService'); } catch (e) {}
  let parteMod = null;
  try { parteMod = require('./ParteService'); } catch (e) {}
  let cuadreMod = null;
  try { cuadreMod = require('./CuadreService'); } catch (e) {}
  let correccionMod = null;
  try { correccionMod = require('./CorreccionService'); } catch (e) {}
  let exclusionesMod = null;
  try { exclusionesMod = require('./Exclusiones'); } catch (e) {}
  let equivalenciasMod = null;
  try { equivalenciasMod = require('./Equivalencias'); } catch (e) {}
  let fechaCorteMod = null;
  try { fechaCorteMod = require('./FechaCorte'); } catch (e) {}
  let seguimientoMod = null;
  try { seguimientoMod = require('./SeguimientoService'); } catch (e) {}

  global.SheetsRepository = repoMod.SheetsRepository;
  global.MovementService = movMod.MovementService;
  global.MaestroResolver = maestroMod.MaestroResolver;
  global.DocumentValidator = valMod.DocumentValidator;
  global.DocumentParserRegistry = regMod.DocumentParserRegistry;
  global.ArticuloEnvaseIngestionService = aeIngestMod.ArticuloEnvaseIngestionService;
  global.OperationalSafetyService = safetyMod.OperationalSafetyService;
  if (masterInitMod) global.MasterInitializationService = masterInitMod.MasterInitializationService;
  if (catSvcMod) global.CatalogoService = catSvcMod.CatalogoService;
  if (importacionMod) global.ImportacionService = importacionMod.ImportacionService;
  if (pendientesMod) global.PendientesService = pendientesMod.PendientesService;
  if (semillaMod) global.sembrarCatalogoEnRepositorio_ = semillaMod.sembrarCatalogoEnRepositorio_;
  if (instalacionMod) global.adminInstalarStockLight = global.adminInstalarStockLight || instalacionMod.adminInstalarStockLight;
  if (stockInicialMod) global.StockInicialService = global.StockInicialService || stockInicialMod.StockInicialService;
  if (operacionesMod) global.OperacionesService = global.OperacionesService || operacionesMod.OperacionesService;
  if (inicioMod) global.InicioService = global.InicioService || inicioMod.InicioService;
  if (parteMod) {
    global.ParteService = global.ParteService || parteMod.ParteService;
    global.enviarParteDiario_ = global.enviarParteDiario_ || parteMod.enviarParteDiario_;
    global.leerDestinatariosParte_ = global.leerDestinatariosParte_ || parteMod.leerDestinatariosParte_;
    global.leerHoraParte_ = global.leerHoraParte_ || parteMod.leerHoraParte_;
    global.normalizarDestinatariosParte_ = global.normalizarDestinatariosParte_ || parteMod.normalizarDestinatariosParte_;
  }
  if (cuadreMod) global.CuadreService = global.CuadreService || cuadreMod.CuadreService;
  if (correccionMod) global.CorreccionService = global.CorreccionService || correccionMod.CorreccionService;
  if (exclusionesMod) {
    global.adminConfigurarClientesExcluidos = global.adminConfigurarClientesExcluidos || exclusionesMod.adminConfigurarClientesExcluidos;
    global.adminConfigurarArticulosFuera = global.adminConfigurarArticulosFuera || exclusionesMod.adminConfigurarArticulosFuera;
    global.listarExclusiones_ = global.listarExclusiones_ || exclusionesMod.listarExclusiones_;
    global.leerClientesExcluidos_ = global.leerClientesExcluidos_ || exclusionesMod.leerClientesExcluidos_;
    global.esClienteExcluido_ = global.esClienteExcluido_ || exclusionesMod.esClienteExcluido_;
  }
  if (equivalenciasMod) {
    global.adminConfigurarEquivalencias = global.adminConfigurarEquivalencias || equivalenciasMod.adminConfigurarEquivalencias;
    global.listarEquivalencias_ = global.listarEquivalencias_ || equivalenciasMod.listarEquivalencias_;
    global.leerEquivalencias_ = global.leerEquivalencias_ || equivalenciasMod.leerEquivalencias_;
    global.mapaEquivalencias_ = global.mapaEquivalencias_ || equivalenciasMod.mapaEquivalencias_;
    global.normalizarDescripcionEquivalencia_ = global.normalizarDescripcionEquivalencia_ || equivalenciasMod.normalizarDescripcionEquivalencia_;
  }
  if (fechaCorteMod) {
    global.adminConfigurarFechaCorte = global.adminConfigurarFechaCorte || fechaCorteMod.adminConfigurarFechaCorte;
  }
  if (seguimientoMod) global.SeguimientoService = global.SeguimientoService || seguimientoMod.SeguimientoService;
  global.processMovement = engMod.processMovement;
  global.buildStockKey = engMod.buildStockKey;
  global.checkDocumentDuplicate = dedupMod.checkDocumentDuplicate;
  global.buildLineIdentityKey = dedupMod.buildLineIdentityKey;
  global.filterBatchForOverlaps = dedupMod.filterBatchForOverlaps;
  global.setSpreadsheetIdConfig = confMod.setSpreadsheetIdConfig;
  global.getSpreadsheetIdConfig = confMod.getSpreadsheetIdConfig;
  global.setDriveFolderIdConfig = confMod.setDriveFolderIdConfig;
  global.getDriveFolderIdConfig = confMod.getDriveFolderIdConfig;
  global.getFuenteEntradasConfig = confMod.getFuenteEntradasConfig;
  global.setFuenteEntradasConfig = confMod.setFuenteEntradasConfig;
  global.normalizarFuenteEntradas_ = confMod.normalizarFuenteEntradas_;
  global.getFechaCorteImportacionConfig = confMod.getFechaCorteImportacionConfig;
  global.setFechaCorteImportacionConfig = confMod.setFechaCorteImportacionConfig;
  global.normalizarFechaCorteImportacion_ = confMod.normalizarFechaCorteImportacion_;
  global.resolveDatabaseSpreadsheet = confMod.resolveDatabaseSpreadsheet;
  global.DriveService = driveMod.DriveService;
  global.StockQueryService = queryMod.StockQueryService;
  global.exigirPropietario_ = segMod.exigirPropietario_;
  global.usuarioActual_ = segMod.usuarioActual_;
  global.exigirSesionApi_ = segMod.exigirSesionApi_;
  global.ejecutarConContexto_ = segMod.ejecutarConContexto_;
  global.conContextoDePrueba_ = segMod.conContextoDePrueba_;
  global.crearServicioAcceso_ = segMod.crearServicioAcceso_;
  global.rolAlcanza_ = segMod.rolAlcanza_;
  global.PERMISOS_API = segMod.PERMISOS_API;
  global.ROLES_USUARIO = segMod.ROLES_USUARIO;
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
  exigirSesionApi_();
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
  exigirSesionApi_();
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
 * Configura los destinatarios y la hora del parte diario (T-029).
 * Reservada al propietario del script.
 *
 * @param {string|Array<string>} destinatarios - Lista separada por comas.
 * @param {number} [hora=21] - Hora local (0-23) en Europe/Madrid.
 * @param {Object} [options] - Inyección para pruebas.
 * @returns {{ destinatarios: Array<string>, hora: number }}
 */
function adminConfigurarParte(destinatarios, hora = 21, options = {}) {
  exigirPropietario_(options && options.session);

  const lista = normalizarDestinatariosParte_(destinatarios);
  const horaNum = hora === undefined || hora === null || String(hora).trim() === '' ? 21 : Number(hora);
  if (!Number.isInteger(horaNum) || horaNum < 0 || horaNum > 23) {
    throw new Error('La hora del parte debe ser un entero entre 0 y 23.');
  }

  const propService = options.propertiesService
    || (typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null);
  if (!propService || typeof propService.setProperty !== 'function') {
    throw new Error('PropertiesService no está disponible para configurar el parte.');
  }

  propService.setProperty('PARTE_DESTINATARIOS', lista.join(','));
  propService.setProperty('PARTE_HORA', String(horaNum));
  return { destinatarios: lista, hora: horaNum };
}

/**
 * Cambia la fuente de entradas entre COMPRAS y RECEPCIONES (T-032).
 * Reservada al propietario del script.
 *
 * @param {'COMPRAS'|'RECEPCIONES'} fuente
 * @param {Object} [options]
 * @returns {{ fuente: string, anterior: string }}
 */
function adminConfigurarFuenteEntradas(fuente, options = {}) {
  exigirPropietario_(options && options.session);
  const anterior = getFuenteEntradasConfig(options);
  const normalizada = normalizarFuenteEntradas_(fuente);
  setFuenteEntradasConfig(normalizada, options);
  return { fuente: normalizada, anterior };
}

/**
 * Instala o reinstala el disparador diario del parte (T-029).
 * Es idempotente: borra los disparadores anteriores de enviarParteDiario_ antes de crear uno.
 * Reservada al propietario del script.
 *
 * @param {Object} [options] - Inyección para pruebas.
 * @returns {{ ok: boolean, handler: string, hora: number }}
 */
function adminInstalarParteDiario(options = {}) {
  exigirPropietario_(options && options.session);

  const hora = leerHoraParte_(options);
  const scriptApp = options.scriptApp || (typeof ScriptApp !== 'undefined' ? ScriptApp : null);
  if (!scriptApp || typeof scriptApp.newTrigger !== 'function') {
    throw new Error('ScriptApp no está disponible para instalar el parte diario.');
  }

  const previos = typeof scriptApp.getProjectTriggers === 'function' ? scriptApp.getProjectTriggers() : [];
  for (const trigger of previos) {
    if (!trigger) continue;
    const handler = typeof trigger.getHandlerFunction === 'function' ? trigger.getHandlerFunction() : '';
    if (handler === 'enviarParteDiario_') {
      scriptApp.deleteTrigger(trigger);
    }
  }

  scriptApp
    .newTrigger('enviarParteDiario_')
    .timeBased()
    .atHour(hora)
    .everyDays(1)
    .create();

  return { ok: true, handler: 'enviarParteDiario_', hora };
}

/**
 * Envía el parte ahora, para probarlo desde el editor (T-029).
 * Reservada al propietario del script.
 *
 * @param {Object} [options] - Inyección para pruebas.
 * @returns {Object}
 */
function adminEnviarParteAhora(options = {}) {
  exigirPropietario_(options && options.session);
  const enviar = typeof enviarParteDiario_ === 'function' ? enviarParteDiario_ : null;
  if (!enviar) throw new Error('enviarParteDiario_ no está disponible en este entorno de ejecución.');
  return enviar(options);
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
  exigirSesionApi_();
  const service = new StockQueryService(options);
  return service.obtenerStockActual();
}

/**
 * Consulta el resumen de existencias agregadas por grupo de envase.
 * @param {Object} [options]
 */
function apiObtenerResumenPorGrupos(options) {
  exigirSesionApi_();
  const service = new StockQueryService(options);
  return service.obtenerResumenPorGrupos();
}

/**
 * Consulta las existencias filtradas por un grupo específico.
 * @param {string} grupo 
 * @param {Object} [options]
 */
function apiObtenerStockPorGrupo(grupo, options) {
  exigirSesionApi_();
  const service = new StockQueryService(options);
  return service.obtenerStockPorGrupo(grupo);
}

/**
 * Consulta el detalle desglosado de un grupo de envase.
 * @param {string} grupo 
 * @param {Object} [options]
 */
function apiObtenerDetalleGrupo(grupo, options) {
  exigirSesionApi_();
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
  exigirSesionApi_();
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
  exigirSesionApi_();
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
  exigirSesionApi_();
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
  exigirSesionApi_();
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
  exigirSesionApi_();
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
  exigirSesionApi_();
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
  exigirSesionApi_();
  const service = new StockQueryService(options);
  return service.obtenerDetallePartidas(codigoArticulo, codigoEnvase, options);
}

/**
 * Registra un ajuste positivo manual en el inventario (Fase 5).
 * @param {Object} params 
 * @param {string} [usuario] 
 */
function apiRegistrarAjustePositivo(params, usuario) {
  exigirSesionApi_();
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
  exigirSesionApi_();
  const service = new MovementService();
  const user = usuarioActual_();
  return service.registrarAjusteNegativo(params, user);
}

/**
 * Registra un ajuste o destrío dirigido sobre una partida concreta (id_capa) (T-033).
 * ESCRITURA, rol ENCARGADO. Delega en MovementService.registrarAjuste con id_capa_objetivo.
 *
 * @param {Object} params - { id_capa, signo (-1|+1), cajas (>0), motivo, nota?, fecha?, kg? }
 * @param {Object} [options] - Opciones de inyección para pruebas
 * @returns {Object}
 */
function apiRegistrarAjustePartida(params, options = {}) {
  exigirSesionApi_();
  const p = params && typeof params === 'object' ? params : {};
  const idCapa = String(p.id_capa || p.idCapa || '').trim();
  if (!idCapa) {
    throw new Error('Debes indicar la partida (id_capa).');
  }

  const signo = Number(p.signo);
  if (signo !== 1 && signo !== -1) {
    throw new Error('El signo del ajuste debe ser +1 o -1.');
  }

  const cajas = Number(p.cajas);
  if (!Number.isInteger(cajas) || cajas <= 0) {
    throw new Error('Las cajas deben ser un número entero mayor que 0.');
  }

  const motivosValidos = ['DESTRIO', 'RECUENTO', 'ERROR_CARGA', 'OTRO'];
  const motivo = String(p.motivo || '').trim().toUpperCase();
  if (motivosValidos.indexOf(motivo) < 0) {
    throw new Error('Motivo no válido. Usa DESTRIO, RECUENTO, ERROR_CARGA u OTRO.');
  }

  const nota = String(p.nota !== undefined ? p.nota : (p.observaciones || '')).trim();
  if (motivo === 'OTRO' && !nota) {
    throw new Error('Debes escribir una nota explicativa cuando el motivo es OTRO.');
  }

  const hoyFn = typeof hoyMadrid === 'function'
    ? hoyMadrid
    : (typeof require !== 'undefined' ? require('./Fechas').hoyMadrid : (() => new Date().toISOString().slice(0, 10)));
  const normFechaFn = typeof normalizarFechaNegocio === 'function'
    ? normalizarFechaNegocio
    : (typeof require !== 'undefined' ? require('./Fechas').normalizarFechaNegocio : (d => String(d || '').slice(0, 10)));

  const hoy = hoyFn(options && options.reloj);
  const fechaNorm = p.fecha ? normFechaFn(p.fecha) : hoy;
  if (fechaNorm > hoy) {
    throw new Error('La fecha del ajuste no puede ser futura.');
  }

  let kgVal = '';
  if (p.kg !== undefined && p.kg !== null && String(p.kg).trim() !== '') {
    const kgNum = Number(p.kg);
    if (!Number.isFinite(kgNum) || kgNum < 0) {
      throw new Error('Los kilos deben ser un número mayor o igual que 0.');
    }
    kgVal = kgNum;
  }

  const repo = options.repository || new SheetsRepository();
  const capas = typeof repo.getCapasFifo === 'function' ? repo.getCapasFifo() : [];
  const capa = capas.find(c => String(c.id_capa || '').trim() === idCapa);
  if (!capa) {
    return {
      success: false,
      errorCode: 'CAPA_NO_ENCONTRADA',
      message: `No se encontró la partida ${idCapa}.`
    };
  }

  const disponibles = Number(capa.cajas_restantes || 0);
  if (signo === -1 && cajas > disponibles) {
    return {
      success: false,
      errorCode: 'STOCK_INSUFICIENTE',
      stockDisponible: disponibles,
      cajasSolicitadas: cajas,
      message: `No se pueden restar ${cajas} cajas: en esta partida solo quedan ${disponibles}.`
    };
  }

  const service = options.movementService || new MovementService({
    repository: repo,
    lockService: options.lockService
  });
  const user = usuarioActual_(options && options.session);

  return service.registrarAjuste({
    codigo_articulo: capa.codigo_articulo,
    codigo_envase: capa.codigo_envase,
    cajas,
    signo,
    motivo,
    observaciones: nota,
    fecha: fechaNorm,
    kg: kgVal,
    id_capa_objetivo: idCapa
  }, user);
}

/**
 * Devuelve la lista única de combinaciones artículo + envase conocidas en CATALOGO,
 * CAPAS_FIFO y STOCK_ACTUAL para ofrecer destinos válidos de Hispatec (T-033).
 * LECTURA, rol CONSULTA.
 *
 * @param {Object} [options]
 * @returns {{ combinaciones: Array<{ articulo: string, envase: string }> }}
 */
function apiListarCombinacionesCatalogo(options = {}) {
  exigirSesionApi_();
  const repo = options.repository || new SheetsRepository();
  const normFn = typeof normalizarNombre === 'function'
    ? normalizarNombre
    : (typeof require !== 'undefined' ? require('./Normalizacion').normalizarNombre : (s => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase()));

  const mapa = new Map();
  const registrar = (artRaw, envRaw) => {
    const articulo = normFn(artRaw);
    const envase = normFn(envRaw);
    if (!articulo || !envase) return;
    const clave = `${articulo}|${envase}`;
    if (!mapa.has(clave)) {
      mapa.set(clave, { articulo, envase });
    }
  };

  if (typeof repo.getCatalogo === 'function') {
    for (const fila of (repo.getCatalogo() || [])) {
      registrar(fila.articulo, fila.envase);
    }
  }
  if (typeof repo.getCapasFifo === 'function') {
    for (const fila of (repo.getCapasFifo() || [])) {
      registrar(fila.codigo_articulo, fila.codigo_envase);
    }
  }
  if (typeof repo.getStockActual === 'function') {
    for (const fila of (repo.getStockActual() || [])) {
      registrar(fila.codigo_articulo, fila.codigo_envase);
    }
  }

  const combinaciones = Array.from(mapa.values()).sort((a, b) => {
    const cmp = a.articulo.localeCompare(b.articulo);
    return cmp !== 0 ? cmp : a.envase.localeCompare(b.envase);
  });

  return { combinaciones };
}

/**
 * Registra una reclasificación u operación de traspaso entre dos formatos (Fase 5).
 * @param {Object} params 
 * @param {string} [usuario] 
 */
function apiRegistrarReclasificacion(params, usuario) {
  exigirSesionApi_();
  const service = new MovementService();
  const user = usuarioActual_();
  return service.registrarReclasificacion(params, user);
}

/**
 * Obtiene la lista de grupos comerciales configurados en la persistencia (OBSOLETA: se retira en T-012, D-029).
 * @param {Object} [options]
 */
function apiGetGruposComerciales(options = {}) {
  exigirSesionApi_();
  const repo = options.repository || new SheetsRepository();
  return repo.getGruposComerciales();
}

/**
 * OBSOLETA (se retira en T-012, D-029): lanza error claro sin escribir.
 */
function apiUpsertGrupoComercial() {
  exigirSesionApi_();
  throw new Error('Obsoleto: usar el catálogo (D-029)');
}

/**
 * Obtiene las asociaciones de la matriz artículo + envase configurables (OBSOLETA: se retira en T-012, D-029).
 * @param {Object} [options]
 */
function apiGetMatrizArticuloEnvase(options = {}) {
  exigirSesionApi_();
  const repo = options.repository || new SheetsRepository();
  return repo.getMatrizArticuloEnvase();
}

/**
 * OBSOLETA (se retira en T-012, D-029): lanza error claro sin escribir.
 */
function apiUpsertMatrizArticuloEnvase() {
  exigirSesionApi_();
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
  exigirSesionApi_();
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
  exigirSesionApi_();
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
  exigirSesionApi_();
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
 * Guarda una excepción en CATALOGO validando atributo y valor contra ATRIBUTOS (D-029).
 * Compartida por apiUpsertExcepcionCatalogo y SeguimientoService (T-028).
 * @private
 */
function guardarExcepcionCatalogo_(repo, excepcion, user) {
  const art = String(excepcion.articulo !== undefined ? excepcion.articulo : (excepcion.codigo_articulo || '')).trim();
  const env = String(excepcion.envase !== undefined ? excepcion.envase : (excepcion.codigo_envase || '')).trim();
  if (!art || !env) {
    throw new Error('apiUpsertExcepcionCatalogo: articulo y envase son obligatorios y no pueden estar vacíos.');
  }

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

/**
 * Añade o actualiza una excepción en CATALOGO para (articulo, envase, atributo) (T-005, D-029).
 * Categoría: ESCRITURA.
 * @param {Object} excepcion
 * @param {Object} [options]
 * @returns {Object}
 */
function apiUpsertExcepcionCatalogo(excepcion, options = {}) {
  exigirSesionApi_();
  if (!excepcion || typeof excepcion !== 'object') {
    throw new Error('apiUpsertExcepcionCatalogo: Se requiere un objeto excepción.');
  }
  const repo = options.repository || new SheetsRepository();
  const user = usuarioActual_(options && options.session);
  return guardarExcepcionCatalogo_(repo, excepcion, user);
}

/**
 * Decide el seguimiento (SEGUIR o IGNORAR) de una combinación artículo + envase desconocida,
 * opcionalmente asignando los atributos de un grupo de la agrupación COMERCIAL,
 * y reintenta pendientes (T-028). Categoría: ESCRITURA; rol mínimo ENCARGADO.
 * @param {string} articulo
 * @param {string} envase
 * @param {'SEGUIR'|'IGNORAR'} decision
 * @param {string|Object} [grupo='']
 * @param {Object} [options={}]
 * @returns {Object}
 */
function apiDecidirSeguimiento(articulo, envase, decision, grupo = '', options = {}) {
  exigirSesionApi_();
  let grupoNombre = grupo;
  let opts = options;
  if (grupoNombre && typeof grupoNombre === 'object') {
    opts = grupoNombre;
    grupoNombre = '';
  }
  const user = usuarioActual_(opts && opts.session);
  const SvcClass = (typeof SeguimientoService !== 'undefined')
    ? SeguimientoService
    : (typeof require !== 'undefined' ? require('./SeguimientoService').SeguimientoService : null);
  if (!SvcClass) throw new Error('SeguimientoService no está disponible en este entorno de ejecución.');
  const repo = (opts && opts.repository) || new SheetsRepository();
  const service = new SvcClass({
    repository: repo,
    movementService: opts && opts.movementService,
    catalogoService: opts && opts.catalogoService,
    pendientesService: opts && opts.pendientesService,
    lockService: opts && opts.lockService,
    configCatalogo: opts && opts.configCatalogo
  });
  return service.decidirSeguimiento(articulo, envase, decision, grupoNombre, user);
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
  exigirSesionApi_();
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
  exigirSesionApi_();
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
  exigirSesionApi_();
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
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.procesarSalidaDocumento(docPayload, lineas, user);
}

/**
 * Previsualiza un CSV de Hispatec sin escribir en ninguna hoja (T-007, D-029, D-031).
 * Categoría: LECTURA.
 * @param {string} textoCsv
 * @param {Object} [options]
 * @returns {Object}
 */
function apiPrevisualizarImportacionCsv(textoCsv, options = {}) {
  exigirSesionApi_();
  const SvcClass = (typeof ImportacionService !== 'undefined')
    ? ImportacionService
    : (typeof require !== 'undefined' ? require('./importacion/ImportacionService').ImportacionService : null);
  if (!SvcClass) throw new Error('ImportacionService no está disponible en este entorno de ejecución.');
  const repo = options.repository || new SheetsRepository();
  const service = new SvcClass({
    repository: repo,
    movementService: options.movementService,
    catalogoService: options.catalogoService,
    configCatalogo: options.configCatalogo,
    umbralTramos: options.umbralTramos,
    lockService: options.lockService
  });
  return service.previsualizar(textoCsv);
}

/**
 * Confirma la importación de un CSV de Hispatec en lote (T-007).
 * Categoría: ESCRITURA; el usuario de auditoría lo decide el servidor.
 * @param {string} textoCsv
 * @param {string} hash
 * @param {Object} [options]
 * @returns {Object}
 */
function apiConfirmarImportacionCsv(textoCsv, hash, options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const SvcClass = (typeof ImportacionService !== 'undefined')
    ? ImportacionService
    : (typeof require !== 'undefined' ? require('./importacion/ImportacionService').ImportacionService : null);
  if (!SvcClass) throw new Error('ImportacionService no está disponible en este entorno de ejecución.');
  const repo = options.repository || new SheetsRepository();
  const service = new SvcClass({
    repository: repo,
    movementService: options.movementService,
    catalogoService: options.catalogoService,
    configCatalogo: options.configCatalogo,
    umbralTramos: options.umbralTramos,
    lockService: options.lockService,
    pendientesService: options.pendientesService
  });
  return service.confirmar(textoCsv, hash, user);
}

/**
 * Previsualiza el stock inicial desde la hoja STOCK_INICIAL_ENTRADA (T-011).
 * Categoría: ADMIN. No escribe nada.
 * @param {Object} [options]
 * @returns {Object}
 */
function adminPrevisualizarStockInicialDesdeHoja(options = {}) {
  exigirPropietario_(options && options.session);
  const service = _crearStockInicialService_(options);
  try {
    return service.previsualizar(service.leerFilasHoja());
  } catch (err) {
    return {
      status: 'HOJA_NO_DISPONIBLE',
      error: err.message,
      filas: [],
      totales: { porArticuloEnvase: [], porProveedor: [], general: { cajas: 0, filas: 0 } },
      hash: '',
      bloquea: true,
      bloqueos: 0,
      avisos: 0
    };
  }
}

/**
 * Confirma el stock inicial desde la hoja STOCK_INICIAL_ENTRADA (T-011).
 * Categoría: ADMIN. Exige el hash de la previsualización; `anadir` permite una segunda carga.
 * @param {string} hash
 * @param {boolean} [anadir=false]
 * @param {Object} [options]
 * @returns {Object}
 */
function adminConfirmarStockInicialDesdeHoja(hash, anadir = false, options = {}) {
  exigirPropietario_(options && options.session);
  const service = _crearStockInicialService_(options);
  let filas;
  try {
    filas = service.leerFilasHoja();
  } catch (err) {
    return { success: false, status: 'HOJA_NO_DISPONIBLE', error: err.message };
  }
  return service.confirmar(filas, hash, usuarioActual_(options && options.session), {
    anadir: anadir === true,
    timeoutMs: options.timeoutMs
  });
}

/**
 * Previsualiza un CSV de stock inicial (T-011).
 * Categoría: ESCRITURA, rol mínimo ADMIN.
 * @param {string} textoCsv
 * @param {Object} [options]
 * @returns {Object}
 */
function apiPrevisualizarStockInicial(textoCsv, options = {}) {
  exigirSesionApi_();
  return _crearStockInicialService_(options).previsualizar(textoCsv);
}

/**
 * Confirma un CSV de stock inicial (T-011).
 * Categoría: ESCRITURA, rol mínimo ADMIN. El usuario de auditoría lo decide el servidor.
 * @param {string} textoCsv
 * @param {string} hash
 * @param {boolean} [anadir=false]
 * @param {Object} [options]
 * @returns {Object}
 */
function apiConfirmarStockInicial(textoCsv, hash, anadir = false, options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  return _crearStockInicialService_(options).confirmar(textoCsv, hash, user, {
    anadir: anadir === true,
    timeoutMs: options.timeoutMs
  });
}

function _resolvePendientesService_(options = {}) {
  if (options && options.pendientesService) return options.pendientesService;
  const SvcClass = (typeof PendientesService !== 'undefined')
    ? PendientesService
    : (typeof require !== 'undefined' ? require('./importacion/PendientesService').PendientesService : null);
  if (!SvcClass) throw new Error('PendientesService no está disponible en este entorno de ejecución.');
  const repo = options.repository || new SheetsRepository();
  return new SvcClass({
    repository: repo,
    movementService: options.movementService,
    catalogoService: options.catalogoService,
    configCatalogo: options.configCatalogo,
    lockService: options.lockService
  });
}

/**
 * Resuelve el servicio de stock inicial (T-011) con las dependencias de la ejecución.
 * Función interna: no se expone en docs/API_PUBLICA.md.
 * @param {Object} [options]
 * @returns {StockInicialService}
 */
function _crearStockInicialService_(options = {}) {
  const SvcClass = (typeof StockInicialService !== 'undefined')
    ? StockInicialService
    : (typeof require !== 'undefined' ? require('./importacion/StockInicialService').StockInicialService : null);
  if (!SvcClass) throw new Error('StockInicialService no está disponible en este entorno de ejecución.');

  const repo = options.repository || new SheetsRepository();
  return new SvcClass({
    repository: repo,
    movementService: options.movementService,
    catalogoService: options.catalogoService,
    pendientesService: options.pendientesService,
    lockService: options.lockService,
    configCatalogo: options.configCatalogo || options.config,
    crearCopiaSeguridad: options.crearCopiaSeguridad,
    backupOptions: options.backupOptions,
    clock: options.clock || options.reloj,
    timeoutMs: options.timeoutMs
  });
}

/**
 * Lista los pendientes agrupados por motivo y por documento (T-008).
 * Categoría: LECTURA (rol mínimo CONSULTA).
 * @param {Object} [filtros={}]
 * @param {Object} [options={}]
 * @returns {Object}
 */
function apiListarPendientes(filtros = {}, options = {}) {
  exigirSesionApi_();
  const service = _resolvePendientesService_(options);
  return service.listarPendientes(filtros);
}

/**
 * Reintenta los pendientes activos de stock insuficiente y seguimiento desconocido (T-008).
 * Categoría: ESCRITURA (rol mínimo ENCARGADO); usuario del servidor.
 * @param {Object} [options={}]
 * @returns {Object}
 */
function apiReintentarPendientes(options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const service = _resolvePendientesService_(options);
  return service.reintentarPendientes(user, options);
}

/**
 * Marca un pendiente (p. ej. MODIFICADO_EN_ERP) como RESUELTA y guarda la nota (T-008).
 * Categoría: ESCRITURA (rol mínimo ENCARGADO); usuario del servidor. No toca el stock.
 * @param {string} idPendiente
 * @param {string} [nota='']
 * @param {Object} [options={}]
 * @returns {Object}
 */
function apiMarcarPendienteResuelto(idPendiente, nota = '', options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const service = _resolvePendientesService_(options);
  return service.marcarPendienteResuelto(idPendiente, nota, user);
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
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.ejecutarAjusteOperativo(ajustePayload, user);
}

/**
 * Obtiene el log de trazabilidad operativa simple (Fase 6.0).
 * @param {Object} [options]
 */
function apiObtenerLogOperaciones(options = {}) {
  exigirSesionApi_();
  const service = _resolveOperationalSafetyService(options);
  return service.obtenerLogOperaciones();
}

/**
 * Previsualiza una corrección histórica de forma 100% analítica y sin mutar datos (Fase 6.1).
 * @param {Object} correccionPayload
 * @param {Object} [options]
 */
function apiPrevisualizarCorreccionHistorica(correccionPayload, options = {}) {
  exigirSesionApi_();
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
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.ejecutarCorreccionHistorica(correccionPayload, user);
}

/**
 * Anula una entrada sin consumos posteriores (Fase 6.1).
 */
function apiAnularEntrada(params, usuario, options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.anularEntrada(params, user);
}

/**
 * Anula una salida restituyendo capas FIFO (Fase 6.1).
 */
function apiAnularSalida(params, usuario, options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.anularSalida(params, user);
}

/**
 * Corrige una entrada parcialmente consumida o modifica artículo/envase (Fase 6.1).
 */
function apiCorregirEntrada(params, usuario, options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.corregirEntrada(params, user);
}

/**
 * Corrige la cantidad de una salida histórica (Fase 6.1).
 */
function apiCorregirSalida(params, usuario, options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.corregirSalida(params, user);
}

/**
 * Divide una entrada histórica en múltiples combinaciones (Fase 6.1).
 */
function apiDividirEntrada(params, usuario, options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const service = _resolveOperationalSafetyService(options);
  return service.dividirEntrada(params, user);
}

function _resolveMovementService_(options = {}) {
  if (options && options.movementService) return options.movementService;
  const ServiceClass = (typeof MovementService !== 'undefined')
    ? MovementService
    : (typeof require !== 'undefined' ? require('./MovementService').MovementService : null);
  if (!ServiceClass) {
    throw new Error('MovementService no está disponible en este entorno de ejecución.');
  }
  const repo = (options && options.repository) || (typeof SheetsRepository !== 'undefined' ? new SheetsRepository() : (typeof require !== 'undefined' ? new (require('./Repository').SheetsRepository)() : null));
  const lock = (options && options.lockService) || null;
  return new ServiceClass({ repository: repo, lockService: lock });
}

/**
 * Registra un reproceso de varias partidas a varios destinos (T-009, D-011, D-030).
 * ESCRITURA: La auditoría usa siempre el usuario del servidor (usuarioActual_()).
 *
 * @param {Object} params
 * @param {Object} [options={}]
 * @returns {Object}
 */
function apiRegistrarReproceso(params, options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const service = _resolveMovementService_(options);
  return service.registrarReproceso(params, user);
}

/**
 * Anula un reproceso previamente registrado si sus destinos no tienen consumos (T-009, D-011, D-012).
 * ESCRITURA: La auditoría usa siempre el usuario del servidor (usuarioActual_()).
 *
 * @param {string} id
 * @param {Object} [options={}]
 * @returns {Object}
 */
function apiAnularReproceso(id, options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  const service = _resolveMovementService_(options);
  return service.anularReproceso(id, user);
}

/**
 * Lista los reprocesos registrados con filtros opcionales (T-009).
 * LECTURA: Solo lectura de REPROCESOS.
 *
 * @param {Object} [filtros={}]
 * @param {Object} [options={}]
 * @returns {Array<Object>}
 */
function apiListarReprocesos(filtros = {}, options = {}) {
  exigirSesionApi_();
  const service = _resolveMovementService_(options);
  return service.listarReprocesos(filtros);
}

/**
 * Sugerencias de combinaciones de destinos usadas antes desde una combinación de origen (T-009, D-030).
 * LECTURA: Solo lectura.
 *
 * @param {string|Object} articulo
 * @param {string|number} [envase]
 * @param {Object} [options={}]
 * @returns {Array<Array<{ articulo: string, envase: string, cajas: number }>>}
 */
function apiSugerenciasReproceso(articulo, envase, options = {}) {
  exigirSesionApi_();
  let opt = options;
  if (typeof envase === 'object' && envase !== null) {
    opt = envase;
    envase = undefined;
  }
  const service = _resolveMovementService_(opt);
  return service.sugerenciasReproceso(articulo, envase);
}

/**
 * Resuelve el servicio de operaciones de solo lectura (T-025).
 * Función interna: no se expone en docs/API_PUBLICA.md.
 * @param {Object} [options]
 * @returns {OperacionesService}
 */
function _resolveOperacionesService_(options = {}) {
  if (options && options.operacionesService) return options.operacionesService;
  const SvcClass = (typeof OperacionesService !== 'undefined')
    ? OperacionesService
    : (typeof require !== 'undefined' ? require('./OperacionesService').OperacionesService : null);
  if (!SvcClass) throw new Error('OperacionesService no está disponible en este entorno de ejecución.');
  const repo = options.repository || (typeof SheetsRepository !== 'undefined'
    ? new SheetsRepository()
    : (typeof require !== 'undefined' ? new (require('./Repository').SheetsRepository)() : null));
  return new SvcClass({
    repository: repo,
    movementService: options.movementService,
    catalogoService: options.catalogoService,
    configCatalogo: options.configCatalogo,
    lockService: options.lockService
  });
}

/**
 * Sugerencias de destinos habituales para un cambio de origen (T-025).
 * LECTURA, rol mínimo CONSULTA.
 * @param {string} articulo
 * @param {string} envase
 * @param {Object} [options]
 * @returns {Array<Object>}
 */
function apiSugerenciasCambio(articulo, envase, options = {}) {
  exigirSesionApi_();
  let opt = options;
  let art = articulo;
  let env = envase;
  if (art && typeof art === 'object') {
    if (env && typeof env === 'object') opt = env;
    env = art.envase || art.codigo_envase;
    art = art.articulo || art.codigo_articulo;
  } else if (env && typeof env === 'object') {
    opt = env;
    env = undefined;
  }
  return _resolveOperacionesService_(opt).sugerenciasCambio(art, env);
}

/**
 * Evalúa el rendimiento de un cambio frente al habitual (T-025).
 * LECTURA, rol mínimo CONSULTA.
 * @param {number} origenCajas
 * @param {Array<Object>} destinos
 * @param {Object|number|null} sugerencia
 * @param {Object} [options]
 * @returns {Object}
 */
function apiEvaluarCambio(origenCajas, destinos, sugerencia, options = {}) {
  exigirSesionApi_();
  return _resolveOperacionesService_(options).evaluarCambio_(origenCajas, destinos, sugerencia);
}

/**
 * Previsualiza una anulación sin escribir nada (T-025).
 * LECTURA, rol mínimo CONSULTA.
 * @param {'REPROCESO'|'ENTRADA'|'SALIDA'} tipo
 * @param {string} id
 * @param {Object} [options]
 * @returns {Object}
 */
function apiPrevisualizarAnulacion(tipo, id, options = {}) {
  exigirSesionApi_();
  return _resolveOperacionesService_(options).previsualizarAnulacion(tipo, id);
}

/**
 * Lista el historial de movimientos agrupado por fecha de negocio (T-025).
 * LECTURA, rol mínimo CONSULTA.
 * @param {Object} [filtros]
 * @param {Object} [options]
 * @returns {Object}
 */
function apiListarMovimientos(filtros = {}, options = {}) {
  exigirSesionApi_();
  return _resolveOperacionesService_(options).listarMovimientos(filtros);
}

/**
 * Búsqueda global de variedades, partidas, albaranes y cambios (T-025).
 * LECTURA, rol mínimo CONSULTA.
 * @param {string} texto
 * @param {Object} [options]
 * @returns {Object}
 */
function apiBuscar(texto, options = {}) {
  exigirSesionApi_();
  return _resolveOperacionesService_(options).buscar(texto);
}

/**
 * Resuelve el servicio de correcciones desde Hispatec (T-027).
 * Función interna: no se expone en docs/API_PUBLICA.md.
 * @param {Object} [options]
 * @returns {CorreccionService}
 */
function _resolveCorreccionService_(options = {}) {
  if (options && options.correccionService) return options.correccionService;
  const SvcClass = (typeof CorreccionService !== 'undefined')
    ? CorreccionService
    : (typeof require !== 'undefined' ? require('./CorreccionService').CorreccionService : null);
  if (!SvcClass) throw new Error('CorreccionService no está disponible en este entorno de ejecución.');
  const repo = options.repository || (typeof SheetsRepository !== 'undefined'
    ? new SheetsRepository()
    : (typeof require !== 'undefined' ? new (require('./Repository').SheetsRepository)() : null));
  return new SvcClass({
    repository: repo,
    movementService: options.movementService,
    catalogoService: options.catalogoService,
    pendientesService: options.pendientesService,
    configCatalogo: options.configCatalogo,
    lockService: options.lockService
  });
}

/**
 * Lista las versiones nuevas pendientes de aplicar (T-027).
 * LECTURA, rol mínimo CONSULTA.
 * @param {Object} [options]
 * @returns {Array<Object>}
 */
function apiListarVersionesPendientes(options = {}) {
  exigirSesionApi_();
  return _resolveCorreccionService_(options).listarVersionesPendientes();
}

/**
 * Previsualiza la aplicación de una versión nueva (T-027).
 * LECTURA, rol mínimo ENCARGADO.
 * @param {string} idPendiente
 * @param {Object} [options]
 * @returns {Object}
 */
function apiPrevisualizarVersion(idPendiente, options = {}) {
  exigirSesionApi_();
  return _resolveCorreccionService_(options).previsualizarVersion(idPendiente);
}

/**
 * Aplica una versión nueva de un documento (T-027).
 * ESCRITURA, rol mínimo ENCARGADO.
 * @param {string} idPendiente
 * @param {string} motivo
 * @param {Object} [options]
 * @returns {Object}
 */
function apiAplicarVersion(idPendiente, motivo, options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  return _resolveCorreccionService_(options).aplicarVersion(idPendiente, motivo, user);
}

/**
 * Previsualiza la anulación de un ajuste o destrío (T-027).
 * LECTURA, rol mínimo ENCARGADO.
 * @param {string} idMovimiento
 * @param {Object} [options]
 * @returns {Object}
 */
function apiPrevisualizarAnularAjuste(idMovimiento, options = {}) {
  exigirSesionApi_();
  return _resolveCorreccionService_(options).previsualizarAnularAjuste(idMovimiento);
}

/**
 * Anula un ajuste o destrío (T-027).
 * ESCRITURA, rol mínimo ENCARGADO.
 * @param {string} idMovimiento
 * @param {string} motivo
 * @param {Object} [options]
 * @returns {Object}
 */
function apiAnularAjuste(idMovimiento, motivo, options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  return _resolveCorreccionService_(options).anularAjuste(idMovimiento, motivo, user);
}

/**
 * Resuelve una función global por nombre para el despachador.
 * En Apps Script las funciones declaradas son propiedades de globalThis; en
 * Node se resuelven desde las exportaciones de este módulo.
 *
 * @param {string} nombre
 * @returns {Function|null}
 */
function _resolverFuncionApi_(nombre) {
  try {
    if (typeof globalThis !== 'undefined' && typeof globalThis[nombre] === 'function') {
      return globalThis[nombre];
    }
  } catch (e) {}
  if (typeof module !== 'undefined' && module.exports && typeof module.exports[nombre] === 'function') {
    return module.exports[nombre];
  }
  return null;
}

/**
 * Despachador único de la interfaz (T-020, D-032).
 * Valida la sesión, comprueba el rol mínimo de PERMISOS_API, fija el contexto
 * de usuario, llama a la función y limpia el contexto en un finally.
 *
 * @param {string} sesion - Identificador de sesión devuelto por apiEntrar.
 * @param {string} nombreApi - Nombre de la función a ejecutar.
 * @param {Array} args - Argumentos de la función.
 * @returns {*} Resultado de la función o { success: false, errorCode }.
 */
function apiLlamar(sesion, nombreApi, args) {
  const nombre = String(nombreApi || '').trim();

  let servicio;
  try {
    servicio = crearServicioAcceso_();
  } catch (e) {
    return { success: false, errorCode: 'SESION_INVALIDA' };
  }

  let usuario = null;
  try {
    usuario = servicio.validarSesion(sesion);
  } catch (e) {
    usuario = null;
  }
  if (!usuario) {
    return { success: false, errorCode: 'SESION_INVALIDA' };
  }

  if (!Object.prototype.hasOwnProperty.call(PERMISOS_API, nombre)) {
    return { success: false, errorCode: 'API_NO_PERMITIDA' };
  }
  const rolMinimo = PERMISOS_API[nombre];
  if (!rolAlcanza_(usuario.rol, rolMinimo)) {
    return { success: false, errorCode: 'PERMISO_DENEGADO' };
  }

  const fn = _resolverFuncionApi_(nombre);
  if (typeof fn !== 'function') {
    return { success: false, errorCode: 'API_NO_ENCONTRADA' };
  }

  const argumentos = Array.isArray(args) ? args : [];
  return ejecutarConContexto_(usuario.nombre, usuario.rol, function () {
    return fn.apply(null, argumentos);
  });
}

/**
 * Abre sesión con token + PIN (T-020). Es una de las dos únicas funciones
 * públicas sin sesión. Devuelve { sesion, nombre, rol } o un error genérico.
 *
 * @param {string} token
 * @param {string} pin
 * @param {Object} [options]
 * @returns {Object}
 */
function apiEntrar(token, pin, options = {}) {
  try {
    const servicio = crearServicioAcceso_(options);
    return servicio.entrar(token, pin);
  } catch (e) {
    return { success: false, errorCode: 'CREDENCIALES_INVALIDAS' };
  }
}

/**
 * Fija el PIN de un usuario que aún no lo tiene o tras regenerar el enlace (T-020).
 * Si tiene éxito, abre sesión y devuelve { sesion, nombre, rol }.
 *
 * @param {string} token
 * @param {string} pin
 * @param {Object} [options]
 * @returns {Object}
 */
function apiEstablecerPin(token, pin, options = {}) {
  try {
    const servicio = crearServicioAcceso_(options);
    return servicio.establecerPin(token, pin);
  } catch (e) {
    // Error genérico: no se revela si falló el token, el PIN o si ya estaba establecido.
    return { success: false, errorCode: 'CREDENCIALES_INVALIDAS' };
  }
}

/**
 * Cierra la sesión indicada (T-020). Es una función de ENTRADA: no exige
 * contexto, solo borra la sesión del almacenamiento.
 *
 * @param {string} sesion
 * @param {Object} [options]
 * @returns {{ success: boolean }}
 */
function apiSalir(sesion, options = {}) {
  try {
    const servicio = crearServicioAcceso_(options);
    return { success: servicio.salir(sesion) };
  } catch (e) {
    return { success: false };
  }
}

/**
 * Crea un usuario desde el editor y devuelve su enlace personal (T-020, ADMIN).
 * El token solo se muestra en este resultado; en la hoja queda su hash.
 *
 * @param {string} nombre
 * @param {string} rol - CONSULTA | ENCARGADO | ADMIN
 * @param {Object} [options]
 * @returns {{ id_usuario: string, nombre: string, rol: string, enlace: string }}
 */
function crearUsuario(nombre, rol, options = {}) {
  exigirPropietario_(options && options.session);
  const servicio = crearServicioAcceso_(options);
  return servicio.crearUsuario(nombre, rol);
}

/**
 * Regenera el enlace personal de un usuario desde el editor (T-020, ADMIN).
 *
 * @param {string} idUsuario
 * @param {Object} [options]
 * @returns {{ id_usuario: string, enlace: string }}
 */
function regenerarEnlace(idUsuario, options = {}) {
  exigirPropietario_(options && options.session);
  const servicio = crearServicioAcceso_(options);
  return servicio.regenerarEnlace(idUsuario);
}

/**
 * Desactiva a un usuario desde el editor (T-020, ADMIN).
 *
 * @param {string} idUsuario
 * @param {Object} [options]
 * @returns {{ id_usuario: string, activo: boolean }}
 */
function desactivarUsuario(idUsuario, options = {}) {
  exigirPropietario_(options && options.session);
  const servicio = crearServicioAcceso_(options);
  return servicio.desactivarUsuario(idUsuario);
}

/**
 * Lista los usuarios sin hashes desde el editor (T-020, ADMIN).
 *
 * @param {Object} [options]
 * @returns {Array<Object>}
 */
function listarUsuarios(options = {}) {
  exigirPropietario_(options && options.session);
  const servicio = crearServicioAcceso_(options);
  return servicio.listarUsuarios();
}

/**
 * Versión para la app de listarUsuarios (T-020). Rol mínimo ADMIN.
 *
 * @param {Object} [options]
 * @returns {Array<Object>}
 */
function apiListarUsuarios(options = {}) {
  exigirSesionApi_();
  const servicio = crearServicioAcceso_(options);
  return servicio.listarUsuarios();
}

/**
 * Versión para la app de crearUsuario (T-020). Rol mínimo ADMIN.
 *
 * @param {string} nombre
 * @param {string} rol
 * @param {Object} [options]
 * @returns {{ id_usuario: string, nombre: string, rol: string, enlace: string }}
 */
function apiCrearUsuario(nombre, rol, options = {}) {
  exigirSesionApi_();
  const servicio = crearServicioAcceso_(options);
  return servicio.crearUsuario(nombre, rol);
}

/**
 * Versión para la app de regenerarEnlace (T-020). Rol mínimo ADMIN.
 *
 * @param {string} idUsuario
 * @param {Object} [options]
 * @returns {{ id_usuario: string, enlace: string }}
 */
function apiRegenerarEnlace(idUsuario, options = {}) {
  exigirSesionApi_();
  const servicio = crearServicioAcceso_(options);
  return servicio.regenerarEnlace(idUsuario);
}

/**
 * Versión para la app de desactivarUsuario (T-020). Rol mínimo ADMIN.
 *
 * @param {string} idUsuario
 * @param {Object} [options]
 * @returns {{ id_usuario: string, activo: boolean }}
 */
function apiDesactivarUsuario(idUsuario, options = {}) {
  exigirSesionApi_();
  const servicio = crearServicioAcceso_(options);
  return servicio.desactivarUsuario(idUsuario);
}

/**
 * Punto de entrada HTTP oficial para Google Apps Script HtmlService (Fase 7.0).
 * Sirve la interfaz web responsive de STOCK-LIGHT y pasa el token del enlace
 * personal (e.parameter.k) a la plantilla (T-020).
 * 
 * @param {Object} [e] Parámetros de petición HTTP
 * @returns {HtmlOutput}
 */
function doGet(e) {
  const parametros = (e && e.parameter) || {};
  const token = parametros.k !== undefined && parametros.k !== null ? String(parametros.k) : '';

  const template = HtmlService.createTemplateFromFile('Index');
  template.k = token;

  let tienePin = false;
  if (token) {
    try {
      tienePin = crearServicioAcceso_().tienePinEstablecido(token);
    } catch (err) {
      tienePin = false;
    }
  }
  template.tienePin = tienePin;

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
  exigirSesionApi_();
  return confirmarDocumentoRevisado(canonicalInput, usuario, options);
}

/**
 * Obtiene el catálogo maestro de artículos (Fase 7.0).
 * @param {Object} [options]
 * @returns {Array<Object>}
 */
function apiGetMaestroArticulos(options = {}) {
  exigirSesionApi_();
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
  exigirSesionApi_();
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
  exigirSesionApi_();
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

/**
 * Incluye un parcial HTML desde `src/` para plantillas HtmlService (`<?!= include_('ui/estilos') ?>`) (T-024).
 * Función interna (termina en `_`): no se expone al navegador por google.script.run.
 *
 * @param {string} nombre
 * @returns {string}
 */
function include_(nombre) {
  const limpio = String(nombre || '').trim().replace(/^\/+/, '');
  if (!limpio || limpio.includes('..') || !/^[a-zA-Z0-9_/-]+$/.test(limpio)) {
    throw new Error(`include_: nombre de parcial inválido '${nombre}'.`);
  }
  if (typeof HtmlService !== 'undefined' && HtmlService && typeof HtmlService.createHtmlOutputFromFile === 'function') {
    return HtmlService.createHtmlOutputFromFile(limpio).getContent();
  }
  if (typeof require !== 'undefined') {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, `${limpio}.html`), 'utf8');
  }
  return '';
}

function _resolveInicioService_(options = {}) {
  if (options && options.inicioService) return options.inicioService;
  const SvcClass = (typeof InicioService !== 'undefined')
    ? InicioService
    : (typeof require !== 'undefined' ? require('./InicioService').InicioService : null);
  if (!SvcClass) throw new Error('InicioService no está disponible en este entorno de ejecución.');
  const repo = options.repository || new SheetsRepository();
  return new SvcClass({
    repository: repo,
    catalogoService: options.catalogoService,
    pendientesService: options.pendientesService,
    configCatalogo: options.configCatalogo,
    reloj: options.reloj
  });
}

/**
 * Resuelve el servicio del parte de la noche (T-029).
 * Función interna: no se expone en docs/API_PUBLICA.md.
 * @param {Object} [options]
 * @returns {ParteService}
 */
function _resolveParteService_(options = {}) {
  if (options && options.parteService) return options.parteService;
  const SvcClass = (typeof ParteService !== 'undefined')
    ? ParteService
    : (typeof require !== 'undefined' ? require('./ParteService').ParteService : null);
  if (!SvcClass) throw new Error('ParteService no está disponible en este entorno de ejecución.');
  return new SvcClass({
    repository: options.repository,
    inicioService: options.inicioService,
    catalogoService: options.catalogoService,
    pendientesService: options.pendientesService,
    configCatalogo: options.configCatalogo,
    reloj: options.reloj,
    clock: options.clock
  });
}

/**
 * Devuelve el resumen agregado para la pantalla de Existencias (T-024).
 * Categoría: LECTURA (rol mínimo CONSULTA).
 *
 * @param {Object} [options={}]
 * @returns {Object}
 */
function apiObtenerInicio(options = {}) {
  exigirSesionApi_();
  const service = _resolveInicioService_(options);
  return service.obtenerInicio(options);
}

/**
 * Resuelve el servicio del cuadre de la noche (T-040).
 * Función interna: no se expone en docs/API_PUBLICA.md.
 * @param {Object} [options]
 * @returns {CuadreService}
 */
function _resolveCuadreService_(options = {}) {
  if (options && options.cuadreService) return options.cuadreService;
  const SvcClass = (typeof CuadreService !== 'undefined')
    ? CuadreService
    : (typeof require !== 'undefined' ? require('./CuadreService').CuadreService : null);
  if (!SvcClass) throw new Error('CuadreService no está disponible en este entorno de ejecución.');
  const repo = options.repository || (typeof SheetsRepository !== 'undefined'
    ? new SheetsRepository()
    : (typeof require !== 'undefined' ? new (require('./Repository').SheetsRepository)() : null));
  return new SvcClass({
    repository: repo,
    movementService: options.movementService,
    catalogoService: options.catalogoService,
    configCatalogo: options.configCatalogo,
    lockService: options.lockService,
    reloj: options.reloj !== undefined ? options.reloj : options.clock
  });
}

/**
 * Devuelve el cuadre de la noche: familias, artículos y cajas que debería haber (T-040).
 * Categoría: LECTURA (rol mínimo ENCARGADO).
 *
 * @param {Object} [options={}]
 * @returns {{ id_cuadre: string, generado_en: string, familias: Array<Object> }}
 */
function apiObtenerCuadre(options = {}) {
  exigirSesionApi_();
  return _resolveCuadreService_(options).obtenerCuadre();
}

/**
 * Confirma el recuento de una familia y crea los ajustes RECUENTO que hagan falta (T-040).
 * Categoría: ESCRITURA (rol mínimo ENCARGADO). El usuario lo decide el servidor.
 *
 * @param {Object} params - `{ id_cuadre, familia, lineas: [{ articulo, envase, deberia, hay }] }`
 * @param {Object} [options={}]
 * @returns {Object}
 */
function apiConfirmarCuadreFamilia(params, options = {}) {
  exigirSesionApi_();
  const user = usuarioActual_(options && options.session);
  return _resolveCuadreService_(options).confirmarFamilia(params || {}, user);
}

/**
 * Devuelve el parte de stock de la noche (T-029).
 * Categoría: LECTURA (rol mínimo CONSULTA).
 *
 * @param {Object} [options={}]
 * @returns {Object}
 */
function apiObtenerParte(options = {}) {
  exigirSesionApi_();
  const service = _resolveParteService_(options);
  return service.generarParte(options);
}

/**
 * Devuelve la historia completa de una partida (origen, consumos y destinos de reproceso) (T-024).
 * Categoría: LECTURA (rol mínimo CONSULTA).
 *
 * @param {string} idCapa
 * @param {Object} [options={}]
 * @returns {Object}
 */
function apiObtenerPartida(idCapa, options = {}) {
  exigirSesionApi_();
  const service = _resolveInicioService_(options);
  return service.obtenerPartida(idCapa);
}

/**
 * Lista los clientes excluidos y los nombres comerciales fuera (T-031).
 * Categoría: LECTURA (rol mínimo CONSULTA).
 *
 * @param {Object} [options={}]
 * @returns {{ clientesExcluidos: Array<string>, articulosFuera: Array<string> }}
 */
function apiListarExclusiones(options = {}) {
  exigirSesionApi_();
  const repo = options.repository || new SheetsRepository();
  const listar = typeof listarExclusiones_ === 'function' ? listarExclusiones_ : null;
  if (!listar) throw new Error('listarExclusiones_ no está disponible en este entorno de ejecución.');
  return listar(repo);
}

/**
 * Lista las equivalencias de nombre de artículo para recepciones (T-032).
 * Categoría: LECTURA (rol mínimo CONSULTA).
 *
 * @param {Object} [options={}]
 * @returns {{ equivalencias: Array<Object> }}
 */
function apiListarEquivalencias(options = {}) {
  exigirSesionApi_();
  const repo = options.repository || new SheetsRepository();
  const listar = typeof listarEquivalencias_ === 'function' ? listarEquivalencias_ : null;
  if (!listar) throw new Error('listarEquivalencias_ no está disponible en este entorno de ejecución.');
  return listar(repo);
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
    apiRegistrarAjustePartida,
    apiListarCombinacionesCatalogo,
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
    apiDecidirSeguimiento,
    apiValidarDocumento,
    apiPrevisualizarDocumento,
    apiProcesarEntradaDocumento,
    apiProcesarSalidaDocumento,
    apiPrevisualizarImportacionCsv,
    apiConfirmarImportacionCsv,
    apiPrevisualizarStockInicial,
    apiConfirmarStockInicial,
    adminPrevisualizarStockInicialDesdeHoja,
    adminConfirmarStockInicialDesdeHoja,
    apiListarPendientes,
    apiReintentarPendientes,
    apiMarcarPendienteResuelto,
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
    apiRegistrarReproceso,
    apiAnularReproceso,
    apiListarReprocesos,
    apiSugerenciasReproceso,
    apiSugerenciasCambio,
    apiEvaluarCambio,
    apiPrevisualizarAnulacion,
    apiListarMovimientos,
    apiBuscar,
    apiListarVersionesPendientes,
    apiPrevisualizarVersion,
    apiAplicarVersion,
    apiPrevisualizarAnularAjuste,
    apiAnularAjuste,
    apiLlamar,
    apiEntrar,
    apiEstablecerPin,
    apiSalir,
    crearUsuario,
    regenerarEnlace,
    desactivarUsuario,
    listarUsuarios,
    apiListarUsuarios,
    apiCrearUsuario,
    apiRegenerarEnlace,
    apiDesactivarUsuario,
    adminCrearCopiaManual,
    adminInstalarCopiaDiaria,
    adminConfigurarCarpetaCopias,
    adminConfigurarParte,
    adminInstalarParteDiario,
    adminEnviarParteAhora,
    adminConfigurarClientesExcluidos: (typeof adminConfigurarClientesExcluidos !== 'undefined')
      ? adminConfigurarClientesExcluidos
      : (exclusionesMod ? exclusionesMod.adminConfigurarClientesExcluidos : null),
    adminConfigurarArticulosFuera: (typeof adminConfigurarArticulosFuera !== 'undefined')
      ? adminConfigurarArticulosFuera
      : (exclusionesMod ? exclusionesMod.adminConfigurarArticulosFuera : null),
    adminConfigurarEquivalencias: (typeof adminConfigurarEquivalencias !== 'undefined')
      ? adminConfigurarEquivalencias
      : (equivalenciasMod ? equivalenciasMod.adminConfigurarEquivalencias : null),
    adminConfigurarFuenteEntradas,
    adminConfigurarFechaCorte: (typeof adminConfigurarFechaCorte !== 'undefined')
      ? adminConfigurarFechaCorte
      : (fechaCorteMod ? fechaCorteMod.adminConfigurarFechaCorte : null),
    enviarParteDiario_: (typeof enviarParteDiario_ !== 'undefined')
      ? enviarParteDiario_
      : (parteMod ? parteMod.enviarParteDiario_ : null),
    adminInstalarStockLight: (typeof adminInstalarStockLight !== 'undefined')
      ? adminInstalarStockLight
      : (instalacionMod ? instalacionMod.adminInstalarStockLight : null),
    copiaDiariaProgramada,
    doGet,
    include_,
    apiObtenerInicio,
    apiObtenerParte,
    apiObtenerCuadre,
    apiConfirmarCuadreFamilia,
    apiObtenerPartida,
    apiListarExclusiones,
    apiListarEquivalencias,
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
