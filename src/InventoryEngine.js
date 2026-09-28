/**
 * STOCK-LIGHT — InventoryEngine.js
 * 
 * Motor de Inventario y Núcleo FIFO Puro.
 * DOMINIO DESACOPLADO: Este módulo NO contiene dependencias de SpreadsheetApp,
 * DriveApp, LockService ni servicios externos de Google.
 * Opera exclusivamente sobre objetos y arreglos JavaScript puros en memoria.
 */

/**
 * Genera la clave canónica de existencia: CODIGO_ARTICULO_HISPATEC + "|" + CODIGO_ENVASE.
 * @param {string} codigoArticulo 
 * @param {string} codigoEnvase 
 * @returns {string}
 */
function buildStockKey(codigoArticulo, codigoEnvase) {
  const art = String(codigoArticulo || '').trim();
  const env = String(codigoEnvase || '').trim();
  if (!art || !env) {
    throw new Error(`Clave de stock inválida: codigoArticulo='${codigoArticulo}', codigoEnvase='${codigoEnvase}'`);
  }
  return `${art}|${env}`;
}

/**
 * Valida un movimiento de entrada al dominio.
 * @param {Object} input 
 */
function validateMovementInput(input) {
  if (!input) throw new Error('MovementInput no puede ser nulo');
  if (!input.tipo || !['ENTRADA', 'SALIDA', 'AJUSTE'].includes(input.tipo)) {
    throw new Error(`Tipo de movimiento inválido: '${input.tipo}'. Tipos válidos: ENTRADA, SALIDA, AJUSTE`);
  }
  if (!input.codigoArticulo) throw new Error('codigoArticulo es obligatorio');
  if (!input.codigoEnvase) throw new Error('codigoEnvase es obligatorio');
  
  const cajas = Number(input.cajas);
  if (!Number.isInteger(cajas) || cajas <= 0) {
    throw new Error(`Cantidad de cajas debe ser un entero positivo mayor a 0. Valor recibido: ${input.cajas}`);
  }

  if (input.tipo === 'AJUSTE') {
    if (!input.signo || ![1, -1].includes(Number(input.signo))) {
      throw new Error(`Signo de ajuste debe ser 1 o -1. Valor recibido: ${input.signo}`);
    }
    if (!input.motivo || String(input.motivo).trim() === '') {
      throw new Error('Motivo es obligatorio en movimientos de tipo AJUSTE');
    }
    if (!input.usuario || String(input.usuario).trim() === '') {
      throw new Error('Usuario es obligatorio en movimientos de tipo AJUSTE');
    }
  }
}

/**
 * Ordena las capas FIFO según la regla canónica:
 * 1. fecha_capa ASC (YYYY-MM-DD o ISO)
 * 2. id_capa ASC (determinista y estable)
 * @param {Array<Object>} layers 
 * @returns {Array<Object>} Nueva copia ordenada
 */
function sortFifoLayers(layers) {
  return [...layers].sort((a, b) => {
    const fechaA = String(a.fecha_capa || '');
    const fechaB = String(b.fecha_capa || '');
    if (fechaA !== fechaB) {
      return fechaA.localeCompare(fechaB);
    }
    return String(a.id_capa || '').localeCompare(String(b.id_capa || ''));
  });
}

/**
 * Calcula el stock disponible actual para un par artículo + envase sumando
 * las cajas_restantes de las capas activas.
 * @param {string} stockKey 
 * @param {Array<Object>} layers 
 * @returns {number}
 */
function calculateAvailableStock(stockKey, layers) {
  let total = 0;
  for (const layer of layers) {
    const key = buildStockKey(layer.codigo_articulo, layer.codigo_envase);
    if (key === stockKey && layer.estado_capa === 'ACTIVA') {
      total += Number(layer.cajas_restantes || 0);
    }
  }
  return total;
}

/**
 * Procesa un movimiento individual contra el estado actual de capas vivas y stock.
 * NO MUTAR el estado original directamente; genera y retorna las transformaciones.
 * 
 * @param {Object} movementInput 
 * @param {Array<Object>} currentLayers - Copia del conjunto de capas FIFO
 * @param {Object} currentStock - Mapa clave -> cajas_actuales
 * @returns {Object} Resultado con:
 *   - success: boolean
 *   - status: 'CONFIRMADO' | 'PENDIENTE_REVISION'
 *   - errorCode: null | 'STOCK_INSUFICIENTE' | 'VALIDATION_ERROR'
 *   - updatedLayers: Array<Object>
 *   - updatedStock: Object
 *   - generatedMovement: Object
 *   - fifoConsumptions: Array<Object> (desglose de capas consumidas)
 *   - newLayer: Object|null (capa creada si fue entrada o ajuste positivo)
 */
function processMovement(movementInput, currentLayers = [], currentStock = {}) {
  validateMovementInput(movementInput);

  const stockKey = buildStockKey(movementInput.codigoArticulo, movementInput.codigoEnvase);
  const cajasSolicitadas = Number(movementInput.cajas);
  const layersCopy = currentLayers.map(l => ({ ...l }));
  const stockCopy = { ...currentStock };
  
  if (stockCopy[stockKey] === undefined) {
    stockCopy[stockKey] = calculateAvailableStock(stockKey, layersCopy);
  }

  const stockDisponible = stockCopy[stockKey];

  // 1. GESTIÓN DE ENTRADA
  if (movementInput.tipo === 'ENTRADA') {
    const idCapa = movementInput.idCapa || `CAPA-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const idMovimiento = movementInput.idMovimiento || `MOV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const fechaCapa = movementInput.fecha || new Date().toISOString().slice(0, 10);

    const newLayer = {
      id_capa: idCapa,
      id_movimiento_entrada: idMovimiento,
      fecha_capa: fechaCapa,
      codigo_articulo: String(movementInput.codigoArticulo).trim(),
      codigo_envase: String(movementInput.codigoEnvase).trim(),
      cajas_iniciales: cajasSolicitadas,
      cajas_consumidas: 0,
      cajas_restantes: cajasSolicitadas,
      estado_capa: 'ACTIVA',
      partida: movementInput.partida ? String(movementInput.partida).trim() : '',
      documento_ref: movementInput.documentoRef ? String(movementInput.documentoRef).trim() : ''
    };

    layersCopy.push(newLayer);
    stockCopy[stockKey] = stockDisponible + cajasSolicitadas;

    const generatedMovement = {
      id_movimiento: idMovimiento,
      fecha_hora: movementInput.fechaHora || new Date().toISOString(),
      tipo_movimiento: 'ENTRADA',
      id_documento_ref: movementInput.idDocumentoRef || movementInput.documentoRef || '',
      codigo_articulo: String(movementInput.codigoArticulo).trim(),
      codigo_envase: String(movementInput.codigoEnvase).trim(),
      cajas: cajasSolicitadas,
      signo: 1,
      partida_origen: movementInput.partida || '',
      motivo_ajuste: '',
      usuario: movementInput.usuario || 'SISTEMA',
      observaciones: movementInput.observaciones || '',
      estado: 'CONFIRMADO'
    };

    return {
      success: true,
      status: 'CONFIRMADO',
      errorCode: null,
      stockKey,
      cajasAfectadas: cajasSolicitadas,
      stockAnterior: stockDisponible,
      stockNuevo: stockCopy[stockKey],
      updatedLayers: layersCopy,
      updatedStock: stockCopy,
      generatedMovement,
      newLayer,
      fifoConsumptions: []
    };
  }

  // 2. GESTIÓN DE SALIDA O AJUSTE NEGATIVO (Consumo FIFO)
  const esDeduccion = movementInput.tipo === 'SALIDA' || (movementInput.tipo === 'AJUSTE' && Number(movementInput.signo) === -1);

  if (esDeduccion) {
    if (stockDisponible < cajasSolicitadas) {
      // PROHIBICIÓN DE SALDO NEGATIVO SILENCIOSO
      const deficit = cajasSolicitadas - stockDisponible;
      return {
        success: false,
        status: 'PENDIENTE_REVISION',
        errorCode: 'STOCK_INSUFICIENTE',
        stockKey,
        stockDisponible,
        cajasSolicitadas,
        deficit,
        message: `Stock insuficiente para ${stockKey}. Disponible: ${stockDisponible}, Solicitado: ${cajasSolicitadas}, Déficit: ${deficit}`,
        updatedLayers: currentLayers,
        updatedStock: currentStock,
        generatedMovement: null,
        newLayer: null,
        fifoConsumptions: []
      };
    }

    // Filtrar y ordenar capas activas de este artículo y envase
    const activeLayersForStock = sortFifoLayers(
      layersCopy.filter(l => buildStockKey(l.codigo_articulo, l.codigo_envase) === stockKey && l.estado_capa === 'ACTIVA')
    );

    let porConsumir = cajasSolicitadas;
    const consumptions = [];

    for (const layer of activeLayersForStock) {
      if (porConsumir <= 0) break;

      const disponibleEnCapa = Number(layer.cajas_restantes);
      const aDescontar = Math.min(porConsumir, disponibleEnCapa);

      layer.cajas_consumidas = Number(layer.cajas_consumidas) + aDescontar;
      layer.cajas_restantes = disponibleEnCapa - aDescontar;

      if (layer.cajas_restantes === 0) {
        layer.estado_capa = 'AGOTADA';
      }

      consumptions.push({
        id_capa: layer.id_capa,
        fecha_capa: layer.fecha_capa,
        cajas_descontadas: aDescontar,
        cajas_restantes_capa: layer.cajas_restantes,
        estado_capa: layer.estado_capa
      });

      porConsumir -= aDescontar;
    }

    if (porConsumir > 0) {
      // Salvaguarda adicional en caso de inconsistencia interna
      return {
        success: false,
        status: 'PENDIENTE_REVISION',
        errorCode: 'STOCK_INSUFICIENTE',
        stockKey,
        stockDisponible,
        cajasSolicitadas,
        deficit: porConsumir,
        message: `Inconsistencia en capas FIFO para ${stockKey}. Faltan ${porConsumir} cajas por cubrir.`,
        updatedLayers: currentLayers,
        updatedStock: currentStock,
        generatedMovement: null,
        newLayer: null,
        fifoConsumptions: []
      };
    }

    const nuevoStock = stockDisponible - cajasSolicitadas;
    stockCopy[stockKey] = nuevoStock;

    const idMovimiento = movementInput.idMovimiento || `MOV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const generatedMovement = {
      id_movimiento: idMovimiento,
      fecha_hora: movementInput.fechaHora || new Date().toISOString(),
      tipo_movimiento: movementInput.tipo,
      id_documento_ref: movementInput.idDocumentoRef || movementInput.documentoRef || '',
      codigo_articulo: String(movementInput.codigoArticulo).trim(),
      codigo_envase: String(movementInput.codigoEnvase).trim(),
      cajas: cajasSolicitadas,
      signo: -1,
      partida_origen: movementInput.partida || '',
      motivo_ajuste: movementInput.tipo === 'AJUSTE' ? String(movementInput.motivo).trim() : '',
      usuario: movementInput.usuario || 'SISTEMA',
      observaciones: movementInput.observaciones || '',
      estado: 'CONFIRMADO'
    };

    return {
      success: true,
      status: 'CONFIRMADO',
      errorCode: null,
      stockKey,
      cajasAfectadas: cajasSolicitadas,
      stockAnterior: stockDisponible,
      stockNuevo: nuevoStock,
      updatedLayers: layersCopy,
      updatedStock: stockCopy,
      generatedMovement,
      newLayer: null,
      fifoConsumptions: consumptions
    };
  }

  // 3. GESTIÓN DE AJUSTE POSITIVO (Creación de Capa de Corrección / Stock Inicial)
  if (movementInput.tipo === 'AJUSTE' && Number(movementInput.signo) === 1) {
    const idCapa = movementInput.idCapa || `CAPA-AJUSTE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const idMovimiento = movementInput.idMovimiento || `MOV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const fechaCapa = movementInput.fecha || new Date().toISOString().slice(0, 10);

    const newLayer = {
      id_capa: idCapa,
      id_movimiento_entrada: idMovimiento,
      fecha_capa: fechaCapa,
      codigo_articulo: String(movementInput.codigoArticulo).trim(),
      codigo_envase: String(movementInput.codigoEnvase).trim(),
      cajas_iniciales: cajasSolicitadas,
      cajas_consumidas: 0,
      cajas_restantes: cajasSolicitadas,
      estado_capa: 'ACTIVA',
      partida: movementInput.partida ? String(movementInput.partida).trim() : 'AJUSTE',
      documento_ref: movementInput.documentoRef ? String(movementInput.documentoRef).trim() : `AJUSTE:${movementInput.motivo}`
    };

    layersCopy.push(newLayer);
    stockCopy[stockKey] = stockDisponible + cajasSolicitadas;

    const generatedMovement = {
      id_movimiento: idMovimiento,
      fecha_hora: movementInput.fechaHora || new Date().toISOString(),
      tipo_movimiento: 'AJUSTE',
      id_documento_ref: movementInput.idDocumentoRef || movementInput.documentoRef || '',
      codigo_articulo: String(movementInput.codigoArticulo).trim(),
      codigo_envase: String(movementInput.codigoEnvase).trim(),
      cajas: cajasSolicitadas,
      signo: 1,
      partida_origen: movementInput.partida || '',
      motivo_ajuste: String(movementInput.motivo).trim(),
      usuario: movementInput.usuario || 'SISTEMA',
      observaciones: movementInput.observaciones || '',
      estado: 'CONFIRMADO'
    };

    return {
      success: true,
      status: 'CONFIRMADO',
      errorCode: null,
      stockKey,
      cajasAfectadas: cajasSolicitadas,
      stockAnterior: stockDisponible,
      stockNuevo: stockCopy[stockKey],
      updatedLayers: layersCopy,
      updatedStock: stockCopy,
      generatedMovement,
      newLayer,
      fifoConsumptions: []
    };
  }

  throw new Error(`Combinación de tipo/signo no soportada: tipo=${movementInput.tipo}, signo=${movementInput.signo}`);
}

/**
 * Reconstruye determinísticamente el stock y las capas a partir de la lista cronológica de movimientos.
 * NO modifica el historial de movimientos.
 * 
 * @param {Array<Object>} movements - Lista completa de movimientos confirmados
 * @param {Array<Object>} maestro - Catálogo de artículos y envases (opcional, para enriquecer nombres)
 * @returns {Object} Resultado de la reconstrucción con:
 *   - stockMap: Map de stockKey -> saldo
 *   - reconstructedLayers: Array de capas resultantes
 *   - totalCajasPorMovimientos: número total
 *   - totalCajasPorCapas: número total
 *   - isConsistent: boolean (conciliación perfecta)
 */
function rebuildStockFromMovements(movements = [], maestro = []) {
  // Ordenar movimientos por fecha_hora ASC, id_movimiento ASC
  const sortedMovements = [...movements].sort((a, b) => {
    const fA = String(a.fecha_hora || '');
    const fB = String(b.fecha_hora || '');
    if (fA !== fB) return fA.localeCompare(fB);
    return String(a.id_movimiento || '').localeCompare(String(b.id_movimiento || ''));
  });

  let currentLayers = [];
  let currentStock = {};

  for (const mov of sortedMovements) {
    if (mov.estado !== 'CONFIRMADO') {
      continue; // Ignorar movimientos no confirmados o pendientes
    }

    const input = {
      tipo: mov.tipo_movimiento,
      codigoArticulo: mov.codigo_articulo,
      codigoEnvase: mov.codigo_envase,
      cajas: Math.abs(Number(mov.cajas)),
      signo: Number(mov.signo) || (mov.tipo_movimiento === 'ENTRADA' ? 1 : -1),
      fecha: String(mov.fecha_hora || '').slice(0, 10),
      fechaHora: mov.fecha_hora,
      idMovimiento: mov.id_movimiento,
      idDocumentoRef: mov.id_documento_ref,
      partida: mov.partida_origen,
      motivo: mov.motivo_ajuste,
      usuario: mov.usuario || 'SISTEMA',
      observaciones: mov.observaciones
    };

    const result = processMovement(input, currentLayers, currentStock);
    if (!result.success) {
      throw new Error(`Fallo en reconstrucción determinista en movimiento ${mov.id_movimiento}: ${result.message}`);
    }

    currentLayers = result.updatedLayers;
    currentStock = result.updatedStock;
  }

  // Conciliación de integridad: Σ(cajas_restantes de capas activas) == Σ(stockMap)
  let totalCajasCapas = 0;
  for (const layer of currentLayers) {
    if (layer.estado_capa === 'ACTIVA') {
      totalCajasCapas += Number(layer.cajas_restantes);
    }
  }

  let totalCajasStock = 0;
  for (const key in currentStock) {
    totalCajasStock += Number(currentStock[key]);
  }

  const isConsistent = totalCajasCapas === totalCajasStock;

  return {
    stockMap: currentStock,
    reconstructedLayers: currentLayers,
    totalCajasPorCapas: totalCajasCapas,
    totalCajasPorStock: totalCajasStock,
    isConsistent,
    totalMovimientosProcesados: sortedMovements.length
  };
}

// Exportación compatible para Node.js y Google Apps Script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildStockKey,
    validateMovementInput,
    sortFifoLayers,
    calculateAvailableStock,
    processMovement,
    rebuildStockFromMovements
  };
}
