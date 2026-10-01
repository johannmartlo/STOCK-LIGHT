/**
 * STOCK-LIGHT — Repository.js
 * 
 * Capa de Persistencia y Acceso a Google Sheets.
 * ÚNICO módulo autorizado para invocar SpreadsheetApp.
 * 
 * Cumple estrictamente con las reglas de rendimiento:
 * - Prohibido getValue(), setValue(), appendRow() en bucles.
 * - Lectura y escritura exclusiva mediante getValues() y setValues() en bloques contiguos.
 * - Cero fórmulas de cálculo en celdas.
 */

// Importaciones condicionales para entorno Node.js / Testing (aisladas sin 'var' para evitar colisiones en Apps Script V8)
if (typeof require !== 'undefined') {
  global.resolveDatabaseSpreadsheet = global.resolveDatabaseSpreadsheet || require('./Config').resolveDatabaseSpreadsheet;
}

const SCHEMA_DEFINITIONS = {
  MAESTRO: [
    'codigo_articulo',
    'codigo_envase',
    'nombre_articulo',
    'descripcion_envase',
    'grupo_comercial',
    'activo',
    'fecha_alta'
  ],
  DOCUMENTOS: [
    'id_documento',
    'sha256_hash',
    'tipo_documento',
    'serie',
    'numero',
    'fecha_documento',
    'entidad_nombre',
    'total_lineas',
    'total_cajas',
    'drive_file_id',
    'drive_url',
    'estado_proceso',
    'fecha_subida',
    'usuario_subida'
  ],
  MOVIMIENTOS: [
    'id_movimiento',
    'fecha_hora',
    'tipo_movimiento',
    'id_documento_ref',
    'codigo_articulo',
    'codigo_envase',
    'cajas',
    'signo',
    'partida_origen',
    'motivo_ajuste',
    'usuario',
    'observaciones',
    'estado'
  ],
  CAPAS_FIFO: [
    'id_capa',
    'id_movimiento_entrada',
    'fecha_capa',
    'codigo_articulo',
    'codigo_envase',
    'cajas_iniciales',
    'cajas_consumidas',
    'cajas_restantes',
    'estado_capa',
    'partida',
    'documento_ref'
  ],
  STOCK_ACTUAL: [
    'stock_key',
    'codigo_articulo',
    'nombre_articulo',
    'codigo_envase',
    'descripcion_envase',
    'cajas_actuales',
    'fecha_ultima_actualizacion',
    'ultimo_movimiento_id'
  ],
  GRUPOS_ENVASE: [
    'codigo_envase',
    'descripcion_envase',
    'grupo_envase',
    'activo'
  ]
};

class SheetsRepository {
  /**
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet|Object} [spreadsheetOrOptions] 
   */
  constructor(spreadsheetOrOptions = null) {
    if (spreadsheetOrOptions && typeof spreadsheetOrOptions.getSheetByName === 'function') {
      this._spreadsheet = spreadsheetOrOptions;
      this._options = {};
    } else {
      this._options = (spreadsheetOrOptions && typeof spreadsheetOrOptions === 'object') ? spreadsheetOrOptions : {};
      this._spreadsheet = this._options.spreadsheet || null;
    }
  }

  /**
   * Obtiene la hoja de cálculo resolviendo determinísticamente según la jerarquía:
   * 1. Inyección explícita
   * 2. SpreadsheetApp.getActiveSpreadsheet() si existe
   * 3. SPREADSHEET_ID desde ScriptProperties o configuración
   */
  getSpreadsheet() {
    if (!this._spreadsheet) {
      if (typeof resolveDatabaseSpreadsheet === 'function') {
        this._spreadsheet = resolveDatabaseSpreadsheet(this._options);
      } else if (typeof SpreadsheetApp !== 'undefined') {
        this._spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      } else {
        throw new Error('SpreadsheetApp no está disponible en este entorno.');
      }
    }
    return this._spreadsheet;
  }

  /**
   * Provisiona las 5 hojas requeridas si no existen, inicializando sus cabeceras oficiales.
   */
  provisionDatabase() {
    const ss = this.getSpreadsheet();
    const createdSheets = [];

    for (const sheetName in SCHEMA_DEFINITIONS) {
      let sheet = ss.getSheetByName(sheetName);
      const headers = SCHEMA_DEFINITIONS[sheetName];

      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.setFrozenRows(1);
        sheet.getRange(1, 1, 1, headers.length)
          .setBackground('#1a365d')
          .setFontColor('#ffffff')
          .setFontWeight('bold');
        createdSheets.push(sheetName);
      } else {
        // Verificar si la fila 1 tiene las cabeceras
        const lastCol = sheet.getLastColumn();
        if (lastCol === 0) {
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          sheet.setFrozenRows(1);
          sheet.getRange(1, 1, 1, headers.length)
            .setBackground('#1a365d')
            .setFontColor('#ffffff')
            .setFontWeight('bold');
        }
      }
    }

    return {
      status: 'OK',
      createdSheets,
      allSheets: Object.keys(SCHEMA_DEFINITIONS)
    };
  }

  /**
   * Lee en bloque todos los registros de una hoja como array de objetos.
   * Utiliza una sola llamada getValues().
   * @param {string} sheetName 
   * @returns {Array<Object>}
   */
  readTable(sheetName) {
    const ss = this.getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`La hoja '${sheetName}' no existe. Ejecuta provisionDatabase() primero.`);
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) {
      return []; // Solo cabecera o vacía
    }

    // 1 única llamada de lectura en bloque
    const matrix = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = matrix[0].map(h => String(h).trim());
    const records = [];

    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i];
      // Ignorar filas totalmente vacías
      if (row.every(cell => cell === '' || cell === null)) continue;

      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = row[j] !== undefined ? row[j] : '';
      }
      records.push(obj);
    }

    return records;
  }

  /**
   * Añade en bloque un conjunto de registros al final de la hoja en una sola llamada setValues().
   * @param {string} sheetName 
   * @param {Array<Object>} records 
   */
  appendRecords(sheetName, records) {
    if (!records || records.length === 0) return 0;

    const ss = this.getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`La hoja '${sheetName}' no existe.`);
    }

    const headers = SCHEMA_DEFINITIONS[sheetName];
    if (!headers) {
      throw new Error(`Esquema no definido para '${sheetName}'`);
    }

    const matrix = records.map(rec => {
      return headers.map(h => (rec[h] !== undefined && rec[h] !== null ? rec[h] : ''));
    });

    const startRow = sheet.getLastRow() + 1;
    // 1 única llamada de escritura en bloque
    sheet.getRange(startRow, 1, matrix.length, headers.length).setValues(matrix);
    return matrix.length;
  }

  /**
   * Reemplaza por completo el contenido de una tabla (conservando la fila de cabecera).
   * Especialmente usado para materializar STOCK_ACTUAL y CAPAS_FIFO de forma atómica.
   * @param {string} sheetName 
   * @param {Array<Object>} records 
   */
  replaceTable(sheetName, records = []) {
    const ss = this.getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`La hoja '${sheetName}' no existe.`);
    }

    const headers = SCHEMA_DEFINITIONS[sheetName];
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn() || headers.length;

    // Asegurar cabeceras si la tabla estuviera vacía, o limpiar datos bajo la cabecera
    if (lastRow === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    }

    if (!records || records.length === 0) {
      return 0;
    }

    const matrix = records.map(rec => {
      return headers.map(h => (rec[h] !== undefined && rec[h] !== null ? rec[h] : ''));
    });

    // Escribir todas las nuevas filas en un único bloque
    sheet.getRange(2, 1, matrix.length, headers.length).setValues(matrix);
    return matrix.length;
  }

  // --- Métodos Semánticos de Dominio ---

  getDocumentos() {
    return this.readTable('DOCUMENTOS');
  }

  appendDocumento(doc) {
    return this.appendRecords('DOCUMENTOS', [doc]);
  }

  /**
   * Actualiza el estado_proceso de un documento por su ID.
   * @param {string} idDocumento 
   * @param {string} nuevoEstado 
   */
  updateDocumentoEstado(idDocumento, nuevoEstado) {
    const docs = this.getDocumentos();
    const doc = docs.find(d => String(d.id_documento || '').trim() === String(idDocumento).trim());
    if (!doc) {
      throw new Error(`Documento con ID '${idDocumento}' no encontrado.`);
    }
    doc.estado_proceso = nuevoEstado;
    return this.replaceTable('DOCUMENTOS', docs);
  }

  getMovimientos() {
    return this.readTable('MOVIMIENTOS');
  }

  appendMovimientos(movs) {
    return this.appendRecords('MOVIMIENTOS', movs);
  }

  getCapasFifo() {
    return this.readTable('CAPAS_FIFO');
  }

  saveCapasFifo(capas) {
    return this.replaceTable('CAPAS_FIFO', capas);
  }

  getStockActual() {
    return this.readTable('STOCK_ACTUAL');
  }

  saveStockActual(stockRecords) {
    return this.replaceTable('STOCK_ACTUAL', stockRecords);
  }

  getMaestro() {
    return this.readTable('MAESTRO');
  }

  getGruposEnvase() {
    const ss = this.getSpreadsheet();
    if (!ss.getSheetByName('GRUPOS_ENVASE')) {
      return [];
    }
    return this.readTable('GRUPOS_ENVASE');
  }

  saveGruposEnvase(records) {
    return this.replaceTable('GRUPOS_ENVASE', records);
  }
}

// Exportación compatible
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEMA_DEFINITIONS,
    SheetsRepository
  };
}
