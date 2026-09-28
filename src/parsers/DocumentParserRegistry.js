/**
 * STOCK-LIGHT — DocumentParserRegistry.js
 * 
 * Orquestador de Detección, Parseo, Normalización y Revisión de Documentos.
 * Cumple con la regla de SEPARACIÓN ESTRICTA:
 * PDF RAW → PARSER → NORMALIZER → VALIDATOR → REVIEW → (Acción explícita) → MOVEMENT SERVICE
 */

// Importaciones condicionales para Node.js
if (typeof CompraParser === 'undefined' && typeof require !== 'undefined') {
  var { CompraParser } = require('./CompraParser');
  var { RecepcionParser } = require('./RecepcionParser');
  var { SalidaParser } = require('./SalidaParser');
  var { DocumentValidator } = require('../DocumentValidator');
  var { MaestroResolver } = require('../MaestroResolver');
}

class DocumentParserRegistry {
  /**
   * @param {Object} [options]
   * @param {Array<Object>} [options.parsers]
   * @param {DocumentValidator} [options.validator]
   * @param {MaestroResolver} [options.maestroResolver]
   */
  constructor(options = {}) {
    this.parsers = options.parsers || [
      new CompraParser(),
      new RecepcionParser(),
      new SalidaParser()
    ];
    this.validator = options.validator || new DocumentValidator({
      maestroResolver: options.maestroResolver
    });
  }

  /**
   * Identifica el parser adecuado para el texto de un documento.
   * @param {string} rawText 
   * @returns {Object|null}
   */
  findParser(rawText) {
    for (const parser of this.parsers) {
      if (parser.canParse(rawText)) {
        return parser;
      }
    }
    return null;
  }

  /**
   * Parsea un texto crudo de documento a NormalizedDocument.
   * @param {string} rawText 
   * @param {Object} [fileMeta]
   * @returns {Object} NormalizedDocument
   */
  parseText(rawText, fileMeta = {}) {
    const parser = this.findParser(rawText);
    if (!parser) {
      throw new Error('No se reconoció el tipo de documento Hispatec (no coincide con Compra, Recepción ni Salida).');
    }
    return parser.parse(rawText, fileMeta);
  }

  /**
   * Prepara la revisión del documento SIN modificar inventario ni persistir movimientos.
   * Esta función es puramente analítica y de staging.
   * 
   * @param {string|Object} rawTextOrNormDoc 
   * @param {Object} [options]
   * @param {Object} [options.fileMeta]
   * @param {Array<Object>} [options.existingDocuments] - Para comprobar duplicados
   * @returns {Object} ReviewPayload estructurado para interfaz humana
   */
  reviewDocument(rawTextOrNormDoc, options = {}) {
    let normDoc;
    if (typeof rawTextOrNormDoc === 'string') {
      normDoc = this.parseText(rawTextOrNormDoc, options.fileMeta || {});
    } else {
      normDoc = rawTextOrNormDoc;
    }

    const validation = this.validator.validate(normDoc, options.existingDocuments || []);

    return {
      documentoDetectado: normDoc.documentType,
      serieNumero: `${normDoc.series}/${normDoc.number}`,
      serie: normDoc.series,
      numero: normDoc.number,
      fecha: normDoc.date,
      entidad: normDoc.entityName || normDoc.entityCode || 'NO INFORMADO',
      entidadCodigo: normDoc.entityCode,
      archivoOrigen: normDoc.sourceFileName,
      hashSha256: normDoc.sha256Hash,
      totalCajasDetectadas: validation.totalCajasCalculadas,
      lineasDetectadas: validation.validatedLines.map(vl => ({
        linea: vl.lineIndex,
        codigoArticulo: vl.articleCode,
        nombreArticulo: vl.articleName,
        codigoEnvase: vl.envaseCode,
        nombreEnvase: vl.envaseName,
        cajas: vl.boxes,
        partida: vl.lot || '-',
        valida: vl.isValid,
        errores: vl.errors
      })),
      advertencias: validation.warnings,
      errores: validation.errors,
      estadoValidacion: validation.status, // 'VALIDO' | 'DUPLICADO' | 'PENDIENTE_REVISION'
      aptoParaConfirmar: validation.isValid,
      normalizedDocument: normDoc
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DocumentParserRegistry
  };
}
