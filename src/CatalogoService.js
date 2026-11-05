/**
 * STOCK-LIGHT — CatalogoService.js
 * Servicio de lectura con caché por ejecución de las 4 hojas del catálogo (D-029).
 */

let _catalogoPuroMod = null;
let _repoModCatalogo = null;

if (typeof require !== 'undefined') {
  try {
    _catalogoPuroMod = require('./Catalogo');
  } catch (e) {
    // Fallback entorno Apps Script V8
  }
  try {
    _repoModCatalogo = require('./Repository');
  } catch (e) {
    // Fallback entorno Apps Script V8
  }
}

function obtenerFuncionesCatalogoPuro_() {
  if (_catalogoPuroMod && typeof _catalogoPuroMod.clasificarCombinacion === 'function') {
    return _catalogoPuroMod;
  }
  return {
    clasificarCombinacion: typeof clasificarCombinacion === 'function' ? clasificarCombinacion : null,
    explicarCombinacion: typeof explicarCombinacion === 'function' ? explicarCombinacion : null,
    cumpleFiltro: typeof cumpleFiltro === 'function' ? cumpleFiltro : null
  };
}

class CatalogoService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.repository] - Instancia de SheetsRepository
   * @param {Object} [options.config] - Configuración en memoria `{ atributos, reglas, catalogo, agrupaciones }`
   */
  constructor(options = {}) {
    this.repo = options.repository || null;
    this._staticConfig = options.config || null;
    this._configCache = null;
    this._cachedRepoVersion = -1;

    this.clasificar = this.clasificar.bind(this);
    this.explicar = this.explicar.bind(this);
    this.esCombinacionSeguida = this.esCombinacionSeguida.bind(this);
  }

  /**
   * Invalida la caché en memoria para forzar relectura desde el repositorio.
   */
  invalidarCache() {
    this._configCache = null;
    this._cachedRepoVersion = -1;
  }

  /**
   * Obtiene o construye el repositorio de persistencia.
   * @returns {Object|null}
   * @private
   */
  _obtenerRepositorio() {
    if (this.repo) return this.repo;
    const RepoClass = (_repoModCatalogo && _repoModCatalogo.SheetsRepository)
      ? _repoModCatalogo.SheetsRepository
      : (typeof SheetsRepository !== 'undefined' ? SheetsRepository : null);
    if (RepoClass) {
      this.repo = new RepoClass();
    }
    return this.repo;
  }

  /**
   * Devuelve la configuración de las cuatro tablas del catálogo usando caché por ejecución.
   * @returns {{ atributos: Array<Object>, reglas: Array<Object>, catalogo: Array<Object>, agrupaciones: Array<Object> }}
   */
  obtenerConfiguracion() {
    if (this._staticConfig) {
      return {
        atributos: Array.isArray(this._staticConfig.atributos) ? this._staticConfig.atributos : [],
        reglas: Array.isArray(this._staticConfig.reglas) ? this._staticConfig.reglas : [],
        catalogo: Array.isArray(this._staticConfig.catalogo) ? this._staticConfig.catalogo : [],
        agrupaciones: Array.isArray(this._staticConfig.agrupaciones) ? this._staticConfig.agrupaciones : []
      };
    }

    const repo = this._obtenerRepositorio();
    if (!repo) {
      return { atributos: [], reglas: [], catalogo: [], agrupaciones: [] };
    }

    const repoVersion = typeof repo._catalogoVersion === 'number' ? repo._catalogoVersion : 0;
    if (this._configCache && this._cachedRepoVersion === repoVersion) {
      return this._configCache;
    }

    let atributos = [];
    let reglas = [];
    let catalogo = [];
    let agrupaciones = [];

    try {
      atributos = typeof repo.getAtributos === 'function' ? repo.getAtributos() : [];
      reglas = typeof repo.getReglasClasificacion === 'function' ? repo.getReglasClasificacion() : [];
      catalogo = typeof repo.getCatalogo === 'function' ? repo.getCatalogo() : [];
      agrupaciones = typeof repo.getAgrupaciones === 'function' ? repo.getAgrupaciones() : [];
    } catch (e) {
      return { atributos: [], reglas: [], catalogo: [], agrupaciones: [] };
    }

    this._configCache = {
      atributos,
      reglas,
      catalogo,
      agrupaciones
    };
    this._cachedRepoVersion = repoVersion;

    return this._configCache;
  }

  /**
   * Clasifica una combinación artículo + envase.
   * @param {string} articulo
   * @param {string} envase
   * @returns {{ seguimiento: string, atributos: Object, agrupaciones: Object }}
   */
  clasificar(articulo, envase) {
    const fns = obtenerFuncionesCatalogoPuro_();
    const config = this.obtenerConfiguracion();
    return fns.clasificarCombinacion(articulo, envase, config);
  }

  /**
   * Explica la clasificación de una combinación artículo + envase.
   * @param {string} articulo
   * @param {string} envase
   * @returns {{
   *   seguimiento: string,
   *   atributos: Object,
   *   agrupaciones: Object,
   *   origenPorAtributo: Object,
   *   filaPorAgrupacion: Object
   * }}
   */
  explicar(articulo, envase) {
    const fns = obtenerFuncionesCatalogoPuro_();
    const config = this.obtenerConfiguracion();
    return fns.explicarCombinacion(articulo, envase, config);
  }

  /**
   * Determina el estado de seguimiento de la combinación (articulo, envase) en el inventario.
   * Compatible con la firma `(articulo, envase) => 'SEGUIDA' | 'NO_SEGUIDA' | 'PENDIENTE'`
   * que espera `clasificar` de ClasificadorLineas (T-006B).
   * @param {string} articulo
   * @param {string} envase
   * @returns {'SEGUIDA'|'NO_SEGUIDA'|'PENDIENTE'}
   */
  esCombinacionSeguida(articulo, envase) {
    const res = this.clasificar(articulo, envase);
    return (res && res.seguimiento) ? res.seguimiento : 'PENDIENTE';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CatalogoService
  };
}
