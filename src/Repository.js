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
  try {
    const fechasMod = require('./Fechas');
    global.normalizarFechaNegocio = global.normalizarFechaNegocio || fechasMod.normalizarFechaNegocio;
  } catch (e) {}
  try {
    const idsMod = require('./Ids');
    global.nuevoId = global.nuevoId || idsMod.nuevoId;
  } catch (e) {}
}

const SCHEMA_DEFINITIONS = {
  MAESTRO: [
    'codigo_articulo',
    'codigo_envase',
    'nombre_articulo',
    'descripcion_envase',
    'es_predeterminado',
    'grupo_comercial',
    'activo',
    'tenant_id',
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
    'usuario_subida',
    'firma_lineas'
  ],
  PENDIENTES: [
    'id_pendiente',
    'id_importacion',
    'tipo_doc',
    'serie',
    'numero',
    'linea',
    'fecha_negocio',
    'entidad',
    'articulo',
    'envase',
    'cajas',
    'kg',
    'motivo',
    'estado',
    'fecha_alta',
    'fecha_resolucion'
  ],
  IMPORTACIONES: [
    'id_importacion',
    'fecha_hora',
    'usuario',
    'tipo_csv',
    'hash',
    'documentos_nuevos',
    'documentos_saltados',
    'documentos_modificados',
    'documentos_pendientes',
    'lineas_ok',
    'lineas_no_seguidas',
    'lineas_abono',
    'lineas_series_ignoradas',
    'lineas_pendientes',
    'lineas_error',
    'estado',
    'ultimo_tramo'
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
    'estado',
    'fecha_negocio',
    'entidad_nombre',
    'secuencia',
    'origen_dato',
    'kg_informativo',
    'id_movimiento_ref',
    'id_capa_objetivo',
    'id_capa_creada'
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
    'documento_ref',
    'proveedor',
    'id_capa_origen',
    'origen_dato'
  ],
  CONSUMOS_FIFO: [
    'id_movimiento',
    'orden',
    'id_capa',
    'codigo_articulo',
    'codigo_envase',
    'cajas',
    'fecha_negocio'
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
  ],
  MAESTRO_ARTICULOS: [
    'id',
    'nombre',
    'activo'
  ],
  MAESTRO_ENVASES: [
    'id',
    'nombre',
    'tara_kg',
    'peso_unitario_kg',
    'activo'
  ],
  GRUPOS_COMERCIALES: [
    'id',
    'nombre',
    'orden_visual',
    'activo',
    'tipo'
  ],
  MATRIZ_ARTICULO_ENVASE: [
    'id',
    'articulo',
    'envase',
    'grupo_comercial',
    'subgrupo',
    'prioridad',
    'activo',
    'observaciones'
  ],
  ATRIBUTOS: [
    'nombre',
    'descripcion',
    'activo'
  ],
  REGLAS_CLASIFICACION: [
    'id',
    'atributo',
    'valor',
    'prioridad',
    'articulo_contiene',
    'articulo_excluye',
    'envase_contiene',
    'envase_excluye',
    'activo',
    'observaciones'
  ],
  CATALOGO: [
    'articulo',
    'envase',
    'atributo',
    'valor',
    'activo',
    'observaciones'
  ],
  AGRUPACIONES: [
    'agrupacion',
    'orden',
    'grupo',
    'subgrupo',
    'filtro',
    'activo'
  ],
  LOG_OPERACIONES: [
    'id_log',
    'fecha_hora',
    'usuario',
    'operacion',
    'codigo_articulo',
    'nombre_articulo',
    'codigo_envase',
    'descripcion_envase',
    'cantidad_cajas',
    'origen',
    'destino',
    'motivo',
    'referencia',
    'estado',
    'observaciones'
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
    this._catalogoVersion = 0;
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
        const headerRange = sheet.getRange(1, 1, 1, headers.length);
        if (typeof headerRange.setBackground === 'function') headerRange.setBackground('#1a365d');
        if (typeof headerRange.setFontColor === 'function') headerRange.setFontColor('#ffffff');
        if (typeof headerRange.setFontWeight === 'function') headerRange.setFontWeight('bold');
        createdSheets.push(sheetName);
      } else {
        // Verificar si la fila 1 tiene las cabeceras
        const lastCol = sheet.getLastColumn();
        if (lastCol === 0) {
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          sheet.setFrozenRows(1);
          const headerRange = sheet.getRange(1, 1, 1, headers.length);
          if (typeof headerRange.setBackground === 'function') headerRange.setBackground('#1a365d');
          if (typeof headerRange.setFontColor === 'function') headerRange.setFontColor('#ffffff');
          if (typeof headerRange.setFontWeight === 'function') headerRange.setFontWeight('bold');
        } else {
          // Si la hoja ya existe, comprobar si le faltan columnas del esquema oficial (idempotencia)
          const range = sheet.getRange(1, 1, 1, lastCol);
          if (range && typeof range.getValues === 'function') {
            const rawVals = range.getValues();
            const existingHeaders = (rawVals && rawVals[0] ? rawVals[0] : []).map(h => String(h).trim());
            const missingHeaders = headers.filter(h => !existingHeaders.includes(h));
            if (missingHeaders.length > 0) {
              const addRange = sheet.getRange(1, lastCol + 1, 1, missingHeaders.length);
              if (addRange && typeof addRange.setValues === 'function') {
                addRange.setValues([missingHeaders]);
              }
              if (addRange && typeof addRange.setBackground === 'function') addRange.setBackground('#1a365d');
              if (addRange && typeof addRange.setFontColor === 'function') addRange.setFontColor('#ffffff');
              if (addRange && typeof addRange.setFontWeight === 'function') addRange.setFontWeight('bold');
            }
          }
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

    const DATE_COLUMNS = new Set(['fecha_negocio', 'fecha_capa', 'fecha_documento']);
    const normFn = typeof normalizarFechaNegocio === 'function' ? normalizarFechaNegocio : (global.normalizarFechaNegocio || (d => d));

    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i];
      // Ignorar filas totalmente vacías
      if (row.every(cell => cell === '' || cell === null)) continue;

      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        const colName = headers[j];
        let val = row[j];
        if (val instanceof Date && DATE_COLUMNS.has(colName)) {
          try {
            val = normFn(val);
          } catch (e) {
            // si falla normalizar, mantener valor
          }
        }
        obj[colName] = val !== undefined ? val : '';
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

    const DATE_COLUMNS = new Set(['fecha_negocio', 'fecha_capa', 'fecha_documento']);
    const normFn = typeof normalizarFechaNegocio === 'function' ? normalizarFechaNegocio : (global.normalizarFechaNegocio || (d => d));

    const matrix = records.map(rec => {
      return headers.map(h => {
        let val = rec[h] !== undefined && rec[h] !== null ? rec[h] : '';
        if (val instanceof Date && DATE_COLUMNS.has(h)) {
          try {
            val = normFn(val);
          } catch (e) {}
        }
        return val;
      });
    });

    const startRow = sheet.getLastRow() + 1;
    // 1 única llamada de escritura en bloque
    sheet.getRange(startRow, 1, matrix.length, headers.length).setValues(matrix);

    // Escribir columnas de fecha como texto para que Sheets no las convierta a Date
    for (let j = 0; j < headers.length; j++) {
      if (DATE_COLUMNS.has(headers[j])) {
        const colRange = sheet.getRange(startRow, j + 1, matrix.length, 1);
        if (typeof colRange.setNumberFormat === 'function') {
          colRange.setNumberFormat('@');
        }
      }
    }
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

    const DATE_COLUMNS = new Set(['fecha_negocio', 'fecha_capa', 'fecha_documento']);
    const normFn = typeof normalizarFechaNegocio === 'function' ? normalizarFechaNegocio : (global.normalizarFechaNegocio || (d => d));

    const matrix = records.map(rec => {
      return headers.map(h => {
        let val = rec[h] !== undefined && rec[h] !== null ? rec[h] : '';
        if (val instanceof Date && DATE_COLUMNS.has(h)) {
          try {
            val = normFn(val);
          } catch (e) {}
        }
        return val;
      });
    });

    // Escribir todas las nuevas filas en un único bloque
    sheet.getRange(2, 1, matrix.length, headers.length).setValues(matrix);

    // Escribir columnas de fecha como texto para que Sheets no las convierta a Date
    for (let j = 0; j < headers.length; j++) {
      if (DATE_COLUMNS.has(headers[j])) {
        const colRange = sheet.getRange(2, j + 1, matrix.length, 1);
        if (typeof colRange.setNumberFormat === 'function') {
          colRange.setNumberFormat('@');
        }
      }
    }
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

  getPendientes() {
    const ss = this.getSpreadsheet();
    if (!ss.getSheetByName('PENDIENTES')) return [];
    return this.readTable('PENDIENTES');
  }

  appendPendientes(records = []) {
    if (!Array.isArray(records) || records.length === 0) return 0;
    return this.appendRecords('PENDIENTES', records);
  }

  savePendientes(records = []) {
    return this.replaceTable('PENDIENTES', records);
  }

  getImportaciones() {
    const ss = this.getSpreadsheet();
    if (!ss.getSheetByName('IMPORTACIONES')) return [];
    return this.readTable('IMPORTACIONES');
  }

  appendImportaciones(records = []) {
    if (!Array.isArray(records) || records.length === 0) return 0;
    return this.appendRecords('IMPORTACIONES', records);
  }

  saveImportaciones(records = []) {
    return this.replaceTable('IMPORTACIONES', records);
  }

  getMovimientos() {
    return this.readTable('MOVIMIENTOS');
  }

  appendMovimientos(movs, movimientosExistentes = null) {
    if (!movs || movs.length === 0) return 0;
    const existentes = Array.isArray(movimientosExistentes) ? movimientosExistentes : this.getMovimientos();
    let maxSecuencia = 0;
    for (const m of existentes) {
      const s = Number(m.secuencia);
      if (!isNaN(s) && s > maxSecuencia) {
        maxSecuencia = s;
      }
    }
    for (const mov of movs) {
      maxSecuencia++;
      mov.secuencia = maxSecuencia;
    }
    return this.appendRecords('MOVIMIENTOS', movs);
  }

  getCapasFifo() {
    return this.readTable('CAPAS_FIFO');
  }

  saveCapasFifo(capas) {
    return this.replaceTable('CAPAS_FIFO', capas);
  }

  getConsumosFifo() {
    return this.readTable('CONSUMOS_FIFO');
  }

  saveConsumosFifo(consumos) {
    return this.replaceTable('CONSUMOS_FIFO', consumos);
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

  saveMaestro(records) {
    return this.replaceTable('MAESTRO', records);
  }

  appendMaestro(records) {
    return this.appendRecords('MAESTRO', records);
  }

  /**
   * Actualiza o inserta un registro en MAESTRO garantizando idempotencia por:
   * (tenant_id, codigo_articulo, codigo_envase)
   * @param {Object} record 
   */
  upsertMaestroRecord(record) {
    if (!record || !record.codigo_articulo || !record.codigo_envase) {
      throw new Error('Registro de MAESTRO inválido: codigo_articulo y codigo_envase son obligatorios.');
    }
    const tenant = String(record.tenant_id || 'DEFAULT').trim();
    const art = String(record.codigo_articulo).trim();
    const env = String(record.codigo_envase).trim();

    const maestro = this.getMaestro();
    const existingIdx = maestro.findIndex(m => 
      String(m.codigo_articulo || '').trim() === art &&
      String(m.codigo_envase || '').trim() === env &&
      String(m.tenant_id || 'DEFAULT').trim() === tenant
    );

    const merged = {
      codigo_articulo: art,
      codigo_envase: env,
      nombre_articulo: record.nombre_articulo !== undefined ? record.nombre_articulo : (existingIdx >= 0 ? maestro[existingIdx].nombre_articulo : ''),
      descripcion_envase: record.descripcion_envase !== undefined ? record.descripcion_envase : (existingIdx >= 0 ? maestro[existingIdx].descripcion_envase : ''),
      es_predeterminado: record.es_predeterminado !== undefined ? record.es_predeterminado : (existingIdx >= 0 ? maestro[existingIdx].es_predeterminado : false),
      grupo_comercial: record.grupo_comercial !== undefined ? record.grupo_comercial : (existingIdx >= 0 ? maestro[existingIdx].grupo_comercial : ''),
      activo: record.activo !== undefined ? record.activo : (existingIdx >= 0 ? maestro[existingIdx].activo : true),
      tenant_id: tenant,
      fecha_alta: (existingIdx >= 0 && maestro[existingIdx].fecha_alta) ? maestro[existingIdx].fecha_alta : (record.fecha_alta || new Date().toISOString())
    };

    if (existingIdx >= 0) {
      maestro[existingIdx] = merged;
      this.saveMaestro(maestro);
    } else {
      maestro.push(merged);
      this.saveMaestro(maestro);
    }
    return merged;
  }

  /**
   * Establece un envase como predeterminado para un artículo, desmarcando otros predeterminados
   * sin eliminar asociaciones existentes ni desactivarlas.
   * @param {string} codigoArticulo 
   * @param {string} codigoEnvase 
   * @param {string} [tenantId='DEFAULT'] 
   */
  setEnvasePredeterminado(codigoArticulo, codigoEnvase, tenantId = 'DEFAULT') {
    const art = String(codigoArticulo || '').trim();
    const env = String(codigoEnvase || '').trim();
    const tenant = String(tenantId || 'DEFAULT').trim();

    if (!art || !env) {
      throw new Error(`setEnvasePredeterminado requiere codigoArticulo y codigoEnvase.`);
    }

    const maestro = this.getMaestro();
    let targetFound = false;

    maestro.forEach(m => {
      const mArt = String(m.codigo_articulo || '').trim();
      const mEnv = String(m.codigo_envase || '').trim();
      const mTenant = String(m.tenant_id || 'DEFAULT').trim();

      if (mArt === art && mTenant === tenant) {
        if (mEnv === env) {
          m.es_predeterminado = true;
          m.activo = true;
          targetFound = true;
        } else {
          m.es_predeterminado = false;
        }
      }
    });

    if (!targetFound) {
      maestro.push({
        codigo_articulo: art,
        codigo_envase: env,
        nombre_articulo: '',
        descripcion_envase: '',
        es_predeterminado: true,
        grupo_comercial: '',
        activo: true,
        tenant_id: tenant,
        fecha_alta: new Date().toISOString()
      });
    }

    this.saveMaestro(maestro);
    return true;
  }

  /**
   * Obtiene todas las asociaciones activas de un artículo para un tenant.
   * @param {string} codigoArticulo 
   * @param {string} [tenantId='DEFAULT'] 
   */
  getAsociacionesArticulo(codigoArticulo, tenantId = 'DEFAULT') {
    const art = String(codigoArticulo || '').trim();
    const tenant = String(tenantId || 'DEFAULT').trim();
    const maestro = this.getMaestro();
    return maestro.filter(m => 
      String(m.codigo_articulo || '').trim() === art &&
      String(m.tenant_id || 'DEFAULT').trim() === tenant &&
      (m.activo === true || String(m.activo).toLowerCase() === 'true' || m.activo === 1)
    );
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

  // --- MÉTODOS OPERATIVOS FASE 5: CATÁLOGOS COMERCIALES CONFIGURABLES ---

  getMaestroArticulos() {
    const ss = this.getSpreadsheet();
    if (!ss.getSheetByName('MAESTRO_ARTICULOS')) return [];
    return this.readTable('MAESTRO_ARTICULOS');
  }

  saveMaestroArticulos(records) {
    return this.replaceTable('MAESTRO_ARTICULOS', records);
  }

  upsertMaestroArticulo(articulo) {
    if (!articulo || (!articulo.id && !articulo.nombre)) {
      throw new Error('upsertMaestroArticulo: Se requiere id o nombre.');
    }
    const id = String(articulo.id || articulo.codigo || articulo.nombre).trim();
    const nombre = String(articulo.nombre || articulo.id).trim();
    const activo = articulo.activo !== false;

    const list = this.getMaestroArticulos();
    const idx = list.findIndex(a => String(a.id || '').trim().toUpperCase() === id.toUpperCase());
    const record = { id, nombre, activo };

    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    this.saveMaestroArticulos(list);
    return record;
  }

  getMaestroEnvases() {
    const ss = this.getSpreadsheet();
    if (!ss.getSheetByName('MAESTRO_ENVASES')) return [];
    return this.readTable('MAESTRO_ENVASES');
  }

  saveMaestroEnvases(records) {
    return this.replaceTable('MAESTRO_ENVASES', records);
  }

  upsertMaestroEnvase(envase) {
    if (!envase || (!envase.id && !envase.nombre)) {
      throw new Error('upsertMaestroEnvase: Se requiere id o nombre.');
    }
    const id = String(envase.id || envase.codigo || envase.nombre).trim();
    const nombre = String(envase.nombre || envase.id).trim();
    const taraKg = envase.tara_kg !== undefined ? Number(envase.tara_kg) : 0;
    const pesoUnitarioKg = envase.peso_unitario_kg !== undefined ? Number(envase.peso_unitario_kg) : 0;
    const activo = envase.activo !== false;

    const list = this.getMaestroEnvases();
    const idx = list.findIndex(e => String(e.id || '').trim().toUpperCase() === id.toUpperCase());
    const record = { id, nombre, tara_kg: taraKg, peso_unitario_kg: pesoUnitarioKg, activo };

    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    this.saveMaestroEnvases(list);
    return record;
  }

  getGruposComerciales() {
    const ss = this.getSpreadsheet();
    if (!ss.getSheetByName('GRUPOS_COMERCIALES')) return [];
    return this.readTable('GRUPOS_COMERCIALES');
  }

  saveGruposComerciales(records) {
    return this.replaceTable('GRUPOS_COMERCIALES', records);
  }

  upsertGrupoComercial(grupo) {
    if (!grupo || (!grupo.id && !grupo.nombre)) {
      throw new Error('upsertGrupoComercial: Se requiere id o nombre.');
    }
    const id = String(grupo.id || grupo.nombre).trim().toUpperCase();
    const nombre = String(grupo.nombre || grupo.id).trim();
    const ordenVisual = grupo.orden_visual !== undefined ? Number(grupo.orden_visual) : 50;
    const activo = grupo.activo !== false;
    const tipo = String(grupo.tipo || 'COMERCIAL').trim();

    const list = this.getGruposComerciales();
    const idx = list.findIndex(g => String(g.id || '').trim().toUpperCase() === id);
    const record = { id, nombre, orden_visual: ordenVisual, activo, tipo };

    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    this.saveGruposComerciales(list);
    return record;
  }

  getMatrizArticuloEnvase() {
    const ss = this.getSpreadsheet();
    if (!ss.getSheetByName('MATRIZ_ARTICULO_ENVASE')) return [];
    return this.readTable('MATRIZ_ARTICULO_ENVASE');
  }

  saveMatrizArticuloEnvase(records) {
    return this.replaceTable('MATRIZ_ARTICULO_ENVASE', records);
  }

  upsertMatrizArticuloEnvase(asoc) {
    if (!asoc || !asoc.articulo) {
      throw new Error('upsertMatrizArticuloEnvase: Se requiere articulo.');
    }
    const art = String(asoc.articulo).trim();
    const env = String(asoc.envase || '').trim();
    const id = asoc.id || `${art}|${env}`;
    const grp = String(asoc.grupo_comercial || '').trim();
    const subgrp = asoc.subgrupo !== undefined && asoc.subgrupo !== null ? String(asoc.subgrupo).trim() : '';
    const prioridad = asoc.prioridad !== undefined ? Number(asoc.prioridad) : 20;
    const activo = asoc.activo !== false;
    const observaciones = String(asoc.observaciones || '').trim();

    const list = this.getMatrizArticuloEnvase();
    const idx = list.findIndex(m => 
      String(m.articulo || '').trim().toUpperCase() === art.toUpperCase() &&
      String(m.envase || '').trim().toUpperCase() === env.toUpperCase()
    );

    const record = {
      id,
      articulo: art,
      envase: env,
      grupo_comercial: grp,
      subgrupo: subgrp,
      prioridad,
      activo,
      observaciones
    };

    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    this.saveMatrizArticuloEnvase(list);
    return record;
  }

  // --- MÉTODOS OPERATIVOS T-005: CATÁLOGO Y CLASIFICACIÓN (D-029) ---

  _incrementarVersionCatalogo() {
    this._catalogoVersion = (this._catalogoVersion || 0) + 1;
  }

  _normalizarClaveCatalogo(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase();
  }

  getAtributos() {
    const ss = this.getSpreadsheet();
    if (!ss.getSheetByName('ATRIBUTOS')) return [];
    return this.readTable('ATRIBUTOS');
  }

  saveAtributos(records) {
    const res = this.replaceTable('ATRIBUTOS', records);
    this._incrementarVersionCatalogo();
    return res;
  }

  appendAtributos(records = []) {
    if (!Array.isArray(records) || records.length === 0) return 0;
    const res = this.appendRecords('ATRIBUTOS', records);
    this._incrementarVersionCatalogo();
    return res;
  }

  upsertAtributo(attr) {
    if (!attr || !attr.nombre) {
      throw new Error('upsertAtributo: Se requiere nombre.');
    }
    const nombre = String(attr.nombre).trim().toUpperCase();
    const descripcion = String(attr.descripcion || '').trim();
    const activo = attr.activo !== false && String(attr.activo).toUpperCase() !== 'FALSE' && String(attr.activo).toUpperCase() !== 'NO';

    const list = this.getAtributos();
    const idx = list.findIndex(a => String(a.nombre || '').trim().toUpperCase() === nombre);
    const record = { nombre, descripcion, activo };

    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    this.saveAtributos(list);
    return record;
  }

  getReglasClasificacion() {
    const ss = this.getSpreadsheet();
    if (!ss.getSheetByName('REGLAS_CLASIFICACION')) return [];
    return this.readTable('REGLAS_CLASIFICACION');
  }

  saveReglasClasificacion(records) {
    const res = this.replaceTable('REGLAS_CLASIFICACION', records);
    this._incrementarVersionCatalogo();
    return res;
  }

  appendReglasClasificacion(records = []) {
    if (!Array.isArray(records) || records.length === 0) return 0;
    const res = this.appendRecords('REGLAS_CLASIFICACION', records);
    this._incrementarVersionCatalogo();
    return res;
  }

  upsertReglaClasificacion(regla) {
    if (!regla || !regla.atributo || regla.valor === undefined || regla.valor === null || String(regla.valor).trim() === '') {
      throw new Error('upsertReglaClasificacion: Se requieren atributo y valor.');
    }
    const genIdFn = typeof nuevoId === 'function' ? nuevoId : (global.nuevoId || (p => `${p}-AUTO`));
    const id = regla.id && String(regla.id).trim() !== '' ? String(regla.id).trim() : genIdFn('REG');
    const atributo = String(regla.atributo).trim().toUpperCase();
    const valor = String(regla.valor).trim().toUpperCase();
    const rawPrio = regla.prioridad !== undefined ? regla.prioridad : regla.orden;
    const prioridad = rawPrio !== undefined && rawPrio !== null && String(rawPrio).trim() !== ''
      ? Number(rawPrio)
      : 50;
    const articuloContiene = String(
      regla.articulo_contiene !== undefined ? regla.articulo_contiene : (regla.patron_articulo || '')
    ).trim();
    const articuloExcluye = String(regla.articulo_excluye || '').trim();
    const envaseContiene = String(
      regla.envase_contiene !== undefined ? regla.envase_contiene : (regla.patron_envase || '')
    ).trim();
    const envaseExcluye = String(regla.envase_excluye || '').trim();
    const rawActivo = regla.activo !== undefined ? regla.activo : regla.activa;
    const activo = rawActivo !== false && String(rawActivo).toUpperCase() !== 'FALSE' && String(rawActivo).toUpperCase() !== 'NO';
    const observaciones = String(
      regla.observaciones !== undefined ? regla.observaciones : (regla.descripcion || '')
    ).trim();

    const list = this.getReglasClasificacion();
    const idx = list.findIndex(r => String(r.id || '').trim().toUpperCase() === id.toUpperCase());

    const record = {
      id,
      atributo,
      valor,
      prioridad,
      articulo_contiene: articuloContiene,
      articulo_excluye: articuloExcluye,
      envase_contiene: envaseContiene,
      envase_excluye: envaseExcluye,
      activo,
      observaciones
    };

    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    this.saveReglasClasificacion(list);
    return record;
  }

  getCatalogo() {
    const ss = this.getSpreadsheet();
    if (!ss.getSheetByName('CATALOGO')) return [];
    return this.readTable('CATALOGO');
  }

  saveCatalogo(records) {
    const res = this.replaceTable('CATALOGO', records);
    this._incrementarVersionCatalogo();
    return res;
  }

  appendCatalogo(records = []) {
    if (!Array.isArray(records) || records.length === 0) return 0;
    const res = this.appendRecords('CATALOGO', records);
    this._incrementarVersionCatalogo();
    return res;
  }

  upsertExcepcionCatalogo(excepcion) {
    if (!excepcion) {
      throw new Error('upsertExcepcionCatalogo: Se requiere un objeto de excepción.');
    }
    const art = String(excepcion.articulo !== undefined ? excepcion.articulo : (excepcion.codigo_articulo || '')).trim();
    const env = String(excepcion.envase !== undefined ? excepcion.envase : (excepcion.codigo_envase || '')).trim();
    const atributo = String(excepcion.atributo || '').trim().toUpperCase();
    const valor = String(excepcion.valor || '').trim().toUpperCase();

    if (!art || !env || !atributo || !valor) {
      throw new Error('upsertExcepcionCatalogo: articulo, envase, atributo y valor son obligatorios.');
    }

    const rawActivo = excepcion.activo !== undefined ? excepcion.activo : excepcion.activa;
    const activo = rawActivo !== false && String(rawActivo).toUpperCase() !== 'FALSE' && String(rawActivo).toUpperCase() !== 'NO';
    const observaciones = String(excepcion.observaciones || '').trim();

    const artKey = this._normalizarClaveCatalogo(art);
    const envKey = this._normalizarClaveCatalogo(env);
    const attrKey = this._normalizarClaveCatalogo(atributo);

    const list = this.getCatalogo();
    const idx = list.findIndex(c =>
      this._normalizarClaveCatalogo(c.articulo) === artKey &&
      this._normalizarClaveCatalogo(c.envase) === envKey &&
      this._normalizarClaveCatalogo(c.atributo) === attrKey
    );

    const record = {
      articulo: this._normalizarClaveCatalogo(art),
      envase: this._normalizarClaveCatalogo(env),
      atributo,
      valor,
      activo,
      observaciones
    };

    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    this.saveCatalogo(list);
    return record;
  }

  getAgrupaciones() {
    const ss = this.getSpreadsheet();
    if (!ss.getSheetByName('AGRUPACIONES')) return [];
    return this.readTable('AGRUPACIONES');
  }

  saveAgrupaciones(records) {
    const res = this.replaceTable('AGRUPACIONES', records);
    this._incrementarVersionCatalogo();
    return res;
  }

  appendAgrupaciones(records = []) {
    if (!Array.isArray(records) || records.length === 0) return 0;
    const res = this.appendRecords('AGRUPACIONES', records);
    this._incrementarVersionCatalogo();
    return res;
  }

  upsertAgrupacion(agrup) {
    if (!agrup || !agrup.agrupacion || agrup.orden === undefined || agrup.orden === null) {
      throw new Error('upsertAgrupacion: Se requieren agrupacion y orden.');
    }
    const agrupacion = String(agrup.agrupacion).trim().toUpperCase();
    const orden = Number(agrup.orden);
    const grupo = String(agrup.grupo || '').trim();
    const subgrupo = agrup.subgrupo !== undefined && agrup.subgrupo !== null ? String(agrup.subgrupo).trim() : '';
    const filtro = agrup.filtro !== undefined && agrup.filtro !== null ? String(agrup.filtro).trim() : '';
    const rawActivo = agrup.activo !== undefined ? agrup.activo : agrup.activa;
    const activo = rawActivo !== false && String(rawActivo).toUpperCase() !== 'FALSE' && String(rawActivo).toUpperCase() !== 'NO';

    const list = this.getAgrupaciones();
    const idx = list.findIndex(a =>
      String(a.agrupacion || '').trim().toUpperCase() === agrupacion &&
      Number(a.orden) === orden
    );

    const record = { agrupacion, orden, grupo, subgrupo, filtro, activo };
    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    this.saveAgrupaciones(list);
    return record;
  }

  /**
   * Obtiene el registro operativo de trazabilidad simple.
   * @returns {Array<Object>}
   */
  getLogOperaciones() {
    return this.readTable('LOG_OPERACIONES');
  }

  /**
   * Añade registros al log de operaciones.
   * @param {Array<Object>} logs 
   * @returns {number}
   */
  appendLogOperaciones(logs = []) {
    if (!Array.isArray(logs) || logs.length === 0) return 0;
    return this.appendRecords('LOG_OPERACIONES', logs);
  }

  /**
   * Añade un único registro al log de operaciones.
   * @param {Object} log 
   * @returns {Object}
   */
  appendLogOperacion(log) {
    if (!log) return null;
    const record = {
      id_log: log.id_log || `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      fecha_hora: log.fecha_hora || new Date().toISOString(),
      usuario: log.usuario || 'SISTEMA',
      operacion: log.operacion || '',
      codigo_articulo: log.codigo_articulo || '',
      nombre_articulo: log.nombre_articulo || '',
      codigo_envase: log.codigo_envase || '',
      descripcion_envase: log.descripcion_envase || '',
      cantidad_cajas: log.cantidad_cajas != null ? Number(log.cantidad_cajas) : (log.cajas != null ? Number(log.cajas) : 0),
      origen: log.origen || '',
      destino: log.destino || '',
      motivo: log.motivo || '',
      referencia: log.referencia || '',
      estado: log.estado || 'CORRECTA',
      observaciones: log.observaciones || ''
    };
    this.appendLogOperaciones([record]);
    return record;
  }
}

// Exportación compatible
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEMA_DEFINITIONS,
    SheetsRepository
  };
}
