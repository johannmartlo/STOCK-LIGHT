/**
 * STOCK-LIGHT — InicioService.js
 *
 * Servicio de lectura agregada para la pantalla principal de Existencias y la ficha de partida (T-024):
 * - `obtenerInicio(options)`: lee cada hoja necesaria UNA SOLA VEZ y devuelve el resumen completo
 *   (total, serie de 30 días, variedades con partidas y procedencia `viene_de`, pendientes,
 *   destrío de 7 días, importado hasta y últimos 12 movimientos).
 * - `obtenerPartida(idCapa)`: devuelve la historia completa de una partida (origen, consumos y `se_convirtio_en`).
 *
 * Motivos de ajuste negativo que computan en `destrio7`:
 * - `DESTRIO`, `MERMA`, `ROTURA` y `DETERIORO` (además de `destrio_cajas` de los reprocesos no anulados).
 */

if (typeof require !== 'undefined') {
  try {
    const fechasMod = require('./Fechas');
    global.hoyMadrid = global.hoyMadrid || fechasMod.hoyMadrid;
    global.normalizarFechaNegocio = global.normalizarFechaNegocio || fechasMod.normalizarFechaNegocio;
  } catch (e) {}
  try {
    const normMod = require('./Normalizacion');
    global.normalizarNombre = global.normalizarNombre || normMod.normalizarNombre;
  } catch (e) {}
  try {
    const ordenMod = require('./OrdenExistencias');
    global.compararArticulos = global.compararArticulos || ordenMod.compararArticulos;
    global.construirDesgloseOrdenado = global.construirDesgloseOrdenado || ordenMod.construirDesgloseOrdenado;
  } catch (e) {}
}

const PALETA_VARIEDADES_INICIO_ = [
  '#4FA37C',
  '#F2553D',
  '#2DD4BF',
  '#F5A3B5',
  '#EC4899',
  '#60A5FA'
];

const MOTIVOS_DESTRIO_INICIO_ = new Set([
  'DESTRIO',
  'MERMA',
  'ROTURA',
  'DETERIORO'
]);

function _normTextoInicio_(texto) {
  const fn = typeof normalizarNombre === 'function'
    ? normalizarNombre
    : (typeof global !== 'undefined' && typeof global.normalizarNombre === 'function' ? global.normalizarNombre : null);
  if (typeof fn === 'function') return fn(texto);
  return String(texto === null || texto === undefined ? '' : texto).trim().replace(/\s+/g, ' ').toUpperCase();
}

function _normFechaInicio_(valor) {
  if (valor === undefined || valor === null || valor === '') return '';
  const fn = typeof normalizarFechaNegocio === 'function'
    ? normalizarFechaNegocio
    : (typeof global !== 'undefined' && typeof global.normalizarFechaNegocio === 'function' ? global.normalizarFechaNegocio : null);
  if (typeof fn === 'function') {
    try {
      return fn(valor);
    } catch (e) {
      // Fallback defensivo para textos sueltos
    }
  }
  const s = String(valor).trim();
  const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`;
  return '';
}

function _hoyInicio_(reloj) {
  const fn = typeof hoyMadrid === 'function'
    ? hoyMadrid
    : (typeof global !== 'undefined' && typeof global.hoyMadrid === 'function' ? global.hoyMadrid : null);
  if (typeof fn === 'function') return fn(reloj);
  const d = reloj ? new Date(reloj) : new Date();
  return d.toISOString().slice(0, 10);
}

function _sumarDiasIsoInicio_(iso, deltaDias) {
  const parts = String(iso || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return iso;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + Number(deltaDias || 0)));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function _diferenciaDiasIsoInicio_(fechaAntigua, fechaReciente) {
  const a = String(fechaAntigua || '').split('-').map(Number);
  const b = String(fechaReciente || '').split('-').map(Number);
  if (a.length !== 3 || b.length !== 3) return 0;
  if (a.some(n => !Number.isFinite(n)) || b.some(n => !Number.isFinite(n))) return 0;
  const msA = Date.UTC(a[0], a[1] - 1, a[2]);
  const msB = Date.UTC(b[0], b[1] - 1, b[2]);
  return Math.max(0, Math.round((msB - msA) / 86400000));
}

function _leerTablaSeguraInicio_(fn) {
  try {
    const res = fn();
    return Array.isArray(res) ? res : [];
  } catch (e) {
    if (e && e.message && String(e.message).includes('no existe')) {
      return [];
    }
    throw e;
  }
}

function _esFilaActivaInicio_(val) {
  if (val === false) return false;
  const s = String(val === undefined || val === null ? 'TRUE' : val).trim().toUpperCase();
  return s !== 'FALSE' && s !== 'NO' && s !== '0';
}

class InicioService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.repository]
   * @param {Object} [options.catalogoService]
   * @param {Object} [options.pendientesService]
   * @param {Object} [options.configCatalogo]
   * @param {Function|Date|string} [options.reloj]
   */
  constructor(options = {}) {
    const RepoClass = (typeof SheetsRepository !== 'undefined')
      ? SheetsRepository
      : (typeof require !== 'undefined' ? require('./Repository').SheetsRepository : null);
    if (!RepoClass && !options.repository) {
      throw new Error('SheetsRepository no está disponible en InicioService');
    }
    this.repo = options.repository || new RepoClass();

    const CatalogoClass = (typeof CatalogoService !== 'undefined')
      ? CatalogoService
      : (typeof require !== 'undefined' ? require('./CatalogoService').CatalogoService : null);
    this.catalogoService = options.catalogoService || (CatalogoClass
      ? new CatalogoClass({
        repository: this.repo,
        config: options.configCatalogo || options.config || null
      })
      : null);

    this.pendientesService = options.pendientesService || null;
    this.operacionesService = options.operacionesService || null;
    this.reloj = options.reloj !== undefined ? options.reloj : null;

    const CierreClass = (typeof CierreService !== 'undefined')
      ? CierreService
      : (typeof require !== 'undefined' ? require('./CierreService').CierreService : null);
    this.cierreService = options.cierreService !== undefined
      ? options.cierreService
      : (CierreClass
        ? new CierreClass({
          repository: this.repo,
          catalogoService: this.catalogoService,
          reloj: this.reloj
        })
        : null);
  }

  _resolverOperacionesService_() {
    if (this.operacionesService) return this.operacionesService;
    const OpsClass = (typeof OperacionesService !== 'undefined')
      ? OperacionesService
      : (typeof require !== 'undefined' ? require('./OperacionesService').OperacionesService : null);
    if (!OpsClass) return null;
    return new OpsClass({
      repository: this.repo,
      catalogoService: this.catalogoService
    });
  }

  _resolverPendientesService_() {
    if (this.pendientesService) return this.pendientesService;
    const PendClass = (typeof PendientesService !== 'undefined')
      ? PendientesService
      : (typeof require !== 'undefined' ? require('./importacion/PendientesService').PendientesService : null);
    if (!PendClass) return null;
    return new PendClass({
      repository: this.repo,
      catalogoService: this.catalogoService
    });
  }

  _clasificadorPuro_() {
    if (typeof clasificarCombinacion === 'function') return clasificarCombinacion;
    if (typeof global !== 'undefined' && typeof global.clasificarCombinacion === 'function') {
      return global.clasificarCombinacion;
    }
    if (typeof require !== 'undefined') {
      try {
        return require('./Catalogo').clasificarCombinacion;
      } catch (e) {}
    }
    return null;
  }

  /**
   * Construye la lista ordenada de definiciones de grupos de la agrupación COMERCIAL.
   * @private
   */
  _definirGruposComerciales_(agrupaciones) {
    const filas = (Array.isArray(agrupaciones) ? agrupaciones : [])
      .filter(f => f && _esFilaActivaInicio_(f.activo !== undefined ? f.activo : f.activa))
      .filter(f => _normTextoInicio_(f.agrupacion) === 'COMERCIAL')
      .map((f, idx) => ({
        fila: f,
        orden: Number.isFinite(Number(f.orden)) ? Number(f.orden) : Number.MAX_SAFE_INTEGER,
        idx
      }));

    filas.sort((a, b) => (a.orden !== b.orden ? a.orden - b.orden : a.idx - b.idx));

    const mapa = new Map();
    const lista = [];
    for (const item of filas) {
      const f = item.fila;
      const grupo = String(f.grupo || '').trim() || 'SIN CLASIFICAR';
      const claveGrupo = _normTextoInicio_(grupo);
      if (!mapa.has(claveGrupo)) {
        const idxColor = lista.length;
        const def = {
          clave: claveGrupo,
          grupo,
          orden: item.orden,
          color: '',
          dias_aviso: null,
          stock_bajo: null
        };
        mapa.set(claveGrupo, def);
        lista.push(def);
        def._paletaIdx = idxColor;
      }
      const def = mapa.get(claveGrupo);
      if (!def.color && f.color !== undefined && f.color !== null && String(f.color).trim() !== '') {
        def.color = String(f.color).trim();
      }
      if (def.dias_aviso === null && f.dias_aviso !== undefined && f.dias_aviso !== null && String(f.dias_aviso).trim() !== '') {
        const d = Number(f.dias_aviso);
        if (Number.isFinite(d) && d >= 0) def.dias_aviso = d;
      }
      if (def.stock_bajo === null && f.stock_bajo !== undefined && f.stock_bajo !== null && String(f.stock_bajo).trim() !== '') {
        const sb = Number(f.stock_bajo);
        if (Number.isFinite(sb) && sb >= 0) def.stock_bajo = sb;
      }
    }

    for (const def of lista) {
      if (!def.color) {
        def.color = PALETA_VARIEDADES_INICIO_[def._paletaIdx % PALETA_VARIEDADES_INICIO_.length];
      }
      if (def.dias_aviso === null) {
        def.dias_aviso = 4;
      }
      delete def._paletaIdx;
    }

    return { lista, mapa };
  }

  /**
   * Construye mapas de reprocesos activos y sus líneas (ORIGEN / DESTINO) en un único paso.
   * @private
   */
  _indexarReprocesos_(reprocesos, reprocesoLineas) {
    const reprocesosActivos = new Map();
    for (const r of reprocesos) {
      if (!r || !r.id_reproceso) continue;
      const est = String(r.estado || '').trim().toUpperCase();
      if (est === 'ANULADO') continue;
      reprocesosActivos.set(String(r.id_reproceso).trim(), r);
    }

    const origenesPorReproceso = new Map();
    const destinosPorReproceso = new Map();
    const destinoPorCapa = new Map();
    const origenesPorCapa = new Map();
    const reprocesoPorMov = new Map();

    for (const l of reprocesoLineas) {
      if (!l || !l.id_reproceso) continue;
      const idRep = String(l.id_reproceso).trim();
      if (!reprocesosActivos.has(idRep)) continue;

      const tipo = String(l.tipo || '').trim().toUpperCase();
      const idCapa = String(l.id_capa || '').trim();
      const idMov = String(l.id_movimiento || '').trim();
      if (idMov) reprocesoPorMov.set(idMov, idRep);

      if (tipo === 'ORIGEN') {
        if (!origenesPorReproceso.has(idRep)) origenesPorReproceso.set(idRep, []);
        origenesPorReproceso.get(idRep).push(l);
        if (idCapa) {
          if (!origenesPorCapa.has(idCapa)) origenesPorCapa.set(idCapa, []);
          origenesPorCapa.get(idCapa).push(l);
        }
      } else if (tipo === 'DESTINO') {
        if (!destinosPorReproceso.has(idRep)) destinosPorReproceso.set(idRep, []);
        destinosPorReproceso.get(idRep).push(l);
        if (idCapa) {
          destinoPorCapa.set(idCapa, l);
        }
      }
    }

    return {
      reprocesosActivos,
      origenesPorReproceso,
      destinosPorReproceso,
      destinoPorCapa,
      origenesPorCapa,
      reprocesoPorMov
    };
  }

  _construirVieneDe_(idCapa, idxRep) {
    const lineaDest = idxRep.destinoPorCapa.get(String(idCapa || '').trim());
    if (!lineaDest) return null;
    const idRep = String(lineaDest.id_reproceso || '').trim();
    const rep = idxRep.reprocesosActivos.get(idRep);
    if (!rep) return null;

    const origs = idxRep.origenesPorReproceso.get(idRep) || [];
    return {
      id_reproceso: idRep,
      fecha: _normFechaInicio_(rep.fecha) || _normFechaInicio_(lineaDest.fecha_capa),
      fecha_hora: rep.fecha_hora || '',
      usuario: rep.usuario || '',
      destrio_cajas: Number(rep.destrio_cajas || 0),
      origenes: origs.map(o => ({
        id_capa: String(o.id_capa || '').trim(),
        proveedor: String(o.proveedor || '').trim(),
        fecha_capa: _normFechaInicio_(o.fecha_capa),
        articulo: String(o.codigo_articulo || '').trim(),
        envase: String(o.codigo_envase || '').trim(),
        cajas: Number(o.cajas || 0)
      }))
    };
  }

  /**
   * Devuelve el payload agregado de la pantalla de inicio (Existencias).
   * Lee cada hoja necesaria una sola vez.
   *
   * @param {Object} [options]
   * @param {string|Date} [options.hoy] - Fecha de referencia (YYYY-MM-DD)
   * @returns {Object}
   */
  obtenerInicio(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};

    // 1. Lectura única por hoja
    const movimientos = _leerTablaSeguraInicio_(() => (typeof this.repo.getMovimientos === 'function' ? this.repo.getMovimientos() : []));
    const capas = _leerTablaSeguraInicio_(() => (typeof this.repo.getCapasFifo === 'function' ? this.repo.getCapasFifo() : []));
    const reprocesos = _leerTablaSeguraInicio_(() => (typeof this.repo.getReprocesos === 'function' ? this.repo.getReprocesos() : []));
    const reprocesoLineas = _leerTablaSeguraInicio_(() => (typeof this.repo.getReprocesoLineas === 'function' ? this.repo.getReprocesoLineas() : []));
    const documentos = _leerTablaSeguraInicio_(() => (typeof this.repo.getDocumentos === 'function' ? this.repo.getDocumentos() : []));

    const pendSvc = this._resolverPendientesService_();
    const pendientesResumen = (pendSvc && typeof pendSvc.listarPendientes === 'function')
      ? pendSvc.listarPendientes({ estado: 'PENDIENTE' })
      : { totalFilas: 0, totalDocumentos: 0, porMotivo: {} };

    const catalogoConfig = (this.catalogoService && typeof this.catalogoService.obtenerConfiguracion === 'function')
      ? this.catalogoService.obtenerConfiguracion()
      : { atributos: [], reglas: [], catalogo: [], agrupaciones: [] };

    // 2. Clasificación con caché por par (articulo, envase) para O(U) en lugar de O(M)
    const clasificarFn = this._clasificadorPuro_();
    const clasifCache = new Map();
    const { lista: defsGrupos, mapa: mapaDefsGrupos } = this._definirGruposComerciales_(catalogoConfig.agrupaciones);
    const tieneSinClasificarEnComercial = mapaDefsGrupos.has('SIN CLASIFICAR');

    const obtenerGrupoParaPar = (art, env) => {
      const nArt = _normTextoInicio_(art);
      const nEnv = _normTextoInicio_(env);
      const key = `${nArt}|${nEnv}`;
      if (clasifCache.has(key)) return clasifCache.get(key);

      let grupoRaw = 'SIN CLASIFICAR';
      let subgrupo = '';
      if (typeof clasificarFn === 'function') {
        const res = clasificarFn(nArt, nEnv, catalogoConfig);
        if (res && res.cajones && res.cajones.COMERCIAL && res.cajones.COMERCIAL.grupo) {
          grupoRaw = String(res.cajones.COMERCIAL.grupo).trim();
          subgrupo = res.cajones.COMERCIAL.subgrupo ? String(res.cajones.COMERCIAL.subgrupo).trim() : '';
        }
      }

      const claveNorm = _normTextoInicio_(grupoRaw);
      let claveDestino = '__SIN_AGRUPAR__';
      if (mapaDefsGrupos.has(claveNorm) && (claveNorm !== 'SIN CLASIFICAR' || tieneSinClasificarEnComercial)) {
        claveDestino = claveNorm;
      }

      const info = { claveGrupo: claveDestino, grupoRaw, subgrupo };
      clasifCache.set(key, info);
      return info;
    };

    // 3. Indexar movimientos confirmados en una sola pasada y determinar fechaFin y fechaInicioDatos
    const movsConfirmados = [];
    const movById = new Map();
    const docIdsCsv = new Set();
    let maxFechaMov = '';
    let maxFechaStockInicial = '';

    for (let i = 0; i < movimientos.length; i++) {
      const m = movimientos[i];
      if (!m) continue;
      if (String(m.estado || '').trim().toUpperCase() !== 'CONFIRMADO') continue;

      const fechaNeg = _normFechaInicio_(m.fecha_negocio) || _normFechaInicio_(m.fecha_hora);
      if (fechaNeg && (!maxFechaMov || fechaNeg > maxFechaMov)) {
        maxFechaMov = fechaNeg;
      }
      const motMov = String(m.motivo_ajuste || '').trim().toUpperCase();
      const origMov = String(m.origen_dato || '').trim().toUpperCase();
      if ((motMov === 'STOCK_INICIAL' || origMov === 'STOCK_INICIAL') && fechaNeg) {
        if (!maxFechaStockInicial || fechaNeg > maxFechaStockInicial) {
          maxFechaStockInicial = fechaNeg;
        }
      }
      if (origMov === 'CSV' && m.id_documento_ref) {
        docIdsCsv.add(String(m.id_documento_ref).trim());
      }

      const item = { raw: m, fechaNeg, idx: i };
      movsConfirmados.push(item);
      if (m.id_movimiento) {
        movById.set(String(m.id_movimiento).trim(), m);
      }
    }

    let fechaCorteInicio = '';
    try {
      const fnCorte = typeof getFechaCorteImportacionConfig === 'function'
        ? getFechaCorteImportacionConfig
        : (typeof global !== 'undefined' && typeof global.getFechaCorteImportacionConfig === 'function'
          ? global.getFechaCorteImportacionConfig
          : (typeof require !== 'undefined' ? require('./Config').getFechaCorteImportacionConfig : null));
      if (typeof fnCorte === 'function') {
        fechaCorteInicio = fnCorte({
          fechaCorte: opts.fechaCorte !== undefined ? opts.fechaCorte : undefined,
          propertiesService: opts.propertiesService || undefined
        }) || '';
      }
    } catch (e) {
      fechaCorteInicio = '';
    }
    const fechaInicioDatos = fechaCorteInicio || maxFechaStockInicial;

    let fechaFin = opts.hoy ? _normFechaInicio_(opts.hoy) : _hoyInicio_(this.reloj);
    if (!opts.hoy && maxFechaMov && maxFechaMov > fechaFin) {
      fechaFin = maxFechaMov;
    }
    const fechaInicio30 = _sumarDiasIsoInicio_(fechaFin, -29);
    const fechaHace7 = _sumarDiasIsoInicio_(fechaFin, -7);
    const fechaInicio7 = _sumarDiasIsoInicio_(fechaFin, -6);

    // Construir array de 30 fechas
    const fechas30 = [];
    const idxPorFecha30 = new Map();
    for (let d = 0; d < 30; d++) {
      const f = _sumarDiasIsoInicio_(fechaInicio30, d);
      fechas30.push(f);
      idxPorFecha30.set(f, d);
    }

    const deltaStock30 = new Array(30).fill(0);
    const entradas30 = new Array(30).fill(0);
    const salidas30 = new Array(30).fill(0);
    let stockPrevio30 = 0;
    let destrioAjustes7 = 0;

    // Acumuladores por grupo para tendencia7 (cajas hoy vs hace 7 días y últimos 7 días)
    const stockBaseHace7PorGrupo = new Map();
    const delta7PorGrupo = new Map(); // Array(7) por claveGrupo

    const asegurarDelta7 = (claveGrupo) => {
      if (!delta7PorGrupo.has(claveGrupo)) {
        delta7PorGrupo.set(claveGrupo, new Array(7).fill(0));
      }
      return delta7PorGrupo.get(claveGrupo);
    };

    for (const item of movsConfirmados) {
      const m = item.raw;
      const fecha = item.fechaNeg;
      const cajas = Math.abs(Number(m.cajas || 0));
      const signo = Number(m.signo || 0);
      const delta = signo * cajas;
      const tipo = String(m.tipo_movimiento || '').trim().toUpperCase();
      const motivo = String(m.motivo_ajuste || '').trim().toUpperCase();
      const origenDato = String(m.origen_dato || '').trim().toUpperCase();
      const esStockInicial = motivo === 'STOCK_INICIAL' || origenDato === 'STOCK_INICIAL';

      // Serie 30 días
      if (!fecha || fecha < fechaInicio30) {
        stockPrevio30 += delta;
      } else {
        const idx30 = idxPorFecha30.get(fecha);
        if (idx30 !== undefined) {
          deltaStock30[idx30] += delta;

          if (tipo === 'ENTRADA' && !esStockInicial) {
            entradas30[idx30] += cajas;
          } else if (tipo === 'SALIDA') {
            salidas30[idx30] += cajas;
          } else if (tipo === 'ANULACION') {
            const refMov = m.id_movimiento_ref ? movById.get(String(m.id_movimiento_ref).trim()) : null;
            const refTipo = refMov ? String(refMov.tipo_movimiento || '').trim().toUpperCase() : '';
            const refEsStockInicial = Boolean(refMov && (
              String(refMov.motivo_ajuste || '').trim().toUpperCase() === 'STOCK_INICIAL'
              || String(refMov.origen_dato || '').trim().toUpperCase() === 'STOCK_INICIAL'
            ));
            if ((refTipo === 'ENTRADA' && !refEsStockInicial) || (!refTipo && motivo === 'ANULAR_ENTRADA')) {
              entradas30[idx30] -= cajas;
            } else if (refTipo === 'SALIDA' || (!refTipo && motivo === 'ANULAR_SALIDA')) {
              salidas30[idx30] -= cajas;
            }
          }
        }
      }

      // Destrío en ajustes negativos últimos 7 días
      if (fecha && fecha >= fechaInicio7 && fecha <= fechaFin && tipo === 'AJUSTE' && signo === -1 && MOTIVOS_DESTRIO_INICIO_.has(motivo)) {
        destrioAjustes7 += cajas;
      }

      // Evolución 7 días por variedad
      const { claveGrupo } = obtenerGrupoParaPar(m.codigo_articulo, m.codigo_envase);
      if (!fecha || fecha <= fechaHace7) {
        stockBaseHace7PorGrupo.set(claveGrupo, (stockBaseHace7PorGrupo.get(claveGrupo) || 0) + delta);
      } else if (fecha >= fechaInicio7 && fecha <= fechaFin) {
        const diaIdx = _diferenciaDiasIsoInicio_(fechaInicio7, fecha);
        if (diaIdx >= 0 && diaIdx < 7) {
          asegurarDelta7(claveGrupo)[diaIdx] += delta;
        }
      }
    }

    let stockAcumulado = stockPrevio30;
    const serie = [];
    for (let d = 0; d < 30; d++) {
      stockAcumulado += deltaStock30[d];
      const fechaDia = fechas30[d];
      const anteriorInicio = Boolean(fechaInicioDatos && fechaDia < fechaInicioDatos);
      serie.push({
        fecha: fechaDia,
        stock: anteriorInicio ? null : stockAcumulado,
        entradas: entradas30[d],
        salidas: salidas30[d]
      });
    }

    // 4. Reprocesos: indexación y destrío 7 días
    const idxRep = this._indexarReprocesos_(reprocesos, reprocesoLineas);
    let destrioReprocesos7 = 0;
    for (const rep of idxRep.reprocesosActivos.values()) {
      const fRep = _normFechaInicio_(rep.fecha) || _normFechaInicio_(rep.fecha_hora);
      if (fRep && fRep >= fechaInicio7 && fRep <= fechaFin) {
        destrioReprocesos7 += Math.max(0, Number(rep.destrio_cajas || 0));
      }
    }
    const destrio7 = destrioReprocesos7 + destrioAjustes7;

    // 5. Capas vivas agrupadas por variedad COMERCIAL
    const partidasPorGrupo = new Map();
    let totalCapasVivas = 0;

    for (const capa of capas) {
      if (!capa) continue;
      const estCapa = String(capa.estado_capa || '').trim().toUpperCase();
      const cajasRest = Number(capa.cajas_restantes || 0);
      if (estCapa === 'ANULADA' || cajasRest <= 0) continue;

      totalCapasVivas += cajasRest;
      const art = String(capa.codigo_articulo || '').trim();
      const env = String(capa.codigo_envase || '').trim();
      const { claveGrupo } = obtenerGrupoParaPar(art, env);
      if (!partidasPorGrupo.has(claveGrupo)) {
        partidasPorGrupo.set(claveGrupo, []);
      }

      const idCapa = String(capa.id_capa || '').trim();
      const fechaCapa = _normFechaInicio_(capa.fecha_capa);
      const dias = fechaCapa ? _diferenciaDiasIsoInicio_(fechaCapa, fechaFin) : 0;

      partidasPorGrupo.get(claveGrupo).push({
        id_capa: idCapa,
        proveedor: String(capa.proveedor || '').trim(),
        fecha: fechaCapa,
        articulo: art,
        envase: env,
        cajas: cajasRest,
        cajas_iniciales: Number(capa.cajas_iniciales || cajasRest),
        dias,
        viene_de: this._construirVieneDe_(idCapa, idxRep)
      });
    }

    const total = totalCapasVivas;
    // Asegurar coherencia si el libro tuviera diferencia frente a serie cuando no hay capas vs movimientos
    if (serie.length > 0 && serie[serie.length - 1].stock !== total && movsConfirmados.length === 0) {
      serie[serie.length - 1].stock = total;
    }

    const construirVariedad = (def) => {
      const partidas = partidasPorGrupo.get(def.clave) || [];
      if (partidas.length === 0) return null;

      // Orden de la ficha (T-039): artículo por variedad/categoría/calibre y, a igualdad,
      // fecha ascendente y después id_capa (el desempate que había antes).
      partidas.sort((a, b) => {
        const cmpArticulo = compararArticulos(a, b);
        if (cmpArticulo !== 0) return cmpArticulo;
        if (a.fecha !== b.fecha) {
          if (!a.fecha) return 1;
          if (!b.fecha) return -1;
          return a.fecha < b.fecha ? -1 : 1;
        }
        return a.id_capa < b.id_capa ? -1 : (a.id_capa > b.id_capa ? 1 : 0);
      });

      const cajas = partidas.reduce((acc, p) => acc + p.cajas, 0);
      // `partidas[0]` ya no es la más antigua: sale_primero y dias miran el mínimo de fecha.
      let partidaMasAntigua = partidas[0];
      for (const partida of partidas) {
        if (!partida.fecha) continue;
        if (!partidaMasAntigua || !partidaMasAntigua.fecha || partida.fecha < partidaMasAntigua.fecha) {
          partidaMasAntigua = partida;
        }
      }
      const salePrimero = partidaMasAntigua ? partidaMasAntigua.fecha : '';
      const diasAntiguedad = partidaMasAntigua ? partidaMasAntigua.dias : 0;
      const avisoAntiguedad = diasAntiguedad >= def.dias_aviso;

      const baseHace7 = Number(stockBaseHace7PorGrupo.get(def.clave) || 0);
      const deltas7 = delta7PorGrupo.get(def.clave) || [0, 0, 0, 0, 0, 0, 0];
      const serie7 = [];
      let s7 = baseHace7;
      for (let k = 0; k < 7; k++) {
        s7 += deltas7[k];
        serie7.push(s7);
      }

      const tendencia7 = cajas - baseHace7;

      return {
        grupo: def.grupo,
        color: def.color,
        cajas,
        partidas,
        desglose: construirDesgloseOrdenado(partidas),
        sale_primero: salePrimero,
        dias: diasAntiguedad,
        dias_aviso: def.dias_aviso,
        aviso_antiguedad: avisoAntiguedad,
        stock_bajo: def.stock_bajo,
        aviso_stock_bajo: def.stock_bajo !== null ? cajas <= def.stock_bajo : false,
        tendencia7,
        serie7
      };
    };

    const variedades = [];
    for (const def of defsGrupos) {
      const v = construirVariedad(def);
      if (v) variedades.push(v);
    }

    const sinAgruparDef = {
      clave: '__SIN_AGRUPAR__',
      grupo: 'Sin agrupar',
      color: PALETA_VARIEDADES_INICIO_[variedades.length % PALETA_VARIEDADES_INICIO_.length],
      dias_aviso: 4,
      stock_bajo: null
    };
    const sinAgruparVar = construirVariedad(sinAgruparDef);
    if (sinAgruparVar) {
      variedades.push(sinAgruparVar);
    }

    // 6. Pendientes: recuento por motivo (documentos y filas)
    const porMotivoDocs = {};
    const porMotivoFilas = {};
    const bloques = (pendientesResumen && pendientesResumen.porMotivo) ? pendientesResumen.porMotivo : {};
    for (const mot of Object.keys(bloques)) {
      porMotivoDocs[mot] = Number(bloques[mot].totalDocumentos || 0);
      porMotivoFilas[mot] = Number(bloques[mot].totalFilas || 0);
    }
    const pendientes = {
      total: Number(pendientesResumen.totalDocumentos || 0),
      totalDocumentos: Number(pendientesResumen.totalDocumentos || 0),
      totalFilas: Number(pendientesResumen.totalFilas || 0),
      porMotivo: porMotivoDocs,
      filasPorMotivo: porMotivoFilas
    };

    // 7. Importado hasta (por CSV, compras y ventas por separado)
    let maxComprasCsv = '';
    let maxVentasCsv = '';
    for (const doc of documentos) {
      if (!doc) continue;
      const est = String(doc.estado_proceso || '').trim().toUpperCase();
      if (est !== 'CONFIRMADO' && est !== 'CONFIRMADO_PARCIAL') continue;
      const esCsv = Boolean(String(doc.firma_lineas || '').trim()) || docIdsCsv.has(String(doc.id_documento || '').trim());
      if (!esCsv) continue;

      const fDoc = _normFechaInicio_(doc.fecha_documento);
      if (!fDoc) continue;

      const tDoc = String(doc.tipo_documento || '').trim().toUpperCase();
      if (tDoc === 'COMPRA' || tDoc === 'ENTRADA') {
        if (!maxComprasCsv || fDoc > maxComprasCsv) maxComprasCsv = fDoc;
      } else if (tDoc === 'SALIDA' || tDoc === 'VENTA') {
        if (!maxVentasCsv || fDoc > maxVentasCsv) maxVentasCsv = fDoc;
      }
    }
    const importadoHasta = {
      compras: maxComprasCsv || null,
      ventas: maxVentasCsv || null
    };

    // 8. Últimos 12 movimientos vía OperacionesService.listarMovimientos({ limite: 12 }) (T-025)
    const opsSvc = this._resolverOperacionesService_();
    const resMovs = (opsSvc && typeof opsSvc.listarMovimientos === 'function')
      ? opsSvc.listarMovimientos({ limite: 12 })
      : { grupos: [] };

    const reprocesosTodos = new Map();
    for (const r of reprocesos) {
      if (r && r.id_reproceso) {
        reprocesosTodos.set(String(r.id_reproceso).trim(), r);
      }
    }
    const lineasPorRepTodos = new Map();
    for (const l of reprocesoLineas) {
      if (!l || !l.id_reproceso) continue;
      const idRep = String(l.id_reproceso).trim();
      if (!lineasPorRepTodos.has(idRep)) lineasPorRepTodos.set(idRep, []);
      lineasPorRepTodos.get(idRep).push(l);
    }

    const aplanados = [];
    for (const grupo of (resMovs && Array.isArray(resMovs.grupos) ? resMovs.grupos : [])) {
      for (const el of (grupo && Array.isArray(grupo.elementos) ? grupo.elementos : [])) {
        aplanados.push(el);
      }
    }

    const ultimos = aplanados.slice(0, 12).map(el => {
      const tipoRaw = String(el.tipo || '').trim().toLowerCase();
      let texto = String(el.texto || '').trim();
      let detalle = String(el.detalle || '').trim();

      if (tipoRaw === 'cambio') {
        const idRep = String(el.id || '').trim();
        const rep = reprocesosTodos.get(idRep);
        const lineasRep = lineasPorRepTodos.get(idRep) || [];
        const origenes = lineasRep.filter(l => String(l.tipo || '').trim().toUpperCase() === 'ORIGEN');
        const destinos = lineasRep.filter(l => String(l.tipo || '').trim().toUpperCase() === 'DESTINO');
        if (origenes.length > 0 || destinos.length > 0) {
          const origArt = String((origenes[0] && origenes[0].codigo_articulo) || '').trim();
          const destArt = String((destinos[0] && destinos[0].codigo_articulo) || '').trim();
          const origLabel = origArt + (origenes.length > 1 ? ` (+${origenes.length - 1})` : '');
          const destLabel = destArt + (destinos.length > 1 ? ` (+${destinos.length - 1})` : '');
          texto = `${origLabel || 'Origen'} → ${destLabel || 'Destino'}`;

          const totalRet = origenes.reduce((s, l) => s + Number(l.cajas || 0), 0)
            || Number((rep && rep.total_retirado) || 0);
          const totalDest = destinos.reduce((s, l) => s + Number(l.cajas || 0), 0)
            || Number((rep && rep.total_destinos) || 0);
          const destrio = Number((rep && rep.destrio_cajas) || 0);
          detalle = `${totalRet} → ${totalDest}` + (destrio > 0 ? ` · destrío ${destrio}` : '');
        }
      }

      return {
        id: String(el.id || '').trim(),
        id_movimiento: String(el.id || '').trim(),
        fecha: el.fecha_negocio || _normFechaInicio_(el.fecha_hora),
        fecha_hora: el.fecha_hora || '',
        tipo: tipoRaw,
        texto,
        detalle,
        cajas: Number(el.cajas || 0),
        usuario: String(el.usuario || 'SISTEMA').trim(),
        documento: String(el.documento || '').trim(),
        anulado: Boolean(el.anulado)
      };
    });

    let ultimoMovimientoHora = '';
    for (const item of movsConfirmados) {
      const fechaHora = String((item.raw && item.raw.fecha_hora) || '').trim();
      if (fechaHora && (!ultimoMovimientoHora || fechaHora > ultimoMovimientoHora)) {
        ultimoMovimientoHora = fechaHora;
      }
    }

    let cierre = null;
    if (opts.incluirCierre !== false && this.cierreService && typeof this.cierreService.obtenerCierre === 'function') {
      try {
        const fechaCierre = opts.hoy ? _normFechaInicio_(opts.hoy) : _hoyInicio_(this.reloj);
        const stockRowsCierre = _leerTablaSeguraInicio_(() => (
          typeof this.repo.getStockActual === 'function' ? this.repo.getStockActual() : []
        ));
        cierre = this.cierreService.obtenerCierre(fechaCierre, {
          movimientos,
          reprocesos,
          stockRows: stockRowsCierre
        });
      } catch (e) {
        cierre = null;
      }
    }

    return {
      fecha_referencia: fechaFin,
      fecha_inicio_datos: fechaInicioDatos,
      total,
      serie,
      variedades,
      pendientes,
      destrio7,
      importado_hasta: importadoHasta,
      ultimos,
      ultimo_movimiento_hora: ultimoMovimientoHora,
      cierre
    };
  }

  /**
   * Devuelve la historia completa de una partida (capa FIFO):
   * - origen (compra, stock inicial, ajuste o reproceso con `viene_de`);
   * - consumos (ventas, ajustes y reprocesos que la usaron);
   * - `se_convirtio_en` si salió por un reproceso (destinos de ese reproceso).
   *
   * @param {string} idCapa
   * @returns {Object}
   */
  obtenerPartida(idCapa) {
    const idLimpio = String(idCapa === null || idCapa === undefined ? '' : idCapa).trim();
    if (!idLimpio) {
      throw new Error('apiObtenerPartida: Se requiere idCapa.');
    }

    const capas = _leerTablaSeguraInicio_(() => (typeof this.repo.getCapasFifo === 'function' ? this.repo.getCapasFifo() : []));
    const capa = capas.find(c => String(c.id_capa || '').trim() === idLimpio);
    if (!capa) {
      throw new Error(`No se encontró la partida '${idLimpio}'.`);
    }

    const movimientos = _leerTablaSeguraInicio_(() => (typeof this.repo.getMovimientos === 'function' ? this.repo.getMovimientos() : []));
    const consumosFifo = _leerTablaSeguraInicio_(() => (typeof this.repo.getConsumosFifo === 'function' ? this.repo.getConsumosFifo() : []));
    const reprocesos = _leerTablaSeguraInicio_(() => (typeof this.repo.getReprocesos === 'function' ? this.repo.getReprocesos() : []));
    const reprocesoLineas = _leerTablaSeguraInicio_(() => (typeof this.repo.getReprocesoLineas === 'function' ? this.repo.getReprocesoLineas() : []));
    const catalogoConfig = (this.catalogoService && typeof this.catalogoService.obtenerConfiguracion === 'function')
      ? this.catalogoService.obtenerConfiguracion()
      : { atributos: [], reglas: [], catalogo: [], agrupaciones: [] };

    const capasById = new Map();
    for (const c of capas) {
      if (c && c.id_capa) capasById.set(String(c.id_capa).trim(), c);
    }

    const movById = new Map();
    for (const m of movimientos) {
      if (m && m.id_movimiento) movById.set(String(m.id_movimiento).trim(), m);
    }

    const idxRep = this._indexarReprocesos_(reprocesos, reprocesoLineas);

    // Clasificación visual (grupo y color)
    const { mapa: mapaDefsGrupos } = this._definirGruposComerciales_(catalogoConfig.agrupaciones);
    const clasificarFn = this._clasificadorPuro_();
    let grupoNombre = 'Sin agrupar';
    let colorGrupo = PALETA_VARIEDADES_INICIO_[0];
    if (typeof clasificarFn === 'function') {
      const clasif = clasificarFn(capa.codigo_articulo, capa.codigo_envase, catalogoConfig);
      if (clasif && clasif.cajones && clasif.cajones.COMERCIAL && clasif.cajones.COMERCIAL.grupo) {
        const gRaw = String(clasif.cajones.COMERCIAL.grupo).trim();
        const def = mapaDefsGrupos.get(_normTextoInicio_(gRaw));
        if (def) {
          grupoNombre = def.grupo;
          colorGrupo = def.color;
        }
      }
    }

    // 1. Origen de la partida
    const movEntrada = capa.id_movimiento_entrada ? movById.get(String(capa.id_movimiento_entrada).trim()) : null;
    const vieneDeBase = this._construirVieneDe_(idLimpio, idxRep);
    let origen;

    if (vieneDeBase) {
      vieneDeBase.origenes = vieneDeBase.origenes.map(o => {
        const capaOrig = capasById.get(o.id_capa);
        return {
          ...o,
          cajas_restantes: capaOrig ? Number(capaOrig.cajas_restantes || 0) : null
        };
      });
      origen = {
        tipo: 'REPROCESO',
        id_movimiento: String(capa.id_movimiento_entrada || '').trim(),
        fecha: vieneDeBase.fecha,
        fecha_hora: vieneDeBase.fecha_hora,
        usuario: vieneDeBase.usuario,
        proveedor: String(capa.proveedor || '').trim(),
        fecha_capa: _normFechaInicio_(capa.fecha_capa),
        documento_ref: String(capa.documento_ref || '').trim(),
        cajas: Number(capa.cajas_iniciales || 0),
        viene_de: vieneDeBase
      };
    } else if (movEntrada) {
      const tipoMov = String(movEntrada.tipo_movimiento || '').trim().toUpperCase();
      const motMov = String(movEntrada.motivo_ajuste || '').trim().toUpperCase();
      let tipoOrigen = 'COMPRA';
      if (tipoMov === 'AJUSTE') {
        tipoOrigen = motMov === 'STOCK_INICIAL' ? 'STOCK_INICIAL' : 'AJUSTE';
      }
      origen = {
        tipo: tipoOrigen,
        id_movimiento: String(movEntrada.id_movimiento || '').trim(),
        fecha: _normFechaInicio_(movEntrada.fecha_negocio) || _normFechaInicio_(capa.fecha_capa),
        fecha_hora: movEntrada.fecha_hora || '',
        usuario: String(movEntrada.usuario || '').trim(),
        proveedor: String(capa.proveedor || movEntrada.entidad_nombre || '').trim(),
        fecha_capa: _normFechaInicio_(capa.fecha_capa),
        documento_ref: String(capa.documento_ref || movEntrada.documento_ref || '').trim(),
        motivo: motMov,
        cajas: Number(capa.cajas_iniciales || 0),
        viene_de: null
      };
    } else {
      origen = {
        tipo: 'COMPRA',
        id_movimiento: String(capa.id_movimiento_entrada || '').trim(),
        fecha: _normFechaInicio_(capa.fecha_capa),
        fecha_hora: '',
        usuario: '',
        proveedor: String(capa.proveedor || '').trim(),
        fecha_capa: _normFechaInicio_(capa.fecha_capa),
        documento_ref: String(capa.documento_ref || '').trim(),
        motivo: '',
        cajas: Number(capa.cajas_iniciales || 0),
        viene_de: null
      };
    }

    // 2. Consumos sobre esta partida
    const consumos = [];
    for (const c of consumosFifo) {
      if (!c || String(c.id_capa || '').trim() !== idLimpio) continue;
      const cajasC = Number(c.cajas || 0);
      if (cajasC <= 0) continue;

      const idMov = String(c.id_movimiento || '').trim();
      const mov = movById.get(idMov);
      const idRepMov = idxRep.reprocesoPorMov.get(idMov) || null;
      const tipoMov = mov ? String(mov.tipo_movimiento || '').trim().toUpperCase() : '';
      const motMov = mov ? String(mov.motivo_ajuste || '').trim().toUpperCase() : '';

      let tipoConsumo = 'VENTA';
      if (idRepMov) {
        tipoConsumo = 'REPROCESO';
      } else if (tipoMov === 'AJUSTE') {
        tipoConsumo = motMov || 'AJUSTE';
      }

      consumos.push({
        id_movimiento: idMov,
        tipo: tipoConsumo,
        fecha: _normFechaInicio_(c.fecha_negocio) || (mov ? _normFechaInicio_(mov.fecha_negocio) : ''),
        cajas: cajasC,
        entidad: mov ? String(mov.entidad_nombre || '').trim() : '',
        documento_ref: mov ? String(mov.documento_ref || '').trim() : '',
        usuario: mov ? String(mov.usuario || '').trim() : '',
        id_reproceso: idRepMov
      });
    }

    // 3. se_convirtio_en (si salió por uno o más reprocesos activos)
    const lineasComoOrigen = idxRep.origenesPorCapa.get(idLimpio) || [];
    const seConvirtioEn = [];
    for (const lo of lineasComoOrigen) {
      const idRep = String(lo.id_reproceso || '').trim();
      const rep = idxRep.reprocesosActivos.get(idRep);
      if (!rep) continue;
      const dests = idxRep.destinosPorReproceso.get(idRep) || [];
      for (const d of dests) {
        const capaDest = capasById.get(String(d.id_capa || '').trim());
        seConvirtioEn.push({
          id_reproceso: idRep,
          fecha: _normFechaInicio_(rep.fecha) || _normFechaInicio_(d.fecha_capa),
          cajas_retiradas: Number(lo.cajas || 0),
          destrio_prorrateado: Number(lo.destrio_prorrateado || 0),
          id_capa: String(d.id_capa || '').trim(),
          articulo: String(d.codigo_articulo || '').trim(),
          envase: String(d.codigo_envase || '').trim(),
          cajas: Number(d.cajas || 0),
          cajas_restantes: capaDest ? Number(capaDest.cajas_restantes || 0) : null,
          proveedor: String(d.proveedor || '').trim(),
          fecha_capa: _normFechaInicio_(d.fecha_capa)
        });
      }
    }

    return {
      id_capa: idLimpio,
      articulo: String(capa.codigo_articulo || '').trim(),
      envase: String(capa.codigo_envase || '').trim(),
      grupo: grupoNombre,
      color: colorGrupo,
      cajas_iniciales: Number(capa.cajas_iniciales || 0),
      cajas_consumidas: Number(capa.cajas_consumidas || 0),
      cajas_restantes: Number(capa.cajas_restantes || 0),
      estado_capa: String(capa.estado_capa || '').trim(),
      fecha_capa: _normFechaInicio_(capa.fecha_capa),
      proveedor: String(capa.proveedor || '').trim(),
      partida: String(capa.partida || '').trim(),
      documento_ref: String(capa.documento_ref || '').trim(),
      origen_dato: String(capa.origen_dato || '').trim(),
      origen,
      consumos,
      se_convirtio_en: seConvirtioEn
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    InicioService,
    PALETA_VARIEDADES_INICIO_,
    MOTIVOS_DESTRIO_INICIO_
  };
}
