/**
 * STOCK-LIGHT — Ids.js
 *
 * Generador unificado de identificadores únicos (D-024, T-022).
 * En Google Apps Script utiliza Utilities.getUuid().
 * En Node.js utiliza crypto.randomUUID().
 * Prohibido el uso de Date.now() o números aleatorios cortos como ID.
 */

/**
 * Genera un identificador único con prefijo legible.
 *
 * @param {string} [prefijo='ID'] - Prefijo del identificador (ej. 'MOV', 'CAPA', 'DOC').
 * @returns {string} Identificador único (ej. 'MOV-550e8400-e29b-41d4-a716-446655440000').
 */
function nuevoId(prefijo = 'ID') {
  let uuid = '';

  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.getUuid === 'function') {
    uuid = Utilities.getUuid();
  } else if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
    uuid = crypto.randomUUID();
  } else if (typeof require !== 'undefined') {
    const nodeCrypto = require('crypto');
    uuid = nodeCrypto.randomUUID();
  } else {
    throw new Error('No se encontró un generador de UUID válido (Utilities.getUuid o crypto.randomUUID).');
  }

  const pref = String(prefijo || '').trim();
  if (!pref) {
    return uuid;
  }
  if (pref.endsWith('-') || pref.endsWith(':')) {
    return `${pref}${uuid}`;
  }
  return `${pref}-${uuid}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    nuevoId
  };
}
