/**
 * STOCK-LIGHT — OperacionesService.js
 *
 * Servicio de solo lectura para la pantalla de operaciones (T-025):
 * - sugerencias de cambio (reproceso) con proporciones habituales;
 * - evaluación del rendimiento de un cambio;
 * - previsualización de anulaciones con las mismas reglas que la anulación real;
 * - historial de movimientos agrupado por fecha de negocio;
 * - búsqueda global.
 *
 * No escribe nunca. Cada método lee cada hoja una sola vez y trabaja en memoria.
 */

const OPERACIONES_NORMALIZACION_NODE = typeof module !== 'undefined' && module.exports
  ? require('./Normalizacion')
  : null;
const OPERACIONES_FECHAS_NODE = typeof module !== 'undefined' && module.exports
  ? require('./Fechas')
  : null;

const UMBRAL_RENDE_DISTINTO_PCT = 10;
const OPERACIONES_LIMITE_BUSQUEDA = 20;
const MOTIVOS_LEGIBLES_OPERACIONES = {
  STOCK_INICIAL: 'Stock inicial',
  RECUENTO: 'Recuento',
  ERROR_CARGA: 'Error de carga',
  DESTRIO: 'Destrío',
  OTRO: 'Otro',
  ANULACION_AJUSTE: 'Anulación de ajuste',
  REPROCESO: 'Cambio de confección'
};

class OperacionesService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.repository]
   * @param {Object} [options.movementService]
   * @param {Object} [options.catalogoService]
   * @param {Object} [options.configCatalogo]
   * @param {Object} [options.lockService]
   */
  constructor(options = {}) {
    const RepoClass = (typeof SheetsRepository !== 'undefined')
      ? SheetsRepository
      : (typeof require !== 'undefined' ? require('./Repository').SheetsRepository : null);
    if (!RepoClass && !options.repository) {
      throw new Error('SheetsRepository no está disponible en OperacionesService');
    }
    this.repo = options.repository || new RepoClass();

    const MovementClass = (typeof MovementService !== 'undefined')
      ? MovementService
      : (typeof require !== 'undefined' ? require('./MovementService').MovementService : null);
    this.movementService = options.movementService || (MovementClass
      ? new MovementClass({ repository: this.repo, lockService: options.lockService })
      : null);
    if (!this.movementService) {
      throw new Error('MovementService no está disponible en OperacionesService');
    }

    const CatalogoClass = (typeof CatalogoService !== 'undefined')
      ? CatalogoService
      : (typeof require !== 'undefined' ? require('./CatalogoService').CatalogoService : null);
    this.catalogoService = options.catalogoService || (CatalogoClass
      ? new CatalogoClass({
        repository: this.repo,
        config: options.configCatalogo || options.config || null
      })
      : null);

    this._cacheVariedad = new Map();
  }

  _normalizar_(texto) {
    if (OPERACIONES_NORMALIZACION_NODE) {
      return OPERACIONES_NORMALIZACION_NODE.normalizarNombre(texto);
    }
    if (typeof normalizarNombre === 'function') return normalizarNombre(texto);
    return String(texto === null || texto === undefined ? '' : texto).trim().replace(/\s+/g, ' ').toUpperCase();
  }

  _sinAcentos_(texto) {
    return String(texto === null || texto === undefined ? '' : texto)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  _fechaNegocio_(valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    try {
      if (OPERACIONES_FECHAS_NODE) return OPERACIONES_FECHAS_NODE.normalizarFechaNegocio(valor);
      if (typeof normalizarFechaNegocio === 'function') return normalizarFechaNegocio(valor);
    } catch (e) {
      // Se usa el valor tal cual si no se puede normalizar.
    }
    return String(valor).slice(0, 10);
  }

  _mediana_(valores) {
    const lista = (Array.isArray(valores) ? valores : [])
      .map(valor => Number(valor))
      .filter(valor => Number.isFinite(valor))
      .sort((a, b) => a - b);
    if (lista.length === 0) return 0;
    const mitad = Math.floor(lista.length / 2);
    if (lista.length % 2 === 1) return lista[mitad];
    return (lista[mitad - 1] + lista[mitad]) / 2;
  }

  _redondear_(valor, decimales = 2) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return 0;
    const factor = Math.pow(10, decimales);
    return Math.round((numero + Number.EPSILON) * factor) / factor;
  }

  _clonarEstado_(estado) {
    return {
      capas: Array.isArray(estado && estado.capas) ? estado.capas.map(capa => ({ ...capa })) : [],
      stock: estado && estado.stock ? { ...estado.stock } : {},
      consumosPorMovimiento: JSON.parse(JSON.stringify(
        estado && estado.consumosPorMovimiento ? estado.consumosPorMovimiento : {}
      ))
    };
  }

  _configCatalogo_() {
    if (!this.catalogoService || typeof this.catalogoService.obtenerConfiguracion !== 'function') {
      return { atributos: [], reglas: [], catalogo: [], agrupaciones: [] };
    }
    try {
      return this.catalogoService.obtenerConfiguracion() || {};
    } catch (e) {
      return { atributos: [], reglas: [], catalogo: [], agrupaciones: [] };
    }
  }

  _variedad_(articulo, envase) {
    const art = this._normalizar_(articulo);
    const env = this._normalizar_(envase);
    const clave = `${art}|${env}`;
    if (this._cacheVariedad.has(clave)) return this._cacheVariedad.get(clave);

    let grupo = 'SIN CLASIFICAR';
    if (this.catalogoService && typeof this.catalogoService.clasificar === 'function') {
      try {
        const clasificacion = this.catalogoService.clasificar(art, env);
        const cajon = clasificacion && clasificacion.cajones ? clasificacion.cajones.COMERCIAL : null;
        if (cajon && cajon.grupo) grupo = String(cajon.grupo).trim() || 'SIN CLASIFICAR';
      } catch (e) {
        grupo = 'SIN CLASIFICAR';
      }
    }
    this._cacheVariedad.set(clave, grupo);
    return grupo;
  }

  _cargarReprocesos_() {
    const reprocesos = (this.repo && typeof this.repo.getReprocesos === 'function')
      ? this.repo.getReprocesos()
      : [];
    const lineas = (this.repo && typeof this.repo.getReprocesoLineas === 'function')
      ? this.repo.getReprocesoLineas()
      : [];
    return { reprocesos, lineas };
  }

  _cargarHistorial_() {
    const movimientos = (this.repo && typeof this.repo.getMovimientos === 'function') ? this.repo.getMovimientos() : [];
    const capas = (this.repo && typeof this.repo.getCapasFifo === 'function') ? this.repo.getCapasFifo() : [];
    const stock = (this.repo && typeof this.repo.getStockActual === 'function') ? this.repo.getStockActual() : [];
    const consumos = (this.repo && typeof this.repo.getConsumosFifo === 'function') ? this.repo.getConsumosFifo() : [];
    const documentos = (this.repo && typeof this.repo.getDocumentos === 'function') ? this.repo.getDocumentos() : [];
    const maestro = (this.repo && typeof this.repo.getMaestro === 'function') ? this.repo.getMaestro() : [];
    let usuarios = [];
    if (this.repo && typeof this.repo.getUsuarios === 'function') {
      try {
        const resUsuarios = this.repo.getUsuarios();
        if (Array.isArray(resUsuarios)) usuarios = resUsuarios;
      } catch (e) {
        usuarios = [];
      }
    }
    const { reprocesos, lineas } = this._cargarReprocesos_();
    const config = this._configCatalogo_();
    return { movimientos, capas, stock, consumos, documentos, maestro, usuarios, reprocesos, lineas, config };
  }

  _fechaOrdenReproceso_(reproceso) {
    return String(
      (reproceso && (reproceso.fecha_hora || reproceso.fecha)) || ''
    );
  }

  /**
   * Conjuntos de destinos habituales para un origen (T-025 regla 1).
   * @param {string} articulo
   * @param {string} envase
   * @returns {Array<Object>}
   */
  sugerenciasCambio(articulo, envase) {
    let art = articulo;
    let env = envase;
    if (art && typeof art === 'object') {
      env = art.envase || art.codigo_envase;
      art = art.articulo || art.codigo_articulo;
    } else if (!env && String(art || '').includes('|')) {
      const partes = String(art).split('|');
      art = partes[0];
      env = partes.slice(1).join('|');
    }
    art = this._normalizar_(art);
    env = this._normalizar_(env);
    if (!art || !env) return [];

    const { reprocesos, lineas } = this._cargarReprocesos_();
    const lineasPorReproceso = new Map();
    for (const linea of lineas) {
      const id = String(linea.id_reproceso || '').trim();
      if (!id) continue;
      if (!lineasPorReproceso.has(id)) lineasPorReproceso.set(id, []);
      lineasPorReproceso.get(id).push(linea);
    }

    const grupos = new Map();

    for (const reproceso of reprocesos) {
      if (String(reproceso.estado || '').trim().toUpperCase() === 'ANULADO') continue;
      const id = String(reproceso.id_reproceso || '').trim();
      if (!id) continue;

      const lineasReproceso = lineasPorReproceso.get(id) || [];
      const origenes = lineasReproceso.filter(linea => String(linea.tipo || '').toUpperCase() === 'ORIGEN');
      const destinos = lineasReproceso.filter(linea => String(linea.tipo || '').toUpperCase() === 'DESTINO');
      if (destinos.length === 0) continue;

      const coincideOrigen = origenes.some(origen =>
        this._normalizar_(origen.codigo_articulo) === art &&
        this._normalizar_(origen.codigo_envase) === env
      );
      if (!coincideOrigen) continue;

      const totalOrigen = origenes.reduce((total, origen) => total + Number(origen.cajas || 0), 0)
        || Number(reproceso.total_retirado || 0);
      if (totalOrigen <= 0) continue;

      const totalDestino = destinos.reduce((total, destino) => total + Number(destino.cajas || 0), 0);
      const destrio = Number(reproceso.destrio_cajas || 0);

      const destinosAgrupados = new Map();
      for (const destino of destinos) {
        const articuloDestino = this._normalizar_(destino.codigo_articulo);
        const envaseDestino = this._normalizar_(destino.codigo_envase);
        const claveDestino = `${articuloDestino}|${envaseDestino}`;
        if (!destinosAgrupados.has(claveDestino)) {
          destinosAgrupados.set(claveDestino, {
            articulo: articuloDestino,
            envase: envaseDestino,
            cajas: 0
          });
        }
        destinosAgrupados.get(claveDestino).cajas += Number(destino.cajas || 0);
      }
      const destinosUnicos = [...destinosAgrupados.values()];
      const combos = destinosUnicos.map(destino => ({
        articulo: destino.articulo,
        envase: destino.envase
      }));
      const clavesCombo = combos.map(combo => `${combo.articulo}|${combo.envase}`);
      const firma = [...clavesCombo].sort().join(';;');

      if (!grupos.has(firma)) {
        grupos.set(firma, {
          firma,
          combos,
          reprocesos: []
        });
      }
      const grupo = grupos.get(firma);
      grupo.reprocesos.push({
        reproceso,
        destinos: destinosUnicos,
        clavesCombo,
        totalOrigen,
        totalDestino,
        destrio
      });
    }

    const resultado = [];
    for (const grupo of grupos.values()) {
      const ordenados = grupo.reprocesos.slice().sort((a, b) => {
        const fechaA = this._fechaOrdenReproceso_(a.reproceso);
        const fechaB = this._fechaOrdenReproceso_(b.reproceso);
        if (fechaA !== fechaB) return fechaA < fechaB ? 1 : -1;
        return String(b.reproceso.id_reproceso || '').localeCompare(String(a.reproceso.id_reproceso || ''));
      });
      const ultimos = ordenados.slice(0, 5);

      const destinos = grupo.combos.map((combo, indice) => {
        const ratios = ultimos.map(item => {
          const clave = item.clavesCombo[indice];
          const destino = item.destinos.find(d => {
            const articuloDestino = d.codigo_articulo !== undefined ? d.codigo_articulo : d.articulo;
            const envaseDestino = d.codigo_envase !== undefined ? d.codigo_envase : d.envase;
            return `${this._normalizar_(articuloDestino)}|${this._normalizar_(envaseDestino)}` === clave;
          });
          return destino ? Number(destino.cajas || 0) / item.totalOrigen : 0;
        });
        return {
          articulo: combo.articulo,
          envase: combo.envase,
          proporcion: this._redondear_(this._mediana_(ratios), 2)
        };
      });

      const proporcionTotal = this._mediana_(ultimos.map(item => item.totalDestino / item.totalOrigen));
      const destrioHabitual = this._mediana_(ultimos.map(item => item.destrio / item.totalOrigen));
      const ultima = ordenados[0] ? ordenados[0].reproceso : null;
      const ultimaVez = ultima
        ? String(ultima.fecha || (ultima.fecha_hora ? String(ultima.fecha_hora).slice(0, 10) : ''))
        : '';

      resultado.push({
        destinos,
        proporcion_total: this._redondear_(proporcionTotal, 2),
        destrio_habitual: this._redondear_(destrioHabitual, 2),
        veces: ordenados.length,
        ultima_vez: ultimaVez,
        _orden: ultima ? this._fechaOrdenReproceso_(ultima) : ''
      });
    }

    resultado.sort((a, b) => {
      if (a._orden !== b._orden) return a._orden < b._orden ? 1 : -1;
      return String(a.ultima_vez).localeCompare(String(b.ultima_vez));
    });

    return resultado.slice(0, 5).map(item => ({
      destinos: item.destinos,
      proporcion_total: item.proporcion_total,
      destrio_habitual: item.destrio_habitual,
      veces: item.veces,
      ultima_vez: item.ultima_vez
    }));
  }

  /**
   * Compara el rendimiento real de un cambio con el habitual (T-025 regla 2).
   * @param {number} origenCajas
   * @param {Array<Object>|number} destinos
   * @param {Object|number|null} sugerencia
   * @returns {{ esperado: number, real: number, desviacion_pct: number, rinde_distinto: boolean }}
   */
  evaluarCambio_(origenCajas, destinos, sugerencia) {
    const origen = Number(origenCajas);
    const lista = Array.isArray(destinos)
      ? destinos
      : (destinos && typeof destinos === 'object' ? [destinos] : []);
    const totalDestinos = lista.reduce((total, destino) => {
      if (destino && typeof destino === 'object') return total + Number(destino.cajas || 0);
      return total + Number(destino || 0);
    }, 0);

    let proporcionHabitual = 1;
    if (typeof sugerencia === 'number' && Number.isFinite(sugerencia)) {
      proporcionHabitual = sugerencia;
    } else if (sugerencia && typeof sugerencia === 'object' && Number.isFinite(Number(sugerencia.proporcion_total))) {
      proporcionHabitual = Number(sugerencia.proporcion_total);
    }
    if (!Number.isFinite(proporcionHabitual) || proporcionHabitual < 0) proporcionHabitual = 1;

    const real = origen > 0 ? totalDestinos / origen : 0;
    const desviacion = proporcionHabitual > 0
      ? ((real - proporcionHabitual) / proporcionHabitual) * 100
      : 0;

    return {
      esperado: this._redondear_(proporcionHabitual, 2),
      real: this._redondear_(real, 2),
      desviacion_pct: this._redondear_(desviacion, 1),
      rinde_distinto: Math.abs(desviacion) > UMBRAL_RENDE_DISTINTO_PCT
    };
  }

  _crearRepositorioClon_(datos) {
    const clon = {
      _capas: (datos.capas || []).map(capa => ({ ...capa })),
      _stock: (datos.stock || []).map(fila => ({ ...fila })),
      _movimientos: (datos.movimientos || []).map(mov => ({ ...mov })),
      _consumos: (datos.consumos || []).map(fila => ({ ...fila })),
      _documentos: (datos.documentos || []).map(doc => ({ ...doc })),
      _reprocesos: (datos.reprocesos || []).map(rep => ({ ...rep })),
      _lineas: (datos.lineas || []).map(linea => ({ ...linea })),
      _maestro: (datos.maestro || []).map(fila => ({ ...fila })),
      _secuencia: 0,

      getCapasFifo() { return this._capas; },
      saveCapasFifo(capas) { this._capas = (capas || []).map(capa => ({ ...capa })); },
      getStockActual() { return this._stock; },
      saveStockActual(stock) { this._stock = (stock || []).map(fila => ({ ...fila })); },
      getMovimientos() { return this._movimientos; },
      appendMovimientos(movs) {
        for (const mov of (movs || [])) {
          const max = this._movimientos.reduce((valor, item) => {
            const secuencia = Number(item.secuencia);
            return Number.isFinite(secuencia) && secuencia > valor ? secuencia : valor;
          }, this._secuencia);
          this._secuencia = max + 1;
          this._movimientos.push({ ...mov, secuencia: this._secuencia });
        }
      },
      getConsumosFifo() { return this._consumos; },
      saveConsumosFifo(consumos) { this._consumos = (consumos || []).map(fila => ({ ...fila })); },
      getDocumentos() { return this._documentos; },
      appendDocumento(doc) { this._documentos.push({ ...doc }); },
      updateDocumentoEstado(idDocumento, nuevoEstado) {
        const doc = this._documentos.find(item => String(item.id_documento || '') === String(idDocumento || ''));
        if (doc) doc.estado_proceso = nuevoEstado;
      },
      getMaestro() { return this._maestro; },
      getReprocesos() { return this._reprocesos; },
      getReprocesoLineas(idReproceso = null) {
        if (!idReproceso) return this._lineas;
        return this._lineas.filter(linea => String(linea.id_reproceso || '') === String(idReproceso || ''));
      },
      appendReproceso(reproceso) {
        const lista = Array.isArray(reproceso) ? reproceso : [reproceso];
        for (const item of lista) this._reprocesos.push({ ...item });
      },
      appendReprocesoLineas(lineas) {
        const lista = Array.isArray(lineas) ? lineas : [lineas];
        for (const item of lista) this._lineas.push({ ...item });
      },
      updateReprocesoEstado(idReproceso, nuevoEstado) {
        const rep = this._reprocesos.find(item => String(item.id_reproceso || '') === String(idReproceso || ''));
        if (rep) rep.estado = nuevoEstado;
      },
      appendPendientes() {},
      getImportaciones() { return []; },
      saveImportaciones() {},
      replaceTable(nombre, registros) {
        if (nombre === 'DOCUMENTOS') this._documentos = (registros || []).map(doc => ({ ...doc }));
        if (nombre === 'CAPAS_FIFO') this.saveCapasFifo(registros);
        if (nombre === 'STOCK_ACTUAL') this.saveStockActual(registros);
        if (nombre === 'CONSUMOS_FIFO') this.saveConsumosFifo(registros);
        if (nombre === 'REPROCESOS') this._reprocesos = (registros || []).map(rep => ({ ...rep }));
      },
      appendRecords(nombre, registros) {
        if (nombre === 'DOCUMENTOS') {
          for (const doc of (registros || [])) this._documentos.push({ ...doc });
        }
      }
    };
    return clon;
  }

  /**
   * Vista previa de una anulación usando la anulación real sobre una copia en memoria (T-025 regla 3).
   * @param {'REPROCESO'|'ENTRADA'|'SALIDA'} tipo
   * @param {string} id
   * @returns {Object}
   */
  previsualizarAnulacion(tipo, id) {
    const tipoNorm = String(tipo || '').trim().toUpperCase();
    const idNorm = String(id === null || id === undefined ? '' : id).trim();
    const respuestaBase = {
      tipo: tipoNorm,
      id: idNorm,
      posible: false,
      motivo: '',
      partidas_vuelven: [],
      partidas_bajan: [],
      partidas_desaparecen: [],
      efecto_variedades: []
    };

    if (!['REPROCESO', 'ENTRADA', 'SALIDA'].includes(tipoNorm)) {
      respuestaBase.motivo = 'TIPO_NO_SOPORTADO';
      return respuestaBase;
    }
    if (!idNorm) {
      respuestaBase.motivo = 'ID_REQUERIDO';
      return respuestaBase;
    }

    const datos = this._cargarHistorial_();
    this._cacheVariedad.clear();
    const repositorioClon = this._crearRepositorioClon_(datos);
    const MovementClass = (typeof MovementService !== 'undefined')
      ? MovementService
      : (typeof require !== 'undefined' ? require('./MovementService').MovementService : null);
    if (!MovementClass) {
      respuestaBase.motivo = 'MOVEMENT_SERVICE_NO_DISPONIBLE';
      return respuestaBase;
    }

    const servicioClon = new MovementClass({
      repository: repositorioClon,
      lockService: { waitLock: () => true, releaseLock: () => {} },
      libro: this.movementService.libro,
      inventoryEngine: this.movementService.engine,
      deduplicationService: this.movementService.dedup
    });

    const antes = this._clonarEstado_(servicioClon._cargarEstado().estado);
    let resultado = null;

    try {
      if (tipoNorm === 'REPROCESO') {
        resultado = servicioClon.anularReproceso(idNorm, 'PREVISUALIZACION');
      } else if (tipoNorm === 'ENTRADA') {
        resultado = servicioClon.anularEntrada({ id_capa: idNorm }, 'PREVISUALIZACION');
        if (!resultado || resultado.success !== true) {
          const segundo = servicioClon.anularEntrada({ id_movimiento: idNorm }, 'PREVISUALIZACION');
          if (segundo && (segundo.success === true || !resultado || resultado.errorCode === 'CAPA_NO_ENCONTRADA')) {
            resultado = segundo;
          }
        }
        if (!resultado || (resultado.success !== true && resultado.errorCode === 'CAPA_NO_ENCONTRADA')) {
          const tercero = servicioClon.anularEntrada({ id_documento: idNorm }, 'PREVISUALIZACION');
          if (tercero && (tercero.success === true || !resultado || resultado.errorCode === 'CAPA_NO_ENCONTRADA')) {
            resultado = tercero;
          }
        }
      } else {
        const parametros = {};
        if (idNorm.includes('/')) {
          const partes = idNorm.split('/');
          parametros.serie = partes[0];
          parametros.numero = partes.slice(1).join('/');
        } else {
          parametros.id_documento = idNorm;
          parametros.id_movimiento = idNorm;
        }
        resultado = servicioClon.anularSalida(parametros, 'PREVISUALIZACION');
      }
    } catch (error) {
      respuestaBase.motivo = error && error.message ? error.message : String(error);
      return respuestaBase;
    }

    if (!resultado || resultado.success !== true) {
      respuestaBase.motivo = (resultado && (resultado.message || resultado.error || resultado.reason))
        || 'NO_SE_PUEDE_ANULAR';
      return respuestaBase;
    }

    const despues = this._clonarEstado_(servicioClon._cargarEstado().estado);
    const capasAntes = new Map(antes.capas.map(capa => [String(capa.id_capa || ''), capa]));
    const capasDespues = new Map(despues.capas.map(capa => [String(capa.id_capa || ''), capa]));
    const vuelven = [];
    const bajan = [];
    const desaparecen = [];

    for (const [idCapa, capaAntes] of capasAntes.entries()) {
      const capaDespues = capasDespues.get(idCapa);
      const restantesAntes = Number(capaAntes.cajas_restantes || 0);
      const restantesDespues = capaDespues ? Number(capaDespues.cajas_restantes || 0) : 0;
      const diferencia = restantesDespues - restantesAntes;
      if (diferencia > 0) {
        vuelven.push({
          id_capa: idCapa,
          articulo: capaAntes.codigo_articulo,
          envase: capaAntes.codigo_envase,
          proveedor: capaAntes.proveedor || '',
          fecha_capa: capaAntes.fecha_capa || '',
          cajas: diferencia
        });
      } else if (diferencia < 0) {
        const entrada = {
          id_capa: idCapa,
          articulo: capaAntes.codigo_articulo,
          envase: capaAntes.codigo_envase,
          proveedor: capaAntes.proveedor || '',
          fecha_capa: capaAntes.fecha_capa || '',
          cajas: Math.abs(diferencia)
        };
        const anulada = !capaDespues || String(capaDespues.estado_capa || '').toUpperCase() === 'ANULADA' || restantesDespues === 0;
        if (anulada) desaparecen.push(entrada);
        else bajan.push(entrada);
      }
    }

    const porVariedad = {};
    const clavesStock = new Set([
      ...Object.keys(antes.stock || {}),
      ...Object.keys(despues.stock || {})
    ]);
    for (const clave of clavesStock) {
      const diferencia = Number(despues.stock[clave] || 0) - Number(antes.stock[clave] || 0);
      if (diferencia === 0) continue;
      const partes = String(clave).split('|');
      const variedad = this._variedad_(partes[0], partes[1]);
      porVariedad[variedad] = (porVariedad[variedad] || 0) + diferencia;
    }

    return {
      tipo: tipoNorm,
      id: idNorm,
      posible: true,
      motivo: '',
      partidas_vuelven: vuelven,
      partidas_bajan: bajan,
      partidas_desaparecen: desaparecen,
      efecto_variedades: Object.keys(porVariedad).map(variedad => ({
        variedad,
        cajas: porVariedad[variedad]
      }))
    };
  }

  _etiquetaDocumento_(documento) {
    if (!documento) return '';
    const serie = String(documento.serie || '').trim();
    const numero = String(documento.numero || '').trim();
    if (serie && numero) return `${serie}/${numero}`;
    return numero || serie || String(documento.id_documento || '');
  }

  _textoTransaccion_(tipo, articulo, envase, entidad) {
    const partes = [String(articulo || ''), String(envase || '')].filter(Boolean).join(' ');
    const persona = String(entidad || '').trim();
    if (persona && partes) return `${tipo} · ${partes} · ${persona}`;
    if (persona) return `${tipo} · ${persona}`;
    return `${tipo} · ${partes}`;
  }

  _traducirMotivo_(motivo) {
    const raw = String(motivo === null || motivo === undefined ? '' : motivo).trim();
    if (!raw) return '';
    const clave = raw.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(MOTIVOS_LEGIBLES_OPERACIONES, clave)) {
      return MOTIVOS_LEGIBLES_OPERACIONES[clave];
    }
    const limpio = raw.replace(/_/g, ' ').toLowerCase();
    return limpio.charAt(0).toUpperCase() + limpio.slice(1);
  }

  _resolverAdminUnico_(usuarios) {
    const lista = Array.isArray(usuarios) ? usuarios : [];
    const adminsActivos = lista.filter(u => {
      if (!u) return false;
      const rol = String(u.rol || '').trim().toUpperCase();
      if (rol !== 'ADMIN') return false;
      if (u.activo === false) return false;
      const act = String(u.activo === undefined || u.activo === null ? 'TRUE' : u.activo).trim().toUpperCase();
      return act !== 'FALSE' && act !== 'NO' && act !== '0';
    });
    if (adminsActivos.length === 1) {
      return String(adminsActivos[0].nombre || '').trim();
    }
    return '';
  }

  _usuarioVisible_(usuario, nombreAdminUnico) {
    const raw = String(usuario === null || usuario === undefined ? '' : usuario).trim();
    if (!raw || raw.indexOf('@') < 0) return raw;
    if (nombreAdminUnico) return nombreAdminUnico;
    return raw.split('@')[0];
  }

  _construirTransacciones_(datos) {
    const nombreAdminUnico = this._resolverAdminUnico_(datos.usuarios);
    const documentosPorId = new Map();
    for (const doc of datos.documentos) {
      documentosPorId.set(String(doc.id_documento || ''), doc);
    }

    const capasPorId = new Map();
    const capasPorMovimiento = new Map();
    for (const capa of datos.capas) {
      capasPorId.set(String(capa.id_capa || ''), capa);
      if (capa.id_movimiento_entrada) {
        capasPorMovimiento.set(String(capa.id_movimiento_entrada), capa);
      }
    }

    const reprocesosPorId = new Map();
    for (const rep of datos.reprocesos) {
      reprocesosPorId.set(String(rep.id_reproceso || ''), rep);
    }
    const lineasPorReproceso = new Map();
    for (const linea of datos.lineas) {
      const id = String(linea.id_reproceso || '');
      if (!lineasPorReproceso.has(id)) lineasPorReproceso.set(id, []);
      lineasPorReproceso.get(id).push(linea);
    }

    const esReproceso = (mov) => {
      const docRef = String(mov.id_documento_ref || '');
      if (docRef.startsWith('REPROCESO:')) return true;
      return String(mov.motivo_ajuste || '').toUpperCase().startsWith('REPROCESO');
    };

    const anulacionesPorMovimiento = new Map();
    const anulacionesPorReproceso = new Map();
    const anulacionesSinReferencia = [];
    for (const mov of datos.movimientos) {
      if (String(mov.tipo_movimiento || '').toUpperCase() !== 'ANULACION') continue;
      const docRef = String(mov.id_documento_ref || '');
      if (docRef.startsWith('REPROCESO:')) {
        const idRep = docRef.slice('REPROCESO:'.length);
        if (!anulacionesPorReproceso.has(idRep)) anulacionesPorReproceso.set(idRep, []);
        anulacionesPorReproceso.get(idRep).push(mov);
        continue;
      }
      const ref = String(mov.id_movimiento_ref || '').trim();
      if (ref) {
        if (!anulacionesPorMovimiento.has(ref)) anulacionesPorMovimiento.set(ref, []);
        anulacionesPorMovimiento.get(ref).push(mov);
      } else {
        anulacionesSinReferencia.push(mov);
      }
    }

    const transacciones = [];
    const transaccionPorMovimiento = new Map();
    const movimientosPorReproceso = new Map();
    for (const mov of datos.movimientos) {
      const docRef = String(mov.id_documento_ref || '');
      if (!docRef.startsWith('REPROCESO:')) continue;
      const idRep = docRef.slice('REPROCESO:'.length);
      if (!movimientosPorReproceso.has(idRep)) movimientosPorReproceso.set(idRep, []);
      movimientosPorReproceso.get(idRep).push(mov);
    }

    for (const rep of datos.reprocesos) {
      const idRep = String(rep.id_reproceso || '');
      const lineas = lineasPorReproceso.get(idRep) || [];
      const origenes = lineas.filter(linea => String(linea.tipo || '').toUpperCase() === 'ORIGEN');
      const destinos = lineas.filter(linea => String(linea.tipo || '').toUpperCase() === 'DESTINO');
      if (origenes.length === 0 && destinos.length === 0) continue;

      const totalRetirado = origenes.reduce((total, linea) => total + Number(linea.cajas || 0), 0)
        || Number(rep.total_retirado || 0);
      const totalDestinos = destinos.reduce((total, linea) => total + Number(linea.cajas || 0), 0)
        || Number(rep.total_destinos || 0);
      const destrio = Number(rep.destrio_cajas || 0);
      const variedades = new Set();
      for (const linea of lineas) {
        variedades.add(this._variedad_(linea.codigo_articulo, linea.codigo_envase));
      }
      const listaVariedades = [...variedades];
      const variedad = listaVariedades.length === 1 ? listaVariedades[0] : 'VARIAS';

      const origen = origenes[0] || {};
      const destino = destinos[0] || {};
      const origenTexto = [origen.codigo_articulo, origen.codigo_envase].filter(Boolean).join(' ');
      const destinoTexto = [destino.codigo_articulo, destino.codigo_envase].filter(Boolean).join(' ');
      const texto = `${totalRetirado} ${origenTexto || 'origen'} → ${totalDestinos} ${destinoTexto || 'destino'}`
        + (destrio > 0 ? ` · destrío ${destrio}` : '');
      const detalle = [
        origenes.length > 1 ? `${origenes.length} orígenes` : '',
        destinos.length > 1 ? `${destinos.length} destinos` : '',
        `destrío ${destrio}`
      ].filter(Boolean).join(' · ');

      let anulado = String(rep.estado || '').toUpperCase() === 'ANULADO';
      const anulaciones = anulacionesPorReproceso.get(idRep) || [];
      if (anulaciones.length > 0) anulado = true;

      let anulable = !anulado;
      if (anulable) {
        for (const linea of destinos) {
          const capa = capasPorId.get(String(linea.id_capa || ''));
          if (capa && Number(capa.cajas_consumidas || 0) > 0) {
            anulable = false;
            break;
          }
        }
      }

      const usuarioVisibleRep = this._usuarioVisible_(rep.usuario, nombreAdminUnico);
      const transaccion = {
        id: idRep,
        tipo: 'cambio',
        texto,
        detalle,
        cajas: totalDestinos - totalRetirado,
        variedad,
        variedades: listaVariedades,
        documento: `REPROCESO:${idRep}`,
        usuario: usuarioVisibleRep,
        fecha_hora: rep.fecha_hora || '',
        fecha_negocio: this._fechaNegocio_(rep.fecha || rep.fecha_hora || ''),
        anulable,
        anulado,
        anulado_por: anulaciones.length > 0 ? String(anulaciones[0].id_movimiento || '') : '',
        anula_id: '',
        _busqueda: this._sinAcentos_([
          idRep, texto, detalle, rep.usuario, usuarioVisibleRep, variantesTexto_(lineas)
        ].join(' ')),
        _mov_ids: [],
        _rep_id: idRep
      };
      transacciones.push(transaccion);

      for (const mov of (movimientosPorReproceso.get(idRep) || [])) {
        transaccionPorMovimiento.set(String(mov.id_movimiento || ''), idRep);
      }
    }

    const salidasPorDocumento = new Map();
    for (const mov of datos.movimientos) {
      if (String(mov.tipo_movimiento || '').toUpperCase() !== 'SALIDA') continue;
      if (esReproceso(mov)) {
        continue;
      }
      const clave = String(mov.id_documento_ref || mov.id_movimiento || '');
      if (!salidasPorDocumento.has(clave)) salidasPorDocumento.set(clave, []);
      salidasPorDocumento.get(clave).push(mov);
    }

    for (const [clave, movs] of salidasPorDocumento.entries()) {
      const primero = movs[0];
      const documento = documentosPorId.get(String(primero.id_documento_ref || ''));
      const entidad = primero.entidad_nombre || (documento && documento.entidad_nombre) || '';
      const variedades = new Set();
      let articulo = primero.codigo_articulo || '';
      let envase = primero.codigo_envase || '';
      let textoLineas = '';
      for (const mov of movs) {
        variedades.add(this._variedad_(mov.codigo_articulo, mov.codigo_envase));
        textoLineas += ` ${mov.codigo_articulo || ''} ${mov.codigo_envase || ''} ${mov.entidad_nombre || ''} ${mov.id_documento_ref || ''}`;
      }
      const listaVariedades = [...variedades];
      const variedad = listaVariedades.length === 1 ? listaVariedades[0] : 'VARIAS';
      let anulado = movs.every(mov => anulacionesPorMovimiento.has(String(mov.id_movimiento || '')));
      const anulaciones = movs
        .map(mov => (anulacionesPorMovimiento.get(String(mov.id_movimiento || '')) || [])[0])
        .filter(Boolean);
      if (anulaciones.length === 0) anulado = false;

      const cajas = -movs.reduce((total, mov) => total + Math.abs(Number(mov.cajas || 0)), 0);
      const usuarioVisibleSal = this._usuarioVisible_(primero.usuario, nombreAdminUnico);
      const transaccion = {
        id: clave,
        tipo: 'salida',
        texto: this._textoTransaccion_('Salida', articulo, envase, entidad)
          + (movs.length > 1 ? ` (+${movs.length - 1} líneas)` : ''),
        detalle: this._etiquetaDocumento_(documento) || String(primero.id_documento_ref || ''),
        cajas,
        variedad,
        variedades: listaVariedades,
        documento: this._etiquetaDocumento_(documento) || String(primero.id_documento_ref || ''),
        usuario: usuarioVisibleSal,
        fecha_hora: primero.fecha_hora || '',
        fecha_negocio: this._fechaNegocio_(primero.fecha_negocio || ''),
        anulable: !anulado,
        anulado,
        anulado_por: anulaciones.length > 0 ? String(anulaciones[0].id_movimiento || '') : '',
        anula_id: '',
        _busqueda: this._sinAcentos_([
          clave, articulo, envase, entidad, this._etiquetaDocumento_(documento),
          primero.usuario, usuarioVisibleSal, textoLineas, primero.fecha_negocio
        ].join(' ')),
        _mov_ids: movs.map(mov => String(mov.id_movimiento || ''))
      };
      transacciones.push(transaccion);
      for (const mov of movs) {
        transaccionPorMovimiento.set(String(mov.id_movimiento || ''), clave);
      }
    }

    for (const mov of datos.movimientos) {
      const tipo = String(mov.tipo_movimiento || '').toUpperCase();
      if (tipo !== 'ENTRADA' && tipo !== 'AJUSTE') continue;
      if (esReproceso(mov)) {
        continue;
      }

      const documento = documentosPorId.get(String(mov.id_documento_ref || ''));
      const capa = capasPorMovimiento.get(String(mov.id_movimiento || ''))
        || capasPorId.get(String(mov.id_capa_creada || ''));
      const motivo = String(mov.motivo_ajuste || '').toUpperCase();
      let tipoTransaccion = 'ajuste';
      if (tipo === 'ENTRADA') tipoTransaccion = 'entrada';
      if (motivo === 'STOCK_INICIAL' || String(mov.origen_dato || '').toUpperCase() === 'STOCK_INICIAL') {
        tipoTransaccion = 'stock inicial';
      } else if (motivo.includes('DESTRIO') || motivo.includes('DESTRÍO')) {
        tipoTransaccion = 'destrio';
      }

      const variedades = [this._variedad_(mov.codigo_articulo, mov.codigo_envase)];
      const anulaciones = anulacionesPorMovimiento.get(String(mov.id_movimiento || '')) || [];
      const anulado = anulaciones.length > 0 || (capa && String(capa.estado_capa || '').toUpperCase() === 'ANULADA');
      const signo = Number(mov.signo || (tipo === 'ENTRADA' ? 1 : -1));
      const cajas = Math.abs(Number(mov.cajas || 0)) * (signo >= 0 ? 1 : -1);
      const docRefRaw = String(mov.id_documento_ref || '').trim();
      const esRefAjusteSintetica = !documento && /^AJUSTE:/i.test(docRefRaw);
      const etiquetaDocumento = tipoTransaccion === 'stock inicial'
        ? 'Stock inicial'
        : (this._etiquetaDocumento_(documento) || (esRefAjusteSintetica ? '' : docRefRaw));
      const motivoLegible = this._traducirMotivo_(motivo);
      const detalleTransaccion = tipoTransaccion === 'stock inicial'
        ? etiquetaDocumento
        : [etiquetaDocumento, motivoLegible].filter(Boolean).join(' · ');
      const usuarioVisibleMov = this._usuarioVisible_(mov.usuario, nombreAdminUnico);
      const texto = tipoTransaccion === 'stock inicial'
        ? `Stock inicial · ${mov.codigo_articulo || ''} ${mov.codigo_envase || ''}`
        : this._textoTransaccion_(
          tipoTransaccion === 'entrada' ? 'Entrada' : (tipoTransaccion === 'destrio' ? 'Destrío' : 'Ajuste'),
          mov.codigo_articulo,
          mov.codigo_envase,
          mov.entidad_nombre
        );
      const anulable = Boolean(capa && String(capa.estado_capa || '').toUpperCase() === 'ACTIVA'
        && Number(capa.cajas_consumidas || 0) === 0 && !anulado);

      const transaccion = {
        id: String(mov.id_movimiento || ''),
        tipo: tipoTransaccion,
        texto,
        detalle: detalleTransaccion,
        cajas,
        variedad: variedades[0],
        variedades,
        documento: etiquetaDocumento,
        usuario: usuarioVisibleMov,
        fecha_hora: mov.fecha_hora || '',
        fecha_negocio: this._fechaNegocio_(mov.fecha_negocio || ''),
        anulable,
        anulado,
        anulado_por: anulaciones.length > 0 ? String(anulaciones[0].id_movimiento || '') : '',
        anula_id: '',
        _busqueda: this._sinAcentos_([
          mov.id_movimiento, mov.codigo_articulo, mov.codigo_envase, mov.entidad_nombre,
          etiquetaDocumento, mov.usuario, usuarioVisibleMov, motivo, motivoLegible, mov.fecha_negocio
        ].join(' ')),
        _mov_ids: [String(mov.id_movimiento || '')]
      };
      transacciones.push(transaccion);
      transaccionPorMovimiento.set(String(mov.id_movimiento || ''), String(mov.id_movimiento || ''));
    }

    const gruposAnulacion = new Map();
    for (const [referencia, movs] of anulacionesPorMovimiento.entries()) {
      const idObjetivo = transaccionPorMovimiento.get(referencia) || referencia;
      if (!gruposAnulacion.has(idObjetivo)) {
        gruposAnulacion.set(idObjetivo, { idObjetivo, movs: [] });
      }
      gruposAnulacion.get(idObjetivo).movs.push(...movs);
    }

    for (const grupoAnulacion of gruposAnulacion.values()) {
      const movs = grupoAnulacion.movs;
      const primero = movs[0];
      const idObjetivo = grupoAnulacion.idObjetivo;
      const objetivo = transacciones.find(item => item.id === idObjetivo);
      const documento = documentosPorId.get(String(primero.id_documento_ref || ''));
      const usuarioVisibleAnul = this._usuarioVisible_(primero.usuario, nombreAdminUnico);
      const transaccion = {
        id: String(primero.id_movimiento || ''),
        tipo: 'anulacion',
        texto: objetivo ? `Anulación de ${objetivo.tipo} · ${objetivo.texto}` : 'Anulación',
        detalle: [objetivo ? objetivo.detalle : '', usuarioVisibleAnul].filter(Boolean).join(' · '),
        cajas: 0,
        variedad: objetivo ? objetivo.variedad : this._variedad_(primero.codigo_articulo, primero.codigo_envase),
        variedades: objetivo ? objetivo.variedades : [this._variedad_(primero.codigo_articulo, primero.codigo_envase)],
        documento: objetivo ? objetivo.documento : this._etiquetaDocumento_(documento),
        usuario: usuarioVisibleAnul,
        fecha_hora: primero.fecha_hora || '',
        fecha_negocio: this._fechaNegocio_(primero.fecha_negocio || ''),
        anulable: false,
        anulado: false,
        anulado_por: '',
        anula_id: idObjetivo,
        _busqueda: this._sinAcentos_([objetivo ? objetivo.texto : '', primero.usuario || '', usuarioVisibleAnul].join(' ')),
        _mov_ids: movs.map(mov => String(mov.id_movimiento || ''))
      };
      transacciones.push(transaccion);
    }

    for (const [idRep, movs] of anulacionesPorReproceso.entries()) {
      const primero = movs[0];
      const objetivo = transacciones.find(item => item.id === idRep);
      const usuarioVisibleAnulRep = this._usuarioVisible_(primero.usuario, nombreAdminUnico);
      const transaccion = {
        id: String(primero.id_movimiento || ''),
        tipo: 'anulacion',
        texto: objetivo ? `Anulación de cambio · ${objetivo.texto}` : 'Anulación de cambio',
        detalle: usuarioVisibleAnulRep,
        cajas: 0,
        variedad: objetivo ? objetivo.variedad : 'SIN CLASIFICAR',
        variedades: objetivo ? objetivo.variedades : [],
        documento: objetivo ? objetivo.documento : `REPROCESO:${idRep}`,
        usuario: usuarioVisibleAnulRep,
        fecha_hora: primero.fecha_hora || '',
        fecha_negocio: this._fechaNegocio_(primero.fecha_negocio || ''),
        anulable: false,
        anulado: false,
        anulado_por: '',
        anula_id: idRep,
        _busqueda: this._sinAcentos_([objetivo ? objetivo.texto : '', primero.usuario || '', usuarioVisibleAnulRep].join(' ')),
        _mov_ids: movs.map(mov => String(mov.id_movimiento || ''))
      };
      transacciones.push(transaccion);
    }

    for (const mov of anulacionesSinReferencia) {
      const usuarioVisibleSinRef = this._usuarioVisible_(mov.usuario, nombreAdminUnico);
      const transaccion = {
        id: String(mov.id_movimiento || ''),
        tipo: 'anulacion',
        texto: 'Anulación',
        detalle: mov.observaciones || '',
        cajas: 0,
        variedad: this._variedad_(mov.codigo_articulo, mov.codigo_envase),
        variedades: [this._variedad_(mov.codigo_articulo, mov.codigo_envase)],
        documento: String(mov.id_documento_ref || ''),
        usuario: usuarioVisibleSinRef,
        fecha_hora: mov.fecha_hora || '',
        fecha_negocio: this._fechaNegocio_(mov.fecha_negocio || ''),
        anulable: false,
        anulado: false,
        anulado_por: '',
        anula_id: '',
        _busqueda: this._sinAcentos_([mov.codigo_articulo, mov.codigo_envase, mov.observaciones, mov.usuario || '', usuarioVisibleSinRef].join(' ')),
        _mov_ids: [String(mov.id_movimiento || '')]
      };
      transacciones.push(transaccion);
    }

    return transacciones;
  }

  _normalizarTipoFiltro_(valor) {
    const texto = this._sinAcentos_(valor);
    if (texto === 'entrada' || texto === 'entradas') return 'entrada';
    if (texto === 'salida' || texto === 'salidas') return 'salida';
    if (texto === 'cambio' || texto === 'cambios' || texto === 'reproceso' || texto === 'reprocesos') return 'cambio';
    if (texto === 'destrio' || texto === 'destrios') return 'destrio';
    if (texto === 'ajuste' || texto === 'ajustes') return 'ajuste';
    if (texto === 'stock inicial' || texto === 'stock_inicial' || texto === 'inicial') return 'stock inicial';
    if (texto === 'anulacion' || texto === 'anulaciones' || texto === 'anulacion') return 'anulacion';
    return texto;
  }

  _filtrarTransacciones_(transacciones, filtros) {
    const opciones = filtros || {};
    const tipos = opciones.tipo === undefined || opciones.tipo === null || opciones.tipo === ''
      ? null
      : (Array.isArray(opciones.tipo) ? opciones.tipo : [opciones.tipo]).map(tipo => this._normalizarTipoFiltro_(tipo));
    const variedad = opciones.variedad === undefined || opciones.variedad === null ? '' : this._sinAcentos_(opciones.variedad);
    const desde = opciones.desde ? this._fechaNegocio_(opciones.desde) : '';
    const hasta = opciones.hasta ? this._fechaNegocio_(opciones.hasta) : '';
    const texto = opciones.texto ? this._sinAcentos_(opciones.texto) : '';

    return transacciones.filter(transaccion => {
      if (tipos && tipos.length > 0 && !tipos.includes(transaccion.tipo)) return false;
      if (variedad) {
        const coincide = (transaccion.variedades || []).some(valor => this._sinAcentos_(valor) === variedad)
          || this._sinAcentos_(transaccion.variedad).includes(variedad);
        if (!coincide) return false;
      }
      if (desde && transaccion.fecha_negocio < desde) return false;
      if (hasta && transaccion.fecha_negocio > hasta) return false;
      if (texto && !transaccion._busqueda.includes(texto)) return false;
      return true;
    });
  }

  _publicarTransaccion_(transaccion) {
    return {
      id: transaccion.id,
      tipo: transaccion.tipo,
      texto: transaccion.texto,
      detalle: transaccion.detalle,
      cajas: transaccion.cajas,
      variedad: transaccion.variedad,
      variedades: transaccion.variedades,
      documento: transaccion.documento,
      usuario: transaccion.usuario,
      fecha_hora: transaccion.fecha_hora,
      fecha_negocio: transaccion.fecha_negocio,
      anulable: transaccion.anulable,
      anulado: transaccion.anulado,
      anulado_por: transaccion.anulado_por,
      anula_id: transaccion.anula_id
    };
  }

  /**
   * Historial de movimientos como transacciones de banco (T-025 regla 4).
   * @param {Object} [filtros]
   * @returns {Object}
   */
  listarMovimientos(filtros = {}) {
    const datos = this._cargarHistorial_();
    this._cacheVariedad.clear();
    const transacciones = this._construirTransacciones_(datos);
    const filtradas = this._filtrarTransacciones_(transacciones, filtros);

    filtradas.sort((a, b) => {
      if (a.fecha_negocio !== b.fecha_negocio) return a.fecha_negocio < b.fecha_negocio ? 1 : -1;
      if (a.fecha_hora !== b.fecha_hora) return a.fecha_hora < b.fecha_hora ? 1 : -1;
      return String(a.id).localeCompare(String(b.id));
    });

    const limiteSolicitado = Number(filtros && filtros.limite);
    const limite = Number.isFinite(limiteSolicitado) && limiteSolicitado > 0
      ? Math.floor(limiteSolicitado)
      : 50;
    const cursorSolicitado = Number(filtros && filtros.cursor);
    const inicio = Number.isFinite(cursorSolicitado) && cursorSolicitado > 0 ? Math.floor(cursorSolicitado) : 0;
    const pagina = filtradas.slice(inicio, inicio + limite);
    const siguiente = inicio + limite < filtradas.length ? String(inicio + limite) : null;

    const grupos = [];
    for (const transaccion of pagina) {
      const fecha = transaccion.fecha_negocio || '';
      let grupo = grupos.length > 0 ? grupos[grupos.length - 1] : null;
      if (!grupo || grupo.fecha !== fecha) {
        grupo = { fecha, elementos: [] };
        grupos.push(grupo);
      }
      grupo.elementos.push(this._publicarTransaccion_(transaccion));
    }

    return {
      grupos,
      total: filtradas.length,
      limite,
      cursor: inicio,
      siguiente_cursor: siguiente
    };
  }

  _variedadesCatalogo_() {
    const config = this._configCatalogo_();
    const agrupaciones = Array.isArray(config.agrupaciones) ? config.agrupaciones : [];
    const vistas = [];
    const vistos = new Set();
    for (const fila of agrupaciones) {
      if (!fila) continue;
      if (String(fila.agrupacion || '').trim().toUpperCase() !== 'COMERCIAL') continue;
      const activo = fila.activo === undefined || fila.activo === null || fila.activo === ''
        ? true
        : String(fila.activo).toUpperCase() !== 'FALSE' && String(fila.activo).toUpperCase() !== 'NO';
      if (!activo) continue;
      const grupo = String(fila.grupo || '').trim();
      if (!grupo || vistos.has(this._sinAcentos_(grupo))) continue;
      vistos.add(this._sinAcentos_(grupo));
      vistas.push(grupo);
    }
    return vistas;
  }

  /**
   * Búsqueda global ⌘K (T-025 regla 5).
   * @param {string} texto
   * @returns {{ variedades: Array<Object>, partidas: Array<Object>, albaranes: Array<Object>, cambios: Array<Object>, total: number }}
   */
  buscar(texto) {
    const consulta = this._sinAcentos_(texto);
    const respuesta = { variedades: [], partidas: [], albaranes: [], cambios: [], total: 0 };
    if (!consulta) return respuesta;

    const capas = (this.repo && typeof this.repo.getCapasFifo === 'function') ? this.repo.getCapasFifo() : [];
    const stock = (this.repo && typeof this.repo.getStockActual === 'function') ? this.repo.getStockActual() : [];
    const documentos = (this.repo && typeof this.repo.getDocumentos === 'function') ? this.repo.getDocumentos() : [];
    const { reprocesos, lineas } = this._cargarReprocesos_();
    this._cacheVariedad.clear();

    const cajasPorVariedad = {};
    for (const fila of stock) {
      const variedad = this._variedad_(fila.codigo_articulo, fila.codigo_envase);
      cajasPorVariedad[variedad] = (cajasPorVariedad[variedad] || 0) + Number(fila.cajas_actuales || 0);
    }

    for (const grupo of this._variedadesCatalogo_()) {
      if (!this._sinAcentos_(grupo).includes(consulta)) continue;
      respuesta.variedades.push({
        id: grupo,
        tipo: 'variedad',
        grupo,
        cajas: Number(cajasPorVariedad[grupo] || 0)
      });
      if (respuesta.variedades.length >= 5) break;
    }

    for (const capa of capas) {
      if (Number(capa.cajas_restantes || 0) <= 0) continue;
      const haystack = this._sinAcentos_([
        capa.id_capa, capa.codigo_articulo, capa.codigo_envase, capa.proveedor,
        capa.fecha_capa, capa.partida
      ].join(' '));
      if (!haystack.includes(consulta)) continue;
      respuesta.partidas.push({
        id: capa.id_capa,
        tipo: 'partida',
        articulo: capa.codigo_articulo,
        envase: capa.codigo_envase,
        proveedor: capa.proveedor || '',
        fecha: capa.fecha_capa || '',
        cajas: Number(capa.cajas_restantes || 0)
      });
      if (respuesta.partidas.length >= 8) break;
    }

    for (const doc of documentos) {
      const haystack = this._sinAcentos_([
        doc.id_documento, doc.serie, doc.numero, doc.entidad_nombre, doc.fecha_documento,
        `${doc.serie || ''}/${doc.numero || ''}`
      ].join(' '));
      if (!haystack.includes(consulta)) continue;
      respuesta.albaranes.push({
        id: doc.id_documento,
        tipo: 'albaran',
        serie: doc.serie || '',
        numero: doc.numero || '',
        entidad: doc.entidad_nombre || '',
        fecha: doc.fecha_documento || ''
      });
      if (respuesta.albaranes.length >= 4) break;
    }

    const lineasPorReproceso = new Map();
    for (const linea of lineas) {
      const id = String(linea.id_reproceso || '');
      if (!lineasPorReproceso.has(id)) lineasPorReproceso.set(id, []);
      lineasPorReproceso.get(id).push(linea);
    }
    for (const rep of reprocesos) {
      const id = String(rep.id_reproceso || '');
      const lineasRep = lineasPorReproceso.get(id) || [];
      const haystack = this._sinAcentos_([
        id, rep.fecha, rep.fecha_hora, rep.usuario, rep.observaciones,
        ...lineasRep.map(linea => `${linea.codigo_articulo} ${linea.codigo_envase} ${linea.proveedor}`)
      ].join(' '));
      if (!haystack.includes(consulta)) continue;
      respuesta.cambios.push({
        id,
        tipo: 'cambio',
        texto: this._textoCambio_(rep, lineasRep),
        fecha: rep.fecha || ''
      });
      if (respuesta.cambios.length >= 3) break;
    }

    respuesta.total = respuesta.variedades.length + respuesta.partidas.length
      + respuesta.albaranes.length + respuesta.cambios.length;
    if (respuesta.total > OPERACIONES_LIMITE_BUSQUEDA) {
      const sobrante = respuesta.total - OPERACIONES_LIMITE_BUSQUEDA;
      for (let i = 0; i < sobrante; i++) {
        if (respuesta.cambios.length > 0) respuesta.cambios.pop();
        else if (respuesta.albaranes.length > 0) respuesta.albaranes.pop();
        else if (respuesta.partidas.length > 0) respuesta.partidas.pop();
        else respuesta.variedades.pop();
      }
      respuesta.total = OPERACIONES_LIMITE_BUSQUEDA;
    }
    return respuesta;
  }

  _textoCambio_(reproceso, lineas) {
    const origenes = lineas.filter(linea => String(linea.tipo || '').toUpperCase() === 'ORIGEN');
    const destinos = lineas.filter(linea => String(linea.tipo || '').toUpperCase() === 'DESTINO');
    const totalRetirado = origenes.reduce((total, linea) => total + Number(linea.cajas || 0), 0);
    const totalDestinos = destinos.reduce((total, linea) => total + Number(linea.cajas || 0), 0);
    const origen = origenes[0] || {};
    const destino = destinos[0] || {};
    return `${totalRetirado} ${origen.codigo_articulo || ''} ${origen.codigo_envase || ''} → `
      + `${totalDestinos} ${destino.codigo_articulo || ''} ${destino.codigo_envase || ''}`;
  }
}

function variantesTexto_(lineas) {
  return (Array.isArray(lineas) ? lineas : [])
    .map(linea => `${linea.codigo_articulo || ''} ${linea.codigo_envase || ''} ${linea.proveedor || ''}`)
    .join(' ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OperacionesService,
    UMBRAL_RENDE_DISTINTO_PCT,
    OPERACIONES_LIMITE_BUSQUEDA
  };
}
