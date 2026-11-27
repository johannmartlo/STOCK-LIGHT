/**
 * STOCK-LIGHT — NombresLegibles.js
 *
 * Nombres legibles en servidor con las mismas reglas que `nombreLegible` del cliente
 * (`src/ui/app.html`, T-024). Es lógica pura: no toca hojas ni servicios de Google.
 */

const SIGLAS_LEGIBLES = new Set([
  'G', 'GG', 'GGG', 'M', 'MM', 'MMM', 'I', 'II', 'EPS', 'POOL',
  'HD', 'TDA', 'SAT', 'SL', 'SA', 'SLL', 'IFCO', 'LL', 'S/C'
]);

const PALABRAS_ENLACE_LEGIBLES = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'con', 'para'
]);

const TILDES_LEGIBLES = {
  CARTON: 'Cartón',
  GENERICA: 'Genérica',
  GENERICO: 'Genérico',
  JAPONES: 'Japonés',
  CORAZON: 'Corazón',
  PLASTICO: 'Plástico',
  CAMARA: 'Cámara'
};

/**
 * Normaliza para comparar sin acentos ni mayúsculas (misma regla que el cliente).
 * @param {*} texto
 * @returns {string}
 */
function _normalizarBusquedaParte_(texto) {
  return String(texto === null || texto === undefined ? '' : texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Convierte un nombre de artículo, envase o grupo en su forma legible.
 * Réplica exacta de `nombreLegible` de `src/ui/app.html`.
 *
 * @param {*} texto
 * @returns {string}
 */
function nombreLegible_(texto) {
  if (texto === null || texto === undefined) return '';
  const raw = String(texto).trim();
  if (!raw) return '';

  return raw.split(/(\s*[·→]\s*)/).map(function (parte) {
    if (/^\s*[·→]\s*$/.test(parte)) return parte;
    const sinTomate = parte.trim().replace(/^TOMATE\s+/i, '');
    if (!sinTomate) return '';
    return sinTomate.split(/\s+/).map(function (palabra, idx) {
      const upper = palabra.toUpperCase();
      if (SIGLAS_LEGIBLES.has(upper)) return upper;
      if (Object.prototype.hasOwnProperty.call(TILDES_LEGIBLES, upper)) {
        return TILDES_LEGIBLES[upper];
      }
      const lower = palabra.toLowerCase();
      if (idx > 0 && PALABRAS_ENLACE_LEGIBLES.has(lower)) return lower;
      if (/^\d+(?:[.,]\d+)?(?:[xX]\d+(?:[.,]\d+)?)+[a-zA-Z]*$/.test(palabra)) {
        return lower;
      }
      if (/^\d+(?:[.,]\d+)?(?:G|KG|ML|L|CM|MM)$/i.test(palabra)) {
        return lower;
      }
      return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
    }).join(' ');
  }).join('');
}

/**
 * Quita del artículo legible el prefijo que comparte con el nombre de la variedad.
 * Réplica de `etiquetaArticuloEnVariedad` de `src/ui/app.html`.
 *
 * @param {string} articulo
 * @param {string} grupo
 * @returns {string}
 */
function etiquetaArticuloEnVariedad_(articulo, grupo) {
  const artLeg = nombreLegible_(articulo);
  if (!artLeg || !grupo) return artLeg;
  const artWords = artLeg.split(/\s+/);
  const grpWords = nombreLegible_(grupo).split(/\s+/);
  let matchCount = 0;
  while (
    matchCount < artWords.length
    && matchCount < grpWords.length
    && _normalizarBusquedaParte_(artWords[matchCount]) === _normalizarBusquedaParte_(grpWords[matchCount])
  ) {
    matchCount++;
  }
  if (matchCount > 0 && matchCount < artWords.length) {
    return artWords.slice(matchCount).join(' ');
  }
  return artLeg;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SIGLAS_LEGIBLES,
    nombreLegible: nombreLegible_,
    nombreLegible_,
    etiquetaArticuloEnVariedad: etiquetaArticuloEnVariedad_,
    etiquetaArticuloEnVariedad_
  };
}
