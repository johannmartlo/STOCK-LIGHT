/**
 * STOCK-LIGHT — Equivalencias.js
 *
 * Equivalencias de nombre de artículo para las recepciones de Hispatec (T-032).
 * Solo cambian el nombre del artículo; nunca el envase.
 */

const EQUIVALENCIAS_HOJA = 'EQUIVALENCIAS_ARTICULO';

if (typeof require !== 'undefined') {
  const segMod = require('./Seguridad');
  const repoMod = require('./Repository');
  global.exigirPropietario_ = global.exigirPropietario_ || segMod.exigirPropietario_;
  global.SheetsRepository = global.SheetsRepository || repoMod.SheetsRepository;
}

/**
 * Normaliza una descripción de recepción: mayúsculas, espacios colapsados y
 * sin sufijo final KG / UNID / UND.
 * @param {*} texto
 * @returns {string}
 */
function normalizarDescripcionEquivalencia_(texto) {
  let valor = String(texto === null || texto === undefined ? '' : texto)
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
  valor = valor.replace(/\s+(KG|UNID|UND)$/i, '').trim();
  return valor;
}

function normalizarNombreEquivalencia_(texto) {
  return String(texto === null || texto === undefined ? '' : texto)
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function _equivalenciasActivo_(valor) {
  if (valor === false || valor === 0) return false;
  const texto = String(valor === undefined || valor === null ? 'TRUE' : valor).trim().toUpperCase();
  return texto !== 'FALSE' && texto !== 'NO' && texto !== '0';
}

function _equivalenciasRepo_(options = {}) {
  if (options.repository) return options.repository;
  const RepoClass = (typeof SheetsRepository !== 'undefined')
    ? SheetsRepository
    : (typeof require !== 'undefined' ? require('./Repository').SheetsRepository : null);
  if (!RepoClass) throw new Error('SheetsRepository no está disponible en Equivalencias.');
  return new RepoClass();
}

/**
 * Lee las equivalencias de artículo. Por defecto solo las activas.
 * @param {Object} repo
 * @param {Object} [opciones]
 * @returns {Array<Object>}
 */
function leerEquivalencias_(repo, opciones = {}) {
  if (!repo) return [];
  const ss = typeof repo.getSpreadsheet === 'function' ? repo.getSpreadsheet() : null;
  if (!ss || typeof ss.getSheetByName !== 'function' || !ss.getSheetByName(EQUIVALENCIAS_HOJA)) return [];
  const filas = typeof repo.readTable === 'function' ? repo.readTable(EQUIVALENCIAS_HOJA) : [];
  const incluirInactivas = opciones && opciones.incluirInactivas === true;
  return (Array.isArray(filas) ? filas : [])
    .filter(fila => fila && (incluirInactivas || _equivalenciasActivo_(fila.activo)))
    .map(fila => ({
      descripcion: normalizarDescripcionEquivalencia_(fila.descripcion),
      nombre_articulo: normalizarNombreEquivalencia_(fila.nombre_articulo),
      activo: _equivalenciasActivo_(fila.activo),
      nota: String(fila.nota || '').trim()
    }))
    .filter(fila => fila.descripcion && fila.nombre_articulo);
}

/**
 * Mapa descripción normalizada → nombre de artículo de venta.
 * @param {Object} repo
 * @returns {Map<string,string>}
 */
function mapaEquivalencias_(repo) {
  const mapa = new Map();
  for (const fila of leerEquivalencias_(repo)) {
    if (!mapa.has(fila.descripcion)) mapa.set(fila.descripcion, fila.nombre_articulo);
  }
  return mapa;
}

/**
 * Devuelve la configuración para la futura pantalla.
 * @param {Object} repo
 * @returns {{ equivalencias: Array<Object> }}
 */
function listarEquivalencias_(repo) {
  return { equivalencias: leerEquivalencias_(repo) };
}

/**
 * Añade o actualiza equivalencias descripción → nombre de artículo.
 * Idempotente; no borra filas.
 *
 * @param {Array<Array<string>>|Object} pares
 * @param {Object} [options]
 * @returns {{ anadidos: Array<string>, actualizados: Array<string>, yaEstaban: Array<string> }}
 */
function adminConfigurarEquivalencias(pares, options = {}) {
  exigirPropietario_(options && options.session);

  const repo = _equivalenciasRepo_(options);
  const entradas = Array.isArray(pares)
    ? pares
    : Object.keys(pares && typeof pares === 'object' ? pares : {}).map(clave => [clave, pares[clave]]);

  const filas = leerEquivalencias_(repo, { incluirInactivas: true });
  const porDescripcion = new Map(filas.map(fila => [fila.descripcion, fila]));
  const anadidos = [];
  const actualizados = [];
  const yaEstaban = [];
  let cambio = false;

  for (const entrada of entradas) {
    if (!Array.isArray(entrada) || entrada.length < 2) continue;
    const descripcion = normalizarDescripcionEquivalencia_(entrada[0]);
    const nombre = normalizarNombreEquivalencia_(entrada[1]);
    if (!descripcion || !nombre) continue;

    const existente = porDescripcion.get(descripcion);
    if (!existente) {
      const nueva = {
        descripcion,
        nombre_articulo: nombre,
        activo: true,
        nota: ''
      };
      filas.push(nueva);
      porDescripcion.set(descripcion, nueva);
      anadidos.push(descripcion);
      cambio = true;
      continue;
    }

    if (existente.activo && existente.nombre_articulo === nombre) {
      yaEstaban.push(descripcion);
      continue;
    }

    existente.nombre_articulo = nombre;
    existente.activo = true;
    actualizados.push(descripcion);
    cambio = true;
  }

  if (cambio) {
    if (typeof repo.replaceTable === 'function') {
      repo.replaceTable(EQUIVALENCIAS_HOJA, filas);
    } else if (typeof repo.appendRecords === 'function') {
      // Sin replaceTable no se pueden actualizar filas existentes; al menos no perder nuevas.
      const nuevas = filas.filter(fila => anadidos.includes(fila.descripcion));
      if (nuevas.length > 0) repo.appendRecords(EQUIVALENCIAS_HOJA, nuevas);
    }
  }

  return { anadidos, actualizados, yaEstaban };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EQUIVALENCIAS_HOJA,
    normalizarDescripcionEquivalencia_,
    normalizarNombreEquivalencia_,
    leerEquivalencias_,
    mapaEquivalencias_,
    listarEquivalencias_,
    adminConfigurarEquivalencias
  };
}
