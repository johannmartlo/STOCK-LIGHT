/**
 * STOCK-LIGHT — MovementService.js
 * 
 * Orquestador de Movimientos, Concurrencia y Transaccionalidad.
 * Coordina:
 * - DeduplicationService (detección de colisiones y duplicados)
 * - Libro / InventoryEngine (cálculo matemático FIFO puro en memoria; D-012, D-022, D-024, T-022)
 * - Repository (persistencia atómica en Google Sheets)
 * - LockService (bloqueo exclusivo para evitar condiciones de carrera)
 */

// Importaciones condicionales para entorno Node.js / Testing (aisladas sin 'var' para evitar colisiones en Apps Script V8)
if (typeof require !== 'undefined') {
  try {
    const fechasMod = require('./Fechas');
    global.hoyMadrid = global.hoyMadrid || fechasMod.hoyMadrid;
    global.normalizarFechaNegocio = global.normalizarFechaNegocio || fechasMod.normalizarFechaNegocio;
  } catch (e) {}
  try {
    const idsMod = require('./Ids');
    global.nuevoId = global.nuevoId || idsMod.nuevoId;
  } catch (e) {}
  try {
    const libroMod = require('./Libro');
    global.aplicarMovimiento = global.aplicarMovimiento || libroMod.aplicarMovimiento;
    global.reconstruir = global.reconstruir || libroMod.reconstruir;
    global.ordenarMovimientosPorSecuencia = global.ordenarMovimientosPorSecuencia || libroMod.ordenarMovimientosPorSecuencia;
  } catch (e) {}
}

class MovementService {
  /**
   * @param {Object} options 
   * @param {Object} [options.repository]
   * @param {Object} [options.lockService]
   * @param {Object} [options.deduplicationService]
   * @param {Object} [options.inventoryEngine]
   * @param {Object} [options.libro]
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
        rebuildStockFromMovements: (typeof rebuildStockFromMovements !== 'undefined' ? rebuildStockFromMovements : null),
        sortFifoLayers: (typeof sortFifoLayers !== 'undefined' ? sortFifoLayers : null)
      };
    }
    this.engine = EngineModule;

    let LibroModule = options.libro || null;
    if (!LibroModule && typeof require !== 'undefined') {
      try {
        LibroModule = require('./Libro');
      } catch (e) {
        // ignore
      }
    }
    if (!LibroModule) {
      LibroModule = {
        aplicarMovimiento: (typeof aplicarMovimiento !== 'undefined' ? aplicarMovimiento : null),
        reconstruir: (typeof reconstruir !== 'undefined' ? reconstruir : null),
        ordenarMovimientosPorSecuencia: (typeof ordenarMovimientosPorSecuencia !== 'undefined' ? ordenarMovimientosPorSecuencia : null)
      };
    }
    this.libro = LibroModule;

    this.defaultTenantId = options.defaultTenantId || 'DEFAULT';
    this.ingestionService = options.articuloEnvaseIngestionService || null;
  }

  /**
   * Genera un identificador único con prefijo mediante `nuevoId` (D-024).
   * @param {string} prefijo
   * @returns {string}
   */
  _nuevoId(prefijo = 'ID') {
    const fn = typeof nuevoId === 'function' ? nuevoId : (typeof global !== 'undefined' ? global.nuevoId : null);
    if (typeof fn === 'function') {
      return fn(prefijo);
    }
    throw new Error('nuevoId no está disponible en MovementService');
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
   * Carga el estado vivo actual `{ capas, stock, consumosPorMovimiento }` y los movimientos existentes.
   * Carga `consumosPorMovimiento` a partir del JSON `FIFO:` de `observaciones` (Regla 9) y de los
   * movimientos históricos de ajuste/anulación con `id_movimiento_ref`.
   * @returns {{ estado: { capas: Array<Object>, stock: Object, consumosPorMovimiento: Object }, movimientos: Array<Object> }}
   */
  _cargarEstado() {
    const capas = this.repo && typeof this.repo.getCapasFifo === 'function' ? this.repo.getCapasFifo() : [];
    const stockList = this.repo && typeof this.repo.getStockActual === 'function' ? this.repo.getStockActual() : [];
    const movimientos = this.repo && typeof this.repo.getMovimientos === 'function' ? this.repo.getMovimientos() : [];
    const consumosFifoRows = this.repo && typeof this.repo.getConsumosFifo === 'function' ? this.repo.getConsumosFifo() : [];

    const stock = {};
    stockList.forEach(s => {
      stock[s.stock_key] = Number(s.cajas_actuales || 0);
    });

    let consumosPorMovimiento = {};

    if (consumosFifoRows && consumosFifoRows.length > 0) {
      for (const row of consumosFifoRows) {
        const movId = String(row.id_movimiento || '').trim();
        const cajas = Number(row.cajas || 0);
        if (!movId || cajas <= 0) continue;
        if (!consumosPorMovimiento[movId]) {
          consumosPorMovimiento[movId] = [];
        }
        consumosPorMovimiento[movId].push({
          id_capa: String(row.id_capa || '').trim(),
          cajas: cajas,
          codigo_articulo: String(row.codigo_articulo || '').trim(),
          codigo_envase: String(row.codigo_envase || '').trim(),
          fecha_negocio: String(row.fecha_negocio || '').trim()
        });
      }
    } else {
      // Si la hoja está vacía y MOVIMIENTOS tiene movimientos que consumen (primera ejecución tras desplegar)
      const tieneConsumos = movimientos.some(m => {
        const tipo = String(m.tipo_movimiento || '').trim().toUpperCase();
        const signo = Number(m.signo || 0);
        const est = String(m.estado || '').trim().toUpperCase();
        return est === 'CONFIRMADO' && (tipo === 'SALIDA' || (tipo === 'AJUSTE' && signo === -1));
      });

      if (tieneConsumos && this.libro && typeof this.libro.reconstruir === 'function') {
        const rec = this.libro.reconstruir(movimientos);
        if (rec && rec.estado && rec.estado.consumosPorMovimiento) {
          consumosPorMovimiento = rec.estado.consumosPorMovimiento;
        }
      }
    }

    return {
      estado: { capas, stock, consumosPorMovimiento },
      movimientos
    };
  }

  /**
   * Único método de persistencia (T-022 Regla 5), ejecutado dentro del lock y en este orden estricto:
   * 1. añadir movimientos (con su `secuencia` asignada en `repo.appendMovimientos`);
   * 2. reescribir `CAPAS_FIFO`;
   * 3. reescribir `STOCK_ACTUAL`;
   * 4. actualizar `DOCUMENTOS`.
   *
   * Ningún otro método escribe esas hojas.
   *
   * @param {Object} payload
   * @param {Array<Object>} [payload.movimientos]
   * @param {Object} [payload.estado]
   * @param {Object} [payload.documentos]
   * @param {string} [payload.ultimoMovimientoId]
   */
  _persistir({ movimientos = [], estado = null, documentos = null, ultimoMovimientoId = '' } = {}) {
    // 1. Añadir movimientos (con su secuencia en SheetsRepository.appendMovimientos)
    if (Array.isArray(movimientos) && movimientos.length > 0) {
      this.repo.appendMovimientos(movimientos);
    }

    // 2. Reescribir CAPAS_FIFO
    if (estado && Array.isArray(estado.capas)) {
      this.repo.saveCapasFifo(estado.capas);
    }

    // 2b. Reescribir CONSUMOS_FIFO justo después de CAPAS_FIFO (T-003 Regla 2)
    if (estado && estado.consumosPorMovimiento && typeof estado.consumosPorMovimiento === 'object') {
      const consumosRecords = [];
      const movKeys = Object.keys(estado.consumosPorMovimiento);
      for (const movId of movKeys) {
        const list = estado.consumosPorMovimiento[movId];
        if (!Array.isArray(list) || list.length === 0) continue;
        let orden = 1;
        for (const item of list) {
          const cajas = Number(item.cajas !== undefined ? item.cajas : item.cajas_descontadas);
          if (cajas <= 0) continue;

          let art = item.codigo_articulo;
          let env = item.codigo_envase;
          let fecha = item.fecha_negocio;

          if ((!art || !env) && Array.isArray(estado.capas)) {
            const capa = estado.capas.find(c => c.id_capa === item.id_capa);
            if (capa) {
              art = art || capa.codigo_articulo;
              env = env || capa.codigo_envase;
            }
          }

          if (!fecha && Array.isArray(movimientos)) {
            const m = movimientos.find(x => x.id_movimiento === movId);
            if (m) {
              fecha = m.fecha_negocio;
            }
          }

          consumosRecords.push({
            id_movimiento: movId,
            orden: orden++,
            id_capa: item.id_capa,
            codigo_articulo: art || '',
            codigo_envase: env || '',
            cajas: cajas,
            fecha_negocio: fecha || ''
          });
        }
      }
      if (this.repo && typeof this.repo.saveConsumosFifo === 'function') {
        this.repo.saveConsumosFifo(consumosRecords);
      }
    }

    // 3. Reescribir STOCK_ACTUAL
    if (estado && estado.stock && typeof estado.stock === 'object') {
      const maestro = (this.repo && typeof this.repo.getMaestro === 'function') ? this.repo.getMaestro() : [];
      const maestroMap = {};
      maestro.forEach(m => {
        const k = this.engine.buildStockKey(m.codigo_articulo, m.codigo_envase);
        maestroMap[k] = m;
      });

      const lastMovId = ultimoMovimientoId || (movimientos.length > 0 ? movimientos[movimientos.length - 1].id_movimiento : '');
      const nowIso = new Date().toISOString();

      const updatedStockRecords = Object.keys(estado.stock).map(stockKey => {
        const [art, env] = stockKey.split('|');
        const m = maestroMap[stockKey] || {};
        return {
          stock_key: stockKey,
          codigo_articulo: art,
          nombre_articulo: m.nombre_articulo || '',
          codigo_envase: env,
          descripcion_envase: m.descripcion_envase || '',
          cajas_actuales: Number(estado.stock[stockKey] || 0),
          fecha_ultima_actualizacion: nowIso,
          ultimo_movimiento_id: lastMovId || ''
        };
      });

      this.repo.saveStockActual(updatedStockRecords);
    }

    // 4. Actualizar DOCUMENTOS
    if (documentos) {
      if (documentos.append && Array.isArray(documentos.append)) {
        for (const doc of documentos.append) {
          this.repo.appendDocumento(doc);
        }
      } else if (documentos.append && typeof documentos.append === 'object') {
        this.repo.appendDocumento(documentos.append);
      }

      if (documentos.updateEstado && documentos.updateEstado.idDocumento) {
        const { idDocumento, nuevoEstado, fallbackDocs } = documentos.updateEstado;
        if (typeof this.repo.updateDocumentoEstado === 'function') {
          this.repo.updateDocumentoEstado(idDocumento, nuevoEstado);
        } else if (Array.isArray(fallbackDocs) && typeof this.repo.replaceTable === 'function') {
          this.repo.replaceTable('DOCUMENTOS', fallbackDocs);
        }
      }

      if (documentos.replace && Array.isArray(documentos.replace) && typeof this.repo.replaceTable === 'function') {
        this.repo.replaceTable('DOCUMENTOS', documentos.replace);
      }
    }
  }

  /**
   * Comprueba la consistencia entre el estado reconstruido en memoria desde `MOVIMIENTOS`
   * y las hojas `CAPAS_FIFO` y `STOCK_ACTUAL` guardadas (T-022 Regla 7).
   * Devuelve las diferencias por capa y por clave. NO escribe nada.
   *
   * @returns {{
   *   consistente: boolean,
   *   totalDiferencias: number,
   *   diferenciasCapas: Array<Object>,
   *   diferenciasStock: Array<Object>,
   *   avisos: Array<Object>
   * }}
   */
  comprobarConsistencia() {
    const movimientos = this.repo.getMovimientos();
    const capasGuardadas = this.repo.getCapasFifo();
    const stockGuardadoList = this.repo.getStockActual();

    const reconstruccion = this.libro.reconstruir(movimientos);
    const capasReconstruidas = reconstruccion.estado.capas;
    const stockReconstruido = reconstruccion.estado.stock;

    const diferenciasCapas = [];
    const mapaGuardadas = new Map();
    for (const c of capasGuardadas) {
      mapaGuardadas.set(String(c.id_capa || ''), c);
    }
    const mapaReconstruidas = new Map();
    for (const c of capasReconstruidas) {
      mapaReconstruidas.set(String(c.id_capa || ''), c);
    }

    const todosIdsCapa = new Set([...mapaGuardadas.keys(), ...mapaReconstruidas.keys()]);
    for (const idCapa of todosIdsCapa) {
      const g = mapaGuardadas.get(idCapa);
      const r = mapaReconstruidas.get(idCapa);
      if (!g) {
        diferenciasCapas.push({
          id_capa: idCapa,
          tipo: 'FALTA_EN_VIVO',
          vivo: null,
          reconstruido: r
        });
        continue;
      }
      if (!r) {
        diferenciasCapas.push({
          id_capa: idCapa,
          tipo: 'SOBRA_EN_VIVO',
          vivo: g,
          reconstruido: null
        });
        continue;
      }

      const camposComparar = [
        'codigo_articulo',
        'codigo_envase',
        'cajas_iniciales',
        'cajas_consumidas',
        'cajas_restantes',
        'estado_capa',
        'fecha_capa',
        'proveedor'
      ];
      const diffsCampo = {};
      for (const campo of camposComparar) {
        const esNum = campo.startsWith('cajas_');
        const valVivo = esNum ? Number(g[campo] || 0) : String(g[campo] || '').trim();
        const valRec = esNum ? Number(r[campo] || 0) : String(r[campo] || '').trim();
        if (valVivo !== valRec) {
          diffsCampo[campo] = { vivo: valVivo, reconstruido: valRec };
        }
      }
      if (Object.keys(diffsCampo).length > 0) {
        diferenciasCapas.push({
          id_capa: idCapa,
          tipo: 'DIFERENCIA_CAMPOS',
          diferencias: diffsCampo
        });
      }
    }

    const diferenciasStock = [];
    const stockVivoMap = {};
    for (const s of stockGuardadoList) {
      const k = s.stock_key || this.engine.buildStockKey(s.codigo_articulo, s.codigo_envase);
      stockVivoMap[k] = Number(s.cajas_actuales || 0);
    }

    const todasClavesStock = new Set([...Object.keys(stockVivoMap), ...Object.keys(stockReconstruido)]);
    for (const key of todasClavesStock) {
      const vivoVal = Number(stockVivoMap[key] || 0);
      const recVal = Number(stockReconstruido[key] || 0);
      if (vivoVal !== recVal) {
        diferenciasStock.push({
          stock_key: key,
          vivo: vivoVal,
          reconstruido: recVal,
          diferencia: vivoVal - recVal
        });
      }
    }

    const diferenciasConsumos = [];
    const consumosGuardados = (this.repo && typeof this.repo.getConsumosFifo === 'function')
      ? this.repo.getConsumosFifo()
      : [];
    const consumosReconstruidosMap = reconstruccion.estado.consumosPorMovimiento || {};

    const mapaConsumosGuardados = new Map();
    for (const c of consumosGuardados) {
      const movId = String(c.id_movimiento || '').trim();
      const capaId = String(c.id_capa || '').trim();
      const cajas = Number(c.cajas || 0);
      if (!movId || !capaId || cajas <= 0) continue;
      const key = `${movId}|${capaId}`;
      mapaConsumosGuardados.set(key, (mapaConsumosGuardados.get(key) || 0) + cajas);
    }

    const mapaConsumosReconstruidos = new Map();
    for (const movId of Object.keys(consumosReconstruidosMap)) {
      const list = consumosReconstruidosMap[movId];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const capaId = String(item.id_capa || '').trim();
        const cajas = Number(item.cajas !== undefined ? item.cajas : item.cajas_descontadas);
        if (!movId || !capaId || cajas <= 0) continue;
        const key = `${movId}|${capaId}`;
        mapaConsumosReconstruidos.set(key, (mapaConsumosReconstruidos.get(key) || 0) + cajas);
      }
    }

    const todasClavesConsumo = new Set([...mapaConsumosGuardados.keys(), ...mapaConsumosReconstruidos.keys()]);
    for (const key of todasClavesConsumo) {
      const vivoVal = Number(mapaConsumosGuardados.get(key) || 0);
      const recVal = Number(mapaConsumosReconstruidos.get(key) || 0);
      if (vivoVal !== recVal) {
        const [movId, capaId] = key.split('|');
        diferenciasConsumos.push({
          id_movimiento: movId,
          id_capa: capaId,
          vivo: vivoVal,
          reconstruido: recVal,
          diferencia: vivoVal - recVal
        });
      }
    }

    const totalDiferencias = diferenciasCapas.length + diferenciasStock.length + diferenciasConsumos.length;

    return {
      consistente: totalDiferencias === 0 && Boolean(reconstruccion.isConsistent),
      totalDiferencias,
      diferenciasCapas,
      diferenciasStock,
      diferenciasConsumos,
      avisos: reconstruccion.avisos || []
    };
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

      const docId = docPayload.id_documento || this._nuevoId('DOC');
      const totalCajas = lineas.reduce((acc, l) => acc + (Number(l.cajas) || 0), 0);

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
        this._persistir({ documentos: { append: docRecord } });

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

      // 3. Cargar estado actual
      let { estado } = this._cargarEstado();
      const normFn = typeof normalizarFechaNegocio === 'function' ? normalizarFechaNegocio : (global.normalizarFechaNegocio || (d => d));
      const hoyFn = typeof hoyMadrid === 'function' ? hoyMadrid : (global.hoyMadrid || (() => new Date().toISOString().slice(0, 10)));

      let fechaNegocio = '';
      if (docPayload.fecha_documento) {
        try {
          fechaNegocio = normFn(docPayload.fecha_documento);
        } catch (e) {
          fechaNegocio = hoyFn();
        }
      } else {
        fechaNegocio = hoyFn();
      }

      const generatedMovements = [];
      const docRefStr = (docPayload.serie !== undefined && docPayload.numero !== undefined)
        ? `${String(docPayload.serie || '').trim()}/${String(docPayload.numero || '').trim()}`
        : docId;

      for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];
        const cajas = Number(linea.cajas);
        const idMov = this._nuevoId('MOV');
        const idCapa = this._nuevoId('CAPA');
        const origenDato = linea.origen_dato || linea.origenDato || docPayload.origen_dato || docPayload.origenDato || 'MANUAL';
        const kgInformativo = (linea.kg !== undefined && linea.kg !== null && linea.kg !== '')
          ? Number(linea.kg)
          : (linea.kg_informativo !== undefined && linea.kg_informativo !== null && linea.kg_informativo !== '' ? Number(linea.kg_informativo) : '');

        const mov = {
          id_movimiento: idMov,
          fecha_hora: new Date().toISOString(),
          tipo_movimiento: 'ENTRADA',
          id_documento_ref: docId,
          documento_ref: docRefStr,
          codigo_articulo: String(linea.codigo_articulo).trim(),
          codigo_envase: String(linea.codigo_envase).trim(),
          cajas,
          signo: 1,
          partida_origen: linea.partida || '',
          motivo_ajuste: '',
          usuario: usuario || 'SISTEMA',
          observaciones: linea.observaciones || '',
          estado: 'CONFIRMADO',
          fecha_negocio: fechaNegocio,
          entidad_nombre: String(docPayload.entidad_nombre || '').trim(),
          secuencia: '',
          origen_dato: origenDato,
          kg_informativo: kgInformativo,
          id_movimiento_ref: '',
          id_capa_objetivo: '',
          id_capa_creada: idCapa
        };

        const res = this.libro.aplicarMovimiento(estado, mov);
        if (!res.ok) {
          throw new Error(`Error inesperado al procesar entrada: ${res.error}`);
        }

        estado = res.estado;
        generatedMovements.push(mov);
      }

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

      // 4. Persistencia atómica en orden canónico (_persistir)
      this._persistir({
        movimientos: generatedMovements,
        estado,
        documentos: { append: docRecord }
      });

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
      let { estado } = this._cargarEstado();

      // 3. Pre-validación de stock disponible para TODO el documento
      const deficitReports = [];
      const stockKeyNeeds = {};

      for (const linea of lineas) {
        const key = this.engine.buildStockKey(linea.codigo_articulo, linea.codigo_envase);
        const cajas = Number(linea.cajas);
        stockKeyNeeds[key] = (stockKeyNeeds[key] || 0) + cajas;
      }

      for (const key in stockKeyNeeds) {
        const disponible = estado.stock[key] || 0;
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

      const docId = docPayload.id_documento || this._nuevoId('DOC');

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

        this._persistir({ documentos: { append: pendingDocRecord } });

        return {
          success: false,
          status: 'PENDIENTE_REVISION',
          errorCode: 'STOCK_INSUFICIENTE',
          message: 'Stock insuficiente para satisfacer la salida. El documento queda pendiente de revisión.',
          deficits: deficitReports,
          documentoId: docId
        };
      }

      // 4. Si hay stock suficiente: procesar deducciones FIFO con aplicarMovimiento
      const normFn = typeof normalizarFechaNegocio === 'function' ? normalizarFechaNegocio : (global.normalizarFechaNegocio || (d => d));
      const hoyFn = typeof hoyMadrid === 'function' ? hoyMadrid : (global.hoyMadrid || (() => new Date().toISOString().slice(0, 10)));
      let fechaNegocio = '';
      if (docPayload.fecha_documento) {
        try {
          fechaNegocio = normFn(docPayload.fecha_documento);
        } catch (e) {
          fechaNegocio = hoyFn();
        }
      } else {
        fechaNegocio = hoyFn();
      }

      const generatedMovements = [];
      let totalCajas = 0;

      for (const linea of lineas) {
        const cajas = Number(linea.cajas);
        totalCajas += cajas;
        const idMov = this._nuevoId('MOV');
        const origenDato = linea.origen_dato || linea.origenDato || docPayload.origen_dato || docPayload.origenDato || 'MANUAL';
        const kgInformativo = (linea.kg !== undefined && linea.kg !== null && linea.kg !== '')
          ? Number(linea.kg)
          : (linea.kg_informativo !== undefined && linea.kg_informativo !== null && linea.kg_informativo !== '' ? Number(linea.kg_informativo) : '');

        const mov = {
          id_movimiento: idMov,
          fecha_hora: new Date().toISOString(),
          tipo_movimiento: 'SALIDA',
          id_documento_ref: docId,
          codigo_articulo: String(linea.codigo_articulo).trim(),
          codigo_envase: String(linea.codigo_envase).trim(),
          cajas,
          signo: -1,
          partida_origen: linea.partida || '',
          motivo_ajuste: '',
          usuario: usuario || 'SISTEMA',
          observaciones: linea.observaciones || '',
          estado: 'CONFIRMADO',
          fecha_negocio: fechaNegocio,
          entidad_nombre: String(docPayload.entidad_nombre || '').trim(),
          secuencia: '',
          origen_dato: origenDato,
          kg_informativo: kgInformativo,
          id_movimiento_ref: '',
          id_capa_objetivo: '',
          id_capa_creada: ''
        };

        const res = this.libro.aplicarMovimiento(estado, mov);
        if (!res.ok) {
          throw new Error(`Inconsistencia en deducción FIFO: ${res.error}`);
        }

        estado = res.estado;
        generatedMovements.push(mov);
      }

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

      this._persistir({
        movimientos: generatedMovements,
        estado,
        documentos: { append: docRecord }
      });

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
      const { estado } = this._cargarEstado();
      const hoyFn = typeof hoyMadrid === 'function' ? hoyMadrid : (global.hoyMadrid || (() => new Date().toISOString().slice(0, 10)));
      const normFn = typeof normalizarFechaNegocio === 'function' ? normalizarFechaNegocio : (global.normalizarFechaNegocio || (d => d));

      const rawFecha = ajusteInput.fecha || hoyFn();
      let fechaNegocio = '';
      try {
        fechaNegocio = normFn(rawFecha);
      } catch (e) {
        fechaNegocio = hoyFn();
      }

      const codigoArticulo = String(ajusteInput.codigo_articulo || ajusteInput.codigoArticulo || '').trim();
      const codigoEnvase = String(ajusteInput.codigo_envase || ajusteInput.codigoEnvase || '').trim();
      const cajas = Number(ajusteInput.cajas);
      const signo = Number(ajusteInput.signo);
      const motivo = String(ajusteInput.motivo || '').trim();

      // Validar entrada de dominio
      if (this.engine && typeof this.engine.validateMovementInput === 'function') {
        this.engine.validateMovementInput({
          tipo: 'AJUSTE',
          codigoArticulo,
          codigoEnvase,
          cajas,
          signo,
          motivo,
          usuario
        });
      } else {
        if (!codigoArticulo) throw new Error('codigoArticulo es obligatorio');
        if (!codigoEnvase) throw new Error('codigoEnvase es obligatorio');
        if (!Number.isInteger(cajas) || cajas <= 0) throw new Error(`Cantidad de cajas debe ser un entero positivo mayor a 0. Valor recibido: ${ajusteInput.cajas}`);
        if (![1, -1].includes(signo)) throw new Error(`Signo de ajuste debe ser 1 o -1. Valor recibido: ${ajusteInput.signo}`);
        if (!motivo) throw new Error('Motivo es obligatorio en movimientos de tipo AJUSTE');
        if (!usuario || String(usuario).trim() === '') throw new Error('Usuario es obligatorio en movimientos de tipo AJUSTE');
      }

      const stockKey = this.engine.buildStockKey(codigoArticulo, codigoEnvase);
      const stockAnterior = Number(estado.stock[stockKey] || 0);
      const idMov = this._nuevoId('MOV');
      const idCapaObj = String(ajusteInput.id_capa_objetivo || ajusteInput.idCapaObjetivo || '').trim();
      const idMovRef = String(ajusteInput.id_movimiento_ref || ajusteInput.idMovimientoRef || '').trim();
      const idCapaCreada = (signo === 1 && !idCapaObj && !idMovRef)
        ? (ajusteInput.id_capa_creada || ajusteInput.idCapa || this._nuevoId('CAPA-AJUSTE'))
        : '';

      const kgInformativo = (ajusteInput.kg !== undefined && ajusteInput.kg !== null && ajusteInput.kg !== '')
        ? Number(ajusteInput.kg)
        : (ajusteInput.kg_informativo !== undefined && ajusteInput.kg_informativo !== null && ajusteInput.kg_informativo !== '' ? Number(ajusteInput.kg_informativo) : '');

      const mov = {
        id_movimiento: idMov,
        fecha_hora: new Date().toISOString(),
        tipo_movimiento: 'AJUSTE',
        id_documento_ref: ajusteInput.id_documento_ref || ajusteInput.documentoRef || `AJUSTE:${motivo}`,
        codigo_articulo: codigoArticulo,
        codigo_envase: codigoEnvase,
        cajas,
        signo,
        partida_origen: ajusteInput.partida || '',
        motivo_ajuste: motivo,
        usuario,
        observaciones: ajusteInput.observaciones || '',
        estado: 'CONFIRMADO',
        fecha_negocio: fechaNegocio,
        entidad_nombre: String(ajusteInput.entidad || ajusteInput.entidad_nombre || '').trim(),
        secuencia: '',
        origen_dato: ajusteInput.origenDato || ajusteInput.origen_dato || 'MANUAL',
        kg_informativo: kgInformativo,
        id_movimiento_ref: idMovRef,
        id_capa_objetivo: idCapaObj,
        id_capa_creada: idCapaCreada
      };

      const res = this.libro.aplicarMovimiento(estado, mov);
      if (!res.ok) {
        if (res.errorCode === 'CONSUMOS_DESCONOCIDOS') {
          return {
            success: false,
            status: 'REVISION_NECESARIA',
            errorCode: 'CONSUMOS_DESCONOCIDOS',
            message: res.error || 'Consumos FIFO desconocidos para el movimiento referenciado.'
          };
        }
        return {
          success: false,
          status: 'PENDIENTE_REVISION',
          errorCode: res.errorCode || 'STOCK_INSUFICIENTE',
          stockKey,
          stockDisponible: res.stockDisponible !== undefined ? res.stockDisponible : stockAnterior,
          cajasSolicitadas: cajas,
          deficit: res.deficit !== undefined ? res.deficit : Math.max(0, cajas - stockAnterior),
          message: res.error
        };
      }

      const nuevoEstado = res.estado;
      const stockNuevo = Number(nuevoEstado.stock[stockKey] || 0);

      this._persistir({
        movimientos: [mov],
        estado: nuevoEstado
      });

      return {
        success: true,
        status: 'CONFIRMADO',
        stockKey,
        cajasAfectadas: cajas,
        stockAnterior,
        stockNuevo,
        movimientoId: mov.id_movimiento
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
   * Regla 4 (T-022): combinaciones de consumo dirigido + creación de capas,
   * con la fecha y el proveedor de la capa de origen.
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  registrarReclasificacion(params, usuario = 'SISTEMA') {
    const artOrigen = String(params.codigo_articulo_origen || params.codigo_articulo || params.codigoArticulo || '').trim();
    const artDestino = String(params.codigo_articulo_destino || params.codigo_articulo || params.codigoArticulo || '').trim();
    const envOrigen = String(params.codigo_envase_origen || params.codigoEnvaseOrigen || '').trim();
    const envDestino = String(params.codigo_envase_destino || params.codigoEnvaseDestino || '').trim();
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
      let { estado } = this._cargarEstado();
      const keyOrigen = this.engine.buildStockKey(artOrigen, envOrigen);
      const keyDestino = this.engine.buildStockKey(artDestino, envDestino);
      const stockDisp = Number(estado.stock[keyOrigen] || 0);

      if (stockDisp < cajas) {
        return {
          success: false,
          status: 'STOCK_INSUFICIENTE',
          message: `Stock insuficiente en origen (${keyOrigen}). Disponible: ${stockDisp}, Solicitado: ${cajas}`,
          disponible: stockDisp,
          solicitado: cajas
        };
      }

      const stockAnteriorOrigen = stockDisp;
      const stockAnteriorDestino = Number(estado.stock[keyDestino] || 0);
      const refOperacion = this._nuevoId('RECLASIF:');
      const nowIso = new Date().toISOString();

      // Identificar capas de origen por FIFO para consumir de forma dirigida y crear capas destino con la fecha y proveedor de cada capa origen
      const ordenarFn = this.engine && typeof this.engine.sortFifoLayers === 'function'
        ? this.engine.sortFifoLayers
        : (arr => [...arr]);
      const capasOrigenActivas = ordenarFn(
        estado.capas.filter(l =>
          this.engine.buildStockKey(l.codigo_articulo, l.codigo_envase) === keyOrigen &&
          l.estado_capa === 'ACTIVA' &&
          Number(l.cajas_restantes || 0) > 0
        )
      );

      let porConsumir = cajas;
      const tramos = [];
      for (const capa of capasOrigenActivas) {
        if (porConsumir <= 0) break;
        const disp = Number(capa.cajas_restantes || 0);
        const cant = Math.min(porConsumir, disp);
        tramos.push({
          capaOrigen: capa,
          cajas: cant
        });
        porConsumir -= cant;
      }

      if (porConsumir > 0) {
        return {
          success: false,
          status: 'STOCK_INSUFICIENTE',
          message: `Stock insuficiente en capas FIFO de origen (${keyOrigen}).`,
          disponible: stockDisp - porConsumir,
          solicitado: cajas
        };
      }

      const generatedMovements = [];
      let primerMovSalidaId = '';
      let ultimoMovEntradaId = '';

      for (const tramo of tramos) {
        const { capaOrigen, cajas: cantTramo } = tramo;
        const idMovSal = this._nuevoId('MOV');
        const idMovEnt = this._nuevoId('MOV');
        const idCapaNueva = this._nuevoId('CAPA');

        if (!primerMovSalidaId) primerMovSalidaId = idMovSal;
        ultimoMovEntradaId = idMovEnt;

        const movSalida = {
          id_movimiento: idMovSal,
          fecha_hora: nowIso,
          tipo_movimiento: 'AJUSTE',
          id_documento_ref: refOperacion,
          codigo_articulo: artOrigen,
          codigo_envase: envOrigen,
          cajas: cantTramo,
          signo: -1,
          partida_origen: capaOrigen.partida || '',
          motivo_ajuste: `${motivo}_ORIGEN`,
          usuario,
          observaciones: `${observaciones} (SALIDA)`,
          estado: 'CONFIRMADO',
          fecha_negocio: capaOrigen.fecha_capa,
          entidad_nombre: capaOrigen.proveedor || '',
          secuencia: '',
          origen_dato: 'MANUAL',
          kg_informativo: '',
          id_movimiento_ref: '',
          id_capa_objetivo: capaOrigen.id_capa,
          id_capa_creada: ''
        };

        const resSal = this.libro.aplicarMovimiento(estado, movSalida);
        if (!resSal.ok) {
          throw new Error(`Error en reclasificación origen: ${resSal.error}`);
        }
        estado = resSal.estado;
        generatedMovements.push(movSalida);

        const movEntrada = {
          id_movimiento: idMovEnt,
          fecha_hora: nowIso,
          tipo_movimiento: 'AJUSTE',
          id_documento_ref: refOperacion,
          codigo_articulo: artDestino,
          codigo_envase: envDestino,
          cajas: cantTramo,
          signo: 1,
          partida_origen: params.partida || capaOrigen.partida || '',
          motivo_ajuste: `${motivo}_DESTINO`,
          usuario,
          observaciones: `${observaciones} (ENTRADA)`,
          estado: 'CONFIRMADO',
          fecha_negocio: capaOrigen.fecha_capa,
          entidad_nombre: capaOrigen.proveedor || '',
          secuencia: '',
          origen_dato: 'MANUAL',
          kg_informativo: '',
          id_movimiento_ref: idMovSal,
          id_capa_objetivo: '',
          id_capa_creada: idCapaNueva,
          id_capa_origen: capaOrigen.id_capa
        };

        const resEnt = this.libro.aplicarMovimiento(estado, movEntrada);
        if (!resEnt.ok) {
          throw new Error(`Error en reclasificación destino: ${resEnt.error}`);
        }
        estado = resEnt.estado;
        generatedMovements.push(movEntrada);
      }

      this._persistir({
        movimientos: generatedMovements,
        estado
      });

      return {
        success: true,
        status: 'CONFIRMADO',
        referenciaOperacion: refOperacion,
        movimientoSalidaId: primerMovSalidaId,
        movimientoEntradaId: ultimoMovEntradaId,
        cajasReclasificadas: cajas,
        origen: {
          stockKey: keyOrigen,
          stockAnterior: stockAnteriorOrigen,
          stockNuevo: Number(estado.stock[keyOrigen] || 0)
        },
        destino: {
          stockKey: keyDestino,
          stockAnterior: stockAnteriorDestino,
          stockNuevo: Number(estado.stock[keyDestino] || 0)
        }
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Mueve cajas entre partidas dentro del mismo artículo y envase.
   * Regla 4 (T-022): combinaciones de consumo dirigido + creación de capas,
   * con la fecha y el proveedor de la capa de origen.
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  registrarMovimientoPartida(params, usuario = 'SISTEMA') {
    const art = String(params.codigo_articulo || params.codigoArticulo || '').trim();
    const env = String(params.codigo_envase || params.codigoEnvase || '').trim();
    const partidaOrigen = String(params.partida_origen || params.partidaOrigen || '').trim();
    const partidaDestino = String(params.partida_destino || params.partidaDestino || '').trim();
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
      let { estado } = this._cargarEstado();

      const key = this.engine.buildStockKey(art, env);
      const ordenarFn = this.engine && typeof this.engine.sortFifoLayers === 'function'
        ? this.engine.sortFifoLayers
        : (arr => [...arr]);
      const capasOrigen = ordenarFn(
        estado.capas.filter(c => 
          this.engine.buildStockKey(c.codigo_articulo, c.codigo_envase) === key &&
          (c.partida === partidaOrigen || c.partida_id === partidaOrigen) &&
          c.estado_capa === 'ACTIVA' &&
          Number(c.cajas_restantes || 0) > 0
        )
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

      const refOperacion = this._nuevoId('MOV_PARTIDA:');
      const nowIso = new Date().toISOString();

      let porDescontar = cajas;
      const generatedMovements = [];
      let primerMovSalidaId = '';
      let ultimoMovEntradaId = '';

      for (const capa of capasOrigen) {
        if (porDescontar <= 0) break;
        const dispCapa = Number(capa.cajas_restantes || 0);
        const aRestar = Math.min(porDescontar, dispCapa);
        porDescontar -= aRestar;

        const idMovSal = this._nuevoId('MOV');
        const idMovEnt = this._nuevoId('MOV');
        const idCapaNueva = this._nuevoId('CAPA');

        if (!primerMovSalidaId) primerMovSalidaId = idMovSal;
        ultimoMovEntradaId = idMovEnt;

        const movSalida = {
          id_movimiento: idMovSal,
          fecha_hora: nowIso,
          tipo_movimiento: 'AJUSTE',
          id_documento_ref: refOperacion,
          codigo_articulo: art,
          codigo_envase: env,
          cajas: aRestar,
          signo: -1,
          partida_origen: partidaOrigen,
          motivo_ajuste: `${motivo}_ORIGEN`,
          usuario,
          observaciones: `${observaciones} (ORIGEN)`,
          estado: 'CONFIRMADO',
          fecha_negocio: capa.fecha_capa,
          entidad_nombre: capa.proveedor || '',
          secuencia: '',
          origen_dato: 'MANUAL',
          kg_informativo: '',
          id_movimiento_ref: '',
          id_capa_objetivo: capa.id_capa,
          id_capa_creada: ''
        };

        const resSal = this.libro.aplicarMovimiento(estado, movSalida);
        if (!resSal.ok) {
          throw new Error(`Error al descontar partida origen: ${resSal.error}`);
        }
        estado = resSal.estado;
        generatedMovements.push(movSalida);

        const movEntrada = {
          id_movimiento: idMovEnt,
          fecha_hora: nowIso,
          tipo_movimiento: 'AJUSTE',
          id_documento_ref: refOperacion,
          codigo_articulo: art,
          codigo_envase: env,
          cajas: aRestar,
          signo: 1,
          partida_origen: partidaDestino,
          motivo_ajuste: `${motivo}_DESTINO`,
          usuario,
          observaciones: `${observaciones} (DESTINO)`,
          estado: 'CONFIRMADO',
          fecha_negocio: capa.fecha_capa,
          entidad_nombre: capa.proveedor || '',
          secuencia: '',
          origen_dato: 'MANUAL',
          kg_informativo: '',
          id_movimiento_ref: idMovSal,
          id_capa_objetivo: '',
          id_capa_creada: idCapaNueva,
          id_capa_origen: capa.id_capa
        };

        const resEnt = this.libro.aplicarMovimiento(estado, movEntrada);
        if (!resEnt.ok) {
          throw new Error(`Error al crear capa de partida destino: ${resEnt.error}`);
        }
        estado = resEnt.estado;
        generatedMovements.push(movEntrada);
      }

      this._persistir({
        movimientos: generatedMovements,
        estado
      });

      return {
        success: true,
        status: 'CONFIRMADO',
        referenciaOperacion: refOperacion,
        movimientoSalidaId: primerMovSalidaId,
        movimientoEntradaId: ultimoMovEntradaId,
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
   * de movimientos confirmados usando `reconstruir(movimientos)` de `src/Libro.js`.
   * No altera los registros de la tabla MOVIMIENTOS.
   * 
   * @returns {Object} Informe de auditoría y conciliación
   */
  rebuildStock() {
    this._acquireLock(30000);
    try {
      const allMovements = this.repo.getMovimientos();
      const rec = this.libro.reconstruir(allMovements);

      const report = {
        stockMap: rec.estado.stock,
        reconstructedLayers: rec.estado.capas,
        consumosPorMovimiento: rec.estado.consumosPorMovimiento,
        avisos: rec.avisos,
        totalCajasPorCapas: rec.totalCajasPorCapas,
        totalCajasPorStock: rec.totalCajasPorStock,
        isConsistent: rec.isConsistent,
        totalMovimientosProcesados: rec.totalMovimientosProcesados
      };

      this._persistir({
        movimientos: [],
        estado: rec.estado,
        ultimoMovimientoId: 'REBUILD'
      });

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

      // 6. Cargar estado vivo y aplicar entradas con Libro.aplicarMovimiento
      let { estado } = this._cargarEstado();
      const normFn = typeof normalizarFechaNegocio === 'function' ? normalizarFechaNegocio : (global.normalizarFechaNegocio || (d => d));
      const hoyFn = typeof hoyMadrid === 'function' ? hoyMadrid : (global.hoyMadrid || (() => new Date().toISOString().slice(0, 10)));

      let fechaNegocio = '';
      if (doc.fecha_documento) {
        try {
          fechaNegocio = normFn(doc.fecha_documento);
        } catch (e) {
          fechaNegocio = hoyFn();
        }
      } else {
        fechaNegocio = hoyFn();
      }

      const generatedMovements = [];
      const docRefStr = `${String(doc.serie || '').trim()}/${String(doc.numero || '').trim()}`;

      for (const linea of resolvedLines) {
        const idMov = this._nuevoId('MOV');
        const idCapa = this._nuevoId('CAPA');

        const mov = {
          id_movimiento: idMov,
          fecha_hora: new Date().toISOString(),
          tipo_movimiento: 'ENTRADA',
          id_documento_ref: idDocumento,
          documento_ref: docRefStr,
          codigo_articulo: String(linea.codigo_articulo).trim(),
          codigo_envase: String(linea.codigo_envase).trim(),
          cajas: Number(linea.cajas),
          signo: 1,
          partida_origen: linea.partida || '',
          motivo_ajuste: '',
          usuario: usuario || 'SISTEMA',
          observaciones: '',
          estado: 'CONFIRMADO',
          fecha_negocio: fechaNegocio,
          entidad_nombre: String(doc.entidad_nombre || '').trim(),
          secuencia: '',
          origen_dato: 'MANUAL',
          kg_informativo: '',
          id_movimiento_ref: '',
          id_capa_objetivo: '',
          id_capa_creada: idCapa
        };

        const res = this.libro.aplicarMovimiento(estado, mov);
        if (!res.ok) {
          throw new Error(`Error inesperado al procesar entrada: ${res.error}`);
        }

        estado = res.estado;
        generatedMovements.push(mov);
      }

      // 7. Persistir en orden canónico (_persistir: 1. movimientos, 2. capas, 3. stock, 4. documentos)
      doc.estado_proceso = 'CONFIRMADO';
      this._persistir({
        movimientos: generatedMovements,
        estado,
        documentos: {
          updateEstado: {
            idDocumento,
            nuevoEstado: 'CONFIRMADO',
            fallbackDocs: existingDocs
          }
        }
      });

      // 8. Persistir aprendizaje dinámico si se especificó 'recordar: true'
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
   * Anula una entrada de inventario de forma segura y no destructiva.
   * Regla 4 (T-022): Anular = un movimiento ANULACION, con estado CONFIRMADO y id_movimiento_ref.
   * Si la entrada ya tiene consumos posteriores, BLOQUEA la operación (REVISION_NECESARIA).
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  anularEntrada(params = {}, usuario = 'SISTEMA') {
    this._acquireLock(30000);
    try {
      let { estado } = this._cargarEstado();

      const layer = this._findLayer(estado.capas, params);
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
      const hoyFn = typeof hoyMadrid === 'function' ? hoyMadrid : (global.hoyMadrid || (() => new Date().toISOString().slice(0, 10)));
      const nowIso = new Date().toISOString();

      const movAnulacion = {
        id_movimiento: this._nuevoId('MOV-ANUL'),
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
        estado: 'CONFIRMADO',
        fecha_negocio: layer.fecha_capa || hoyFn(),
        entidad_nombre: layer.proveedor || '',
        secuencia: '',
        origen_dato: 'MANUAL',
        kg_informativo: '',
        id_movimiento_ref: layer.id_movimiento_entrada || '',
        id_capa_objetivo: layer.id_capa,
        id_capa_creada: ''
      };

      const res = this.libro.aplicarMovimiento(estado, movAnulacion);
      if (!res.ok) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: res.errorCode || 'ENTRADA_CON_CONSUMOS',
          message: res.error
        };
      }

      estado = res.estado;

      // Si existe documento en DOCUMENTOS, preparar actualización de estado
      const docs = this.repo.getDocumentos();
      const doc = docs.find(d => 
        (layer.documento_ref && `${d.serie}/${d.numero}` === layer.documento_ref) ||
        (d.id_documento && d.id_documento === layer.documento_ref)
      );
      let docUpdate = null;
      if (doc) {
        doc.estado_proceso = 'ANULADO';
        docUpdate = {
          updateEstado: {
            idDocumento: doc.id_documento,
            nuevoEstado: 'ANULADO',
            fallbackDocs: docs
          }
        };
      }

      this._persistir({
        movimientos: [movAnulacion],
        estado,
        documentos: docUpdate
      });

      return {
        success: true,
        status: 'CONFIRMADO',
        estado: 'ANULADA',
        cajasAnuladas,
        stockKey,
        stockRestante: Number(estado.stock[stockKey] || 0),
        movimientoId: movAnulacion.id_movimiento
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Anula una salida de inventario, restituyendo exactamente las cajas consumidas a sus capas
   * FIFO originales mediante movimientos `ANULACION` con `estado: 'CONFIRMADO'` y `id_movimiento_ref` (D-012, T-022).
   * 
   * @param {Object} params
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  anularSalida(params = {}, usuario = 'SISTEMA') {
    this._acquireLock(30000);
    try {
      let { estado, movimientos: allMovs } = this._cargarEstado();

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

      const salidaMovs = allMovs.filter(m => 
        m.tipo_movimiento === 'SALIDA' &&
        (m.id_documento_ref === docRef ||
         (targetDocId && m.id_documento_ref === targetDocId) ||
         m.id_movimiento === params.id_movimiento ||
         (docRef && String(m.id_documento_ref || '').includes(docRef)))
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
      const hoyFn = typeof hoyMadrid === 'function' ? hoyMadrid : (global.hoyMadrid || (() => new Date().toISOString().slice(0, 10)));

      for (const mov of salidaMovs) {
        // Calcular cuántas cajas quedan efectivamente consumidas por esta salida (por si tuvo correcciones previas)
        const consumosActivos = estado.consumosPorMovimiento[mov.id_movimiento];
        const cajasEfectivas = Array.isArray(consumosActivos) && consumosActivos.length > 0
          ? consumosActivos.reduce((s, c) => s + Number(c.cajas || 0), 0)
          : Number(mov.cajas || 0);

        const movAnul = {
          id_movimiento: this._nuevoId('MOV-ANUL'),
          fecha_hora: nowIso,
          tipo_movimiento: 'ANULACION',
          id_documento_ref: mov.id_documento_ref || docRef || '',
          codigo_articulo: mov.codigo_articulo,
          codigo_envase: mov.codigo_envase,
          cajas: cajasEfectivas,
          signo: 1,
          partida_origen: mov.partida_origen || '',
          motivo_ajuste: params.motivo || 'ANULAR_SALIDA',
          usuario,
          observaciones: params.observaciones || 'Anulación y restitución FIFO de salida',
          estado: 'CONFIRMADO',
          fecha_negocio: mov.fecha_negocio || hoyFn(),
          entidad_nombre: mov.entidad_nombre || '',
          secuencia: '',
          origen_dato: 'MANUAL',
          kg_informativo: '',
          id_movimiento_ref: mov.id_movimiento,
          id_capa_objetivo: '',
          id_capa_creada: ''
        };

        const res = this.libro.aplicarMovimiento(estado, movAnul);
        if (!res.ok) {
          if (res.errorCode === 'CONSUMOS_DESCONOCIDOS') {
            return {
              success: false,
              status: 'REVISION_NECESARIA',
              errorCode: 'CONSUMOS_DESCONOCIDOS',
              message: res.error || 'Consumos FIFO desconocidos para la salida que se desea anular.'
            };
          }
          throw new Error(`Error al anular salida ${mov.id_movimiento}: ${res.error}`);
        }

        estado = res.estado;
        totalCajasRestauradas += cajasEfectivas;
        movsAnulacion.push(movAnul);
      }

      let docUpdate = null;
      const doc = docObj || docs.find(d => 
        (docRef && `${d.serie}/${d.numero}` === docRef) ||
        (d.id_documento && d.id_documento === docRef)
      );
      if (doc) {
        doc.estado_proceso = 'ANULADO';
        docUpdate = {
          updateEstado: {
            idDocumento: doc.id_documento,
            nuevoEstado: 'ANULADO',
            fallbackDocs: docs
          }
        };
      }

      this._persistir({
        movimientos: movsAnulacion,
        estado,
        documentos: docUpdate
      });

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
   * Calcula la cantidad efectiva actual de una salida histórica teniendo en cuenta ajustes previos con `id_movimiento_ref`.
   * @param {Object} movSalida
   * @param {Array<Object>} allMovs
   * @returns {number}
   */
  _calcularCantidadEfectivaSalida(movSalida, allMovs = []) {
    let total = Number(movSalida.cajas || 0);
    const idSal = String(movSalida.id_movimiento || '').trim();
    if (!idSal) return total;

    for (const m of allMovs) {
      if (String(m.id_movimiento_ref || '').trim() !== idSal) continue;
      if (String(m.estado || '').trim().toUpperCase() !== 'CONFIRMADO') continue;
      const tipo = String(m.tipo_movimiento || '').trim().toUpperCase();
      const signo = Number(m.signo || 0);
      const c = Math.abs(Number(m.cajas || 0));
      if (tipo === 'AJUSTE' && signo === 1) {
        total -= c; // devolvió cajas a capas -> redujo la salida
      } else if ((tipo === 'AJUSTE' || tipo === 'SALIDA') && signo === -1) {
        total += c; // consumió más cajas -> amplió la salida
      }
    }
    return total;
  }

  /**
   * Corrige la cantidad de una salida histórica sin tocar el movimiento original (D-022, T-022 Regla 4):
   * - A la baja: AJUSTE + con `id_movimiento_ref` a la salida. Devuelve las cajas a las capas de esa salida, en orden inverso al consumo.
   * - Al alza: AJUSTE − por FIFO con `id_movimiento_ref`.
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
      let { estado, movimientos: allMovs } = this._cargarEstado();

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

      const mov = allMovs.find(m => 
        m.tipo_movimiento === 'SALIDA' &&
        (m.id_documento_ref === docRef ||
         (targetDocId && m.id_documento_ref === targetDocId) ||
         m.id_movimiento === params.id_movimiento ||
         (docRef && String(m.id_documento_ref || '').includes(docRef)))
      );

      if (!mov) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'SALIDA_NO_ENCONTRADA',
          message: 'No se encontró el movimiento de salida a corregir.'
        };
      }

      const cajasActualesSalida = this._calcularCantidadEfectivaSalida(mov, allMovs);
      const delta = cajasActualesSalida - nuevaCantidad; // positivo = devolver cajas a stock, negativo = consumir más

      if (delta === 0) {
        return { success: true, status: 'CONFIRMADO', message: 'Cantidad idéntica, sin cambios.' };
      }

      const stockKey = this.engine.buildStockKey(mov.codigo_articulo, mov.codigo_envase);
      const nowIso = new Date().toISOString();
      const hoyFn = typeof hoyMadrid === 'function' ? hoyMadrid : (global.hoyMadrid || (() => new Date().toISOString().slice(0, 10)));

      if (delta > 0) {
        // Corrección a la baja: AJUSTE + con id_movimiento_ref a la salida
        const movAjuste = {
          id_movimiento: this._nuevoId('MOV-CORR-SAL'),
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
          observaciones: `Corrección de salida: reducción de ${cajasActualesSalida} a ${nuevaCantidad} cajas (+${delta} reintegradas a FIFO)`,
          estado: 'CONFIRMADO',
          fecha_negocio: mov.fecha_negocio || hoyFn(),
          entidad_nombre: mov.entidad_nombre || '',
          secuencia: '',
          origen_dato: 'MANUAL',
          kg_informativo: '',
          id_movimiento_ref: mov.id_movimiento,
          id_capa_objetivo: '',
          id_capa_creada: ''
        };

        const res = this.libro.aplicarMovimiento(estado, movAjuste);
        if (!res.ok) {
          if (res.errorCode === 'CONSUMOS_DESCONOCIDOS') {
            return {
              success: false,
              status: 'REVISION_NECESARIA',
              errorCode: 'CONSUMOS_DESCONOCIDOS',
              message: res.error || 'Consumos FIFO desconocidos para la salida que se desea corregir.'
            };
          }
          throw new Error(`Error al corregir salida a la baja: ${res.error}`);
        }

        estado = res.estado;
        this._persistir({
          movimientos: [movAjuste],
          estado
        });

        return {
          success: true,
          status: 'CONFIRMADO',
          cajasRestauradas: delta,
          nuevaCantidad,
          stockNuevo: Number(estado.stock[stockKey] || 0)
        };
      } else {
        // Corrección al alza: AJUSTE - por FIFO con id_movimiento_ref
        const aConsumir = Math.abs(delta);
        const movAjuste = {
          id_movimiento: this._nuevoId('MOV-CORR-SAL'),
          fecha_hora: nowIso,
          tipo_movimiento: 'AJUSTE',
          id_documento_ref: mov.id_documento_ref || '',
          codigo_articulo: mov.codigo_articulo,
          codigo_envase: mov.codigo_envase,
          cajas: aConsumir,
          signo: -1,
          partida_origen: mov.partida_origen || '',
          motivo_ajuste: params.motivo || 'CORRECCION_CANTIDAD_SALIDA',
          usuario,
          observaciones: `Corrección de salida: ampliación de ${cajasActualesSalida} a ${nuevaCantidad} cajas (-${aConsumir} por FIFO)`,
          estado: 'CONFIRMADO',
          fecha_negocio: mov.fecha_negocio || hoyFn(),
          entidad_nombre: mov.entidad_nombre || '',
          secuencia: '',
          origen_dato: 'MANUAL',
          kg_informativo: '',
          id_movimiento_ref: mov.id_movimiento,
          id_capa_objetivo: '',
          id_capa_creada: ''
        };

        const res = this.libro.aplicarMovimiento(estado, movAjuste);
        if (!res.ok) {
          return {
            success: false,
            status: 'REVISION_NECESARIA',
            errorCode: 'STOCK_INSUFICIENTE',
            message: `Stock insuficiente para ampliar la salida en ${aConsumir} cajas.`,
            deficit: res.deficit
          };
        }

        estado = res.estado;

        this._persistir({
          movimientos: [movAjuste],
          estado
        });

        return {
          success: true,
          status: 'CONFIRMADO',
          cajasDeducidas: aConsumir,
          nuevaCantidad,
          stockNuevo: Number(estado.stock[stockKey] || 0)
        };
      }
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Calcula la cantidad efectiva actual de una capa de entrada teniendo en cuenta
   * correcciones de cantidad previas (`AJUSTE` ± con `id_capa_objetivo === layer.id_capa`
   * y motivo `CORRECCION_CANTIDAD_ENTRADA`), ya que `cajas_iniciales` nunca se modifica (Regla 4).
   * @param {Object} layer
   * @param {Array<Object>} allMovs
   * @returns {number}
   */
  _calcularCantidadEfectivaEntrada(layer, allMovs = []) {
    let total = Number(layer.cajas_iniciales || 0);
    const idCapa = String(layer.id_capa || '').trim();
    if (!idCapa) return total;

    for (const m of allMovs) {
      if (String(m.id_capa_objetivo || '').trim() !== idCapa) continue;
      if (String(m.estado || '').trim().toUpperCase() !== 'CONFIRMADO') continue;
      if (String(m.tipo_movimiento || '').trim().toUpperCase() !== 'AJUSTE') continue;
      // Si tiene id_movimiento_ref a una salida o es transferencia/división con capa creada después,
      // solo los ajustes de corrección de cantidad cambian el total de la entrada
      const obs = String(m.observaciones || '');
      const motivo = String(m.motivo_ajuste || '');
      if (motivo === 'CORRECCION_CANTIDAD_ENTRADA' || obs.startsWith('Corrección de entrada:')) {
        const signo = Number(m.signo || 0);
        const c = Math.abs(Number(m.cajas || 0));
        total += signo * c;
      }
    }
    return total;
  }

  /**
   * Corrige la cantidad de una entrada histórica de forma determinista y segura.
   * Regla 4 (T-022): Corregir la cantidad de una entrada = AJUSTE ± con `id_capa_objetivo` = su capa.
   * `cajas_iniciales` de la capa NO se toca: la capa muestra su historial.
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
      let { estado, movimientos: allMovs } = this._cargarEstado();

      const layer = this._findLayer(estado.capas, params);
      if (!layer) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'CAPA_NO_ENCONTRADA',
          message: 'No se encontró la capa de entrada a corregir.'
        };
      }

      const cajasEfectivas = this._calcularCantidadEfectivaEntrada(layer, allMovs);
      const cajasRestantes = Number(layer.cajas_restantes || 0);
      const cajasConsumidas = Number(layer.cajas_consumidas || 0);
      const delta = nuevaCantidad - cajasEfectivas; // negativo = reducción, positivo = aumento

      if (delta === 0) {
        return { success: true, status: 'CONFIRMADO', message: 'Cantidad idéntica, sin cambios.' };
      }

      const stockKey = this.engine.buildStockKey(layer.codigo_articulo, layer.codigo_envase);
      const nowIso = new Date().toISOString();
      const hoyFn = typeof hoyMadrid === 'function' ? hoyMadrid : (global.hoyMadrid || (() => new Date().toISOString().slice(0, 10)));

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

        const movAjuste = {
          id_movimiento: this._nuevoId('MOV-CORR-ENT'),
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
          observaciones: `Corrección de entrada: reducción de ${cajasEfectivas} a ${nuevaCantidad} cajas`,
          estado: 'CONFIRMADO',
          fecha_negocio: layer.fecha_capa || hoyFn(),
          entidad_nombre: layer.proveedor || '',
          secuencia: '',
          origen_dato: 'MANUAL',
          kg_informativo: '',
          id_movimiento_ref: layer.id_movimiento_entrada || '',
          id_capa_objetivo: layer.id_capa,
          id_capa_creada: ''
        };

        const res = this.libro.aplicarMovimiento(estado, movAjuste);
        if (!res.ok) {
          return {
            success: false,
            status: 'REVISION_NECESARIA',
            errorCode: res.errorCode || 'CANTIDAD_INSUFICIENTE_EN_CAPA',
            message: res.error
          };
        }

        estado = res.estado;
        this._persistir({
          movimientos: [movAjuste],
          estado
        });

        return {
          success: true,
          status: 'CONFIRMADO',
          cajasReducidas: reduccion,
          nuevaCantidad,
          stockNuevo: Number(estado.stock[stockKey] || 0)
        };
      } else {
        const aumento = delta;
        const movAjuste = {
          id_movimiento: this._nuevoId('MOV-CORR-ENT'),
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
          observaciones: `Corrección de entrada: aumento de ${cajasEfectivas} a ${nuevaCantidad} cajas`,
          estado: 'CONFIRMADO',
          fecha_negocio: layer.fecha_capa || hoyFn(),
          entidad_nombre: layer.proveedor || '',
          secuencia: '',
          origen_dato: 'MANUAL',
          kg_informativo: '',
          id_movimiento_ref: layer.id_movimiento_entrada || '',
          id_capa_objetivo: layer.id_capa,
          id_capa_creada: ''
        };

        const res = this.libro.aplicarMovimiento(estado, movAjuste);
        if (!res.ok) {
          throw new Error(`Error al ampliar entrada: ${res.error}`);
        }

        estado = res.estado;
        this._persistir({
          movimientos: [movAjuste],
          estado
        });

        return {
          success: true,
          status: 'CONFIRMADO',
          cajasAumentadas: aumento,
          nuevaCantidad,
          stockNuevo: Number(estado.stock[stockKey] || 0)
        };
      }
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Corrige una entrada que ya ha sido parcialmente consumida por salidas posteriores.
   * Regla 4 (T-022): combinación de consumo dirigido (`AJUSTE -` con `id_capa_objetivo`) +
   * creación de nueva capa (`AJUSTE +` con `id_capa_creada`), con la fecha y el proveedor de la capa de origen.
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
      let { estado } = this._cargarEstado();

      const layer = this._findLayer(estado.capas, params);
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
      const targetArt = String(artDestino || artOrigen).trim();
      const targetEnv = String(envDestino || envOrigen).trim();

      const keyOrigen = this.engine.buildStockKey(artOrigen, envOrigen);
      const keyDestino = this.engine.buildStockKey(targetArt, targetEnv);
      const nowIso = new Date().toISOString();

      const idMovOrigen = this._nuevoId('MOV-CORR-ORIG');
      const idMovDestino = this._nuevoId('MOV-CORR-DEST');
      const idCapaNueva = this._nuevoId('CAPA-CORR');

      const movOrigen = {
        id_movimiento: idMovOrigen,
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
        estado: 'CONFIRMADO',
        fecha_negocio: layer.fecha_capa,
        entidad_nombre: layer.proveedor || '',
        secuencia: '',
        origen_dato: 'MANUAL',
        kg_informativo: '',
        id_movimiento_ref: layer.id_movimiento_entrada || '',
        id_capa_objetivo: layer.id_capa,
        id_capa_creada: ''
      };

      const resOrig = this.libro.aplicarMovimiento(estado, movOrigen);
      if (!resOrig.ok) {
        throw new Error(`Error al consumir capa de origen en corrección parcial: ${resOrig.error}`);
      }
      estado = resOrig.estado;

      const movDestino = {
        id_movimiento: idMovDestino,
        fecha_hora: nowIso,
        tipo_movimiento: 'AJUSTE',
        id_documento_ref: layer.documento_ref || '',
        documento_ref: layer.documento_ref || '',
        codigo_articulo: targetArt,
        codigo_envase: targetEnv,
        cajas: cajasRestantes,
        signo: 1,
        partida_origen: layer.partida || '',
        motivo_ajuste: params.motivo || 'CORRECCION_ENTRADA_DESTINO',
        usuario,
        observaciones: `Recepción por corrección de entrada desde ${artOrigen}|${envOrigen}`,
        estado: 'CONFIRMADO',
        fecha_negocio: layer.fecha_capa,
        entidad_nombre: layer.proveedor || '',
        secuencia: '',
        origen_dato: 'MANUAL',
        kg_informativo: '',
        id_movimiento_ref: idMovOrigen,
        id_capa_objetivo: '',
        id_capa_creada: idCapaNueva,
        id_capa_origen: layer.id_capa
      };

      const resDest = this.libro.aplicarMovimiento(estado, movDestino);
      if (!resDest.ok) {
        throw new Error(`Error al crear capa de destino en corrección parcial: ${resDest.error}`);
      }
      estado = resDest.estado;

      this._persistir({
        movimientos: [movOrigen, movDestino],
        estado
      });

      return {
        success: true,
        status: 'CONFIRMADO',
        cajasReclasificadas: cajasRestantes,
        cajasMantenidasConsumidas: cajasConsumidas,
        origen: keyOrigen,
        destino: keyDestino,
        stockOrigen: Number(estado.stock[keyOrigen] || 0),
        stockDestino: Number(estado.stock[keyDestino] || 0)
      };
    } finally {
      this._releaseLock();
    }
  }

  /**
   * Divide una entrada histórica en múltiples combinaciones comerciales.
   * Regla 4 (T-022): combinaciones de consumo dirigido + creación de capas,
   * con la fecha y el proveedor de la capa de origen.
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
      let { estado } = this._cargarEstado();

      const layer = this._findLayer(estado.capas, params);
      if (!layer) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'CAPA_NO_ENCONTRADA',
          message: 'No se encontró la capa de entrada a dividir.'
        };
      }

      const cajasConsumidas = Number(layer.cajas_consumidas || 0);
      const cajasRestantes = Number(layer.cajas_restantes || 0);
      const totalActualCapa = cajasConsumidas + cajasRestantes;
      const sumaDivisiones = divisiones.reduce((s, d) => s + Number(d.cajas || 0), 0);

      if (sumaDivisiones !== totalActualCapa) {
        return {
          success: false,
          status: 'REVISION_NECESARIA',
          errorCode: 'SUMA_DIVISION_NO_COINCIDE',
          message: `La suma de las divisiones (${sumaDivisiones}) no coincide con el total inicial de la entrada (${totalActualCapa}). REVISIÓN NECESARIA`,
          sumaDivisiones,
          totalEntrada: totalActualCapa
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

      const cajasOrig = divOrig ? Number(divOrig.cajas) : 0;
      const cajasTransferidas = totalActualCapa - cajasOrig;

      const nowIso = new Date().toISOString();
      const generatedMovs = [];
      let idMovOrig = '';

      // 1. Consumo dirigido en la capa original por las cajas transferidas a las otras divisiones
      if (cajasTransferidas > 0) {
        idMovOrig = this._nuevoId('MOV-DIV-ORIG');
        const movOrig = {
          id_movimiento: idMovOrig,
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
          estado: 'CONFIRMADO',
          fecha_negocio: layer.fecha_capa,
          entidad_nombre: layer.proveedor || '',
          secuencia: '',
          origen_dato: 'MANUAL',
          kg_informativo: '',
          id_movimiento_ref: layer.id_movimiento_entrada || '',
          id_capa_objetivo: layer.id_capa,
          id_capa_creada: ''
        };

        const resOrig = this.libro.aplicarMovimiento(estado, movOrig);
        if (!resOrig.ok) {
          throw new Error(`Error al consumir capa original en división: ${resOrig.error}`);
        }
        estado = resOrig.estado;
        generatedMovs.push(movOrig);
      }

      // 2. Crear nuevas capas para las demás divisiones conservando fecha y proveedor de la capa de origen
      for (const d of divisiones) {
        if (d === divOrig) continue;

        const dArt = String(d.articulo || d.codigo_articulo).trim();
        const dEnv = String(d.envase || d.codigo_envase || layer.codigo_envase).trim();
        const dCajas = Number(d.cajas);
        const idMovDest = this._nuevoId('MOV-DIV-DEST');
        const idCapaNueva = this._nuevoId('CAPA-DIV');

        const movDest = {
          id_movimiento: idMovDest,
          fecha_hora: nowIso,
          tipo_movimiento: 'AJUSTE',
          id_documento_ref: layer.documento_ref || '',
          documento_ref: layer.documento_ref || '',
          codigo_articulo: dArt,
          codigo_envase: dEnv,
          cajas: dCajas,
          signo: 1,
          partida_origen: d.partida || layer.partida || '',
          motivo_ajuste: params.motivo || 'DIVISION_ENTRADA',
          usuario,
          observaciones: `Línea creada por división de entrada ${layer.documento_ref || ''}`,
          estado: 'CONFIRMADO',
          fecha_negocio: layer.fecha_capa,
          entidad_nombre: layer.proveedor || '',
          secuencia: '',
          origen_dato: 'MANUAL',
          kg_informativo: '',
          id_movimiento_ref: idMovOrig || layer.id_movimiento_entrada || '',
          id_capa_objetivo: '',
          id_capa_creada: idCapaNueva,
          id_capa_origen: layer.id_capa
        };

        const resDest = this.libro.aplicarMovimiento(estado, movDest);
        if (!resDest.ok) {
          throw new Error(`Error al crear capa de división: ${resDest.error}`);
        }
        estado = resDest.estado;
        generatedMovs.push(movDest);
      }

      this._persistir({
        movimientos: generatedMovs,
        estado
      });

      const capaOrigActualizada = estado.capas.find(c => c.id_capa === layer.id_capa);

      return {
        success: true,
        status: 'CONFIRMADO',
        divisionesRealizadas: divisiones,
        cajasMantenidasConsumidas: cajasConsumidas,
        cajasDisponiblesOrigen: capaOrigActualizada ? Number(capaOrigActualizada.cajas_restantes || 0) : 0,
        stockActualizado: estado.stock
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
