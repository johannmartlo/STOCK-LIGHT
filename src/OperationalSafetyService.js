/**
 * STOCK-LIGHT — OperationalSafetyService.js
 * 
 * Capa de Automatización, Validación Previa y Seguridad Operativa (Fase 6.0).
 * 
 * PRINCIPIOS DE ARQUITECTURA:
 * 1. Simplicidad Operativa: Sin Event Sourcing complejo, CQRS ni workflows empresariales pesados.
 * 2. Cero Adivinación: El sistema NUNCA inventa una clasificación. Si ARTÍCULO + ENVASE
 *    no tiene asociación conocida -> PENDIENTE DE ASOCIACIÓN (🟠) y se bloquea el procesamiento.
 * 3. Flujo de Validación Previa:
 *    DOCUMENTO -> EXTRACCIÓN -> NORMALIZACIÓN -> VALIDACIÓN -> PREVISUALIZACIÓN -> CONFIRMACIÓN -> PROCESAMIENTO -> STOCK
 *    Nunca se modifica STOCK directamente durante la extracción o validación.
 * 4. Control de Duplicados e Idempotencia:
 *    Detección de documentos ya procesados con mensaje explícito "Este documento ya fue procesado."
 *    y fecha de procesamiento.
 * 5. Protección de Salidas FIFO:
 *    Prohibición absoluta de saldos negativos o descuentos parciales silenciosos.
 *    Alerta inmediata de STOCK INSUFICIENTE con detalle de cajas solicitadas vs disponibles.
 * 6. Conciliación No Destructiva:
 *    Comparación analítica entre STOCK-LIGHT y stock externo sin alterar existencias.
 * 7. Semáforo Unificado:
 *    🟢 OK: Combinación reconocida y stock suficiente.
 *    🟠 PENDIENTE: Artículo + envase sin asociación comercial / pendiente de revisión.
 *    🔴 ERROR: Documento duplicado, artículo/envase inexistente, stock insuficiente o datos ausentes.
 */

// Importaciones condicionales para Node.js / Testing
let _CommercialGroupResolver = null;
let _MovementService = null;
let _SheetsRepository = null;
let _StockQueryService = null;

if (typeof require !== 'undefined') {
  try {
    _CommercialGroupResolver = require('./CommercialGroupResolver').CommercialGroupResolver;
    _MovementService = require('./MovementService').MovementService;
    _SheetsRepository = require('./Repository').SheetsRepository;
    _StockQueryService = require('./StockQueryService').StockQueryService;
  } catch (e) {
    // Entorno Apps Script o fallback
  }
} else {
  if (typeof CommercialGroupResolver !== 'undefined') _CommercialGroupResolver = CommercialGroupResolver;
  if (typeof MovementService !== 'undefined') _MovementService = MovementService;
  if (typeof SheetsRepository !== 'undefined') _SheetsRepository = SheetsRepository;
  if (typeof StockQueryService !== 'undefined') _StockQueryService = StockQueryService;
}

class OperationalSafetyService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.repository]
   * @param {Object} [options.movementService]
   * @param {Object} [options.commercialResolver]
   * @param {Object} [options.stockQueryService]
   * @param {Object} [options.lockService]
   */
  constructor(options = {}) {
    this.repo = options.repository || (_SheetsRepository ? new _SheetsRepository() : null);
    this.resolver = options.commercialResolver || (_CommercialGroupResolver ? new _CommercialGroupResolver({ repository: this.repo }) : null);
    this.movementService = options.movementService || (_MovementService ? new _MovementService({ repository: this.repo, lockService: options.lockService }) : null);
    this.queryService = options.stockQueryService || (_StockQueryService ? new _StockQueryService({ repository: this.repo, commercialGroupResolver: this.resolver }) : null);
  }

  /**
   * Valida un documento y sus líneas de stock antes de cualquier mutación o previsualización.
   * Aplica control de duplicados, validación de campos obligatorios, clasificación comercial
   * y comprobación de disponibilidad de stock para salidas.
   * 
   * @param {Object} docPayload - Metadatos del documento (serie, numero, fecha_documento, tipo_documento, sha256_hash, id_documento)
   * @param {Array<Object>} lineas - Líneas de stock ({ codigo_articulo, nombre_articulo, codigo_envase, descripcion_envase, cajas, partida })
   * @param {string} [tipoDocumento='ENTRADA'] - 'ENTRADA' | 'SALIDA'
   * @returns {{
   *   semaforo: 'OK'|'PENDIENTE'|'ERROR',
   *   esValido: boolean,
   *   puedeProcesar: boolean,
   *   esDuplicado: boolean,
   *   codigoError: string|null,
   *   mensaje: string,
   *   fechaProcesado: string|null,
   *   documentoExistente: Object|null,
   *   resumen: Object,
   *   lineasValidadas: Array<Object>,
   *   deficits: Array<Object>
   * }}
   */
  validarDocumento(docPayload = {}, lineas = [], tipoDocumento = 'ENTRADA') {
    const tipo = String(docPayload.tipo_documento || tipoDocumento || 'ENTRADA').toUpperCase();
    const serie = String(docPayload.serie || '').trim();
    const numero = String(docPayload.numero || '').trim();
    const fecha = docPayload.fecha_documento || docPayload.fecha || new Date().toISOString().slice(0, 10);
    const hash = docPayload.sha256_hash || '';
    const idDoc = docPayload.id_documento || '';

    // 1. CONTROL DE DUPLICADOS (IDEMPOTENCIA)
    if (this.repo && typeof this.repo.getDocumentos === 'function') {
      const existingDocs = this.repo.getDocumentos();
      const docDuplicado = existingDocs.find(d => {
        if (hash && d.sha256_hash && d.sha256_hash === hash) return true;
        if (idDoc && d.id_documento && d.id_documento === idDoc) return true;
        if (serie && numero && String(d.serie || '').trim() === serie && String(d.numero || '').trim() === numero && String(d.tipo_documento || '').toUpperCase() === tipo) {
          return true;
        }
        return false;
      });

      if (docDuplicado) {
        const fechaProc = docDuplicado.fecha_subida || docDuplicado.fecha_documento || 'Fecha no registrada';
        return {
          semaforo: 'ERROR',
          esValido: false,
          puedeProcesar: false,
          esDuplicado: true,
          codigoError: 'DOCUMENTO_DUPLICADO',
          mensaje: 'Este documento ya fue procesado.',
          fechaProcesado: fechaProc,
          documentoExistente: {
            idDocumento: docDuplicado.id_documento,
            fechaProcesado: fechaProc,
            tipo: docDuplicado.tipo_documento,
            serie: docDuplicado.serie,
            numero: docDuplicado.numero,
            totalCajas: docDuplicado.total_cajas
          },
          resumen: {
            tipoDocumento: tipo,
            totalLineas: lineas.length,
            totalCajas: 0,
            lineasOk: 0,
            lineasPendientes: 0,
            lineasError: lineas.length
          },
          lineasValidadas: [],
          deficits: []
        };
      }
    }

    // 2. VALIDACIÓN DE CABECERA
    const erroresCabecera = [];
    if (!serie) erroresCabecera.push('Serie de documento ausente.');
    if (!numero) erroresCabecera.push('Número de documento ausente.');
    if (!fecha) erroresCabecera.push('Fecha de documento ausente.');
    if (!Array.isArray(lineas) || lineas.length === 0) {
      erroresCabecera.push('El documento no contiene líneas de stock.');
    }

    if (erroresCabecera.length > 0) {
      return {
        semaforo: 'ERROR',
        esValido: false,
        puedeProcesar: false,
        esDuplicado: false,
        codigoError: 'DATOS_OBLIGATORIOS_AUSENTES',
        mensaje: erroresCabecera.join(' '),
        fechaProcesado: null,
        documentoExistente: null,
        resumen: {
          tipoDocumento: tipo,
          totalLineas: lineas ? lineas.length : 0,
          totalCajas: 0,
          lineasOk: 0,
          lineasPendientes: 0,
          lineasError: lineas ? lineas.length : 0
        },
        lineasValidadas: [],
        deficits: []
      };
    }

    // 3. CONSULTA DE STOCK ACTUAL (si es SALIDA)
    let stockMap = {};
    if (tipo === 'SALIDA') {
      let rawStock = [];
      if (this.repo && typeof this.repo.getStockActual === 'function') {
        rawStock = this.repo.getStockActual();
      }
      rawStock.forEach(s => {
        const k = s.stock_key || `${s.codigo_articulo}|${s.codigo_envase}`;
        stockMap[k] = Number(s.cajas_actuales || 0);
      });
    }

    // 4. VALIDACIÓN LÍNEA A LÍNEA
    const lineasValidadas = [];
    const deficits = [];
    let lineasOk = 0;
    let lineasPendientes = 0;
    let lineasError = 0;
    let totalCajas = 0;

    // Acumulador de demanda para salidas del mismo artículo+envase
    const demandaSalida = {};

    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      const lineIndex = l.lineIndex || (i + 1);
      const art = String(l.codigo_articulo || l.articulo || l.nombre_articulo || '').trim();
      const env = String(l.codigo_envase || l.envase || l.descripcion_envase || '').trim();
      const cajas = Number(l.cajas);
      const partida = l.partida || '';

      const erroresLinea = [];
      let semaforoLinea = 'OK';
      let motivoLinea = '';
      let bloqueada = false;

      // Validación de Cajas
      if (isNaN(cajas) || !Number.isInteger(cajas) || cajas <= 0) {
        erroresLinea.push('Cantidad de cajas inválida (debe ser entero > 0).');
        semaforoLinea = 'ERROR';
        motivoLinea = 'CAJAS_INVALIDAS';
        bloqueada = true;
      } else {
        totalCajas += cajas;
      }

      // Validación de Artículo y Envase presentes
      if (!art) {
        erroresLinea.push('Artículo no especificado.');
        semaforoLinea = 'ERROR';
        motivoLinea = 'ARTICULO_AUSENTE';
        bloqueada = true;
      }

      if (!env || env === 'DEFAULT' || env === 'ENVASE_NO_DETERMINABLE_DESDE_PDF') {
        erroresLinea.push('Envase no especificado o inválido (DEFAULT no permitido).');
        semaforoLinea = 'ERROR';
        motivoLinea = 'ENVASE_INVALIDO';
        bloqueada = true;
      }

      // Clasificación Comercial
      let classRes = null;
      if (this.resolver && art && env && semaforoLinea !== 'ERROR') {
        classRes = this.resolver.resolve(art, env);
        if (classRes.status === 'PENDIENTE_ASOCIACION' || classRes.groupId === 'NO_CLASIFICADO') {
          semaforoLinea = 'PENDIENTE';
          motivoLinea = 'PENDIENTE DE ASOCIACIÓN';
          bloqueada = true;
        }
      }

      // Validación de Stock para Salidas (PROHIBICIÓN DE SALDO NEGATIVO SILENCIOSO)
      if (tipo === 'SALIDA' && semaforoLinea !== 'ERROR') {
        const key = `${art}|${env}`;
        demandaSalida[key] = (demandaSalida[key] || 0) + cajas;
        const disponible = stockMap[key] || 0;
        const solicitadaTotal = demandaSalida[key];

        if (disponible < solicitadaTotal) {
          semaforoLinea = 'ERROR';
          motivoLinea = 'STOCK_INSUFICIENTE';
          bloqueada = true;
          const deficit = solicitadaTotal - disponible;
          erroresLinea.push(`Stock insuficiente para ${key}. Solicitadas: ${cajas} (total doc: ${solicitadaTotal}), Disponibles: ${disponible}, Déficit: ${deficit}.`);
          deficits.push({
            lineIndex,
            articulo: art,
            envase: env,
            cajasSolicitadas: cajas,
            cajasDisponibles: disponible,
            deficit
          });
        }
      }

      if (semaforoLinea === 'OK') {
        lineasOk++;
      } else if (semaforoLinea === 'PENDIENTE') {
        lineasPendientes++;
      } else {
        lineasError++;
      }

      lineasValidadas.push({
        lineIndex,
        articulo: art,
        envase: env,
        cajas: isNaN(cajas) ? 0 : cajas,
        partida,
        semaforo: semaforoLinea,
        icono: semaforoLinea === 'OK' ? '🟢' : (semaforoLinea === 'PENDIENTE' ? '🟠' : '🔴'),
        bloqueada,
        motivo: motivoLinea,
        grupoComercialId: classRes ? classRes.groupId : null,
        grupoComercial: classRes ? classRes.groupName : null,
        subgrupoComercialId: classRes ? classRes.subgroupId : null,
        subgrupoComercial: classRes ? classRes.subgroupName : null,
        categoria: classRes ? classRes.categoria : null,
        calibre: classRes ? classRes.calibre : null,
        errores: erroresLinea
      });
    }

    // 5. DETERMINACIÓN DEL SEMÁFORO GLOBAL
    let semaforoGlobal = 'OK';
    let mensajeGlobal = 'Documento validado con éxito.';
    let codigoErrorGlobal = null;

    if (lineasError > 0) {
      semaforoGlobal = 'ERROR';
      codigoErrorGlobal = deficits.length > 0 ? 'STOCK_INSUFICIENTE' : 'ERROR_VALIDACION_LINEAS';
      mensajeGlobal = deficits.length > 0
        ? 'STOCK INSUFICIENTE: Una o más líneas solicitan más cajas de las disponibles.'
        : `El documento contiene ${lineasError} línea(s) con errores bloqueantes.`;
    } else if (lineasPendientes > 0) {
      semaforoGlobal = 'PENDIENTE';
      codigoErrorGlobal = 'PENDIENTE_ASOCIACION';
      mensajeGlobal = `El documento contiene ${lineasPendientes} línea(s) pendientes de asociación comercial.`;
    }

    const esValido = semaforoGlobal === 'OK';
    const puedeProcesar = esValido;

    return {
      semaforo: semaforoGlobal,
      esValido,
      puedeProcesar,
      esDuplicado: false,
      codigoError: codigoErrorGlobal,
      mensaje: mensajeGlobal,
      fechaProcesado: null,
      documentoExistente: null,
      resumen: {
        tipoDocumento: tipo,
        totalLineas: lineas.length,
        totalCajas,
        lineasOk,
        lineasPendientes,
        lineasError
      },
      lineasValidadas,
      deficits
    };
  }

  /**
   * Genera la previsualización interactiva con semáforo antes de la confirmación definitiva.
   * Diseñado para la pantalla de usuario.
   * 
   * @param {Object} docPayload 
   * @param {Array<Object>} lineas 
   * @param {string} [tipoDocumento='ENTRADA'] 
   * @returns {Object}
   */
  previsualizarDocumento(docPayload, lineas, tipoDocumento = 'ENTRADA') {
    const val = this.validarDocumento(docPayload, lineas, tipoDocumento);
    const icono = val.semaforo === 'OK' ? '🟢' : (val.semaforo === 'PENDIENTE' ? '🟠' : '🔴');

    return {
      semaforo: val.semaforo,
      icono,
      puedeProcesar: val.puedeProcesar,
      mensaje: val.mensaje,
      codigoError: val.codigoError,
      esDuplicado: val.esDuplicado,
      fechaProcesado: val.fechaProcesado,
      resumen: val.resumen,
      documento: {
        tipo: docPayload.tipo_documento || tipoDocumento,
        serie: docPayload.serie || '',
        numero: docPayload.numero || '',
        fecha: docPayload.fecha_documento || docPayload.fecha || new Date().toISOString().slice(0, 10),
        entidadNombre: docPayload.entidad_nombre || ''
      },
      lineas: val.lineasValidadas,
      deficits: val.deficits
    };
  }

  /**
   * Procesa una ENTRADA tras validación previa obligatoria.
   * Si el documento es duplicado o contiene líneas pendientes/erróneas, bloquea el procesamiento.
   * 
   * @param {Object} docPayload 
   * @param {Array<Object>} lineas 
   * @param {string} [usuario='SISTEMA'] 
   * @returns {Object}
   */
  procesarEntradaDocumento(docPayload, lineas, usuario = 'SISTEMA') {
    const val = this.validarDocumento(docPayload, lineas, 'ENTRADA');

    if (!val.puedeProcesar) {
      return {
        success: false,
        semaforo: val.semaforo,
        status: val.codigoError || 'ERROR_VALIDACION',
        mensaje: val.mensaje,
        esDuplicado: val.esDuplicado,
        fechaProcesado: val.fechaProcesado,
        deficits: val.deficits,
        lineasPendientes: val.lineasValidadas.filter(l => l.semaforo === 'PENDIENTE')
      };
    }

    if (!this.movementService) {
      throw new Error('MovementService no está disponible.');
    }

    const res = this.movementService.registrarEntrada(docPayload, lineas, usuario);

    // Registro operativo simple en LOG_OPERACIONES
    if (res.success && this.repo && typeof this.repo.appendLogOperaciones === 'function') {
      const logs = lineas.map(l => ({
        fecha_hora: new Date().toISOString(),
        usuario,
        operacion: 'ENTRADA',
        codigo_articulo: l.codigo_articulo || l.articulo,
        nombre_articulo: l.nombre_articulo || '',
        codigo_envase: l.codigo_envase || l.envase,
        descripcion_envase: l.descripcion_envase || '',
        cantidad_cajas: Number(l.cajas),
        origen: docPayload.entidad_nombre || 'PROVEEDOR',
        destino: 'STOCK_ALMACEN',
        referencia: `${docPayload.serie}/${docPayload.numero}`,
        observaciones: `Entrada albarán compra ${docPayload.serie}/${docPayload.numero}`
      }));
      this.repo.appendLogOperaciones(logs);
    }

    return {
      success: true,
      semaforo: 'OK',
      status: 'CONFIRMADO',
      mensaje: 'Entrada procesada con éxito y capas FIFO generadas.',
      documentoId: res.documentoId,
      totalCajas: res.totalCajas,
      movimientosGenerados: res.movimientosGenerados
    };
  }

  /**
   * Procesa una SALIDA tras validación previa obligatoria.
   * Si no hay stock suficiente, BLOQUEA totalmente (cero descuentos parciales silenciosos).
   * 
   * @param {Object} docPayload 
   * @param {Array<Object>} lineas 
   * @param {string} [usuario='SISTEMA'] 
   * @returns {Object}
   */
  procesarSalidaDocumento(docPayload, lineas, usuario = 'SISTEMA') {
    const val = this.validarDocumento(docPayload, lineas, 'SALIDA');

    if (!val.puedeProcesar) {
      return {
        success: false,
        semaforo: val.semaforo,
        status: val.codigoError || 'ERROR_VALIDACION',
        alerta: val.codigoError === 'STOCK_INSUFICIENTE' ? 'STOCK INSUFICIENTE' : val.semaforo,
        mensaje: val.codigoError === 'STOCK_INSUFICIENTE' ? 'STOCK INSUFICIENTE' : val.mensaje,
        detalleMensaje: val.mensaje,
        esDuplicado: val.esDuplicado,
        fechaProcesado: val.fechaProcesado,
        deficits: val.deficits,
        lineasPendientes: val.lineasValidadas.filter(l => l.semaforo === 'PENDIENTE')
      };
    }

    if (!this.movementService) {
      throw new Error('MovementService no está disponible.');
    }

    const res = this.movementService.registrarSalida(docPayload, lineas, usuario);

    // Registro operativo simple en LOG_OPERACIONES
    if (res.success && this.repo && typeof this.repo.appendLogOperaciones === 'function') {
      const logs = lineas.map(l => ({
        fecha_hora: new Date().toISOString(),
        usuario,
        operacion: 'SALIDA',
        codigo_articulo: l.codigo_articulo || l.articulo,
        nombre_articulo: l.nombre_articulo || '',
        codigo_envase: l.codigo_envase || l.envase,
        descripcion_envase: l.descripcion_envase || '',
        cantidad_cajas: Number(l.cajas),
        origen: 'STOCK_ALMACEN',
        destino: docPayload.entidad_nombre || 'CLIENTE',
        referencia: `${docPayload.serie}/${docPayload.numero}`,
        observaciones: `Salida albarán venta ${docPayload.serie}/${docPayload.numero}`
      }));
      this.repo.appendLogOperaciones(logs);
    }

    return {
      success: true,
      semaforo: 'OK',
      status: 'CONFIRMADO',
      mensaje: 'Salida procesada con éxito y capas FIFO deducidas.',
      documentoId: res.documentoId,
      totalCajas: res.totalCajas,
      movimientosGenerados: res.movimientosGenerados
    };
  }

  /**
   * Operación de CONCILIACIÓN de stock:
   * Compara STOCK-LIGHT contra un inventario externo/importado sin modificar existencias.
   * Resultado: ARTÍCULO | ENVASE | STOCK-LIGHT | EXTERNO | DIFERENCIA
   * (Diferencia = stockLight - externo).
   * 
   * @param {Array<Object>} stockExterno - Array de { articulo, envase, cajas, ... }
   * @param {Object} [options]
   * @returns {{
   *   totalLineas: number,
   *   totalCoincidencias: number,
   *   totalDiscrepancias: number,
   *   totalStockLightCajas: number,
   *   totalExternoCajas: number,
   *   diferenciaNetaCajas: number,
   *   fechaConciliacion: string,
   *   lineas: Array<{
   *     codigoArticulo: string,
   *     nombreArticulo: string,
   *     codigoEnvase: string,
   *     descripcionEnvase: string,
   *     stockLight: number,
   *     externo: number,
   *     diferencia: number,
   *     estado: string,
   *     icono: string,
   *     grupoComercial: string,
   *     subgrupoComercial: string|null
   *   }>
   * }}
   */
  conciliarStock(stockExterno = [], options = {}) {
    let localStock = [];
    if (this.queryService && typeof this.queryService.obtenerStockActual === 'function') {
      localStock = this.queryService.obtenerStockActual();
    } else if (this.repo && typeof this.repo.getStockActual === 'function') {
      localStock = this.repo.getStockActual();
    }

    const mergedMap = new Map();

    // 1. Cargar stock interno de STOCK-LIGHT
    localStock.forEach(item => {
      const art = String(item.codigo_articulo || item.nombre_articulo || '').trim();
      const env = String(item.codigo_envase || item.descripcion_envase || '').trim();
      const key = `${art.toUpperCase()}|${env.toUpperCase()}`;
      const cajas = Number(item.cajas_actuales != null ? item.cajas_actuales : (item.cajas || 0));

      mergedMap.set(key, {
        codigoArticulo: item.codigo_articulo || art,
        nombreArticulo: item.nombre_articulo || art,
        codigoEnvase: item.codigo_envase || env,
        descripcionEnvase: item.descripcion_envase || env,
        stockLight: cajas,
        externo: 0,
        grupoComercial: item.grupo_comercial || 'PENDIENTE DE ASOCIACIÓN',
        subgrupoComercial: item.subgrupo_comercial || null
      });
    });

    // 2. Fusionar con stock externo
    (stockExterno || []).forEach(ext => {
      const art = String(ext.codigo_articulo || ext.articulo || ext.nombre_articulo || '').trim();
      const env = String(ext.codigo_envase || ext.envase || ext.descripcion_envase || '').trim();
      const key = `${art.toUpperCase()}|${env.toUpperCase()}`;
      const cajasExt = Number(ext.cajas != null ? ext.cajas : (ext.cajas_actuales || 0));

      if (mergedMap.has(key)) {
        mergedMap.get(key).externo = cajasExt;
      } else {
        let comm = null;
        if (this.resolver && typeof this.resolver.resolve === 'function') {
          comm = this.resolver.resolve(art, env);
        }

        mergedMap.set(key, {
          codigoArticulo: ext.codigo_articulo || art,
          nombreArticulo: ext.nombre_articulo || art,
          codigoEnvase: ext.codigo_envase || env,
          descripcionEnvase: ext.descripcion_envase || env,
          stockLight: 0,
          externo: cajasExt,
          grupoComercial: comm ? comm.groupName : 'PENDIENTE DE ASOCIACIÓN',
          subgrupoComercial: comm ? comm.subgroupName : null
        });
      }
    });

    let totalCoincidencias = 0;
    let totalDiscrepancias = 0;
    let totalStockLightCajas = 0;
    let totalExternoCajas = 0;

    const lineas = Array.from(mergedMap.values()).map(item => {
      const diff = item.stockLight - item.externo;
      totalStockLightCajas += item.stockLight;
      totalExternoCajas += item.externo;

      let estado = 'COINCIDE';
      let icono = '🟢';

      if (diff !== 0) {
        totalDiscrepancias++;
        if (item.stockLight === 0) {
          estado = 'SOLO_EN_EXTERNO';
          icono = '🔴';
        } else if (item.externo === 0) {
          estado = 'SOLO_EN_STOCK_LIGHT';
          icono = '🔴';
        } else if (diff > 0) {
          estado = 'SOBRANTE_LOCAL'; // Más cajas en STOCK-LIGHT que fuera
          icono = '🟠';
        } else {
          estado = 'FALTANTE_LOCAL'; // Menos cajas en STOCK-LIGHT que fuera
          icono = '🟠';
        }
      } else {
        totalCoincidencias++;
      }

      return {
        ...item,
        diferencia: diff,
        estado,
        icono
      };
    });

    return {
      totalLineas: lineas.length,
      totalCoincidencias,
      totalDiscrepancias,
      totalStockLightCajas,
      totalExternoCajas,
      diferenciaNetaCajas: totalStockLightCajas - totalExternoCajas,
      fechaConciliacion: new Date().toISOString(),
      lineas
    };
  }

  /**
   * Ejecuta de forma unificada y segura cualquier ajuste operativo manual:
   * - ANADIR_STOCK (Ajuste Positivo)
   * - QUITAR_STOCK (Ajuste Negativo)
   * - CAMBIAR_CLASIFICACION (Reclasificación comercial)
   * - CAMBIAR_ARTICULO (Cambio de artículo)
   * - CAMBIAR_ENVASE (Cambio de formato de envase)
   * - MOVER_PARTIDA (Traspaso entre partidas)
   * 
   * @param {Object} ajustePayload
   * @param {string} [usuario='OPERADOR']
   * @returns {Object}
   */
  ejecutarAjusteOperativo(ajustePayload, usuario = 'OPERADOR') {
    if (!ajustePayload || !ajustePayload.accion) {
      throw new Error('ejecutarAjusteOperativo: Se requiere campo accion.');
    }

    const accion = String(ajustePayload.accion).trim().toUpperCase();
    const art = ajustePayload.articulo || ajustePayload.codigo_articulo || ajustePayload.codigoArticulo;
    const env = ajustePayload.envase || ajustePayload.codigo_envase || ajustePayload.codigoEnvase;
    const cajas = Math.abs(Number(ajustePayload.cajas || ajustePayload.cantidad));
    const motivo = ajustePayload.motivo || accion;
    const observaciones = ajustePayload.observaciones || '';

    if (!this.movementService) {
      throw new Error('MovementService no está disponible.');
    }

    let res = null;
    let logOp = null;

    switch (accion) {
      case 'ANADIR_STOCK':
      case 'AJUSTE_POSITIVO': {
        res = this.movementService.registrarAjustePositivo({
          codigo_articulo: art,
          codigo_envase: env,
          cajas,
          partida: ajustePayload.partida || '',
          motivo,
          observaciones
        }, usuario);

        if (res.success) {
          logOp = {
            fecha_hora: new Date().toISOString(),
            usuario,
            operacion: 'AJUSTE_POSITIVO',
            codigo_articulo: art,
            codigo_envase: env,
            cantidad_cajas: cajas,
            origen: 'AJUSTE_MANUAL',
            destino: 'STOCK_ALMACEN',
            referencia: res.movimientoId,
            observaciones
          };
        }
        break;
      }

      case 'QUITAR_STOCK':
      case 'AJUSTE_NEGATIVO': {
        res = this.movementService.registrarAjusteNegativo({
          codigo_articulo: art,
          codigo_envase: env,
          cajas,
          motivo,
          observaciones
        }, usuario);

        if (res.success) {
          logOp = {
            fecha_hora: new Date().toISOString(),
            usuario,
            operacion: 'AJUSTE_NEGATIVO',
            codigo_articulo: art,
            codigo_envase: env,
            cantidad_cajas: cajas,
            origen: 'STOCK_ALMACEN',
            destino: 'AJUSTE_MANUAL',
            referencia: res.movimientoId,
            observaciones
          };
        }
        break;
      }

      case 'CAMBIAR_CLASIFICACION':
      case 'RECLASIFICACION': {
        const envDestino = ajustePayload.envaseDestino || ajustePayload.codigo_envase_destino || env;
        const artDestino = ajustePayload.articuloDestino || ajustePayload.codigo_articulo_destino || art;
        res = this.movementService.registrarReclasificacion({
          codigo_articulo_origen: art,
          codigo_articulo_destino: artDestino,
          codigo_envase_origen: env,
          codigo_envase_destino: envDestino,
          cajas,
          motivo: 'RECLASIFICACION',
          observaciones
        }, usuario);

        if (res.success) {
          logOp = {
            fecha_hora: new Date().toISOString(),
            usuario,
            operacion: 'RECLASIFICACION',
            codigo_articulo: art,
            codigo_envase: `${env} → ${envDestino}`,
            cantidad_cajas: cajas,
            origen: `${art}|${env}`,
            destino: `${artDestino}|${envDestino}`,
            referencia: res.referenciaOperacion,
            observaciones
          };
        }
        break;
      }

      case 'CAMBIAR_ARTICULO': {
        const artDestino = ajustePayload.articuloDestino || ajustePayload.codigo_articulo_destino;
        if (!artDestino) throw new Error('CAMBIAR_ARTICULO requiere articuloDestino.');
        res = this.movementService.registrarReclasificacion({
          codigo_articulo_origen: art,
          codigo_articulo_destino: artDestino,
          codigo_envase_origen: env,
          codigo_envase_destino: env,
          cajas,
          motivo: 'CAMBIO_ARTICULO',
          observaciones
        }, usuario);

        if (res.success) {
          logOp = {
            fecha_hora: new Date().toISOString(),
            usuario,
            operacion: 'CAMBIO_ARTICULO',
            codigo_articulo: `${art} → ${artDestino}`,
            codigo_envase: env,
            cantidad_cajas: cajas,
            origen: art,
            destino: artDestino,
            referencia: res.referenciaOperacion,
            observaciones
          };
        }
        break;
      }

      case 'CAMBIAR_ENVASE': {
        const envDestino = ajustePayload.envaseDestino || ajustePayload.codigo_envase_destino;
        if (!envDestino) throw new Error('CAMBIAR_ENVASE requiere envaseDestino.');
        res = this.movementService.registrarReclasificacion({
          codigo_articulo_origen: art,
          codigo_articulo_destino: art,
          codigo_envase_origen: env,
          codigo_envase_destino: envDestino,
          cajas,
          motivo: 'CAMBIO_ENVASE',
          observaciones
        }, usuario);

        if (res.success) {
          logOp = {
            fecha_hora: new Date().toISOString(),
            usuario,
            operacion: 'CAMBIO_ENVASE',
            codigo_articulo: art,
            codigo_envase: `${env} → ${envDestino}`,
            cantidad_cajas: cajas,
            origen: env,
            destino: envDestino,
            referencia: res.referenciaOperacion,
            observaciones
          };
        }
        break;
      }

      case 'MOVER_PARTIDA': {
        const partidaOrigen = ajustePayload.partidaOrigen || ajustePayload.partida_origen;
        const partidaDestino = ajustePayload.partidaDestino || ajustePayload.partida_destino;
        res = this.movementService.registrarMovimientoPartida({
          codigo_articulo: art,
          codigo_envase: env,
          partida_origen: partidaOrigen,
          partida_destino: partidaDestino,
          cajas,
          motivo: 'MOVER_PARTIDA',
          observaciones
        }, usuario);

        if (res.success) {
          logOp = {
            fecha_hora: new Date().toISOString(),
            usuario,
            operacion: 'MOVER_PARTIDA',
            codigo_articulo: art,
            codigo_envase: env,
            cantidad_cajas: cajas,
            origen: partidaOrigen,
            destino: partidaDestino,
            referencia: res.referenciaOperacion,
            observaciones
          };
        }
        break;
      }

      default:
        throw new Error(`Acción de ajuste no reconocida: '${accion}'`);
    }

    if (logOp && this.repo && typeof this.repo.appendLogOperacion === 'function') {
      this.repo.appendLogOperacion(logOp);
    }

    return res;
  }

  /**
   * Obtiene la lista de registros operativos de trazabilidad simple.
   * @returns {Array<Object>}
   */
  obtenerLogOperaciones() {
    if (this.repo && typeof this.repo.getLogOperaciones === 'function') {
      return this.repo.getLogOperaciones();
    }
    return [];
  }

  /**
   * Previsualiza una corrección histórica de forma 100% analítica y de solo lectura.
   * Analiza existencias iniciales, consumos posteriores, saldos actuales y determina si la
   * corrección puede resolverse de forma determinista (CORRECCION_SEGURA) o requiere intervención
   * humana (REVISION_NECESARIA).
   * 
   * @param {Object} correccionPayload
   * @returns {Object}
   */
  previsualizarCorreccionHistorica(correccionPayload = {}) {
    const accion = String(correccionPayload.accion || correccionPayload.tipo || '').toUpperCase();
    const docRef = (correccionPayload.serie && correccionPayload.numero)
      ? `${String(correccionPayload.serie).trim()}/${String(correccionPayload.numero).trim()}`
      : (correccionPayload.id_documento || correccionPayload.documentoRef || correccionPayload.documento_ref);

    // Casos de salida: ANULAR_SALIDA o CORRECCION_CANTIDAD_SALIDA
    if (accion === 'ANULAR_SALIDA' || accion === 'CORRECCION_CANTIDAD_SALIDA') {
      const allMovs = this.repo ? this.repo.getMovimientos() : [];
      const allDocs = this.repo && typeof this.repo.getDocumentos === 'function' ? this.repo.getDocumentos() : [];
      const docObj = allDocs.find(d =>
        (correccionPayload.serie && correccionPayload.numero &&
          String(d.serie).trim() === String(correccionPayload.serie).trim() &&
          String(d.numero).trim() === String(correccionPayload.numero).trim()) ||
        (docRef && d.id_documento === docRef)
      );
      const targetDocId = docObj ? docObj.id_documento : null;
      const mov = allMovs.find(m => 
        m.tipo_movimiento === 'SALIDA' &&
        (m.id_documento_ref === docRef ||
         (targetDocId && m.id_documento_ref === targetDocId) ||
         m.id_movimiento === correccionPayload.id_movimiento ||
         (docRef && String(m.id_documento_ref || '').includes(docRef)))
      );

      if (!mov) {
        return {
          semaforo: 'ERROR',
          estado: 'REVISION_NECESARIA',
          esSegura: false,
          accion,
          mensaje: 'Movimiento de salida no encontrado para previsualizar.'
        };
      }

      const cajasOriginal = Number(mov.cajas);
      if (accion === 'ANULAR_SALIDA') {
        return {
          semaforo: 'OK',
          estado: 'CORRECCION_SEGURA',
          esSegura: true,
          accion,
          movimientoAfectado: {
            id_movimiento: mov.id_movimiento,
            documento_ref: mov.id_documento_ref,
            articulo: mov.codigo_articulo,
            envase: mov.codigo_envase,
            cajas: cajasOriginal
          },
          cantidadOriginal: cajasOriginal,
          cantidadConsumida: 0,
          cantidadDisponible: cajasOriginal,
          movimientosPosteriores: [],
          impactoPotencial: `Se anulará la salida y se reintegrarán ${cajasOriginal} cajas a las capas FIFO originales.`,
          resultadoPrevisto: { stockRecuperado: cajasOriginal, capasRestauradas: 'Restitución FIFO exacta' },
          accionRecomendada: 'Proceder con la anulación de salida.',
          mensaje: `Salida de ${cajasOriginal} cajas lista para ser restituida al inventario.`
        };
      } else {
        const nuevaCantidad = Number(correccionPayload.nuevaCantidad !== undefined ? correccionPayload.nuevaCantidad : correccionPayload.cajas);
        const delta = cajasOriginal - nuevaCantidad;
        if (delta > 0) {
          return {
            semaforo: 'OK',
            estado: 'CORRECCION_SEGURA',
            esSegura: true,
            accion,
            movimientoAfectado: { id_movimiento: mov.id_movimiento, articulo: mov.codigo_articulo, envase: mov.codigo_envase },
            cantidadOriginal: cajasOriginal,
            nuevaCantidad,
            delta,
            impactoPotencial: `Se reintegrarán ${delta} cajas al inventario respetando el modelo FIFO.`,
            resultadoPrevisto: { stockNuevoIncremento: delta, nuevaSalida: nuevaCantidad },
            mensaje: `Corrección segura: se restituirán ${delta} cajas al stock.`
          };
        } else {
          const deltaConsumo = Math.abs(delta);
          const stockKey = this.movementService.engine.buildStockKey(mov.codigo_articulo, mov.codigo_envase);
          const stockList = this.repo.getStockActual();
          const item = stockList.find(s => s.stock_key === stockKey);
          const disp = item ? Number(item.cajas_actuales || 0) : 0;
          if (disp < deltaConsumo) {
            return {
              semaforo: 'ERROR',
              estado: 'REVISION_NECESARIA',
              esSegura: false,
              accion,
              movimientoAfectado: { id_movimiento: mov.id_movimiento, articulo: mov.codigo_articulo, envase: mov.codigo_envase },
              cantidadOriginal: cajasOriginal,
              nuevaCantidad,
              cajasDisponibles: disp,
              deficit: deltaConsumo - disp,
              impactoPotencial: `Se requieren ${deltaConsumo} cajas adicionales pero solo hay ${disp} disponibles.`,
              accionRecomendada: 'Revisar stock o realizar entrada previa antes de ampliar la salida.',
              mensaje: `Stock insuficiente: faltan ${deltaConsumo - disp} cajas para ampliar la salida. REVISIÓN NECESARIA`
            };
          } else {
            return {
              semaforo: 'OK',
              estado: 'CORRECCION_SEGURA',
              esSegura: true,
              accion,
              movimientoAfectado: { id_movimiento: mov.id_movimiento, articulo: mov.codigo_articulo, envase: mov.codigo_envase },
              cantidadOriginal: cajasOriginal,
              nuevaCantidad,
              impactoPotencial: `Se consumirán ${deltaConsumo} cajas adicionales mediante FIFO.`,
              mensaje: `Corrección segura: stock suficiente para ampliar salida en ${deltaConsumo} cajas.`
            };
          }
        }
      }
    }

    // Casos de entrada: ANULAR_ENTRADA, CORRECCION_CANTIDAD_ENTRADA, CORRECCION_ENTRADA_PARCIAL, DIVIDIR_ENTRADA, etc.
    const currentLayers = this.repo ? this.repo.getCapasFifo() : [];
    const layer = this.movementService ? this.movementService._findLayer(currentLayers, correccionPayload) : null;

    if (!layer) {
      return {
        semaforo: 'ERROR',
        estado: 'REVISION_NECESARIA',
        esSegura: false,
        accion,
        mensaje: 'Capa o entrada no encontrada para previsualizar.'
      };
    }

    const cajasIniciales = Number(layer.cajas_iniciales);
    const cajasConsumidas = Number(layer.cajas_consumidas || 0);
    const cajasRestantes = Number(layer.cajas_restantes || 0);

    let esSegura = true;
    let estado = 'CORRECCION_SEGURA';
    let mensaje = 'Operación segura y determinista.';
    let impactoPotencial = '';
    let resultadoPrevisto = {};
    let accionRecomendada = 'Proceder con la corrección.';

    switch (accion) {
      case 'ANULAR_ENTRADA': {
        if (cajasConsumidas > 0) {
          esSegura = false;
          estado = 'REVISION_NECESARIA';
          mensaje = `NO SE PUEDE ANULAR AUTOMÁTICAMENTE: Esta entrada tiene ${cajasConsumidas} cajas consumidas por movimientos posteriores. REVISIÓN NECESARIA`;
          impactoPotencial = `La anulación provocaría un descuadre de ${cajasConsumidas} cajas ya consumidas por salidas.`;
          accionRecomendada = 'Revisar o corregir las salidas posteriores antes de anular esta entrada.';
        } else {
          esSegura = true;
          estado = 'CORRECCION_SEGURA';
          mensaje = `La entrada no tiene consumos posteriores y puede ser anulada íntegramente (-${cajasIniciales} cajas).`;
          impactoPotencial = `Se descontarán ${cajasIniciales} cajas del stock y la capa quedará ANULADA.`;
          resultadoPrevisto = { stockAfectado: -cajasIniciales, estadoCapa: 'ANULADA' };
        }
        break;
      }

      case 'CORRECCION_CANTIDAD_ENTRADA': {
        const nuevaCantidad = Number(correccionPayload.nuevaCantidad !== undefined ? correccionPayload.nuevaCantidad : correccionPayload.cajas);
        const delta = nuevaCantidad - cajasIniciales;
        if (delta < 0) {
          const reduccion = Math.abs(delta);
          if (cajasRestantes < reduccion) {
            esSegura = false;
            estado = 'REVISION_NECESARIA';
            mensaje = `Solo quedan ${cajasRestantes} cajas disponibles de esta entrada. No se puede reducir en ${reduccion} cajas sin provocar inconsistencias. REVISIÓN NECESARIA`;
            impactoPotencial = `Déficit de ${reduccion - cajasRestantes} cajas para absorber la reducción.`;
            accionRecomendada = 'Revisar consumos posteriores o realizar un ajuste por merma/inventario.';
          } else {
            esSegura = true;
            estado = 'CORRECCION_SEGURA';
            mensaje = `Reducción segura: la capa dispone de ${cajasRestantes} cajas para absorber la reducción de ${reduccion} cajas.`;
            impactoPotencial = `La entrada pasará de ${cajasIniciales} a ${nuevaCantidad} cajas (${reduccion} cajas menos en stock).`;
            resultadoPrevisto = { nuevaCantidad, cajasRestantes: cajasRestantes - reduccion };
          }
        } else {
          esSegura = true;
          estado = 'CORRECCION_SEGURA';
          mensaje = `Aumento seguro: la entrada pasará de ${cajasIniciales} a ${nuevaCantidad} cajas (+${delta} cajas en stock).`;
          resultadoPrevisto = { nuevaCantidad, cajasRestantes: cajasRestantes + delta };
        }
        break;
      }

      case 'CORRECCION_ENTRADA_PARCIAL':
      case 'CORREGIR_ENTRADA':
      case 'CAMBIAR_ARTICULO':
      case 'CAMBIAR_ENVASE':
      case 'CAMBIAR_CALIBRE': {
        const nuevoArt = correccionPayload.nuevoArticulo || correccionPayload.articuloDestino || layer.codigo_articulo;
        const nuevoEnv = correccionPayload.nuevoEnvase || correccionPayload.envaseDestino || layer.codigo_envase;
        if (cajasRestantes <= 0) {
          esSegura = false;
          estado = 'REVISION_NECESARIA';
          mensaje = 'No se puede corregir la entrada porque la totalidad de sus cajas ya fueron consumidas por movimientos posteriores. REVISIÓN NECESARIA';
          impactoPotencial = 'Cero saldo disponible para reclasificar.';
          accionRecomendada = 'No alterar la entrada; si es necesario, ajustar manualmente el stock actual.';
        } else {
          esSegura = true;
          estado = 'CORRECCION_SEGURA';
          mensaje = `Corrección segura: ${cajasConsumidas} cajas ya consumidas se mantendrán en origen; ${cajasRestantes} cajas disponibles se reclasificarán a ${nuevoArt}|${nuevoEnv}.`;
          impactoPotencial = cajasConsumidas > 0
            ? `Entrada parcialmente consumida: ${cajasConsumidas} cajas mantenidas en origen; ${cajasRestantes} cajas transferidas a destino`
            : `Las ${cajasRestantes} cajas se transferirán íntegramente a ${nuevoArt}|${nuevoEnv}`;
          resultadoPrevisto = {
            cajasMantenidasConsumidas: cajasConsumidas,
            cajasReclasificadas: cajasRestantes,
            destino: `${nuevoArt}|${nuevoEnv}`
          };
        }
        break;
      }

      case 'DIVIDIR_ENTRADA': {
        const divisiones = correccionPayload.divisiones || [];
        const suma = divisiones.reduce((s, d) => s + Number(d.cajas || 0), 0);
        if (suma !== cajasIniciales) {
          esSegura = false;
          estado = 'REVISION_NECESARIA';
          mensaje = `La suma de las divisiones (${suma}) no coincide con el total inicial de la entrada (${cajasIniciales}). REVISIÓN NECESARIA`;
          impactoPotencial = 'Discrepancia en la suma total de cajas.';
          accionRecomendada = `Asegurar que la suma de divisiones sea exactamente ${cajasIniciales} cajas.`;
        } else {
          const divOrig = divisiones.find(d => 
            (d.articulo || d.codigo_articulo) === layer.codigo_articulo &&
            (d.envase || d.codigo_envase || layer.codigo_envase) === layer.codigo_envase
          );
          const cajasAsignadasOrig = divOrig ? Number(divOrig.cajas || 0) : 0;
          if (cajasConsumidas > 0 && cajasAsignadasOrig < cajasConsumidas) {
            esSegura = false;
            estado = 'REVISION_NECESARIA';
            mensaje = `No se puede dividir la entrada porque la cantidad asignada a la combinación original ${layer.codigo_articulo} (${cajasAsignadasOrig}) es inferior a las cajas ya consumidas (${cajasConsumidas}). REVISIÓN NECESARIA`;
            impactoPotencial = `Generaría un déficit de ${cajasConsumidas - cajasAsignadasOrig} cajas en la combinación original.`;
            accionRecomendada = `Asignar al menos ${cajasConsumidas} cajas a la combinación original ${layer.codigo_articulo}.`;
          } else {
            esSegura = true;
            estado = 'CORRECCION_SEGURA';
            mensaje = `División segura: ${divisiones.length} líneas generadas respetando los consumos existentes.`;
            resultadoPrevisto = { divisiones, cajasMantenidasConsumidas: cajasConsumidas };
          }
        }
        break;
      }

      case 'MOVER_PARTIDA': {
        const cajasMover = Number(correccionPayload.cajas || correccionPayload.cantidad);
        if (cajasRestantes < cajasMover) {
          esSegura = false;
          estado = 'REVISION_NECESARIA';
          mensaje = `Stock insuficiente en la partida origen para mover ${cajasMover} cajas. Disponible: ${cajasRestantes}. REVISIÓN NECESARIA`;
          impactoPotencial = `Déficit de ${cajasMover - cajasRestantes} cajas en la partida origen.`;
        } else {
          esSegura = true;
          estado = 'CORRECCION_SEGURA';
          mensaje = `Movimiento seguro de ${cajasMover} cajas entre partidas.`;
          resultadoPrevisto = { partidaOrigen: layer.partida, partidaDestino: correccionPayload.partidaDestino, cajas: cajasMover };
        }
        break;
      }

      default:
        esSegura = false;
        estado = 'REVISION_NECESARIA';
        mensaje = `Acción de corrección no reconocida: '${accion}'`;
    }

    // Recalcular clasificación comercial de destino si aplica
    let grupoComercialDestino = null;
    if (this.resolver && (correccionPayload.nuevoArticulo || correccionPayload.nuevoEnvase)) {
      const tArt = correccionPayload.nuevoArticulo || layer.codigo_articulo;
      const tEnv = correccionPayload.nuevoEnvase || layer.codigo_envase;
      grupoComercialDestino = this.resolver.resolve(tArt, tEnv);
    }

    return {
      semaforo: esSegura ? 'OK' : 'ERROR',
      estado,
      esSegura,
      accion,
      movimientoAfectado: {
        id_capa: layer.id_capa,
        documento_ref: layer.documento_ref,
        articulo: layer.codigo_articulo,
        envase: layer.codigo_envase,
        partida: layer.partida
      },
      cantidadOriginal: cajasIniciales,
      cantidadConsumida: cajasConsumidas,
      cantidadDisponible: cajasRestantes,
      movimientosPosteriores: cajasConsumidas > 0 ? [{ tipo: 'CONSUMO_POSTERIOR', cajas: cajasConsumidas }] : [],
      impactoPotencial,
      resultadoPrevisto,
      grupoComercialDestino,
      accionRecomendada,
      mensaje
    };
  }

  /**
   * Ejecuta una corrección histórica de forma atómica, validando previamente el impacto,
   * exigiendo motivo obligatorio, preservando la trazabilidad en LOG_OPERACIONES y comprobando
   * la reconciliación matemática final del inventario.
   * 
   * @param {Object} correccionPayload
   * @param {string} [usuario='OPERADOR']
   * @returns {Object}
   */
  ejecutarCorreccionHistorica(correccionPayload = {}, usuario = 'OPERADOR') {
    // 1. MOTIVO OBLIGATORIO
    const motivo = correccionPayload.motivo || correccionPayload.motivo_ajuste;
    if (!motivo || !String(motivo).trim()) {
      return {
        success: false,
        semaforo: 'ERROR',
        status: 'ERROR_MOTIVO_OBLIGATORIO',
        mensaje: 'El motivo es obligatorio en cualquier corrección histórica.'
      };
    }

    // 2. PREVISUALIZACIÓN OBLIGATORIA PREVIA
    const prev = this.previsualizarCorreccionHistorica(correccionPayload);
    if (!prev.esSegura) {
      return {
        success: false,
        semaforo: 'ERROR',
        status: 'REVISION_NECESARIA',
        estado: 'REVISION_NECESARIA',
        mensaje: prev.mensaje,
        movimientoAfectado: prev.movimientoAfectado,
        cantidadOriginal: prev.cantidadOriginal,
        cantidadConsumida: prev.cantidadConsumida,
        movimientosPosteriores: prev.movimientosPosteriores,
        impactoPotencial: prev.impactoPotencial,
        accionRecomendada: prev.accionRecomendada
      };
    }

    // 3. CAPTURA DE SNAPSHOT DE STOCK ANTES (CONCILIACIÓN MATEMÁTICA)
    const stockAntesList = this.repo.getStockActual();
    const totalStockAntes = stockAntesList.reduce((s, r) => s + Number(r.cajas_actuales || 0), 0);

    const accion = String(correccionPayload.accion || correccionPayload.tipo || '').toUpperCase();
    let res = null;
    let impactoEsperado = 0;
    let artLog = correccionPayload.articulo || correccionPayload.codigo_articulo || (prev.movimientoAfectado ? prev.movimientoAfectado.articulo : '');
    let envLog = correccionPayload.envase || correccionPayload.codigo_envase || (prev.movimientoAfectado ? prev.movimientoAfectado.envase : '');
    let cantLog = Number(correccionPayload.cajas || correccionPayload.nuevaCantidad || prev.cantidadDisponible || 0);
    let origenLog = `${artLog}|${envLog}`;
    let destinoLog = `${correccionPayload.nuevoArticulo || artLog}|${correccionPayload.nuevoEnvase || envLog}`;

    // 4. DESPACHO SEGÚN ACCIÓN
    switch (accion) {
      case 'ANULAR_ENTRADA': {
        res = this.movementService.anularEntrada(correccionPayload, usuario);
        impactoEsperado = -Number(res.cajasAnuladas || 0);
        cantLog = Number(res.cajasAnuladas || 0);
        destinoLog = 'ANULADO';
        break;
      }

      case 'ANULAR_SALIDA': {
        res = this.movementService.anularSalida(correccionPayload, usuario);
        impactoEsperado = Number(res.cajasRestauradas || 0);
        cantLog = Number(res.cajasRestauradas || 0);
        origenLog = 'SALIDA_ANULADA';
        destinoLog = 'STOCK_RESTITUIDO';
        break;
      }

      case 'CORRECCION_CANTIDAD_ENTRADA': {
        res = this.movementService.corregirCantidadEntrada(correccionPayload, usuario);
        impactoEsperado = Number(res.cajasAumentadas || 0) - Number(res.cajasReducidas || 0);
        cantLog = Number(res.cajasAumentadas || res.cajasReducidas || 0);
        break;
      }

      case 'CORRECCION_CANTIDAD_SALIDA': {
        res = this.movementService.corregirCantidadSalida(correccionPayload, usuario);
        impactoEsperado = Number(res.cajasRestauradas || 0) - Number(res.cajasDeducidas || 0);
        cantLog = Number(res.cajasRestauradas || res.cajasDeducidas || 0);
        break;
      }

      case 'CORRECCION_ENTRADA_PARCIAL':
      case 'CORREGIR_ENTRADA':
      case 'CAMBIAR_ARTICULO':
      case 'CAMBIAR_ENVASE':
      case 'CAMBIAR_CALIBRE': {
        res = this.movementService.corregirEntradaParcial(correccionPayload, usuario);
        impactoEsperado = 0; // Traspaso interno de existencias
        cantLog = Number(res.cajasReclasificadas || 0);
        origenLog = res.origen || origenLog;
        destinoLog = res.destino || destinoLog;
        break;
      }

      case 'DIVIDIR_ENTRADA': {
        res = this.movementService.dividirCapaEntrada(correccionPayload, usuario);
        impactoEsperado = 0; // Mismo total de existencias
        cantLog = Number(prev.cantidadOriginal || 0);
        destinoLog = 'LINEAS_DIVIDIDAS';
        break;
      }

      case 'MOVER_PARTIDA': {
        res = this.movementService.registrarMovimientoPartida({
          codigo_articulo: artLog,
          codigo_envase: envLog,
          partida_origen: correccionPayload.partidaOrigen || correccionPayload.partida_origen,
          partida_destino: correccionPayload.partidaDestino || correccionPayload.partida_destino,
          cajas: correccionPayload.cajas || correccionPayload.cantidad,
          motivo: 'MOVER_PARTIDA',
          observaciones: correccionPayload.observaciones || ''
        }, usuario);
        impactoEsperado = 0;
        cantLog = Number(correccionPayload.cajas || correccionPayload.cantidad);
        origenLog = correccionPayload.partidaOrigen || correccionPayload.partida_origen;
        destinoLog = correccionPayload.partidaDestino || correccionPayload.partida_destino;
        break;
      }

      default:
        throw new Error(`Acción de corrección histórica no reconocida: '${accion}'`);
    }

    if (!res || !res.success) {
      return res || { success: false, status: 'ERROR_DESCONOCIDO' };
    }

    // 5. CONCILIACIÓN MATEMÁTICA Y VERIFICACIÓN DE INTEGRIDAD
    const stockDespuesList = this.repo.getStockActual();
    const totalStockDespues = stockDespuesList.reduce((s, r) => s + Number(r.cajas_actuales || 0), 0);

    if (totalStockAntes + impactoEsperado !== totalStockDespues) {
      throw new Error(`ERROR DE INTEGRIDAD: Discrepancia matemática en stock tras corrección histórica. Antes: ${totalStockAntes}, Impacto: ${impactoEsperado}, Esperado: ${totalStockAntes + impactoEsperado}, Real: ${totalStockDespues}`);
    }

    // 6. TRAZABILIDAD SIMPLE EN LOG_OPERACIONES
    const logOperacion = {
      fecha_hora: new Date().toISOString(),
      usuario,
      operacion: accion,
      codigo_articulo: artLog,
      codigo_envase: envLog,
      cantidad_cajas: cantLog,
      origen: origenLog,
      destino: destinoLog,
      motivo: String(motivo).trim(),
      referencia: res.referenciaOperacion || res.movimientoId || correccionPayload.id_documento || 'CORRECCION_HISTORICA',
      estado: accion.startsWith('ANULAR') ? 'ANULADA' : 'CORREGIDA',
      observaciones: correccionPayload.observaciones || prev.impactoPotencial || `Corrección histórica: ${accion}`
    };

    if (this.repo && typeof this.repo.appendLogOperacion === 'function') {
      this.repo.appendLogOperacion(logOperacion);
    }

    return {
      success: true,
      semaforo: 'OK',
      estado: 'CORRECTA',
      ...res,
      conciliacion: {
        stockAntes: totalStockAntes,
        impacto: impactoEsperado,
        stockDespues: totalStockDespues,
        integridadVerificada: true
      },
      logOperacion
    };
  }

  // --- Helpers de conveniencia para Correcciones Históricas ---

  anularEntrada(params, usuario = 'OPERADOR') {
    return this.ejecutarCorreccionHistorica({ ...params, accion: 'ANULAR_ENTRADA' }, usuario);
  }

  anularSalida(params, usuario = 'OPERADOR') {
    return this.ejecutarCorreccionHistorica({ ...params, accion: 'ANULAR_SALIDA' }, usuario);
  }

  corregirEntrada(params, usuario = 'OPERADOR') {
    return this.ejecutarCorreccionHistorica({ ...params, accion: 'CORRECCION_ENTRADA_PARCIAL' }, usuario);
  }

  corregirSalida(params, usuario = 'OPERADOR') {
    return this.ejecutarCorreccionHistorica({ ...params, accion: 'CORRECCION_CANTIDAD_SALIDA' }, usuario);
  }

  dividirEntrada(params, usuario = 'OPERADOR') {
    return this.ejecutarCorreccionHistorica({ ...params, accion: 'DIVIDIR_ENTRADA' }, usuario);
  }
}

// Exportación compatible
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OperationalSafetyService
  };
}
