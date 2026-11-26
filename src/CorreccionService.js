/**
 * STOCK-LIGHT — CorreccionService.js
 *
 * Correcciones de documentos de Hispatec (T-027, D-038):
 * - guarda y aplica versiones nuevas de un documento MODIFICADO_EN_ERP;
 * - la corrección de una entrada se hace en cascada: se deshacen los dependientes,
 *   se sustituye la entrada y se rehacen los dependientes;
 * - anula ajustes y destríos.
 *
 * Todo el cálculo se hace sobre el estado en memoria. La escritura real se concentra
 * en un lock y un único `_persistir`; MOVIMIENTOS solo recibe filas nuevas.
 */

const CORRECCION_LIBRO_NODE = typeof module !== 'undefined' && module.exports
  ? require('./Libro')
  : null;
const CORRECCION_REPROCESO_NODE = typeof module !== 'undefined' && module.exports
  ? require('./Reproceso')
  : null;
const CORRECCION_NORMALIZACION_NODE = typeof module !== 'undefined' && module.exports
  ? require('./Normalizacion')
  : null;

class CorreccionService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.repository]
   * @param {Object} [options.movementService]
   * @param {Object} [options.catalogoService]
   * @param {Object} [options.pendientesService]
   * @param {Object} [options.configCatalogo]
   * @param {Object} [options.lockService]
   */
  constructor(options = {}) {
    const RepoClass = (typeof SheetsRepository !== 'undefined')
      ? SheetsRepository
      : (typeof require !== 'undefined' ? require('./Repository').SheetsRepository : null);
    if (!RepoClass && !options.repository) {
      throw new Error('SheetsRepository no está disponible en CorreccionService');
    }
    this.repo = options.repository || new RepoClass();

    const MovementClass = (typeof MovementService !== 'undefined')
      ? MovementService
      : (typeof require !== 'undefined' ? require('./MovementService').MovementService : null);
    this.movementService = options.movementService || (MovementClass
      ? new MovementClass({ repository: this.repo, lockService: options.lockService })
      : null);
    if (!this.movementService) {
      throw new Error('MovementService no está disponible en CorreccionService');
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

    this.pendientesService = options.pendientesService || null;
    this._cacheVariedad = new Map();
  }

  _nuevoId_(prefijo) {
    if (this.movementService && typeof this.movementService._nuevoId === 'function') {
      return this.movementService._nuevoId(prefijo);
    }
    const fn = typeof nuevoId === 'function'
      ? nuevoId
      : (typeof global !== 'undefined' && typeof global.nuevoId === 'function' ? global.nuevoId : null);
    if (!fn) throw new Error('nuevoId no está disponible en CorreccionService');
    return fn(prefijo);
  }

  _normalizar_(texto) {
    if (CORRECCION_NORMALIZACION_NODE) return CORRECCION_NORMALIZACION_NODE.normalizarNombre(texto);
    if (typeof normalizarNombre === 'function') return normalizarNombre(texto);
    return String(texto === null || texto === undefined ? '' : texto).trim().replace(/\s+/g, ' ').toUpperCase();
  }

  _clonarEstado_(estado) {
    const clonarFn = (this.movementService && this.movementService.libro && typeof this.movementService.libro.clonarEstadoLibro === 'function')
      ? this.movementService.libro.clonarEstadoLibro
      : (CORRECCION_LIBRO_NODE && typeof CORRECCION_LIBRO_NODE.clonarEstadoLibro === 'function'
        ? CORRECCION_LIBRO_NODE.clonarEstadoLibro
        : (typeof clonarEstadoLibro === 'function' ? clonarEstadoLibro : null));
    if (typeof clonarFn === 'function') return clonarFn(estado);
    return {
      capas: Array.isArray(estado && estado.capas) ? estado.capas.map(c => ({ ...c })) : [],
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

  _cargarDatos_() {
    const cargado = this.movementService._cargarEstado();
    const repo = this.repo;
    return {
      estado: cargado.estado,
      movimientos: cargado.movimientos || [],
      documentos: (repo && typeof repo.getDocumentos === 'function') ? repo.getDocumentos() : [],
      reprocesos: (repo && typeof repo.getReprocesos === 'function') ? repo.getReprocesos() : [],
      lineas: (repo && typeof repo.getReprocesoLineas === 'function') ? repo.getReprocesoLineas() : [],
      pendientes: (repo && typeof repo.getPendientes === 'function') ? repo.getPendientes() : [],
      versiones: (repo && typeof repo.getVersionesDocumento === 'function') ? repo.getVersionesDocumento() : []
    };
  }

  _esMovimientoReproceso_(mov) {
    const docRef = String(mov && mov.id_documento_ref || '');
    if (docRef.startsWith('REPROCESO:')) return true;
    return String(mov && mov.motivo_ajuste || '').toUpperCase().startsWith('REPROCESO');
  }

  _anuladosSet_(movimientos) {
    const anulados = new Set();
    for (const mov of movimientos) {
      if (String(mov.tipo_movimiento || '').toUpperCase() !== 'ANULACION') continue;
      const ref = String(mov.id_movimiento_ref || '').trim();
      if (ref) anulados.add(ref);
    }
    return anulados;
  }

  _cajasEfectivas_(estado, mov) {
    const consumos = estado && estado.consumosPorMovimiento
      ? estado.consumosPorMovimiento[String(mov.id_movimiento || '')]
      : null;
    if (Array.isArray(consumos) && consumos.length > 0) {
      const suma = consumos.reduce((total, c) => total + Number(c.cajas || 0), 0);
      if (suma > 0) return suma;
    }
    return Number(mov.cajas || 0);
  }

  _parseLineasVersion_(version) {
    if (!version || !version.lineas_json) return [];
    try {
      const parsed = JSON.parse(version.lineas_json);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  _lineaEsOk_(linea) {
    const estado = String(linea && (linea.estado || linea.seguimiento) || '').trim().toUpperCase();
    return estado === '' || estado === 'OK' || estado === 'SEGUIDA';
  }

  _movsDoc_(movimientos, docId, tipo) {
    return movimientos.filter(mov =>
      String(mov.tipo_movimiento || '').toUpperCase() === tipo &&
      String(mov.id_documento_ref || '') === String(docId || '') &&
      String(mov.estado || '').toUpperCase() === 'CONFIRMADO'
    );
  }

  _lineasViejas_(datos, doc, tipo) {
    const anulados = this._anuladosSet_(datos.movimientos);
    const docId = String(doc.id_documento || '');
    const movs = (tipo === 'ENTRADA' ? 'ENTRADA' : 'SALIDA');
    const activos = this._movsDoc_(datos.movimientos, docId, movs)
      .filter(mov => !anulados.has(String(mov.id_movimiento || '')))
      .sort((a, b) => {
        const sa = Number(a.secuencia);
        const sb = Number(b.secuencia);
        if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
        return String(a.fecha_hora || '').localeCompare(String(b.fecha_hora || ''));
      });

    const lineas = [];
    for (let i = 0; i < activos.length; i++) {
      const mov = activos[i];
      const capa = tipo === 'ENTRADA'
        ? datos.estado.capas.find(c => String(c.id_movimiento_entrada || '') === String(mov.id_movimiento || ''))
          || datos.estado.capas.find(c => String(c.id_capa || '') === String(mov.id_capa_creada || ''))
        : null;
      if (tipo === 'ENTRADA' && (!capa || String(capa.estado_capa || '').toUpperCase() === 'ANULADA')) continue;
      lineas.push({
        linea: i + 1,
        articulo: mov.codigo_articulo,
        envase: mov.codigo_envase,
        cajas: tipo === 'ENTRADA'
          ? Number(capa.cajas_iniciales || mov.cajas || 0)
          : Number(mov.cajas || 0),
        fecha: tipo === 'ENTRADA' ? (capa.fecha_capa || mov.fecha_negocio) : mov.fecha_negocio,
        entidad: mov.entidad_nombre || (capa && capa.proveedor) || '',
        kg: mov.kg_informativo === undefined ? '' : mov.kg_informativo,
        id_movimiento: mov.id_movimiento,
        id_capa: capa ? capa.id_capa : ''
      });
    }
    return { lineas, movimientos: activos };
  }

  _contextoVersion_(datos, idPendiente) {
    const id = String(idPendiente === null || idPendiente === undefined ? '' : idPendiente).trim();
    const pendiente = datos.pendientes.find(p => String(p.id_pendiente || '').trim() === id);
    if (!pendiente) return { ok: false, motivo: 'PENDIENTE_NO_ENCONTRADO' };
    if (String(pendiente.estado || '').trim().toUpperCase() !== 'PENDIENTE') {
      return { ok: false, motivo: 'PENDIENTE_NO_PENDIENTE' };
    }

    const versiones = datos.versiones
      .filter(v => String(v.id_pendiente || '') === id)
      .sort((a, b) => String(b.fecha_alta || '').localeCompare(String(a.fecha_alta || '')));
    const version = versiones.find(v => String(v.estado || '').toUpperCase() === 'PENDIENTE') || versiones[0];
    if (!version) return { ok: false, motivo: 'VERSION_NO_ENCONTRADA' };
    if (String(version.estado || '').toUpperCase() !== 'PENDIENTE') {
      return { ok: false, motivo: 'VERSION_NO_PENDIENTE' };
    }

    const tipo = String(pendiente.tipo_doc || '').toUpperCase() === 'ENTRADA' ? 'ENTRADA' : 'SALIDA';
    const doc = datos.documentos.find(d =>
      String(d.id_documento || '') === String(version.id_documento || '')
    ) || datos.documentos.find(d =>
      String(d.tipo_documento || '').toUpperCase() === (tipo === 'ENTRADA' ? 'COMPRA' : 'SALIDA') &&
      String(d.serie || '').trim() === String(pendiente.serie || '').trim() &&
      String(d.numero || '').trim() === String(pendiente.numero || '').trim()
    );
    if (!doc) return { ok: false, motivo: 'DOCUMENTO_NO_ENCONTRADO' };

    const lineasNuevas = this._parseLineasVersion_(version);
    if (lineasNuevas.length === 0) return { ok: false, motivo: 'VERSION_SIN_LINEAS' };
    const lineasNuevasOk = lineasNuevas.filter(linea => this._lineaEsOk_(linea));

    const viejas = this._lineasViejas_(datos, doc, tipo);
    if (viejas.lineas.length === 0) {
      // T-031: un documento totalmente excluido no tiene movimientos, pero guarda
      // su versión de partida (o la última versión aplicada sin movimientos).
      const versionBase = datos.versiones
        .filter(v => String(v.id_documento || '') === String(doc.id_documento || ''))
        .filter(v => {
          const estado = String(v.estado || '').trim().toUpperCase();
          return estado === 'BASE' || estado === 'APLICADA';
        })
        .sort((a, b) => String(b.fecha_alta || '').localeCompare(String(a.fecha_alta || '')))[0];
      if (versionBase) {
        const lineasBase = this._parseLineasVersion_(versionBase);
        if (lineasBase.length > 0) {
          viejas.lineas = lineasBase.map((linea, indice) => Object.assign({}, linea, {
            linea: linea.linea === undefined || linea.linea === null ? indice + 1 : linea.linea,
            id_capa: ''
          }));
        }
      }
    }
    if (viejas.lineas.length === 0) return { ok: false, motivo: 'DOCUMENTO_SIN_VERSION_ACTIVA' };

    return {
      ok: true,
      pendiente,
      version,
      doc,
      tipo,
      lineasNuevas,
      lineasNuevasOk,
      lineasViejas: viejas.lineas,
      movimientosViejos: viejas.movimientos
    };
  }

  _coincideLinea_(vieja, nueva, indice, usadas, permitirOrdinal = true) {
    const claveVieja = `${String(vieja.linea || '').trim()}|${this._normalizar_(vieja.articulo)}|${this._normalizar_(vieja.envase)}`;
    for (let i = 0; i < nueva.length; i++) {
      if (usadas.has(i)) continue;
      const linea = nueva[i];
      if (String(linea.linea === undefined || linea.linea === null ? '' : linea.linea).trim() === String(vieja.linea || '').trim()) {
        return i;
      }
      if (`${String(linea.linea === undefined || linea.linea === null ? '' : linea.linea).trim()}|${this._normalizar_(linea.articulo)}|${this._normalizar_(linea.envase)}` === claveVieja) {
        return i;
      }
    }
    for (let i = 0; i < nueva.length; i++) {
      if (usadas.has(i)) continue;
      if (this._normalizar_(nueva[i].articulo) === this._normalizar_(vieja.articulo)
        && this._normalizar_(nueva[i].envase) === this._normalizar_(vieja.envase)) {
        return i;
      }
    }
    if (permitirOrdinal && indice < nueva.length && !usadas.has(indice)) {
      const lineaNueva = nueva[indice];
      const numeroNuevo = lineaNueva && lineaNueva.linea !== undefined && lineaNueva.linea !== null
        ? String(lineaNueva.linea).trim()
        : '';
      if (numeroNuevo === '' || numeroNuevo === String(vieja.linea || '').trim()) {
        return indice;
      }
    }
    return -1;
  }

  _lineasCambian_(ctx) {
    const nuevas = Array.isArray(ctx.lineasNuevas) ? ctx.lineasNuevas : [];
    const viejas = Array.isArray(ctx.lineasViejas) ? ctx.lineasViejas : [];
    const usadas = new Set();
    const resultado = [];

    for (let i = 0; i < viejas.length; i++) {
      const vieja = viejas[i];
      const indice = this._coincideLinea_(vieja, nuevas, i, usadas);
      if (indice >= 0) usadas.add(indice);
      const nueva = indice >= 0 ? nuevas[indice] : null;
      const cambios = [];
      if (!nueva) {
        cambios.push('eliminada');
      } else {
        for (const campo of ['articulo', 'envase', 'cajas', 'fecha', 'entidad', 'kg']) {
          const valorViejo = campo === 'articulo' || campo === 'envase'
            ? this._normalizar_(vieja[campo])
            : (vieja[campo] === undefined ? '' : vieja[campo]);
          const valorNuevo = campo === 'articulo' || campo === 'envase'
            ? this._normalizar_(nueva[campo])
            : (nueva[campo] === undefined ? '' : nueva[campo]);
          if (String(valorViejo) !== String(valorNuevo)) cambios.push(campo);
        }
      }
      resultado.push({
        linea: vieja.linea,
        antes: {
          articulo: vieja.articulo,
          envase: vieja.envase,
          cajas: vieja.cajas,
          fecha: vieja.fecha,
          entidad: vieja.entidad,
          kg: vieja.kg
        },
        despues: nueva ? {
          articulo: nueva.articulo,
          envase: nueva.envase,
          cajas: nueva.cajas,
          fecha: nueva.fecha,
          entidad: nueva.entidad,
          kg: nueva.kg
        } : null,
        cambios
      });
    }

    for (let i = 0; i < nuevas.length; i++) {
      if (usadas.has(i)) continue;
      const nueva = nuevas[i];
      resultado.push({
        linea: nueva.linea,
        antes: null,
        despues: {
          articulo: nueva.articulo,
          envase: nueva.envase,
          cajas: nueva.cajas,
          fecha: nueva.fecha,
          entidad: nueva.entidad,
          kg: nueva.kg
        },
        cambios: ['nueva']
      });
    }
    return resultado;
  }

  _efectoVariedades_(estadoAntes, estadoDespues) {
    const porVariedad = {};
    const claves = new Set([
      ...Object.keys(estadoAntes.stock || {}),
      ...Object.keys(estadoDespues.stock || {})
    ]);
    for (const clave of claves) {
      const diferencia = Number(estadoDespues.stock[clave] || 0) - Number(estadoAntes.stock[clave] || 0);
      if (diferencia === 0) continue;
      const partes = String(clave).split('|');
      const variedad = this._variedad_(partes[0], partes[1]);
      porVariedad[variedad] = (porVariedad[variedad] || 0) + diferencia;
    }
    return Object.keys(porVariedad).map(variedad => ({ variedad, cajas: porVariedad[variedad] }));
  }

  _partidasCambian_(estadoAntes, estadoDespues) {
    const antes = new Map((estadoAntes.capas || []).map(c => [String(c.id_capa || ''), c]));
    const despues = new Map((estadoDespues.capas || []).map(c => [String(c.id_capa || ''), c]));
    const ids = new Set([...antes.keys(), ...despues.keys()]);
    const cambios = [];
    for (const id of ids) {
      const a = antes.get(id);
      const d = despues.get(id);
      const restantesA = a ? Number(a.cajas_restantes || 0) : 0;
      const restantesD = d ? Number(d.cajas_restantes || 0) : 0;
      const estadoA = a ? String(a.estado_capa || '') : '';
      const estadoD = d ? String(d.estado_capa || '') : '';
      const proveedorA = a ? String(a.proveedor || '') : '';
      const proveedorD = d ? String(d.proveedor || '') : '';
      const fechaA = a ? String(a.fecha_capa || '') : '';
      const fechaD = d ? String(d.fecha_capa || '') : '';
      if (restantesA === restantesD && estadoA === estadoD && proveedorA === proveedorD && fechaA === fechaD) {
        continue;
      }
      cambios.push({
        id_capa: id,
        articulo: (d && d.codigo_articulo) || (a && a.codigo_articulo) || '',
        envase: (d && d.codigo_envase) || (a && a.codigo_envase) || '',
        antes: a ? {
          cajas_restantes: restantesA,
          estado_capa: estadoA,
          proveedor: proveedorA,
          fecha_capa: fechaA
        } : null,
        despues: d ? {
          cajas_restantes: restantesD,
          estado_capa: estadoD,
          proveedor: proveedorD,
          fecha_capa: fechaD
        } : null,
        cajas_antes: restantesA,
        cajas_despues: restantesD
      });
    }
    return cambios;
  }

  _crearAnulacion_(mov, cajas, signo, usuario, idCapaObjetivo) {
    return {
      id_movimiento: this._nuevoId_('MOV-ANUL'),
      fecha_hora: new Date().toISOString(),
      tipo_movimiento: 'ANULACION',
      id_documento_ref: mov.id_documento_ref || '',
      codigo_articulo: mov.codigo_articulo,
      codigo_envase: mov.codigo_envase,
      cajas: Number(cajas),
      signo,
      partida_origen: mov.partida_origen || '',
      motivo_ajuste: 'CORRECCION_VERSION',
      usuario: usuario || 'SISTEMA',
      observaciones: `Anulación por corrección de versión (${mov.id_movimiento || ''})`,
      estado: 'CONFIRMADO',
      fecha_negocio: mov.fecha_negocio || '',
      entidad_nombre: mov.entidad_nombre || '',
      secuencia: '',
      origen_dato: 'MANUAL',
      kg_informativo: '',
      id_movimiento_ref: mov.id_movimiento || '',
      id_capa_objetivo: idCapaObjetivo || '',
      id_capa_creada: ''
    };
  }

  _crearSalidaVersion_(origen, usuario, idPendiente) {
    return {
      id_movimiento: this._nuevoId_('MOV'),
      fecha_hora: new Date().toISOString(),
      tipo_movimiento: 'SALIDA',
      id_documento_ref: origen.id_documento_ref || '',
      codigo_articulo: origen.codigo_articulo,
      codigo_envase: origen.codigo_envase,
      cajas: Number(origen.cajas),
      signo: -1,
      partida_origen: origen.partida_origen || '',
      motivo_ajuste: '',
      usuario: usuario || 'SISTEMA',
      observaciones: `CORRECCION_VERSION:${idPendiente};ORIGINAL:${origen.id_movimiento || ''}`,
      estado: 'CONFIRMADO',
      fecha_negocio: origen.fecha_negocio || '',
      entidad_nombre: origen.entidad_nombre || '',
      secuencia: '',
      origen_dato: origen.origen_dato || 'CSV',
      kg_informativo: origen.kg_informativo === undefined ? '' : origen.kg_informativo,
      id_movimiento_ref: '',
      id_capa_objetivo: '',
      id_capa_creada: ''
    };
  }

  _crearEntradaVersion_(linea, doc, usuario, idPendiente) {
    return {
      id_movimiento: this._nuevoId_('MOV'),
      fecha_hora: new Date().toISOString(),
      tipo_movimiento: 'ENTRADA',
      id_documento_ref: doc.id_documento || '',
      documento_ref: `${doc.serie || ''}/${doc.numero || ''}`,
      codigo_articulo: linea.articulo,
      codigo_envase: linea.envase,
      cajas: Number(linea.cajas),
      signo: 1,
      partida_origen: '',
      motivo_ajuste: '',
      usuario: usuario || 'SISTEMA',
      observaciones: `CORRECCION_VERSION:${idPendiente}`,
      estado: 'CONFIRMADO',
      fecha_negocio: linea.fecha || doc.fecha_documento || '',
      entidad_nombre: String(linea.entidad || doc.entidad_nombre || '').trim(),
      secuencia: '',
      origen_dato: linea.origenDato || 'CSV',
      kg_informativo: linea.kg === undefined ? '' : linea.kg,
      id_movimiento_ref: '',
      id_capa_objetivo: '',
      id_capa_creada: this._nuevoId_('CAPA')
    };
  }

  _crearAjusteNegativoVersion_(mov, usuario, idPendiente) {
    return {
      id_movimiento: this._nuevoId_('MOV'),
      fecha_hora: new Date().toISOString(),
      tipo_movimiento: 'AJUSTE',
      id_documento_ref: mov.id_documento_ref || '',
      codigo_articulo: mov.codigo_articulo,
      codigo_envase: mov.codigo_envase,
      cajas: Number(mov.cajas),
      signo: -1,
      partida_origen: mov.partida_origen || '',
      motivo_ajuste: mov.motivo_ajuste || 'AJUSTE',
      usuario: usuario || 'SISTEMA',
      observaciones: `CORRECCION_VERSION:${idPendiente};ORIGINAL:${mov.id_movimiento || ''}`,
      estado: 'CONFIRMADO',
      fecha_negocio: mov.fecha_negocio || '',
      entidad_nombre: mov.entidad_nombre || '',
      secuencia: '',
      origen_dato: mov.origen_dato || 'MANUAL',
      kg_informativo: '',
      id_movimiento_ref: '',
      id_capa_objetivo: '',
      id_capa_creada: ''
    };
  }

  _pendienteDeVenta_(mov, linea, cajas, usuario, idPendiente, documento) {
    const doc = documento || {};
    const referencia = String(mov.id_documento_ref || '');
    const partes = referencia.includes('/') ? referencia.split('/') : [];
    return {
      id_pendiente: this._nuevoId_('PEND'),
      id_importacion: '',
      tipo_doc: 'SALIDA',
      serie: String(doc.serie || partes[0] || ''),
      numero: String(doc.numero || (partes.length > 1 ? partes.slice(1).join('/') : '')),
      linea: linea === undefined || linea === null ? '' : linea,
      fecha_negocio: mov.fecha_negocio || '',
      entidad: mov.entidad_nombre || doc.entidad_nombre || '',
      articulo: mov.codigo_articulo,
      envase: mov.codigo_envase,
      cajas: Number(cajas),
      kg: '',
      motivo: 'STOCK_INSUFICIENTE',
      estado: 'PENDIENTE',
      fecha_alta: new Date().toISOString(),
      fecha_resolucion: ''
    };
  }

  /**
   * Ejecuta la cascada de la regla 3 sobre el estado en memoria.
   * No escribe nada. Devuelve el plan completo y el estado final.
   */
  _ejecutarCascada_(datos, ctx, usuario) {
    const estadoInicial = this._clonarEstado_(datos.estado);
    let estado = this._clonarEstado_(estadoInicial);
    const movimientosNuevos = [];
    const ventasPendientes = [];
    const pendientesNuevos = [];
    const operacionesRehechas = [];
    const documentos = datos.documentos.map(d => ({ ...d }));
    const reprocesos = datos.reprocesos.map(r => ({ ...r }));
    const reprocesoLineas = datos.lineas.map(l => ({ ...l }));
    let versiones = datos.versiones.map(v => ({ ...v }));
    const pendientes = datos.pendientes.map(p => ({ ...p }));
    const anulados = this._anuladosSet_(datos.movimientos);
    const doc = ctx.doc;
    const tipo = ctx.tipo;
    const idPendiente = String(ctx.pendiente.id_pendiente || '');
    const nuevaFirma = ctx.version.firma_lineas || '';

    const aplicar = (mov) => {
      const res = this.movementService._aplicar(estado, mov);
      if (!res.ok) return res;
      estado = res.estado;
      movimientosNuevos.push(mov);
      return res;
    };
    const fallo = (motivo) => ({ posible: false, motivo });

    const aplicarAnulacion = (mov, cajas, signo, idCapaObjetivo) => {
      const anul = this._crearAnulacion_(mov, cajas, signo, usuario, idCapaObjetivo);
      const res = aplicar(anul);
      if (!res.ok) return res;
      return res;
    };

    // -----------------------------------------------------------------------
    // Documento de SALIDA: anular la versión vieja y aplicar la nueva.
    // -----------------------------------------------------------------------
    if (tipo === 'SALIDA') {
      for (const mov of ctx.movimientosViejos) {
        const cajas = this._cajasEfectivas_(estado, mov);
        const res = aplicarAnulacion(mov, cajas, 1, '');
        if (!res.ok) return fallo(res.error || 'No se pudo anular la salida anterior');
      }

      const estadoAntesNueva = this._clonarEstado_(estado);
      const indiceMov = movimientosNuevos.length;
      let faltaStock = false;
      for (const linea of ctx.lineasNuevasOk) {
        const mov = this._crearSalidaVersion_({
          id_documento_ref: doc.id_documento || '',
          codigo_articulo: linea.articulo,
          codigo_envase: linea.envase,
          cajas: linea.cajas,
          fecha_negocio: linea.fecha || doc.fecha_documento,
          entidad_nombre: linea.entidad || doc.entidad_nombre,
          kg_informativo: linea.kg,
          origen_dato: linea.origenDato || 'CSV'
        }, usuario, idPendiente);
        const res = aplicar(mov);
        if (!res.ok) {
          if (res.errorCode === 'STOCK_INSUFICIENTE') {
            faltaStock = true;
            break;
          }
          return fallo(res.error || 'No se pudo aplicar la nueva salida');
        }
      }

      if (faltaStock) {
        estado = estadoAntesNueva;
        movimientosNuevos.length = indiceMov;
        for (const linea of ctx.lineasNuevasOk) {
          const pseudo = {
            codigo_articulo: linea.articulo,
            codigo_envase: linea.envase,
            fecha_negocio: linea.fecha || doc.fecha_documento,
            entidad_nombre: linea.entidad || doc.entidad_nombre
          };
          const pendiente = this._pendienteDeVenta_(pseudo, linea.linea, linea.cajas, usuario, idPendiente, doc);
          pendientesNuevos.push(pendiente);
          ventasPendientes.push({
            id_documento: doc.id_documento || '',
            serie: pendiente.serie,
            numero: pendiente.numero,
            linea: linea.linea,
            articulo: linea.articulo,
            envase: linea.envase,
            cajas: Number(linea.cajas),
            motivo: 'STOCK_INSUFICIENTE'
          });
        }
      }

      const docFinal = documentos.find(d => String(d.id_documento || '') === String(doc.id_documento || ''));
      if (docFinal) {
        const primeraNueva = ctx.lineasNuevas.length > 0 ? ctx.lineasNuevas[0] : null;
        docFinal.firma_lineas = nuevaFirma;
        docFinal.entidad_nombre = (primeraNueva && primeraNueva.entidad) || docFinal.entidad_nombre;
        docFinal.total_lineas = ctx.lineasNuevas.length;
        docFinal.total_cajas = ctx.lineasNuevasOk.reduce((total, linea) => total + Math.abs(Number(linea.cajas) || 0), 0);
        docFinal.estado_proceso = faltaStock
          ? 'PENDIENTE_REVISION'
          : 'CONFIRMADO';
        docFinal.fecha_documento = (primeraNueva && primeraNueva.fecha) || docFinal.fecha_documento;
      }

      operacionesRehechas.push({
        tipo: 'SALIDA',
        id: doc.id_documento || `${doc.serie}/${doc.numero}`,
        texto: `Salida ${doc.serie || ''}/${doc.numero || ''}`,
        principal: true
      });
    } else {
      // ---------------------------------------------------------------------
      // Documento de ENTRADA: cascada.
      // ---------------------------------------------------------------------
      const capasViejas = ctx.lineasViejas
        .map(linea => estadoInicial.capas.find(c => String(c.id_capa || '') === String(linea.id_capa || '')))
        .filter(Boolean);
      if (capasViejas.length === 0) return fallo('DOCUMENTO_SIN_CAPAS_ACTIVAS');

      const destino = new Set(capasViejas.map(c => String(c.id_capa || '')));
      const dependientes = new Map();
      let ampliar = true;

      const ventas = new Map();
      for (const mov of datos.movimientos) {
        if (String(mov.tipo_movimiento || '').toUpperCase() !== 'SALIDA') continue;
        if (this._esMovimientoReproceso_(mov)) continue;
        if (anulados.has(String(mov.id_movimiento || ''))) continue;
        if (String(mov.estado || '').toUpperCase() !== 'CONFIRMADO') continue;
        const clave = String(mov.id_documento_ref || mov.id_movimiento || '');
        if (!ventas.has(clave)) ventas.set(clave, []);
        ventas.get(clave).push(mov);
      }

      const ajustesNegativos = datos.movimientos.filter(mov =>
        String(mov.tipo_movimiento || '').toUpperCase() === 'AJUSTE' &&
        Number(mov.signo || 0) === -1 &&
        !this._esMovimientoReproceso_(mov) &&
        !anulados.has(String(mov.id_movimiento || '')) &&
        String(mov.estado || '').toUpperCase() === 'CONFIRMADO'
      );

      const reprocesosActivos = reprocesos.filter(rep => {
        if (String(rep.estado || '').toUpperCase() === 'ANULADO') return false;
        return !datos.movimientos.some(mov =>
          String(mov.tipo_movimiento || '').toUpperCase() === 'ANULACION' &&
          String(mov.id_documento_ref || '') === `REPROCESO:${rep.id_reproceso}`
        );
      });

      const lineasDeRep = (idRep) => reprocesoLineas.filter(l => String(l.id_reproceso || '') === String(idRep || ''));

      while (ampliar) {
        ampliar = false;

        for (const [clave, movs] of ventas.entries()) {
          const idDep = `SALIDA:${clave}`;
          if (dependientes.has(idDep)) continue;
          const consume = movs.some(mov => {
            const consumos = estadoInicial.consumosPorMovimiento[String(mov.id_movimiento || '')] || [];
            return consumos.some(c => destino.has(String(c.id_capa || '')));
          });
          if (!consume) continue;
          dependientes.set(idDep, { tipo: 'SALIDA', id: clave, movs });
          ampliar = true;
        }

        for (const rep of reprocesosActivos) {
          const idRep = String(rep.id_reproceso || '');
          const idDep = `REPROCESO:${idRep}`;
          if (dependientes.has(idDep)) continue;
          const lineas = lineasDeRep(idRep);
          const origenes = lineas.filter(l => String(l.tipo || '').toUpperCase() === 'ORIGEN');
          const usa = origenes.some(o => destino.has(String(o.id_capa || '')));
          if (!usa) continue;
          dependientes.set(idDep, { tipo: 'REPROCESO', id: idRep, rep, lineas });
          for (const d of lineas.filter(l => String(l.tipo || '').toUpperCase() === 'DESTINO')) {
            destino.add(String(d.id_capa || ''));
          }
          ampliar = true;
        }

        for (const mov of ajustesNegativos) {
          const idDep = `AJUSTE:${mov.id_movimiento}`;
          if (dependientes.has(idDep)) continue;
          const consumos = estadoInicial.consumosPorMovimiento[String(mov.id_movimiento || '')] || [];
          if (!consumos.some(c => destino.has(String(c.id_capa || '')))) continue;
          if (String(mov.id_capa_objetivo || '').trim() !== '') {
            return fallo('AJUSTE_DIRIGIDO_NO_SOPORTADO_EN_CASCADA');
          }
          dependientes.set(idDep, { tipo: 'AJUSTE', id: mov.id_movimiento, mov });
          ampliar = true;
        }
      }

      const dependientesLista = [...dependientes.values()].sort((a, b) => {
        const secA = this._secuenciaDependiente_(a, datos);
        const secB = this._secuenciaDependiente_(b, datos);
        return secA - secB;
      });
      if (dependientesLista.length > 200) return fallo('DEMASIADOS_DEPENDIENTES');

      for (const dep of dependientesLista) {
        operacionesRehechas.push({
          tipo: dep.tipo,
          id: dep.id,
          texto: dep.tipo === 'REPROCESO'
            ? `Reproceso ${dep.id}`
            : (dep.tipo === 'SALIDA' ? `Salida ${dep.id}` : `Ajuste ${dep.id}`),
          orden: this._secuenciaDependiente_(dep, datos)
        });
      }

      // 1. Deshacer dependientes en orden inverso.
      for (let i = dependientesLista.length - 1; i >= 0; i--) {
        const dep = dependientesLista[i];

        if (dep.tipo === 'SALIDA') {
          for (const mov of dep.movs) {
            const cajas = this._cajasEfectivas_(estado, mov);
            const res = aplicarAnulacion(mov, cajas, 1, '');
            if (!res.ok) return fallo(res.error || `No se pudo deshacer la salida ${dep.id}`);
          }
        } else if (dep.tipo === 'AJUSTE') {
          const cajas = this._cajasEfectivas_(estado, dep.mov);
          const res = aplicarAnulacion(dep.mov, cajas, 1, '');
          if (!res.ok) return fallo(res.error || `No se pudo deshacer el ajuste ${dep.id}`);
        } else {
          const lineas = dep.lineas;
          const destinos = lineas.filter(l => String(l.tipo || '').toUpperCase() === 'DESTINO');
          const origenes = lineas.filter(l => String(l.tipo || '').toUpperCase() === 'ORIGEN');
          for (const d of destinos) {
            const capa = estado.capas.find(c => String(c.id_capa || '') === String(d.id_capa || ''));
            if (capa && Number(capa.cajas_consumidas || 0) > 0) {
              return fallo('DEPENDIENTE_REPROCESO_CON_CONSUMOS');
            }
          }
          for (const d of destinos) {
            const mov = {
              id_movimiento: d.id_movimiento || '',
              id_documento_ref: `REPROCESO:${dep.id}`,
              codigo_articulo: d.codigo_articulo,
              codigo_envase: d.codigo_envase,
              cajas: d.cajas,
              partida_origen: '',
              motivo_ajuste: 'ANULAR_REPROCESO',
              fecha_negocio: d.fecha_capa || '',
              entidad_nombre: d.proveedor || ''
            };
            const res = aplicarAnulacion(mov, d.cajas, -1, d.id_capa);
            if (!res.ok) return fallo(res.error || `No se pudo deshacer el destino del reproceso ${dep.id}`);
          }
          for (const o of origenes) {
            const mov = {
              id_movimiento: o.id_movimiento || '',
              id_documento_ref: `REPROCESO:${dep.id}`,
              codigo_articulo: o.codigo_articulo,
              codigo_envase: o.codigo_envase,
              cajas: o.cajas,
              partida_origen: '',
              motivo_ajuste: 'ANULAR_REPROCESO',
              fecha_negocio: o.fecha_capa || '',
              entidad_nombre: o.proveedor || ''
            };
            const res = aplicarAnulacion(mov, o.cajas, 1, '');
            if (!res.ok) return fallo(res.error || `No se pudo deshacer el origen del reproceso ${dep.id}`);
          }
          const rep = reprocesos.find(r => String(r.id_reproceso || '') === String(dep.id));
          if (rep) rep.estado = 'ANULADO';
        }
      }

      // 2. Anular la versión vieja de la entrada.
      for (const capaVieja of capasViejas) {
        const capa = estado.capas.find(c => String(c.id_capa || '') === String(capaVieja.id_capa || ''));
        if (!capa) continue;
        if (Number(capa.cajas_consumidas || 0) > 0) return fallo('ENTRADA_CON_CONSUMOS');
        const mov = {
          id_movimiento: capa.id_movimiento_entrada || '',
          id_documento_ref: doc.id_documento || '',
          codigo_articulo: capa.codigo_articulo,
          codigo_envase: capa.codigo_envase,
          cajas: capa.cajas_restantes || capa.cajas_iniciales,
          partida_origen: capa.partida || '',
          motivo_ajuste: 'ANULAR_ENTRADA_VERSION',
          fecha_negocio: capa.fecha_capa || '',
          entidad_nombre: capa.proveedor || ''
        };
        const res = aplicarAnulacion(mov, Number(capa.cajas_restantes || capa.cajas_iniciales || 0), -1, capa.id_capa);
        if (!res.ok) return fallo(res.error || 'No se pudo anular la entrada anterior');
      }

      // 3. Aplicar la versión nueva de la entrada.
      const nuevasCapas = [];
      for (let i = 0; i < ctx.lineasNuevasOk.length; i++) {
        const linea = ctx.lineasNuevasOk[i];
        const mov = this._crearEntradaVersion_(linea, doc, usuario, idPendiente);
        const res = aplicar(mov);
        if (!res.ok) return fallo(res.error || 'No se pudo aplicar la nueva entrada');
        const capa = res.capaCreada || estado.capas.find(c => String(c.id_capa || '') === String(mov.id_capa_creada || ''));
        nuevasCapas.push({ linea, mov, capa });
      }

      const viejaANuevaCapa = new Map();
      const usadasNuevas = new Set();
      for (let i = 0; i < ctx.lineasViejas.length; i++) {
        const vieja = ctx.lineasViejas[i];
        const indice = this._coincideLinea_(vieja, ctx.lineasNuevasOk, i, usadasNuevas,
          ctx.lineasViejas.length === ctx.lineasNuevasOk.length);
        if (indice < 0) continue;
        usadasNuevas.add(indice);
        const nueva = nuevasCapas[indice];
        if (nueva && nueva.capa) viejaANuevaCapa.set(String(vieja.id_capa || ''), nueva.capa.id_capa);
      }

      const mapaDestinosRedo = new Map();

      // 4. Rehacer dependientes en orden original.
      for (const dep of dependientesLista) {
        if (dep.tipo === 'SALIDA') {
          const docDep = documentos.find(d => String(d.id_documento || '') === String(dep.id || ''))
            || documentos.find(d => `${d.serie}/${d.numero}` === String(dep.id || ''));
          const estadoAntesSalida = this._clonarEstado_(estado);
          const indiceMovimientos = movimientosNuevos.length;
          let faltaStock = false;

          for (const mov of dep.movs) {
            const nuevo = this._crearSalidaVersion_(mov, usuario, idPendiente);
            const res = aplicar(nuevo);
            if (!res.ok) {
              if (res.errorCode === 'STOCK_INSUFICIENTE') {
                faltaStock = true;
                break;
              }
              return fallo(res.error || `No se pudo rehacer la salida ${dep.id}`);
            }
          }

          if (faltaStock) {
            estado = estadoAntesSalida;
            movimientosNuevos.length = indiceMovimientos;
            for (let i = 0; i < dep.movs.length; i++) {
              const mov = dep.movs[i];
              const pendiente = this._pendienteDeVenta_(mov, i + 1, mov.cajas, usuario, idPendiente, docDep);
              pendientesNuevos.push(pendiente);
              ventasPendientes.push({
                id_documento: mov.id_documento_ref || '',
                serie: pendiente.serie,
                numero: pendiente.numero,
                linea: i + 1,
                articulo: mov.codigo_articulo,
                envase: mov.codigo_envase,
                cajas: Number(mov.cajas),
                motivo: 'STOCK_INSUFICIENTE'
              });
            }
            if (docDep) docDep.estado_proceso = 'PENDIENTE_REVISION';
          } else if (docDep) {
            docDep.estado_proceso = 'CONFIRMADO';
          }
        } else if (dep.tipo === 'AJUSTE') {
          const nuevo = this._crearAjusteNegativoVersion_(dep.mov, usuario, idPendiente);
          const res = aplicar(nuevo);
          if (!res.ok) return fallo(res.error || `No se pudo rehacer el ajuste ${dep.id}`);
        } else {
          const lineas = dep.lineas;
          const origenes = lineas.filter(l => String(l.tipo || '').toUpperCase() === 'ORIGEN');
          const destinos = lineas.filter(l => String(l.tipo || '').toUpperCase() === 'DESTINO');
          const origenesPlan = [];
          for (const o of origenes) {
            const idViejo = String(o.id_capa || '');
            let idNuevo = viejaANuevaCapa.get(idViejo) || mapaDestinosRedo.get(idViejo) || idViejo;
            if (capasViejas.some(c => String(c.id_capa || '') === idViejo) && !viejaANuevaCapa.has(idViejo)) {
              return fallo('REPROCESO_ORIGEN_SIN_REEMPLAZO');
            }
            if (mapaDestinosRedo.has(idViejo)) idNuevo = mapaDestinosRedo.get(idViejo);
            const capaNueva = estado.capas.find(c => String(c.id_capa || '') === String(idNuevo || ''));
            if (!capaNueva || Number(capaNueva.cajas_restantes || 0) < Number(o.cajas || 0)) {
              return fallo('REPROCESO_ORIGEN_SIN_CAJAS');
            }
            origenesPlan.push({ id_capa: idNuevo, cajas: Number(o.cajas) });
          }
          const destinosPlan = destinos.map(d => ({
            articulo: d.codigo_articulo,
            envase: d.codigo_envase,
            cajas: Number(d.cajas)
          }));
          const planFn = (typeof planificarReproceso === 'function')
            ? planificarReproceso
            : (CORRECCION_REPROCESO_NODE && CORRECCION_REPROCESO_NODE.planificarReproceso);
          if (typeof planFn !== 'function') return fallo('PLANIFICADOR_REPROCESO_NO_DISPONIBLE');
          const plan = planFn({
            origenes: origenesPlan,
            destinos: destinosPlan,
            destrio_cajas: Number(dep.rep.destrio_cajas || 0),
            destrio_kg: dep.rep.destrio_kg,
            fecha: dep.rep.fecha,
            usuario,
            observaciones: `CORRECCION_VERSION:${idPendiente};ORIGINAL:${dep.id}`
          }, estado.capas);
          if (!plan || !plan.ok) return fallo(plan && plan.error ? plan.error : 'REPROCESO_NO_REPLANIFICABLE');
          for (const mov of plan.movsOrigen.concat(plan.movsDestino)) {
            const res = aplicar(mov);
            if (!res.ok) return fallo(res.error || `No se pudo rehacer el reproceso ${dep.id}`);
          }
          reprocesos.push(plan.reproceso);
          reprocesoLineas.push(...plan.reprocesoLineas);
          const destinosNuevos = plan.reprocesoLineas.filter(l => String(l.tipo || '').toUpperCase() === 'DESTINO');
          for (let i = 0; i < destinos.length && i < destinosNuevos.length; i++) {
            mapaDestinosRedo.set(String(destinos[i].id_capa || ''), destinosNuevos[i].id_capa);
          }
        }
      }

      const docFinal = documentos.find(d => String(d.id_documento || '') === String(doc.id_documento || ''));
      if (docFinal) {
        const primeraNueva = ctx.lineasNuevas.length > 0 ? ctx.lineasNuevas[0] : null;
        docFinal.firma_lineas = nuevaFirma;
        docFinal.entidad_nombre = (primeraNueva && primeraNueva.entidad) || docFinal.entidad_nombre;
        docFinal.total_lineas = ctx.lineasNuevas.length;
        docFinal.total_cajas = ctx.lineasNuevasOk.reduce((total, linea) => total + Math.abs(Number(linea.cajas) || 0), 0);
        docFinal.estado_proceso = 'CONFIRMADO';
        docFinal.fecha_documento = (primeraNueva && primeraNueva.fecha) || docFinal.fecha_documento;
      }
    }

    // Versión y pendiente.
    const versionFinal = versiones.find(v => String(v.id_version || '') === String(ctx.version.id_version || ''));
    if (versionFinal) {
      versionFinal.estado = 'APLICADA';
      versionFinal.fecha_resolucion = new Date().toISOString();
      versionFinal.usuario = usuario || 'SISTEMA';
      versionFinal.motivo = 'CORRECCION_APLICADA';
    }
    const pendienteFinal = pendientes.find(p => String(p.id_pendiente || '') === idPendiente);
    if (pendienteFinal) {
      pendienteFinal.estado = 'RESUELTA';
      pendienteFinal.fecha_resolucion = new Date().toISOString();
    }
    pendientes.push(...pendientesNuevos);

    return {
      posible: true,
      motivo: '',
      estadoInicial,
      estadoFinal: estado,
      movimientosNuevos,
      documentos,
      reprocesos,
      reprocesoLineas,
      pendientes,
      versiones,
      pendientesNuevos,
      lineas_cambian: this._lineasCambian_(ctx),
      operaciones_rehechas: operacionesRehechas,
      partidas_cambian: this._partidasCambian_(estadoInicial, estado),
      ventas_a_pendientes: ventasPendientes,
      efecto_variedades: this._efectoVariedades_(estadoInicial, estado)
    };
  }

  _secuenciaDependiente_(dep, datos) {
    let secuencia = Number.MAX_SAFE_INTEGER;
    if (dep.tipo === 'SALIDA') {
      for (const mov of dep.movs) {
        const s = Number(mov.secuencia);
        if (Number.isFinite(s) && s < secuencia) secuencia = s;
      }
    } else if (dep.tipo === 'AJUSTE') {
      const s = Number(dep.mov.secuencia);
      if (Number.isFinite(s)) secuencia = s;
    } else {
      for (const mov of datos.movimientos) {
        if (String(mov.id_documento_ref || '') !== `REPROCESO:${dep.id}`) continue;
        const s = Number(mov.secuencia);
        if (Number.isFinite(s) && s < secuencia) secuencia = s;
      }
    }
    return secuencia;
  }

  /**
   * Previsualiza la aplicación de una versión (regla 2).
   * @param {string} idPendiente
   * @returns {Object}
   */
  previsualizarVersion(idPendiente) {
    this._cacheVariedad.clear();
    const datos = this._cargarDatos_();
    const ctx = this._contextoVersion_(datos, idPendiente);
    if (!ctx.ok) return { posible: false, motivo: ctx.motivo };
    const plan = this._ejecutarCascada_(datos, ctx, 'PREVISUALIZACION');
    if (!plan.posible) return { posible: false, motivo: plan.motivo };
    const sinMovimientosStock = ctx.lineasNuevasOk.length === 0;
    return {
      posible: true,
      motivo: '',
      mensaje: sinMovimientosStock ? 'La versión nueva no mueve stock' : '',
      aviso: sinMovimientosStock ? 'La versión nueva no mueve stock' : '',
      sin_movimientos_stock: sinMovimientosStock,
      lineas_cambian: plan.lineas_cambian,
      operaciones_rehechas: plan.operaciones_rehechas,
      partidas_cambian: plan.partidas_cambian,
      ventas_a_pendientes: plan.ventas_a_pendientes,
      efecto_variedades: plan.efecto_variedades
    };
  }

  /**
   * Aplica una versión (regla 3), en un solo lock y un solo _persistir.
   * @param {string} idPendiente
   * @param {string} motivo
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  aplicarVersion(idPendiente, motivo, usuario = 'SISTEMA') {
    const motivoLimpio = String(motivo === null || motivo === undefined ? '' : motivo).trim();
    if (motivoLimpio.length < 5) {
      return { success: false, status: 'MOTIVO_REQUERIDO', message: 'El motivo es obligatorio (mínimo 5 caracteres).' };
    }

    this.movementService._acquireLock(30000);
    try {
      this._cacheVariedad.clear();
      const datos = this._cargarDatos_();
      const ctx = this._contextoVersion_(datos, idPendiente);
      if (!ctx.ok) return { success: false, status: 'NO_POSIBLE', errorCode: ctx.motivo, message: ctx.motivo };
      const plan = this._ejecutarCascada_(datos, ctx, usuario);
      if (!plan.posible) return { success: false, status: 'NO_POSIBLE', errorCode: 'CORRECCION_NO_POSIBLE', message: plan.motivo };

      this.movementService._persistir({
        movimientos: plan.movimientosNuevos,
        movimientosExistentes: datos.movimientos,
        estado: plan.movimientosNuevos.length > 0 ? plan.estadoFinal : null,
        documentos: { replace: plan.documentos }
      });

      if (typeof this.repo.replaceTable === 'function') {
        this.repo.replaceTable('REPROCESOS', plan.reprocesos);
        this.repo.replaceTable('REPROCESO_LINEAS', plan.reprocesoLineas);
      }
      if (typeof this.repo.savePendientes === 'function') {
        this.repo.savePendientes(plan.pendientes);
      }
      if (typeof this.repo.saveVersionesDocumento === 'function') {
        this.repo.saveVersionesDocumento(plan.versiones);
      }

      if (typeof this.repo.appendLogOperacion === 'function') {
        this.repo.appendLogOperacion({
          id_log: this._nuevoId_('LOG'),
          fecha_hora: new Date().toISOString(),
          usuario: usuario || 'SISTEMA',
          operacion: 'APLICAR_VERSION_DOCUMENTO',
          codigo_articulo: '',
          nombre_articulo: '',
          codigo_envase: '',
          descripcion_envase: '',
          cantidad_cajas: plan.movimientosNuevos.reduce((total, mov) => total + Number(mov.cajas || 0), 0),
          origen: ctx.tipo,
          destino: `${ctx.doc.serie || ''}/${ctx.doc.numero || ''}`,
          motivo: motivoLimpio,
          referencia: idPendiente,
          estado: 'CORRECTA',
          observaciones: JSON.stringify({
            id_version: ctx.version.id_version,
            movimientos: plan.movimientosNuevos.length,
            operaciones_rehechas: plan.operaciones_rehechas.length,
            ventas_a_pendientes: plan.ventas_a_pendientes.length
          })
        });
      }

      const resultado = {
        success: true,
        status: 'APLICADA',
        id_pendiente: idPendiente,
        id_version: ctx.version.id_version,
        id_documento: ctx.doc.id_documento || '',
        mensaje: ctx.lineasNuevasOk.length === 0 ? 'La versión nueva no mueve stock' : '',
        aviso: ctx.lineasNuevasOk.length === 0 ? 'La versión nueva no mueve stock' : '',
        sin_movimientos_stock: ctx.lineasNuevasOk.length === 0,
        movimientosGenerados: plan.movimientosNuevos.map(mov => mov.id_movimiento),
        lineas_cambian: plan.lineas_cambian,
        operaciones_rehechas: plan.operaciones_rehechas,
        ventas_a_pendientes: plan.ventas_a_pendientes,
        partidas_cambian: plan.partidas_cambian,
        efecto_variedades: plan.efecto_variedades
      };

      try {
        const pendSvc = this._resolverPendientesService_();
        if (pendSvc && typeof pendSvc.reintentarPendientes === 'function') {
          resultado.reintentoPendientes = pendSvc.reintentarPendientes(usuario);
        }
      } catch (error) {
        resultado.avisoReintento = error && error.message ? error.message : String(error);
      }

      return resultado;
    } finally {
      this.movementService._releaseLock();
    }
  }

  _resolverPendientesService_() {
    if (this.pendientesService) return this.pendientesService;
    const PendClass = (typeof PendientesService !== 'undefined')
      ? PendientesService
      : (typeof require !== 'undefined' ? require('./importacion/PendientesService').PendientesService : null);
    if (!PendClass) return null;
    this.pendientesService = new PendClass({
      repository: this.repo,
      movementService: this.movementService,
      catalogoService: this.catalogoService,
      lockService: this.movementService.lock
    });
    return this.pendientesService;
  }

  /**
   * Lista las versiones pendientes (LECTURA).
   * @returns {Array<Object>}
   */
  listarVersionesPendientes() {
    const pendientes = (this.repo && typeof this.repo.getPendientes === 'function') ? this.repo.getPendientes() : [];
    const versiones = (this.repo && typeof this.repo.getVersionesDocumento === 'function') ? this.repo.getVersionesDocumento() : [];
    const documentos = (this.repo && typeof this.repo.getDocumentos === 'function') ? this.repo.getDocumentos() : [];
    const resultado = [];
    for (const version of versiones) {
      if (String(version.estado || '').toUpperCase() !== 'PENDIENTE') continue;
      const pendiente = pendientes.find(p => String(p.id_pendiente || '') === String(version.id_pendiente || ''));
      if (!pendiente || String(pendiente.estado || '').toUpperCase() !== 'PENDIENTE') continue;
      const doc = documentos.find(d => String(d.id_documento || '') === String(version.id_documento || ''));
      const lineasVersion = this._parseLineasVersion_(version);
      const cajasVersion = lineasVersion.reduce((total, linea) => total + Math.abs(Number(linea.cajas) || 0), 0);
      const diferenciaVersion = doc ? cajasVersion - Number(doc.total_cajas || 0) : pendiente.cajas;
      resultado.push({
        id_version: version.id_version,
        id_pendiente: version.id_pendiente,
        id_documento: version.id_documento,
        firma_lineas: version.firma_lineas,
        lineas: lineasVersion,
        lineas_json: version.lineas_json,
        fecha_alta: version.fecha_alta,
        estado: version.estado,
        fecha_resolucion: version.fecha_resolucion || '',
        usuario: version.usuario || '',
        motivo: version.motivo || pendiente.motivo,
        tipo_doc: pendiente.tipo_doc,
        serie: pendiente.serie,
        numero: pendiente.numero,
        fecha_negocio: pendiente.fecha_negocio,
        entidad: pendiente.entidad,
        cajas: diferenciaVersion,
        diferencia: diferenciaVersion,
        documento: doc ? {
          id_documento: doc.id_documento,
          serie: doc.serie,
          numero: doc.numero,
          fecha_documento: doc.fecha_documento,
          entidad_nombre: doc.entidad_nombre,
          estado_proceso: doc.estado_proceso,
          firma_lineas: doc.firma_lineas
        } : null
      });
    }
    resultado.sort((a, b) => String(b.fecha_alta || '').localeCompare(String(a.fecha_alta || '')));
    return resultado;
  }

  _prepararAnulacionAjuste_(datos, idMovimiento, usuario) {
    const id = String(idMovimiento === null || idMovimiento === undefined ? '' : idMovimiento).trim();
    const mov = datos.movimientos.find(m => String(m.id_movimiento || '') === id);
    if (!mov) return { posible: false, motivo: 'MOVIMIENTO_NO_ENCONTRADO' };
    if (String(mov.tipo_movimiento || '').toUpperCase() !== 'AJUSTE') {
      return { posible: false, motivo: 'NO_ES_AJUSTE' };
    }
    if (this._esMovimientoReproceso_(mov)) {
      return { posible: false, motivo: 'ES_MOVIMIENTO_DE_REPROCESO' };
    }
    if (this._anuladosSet_(datos.movimientos).has(id)) {
      return { posible: false, motivo: 'AJUSTE_YA_ANULADO' };
    }

    const estadoInicial = this._clonarEstado_(datos.estado);
    let estado = this._clonarEstado_(estadoInicial);
    const signo = Number(mov.signo || 0);
    let anulacion = null;

    if (signo === -1) {
      const cajas = this._cajasEfectivas_(estado, mov);
      anulacion = this._crearAnulacion_(mov, cajas, 1, usuario, '');
    } else if (signo === 1) {
      const capa = estado.capas.find(c => String(c.id_capa || '') === String(mov.id_capa_creada || ''))
        || estado.capas.find(c => String(c.id_movimiento_entrada || '') === id);
      if (!capa) return { posible: false, motivo: 'CAPA_NO_ENCONTRADA' };
      if (Number(capa.cajas_consumidas || 0) > 0) {
        return { posible: false, motivo: 'AJUSTE_CON_CONSUMOS' };
      }
      anulacion = this._crearAnulacion_(mov, Number(capa.cajas_restantes || capa.cajas_iniciales || 0), -1, usuario, capa.id_capa);
    } else {
      return { posible: false, motivo: 'SIGNO_NO_SOPORTADO' };
    }

    const res = this.movementService._aplicar(estado, anulacion);
    if (!res.ok) return { posible: false, motivo: res.error || 'NO_SE_PUEDE_ANULAR' };
    estado = res.estado;

    return {
      posible: true,
      motivo: '',
      movimiento: mov,
      anulacion,
      estadoInicial,
      estadoFinal: estado,
      partidas_cambian: this._partidasCambian_(estadoInicial, estado),
      efecto_variedades: this._efectoVariedades_(estadoInicial, estado)
    };
  }

  previsualizarAnularAjuste(idMovimiento) {
    this._cacheVariedad.clear();
    const datos = this._cargarDatos_();
    const plan = this._prepararAnulacionAjuste_(datos, idMovimiento, 'PREVISUALIZACION');
    if (!plan.posible) return { posible: false, motivo: plan.motivo };
    const vuelven = [];
    const bajan = [];
    const desaparecen = [];
    for (const partida of plan.partidas_cambian) {
      const antes = partida.antes ? Number(partida.antes.cajas_restantes || 0) : 0;
      const despues = partida.despues ? Number(partida.despues.cajas_restantes || 0) : 0;
      const entrada = {
        id_capa: partida.id_capa,
        articulo: partida.articulo,
        envase: partida.envase,
        cajas: Math.abs(despues - antes)
      };
      if (despues > antes) vuelven.push(entrada);
      else if (!partida.despues || despues === 0 || (partida.despues && partida.despues.estado_capa === 'ANULADA')) desaparecen.push(entrada);
      else if (despues < antes) bajan.push(entrada);
    }
    return {
      posible: true,
      motivo: '',
      partidas_vuelven: vuelven,
      partidas_bajan: bajan,
      partidas_desaparecen: desaparecen,
      partidas_cambian: plan.partidas_cambian,
      efecto_variedades: plan.efecto_variedades
    };
  }

  anularAjuste(idMovimiento, motivo, usuario = 'SISTEMA') {
    const motivoLimpio = String(motivo === null || motivo === undefined ? '' : motivo).trim();
    if (motivoLimpio.length < 5) {
      return { success: false, status: 'MOTIVO_REQUERIDO', message: 'El motivo es obligatorio (mínimo 5 caracteres).' };
    }
    this.movementService._acquireLock(30000);
    try {
      const datos = this._cargarDatos_();
      const plan = this._prepararAnulacionAjuste_(datos, idMovimiento, usuario);
      if (!plan.posible) return { success: false, status: 'NO_POSIBLE', errorCode: plan.motivo, message: plan.motivo };
      this.movementService._persistir({
        movimientos: [plan.anulacion],
        movimientosExistentes: datos.movimientos,
        estado: plan.estadoFinal
      });
      if (typeof this.repo.appendLogOperacion === 'function') {
        this.repo.appendLogOperacion({
          id_log: this._nuevoId_('LOG'),
          fecha_hora: new Date().toISOString(),
          usuario: usuario || 'SISTEMA',
          operacion: 'ANULAR_AJUSTE',
          codigo_articulo: plan.movimiento.codigo_articulo || '',
          codigo_envase: plan.movimiento.codigo_envase || '',
          cantidad_cajas: Number(plan.anulacion.cajas || 0),
          motivo: motivoLimpio,
          referencia: String(plan.movimiento.id_movimiento || ''),
          estado: 'CORRECTA',
          observaciones: 'Anulación de ajuste'
        });
      }
      return {
        success: true,
        status: 'ANULADO',
        movimiento: plan.movimiento.id_movimiento,
        anulacion: plan.anulacion.id_movimiento,
        partidas_cambian: plan.partidas_cambian,
        efecto_variedades: plan.efecto_variedades
      };
    } finally {
      this.movementService._releaseLock();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CorreccionService
  };
}
