/**
 * STOCK-LIGHT — CalibreCategoria.js
 * Extracción de categoría comercial y calibre a partir de la denominación del artículo (D-029).
 */

/**
 * Normaliza cadenas de texto para extracción de calibre y categoría:
 * Mayúsculas, sin acentos (NFD), signos de puntuación a espacio y espacios colapsados.
 * @param {string} text
 * @returns {string}
 * @private
 */
function normalizarTextoCalibre_(text) {
  if (!text) return '';
  return String(text)
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[,;.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrae categoría comercial y calibre a partir de la denominación del artículo.
 * @param {string} nombreArticulo
 * @returns {{ categoria: string, calibre: string, calibreCategoria: string }}
 */
function extraerCalibreYCategoria(nombreArticulo) {
  const norm = normalizarTextoCalibre_(nombreArticulo);
  if (!norm) {
    return { categoria: 'S/C', calibre: 'S/C', calibreCategoria: 'S/C' };
  }

  // 1. Detección de Categoría
  let categoria = '';
  if (/\bEXTRA\b/.test(norm)) {
    categoria = 'EXTRA';
  } else if (/\bII\b/.test(norm)) {
    categoria = '2ª CATEGORÍA (II)';
  } else if (/\bI\b/.test(norm)) {
    categoria = '1ª CATEGORÍA (I)';
  } else if (norm.includes('VOLLEY')) {
    categoria = '1ª CATEGORÍA (VOLLEY)';
  } else if (norm.includes('CORAZON DE BUEY')) {
    categoria = '2ª CATEGORÍA (CORAZÓN DE BUEY)';
  } else if (norm.includes('JAPI')) {
    categoria = '1ª CATEGORÍA (JAPI)';
  } else if (norm.includes('JAPONES')) {
    categoria = '2ª CATEGORÍA (JAPONÉS)';
  } else {
    categoria = 'ESTÁNDAR';
  }

  // 2. Detección de Calibre
  let calibre = '';
  const tokens = norm.split(' ');
  const calibrePatterns = [
    'S/C', 'GGG', 'GG/GGG', 'GG', 'G', 'MMM', 'MM', 'M', 'UND', 'UNID',
    '500G', '750G', '300G', '250G', '200G', '180G', '225G'
  ];

  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/[(),;]/g, '');
    if (calibrePatterns.includes(t)) {
      calibre = t;
      break;
    }
  }

  if (!calibre) {
    const matchKg = norm.match(/\b(\d+(?:[.,]\d+)?\s*(?:KG|G))\b/);
    if (matchKg) {
      calibre = matchKg[1];
    } else {
      calibre = 'S/C';
    }
  }

  const calibreCategoria = (categoria && calibre !== 'S/C') ? `${categoria} - ${calibre}` : categoria;

  return { categoria, calibre, calibreCategoria };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extraerCalibreYCategoria
  };
}
