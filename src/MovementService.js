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
    this.dedup = options.deduplicationService || (typeof checkDocumentDuplicate !== 'undefined' ? {
      checkDocumentDuplicate,
      buildLineIdentityKey,
      filterBatchForOverlaps
    } : null);

    this.engine = options.inventoryEngine || (typeof processMovement !== 'undefined' ? {
      buildStockKey,
      processMovement,
      rebuildStockFromMovements
    } : null);
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

      // 2. Cargar estado actual de capas vivas y stock
      let currentLayers = this.repo.getCapasFifo();
      const stockList = this.repo.getStockActual();
      const currentStock = {};
      stockList.forEach(s => {
        currentStock[s.stock_key] = Number(s.cajas_actuales || 0);
      });

      // 3. Procesar cada línea en el motor de dominio
      const generatedMovements = [];
      const newLayers = [];
      let totalCajas = 0;
      const docId = docPayload.id_documento || `DOC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];
        const cajas = Number(linea.cajas);
        totalCajas += cajas;

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
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MovementService
  };
}
