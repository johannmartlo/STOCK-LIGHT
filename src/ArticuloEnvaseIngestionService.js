/**
 * STOCK-LIGHT — ArticuloEnvaseIngestionService.js
 * 
 * Servicio de Ingesta, Validación, Idempotencia y Persistencia de la Matriz Artículo-Envase.
 * Gestiona el ciclo de vida de las asociaciones en la tabla MAESTRO de Google Sheets:
 * - Ingesta masiva o individual de combinaciones artículo-envase.
 * - Validación referencial y rechazo de DEFAULT / ENVASE_NO_DETERMINABLE_DESDE_PDF.
 * - Detección de duplicados e idempotencia garantizada por (tenant_id, codigo_articulo, codigo_envase).
 * - Control estricto de cardinalidad y reglas de envase predeterminado (máximo 1 predeterminado activo).
 * - Cambio seguro de envase predeterminado sin eliminación destructiva de asociaciones históricas.
 */

if (typeof require !== 'undefined') {
  global.ArticuloEnvaseValidator = global.ArticuloEnvaseValidator || require('./ArticuloEnvaseValidator').ArticuloEnvaseValidator;
  global.SheetsRepository = global.SheetsRepository || require('./Repository').SheetsRepository;
  global.ImportDiagnostics = global.ImportDiagnostics || require('./ImportDiagnostics');
}

const _AE_VALIDATOR_CLASS = (typeof ArticuloEnvaseValidator !== 'undefined')
  ? ArticuloEnvaseValidator
  : (typeof require !== 'undefined' ? require('./ArticuloEnvaseValidator').ArticuloEnvaseValidator : null);

const _DIAG_CODES = (typeof DIAGNOSTIC_CODES !== 'undefined')
  ? DIAGNOSTIC_CODES
  : (typeof ImportDiagnostics !== 'undefined' ? ImportDiagnostics.DIAGNOSTIC_CODES : (typeof require !== 'undefined' ? require('./ImportDiagnostics').DIAGNOSTIC_CODES : {}));

class ArticuloEnvaseIngestionService {
  /**
   * @param {Object} [options]
   * @param {SheetsRepository|Object} [options.repository]
   * @param {Object} [options.validator]
   * @param {string} [options.defaultTenantId='DEFAULT']
   */
  constructor(options = {}) {
    this.repo = options.repository || (typeof SheetsRepository !== 'undefined' ? new SheetsRepository() : null);
    this.validator = options.validator || null;
    this.defaultTenantId = options.defaultTenantId || 'DEFAULT';
  }

  /**
   * Ingesta una matriz de asociaciones artículo-envase (CSV o array de registros)
   * aplicando validación estructural, referencial, detección de conflictos e idempotencia.
   * 
   * @param {string|Array<Object>|Array<Array<string>>} rawInput 
   * @param {Object} [options]
   * @param {string} [options.tenantId='DEFAULT']
   * @param {string} [options.expectedTenantId]
   * @param {Array<Object>|Map} [options.maestroArticulos]
   * @param {Array<Object>|Map} [options.maestroEnvases]
   * @param {boolean} [options.dryRun=false]
   * @param {boolean} [options.allowDefaultOverride=false]
   * @returns {Object} Resultado de la ingesta
   */
  ingestarMatriz(rawInput, options = {}) {
    if (options.tenantId !== undefined && String(options.tenantId).trim() === '') {
      return {
        success: false,
        status: 'RECHAZADO',
        codigoError: 'TENANT_INVALIDO',
        message: 'El tenant_id no puede ser una cadena vacía.',
        errors: [{ campo: 'tenant_id', codigoError: 'TENANT_INVALIDO', descripcion: 'tenant_id no puede estar vacío.' }]
      };
    }

    const tenantId = String(options.tenantId || this.defaultTenantId || 'DEFAULT').trim();

    // 1. Validar mediante ArticuloEnvaseValidator
    const validator = this.validator || new _AE_VALIDATOR_CLASS({
      maestroArticulos: options.maestroArticulos || this._extraerArticulosDeMaestro(),
      maestroEnvasesValidados: options.maestroEnvases || this._extraerEnvasesDeMaestro()
    });

    const validationReport = validator.validate(rawInput, {
      fileName: options.fileName || 'ARTICULO_ENVASE_INGESTA.csv',
      tenantId,
      expectedTenantId: options.expectedTenantId || tenantId
    });

    const isOk = validationReport.ok !== undefined ? validationReport.ok : (validationReport.errores && validationReport.errores.length === 0);
    if (!isOk) {
      return {
        success: false,
        status: 'RECHAZADO',
        message: `La matriz artículo-envase contiene ${validationReport.errores.length} error(es) de validación.`,
        errors: validationReport.errores,
        report: validationReport
      };
    }

    const registros = validationReport.registrosNormalizados || [];
    if (registros.length === 0) {
      return {
        success: false,
        status: 'RECHAZADO',
        message: 'No se encontraron registros válidos para ingerir.',
        errors: [{ campo: 'archivo', codigoError: 'ARCHIVO_VACIO', descripcion: 'Cero registros para ingesta' }]
      };
    }

    // 2. Cargar estado actual de MAESTRO
    if (!this.repo) {
      throw new Error('No se ha configurado un repositorio para persistir la matriz artículo-envase.');
    }

    const maestroActual = this.repo.getMaestro() || [];

    // Mapeo actual por clave compuesta: tenant_id + "|" + codigo_articulo + "|" + codigo_envase
    const maestroIndex = new Map();
    // Mapeo de predeterminados actuales: tenant_id + "|" + codigo_articulo -> codigo_envase
    const currentDefaults = new Map();

    maestroActual.forEach((row, idx) => {
      const art = String(row.codigo_articulo || '').trim();
      const env = String(row.codigo_envase || '').trim();
      const tId = String(row.tenant_id || this.defaultTenantId).trim();
      if (art && env) {
        const fullKey = `${tId}|${art}|${env}`;
        maestroIndex.set(fullKey, { row, index: idx });

        const isPred = (row.es_predeterminado === true || String(row.es_predeterminado).toLowerCase() === 'true' || row.es_predeterminado === 1);
        const isActivo = (row.activo !== false && String(row.activo).toLowerCase() !== 'false' && row.activo !== 0);
        if (isPred && isActivo) {
          currentDefaults.set(`${tId}|${art}`, env);
        }
      }
    });

    // 3. Evaluar conflictos contra predeterminados existentes
    if (!options.allowDefaultOverride) {
      for (const rec of registros) {
        if (rec.es_predeterminado && rec.activo) {
          const artKey = `${rec.tenant_id}|${rec.codigo_articulo}`;
          if (currentDefaults.has(artKey)) {
            const existingDefaultEnv = currentDefaults.get(artKey);
            if (existingDefaultEnv !== rec.codigo_envase) {
              return {
                success: false,
                status: 'CONFLICTO_PREDETERMINADO',
                codigoError: _DIAG_CODES.CONFLICTO_PREDETERMINADO_MULTIPLE || 'CONFLICTO_PREDETERMINADO_MULTIPLE',
                message: `Conflicto de predeterminado: El artículo '${rec.codigo_articulo}' ya tiene a '${existingDefaultEnv}' como predeterminado en MAESTRO. Para cambiarlo, active allowDefaultOverride o utilice cambiarEnvasePredeterminado().`,
                conflicto: {
                  codigoArticulo: rec.codigo_articulo,
                  envaseActual: existingDefaultEnv,
                  nuevoEnvase: rec.codigo_envase,
                  tenantId: rec.tenant_id
                }
              };
            }
          }
        }
      }
    }

    // 4. Aplicar cambios en memoria garantizando idempotencia
    let insertedCount = 0;
    let updatedCount = 0;
    const nowIso = new Date().toISOString();

    for (const rec of registros) {
      const tId = rec.tenant_id || tenantId;
      const art = rec.codigo_articulo;
      const env = rec.codigo_envase;
      const fullKey = `${tId}|${art}|${env}`;

      // Si este registro es predeterminado y permitimos override, desmarcar otros del mismo artículo
      if (rec.es_predeterminado && options.allowDefaultOverride) {
        maestroActual.forEach(m => {
          const mArt = String(m.codigo_articulo || '').trim();
          const mTId = String(m.tenant_id || this.defaultTenantId).trim();
          const mEnv = String(m.codigo_envase || '').trim();
          if (mArt === art && mTId === tId && mEnv !== env) {
            m.es_predeterminado = false;
          }
        });
      }

      if (maestroIndex.has(fullKey)) {
        // Actualización idempotente (reutilizar registro existente)
        const entry = maestroIndex.get(fullKey);
        const existing = entry.row;
        existing.nombre_articulo = rec.nombre_articulo || existing.nombre_articulo || '';
        existing.descripcion_envase = rec.descripcion_envase || existing.descripcion_envase || '';
        existing.es_predeterminado = rec.es_predeterminado;
        existing.activo = rec.activo;
        if (rec.grupo_comercial !== undefined && rec.grupo_comercial !== '') {
          existing.grupo_comercial = rec.grupo_comercial;
        }
        existing.tenant_id = tId;
        updatedCount++;
      } else {
        // Inserción de nueva relación
        const newRecord = {
          codigo_articulo: art,
          codigo_envase: env,
          nombre_articulo: rec.nombre_articulo || '',
          descripcion_envase: rec.descripcion_envase || '',
          es_predeterminado: rec.es_predeterminado,
          grupo_comercial: rec.grupo_comercial || '',
          activo: rec.activo,
          tenant_id: tId,
          fecha_alta: nowIso
        };
        maestroActual.push(newRecord);
        maestroIndex.set(fullKey, { row: newRecord, index: maestroActual.length - 1 });
        insertedCount++;
      }
    }

    // 5. Persistir si no es dryRun
    if (!options.dryRun) {
      this.repo.saveMaestro(maestroActual);
    }

    return {
      success: true,
      status: 'INGESTADO',
      dryRun: Boolean(options.dryRun),
      insertedCount,
      updatedCount,
      totalProcesados: registros.length,
      cardinalidad: validationReport.cardinalidad || {},
      registros
    };
  }

  /**
   * Cambia de forma atómica y explícita el envase predeterminado de un artículo.
   * Desmarca el predeterminado anterior y marca el nuevo, manteniendo ambas asociaciones activas.
   * 
   * @param {string} codigoArticulo 
   * @param {string} nuevoEnvasePredeterminado 
   * @param {Object} [options]
   * @param {string} [options.tenantId='DEFAULT']
   * @param {string} [options.nombreArticulo]
   * @param {string} [options.descripcionEnvase]
   * @returns {Object}
   */
  cambiarEnvasePredeterminado(codigoArticulo, nuevoEnvasePredeterminado, options = {}) {
    const art = String(codigoArticulo || '').trim();
    const nuevoEnv = String(nuevoEnvasePredeterminado || '').trim();
    const tenantId = String(options.tenantId || this.defaultTenantId || 'DEFAULT').trim();

    if (!art || !nuevoEnv) {
      throw new Error('cambiarEnvasePredeterminado requiere codigoArticulo y nuevoEnvasePredeterminado.');
    }

    if (nuevoEnv === 'DEFAULT' || nuevoEnv === 'ENVASE_NO_DETERMINABLE_DESDE_PDF') {
      throw new Error(`El envase '${nuevoEnv}' no es un envase comercial válido.`);
    }

    if (!this.repo) {
      throw new Error('Repositorio no disponible.');
    }

    const maestro = this.repo.getMaestro() || [];
    let targetFound = false;
    let anteriorPredeterminado = null;

    maestro.forEach(m => {
      const mArt = String(m.codigo_articulo || '').trim();
      const mEnv = String(m.codigo_envase || '').trim();
      const mTId = String(m.tenant_id || this.defaultTenantId).trim();

      if (mArt === art && mTId === tenantId) {
        const isPred = (m.es_predeterminado === true || String(m.es_predeterminado).toLowerCase() === 'true' || m.es_predeterminado === 1);
        if (mEnv === nuevoEnv) {
          m.es_predeterminado = true;
          m.activo = true;
          if (options.nombreArticulo && !m.nombre_articulo) m.nombre_articulo = options.nombreArticulo;
          if (options.descripcionEnvase && !m.descripcion_envase) m.descripcion_envase = options.descripcionEnvase;
          targetFound = true;
        } else {
          if (isPred) {
            anteriorPredeterminado = mEnv;
          }
          m.es_predeterminado = false;
        }
      }
    });

    if (!targetFound) {
      maestro.push({
        codigo_articulo: art,
        codigo_envase: nuevoEnv,
        nombre_articulo: options.nombreArticulo || '',
        descripcion_envase: options.descripcionEnvase || '',
        es_predeterminado: true,
        grupo_comercial: options.grupoComercial || '',
        activo: true,
        tenant_id: tenantId,
        fecha_alta: new Date().toISOString()
      });
    }

    this.repo.saveMaestro(maestro);

    return {
      success: true,
      status: 'PREDETERMINADO_ACTUALIZADO',
      codigoArticulo: art,
      nuevoPredeterminado: nuevoEnv,
      anteriorPredeterminado,
      tenantId
    };
  }

  /**
   * Asocia de forma controlada un artículo con un envase. Utilizado por la opción 'recordar'
   * durante la confirmación manual de compras.
   * 
   * @param {Object} params
   * @param {string} params.codigoArticulo
   * @param {string} params.codigoEnvase
   * @param {string} [params.nombreArticulo]
   * @param {string} [params.descripcionEnvase]
   * @param {boolean} [params.esPredeterminado=false]
   * @param {string} [params.tenantId='DEFAULT']
   * @returns {Object}
   */
  asociarArticuloEnvase(params = {}) {
    const art = String(params.codigoArticulo || '').trim();
    const env = String(params.codigoEnvase || '').trim();
    const tenantId = String(params.tenantId || this.defaultTenantId || 'DEFAULT').trim();
    const esPred = Boolean(params.esPredeterminado);

    if (!art) throw new Error('asociarArticuloEnvase: codigoArticulo es obligatorio.');
    if (!env || env === 'DEFAULT' || env === 'ENVASE_NO_DETERMINABLE_DESDE_PDF') {
      throw new Error(`asociarArticuloEnvase: El envase '${env}' no es un envase comercial válido.`);
    }

    if (!this.repo) throw new Error('Repositorio no disponible.');

    if (esPred) {
      return this.cambiarEnvasePredeterminado(art, env, {
        tenantId,
        nombreArticulo: params.nombreArticulo,
        descripcionEnvase: params.descripcionEnvase
      });
    }

    // Si no se marca como predeterminado, verificar si el artículo ya tiene algún envase
    const maestro = this.repo.getMaestro() || [];
    const artAssocs = maestro.filter(m => 
      String(m.codigo_articulo || '').trim() === art &&
      String(m.tenant_id || this.defaultTenantId).trim() === tenantId
    );

    // Si el artículo no tenía ninguna asociación previa, esta primera asociación puede quedar como predeterminada
    const debeSerPredeterminado = artAssocs.length === 0;

    return this.repo.upsertMaestroRecord({
      codigo_articulo: art,
      codigo_envase: env,
      nombre_articulo: params.nombreArticulo || '',
      descripcion_envase: params.descripcionEnvase || '',
      es_predeterminado: debeSerPredeterminado,
      grupo_comercial: params.grupoComercial || '',
      activo: true,
      tenant_id: tenantId
    });
  }

  _extraerArticulosDeMaestro() {
    if (!this.repo) return [];
    const maestro = this.repo.getMaestro() || [];
    const map = new Map();
    maestro.forEach(m => {
      const cod = String(m.codigo_articulo || '').trim();
      if (cod && !map.has(cod)) {
        map.set(cod, {
          codigo_articulo: cod,
          nombre_articulo: m.nombre_articulo || '',
          activo: (m.activo !== false && String(m.activo).toLowerCase() !== 'false' && m.activo !== 0)
        });
      }
    });
    return Array.from(map.values());
  }

  _extraerEnvasesDeMaestro() {
    if (!this.repo) return [];
    const maestro = this.repo.getMaestro() || [];
    const map = new Map();
    maestro.forEach(m => {
      const cod = String(m.codigo_envase || '').trim();
      if (cod && cod !== 'DEFAULT' && cod !== 'ENVASE_NO_DETERMINABLE_DESDE_PDF' && !map.has(cod)) {
        map.set(cod, {
          codigo_envase: cod,
          descripcion_envase: m.descripcion_envase || '',
          activo: (m.activo !== false && String(m.activo).toLowerCase() !== 'false' && m.activo !== 0)
        });
      }
    });

    try {
      const grupos = this.repo.getGruposEnvase() || [];
      grupos.forEach(g => {
        const cod = String(g.codigo_envase || '').trim();
        if (cod && !map.has(cod)) {
          map.set(cod, {
            codigo_envase: cod,
            descripcion_envase: g.descripcion_envase || '',
            activo: (g.activo !== false && String(g.activo).toLowerCase() !== 'false' && g.activo !== 0)
          });
        }
      });
    } catch (e) {}

    return Array.from(map.values());
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ArticuloEnvaseIngestionService
  };
}
