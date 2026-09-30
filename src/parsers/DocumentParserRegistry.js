/**
 * STOCK-LIGHT — DocumentParserRegistry.js (Calibrado Fase 2.1)
 * 
 * Registro y Orquestador de Parsers de Documentos Oficiales.
 * 
 * CAMBIO DE ALCANCE MVP (Fase 2.1):
 * - Flujo activo exclusivo:
 *   1. ALBARÁN DE COMPRA (Entrada)
 *   2. ALBARÁN DE SALIDA (Salida)
 * - RECEPCIÓN DE MERCANCÍA queda aislada y fuera del flujo activo del MVP.
 */

// Importaciones condicionales para entorno Node.js / Testing (aisladas sin 'var' para evitar colisiones en Apps Script V8)
if (typeof require !== 'undefined') {
  global.CompraParser = global.CompraParser || require('./CompraParser').CompraParser;
  global.SalidaParser = global.SalidaParser || require('./SalidaParser').SalidaParser;
  global.DocumentValidator = global.DocumentValidator || require('../DocumentValidator').DocumentValidator;
  global.MaestroResolver = global.MaestroResolver || require('../MaestroResolver').MaestroResolver;
}

class DocumentParserRegistry {
  /**
   * @param {Object} [options]
   * @param {Array<Object>} [options.parsers]
   * @param {DocumentValidator} [options.validator]
   * @param {MaestroResolver} [options.maestroResolver]
   * @param {boolean} [options.enableRecepcion=false] - Deshabilitado por defecto en MVP
   */
  constructor(options = {}) {
    // En el MVP activo solo operan CompraParser y SalidaParser
    this.parsers = options.parsers || [
      new CompraParser(),
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
      throw new Error('No se reconoció el tipo de documento Hispatec dentro del MVP activo (solo se admiten Albaranes de Compra y Albaranes de Salida).');
    }
    return parser.parse(rawText, fileMeta);
  }

  /**
   * Prepara la revisión del documento SIN modificar inventario ni persistir movimientos.
   * 
   * @param {string|Object} rawTextOrNormDoc 
   * @param {Object} [options]
   * @param {Object} [options.fileMeta]
   * @param {Array<Object>} [options.existingDocuments]
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
