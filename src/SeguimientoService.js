/**
 * STOCK-LIGHT — SeguimientoService.js
 *
 * Decide si una combinación artículo + envase desconocida (SEGUIMIENTO_DESCONOCIDO)
 * se sigue o se ignora (T-028, D-006, D-029):
 * - crea o actualiza la excepción SEGUIMIENTO = SI | NO en CATALOGO reutilizando
 *   el mismo guardado del repositorio que usa `apiUpsertExcepcionCatalogo`;
 * - reintenta pendientes (`PendientesService.reintentarPendientes`);
 * - registra la decisión en `LOG_OPERACIONES`.
 */

class SeguimientoService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.repository]
   * @param {Object} [options.movementService]
   * @param {Object} [options.catalogoService]
   * @param {Object} [options.pendientesService]
   * @param {Object} [options.lockService]
   * @param {Object} [options.configCatalogo]
   */
  constructor(options = {}) {
    const RepoClass = (typeof SheetsRepository !== 'undefined')
      ? SheetsRepository
      : (typeof require !== 'undefined' ? require('./Repository').SheetsRepository : null);
    if (!RepoClass && !options.repository) {
      throw new Error('SheetsRepository no está disponible en SeguimientoService.');
    }
    this.repo = options.repository || new RepoClass();

    const MovementClass = (typeof MovementService !== 'undefined')
      ? MovementService
      : (typeof require !== 'undefined' ? require('./MovementService').MovementService : null);
    this.movementService = options.movementService || (MovementClass
      ? new MovementClass({ repository: this.repo, lockService: options.lockService })
      : null);

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
    this.lockService = options.lockService || null;
  }

  _resolverPendientesService_() {
    if (this.pendientesService) return this.pendientesService;
    const PendClass = (typeof PendientesService !== 'undefined')
      ? PendientesService
      : (typeof require !== 'undefined' ? require('./importacion/PendientesService').PendientesService : null);
    if (!PendClass) {
      throw new Error('PendientesService no está disponible en SeguimientoService.');
    }
    return new PendClass({
      repository: this.repo,
      movementService: this.movementService,
      catalogoService: this.catalogoService,
      lockService: this.lockService
    });
  }

  _nuevoId_(prefijo) {
    const fn = typeof nuevoId === 'function'
      ? nuevoId
      : (typeof global !== 'undefined' && typeof global.nuevoId === 'function'
        ? global.nuevoId
        : (typeof require !== 'undefined' ? require('./Ids').nuevoId : null));
    if (typeof fn === 'function') return fn(prefijo);
    return `${prefijo}-${Date.now()}`;
  }

  /**
   * Decide el seguimiento de una combinación artículo + envase y reintenta pendientes.
   *
   * @param {string} articulo
   * @param {string} envase
   * @param {'SEGUIR'|'IGNORAR'} decision
   * @param {string} [usuario='SISTEMA']
   * @returns {Object} Resultado del reintento junto con el detalle de la excepción aplicada.
   */
  decidirSeguimiento(articulo, envase, decision, usuario = 'SISTEMA') {
    const art = String(articulo === null || articulo === undefined ? '' : articulo).trim();
    const env = String(envase === null || envase === undefined ? '' : envase).trim();
    if (!art || !env) {
      throw new Error('decidirSeguimiento: articulo y envase son obligatorios.');
    }

    const decisionNorm = String(decision === null || decision === undefined ? '' : decision).trim().toUpperCase();
    if (decisionNorm !== 'SEGUIR' && decisionNorm !== 'IGNORAR') {
      throw new Error("decidirSeguimiento: decision debe ser 'SEGUIR' o 'IGNORAR'.");
    }

    const valor = decisionNorm === 'SEGUIR' ? 'SI' : 'NO';
    const user = String(usuario || 'SISTEMA').trim() || 'SISTEMA';
    const ahoraIso = new Date().toISOString();

    // 1. Crear o actualizar la excepción en CATALOGO usando la misma lógica que apiUpsertExcepcionCatalogo
    let guardada;
    if (typeof guardarExcepcionCatalogo_ === 'function') {
      guardada = guardarExcepcionCatalogo_(this.repo, {
        articulo: art,
        envase: env,
        atributo: 'SEGUIMIENTO',
        valor,
        observaciones: `Decisión ${decisionNorm} desde Pendientes`
      }, user);
    } else {
      guardada = this.repo.upsertExcepcionCatalogo({
        articulo: art,
        envase: env,
        atributo: 'SEGUIMIENTO',
        valor,
        usuario: user,
        observaciones: `Decisión ${decisionNorm} desde Pendientes`
      });
    }

    // Invalidar caché del catálogo para que el reintento lea la nueva excepción
    if (this.catalogoService && typeof this.catalogoService.invalidarCache === 'function') {
      this.catalogoService.invalidarCache();
    }

    // 2. Lanzar reintento de pendientes (SEGUIR aplica sus líneas; IGNORAR las deja IGNORADA)
    const pendientesSvc = this._resolverPendientesService_();
    const resultadoReintento = pendientesSvc.reintentarPendientes(user);

    // 3. Registrar en LOG_OPERACIONES quién y cuándo
    if (this.repo && typeof this.repo.appendLogOperacion === 'function') {
      this.repo.appendLogOperacion({
        id_log: this._nuevoId_('LOG'),
        fecha_hora: ahoraIso,
        usuario: user,
        operacion: 'DECIDIR_SEGUIMIENTO',
        codigo_articulo: art,
        codigo_envase: env,
        destino: `SEGUIMIENTO=${valor}`,
        motivo: decisionNorm,
        referencia: 'CATALOGO',
        estado: 'CORRECTA',
        observaciones: `Aplicados: ${Number((resultadoReintento.aplicados && resultadoReintento.aplicados.total) || 0)}, ignorados: ${Number((resultadoReintento.ignorados && resultadoReintento.ignorados.total) || 0)}`
      });
    }

    return {
      ...resultadoReintento,
      success: true,
      articulo: art,
      envase: env,
      decision: decisionNorm,
      valor,
      excepcion: guardada
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SeguimientoService
  };
}
