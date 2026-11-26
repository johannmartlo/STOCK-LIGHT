/**
 * STOCK-LIGHT — ImportacionService.js
 *
 * Servicio de importación en lote de los CSV de Hispatec (T-007).
 * - `previsualizar(textoCsv)` no escribe nada: parsea, clasifica, cruza con DOCUMENTOS y simula.
 * - `confirmar(textoCsv, hashEsperado, usuario)` vuelve a parsear el archivo, comprueba el hash
 *   y aplica por tramos de documentos completos sobre `MovementService.aplicarDocumentosEnLote`.
 *
 * La lógica de parseo, clasificación y agrupación es pura; la escritura vive en MovementService
 * dentro del único lock y del único `_persistir` por tramo (D-022).
 */

const IMPORTACIONES_CONFIG_NODE = typeof module !== 'undefined' && module.exports
  ? require('../Config')
  : null;
const IMPORTACIONES_PARSER_NODE = typeof module !== 'undefined' && module.exports
  ? require('./CsvHispatecParser')
  : null;
const IMPORTACIONES_CLASIFICADOR_NODE = typeof module !== 'undefined' && module.exports
  ? require('./ClasificadorLineas')
  : null;
const IMPORTACIONES_NORMALIZACION_NODE = typeof module !== 'undefined' && module.exports
  ? require('../Normalizacion')
  : null;
const IMPORTACIONES_EXCLUSIONES_NODE = typeof module !== 'undefined' && module.exports
  ? require('../Exclusiones')
  : null;
const IMPORTACIONES_EQUIVALENCIAS_NODE = typeof module !== 'undefined' && module.exports
  ? require('../Equivalencias')
  : null;
const IMPORTACIONES_CRYPTO_NODE = typeof module !== 'undefined' && module.exports
  ? require('crypto')
  : null;

class ImportacionService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.repository]
   * @param {Object} [options.movementService]
   * @param {Object} [options.catalogoService]
   * @param {Object} [options.configCatalogo] - Configuración estática del catálogo para pruebas o entornos controlados.
   * @param {number} [options.umbralTramos]
   * @param {Object} [options.lockService]
   */
  constructor(options = {}) {
    const RepoClass = (typeof SheetsRepository !== 'undefined')
      ? SheetsRepository
      : (typeof require !== 'undefined' ? require('../Repository').SheetsRepository : null);
    if (!RepoClass && !options.repository) {
      throw new Error('SheetsRepository no está disponible en ImportacionService');
    }
    this.repo = options.repository || new RepoClass();

    const MovementClass = (typeof MovementService !== 'undefined')
      ? MovementService
      : (typeof require !== 'undefined' ? require('../MovementService').MovementService : null);
    this.movementService = options.movementService || (MovementClass
      ? new MovementClass({ repository: this.repo, lockService: options.lockService })
      : null);
    if (!this.movementService) {
      throw new Error('MovementService no está disponible en ImportacionService');
    }

    const CatalogoClass = (typeof CatalogoService !== 'undefined')
      ? CatalogoService
      : (typeof require !== 'undefined' ? require('../CatalogoService').CatalogoService : null);
    this.catalogoService = options.catalogoService || (CatalogoClass
      ? new CatalogoClass({
        repository: this.repo,
        config: options.configCatalogo || options.config || null
      })
      : null);
    if (!this.catalogoService || typeof this.catalogoService.esCombinacionSeguida !== 'function') {
      throw new Error('CatalogoService no está disponible en ImportacionService');
    }

    const umbralPredeterminado = (IMPORTACIONES_CONFIG_NODE && IMPORTACIONES_CONFIG_NODE.UMBRAL_DOCUMENTOS_POR_TRAMO)
      ? IMPORTACIONES_CONFIG_NODE.UMBRAL_DOCUMENTOS_POR_TRAMO
      : (typeof UMBRAL_DOCUMENTOS_POR_TRAMO !== 'undefined' ? UMBRAL_DOCUMENTOS_POR_TRAMO : 150);
    const umbral = Number(options.umbralTramos || umbralPredeterminado);
    this.umbralTramos = Number.isFinite(umbral) && umbral > 0 ? Math.floor(umbral) : 150;
    this.pendientesService = options.pendientesService || null;
    this.clientesExcluidos = options.clientesExcluidos !== undefined ? options.clientesExcluidos : null;
    this.fuenteEntradas = options.fuenteEntradas !== undefined ? options.fuenteEntradas : null;
    this.propertiesService = options.propertiesService || null;
  }

  _resolverPendientesService_() {
    if (this.pendientesService) return this.pendientesService;
    const PendClass = (typeof PendientesService !== 'undefined')
      ? PendientesService
      : (typeof require !== 'undefined' ? require('./PendientesService').PendientesService : null);
    if (!PendClass) return null;
    return new PendClass({
      repository: this.repo,
      movementService: this.movementService,
      catalogoService: this.catalogoService,
      lockService: this.movementService && this.movementService.lock
    });
  }

  /**
   * Hash SHA-256 en hexadecimal del texto del CSV.
   * @param {string} texto
   * @returns {string}
   * @private
   */
  _hash_(texto) {
    const contenido = String(texto === null || texto === undefined ? '' : texto);
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.computeDigest === 'function') {
      const digest = Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        contenido,
        Utilities.Charset ? Utilities.Charset.UTF_8 : undefined
      );
      return digest.map(byte => {
        const positivo = byte < 0 ? byte + 256 : byte;
        return positivo.toString(16).padStart(2, '0');
      }).join('');
    }
    if (IMPORTACIONES_CRYPTO_NODE) {
      return IMPORTACIONES_CRYPTO_NODE.createHash('sha256').update(contenido, 'utf8').digest('hex');
    }
    if (typeof require !== 'undefined') {
      return require('crypto').createHash('sha256').update(contenido, 'utf8').digest('hex');
    }
    throw new Error('No hay SHA-256 disponible en este entorno');
  }

  _normalizar_(texto) {
    if (IMPORTACIONES_NORMALIZACION_NODE) {
      return IMPORTACIONES_NORMALIZACION_NODE.normalizarNombre(texto);
    }
    if (typeof normalizarNombre === 'function') return normalizarNombre(texto);
    return String(texto === null || texto === undefined ? '' : texto).trim().replace(/\s+/g, ' ').toUpperCase();
  }

  _fuenteEntradas_() {
    const normalizarFn = (IMPORTACIONES_CONFIG_NODE && typeof IMPORTACIONES_CONFIG_NODE.normalizarFuenteEntradas_ === 'function')
      ? IMPORTACIONES_CONFIG_NODE.normalizarFuenteEntradas_
      : (typeof normalizarFuenteEntradas_ === 'function' ? normalizarFuenteEntradas_ : null);
    if (this.fuenteEntradas !== null && this.fuenteEntradas !== undefined && String(this.fuenteEntradas).trim() !== '') {
      return normalizarFn ? normalizarFn(this.fuenteEntradas) : String(this.fuenteEntradas).trim().toUpperCase();
    }
    const getter = (IMPORTACIONES_CONFIG_NODE && typeof IMPORTACIONES_CONFIG_NODE.getFuenteEntradasConfig === 'function')
      ? IMPORTACIONES_CONFIG_NODE.getFuenteEntradasConfig
      : (typeof getFuenteEntradasConfig === 'function' ? getFuenteEntradasConfig : null);
    if (getter) return getter({ propertiesService: this.propertiesService });
    return 'COMPRAS';
  }

  _normalizarArticulosRecepcion_(lineas) {
    const leerFn = (IMPORTACIONES_EQUIVALENCIAS_NODE && typeof IMPORTACIONES_EQUIVALENCIAS_NODE.leerEquivalencias_ === 'function')
      ? IMPORTACIONES_EQUIVALENCIAS_NODE.leerEquivalencias_
      : (typeof leerEquivalencias_ === 'function' ? leerEquivalencias_ : null);
    const normalizarDescripcion = (IMPORTACIONES_EQUIVALENCIAS_NODE && typeof IMPORTACIONES_EQUIVALENCIAS_NODE.normalizarDescripcionEquivalencia_ === 'function')
      ? IMPORTACIONES_EQUIVALENCIAS_NODE.normalizarDescripcionEquivalencia_
      : (typeof normalizarDescripcionEquivalencia_ === 'function' ? normalizarDescripcionEquivalencia_ : this._normalizar_.bind(this));
    const mapa = new Map();
    if (leerFn) {
      for (const equivalencia of leerFn(this.repo)) {
        if (equivalencia && equivalencia.descripcion && equivalencia.nombre_articulo) {
          mapa.set(equivalencia.descripcion, equivalencia.nombre_articulo);
        }
      }
    }
    for (const linea of lineas) {
      const descripcion = normalizarDescripcion(linea.articulo);
      linea.articulo = mapa.get(descripcion) || descripcion || null;
    }
  }

  _articulosConVenta_() {
    const articulos = new Set();
    const catalogo = this.repo && typeof this.repo.getCatalogo === 'function' ? this.repo.getCatalogo() : [];
    for (const fila of catalogo) {
      if (fila && fila.articulo) articulos.add(this._normalizar_(fila.articulo));
    }
    const movimientos = this.repo && typeof this.repo.getMovimientos === 'function' ? this.repo.getMovimientos() : [];
    for (const movimiento of movimientos) {
      if (String(movimiento.tipo_movimiento || '').toUpperCase() !== 'SALIDA') continue;
      if (movimiento.codigo_articulo) articulos.add(this._normalizar_(movimiento.codigo_articulo));
    }
    // T-035: una venta pendiente también cuenta como pareja, aunque todavía no
    // haya generado movimiento.
    const pendientes = this.repo && typeof this.repo.getPendientes === 'function' ? this.repo.getPendientes() : [];
    for (const pendiente of pendientes) {
      if (String(pendiente.tipo_doc || '').toUpperCase() !== 'SALIDA') continue;
      if (pendiente.articulo) articulos.add(this._normalizar_(pendiente.articulo));
    }
    return articulos;
  }

  _parsear_(texto) {
    if (IMPORTACIONES_PARSER_NODE && typeof IMPORTACIONES_PARSER_NODE.parsear === 'function') {
      return IMPORTACIONES_PARSER_NODE.parsear(texto);
    }
    if (typeof parsear === 'function') return parsear(texto);
    throw new Error('El parser CSV de Hispatec no está disponible');
  }

  _clasificar_(lineas, tipo) {
    const clasificarFn = (IMPORTACIONES_CLASIFICADOR_NODE && typeof IMPORTACIONES_CLASIFICADOR_NODE.clasificar === 'function')
      ? IMPORTACIONES_CLASIFICADOR_NODE.clasificar
      : (typeof clasificar === 'function' ? clasificar : null);
    if (!clasificarFn) throw new Error('El clasificador de líneas no está disponible');
    const prefijosBase = (IMPORTACIONES_CONFIG_NODE && IMPORTACIONES_CONFIG_NODE.PREFIJOS_SERIES_IMPORTACION)
      ? IMPORTACIONES_CONFIG_NODE.PREFIJOS_SERIES_IMPORTACION
      : (typeof PREFIJOS_SERIES_IMPORTACION !== 'undefined' ? PREFIJOS_SERIES_IMPORTACION : undefined);
    const prefijos = (tipo === 'RECEPCIONES' && prefijosBase && prefijosBase.prefijosRecepciones)
      ? Object.assign({}, prefijosBase, { prefijosEntrada: prefijosBase.prefijosRecepciones })
      : prefijosBase;

    let excluidos = this.clientesExcluidos;
    if (excluidos === null || excluidos === undefined) {
      const leerFn = (IMPORTACIONES_EXCLUSIONES_NODE && typeof IMPORTACIONES_EXCLUSIONES_NODE.leerClientesExcluidos_ === 'function')
        ? IMPORTACIONES_EXCLUSIONES_NODE.leerClientesExcluidos_
        : (typeof leerClientesExcluidos_ === 'function' ? leerClientesExcluidos_ : null);
      excluidos = leerFn ? leerFn(this.repo) : [];
    }

    const clasificadas = clasificarFn(
      lineas,
      prefijos,
      (articulo, envase) => this.catalogoService.esCombinacionSeguida(articulo, envase),
      excluidos
    );
    if (tipo !== 'RECEPCIONES') return clasificadas;

    const articulosConVenta = this._articulosConVenta_();
    return clasificadas.map(linea => {
      const conError = linea.errorDatos
        ? Object.assign({}, linea, { estado: 'ERROR_DATOS', mensaje: linea.errorDatos })
        : linea;
      if (conError.estado !== 'OK') return conError;
      const articulo = this._normalizar_(conError.articulo);
      if (articulosConVenta.has(articulo)) return conError;
      const avisos = Array.isArray(conError.avisos) ? conError.avisos.slice() : [];
      if (!avisos.includes('SIN_PAREJA_EN_VENTAS')) avisos.push('SIN_PAREJA_EN_VENTAS');
      const conAviso = Object.assign({}, conError, { avisos });
      if (avisos.length === 1) conAviso.aviso = avisos[0];
      return conAviso;
    });
  }

  _agrupar_(lineasClasificadas) {
    const agruparFn = (IMPORTACIONES_CLASIFICADOR_NODE && typeof IMPORTACIONES_CLASIFICADOR_NODE.agruparEnDocumentos === 'function')
      ? IMPORTACIONES_CLASIFICADOR_NODE.agruparEnDocumentos
      : (typeof agruparEnDocumentos === 'function' ? agruparEnDocumentos : null);
    if (!agruparFn) throw new Error('agruparEnDocumentos no está disponible');
    return agruparFn(lineasClasificadas);
  }

  _resumen_(lineasClasificadas, documentos) {
    const resumenFn = (IMPORTACIONES_CLASIFICADOR_NODE && typeof IMPORTACIONES_CLASIFICADOR_NODE.resumenImportacion === 'function')
      ? IMPORTACIONES_CLASIFICADOR_NODE.resumenImportacion
      : (typeof resumenImportacion === 'function' ? resumenImportacion : null);
    if (!resumenFn) throw new Error('resumenImportacion no está disponible');
    return resumenFn(lineasClasificadas, documentos);
  }

  _nuevoId_(prefijo) {
    const fn = typeof nuevoId === 'function'
      ? nuevoId
      : (typeof global !== 'undefined' && typeof global.nuevoId === 'function' ? global.nuevoId : null);
    if (!fn) throw new Error('nuevoId no está disponible en ImportacionService');
    return fn(prefijo);
  }

  _claveDocumento_(tipoDoc, serie, numero) {
    const tipo = String(tipoDoc || '').trim().toUpperCase();
    const grupo = (tipo === 'ENTRADA' || tipo === 'COMPRA') ? 'E' : 'S';
    return JSON.stringify([grupo, String(serie || '').trim(), String(numero || '').trim()]);
  }

  _claveDocumentoExistente_(doc) {
    return this._claveDocumento_(
      doc && doc.tipo_documento,
      doc && doc.serie,
      doc && doc.numero
    );
  }

  /**
   * Firma de las líneas tal como vienen en el CSV (D-010, T-007):
   * línea, artículo y envase normalizados y cajas, ordenadas. No depende de la clasificación.
   * @param {Array<Object>} lineas
   * @returns {string}
   * @private
   */
  _firmaDocumento_(lineas) {
    const filas = (Array.isArray(lineas) ? lineas : []).map(linea => {
      const cajas = (linea.cajas === null || linea.cajas === undefined || linea.cajas === '')
        ? ''
        : Number(linea.cajas);
      return [
        linea.linea === null || linea.linea === undefined ? '' : String(linea.linea).trim(),
        this._normalizar_(linea.articulo),
        this._normalizar_(linea.envase),
        cajas
      ];
    });
    filas.sort((a, b) => {
      const numeroA = Number(a[0]);
      const numeroB = Number(b[0]);
      const esNumeroA = a[0] !== '' && Number.isFinite(numeroA);
      const esNumeroB = b[0] !== '' && Number.isFinite(numeroB);
      if (esNumeroA && esNumeroB && numeroA !== numeroB) return numeroA - numeroB;
      const textoA = JSON.stringify(a);
      const textoB = JSON.stringify(b);
      if (textoA === textoB) return 0;
      return textoA < textoB ? -1 : 1;
    });
    return this._hash_(JSON.stringify(filas));
  }

  /**
   * Parsea, clasifica y agrupa el CSV, y deja cada documento con su firma y sus líneas completas.
   * @param {string} textoCsv
   * @returns {Object}
   * @private
   */
  _preparar_(textoCsv) {
    const parseado = this._parsear_(textoCsv);
    const fuenteEntradas = this._fuenteEntradas_();
    if (parseado.tipo === 'COMPRAS' && fuenteEntradas === 'RECEPCIONES') {
      throw new Error('Las entradas se importan con el informe de recepciones');
    }
    if (parseado.tipo === 'RECEPCIONES' && fuenteEntradas === 'COMPRAS') {
      throw new Error('Las entradas se importan con el informe de compras');
    }
    if (parseado.tipo === 'RECEPCIONES') this._normalizarArticulosRecepcion_(parseado.lineas);
    const clasificadas = this._clasificar_(parseado.lineas, parseado.tipo);
    const documentos = this._agrupar_(clasificadas);

    const lineasPorClave = new Map();
    for (const linea of clasificadas) {
      const clave = JSON.stringify([linea.tipoDoc || null, linea.serie || null, linea.numero || null]);
      if (!lineasPorClave.has(clave)) lineasPorClave.set(clave, []);
      lineasPorClave.get(clave).push(linea);
    }

    documentos.forEach(documento => {
      documento.clave = this._claveDocumento_(documento.tipoDoc, documento.serie, documento.numero);
      documento.lineasTodas = lineasPorClave.get(JSON.stringify([
        documento.tipoDoc || null,
        documento.serie || null,
        documento.numero || null
      ])) || [];
      documento.firma = this._firmaDocumento_(documento.lineasTodas);
      documento.totalLineas = documento.lineasTodas.length;
      const primeraConEntidad = documento.lineasTodas.find(linea => linea.entidad);
      documento.entidad = primeraConEntidad ? primeraConEntidad.entidad : null;
      if (!documento.fecha && documento.lineasTodas.length > 0) {
        documento.fecha = documento.lineasTodas[0].fecha || null;
      }
    });

    return {
      tipo: parseado.tipo,
      parseado,
      clasificadas,
      documentos,
      resumen: this._resumen_(clasificadas, documentos)
    };
  }

  _documentos_() {
    return (this.repo && typeof this.repo.getDocumentos === 'function') ? this.repo.getDocumentos() : [];
  }

  _importaciones_() {
    return (this.repo && typeof this.repo.getImportaciones === 'function') ? this.repo.getImportaciones() : [];
  }

  _buscarDocumento_(documentos, documento) {
    const clave = documento.clave || this._claveDocumento_(documento.tipoDoc, documento.serie, documento.numero);
    return documentos.find(doc => this._claveDocumentoExistente_(doc) === clave) || null;
  }

  _estadoDocumento_(documento, documentos) {
    const existente = this._buscarDocumento_(documentos, documento);
    if (!existente) return { estado: 'NUEVO', existente: null };
    const firmaExistente = String(existente.firma_lineas || '').trim();
    if (!firmaExistente) {
      return { estado: 'YA_IMPORTADO', existente };
    }
    if (firmaExistente === documento.firma) {
      const entidadExistente = this._normalizar_(existente.entidad_nombre);
      const entidadNueva = this._normalizar_(documento.entidad);
      if (entidadNueva && entidadExistente !== entidadNueva) {
        return { estado: 'MODIFICADO_EN_ERP', existente };
      }
      return { estado: 'YA_IMPORTADO', existente };
    }
    return { estado: 'MODIFICADO_EN_ERP', existente };
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

  _movimientoSimulado_(linea, documento, secuencia) {
    const esEntrada = documento.tipoDoc === 'ENTRADA';
    const kg = (linea.kg !== undefined && linea.kg !== null && linea.kg !== '') ? Number(linea.kg) : '';
    return {
      id_movimiento: `SIM-MOV-${secuencia}`,
      fecha_hora: '',
      tipo_movimiento: esEntrada ? 'ENTRADA' : 'SALIDA',
      id_documento_ref: 'SIM-DOC',
      documento_ref: `${documento.serie || ''}/${documento.numero || ''}`,
      codigo_articulo: linea.articulo,
      codigo_envase: linea.envase,
      cajas: Number(linea.cajas),
      signo: esEntrada ? 1 : -1,
      partida_origen: linea.partida || '',
      motivo_ajuste: '',
      usuario: 'SIMULACION',
      observaciones: '',
      estado: 'CONFIRMADO',
      fecha_negocio: linea.fecha,
      entidad_nombre: String(linea.entidad || '').trim(),
      secuencia: '',
      origen_dato: 'CSV',
      kg_informativo: kg,
      id_movimiento_ref: '',
      id_capa_objetivo: '',
      id_capa_creada: esEntrada ? `SIM-CAPA-${secuencia}` : ''
    };
  }

  /**
   * Construye las líneas que se guardan en VERSIONES_DOCUMENTO, con el estado
   * real de clasificación. Nunca marca como OK una línea sin clasificar.
   * @param {Object} documento
   * @param {string} tipoDoc
   * @param {string} serie
   * @param {string} numero
   * @returns {Array<Object>}
   * @private
   */
  _lineasVersionDocumento_(documento, tipoDoc, serie, numero) {
    const lineas = (documento && Array.isArray(documento.lineasTodas)) ? documento.lineasTodas : [];
    return lineas.map(linea => {
      const estado = linea.estado || 'ERROR_DATOS';
      return {
        tipoDoc: linea.tipoDoc || tipoDoc,
        serie: linea.serie !== undefined ? linea.serie : serie,
        numero: linea.numero !== undefined ? linea.numero : numero,
        linea: linea.linea === undefined ? '' : linea.linea,
        fecha: linea.fecha || (documento && documento.fecha) || '',
        entidad: linea.entidad || '',
        articulo: linea.articulo || '',
        envase: linea.envase || '',
        cajas: linea.cajas === undefined ? '' : linea.cajas,
        kg: linea.kg === undefined ? '' : linea.kg,
        partida: linea.partida || '',
        estado,
        seguimiento: estado,
        origenDato: linea.origenDato || 'CSV'
      };
    });
  }

  /**
   * Guarda la versión nueva de un documento MODIFICADO_EN_ERP y mantiene una sola
   * fila PENDIENTES por documento (T-027 regla 1).
   * @param {Array<Object>} items
   * @param {Object} importacion
   * @param {string} usuario
   * @private
   */
  _registrarVersionesModificadas_(items, importacion, usuario) {
    const repo = this.repo;
    if (!repo) return;

    const pendientes = typeof repo.getPendientes === 'function' ? repo.getPendientes() : [];
    const versiones = typeof repo.getVersionesDocumento === 'function' ? repo.getVersionesDocumento() : [];
    const ahoraIso = new Date().toISOString();

    for (const item of items) {
      const doc = item.documento;
      const existente = item.existente || {};
      const tipoDoc = doc.tipoDoc === 'ENTRADA' ? 'ENTRADA' : 'SALIDA';
      const serie = String(doc.serie || '').trim();
      const numero = String(doc.numero || '').trim();
      const clave = this._claveDocumento_(tipoDoc, serie, numero);

      let pendiente = pendientes.find(p =>
        String(p.motivo || '').trim().toUpperCase() === 'MODIFICADO_EN_ERP' &&
        String(p.estado || '').trim().toUpperCase() === 'PENDIENTE' &&
        this._claveDocumento_(p.tipo_doc, p.serie, p.numero) === clave
      );
      if (!pendiente) {
        const candidatos = pendientes
          .filter(p =>
            String(p.motivo || '').trim().toUpperCase() === 'MODIFICADO_EN_ERP' &&
            this._claveDocumento_(p.tipo_doc, p.serie, p.numero) === clave
          )
          .sort((a, b) => String(b.fecha_alta || '').localeCompare(String(a.fecha_alta || '')));
        pendiente = candidatos[0] || null;
      }

      const lineasBase = Array.isArray(doc.lineasOk) ? doc.lineasOk : [];
      const cajasNuevo = lineasBase.reduce((acc, linea) => acc + Math.abs(Number(linea.cajas) || 0), 0);
      const cajasImportado = Number(existente.total_cajas || 0);
      const diferencia = cajasNuevo - cajasImportado;

      const estadoAnteriorPendiente = pendiente ? String(pendiente.estado || '').toUpperCase() : '';

      if (!pendiente) {
        pendiente = {
          id_pendiente: this._nuevoId_('PEND'),
          id_importacion: importacion.id_importacion,
          tipo_doc: tipoDoc,
          serie,
          numero,
          linea: '',
          fecha_negocio: doc.fecha || '',
          entidad: String(doc.entidad || '').trim(),
          articulo: '',
          envase: '',
          cajas: diferencia,
          kg: '',
          motivo: 'MODIFICADO_EN_ERP',
          estado: 'PENDIENTE',
          fecha_alta: ahoraIso,
          fecha_resolucion: ''
        };
        pendientes.push(pendiente);
      } else {
        pendiente.id_importacion = importacion.id_importacion;
        pendiente.fecha_negocio = doc.fecha || pendiente.fecha_negocio || '';
        pendiente.entidad = String(doc.entidad || pendiente.entidad || '').trim();
        // T-008 fija la diferencia de la primera reimportación mientras la fila
        // siga PENDIENTE; una nueva versión no debe alterar ese dato ya mostrado.
        if (estadoAnteriorPendiente !== 'PENDIENTE') pendiente.cajas = diferencia;
        pendiente.estado = 'PENDIENTE';
        pendiente.fecha_alta = ahoraIso;
        pendiente.fecha_resolucion = '';
      }

      const lineasVersion = this._lineasVersionDocumento_(doc, tipoDoc, serie, numero);

      const lineasJson = JSON.stringify(lineasVersion);
      const versionesDeEstePendiente = versiones.filter(v =>
        String(v.id_pendiente || '') === String(pendiente.id_pendiente || '') &&
        String(v.estado || '').trim().toUpperCase() === 'PENDIENTE'
      );
      const mismaVersion = versionesDeEstePendiente.find(v =>
        String(v.firma_lineas || '').trim() === String(doc.firma || '').trim() &&
        String(v.lineas_json || '') === lineasJson
      );

      for (const version of versionesDeEstePendiente) {
        if (version !== mismaVersion) {
          version.estado = 'DESCARTADA';
          version.fecha_resolucion = ahoraIso;
        }
      }

      if (mismaVersion) {
        mismaVersion.lineas_json = lineasJson;
        mismaVersion.fecha_alta = ahoraIso;
        mismaVersion.usuario = usuario || 'SISTEMA';
        mismaVersion.motivo = 'MODIFICADO_EN_ERP';
      } else {
        versiones.push({
          id_version: this._nuevoId_('VER'),
          id_pendiente: pendiente.id_pendiente,
          id_documento: existente.id_documento || '',
          firma_lineas: doc.firma || '',
          lineas_json: lineasJson,
          fecha_alta: ahoraIso,
          estado: 'PENDIENTE',
          fecha_resolucion: '',
          usuario: usuario || 'SISTEMA',
          motivo: 'MODIFICADO_EN_ERP'
        });
      }
    }

    if (typeof repo.savePendientes === 'function') {
      repo.savePendientes(pendientes);
    } else if (typeof repo.appendPendientes === 'function') {
      repo.appendPendientes(pendientes);
    }
    if (typeof repo.saveVersionesDocumento === 'function') {
      repo.saveVersionesDocumento(versiones);
    } else if (typeof repo.appendVersionesDocumento === 'function') {
      repo.appendVersionesDocumento(versiones);
    }
  }

  _resultadoDocumento_(documento, estado, existente) {
    const lineas = Array.isArray(documento.lineasTodas) ? documento.lineasTodas : [];
    const avisos = [];
    for (const linea of lineas) {
      for (const tipo of (Array.isArray(linea.avisos) ? linea.avisos : [])) {
        avisos.push({
          tipo,
          serie: documento.serie,
          numero: documento.numero,
          linea: linea.linea,
          articulo: linea.articulo
        });
      }
    }
    return {
      clave: documento.clave,
      tipoDoc: documento.tipoDoc,
      serie: documento.serie,
      numero: documento.numero,
      fecha: documento.fecha || null,
      estado,
      idDocumento: existente ? (existente.id_documento || '') : '',
      totalLineas: documento.totalLineas || 0,
      resumen: documento.resumen,
      lineas,
      avisos
    };
  }

  /**
   * Previsualiza la importación completa sin escribir en ninguna hoja.
   * @param {string} textoCsv
   * @returns {Object}
   */
  previsualizar(textoCsv) {
    const preparado = this._preparar_(textoCsv);
    const hash = this._hash_(textoCsv);
    const documentosExistentes = this._documentos_();
    let estado = this.movementService._cargarEstado().estado;
    let secuencia = 0;

    const resultados = preparado.documentos.map(documento => {
      const clasificacion = this._estadoDocumento_(documento, documentosExistentes);
      let estadoDocumento = clasificacion.estado;

      if (!clasificacion.existente) {
        if (documento.lineasOk.length === 0 && documento.lineasPendiente.length === 0) {
          estadoDocumento = 'SIN_LINEAS_APLICABLES';
        } else if (documento.lineasOk.length === 0) {
          estadoDocumento = 'NUEVO';
        } else {
          const estadoAntes = this._clonarEstado_(estado);
          let faltaStock = false;
          for (const linea of documento.lineasOk) {
            const movimiento = this._movimientoSimulado_(linea, documento, ++secuencia);
            const res = this.movementService._aplicar(estado, movimiento);
            if (!res.ok) {
              if (res.errorCode === 'STOCK_INSUFICIENTE') {
                faltaStock = true;
                break;
              }
              throw new Error(`Error inesperado al simular la línea ${linea.linea} de ${documento.serie}/${documento.numero}: ${res.error}`);
            }
            estado = res.estado;
          }
          if (faltaStock) {
            estado = estadoAntes;
            estadoDocumento = 'STOCK_INSUFICIENTE';
          } else {
            estadoDocumento = 'NUEVO';
          }
        }
      }

      return this._resultadoDocumento_(documento, estadoDocumento, clasificacion.existente);
    });

    const totales = {
      documentos: resultados.length,
      nuevos: resultados.filter(doc => doc.estado === 'NUEVO').length,
      yaImportados: resultados.filter(doc => doc.estado === 'YA_IMPORTADO').length,
      modificados: resultados.filter(doc => doc.estado === 'MODIFICADO_EN_ERP').length,
      sinLineas: resultados.filter(doc => doc.estado === 'SIN_LINEAS_APLICABLES').length,
      stockInsuficiente: resultados.filter(doc => doc.estado === 'STOCK_INSUFICIENTE').length
    };
    const avisos = resultados.reduce((lista, doc) => lista.concat(doc.avisos || []), []);

    return {
      hash,
      tipoCsv: preparado.tipo,
      resumen: preparado.resumen,
      lineasClienteExcluido: Number(preparado.resumen.porEstado.CLIENTE_EXCLUIDO || 0),
      documentos: resultados,
      totales,
      avisos,
      stockSimulado: { ...estado.stock }
    };
  }

  /**
   * Confirma la importación. El servidor reparsea el archivo, comprueba el hash y aplica por tramos.
   * @param {string} textoCsv
   * @param {string} hashEsperado
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  confirmar(textoCsv, hashEsperado, usuario = 'SISTEMA') {
    const hash = this._hash_(textoCsv);
    const hashRecibido = (hashEsperado === null || hashEsperado === undefined) ? '' : String(hashEsperado).trim();
    if (hashRecibido !== '' && hashRecibido.toLowerCase() !== hash) {
      return {
        success: false,
        status: 'HASH_NO_COINCIDE',
        hashCalculado: hash,
        hashEsperado: hashRecibido
      };
    }

    const preparado = this._preparar_(textoCsv);
    const importaciones = this._importaciones_();
    const importacionExistente = importaciones.find(fila =>
      String(fila.hash || '').trim().toLowerCase() === hash
    );
    if (importacionExistente && String(importacionExistente.estado || '').trim().toUpperCase() === 'CONFIRMADA') {
      return {
        success: true,
        status: 'YA_IMPORTADO',
        yaImportado: true,
        hash,
        idImportacion: importacionExistente.id_importacion || '',
        importacion: importacionExistente
      };
    }

    const documentosExistentes = this._documentos_();
    const clasificados = preparado.documentos.map(documento => ({
      documento,
      ...this._estadoDocumento_(documento, documentosExistentes)
    }));
    const aplicables = clasificados
      .filter(item => !item.existente && (item.documento.lineasOk.length > 0 || item.documento.lineasPendiente.length > 0))
      .map(item => item.documento);
    const soloExcluidos = clasificados
      .filter(item => {
        if (item.existente || !item.documento.resumen || !item.documento.resumen.porEstado) return false;
        if (item.documento.lineasOk.length > 0 || item.documento.lineasPendiente.length > 0) return false;
        const excluidas = Number(item.documento.resumen.porEstado.CLIENTE_EXCLUIDO || 0);
        const total = Number(item.documento.resumen.totalLineas || 0);
        return excluidas > 0 && excluidas === total;
      })
      .map(item => item.documento);
    const saltados = clasificados.filter(item => item.estado === 'YA_IMPORTADO').length;
    const modificados = clasificados.filter(item => item.estado === 'MODIFICADO_EN_ERP').length;

    const esReanudacion = Boolean(
      importacionExistente &&
      String(importacionExistente.estado || '').trim().toUpperCase() === 'EN_CURSO'
    );

    const importacion = importacionExistente || {
      id_importacion: this._nuevoId_('IMP'),
      fecha_hora: new Date().toISOString(),
      usuario: usuario || 'SISTEMA',
      tipo_csv: preparado.tipo,
      hash,
      documentos_nuevos: 0,
      documentos_saltados: 0,
      documentos_modificados: 0,
      documentos_pendientes: 0,
      lineas_ok: 0,
      lineas_no_seguidas: 0,
      lineas_abono: 0,
      lineas_series_ignoradas: 0,
      lineas_pendientes: 0,
      lineas_cliente_excluido: 0,
      lineas_error: 0,
      estado: 'EN_CURSO',
      ultimo_tramo: 0
    };

    importacion.usuario = usuario || 'SISTEMA';
    importacion.tipo_csv = preparado.tipo;
    const porEstado = preparado.resumen.porEstado || {};
    importacion.lineas_ok = Number(porEstado.OK || 0);
    importacion.lineas_no_seguidas = Number(porEstado.NO_SEGUIDA || 0);
    importacion.lineas_abono = Number(porEstado.ABONO || 0);
    importacion.lineas_series_ignoradas = Number(porEstado.SERIE_IGNORADA || 0);
    importacion.lineas_pendientes = Number(porEstado.PENDIENTE || 0);
    importacion.lineas_cliente_excluido = Number(porEstado.CLIENTE_EXCLUIDO || 0);
    importacion.lineas_error = Number(porEstado.ERROR_DATOS || 0);

    if (!esReanudacion) {
      importacion.documentos_saltados = saltados;
      importacion.documentos_modificados = modificados;
    }

    let listaImportaciones = importaciones.slice();
    if (listaImportaciones.some(fila => String(fila.id_importacion || '') === String(importacion.id_importacion || ''))) {
      listaImportaciones = listaImportaciones.map(fila =>
        String(fila.id_importacion || '') === String(importacion.id_importacion || '') ? importacion : fila
      );
    } else {
      listaImportaciones.push(importacion);
    }

    const resultadosPorClave = new Map();
    const opciones = {
      hash,
      idImportacion: importacion.id_importacion,
      documentosExistentes,
      importaciones: listaImportaciones,
      importacion
    };

    if (aplicables.length === 0) {
      importacion.estado = 'CONFIRMADA';
      const res = this.movementService.aplicarDocumentosEnLote([], usuario, opciones);
      (res.documentos || []).forEach(doc => resultadosPorClave.set(doc.clave, doc));
    } else {
      let tramo = Number(importacion.ultimo_tramo || 0);
      for (let i = 0; i < aplicables.length; i += this.umbralTramos) {
        const lote = aplicables.slice(i, i + this.umbralTramos);
        const esUltimo = (i + this.umbralTramos) >= aplicables.length;
        tramo++;
        importacion.estado = esUltimo ? 'CONFIRMADA' : 'EN_CURSO';
        importacion.ultimo_tramo = tramo;

        const res = this.movementService.aplicarDocumentosEnLote(lote, usuario, opciones);
        (res.documentos || []).forEach(doc => resultadosPorClave.set(doc.clave, doc));
      }
    }

    const resultadosExcluidos = new Map();
    if (soloExcluidos.length > 0) {
      const ahora = new Date().toISOString();
      const registros = soloExcluidos.map((documento) => {
        const idDocumento = this._nuevoId_('DOC');
        const tipoDoc = documento.tipoDoc === 'ENTRADA' ? 'ENTRADA' : 'SALIDA';
        resultadosExcluidos.set(documento.clave, {
          clave: documento.clave,
          tipoDoc,
          serie: documento.serie,
          numero: documento.numero,
          fecha: documento.fecha || null,
          estado: 'CLIENTE_EXCLUIDO',
          estadoProceso: 'CONFIRMADO',
          idDocumento
        });
        return {
          id_documento: idDocumento,
          sha256_hash: hash,
          tipo_documento: tipoDoc === 'ENTRADA' ? 'COMPRA' : 'SALIDA',
          serie: String(documento.serie || '').trim(),
          numero: String(documento.numero || '').trim(),
          fecha_documento: documento.fecha || '',
          entidad_nombre: String(documento.entidad || '').trim(),
          total_lineas: Number(documento.totalLineas || 0),
          total_cajas: 0,
          drive_file_id: '',
          drive_url: '',
          estado_proceso: 'CONFIRMADO',
          fecha_subida: ahora,
          usuario_subida: usuario || 'SISTEMA',
          firma_lineas: documento.firma || ''
        };
      });

      if (typeof this.repo.appendRecords === 'function') {
        this.repo.appendRecords('DOCUMENTOS', registros);
      } else if (typeof this.repo.appendDocumento === 'function') {
        for (const registro of registros) this.repo.appendDocumento(registro);
      }
      importacion.documentos_nuevos = Number(importacion.documentos_nuevos || 0) + registros.length;
      if (typeof this.repo.saveImportaciones === 'function') {
        this.repo.saveImportaciones(listaImportaciones);
      }

      // T-031 × T-027: un documento totalmente excluido guarda también su versión
      // de partida. No tiene movimientos, pero permite corregirlo después.
      if (typeof this.repo.getVersionesDocumento === 'function') {
        const versionesBase = soloExcluidos.map((documento, indice) => {
          const tipoDoc = documento.tipoDoc === 'ENTRADA' ? 'ENTRADA' : 'SALIDA';
          return {
            id_version: this._nuevoId_('VER'),
            id_pendiente: '',
            id_documento: registros[indice].id_documento,
            firma_lineas: documento.firma || '',
            lineas_json: JSON.stringify(this._lineasVersionDocumento_(
              documento,
              tipoDoc,
              documento.serie,
              documento.numero
            )),
            fecha_alta: ahora,
            estado: 'BASE',
            fecha_resolucion: '',
            usuario: usuario || 'SISTEMA',
            motivo: 'VERSION_INICIAL'
          };
        });
        const versiones = this.repo.getVersionesDocumento() || [];
        if (typeof this.repo.saveVersionesDocumento === 'function') {
          this.repo.saveVersionesDocumento(versiones.concat(versionesBase));
        } else if (typeof this.repo.appendVersionesDocumento === 'function') {
          this.repo.appendVersionesDocumento(versionesBase);
        }
      }
    }

    const documentosResultado = clasificados.map(item => {
      if (item.estado !== 'NUEVO') {
        return this._resultadoDocumento_(item.documento, item.estado, item.existente);
      }
      const resultado = resultadosPorClave.get(item.documento.clave) || resultadosExcluidos.get(item.documento.clave);
      return resultado || this._resultadoDocumento_(item.documento, 'SIN_LINEAS_APLICABLES', null);
    });

    // Regla 4 (T-008) y Regla 1 (T-027): una sola fila MODIFICADO_EN_ERP y una
    // versión PENDIENTE por documento; las versiones anteriores se descartan.
    const modificadosItems = clasificados.filter(item => item.estado === 'MODIFICADO_EN_ERP');
    if (modificadosItems.length > 0) {
      this._registrarVersionesModificadas_(modificadosItems, importacion, usuario);
    }

    // Regla 3 (T-008): reintento automático cuando se haya creado al menos una capa
    const seCreoCapa = Array.from(resultadosPorClave.values()).some(doc =>
      doc &&
      doc.tipoDoc === 'ENTRADA' &&
      doc.estado === 'NUEVO' &&
      (doc.estadoProceso === 'CONFIRMADO' || doc.estadoProceso === 'CONFIRMADO_PARCIAL')
    );

    let reintentoPendientes = null;
    const avisos = [];
    let avisoReintento = '';
    if (seCreoCapa) {
      try {
        const pendientesSvc = this._resolverPendientesService_();
        if (pendientesSvc && typeof pendientesSvc.reintentarPendientes === 'function') {
          reintentoPendientes = pendientesSvc.reintentarPendientes(usuario);
        }
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        avisoReintento = `Importación confirmada, pero falló el reintento automático de pendientes: ${msg}`;
        avisos.push(avisoReintento);
        try {
          if (this.repo && typeof this.repo.appendLogOperacion === 'function') {
            this.repo.appendLogOperacion({
              id_log: this._nuevoId_('LOG'),
              usuario: usuario || 'SISTEMA',
              operacion: 'REINTENTO_PENDIENTES_IMPORTACION',
              referencia: importacion.id_importacion,
              estado: 'ERROR',
              observaciones: msg
            });
          }
        } catch (logErr) {
          // Nunca fallar la importación por un error de log
        }
      }
    }

    const salida = {
      success: true,
      status: importacion.estado,
      hash,
      idImportacion: importacion.id_importacion,
      importacion,
      resumen: preparado.resumen,
      documentos: documentosResultado,
      tramos: Number(importacion.ultimo_tramo || 0),
      conteos: {
        nuevos: Number(importacion.documentos_nuevos || 0),
        saltados: Number(importacion.documentos_saltados || 0),
        modificados: Number(importacion.documentos_modificados || 0),
        pendientes: Number(importacion.documentos_pendientes || 0),
        clienteExcluido: Number(importacion.lineas_cliente_excluido || 0)
      }
    };
    if (reintentoPendientes) salida.reintentoPendientes = reintentoPendientes;
    if (avisos.length > 0) {
      salida.avisos = avisos;
      salida.avisoReintento = avisoReintento;
    }
    return salida;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ImportacionService
  };
}
