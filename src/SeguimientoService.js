/**
 * STOCK-LIGHT — SeguimientoService.js
 *
 * Decide si una combinación artículo + envase desconocida (SEGUIMIENTO_DESCONOCIDO)
 * se sigue o se ignora (T-028, D-006, D-029):
 * - crea o actualiza la excepción SEGUIMIENTO = SI | NO en CATALOGO reutilizando
 *   el mismo guardado del repositorio que usa `apiUpsertExcepcionCatalogo`;
 * - cuando decision = SEGUIR y se indica un grupo de AGRUPACIONES (COMERCIAL),
 *   traduce el filtro del grupo a excepciones de atributos en CATALOGO;
 * - reintenta pendientes (`PendientesService.reintentarPendientes`);
 * - registra la decisión en `LOG_OPERACIONES`.
 */

function _normTextoSeg_(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto).trim().replace(/\s+/g, ' ').toUpperCase();
}

function _esActivaSeg_(valor) {
  if (valor === undefined || valor === null || valor === '') return true;
  if (typeof valor === 'boolean') return valor;
  const norm = String(valor).trim().toUpperCase();
  if (norm === 'FALSE' || norm === 'NO' || norm === '0') return false;
  return norm === 'TRUE' || norm === 'SI' || norm === 'SÍ' || norm === '1';
}

/**
 * Traduce un filtro declarativo de AGRUPACIONES (`ATRIBUTO=v1|v2; OTRO!=v3`)
 * a pares `{ atributo, valor }` que satisfacen `cumpleFiltro` (D-029).
 * - `;` separa condiciones Y.
 * - `ATRIBUTO=v1|v2` asigna el primer valor `v1`.
 * - `ATRIBUTO!=v3` no requiere asignar atributo (un atributo vacío cumple `!=`).
 * - Si alguna condición no sigue esta sintaxis, lanza error explícito.
 *
 * @param {string} filtro
 * @returns {Array<{ atributo: string, valor: string }>}
 */
function _atributosDesdeFiltro_(filtro) {
  const texto = String(filtro === null || filtro === undefined ? '' : filtro).trim();
  if (!texto) return [];

  const resultado = [];
  const condiciones = texto.split(';');
  for (let i = 0; i < condiciones.length; i++) {
    const cond = condiciones[i].trim();
    if (!cond) continue;

    if (cond.includes('!=')) {
      const idx = cond.indexOf('!=');
      const attr = _normTextoSeg_(cond.slice(0, idx));
      const rhs = cond.slice(idx + 2).trim();
      if (!attr || !rhs) {
        throw new Error(`No se puede traducir la condición de filtro '${cond}'.`);
      }
      // En cumpleFiltro un atributo vacío cumple !=, no se necesita escribir excepción.
      continue;
    }

    if (cond.includes('=')) {
      const idx = cond.indexOf('=');
      const attr = _normTextoSeg_(cond.slice(0, idx));
      const rhs = cond.slice(idx + 1);
      const valores = rhs.split('|').map(v => _normTextoSeg_(v)).filter(Boolean);
      if (!attr || valores.length === 0) {
        throw new Error(`No se puede traducir la condición de filtro '${cond}'.`);
      }
      resultado.push({ atributo: attr, valor: valores[0] });
      continue;
    }

    throw new Error(`Formato de filtro no reconocido en AGRUPACIONES: '${cond}'.`);
  }

  return resultado;
}

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

  _guardarExcepcion_(art, env, atributo, valor, user, observaciones) {
    if (typeof guardarExcepcionCatalogo_ === 'function') {
      return guardarExcepcionCatalogo_(this.repo, {
        articulo: art,
        envase: env,
        atributo,
        valor,
        observaciones
      }, user);
    }
    return this.repo.upsertExcepcionCatalogo({
      articulo: art,
      envase: env,
      atributo,
      valor,
      usuario: user,
      observaciones
    });
  }

  _atributosParaGrupoComercial_(grupoRaw) {
    const grupoNorm = _normTextoSeg_(grupoRaw);
    if (!grupoNorm || grupoNorm === 'SIN AGRUPAR' || grupoNorm === 'SIN CLASIFICAR') {
      return [];
    }

    const agrupaciones = (this.repo && typeof this.repo.getAgrupaciones === 'function')
      ? (this.repo.getAgrupaciones() || [])
      : [];

    const candidatas = agrupaciones
      .filter(f => f && _esActivaSeg_(f.activo !== undefined ? f.activo : f.activa))
      .filter(f => _normTextoSeg_(f.agrupacion) === 'COMERCIAL')
      .filter(f => _normTextoSeg_(f.grupo) === grupoNorm)
      .sort((a, b) => {
        const oa = Number.isFinite(Number(a.orden)) ? Number(a.orden) : Number.MAX_SAFE_INTEGER;
        const ob = Number.isFinite(Number(b.orden)) ? Number(b.orden) : Number.MAX_SAFE_INTEGER;
        return oa - ob;
      });

    if (candidatas.length === 0) {
      throw new Error(`No existe el grupo '${grupoRaw}' en la agrupación COMERCIAL de AGRUPACIONES.`);
    }

    return _atributosDesdeFiltro_(candidatas[0].filtro);
  }

  /**
   * Decide el seguimiento de una combinación artículo + envase y reintenta pendientes.
   *
   * @param {string} articulo
   * @param {string} envase
   * @param {'SEGUIR'|'IGNORAR'} decision
   * @param {string} [grupo=''] - Grupo de la agrupación COMERCIAL (o vacío / 'Sin agrupar')
   * @param {string} [usuario='SISTEMA']
   * @returns {Object} Resultado del reintento junto con el detalle de las excepciones aplicadas.
   */
  decidirSeguimiento(articulo, envase, decision, grupo = '', usuario = 'SISTEMA') {
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
    const grupoLimpio = String(grupo === null || grupo === undefined ? '' : grupo).trim();
    const user = String(usuario || 'SISTEMA').trim() || 'SISTEMA';
    const ahoraIso = new Date().toISOString();

    // Resolver atributos del grupo ANTES de escribir nada (fallo atómico si el filtro no es traducible)
    const atributosGrupo = decisionNorm === 'SEGUIR'
      ? this._atributosParaGrupoComercial_(grupoLimpio)
      : [];

    // 1. Crear o actualizar la excepción SEGUIMIENTO en CATALOGO
    const guardada = this._guardarExcepcion_(
      art,
      env,
      'SEGUIMIENTO',
      valor,
      user,
      `Decisión ${decisionNorm} desde Pendientes`
    );

    // 1b. Si SEGUIR con grupo comercial, guardar los atributos exigidos por el filtro del grupo
    const excepcionesGrupo = [];
    for (const par of atributosGrupo) {
      const exc = this._guardarExcepcion_(
        art,
        env,
        par.atributo,
        par.valor,
        user,
        `Asignado al grupo ${grupoLimpio} desde Pendientes`
      );
      excepcionesGrupo.push(exc);
    }

    // Invalidar caché del catálogo para que el reintento lea las nuevas excepciones
    if (this.catalogoService && typeof this.catalogoService.invalidarCache === 'function') {
      this.catalogoService.invalidarCache();
    }

    // 2. Lanzar reintento de pendientes (SEGUIR aplica sus líneas; IGNORAR las deja IGNORADA)
    const pendientesSvc = this._resolverPendientesService_();
    const resultadoReintento = pendientesSvc.reintentarPendientes(user);

    // 3. Registrar en LOG_OPERACIONES quién y cuándo
    if (this.repo && typeof this.repo.appendLogOperacion === 'function') {
      const destinoLog = atributosGrupo.length > 0
        ? `SEGUIMIENTO=${valor}; ${atributosGrupo.map(p => `${p.atributo}=${p.valor}`).join('; ')}`
        : `SEGUIMIENTO=${valor}`;
      this.repo.appendLogOperacion({
        id_log: this._nuevoId_('LOG'),
        fecha_hora: ahoraIso,
        usuario: user,
        operacion: 'DECIDIR_SEGUIMIENTO',
        codigo_articulo: art,
        codigo_envase: env,
        destino: destinoLog,
        motivo: decisionNorm,
        referencia: grupoLimpio || 'CATALOGO',
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
      grupo: grupoLimpio || '',
      valor,
      excepcion: guardada,
      excepcionesGrupo
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SeguimientoService,
    _atributosDesdeFiltro_
  };
}
