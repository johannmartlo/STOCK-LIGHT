/**
 * STOCK-LIGHT — Libro.js
 *
 * Motor puro del Libro de Movimientos de Solo Añadir (D-012, D-022, D-024, T-022).
 *
 * DOMINIO DESACOPLADO: Este módulo NO contiene dependencias de SpreadsheetApp,
 * DriveApp, LockService, Session ni UrlFetchApp.
 *
 * Una sola función pura (`aplicarMovimiento`) decide qué le hace cada movimiento al estado.
 * Tanto las operaciones en vivo como la reconstrucción (`reconstruir`) pasan por ella,
 * garantizando que la reconstrucción siempre coincida con el estado vivo por construcción.
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
    const engineMod = require('./InventoryEngine');
    global.buildStockKey = global.buildStockKey || engineMod.buildStockKey;
    global.sortFifoLayers = global.sortFifoLayers || engineMod.sortFifoLayers;
  } catch (e) {}
}

/**
 * Extrae el array de consumos FIFO embebido en el campo `observaciones` (formato `FIFO:[...]`).
 * @param {string} observaciones
 * @returns {Array<{id_capa: string, cajas: number, cajas_descontadas: number}>}
 */
function extraerConsumosFifoDeObservaciones(observaciones) {
  const obs = String(observaciones || '');
  if (!obs.includes('FIFO:')) return [];
  try {
    const idx = obs.indexOf('FIFO:');
    const after = obs.slice(idx + 5).trim();
    // Buscar cierre de array JSON si hubiera texto posterior
    const endBracket = after.lastIndexOf(']');
    const jsonPart = endBracket >= 0 ? after.slice(0, endBracket + 1) : after;
    const parsed = JSON.parse(jsonPart);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => {
      const cajas = Number(item.cajas !== undefined ? item.cajas : item.cajas_descontadas);
      return {
        ...item,
        id_capa: String(item.id_capa || '').trim(),
        cajas: isNaN(cajas) ? 0 : cajas,
        cajas_descontadas: isNaN(cajas) ? 0 : cajas
      };
    }).filter(item => item.id_capa && item.cajas > 0);
  } catch (e) {
    return [];
  }
}

/**
 * Anexa la representación `FIFO:[...]` al campo `observaciones` de un movimiento.
 * @param {string} observaciones
 * @param {Array<Object>} consumos
 * @returns {string}
 */
function anexarConsumosFifoAObservaciones(observaciones, consumos) {
  const obs = String(observaciones || '').trim();
  if (!Array.isArray(consumos) || consumos.length === 0) return obs;
  if (obs.includes('FIFO:')) return obs;
  const serialized = JSON.stringify(consumos.map(c => ({
    id_capa: c.id_capa,
    fecha_capa: c.fecha_capa || '',
    cajas_descontadas: Number(c.cajas !== undefined ? c.cajas : c.cajas_descontadas),
    cajas_restantes_capa: c.cajas_restantes_capa !== undefined ? Number(c.cajas_restantes_capa) : undefined,
    estado_capa: c.estado_capa || undefined
  })));
  return obs ? `${obs} | FIFO:${serialized}` : `FIFO:${serialized}`;
}

/**
 * Clona profundamente el estado `{ capas, stock, consumosPorMovimiento }` sin mutar la entrada.
 * @param {Object} estado
 * @returns {{capas: Array<Object>, stock: Object, consumosPorMovimiento: Object}}
 */
function clonarEstadoLibro(estado = {}) {
  const capas = Array.isArray(estado.capas) ? estado.capas.map(c => ({ ...c })) : [];
  const stock = estado.stock && typeof estado.stock === 'object' ? { ...estado.stock } : {};
  const consumosPorMovimiento = {};
  if (estado.consumosPorMovimiento && typeof estado.consumosPorMovimiento === 'object') {
    for (const movId of Object.keys(estado.consumosPorMovimiento)) {
      const list = estado.consumosPorMovimiento[movId];
      if (Array.isArray(list)) {
        consumosPorMovimiento[movId] = list.map(item => ({
          id_capa: item.id_capa,
          cajas: Number(item.cajas !== undefined ? item.cajas : item.cajas_descontadas),
          codigo_articulo: item.codigo_articulo || '',
          codigo_envase: item.codigo_envase || '',
          fecha_negocio: item.fecha_negocio || ''
        }));
      }
    }
  }
  return { capas, stock, consumosPorMovimiento };
}

/**
 * Resuelve la clave de stock canónica `codigo_articulo|codigo_envase`.
 * @param {string} codigoArticulo
 * @param {string} codigoEnvase
 * @returns {string}
 */
function _keyLibro(codigoArticulo, codigoEnvase) {
  if (typeof buildStockKey === 'function') {
    return buildStockKey(codigoArticulo, codigoEnvase);
  }
  if (typeof global !== 'undefined' && typeof global.buildStockKey === 'function') {
    return global.buildStockKey(codigoArticulo, codigoEnvase);
  }
  const art = String(codigoArticulo || '').trim();
  const env = String(codigoEnvase || '').trim();
  if (!art || !env) {
    throw new Error(`Clave de stock inválida: codigoArticulo='${codigoArticulo}', codigoEnvase='${codigoEnvase}'`);
  }
  return `${art}|${env}`;
}

/**
 * Ordena las capas FIFO según la regla canónica: `fecha_capa ASC, id_capa ASC`.
 * @param {Array<Object>} layers
 * @returns {Array<Object>}
 */
function _ordenarCapasFifo(layers) {
  if (typeof sortFifoLayers === 'function') {
    return sortFifoLayers(layers);
  }
  if (typeof global !== 'undefined' && typeof global.sortFifoLayers === 'function') {
    return global.sortFifoLayers(layers);
  }
  const normFn = typeof normalizarFechaNegocio === 'function'
    ? normalizarFechaNegocio
    : (typeof global !== 'undefined' && global.normalizarFechaNegocio ? global.normalizarFechaNegocio : (d => String(d || '')));
  return [...layers].sort((a, b) => {
    const fA = a.fecha_capa instanceof Date ? normFn(a.fecha_capa) : String(a.fecha_capa || '');
    const fB = b.fecha_capa instanceof Date ? normFn(b.fecha_capa) : String(b.fecha_capa || '');
    if (fA !== fB) return fA.localeCompare(fB);
    return String(a.id_capa || '').localeCompare(String(b.id_capa || ''));
  });
}

/**
 * Normaliza la fecha de negocio de un movimiento.
 * @param {Object} movimiento
 * @returns {string} YYYY-MM-DD
 */
function _resolverFechaNegocioMovimiento(movimiento) {
  const normFn = typeof normalizarFechaNegocio === 'function'
    ? normalizarFechaNegocio
    : (typeof global !== 'undefined' && global.normalizarFechaNegocio ? global.normalizarFechaNegocio : null);
  const hoyFn = typeof hoyMadrid === 'function'
    ? hoyMadrid
    : (typeof global !== 'undefined' && global.hoyMadrid ? global.hoyMadrid : (() => new Date().toISOString().slice(0, 10)));

  const raw = movimiento.fecha_negocio || movimiento.fechaNegocio || movimiento.fecha;
  if (raw) {
    if (normFn) {
      try {
        return normFn(raw);
      } catch (e) {
        return String(raw).slice(0, 10);
      }
    }
    return String(raw).slice(0, 10);
  }
  if (movimiento.fecha_hora || movimiento.fechaHora) {
    const fh = String(movimiento.fecha_hora || movimiento.fechaHora);
    if (/^\d{4}-\d{2}-\d{2}/.test(fh)) {
      return fh.slice(0, 10);
    }
  }
  return hoyFn();
}

/**
 * Genera un ID usando `nuevoId`.
 * @param {string} prefijo
 * @returns {string}
 */
function _generarIdLibro(prefijo) {
  const fn = typeof nuevoId === 'function' ? nuevoId : (typeof global !== 'undefined' ? global.nuevoId : null);
  if (typeof fn === 'function') {
    return fn(prefijo);
  }
  throw new Error('nuevoId no está disponible en Libro.js');
}

/**
 * Calcula las cajas disponibles en capas activas para una clave de stock.
 * @param {string} stockKey
 * @param {Array<Object>} capas
 * @returns {number}
 */
function _calcularDisponibleCapas(stockKey, capas) {
  let total = 0;
  for (const l of capas) {
    if (_keyLibro(l.codigo_articulo, l.codigo_envase) === stockKey && l.estado_capa === 'ACTIVA') {
      total += Number(l.cajas_restantes || 0);
    }
  }
  return total;
}

/**
 * Aplica un único movimiento sobre el estado actual de forma 100% pura (sin mutar la entrada).
 *
 * Semántica única (T-022 Regla 3 y Regla 4):
 * 1. ENTRADA, o AJUSTE + sin `id_capa_objetivo` (y sin `id_movimiento_ref` a salida):
 *    Crea la capa `id_capa_creada` con `fecha_capa = fecha_negocio` y `proveedor = entidad_nombre`.
 * 2. AJUSTE + con `id_capa_objetivo`:
 *    Devuelve cajas a esa capa (restitución o ampliación de entrada). `cajas_iniciales` no se toca.
 * 3. AJUSTE + con `id_movimiento_ref` (corrección de salida a la baja, sin `id_capa_objetivo`):
 *    Devuelve las cajas a las capas consumidas por esa salida, en orden inverso al consumo.
 * 4. SALIDA, o AJUSTE − sin `id_capa_objetivo`:
 *    Consume por FIFO y anota los consumos en `consumosPorMovimiento`. Si lleva `id_movimiento_ref`
 *    (corrección de salida al alza), acumula también los consumos en la salida referenciada.
 * 5. AJUSTE − con `id_capa_objetivo`:
 *    Consume solo de esa capa (consumo dirigido). `cajas_iniciales` no se toca.
 * 6. ANULACION con `id_movimiento_ref` = una entrada:
 *    Consume todo lo que quede en la capa creada por ella y la marca `ANULADA`. Si ya tiene consumos, error.
 * 7. ANULACION con `id_movimiento_ref` = una salida o un ajuste −:
 *    Devuelve a cada capa exactamente lo que ese movimiento consumió, según `consumosPorMovimiento` (D-012).
 *
 * @param {Object} estado - `{ capas, stock, consumosPorMovimiento }`
 * @param {Object} movimiento - Fila/objeto de movimiento de MOVIMIENTOS
 * @returns {{
 *   ok: boolean,
 *   estado: { capas: Array<Object>, stock: Object, consumosPorMovimiento: Object },
 *   consumos: Array<Object>,
 *   capaCreada: Object|null,
 *   error: string|null,
 *   errorCode: string|null,
 *   deficit?: number,
 *   stockDisponible?: number,
 *   cajasSolicitadas?: number,
 *   cajasConsumidas?: number,
 *   cajasRestantes?: number
 * }}
 */
function aplicarMovimiento(estado, movimiento) {
  if (!movimiento || typeof movimiento !== 'object') {
    return {
      ok: false,
      estado,
      consumos: [],
      capaCreada: null,
      error: 'El movimiento no puede ser nulo.',
      errorCode: 'VALIDATION_ERROR'
    };
  }

  const next = clonarEstadoLibro(estado);
  const tipo = String(movimiento.tipo_movimiento || movimiento.tipo || '').trim().toUpperCase();
  const codigoArticulo = String(movimiento.codigo_articulo || movimiento.codigoArticulo || '').trim();
  const codigoEnvase = String(movimiento.codigo_envase || movimiento.codigoEnvase || '').trim();

  if (!codigoArticulo || !codigoEnvase) {
    return {
      ok: false,
      estado,
      consumos: [],
      capaCreada: null,
      error: 'codigo_articulo y codigo_envase son obligatorios.',
      errorCode: 'VALIDATION_ERROR'
    };
  }

  const stockKey = _keyLibro(codigoArticulo, codigoEnvase);
  if (next.stock[stockKey] === undefined) {
    next.stock[stockKey] = _calcularDisponibleCapas(stockKey, next.capas);
  }

  const idMovimiento = String(movimiento.id_movimiento || movimiento.idMovimiento || '').trim() || _generarIdLibro('MOV');
  const idMovRef = String(movimiento.id_movimiento_ref || movimiento.idMovimientoRef || '').trim();
  const idCapaObjetivo = String(movimiento.id_capa_objetivo || movimiento.idCapaObjetivo || '').trim();
  const idCapaCreada = String(movimiento.id_capa_creada || movimiento.idCapaCreada || movimiento.idCapa || '').trim();
  const cajas = Math.abs(Number(movimiento.cajas || 0));
  const signo = Number(movimiento.signo !== undefined && movimiento.signo !== '' ? movimiento.signo : (tipo === 'ENTRADA' ? 1 : -1));
  const fechaNegocio = _resolverFechaNegocioMovimiento(movimiento);
  const entidadNombre = String(movimiento.entidad_nombre !== undefined ? movimiento.entidad_nombre : (movimiento.entidad || '')).trim();
  const origenDato = String(movimiento.origen_dato || movimiento.origenDato || 'MANUAL').trim() || 'MANUAL';

  // =========================================================================
  // CASO 1: ENTRADA, o AJUSTE + sin id_capa_objetivo (y no restitución de salida)
  // =========================================================================
  const esRestitucionSalida = tipo === 'AJUSTE' && signo === 1 && !idCapaObjetivo && !idCapaCreada && Boolean(idMovRef);

  if (tipo === 'ENTRADA' || (tipo === 'AJUSTE' && signo === 1 && !idCapaObjetivo && !esRestitucionSalida)) {
    if (!Number.isInteger(cajas) || cajas <= 0) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `Cantidad de cajas inválida (${movimiento.cajas}). Debe ser entero > 0.`,
        errorCode: 'VALIDATION_ERROR'
      };
    }

    const finalIdCapa = idCapaCreada || _generarIdLibro('CAPA');
    const partidaVal = movimiento.partida_origen !== undefined && movimiento.partida_origen !== null && String(movimiento.partida_origen).trim() !== ''
      ? String(movimiento.partida_origen).trim()
      : (movimiento.partida ? String(movimiento.partida).trim() : (tipo === 'AJUSTE' ? 'AJUSTE' : ''));
    const docRefVal = String(
      movimiento.documento_ref ||
      movimiento.documentoRef ||
      movimiento.id_documento_ref ||
      movimiento.idDocumentoRef ||
      (tipo === 'AJUSTE' ? `AJUSTE:${movimiento.motivo_ajuste || movimiento.motivo || ''}` : '')
    ).trim();

    const nuevaCapa = {
      id_capa: finalIdCapa,
      id_movimiento_entrada: idMovimiento,
      fecha_capa: fechaNegocio,
      codigo_articulo: codigoArticulo,
      codigo_envase: codigoEnvase,
      cajas_iniciales: cajas,
      cajas_consumidas: 0,
      cajas_restantes: cajas,
      estado_capa: 'ACTIVA',
      partida: partidaVal,
      documento_ref: docRefVal,
      proveedor: entidadNombre,
      id_capa_origen: String(movimiento.id_capa_origen || movimiento.idCapaOrigen || '').trim(),
      origen_dato: origenDato
    };

    next.capas.push(nuevaCapa);
    next.stock[stockKey] = Number(next.stock[stockKey] || 0) + cajas;

    return {
      ok: true,
      estado: next,
      consumos: [],
      capaCreada: nuevaCapa,
      error: null,
      errorCode: null
    };
  }

  // =========================================================================
  // CASO 2: AJUSTE + con id_capa_objetivo (Restitución / ampliación sobre capa)
  // =========================================================================
  if (tipo === 'AJUSTE' && signo === 1 && idCapaObjetivo) {
    if (!Number.isInteger(cajas) || cajas <= 0) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `Cantidad de cajas inválida (${movimiento.cajas}).`,
        errorCode: 'VALIDATION_ERROR'
      };
    }

    const layer = next.capas.find(l => l.id_capa === idCapaObjetivo);
    if (!layer) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `No se encontró la capa objetivo '${idCapaObjetivo}'.`,
        errorCode: 'CAPA_NO_ENCONTRADA'
      };
    }

    // Regla 4: cajas_iniciales de la capa NO se toca: la capa muestra su historial.
    layer.cajas_restantes = Number(layer.cajas_restantes || 0) + cajas;
    if (idMovRef) {
      // Si restituye consumo de un movimiento previo, reduce cajas_consumidas
      layer.cajas_consumidas = Math.max(0, Number(layer.cajas_consumidas || 0) - cajas);
      if (Array.isArray(next.consumosPorMovimiento[idMovRef])) {
        const list = next.consumosPorMovimiento[idMovRef];
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].id_capa === idCapaObjetivo) {
            list[i].cajas = Math.max(0, Number(list[i].cajas || 0) - cajas);
            break;
          }
        }
        next.consumosPorMovimiento[idMovRef] = list.filter(c => c.cajas > 0);
      }
    }
    layer.estado_capa = layer.cajas_restantes > 0 ? 'ACTIVA' : 'AGOTADA';

    const layerKey = _keyLibro(layer.codigo_articulo, layer.codigo_envase);
    next.stock[layerKey] = Number(next.stock[layerKey] || 0) + cajas;

    return {
      ok: true,
      estado: next,
      consumos: [{ id_capa: layer.id_capa, cajas: -cajas, cajas_restantes_capa: layer.cajas_restantes, estado_capa: layer.estado_capa }],
      capaCreada: null,
      error: null,
      errorCode: null
    };
  }

  // =========================================================================
  // CASO 3: AJUSTE + con id_movimiento_ref (Corrección de salida a la baja)
  // Devuelve las cajas a las capas de esa salida, en orden inverso al consumo.
  // =========================================================================
  if (esRestitucionSalida) {
    if (!Number.isInteger(cajas) || cajas <= 0) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `Cantidad de cajas inválida (${movimiento.cajas}).`,
        errorCode: 'VALIDATION_ERROR'
      };
    }

    let consumosRef = Array.isArray(next.consumosPorMovimiento[idMovRef])
      ? next.consumosPorMovimiento[idMovRef]
      : [];

    if ((!consumosRef || consumosRef.length === 0) && movimiento.observaciones) {
      consumosRef = extraerConsumosFifoDeObservaciones(movimiento.observaciones);
    }

    if (!consumosRef || consumosRef.length === 0) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `No se conocen los consumos FIFO del movimiento referenciado '${idMovRef}'.`,
        errorCode: 'CONSUMOS_DESCONOCIDOS'
      };
    }

    let porRestaurar = cajas;
    const restituciones = [];

    for (let i = consumosRef.length - 1; i >= 0 && porRestaurar > 0; i--) {
      const c = consumosRef[i];
      const dispConsumo = Number(c.cajas || 0);
      if (dispConsumo <= 0) continue;

      const layer = next.capas.find(l => l.id_capa === c.id_capa);
      if (layer) {
        const aRestaurar = Math.min(porRestaurar, dispConsumo);
        layer.cajas_consumidas = Math.max(0, Number(layer.cajas_consumidas || 0) - aRestaurar);
        layer.cajas_restantes = Number(layer.cajas_restantes || 0) + aRestaurar;
        layer.estado_capa = 'ACTIVA';
        c.cajas = dispConsumo - aRestaurar;
        porRestaurar -= aRestaurar;
        restituciones.push({
          id_capa: layer.id_capa,
          cajas: aRestaurar,
          cajas_restantes_capa: layer.cajas_restantes,
          estado_capa: layer.estado_capa
        });
      }
    }
    next.consumosPorMovimiento[idMovRef] = consumosRef.filter(c => Number(c.cajas || 0) > 0);

    if (porRestaurar > 0) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `Consumos FIFO insuficientes en el movimiento referenciado '${idMovRef}' para restaurar ${cajas} cajas.`,
        errorCode: 'CONSUMOS_DESCONOCIDOS'
      };
    }

    next.stock[stockKey] = Number(next.stock[stockKey] || 0) + cajas;

    return {
      ok: true,
      estado: next,
      consumos: restituciones,
      capaCreada: null,
      error: null,
      errorCode: null
    };
  }

  // =========================================================================
  // CASO 4: SALIDA, o AJUSTE − sin id_capa_objetivo (Consumo por FIFO)
  // =========================================================================
  if ((tipo === 'SALIDA' || (tipo === 'AJUSTE' && signo === -1)) && !idCapaObjetivo) {
    if (!Number.isInteger(cajas) || cajas <= 0) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `Cantidad de cajas inválida (${movimiento.cajas}).`,
        errorCode: 'VALIDATION_ERROR'
      };
    }

    const stockDisponible = Number(next.stock[stockKey] || 0);
    if (stockDisponible < cajas) {
      const deficit = cajas - stockDisponible;
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `Stock insuficiente para ${stockKey}. Disponible: ${stockDisponible}, Solicitado: ${cajas}, Déficit: ${deficit}`,
        errorCode: 'STOCK_INSUFICIENTE',
        stockDisponible,
        cajasSolicitadas: cajas,
        deficit
      };
    }

    const activeLayers = _ordenarCapasFifo(
      next.capas.filter(l => _keyLibro(l.codigo_articulo, l.codigo_envase) === stockKey && l.estado_capa === 'ACTIVA' && Number(l.cajas_restantes || 0) > 0)
    );

    let porConsumir = cajas;
    const consumos = [];

    for (const layer of activeLayers) {
      if (porConsumir <= 0) break;
      const disp = Number(layer.cajas_restantes || 0);
      const aDescontar = Math.min(porConsumir, disp);

      layer.cajas_consumidas = Number(layer.cajas_consumidas || 0) + aDescontar;
      layer.cajas_restantes = disp - aDescontar;
      if (layer.cajas_restantes === 0) {
        layer.estado_capa = 'AGOTADA';
      }

      consumos.push({
        id_capa: layer.id_capa,
        fecha_capa: layer.fecha_capa,
        cajas: aDescontar,
        cajas_descontadas: aDescontar,
        cajas_restantes_capa: layer.cajas_restantes,
        estado_capa: layer.estado_capa
      });

      porConsumir -= aDescontar;
    }

    if (porConsumir > 0) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `Inconsistencia en capas FIFO para ${stockKey}. Faltan ${porConsumir} cajas por cubrir.`,
        errorCode: 'STOCK_INSUFICIENTE',
        stockDisponible,
        cajasSolicitadas: cajas,
        deficit: porConsumir
      };
    }

    next.stock[stockKey] = stockDisponible - cajas;
    next.consumosPorMovimiento[idMovimiento] = consumos.map(c => ({
      id_capa: c.id_capa,
      cajas: c.cajas,
      codigo_articulo: movimiento.codigo_articulo || (c.codigo_articulo || ''),
      codigo_envase: movimiento.codigo_envase || (c.codigo_envase || ''),
      fecha_negocio: fechaNegocio
    }));

    // Si es una corrección de salida al alza (AJUSTE - con id_movimiento_ref a la salida),
    // acumular también estos consumos en la salida referenciada para que futuras correcciones/anulaciones los restituyan.
    if (idMovRef) {
      if (!Array.isArray(next.consumosPorMovimiento[idMovRef])) {
        next.consumosPorMovimiento[idMovRef] = [];
      }
      for (const c of consumos) {
        const existing = next.consumosPorMovimiento[idMovRef].find(item => item.id_capa === c.id_capa);
        if (existing) {
          existing.cajas = Number(existing.cajas || 0) + c.cajas;
        } else {
          next.consumosPorMovimiento[idMovRef].push({
            id_capa: c.id_capa,
            cajas: c.cajas,
            codigo_articulo: movimiento.codigo_articulo || (c.codigo_articulo || ''),
            codigo_envase: movimiento.codigo_envase || (c.codigo_envase || ''),
            fecha_negocio: fechaNegocio
          });
        }
      }
    }

    return {
      ok: true,
      estado: next,
      consumos,
      capaCreada: null,
      error: null,
      errorCode: null
    };
  }

  // =========================================================================
  // CASO 5: AJUSTE − con id_capa_objetivo (Consumo dirigido de una capa)
  // =========================================================================
  if (tipo === 'AJUSTE' && signo === -1 && idCapaObjetivo) {
    if (!Number.isInteger(cajas) || cajas <= 0) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `Cantidad de cajas inválida (${movimiento.cajas}).`,
        errorCode: 'VALIDATION_ERROR'
      };
    }

    const layer = next.capas.find(l => l.id_capa === idCapaObjetivo);
    if (!layer) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `No se encontró la capa objetivo '${idCapaObjetivo}'.`,
        errorCode: 'CAPA_NO_ENCONTRADA'
      };
    }

    const dispCapa = Number(layer.cajas_restantes || 0);
    const consumidasPrevias = Number(layer.cajas_consumidas || 0);
    if (dispCapa < cajas) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `Solo quedan ${dispCapa} cajas disponibles de esta entrada. No se puede reducir en ${cajas} cajas sin provocar inconsistencias. REVISIÓN NECESARIA`,
        errorCode: 'CANTIDAD_INSUFICIENTE_EN_CAPA',
        cajasDisponibles: dispCapa,
        cajasConsumidas: consumidasPrevias,
        deficit: cajas - dispCapa
      };
    }

    // Regla 4: cajas_iniciales NO se toca.
    layer.cajas_consumidas = consumidasPrevias + cajas;
    layer.cajas_restantes = dispCapa - cajas;
    if (layer.cajas_restantes === 0) {
      layer.estado_capa = 'AGOTADA';
    }

    const layerKey = _keyLibro(layer.codigo_articulo, layer.codigo_envase);
    next.stock[layerKey] = Math.max(0, Number(next.stock[layerKey] || 0) - cajas);

    const consumoDirigido = [{
      id_capa: layer.id_capa,
      fecha_capa: layer.fecha_capa,
      cajas,
      cajas_descontadas: cajas,
      cajas_restantes_capa: layer.cajas_restantes,
      estado_capa: layer.estado_capa
    }];

    next.consumosPorMovimiento[idMovimiento] = [{
      id_capa: layer.id_capa,
      cajas,
      codigo_articulo: layer.codigo_articulo || '',
      codigo_envase: layer.codigo_envase || '',
      fecha_negocio: fechaNegocio
    }];

    return {
      ok: true,
      estado: next,
      consumos: consumoDirigido,
      capaCreada: null,
      error: null,
      errorCode: null
    };
  }

  // =========================================================================
  // CASO 6 y 7: ANULACION con id_movimiento_ref
  // =========================================================================
  if (tipo === 'ANULACION') {
    if (!idMovRef && !idCapaObjetivo) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `Movimiento ANULACION '${idMovimiento}' sin id_movimiento_ref identificable.`,
        errorCode: 'ANULACION_SIN_REFERENCIA'
      };
    }

    // Intentar localizar si id_movimiento_ref corresponde a una capa creada por una entrada
    const capaEntrada = next.capas.find(l =>
      (idMovRef && l.id_movimiento_entrada === idMovRef) ||
      (idCapaObjetivo && l.id_capa === idCapaObjetivo)
    );

    if (capaEntrada && signo === -1) {
      const cajasConsumidas = Number(capaEntrada.cajas_consumidas || 0);
      if (cajasConsumidas > 0) {
        return {
          ok: false,
          estado,
          consumos: [],
          capaCreada: null,
          error: `NO SE PUEDE ANULAR AUTOMÁTICAMENTE: Esta entrada tiene ${cajasConsumidas} cajas consumidas por movimientos posteriores. REVISIÓN NECESARIA`,
          errorCode: 'ENTRADA_CON_CONSUMOS',
          cajasConsumidas,
          cajasRestantes: Number(capaEntrada.cajas_restantes || 0)
        };
      }

      const cajasAnuladas = Number(capaEntrada.cajas_restantes || 0);
      capaEntrada.cajas_restantes = 0;
      capaEntrada.estado_capa = 'ANULADA';

      const k = _keyLibro(capaEntrada.codigo_articulo, capaEntrada.codigo_envase);
      next.stock[k] = Math.max(0, Number(next.stock[k] || 0) - cajasAnuladas);

      return {
        ok: true,
        estado: next,
        consumos: [{
          id_capa: capaEntrada.id_capa,
          cajas: cajasAnuladas,
          cajas_descontadas: cajasAnuladas,
          cajas_restantes_capa: 0,
          estado_capa: 'ANULADA'
        }],
        capaCreada: null,
        error: null,
        errorCode: null
      };
    }

    // Si es ANULACION de una salida o un ajuste negativo (signo +1 o referencia en consumosPorMovimiento)
    let consumosOriginales = (idMovRef && Array.isArray(next.consumosPorMovimiento[idMovRef]))
      ? next.consumosPorMovimiento[idMovRef]
      : [];

    if ((!consumosOriginales || consumosOriginales.length === 0) && movimiento.observaciones) {
      consumosOriginales = extraerConsumosFifoDeObservaciones(movimiento.observaciones);
    }

    if (!consumosOriginales || consumosOriginales.length === 0) {
      return {
        ok: false,
        estado,
        consumos: [],
        capaCreada: null,
        error: `No se conocen los consumos FIFO del movimiento referenciado '${idMovRef || movimiento.id_movimiento}'.`,
        errorCode: 'CONSUMOS_DESCONOCIDOS'
      };
    }

    let totalRestituido = 0;
    const restituciones = [];

    for (const c of consumosOriginales) {
      const cant = Number(c.cajas !== undefined ? c.cajas : c.cajas_descontadas);
      if (cant <= 0) continue;
      const layer = next.capas.find(l => l.id_capa === c.id_capa);
      if (layer) {
        layer.cajas_consumidas = Math.max(0, Number(layer.cajas_consumidas || 0) - cant);
        layer.cajas_restantes = Number(layer.cajas_restantes || 0) + cant;
        layer.estado_capa = 'ACTIVA';
        totalRestituido += cant;
        restituciones.push({
          id_capa: layer.id_capa,
          cajas: cant,
          cajas_restantes_capa: layer.cajas_restantes,
          estado_capa: layer.estado_capa
        });
      }
    }
    if (idMovRef) {
      next.consumosPorMovimiento[idMovRef] = [];
    }

    next.stock[stockKey] = Number(next.stock[stockKey] || 0) + totalRestituido;

    return {
      ok: true,
      estado: next,
      consumos: restituciones,
      capaCreada: null,
      error: null,
      errorCode: null
    };
  }

  return {
    ok: false,
    estado,
    consumos: [],
    capaCreada: null,
    error: `Combinación de movimiento no soportada: tipo=${tipo}, signo=${signo}`,
    errorCode: 'UNSUPPORTED_MOVEMENT'
  };
}

/**
 * Ordena los movimientos por `secuencia` ASC (filas antiguas sin secuencia van antes,
 * ordenadas por `fecha_hora` ASC, `id_movimiento` ASC).
 * @param {Array<Object>} movimientos
 * @returns {Array<Object>}
 */
function ordenarMovimientosPorSecuencia(movimientos = []) {
  return [...movimientos].sort((a, b) => {
    const hasSecA = a.secuencia !== undefined && a.secuencia !== null && a.secuencia !== '' && !isNaN(Number(a.secuencia));
    const hasSecB = b.secuencia !== undefined && b.secuencia !== null && b.secuencia !== '' && !isNaN(Number(b.secuencia));

    if (hasSecA && hasSecB) {
      return Number(a.secuencia) - Number(b.secuencia);
    }
    if (!hasSecA && hasSecB) return -1;
    if (hasSecA && !hasSecB) return 1;

    const fA = String(a.fecha_hora || '');
    const fB = String(b.fecha_hora || '');
    if (fA !== fB) return fA.localeCompare(fB);
    return 0;
  });
}

/**
 * Reconstruye el estado completo `{ capas, stock, consumosPorMovimiento }` aplicando
 * los movimientos en orden de `secuencia` partiendo del estado vacío (T-022 Regla 1 y Regla 8).
 *
 * Tratamiento de filas antiguas (Regla 8):
 * - Un `ANULACION` antiguo con `estado === 'ANULADO'` y sin `id_movimiento_ref`:
 *   - Si su `id_documento_ref` identifica inequívocamente la entrada o la salida anulada,
 *     se aplica con esa referencia.
 *   - Si no, `reconstruir` lo informa en la lista `avisos`. No lanza error ni lo ignora en silencio.
 *
 * @param {Array<Object>} movimientos
 * @returns {{
 *   ok: boolean,
 *   estado: { capas: Array<Object>, stock: Object, consumosPorMovimiento: Object },
 *   avisos: Array<Object>,
 *   totalCajasPorCapas: number,
 *   totalCajasPorStock: number,
 *   isConsistent: boolean,
 *   totalMovimientosProcesados: number
 * }}
 */
function reconstruir(movimientos = []) {
  const ordenados = ordenarMovimientosPorSecuencia(movimientos);
  let estado = {
    capas: [],
    stock: {},
    consumosPorMovimiento: {}
  };
  const avisos = [];
  const movimientosProcesados = [];
  let countProcesados = 0;

  for (const mov of ordenados) {
    const tipo = String(mov.tipo_movimiento || '').trim().toUpperCase();
    const est = String(mov.estado || '').trim().toUpperCase();
    const idMovRef = String(mov.id_movimiento_ref || '').trim();

    // Caso de ANULACION antiguo (estado === 'ANULADO' o 'CONFIRMADO' sin id_movimiento_ref)
    if (tipo === 'ANULACION' && !idMovRef) {
      const docRef = String(mov.id_documento_ref || '').trim();
      const art = String(mov.codigo_articulo || '').trim();
      const env = String(mov.codigo_envase || '').trim();
      const signo = Number(mov.signo || -1);

      let candidato = null;
      if (docRef) {
        const candidatos = movimientosProcesados.filter(prev => {
          if (String(prev.codigo_articulo || '').trim() !== art) return false;
          if (String(prev.codigo_envase || '').trim() !== env) return false;
          const prevTipo = String(prev.tipo_movimiento || '').trim().toUpperCase();
          if (signo === -1 && prevTipo !== 'ENTRADA') return false;
          if (signo === 1 && prevTipo !== 'SALIDA' && prevTipo !== 'AJUSTE') return false;

          const prevDoc = String(prev.id_documento_ref || '').trim();
          const prevId = String(prev.id_movimiento || '').trim();
          if (prevDoc === docRef || prevId === docRef) return true;
          // También buscar por documento_ref de la capa creada
          const capaDePrev = estado.capas.find(c => c.id_movimiento_entrada === prevId);
          if (capaDePrev && String(capaDePrev.documento_ref || '').trim() === docRef) return true;
          return false;
        });

        if (candidatos.length === 1) {
          candidato = candidatos[0];
        }
      }

      if (!candidato) {
        avisos.push({
          id_movimiento: mov.id_movimiento || '',
          tipo_movimiento: 'ANULACION',
          estado: mov.estado || '',
          id_documento_ref: docRef,
          motivo: 'ANULACION antiguo sin id_movimiento_ref ni id_documento_ref identificable'
        });
        continue;
      }

      const movConRef = {
        ...mov,
        estado: 'CONFIRMADO',
        id_movimiento_ref: candidato.id_movimiento
      };

      const resLegacy = aplicarMovimiento(estado, movConRef);
      if (!resLegacy.ok) {
        avisos.push({
          id_movimiento: mov.id_movimiento || '',
          tipo_movimiento: 'ANULACION',
          estado: mov.estado || '',
          id_documento_ref: docRef,
          motivo: resLegacy.error || 'No se pudo aplicar ANULACION antiguo'
        });
        continue;
      }

      estado = resLegacy.estado;
      movimientosProcesados.push(movConRef);
      countProcesados++;
      continue;
    }

    // Ignorar movimientos no confirmados (salvo ANULACION con id_movimiento_ref que pudiera tener estado ANULADO antiguo)
    if (est !== 'CONFIRMADO' && !(tipo === 'ANULACION' && idMovRef)) {
      continue;
    }

    const res = aplicarMovimiento(estado, mov);
    if (!res.ok) {
      if (res.errorCode === 'CONSUMOS_DESCONOCIDOS') {
        avisos.push({
          id_movimiento: mov.id_movimiento || '',
          tipo_movimiento: tipo,
          id_movimiento_ref: idMovRef,
          motivo: res.error || 'Consumos desconocidos para el movimiento referenciado'
        });
        continue;
      }
      throw new Error(`Fallo en reconstrucción determinista en movimiento ${mov.id_movimiento}: ${res.error}`);
    }

    estado = res.estado;
    movimientosProcesados.push(mov);
    countProcesados++;
  }

  let totalCajasPorCapas = 0;
  for (const l of estado.capas) {
    if (l.estado_capa === 'ACTIVA') {
      totalCajasPorCapas += Number(l.cajas_restantes || 0);
    }
  }

  let totalCajasPorStock = 0;
  for (const k of Object.keys(estado.stock)) {
    totalCajasPorStock += Number(estado.stock[k] || 0);
  }

  const isConsistent = totalCajasPorCapas === totalCajasPorStock;

  return {
    ok: true,
    estado,
    avisos,
    totalCajasPorCapas,
    totalCajasPorStock,
    isConsistent,
    totalMovimientosProcesados: countProcesados
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    aplicarMovimiento,
    reconstruir,
    ordenarMovimientosPorSecuencia,
    extraerConsumosFifoDeObservaciones,
    anexarConsumosFifoAObservaciones,
    clonarEstadoLibro
  };
}
