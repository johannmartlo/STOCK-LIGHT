/**
 * STOCK-LIGHT — Instalacion.js
 *
 * Puesta en marcha de una instalación nueva (T-011):
 * - provisiona las hojas;
 * - siembra el catálogo solo si está vacío;
 * - instala la copia diaria si hay carpeta de copias;
 * - crea el primer usuario ADMIN si no existe ninguno.
 *
 * La función es idempotente y se ejecuta desde el editor de Apps Script.
 */

// Dependencias compartidas en Node.js; en Apps Script son globales.
if (typeof require !== 'undefined') {
  const segMod = require('./Seguridad');
  const confMod = require('./Config');
  const repoMod = require('./Repository');
  const semillaMod = require('./SemillaCatalogo');
  const backupMod = require('./BackupService');

  global.exigirPropietario_ = global.exigirPropietario_ || segMod.exigirPropietario_;
  global.crearServicioAcceso_ = global.crearServicioAcceso_ || segMod.crearServicioAcceso_;
  global.getSpreadsheetIdConfig = global.getSpreadsheetIdConfig || confMod.getSpreadsheetIdConfig;
  global.getDriveFolderIdConfig = global.getDriveFolderIdConfig || confMod.getDriveFolderIdConfig;
  global.SheetsRepository = global.SheetsRepository || repoMod.SheetsRepository;
  global.sembrarCatalogoEnRepositorio_ = global.sembrarCatalogoEnRepositorio_ || semillaMod.sembrarCatalogoEnRepositorio_;
  global.instalarCopiaDiaria_ = global.instalarCopiaDiaria_ || backupMod.instalarCopiaDiaria_;
}

const BACKUP_FOLDER_ID_KEY_INSTALACION = 'BACKUP_FOLDER_ID';

/**
 * Lee una propiedad del script de forma defensiva.
 *
 * @param {string} nombre
 * @param {Object} [options]
 * @returns {string}
 */
function _leerPropiedadInstalacion_(nombre, options = {}) {
  const propService = options.propertiesService
    || (typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null);
  if (!propService || typeof propService.getProperty !== 'function') return '';
  const valor = propService.getProperty(nombre);
  return valor === null || valor === undefined ? '' : String(valor).trim();
}

/**
 * Indica si una fila de USUARIOS está activa, con la misma tolerancia que Seguridad.js.
 *
 * @param {Object} usuario
 * @returns {boolean}
 */
function _usuarioActivoInstalacion_(usuario) {
  if (!usuario) return false;
  const valor = usuario.activo;
  if (valor === false || valor === 0) return false;
  const texto = String(valor === undefined || valor === null ? '' : valor).trim().toUpperCase();
  return texto !== 'FALSE' && texto !== 'NO' && texto !== '0';
}

/**
 * Indica si ya existe un ADMIN activo.
 *
 * @param {Array<Object>} usuarios
 * @returns {boolean}
 */
function _hayAdminActivoInstalacion_(usuarios) {
  return (Array.isArray(usuarios) ? usuarios : []).some((usuario) => (
    String(usuario && usuario.rol || '').trim().toUpperCase() === 'ADMIN'
    && _usuarioActivoInstalacion_(usuario)
  ));
}

/**
 * Ejecuta la puesta en marcha completa desde el editor.
 *
 * @param {string} [nombre] - Nombre del primer ADMIN, si no existe ninguno.
 * @param {Object} [options] - Inyección para pruebas (repository, propertiesService, scriptApp, session...).
 * @returns {{ hecho: Array<string>, yaEstaba: Array<string>, falta: Array<string>, enlace: string, sinCambios: boolean }}
 */
function adminInstalarStockLight(nombre = '', options = {}) {
  exigirPropietario_(options && options.session);

  const hecho = [];
  const yaEstaba = [];
  const falta = [];
  const informe = (enlace = '') => ({
    hecho,
    yaEstaba,
    falta,
    enlace,
    sinCambios: hecho.length === 0
  });

  // 1. Comprobaciones previas: sin configuración no se escribe nada.
  const spreadsheetId = getSpreadsheetIdConfig(options);
  const driveFolderId = getDriveFolderIdConfig(options);
  if (!spreadsheetId) {
    falta.push("SPREADSHEET_ID no configurado. Ejecuta configurarSpreadsheetId('<ID_DE_LA_HOJA>').");
  }
  if (!driveFolderId) {
    falta.push("DRIVE_FOLDER_ID no configurado. Ejecuta configurarDriveFolderId('<ID_DE_LA_CARPETA>').");
  }
  if (!spreadsheetId || !driveFolderId) {
    return informe();
  }

  let repo;
  try {
    repo = options.repository || new SheetsRepository({
      spreadsheet: options.spreadsheet,
      propertiesService: options.propertiesService,
      spreadsheetId
    });
  } catch (err) {
    falta.push(`No se pudo abrir la hoja de datos: ${err.message}`);
    return informe();
  }

  // 2. Provisionar las hojas (incluye STOCK_INICIAL_ENTRADA con solo la cabecera).
  let provision;
  try {
    provision = repo.provisionDatabase();
  } catch (err) {
    falta.push(`No se pudieron provisionar las hojas: ${err.message}`);
    return informe();
  }
  const creadas = provision && Array.isArray(provision.createdSheets) ? provision.createdSheets : [];
  if (creadas.length > 0) {
    hecho.push(`hojas_provisionadas:${creadas.join(',')}`);
  } else {
    yaEstaba.push('hojas');
  }

  // 3. Sembrar el catálogo solo si ATRIBUTOS y REGLAS_CLASIFICACION están vacías.
  let atributos = [];
  let reglas = [];
  try {
    atributos = typeof repo.getAtributos === 'function' ? repo.getAtributos() : [];
    reglas = typeof repo.getReglasClasificacion === 'function' ? repo.getReglasClasificacion() : [];
  } catch (err) {
    falta.push(`No se pudo leer la configuración del catálogo: ${err.message}`);
    return informe();
  }

  if (atributos.length === 0 && reglas.length === 0) {
    try {
      const semilla = sembrarCatalogoEnRepositorio_(repo);
      hecho.push(`catalogo_sembrado:${Number(semilla && semilla.totalInsertados || 0)}`);
    } catch (err) {
      falta.push(`No se pudo sembrar el catálogo: ${err.message}`);
      return informe();
    }
  } else {
    yaEstaba.push('catalogo');
  }

  // 4. Copia diaria: solo si hay carpeta de copias configurada.
  const backupFolderId = _leerPropiedadInstalacion_(BACKUP_FOLDER_ID_KEY_INSTALACION, options);
  if (!backupFolderId) {
    falta.push("Carpeta de copias no configurada. Ejecuta adminConfigurarCarpetaCopias('<ID_DE_LA_CARPETA>').");
  } else {
    const scriptApp = options.scriptApp || (typeof ScriptApp !== 'undefined' ? ScriptApp : null);
    const triggers = scriptApp && typeof scriptApp.getProjectTriggers === 'function'
      ? scriptApp.getProjectTriggers()
      : [];
    const yaInstalada = (Array.isArray(triggers) ? triggers : []).some((trigger) => (
      trigger
      && typeof trigger.getHandlerFunction === 'function'
      && trigger.getHandlerFunction() === 'copiaDiariaProgramada'
    ));

    if (yaInstalada) {
      yaEstaba.push('copia_diaria');
    } else {
      try {
        const instalar = options.instalarCopiaDiaria || instalarCopiaDiaria_;
        if (typeof instalar !== 'function') throw new Error('instalarCopiaDiaria_ no está disponible.');
        instalar(options);
        hecho.push('copia_diaria_instalada');
      } catch (err) {
        falta.push(`No se pudo instalar la copia diaria: ${err.message}`);
      }
    }
  }

  // 5. Primer ADMIN: solo si no hay ninguno activo.
  let usuarios = [];
  try {
    usuarios = typeof repo.getUsuarios === 'function' ? repo.getUsuarios() : [];
  } catch (err) {
    falta.push(`No se pudo leer la hoja USUARIOS: ${err.message}`);
    return informe();
  }

  let enlace = '';
  if (_hayAdminActivoInstalacion_(usuarios)) {
    yaEstaba.push('usuario_admin');
  } else {
    const nombreLimpio = String(nombre === null || nombre === undefined ? '' : nombre).trim();
    if (!nombreLimpio) {
      falta.push("No hay ningún usuario ADMIN. Ejecuta adminInstalarStockLight('Nombre') para crear el primero.");
    } else {
      try {
        const creado = crearServicioAcceso_(options).crearUsuario(nombreLimpio, 'ADMIN');
        enlace = creado && creado.enlace ? creado.enlace : '';
        hecho.push('usuario_admin_creado');
      } catch (err) {
        falta.push(`No se pudo crear el primer ADMIN: ${err.message}`);
      }
    }
  }

  return informe(enlace);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    adminInstalarStockLight
  };
}
