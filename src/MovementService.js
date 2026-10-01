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

    const { idDocumento, lineResolutions = [] } = clientPayload;

    if (!idDocumento) {
      throw new Error('Trust Boundary violado: Se requiere idDocumento para confirmar compra pendiente.');
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
      const resolver = resolverParam || (typeof MaestroResolver !== 'undefined' ? new MaestroResolver(maestroRecords) : null);
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
        resolutionMap.set(idx, env);
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
        let envCode = resolutionMap.get(lineIdx) || rawLine.envaseCode || rawLine.codigo_envase;
        if (!envCode || envCode === 'DEFAULT' || envCode === 'ENVASE_NO_DETERMINABLE_DESDE_PDF') {
          throw new Error(`Trust Boundary violado: Línea ${lineIdx} (${artName}) no tiene un envase asignado.`);
        }

        // Validar que el envase está permitido para este artículo en MAESTRO
        if (!resolver.isEnvasePermitidoParaArticulo(artCode, envCode)) {
          const permitidos = resolver.getEnvasesPermitidos(artCode).map(p => p.codigo_envase).join(', ');
          throw new Error(`Trust Boundary violado: El envase '${envCode}' no está permitido para el artículo '${artCode}' (${artName}) en MAESTRO. Opciones permitidas: [${permitidos}].`);
        }

        resolvedLines.push({
          lineIndex: lineIdx,
          codigo_articulo: artCode,
          nombre_articulo: artName,
          codigo_envase: envCode,
          cajas,
          partida: rawLine.lot || rawLine.partida || ''
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

      return {
        success: true,
        status: 'CONFIRMADO',
        documentoId: idDocumento,
        totalCajas,
        lineasProcesadas: resolvedLines.length,
        movimientosGenerados: generatedMovements.map(m => m.id_movimiento)
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
