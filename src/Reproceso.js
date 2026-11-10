/**
 * STOCK-LIGHT — Reproceso.js
 *
 * Módulo puro para planificación y validación de reprocesos (T-009, D-011, D-030, D-036).
 * Lógica pura sin llamadas a Google Sheets ni servicios externos.
 */

if (typeof module !== 'undefined' && module.exports) {
  try {
    const normMod = require('./Normalizacion');
    global.normalizarNombre = global.normalizarNombre || normMod.normalizarNombre;
  } catch (e) {}
  try {
    const fechasMod = require('./Fechas');
    global.hoyMadrid = global.hoyMadrid || fechasMod.hoyMadrid;
    global.normalizarFechaNegocio = global.normalizarFechaNegocio || fechasMod.normalizarFechaNegocio;
  } catch (e) {}
  try {
    const idsMod = require('./Ids');
    global.nuevoId = global.nuevoId || idsMod.nuevoId;
  } catch (e) {}
}

function _normNombre_(texto) {
  const fn = typeof normalizarNombre === 'function'
    ? normalizarNombre
    : (typeof global !== 'undefined' && typeof global.normalizarNombre === 'function' ? global.normalizarNombre : null);
  if (typeof fn === 'function') {
    return fn(texto);
  }
  return String(texto === null || texto === undefined ? '' : texto).trim().replace(/\s+/g, ' ').toUpperCase();
}

function _hoyMadrid_() {
  const fn = typeof hoyMadrid === 'function'
    ? hoyMadrid
    : (typeof global !== 'undefined' && typeof global.hoyMadrid === 'function' ? global.hoyMadrid : null);
  if (typeof fn === 'function') {
    return fn();
  }
  return new Date().toISOString().slice(0, 10);
}

function _normFecha_(fecha) {
  if (!fecha) return _hoyMadrid_();
  const fn = typeof normalizarFechaNegocio === 'function'
    ? normalizarFechaNegocio
    : (typeof global !== 'undefined' && typeof global.normalizarFechaNegocio === 'function' ? global.normalizarFechaNegocio : null);
  if (typeof fn === 'function') {
    return fn(fecha);
  }
  return String(fecha).slice(0, 10);
}

function _nuevoIdReproceso_(prefijo) {
  const fn = typeof nuevoId === 'function'
    ? nuevoId
    : (typeof global !== 'undefined' && typeof global.nuevoId === 'function' ? global.nuevoId : null);
  if (typeof fn === 'function') {
    return fn(prefijo);
  }
  if (typeof require !== 'undefined') {
    const crypto = require('crypto');
    return `${prefijo}-${crypto.randomUUID()}`;
  }
  return `${prefijo}-${Date.now()}`;
}

/**
 * Prorratea el destrío en cajas entre las capas de origen en proporción a las cajas retiradas.
 * Enteros, y el resto a la capa con más cajas retiradas. La suma es exactamente destrio_cajas (D-030).
 *
 * @param {Array<{ layer: Object, cajas: number }>} origenes
 * @param {number} destrioCajas
 * @param {number} totalRetirado
 * @returns {Array<number>} Prorrateo por cada origen en el mismo orden
 */
function prorratearDestrio_(origenes, destrioCajas, totalRetirado) {
  const n = origenes.length;
  const resultado = new Array(n).fill(0);
  if (destrioCajas <= 0 || totalRetirado <= 0) {
    return resultado;
  }

  let sumaBases = 0;
  for (let i = 0; i < n; i++) {
    const base = Math.floor((origenes[i].cajas * destrioCajas) / totalRetirado);
    resultado[i] = base;
    sumaBases += base;
  }

  const resto = destrioCajas - sumaBases;
  if (resto > 0) {
    const ordenados = origenes
      .map((o, idx) => ({ idx, cajas: o.cajas }))
      .sort((a, b) => b.cajas - a.cajas || a.idx - b.idx);

    for (let r = 0; r < resto; r++) {
      const targetIdx = ordenados[r % n].idx;
      resultado[targetIdx] += 1;
    }
  }

  return resultado;
}

/**
 * Valida y planifica un reproceso a partir de capas FIFO en memoria (función pura).
 *
 * @param {Object} params
 * @param {Array<Object>|Object} params.origenes - Lista de { id_capa, cajas } o bien { articulo, envase, cajas, ids_capa? }
 * @param {Array<Object>} params.destinos - 1..N elementos { articulo, envase, cajas }
 * @param {number} [params.destrio_cajas] - Entero >= 0 en cajas de origen (D-036)
 * @param {number} [params.destrio_kg] - Número >= 0, informativo (D-025, D-036)
 * @param {string} [params.fecha] - Fecha de registro (YYYY-MM-DD); por defecto hoy en Europe/Madrid
 * @param {string} [params.observaciones]
 * @param {string} [params.usuario='SISTEMA']
 * @param {string} [params.id_reproceso]
 * @param {Array<Object>} capas - Capas actuales de CAPAS_FIFO
 * @returns {{
 *   ok: boolean,
 *   error?: string,
 *   errorCode?: string,
 *   id_reproceso?: string,
 *   movimientos?: Array<Object>,
 *   movsOrigen?: Array<Object>,
 *   movsDestino?: Array<Object>,
 *   reproceso?: Object,
 *   reprocesoLineas?: Array<Object>,
 *   cambio_envase?: string,
 *   destrio_cajas?: number,
 *   destrio_kg?: number|string,
 *   total_retirado?: number,
 *   total_destinos?: number
 * }}
 */
function planificarReproceso(params, capas) {
  if (!params || typeof params !== 'object') {
    return {
      ok: false,
      error: 'Parámetros de reproceso inválidos.',
      errorCode: 'VALIDATION_ERROR'
    };
  }

  const listaCapas = Array.isArray(capas) ? capas : [];

  // 1. Validar destinos
  if (!Array.isArray(params.destinos) || params.destinos.length === 0) {
    return {
      ok: false,
      error: 'Se requiere al menos un destino en el reproceso.',
      errorCode: 'VALIDATION_ERROR'
    };
  }

  const destinosNormalizados = [];
  let totalDestinos = 0;

  for (let i = 0; i < params.destinos.length; i++) {
    const d = params.destinos[i];
    if (!d || typeof d !== 'object') {
      return {
        ok: false,
        error: `Destino #${i + 1} inválido.`,
        errorCode: 'VALIDATION_ERROR'
      };
    }

    const rawArt = String(d.articulo || d.codigo_articulo || '').trim();
    const rawEnv = String(d.envase || d.codigo_envase || '').trim();

    if (!rawArt || !rawEnv) {
      return {
        ok: false,
        error: `Destino #${i + 1}: el artículo y el envase no pueden estar vacíos.`,
        errorCode: 'VALIDATION_ERROR'
      };
    }

    if (rawArt.includes('|') || rawEnv.includes('|')) {
      return {
        ok: false,
        error: `Destino #${i + 1}: los nombres no pueden contener el carácter '|'.`,
        errorCode: 'VALIDATION_ERROR'
      };
    }

    const cajasDest = Number(d.cajas);
    if (!Number.isInteger(cajasDest) || cajasDest <= 0) {
      return {
        ok: false,
        error: `Destino #${i + 1}: cantidad de cajas inválida (${d.cajas}). Debe ser un entero > 0.`,
        errorCode: 'VALIDATION_ERROR'
      };
    }

    const normArt = _normNombre_(rawArt);
    const normEnv = _normNombre_(rawEnv);

    destinosNormalizados.push({
      articulo: normArt,
      envase: normEnv,
      cajas: cajasDest
    });
    totalDestinos += cajasDest;
  }

  // 2. Resolver orígenes
  const origenesResueltos = [];

  if (Array.isArray(params.origenes)) {
    if (params.origenes.length === 0) {
      return {
        ok: false,
        error: 'Se requiere al menos una partida de origen.',
        errorCode: 'VALIDATION_ERROR'
      };
    }

    const idsVistos = new Set();
    for (let i = 0; i < params.origenes.length; i++) {
      const o = params.origenes[i];
      if (!o || typeof o !== 'object') {
        return {
          ok: false,
          error: `Origen #${i + 1} inválido.`,
          errorCode: 'VALIDATION_ERROR'
        };
      }

      const idCapa = String(o.id_capa || o.idCapa || '').trim();
      if (!idCapa) {
        return {
          ok: false,
          error: `Origen #${i + 1}: se requiere id_capa.`,
          errorCode: 'VALIDATION_ERROR'
        };
      }

      if (idsVistos.has(idCapa)) {
        return {
          ok: false,
          error: `Partida de origen duplicada: ${idCapa}.`,
          errorCode: 'VALIDATION_ERROR'
        };
      }
      idsVistos.add(idCapa);

      const cajasPedidas = Number(o.cajas);
      if (!Number.isInteger(cajasPedidas) || cajasPedidas <= 0) {
        return {
          ok: false,
          error: `Origen '${idCapa}': cantidad de cajas inválida (${o.cajas}). Debe ser entero > 0.`,
          errorCode: 'VALIDATION_ERROR'
        };
      }

      const layer = listaCapas.find(c => String(c.id_capa || '').trim() === idCapa);
      if (!layer) {
        return {
          ok: false,
          error: `La partida '${idCapa}' no existe.`,
          errorCode: 'CAPA_NO_ENCONTRADA'
        };
      }

      const estadoCapa = String(layer.estado_capa || '').trim().toUpperCase();
      if (estadoCapa !== 'ACTIVA') {
        return {
          ok: false,
          error: `La partida '${idCapa}' no está activa (estado actual: ${estadoCapa || 'DESCONOCIDO'}).`,
          errorCode: 'CAPA_INACTIVA'
        };
      }

      const restantes = Number(layer.cajas_restantes !== undefined ? layer.cajas_restantes : (Number(layer.cajas_iniciales || 0) - Number(layer.cajas_consumidas || 0)));
      if (cajasPedidas > restantes) {
        return {
          ok: false,
          error: `La partida ${idCapa} solo tiene ${restantes} cajas`,
          errorCode: 'CANTIDAD_INSUFICIENTE_EN_CAPA'
        };
      }

      origenesResueltos.push({
        layer,
        cajas: cajasPedidas
      });
    }
  } else if (typeof params.origenes === 'object' && params.origenes !== null) {
    const rawArt = String(params.origenes.articulo || params.origenes.codigo_articulo || '').trim();
    const rawEnv = String(params.origenes.envase || params.origenes.codigo_envase || '').trim();
    const cajasPedidas = Number(params.origenes.cajas);

    if (!rawArt || !rawEnv) {
      return {
        ok: false,
        error: 'Orígenes por combinación: se requiere artículo y envase.',
        errorCode: 'VALIDATION_ERROR'
      };
    }

    if (!Number.isInteger(cajasPedidas) || cajasPedidas <= 0) {
      return {
        ok: false,
        error: `Cantidad de cajas de origen inválida (${params.origenes.cajas}). Debe ser entero > 0.`,
        errorCode: 'VALIDATION_ERROR'
      };
    }

    const normArt = _normNombre_(rawArt);
    const normEnv = _normNombre_(rawEnv);

    let candidatas = listaCapas.filter(c =>
      _normNombre_(c.codigo_articulo) === normArt &&
      _normNombre_(c.codigo_envase) === normEnv &&
      String(c.estado_capa || '').trim().toUpperCase() === 'ACTIVA' &&
      Number(c.cajas_restantes || 0) > 0
    );

    if (Array.isArray(params.origenes.ids_capa) && params.origenes.ids_capa.length > 0) {
      const setIds = new Set(params.origenes.ids_capa.map(id => String(id || '').trim()));
      candidatas = candidatas.filter(c => setIds.has(String(c.id_capa || '').trim()));
    }

    // Ordenar por FIFO: fecha_capa ascendente, id_capa ascendente
    candidatas.sort((a, b) => {
      const fA = String(a.fecha_capa || '');
      const fB = String(b.fecha_capa || '');
      if (fA !== fB) return fA.localeCompare(fB);
      return String(a.id_capa || '').localeCompare(String(b.id_capa || ''));
    });

    const totalDisp = candidatas.reduce((sum, c) => sum + Number(c.cajas_restantes || 0), 0);
    if (cajasPedidas > totalDisp) {
      return {
        ok: false,
        error: `Stock insuficiente: disponibles ${totalDisp}, solicitadas ${cajasPedidas}`,
        errorCode: 'STOCK_INSUFICIENTE'
      };
    }

    let pendiente = cajasPedidas;
    for (const layer of candidatas) {
      if (pendiente <= 0) break;
      const disp = Number(layer.cajas_restantes || 0);
      const tomar = Math.min(disp, pendiente);
      origenesResueltos.push({
        layer,
        cajas: tomar
      });
      pendiente -= tomar;
    }
  } else {
    return {
      ok: false,
      error: 'Se deben indicar los orígenes del reproceso (lista de partidas o combinación con cajas).',
      errorCode: 'VALIDATION_ERROR'
    };
  }

  const totalRetirado = origenesResueltos.reduce((s, o) => s + o.cajas, 0);

  // Validar total por combinación contra stock disponible en capas
  const agrupadoPorClave = {};
  for (const o of origenesResueltos) {
    const k = `${_normNombre_(o.layer.codigo_articulo)}|${_normNombre_(o.layer.codigo_envase)}`;
    agrupadoPorClave[k] = (agrupadoPorClave[k] || 0) + o.cajas;
  }
  for (const [k, cajasPed] of Object.entries(agrupadoPorClave)) {
    const [a, e] = k.split('|');
    const dispTotal = listaCapas
      .filter(c => _normNombre_(c.codigo_articulo) === a && _normNombre_(c.codigo_envase) === e && String(c.estado_capa || '').toUpperCase() === 'ACTIVA')
      .reduce((s, c) => s + Number(c.cajas_restantes || 0), 0);
    if (cajasPed > dispTotal) {
      return {
        ok: false,
        error: `Stock insuficiente para la combinación ${k}: disponible ${dispTotal}, solicitado ${cajasPed}`,
        errorCode: 'STOCK_INSUFICIENTE'
      };
    }
  }

  // 3. Comprobar si hay cambio de envase
  const envasesOrigen = new Set(origenesResueltos.map(o => _normNombre_(o.layer.codigo_envase)));
  const envasesDestino = new Set(destinosNormalizados.map(d => d.envase));

  const mismoEnvase = (envasesOrigen.size === 1 && envasesDestino.size === 1 && [...envasesOrigen][0] === [...envasesDestino][0]);
  const cambioEnvase = mismoEnvase ? 'NO' : 'SI';

  // 4. Validar destrío
  let destrioCajas = 0;
  if (cambioEnvase === 'SI') {
    if (params.destrio_cajas === undefined || params.destrio_cajas === null || params.destrio_cajas === '') {
      return {
        ok: false,
        error: 'Indica el destrío en cajas: al cambiar de envase no se puede calcular',
        errorCode: 'DESTRIO_OBLIGATORIO'
      };
    }
    const valD = Number(params.destrio_cajas);
    if (!Number.isInteger(valD) || valD < 0) {
      return {
        ok: false,
        error: 'El destrío en cajas debe ser un entero ≥ 0.',
        errorCode: 'VALIDATION_ERROR'
      };
    }
    destrioCajas = valD;
  } else {
    if (params.destrio_cajas === undefined || params.destrio_cajas === null || params.destrio_cajas === '') {
      destrioCajas = Math.max(0, totalRetirado - totalDestinos);
    } else {
      const valD = Number(params.destrio_cajas);
      if (!Number.isInteger(valD) || valD < 0) {
        return {
          ok: false,
          error: 'El destrío en cajas debe ser un entero ≥ 0.',
          errorCode: 'VALIDATION_ERROR'
        };
      }
      destrioCajas = valD;
    }
  }

  let destrioKg = '';
  if (params.destrio_kg !== undefined && params.destrio_kg !== null && params.destrio_kg !== '') {
    const valKg = Number(params.destrio_kg);
    if (isNaN(valKg) || valKg < 0) {
      return {
        ok: false,
        error: 'El destrío en kg debe ser un número ≥ 0.',
        errorCode: 'VALIDATION_ERROR'
      };
    }
    destrioKg = valKg;
  }

  // 5. Herencia de fecha y proveedor para destinos
  const fechasOrigen = origenesResueltos.map(o => String(o.layer.fecha_capa || ''));
  fechasOrigen.sort();
  const fechaNegocioDestino = fechasOrigen[0] || _hoyMadrid_();

  const proveedoresOrigen = new Set(
    origenesResueltos
      .map(o => String(o.layer.proveedor || o.layer.entidad_nombre || '').trim())
      .filter(Boolean)
  );

  let proveedorDestino = 'VARIOS';
  if (proveedoresOrigen.size === 1) {
    proveedorDestino = [...proveedoresOrigen][0];
  }

  const idCapaOrigen = origenesResueltos.length === 1 ? origenesResueltos[0].layer.id_capa : '';

  // 6. Prorrateo de destrío entre orígenes
  const prorrateos = prorratearDestrio_(origenesResueltos, destrioCajas, totalRetirado);

  // 7. Generación de identificadores y movimientos
  const idReproceso = params.id_reproceso || _nuevoIdReproceso_('REP');
  const idDocRef = `REPROCESO:${idReproceso}`;
  const fechaRegistro = _normFecha_(params.fecha);
  const nowIso = params.fecha_hora || new Date().toISOString();
  const usuario = params.usuario || 'SISTEMA';

  // Movimientos ORIGEN (AJUSTE − con id_capa_objetivo)
  const movsOrigen = [];
  const lineasOrigen = [];
  for (let i = 0; i < origenesResueltos.length; i++) {
    const o = origenesResueltos[i];
    const idMovOrig = _nuevoIdReproceso_('MOV-REP-ORIG');

    const movOrig = {
      id_movimiento: idMovOrig,
      fecha_hora: nowIso,
      tipo_movimiento: 'AJUSTE',
      id_documento_ref: idDocRef,
      codigo_articulo: _normNombre_(o.layer.codigo_articulo),
      codigo_envase: _normNombre_(o.layer.codigo_envase),
      cajas: o.cajas,
      signo: -1,
      partida_origen: o.layer.partida || '',
      motivo_ajuste: 'REPROCESO_ORIGEN',
      usuario,
      observaciones: params.observaciones || `Reproceso origen ${idReproceso}`,
      estado: 'CONFIRMADO',
      fecha_negocio: fechaRegistro,
      entidad_nombre: o.layer.proveedor || '',
      secuencia: '',
      origen_dato: 'MANUAL',
      kg_informativo: '',
      id_movimiento_ref: o.layer.id_movimiento_entrada || '',
      id_capa_objetivo: o.layer.id_capa,
      id_capa_creada: ''
    };
    movsOrigen.push(movOrig);

    lineasOrigen.push({
      id_reproceso: idReproceso,
      tipo: 'ORIGEN',
      id_capa: o.layer.id_capa,
      codigo_articulo: _normNombre_(o.layer.codigo_articulo),
      codigo_envase: _normNombre_(o.layer.codigo_envase),
      cajas: o.cajas,
      proveedor: o.layer.proveedor || '',
      fecha_capa: o.layer.fecha_capa || '',
      destrio_prorrateado: prorrateos[i],
      id_movimiento: idMovOrig
    });
  }

  // Movimientos DESTINO (AJUSTE + sin capa objetivo, con id_capa_creada)
  const movsDestino = [];
  const lineasDestino = [];
  for (let j = 0; j < destinosNormalizados.length; j++) {
    const d = destinosNormalizados[j];
    const idMovDest = _nuevoIdReproceso_('MOV-REP-DEST');
    const idCapaNueva = _nuevoIdReproceso_('CAPA-REP');

    const movDest = {
      id_movimiento: idMovDest,
      fecha_hora: nowIso,
      tipo_movimiento: 'AJUSTE',
      id_documento_ref: idDocRef,
      documento_ref: idDocRef,
      codigo_articulo: d.articulo,
      codigo_envase: d.envase,
      cajas: d.cajas,
      signo: 1,
      partida_origen: origenesResueltos.length === 1 ? (origenesResueltos[0].layer.partida || 'REPROCESO') : 'REPROCESO',
      motivo_ajuste: 'REPROCESO_DESTINO',
      usuario,
      observaciones: params.observaciones || `Reproceso destino ${idReproceso}`,
      estado: 'CONFIRMADO',
      fecha_negocio: fechaNegocioDestino,
      entidad_nombre: proveedorDestino,
      secuencia: '',
      origen_dato: 'MANUAL',
      kg_informativo: '',
      id_movimiento_ref: origenesResueltos.length === 1 ? (origenesResueltos[0].layer.id_movimiento_entrada || '') : '',
      id_capa_objetivo: '',
      id_capa_creada: idCapaNueva,
      id_capa_origen: idCapaOrigen
    };
    movsDestino.push(movDest);

    lineasDestino.push({
      id_reproceso: idReproceso,
      tipo: 'DESTINO',
      id_capa: idCapaNueva,
      codigo_articulo: d.articulo,
      codigo_envase: d.envase,
      cajas: d.cajas,
      proveedor: proveedorDestino,
      fecha_capa: fechaNegocioDestino,
      destrio_prorrateado: 0,
      id_movimiento: idMovDest
    });
  }

  // Documento cabecera REPROCESOS
  const reprocesoDoc = {
    id_reproceso: idReproceso,
    fecha: fechaRegistro,
    fecha_hora: nowIso,
    usuario,
    total_retirado: totalRetirado,
    total_destinos: totalDestinos,
    destrio_cajas: destrioCajas,
    destrio_kg: destrioKg,
    cambio_envase: cambioEnvase,
    estado: 'ACTIVO',
    observaciones: params.observaciones || ''
  };

  return {
    ok: true,
    id_reproceso: idReproceso,
    movimientos: [...movsOrigen, ...movsDestino],
    movsOrigen,
    movsDestino,
    reproceso: reprocesoDoc,
    reprocesoLineas: [...lineasOrigen, ...lineasDestino],
    cambio_envase: cambioEnvase,
    destrio_cajas: destrioCajas,
    destrio_kg: destrioKg,
    total_retirado: totalRetirado,
    total_destinos: totalDestinos
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    planificarReproceso,
    prorratearDestrio_
  };
}
