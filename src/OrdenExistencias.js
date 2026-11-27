/**
 * STOCK-LIGHT — OrdenExistencias.js (T-039)
 *
 * Orden de las existencias como en la hoja VISTA MOVIL del Excel:
 * variedad → categoría → calibre de grande a pequeño, con subtotales por categoría.
 *
 * Funciones puras: no tocan Sheets, ni Drive, ni DOM. Se reutiliza
 * `extraerCalibreYCategoria` de CalibreCategoria.js (D-029) para leer categoría y calibre.
 */

if (typeof require !== 'undefined') {
  try {
    const calibreMod = require('./CalibreCategoria');
    if (typeof global !== 'undefined') {
      global.extraerCalibreYCategoria = global.extraerCalibreYCategoria || calibreMod.extraerCalibreYCategoria;
    }
  } catch (e) {}
}

const ORDEN_CATEGORIA_ = {
  EXTRA: 0,
  '1ª CATEGORÍA (I)': 1,
  '2ª CATEGORÍA (II)': 2
};

const ORDEN_CALIBRE_ = {
  GGG: 0,
  'GG/GGG': 1,
  GG: 2,
  G: 3,
  M: 4,
  MM: 5,
  MMM: 6,
  'S/C': 8
};

/**
 * Normaliza el nombre de un artículo para el orden: mayúsculas, sin acentos,
 * puntuación ligera a espacio y espacios colapsados, igual que CalibreCategoria.js.
 * @param {string} text
 * @returns {string}
 * @private
 */
function _normalizarTextoOrden_(text) {
  if (!text) return '';
  return String(text)
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[,;.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrae categoría y calibre reutilizando el extractor existente (CalibreCategoria.js).
 * @param {string} nombreArticulo
 * @returns {{categoria: string, calibre: string, calibreCategoria: string}}
 * @private
 */
function _extraerCalibreCategoriaOrden_(nombreArticulo) {
  let extractor = null;
  if (typeof extraerCalibreYCategoria === 'function') {
    extractor = extraerCalibreYCategoria;
  } else if (typeof global !== 'undefined' && typeof global.extraerCalibreYCategoria === 'function') {
    extractor = global.extraerCalibreYCategoria;
  }
  if (!extractor) {
    throw new Error('OrdenExistencias: no está disponible extraerCalibreYCategoria (CalibreCategoria.js).');
  }
  return extractor(nombreArticulo);
}

/**
 * Escapa un texto para usarlo como literal dentro de una expresión regular.
 * @param {string} texto
 * @returns {string}
 * @private
 */
function _escaparRegexOrden_(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Calcula la variedad base: el nombre normalizado sin las palabras de categoría
 * (EXTRA, I, II), sin el calibre detectado y sin el sufijo KG/UNID entre paréntesis
 * o suelto.
 * @param {string} nombreArticulo
 * @param {string} calibre
 * @returns {string}
 * @private
 */
function _variedadBaseOrden_(nombreArticulo, calibre) {
  let base = _normalizarTextoOrden_(nombreArticulo);

  // Sufijo KG/UNID: entre paréntesis o suelto al final del nombre.
  base = base.replace(/\s*\(\s*(?:KG|UNID)\s*\)\s*$/, ' ');
  base = base.replace(/\s+\b(?:KG|UNID)\b\s*$/, ' ');

  // Palabras de categoría comercial.
  base = base.replace(/\b(?:EXTRA|II|I)\b/g, ' ');

  // Calibre detectado (pesos como 500G o 1 KG incluidos).
  if (calibre) {
    const patron = _escaparRegexOrden_(calibre).replace(/\s+/g, '\\s*');
    base = base.replace(new RegExp('\\b' + patron + '\\b', 'g'), ' ');
  }

  // Paréntesis que se quedan vacíos al quitar el calibre: «(GG)» → «()».
  base = base.replace(/\(\s*\)/g, ' ');

  return base.replace(/\s+/g, ' ').trim();
}

/**
 * Rango de calibre: cuanto menor, más grande es el calibre.
 * @param {string} calibre
 * @returns {number}
 * @private
 */
function _rangoCalibreOrden_(calibre) {
  const valor = String(calibre === null || calibre === undefined ? '' : calibre).trim();
  if (Object.prototype.hasOwnProperty.call(ORDEN_CALIBRE_, valor)) {
    return ORDEN_CALIBRE_[valor];
  }
  if (/^\d+(?:[.,]\d+)?\s*(?:KG|G)$/.test(valor)) return 7;
  return 9;
}

/**
 * Clave de orden de un artículo: variedad base, categoría y calibre.
 * @param {string} nombreArticulo
 * @returns {{variedadBase: string, rangoCategoria: number, rangoCalibre: number, categoriaCorta: string, calibre: string}}
 */
function claveOrdenArticulo(nombreArticulo) {
  const extraido = _extraerCalibreCategoriaOrden_(nombreArticulo);
  const categoria = String((extraido && extraido.categoria) || '');
  const calibre = String((extraido && extraido.calibre) || '');
  const rangoCategoria = Object.prototype.hasOwnProperty.call(ORDEN_CATEGORIA_, categoria)
    ? ORDEN_CATEGORIA_[categoria]
    : 3;
  let categoriaCorta = '';
  if (categoria === 'EXTRA') categoriaCorta = 'Extra';
  else if (categoria === '1ª CATEGORÍA (I)') categoriaCorta = 'Cat. I';
  else if (categoria === '2ª CATEGORÍA (II)') categoriaCorta = 'Cat. II';

  return {
    variedadBase: _variedadBaseOrden_(nombreArticulo, calibre),
    rangoCategoria,
    rangoCalibre: _rangoCalibreOrden_(calibre),
    categoriaCorta,
    calibre
  };
}

/**
 * Compara dos artículos (con su envase) en el orden de la hoja VISTA MOVIL:
 * variedad base → categoría → calibre → envase → artículo. Orden total y estable.
 * @param {{articulo: string, envase: string}} a
 * @param {{articulo: string, envase: string}} b
 * @returns {number}
 */
function compararArticulos(a, b) {
  const articuloA = String((a && a.articulo) || '');
  const articuloB = String((b && b.articulo) || '');
  const envaseA = String((a && a.envase) || '');
  const envaseB = String((b && b.envase) || '');

  const claveA = claveOrdenArticulo(articuloA);
  const claveB = claveOrdenArticulo(articuloB);

  const cmpBase = claveA.variedadBase.localeCompare(claveB.variedadBase, 'es');
  if (cmpBase !== 0) return cmpBase;
  if (claveA.rangoCategoria !== claveB.rangoCategoria) return claveA.rangoCategoria - claveB.rangoCategoria;
  if (claveA.rangoCalibre !== claveB.rangoCalibre) return claveA.rangoCalibre - claveB.rangoCalibre;
  const cmpEnvase = envaseA.localeCompare(envaseB, 'es');
  if (cmpEnvase !== 0) return cmpEnvase;
  return articuloA.localeCompare(articuloB, 'es');
}

/**
 * Construye los bloques del desglose por variedad base + categoría, con subtotal de cajas
 * y una línea por artículo + envase. Las líneas con 0 cajas no salen.
 * @param {Array<{articulo: string, envase: string, cajas: number}>} partidas
 * @returns {Array<{variedadBase: string, categoriaCorta: string, cajas: number, lineas: Array<{articulo: string, envase: string, cajas: number}>}>}
 */
function construirDesgloseOrdenado(partidas) {
  const lista = Array.isArray(partidas) ? partidas.slice() : [];
  lista.sort(compararArticulos);

  const bloques = new Map();
  const ordenBloques = [];

  for (const partida of lista) {
    if (!partida) continue;
    const articulo = String(partida.articulo || '').trim();
    const envase = String(partida.envase || '').trim();
    const cajas = Number(partida.cajas || 0);
    const clave = claveOrdenArticulo(articulo);
    const claveBloque = clave.variedadBase + '\u0000' + clave.categoriaCorta;

    if (!bloques.has(claveBloque)) {
      const bloque = {
        variedadBase: clave.variedadBase,
        categoriaCorta: clave.categoriaCorta,
        cajas: 0,
        lineas: []
      };
      bloques.set(claveBloque, bloque);
      ordenBloques.push(bloque);
    }

    const bloque = bloques.get(claveBloque);
    const claveLinea = articulo + '\u0000' + envase;
    let linea = null;
    for (const existente of bloque.lineas) {
      if (existente.articulo === articulo && existente.envase === envase) {
        linea = existente;
        break;
      }
    }
    if (!linea) {
      linea = { articulo, envase, cajas: 0 };
      bloque.lineas.push(linea);
    }
    linea.cajas += cajas;
    bloque.cajas += cajas;
  }

  return ordenBloques
    .map((bloque) => ({
      variedadBase: bloque.variedadBase,
      categoriaCorta: bloque.categoriaCorta,
      cajas: bloque.cajas,
      lineas: bloque.lineas.filter((linea) => Number(linea.cajas) !== 0)
    }))
    .filter((bloque) => bloque.lineas.length > 0);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    claveOrdenArticulo,
    compararArticulos,
    construirDesgloseOrdenado
  };
}
