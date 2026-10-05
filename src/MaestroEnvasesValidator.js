/**
 * STOCK-LIGHT — MaestroEnvasesValidator.js
 * 
 * Validador en memoria para la ingesta del Maestro Oficial de Envases y Taras de Hispatec.
 * Opera 100% aislado: CERO escrituras en base de datos.
 */

if (typeof require !== 'undefined') {
  global.ImportSchema = global.ImportSchema || require('./ImportSchema');
  global.ImportDiagnostics = global.ImportDiagnostics || require('./ImportDiagnostics');
}

const _resolveHeaderMapping = (typeof resolveHeaderMapping !== 'undefined')
  ? resolveHeaderMapping
  : (typeof ImportSchema !== 'undefined' ? ImportSchema.resolveHeaderMapping : require('./ImportSchema').resolveHeaderMapping);

const _parseCSV = (typeof parseCSV !== 'undefined')
  ? parseCSV
  : (typeof ImportSchema !== 'undefined' ? ImportSchema.parseCSV : require('./ImportSchema').parseCSV);

const _ENVASES_HEADER_SYNONYMS = (typeof ENVASES_HEADER_SYNONYMS !== 'undefined')
  ? ENVASES_HEADER_SYNONYMS
  : (typeof ImportSchema !== 'undefined' ? ImportSchema.ENVASES_HEADER_SYNONYMS : require('./ImportSchema').ENVASES_HEADER_SYNONYMS);

const _ENVASES_SCHEMA_SPEC = (typeof ENVASES_SCHEMA_SPEC !== 'undefined')
  ? ENVASES_SCHEMA_SPEC
  : (typeof ImportSchema !== 'undefined' ? ImportSchema.ENVASES_SCHEMA_SPEC : require('./ImportSchema').ENVASES_SCHEMA_SPEC);

const _DIAGNOSTIC_CODES = (typeof DIAGNOSTIC_CODES !== 'undefined')
  ? DIAGNOSTIC_CODES
  : (typeof ImportDiagnostics !== 'undefined' ? ImportDiagnostics.DIAGNOSTIC_CODES : require('./ImportDiagnostics').DIAGNOSTIC_CODES);

const _DiagnosticReport = (typeof DiagnosticReport !== 'undefined')
  ? DiagnosticReport
  : (typeof ImportDiagnostics !== 'undefined' ? ImportDiagnostics.DiagnosticReport : require('./ImportDiagnostics').DiagnosticReport);


const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class MaestroEnvasesValidator {
  /**
   * @param {Object} [options]
   * @param {Array<string>} [options.knownSha256List] Lista de hashes SHA-256 ya procesados
   * @param {Object|Map} [options.historicalTaras] Mapa de referencia histórica (nombre -> tara)
   * @param {Array<Object>} [options.maestroBase] Catálogo MAESTRO_BASE de referencia para conciliación
   */
  constructor(options = {}) {
    this.knownSha256List = options.knownSha256List || [];
    this.historicalTaras = options.historicalTaras || null;
    this.maestroBase = options.maestroBase || null;
  }

  /**
   * Valida el contenido sin escribir nada en base de datos.
   * 
   * @param {string|Array<Array<string>>} rawInput Texto CSV o matriz de celdas
   * @param {Object} [fileMeta] { fileName, sha256Hash }
   * @returns {Object} Informe diagnóstico estructurado
   */
  validate(rawInput, fileMeta = {}) {
    const fileName = fileMeta.fileName || 'MAESTRO_ENVASES.csv';
    const sha256Hash = fileMeta.sha256Hash || '';
    const report = new _DiagnosticReport(fileName);

    // 1. Control criptográfico de duplicidad documental
    if (sha256Hash && this.knownSha256List.includes(sha256Hash)) {
      report.addError({
        fila: 0,
        campo: 'sha256_hash',
        valor: sha256Hash,
        codigoError: _DIAGNOSTIC_CODES.ARCHIVO_DUPLICADO_SHA256,
        descripcion: `El archivo con hash SHA-256 '${sha256Hash}' ya ha sido procesado anteriormente.`
      });
      return report.toObject();
    }

    // 2. Extracción de matriz de filas
    let rows = [];
    if (typeof rawInput === 'string') {
      rows = _parseCSV(rawInput);
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

    // 3. Resolución de encabezados
    const headerRes = _resolveHeaderMapping(headerRow, _ENVASES_HEADER_SYNONYMS, _ENVASES_SCHEMA_SPEC);
    if (!headerRes.ok) {
      headerRes.errors.forEach(err => {
        report.addError({
          fila: 1,
          campo: 'cabecera',
          valor: headerRow.join(' | '),
          codigoError: err.includes('duplicada') ? _DIAGNOSTIC_CODES.COLUMNA_DUPLICADA : _DIAGNOSTIC_CODES.COLUMNA_OBLIGATORIA_FALTANTE,
          descripcion: err
        });
      });
      return report.toObject();
    }

    const mapping = headerRes.mapping;

    // 4. Validación fila a fila
    const seenCodes = new Map(); // codigo -> { fila, descripcion }

    dataRows.forEach((row, idx) => {
      const filaNum = idx + 2; // Fila 1 es cabecera (1-indexed)

      const getVal = (logicalField) => {
        const m = mapping[logicalField];
        if (!m || m.colIndex >= row.length) return '';
        return String(row[m.colIndex] || '').trim();
      };

      const rawCodigo = getVal('codigo_envase');
      const rawDescripcion = getVal('descripcion_envase');
      const rawAlias = getVal('alias');
      const rawCodFam = getVal('codigo_familia');
      const rawFam = getVal('familia');
      const rawTara = getVal('tara_kg');
      const rawActivo = getVal('activo');
      const rawPool = getVal('es_retornable_pool');

      let rowHasFatalError = false;

      // A. Validación Código
      if (!rawCodigo) {
        report.addError({
          fila: filaNum,
          campo: 'codigo_envase',
          valor: rawCodigo,
          codigoError: _DIAGNOSTIC_CODES.ENVASE_CODIGO_VACIO,
          descripcion: `Fila ${filaNum}: El código de envase es obligatorio y no puede estar vacío.`
        });
        rowHasFatalError = true;
      } else {
        // Alarma de seguridad: Detectar UUID de base de datos ajena
        if (UUID_REGEX.test(rawCodigo)) {
          report.addError({
            fila: filaNum,
            campo: 'codigo_envase',
            valor: rawCodigo,
            codigoError: _DIAGNOSTIC_CODES.ENVASE_CODIGO_UUID,
            descripcion: `Fila ${filaNum}: El código '${rawCodigo}' tiene formato UUID de un SaaS ajeno y no es un código oficial de Hispatec.`
          });
          rowHasFatalError = true;
        }

        // Control de duplicados en el lote
        if (seenCodes.has(rawCodigo)) {
          const prev = seenCodes.get(rawCodigo);
          report.addError({
            fila: filaNum,
            campo: 'codigo_envase',
            valor: rawCodigo,
            codigoError: _DIAGNOSTIC_CODES.ENVASE_CODIGO_DUPLICADO,
            descripcion: `Fila ${filaNum}: Código de envase duplicado '${rawCodigo}' (ya visto en fila ${prev.fila}).`
          });
          if (prev.descripcion !== rawDescripcion) {
            report.addError({
              fila: filaNum,
              campo: 'descripcion_envase',
              valor: rawDescripcion,
              codigoError: _DIAGNOSTIC_CODES.ENVASE_DESCRIPCION_INCONSISTENTE,
              descripcion: `Fila ${filaNum}: Descripción '${rawDescripcion}' inconsistente con la fila ${prev.fila} ('${prev.descripcion}') para el código '${rawCodigo}'.`
            });
          }
          rowHasFatalError = true;
        } else {
          seenCodes.set(rawCodigo, { fila: filaNum, descripcion: rawDescripcion });
        }
      }

      // B. Validación Descripción
      if (!rawDescripcion) {
        report.addError({
          fila: filaNum,
          campo: 'descripcion_envase',
          valor: rawDescripcion,
          codigoError: _DIAGNOSTIC_CODES.ENVASE_DESCRIPCION_VACIA,
          descripcion: `Fila ${filaNum}: La descripción del envase es obligatoria.`
        });
        rowHasFatalError = true;
      } else if (rawDescripcion.length < 3) {
        report.addError({
          fila: filaNum,
          campo: 'descripcion_envase',
          valor: rawDescripcion,
          codigoError: _DIAGNOSTIC_CODES.ENVASE_DESCRIPCION_CORTA,
          descripcion: `Fila ${filaNum}: La descripción '${rawDescripcion}' es demasiado corta (mínimo 3 caracteres).`
        });
        rowHasFatalError = true;
      }

      // C. Validación Familia
      if (!rawCodFam || !rawFam) {
        report.addError({
          fila: filaNum,
          campo: 'familia',
          valor: `${rawCodFam} - ${rawFam}`,
          codigoError: _DIAGNOSTIC_CODES.ENVASE_FAMILIA_VACIA,
          descripcion: `Fila ${filaNum}: Código y nombre de familia son obligatorios.`
        });
        rowHasFatalError = true;
      }

      // D. Validación y tipificación de Tara
      let parsedTara = null;
      let estadoTara = 'NO_INFORMADA';

      if (rawTara === '' || rawTara === null || rawTara === undefined) {
        report.addWarning({
          fila: filaNum,
          campo: 'tara_kg',
          valor: rawTara,
          codigoWarning: _DIAGNOSTIC_CODES.TARA_NO_INFORMADA,
          descripcion: `Fila ${filaNum}: Envase '${rawCodigo}' sin tara informada en el archivo oficial.`
        });
        estadoTara = 'NO_INFORMADA';
        parsedTara = null;
      } else {
        const normTaraStr = rawTara.replace(',', '.');
        const numTara = parseFloat(normTaraStr);

        if (isNaN(numTara)) {
          report.addError({
            fila: filaNum,
            campo: 'tara_kg',
            valor: rawTara,
            codigoError: 'TARA_NO_NUMERICA',
            descripcion: `Fila ${filaNum}: La tara '${rawTara}' no es un número decimal válido.`
          });
          rowHasFatalError = true;
        } else if (numTara < 0) {
          report.addError({
            fila: filaNum,
            campo: 'tara_kg',
            valor: rawTara,
            codigoError: _DIAGNOSTIC_CODES.TARA_NEGATIVA,
            descripcion: `Fila ${filaNum}: La tara no puede ser negativa (${numTara} kg).`
          });
          rowHasFatalError = true;
        } else if (numTara === 0) {
          report.addWarning({
            fila: filaNum,
            campo: 'tara_kg',
            valor: rawTara,
            codigoWarning: _DIAGNOSTIC_CODES.TARA_CERO_REQUIERE_REVISION,
            descripcion: `Fila ${filaNum}: Tara 0.000 kg detectada para '${rawCodigo}'. Requiere confirmación física de pesaje.`
          });
          parsedTara = 0.000;
          estadoTara = 'OFICIAL_CERO';
        } else {
          parsedTara = parseFloat(numTara.toFixed(3));
          estadoTara = 'OFICIAL';
        }
      }

      // E. Comparación con referencia histórica (control del archivo antiguo)
      if (this.historicalTaras && parsedTara !== null && parsedTara > 0) {
        const histTaraVal = this._findHistoricalTara(rawCodigo, rawDescripcion, rawAlias);
        if (histTaraVal !== null && histTaraVal > 0) {
          const discrepancy = Math.abs(parsedTara - histTaraVal) / histTaraVal;
          if (discrepancy > 0.10) {
            report.addWarning({
              fila: filaNum,
              campo: 'tara_kg',
              valor: `${parsedTara} vs hist ${histTaraVal}`,
              codigoWarning: _DIAGNOSTIC_CODES.WARNING_HISTORICO_TARA,
              descripcion: `Fila ${filaNum}: Discrepancia del ${(discrepancy * 100).toFixed(1)}% entre tara oficial (${parsedTara} kg) e histórica (${histTaraVal} kg).`
            });
          }
        }
      }

      // F. Deducción de Grupo Visual y Retornable
      let grupoVisual = 'VARIOS';
      const uFam = rawFam.toUpperCase();
      const uDesc = rawDescripcion.toUpperCase();
      if (uFam.includes('EPS') || uDesc.includes('EPS')) grupoVisual = 'EPS';
      else if (uFam.includes('CARTON') || uFam.includes('CARTÓN') || uDesc.includes('CARTON')) grupoVisual = 'CARTON';
      else if (uFam.includes('IFCO') || uDesc.includes('IFCO')) grupoVisual = 'IFCO';
      else if (uFam.includes('MADERA') || uDesc.includes('MADERA')) grupoVisual = 'MADERA';

      let esPool = false;
      if (rawPool !== '') {
        const pLower = rawPool.toLowerCase();
        esPool = (pLower === 'true' || pLower === '1' || pLower === 'si' || pLower === 'sí');
      } else {
        esPool = (rawCodFam === '97' || rawCodFam === '98' || uFam.includes('POOL') || uFam.includes('IFCO') || rawCodigo.endsWith('CA'));
      }

      let activo = true;
      if (rawActivo !== '') {
        const aLower = rawActivo.toLowerCase();
        activo = !(aLower === 'false' || aLower === '0' || aLower === 'no' || aLower === 'baja');
      }

      if (!rowHasFatalError) {
        report.addNormalizedRecord({
          codigo_envase: rawCodigo,
          descripcion_envase: rawDescripcion,
          alias: rawAlias,
          codigo_familia: rawCodFam,
          nombre_familia: rawFam,
          grupo_visual: grupoVisual,
          tara_kg: parsedTara,
          estado_tara: estadoTara,
          es_retornable_pool: esPool,
          activo
        });
      }
    });

    // 5. Conciliación contra catálogo MAESTRO_BASE de referencia (si se ha provisto)
    if (this.maestroBase && Array.isArray(this.maestroBase)) {
      const reconcil = this.reconcileAgainstBase(report.registrosNormalizados, this.maestroBase);
      report.setReconciliation(reconcil);
    }

    return report.toObject();
  }

  /**
   * Cruza los registros normalizados contra el catálogo MAESTRO_BASE existente.
   * NO modifica MAESTRO_BASE.json. Solo genera diagnóstico estructurado.
   * 
   * @param {Array<Object>} normalizedRecords
   * @param {Array<Object>} maestroBase
   * @returns {Object} Informe de conciliación
   */
  reconcileAgainstBase(normalizedRecords, maestroBase) {
    const baseMap = new Map(); // codigo_envase -> Array<{ desc, artCode, artName }>
    maestroBase.forEach(item => {
      const code = String(item.codigo_envase || '').trim();
      const desc = String(item.descripcion_envase || '').trim();
      if (!baseMap.has(code)) {
        baseMap.set(code, []);
      }
      baseMap.get(code).push({
        desc,
        artCode: item.codigo_articulo,
        artName: item.nombre_articulo
      });
    });

    const items = [];
    const matchedBaseCodes = new Set();

    normalizedRecords.forEach(norm => {
      const code = norm.codigo_envase;
      const desc = norm.descripcion_envase;

      if (baseMap.has(code)) {
        matchedBaseCodes.add(code);
        const baseEntries = baseMap.get(code);
        const exactDescMatch = baseEntries.some(e => e.desc.toUpperCase() === desc.toUpperCase());

        if (exactDescMatch) {
          items.push({
            codigo: code,
            descripcion: desc,
            estadoConciliacion: 'COINCIDENTE',
            detalle: `Coincide en código y descripción con ${baseEntries.length} entradas en MAESTRO_BASE.`
          });
        } else {
          items.push({
            codigo: code,
            descripcion: desc,
            descripcionBase: baseEntries[0].desc,
            estadoConciliacion: 'DESCRIPCION_CAMBIADA',
            detalle: `Mismo código en MAESTRO_BASE pero descripción previa era '${baseEntries[0].desc}'.`
          });
        }
      } else {
        // Verificar si la descripción existe bajo otro código en base
        let altCodeMatch = null;
        for (const [bCode, bEntries] of baseMap.entries()) {
          if (bEntries.some(e => e.desc.toUpperCase() === desc.toUpperCase())) {
            altCodeMatch = bCode;
            break;
          }
        }

        if (altCodeMatch) {
          items.push({
            codigo: code,
            descripcion: desc,
            codigoBaseAnterior: altCodeMatch,
            estadoConciliacion: 'CODIGO_CAMBIADO',
            detalle: `Misma descripción registrada bajo el código previo '${altCodeMatch}' (diferencia de serie).`
          });
        } else {
          items.push({
            codigo: code,
            descripcion: desc,
            estadoConciliacion: 'NUEVO',
            detalle: 'Envase oficial no presente en la configuración previa.'
          });
        }
      }
    });

    // Detectar envases en base que no constan en la exportación oficial
    for (const [bCode, bEntries] of baseMap.entries()) {
      if (!matchedBaseCodes.has(bCode)) {
        items.push({
          codigo: bCode,
          descripcion: bEntries[0].desc,
          estadoConciliacion: 'HUERFANO',
          detalle: `Presente en MAESTRO_BASE pero no recibido en la exportación oficial de Hispatec.`
        });
      }
    }

    const counts = {
      COINCIDENTE: items.filter(i => i.estadoConciliacion === 'COINCIDENTE').length,
      NUEVO: items.filter(i => i.estadoConciliacion === 'NUEVO').length,
      DESCRIPCION_CAMBIADA: items.filter(i => i.estadoConciliacion === 'DESCRIPCION_CAMBIADA').length,
      CODIGO_CAMBIADO: items.filter(i => i.estadoConciliacion === 'CODIGO_CAMBIADO').length,
      HUERFANO: items.filter(i => i.estadoConciliacion === 'HUERFANO').length
    };

    return {
      totalItems: items.length,
      resumen: counts,
      items
    };
  }

  _findHistoricalTara(codigo, descripcion, alias) {
    if (!this.historicalTaras) return null;
    const norm = (str) => String(str || '').trim().toUpperCase().replace(/[,\.]/g, '');
    const nDesc = norm(descripcion);
    const nAlias = norm(alias);
    const nCode = norm(codigo);

    if (this.historicalTaras[nCode] !== undefined) return this.historicalTaras[nCode];
    if (this.historicalTaras[nDesc] !== undefined) return this.historicalTaras[nDesc];
    if (nAlias && this.historicalTaras[nAlias] !== undefined) return this.historicalTaras[nAlias];
    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MaestroEnvasesValidator
  };
}
