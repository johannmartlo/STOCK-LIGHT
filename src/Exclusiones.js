/**
 * STOCK-LIGHT — Exclusiones.js
 *
 * Exclusiones de la importación (T-031):
 * - clientes cuyas ventas no pasan por el almacén;
 * - nombres comerciales que quedan fuera aunque empiecen por un artículo seguido.
 *
 * La configuración vive en hojas; aquí no se escribe ningún nombre de cliente real.
 */

const EXCLUSIONES_MARCA = 'T-031 nombre comercial fuera';
const EXCLUSIONES_PRIORIDAD = 1;
const EXCLUSIONES_CLIENTES_HOJA = 'CLIENTES_EXCLUIDOS';

// Dependencias compartidas en Node.js; en Apps Script son globales.
if (typeof require !== 'undefined') {
  const segMod = require('./Seguridad');
  const repoMod = require('./Repository');
  const idsMod = require('./Ids');
  global.exigirPropietario_ = global.exigirPropietario_ || segMod.exigirPropietario_;
  global.usuarioActual_ = global.usuarioActual_ || segMod.usuarioActual_;
  global.SheetsRepository = global.SheetsRepository || repoMod.SheetsRepository;
  global.nuevoId = global.nuevoId || idsMod.nuevoId;
}

/**
 * Normaliza un patrón o una entidad para comparar:
 * mayúsculas, sin acentos, sin espacios sobrantes y con espacios internos colapsados.
 * @param {*} texto
 * @returns {string}
 */
function normalizarPatronExclusion_(texto) {
  return String(texto === null || texto === undefined ? '' : texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function _exclusionesActivo_(valor) {
  if (valor === false || valor === 0) return false;
  const texto = String(valor === undefined || valor === null ? 'TRUE' : valor).trim().toUpperCase();
  return texto !== 'FALSE' && texto !== 'NO' && texto !== '0';
}

function _exclusionesRepo_(options = {}) {
  if (options.repository) return options.repository;
  const RepoClass = (typeof SheetsRepository !== 'undefined')
    ? SheetsRepository
    : (typeof require !== 'undefined' ? require('./Repository').SheetsRepository : null);
  if (!RepoClass) throw new Error('SheetsRepository no está disponible en Exclusiones.');
  return new RepoClass();
}

function _exclusionesUsuario_() {
  try {
    if (typeof usuarioActual_ === 'function') return usuarioActual_() || 'SISTEMA';
  } catch (e) {}
  return 'SISTEMA';
}

function _exclusionesAhora_() {
  return new Date().toISOString();
}

/**
 * Indica si una entidad contiene algún patrón activo.
 * @param {string} entidad
 * @param {Array<string>} patrones
 * @returns {boolean}
 */
function esClienteExcluido_(entidad, patrones) {
  const entidadNormalizada = normalizarPatronExclusion_(entidad);
  if (!entidadNormalizada) return false;
  const lista = Array.isArray(patrones) ? patrones : [];
  for (const patron of lista) {
    const patronNormalizado = normalizarPatronExclusion_(patron);
    if (patronNormalizado && entidadNormalizada.includes(patronNormalizado)) return true;
  }
  return false;
}

/**
 * Lee los patrones activos de CLIENTES_EXCLUIDOS.
 * @param {Object} repo
 * @returns {Array<string>}
 */
function leerClientesExcluidos_(repo) {
  if (!repo) return [];
  let filas = [];
  if (typeof repo.getClientesExcluidos === 'function') {
    filas = repo.getClientesExcluidos() || [];
  } else {
    const ss = typeof repo.getSpreadsheet === 'function' ? repo.getSpreadsheet() : null;
    if (!ss || typeof ss.getSheetByName !== 'function' || !ss.getSheetByName(EXCLUSIONES_CLIENTES_HOJA)) {
      return [];
    }
    filas = typeof repo.readTable === 'function' ? repo.readTable(EXCLUSIONES_CLIENTES_HOJA) : [];
  }
  return (Array.isArray(filas) ? filas : [])
    .filter(fila => fila && _exclusionesActivo_(fila.activo))
    .map(fila => normalizarPatronExclusion_(fila.patron))
    .filter(Boolean);
}

function _esReglaFuera_(regla) {
  return Boolean(
    regla
    && String(regla.atributo || '').trim().toUpperCase() === 'SEGUIMIENTO'
    && String(regla.valor || '').trim().toUpperCase() === 'NO'
    && String(regla.observaciones || '').trim() === EXCLUSIONES_MARCA
  );
}

/**
 * Lee los patrones de nombres comerciales fuera creados por T-031.
 * @param {Object} repo
 * @returns {Array<string>}
 */
function leerArticulosFuera_(repo) {
  if (!repo || typeof repo.getReglasClasificacion !== 'function') return [];
  return (repo.getReglasClasificacion() || [])
    .filter(_esReglaFuera_)
    .map(regla => normalizarPatronExclusion_(regla.articulo_contiene))
    .filter(Boolean);
}

/**
 * Devuelve la configuración de exclusiones para la pantalla futura.
 * @param {Object} repo
 * @returns {{ clientesExcluidos: Array<string>, articulosFuera: Array<string> }}
 */
function listarExclusiones_(repo) {
  return {
    clientesExcluidos: leerClientesExcluidos_(repo),
    articulosFuera: leerArticulosFuera_(repo)
  };
}

/**
 * Añade patrones de clientes excluidos. Idempotente y no borra.
 *
 * @param {Array<string>|string} patrones
 * @param {Object} [options]
 * @returns {{ anadidos: Array<string>, yaEstaban: Array<string> }}
 */
function adminConfigurarClientesExcluidos(patrones, options = {}) {
  exigirPropietario_(options && options.session);

  const repo = _exclusionesRepo_(options);
  const lista = (Array.isArray(patrones) ? patrones : String(patrones || '').split(','))
    .map(normalizarPatronExclusion_)
    .filter(Boolean);
  const unicos = Array.from(new Set(lista));

  const ss = typeof repo.getSpreadsheet === 'function' ? repo.getSpreadsheet() : null;
  if (!ss || typeof ss.getSheetByName !== 'function' || !ss.getSheetByName(EXCLUSIONES_CLIENTES_HOJA)) {
    throw new Error(`La hoja ${EXCLUSIONES_CLIENTES_HOJA} no existe. Ejecuta initDatabase o adminInstalarStockLight.`);
  }

  const existentes = (typeof repo.readTable === 'function' ? repo.readTable(EXCLUSIONES_CLIENTES_HOJA) : [])
    .filter(fila => fila && _exclusionesActivo_(fila.activo))
    .map(fila => normalizarPatronExclusion_(fila.patron))
    .filter(Boolean);
  const activos = new Set(existentes);

  const anadidos = [];
  const yaEstaban = [];
  const nuevos = [];
  const usuario = _exclusionesUsuario_();
  const fechaAlta = _exclusionesAhora_();

  for (const patron of unicos) {
    if (activos.has(patron)) {
      yaEstaban.push(patron);
      continue;
    }
    nuevos.push({
      patron,
      activo: true,
      nota: '',
      fecha_alta: fechaAlta,
      usuario
    });
    activos.add(patron);
    anadidos.push(patron);
  }

  if (nuevos.length > 0) {
    repo.appendRecords(EXCLUSIONES_CLIENTES_HOJA, nuevos);
  }

  return { anadidos, yaEstaban };
}

/**
 * Crea o actualiza reglas de SEGUIMIENTO=NO para nombres comerciales fuera.
 * Usa prioridad 1 para ganar a las reglas generales (por ejemplo, TOMATE → SI, prioridad 30).
 *
 * @param {Array<string>|string} patrones
 * @param {Object} [options]
 * @returns {{ anadidos: Array<string>, actualizados: Array<string>, yaEstaban: Array<string> }}
 */
function adminConfigurarArticulosFuera(patrones, options = {}) {
  exigirPropietario_(options && options.session);

  const repo = _exclusionesRepo_(options);
  const lista = (Array.isArray(patrones) ? patrones : String(patrones || '').split(','))
    .map(normalizarPatronExclusion_)
    .filter(Boolean);
  const unicos = Array.from(new Set(lista));

  const reglas = typeof repo.getReglasClasificacion === 'function' ? repo.getReglasClasificacion() : [];
  const anadidos = [];
  const actualizados = [];
  const yaEstaban = [];

  for (const patron of unicos) {
    const existente = reglas.find(regla => (
      _esReglaFuera_(regla)
      && normalizarPatronExclusion_(regla.articulo_contiene) === patron
    ));

    if (!existente) {
      repo.upsertReglaClasificacion({
        atributo: 'SEGUIMIENTO',
        valor: 'NO',
        prioridad: EXCLUSIONES_PRIORIDAD,
        articulo_contiene: patron,
        articulo_excluye: '',
        envase_contiene: '',
        envase_excluye: '',
        activo: true,
        observaciones: EXCLUSIONES_MARCA
      });
      anadidos.push(patron);
      continue;
    }

    const yaCorrecta = String(existente.valor || '').trim().toUpperCase() === 'NO'
      && Number(existente.prioridad) === EXCLUSIONES_PRIORIDAD
      && _exclusionesActivo_(existente.activo);
    if (yaCorrecta) {
      yaEstaban.push(patron);
      continue;
    }

    repo.upsertReglaClasificacion(Object.assign({}, existente, {
      valor: 'NO',
      prioridad: EXCLUSIONES_PRIORIDAD,
      activo: true,
      observaciones: EXCLUSIONES_MARCA
    }));
    actualizados.push(patron);
  }

  return { anadidos, actualizados, yaEstaban };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EXCLUSIONES_MARCA,
    EXCLUSIONES_PRIORIDAD,
    EXCLUSIONES_CLIENTES_HOJA,
    normalizarPatronExclusion_,
    esClienteExcluido_,
    leerClientesExcluidos_,
    leerArticulosFuera_,
    listarExclusiones_,
    adminConfigurarClientesExcluidos,
    adminConfigurarArticulosFuera
  };
}
