/**
 * STOCK-LIGHT — MovementService.js
 * 
 * Orquestador de Movimientos, Concurrencia y Transaccionalidad.
 * Coordina:
 * - DeduplicationService (detección de colisiones y duplicados)
 * - InventoryEngine (cálculo matemático FIFO puro en memoria)
 * - Repository (persistencia atómica en Google Sheets)
 * - LockService (bloqueo exclusivo para evitar condiciones de carrera)
 */

class MovementService {
  /**
   * @param {Object} options 
   * @param {Object} [options.repository]
   * @param {Object} [options.lockService]
   * @param {Object} [options.deduplicationService]
   * @param {Object} [options.inventoryEngine]
   */
  constructor(options = {}) {
    this.repo = options.repository || (typeof SheetsRepository !== 'undefined' ? new SheetsRepository() : null);
    this.lock = options.lockService || (typeof LockService !== 'undefined' ? LockService.getScriptLock() : null);
    
    // Inyección de servicios de dominio (compatible con Node.js y GAS)
    let DedupModule = options.deduplicationService || null;
    if (!DedupModule && typeof require !== 'undefined') {
      try {
        DedupModule = require('./DeduplicationService');
      } catch (e) {
        // ignore
      }
    }
    if (!DedupModule) {
      DedupModule = {
        checkDocumentDuplicate: (typeof checkDocumentDuplicate !== 'undefined' ? checkDocumentDuplicate : null),
        buildLineIdentityKey: (typeof buildLineIdentityKey !== 'undefined' ? buildLineIdentityKey : null),
        filterBatchForOverlaps: (typeof filterBatchForOverlaps !== 'undefined' ? filterBatchForOverlaps : null)
      };
    }
    this.dedup = DedupModule;

    let EngineModule = options.inventoryEngine || null;
    if (!EngineModule && typeof require !== 'undefined') {
      try {
        EngineModule = require('./InventoryEngine');
      } catch (e) {
        // ignore
      }
    }
    if (!EngineModule) {
      EngineModule = {
        buildStockKey: (typeof buildStockKey !== 'undefined' ? buildStockKey : null),
        processMovement: (typeof processMovement !== 'undefined' ? processMovement : null),
        rebuildStockFromMovements: (typeof rebuildStockFromMovements !== 'undefined' ? rebuildStockFromMovements : null)
      };
    }
    this.engine = EngineModule;

    this.defaultTenantId = options.defaultTenantId || 'DEFAULT';
    this.ingestionService = options.articuloEnvaseIngestionService || null;
  }

  /**
   * Adquiere el bloqueo exclusivo del script.
   * @param {number} timeoutMs 
   */
  _acquireLock(timeoutMs = 30000) {
    if (this.lock && typeof this.lock.waitLock === 'function') {
      const success = this.lock.waitLock(timeoutMs);
      if (!success) {
        throw new Error(`No se pudo adquirir el bloqueo de concurrencia tras ${timeoutMs}ms. Otra operación está en curso.`);
      }
    }
  }

  /**
   * Libera el bloqueo del script.
   */
  _releaseLock() {
    if (this.lock && typeof this.lock.releaseLock === 'function') {
      try {
        this.lock.releaseLock();
      } catch (e) {
        // En caso de que ya haya expirado o liberado
      }
    }
  }

  /**
   * Registra una ENTRADA a partir de un documento (Albarán de Compra o Recepción de Mercancía).
   * 
   * @param {Object} docPayload - Metadatos del documento:
   *   - sha256_hash, tipo_documento ('COMPRA'|'RECEPCION'), serie, numero, fecha_documento, entidad_nombre, drive_file_id, drive_url
   * @param {Array<Object>} lineas - Líneas de stock:
   *   - codigo_articulo, codigo_envase, cajas, partida (opcional), descripcion_articulo, descripcion_envase
   * @param {string} usuario 
   * @returns {Object} Resultado de la operación
   */
  registrarEntrada(docPayload, lineas = [], usuario = 'SISTEMA') {
    if (!lineas || lineas.length === 0) {
      throw new Error('El documento de entrada no contiene líneas de cajas.');
    }

    this._acquireLock(30000);
    try {
      // 1. Deduplicación
      const existingDocs = this.repo.getDocumentos();
      const dedupCheck = this.dedup.checkDocumentDuplicate(docPayload, existingDocs);
      if (dedupCheck.isDuplicate) {
        return {
          success: false,
          isDuplicate: true,
          status: 'DUPLICADO',
          reason: dedupCheck.reason,
          matchedDocument: dedupCheck.matchedDocument
        };
      }

      // 2. Comprobar si alguna línea tiene envase no resuelto, DEFAULT o requiere revisión humana
      const hasUnresolvedPackaging = lineas.some(l => 
        !l.codigo_envase || 
        l.codigo_envase === 'DEFAULT' || 
        l.codigo_envase === 'ENVASE_NO_DETERMINABLE_DESDE_PDF' ||
        l.incidencia === 'ENVASE_NO_DETERMINABLE_DESDE_PDF'
      );

      const docId = docPayload.id_documento || `DOC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      let totalCajas = lineas.reduce((acc, l) => acc + (Number(l.cajas) || 0), 0);

      // Si el documento está marcado como PENDIENTE_REVISION o contiene líneas ambiguas:
      if (docPayload.estado_proceso === 'PENDIENTE_REVISION' || hasUnresolvedPackaging) {
        const docRecord = {
          id_documento: docId,
          sha256_hash: docPayload.sha256_hash || '',
          tipo_documento: docPayload.tipo_documento || 'COMPRA',
          serie: String(docPayload.serie || '').trim(),
          numero: String(docPayload.numero || '').trim(),
          fecha_documento: docPayload.fecha_documento,
          entidad_nombre: docPayload.entidad_nombre || '',
          total_lineas: lineas.length,
          total_cajas: totalCajas,
          drive_file_id: docPayload.drive_file_id || '',
          drive_url: docPayload.drive_url || '',
          estado_proceso: 'PENDIENTE_REVISION',
          fecha_subida: new Date().toISOString(),
          usuario_subida: usuario
        };

        // Persistir ÚNICAMENTE la cabecera en DOCUMENTOS (cero movimientos, cero capas FIFO, cero stock_actual)
        this.repo.appendDocumento(docRecord);

        return {
          success: false,
          status: 'PENDIENTE_REVISION',
          documentoId: docId,
          totalCajas,
          lineasProcesadas: lineas.length,
          movimientosGenerados: [],
          reason: 'El documento contiene líneas con envase no determinable desde el PDF y requiere revisión humana.',
          requiresReview: true,
          lineasPendientes: lineas.map((l, idx) => ({
            lineIndex: l.lineIndex || (idx + 1),
            codigoArticulo: l.codigo_articulo,
            nombreArticulo: l.nombre_articulo || l.descripcion_articulo || '',
            cajas: l.cajas,
            partida: l.partida || '',
            incidencia: l.incidencia || (!l.codigo_envase ? 'ENVASE_NO_DETERMINABLE_DESDE_PDF' : null)
          }))
        };
      }

      // 3. Cargar estado actual de capas vivas y stock
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      // 4. Procesar cada línea en el motor de dominio
      const generatedMovements = [];
      const newLayers = [];

      for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];
        const cajas = Number(linea.cajas);

        const movInput = {
          tipo: 'ENTRADA',
          codigoArticulo: linea.codigo_articulo,
          codigoEnvase: linea.codigo_envase,
          cajas,
          partida: linea.partida || '',
          fecha: docPayload.fecha_documento,
          fechaHora: new Date().toISOString(),
          idDocumentoRef: docId,
          documentoRef: `${docPayload.serie}/${docPayload.numero}`,
          usuario
        };

        const res = this.engine.processMovement(movInput, currentLayers, currentStock);
        if (!res.success) {
          throw new Error(`Error inesperado al procesar entrada: ${res.message}`);
        }

        currentLayers = res.updatedLayers;
        Object.assign(currentStock, res.updatedStock);
        generatedMovements.push(res.generatedMovement);
        if (res.newLayer) newLayers.push(res.newLayer);
      }

      // 4. Preparar registro de documento
      const docRecord = {
        id_documento: docId,
        sha256_hash: docPayload.sha256_hash || '',
        tipo_documento: docPayload.tipo_documento,
        serie: String(docPayload.serie || '').trim(),
        numero: String(docPayload.numero || '').trim(),
        fecha_documento: docPayload.fecha_documento,
        entidad_nombre: docPayload.entidad_nombre || '',
        total_lineas: lineas.length,
        total_cajas: totalCajas,
        drive_file_id: docPayload.drive_file_id || '',
        drive_url: docPayload.drive_url || '',
        estado_proceso: 'CONFIRMADO',
        fecha_subida: new Date().toISOString(),
        usuario_subida: usuario
      };

      // 5. Preparar actualización de STOCK_ACTUAL
      const maestro = this.repo.getMaestro();
      const maestroMap = {};
      maestro.forEach(m => {
        const k = this.engine.buildStockKey(m.codigo_articulo, m.codigo_envase);
        maestroMap[k] = m;
      });

      const updatedStockRecords = Object.keys(currentStock).map(stockKey => {
        const [art, env] = stockKey.split('|');
        const m = maestroMap[stockKey] || {};
        return {
          stock_key: stockKey,
          codigo_articulo: art,
          nombre_articulo: m.nombre_articulo || '',
          codigo_envase: env,
          descripcion_envase: m.descripcion_envase || '',
          cajas_actuales: currentStock[stockKey],
          fecha_ultima_actualizacion: new Date().toISOString(),
          ultimo_movimiento_id: generatedMovements[generatedMovements.length - 1].id_movimiento
        };
      });

      // 6. Persistencia atómica en lote
      this.repo.appendDocumento(docRecord);
      this.repo.appendMovimientos(generatedMovements);
      this.repo.saveCapasFifo(currentLayers);
      this.repo.saveStockActual(updatedStockRecords);

      return {
        success: true,
        status: 'CONFIRMADO',
        documentoId: docId,
        totalCajas,
        lineasProcesadas: lineas.length,
        movimientosGenerados: generatedMovements.map(m => m.id_movimiento)
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Registra una SALIDA a partir de un Albarán de Salida.
   * Si no hay suficiente stock en alguna línea:
   * - BLOQUEA la mutación de capas y stock.
   * - Registra el documento como PENDIENTE_REVISION con detalle del déficit.
   * 
   * @param {Object} docPayload 
   * @param {Array<Object>} lineas 
   * @param {string} usuario 
   * @returns {Object}
   */
  registrarSalida(docPayload, lineas = [], usuario = 'SISTEMA') {
    if (!lineas || lineas.length === 0) {
      throw new Error('El documento de salida no contiene líneas.');
    }

    this._acquireLock(30000);
    try {
      // 1. Deduplicación
      const existingDocs = this.repo.getDocumentos();
      const dedupCheck = this.dedup.checkDocumentDuplicate(docPayload, existingDocs);
      if (dedupCheck.isDuplicate) {
        return {
          success: false,
          isDuplicate: true,
          status: 'DUPLICADO',
          reason: dedupCheck.reason,
          matchedDocument: dedupCheck.matchedDocument
        };
      }

      // 2. Cargar estado de capas y stock
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      // 3. Pre-validación de stock disponible para TODO el documento
      const deficitReports = [];
      const stockKeyNeeds = {};

      for (const linea of lineas) {
        const key = this.engine.buildStockKey(linea.codigo_articulo, linea.codigo_envase);
        const cajas = Number(linea.cajas);
        stockKeyNeeds[key] = (stockKeyNeeds[key] || 0) + cajas;
      }

      for (const key in stockKeyNeeds) {
        const disponible = currentStock[key] || 0;
        const solicitado = stockKeyNeeds[key];
        if (disponible < solicitado) {
          deficitReports.push({
            stockKey: key,
            disponible,
            solicitado,
            deficit: solicitado - disponible
          });
        }
      }

      const docId = docPayload.id_documento || `DOC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // Si existe déficit: NO TOCAR STOCK NI CAPAS FIFO. Registrar en revisión.
      if (deficitReports.length > 0) {
        const pendingDocRecord = {
          id_documento: docId,
          sha256_hash: docPayload.sha256_hash || '',
          tipo_documento: 'SALIDA',
          serie: String(docPayload.serie || '').trim(),
          numero: String(docPayload.numero || '').trim(),
          fecha_documento: docPayload.fecha_documento,
          entidad_nombre: docPayload.entidad_nombre || '',
          total_lineas: lineas.length,
          total_cajas: lineas.reduce((acc, l) => acc + Number(l.cajas), 0),
          drive_file_id: docPayload.drive_file_id || '',
          drive_url: docPayload.drive_url || '',
          estado_proceso: 'PENDIENTE_REVISION',
          fecha_subida: new Date().toISOString(),
          usuario_subida: usuario
        };

        this.repo.appendDocumento(pendingDocRecord);

        return {
          success: false,
          status: 'PENDIENTE_REVISION',
          errorCode: 'STOCK_INSUFICIENTE',
          message: 'Stock insuficiente para satisfacer la salida. El documento queda pendiente de revisión.',
          deficits: deficitReports,
          documentoId: docId
        };
      }

      // 4. Si hay stock suficiente: procesar deducciones FIFO
      const generatedMovements = [];
      let totalCajas = 0;

      for (const linea of lineas) {
        const cajas = Number(linea.cajas);
        totalCajas += cajas;

        const movInput = {
          tipo: 'SALIDA',
          codigoArticulo: linea.codigo_articulo,
          codigoEnvase: linea.codigo_envase,
          cajas,
          fecha: docPayload.fecha_documento,
          fechaHora: new Date().toISOString(),
          idDocumentoRef: docId,
          documentoRef: `${docPayload.serie}/${docPayload.numero}`,
          usuario
        };

        const res = this.engine.processMovement(movInput, currentLayers, currentStock);
        if (!res.success) {
          throw new Error(`Inconsistencia en deducción FIFO: ${res.message}`);
        }

        currentLayers = res.updatedLayers;
        Object.assign(currentStock, res.updatedStock);
        if (res.fifoConsumptions && res.fifoConsumptions.length > 0) {
          const obsExisting = res.generatedMovement.observaciones || '';
          res.generatedMovement.observaciones = obsExisting
            ? `${obsExisting} | FIFO:${JSON.stringify(res.fifoConsumptions)}`
            : `FIFO:${JSON.stringify(res.fifoConsumptions)}`;
        }
        generatedMovements.push(res.generatedMovement);
      }

      // 5. Persistir documento aprobado y movimientos
      const docRecord = {
        id_documento: docId,
        sha256_hash: docPayload.sha256_hash || '',
        tipo_documento: 'SALIDA',
        serie: String(docPayload.serie || '').trim(),
        numero: String(docPayload.numero || '').trim(),
        fecha_documento: docPayload.fecha_documento,
        entidad_nombre: docPayload.entidad_nombre || '',
        total_lineas: lineas.length,
        total_cajas: totalCajas,
        drive_file_id: docPayload.drive_file_id || '',
        drive_url: docPayload.drive_url || '',
        estado_proceso: 'CONFIRMADO',
        fecha_subida: new Date().toISOString(),
        usuario_subida: usuario
      };

      const maestro = this.repo.getMaestro();
      const maestroMap = {};
      maestro.forEach(m => {
        const k = this.engine.buildStockKey(m.codigo_articulo, m.codigo_envase);
        maestroMap[k] = m;
      });

      const updatedStockRecords = Object.keys(currentStock).map(stockKey => {
        const [art, env] = stockKey.split('|');
        const m = maestroMap[stockKey] || {};
        return {
          stock_key: stockKey,
          codigo_articulo: art,
          nombre_articulo: m.nombre_articulo || '',
          codigo_envase: env,
          descripcion_envase: m.descripcion_envase || '',
          cajas_actuales: currentStock[stockKey],
          fecha_ultima_actualizacion: new Date().toISOString(),
          ultimo_movimiento_id: generatedMovements[generatedMovements.length - 1].id_movimiento
        };
      });

      this.repo.appendDocumento(docRecord);
      this.repo.appendMovimientos(generatedMovements);
      this.repo.saveCapasFifo(currentLayers);
      this.repo.saveStockActual(updatedStockRecords);

      return {
        success: true,
        status: 'CONFIRMADO',
        documentoId: docId,
        totalCajas,
        lineasProcesadas: lineas.length,
        movimientosGenerados: generatedMovements.map(m => m.id_movimiento)
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Registra un AJUSTE manual de inventario (incluyendo STOCK_INICIAL, MERMA, ROTURA, etc.).
   * 
   * @param {Object} ajusteInput:
   *   - codigo_articulo, codigo_envase, cajas, signo (+1 o -1), motivo, observaciones
   * @param {string} usuario 
   * @returns {Object}
   */
  registrarAjuste(ajusteInput, usuario = 'SISTEMA') {
    this._acquireLock(30000);
    try {
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      const movInput = {
        tipo: 'AJUSTE',
        codigoArticulo: ajusteInput.codigo_articulo,
        codigoEnvase: ajusteInput.codigo_envase,
        cajas: Number(ajusteInput.cajas),
        signo: Number(ajusteInput.signo),
        motivo: ajusteInput.motivo,
        partida: ajusteInput.partida || '',
        observaciones: ajusteInput.observaciones || '',
        usuario,
        fecha: ajusteInput.fecha || new Date().toISOString().slice(0, 10),
        fechaHora: new Date().toISOString(),
        documentoRef: `AJUSTE:${ajusteInput.motivo}`
      };

      const res = this.engine.processMovement(movInput, currentLayers, currentStock);
      if (!res.success) {
        return res; // Retornar STOCK_INSUFICIENTE si intentó ajustar en negativo más de lo que había
      }

      currentLayers = res.updatedLayers;
      Object.assign(currentStock, res.updatedStock);

      const maestro = this.repo.getMaestro();
      const maestroMap = {};
      maestro.forEach(m => {
        const k = this.engine.buildStockKey(m.codigo_articulo, m.codigo_envase);
        maestroMap[k] = m;
      });

      const updatedStockRecords = Object.keys(currentStock).map(stockKey => {
        const [art, env] = stockKey.split('|');
        const m = maestroMap[stockKey] || {};
        return {
          stock_key: stockKey,
          codigo_articulo: art,
          nombre_articulo: m.nombre_articulo || '',
          codigo_envase: env,
          descripcion_envase: m.descripcion_envase || '',
          cajas_actuales: currentStock[stockKey],
          fecha_ultima_actualizacion: new Date().toISOString(),
          ultimo_movimiento_id: res.generatedMovement.id_movimiento
        };
      });

      this.repo.appendMovimientos([res.generatedMovement]);
      this.repo.saveCapasFifo(currentLayers);
      this.repo.saveStockActual(updatedStockRecords);

      return {
        success: true,
        status: 'CONFIRMADO',
        stockKey: res.stockKey,
        cajasAfectadas: res.cajasAfectadas,
        stockAnterior: res.stockAnterior,
        stockNuevo: res.stockNuevo,
        movimientoId: res.generatedMovement.id_movimiento
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Registra un ajuste positivo manual en el inventario.
   * Crea una nueva capa FIFO y actualiza STOCK_ACTUAL y MOVIMIENTOS.
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  registrarAjustePositivo(params, usuario = 'SISTEMA') {
    return this.registrarAjuste({
      codigo_articulo: params.codigo_articulo || params.codigoArticulo,
      codigo_envase: params.codigo_envase || params.codigoEnvase,
      cajas: Math.abs(Number(params.cajas)),
      signo: 1,
      motivo: params.motivo || 'AJUSTE_POSITIVO',
      partida: params.partida || '',
      observaciones: params.observaciones || '',
      fecha: params.fecha
    }, usuario);
  }

  /**
   * Registra un ajuste negativo manual en el inventario.
   * Deduce cajas consumiendo capas FIFO por orden de antigüedad.
   * Si no hay suficiente stock, rechaza la operación sin alterar inventario.
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  registrarAjusteNegativo(params, usuario = 'SISTEMA') {
    return this.registrarAjuste({
      codigo_articulo: params.codigo_articulo || params.codigoArticulo,
      codigo_envase: params.codigo_envase || params.codigoEnvase,
      cajas: Math.abs(Number(params.cajas)),
      signo: -1,
      motivo: params.motivo || 'AJUSTE_NEGATIVO',
      partida: params.partida || '',
      observaciones: params.observaciones || '',
      fecha: params.fecha
    }, usuario);
  }

  /**
   * Registra una reclasificación u operación de traspaso entre dos combinaciones de stock
   * (ejemplo: 10 cajas de Rosa Cartón a Rosa EPS).
   * 
   * Ejecuta atómicamente:
   * 1. Salida/Ajuste negativo en la combinación origen (consumiendo FIFO).
   * 2. Entrada/Ajuste positivo en la combinación destino (creando nueva capa FIFO).
   * 3. Ambas operaciones quedan vinculadas por la misma referencia en MOVIMIENTOS.
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  registrarReclasificacion(params, usuario = 'SISTEMA') {
    const artOrigen = params.codigo_articulo_origen || params.codigo_articulo || params.codigoArticulo;
    const artDestino = params.codigo_articulo_destino || params.codigo_articulo || params.codigoArticulo;
    const envOrigen = params.codigo_envase_origen || params.codigoEnvaseOrigen;
    const envDestino = params.codigo_envase_destino || params.codigoEnvaseDestino;
    const cajas = Math.abs(Number(params.cajas));
    const motivo = params.motivo || 'RECLASIFICACION';
    const observaciones = params.observaciones || `Reclasificación de ${cajas} cajas de ${artOrigen}|${envOrigen} a ${artDestino}|${envDestino}`;

    if (!artOrigen || !artDestino || !envOrigen || !envDestino || !cajas || cajas <= 0) {
      throw new Error('registrarReclasificacion: Parámetros inválidos. Requiere articulo, envase origen, envase destino y cajas > 0.');
    }

    if (artOrigen === artDestino && envOrigen === envDestino) {
      throw new Error('registrarReclasificacion: Origen y destino no pueden ser idénticos.');
    }

    this._acquireLock(30000);
    try {
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      const keyOrigen = this.engine.buildStockKey(artOrigen, envOrigen);
      const stockDisp = currentStock[keyOrigen] || 0;
      if (stockDisp < cajas) {
        return {
          success: false,
          status: 'STOCK_INSUFICIENTE',
          message: `Stock insuficiente en origen (${keyOrigen}). Disponible: ${stockDisp}, Solicitado: ${cajas}`,
          disponible: stockDisp,
          solicitado: cajas
        };
      }

      const refOperacion = `RECLASIF:${Date.now()}`;
      const fechaHoy = params.fecha || new Date().toISOString().slice(0, 10);
      const nowIso = new Date().toISOString();

      // 1. Movimiento de Salida (Ajuste Negativo)
      const movSalidaInput = {
        tipo: 'AJUSTE',
        codigoArticulo: artOrigen,
        codigoEnvase: envOrigen,
        cajas: cajas,
        signo: -1,
        motivo: `${motivo}_ORIGEN`,
        observaciones: `${observaciones} (SALIDA)`,
        usuario,
        fecha: fechaHoy,
        fechaHora: nowIso,
        documentoRef: refOperacion
      };

      const resSalida = this.engine.processMovement(movSalidaInput, currentLayers, currentStock);
      if (!resSalida.success) {
        return resSalida;
      }
      currentLayers = resSalida.updatedLayers;
      Object.assign(currentStock, resSalida.updatedStock);

      // 2. Movimiento de Entrada (Ajuste Positivo)
      const movEntradaInput = {
        tipo: 'AJUSTE',
        codigoArticulo: artDestino,
        codigoEnvase: envDestino,
        cajas: cajas,
        signo: 1,
        motivo: `${motivo}_DESTINO`,
        observaciones: `${observaciones} (ENTRADA)`,
        usuario,
        fecha: fechaHoy,
        fechaHora: nowIso,
        documentoRef: refOperacion,
        partida: params.partida || ''
      };

      const resEntrada = this.engine.processMovement(movEntradaInput, currentLayers, currentStock);
      if (!resEntrada.success) {
        throw new Error(`Error en reclasificación destino: ${resEntrada.message}`);
      }
      currentLayers = resEntrada.updatedLayers;
      Object.assign(currentStock, resEntrada.updatedStock);

      // 3. Actualizar registros en STOCK_ACTUAL
      const maestro = this.repo.getMaestro();
      const maestroMap = {};
      maestro.forEach(m => {
        const k = this.engine.buildStockKey(m.codigo_articulo, m.codigo_envase);
        maestroMap[k] = m;
      });

      const updatedStockRecords = Object.keys(currentStock).map(stockKey => {
        const [art, env] = stockKey.split('|');
        const m = maestroMap[stockKey] || {};
        return {
          stock_key: stockKey,
          codigo_articulo: art,
          nombre_articulo: m.nombre_articulo || '',
          codigo_envase: env,
          descripcion_envase: m.descripcion_envase || '',
          cajas_actuales: currentStock[stockKey],
          fecha_ultima_actualizacion: nowIso,
          ultimo_movimiento_id: resEntrada.generatedMovement.id_movimiento
        };
      });

      // 4. Persistencia en lote
      this.repo.appendMovimientos([resSalida.generatedMovement, resEntrada.generatedMovement]);
      this.repo.saveCapasFifo(currentLayers);
      this.repo.saveStockActual(updatedStockRecords);

      return {
        success: true,
        status: 'CONFIRMADO',
        referenciaOperacion: refOperacion,
        movimientoSalidaId: resSalida.generatedMovement.id_movimiento,
        movimientoEntradaId: resEntrada.generatedMovement.id_movimiento,
        cajasReclasificadas: cajas,
        origen: {
          stockKey: keyOrigen,
          stockAnterior: resSalida.stockAnterior,
          stockNuevo: resSalida.stockNuevo
        },
        destino: {
          stockKey: this.engine.buildStockKey(artDestino, envDestino),
          stockAnterior: resEntrada.stockAnterior,
          stockNuevo: resEntrada.stockNuevo
        }
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Mueve cajas entre partidas dentro del mismo artículo y envase.
   * Deduce cajas de la partida origen y crea una nueva capa para la partida destino,
   * preservando el total de stock_key y registrando ambos movimientos vinculados.
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  registrarMovimientoPartida(params, usuario = 'SISTEMA') {
    const art = params.codigo_articulo || params.codigoArticulo;
    const env = params.codigo_envase || params.codigoEnvase;
    const partidaOrigen = params.partida_origen || params.partidaOrigen;
    const partidaDestino = params.partida_destino || params.partidaDestino;
    const cajas = Math.abs(Number(params.cajas));
    const motivo = params.motivo || 'MOVER_PARTIDA';
    const observaciones = params.observaciones || `Movimiento de ${cajas} cajas de partida ${partidaOrigen} a ${partidaDestino}`;

    if (!art || !env || !partidaOrigen || !partidaDestino || !cajas || cajas <= 0) {
      throw new Error('registrarMovimientoPartida: Requiere articulo, envase, partidaOrigen, partidaDestino y cajas > 0.');
    }
    if (partidaOrigen === partidaDestino) {
      throw new Error('registrarMovimientoPartida: Partida origen y destino no pueden ser idénticas.');
    }

    this._acquireLock(30000);
    try {
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      const key = this.engine.buildStockKey(art, env);
      const capasOrigen = currentLayers.filter(c => 
        this.engine.buildStockKey(c.codigo_articulo, c.codigo_envase) === key &&
        (c.partida === partidaOrigen || c.partida_id === partidaOrigen) &&
        Number(c.cajas_restantes || 0) > 0
      );
      const dispEnPartida = capasOrigen.reduce((sum, c) => sum + Number(c.cajas_restantes || 0), 0);
      if (dispEnPartida < cajas) {
        return {
          success: false,
          status: 'STOCK_INSUFICIENTE',
          errorCode: 'STOCK_INSUFICIENTE',
          message: `Stock insuficiente en partida ${partidaOrigen} para ${key}. Disponible en partida: ${dispEnPartida}, Solicitado: ${cajas}`,
          disponibleEnPartida: dispEnPartida,
          solicitado: cajas,
          deficit: cajas - dispEnPartida
        };
      }

      const refOperacion = `MOV_PARTIDA:${Date.now()}`;
      const fechaHoy = params.fecha || new Date().toISOString().slice(0, 10);
      const nowIso = new Date().toISOString();

      let porDescontar = cajas;
      for (const capa of capasOrigen) {
        if (porDescontar <= 0) break;
        const dispCapa = Number(capa.cajas_restantes || 0);
        const aRestar = Math.min(porDescontar, dispCapa);
        capa.cajas_consumidas = Number(capa.cajas_consumidas || 0) + aRestar;
        capa.cajas_restantes = dispCapa - aRestar;
        if (capa.cajas_restantes === 0) {
          capa.estado_capa = 'AGOTADA';
        }
        porDescontar -= aRestar;
      }

      const idCapaNueva = `CAPA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const nuevaCapa = {
        id_capa: idCapaNueva,
        id_movimiento_entrada: refOperacion,
        fecha_capa: fechaHoy,
        codigo_articulo: art,
        codigo_envase: env,
        cajas_iniciales: cajas,
        cajas_consumidas: 0,
        cajas_restantes: cajas,
        estado_capa: 'ACTIVA',
        partida: partidaDestino,
        documento_ref: refOperacion
      };
      currentLayers.push(nuevaCapa);

      const movSalida = {
        id_movimiento: `MOV-${Date.now()}-1`,
        fecha_hora: nowIso,
        tipo_movimiento: 'AJUSTE',
        id_documento_ref: refOperacion,
        codigo_articulo: art,
        codigo_envase: env,
        cajas: cajas,
        signo: -1,
        partida_origen: partidaOrigen,
        motivo_ajuste: `${motivo}_ORIGEN`,
        usuario,
        observaciones: `${observaciones} (ORIGEN)`,
        estado: 'CONFIRMADO'
      };

      const movEntrada = {
        id_movimiento: `MOV-${Date.now()}-2`,
        fecha_hora: nowIso,
        tipo_movimiento: 'AJUSTE',
        id_documento_ref: refOperacion,
        codigo_articulo: art,
        codigo_envase: env,
        cajas: cajas,
        signo: 1,
        partida_origen: partidaDestino,
        motivo_ajuste: `${motivo}_DESTINO`,
        usuario,
        observaciones: `${observaciones} (DESTINO)`,
        estado: 'CONFIRMADO'
      };

      this.repo.appendMovimientos([movSalida, movEntrada]);
      this.repo.saveCapasFifo(currentLayers);

      const maestro = this.repo.getMaestro();
      const maestroMap = {};
      maestro.forEach(m => {
        const k = this.engine.buildStockKey(m.codigo_articulo, m.codigo_envase);
        maestroMap[k] = m;
      });
      const updatedStockRecords = Object.keys(currentStock).map(stockKey => {
        const [a, e] = stockKey.split('|');
        const m = maestroMap[stockKey] || {};
        return {
          stock_key: stockKey,
          codigo_articulo: a,
          nombre_articulo: m.nombre_articulo || '',
          codigo_envase: e,
          descripcion_envase: m.descripcion_envase || '',
          cajas_actuales: currentStock[stockKey],
          fecha_ultima_actualizacion: nowIso,
          ultimo_movimiento_id: movEntrada.id_movimiento
        };
      });
      this.repo.saveStockActual(updatedStockRecords);

      return {
        success: true,
        status: 'CONFIRMADO',
        referenciaOperacion: refOperacion,
        movimientoSalidaId: movSalida.id_movimiento,
        movimientoEntradaId: movEntrada.id_movimiento,
        cajasMovidas: cajas,
        partidaOrigen,
        partidaDestino
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Reconstruye determinísticamente el stock actual y las capas FIFO a partir de la totalidad
   * de movimientos confirmados.
   * No altera los registros de la tabla MOVIMIENTOS.
   * 
   * @returns {Object} Informe de auditoría y conciliación
   */
  rebuildStock() {
    this._acquireLock(30000);
    try {
      const allMovements = this.repo.getMovimientos();
      const maestro = this.repo.getMaestro();

      const report = this.engine.rebuildStockFromMovements(allMovements, maestro);

      const maestroMap = {};
      maestro.forEach(m => {
        const k = this.engine.buildStockKey(m.codigo_articulo, m.codigo_envase);
        maestroMap[k] = m;
      });

      const updatedStockRecords = Object.keys(report.stockMap).map(stockKey => {
        const [art, env] = stockKey.split('|');
        const m = maestroMap[stockKey] || {};
        return {
          stock_key: stockKey,
          codigo_articulo: art,
          nombre_articulo: m.nombre_articulo || '',
          codigo_envase: env,
          descripcion_envase: m.descripcion_envase || '',
          cajas_actuales: report.stockMap[stockKey],
          fecha_ultima_actualizacion: new Date().toISOString(),
          ultimo_movimiento_id: 'REBUILD'
        };
      });

      // Sobrescribir capas FIFO regeneradas y STOCK_ACTUAL
      this.repo.saveCapasFifo(report.reconstructedLayers);
      this.repo.saveStockActual(updatedStockRecords);

      return {
        success: true,
        report
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Confirma un documento de compra en estado PENDIENTE_REVISION tras resolución de envases por el operador.
   * Aplica validación estricta de servidor (Trust Boundary):
   * - El cliente envía EXCLUSIVAMENTE: { idDocumento, lineResolutions }.
   * - El cliente NO puede enviar rawText, líneas, artículos ni cajas.
   * - Las líneas canónicas se obtienen EXCLUSIVAMENTE de una fuente controlada por el servidor:
   *   a) Documento original en Google Drive (doc.drive_file_id), re-extraído y re-parseado por el servidor.
   *   b) Staging persistido en el servidor (serverContext.canonicalLines o serverContext.serverStaging).
   * - Se validan estrictamente las cajas y líneas totales contra la cabecera custodiada en DOCUMENTOS.
   * - Cada envase elegido se valida contra MAESTRO para ese artículo concreto.
   * - Se prohíben absolutamente 'DEFAULT' y 'ENVASE_NO_DETERMINABLE_DESDE_PDF'.
   * 
   * @param {Object} clientPayload - { idDocumento, lineResolutions } (ENTRADA EXCLUSIVA DEL CLIENTE)
   * @param {string} [usuario='OPERADOR']
   * @param {Object} [resolverParam=null]
   * @param {Object} [serverContext={}] - CONTEXTO Y FUENTES CONTROLADAS EXCLUSIVAMENTE POR EL SERVIDOR
   * @returns {Object} Resultado de la confirmación
   */
  confirmarCompraPendiente(clientPayload = {}, usuario = 'OPERADOR', resolverParam = null, serverContext = {}) {
    if (!clientPayload || typeof clientPayload !== 'object') {
      throw new Error('Trust Boundary violado: Se requiere un objeto de parámetros válido.');
    }

    // Regla de Trust Boundary 1: El cliente NO puede enviar rawText
    if (clientPayload.rawText) {
      throw new Error('Trust Boundary violado: El cliente no puede enviar rawText para confirmar compras. El contenido documental debe proceder exclusivamente de fuentes controladas por el servidor (Drive o staging).');
    }

    // Regla de Trust Boundary 2: El cliente NO puede enviar líneas, cajas ni artículos en su payload
    if (clientPayload.lines || clientPayload.canonicalLines) {
      throw new Error('Trust Boundary violado: El cliente no puede suministrar líneas ni cantidades de stock. La estructura procede exclusivamente de fuentes controladas por el servidor.');
    }

    if (clientPayload.codigoArticulo) {
      throw new Error('Trust Boundary violado: El cliente no puede manipular codigoArticulo en el payload.');
    }

    const serverTenant = String(serverContext.tenantId || this.defaultTenantId || 'DEFAULT').trim();
    if (clientPayload.tenant_id && String(clientPayload.tenant_id).trim() !== serverTenant) {
      throw new Error(`Trust Boundary violado: El tenant_id manipulado ('${clientPayload.tenant_id}') no coincide con el tenant autorizado del servidor ('${serverTenant}').`);
    }
    if (clientPayload.tenantId && String(clientPayload.tenantId).trim() !== serverTenant) {
      throw new Error(`Trust Boundary violado: El tenantId manipulado ('${clientPayload.tenantId}') no coincide con el tenant autorizado del servidor ('${serverTenant}').`);
    }

    const { idDocumento, lineResolutions = [] } = clientPayload;

    if (!idDocumento) {
      throw new Error('Trust Boundary violado: Se requiere idDocumento para confirmar compra pendiente.');
    }

    // Validar cada resolución provista por el operador
    for (const res of lineResolutions) {
      if (res && res.codigoArticulo) {
        throw new Error(`Trust Boundary violado: El cliente no puede manipular codigoArticulo en lineResolutions ('${res.codigoArticulo}').`);
      }
      if (res && res.tenant_id && String(res.tenant_id).trim() !== serverTenant) {
        throw new Error(`Trust Boundary violado: El tenant_id en lineResolutions ('${res.tenant_id}') no coincide con el tenant autorizado.`);
      }
      if (res && res.tenantId && String(res.tenantId).trim() !== serverTenant) {
        throw new Error(`Trust Boundary violado: El tenantId en lineResolutions no coincide con el tenant autorizado.`);
      }
      if (res && res.cajas !== undefined) {
        throw new Error(`Trust Boundary violado: El cliente no puede manipular la cantidad de cajas en lineResolutions.`);
      }
    }

    this._acquireLock(30000);
    try {
      // 1. Verificar existencia y estado del documento en persistencia
      const existingDocs = this.repo.getDocumentos();
      const doc = existingDocs.find(d => String(d.id_documento || '').trim() === String(idDocumento).trim());
      if (!doc) {
        throw new Error(`Trust Boundary violado: Documento con ID '${idDocumento}' no existe en persistencia.`);
      }

      if (doc.estado_proceso === 'CONFIRMADO') {
        throw new Error(`Trust Boundary violado: El documento '${idDocumento}' (${doc.serie}/${doc.numero}) ya ha sido confirmado previamente.`);
      }

      if (doc.estado_proceso !== 'PENDIENTE_REVISION') {
        throw new Error(`Trust Boundary violado: El documento '${idDocumento}' no se encuentra en estado PENDIENTE_REVISION (estado actual: ${doc.estado_proceso}).`);
      }

      // 2. Cargar Maestro para validar envases permitidos
      const maestroRecords = this.repo.getMaestro();
      const ResolverClass = (typeof MaestroResolver !== 'undefined')
        ? MaestroResolver
        : (typeof require !== 'undefined' ? require('./MaestroResolver').MaestroResolver : null);
      const resolver = resolverParam || (ResolverClass ? new ResolverClass(maestroRecords) : null);
      if (!resolver) {
        throw new Error('No se pudo inicializar MaestroResolver para validar envases de compra.');
      }

      // 3. Preparar mapa de resoluciones del operador por lineIndex
      const resolutionMap = new Map();
      for (const res of lineResolutions) {
        const idx = Number(res.lineIndex);
        const env = String(res.codigoEnvase || '').trim();
        if (isNaN(idx) || idx <= 0) {
          throw new Error(`Trust Boundary violado: lineIndex inválido ('${res.lineIndex}').`);
        }
        if (!env || env === 'DEFAULT' || env === 'ENVASE_NO_DETERMINABLE_DESDE_PDF') {
          throw new Error(`Trust Boundary violado: El envase '${env}' no es un envase comercial válido de stock.`);
        }
        resolutionMap.set(idx, {
          codigoEnvase: env,
          recordar: Boolean(res.recordar),
          esPredeterminado: Boolean(res.esPredeterminado !== undefined ? res.esPredeterminado : res.establecerPredeterminado)
        });
      }

      // 4. Obtención de líneas originales EXCLUSIVAMENTE desde fuente controlada por el servidor:
      let linesToProcess = [];

      // Vía A: Re-extracción / re-parseo autónomo desde Google Drive por doc.drive_file_id
      if (doc.drive_file_id) {
        const driveService = this.driveService || serverContext.driveService || (typeof DriveService !== 'undefined' ? DriveService : null);
        if (driveService && typeof driveService.extractTextFromDriveFile === 'function') {
          const serverRawText = driveService.extractTextFromDriveFile(doc.drive_file_id);
          const parser = (typeof CompraParser !== 'undefined' && CompraParser.parse)
            ? CompraParser
            : (typeof require !== 'undefined' ? require('./parsers/CompraParser').CompraParser : null);
          if (parser) {
            const parsedDoc = parser.parse(serverRawText, { fileName: `${doc.serie || ''}_${doc.numero || ''}.pdf` });
            linesToProcess = parsedDoc.lines || [];
          }
        }
      }

      // Vía B: Staging persistido por el servidor (serverContext controlado por backend)
      if (linesToProcess.length === 0) {
        if (serverContext.serverStaging && typeof serverContext.serverStaging.getLines === 'function') {
          linesToProcess = serverContext.serverStaging.getLines(idDocumento);
        } else if (serverContext.canonicalLines && Array.isArray(serverContext.canonicalLines)) {
          linesToProcess = serverContext.canonicalLines;
        }
      }

      if (linesToProcess.length === 0) {
        throw new Error(`Trust Boundary violado: No se dispone de líneas canónicas en fuentes controladas por el servidor (Drive o staging) para confirmar el documento '${idDocumento}'.`);
      }

      // Validación estricta de coherencia física contra el documento original persistido en DOCUMENTOS
      if (doc.total_lineas !== undefined && doc.total_lineas !== null && linesToProcess.length !== Number(doc.total_lineas)) {
        throw new Error(`Trust Boundary violado: El número de líneas recibidas (${linesToProcess.length}) no coincide con el total registrado en el documento original (${doc.total_lineas}).`);
      }

      // 5. Validar cada línea contra MAESTRO
      const resolvedLines = [];
      let totalCajas = 0;

      for (let i = 0; i < linesToProcess.length; i++) {
        const rawLine = linesToProcess[i];
        const lineIdx = rawLine.lineIndex || (i + 1);
        const cajas = Number(rawLine.boxes !== undefined ? rawLine.boxes : rawLine.cajas);
        if (isNaN(cajas) || cajas <= 0) {
          throw new Error(`Trust Boundary violado: Línea ${lineIdx} con cantidad de cajas inválida (${cajas}).`);
        }
        totalCajas += cajas;

        // Resolver artículo canónico
        let artCode = rawLine.articleCode || rawLine.codigo_articulo;
        let artName = rawLine.articleName || rawLine.nombre_articulo;
        const artRes = resolver.resolveArticle(artCode, artName);
        if (artRes.resolved) {
          artCode = artRes.code;
          artName = artRes.name;
        } else {
          throw new Error(`Trust Boundary violado: Línea ${lineIdx}: Artículo '${artName}' no existe en MAESTRO.`);
        }

        // Determinar envase: provisto en resolutionMap o ya resuelto previamente
        const userRes = resolutionMap.get(lineIdx);
        let envCode = (userRes && userRes.codigoEnvase) ? userRes.codigoEnvase : (rawLine.envaseCode || rawLine.codigo_envase);
        if (!envCode || envCode === 'DEFAULT' || envCode === 'ENVASE_NO_DETERMINABLE_DESDE_PDF') {
          throw new Error(`Trust Boundary violado: Línea ${lineIdx} (${artName}) no tiene un envase asignado.`);
        }

        // Validar que el envase está permitido para este artículo en MAESTRO
        if (!resolver.isEnvasePermitidoParaArticulo(artCode, envCode, serverTenant)) {
          const permitidos = resolver.getEnvasesPermitidos(artCode, serverTenant).map(p => p.codigo_envase).join(', ');
          throw new Error(`Trust Boundary violado: El envase '${envCode}' no está permitido para el artículo '${artCode}' (${artName}) en MAESTRO. Opciones permitidas: [${permitidos}].`);
        }

        resolvedLines.push({
          lineIndex: lineIdx,
          codigo_articulo: artCode,
          nombre_articulo: artName,
          codigo_envase: envCode,
          cajas,
          partida: rawLine.lot || rawLine.partida || '',
          recordar: userRes ? userRes.recordar : false,
          esPredeterminado: userRes ? userRes.esPredeterminado : false
        });
      }

      // Validación estricta de bultos totales contra la cabecera canónica persistida en DOCUMENTOS
      if (doc.total_cajas !== undefined && doc.total_cajas !== null && totalCajas !== Number(doc.total_cajas)) {
        throw new Error(`Trust Boundary violado: El total de cajas procesadas (${totalCajas}) no coincide con el total de cajas del documento original (${doc.total_cajas}).`);
      }

      // 6. Cargar capas FIFO y stock actual
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      const generatedMovements = [];
      const newLayers = [];

      for (const linea of resolvedLines) {
        const movInput = {
          tipo: 'ENTRADA',
          codigoArticulo: linea.codigo_articulo,
          codigoEnvase: linea.codigo_envase,
          cajas: linea.cajas,
          partida: linea.partida || '',
          fecha: doc.fecha_documento,
          fechaHora: new Date().toISOString(),
          idDocumentoRef: idDocumento,
          documentoRef: `${doc.serie}/${doc.numero}`,
          usuario
        };

        const res = this.engine.processMovement(movInput, currentLayers, currentStock);
        if (!res.success) {
          throw new Error(`Error inesperado al procesar entrada: ${res.message}`);
        }

        currentLayers = res.updatedLayers;
        Object.assign(currentStock, res.updatedStock);
        generatedMovements.push(res.generatedMovement);
        if (res.newLayer) newLayers.push(res.newLayer);
      }

      // 7. Preparar actualización de STOCK_ACTUAL
      const maestroMap = {};
      maestroRecords.forEach(m => {
        const k = this.engine.buildStockKey(m.codigo_articulo, m.codigo_envase);
        maestroMap[k] = m;
      });

      const updatedStockRecords = Object.keys(currentStock).map(stockKey => {
        const [art, env] = stockKey.split('|');
        const m = maestroMap[stockKey] || {};
        return {
          stock_key: stockKey,
          codigo_articulo: art,
          nombre_articulo: m.nombre_articulo || '',
          codigo_envase: env,
          descripcion_envase: m.descripcion_envase || '',
          cajas_actuales: currentStock[stockKey],
          fecha_ultima_actualizacion: new Date().toISOString(),
          ultimo_movimiento_id: generatedMovements[generatedMovements.length - 1].id_movimiento
        };
      });

      // 8. Actualizar DOCUMENTOS: cambiar estado a 'CONFIRMADO'
      if (typeof this.repo.updateDocumentoEstado === 'function') {
        this.repo.updateDocumentoEstado(idDocumento, 'CONFIRMADO');
      } else {
        doc.estado_proceso = 'CONFIRMADO';
        this.repo.replaceTable('DOCUMENTOS', existingDocs);
      }

      // 9. Persistir movimientos, capas y stock
      this.repo.appendMovimientos(generatedMovements);
      this.repo.saveCapasFifo(currentLayers);
      this.repo.saveStockActual(updatedStockRecords);

      // 10. Persistir aprendizaje dinámico si se especificó 'recordar: true'
      const rememberedAssociations = [];
      const IngestionServiceClass = (typeof ArticuloEnvaseIngestionService !== 'undefined')
        ? ArticuloEnvaseIngestionService
        : (typeof require !== 'undefined' ? require('./ArticuloEnvaseIngestionService').ArticuloEnvaseIngestionService : null);

      const ingestionService = this.ingestionService || (IngestionServiceClass ? new IngestionServiceClass({ repository: this.repo }) : null);

      for (const line of resolvedLines) {
        if (line.recordar && ingestionService) {
          const resAssoc = ingestionService.asociarArticuloEnvase({
            codigoArticulo: line.codigo_articulo,
            codigoEnvase: line.codigo_envase,
            nombreArticulo: line.nombre_articulo,
            esPredeterminado: line.esPredeterminado,
            tenantId: serverTenant
          });
          rememberedAssociations.push({
            codigoArticulo: line.codigo_articulo,
            codigoEnvase: line.codigo_envase,
            esPredeterminado: line.esPredeterminado,
            resultado: resAssoc
          });
        }
      }

      return {
        success: true,
        status: 'CONFIRMADO',
        documentoId: idDocumento,
        totalCajas,
        lineasProcesadas: resolvedLines.length,
        movimientosGenerados: generatedMovements.map(m => m.id_movimiento),
        asociacionesRecordadas: rememberedAssociations
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Helper privado para localizar una capa FIFO por diversos criterios deterministas.
   */
  _findLayer(currentLayers, params = {}) {
    if (params.id_capa) {
      const byId = currentLayers.find(l => l.id_capa === params.id_capa);
      if (byId) return byId;
    }
    if (params.id_movimiento) {
      const byMov = currentLayers.find(l => l.id_movimiento_entrada === params.id_movimiento);
      if (byMov) return byMov;
    }
    const docRef = (params.serie && params.numero)
      ? `${String(params.serie).trim()}/${String(params.numero).trim()}`
      : (params.id_documento || params.documentoRef || params.documento_ref);

    const art = params.articulo || params.codigo_articulo || params.codigoArticulo;
    const env = params.envase || params.codigo_envase || params.codigoEnvase;

    if (docRef) {
      const byDocRef = currentLayers.find(l => {
        const matchDoc = l.documento_ref === docRef || (l.id_movimiento_entrada && l.id_movimiento_entrada.includes(docRef));
        if (!matchDoc) return false;
        if (art && l.codigo_articulo !== art) return false;
        if (env && l.codigo_envase !== env) return false;
        return true;
      });
      if (byDocRef) return byDocRef;
    }

    if (art && env) {
      const key = this.engine.buildStockKey(art, env);
      const byKey = currentLayers.find(l => 
        this.engine.buildStockKey(l.codigo_articulo, l.codigo_envase) === key &&
        (l.estado_capa === 'ACTIVA' || Number(l.cajas_restantes || 0) > 0)
      );
      if (byKey) return byKey;
    }

    return null;
  }

  /**
   * Helper privado para sincronizar la tabla STOCK_ACTUAL a partir de un mapa de saldos.
   */
  _syncStockActual(currentStock, ultimoMovId = '') {
    const maestro = this.repo.getMaestro();
    const maestroMap = {};
    maestro.forEach(m => {
      const k = this.engine.buildStockKey(m.codigo_articulo, m.codigo_envase);
      maestroMap[k] = m;
    });
    const updatedStockRecords = Object.keys(currentStock).map(stockKey => {
      const [a, e] = stockKey.split('|');
      const m = maestroMap[stockKey] || {};
      return {
        stock_key: stockKey,
        codigo_articulo: a,
        nombre_articulo: m.nombre_articulo || '',
        codigo_envase: e,
        descripcion_envase: m.descripcion_envase || '',
        cajas_actuales: Number(currentStock[stockKey] || 0),
        fecha_ultima_actualizacion: new Date().toISOString(),
        ultimo_movimiento_id: ultimoMovId || ''
      };
    });
    this.repo.saveStockActual(updatedStockRecords);
    return updatedStockRecords;
  }

  /**
   * Anula una entrada de inventario de forma segura y no destructiva.
   * Si la entrada ya tiene consumos posteriores, BLOQUEA la operación (REVISION_NECESARIA)
   * para evitar generar existencias negativas o descuadres históricos.
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  anularEntrada(params = {}, usuario = 'SISTEMA') {
    this._acquireLock(30000);
    try {
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      const layer = this._findLayer(currentLayers, params);
      if (!layer) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'CAPA_NO_ENCONTRADA',
          message: 'No se encontró la capa FIFO correspondiente a la entrada que se desea anular.'
        };
      }

      const cajasConsumidas = Number(layer.cajas_consumidas || 0);
      if (cajasConsumidas > 0) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'ENTRADA_CON_CONSUMOS',
          message: `NO SE PUEDE ANULAR AUTOMÁTICAMENTE: Esta entrada tiene ${cajasConsumidas} cajas consumidas por movimientos posteriores. REVISIÓN NECESARIA`,
          cajasConsumidas,
          cajasRestantes: Number(layer.cajas_restantes || 0),
          accionRecomendada: 'Revisar o corregir las salidas posteriores antes de anular esta entrada.'
        };
      }

      const cajasAnuladas = Number(layer.cajas_restantes || layer.cajas_iniciales);
      const stockKey = this.engine.buildStockKey(layer.codigo_articulo, layer.codigo_envase);

      layer.cajas_restantes = 0;
      layer.estado_capa = 'ANULADA';

      currentStock[stockKey] = Math.max(0, (currentStock[stockKey] || 0) - cajasAnuladas);

      const nowIso = new Date().toISOString();
      const movAnulacion = {
        id_movimiento: `MOV-ANUL-${Date.now()}`,
        fecha_hora: nowIso,
        tipo_movimiento: 'ANULACION',
        id_documento_ref: layer.documento_ref || layer.id_movimiento_entrada || '',
        codigo_articulo: layer.codigo_articulo,
        codigo_envase: layer.codigo_envase,
        cajas: cajasAnuladas,
        signo: -1,
        partida_origen: layer.partida || '',
        motivo_ajuste: params.motivo || 'ANULAR_ENTRADA',
        usuario,
        observaciones: params.observaciones || 'Anulación de entrada sin consumos',
        estado: 'ANULADO'
      };

      // Si existe documento en DOCUMENTOS, actualizar estado
      const docs = this.repo.getDocumentos();
      const doc = docs.find(d => 
        (layer.documento_ref && `${d.serie}/${d.numero}` === layer.documento_ref) ||
        (d.id_documento && d.id_documento === layer.documento_ref)
      );
      if (doc) {
        doc.estado_proceso = 'ANULADO';
        this.repo.replaceTable('DOCUMENTOS', docs);
      }

      this.repo.saveCapasFifo(currentLayers);
      this.repo.appendMovimientos([movAnulacion]);
      this._syncStockActual(currentStock, movAnulacion.id_movimiento);

      return {
        success: true,
        status: 'CONFIRMADO',
        estado: 'ANULADA',
        cajasAnuladas,
        stockKey,
        stockRestante: currentStock[stockKey],
        movimientoId: movAnulacion.id_movimiento
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Anula una salida de inventario, restituyendo exactamente las cajas consumidas a sus capas
   * FIFO originales y respetando el modelo de inventario.
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  anularSalida(params = {}, usuario = 'SISTEMA') {
    this._acquireLock(30000);
    try {
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      const docs = this.repo.getDocumentos();
      const docRef = (params.serie && params.numero)
        ? `${String(params.serie).trim()}/${String(params.numero).trim()}`
        : (params.id_documento || params.documentoRef || params.documento_ref);

      const docObj = docs.find(d => 
        (params.serie && params.numero && String(d.serie).trim() === String(params.serie).trim() && String(d.numero).trim() === String(params.numero).trim()) ||
        (docRef && `${d.serie}/${d.numero}` === docRef) ||
        (docRef && d.id_documento === docRef)
      );
      const targetDocId = docObj ? docObj.id_documento : null;

      const allMovs = this.repo.getMovimientos();
      const salidaMovs = allMovs.filter(m => 
        m.tipo_movimiento === 'SALIDA' &&
        (m.id_documento_ref === docRef ||
         (targetDocId && m.id_documento_ref === targetDocId) ||
         m.id_movimiento === params.id_movimiento ||
         (docRef && m.id_documento_ref.includes(docRef)))
      );

      if (salidaMovs.length === 0) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'SALIDA_NO_ENCONTRADA',
          message: 'No se encontraron movimientos de salida correspondientes al documento especificado.'
        };
      }

      let totalCajasRestauradas = 0;
      const movsAnulacion = [];
      const nowIso = new Date().toISOString();

      for (const mov of salidaMovs) {
        const cajas = Number(mov.cajas);
        const stockKey = this.engine.buildStockKey(mov.codigo_articulo, mov.codigo_envase);

        // Extraer consumos FIFO si están disponibles en observaciones
        let consumos = [];
        if (mov.observaciones && mov.observaciones.includes('FIFO:')) {
          try {
            const jsonPart = mov.observaciones.split('FIFO:')[1].trim();
            consumos = JSON.parse(jsonPart);
          } catch (e) {
            consumos = [];
          }
        }

        if (consumos.length > 0) {
          for (const c of consumos) {
            const layer = currentLayers.find(l => l.id_capa === c.id_capa);
            if (layer) {
              layer.cajas_consumidas = Math.max(0, Number(layer.cajas_consumidas || 0) - Number(c.cajas_descontadas));
              layer.cajas_restantes = Number(layer.cajas_restantes || 0) + Number(c.cajas_descontadas);
              layer.estado_capa = 'ACTIVA';
            }
          }
        } else {
          // Fallback LIFO sobre capas con consumos de esa clave
          const capasConsumidas = currentLayers.filter(l => 
            this.engine.buildStockKey(l.codigo_articulo, l.codigo_envase) === stockKey &&
            Number(l.cajas_consumidas || 0) > 0
          );
          // Ordenar descendente por fecha de capa (LIFO)
          capasConsumidas.sort((a, b) => String(b.fecha_capa || '').localeCompare(String(a.fecha_capa || '')));
          let porRestaurar = cajas;
          for (const layer of capasConsumidas) {
            if (porRestaurar <= 0) break;
            const consumidasCapa = Number(layer.cajas_consumidas || 0);
            const aRestaurar = Math.min(porRestaurar, consumidasCapa);
            layer.cajas_consumidas -= aRestaurar;
            layer.cajas_restantes = Number(layer.cajas_restantes || 0) + aRestaurar;
            layer.estado_capa = 'ACTIVA';
            porRestaurar -= aRestaurar;
          }
        }

        currentStock[stockKey] = (currentStock[stockKey] || 0) + cajas;
        totalCajasRestauradas += cajas;

        movsAnulacion.push({
          id_movimiento: `MOV-ANUL-${Date.now()}-${totalCajasRestauradas}`,
          fecha_hora: nowIso,
          tipo_movimiento: 'ANULACION',
          id_documento_ref: mov.id_documento_ref || docRef || '',
          codigo_articulo: mov.codigo_articulo,
          codigo_envase: mov.codigo_envase,
          cajas,
          signo: 1,
          partida_origen: mov.partida_origen || '',
          motivo_ajuste: params.motivo || 'ANULAR_SALIDA',
          usuario,
          observaciones: params.observaciones || 'Anulación y restitución FIFO de salida',
          estado: 'ANULADO'
        });
      }

      // Actualizar estado de documento si existe
      const doc = docs.find(d => 
        (docRef && `${d.serie}/${d.numero}` === docRef) ||
        (d.id_documento && d.id_documento === docRef)
      );
      if (doc) {
        doc.estado_proceso = 'ANULADO';
        this.repo.replaceTable('DOCUMENTOS', docs);
      }

      this.repo.saveCapasFifo(currentLayers);
      this.repo.appendMovimientos(movsAnulacion);
      this._syncStockActual(currentStock, movsAnulacion[0] ? movsAnulacion[0].id_movimiento : '');

      return {
        success: true,
        status: 'CONFIRMADO',
        estado: 'ANULADA',
        cajasRestauradas: totalCajasRestauradas,
        movimientosAnulados: salidaMovs.map(m => m.id_movimiento)
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Corrige la cantidad de una salida histórica.
   * Si la nueva cantidad es menor, devuelve las cajas excedentes al inventario restituyendo capas FIFO.
   * Si la nueva cantidad es mayor, descuenta cajas adicionales mediante FIFO asegurando saldo suficiente.
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  corregirCantidadSalida(params = {}, usuario = 'SISTEMA') {
    const nuevaCantidad = Number(params.nuevaCantidad !== undefined ? params.nuevaCantidad : params.cajas);
    if (isNaN(nuevaCantidad) || nuevaCantidad <= 0) {
      throw new Error('corregirCantidadSalida: nuevaCantidad debe ser un número positivo.');
    }

    this._acquireLock(30000);
    try {
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      const docs = this.repo.getDocumentos();
      const docRef = (params.serie && params.numero)
        ? `${String(params.serie).trim()}/${String(params.numero).trim()}`
        : (params.id_documento || params.documentoRef);

      const docObj = docs.find(d => 
        (params.serie && params.numero && String(d.serie).trim() === String(params.serie).trim() && String(d.numero).trim() === String(params.numero).trim()) ||
        (docRef && `${d.serie}/${d.numero}` === docRef) ||
        (docRef && d.id_documento === docRef)
      );
      const targetDocId = docObj ? docObj.id_documento : null;

      const allMovs = this.repo.getMovimientos();
      const mov = allMovs.find(m => 
        m.tipo_movimiento === 'SALIDA' &&
        (m.id_documento_ref === docRef ||
         (targetDocId && m.id_documento_ref === targetDocId) ||
         m.id_movimiento === params.id_movimiento ||
         (docRef && m.id_documento_ref.includes(docRef)))
      );

      if (!mov) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'SALIDA_NO_ENCONTRADA',
          message: 'No se encontró el movimiento de salida a corregir.'
        };
      }

      const cajasOriginales = Number(mov.cajas);
      const delta = cajasOriginales - nuevaCantidad; // positivo = devolver cajas a stock, negativo = consumir más

      if (delta === 0) {
        return { success: true, status: 'CONFIRMADO', message: 'Cantidad idéntica, sin cambios.' };
      }

      const stockKey = this.engine.buildStockKey(mov.codigo_articulo, mov.codigo_envase);
      const nowIso = new Date().toISOString();

      if (delta > 0) {
        // Salida fue menor: devolver 'delta' cajas a las capas FIFO
        let consumos = [];
        if (mov.observaciones && mov.observaciones.includes('FIFO:')) {
          try {
            const jsonPart = mov.observaciones.split('FIFO:')[1].trim();
            consumos = JSON.parse(jsonPart);
          } catch (e) {
            consumos = [];
          }
        }

        let porRestaurar = delta;
        if (consumos.length > 0) {
          // Revertir consumos en orden inverso
          for (let i = consumos.length - 1; i >= 0 && porRestaurar > 0; i--) {
            const c = consumos[i];
            const layer = currentLayers.find(l => l.id_capa === c.id_capa);
            if (layer) {
              const aRestaurar = Math.min(porRestaurar, c.cajas_descontadas);
              layer.cajas_consumidas = Math.max(0, Number(layer.cajas_consumidas || 0) - aRestaurar);
              layer.cajas_restantes = Number(layer.cajas_restantes || 0) + aRestaurar;
              layer.estado_capa = 'ACTIVA';
              c.cajas_descontadas -= aRestaurar;
              porRestaurar -= aRestaurar;
            }
          }
        } else {
          // Fallback sobre capas con consumos
          const capasConsumidas = currentLayers.filter(l => 
            this.engine.buildStockKey(l.codigo_articulo, l.codigo_envase) === stockKey &&
            Number(l.cajas_consumidas || 0) > 0
          );
          capasConsumidas.sort((a, b) => String(b.fecha_capa || '').localeCompare(String(a.fecha_capa || '')));
          for (const layer of capasConsumidas) {
            if (porRestaurar <= 0) break;
            const consumidasCapa = Number(layer.cajas_consumidas || 0);
            const aRestaurar = Math.min(porRestaurar, consumidasCapa);
            layer.cajas_consumidas -= aRestaurar;
            layer.cajas_restantes = Number(layer.cajas_restantes || 0) + aRestaurar;
            layer.estado_capa = 'ACTIVA';
            porRestaurar -= aRestaurar;
          }
        }

        currentStock[stockKey] = (currentStock[stockKey] || 0) + delta;

        const movAjuste = {
          id_movimiento: `MOV-CORR-SAL-${Date.now()}`,
          fecha_hora: nowIso,
          tipo_movimiento: 'AJUSTE',
          id_documento_ref: mov.id_documento_ref || '',
          codigo_articulo: mov.codigo_articulo,
          codigo_envase: mov.codigo_envase,
          cajas: delta,
          signo: 1,
          partida_origen: mov.partida_origen || '',
          motivo_ajuste: params.motivo || 'CORRECCION_CANTIDAD_SALIDA',
          usuario,
          observaciones: `Corrección de salida: reducción de ${cajasOriginales} a ${nuevaCantidad} cajas (+${delta} reintegradas a FIFO)`,
          estado: 'CONFIRMADO'
        };

        mov.cajas = nuevaCantidad;
        this.repo.saveCapasFifo(currentLayers);
        this.repo.replaceTable('MOVIMIENTOS', allMovs);
        this.repo.appendMovimientos([movAjuste]);
        this._syncStockActual(currentStock, movAjuste.id_movimiento);

        return {
          success: true,
          status: 'CONFIRMADO',
          cajasRestauradas: delta,
          nuevaCantidad,
          stockNuevo: currentStock[stockKey]
        };
      } else {
        // delta < 0: Salida fue mayor, requiere consumir más cajas
        const aConsumir = Math.abs(delta);
        const movInput = {
          tipo: 'SALIDA',
          codigoArticulo: mov.codigo_articulo,
          codigoEnvase: mov.codigo_envase,
          cajas: aConsumir,
          fecha: new Date().toISOString().slice(0, 10),
          fechaHora: nowIso,
          documentoRef: mov.id_documento_ref || '',
          usuario
        };

        const resProc = this.engine.processMovement(movInput, currentLayers, currentStock);
        if (!resProc.success) {
          return {
            success: false,
            status: 'REVISION_NECESARIA',
            errorCode: 'STOCK_INSUFICIENTE',
            message: `Stock insuficiente para ampliar la salida en ${aConsumir} cajas.`,
            deficit: resProc.deficit
          };
        }

        currentLayers = resProc.updatedLayers;
        Object.assign(currentStock, resProc.updatedStock);
        mov.cajas = nuevaCantidad;

        this.repo.saveCapasFifo(currentLayers);
        this.repo.replaceTable('MOVIMIENTOS', allMovs);
        this.repo.appendMovimientos([resProc.generatedMovement]);
        this._syncStockActual(currentStock, resProc.generatedMovement.id_movimiento);

        return {
          success: true,
          status: 'CONFIRMADO',
          cajasDeducidas: aConsumir,
          nuevaCantidad,
          stockNuevo: currentStock[stockKey]
        };
      }
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Corrige la cantidad de una entrada histórica de forma determinista y segura.
   * Si la nueva cantidad reduce la entrada, verifica que la capa conserve suficientes cajas
   * disponibles (no consumidas) para absorber la reducción sin generar inconsistencias.
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  corregirCantidadEntrada(params = {}, usuario = 'SISTEMA') {
    const nuevaCantidad = Number(params.nuevaCantidad !== undefined ? params.nuevaCantidad : params.cajas);
    if (isNaN(nuevaCantidad) || nuevaCantidad <= 0) {
      throw new Error('corregirCantidadEntrada: nuevaCantidad debe ser un número positivo.');
    }

    this._acquireLock(30000);
    try {
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      const layer = this._findLayer(currentLayers, params);
      if (!layer) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'CAPA_NO_ENCONTRADA',
          message: 'No se encontró la capa de entrada a corregir.'
        };
      }

      const cajasOriginales = Number(layer.cajas_iniciales);
      const cajasRestantes = Number(layer.cajas_restantes || 0);
      const cajasConsumidas = Number(layer.cajas_consumidas || 0);
      const delta = nuevaCantidad - cajasOriginales; // negativo = reducción, positivo = aumento

      if (delta === 0) {
        return { success: true, status: 'CONFIRMADO', message: 'Cantidad idéntica, sin cambios.' };
      }

      const stockKey = this.engine.buildStockKey(layer.codigo_articulo, layer.codigo_envase);
      const nowIso = new Date().toISOString();

      if (delta < 0) {
        const reduccion = Math.abs(delta);
        if (cajasRestantes < reduccion) {
          return {
            success: false,
            status: 'REVISION_NECESARIA',
            errorCode: 'CANTIDAD_INSUFICIENTE_EN_CAPA',
            message: `Solo quedan ${cajasRestantes} cajas disponibles de esta entrada. No se puede reducir en ${reduccion} cajas sin provocar inconsistencias. REVISIÓN NECESARIA`,
            cajasDisponibles: cajasRestantes,
            cajasConsumidas,
            reduccionSolicitada: reduccion,
            deficit: reduccion - cajasRestantes,
            accionRecomendada: 'Revisar consumos posteriores o realizar un ajuste por merma/inventario.'
          };
        }

        layer.cajas_iniciales = nuevaCantidad;
        layer.cajas_restantes = cajasRestantes - reduccion;
        if (layer.cajas_restantes === 0 && cajasConsumidas > 0) {
          layer.estado_capa = 'AGOTADA';
        }

        currentStock[stockKey] = Math.max(0, (currentStock[stockKey] || 0) - reduccion);

        const movAjuste = {
          id_movimiento: `MOV-CORR-ENT-${Date.now()}`,
          fecha_hora: nowIso,
          tipo_movimiento: 'AJUSTE',
          id_documento_ref: layer.documento_ref || '',
          codigo_articulo: layer.codigo_articulo,
          codigo_envase: layer.codigo_envase,
          cajas: reduccion,
          signo: -1,
          partida_origen: layer.partida || '',
          motivo_ajuste: params.motivo || 'CORRECCION_CANTIDAD_ENTRADA',
          usuario,
          observaciones: `Corrección de entrada: reducción de ${cajasOriginales} a ${nuevaCantidad} cajas`,
          estado: 'CONFIRMADO'
        };

        this.repo.saveCapasFifo(currentLayers);
        this.repo.appendMovimientos([movAjuste]);
        this._syncStockActual(currentStock, movAjuste.id_movimiento);

        return {
          success: true,
          status: 'CONFIRMADO',
          cajasReducidas: reduccion,
          nuevaCantidad,
          stockNuevo: currentStock[stockKey]
        };
      } else {
        // delta > 0: Aumento de entrada
        const aumento = delta;
        layer.cajas_iniciales = nuevaCantidad;
        layer.cajas_restantes = cajasRestantes + aumento;
        layer.estado_capa = 'ACTIVA';

        currentStock[stockKey] = (currentStock[stockKey] || 0) + aumento;

        const movAjuste = {
          id_movimiento: `MOV-CORR-ENT-${Date.now()}`,
          fecha_hora: nowIso,
          tipo_movimiento: 'AJUSTE',
          id_documento_ref: layer.documento_ref || '',
          codigo_articulo: layer.codigo_articulo,
          codigo_envase: layer.codigo_envase,
          cajas: aumento,
          signo: 1,
          partida_origen: layer.partida || '',
          motivo_ajuste: params.motivo || 'CORRECCION_CANTIDAD_ENTRADA',
          usuario,
          observaciones: `Corrección de entrada: aumento de ${cajasOriginales} a ${nuevaCantidad} cajas`,
          estado: 'CONFIRMADO'
        };

        this.repo.saveCapasFifo(currentLayers);
        this.repo.appendMovimientos([movAjuste]);
        this._syncStockActual(currentStock, movAjuste.id_movimiento);

        return {
          success: true,
          status: 'CONFIRMADO',
          cajasAumentadas: aumento,
          nuevaCantidad,
          stockNuevo: currentStock[stockKey]
        };
      }
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Corrige una entrada que ya ha sido parcialmente consumida por salidas posteriores.
   * Mantiene intactas las cajas ya consumidas en la combinación original (para no falsear el histórico de ventas)
   * y traslada de forma segura el saldo disponible restante a la nueva combinación.
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  corregirEntradaParcial(params = {}, usuario = 'SISTEMA') {
    const artDestino = params.nuevoArticulo || params.nuevo_articulo || params.articuloDestino;
    const envDestino = params.nuevoEnvase || params.nuevo_envase || params.envaseDestino;

    if (!artDestino && !envDestino) {
      throw new Error('corregirEntradaParcial: Debe especificarse al menos nuevoArticulo o nuevoEnvase.');
    }

    this._acquireLock(30000);
    try {
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      const layer = this._findLayer(currentLayers, params);
      if (!layer) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'CAPA_NO_ENCONTRADA',
          message: 'No se encontró la capa de entrada a corregir.'
        };
      }

      const cajasRestantes = Number(layer.cajas_restantes || 0);
      const cajasConsumidas = Number(layer.cajas_consumidas || 0);

      if (cajasRestantes <= 0) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'SIN_STOCK_DISPONIBLE_EN_CAPA',
          message: 'No se puede corregir la entrada porque la totalidad de sus cajas ya fueron consumidas por movimientos posteriores. REVISIÓN NECESARIA',
          cajasConsumidas,
          cajasRestantes: 0
        };
      }

      const artOrigen = layer.codigo_articulo;
      const envOrigen = layer.codigo_envase;
      const targetArt = artDestino || artOrigen;
      const targetEnv = envDestino || envOrigen;

      const keyOrigen = this.engine.buildStockKey(artOrigen, envOrigen);
      const keyDestino = this.engine.buildStockKey(targetArt, targetEnv);

      // Si tiene consumos, la capa origen conserva exactamente las cajas consumidas como histórico
      if (cajasConsumidas > 0) {
        layer.cajas_iniciales = cajasConsumidas;
        layer.cajas_restantes = 0;
        layer.estado_capa = 'AGOTADA';
      } else {
        layer.cajas_restantes = 0;
        layer.estado_capa = 'ANULADA';
      }

      // Crear nueva capa para la combinación destino con el saldo restante disponible
      const idCapaNueva = `CAPA-CORR-${Date.now()}`;
      const nuevaCapa = {
        id_capa: idCapaNueva,
        id_movimiento_entrada: `MOV-CORR-ENT-${Date.now()}`,
        fecha_capa: layer.fecha_capa,
        codigo_articulo: targetArt,
        codigo_envase: targetEnv,
        cajas_iniciales: cajasRestantes,
        cajas_consumidas: 0,
        cajas_restantes: cajasRestantes,
        estado_capa: 'ACTIVA',
        partida: layer.partida || '',
        documento_ref: layer.documento_ref || ''
      };
      currentLayers.push(nuevaCapa);

      // Actualizar stocks
      currentStock[keyOrigen] = Math.max(0, (currentStock[keyOrigen] || 0) - cajasRestantes);
      currentStock[keyDestino] = (currentStock[keyDestino] || 0) + cajasRestantes;

      const nowIso = new Date().toISOString();
      const movOrigen = {
        id_movimiento: `MOV-CORR-ORIG-${Date.now()}`,
        fecha_hora: nowIso,
        tipo_movimiento: 'AJUSTE',
        id_documento_ref: layer.documento_ref || '',
        codigo_articulo: artOrigen,
        codigo_envase: envOrigen,
        cajas: cajasRestantes,
        signo: -1,
        partida_origen: layer.partida || '',
        motivo_ajuste: params.motivo || 'CORRECCION_ENTRADA_ORIGEN',
        usuario,
        observaciones: `Corrección entrada parcial: ${cajasConsumidas} consumidas mantenidas en origen, ${cajasRestantes} transferidas a ${targetArt}|${targetEnv}`,
        estado: 'CONFIRMADO'
      };

      const movDestino = {
        id_movimiento: `MOV-CORR-DEST-${Date.now()}`,
        fecha_hora: nowIso,
        tipo_movimiento: 'AJUSTE',
        id_documento_ref: layer.documento_ref || '',
        codigo_articulo: targetArt,
        codigo_envase: targetEnv,
        cajas: cajasRestantes,
        signo: 1,
        partida_origen: layer.partida || '',
        motivo_ajuste: params.motivo || 'CORRECCION_ENTRADA_DESTINO',
        usuario,
        observaciones: `Recepción por corrección de entrada desde ${artOrigen}|${envOrigen}`,
        estado: 'CONFIRMADO'
      };

      this.repo.saveCapasFifo(currentLayers);
      this.repo.appendMovimientos([movOrigen, movDestino]);
      this._syncStockActual(currentStock, movDestino.id_movimiento);

      return {
        success: true,
        status: 'CONFIRMADO',
        cajasReclasificadas: cajasRestantes,
        cajasMantenidasConsumidas: cajasConsumidas,
        origen: keyOrigen,
        destino: keyDestino,
        stockOrigen: currentStock[keyOrigen],
        stockDestino: currentStock[keyDestino]
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Divide una entrada histórica en múltiples combinaciones comerciales.
   * Si la entrada ya tiene consumos previos, comprueba determinísticamente que la cantidad
   * asignada a la combinación original sea suficiente para cubrir las cajas ya consumidas.
   * Si no lo es, BLOQUEA la operación con REVISION_NECESARIA.
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  dividirCapaEntrada(params = {}, usuario = 'SISTEMA') {
    const divisiones = params.divisiones;
    if (!Array.isArray(divisiones) || divisiones.length < 2) {
      throw new Error('dividirCapaEntrada: Se requiere array divisiones con al menos 2 líneas.');
    }

    this._acquireLock(30000);
    try {
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      const layer = this._findLayer(currentLayers, params);
      if (!layer) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'CAPA_NO_ENCONTRADA',
          message: 'No se encontró la capa de entrada a dividir.'
        };
      }

      const cajasIniciales = Number(layer.cajas_iniciales);
      const cajasConsumidas = Number(layer.cajas_consumidas || 0);
      const sumaDivisiones = divisiones.reduce((s, d) => s + Number(d.cajas || 0), 0);

      if (sumaDivisiones !== cajasIniciales) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'SUMA_DIVISION_NO_COINCIDE',
          message: `La suma de las divisiones (${sumaDivisiones}) no coincide con el total inicial de la entrada (${cajasIniciales}). REVISIÓN NECESARIA`,
          sumaDivisiones,
          totalEntrada: cajasIniciales
        };
      }

      // Buscar si alguna división corresponde a la combinación original
      const divOrig = divisiones.find(d => 
        (d.articulo || d.codigo_articulo) === layer.codigo_articulo &&
        (d.envase || d.codigo_envase || layer.codigo_envase) === layer.codigo_envase
      );

      // Si ya hay consumos, la combinación original DEBE recibir al menos las cajas consumidas
      if (cajasConsumidas > 0) {
        const cajasAsignadasOrig = divOrig ? Number(divOrig.cajas || 0) : 0;
        if (cajasAsignadasOrig < cajasConsumidas) {
          return {
            success: false,
            status: 'REVISION_NECESARIA',
            errorCode: 'DIVISION_INCONSISTENTE_CON_CONSUMOS',
            message: `No se puede dividir la entrada porque la cantidad asignada a la combinación original ${layer.codigo_articulo} (${cajasAsignadasOrig}) es inferior a las cajas ya consumidas (${cajasConsumidas}). REVISIÓN NECESARIA`,
            cajasAsignadas: cajasAsignadasOrig,
            cajasConsumidas,
            deficit: cajasConsumidas - cajasAsignadasOrig,
            accionRecomendada: 'Ajustar la división para que la combinación original conserve al menos las cajas ya consumidas.'
          };
        }
      }

      const keyOrig = this.engine.buildStockKey(layer.codigo_articulo, layer.codigo_envase);
      const cajasOrig = divOrig ? Number(divOrig.cajas) : 0;
      const cajasTransferidas = cajasIniciales - cajasOrig;

      // Actualizar capa original
      layer.cajas_iniciales = cajasOrig;
      layer.cajas_restantes = Math.max(0, cajasOrig - cajasConsumidas);
      layer.estado_capa = layer.cajas_restantes > 0 ? 'ACTIVA' : 'AGOTADA';

      currentStock[keyOrig] = Math.max(0, (currentStock[keyOrig] || 0) - cajasTransferidas);

      const nowIso = new Date().toISOString();
      const generatedMovs = [];

      // Registrar movimiento de ajuste negativo en origen por las cajas transferidas
      if (cajasTransferidas > 0) {
        generatedMovs.push({
          id_movimiento: `MOV-DIV-ORIG-${Date.now()}`,
          fecha_hora: nowIso,
          tipo_movimiento: 'AJUSTE',
          id_documento_ref: layer.documento_ref || '',
          codigo_articulo: layer.codigo_articulo,
          codigo_envase: layer.codigo_envase,
          cajas: cajasTransferidas,
          signo: -1,
          partida_origen: layer.partida || '',
          motivo_ajuste: params.motivo || 'DIVISION_ENTRADA',
          usuario,
          observaciones: `División de entrada: ${cajasTransferidas} cajas transferidas a nuevas líneas`,
          estado: 'CONFIRMADO'
        });
      }

      // Crear nuevas capas para las demás divisiones
      for (const d of divisiones) {
        const dArt = d.articulo || d.codigo_articulo;
        const dEnv = d.envase || d.codigo_envase || layer.codigo_envase;
        const dCajas = Number(d.cajas);

        if (d === divOrig) continue; // Ya procesada la original

        const dKey = this.engine.buildStockKey(dArt, dEnv);
        const idCapaNueva = `CAPA-DIV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const nuevaCapa = {
          id_capa: idCapaNueva,
          id_movimiento_entrada: `MOV-DIV-DEST-${Date.now()}`,
          fecha_capa: layer.fecha_capa,
          codigo_articulo: dArt,
          codigo_envase: dEnv,
          cajas_iniciales: dCajas,
          cajas_consumidas: 0,
          cajas_restantes: dCajas,
          estado_capa: 'ACTIVA',
          partida: d.partida || layer.partida || '',
          documento_ref: layer.documento_ref || ''
        };
        currentLayers.push(nuevaCapa);
        currentStock[dKey] = (currentStock[dKey] || 0) + dCajas;

        generatedMovs.push({
          id_movimiento: `MOV-DIV-DEST-${Date.now()}-${dArt}`,
          fecha_hora: nowIso,
          tipo_movimiento: 'AJUSTE',
          id_documento_ref: layer.documento_ref || '',
          codigo_articulo: dArt,
          codigo_envase: dEnv,
          cajas: dCajas,
          signo: 1,
          partida_origen: d.partida || layer.partida || '',
          motivo_ajuste: params.motivo || 'DIVISION_ENTRADA',
          usuario,
          observaciones: `Línea creada por división de entrada ${layer.documento_ref || ''}`,
          estado: 'CONFIRMADO'
        });
      }

      this.repo.saveCapasFifo(currentLayers);
      this.repo.appendMovimientos(generatedMovs);
      this._syncStockActual(currentStock, generatedMovs[0] ? generatedMovs[0].id_movimiento : '');

      return {
        success: true,
        status: 'CONFIRMADO',
        divisionesRealizadas: divisiones,
        cajasMantenidasConsumidas: cajasConsumidas,
        cajasDisponiblesOrigen: layer.cajas_restantes,
        stockActualizado: currentStock
      };
    } finally {
      this._releaseLock();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MovementService
  };
}
