/**
 * STOCK-LIGHT — BackupService.js
 *
 * Copias de seguridad automáticas de la hoja de datos (T-018).
 *
 * El módulo está separado en dos partes:
 * - lógica pura, probable en Node: nombre de la copia y selección de copias a borrar;
 * - acceso mínimo a Drive/ScriptApp/PropertiesService.
 *
 * Las funciones de administración viven en Código.js y llaman a exigirPropietario_()
 * (T-023). Este módulo no toca stock.
 */

// En Node.js las dependencias compartidas se resuelven aquí; en Apps Script son globales.
if (typeof require !== 'undefined') {
  const segMod = require('./Seguridad');
  const confMod = require('./Config');
  if (typeof global.exigirPropietario_ === 'undefined') global.exigirPropietario_ = segMod.exigirPropietario_;
  if (typeof global.usuarioActual_ === 'undefined') global.usuarioActual_ = segMod.usuarioActual_;
  if (typeof global.resolveDatabaseSpreadsheet === 'undefined') global.resolveDatabaseSpreadsheet = confMod.resolveDatabaseSpreadsheet;
}

const BACKUP_FOLDER_ID_KEY = 'BACKUP_FOLDER_ID';
const MOTIVOS_COPIA = ['DIARIA', 'MANUAL', 'PRE_DESPLIEGUE'];
const MAX_COPIAS_DIARIAS = 30;

/**
 * Descompone una fecha en sus partes en Europe/Madrid.
 * Función privada y pura.
 *
 * @param {Date|string|number} fecha
 * @returns {{ anio: string, mes: string, dia: string, hora: string, minuto: string, fecha: string }}
 */
function _partesFechaMadrid_(fecha) {
  const fechaObj = fecha instanceof Date ? fecha : new Date(fecha);
  if (isNaN(fechaObj.getTime())) {
    throw new Error(`Fecha de copia no válida: ${fecha}`);
  }

  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(fechaObj);

  const valor = (tipo) => {
    const parte = partes.find((p) => p.type === tipo);
    return parte ? parte.value : '';
  };

  const anio = valor('year');
  const mes = valor('month');
  const dia = valor('day');
  const hora = valor('hour');
  const minuto = valor('minute');

  if (!anio || !mes || !dia || !hora || !minuto) {
    throw new Error('No se pudo formatear la fecha de la copia en Europe/Madrid.');
  }

  return {
    anio,
    mes,
    dia,
    hora,
    minuto,
    fecha: `${anio}-${mes}-${dia}`
  };
}

/**
 * Genera el nombre canónico de una copia:
 * STOCK-LIGHT_COPIA_<YYYY-MM-DD_HHmm Europe/Madrid>_<MOTIVO>
 *
 * Función pura: no accede a Drive, Sheets ni Session.
 *
 * @param {Date|string|number} fecha
 * @param {string} motivo - DIARIA | MANUAL | PRE_DESPLIEGUE
 * @returns {string}
 */
function nombreCopiaSeguridad(fecha, motivo) {
  const motivoNormalizado = String(motivo || '').trim().toUpperCase();
  if (MOTIVOS_COPIA.indexOf(motivoNormalizado) === -1) {
    throw new Error(`Motivo de copia no válido: '${motivo}'. Debe ser DIARIA, MANUAL o PRE_DESPLIEGUE.`);
  }

  const partes = _partesFechaMadrid_(fecha);
  return `STOCK-LIGHT_COPIA_${partes.fecha}_${partes.hora}${partes.minuto}_${motivoNormalizado}`;
}

/**
 * Extrae la fecha YYYY-MM-DD del nombre canónico de una copia.
 * Función privada y pura.
 *
 * @param {Object} copia
 * @returns {string}
 */
function _fechaDeNombreCopia_(copia) {
  const nombre = String((copia && (copia.nombre || copia.name)) || '').trim();
  const match = nombre.match(/^STOCK-LIGHT_COPIA_(\d{4}-\d{2}-\d{2})_/);
  return match ? match[1] : '';
}

/**
 * Indica si ya existe una copia DIARIA con la fecha indicada (Europe/Madrid),
 * comparando la fecha que lleva el nombre de la copia. Función pura.
 *
 * @param {Array<Object>} listaCopias
 * @param {Date|string} hoy - Fecha de referencia; si es 'YYYY-MM-DD' se usa tal cual
 * @returns {boolean}
 */
function existeCopiaDiariaDeHoy(listaCopias, hoy) {
  let fechaHoy;
  if (typeof hoy === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(hoy.trim())) {
    fechaHoy = hoy.trim();
  } else {
    fechaHoy = _partesFechaMadrid_(hoy === undefined || hoy === null ? new Date() : hoy).fecha;
  }

  const copias = Array.isArray(listaCopias) ? listaCopias : [];
  return copias.some((copia) => _esCopiaDiaria_(copia) && _fechaDeNombreCopia_(copia) === fechaHoy);
}

/**
 * Indica si una copia es DIARIA. Acepta el motivo explícito o lo deduce del nombre.
 * Función pura.
 *
 * @param {Object} copia
 * @returns {boolean}
 */
function _esCopiaDiaria_(copia) {
  if (!copia) return false;
  if (String(copia.motivo || '').trim().toUpperCase() === 'DIARIA') return true;
  return /_DIARIA(?: \(\d+\))?$/.test(String(copia.nombre || copia.name || '').trim());
}

/**
 * Clave temporal de una copia para ordenar de más antigua a más nueva.
 * Usa fechaCreacion si es válida; si no, el timestamp del nombre; si no, el final.
 * Función pura.
 *
 * @param {Object} copia
 * @returns {number}
 */
function _claveTiempoCopia_(copia) {
  if (!copia) return Number.MAX_SAFE_INTEGER;
  const fecha = copia.fechaCreacion || copia.fecha_creacion || copia.createdAt || copia.fecha;
  if (fecha) {
    const tiempo = new Date(fecha).getTime();
    if (!isNaN(tiempo)) return tiempo;
  }

  const nombre = String(copia.nombre || copia.name || '').trim();
  const match = nombre.match(/(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/);
  if (match) {
    return Date.UTC(
      parseInt(match[1].slice(0, 4), 10),
      parseInt(match[1].slice(5, 7), 10) - 1,
      parseInt(match[1].slice(8, 10), 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10)
    );
  }

  return Number.MAX_SAFE_INTEGER;
}

/**
 * Decide qué copias DIARIA sobran para conservar como máximo `maximo`.
 * Nunca devuelve copias MANUAL ni PRE_DESPLIEGUE. No muta la lista de entrada.
 *
 * @param {Array<Object>} listaCopias - [{ id, nombre, motivo?, fechaCreacion? }]
 * @param {number} [maximo=30]
 * @returns {Array<Object>} Copias DIARIA más antiguas que sobran
 */
function seleccionarCopiasABorrar(listaCopias, maximo = MAX_COPIAS_DIARIAS) {
  const copias = Array.isArray(listaCopias) ? listaCopias.slice() : [];
  const limite = Number.isFinite(Number(maximo)) ? Math.max(0, Math.floor(Number(maximo))) : MAX_COPIAS_DIARIAS;

  const diarias = copias.filter(_esCopiaDiaria_);
  diarias.sort((a, b) => {
    const tiempoA = _claveTiempoCopia_(a);
    const tiempoB = _claveTiempoCopia_(b);
    if (tiempoA !== tiempoB) return tiempoA - tiempoB;
    return String(a.nombre || a.name || '').localeCompare(String(b.nombre || b.name || ''));
  });

  const sobran = Math.max(0, diarias.length - limite);
  return diarias.slice(0, sobran);
}

/**
 * Genera un identificador con UUID para la línea de LOG_OPERACIONES (D-024).
 * Función privada.
 *
 * @returns {string}
 */
function _nuevoIdLogCopia_() {
  if (typeof Utilities !== 'undefined' && typeof Utilities.getUuid === 'function') {
    return 'LOG-COPIA-' + Utilities.getUuid();
  }
  if (typeof require !== 'undefined') {
    const crypto = require('crypto');
    if (crypto && typeof crypto.randomUUID === 'function') {
      return 'LOG-COPIA-' + crypto.randomUUID();
    }
  }
  throw new Error('No hay generador de identificadores UUID disponible para la copia de seguridad.');
}

/**
 * Resuelve la propiedad BACKUP_FOLDER_ID desde PropertiesService o las opciones.
 * Función privada.
 *
 * @param {Object} [options]
 * @returns {Object} Servicio de propiedades y valor
 */
function _resolverPropiedadesCopia_(options = {}) {
  const folderIdOpt = options.backupFolderId && String(options.backupFolderId).trim();
  if (folderIdOpt) {
    return { propService: null, folderId: folderIdOpt };
  }

  const propService = options.propertiesService || (typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null);
  if (!propService || typeof propService.getProperty !== 'function') {
    throw new Error('PropertiesService no está disponible para leer la configuración de copias.');
  }
  const folderId = propService.getProperty(BACKUP_FOLDER_ID_KEY);
  return {
    propService,
    folderId: folderId && String(folderId).trim() ? String(folderId).trim() : ''
  };
}

/**
 * Escribe una línea de auditoría de copia en LOG_OPERACIONES dentro de LockService.
 * Función privada; si no hay repositorio disponible no falla.
 *
 * @param {Object} registro
 * @param {Object} [options]
 * @returns {boolean}
 */
function _escribirLogCopia_(registro, options = {}) {
  const repo = options.repository || (typeof SheetsRepository !== 'undefined' ? new SheetsRepository() : null);
  if (!repo || typeof repo.appendLogOperacion !== 'function') return false;

  const lock = options.lockService || (typeof LockService !== 'undefined' && typeof LockService.getScriptLock === 'function' ? LockService.getScriptLock() : null);
  let bloqueado = false;
  try {
    if (lock && typeof lock.waitLock === 'function') {
      bloqueado = lock.waitLock(10000);
      if (!bloqueado) {
        throw new Error('No se pudo adquirir el bloqueo para registrar la copia de seguridad.');
      }
    }
    repo.appendLogOperacion(registro);
    return true;
  } finally {
    if (bloqueado && lock && typeof lock.releaseLock === 'function') {
      try { lock.releaseLock(); } catch (e) { /* bloqueo ya liberado */ }
    }
  }
}

/**
 * Registra una copia correcta en LOG_OPERACIONES.
 * Función privada.
 *
 * @param {Object} copia - { id, nombre }
 * @param {string} motivo
 * @param {Object} [options]
 */
function _registrarLogCopia_(copia, motivo, options = {}) {
  _escribirLogCopia_({
    id_log: _nuevoIdLogCopia_(),
    fecha_hora: new Date().toISOString(),
    usuario: typeof usuarioActual_ === 'function' ? usuarioActual_() : 'SIN_IDENTIFICAR',
    operacion: 'COPIA_SEGURIDAD',
    motivo,
    referencia: copia.id,
    estado: 'CORRECTA',
    observaciones: copia.nombre
  }, options);
}

/**
 * Registra un error de copia en LOG_OPERACIONES sin lanzar nada.
 * Función privada.
 *
 * @param {Error|string} error
 * @param {Object} [options]
 */
function registrarErrorCopia_(error, options = {}) {
  try {
    const mensaje = error && error.message ? error.message : String(error);
    _escribirLogCopia_({
      id_log: _nuevoIdLogCopia_(),
      fecha_hora: new Date().toISOString(),
      usuario: typeof usuarioActual_ === 'function' ? usuarioActual_() : 'SIN_IDENTIFICAR',
      operacion: 'COPIA_SEGURIDAD',
      motivo: 'DIARIA',
      estado: 'ERROR',
      observaciones: mensaje
    }, options);
  } catch (e) {
    // El log de errores nunca debe tumbar el disparador.
  }
}

/**
 * Lista las copias de una carpeta de Drive como metadatos planos.
 * Función privada.
 *
 * @param {Object} carpeta
 * @returns {Array<Object>}
 */
function _listarCopiasSeguridad_(carpeta) {
  const copias = [];
  if (!carpeta || typeof carpeta.getFiles !== 'function') return copias;

  const iterador = carpeta.getFiles();
  while (iterador && typeof iterador.hasNext === 'function' && iterador.hasNext()) {
    const archivo = iterador.next();
    if (!archivo) continue;
    copias.push({
      id: typeof archivo.getId === 'function' ? archivo.getId() : '',
      nombre: typeof archivo.getName === 'function' ? archivo.getName() : '',
      fechaCreacion: typeof archivo.getDateCreated === 'function' ? archivo.getDateCreated() : null
    });
  }
  return copias;
}

/**
 * Aplica la retención de copias DIARIA: conserva 30 y manda a la papelera las más antiguas.
 * Las MANUAL y PRE_DESPLIEGUE no se tocan.
 * Función privada.
 *
 * @param {Object} carpeta
 * @param {Object} driveApp
 * @returns {Array<string>} Identificadores enviados a la papelera
 */
function _aplicarRetencionCopias_(carpeta, driveApp) {
  const copias = _listarCopiasSeguridad_(carpeta);
  const aBorrar = seleccionarCopiasABorrar(copias, MAX_COPIAS_DIARIAS);
  const borradas = [];

  for (const copia of aBorrar) {
    if (!copia.id) continue;
    const archivo = driveApp.getFileById(copia.id);
    if (archivo && typeof archivo.setTrashed === 'function') {
      archivo.setTrashed(true);
      borradas.push(copia.id);
    }
  }
  return borradas;
}

/**
 * Crea una copia de seguridad de la hoja de datos y la registra en LOG_OPERACIONES.
 * Función privada: la invocan las funciones admin* y el disparador diario.
 *
 * @param {string} motivo - DIARIA | MANUAL | PRE_DESPLIEGUE
 * @param {Object} [options] - Inyección para pruebas
 * @returns {{ id: string, nombre: string }}
 */
function crearCopiaSeguridad_(motivo, options = {}) {
  const motivoNormalizado = String(motivo || '').trim().toUpperCase();
  if (MOTIVOS_COPIA.indexOf(motivoNormalizado) === -1) {
    throw new Error(`Motivo de copia no válido: '${motivo}'. Debe ser DIARIA, MANUAL o PRE_DESPLIEGUE.`);
  }

  const fecha = options.fecha ? new Date(options.fecha) : new Date();
  const nombre = nombreCopiaSeguridad(fecha, motivoNormalizado);

  const spreadsheet = options.spreadsheet || (typeof resolveDatabaseSpreadsheet === 'function' ? resolveDatabaseSpreadsheet(options) : null);
  if (!spreadsheet || typeof spreadsheet.getId !== 'function') {
    throw new Error('No se pudo resolver la hoja de datos que se va a copiar.');
  }
  const spreadsheetId = String(spreadsheet.getId() || '').trim();
  if (!spreadsheetId) {
    throw new Error('La hoja de datos no tiene un identificador válido para copiar.');
  }

  const { folderId } = _resolverPropiedadesCopia_(options);
  if (!folderId) {
    throw new Error(
      `No se ha configurado la carpeta de copias (${BACKUP_FOLDER_ID_KEY}) en ScriptProperties. ` +
      'Ejecuta adminConfigurarCarpetaCopias(<id de la carpeta>) antes de crear copias.'
    );
  }

  const driveApp = options.driveApp || (typeof DriveApp !== 'undefined' ? DriveApp : null);
  if (!driveApp || typeof driveApp.getFolderById !== 'function' || typeof driveApp.getFileById !== 'function') {
    throw new Error('DriveApp no está disponible para crear la copia de seguridad.');
  }

  let carpeta;
  try {
    carpeta = driveApp.getFolderById(folderId);
  } catch (err) {
    throw new Error(`No se pudo acceder a la carpeta de copias '${folderId}': ${err.message}`);
  }
  if (!carpeta) {
    throw new Error(`No se encontró la carpeta de copias '${folderId}'.`);
  }

  // Blindaje contra llamadas repetidas desde el navegador: una sola DIARIA por día.
  if (motivoNormalizado === 'DIARIA') {
    const copiasActuales = _listarCopiasSeguridad_(carpeta);
    if (existeCopiaDiariaDeHoy(copiasActuales, fecha)) {
      return { ok: true, omitida: true, motivo: 'YA_EXISTE_HOY' };
    }
  }

  let archivoCopia;
  try {
    archivoCopia = driveApp.getFileById(spreadsheetId).makeCopy(nombre, carpeta);
  } catch (err) {
    throw new Error(`No se pudo crear la copia de seguridad '${nombre}': ${err.message}`);
  }

  const idCopia = archivoCopia && typeof archivoCopia.getId === 'function' ? String(archivoCopia.getId() || '').trim() : '';
  if (!idCopia) {
    throw new Error(`La copia '${nombre}' se creó pero no se pudo obtener su identificador.`);
  }

  const copia = { id: idCopia, nombre };

  if (motivoNormalizado === 'DIARIA') {
    _aplicarRetencionCopias_(carpeta, driveApp);
  }

  _registrarLogCopia_(copia, motivoNormalizado, options);
  return copia;
}

/**
 * Instala (o reinstala) el disparador diario de las 23:00 para copiaDiariaProgramada.
 * Borra antes cualquier disparador anterior de esa función, por lo que es idempotente.
 * Función privada: la llama adminInstalarCopiaDiaria().
 *
 * @param {Object} [options] - Inyección para pruebas
 * @returns {{ ok: boolean, handler: string, hora: number }}
 */
function instalarCopiaDiaria_(options = {}) {
  const scriptApp = options.scriptApp || (typeof ScriptApp !== 'undefined' ? ScriptApp : null);
  if (!scriptApp || typeof scriptApp.newTrigger !== 'function') {
    throw new Error('ScriptApp no está disponible para instalar la copia diaria.');
  }

  const previos = typeof scriptApp.getProjectTriggers === 'function' ? scriptApp.getProjectTriggers() : [];
  for (const trigger of previos) {
    if (!trigger) continue;
    const handler = typeof trigger.getHandlerFunction === 'function' ? trigger.getHandlerFunction() : '';
    if (handler === 'copiaDiariaProgramada') {
      scriptApp.deleteTrigger(trigger);
    }
  }

  scriptApp
    .newTrigger('copiaDiariaProgramada')
    .timeBased()
    .atHour(23)
    .everyDays(1)
    .create();

  return { ok: true, handler: 'copiaDiariaProgramada', hora: 23 };
}

/**
 * Persiste el ID de la carpeta de Drive donde se guardan las copias.
 * Función privada: la llama adminConfigurarCarpetaCopias().
 *
 * @param {string} folderId
 * @param {Object} [options] - Inyección para pruebas
 * @returns {{ folderId: string }}
 */
function configurarCarpetaCopias_(folderId, options = {}) {
  const id = String(folderId || '').trim();
  if (!id) {
    throw new Error('El BACKUP_FOLDER_ID proporcionado no es válido (debe ser una cadena no vacía).');
  }

  const propService = options.propertiesService || (typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null);
  if (!propService || typeof propService.setProperty !== 'function') {
    throw new Error('PropertiesService no está disponible para persistir la carpeta de copias.');
  }

  propService.setProperty(BACKUP_FOLDER_ID_KEY, id);
  return { folderId: id };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    nombreCopiaSeguridad,
    existeCopiaDiariaDeHoy,
    seleccionarCopiasABorrar,
    crearCopiaSeguridad_,
    instalarCopiaDiaria_,
    configurarCarpetaCopias_,
    registrarErrorCopia_
  };
}
