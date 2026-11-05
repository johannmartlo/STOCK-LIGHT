/**
 * STOCK-LIGHT — CommercialGroupResolver.js
 * Fachada de clasificación comercial sobre el motor de catálogo y extracción de calibre (D-029).
 */

let _calibreMod = null;
let _catalogoServiceMod = null;
let _semillaMod = null;

if (typeof require !== 'undefined') {
  try {
    _calibreMod = require('./CalibreCategoria');
  } catch (e) {}
  try {
    _catalogoServiceMod = require('./CatalogoService');
  } catch (e) {}
  try {
    _semillaMod = require('./SemillaCatalogo');
  } catch (e) {}
}

function obtenerExtractorCalibre_() {
  if (_calibreMod && typeof _calibreMod.extraerCalibreYCategoria === 'function') {
    return _calibreMod.extraerCalibreYCategoria;
  }
  if (typeof extraerCalibreYCategoria === 'function') {
    return extraerCalibreYCategoria;
  }
  return () => ({ categoria: 'S/C', calibre: 'S/C', calibreCategoria: 'S/C' });
}

function obtenerMetadatosGruposBase_() {
  const fuente = (_semillaMod && _semillaMod.METADATOS_GRUPOS_COMERCIALES)
    ? _semillaMod.METADATOS_GRUPOS_COMERCIALES
    : (typeof METADATOS_GRUPOS_COMERCIALES !== 'undefined' ? METADATOS_GRUPOS_COMERCIALES : null);

  if (!fuente) {
    return {
      NO_CLASIFICADO: {
        id: 'NO_CLASIFICADO',
        name: 'PENDIENTE DE ASOCIACIÓN',
        order: 99,
        subgroups: []
      }
    };
  }

  const copia = {};
  const keys = Object.keys(fuente);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const g = fuente[k];
    copia[k] = {
      ...g,
      subgroups: Array.isArray(g.subgroups) ? g.subgroups.map(s => ({ ...s })) : []
    };
  }
  return copia;
}

function crearCatalogoService_(opciones) {
  if (opciones && opciones.catalogoService) {
    return opciones.catalogoService;
  }
  const SvcClass = (_catalogoServiceMod && _catalogoServiceMod.CatalogoService)
    ? _catalogoServiceMod.CatalogoService
    : (typeof CatalogoService !== 'undefined' ? CatalogoService : null);
  if (SvcClass) {
    return new SvcClass({
      repository: opciones ? opciones.repository : null,
      config: opciones ? opciones.config : null
    });
  }
  return null;
}

function lanzarErrorObsoleto_() {
  throw new Error('Obsoleto: usar el catálogo (D-029)');
}

/**
 * Normaliza cadenas de texto para búsqueda canónica:
 * Mayúsculas, sin acentos (NFD), signos de puntuación a espacio y espacios colapsados.
 * @param {string} text
 * @returns {string}
 */
function normalizeCommercialText(text) {
  if (!text) return '';
  return String(text)
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[,;.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class CommercialGroupResolver {
  /**
   * @param {Object} [options]
   * @param {Object} [options.repository] - Instancia de SheetsRepository
   * @param {Object} [options.catalogoService] - Instancia de CatalogoService
   * @param {Object} [options.config] - Configuración en memoria `{ atributos, reglas, catalogo, agrupaciones }`
   */
  constructor(options = {}) {
    this.repo = options.repository || null;
    this.catalogoService = crearCatalogoService_(options);
    this.groups = obtenerMetadatosGruposBase_();
    this._historicalPendientes = new Map();
  }

  _buildKey(articulo, envase) {
    return `${normalizeCommercialText(articulo)}|${normalizeCommercialText(envase)}`;
  }

  /**
   * Vincula el repositorio al servicio de catálogo e invalida su caché.
   * @param {Object} repository
   * @returns {{ vinculado: boolean }}
   */
  loadFromRepository(repository) {
    if (!repository) return { vinculado: false };
    this.repo = repository;
    if (this.catalogoService) {
      this.catalogoService.repo = repository;
      if (typeof this.catalogoService.invalidarCache === 'function') {
        this.catalogoService.invalidarCache();
      }
    } else {
      this.catalogoService = crearCatalogoService_({ repository });
    }
    return { vinculado: true };
  }

  // --- MÉTODOS OBSOLETOS DE ESCRITURA EN MEMORIA (D-029) ---

  addAssociation() {
    lanzarErrorObsoleto_();
  }

  removeAssociation() {
    lanzarErrorObsoleto_();
  }

  registerRule() {
    lanzarErrorObsoleto_();
  }

  registerArticleRule() {
    lanzarErrorObsoleto_();
  }

  registerPackagingRule() {
    lanzarErrorObsoleto_();
  }

  registerGroup() {
    lanzarErrorObsoleto_();
  }

  loadGroups() {
    lanzarErrorObsoleto_();
  }

  loadMatrix() {
    lanzarErrorObsoleto_();
  }

  loadMatrixCsv() {
    lanzarErrorObsoleto_();
  }

  /**
   * Sincroniza la tabla de metadatos de grupos con las filas activas de la vista COMERCIAL.
   * @private
   */
  _sincronizarGruposDesdeCatalogo() {
    const base = obtenerMetadatosGruposBase_();
    if (!this.catalogoService || typeof this.catalogoService.obtenerConfiguracion !== 'function') {
      this.groups = base;
      return;
    }

    const cfg = this.catalogoService.obtenerConfiguracion();
    const agrupaciones = Array.isArray(cfg.agrupaciones) ? cfg.agrupaciones : [];

    for (let i = 0; i < agrupaciones.length; i++) {
      const fila = agrupaciones[i];
      if (!fila) continue;
      if (fila.activa === false || String(fila.activa).toUpperCase() === 'FALSE' || String(fila.activa).toUpperCase() === 'NO') {
        continue;
      }
      if (normalizeCommercialText(fila.agrupacion) !== 'COMERCIAL') continue;

      const grupoRaw = String(fila.grupo || '').trim();
      if (!grupoRaw || grupoRaw.toUpperCase() === 'SIN CLASIFICAR') continue;

      const gId = grupoRaw.toUpperCase();
      if (!base[gId]) {
        base[gId] = {
          id: gId,
          name: grupoRaw,
          order: Number.isFinite(Number(fila.orden)) ? Number(fila.orden) : 50,
          activo: true,
          subgroups: []
        };
      }

      const subRaw = String(fila.subgrupo || '').trim();
      if (subRaw) {
        const sId = subRaw.toUpperCase();
        const yaExiste = base[gId].subgroups.some(s => String(s.id).toUpperCase() === sId);
        if (!yaExiste) {
          base[gId].subgroups.push({
            id: sId,
            name: subRaw,
            order: base[gId].subgroups.length + 1
          });
        }
      }
    }

    this.groups = base;
  }

  /**
   * Obtiene todos los grupos comerciales ordenados por prioridad visual.
   * @param {Object} [options]
   * @param {boolean} [options.includeInactive=false]
   * @returns {Array<Object>}
   */
  getGroups(options = {}) {
    this._sincronizarGruposDesdeCatalogo();
    const includeInactive = options.includeInactive === true;
    return Object.values(this.groups)
      .filter(g => includeInactive || g.activo !== false)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Clasifica comercialmente una combinación artículo + envase delegando en el catálogo (vista COMERCIAL)
   * y enriqueciendo con calibre y categoría desde CalibreCategoria.js.
   *
   * @param {string|Object} articuloParam
   * @param {string} [envaseParam='']
   * @returns {Object}
   */
  resolve(articuloParam, envaseParam = '') {
    let artRaw = '';
    let envRaw = '';

    if (articuloParam && typeof articuloParam === 'object') {
      artRaw = articuloParam.nombre_articulo || articuloParam.nombreArticulo || articuloParam.articulo || articuloParam.codigo_articulo || '';
      envRaw = envaseParam || articuloParam.descripcion_envase || articuloParam.descripcionEnvase || articuloParam.envase || articuloParam.codigo_envase || '';
    } else {
      artRaw = String(articuloParam || '').trim();
      envRaw = String(envaseParam || '').trim();
    }

    const artNorm = normalizeCommercialText(artRaw);
    const envNorm = normalizeCommercialText(envRaw);
    const key = `${artNorm}|${envNorm}`;

    const extraerFn = obtenerExtractorCalibre_();
    const { categoria, calibre, calibreCategoria } = extraerFn(artRaw);

    this._sincronizarGruposDesdeCatalogo();
    const noClasificadoMeta = this.groups.NO_CLASIFICADO || {
      id: 'NO_CLASIFICADO',
      name: 'PENDIENTE DE ASOCIACIÓN'
    };

    if (!artNorm || !envNorm) {
      return {
        groupId: noClasificadoMeta.id,
        groupName: noClasificadoMeta.name,
        subgroupId: null,
        subgroupName: null,
        status: 'SIN_ENVASE',
        ruleId: 'SIN_ENVASE',
        categoria,
        calibre,
        calibreCategoria,
        articulo: artRaw,
        envase: envRaw,
        seguimiento: 'NO',
        atributos: { SEGUIMIENTO: 'NO' },
        agrupaciones: {},
        auditTrace: '[CATÁLOGO] Falta artículo o envase — SIN_ENVASE'
      };
    }

    if (this._historicalPendientes.has(key)) {
      const hist = this._historicalPendientes.get(key);
      return {
        groupId: hist.groupId,
        groupName: hist.groupName,
        subgroupId: hist.subgroupId || null,
        subgroupName: hist.subgroupName || null,
        status: hist.status || 'PENDIENTE_ASOCIACION',
        ruleId: hist.ruleId || 'HISTORICO_PENDIENTE_ASOCIACION',
        categoria,
        calibre,
        calibreCategoria,
        articulo: artRaw,
        envase: envRaw,
        seguimiento: 'SI',
        atributos: {},
        agrupaciones: {},
        auditTrace: `[CATÁLOGO] Pendiente histórico registrado (${hist.ruleId || 'HISTORICO_PENDIENTE_ASOCIACION'})`
      };
    }

    const explicacion = this.catalogoService
      ? this.catalogoService.explicar(artRaw, envRaw)
      : {
          seguimiento: 'NO',
          atributos: { SEGUIMIENTO: 'NO' },
          agrupaciones: {},
          origenPorAtributo: {},
          filaPorAgrupacion: {}
        };

    const vistaComercial = explicacion.agrupaciones && explicacion.agrupaciones.COMERCIAL
      ? explicacion.agrupaciones.COMERCIAL
      : null;

    const sinClasificar = !vistaComercial ||
      !vistaComercial.grupo ||
      String(vistaComercial.grupo).trim().toUpperCase() === 'SIN CLASIFICAR' ||
      String(vistaComercial.grupo).trim().toUpperCase() === 'NO_CLASIFICADO';

    if (sinClasificar) {
      const esRevisar = Boolean(explicacion.atributos && explicacion.atributos.REVISAR === 'SI');
      const esHistorico = this._historicalPendientes.has(key);

      let status = 'PENDIENTE_ASOCIACION';
      let ruleId = 'FALLBACK_PENDIENTE_ASOCIACION';

      if (esRevisar) {
        status = 'REVISAR';
        ruleId = (explicacion.origenPorAtributo && explicacion.origenPorAtributo.REVISAR)
          ? explicacion.origenPorAtributo.REVISAR
          : 'REVISAR';
      } else if (esHistorico) {
        status = 'PENDIENTE_ASOCIACION';
        ruleId = 'HISTORICO_PENDIENTE_ASOCIACION';
      }

      return {
        groupId: noClasificadoMeta.id,
        groupName: noClasificadoMeta.name,
        subgroupId: null,
        subgroupName: null,
        status,
        ruleId,
        categoria,
        calibre,
        calibreCategoria,
        articulo: artRaw,
        envase: envRaw,
        seguimiento: explicacion.seguimiento,
        atributos: explicacion.atributos,
        agrupaciones: explicacion.agrupaciones,
        auditTrace: `[CATÁLOGO] Sin coincidencia en agrupación COMERCIAL — ${status}`
      };
    }

    const groupId = String(vistaComercial.grupo).trim().toUpperCase();
    const groupMeta = this.groups[groupId];
    const groupName = groupMeta && groupMeta.name ? groupMeta.name : String(vistaComercial.grupo).trim();
    const subgroupId = vistaComercial.subgrupo ? String(vistaComercial.subgrupo).trim().toUpperCase() : null;
    const subgroupName = subgroupId;

    let ruleId = 'CATALOGO_CLASIFICADO';
    const origenes = explicacion.origenPorAtributo || {};
    const decisiones = explicacion.decisionesAtributos || {};
    const attrKeys = Object.keys(origenes).filter(k => k !== 'SEGUIMIENTO');
    const excKey = attrKeys.find(k => origenes[k] === 'CATALOGO');
    if (excKey) {
      const obs = decisiones[excKey] && decisiones[excKey].observaciones ? String(decisiones[excKey].observaciones).trim() : '';
      ruleId = obs || 'CATALOGO';
    } else if (attrKeys.length > 0) {
      ruleId = origenes[attrKeys[0]];
    }

    const ordenComercial = explicacion.filaPorAgrupacion && explicacion.filaPorAgrupacion.COMERCIAL
      ? explicacion.filaPorAgrupacion.COMERCIAL.orden
      : '?';

    return {
      groupId,
      groupName,
      subgroupId,
      subgroupName,
      status: 'CLASIFICADO',
      ruleId,
      categoria,
      calibre,
      calibreCategoria,
      articulo: artRaw,
      envase: envRaw,
      seguimiento: explicacion.seguimiento,
      atributos: explicacion.atributos,
      agrupaciones: explicacion.agrupaciones,
      auditTrace: `[CATÁLOGO] Agrupación COMERCIAL orden ${ordenComercial} -> ${groupId}${subgroupId ? ' / ' + subgroupId : ''}`
    };
  }

  /**
   * Alias de resolve().
   */
  classify(articulo, envase, options = {}) {
    return this.resolve(articulo, envase, options);
  }

  /**
   * Proporciona explicación detallada para una combinación.
   */
  explain(articulo, envase) {
    const classification = this.resolve(articulo, envase);
    const explicacionCatalogo = this.catalogoService
      ? this.catalogoService.explicar(articulo, envase)
      : null;
    return {
      articulo,
      envase,
      resultado: classification,
      explicacionCatalogo,
      trazaAuditoria: classification.auditTrace
    };
  }

  /**
   * Analiza un listado histórico de combinaciones preservando las ya clasificadas por el catálogo
   * y anotando las no clasificadas como pendientes de revisión.
   */
  loadHistoricalCatalog(catalogData, options = {}) {
    const preserveExisting = options.preserveExisting !== false;
    let records = [];

    if (typeof catalogData === 'string') {
      const lines = catalogData.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length > 1) {
        const header = lines[0].split(',').map(h => normalizeCommercialText(h.replace(/^"|"$/g, '')));
        const idxArt = header.findIndex(h => h.includes('ARTICULO'));
        const idxEnv = header.findIndex(h => h.includes('ENVASE'));
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
          records.push({
            articulo: cols[idxArt >= 0 ? idxArt : 0] || '',
            envase: cols[idxEnv >= 0 ? idxEnv : 1] || ''
          });
        }
      }
    } else if (Array.isArray(catalogData)) {
      records = catalogData;
    }

    let nuevosPendientes = 0;
    let existentesValidados = 0;
    const noClasificadoMeta = this.groups.NO_CLASIFICADO || {
      id: 'NO_CLASIFICADO',
      name: 'PENDIENTE DE ASOCIACIÓN'
    };

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec) continue;
      const art = rec.articulo || rec.nombre_articulo || rec.codigo_articulo || '';
      const env = rec.envase || rec.descripcion_envase || rec.codigo_envase || '';
      if (!art) continue;

      const res = this.resolve(art, env);
      const tieneClasificacionEspecifica = res.status === 'CLASIFICADO' && res.subgroupId !== 'OTROS';
      if (tieneClasificacionEspecifica && preserveExisting) {
        existentesValidados++;
        continue;
      }

      const key = this._buildKey(art, env);
      this._historicalPendientes.set(key, {
        id: key,
        articulo: String(art).trim(),
        envase: String(env).trim(),
        groupId: noClasificadoMeta.id,
        groupName: noClasificadoMeta.name,
        subgroupId: null,
        subgroupName: null,
        status: 'PENDIENTE_ASOCIACION',
        ruleId: 'HISTORICO_PENDIENTE_ASOCIACION',
        origen: 'HISTORICO_VENTAS',
        activo: true
      });
      nuevosPendientes++;
    }

    return {
      totalProcesados: records.length,
      nuevosPendientes,
      existentesValidados
    };
  }

  /**
   * Obtiene la lista de combinaciones pendientes registradas para revisión.
   * @returns {Array<Object>}
   */
  getCombinacionesPendientes() {
    return Array.from(this._historicalPendientes.values()).map(item => ({ ...item }));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CommercialGroupResolver,
    normalizeCommercialText,
    extraerCalibreYCategoria: obtenerExtractorCalibre_()
  };
}
