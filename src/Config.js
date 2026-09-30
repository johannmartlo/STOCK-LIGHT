/**
 * STOCK-LIGHT — Config.js
 * 
 * Gestión de Configuración y Resolución Determinista de Persistencia.
 * Permite resolver el Google Spreadsheet tanto en ejecuciones vinculadas (container-bound)
 * como en ejecuciones independientes de Web App (standalone), sin hardcodear IDs sensibles.
 */

const CONFIG_KEYS = {
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  DRIVE_FOLDER_ID: 'DRIVE_FOLDER_ID',
  APP_ENV: 'APP_ENV'
};

/**
 * Obtiene el SPREADSHEET_ID desde las propiedades del script (PropertiesService)
 * o desde las opciones inyectadas.
 * 
 * @param {Object} [options]
 * @returns {string|null}
 */
function getSpreadsheetIdConfig(options = {}) {
  // 1. Inyección explícita en opciones (útil para pruebas y entornos controlados)
  if (options.spreadsheetId && typeof options.spreadsheetId === 'string' && options.spreadsheetId.trim() !== '') {
    return options.spreadsheetId.trim();
  }

  // 2. Consulta a PropertiesService de Google Apps Script
  const propService = options.propertiesService || (typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null);
  if (propService && typeof propService.getProperty === 'function') {
    const propVal = propService.getProperty(CONFIG_KEYS.SPREADSHEET_ID);
    if (propVal && typeof propVal === 'string' && propVal.trim() !== '') {
      return propVal.trim();
    }
  }

  // 3. Fallback de variables de entorno en entornos Node.js
  if (typeof process !== 'undefined' && process.env && process.env.SPREADSHEET_ID) {
    return process.env.SPREADSHEET_ID.trim();
  }

  return null;
}

/**
 * Establece de forma segura el SPREADSHEET_ID en las propiedades persistentes del script.
 * No requiere editar código fuente ni almacenar secretos en el repositorio.
 * 
 * @param {string} spreadsheetId 
 * @param {Object} [options]
 * @returns {boolean}
 */
function setSpreadsheetIdConfig(spreadsheetId, options = {}) {
  if (!spreadsheetId || typeof spreadsheetId !== 'string' || spreadsheetId.trim() === '') {
    throw new Error('El SPREADSHEET_ID proporcionado no es válido (debe ser una cadena no vacía).');
  }

  const cleanId = spreadsheetId.trim();
  // Validación de formato básico de Google Spreadsheet ID (mínimo 15 caracteres sin espacios)
  if (cleanId.length < 15 || /\s/.test(cleanId)) {
    throw new Error(`El formato del SPREADSHEET_ID ('${cleanId}') no parece un identificador válido de Google Sheets.`);
  }

  const propService = options.propertiesService || (typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null);
  if (!propService || typeof propService.setProperty !== 'function') {
    throw new Error('PropertiesService no está disponible para persistir la configuración.');
  }

  propService.setProperty(CONFIG_KEYS.SPREADSHEET_ID, cleanId);
  return true;
}

/**
 * Obtiene el DRIVE_FOLDER_ID desde las propiedades del script (PropertiesService)
 * o desde las opciones inyectadas.
 * 
 * @param {Object} [options]
 * @returns {string|null}
 */
function getDriveFolderIdConfig(options = {}) {
  // 1. Inyección explícita en opciones (útil para pruebas)
  if (options.driveFolderId && typeof options.driveFolderId === 'string' && options.driveFolderId.trim() !== '') {
    return options.driveFolderId.trim();
  }

  // 2. Consulta a PropertiesService de Google Apps Script
  const propService = options.propertiesService || (typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null);
  if (propService && typeof propService.getProperty === 'function') {
    const propVal = propService.getProperty(CONFIG_KEYS.DRIVE_FOLDER_ID);
    if (propVal && typeof propVal === 'string' && propVal.trim() !== '') {
      return propVal.trim();
    }
  }

  // 3. Fallback de variables de entorno en entornos Node.js
  if (typeof process !== 'undefined' && process.env && process.env.DRIVE_FOLDER_ID) {
    return process.env.DRIVE_FOLDER_ID.trim();
  }

  return null;
}

/**
 * Establece de forma segura el DRIVE_FOLDER_ID en las propiedades persistentes del script.
 * 
 * @param {string} driveFolderId 
 * @param {Object} [options]
 * @returns {boolean}
 */
function setDriveFolderIdConfig(driveFolderId, options = {}) {
  if (!driveFolderId || typeof driveFolderId !== 'string' || driveFolderId.trim() === '') {
    throw new Error('El DRIVE_FOLDER_ID proporcionado no es válido (debe ser una cadena no vacía).');
  }

  const cleanId = driveFolderId.trim();
  if (cleanId.length < 10 || /\s/.test(cleanId)) {
    throw new Error(`El formato del DRIVE_FOLDER_ID ('${cleanId}') no parece un identificador válido de Google Drive.`);
  }

  const propService = options.propertiesService || (typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null);
  if (!propService || typeof propService.setProperty !== 'function') {
    throw new Error('PropertiesService no está disponible para persistir la configuración.');
  }

  propService.setProperty(CONFIG_KEYS.DRIVE_FOLDER_ID, cleanId);
  return true;
}

/**
 * Resuelve determinísticamente la instancia de Google Spreadsheet según la jerarquía:
 * 1. Objeto Spreadsheet explícitamente inyectado (options.spreadsheet)
 * 2. Spreadsheet activo en contexto container-bound (SpreadsheetApp.getActiveSpreadsheet())
 * 3. Apertura por ID vía SPREADSHEET_ID configurado en ScriptProperties (SpreadsheetApp.openById(id))
 * 
 * Si no se puede resolver, lanza una excepción clara y guiada.
 * 
 * @param {Object} [options]
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function resolveDatabaseSpreadsheet(options = {}) {
  // 1. Spreadsheet inyectado directamente
  if (options.spreadsheet && typeof options.spreadsheet.getSheetByName === 'function') {
    return options.spreadsheet;
  }

  const ssApp = options.spreadsheetApp || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp : null);
  if (!ssApp) {
    throw new Error('SpreadsheetApp no está disponible en este entorno de ejecución y no se proporcionó una instancia de Spreadsheet.');
  }

  // 2. Comprobar si existe Spreadsheet activo en el contexto actual
  if (typeof ssApp.getActiveSpreadsheet === 'function') {
    try {
      const activeSS = ssApp.getActiveSpreadsheet();
      if (activeSS && typeof activeSS.getSheetByName === 'function') {
        return activeSS;
      }
    } catch (e) {
      // getActiveSpreadsheet puede lanzar error en ciertos contextos de ejecución autónoma
    }
  }

  // 3. Resolver mediante SPREADSHEET_ID configurado
  const configuredId = getSpreadsheetIdConfig(options);
  if (!configuredId) {
    throw new Error(
      'Configuración de persistencia no encontrada: No existe un Spreadsheet activo en el contexto actual ' +
      'y no se ha configurado la propiedad "SPREADSHEET_ID" en ScriptProperties. ' +
      'Para resolver este problema en Web App, configure el ID ejecutando configurarSpreadsheetId("TU_ID") ' +
      'o agregue "SPREADSHEET_ID" en la configuración del proyecto de Apps Script.'
    );
  }

  // Validación básica del formato antes de llamar a openById
  if (configuredId.length < 15 || /\s/.test(configuredId)) {
    throw new Error(`Configuración inválida: El SPREADSHEET_ID configurado ('${configuredId}') no tiene un formato válido.`);
  }

  try {
    const openedSS = ssApp.openById(configuredId);
    if (!openedSS || typeof openedSS.getSheetByName !== 'function') {
      throw new Error(`No se pudo obtener una instancia válida de Spreadsheet con ID: ${configuredId}`);
    }
    return openedSS;
  } catch (err) {
    throw new Error(`Configuración inválida o error de acceso: No se pudo abrir el Spreadsheet con ID '${configuredId}'. Detalle: ${err.message}`);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG_KEYS,
    getSpreadsheetIdConfig,
    setSpreadsheetIdConfig,
    getDriveFolderIdConfig,
    setDriveFolderIdConfig,
    resolveDatabaseSpreadsheet
  };
}
