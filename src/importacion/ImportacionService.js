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

  _parsear_(texto) {
    if (IMPORTACIONES_PARSER_NODE && typeof IMPORTACIONES_PARSER_NODE.parsear === 'function') {
      return IMPORTACIONES_PARSER_NODE.parsear(texto);
    }
    if (typeof parsear === 'function') return parsear(texto);
    throw new Error('El parser CSV de Hispatec no está disponible');
  }

  _clasificar_(lineas) {
    const clasificarFn = (IMPORTACIONES_CLASIFICADOR_NODE && typeof IMPORTACIONES_CLASIFICADOR_NODE.clasificar === 'function')
      ? IMPORTACIONES_CLASIFICADOR_NODE.clasificar
      : (typeof clasificar === 'function' ? clasificar : null);
    if (!clasificarFn) throw new Error('El clasificador de líneas no está disponible');
    const prefijos = (IMPORTACIONES_CONFIG_NODE && IMPORTACIONES_CONFIG_NODE.PREFIJOS_SERIES_IMPORTACION)
      ? IMPORTACIONES_CONFIG_NODE.PREFIJOS_SERIES_IMPORTACION
      : (typeof PREFIJOS_SERIES_IMPORTACION !== 'undefined' ? PREFIJOS_SERIES_IMPORTACION : undefined);
    return clasificarFn(lineas, prefijos, (articulo, envase) => this.catalogoService.esCombinacionSeguida(articulo, envase));
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
    const clasificadas = this._clasificar_(parseado.lineas);
    const documentos = this._agrupar_(clasificadas);

    const lineasPorClave = new Map();
    for (const linea of parseado.lineas) {
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
    if (!firmaExistente || firmaExistente === documento.firma) {
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

  _resultadoDocumento_(documento, estado, existente) {
    return {
      clave: documento.clave,
      tipoDoc: documento.tipoDoc,
      serie: documento.serie,
      numero: documento.numero,
      fecha: documento.fecha || null,
      estado,
      idDocumento: existente ? (existente.id_documento || '') : '',
      totalLineas: documento.totalLineas || 0,
      resumen: documento.resumen
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

    return {
      hash,
      tipoCsv: preparado.tipo,
      resumen: preparado.resumen,
      documentos: resultados,
      totales,
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

    const documentosResultado = clasificados.map(item => {
      if (item.estado !== 'NUEVO') {
        return this._resultadoDocumento_(item.documento, item.estado, item.existente);
      }
      const resultado = resultadosPorClave.get(item.documento.clave);
      return resultado || this._resultadoDocumento_(item.documento, 'SIN_LINEAS_APLICABLES', null);
    });

    return {
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
        pendientes: Number(importacion.documentos_pendientes || 0)
      }
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ImportacionService
  };
}
