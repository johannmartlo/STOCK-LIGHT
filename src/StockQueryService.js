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
if (typeof require !== 'undefined') {
  const repoMod = require('./Repository');
  global.SheetsRepository = global.SheetsRepository || repoMod.SheetsRepository;
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
   */
  constructor(options = {}) {
    this.repo = options.repository || (typeof SheetsRepository !== 'undefined' ? new SheetsRepository() : null);
    this._gruposEnvaseOverride = options.gruposEnvase || null;
    this._stockActualOverride = options.stockActual || null;
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
