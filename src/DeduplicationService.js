/**
 * STOCK-LIGHT — DeduplicationService.js
 * 
 * Servicio de Deduplicación Multicapa.
 * Evita la duplicación accidental de documentos físicos, albaranes solapados
 * y líneas repetidas.
 */

/**
 * Normaliza una cadena de texto para comparaciones de clave (elimina espacios superfluos y pasa a mayúsculas).
 * @param {string} str 
 * @returns {string}
 */
function normalizeDocKey(str) {
  return String(str || '').trim().toUpperCase();
}

/**
 * Genera la clave de identidad documental Nivel 2: TIPO + SERIE + NUMERO + FECHA.
 * @param {string} tipoDocumento - COMPRA, RECEPCION, SALIDA
 * @param {string} serie 
 * @param {string} numero 
 * @param {string} fecha - YYYY-MM-DD
 * @returns {string}
 */
function buildDocumentIdentityKey(tipoDocumento, serie, numero, fecha) {
  const t = normalizeDocKey(tipoDocumento);
  const s = normalizeDocKey(serie);
  const n = normalizeDocKey(numero);
  const f = normalizeDocKey(fecha);

  if (!t || !s || !n || !f) {
    throw new Error(`Datos insuficientes para clave de identidad documental: tipo='${tipoDocumento}', serie='${serie}', numero='${numero}', fecha='${fecha}'`);
  }
  return `${t}#${s}#${n}#${f}`;
}

/**
 * Genera la clave de identidad de línea Nivel 3:
 * DOCUMENTO_ID + "|" + INDICE_LINEA + "|" + CODIGO_ARTICULO + "|" + CODIGO_ENVASE + "|" + CAJAS
 * 
 * Protege contra dos líneas idénticas legítimas dentro del mismo documento usando el índice secuencial determinista.
 * 
 * @param {string} documentoId 
 * @param {number} lineIndex - Índice 0-based o 1-based de la línea en el documento original
 * @param {string} codigoArticulo 
 * @param {string} codigoEnvase 
 * @param {number} cajas 
 * @returns {string}
 */
function buildLineIdentityKey(documentoId, lineIndex, codigoArticulo, codigoEnvase, cajas) {
  const docId = normalizeDocKey(documentoId);
  const idx = Number(lineIndex);
  const art = normalizeDocKey(codigoArticulo);
  const env = normalizeDocKey(codigoEnvase);
  const c = Number(cajas);

  if (!docId || isNaN(idx) || !art || !env || isNaN(c)) {
    throw new Error(`Datos insuficientes para clave de línea: docId='${documentoId}', idx='${lineIndex}', art='${codigoArticulo}', env='${codigoEnvase}', cajas='${cajas}'`);
  }
  return `${docId}|L${idx}|${art}|${env}|${c}`;
}

/**
 * Evalúa si un documento candidato a importar es duplicado frente a la base histórica de documentos.
 * 
 * @param {Object} candidateDoc - Documento a verificar:
 *   - sha256_hash: string (opcional)
 *   - tipo_documento: string
 *   - serie: string
 *   - numero: string
 *   - fecha_documento: string
 * @param {Array<Object>} existingDocuments - Documentos históricos registrados
 * @returns {Object} Resultado de la evaluación:
 *   - isDuplicate: boolean
 *   - duplicateLevel: 1 | 2 | null
 *   - matchedDocument: Object | null
 *   - reason: string
 */
function checkDocumentDuplicate(candidateDoc, existingDocuments = []) {
  if (!candidateDoc) throw new Error('candidateDoc no puede ser nulo');

  // NIVEL 1: Comprobación por Hash SHA-256 de archivo (si se proporciona)
  const candidateHash = candidateDoc.sha256_hash ? String(candidateDoc.sha256_hash).trim().toLowerCase() : null;
  if (candidateHash) {
    const matchByHash = existingDocuments.find(d => 
      d.sha256_hash && String(d.sha256_hash).trim().toLowerCase() === candidateHash
    );
    if (matchByHash) {
      return {
        isDuplicate: true,
        duplicateLevel: 1,
        matchedDocument: matchByHash,
        reason: `Duplicado Nivel 1 (Hash SHA-256 coincidente con documento ${matchByHash.id_documento})`
      };
    }
  }

  // NIVEL 2: Comprobación por Identidad Documental Compuesta (Tipo + Serie + Número + Fecha)
  const candidateKey = buildDocumentIdentityKey(
    candidateDoc.tipo_documento,
    candidateDoc.serie,
    candidateDoc.numero,
    candidateDoc.fecha_documento
  );

  const matchByKey = existingDocuments.find(d => {
    try {
      const existingKey = buildDocumentIdentityKey(
        d.tipo_documento,
        d.serie,
        d.numero,
        d.fecha_documento
      );
      return existingKey === candidateKey;
    } catch (e) {
      return false;
    }
  });

  if (matchByKey) {
    return {
      isDuplicate: true,
      duplicateLevel: 2,
      matchedDocument: matchByKey,
      reason: `Duplicado Nivel 2 (Identidad compuesta coincidente con documento ${matchByKey.id_documento}: ${candidateKey})`
    };
  }

  return {
    isDuplicate: false,
    duplicateLevel: null,
    matchedDocument: null,
    reason: 'Documento único (no duplicado)'
  };
}

/**
 * Filtra un lote de documentos candidatos durante una importación (por ejemplo de períodos solapados).
 * Separa los documentos válidos nuevos de aquellos que ya fueron importados previamente.
 * 
 * @param {Array<Object>} candidateBatch - Lista de documentos en el lote a importar
 * @param {Array<Object>} existingDocuments - Base histórica acumulada
 * @returns {Object}
 *   - newDocuments: Array<Object> (documentos nuevos a procesar)
 *   - duplicateDocuments: Array<Object> (documentos descartados con su motivo)
 */
function filterBatchForOverlaps(candidateBatch = [], existingDocuments = []) {
  const newDocuments = [];
  const duplicateDocuments = [];
  const currentBatchRegisteredKeys = new Set();
  const currentBatchHashes = new Set();

  // Construir sets rápidos de documentos existentes
  for (const doc of existingDocuments) {
    if (doc.sha256_hash) currentBatchHashes.add(String(doc.sha256_hash).trim().toLowerCase());
    try {
      const key = buildDocumentIdentityKey(doc.tipo_documento, doc.serie, doc.numero, doc.fecha_documento);
      currentBatchRegisteredKeys.add(key);
    } catch (e) {
      // Ignorar docs incompletos en base histórica
    }
  }

  for (const doc of candidateBatch) {
    const hash = doc.sha256_hash ? String(doc.sha256_hash).trim().toLowerCase() : null;
    let isDupe = false;
    let reason = '';

    if (hash && currentBatchHashes.has(hash)) {
      isDupe = true;
      reason = 'Hash SHA-256 ya registrado en el sistema o en el lote actual';
    } else {
      const key = buildDocumentIdentityKey(doc.tipo_documento, doc.serie, doc.numero, doc.fecha_documento);
      if (currentBatchRegisteredKeys.has(key)) {
        isDupe = true;
        reason = `Identidad documental ${key} ya registrada previamente`;
      } else {
        // Registrar temporalmente en el conjunto del lote para evitar duplicados internos en el mismo envío
        if (hash) currentBatchHashes.add(hash);
        currentBatchRegisteredKeys.add(key);
      }
    }

    if (isDupe) {
      duplicateDocuments.push({
        document: doc,
        reason
      });
    } else {
      newDocuments.push(doc);
    }
  }

  return {
    newDocuments,
    duplicateDocuments,
    totalCandidatos: candidateBatch.length,
    totalNuevos: newDocuments.length,
    totalDuplicados: duplicateDocuments.length
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeDocKey,
    buildDocumentIdentityKey,
    buildLineIdentityKey,
    checkDocumentDuplicate,
    filterBatchForOverlaps
  };
}
