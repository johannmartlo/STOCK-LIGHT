/**
 * STOCK-LIGHT — DocumentValidator.js
 * 
 * Validador de Integridad y Reglas de Negocio para Documentos Normalizados.
 * Evalúa documentos antes de permitir su paso a la bandeja de confirmación de movimientos.
 */

// Importación condicional para entorno Node.js / Testing (aislada sin 'var' para evitar colisiones en Apps Script V8)
if (typeof require !== 'undefined') {
  global.checkDocumentDuplicate = global.checkDocumentDuplicate || require('./DeduplicationService').checkDocumentDuplicate;
}

class DocumentValidator {
  /**
   * @param {Object} options
   * @param {Object} [options.deduplicationService]
   * @param {Object} [options.maestroResolver]
   */
  constructor(options = {}) {
    this.dedup = options.deduplicationService || (typeof checkDocumentDuplicate !== 'undefined' ? {
      checkDocumentDuplicate
    } : null);
    this.resolver = options.maestroResolver || null;
  }

  /**
   * Valida exhaustivamente un NormalizedDocument.
   * 
   * @param {Object} normDoc - NormalizedDocument
   * @param {Array<Object>} [existingDocuments] - Documentos históricos en persistencia
   * @returns {Object} Resultado de validación:
   *   - isValid: boolean
   *   - status: 'VALIDO' | 'DUPLICADO' | 'PENDIENTE_REVISION'
   *   - errors: Array<string>
   *   - warnings: Array<string>
   *   - deduplicationReport: Object | null
   *   - validatedLines: Array<Object>
   */
  validate(normDoc, existingDocuments = []) {
    const errors = [];
    const warnings = [];

    if (!normDoc) {
      return {
        isValid: false,
        status: 'PENDIENTE_REVISION',
        errors: ['Documento nulo o vacío'],
        warnings: [],
        deduplicationReport: null,
        validatedLines: []
      };
    }

    // 1. Validación de Cabecera Crítica
    if (!normDoc.documentType || !['COMPRA', 'RECEPCION', 'SALIDA'].includes(normDoc.documentType)) {
      errors.push(`Tipo de documento inválido o ausente: '${normDoc.documentType}'`);
    }

    if (!normDoc.series || String(normDoc.series).trim() === '') {
      errors.push('Serie de documento ausente');
    }

    if (!normDoc.number || String(normDoc.number).trim() === '') {
      errors.push('Número de documento ausente');
    }

    if (!normDoc.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(normDoc.date).trim())) {
      errors.push(`Fecha de documento ausente o formato no ISO (YYYY-MM-DD): '${normDoc.date}'`);
    }

    // 2. Comprobación de Deduplicación
    let dedupReport = null;
    if (this.dedup && existingDocuments && existingDocuments.length > 0) {
      dedupReport = this.dedup.checkDocumentDuplicate({
        sha256_hash: normDoc.sha256Hash,
        tipo_documento: normDoc.documentType,
        serie: normDoc.series,
        numero: normDoc.number,
        fecha_documento: normDoc.date
      }, existingDocuments);

      if (dedupReport.isDuplicate) {
        errors.push(`Documento duplicado: ${dedupReport.reason}`);
        return {
          isValid: false,
          status: 'DUPLICADO',
          errors,
          warnings,
          deduplicationReport: dedupReport,
          validatedLines: []
        };
      }
    }

    // 3. Validación de Líneas
    if (!normDoc.lines || !Array.isArray(normDoc.lines) || normDoc.lines.length === 0) {
      errors.push('El documento no contiene ninguna línea de stock.');
      return {
        isValid: false,
        status: 'PENDIENTE_REVISION',
        errors,
        warnings,
        deduplicationReport: dedupReport,
        validatedLines: []
      };
    }

    const validatedLines = [];
    let totalCajas = 0;

    for (let i = 0; i < normDoc.lines.length; i++) {
      const line = normDoc.lines[i];
      const lineIdx = line.lineIndex || (i + 1);
      const lineErrors = [];

      // A. Cajas (CRÍTICO: Número entero > 0)
      const boxes = Number(line.boxes);
      if (line.boxes === null || line.boxes === undefined || isNaN(boxes)) {
        lineErrors.push(`Línea ${lineIdx}: Cajas ausentes o no numéricas ('${line.boxes}')`);
      } else if (!Number.isInteger(boxes) || boxes <= 0) {
        lineErrors.push(`Línea ${lineIdx}: Cantidad de cajas ambigua o inválida (${boxes}). Debe ser entero > 0`);
      } else {
        totalCajas += boxes;
      }

      // B. Resolución de Artículo
      let artCode = line.articleCode;
      let artName = line.articleName;
      if (this.resolver) {
        const artRes = this.resolver.resolveArticle(line.articleCode, line.articleName);
        if (artRes.resolved) {
          artCode = artRes.code;
          artName = artRes.name;
        } else {
          lineErrors.push(`Línea ${lineIdx}: Artículo no identificable inequívocamente ('${line.articleCode}' / '${line.articleName}')`);
        }
      } else {
        if (!artCode || String(artCode).trim() === '') {
          lineErrors.push(`Línea ${lineIdx}: Código de artículo ausente`);
        }
      }

      // C. Resolución de Envase
      let envCode = line.envaseCode;
      let envName = line.envaseName;
      let lineIncidencia = null;
      let allowedOptions = [];

      if (normDoc.documentType === 'COMPRA') {
        if (envCode && envCode !== 'DEFAULT' && envCode !== 'ENVASE_NO_DETERMINABLE_DESDE_PDF') {
          // Si ya viene un envase explícito (por ejemplo, resolución previa del operador)
          if (this.resolver) {
            if (this.resolver.isEnvasePermitidoParaArticulo(artCode, envCode)) {
              const envRes = this.resolver.resolveEnvase(envCode, envName);
              if (envRes.resolved) {
                envCode = envRes.code;
                envName = envRes.name;
              }
            } else {
              lineErrors.push(`Línea ${lineIdx}: El envase '${envCode}' no está permitido para el artículo '${artCode}' en MAESTRO.`);
              lineIncidencia = 'ENVASE_NO_PERMITIDO';
              allowedOptions = this.resolver.getEnvasesPermitidos(artCode);
            }
          }
        } else {
          // El PDF de compra no aporta envase: resolver mediante reglas deterministas homologadas
          if (this.resolver) {
            const compRes = this.resolver.resolveEnvaseCompra(artCode, artName, line.unit);
            if (compRes.resolved) {
              envCode = compRes.code;
              envName = compRes.name;
            } else {
              envCode = null;
              envName = null;
              lineIncidencia = 'ENVASE_NO_DETERMINABLE_DESDE_PDF';
              allowedOptions = this.resolver.getEnvasesPermitidos(artCode);
              lineErrors.push(`Línea ${lineIdx}: Envase no determinable desde PDF de compra para '${artName || line.articleName}'. Requiere revisión humana.`);
            }
          } else {
            envCode = null;
            lineIncidencia = 'ENVASE_NO_DETERMINABLE_DESDE_PDF';
            lineErrors.push(`Línea ${lineIdx}: Código de envase ausente en albarán de compra.`);
          }
        }
      } else {
        // Para SALIDA y otros tipos con envase explícito en documento
        if (this.resolver) {
          const envRes = this.resolver.resolveEnvase(line.envaseCode, line.envaseName);
          if (envRes.resolved && envRes.code !== 'DEFAULT') {
            envCode = envRes.code;
            envName = envRes.name;
          } else {
            lineErrors.push(`Línea ${lineIdx}: Envase no identificable inequívocamente ('${line.envaseCode}' / '${line.envaseName}')`);
          }
        } else {
          if (!envCode || String(envCode).trim() === '' || envCode === 'DEFAULT' || envCode === 'ENVASE_NO_DETERMINABLE_DESDE_PDF') {
            lineErrors.push(`Línea ${lineIdx}: Código de envase ausente o inválido`);
          }
        }
      }

      // D. Validación de par en Maestro (advertencia si no existe la pareja específica)
      if (this.resolver && artCode && envCode && envCode !== 'DEFAULT') {
        if (!this.resolver.isValidStockPair(artCode, envCode)) {
          warnings.push(`Línea ${lineIdx}: La combinación ${artCode}|${envCode} no figura actualmente en catálogo MAESTRO activo.`);
        }
      }

      if (lineErrors.length > 0) {
        errors.push(...lineErrors);
      }

      validatedLines.push({
        ...line,
        lineIndex: lineIdx,
        articleCode: artCode,
        articleName: artName,
        envaseCode: envCode,
        envaseName: envName,
        boxes: isNaN(boxes) ? null : boxes,
        unit: line.unit || '',
        isValid: lineErrors.length === 0,
        incidencia: lineIncidencia,
        opcionesPermitidas: allowedOptions,
        errors: lineErrors
      });
    }

    // 4. Validación de Consistencia de Bultos / Cajas con Pie de Documento
    if (normDoc.rawMetadata && typeof normDoc.rawMetadata.cuadraConPie === 'boolean') {
      if (!normDoc.rawMetadata.cuadraConPie) {
        errors.push(
          `Descuadre de bultos: La suma calculada de cajas de las líneas (${totalCajas}) ` +
          `no coincide con el total de bultos declarado en el pie del documento (${normDoc.rawMetadata.totalBultosPie}).`
        );
      }
    }

    const isValid = errors.length === 0;
    const status = isValid ? 'VALIDO' : 'PENDIENTE_REVISION';

    return {
      isValid,
      status,
      errors,
      warnings,
      deduplicationReport: dedupReport,
      totalCajasCalculadas: totalCajas,
      validatedLines
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DocumentValidator
  };
}
