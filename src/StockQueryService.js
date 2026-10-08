/**
 * STOCK-LIGHT — StockQueryService.js
 * 
 * Capa de Consulta, Agregación y Agrupación Visual de Existencias.
 * 
 * REGLAS FUNDAMENTALES DE NEGOCIO:
 * 1. La unidad fundamental de existencia en STOCK-LIGHT es estrictamente:
 *    CODIGO_ARTICULO + CODIGO_ENVASE
 * 2. Los grupos de envase (ej. "EPS", "JAPI", "JAPONÉS CARTÓN", "OTROS") son
 *    EXCLUSIVAMENTE una capa de agregación, consulta y filtro visual.
 * 3. Los grupos NO intervienen en el cálculo de saldo, creación de movimientos,
 *    asignación/consumo de capas FIFO, ni en rebuildStock().
 * 4. La fuente de consulta rápida es directamente la tabla STOCK_ACTUAL,
 *    evitando reescanear MOVIMIENTOS o recalcular CAPAS_FIFO en tiempo de lectura.
 * 5. Los envases no mapeados o sin grupo asignado se clasifican de forma estricta
 *    y sin conjeturas como 'SIN_CLASIFICAR'.
 */

// Importaciones condicionales para entorno Node.js / Testing (aisladas sin 'var' para evitar colisiones en Apps Script V8)
let CommercialGroupResolverClass = null;
if (typeof require !== 'undefined') {
  const repoMod = require('./Repository');
  global.SheetsRepository = global.SheetsRepository || repoMod.SheetsRepository;
  try {
    const commercialMod = require('./CommercialGroupResolver');
    CommercialGroupResolverClass = commercialMod.CommercialGroupResolver;
  } catch (e) {
    // fallback
  }
} else if (typeof CommercialGroupResolver !== 'undefined') {
  CommercialGroupResolverClass = CommercialGroupResolver;
}

const DEFAULT_GRUPOS_ENVASE = [
  { codigo_envase: 'EPS104', descripcion_envase: 'EPS 104', grupo_envase: 'EPS', activo: true },
  { codigo_envase: 'EPS106', descripcion_envase: 'EPS 106 9x500', grupo_envase: 'EPS', activo: true },
  { codigo_envase: 'EPS154', descripcion_envase: 'EPS 154', grupo_envase: 'EPS', activo: true },
  { codigo_envase: 'CARTON', descripcion_envase: 'CARTON 40x30X9.7 MADERA 8X300', grupo_envase: 'JAPONÉS CARTÓN', activo: true },
  { codigo_envase: 'CT4395', descripcion_envase: 'CT4395 MORESCO', grupo_envase: 'JAPONÉS CARTÓN', activo: true },
  { codigo_envase: 'CT4395MAD', descripcion_envase: 'CT4395MAD', grupo_envase: 'JAPONÉS CARTÓN', activo: true },
  { codigo_envase: 'CT6412MAD', descripcion_envase: 'CT6412MAD10x500', grupo_envase: 'JAPONÉS CARTÓN', activo: true },
  { codigo_envase: 'CT6495MD', descripcion_envase: 'CT6495MD 10X300', grupo_envase: 'JAPONÉS CARTÓN', activo: true },
  { codigo_envase: 'CT4397MAD', descripcion_envase: 'CT4397MAD8X225', grupo_envase: 'JAPONÉS CARTÓN', activo: true }
];

class StockQueryService {
  /**
   * @param {Object} [options]
   * @param {SheetsRepository|Object} [options.repository]
   * @param {Array<Object>} [options.gruposEnvase] - Inyección opcional para testing
   * @param {Array<Object>} [options.stockActual] - Inyección opcional para testing
   * @param {Object} [options.commercialGroupResolver] - Instancia de CommercialGroupResolver
   */
  constructor(options = {}) {
    this.repo = options.repository || (typeof SheetsRepository !== 'undefined' ? new SheetsRepository() : null);
    this._gruposEnvaseOverride = options.gruposEnvase || null;
    this._stockActualOverride = options.stockActual || null;
    this._capasFifoOverride = options.capasFifo || null;
    this.commercialResolver = options.commercialGroupResolver || 
      (CommercialGroupResolverClass ? new CommercialGroupResolverClass() : null);
  }

  /**
   * Carga la configuración de grupos de envase y devuelve el mapa por código de envase
   * y la lista de nombres canónicos de grupo configurados y activos.
   * @private
   * @returns {{ mapa: Map<string, string>, gruposDefinidos: Array<string> }}
   */
  _obtenerDefinicionGrupos() {
    let grupos = [];
    if (this._gruposEnvaseOverride) {
      grupos = this._gruposEnvaseOverride;
    } else if (this.repo && typeof this.repo.getGruposEnvase === 'function') {
      try {
        grupos = this.repo.getGruposEnvase();
      } catch (e) {
        grupos = [];
      }
    }

    const mapa = new Map();
    const gruposDefinidos = new Set();

    if (Array.isArray(grupos)) {
      grupos.forEach(row => {
        const activo = row.activo !== undefined
          ? (row.activo === true || String(row.activo).toUpperCase() === 'TRUE' || row.activo === 1 || row.activo === '1')
          : true;
        if (!activo) return;

        const cod = String(row.codigo_envase || '').trim();
        const grp = String(row.grupo_envase || '').trim();
        if (cod) {
          mapa.set(cod, grp || 'SIN_CLASIFICAR');
        }
        if (grp) {
          gruposDefinidos.add(grp);
        }
      });
    }

    return { mapa, gruposDefinidos: Array.from(gruposDefinidos) };
  }

  /**
   * Obtiene la totalidad del stock actual enriquecido con la clasificación de grupo.
   * Lee directamente de STOCK_ACTUAL en O(N).
   * 
   * @returns {Array<Object>}
   */
  obtenerStockActual() {
    let rawStock = [];
    if (this._stockActualOverride) {
      rawStock = this._stockActualOverride;
    } else if (this.repo && typeof this.repo.getStockActual === 'function') {
      rawStock = this.repo.getStockActual();
    }

    const { mapa } = this._obtenerDefinicionGrupos();

    return (rawStock || []).map(rec => {
      const codEnvase = String(rec.codigo_envase || '').trim();
      const grupo = (codEnvase && mapa.has(codEnvase)) ? mapa.get(codEnvase) : 'SIN_CLASIFICAR';
      const cajas = Number(rec.cajas_actuales !== undefined ? rec.cajas_actuales : (rec.cajas || 0));

      let comm = null;
      if (this.commercialResolver && typeof this.commercialResolver.resolve === 'function') {
        comm = this.commercialResolver.resolve({
          codigo_articulo: rec.codigo_articulo,
          nombre_articulo: rec.nombre_articulo,
          codigo_envase: codEnvase,
          descripcion_envase: rec.descripcion_envase
        });
      }

      return {
        stock_key: rec.stock_key || `${rec.codigo_articulo}|${rec.codigo_envase}`,
        codigo_articulo: String(rec.codigo_articulo || ''),
        nombre_articulo: rec.nombre_articulo || '',
        codigo_envase: codEnvase,
        descripcion_envase: rec.descripcion_envase || '',
        cajas_actuales: cajas,
        cajas: cajas,
        grupo_envase: grupo,
        grupo: grupo,
        // Enriquecimiento comercial Fase 4:
        grupo_comercial_id: comm ? comm.groupId : 'NO_CLASIFICADO',
        grupo_comercial: comm ? comm.groupName : 'PENDIENTE DE ASOCIACIÓN',
        subgrupo_comercial_id: comm ? comm.subgroupId : null,
        subgrupo_comercial: comm ? comm.subgroupName : null,
        categoria: comm ? comm.categoria : 'ESTÁNDAR',
        calibre: comm ? comm.calibre : 'S/C',
        calibre_categoria: comm ? comm.calibreCategoria : 'ESTÁNDAR',
        estado_comercial: comm ? comm.status : 'PENDIENTE_ASOCIACION',
        regla_comercial_id: comm ? comm.ruleId : 'FALLBACK_PENDIENTE_ASOCIACION',
        fecha_ultima_actualizacion: rec.fecha_ultima_actualizacion || '',
        ultimo_movimiento_id: rec.ultimo_movimiento_id || ''
      };
    });
  }

  /**
   * Consulta y filtra las existencias actuales pertenecientes a un grupo específico.
   * La comparación es insensible a mayúsculas/minúsculas y espacios.
   * 
   * @param {string} grupo - Nombre del grupo a consultar (ej. 'EPS', 'JAPONÉS CARTÓN', 'SIN_CLASIFICAR')
   * @returns {Array<Object>}
   */
  obtenerStockPorGrupo(grupo) {
    if (!grupo || typeof grupo !== 'string') {
      grupo = 'SIN_CLASIFICAR';
    }
    const grupoNorm = grupo.trim().toUpperCase();
    const stock = this.obtenerStockActual();

    return stock.filter(item => {
      const itemGrupoNorm = String(item.grupo_envase || 'SIN_CLASIFICAR').trim().toUpperCase();
      return itemGrupoNorm === grupoNorm;
    });
  }

  /**
   * Genera un resumen agregado de existencias por grupo.
   * Devuelve cada grupo junto con el total consolidado de cajas.
   * 
   * @returns {Array<{ grupo: string, totalCajas: number, cajas: number, totalLineas: number }>}
   */
  obtenerResumenPorGrupos() {
    const stock = this.obtenerStockActual();
    const { gruposDefinidos } = this._obtenerDefinicionGrupos();

    const acumulador = new Map(); // normKey -> { grupo, totalCajas, cajas, totalLineas }

    // Pre-poblar los grupos formalmente configurados
    gruposDefinidos.forEach(g => {
      const normKey = g.trim().toUpperCase();
      if (!acumulador.has(normKey)) {
        acumulador.set(normKey, {
          grupo: g.trim(),
          totalCajas: 0,
          cajas: 0,
          totalLineas: 0
        });
      }
    });

    let tieneSinClasificar = false;

    // Agregar datos de existencias reales
    stock.forEach(item => {
      const grupo = item.grupo_envase || 'SIN_CLASIFICAR';
      const normKey = grupo.trim().toUpperCase();
      if (normKey === 'SIN_CLASIFICAR') {
        tieneSinClasificar = true;
      }

      if (!acumulador.has(normKey)) {
        acumulador.set(normKey, {
          grupo: grupo.trim(),
          totalCajas: 0,
          cajas: 0,
          totalLineas: 0
        });
      }

      const entry = acumulador.get(normKey);
      const cajas = Number(item.cajas_actuales || 0);
      entry.totalCajas += cajas;
      entry.cajas += cajas;
      entry.totalLineas += 1;
    });

    // Si SIN_CLASIFICAR no tiene stock y no fue definido explícitamente en la tabla, no se incluye
    if (!tieneSinClasificar && acumulador.has('SIN_CLASIFICAR') && !gruposDefinidos.some(g => g.trim().toUpperCase() === 'SIN_CLASIFICAR')) {
      acumulador.delete('SIN_CLASIFICAR');
    }

    return Array.from(acumulador.values());
  }

  /**
   * Obtiene el desglose detallado de existencias de un grupo particular,
   * incluyendo totales consolidados y las líneas unitarias de artículo y envase.
   * Si el grupo no tiene existencias, devuelve total 0 cajas y array vacío sin arrojar error.
   * 
   * @param {string} grupo 
   * @returns {{ grupo: string, totalCajas: number, cajas: number, totalLineas: number, lineas: Array<Object> }}
   */
  obtenerDetalleGrupo(grupo) {
    const grupoBuscado = (grupo && typeof grupo === 'string') ? grupo.trim() : 'SIN_CLASIFICAR';
    const lineas = this.obtenerStockPorGrupo(grupoBuscado);

    const totalCajas = lineas.reduce((acc, l) => acc + Number(l.cajas_actuales || 0), 0);

    return {
      grupo: grupoBuscado,
      totalCajas: totalCajas,
      cajas: totalCajas,
      totalLineas: lineas.length,
      lineas: lineas.map(l => ({
        stockKey: l.stock_key,
        codigoArticulo: l.codigo_articulo,
        nombreArticulo: l.nombre_articulo,
        codigoEnvase: l.codigo_envase,
        descripcionEnvase: l.descripcion_envase,
        cajas: l.cajas_actuales,
        cajasActuales: l.cajas_actuales,
        grupo: l.grupo_envase,
        grupoEnvase: l.grupo_envase,
        fechaUltimaActualizacion: l.fecha_ultima_actualizacion,
        ultimoMovimientoId: l.ultimo_movimiento_id
      }))
    };
  }

  /**
   * Consulta el registro de existencias de un par específico (artículo, envase).
   * 
   * @param {string} codigoArticulo 
   * @param {string} codigoEnvase 
   * @returns {Object|null}
   */
  obtenerDetalleStock(codigoArticulo, codigoEnvase) {
    if (!codigoArticulo || !codigoEnvase) return null;
    const art = String(codigoArticulo).trim();
    const env = String(codigoEnvase).trim();

    const stock = this.obtenerStockActual();
    const item = stock.find(l => l.codigo_articulo === art && l.codigo_envase === env);
    return item || null;
  }

  /**
   * Genera el resumen jerárquico visual de existencias por grupo comercial y subgrupo.
   * Diseñado específicamente para pantallas visuales y usuarios no técnicos (responsivo PC/tablet/móvil).
   * 
   * @returns {{
   *   grupos: Array<{
   *     groupId: string,
   *     groupName: string,
   *     order: number,
   *     totalCajas: number,
   *     totalLineas: number,
   *     tieneSubgrupos: boolean,
   *     subgrupos: Array<{ subgroupId: string, subgroupName: string, order: number, totalCajas: number, totalLineas: number }>
   *   }>,
   *   granTotalCajas: number,
   *   granTotalLineas: number,
   *   fechaConsulta: string
   * }}
   */
  obtenerStockVisualResumen() {
    const stock = this.obtenerStockActual();

    // Obtener grupos configurados desde el resolver comercial dinámico o base
    let baseGroups = [];
    if (this.commercialResolver && typeof this.commercialResolver.getGroups === 'function') {
      baseGroups = this.commercialResolver.getGroups();
    }
    if (!baseGroups || baseGroups.length === 0) {
      baseGroups = [
        { id: 'EPS', name: 'TOMATE EN CAJA EPS', order: 1, subgroups: [] },
        { id: 'HUEVO_TORO', name: 'TOMATE HUEVO DE TORO', order: 2, subgroups: [] },
        { id: 'VOLLEY', name: 'TOMATE VOLLEY Y CORAZÓN DE BUEY', order: 3, subgroups: [] },
        { id: 'JAPI_JAPONES', name: 'TOMATE JAPI Y JAPONÉS', order: 4, subgroups: [] },
        { 
          id: 'CARTON', 
          name: 'TOMATES EN CAJA DE CARTÓN', 
          order: 5, 
          subgroups: [
            { id: 'AZUL', name: 'AZUL', order: 1 },
            { id: 'ROSA', name: 'ROSA', order: 2 },
            { id: 'MORESCO', name: 'MORESCO', order: 3 },
            { id: 'OTROS', name: 'OTROS', order: 4 }
          ] 
        },
        { id: 'CARREFOUR', name: 'CARREFOUR', order: 6, subgroups: [] },
        { id: 'NO_CLASIFICADO', name: 'PENDIENTE DE ASOCIACIÓN', order: 99, subgroups: [] }
      ];
    }

    const groupMap = new Map();
    baseGroups.forEach(bg => {
      const subMap = new Map();
      const rawSubgroups = bg.subgroups || bg.subgruposDefs || bg.subgrupos || [];
      rawSubgroups.forEach(sg => {
        const sId = String(sg.id || sg.nombre || '').toUpperCase();
        const sName = String(sg.name || sg.nombre || sId);
        const sOrder = sg.order != null ? Number(sg.order) : (sg.orden_visual != null ? Number(sg.orden_visual) : 50);
        subMap.set(sId, {
          subgroupId: sId,
          subgroupName: sName,
          order: sOrder,
          totalCajas: 0,
          totalLineas: 0
        });
      });

      const gOrder = bg.order != null ? Number(bg.order) : (bg.orden_visual != null ? Number(bg.orden_visual) : 50);
      groupMap.set(bg.id, {
        groupId: bg.id,
        groupName: bg.name || bg.nombre || bg.id,
        order: gOrder,
        totalCajas: 0,
        totalLineas: 0,
        tieneSubgrupos: rawSubgroups.length > 0,
        subgruposMap: subMap
      });
    });

    let granTotalCajas = 0;
    let granTotalLineas = 0;

    stock.forEach(item => {
      const gId = item.grupo_comercial_id || 'NO_CLASIFICADO';
      const sgId = item.subgrupo_comercial_id || null;
      const cajas = Number(item.cajas_actuales || 0);

      granTotalCajas += cajas;
      granTotalLineas += 1;

      if (!groupMap.has(gId)) {
        groupMap.set(gId, {
          groupId: gId,
          groupName: item.grupo_comercial || gId,
          order: 90,
          totalCajas: 0,
          totalLineas: 0,
          tieneSubgrupos: false,
          subgruposMap: new Map()
        });
      }

      const grp = groupMap.get(gId);
      grp.totalCajas += cajas;
      grp.totalLineas += 1;

      if (sgId && grp.subgruposMap) {
        if (!grp.subgruposMap.has(sgId)) {
          grp.subgruposMap.set(sgId, {
            subgroupId: sgId,
            subgroupName: item.subgrupo_comercial || sgId,
            order: 50,
            totalCajas: 0,
            totalLineas: 0
          });
        }
        const sgrp = grp.subgruposMap.get(sgId);
        sgrp.totalCajas += cajas;
        sgrp.totalLineas += 1;
      }
    });

    const grupos = Array.from(groupMap.values()).map(g => {
      const subgrupos = Array.from(g.subgruposMap.values()).sort((a, b) => a.order - b.order);
      return {
        groupId: g.groupId,
        groupName: g.groupName,
        order: g.order,
        totalCajas: g.totalCajas,
        totalLineas: g.totalLineas,
        tieneSubgrupos: g.tieneSubgrupos || subgrupos.length > 0,
        subgrupos
      };
    }).sort((a, b) => a.order - b.order);

    return {
      grupos,
      granTotalCajas,
      granTotalLineas,
      fechaConsulta: new Date().toISOString()
    };
  }

  /**
   * Obtiene el desglose detallado de existencias para un grupo o subgrupo específico.
   * Permite llegar hasta el nivel de:
   * ARTÍCULO + ENVASE + CALIBRE/CATEGORÍA + CAJAS.
   * 
   * @param {string} groupId - ID del grupo comercial (ej. 'CARTON', 'EPS', 'CARREFOUR')
   * @param {string} [subgroupId=null] - ID opcional del subgrupo (ej. 'MORESCO', 'ROSA', 'AZUL')
   * @returns {{
   *   groupId: string,
   *   groupName: string,
   *   subgroupId: string|null,
   *   subgroupName: string|null,
   *   totalCajas: number,
   *   totalLineas: number,
   *   lineas: Array<Object>
   * }}
   */
  obtenerStockVisualDetalle(groupId, subgroupId = null) {
    if (!groupId) {
      throw new Error('obtenerStockVisualDetalle: Se requiere groupId.');
    }

    const targetGId = String(groupId).trim().toUpperCase();
    const targetSgId = subgroupId ? String(subgroupId).trim().toUpperCase() : null;

    const stock = this.obtenerStockActual();

    const lineasFiltradas = stock.filter(item => {
      const itemGId = String(item.grupo_comercial_id || 'NO_CLASIFICADO').trim().toUpperCase();
      if (itemGId !== targetGId) return false;

      if (targetSgId) {
        const itemSgId = String(item.subgrupo_comercial_id || '').trim().toUpperCase();
        return itemSgId === targetSgId;
      }
      return true;
    });

    const totalCajas = lineasFiltradas.reduce((sum, l) => sum + Number(l.cajas_actuales || 0), 0);

    let groupName = targetGId;
    let subgroupName = targetSgId;

    if (this.commercialResolver && this.commercialResolver.groups && this.commercialResolver.groups[targetGId]) {
      const gDef = this.commercialResolver.groups[targetGId];
      groupName = gDef.name;
      if (targetSgId && Array.isArray(gDef.subgroups)) {
        const sDef = gDef.subgroups.find(s => s.id.toUpperCase() === targetSgId);
        if (sDef) subgroupName = sDef.name;
      }
    } else if (lineasFiltradas.length > 0) {
      groupName = lineasFiltradas[0].grupo_comercial || targetGId;
      if (targetSgId) {
        subgroupName = lineasFiltradas[0].subgrupo_comercial || targetSgId;
      }
    }

    return {
      groupId: targetGId,
      groupName,
      subgroupId: targetSgId,
      subgroupName,
      totalCajas,
      totalLineas: lineasFiltradas.length,
      lineas: lineasFiltradas.map(l => ({
        stockKey: l.stock_key,
        codigoArticulo: l.codigo_articulo,
        nombreArticulo: l.nombre_articulo,
        codigoEnvase: l.codigo_envase,
        descripcionEnvase: l.descripcion_envase,
        cajas: l.cajas_actuales,
        cajasActuales: l.cajas_actuales,
        calibre: l.calibre || 'S/C',
        categoria: l.categoria || 'ESTÁNDAR',
        calibreCategoria: l.calibre_categoria || `${l.categoria || 'ESTÁNDAR'} - ${l.calibre || 'S/C'}`,
        groupId: l.grupo_comercial_id,
        groupName: l.grupo_comercial,
        subgroupId: l.subgrupo_comercial_id,
        subgroupName: l.subgrupo_comercial,
        status: l.estado_comercial,
        ruleId: l.regla_comercial_id
      }))
    };
  }

  /**
   * Consulta las capas FIFO vivas de un artículo + envase concreto para mostrar partidas (Nivel 5 de Drill-down).
   * Permite inspeccionar fecha de entrada, cajas iniciales, cajas consumidas y saldo restante por partida.
   * 
   * @param {string} codigoArticulo 
   * @param {string} codigoEnvase 
   * @param {Object} [options]
   * @param {boolean} [options.soloVivas=true] - Si solo incluye capas con saldo > 0
   * @returns {{
   *   codigoArticulo: string,
   *   codigoEnvase: string,
   *   totalPartidas: number,
   *   totalCajas: number,
   *   partidas: Array<{
   *     idCapa: string,
   *     partida: string,
   *     fechaEntrada: string,
   *     cajasIniciales: number,
   *     cajasConsumidas: number,
   *     cajasRestantes: number,
   *     saldo: number,
   *     estadoCapa: string,
   *     documentoRef: string
   *   }>
   * }}
   */
  obtenerDetallePartidas(codigoArticulo, codigoEnvase, options = {}) {
    if (!codigoArticulo || !codigoEnvase) {
      throw new Error('obtenerDetallePartidas: Se requiere codigoArticulo y codigoEnvase.');
    }
    const art = String(codigoArticulo).trim();
    const env = String(codigoEnvase).trim();
    const soloVivas = options.soloVivas !== false;

    let rawCapas = [];
    if (this._capasFifoOverride) {
      rawCapas = this._capasFifoOverride;
    } else if (this.repo && typeof this.repo.getCapasFifo === 'function') {
      rawCapas = this.repo.getCapasFifo();
    }

    const capasFiltradas = (rawCapas || []).filter(c => {
      const artMatch = String(c.codigo_articulo || '').trim() === art;
      const envMatch = String(c.codigo_envase || '').trim() === env;
      if (!artMatch || !envMatch) return false;
      const restantes = Number(c.cajas_restantes !== undefined ? c.cajas_restantes : (c.cajas_saldo !== undefined ? c.cajas_saldo : (Number(c.cajas_iniciales || 0) - Number(c.cajas_consumidas || 0))));
      if (soloVivas && restantes <= 0) return false;
      return true;
    });

    const partidas = capasFiltradas.map(c => {
      const iniciales = Number(c.cajas_iniciales || 0);
      const consumidas = Number(c.cajas_consumidas || 0);
      const restantes = Number(c.cajas_restantes !== undefined ? c.cajas_restantes : (c.cajas_saldo !== undefined ? c.cajas_saldo : (iniciales - consumidas)));
      return {
        idCapa: c.id_capa || c.capa_id,
        partida: c.partida || c.partida_id || 'SIN_PARTIDA',
        fechaEntrada: c.fecha_capa || c.fecha_entrada || '',
        cajasIniciales: iniciales,
        cajasConsumidas: consumidas,
        cajasRestantes: restantes,
        saldo: restantes,
        estadoCapa: c.estado_capa || (restantes > 0 ? (consumidas > 0 ? 'PARCIAL' : 'ABIERTA') : 'AGOTADA'),
        documentoRef: c.documento_ref || c.referencia_origen || ''
      };
    });

    const totalCajas = partidas.reduce((sum, p) => sum + p.cajasRestantes, 0);

    return {
      codigoArticulo: art,
      codigoEnvase: env,
      totalPartidas: partidas.length,
      totalCajas,
      partidas
    };
  }

  /**
   * Inicializa la tabla GRUPOS_ENVASE con la configuración base por defecto
   * si la tabla está actualmente vacía.
   * 
   * @returns {{ inicializado: boolean, count: number }}
   */
  inicializarGruposEnvaseDefault() {
    if (!this.repo) {
      throw new Error('SheetsRepository no está disponible.');
    }
    const actuales = this.repo.getGruposEnvase();
    if (actuales.length === 0) {
      this.repo.saveGruposEnvase(DEFAULT_GRUPOS_ENVASE);
      return { inicializado: true, count: DEFAULT_GRUPOS_ENVASE.length };
    }
    return { inicializado: false, count: actuales.length };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    StockQueryService,
    DEFAULT_GRUPOS_ENVASE
  };
}
