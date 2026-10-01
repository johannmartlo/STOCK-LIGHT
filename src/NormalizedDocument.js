/**
 * STOCK-LIGHT — NormalizedDocument.js
 * 
 * Contrato canónico de datos intermedios entre los Parsers y el Motor de Inventario.
 * Garantiza que la representación interna de un documento sea homogénea independientemente
 * de la fuente de extracción (PDF, escáner, CSV futuro o API).
 */

/**
 * Crea una instancia de línea normalizada de stock.
 * 
 * @param {Object} params
 * @param {number} params.lineIndex - Posición secuencial 1-based en el documento original
 * @param {string} params.articleCode - Código de artículo oficial en Hispatec
 * @param {string} [params.articleName] - Nombre descriptivo del artículo
 * @param {string} params.envaseCode - Código oficial del envase en Hispatec
 * @param {string} [params.envaseName] - Descripción del envase (ej. EPS 104)
 * @param {number} params.boxes - Número entero positivo de cajas/envases (CRÍTICO: CERO KILOS)
 * @param {string} [params.lot] - Partida informativa de Hispatec si existe
 * @param {string} [params.warehouse] - Almacén informado si existe
 * @param {string} [params.sourceReference] - Fragmento de texto original o ID de línea para auditoría
 * @returns {Object} NormalizedLine
 */
function createNormalizedLine(params = {}) {
  const lineIndex = Number(params.lineIndex) || 1;
  const boxes = Number(params.boxes);
  
  return {
    lineIndex,
    articleCode: String(params.articleCode || '').trim(),
    articleName: String(params.articleName || '').trim(),
    envaseCode: String(params.envaseCode || '').trim(),
    envaseName: String(params.envaseName || '').trim(),
    boxes: isNaN(boxes) ? null : boxes,
    unit: params.unit ? String(params.unit).trim().toUpperCase() : '',
    lot: params.lot ? String(params.lot).trim() : '',
    warehouse: params.warehouse ? String(params.warehouse).trim() : '',
    sourceReference: params.sourceReference ? String(params.sourceReference).trim() : ''
  };
}

/**
 * Crea una instancia de documento normalizado.
 * 
 * @param {Object} params
 * @param {string} params.documentType - 'COMPRA' | 'RECEPCION' | 'SALIDA'
 * @param {string} params.series - Serie del documento Hispatec (ej. ACT26, AVT26)
 * @param {string} params.number - Número correlativo del albarán
 * @param {string} params.date - Fecha en formato YYYY-MM-DD
 * @param {string} [params.entityCode] - Código de proveedor o cliente
 * @param {string} [params.entityName] - Razón social del proveedor o cliente
 * @param {string} [params.sourceFileName] - Nombre del archivo PDF de origen
 * @param {string} [params.sourceFileId] - ID de Drive o identificador de almacenamiento
 * @param {string} [params.sha256Hash] - Hash SHA-256 del binario para deduplicación Nivel 1
 * @param {Array<Object>} [params.lines] - Lista de NormalizedLine
 * @param {Object} [params.rawMetadata] - Metadatos adicionales sin procesar de cabecera
 * @returns {Object} NormalizedDocument
 */
function createNormalizedDocument(params = {}) {
  const lines = Array.isArray(params.lines) ? params.lines : [];
  let calculatedBoxes = 0;
  for (const l of lines) {
    if (typeof l.boxes === 'number' && !isNaN(l.boxes)) {
      calculatedBoxes += l.boxes;
    }
  }

  return {
    documentType: String(params.documentType || '').trim().toUpperCase(),
    series: String(params.series || '').trim(),
    number: String(params.number || '').trim(),
    date: String(params.date || '').trim(),
    entityCode: params.entityCode ? String(params.entityCode).trim() : '',
    entityName: params.entityName ? String(params.entityName).trim() : '',
    sourceFileName: params.sourceFileName ? String(params.sourceFileName).trim() : '',
    sourceFileId: params.sourceFileId ? String(params.sourceFileId).trim() : '',
    sha256Hash: params.sha256Hash ? String(params.sha256Hash).trim().toLowerCase() : '',
    totalBoxes: calculatedBoxes,
    lines,
    rawMetadata: params.rawMetadata || {}
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createNormalizedLine,
    createNormalizedDocument
  };
}
