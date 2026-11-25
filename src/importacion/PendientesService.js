/**
 * STOCK-LIGHT — PendientesService.js
 *
 * Gestión de líneas y documentos pendientes (T-008, D-006, D-009, D-029, D-030):
 * - `reintentarPendientes(usuario, opciones)`: reintenta STOCK_INSUFICIENTE y SEGUIMIENTO_DESCONOCIDO
 *   en orden D-007, dentro de un único lock y persistencia en lote.
 * - `listarPendientes(filtros)`: lista agrupada por motivo y por documento.
 * - `marcarPendienteResuelto(idPendiente, nota, usuario)`: marca un pendiente como RESUELTA
 *   (usado para MODIFICADO_EN_ERP) sin tocar stock, registrando la nota en LOG_OPERACIONES.
 *
 * Regla de consumo tardío (T-008): un pendiente que se aplica tarde consume FIFO sobre las capas
 * tal como están en ese momento; nunca se rehacen consumos de salidas posteriores.
 */

const PENDIENTES_LIBRO_NODE = typeof module !== 'undefined' && module.exports
  ? require('../Libro')
  : null;

class PendientesService {
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
      : (typeof require !== 'undefined' ? require('../Repository').SheetsRepository : null);
    if (!RepoClass && !options.repository) {
      throw new Error('SheetsRepository no está disponible en PendientesService');
    }
    this.repo = options.repository || new RepoClass();

    const MovementClass = (typeof MovementService !== 'undefined')
      ? MovementService
      : (typeof require !== 'undefined' ? require('../MovementService').MovementService : null);
    this.movementService = options.movementService || (MovementClass
      ? new MovementClass({ repository: this.repo, lockService: options.lockService })
      : null);
    if (!this.movementService) {
      throw new Error('MovementService no está disponible en PendientesService');
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
  }

  _nuevoId_(prefijo) {
    if (this.movementService && typeof this.movementService._nuevoId === 'function') {
      return this.movementService._nuevoId(prefijo);
    }
    const fn = typeof nuevoId === 'function'
      ? nuevoId
      : (typeof global !== 'undefined' && typeof global.nuevoId === 'function' ? global.nuevoId : null);
    if (!fn) throw new Error('nuevoId no está disponible en PendientesService');
    return fn(prefijo);
  }

  _clonarEstado_(estado) {
    const clonarFn = (this.movementService && this.movementService.libro && typeof this.movementService.libro.clonarEstadoLibro === 'function')
      ? this.movementService.libro.clonarEstadoLibro
      : (PENDIENTES_LIBRO_NODE && typeof PENDIENTES_LIBRO_NODE.clonarEstadoLibro === 'function'
        ? PENDIENTES_LIBRO_NODE.clonarEstadoLibro
        : (typeof clonarEstadoLibro === 'function' ? clonarEstadoLibro : null));
    if (typeof clonarFn === 'function') {
      return clonarFn(estado);
    }
    return {
      capas: Array.isArray(estado && estado.capas) ? estado.capas.map(c => ({ ...c })) : [],
      stock: estado && estado.stock ? { ...estado.stock } : {},
      consumosPorMovimiento: JSON.parse(JSON.stringify(
        estado && estado.consumosPorMovimiento ? estado.consumosPorMovimiento : {}
      ))
    };
  }

  _claveDocumento_(tipoDoc, serie, numero) {
    const tipo = String(tipoDoc || '').trim().toUpperCase();
    const grupo = (tipo === 'ENTRADA' || tipo === 'COMPRA') ? 'E' : 'S';
    return JSON.stringify([grupo, String(serie || '').trim(), String(numero || '').trim()]);
  }

  _compararTextoNumerico_(a, b) {
    const sa = String(a === null || a === undefined ? '' : a).trim();
    const sb = String(b === null || b === undefined ? '' : b).trim();
    const na = Number(sa);
    const nb = Number(sb);
    if (sa !== '' && sb !== '' && Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
      return na - nb;
    }
    if (sa === sb) return 0;
    return sa < sb ? -1 : 1;
  }

  /**
   * Orden D-007: fecha ASC; el mismo día, ENTRADA antes que SALIDA; serie ASC; numero ASC.
   * @private
   */
  _compararDocumentosD007_(a, b) {
    const fa = String(a.fecha_negocio || a.fecha || '').trim();
    const fb = String(b.fecha_negocio || b.fecha || '').trim();
    if (fa !== fb) {
      if (!fa) return 1;
      if (!fb) return -1;
      return fa < fb ? -1 : 1;
    }
    const ta = String(a.tipo_doc || a.tipoDoc || '').trim().toUpperCase() === 'ENTRADA' ? 0 : 1;
    const tb = String(b.tipo_doc || b.tipoDoc || '').trim().toUpperCase() === 'ENTRADA' ? 0 : 1;
    if (ta !== tb) return ta - tb;

    const cmpSerie = this._compararTextoNumerico_(a.serie, b.serie);
    if (cmpSerie !== 0) return cmpSerie;

    return this._compararTextoNumerico_(a.numero, b.numero);
  }

  _compararLineas_(a, b) {
    const cmpLinea = this._compararTextoNumerico_(a.linea, b.linea);
    if (cmpLinea !== 0) return cmpLinea;
    return this._compararTextoNumerico_(a.id_pendiente, b.id_pendiente);
  }

  /**
   * Reintenta todas las filas de PENDIENTES con `estado = PENDIENTE` en un único lock (T-008):
   * - `STOCK_INSUFICIENTE`: todo o nada por documento en orden D-007.
   * - `SEGUIMIENTO_DESCONOCIDO`: reevalúa `esCombinacionSeguida`; si es SEGUIDA aplica, si es NO_SEGUIDA pasa a IGNORADA.
   * - `MODIFICADO_EN_ERP`: nunca se aplica automáticamente; permanece PENDIENTE.
   *
   * @param {string} [usuario='SISTEMA']
   * @param {Object} [opciones={}]
   * @returns {Object}
   */
  reintentarPendientes(usuario = 'SISTEMA', opciones = {}) {
    const opcionesSeguras = opciones || {};
    const ahoraIso = new Date().toISOString();

    this.movementService._acquireLock(opcionesSeguras.timeoutMs || 30000);
    try {
      const todasPendientes = (this.repo && typeof this.repo.getPendientes === 'function')
        ? this.repo.getPendientes()
        : [];

      const aplicados = {
        STOCK_INSUFICIENTE: 0,
        SEGUIMIENTO_DESCONOCIDO: 0
      };
      const ignorados = {
        SEGUIMIENTO_DESCONOCIDO: 0
      };
      const contarSiguenPendientes = () => {
        const conteo = {
          STOCK_INSUFICIENTE: 0,
          SEGUIMIENTO_DESCONOCIDO: 0,
          MODIFICADO_EN_ERP: 0
        };
        for (const fila of todasPendientes) {
          if (String(fila.estado || '').trim().toUpperCase() !== 'PENDIENTE') continue;
          const m = String(fila.motivo || '').trim().toUpperCase();
          conteo[m] = (conteo[m] || 0) + 1;
        }
        const total = Object.values(conteo).reduce((acc, n) => acc + n, 0);
        return { total, ...conteo };
      };

      const pendientesActivas = todasPendientes.filter(
        fila => String(fila.estado || '').trim().toUpperCase() === 'PENDIENTE'
      );

      if (pendientesActivas.length === 0) {
        return {
          aplicados: { total: 0, ...aplicados },
          ignorados: { total: 0, ...ignorados },
          siguenPendientes: contarSiguenPendientes(),
          documentosConfirmados: 0,
          movimientosGenerados: []
        };
      }

      // Invalidar caché del catálogo para leer reglas o excepciones recién añadidas
      if (this.catalogoService && typeof this.catalogoService.invalidarCache === 'function') {
        this.catalogoService.invalidarCache();
      }

      let pendientesModificadas = false;
      const candidatosAplicar = [];
      const docsAfectados = new Set();

      for (const fila of pendientesActivas) {
        const motivo = String(fila.motivo || '').trim().toUpperCase();
        const clave = this._claveDocumento_(fila.tipo_doc, fila.serie, fila.numero);

        if (motivo === 'MODIFICADO_EN_ERP') {
          continue;
        }

        if (motivo === 'SEGUIMIENTO_DESCONOCIDO') {
          const seguimiento = (this.catalogoService && typeof this.catalogoService.esCombinacionSeguida === 'function')
            ? this.catalogoService.esCombinacionSeguida(fila.articulo, fila.envase)
            : 'PENDIENTE';

          if (seguimiento === 'NO_SEGUIDA') {
            fila.estado = 'IGNORADA';
            fila.fecha_resolucion = ahoraIso;
            ignorados.SEGUIMIENTO_DESCONOCIDO++;
            pendientesModificadas = true;
            docsAfectados.add(clave);
          } else if (seguimiento === 'SEGUIDA') {
            candidatosAplicar.push({ fila, motivo: 'SEGUIMIENTO_DESCONOCIDO', clave });
          }
          continue;
        }

        if (motivo === 'STOCK_INSUFICIENTE') {
          candidatosAplicar.push({ fila, motivo: 'STOCK_INSUFICIENTE', clave });
          continue;
        }
      }

      // Agrupar candidatos a aplicar por documento (tipo_doc + serie + numero)
      const gruposMap = new Map();
      for (const item of candidatosAplicar) {
        const { fila, motivo, clave } = item;
        if (!gruposMap.has(clave)) {
          const tipoDoc = String(fila.tipo_doc || '').trim().toUpperCase() === 'ENTRADA' ? 'ENTRADA' : 'SALIDA';
          gruposMap.set(clave, {
            clave,
            tipo_doc: tipoDoc,
            serie: String(fila.serie || '').trim(),
            numero: String(fila.numero || '').trim(),
            fecha_negocio: String(fila.fecha_negocio || '').trim(),
            entidad: String(fila.entidad || '').trim(),
            items: []
          });
        }
        const grupo = gruposMap.get(clave);
        grupo.items.push({ fila, motivo });
        const fechaFila = String(fila.fecha_negocio || '').trim();
        if (fechaFila && (!grupo.fecha_negocio || fechaFila < grupo.fecha_negocio)) {
          grupo.fecha_negocio = fechaFila;
        }
        if (!grupo.entidad && fila.entidad) {
          grupo.entidad = String(fila.entidad).trim();
        }
      }

      const gruposOrdenados = Array.from(gruposMap.values());
      gruposOrdenados.sort((a, b) => this._compararDocumentosD007_(a, b));
      for (const grupo of gruposOrdenados) {
        grupo.items.sort((a, b) => this._compararLineas_(a.fila, b.fila));
      }

      let estado = null;
      let movimientosExistentes = null;
      let documentosExistentes = null;
      const generatedMovements = [];
      const cajasNuevasPorClave = new Map();
      const aplicadasPorClave = new Set();

      if (gruposOrdenados.length > 0 || docsAfectados.size > 0) {
        documentosExistentes = (this.repo && typeof this.repo.getDocumentos === 'function')
          ? this.repo.getDocumentos()
          : [];
      }

      if (gruposOrdenados.length > 0) {
        const cargado = this.movementService._cargarEstado();
        estado = cargado.estado;
        movimientosExistentes = cargado.movimientos;

        let gruposRestantes = gruposOrdenados;
        let huboAplicados = true;

        while (huboAplicados && gruposRestantes.length > 0) {
          huboAplicados = false;
          const siguientePasada = [];

          for (const grupo of gruposRestantes) {
            const docExistente = documentosExistentes.find(
              d => this._claveDocumento_(d.tipo_documento, d.serie, d.numero) === grupo.clave
            );
            const docId = (docExistente && docExistente.id_documento)
              ? docExistente.id_documento
              : this._nuevoId_('DOC');

            const estadoAntesDoc = this._clonarEstado_(estado);
            const movsDocumento = [];
            let faltaStock = false;

            for (const { fila } of grupo.items) {
              const esEntrada = grupo.tipo_doc === 'ENTRADA';
              const kgLinea = (fila.kg !== undefined && fila.kg !== null && fila.kg !== '')
                ? Number(fila.kg)
                : '';
              const mov = {
                id_movimiento: this._nuevoId_('MOV'),
                fecha_hora: ahoraIso,
                tipo_movimiento: grupo.tipo_doc,
                id_documento_ref: docId,
                documento_ref: `${grupo.serie}/${grupo.numero}`,
                codigo_articulo: fila.articulo,
                codigo_envase: fila.envase,
                cajas: Number(fila.cajas),
                signo: esEntrada ? 1 : -1,
                partida_origen: '',
                motivo_ajuste: '',
                usuario: usuario || 'SISTEMA',
                observaciones: '',
                estado: 'CONFIRMADO',
                fecha_negocio: fila.fecha_negocio || grupo.fecha_negocio || '',
                entidad_nombre: String(fila.entidad || grupo.entidad || '').trim(),
                secuencia: '',
                origen_dato: 'CSV',
                kg_informativo: kgLinea,
                id_movimiento_ref: '',
                id_capa_objetivo: '',
                id_capa_creada: esEntrada ? this._nuevoId_('CAPA') : ''
              };

              const res = this.movementService._aplicar(estado, mov);
              if (!res.ok) {
                if (res.errorCode === 'STOCK_INSUFICIENTE') {
                  faltaStock = true;
                  break;
                }
                throw new Error(
                  `Error inesperado al reintentar la línea ${fila.linea} de ${grupo.serie}/${grupo.numero}: ${res.error}`
                );
              }
              estado = res.estado;
              movsDocumento.push(mov);
            }

            if (faltaStock) {
              // Todo o nada por documento: restaurar estado y reintentar si algún documento posterior libera stock
              estado = estadoAntesDoc;
              siguientePasada.push(grupo);
              continue;
            }

            huboAplicados = true;
            for (const mov of movsDocumento) {
              generatedMovements.push(mov);
            }
            for (const { fila, motivo } of grupo.items) {
              fila.estado = 'APLICADA';
              fila.fecha_resolucion = ahoraIso;
              aplicados[motivo] = (aplicados[motivo] || 0) + 1;
              if (motivo === 'SEGUIMIENTO_DESCONOCIDO') {
                cajasNuevasPorClave.set(
                  grupo.clave,
                  (cajasNuevasPorClave.get(grupo.clave) || 0) + Math.abs(Number(fila.cajas) || 0)
                );
              }
            }
            pendientesModificadas = true;
            docsAfectados.add(grupo.clave);
            aplicadasPorClave.add(grupo.clave);
          }

          gruposRestantes = siguientePasada;
        }

        // Si una fila SEGUIMIENTO_DESCONOCIDO ya es SEGUIDA pero su documento no entra por stock,
        // su motivo pasa a STOCK_INSUFICIENTE (sigue PENDIENTE)
        for (const grupo of gruposRestantes) {
          for (const { fila } of grupo.items) {
            if (String(fila.motivo || '').trim().toUpperCase() === 'SEGUIMIENTO_DESCONOCIDO') {
              fila.motivo = 'STOCK_INSUFICIENTE';
              pendientesModificadas = true;
            }
          }
        }
      }

      // Actualizar estado_proceso en DOCUMENTOS para documentos afectados
      let documentosModificados = false;
      let documentosConfirmados = 0;

      if (docsAfectados.size > 0 && Array.isArray(documentosExistentes)) {
        for (const clave of docsAfectados) {
          const doc = documentosExistentes.find(
            d => this._claveDocumento_(d.tipo_documento, d.serie, d.numero) === clave
          );
          if (!doc) continue;

          const estadoActualDoc = String(doc.estado_proceso || '').trim().toUpperCase();
          if (estadoActualDoc !== 'PENDIENTE_REVISION' && estadoActualDoc !== 'CONFIRMADO_PARCIAL') {
            continue;
          }

          const quedanLineasPendientes = todasPendientes.some(fila =>
            String(fila.estado || '').trim().toUpperCase() === 'PENDIENTE' &&
            String(fila.motivo || '').trim().toUpperCase() !== 'MODIFICADO_EN_ERP' &&
            this._claveDocumento_(fila.tipo_doc, fila.serie, fila.numero) === clave
          );

          const cajasNuevas = cajasNuevasPorClave.get(clave) || 0;
          if (cajasNuevas > 0) {
            doc.total_cajas = Number(doc.total_cajas || 0) + cajasNuevas;
            documentosModificados = true;
          }

          if (!quedanLineasPendientes) {
            doc.estado_proceso = 'CONFIRMADO';
            documentosModificados = true;
            documentosConfirmados++;
          } else if (estadoActualDoc === 'PENDIENTE_REVISION' && aplicadasPorClave.has(clave)) {
            doc.estado_proceso = 'CONFIRMADO_PARCIAL';
            documentosModificados = true;
          }
        }
      }

      // Persistencia en lote dentro del mismo lock (orden canónico de _persistir)
      if (generatedMovements.length > 0 || documentosModificados) {
        this.movementService._persistir({
          movimientos: generatedMovements,
          movimientosExistentes,
          estado: generatedMovements.length > 0 ? estado : null,
          documentos: documentosModificados ? { replace: documentosExistentes } : null
        });
      }

      if (pendientesModificadas && this.repo && typeof this.repo.savePendientes === 'function') {
        this.repo.savePendientes(todasPendientes);
      }

      const totalAplicados = Object.values(aplicados).reduce((acc, n) => acc + n, 0);
      const totalIgnorados = Object.values(ignorados).reduce((acc, n) => acc + n, 0);

      return {
        aplicados: { total: totalAplicados, ...aplicados },
        ignorados: { total: totalIgnorados, ...ignorados },
        siguenPendientes: contarSiguenPendientes(),
        documentosConfirmados,
        movimientosGenerados: generatedMovements.map(m => m.id_movimiento)
      };
    } finally {
      this.movementService._releaseLock();
    }
  }

  /**
   * Lista los pendientes agrupados por motivo y por documento, con cajas totales, fechas y entidad (T-008).
   *
   * @param {Object} [filtros={}]
   * @param {string} [filtros.estado='PENDIENTE'] - 'PENDIENTE', 'APLICADA', 'IGNORADA', 'RESUELTA' o 'TODOS'
   * @param {string} [filtros.motivo] - Filtro opcional por motivo
   * @param {string} [filtros.tipo_doc] - Filtro opcional por ENTRADA / SALIDA
   * @returns {Object}
   */
  listarPendientes(filtros = {}) {
    const f = filtros && typeof filtros === 'object' ? filtros : {};
    const estadoFiltro = f.estado !== undefined && f.estado !== null && String(f.estado).trim() !== ''
      ? String(f.estado).trim().toUpperCase()
      : 'PENDIENTE';
    const motivoFiltro = f.motivo ? String(f.motivo).trim().toUpperCase() : '';
    const tipoFiltro = (f.tipo_doc || f.tipoDoc)
      ? String(f.tipo_doc || f.tipoDoc).trim().toUpperCase()
      : '';

    const todas = (this.repo && typeof this.repo.getPendientes === 'function')
      ? this.repo.getPendientes()
      : [];

    const filtradas = todas.filter(fila => {
      const est = String(fila.estado || '').trim().toUpperCase();
      const mot = String(fila.motivo || '').trim().toUpperCase();
      const tip = String(fila.tipo_doc || '').trim().toUpperCase();

      if (estadoFiltro !== 'TODOS' && est !== estadoFiltro) return false;
      if (motivoFiltro && mot !== motivoFiltro) return false;
      if (tipoFiltro && tip !== tipoFiltro) return false;
      return true;
    });

    const porMotivo = {};
    let totalDocumentos = 0;

    for (const fila of filtradas) {
      const motivo = String(fila.motivo || 'OTRO').trim().toUpperCase();
      if (!porMotivo[motivo]) {
        porMotivo[motivo] = {
          motivo,
          totalFilas: 0,
          totalDocumentos: 0,
          totalCajas: 0,
          _docsMap: new Map()
        };
      }
      const bloque = porMotivo[motivo];
      const cajasFila = Number(fila.cajas || 0);
      bloque.totalFilas++;
      bloque.totalCajas += cajasFila;

      const clave = this._claveDocumento_(fila.tipo_doc, fila.serie, fila.numero);
      if (!bloque._docsMap.has(clave)) {
        bloque._docsMap.set(clave, {
          clave,
          tipo_doc: String(fila.tipo_doc || '').trim().toUpperCase(),
          serie: String(fila.serie || '').trim(),
          numero: String(fila.numero || '').trim(),
          fecha_negocio: String(fila.fecha_negocio || '').trim(),
          fecha_alta: String(fila.fecha_alta || '').trim(),
          fecha_resolucion: String(fila.fecha_resolucion || '').trim(),
          entidad: String(fila.entidad || '').trim(),
          motivo,
          estado: String(fila.estado || '').trim().toUpperCase(),
          totalCajas: 0,
          totalLineas: 0,
          lineas: []
        });
        bloque.totalDocumentos++;
        totalDocumentos++;
      }

      const doc = bloque._docsMap.get(clave);
      doc.totalCajas += cajasFila;
      doc.totalLineas++;
      doc.lineas.push({ ...fila });
      if (!doc.entidad && fila.entidad) {
        doc.entidad = String(fila.entidad).trim();
      }
      if (fila.fecha_negocio && (!doc.fecha_negocio || String(fila.fecha_negocio) < doc.fecha_negocio)) {
        doc.fecha_negocio = String(fila.fecha_negocio).trim();
      }
    }

    for (const motivo of Object.keys(porMotivo)) {
      const bloque = porMotivo[motivo];
      const docs = Array.from(bloque._docsMap.values());
      docs.sort((a, b) => this._compararDocumentosD007_(a, b));
      for (const doc of docs) {
        doc.lineas.sort((a, b) => this._compararLineas_(a, b));
      }
      bloque.documentos = docs;
      delete bloque._docsMap;
    }

    return {
      totalFilas: filtradas.length,
      totalDocumentos,
      porMotivo
    };
  }

  /**
   * Marca un pendiente como `RESUELTA` y registra la nota en `LOG_OPERACIONES` (T-008, Regla 4).
   * No toca el stock, ni `MOVIMIENTOS`, ni `CAPAS_FIFO`, ni `STOCK_ACTUAL`.
   *
   * @param {string} idPendiente
   * @param {string} [nota='']
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  marcarPendienteResuelto(idPendiente, nota = '', usuario = 'SISTEMA') {
    const idLimpio = String(idPendiente === null || idPendiente === undefined ? '' : idPendiente).trim();
    if (!idLimpio) {
      throw new Error('Se requiere id_pendiente para marcar un pendiente como resuelto.');
    }
    const notaLimpia = String(nota === null || nota === undefined ? '' : nota).trim();
    const ahoraIso = new Date().toISOString();

    this.movementService._acquireLock(30000);
    try {
      const todas = (this.repo && typeof this.repo.getPendientes === 'function')
        ? this.repo.getPendientes()
        : [];
      const fila = todas.find(p => String(p.id_pendiente || '').trim() === idLimpio);

      if (!fila) {
        return {
          success: false,
          errorCode: 'PENDIENTE_NO_ENCONTRADO',
          message: `No se encontró el pendiente '${idLimpio}'.`
        };
      }

      const motivoActual = String(fila.motivo || '').trim().toUpperCase();
      if (motivoActual !== 'MODIFICADO_EN_ERP') {
        return {
          success: false,
          errorCode: 'SOLO_MODIFICADO_EN_ERP',
          message: `Solo se pueden marcar como resueltos los pendientes con motivo MODIFICADO_EN_ERP (motivo actual: '${motivoActual}').`,
          motivo: motivoActual
        };
      }

      const estadoActual = String(fila.estado || '').trim().toUpperCase();
      if (estadoActual === 'RESUELTA' || estadoActual === 'APLICADA' || estadoActual === 'IGNORADA') {
        return {
          success: false,
          errorCode: 'PENDIENTE_YA_RESUELTO',
          message: `El pendiente '${idLimpio}' ya está en estado '${estadoActual}'.`,
          estado: estadoActual
        };
      }

      fila.estado = 'RESUELTA';
      fila.fecha_resolucion = ahoraIso;

      if (this.repo && typeof this.repo.savePendientes === 'function') {
        this.repo.savePendientes(todas);
      }

      if (this.repo && typeof this.repo.appendLogOperacion === 'function') {
        this.repo.appendLogOperacion({
          id_log: this._nuevoId_('LOG'),
          fecha_hora: ahoraIso,
          usuario: usuario || 'SISTEMA',
          operacion: 'RESOLVER_PENDIENTE',
          codigo_articulo: fila.articulo || '',
          codigo_envase: fila.envase || '',
          cantidad_cajas: Number(fila.cajas || 0),
          destino: `${fila.tipo_doc || ''} ${fila.serie || ''}/${fila.numero || ''}`.trim(),
          motivo: fila.motivo || '',
          referencia: fila.id_pendiente,
          estado: 'RESUELTA',
          observaciones: notaLimpia
        });
      }

      return {
        success: true,
        id_pendiente: fila.id_pendiente,
        estado: 'RESUELTA',
        fecha_resolucion: ahoraIso,
        nota: notaLimpia
      };
    } finally {
      this.movementService._releaseLock();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PendientesService
  };
}
