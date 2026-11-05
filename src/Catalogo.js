/**
 * STOCK-LIGHT — Catalogo.js
 * Motor puro de clasificación de combinaciones artículo + envase mediante atributos y agrupaciones (D-029).
 * Sin dependencias de hojas de cálculo ni de servicios.
 */

/**
 * Normaliza un texto según D-003: mayúsculas, sin espacios extremos y espacios internos colapsados en uno.
 * No altera tildes, comas, puntos ni otros signos.
 * @param {string} texto
 * @returns {string}
 * @private
 */
function normalizarTextoCatalogo_(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto).trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Determina si una fila de configuración está activa.
 * @param {*} valor
 * @returns {boolean}
 * @private
 */
function esFilaActivaCatalogo_(valor) {
  if (valor === undefined || valor === null || valor === '') return true;
  if (typeof valor === 'boolean') return valor;
  const norm = String(valor).trim().toUpperCase();
  if (norm === 'FALSE' || norm === 'NO' || norm === '0') return false;
  return norm === 'TRUE' || norm === 'SI' || norm === 'SÍ' || norm === '1';
}

/**
 * Evalúa un campo de condición (`*_contiene` o `*_excluye`) sobre un texto ya normalizado.
 * - `;` separa alternativas (O).
 * - `+` une términos que deben aparecer todos en el texto (Y).
 * - Un campo vacío no filtra (devuelve true).
 *
 * @param {string} textoNorm - Texto normalizado (D-003)
 * @param {string} expresionRaw - Condición con `;` y `+`
 * @param {boolean} esExcluye - Si es true, la regla no aplica cuando se cumple cualquier alternativa
 * @returns {boolean}
 * @private
 */
function cumpleCondicionTextoCatalogo_(textoNorm, expresionRaw, esExcluye) {
  if (expresionRaw === null || expresionRaw === undefined) return true;
  const expresion = normalizarTextoCatalogo_(expresionRaw);
  if (!expresion) return true;

  const alternativas = expresion
    .split(';')
    .map(alt => normalizarTextoCatalogo_(alt))
    .filter(Boolean);

  if (alternativas.length === 0) return true;

  let coincideAlguna = false;
  for (let i = 0; i < alternativas.length; i++) {
    const terminos = alternativas[i]
      .split('+')
      .map(t => normalizarTextoCatalogo_(t))
      .filter(Boolean);

    if (terminos.length === 0) continue;

    let todosPresentes = Boolean(textoNorm);
    if (todosPresentes) {
      for (let j = 0; j < terminos.length; j++) {
        if (!textoNorm.includes(terminos[j])) {
          todosPresentes = false;
          break;
        }
      }
    }

    if (todosPresentes) {
      coincideAlguna = true;
      break;
    }
  }

  return esExcluye ? !coincideAlguna : coincideAlguna;
}

/**
 * Evalúa si un mapa de atributos cumple una expresión de filtro declarativa.
 * Sintaxis del filtro: `ATRIBUTO=v1|v2; OTRO!=v3`
 * - `;` es Y entre condiciones.
 * - `|` es O entre valores.
 * - `!=` es negación.
 * - Un atributo vacío no es igual a ningún valor.
 * - Un filtro vacío lo acepta todo.
 *
 * @param {Object} atributos - Mapa `{ [nombreAtributo]: valor }`
 * @param {string} filtro - Expresión de filtro
 * @returns {boolean}
 */
function cumpleFiltro(atributos, filtro) {
  if (filtro === null || filtro === undefined || String(filtro).trim() === '') {
    return true;
  }

  const mapaAtributos = {};
  if (atributos && typeof atributos === 'object') {
    const keys = Object.keys(atributos);
    for (let i = 0; i < keys.length; i++) {
      const k = normalizarTextoCatalogo_(keys[i]);
      const v = atributos[keys[i]];
      if (k && v !== undefined && v !== null && String(v).trim() !== '') {
        mapaAtributos[k] = normalizarTextoCatalogo_(v);
      }
    }
  }

  const condiciones = String(filtro).split(';');
  for (let i = 0; i < condiciones.length; i++) {
    const cond = condiciones[i].trim();
    if (!cond) continue;

    if (cond.includes('!=')) {
      const idx = cond.indexOf('!=');
      const nombreAttr = normalizarTextoCatalogo_(cond.slice(0, idx));
      const rhs = cond.slice(idx + 2);
      const valoresExcluidos = rhs
        .split('|')
        .map(v => normalizarTextoCatalogo_(v))
        .filter(Boolean);

      const valorActual = mapaAtributos[nombreAttr];
      // Un atributo vacío (undefined) no es igual a ningún valor, por lo que cumple !=
      if (valorActual !== undefined && valoresExcluidos.includes(valorActual)) {
        return false;
      }
    } else if (cond.includes('=')) {
      const idx = cond.indexOf('=');
      const nombreAttr = normalizarTextoCatalogo_(cond.slice(0, idx));
      const rhs = cond.slice(idx + 1);
      const valoresPermitidos = rhs
        .split('|')
        .map(v => normalizarTextoCatalogo_(v))
        .filter(Boolean);

      const valorActual = mapaAtributos[nombreAttr];
      // Un atributo vacío (undefined) no es igual a ningún valor
      if (valorActual === undefined || !valoresPermitidos.includes(valorActual)) {
        return false;
      }
    } else {
      return false;
    }
  }

  return true;
}

/**
 * Clasifica una combinación artículo + envase y devuelve la explicación completa de su evaluación:
 * qué excepción o regla decidió cada atributo, qué fila de agrupación ganó y qué reglas/excepciones
 * se ignoraron por referenciar un atributo inexistente o inactivo.
 *
 * @param {string} articulo
 * @param {string} envase
 * @param {Object} config - `{ atributos, reglas, catalogo, agrupaciones }`
 * @returns {{
 *   seguimiento: 'SEGUIDA'|'NO_SEGUIDA'|'PENDIENTE',
 *   atributos: Object,
 *   cajones: Object,
 *   agrupaciones: Object,
 *   origenPorAtributo: Object,
 *   decisionesAtributos: Object,
 *   filaPorAgrupacion: Object,
 *   decisionesAgrupaciones: Object,
 *   ignorados: Array<Object>,
 *   avisos: Array<string>
 * }}
 */
function explicarCombinacion(articulo, envase, config) {
  const cfg = config || {};
  const tieneTablaAtributos = Array.isArray(cfg.atributos);
  const listaAtributos = tieneTablaAtributos ? cfg.atributos : [];
  const listaReglas = Array.isArray(cfg.reglas) ? cfg.reglas : [];
  const listaCatalogo = Array.isArray(cfg.catalogo) ? cfg.catalogo : [];
  const listaAgrupaciones = Array.isArray(cfg.agrupaciones) ? cfg.agrupaciones : [];

  const artNorm = normalizarTextoCatalogo_(articulo);
  const envNorm = normalizarTextoCatalogo_(envase);

  // 1. Construir catálogo de atributos definidos y su estado (activo / inactivo)
  const estadoAtributo = new Map();
  const nombresAtributosActivos = [];

  function registrarAtributoActivo_(nombre) {
    if (!estadoAtributo.has(nombre)) {
      estadoAtributo.set(nombre, 'ACTIVO');
      nombresAtributosActivos.push(nombre);
    }
  }

  for (let i = 0; i < listaAtributos.length; i++) {
    const item = listaAtributos[i];
    if (!item) continue;
    const nombre = normalizarTextoCatalogo_(item.nombre);
    if (!nombre) continue;
    const activo = esFilaActivaCatalogo_(item.activo !== undefined ? item.activo : item.activa);
    if (activo) {
      registrarAtributoActivo_(nombre);
    } else {
      estadoAtributo.set(nombre, 'INACTIVO');
    }
  }

  // SEGUIMIENTO es obligatorio y especial salvo que se haya desactivado expresamente en ATRIBUTOS
  if (!estadoAtributo.has('SEGUIMIENTO')) {
    registrarAtributoActivo_('SEGUIMIENTO');
  }

  // Si no se pasó tabla de atributos en config, inferir como activos los atributos presentes en reglas/catálogo
  if (!tieneTablaAtributos) {
    for (let i = 0; i < listaCatalogo.length; i++) {
      const fila = listaCatalogo[i];
      if (fila && fila.atributo) {
        const attr = normalizarTextoCatalogo_(fila.atributo);
        if (attr) registrarAtributoActivo_(attr);
      }
    }
    for (let i = 0; i < listaReglas.length; i++) {
      const regla = listaReglas[i];
      if (regla && regla.atributo) {
        const attr = normalizarTextoCatalogo_(regla.atributo);
        if (attr) registrarAtributoActivo_(attr);
      }
    }
  }

  const ignorados = [];
  const avisos = [];

  function verificarAtributoValido_(attrRaw, tipoOrigen, idReferencia) {
    const attr = normalizarTextoCatalogo_(attrRaw);
    if (!attr) {
      const msg = `${tipoOrigen} (${idReferencia}) ignorada: atributo vacío`;
      ignorados.push({ tipo: tipoOrigen, referencia: idReferencia, atributo: '', motivo: 'ATRIBUTO_INEXISTENTE', mensaje: msg });
      avisos.push(msg);
      return null;
    }
    const est = estadoAtributo.get(attr);
    if (!est) {
      const msg = `${tipoOrigen} (${idReferencia}) ignorada: atributo '${attr}' inexistente en ATRIBUTOS`;
      ignorados.push({ tipo: tipoOrigen, referencia: idReferencia, atributo: attr, motivo: 'ATRIBUTO_INEXISTENTE', mensaje: msg });
      avisos.push(msg);
      return null;
    }
    if (est === 'INACTIVO') {
      const msg = `${tipoOrigen} (${idReferencia}) ignorada: atributo '${attr}' inactivo en ATRIBUTOS`;
      ignorados.push({ tipo: tipoOrigen, referencia: idReferencia, atributo: attr, motivo: 'ATRIBUTO_INACTIVO', mensaje: msg });
      avisos.push(msg);
      return null;
    }
    return attr;
  }

  // 2. Evaluar excepciones exactas en CATALOGO (artículo + envase normalizados, por atributo)
  const excepcionesPorAtributo = {};
  for (let i = 0; i < listaCatalogo.length; i++) {
    const fila = listaCatalogo[i];
    if (!fila) continue;
    const activa = esFilaActivaCatalogo_(fila.activo !== undefined ? fila.activo : fila.activa);
    if (!activa) continue;

    const filaArt = normalizarTextoCatalogo_(fila.articulo !== undefined ? fila.articulo : fila.codigo_articulo);
    const filaEnv = normalizarTextoCatalogo_(fila.envase !== undefined ? fila.envase : fila.codigo_envase);
    const refExcepcion = `${filaArt}|${filaEnv}`;

    const attr = verificarAtributoValido_(fila.atributo, 'EXCEPCION_CATALOGO', refExcepcion);
    if (!attr) continue;

    if (filaArt === artNorm && filaEnv === envNorm) {
      const val = fila.valor !== undefined && fila.valor !== null ? normalizarTextoCatalogo_(fila.valor) : '';
      if (val !== '') {
        excepcionesPorAtributo[attr] = {
          valor: val,
          fila,
          observaciones: fila.observaciones !== undefined && fila.observaciones !== null ? String(fila.observaciones).trim() : ''
        };
      }
    }
  }

  // 3. Agrupar reglas activas de REGLAS_CLASIFICACION por atributo y ordenar por menor prioridad (empate: primera de la hoja)
  const reglasPorAtributo = {};
  for (let i = 0; i < listaReglas.length; i++) {
    const regla = listaReglas[i];
    if (!regla) continue;
    const activa = esFilaActivaCatalogo_(regla.activo !== undefined ? regla.activo : regla.activa);
    if (!activa) continue;

    const idRegla = regla.id !== undefined && regla.id !== null && String(regla.id).trim() !== ''
      ? String(regla.id).trim()
      : `REGLA_${i + 1}`;

    const attr = verificarAtributoValido_(regla.atributo, 'REGLA_CLASIFICACION', idRegla);
    if (!attr) continue;

    if (!reglasPorAtributo[attr]) {
      reglasPorAtributo[attr] = [];
    }

    const rawPrioridad = regla.prioridad !== undefined ? regla.prioridad : regla.orden;
    const prioNum = Number(rawPrioridad);
    reglasPorAtributo[attr].push({
      regla,
      id: idRegla,
      prioridad: Number.isFinite(prioNum) ? prioNum : Number.MAX_SAFE_INTEGER,
      idx: i
    });
  }

  const attrsConReglas = Object.keys(reglasPorAtributo);
  for (let i = 0; i < attrsConReglas.length; i++) {
    const attr = attrsConReglas[i];
    reglasPorAtributo[attr].sort((a, b) => {
      if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
      return a.idx - b.idx;
    });
  }

  // 4. Resolver cada atributo activo de forma independiente
  const atributos = {};
  const origenPorAtributo = {};
  const decisionesAtributos = {};

  for (let i = 0; i < nombresAtributosActivos.length; i++) {
    const attr = nombresAtributosActivos[i];

    // Una excepción activa en CATALOGO gana a las reglas solo para ese atributo
    if (Object.prototype.hasOwnProperty.call(excepcionesPorAtributo, attr)) {
      const exc = excepcionesPorAtributo[attr];
      atributos[attr] = exc.valor;
      origenPorAtributo[attr] = 'CATALOGO';
      decisionesAtributos[attr] = {
        tipo: 'CATALOGO',
        origen: 'CATALOGO',
        valor: exc.valor,
        observaciones: exc.observaciones,
        fila: exc.fila
      };
      continue;
    }

    // Evaluar reglas activas del atributo por menor prioridad
    const candidatas = reglasPorAtributo[attr] || [];
    for (let j = 0; j < candidatas.length; j++) {
      const item = candidatas[j];
      const regla = item.regla;

      const artContiene = regla.articulo_contiene !== undefined ? regla.articulo_contiene : regla.patron_articulo;
      const artExcluye = regla.articulo_excluye;
      const envContiene = regla.envase_contiene !== undefined ? regla.envase_contiene : regla.patron_envase;
      const envExcluye = regla.envase_excluye;

      // Si una regla solo tiene condiciones vacías en todos los campos, requiere al menos artículo o envase presente
      const sinCondiciones =
        !normalizarTextoCatalogo_(artContiene) &&
        !normalizarTextoCatalogo_(artExcluye) &&
        !normalizarTextoCatalogo_(envContiene) &&
        !normalizarTextoCatalogo_(envExcluye);
      if (sinCondiciones && !artNorm && !envNorm) {
        continue;
      }

      // Si hay *_excluye de artículo pero no *_contiene, requiere que exista artículo normalizado
      if (!normalizarTextoCatalogo_(artContiene) && normalizarTextoCatalogo_(artExcluye) && !artNorm) {
        continue;
      }
      // Si hay *_excluye de envase pero no *_contiene, requiere que exista envase normalizado
      if (!normalizarTextoCatalogo_(envContiene) && normalizarTextoCatalogo_(envExcluye) && !envNorm) {
        continue;
      }

      const okArtCont = cumpleCondicionTextoCatalogo_(artNorm, artContiene, false);
      if (!okArtCont) continue;

      const okArtExcl = cumpleCondicionTextoCatalogo_(artNorm, artExcluye, true);
      if (!okArtExcl) continue;

      const okEnvCont = cumpleCondicionTextoCatalogo_(envNorm, envContiene, false);
      if (!okEnvCont) continue;

      const okEnvExcl = cumpleCondicionTextoCatalogo_(envNorm, envExcluye, true);
      if (!okEnvExcl) continue;

      const valorAsignado = regla.valor !== undefined && regla.valor !== null
        ? normalizarTextoCatalogo_(regla.valor)
        : '';

      if (valorAsignado !== '') {
        atributos[attr] = valorAsignado;
        origenPorAtributo[attr] = item.id;
        decisionesAtributos[attr] = {
          tipo: 'REGLA',
          origen: item.id,
          reglaId: item.id,
          prioridad: item.prioridad,
          valor: valorAsignado,
          regla
        };
        break;
      }
    }
  }

  // 5. Determinar estado de seguimiento a partir del atributo especial SEGUIMIENTO (SI -> SEGUIDA, NO -> NO_SEGUIDA, sin decidir -> PENDIENTE)
  let seguimiento = 'PENDIENTE';
  if (atributos.SEGUIMIENTO === 'SI') {
    seguimiento = 'SEGUIDA';
  } else if (atributos.SEGUIMIENTO === 'NO') {
    seguimiento = 'NO_SEGUIDA';
  }

  // 6. Evaluar AGRUPACIONES activas por orden ascendente dentro de cada agrupación
  const filasPorVista = {};
  const ordenVistas = [];

  for (let i = 0; i < listaAgrupaciones.length; i++) {
    const fila = listaAgrupaciones[i];
    if (!fila) continue;
    const activa = esFilaActivaCatalogo_(fila.activo !== undefined ? fila.activo : fila.activa);
    if (!activa) continue;

    const nombreVista = normalizarTextoCatalogo_(fila.agrupacion);
    if (!nombreVista) continue;

    if (!filasPorVista[nombreVista]) {
      filasPorVista[nombreVista] = [];
      ordenVistas.push(nombreVista);
    }

    const ordenNum = Number(fila.orden);
    filasPorVista[nombreVista].push({
      fila,
      orden: Number.isFinite(ordenNum) ? ordenNum : Number.MAX_SAFE_INTEGER,
      idx: i
    });
  }

  const cajones = {};
  const filaPorAgrupacion = {};
  const decisionesAgrupaciones = {};

  for (let i = 0; i < ordenVistas.length; i++) {
    const vista = ordenVistas[i];
    const candidatas = filasPorVista[vista];
    candidatas.sort((a, b) => {
      if (a.orden !== b.orden) return a.orden - b.orden;
      return a.idx - b.idx;
    });

    let ganador = null;
    for (let j = 0; j < candidatas.length; j++) {
      const item = candidatas[j];
      const filtro = item.fila.filtro !== undefined && item.fila.filtro !== null ? String(item.fila.filtro) : '';
      if (cumpleFiltro(atributos, filtro)) {
        ganador = item;
        break;
      }
    }

    if (ganador) {
      const grupoRaw = ganador.fila.grupo !== undefined && ganador.fila.grupo !== null
        ? String(ganador.fila.grupo).trim()
        : '';
      const subgrupoRaw = ganador.fila.subgrupo !== undefined && ganador.fila.subgrupo !== null
        ? String(ganador.fila.subgrupo).trim()
        : '';

      cajones[vista] = {
        grupo: grupoRaw || 'SIN CLASIFICAR',
        subgrupo: subgrupoRaw !== '' ? subgrupoRaw : null
      };
      const infoFila = {
        agrupacion: vista,
        orden: ganador.orden,
        grupo: cajones[vista].grupo,
        subgrupo: cajones[vista].subgrupo,
        filtro: ganador.fila.filtro !== undefined && ganador.fila.filtro !== null ? String(ganador.fila.filtro) : ''
      };
      filaPorAgrupacion[vista] = infoFila;
      decisionesAgrupaciones[vista] = infoFila;
    } else {
      cajones[vista] = {
        grupo: 'SIN CLASIFICAR',
        subgrupo: null
      };
      filaPorAgrupacion[vista] = null;
      decisionesAgrupaciones[vista] = null;
    }
  }

  return {
    seguimiento,
    atributos,
    cajones,
    agrupaciones: cajones,
    origenPorAtributo,
    decisionesAtributos,
    filaPorAgrupacion,
    decisionesAgrupaciones,
    ignorados,
    avisos
  };
}

/**
 * Clasifica una combinación artículo + envase según la configuración del catálogo.
 *
 * @param {string} articulo
 * @param {string} envase
 * @param {Object} config - `{ atributos, reglas, catalogo, agrupaciones }`
 * @returns {{
 *   seguimiento: 'SEGUIDA'|'NO_SEGUIDA'|'PENDIENTE',
 *   atributos: Object,
 *   cajones: Object,
 *   agrupaciones: Object
 * }}
 */
function clasificarCombinacion(articulo, envase, config) {
  const explicacion = explicarCombinacion(articulo, envase, config);
  return {
    seguimiento: explicacion.seguimiento,
    atributos: explicacion.atributos,
    cajones: explicacion.cajones,
    agrupaciones: explicacion.cajones
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    clasificarCombinacion,
    explicarCombinacion,
    cumpleFiltro
  };
}
