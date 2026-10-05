/**
 * STOCK-LIGHT — ArticuloEnvaseValidator.js
 * 
 * Validador en memoria para la matriz relacional ARTICULO_ENVASE.
 * Evalúa integridad referencial cruzada y calcula cardinalidad de confección.
 * Opera 100% aislado: CERO escrituras en base de datos.
 */

if (typeof require !== 'undefined') {
  global.ImportSchema = global.ImportSchema || require('./ImportSchema');
  global.ImportDiagnostics = global.ImportDiagnostics || require('./ImportDiagnostics');
}

const _resolveHeaderMappingAE = (typeof resolveHeaderMapping !== 'undefined')
  ? resolveHeaderMapping
  : (typeof ImportSchema !== 'undefined' ? ImportSchema.resolveHeaderMapping : require('./ImportSchema').resolveHeaderMapping);

const _parseCSVAE = (typeof parseCSV !== 'undefined')
  ? parseCSV
  : (typeof ImportSchema !== 'undefined' ? ImportSchema.parseCSV : require('./ImportSchema').parseCSV);

const _ARTICULO_ENVASE_HEADER_SYNONYMS = (typeof ARTICULO_ENVASE_HEADER_SYNONYMS !== 'undefined')
  ? ARTICULO_ENVASE_HEADER_SYNONYMS
  : (typeof ImportSchema !== 'undefined' ? ImportSchema.ARTICULO_ENVASE_HEADER_SYNONYMS : require('./ImportSchema').ARTICULO_ENVASE_HEADER_SYNONYMS);

const _ARTICULO_ENVASE_SCHEMA_SPEC = (typeof ARTICULO_ENVASE_SCHEMA_SPEC !== 'undefined')
  ? ARTICULO_ENVASE_SCHEMA_SPEC
  : (typeof ImportSchema !== 'undefined' ? ImportSchema.ARTICULO_ENVASE_SCHEMA_SPEC : require('./ImportSchema').ARTICULO_ENVASE_SCHEMA_SPEC);

const _DIAGNOSTIC_CODES_AE = (typeof DIAGNOSTIC_CODES !== 'undefined')
  ? DIAGNOSTIC_CODES
  : (typeof ImportDiagnostics !== 'undefined' ? ImportDiagnostics.DIAGNOSTIC_CODES : require('./ImportDiagnostics').DIAGNOSTIC_CODES);

const _DiagnosticReportAE = (typeof DiagnosticReport !== 'undefined')
  ? DiagnosticReport
  : (typeof ImportDiagnostics !== 'undefined' ? ImportDiagnostics.DiagnosticReport : require('./ImportDiagnostics').DiagnosticReport);


class ArticuloEnvaseValidator {
  /**
   * @param {Object} [options]
   * @param {Array<Object>|Map} [options.maestroArticulos] Catálogo de artículos conocidos [{ codigo_articulo, nombre_articulo, activo }]
   * @param {Array<Object>|Map} [options.maestroEnvasesValidados] Catálogo de envases validados [{ codigo_envase, descripcion_envase, activo }]
   */
  constructor(options = {}) {
    this.maestroArticulos = this._indexArticulos(options.maestroArticulos || []);
    this.maestroEnvasesValidados = this._indexEnvases(options.maestroEnvasesValidados || []);
  }

  /**
   * Valida el archivo CSV de combinaciones artículo-envase.
   * 
   * @param {string|Array<Array<string>>} rawInput
   * @param {Object} [fileMeta]
   * @returns {Object} Informe de diagnóstico
   */
  validate(rawInput, fileMeta = {}) {
    const fileName = fileMeta.fileName || 'ARTICULO_ENVASE.csv';
    const report = new _DiagnosticReportAE(fileName);

    let rows = [];
    if (typeof rawInput === 'string') {
      rows = _parseCSVAE(rawInput);
    } else if (Array.isArray(rawInput)) {
      rows = rawInput;
    }

    if (!rows || rows.length === 0) {
      report.addError({
        fila: 0,
        campo: 'archivo',
        valor: '',
        codigoError: 'ARCHIVO_VACIO',
        descripcion: 'El archivo recibido está vacío o carece de filas.'
      });
      return report.toObject();
    }

    const headerRow = rows[0];
    const dataRows = rows.slice(1);
    report.totalFilas = dataRows.length;

    // Resolución de encabezados
    const headerRes = _resolveHeaderMappingAE(headerRow, _ARTICULO_ENVASE_HEADER_SYNONYMS, _ARTICULO_ENVASE_SCHEMA_SPEC);
    if (!headerRes.ok) {
      headerRes.errors.forEach(err => {
        report.addError({
          fila: 1,
          campo: 'cabecera',
          valor: headerRow.join(' | '),
          codigoError: err.includes('duplicada') ? _DIAGNOSTIC_CODES_AE.COLUMNA_DUPLICADA : _DIAGNOSTIC_CODES_AE.COLUMNA_OBLIGATORIA_FALTANTE,
          descripcion: err
        });
      });
      return report.toObject();
    }

    const mapping = headerRes.mapping;
    const seenRelationKeys = new Set();
    const articlePackagingGroups = new Map(); // codArticulo -> Array<{ codEnvase, descEnvase, activo }>

    dataRows.forEach((row, idx) => {
      const filaNum = idx + 2;

      const getVal = (logicalField) => {
        const m = mapping[logicalField];
        if (!m || m.colIndex >= row.length) return '';
        return String(row[m.colIndex] || '').trim();
      };

      const rawCodArt = getVal('codigo_articulo');
      const rawNomArt = getVal('nombre_articulo');
      const rawCodEnv = getVal('codigo_envase');
      const rawNomEnv = getVal('nombre_envase');
      const rawPred = getVal('es_predeterminado');
      const rawActivo = getVal('activo');

      let rowHasFatalError = false;

      // Validación obligatoria de claves
      if (!rawCodArt) {
        report.addError({
          fila: filaNum,
          campo: 'codigo_articulo',
          valor: rawCodArt,
          codigoError: _DIAGNOSTIC_CODES_AE.ARTICULO_CODIGO_VACIO,
          descripcion: `Fila ${filaNum}: El código de artículo no puede estar vacío.`
        });
        rowHasFatalError = true;
      }

      if (!rawCodEnv) {
        report.addError({
          fila: filaNum,
          campo: 'codigo_envase',
          valor: rawCodEnv,
          codigoError: _DIAGNOSTIC_CODES_AE.ENVASE_CODIGO_VACIO,
          descripcion: `Fila ${filaNum}: El código de envase no puede estar vacío.`
        });
        rowHasFatalError = true;
      }

      if (rawCodArt && rawCodEnv) {
        const relationKey = `${rawCodArt}|${rawCodEnv}`;
        if (seenRelationKeys.has(relationKey)) {
          report.addError({
            fila: filaNum,
            campo: 'relation_key',
            valor: relationKey,
            codigoError: _DIAGNOSTIC_CODES_AE.RELACION_DUPLICADA,
            descripcion: `Fila ${filaNum}: Relación duplicada '${relationKey}' detectada en el archivo.`
          });
          rowHasFatalError = true;
        } else {
          seenRelationKeys.add(relationKey);
        }

        // Integridad referencial con Catálogo de Artículos
        if (this.maestroArticulos.size > 0) {
          if (!this.maestroArticulos.has(rawCodArt)) {
            report.addError({
              fila: filaNum,
              campo: 'codigo_articulo',
              valor: rawCodArt,
              codigoError: _DIAGNOSTIC_CODES_AE.ARTICULO_NO_EXISTE,
              descripcion: `Fila ${filaNum}: El artículo '${rawCodArt}' (${rawNomArt}) no existe en MAESTRO.`
            });
            rowHasFatalError = true;
          } else {
            const artInfo = this.maestroArticulos.get(rawCodArt);
            if (artInfo.activo === false) {
              report.addError({
                fila: filaNum,
                campo: 'codigo_articulo',
                valor: rawCodArt,
                codigoError: _DIAGNOSTIC_CODES_AE.ARTICULO_INACTIVO,
                descripcion: `Fila ${filaNum}: El artículo '${rawCodArt}' está inactivo en MAESTRO.`
              });
              rowHasFatalError = true;
            }
          }
        }

        // Integridad referencial con Catálogo de Envases
        if (this.maestroEnvasesValidados.size > 0) {
          if (!this.maestroEnvasesValidados.has(rawCodEnv)) {
            report.addError({
              fila: filaNum,
              campo: 'codigo_envase',
              valor: rawCodEnv,
              codigoError: _DIAGNOSTIC_CODES_AE.ENVASE_NO_EXISTE,
              descripcion: `Fila ${filaNum}: El envase '${rawCodEnv}' (${rawNomEnv}) no existe en MAESTRO_ENVASES.`
            });
            rowHasFatalError = true;
          } else {
            const envInfo = this.maestroEnvasesValidados.get(rawCodEnv);
            if (envInfo.activo === false) {
              report.addError({
                fila: filaNum,
                campo: 'codigo_envase',
                valor: rawCodEnv,
                codigoError: _DIAGNOSTIC_CODES_AE.ENVASE_INACTIVO,
                descripcion: `Fila ${filaNum}: El envase '${rawCodEnv}' está inactivo en MAESTRO_ENVASES.`
              });
              rowHasFatalError = true;
            }
          }
        }
      }

      let activo = true;
      if (rawActivo !== '') {
        const aLower = rawActivo.toLowerCase();
        activo = !(aLower === 'false' || aLower === '0' || aLower === 'no' || aLower === 'baja');
      }

      let esPredeterminado = false;
      if (rawPred !== '') {
        const pLower = rawPred.toLowerCase();
        esPredeterminado = (pLower === 'true' || pLower === '1' || pLower === 'si' || pLower === 'sí');
      }

      if (!rowHasFatalError) {
        report.addNormalizedRecord({
          relation_key: `${rawCodArt}|${rawCodEnv}`,
          codigo_articulo: rawCodArt,
          nombre_articulo: rawNomArt,
          codigo_envase: rawCodEnv,
          descripcion_envase: rawNomEnv,
          es_predeterminado: esPredeterminado,
          activo
        });

        if (activo) {
          if (!articlePackagingGroups.has(rawCodArt)) {
            articlePackagingGroups.set(rawCodArt, []);
          }
          articlePackagingGroups.get(rawCodArt).push({
            codigo_envase: rawCodEnv,
            descripcion_envase: rawNomEnv,
            es_predeterminado: esPredeterminado
          });
        }
      }
    });

    // 4. Cálculo de Cardinalidad
    const cardinalityReport = {};
    for (const [artCode, envList] of articlePackagingGroups.entries()) {
      const count = envList.length;
      let clasificacion = 'SIN_ENVASE_CONFIGURADO';
      if (count === 1) {
        clasificacion = 'DETERMINISTA';
      } else if (count >= 2) {
        clasificacion = 'MULTIFORMATO';
      }

      cardinalityReport[artCode] = {
        codigoArticulo: artCode,
        envasesActivos: count,
        clasificacion,
        envases: envList
      };
    }

    report.setCardinality(cardinalityReport);

    return report.toObject();
  }

  _indexArticulos(listOrMap) {
    const map = new Map();
    if (listOrMap instanceof Map) return listOrMap;
    if (Array.isArray(listOrMap)) {
      listOrMap.forEach(item => {
        const code = String(item.codigo_articulo || item.Código || item.codigo || '').trim();
        if (code) {
          map.set(code, {
            codigo_articulo: code,
            nombre_articulo: item.nombre_articulo || item.Nombre || '',
            activo: item.activo !== undefined ? item.activo : true
          });
        }
      });
    }
    return map;
  }

  _indexEnvases(listOrMap) {
    const map = new Map();
    if (listOrMap instanceof Map) return listOrMap;
    if (Array.isArray(listOrMap)) {
      listOrMap.forEach(item => {
        const code = String(item.codigo_envase || item.Código || item.codigo || '').trim();
        if (code) {
          map.set(code, {
            codigo_envase: code,
            descripcion_envase: item.descripcion_envase || item.Nombre || '',
            activo: item.activo !== undefined ? item.activo : true
          });
        }
      });
    }
    return map;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ArticuloEnvaseValidator
  };
}
