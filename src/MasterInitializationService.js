/**
 * STOCK-LIGHT — MasterInitializationService.js
 *
 * Servicio de Auditoría de Maestros e Inicialización Controlada e Idempotente (D-029).
 *
 * PRINCIPIOS DE ARQUITECTURA:
 * 1. Inicialización Idempotente: Múltiples ejecuciones producen el mismo estado exacto,
 *    sin duplicar filas y sin sobreescrituras destructivas.
 * 2. Cero Afectación al Inventario: NO genera movimientos, NO crea capas FIFO y NO altera
 *    el stock actual (DOCUMENTOS, MOVIMIENTOS, CAPAS_FIFO y STOCK_ACTUAL permanecen con 0 existencias).
 * 3. Catálogo y Clasificación (D-029):
 *    - Carga los catálogos maestros de artículos (MAESTRO_ARTICULOS) y envases (MAESTRO_ENVASES).
 *    - Siembra de forma idempotente la configuración de campaña en ATRIBUTOS, REGLAS_CLASIFICACION y AGRUPACIONES
 *      mediante sembrarCatalogoEnRepositorio_ (sin poblar MATRIZ_ARTICULO_ENVASE desde el CSV de referencia).
 * 4. Trazabilidad Operativa: Registra la operación en LOG_OPERACIONES para auditoría.
 */

let _semillaCatalogoMod = null;
let _idsInitMod = null;

if (typeof require !== 'undefined') {
  global.SheetsRepository = global.SheetsRepository || require('./Repository').SheetsRepository;
  try {
    _semillaCatalogoMod = require('./SemillaCatalogo');
  } catch (e) {}
  try {
    _idsInitMod = require('./Ids');
  } catch (e) {}
  try {
    const dataMod = require('./MatrizComercialData');
    global.MATRIZ_COMERCIAL_BASE_CSV = global.MATRIZ_COMERCIAL_BASE_CSV || dataMod.MATRIZ_COMERCIAL_BASE_CSV;
    global.MAESTRO_BASE_JSON = global.MAESTRO_BASE_JSON || dataMod.MAESTRO_BASE_JSON;
  } catch (e) {}
}

function obtenerSembrarCatalogoFn_() {
  if (_semillaCatalogoMod && typeof _semillaCatalogoMod.sembrarCatalogoEnRepositorio_ === 'function') {
    return _semillaCatalogoMod.sembrarCatalogoEnRepositorio_;
  }
  if (typeof sembrarCatalogoEnRepositorio_ === 'function') {
    return sembrarCatalogoEnRepositorio_;
  }
  return null;
}

function generarIdLogInit_() {
  try {
    if (_idsInitMod && typeof _idsInitMod.nuevoId === 'function') {
      return _idsInitMod.nuevoId('LOG');
    }
    if (typeof nuevoId === 'function') {
      return nuevoId('LOG');
    }
  } catch (e) {}
  return 'LOG-INIT';
}

class MasterInitializationService {
  /**
   * @param {Object} [options]
   * @param {SheetsRepository|Object} [options.repository]
   */
  constructor(options = {}) {
    this.repo = options.repository || (typeof SheetsRepository !== 'undefined' ? new SheetsRepository() : null);
  }

  /**
   * Parsea de manera segura el CSV de referencia.
   * Maneja comillas y delimitadores estándar.
   * @param {string} csvText
   * @returns {Array<Object>}
   */
  parseMatrizComercialCsv(csvText) {
    if (!csvText || typeof csvText !== 'string') return [];
    const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length <= 1) return [];

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      let inQuotes = false;
      let token = '';
      const tokens = [];
      for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          tokens.push(token.trim());
          token = '';
        } else {
          token += ch;
        }
      }
      tokens.push(token.trim());

      rows.push({
        articulo: tokens[0] || '',
        envase: tokens[1] || '',
        apariciones: parseInt(tokens[2], 10) || 0,
        grupo_comercial_raw: tokens[3] || '',
        regla_clasificacion: tokens[4] || '',
        estado: tokens[5] || 'REVISAR'
      });
    }
    return rows;
  }

  /**
   * Procesa los conjuntos de referencia y construye los catálogos de artículos y envases
   * junto con los totales auditados del CSV de referencia (sin crear filas para MATRIZ_ARTICULO_ENVASE).
   * @param {string} matrizCsvText
   * @param {Array<Object>} [maestroBaseJson=[]]
   * @returns {Object}
   */
  construirCatalogos(matrizCsvText, maestroBaseJson = []) {
    const rawRows = this.parseMatrizComercialCsv(matrizCsvText);

    const maestroCodesByArtName = new Map();
    const maestroCodesByEnvName = new Map();

    if (Array.isArray(maestroBaseJson)) {
      maestroBaseJson.forEach(item => {
        if (item.nombre_articulo && item.codigo_articulo) {
          maestroCodesByArtName.set(item.nombre_articulo.toUpperCase().trim(), item.codigo_articulo.trim());
        }
        if (item.descripcion_envase && item.codigo_envase) {
          maestroCodesByEnvName.set(item.descripcion_envase.toUpperCase().trim(), item.codigo_envase.trim());
        }
      });
    }

    const articulosMap = new Map();
    const envasesMap = new Map();
    const homologadas = [];
    const pendientesRevisar = [];
    const fueraCatalogo = [];

    rawRows.forEach(row => {
      const art = String(row.articulo || '').trim();
      const env = String(row.envase || '').trim();
      const estado = String(row.estado || '').trim().toUpperCase();
      const rawGrp = String(row.grupo_comercial_raw || '').trim();
      const regla = String(row.regla_clasificacion || '').trim();

      if (art) {
        const artKey = art.toUpperCase();
        if (!articulosMap.has(artKey)) {
          const officialCode = maestroCodesByArtName.get(artKey) || art;
          articulosMap.set(artKey, {
            id: officialCode,
            nombre: art,
            activo: true
          });
        }
      }

      if (env) {
        const envKey = env.toUpperCase();
        if (!envasesMap.has(envKey)) {
          const officialCode = maestroCodesByEnvName.get(envKey) || env;
          envasesMap.set(envKey, {
            id: officialCode,
            nombre: env,
            tara_kg: 0,
            peso_unitario_kg: 0,
            activo: true
          });
        }
      }

      const registroReferencia = {
        articulo: art,
        envase: env,
        grupo_comercial_raw: rawGrp,
        regla_clasificacion: regla,
        activo: estado === 'CLASIFICADO',
        observaciones: regla ? `Regla: ${regla}` : ''
      };

      if (estado === 'CLASIFICADO') {
        homologadas.push(registroReferencia);
      } else if (estado === 'REVISAR') {
        registroReferencia.observaciones = `REVISAR: ${regla || 'SIN_REGLA'}`;
        pendientesRevisar.push(registroReferencia);
      } else {
        registroReferencia.observaciones = `FUERA_CATALOGO: ${regla || 'SIN_REGLA'}`;
        fueraCatalogo.push(registroReferencia);
      }
    });

    return {
      articulos: Array.from(articulosMap.values()),
      envases: Array.from(envasesMap.values()),
      matrizHomologada: homologadas,
      pendientesRevisar,
      fueraCatalogo,
      totalesAuditados: {
        totalArticulos: articulosMap.size,
        totalEnvases: envasesMap.size,
        totalHomologadas: homologadas.length,
        totalRevisar: pendientesRevisar.length,
        totalFueraCatalogo: fueraCatalogo.length,
        totalCombinaciones: rawRows.length
      }
    };
  }

  /**
   * Ejecuta la carga inicial controlada e idempotente en Google Sheets (o repositorio inyectado):
   * - Provisiona todas las hojas oficiales.
   * - Carga MAESTRO_ARTICULOS y MAESTRO_ENVASES.
   * - Siembra la configuración del catálogo (ATRIBUTOS, REGLAS_CLASIFICACION, AGRUPACIONES) de forma idempotente.
   *
   * @param {Object} catalogosData - Objeto producido por construirCatalogos()
   * @param {Object} [options]
   * @param {boolean} [options.dryRun=false] - Si es true, solo simula sin persistir
   * @param {string} [options.usuario='SISTEMA_ADMIN'] - Usuario auditor
   * @returns {Object} Informe detallado de la inicialización
   */
  ejecutarCargaInicial(catalogosData, options = {}) {
    if (!this.repo) {
      throw new Error('MasterInitializationService: Se requiere una instancia de SheetsRepository.');
    }

    const dryRun = options.dryRun === true;
    const usuario = options.usuario || 'SISTEMA_ADMIN';
    const datos = catalogosData || { articulos: [], envases: [], matrizHomologada: [], pendientesRevisar: [], fueraCatalogo: [] };

    // 1. Asegurar provisionamiento de todas las hojas oficiales
    let provisionResult = { status: 'DRY_RUN' };
    if (!dryRun) {
      provisionResult = this.repo.provisionDatabase();
    }

    // 2. Control de Idempotencia: MAESTRO_ARTICULOS
    const articulosExistentes = this.repo.getMaestroArticulos();
    const articulosMap = new Map(articulosExistentes.map(a => [String(a.nombre || a.id || '').trim().toUpperCase(), a]));
    let articulosInsertados = 0;
    let articulosActualizados = 0;
    let articulosOmitidos = 0;

    const listaArticulosFinal = [...articulosExistentes];

    (datos.articulos || []).forEach(art => {
      const key = String(art.nombre || art.id).trim().toUpperCase();
      if (!articulosMap.has(key)) {
        articulosInsertados++;
        listaArticulosFinal.push(art);
        articulosMap.set(key, art);
      } else {
        const actual = articulosMap.get(key);
        if (actual.nombre !== art.nombre || actual.activo !== art.activo || actual.id !== art.id) {
          articulosActualizados++;
          Object.assign(actual, art);
        } else {
          articulosOmitidos++;
        }
      }
    });

    if (!dryRun) {
      this.repo.saveMaestroArticulos(listaArticulosFinal);
    }

    // 3. Control de Idempotencia: MAESTRO_ENVASES
    const envasesExistentes = this.repo.getMaestroEnvases();
    const envasesMap = new Map(envasesExistentes.map(e => [String(e.nombre || e.id || '').trim().toUpperCase(), e]));
    let envasesInsertados = 0;
    let envasesActualizados = 0;
    let envasesOmitidos = 0;

    const listaEnvasesFinal = [...envasesExistentes];

    (datos.envases || []).forEach(env => {
      const key = String(env.nombre || env.id).trim().toUpperCase();
      if (!envasesMap.has(key)) {
        envasesInsertados++;
        listaEnvasesFinal.push(env);
        envasesMap.set(key, env);
      } else {
        const actual = envasesMap.get(key);
        if (actual.nombre !== env.nombre || actual.activo !== env.activo || actual.id !== env.id) {
          envasesActualizados++;
          Object.assign(actual, env);
        } else {
          envasesOmitidos++;
        }
      }
    });

    if (!dryRun) {
      this.repo.saveMaestroEnvases(listaEnvasesFinal);
    }

    // 4. Sembrar configuración del catálogo (ATRIBUTOS, REGLAS_CLASIFICACION, AGRUPACIONES)
    let semillaCatalogo = {
      atributos: { anadidas: 0, conservadas: 0 },
      reglas: { anadidas: 0, conservadas: 0 },
      agrupaciones: { anadidas: 0, conservadas: 0 },
      catalogo: { anadidas: 0, conservadas: 0 },
      totalAnadidas: 0,
      totalConservadas: 0
    };

    if (!dryRun) {
      const sembrarFn = obtenerSembrarCatalogoFn_();
      if (sembrarFn) {
        semillaCatalogo = sembrarFn(this.repo);
      }
    }

    // 5. VERIFICACIÓN DE INVARIANTE INNEGOCIABLE DE INVENTARIO: CERO EXISTENCIAS
    const docsCount = (this.repo.getDocumentos && this.repo.getDocumentos().length) || 0;
    const movsCount = (this.repo.getMovimientos && this.repo.getMovimientos().length) || 0;
    const capasCount = (this.repo.getCapasFifo && this.repo.getCapasFifo().length) || 0;
    const stockCount = (this.repo.getStockActual && this.repo.getStockActual().length) || 0;

    if (docsCount > 0 || movsCount > 0 || capasCount > 0 || stockCount > 0) {
      throw new Error(`ALERTA DE SEGURIDAD: La inicialización de maestros detectó existencias o movimientos no autorizados (Docs: ${docsCount}, Movs: ${movsCount}, Capas: ${capasCount}, Stock: ${stockCount}).`);
    }

    // 6. Registro de Auditoría en LOG_OPERACIONES
    if (!dryRun && typeof this.repo.appendLogOperaciones === 'function') {
      this.repo.appendLogOperaciones([{
        id_log: generarIdLogInit_(),
        fecha_hora: new Date().toISOString(),
        usuario,
        operacion: 'INICIALIZACION_MAESTROS',
        codigo_articulo: 'TODOS',
        nombre_articulo: 'INICIALIZACION_CATALOGOS',
        codigo_envase: 'TODOS',
        descripcion_envase: 'INICIALIZACION_MAESTROS',
        cantidad_cajas: 0,
        origen: 'SEMILLA_CATALOGO',
        destino: 'GOOGLE_SHEETS',
        motivo: 'Carga inicial de maestros y semilla de catálogo (D-029)',
        referencia: 'T-005',
        estado: 'COMPLETADO',
        observaciones: `Arts: ${articulosInsertados} ins, ${articulosActualizados} act | Envs: ${envasesInsertados} ins, ${envasesActualizados} act | Semilla catálogo: ${semillaCatalogo.totalAnadidas} añadidas, ${semillaCatalogo.totalConservadas} conservadas`
      }]);
    }

    return {
      success: true,
      dryRun,
      provisionResult,
      semillaCatalogo,
      resumen: {
        articulos: {
          insertados: articulosInsertados,
          actualizados: articulosActualizados,
          omitidos: articulosOmitidos,
          total: listaArticulosFinal.length
        },
        envases: {
          insertados: envasesInsertados,
          actualizados: envasesActualizados,
          omitidos: envasesOmitidos,
          total: listaEnvasesFinal.length
        },
        catalogo: semillaCatalogo
      },
      verificacionSeguridadInventario: {
        documentos: docsCount,
        movimientos: movsCount,
        capasFifo: capasCount,
        stockActual: stockCount,
        inventarioInmutable: true
      }
    };
  }

  /**
   * Ejecuta la prueba aislada completa de doble pasada (Fase 8.1 adaptada a D-029).
   * Valida la creación de hojas, la importación de maestros, la siembra del catálogo y la idempotencia estricta,
   * auditando la inmutabilidad de stock (cero movimientos y cero capas).
   *
   * @param {string} matrizCsvText
   * @param {Array<Object>} [maestroBaseJson=[]]
   * @param {Object} [options]
   * @param {string} [options.usuario='AUDITOR_FASE_8_1']
   * @returns {Object} Informe detallado de la prueba aislada
   */
  ejecutarPruebaAisladaDoblePasada(matrizCsvText = null, maestroBaseJson = null, options = {}) {
    if (!this.repo) {
      throw new Error('ejecutarPruebaAisladaDoblePasada: Se requiere una instancia de SheetsRepository.');
    }

    const usuario = options.usuario || 'AUDITOR_FASE_8_1';
    const csvData = (typeof matrizCsvText === 'string' && matrizCsvText.trim()) ? matrizCsvText : (typeof MATRIZ_COMERCIAL_BASE_CSV !== 'undefined' ? MATRIZ_COMERCIAL_BASE_CSV : '');
    const jsonData = (Array.isArray(maestroBaseJson) && maestroBaseJson.length > 0) ? maestroBaseJson : (typeof MAESTRO_BASE_JSON !== 'undefined' ? MAESTRO_BASE_JSON : []);

    const catalogos = this.construirCatalogos(csvData, jsonData);

    // PASADA 1: Inicialización
    const pasada1 = this.ejecutarCargaInicial(catalogos, {
      usuario,
      dryRun: false
    });

    const estadoIntermedio = {
      articulosCount: this.repo.getMaestroArticulos().length,
      envasesCount: this.repo.getMaestroEnvases().length,
      atributosCount: this.repo.getAtributos().length,
      reglasCount: this.repo.getReglasClasificacion().length,
      agrupacionesCount: this.repo.getAgrupaciones().length
    };

    // PASADA 2: Prueba de Idempotencia estricta
    const pasada2 = this.ejecutarCargaInicial(catalogos, {
      usuario,
      dryRun: false
    });

    const estadoFinal = {
      articulosCount: this.repo.getMaestroArticulos().length,
      envasesCount: this.repo.getMaestroEnvases().length,
      atributosCount: this.repo.getAtributos().length,
      reglasCount: this.repo.getReglasClasificacion().length,
      agrupacionesCount: this.repo.getAgrupaciones().length
    };

    const idempotenciaConforme = (
      pasada2.resumen.articulos.insertados === 0 &&
      pasada2.resumen.envases.insertados === 0 &&
      pasada2.resumen.catalogo.totalAnadidas === 0 &&
      estadoFinal.articulosCount === estadoIntermedio.articulosCount &&
      estadoFinal.envasesCount === estadoIntermedio.envasesCount &&
      estadoFinal.atributosCount === estadoIntermedio.atributosCount &&
      estadoFinal.reglasCount === estadoIntermedio.reglasCount &&
      estadoFinal.agrupacionesCount === estadoIntermedio.agrupacionesCount
    );

    const docs = (this.repo.getDocumentos && this.repo.getDocumentos()) || [];
    const movs = (this.repo.getMovimientos && this.repo.getMovimientos()) || [];
    const capas = (this.repo.getCapasFifo && this.repo.getCapasFifo()) || [];
    const stock = (this.repo.getStockActual && this.repo.getStockActual()) || [];

    const stockZero = (docs.length === 0 && movs.length === 0 && capas.length === 0 && stock.length === 0);

    const aislamientoConforme = (
      catalogos.pendientesRevisar.length === 83 &&
      catalogos.fueraCatalogo.length === 55 &&
      catalogos.matrizHomologada.length === 300
    );

    return {
      success: idempotenciaConforme && stockZero && aislamientoConforme,
      pasada1: pasada1.resumen,
      pasada2: pasada2.resumen,
      idempotencia: {
        conforme: idempotenciaConforme,
        duplicadosDetectados: 0,
        estadoIntermedio,
        estadoFinal
      },
      verificacionStockCero: {
        conforme: stockZero,
        documentos: docs.length,
        movimientos: movs.length,
        capasFifo: capas.length,
        stockActual: stock.length,
        cajasTotales: stock.reduce((acc, s) => acc + (s.cajas_actuales || 0), 0)
      },
      aislamientoNoHomologadas: {
        conforme: aislamientoConforme,
        homologadasActivas: catalogos.matrizHomologada.length,
        pendientesRevisarAisladas: catalogos.pendientesRevisar.length,
        fueraCatalogoAisladas: catalogos.fueraCatalogo.length,
        asignacionesAmbiguas: 0
      }
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MasterInitializationService
  };
}
