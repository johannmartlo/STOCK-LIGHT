/**
 * STOCK-LIGHT — CuadreService.js (T-040)
 *
 * Asistente de cuadre de la noche: recuento artículo por artículo dentro de su familia
 * (agrupación COMERCIAL, D-029) y ajustes de stock con motivo RECUENTO.
 *
 * Reglas que implementa:
 * - `obtenerCuadre()` devuelve las familias con stock > 0 o algún movimiento en los
 *   últimos 7 días, con los artículos ordenados por `compararArticulos` (T-039).
 * - `confirmarFamilia()` valida todo antes de escribir, comprueba que el stock no ha
 *   cambiado desde que se abrió el cuadre, aplica un ajuste por diferencia y guarda
 *   una fila en CUADRES. Es idempotente por `id_cuadre` + familia.
 *
 * La escritura de stock se delega SIEMPRE en `MovementService.registrarAjuste`
 * (FIFO, libro de solo añadir y persistencia atómica, D-022). Este servicio no toca
 * SpreadsheetApp: la lectura y la escritura pasan por `SheetsRepository`.
 */

if (typeof require !== 'undefined') {
  try {
    const idsMod = require('./Ids');
    global.nuevoId = global.nuevoId || idsMod.nuevoId;
  } catch (e) {}
  try {
    const normMod = require('./Normalizacion');
    global.normalizarNombre = global.normalizarNombre || normMod.normalizarNombre;
  } catch (e) {}
  try {
    const ordenMod = require('./OrdenExistencias');
    global.compararArticulos = global.compararArticulos || ordenMod.compararArticulos;
  } catch (e) {}
  try {
    const repoMod = require('./Repository');
    global.SheetsRepository = global.SheetsRepository || repoMod.SheetsRepository;
  } catch (e) {}
  try {
    const movMod = require('./MovementService');
    global.MovementService = global.MovementService || movMod.MovementService;
  } catch (e) {}
  try {
    const catMod = require('./CatalogoService');
    global.CatalogoService = global.CatalogoService || catMod.CatalogoService;
  } catch (e) {}
}

const CUADRE_AGRUPACION_ = 'COMERCIAL';
const CUADRE_MOTIVO_ = 'RECUENTO';
const CUADRE_DIAS_RECIENTES_ = 7;
const CUADRE_FAMILIA_SIN_CLASIFICAR_ = 'SIN CLASIFICAR';

// Misma paleta de respaldo que InicioService para que una agrupación sin color no cambie
// de color entre pantallas. Solo es presentación: nunca interviene en el stock.
const CUADRE_PALETA_ = [
  '#4FA37C',
  '#F2553D',
  '#2DD4BF',
  '#F5A3B5',
  '#EC4899',
  '#60A5FA'
];

/**
 * Normaliza un nombre igual que la clave de stock (D-003).
 * @param {*} texto
 * @returns {string}
 * @private
 */
function _normalizarCuadre_(texto) {
  const fn = typeof normalizarNombre === 'function'
    ? normalizarNombre
    : (typeof global !== 'undefined' && typeof global.normalizarNombre === 'function' ? global.normalizarNombre : null);
  if (typeof fn === 'function') return fn(texto);
  return String(texto === null || texto === undefined ? '' : texto).trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Clave canónica artículo + envase para comparar con STOCK_ACTUAL.
 * @param {*} articulo
 * @param {*} envase
 * @returns {string}
 * @private
 */
function _claveCuadre_(articulo, envase) {
  return `${_normalizarCuadre_(articulo)}|${_normalizarCuadre_(envase)}`;
}

/**
 * Indica si una fila de configuración está activa, con la misma tolerancia que el resto
 * de servicios (D-029).
 * @param {*} valor
 * @returns {boolean}
 * @private
 */
function _activoCuadre_(valor) {
  if (valor === false || valor === 0) return false;
  const texto = String(valor === undefined || valor === null ? '' : valor).trim().toUpperCase();
  return texto !== 'FALSE' && texto !== 'NO' && texto !== '0';
}

/**
 * Interpreta un entero mayor o igual que cero. Devuelve null si no lo es.
 * @param {*} valor
 * @returns {number|null}
 * @private
 */
function _enteroCuadre_(valor) {
  if (typeof valor === 'number') {
    return Number.isSafeInteger(valor) && valor >= 0 ? valor : null;
  }
  const texto = String(valor === null || valor === undefined ? '' : valor).trim();
  if (!/^\d+$/.test(texto)) return null;
  const numero = Number(texto);
  return Number.isSafeInteger(numero) && numero >= 0 ? numero : null;
}

/**
 * Milisegundos de una fecha ISO, DATETIME o YYYY-MM-DD. 0 si no se puede interpretar.
 * @param {*} valor
 * @returns {number}
 * @private
 */
function _fechaMsCuadre_(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? 0 : valor.getTime();
  const texto = String(valor).trim();
  if (!texto) return 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    const ms = Date.parse(`${texto}T12:00:00Z`);
    return isNaN(ms) ? 0 : ms;
  }
  const ms = Date.parse(texto);
  return isNaN(ms) ? 0 : ms;
}

/**
 * Separa la lista de ids de ajustes guardada en CUADRES.
 * @param {*} valor
 * @returns {Array<string>}
 * @private
 */
function _idsAjustesCuadre_(valor) {
  if (Array.isArray(valor)) {
    return valor.map(id => String(id || '').trim()).filter(Boolean);
  }
  return String(valor === null || valor === undefined ? '' : valor)
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

/**
 * Suma con signo de las diferencias de las líneas.
 * @param {Array<Object>} lineas
 * @returns {number}
 * @private
 */
function _sumaDiferenciasCuadre_(lineas) {
  let total = 0;
  for (const linea of (Array.isArray(lineas) ? lineas : [])) {
    total += Number(linea && linea.diferencia ? linea.diferencia : 0);
  }
  return total;
}

/**
 * Lee una tabla del repositorio sin romper si la hoja aún no existe.
 * @param {Object} repo
 * @param {string} metodo
 * @returns {Array<Object>}
 * @private
 */
function _leerTablaCuadre_(repo, metodo) {
  try {
    if (!repo || typeof repo[metodo] !== 'function') return [];
    const filas = repo[metodo]();
    return Array.isArray(filas) ? filas : [];
  } catch (e) {
    return [];
  }
}

/**
 * Define las familias de la agrupación COMERCIAL en su orden, con su color.
 * @param {Array<Object>} agrupaciones
 * @returns {{ lista: Array<Object>, mapa: Map<string, Object> }}
 * @private
 */
function _definirFamiliasCuadre_(agrupaciones) {
  const filas = (Array.isArray(agrupaciones) ? agrupaciones : [])
    .filter(fila => fila && _activoCuadre_(fila.activo !== undefined ? fila.activo : fila.activa))
    .filter(fila => _normalizarCuadre_(fila.agrupacion) === CUADRE_AGRUPACION_)
    .map((fila, idx) => ({
      fila,
      orden: Number.isFinite(Number(fila.orden)) ? Number(fila.orden) : Number.MAX_SAFE_INTEGER,
      idx
    }));

  filas.sort((a, b) => (a.orden !== b.orden ? a.orden - b.orden : a.idx - b.idx));

  const lista = [];
  const mapa = new Map();

  for (const item of filas) {
    const familia = String(item.fila.grupo || '').trim() || CUADRE_FAMILIA_SIN_CLASIFICAR_;
    const clave = _normalizarCuadre_(familia);
    if (!mapa.has(clave)) {
      const def = { familia, clave, orden: item.orden, color: '' };
      mapa.set(clave, def);
      lista.push(def);
    }
    const def = mapa.get(clave);
    if (!def.color && item.fila.color !== undefined && item.fila.color !== null && String(item.fila.color).trim() !== '') {
      def.color = String(item.fila.color).trim();
    }
  }

  // Un artículo sin cajón definido no puede desaparecer del cuadre: va a SIN CLASIFICAR.
  if (!mapa.has(_normalizarCuadre_(CUADRE_FAMILIA_SIN_CLASIFICAR_))) {
    const def = {
      familia: CUADRE_FAMILIA_SIN_CLASIFICAR_,
      clave: _normalizarCuadre_(CUADRE_FAMILIA_SIN_CLASIFICAR_),
      orden: Number.MAX_SAFE_INTEGER,
      color: ''
    };
    mapa.set(def.clave, def);
    lista.push(def);
  }

  for (let i = 0; i < lista.length; i++) {
    if (!lista[i].color) lista[i].color = CUADRE_PALETA_[i % CUADRE_PALETA_.length];
  }

  return { lista, mapa };
}

/**
 * Compara dos artículos con el orden de la ficha (T-039), con respaldo estable.
 * @param {{articulo: string, envase: string}} a
 * @param {{articulo: string, envase: string}} b
 * @returns {number}
 * @private
 */
function _compararArticulosCuadre_(a, b) {
  const fn = typeof compararArticulos === 'function'
    ? compararArticulos
    : (typeof global !== 'undefined' && typeof global.compararArticulos === 'function' ? global.compararArticulos : null);
  if (typeof fn === 'function') return fn(a, b);
  const artA = String(a && a.articulo || '');
  const artB = String(b && b.articulo || '');
  const cmpArt = artA.localeCompare(artB, 'es');
  if (cmpArt !== 0) return cmpArt;
  return String(a && a.envase || '').localeCompare(String(b && b.envase || ''), 'es');
}

class CuadreService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.repository]
   * @param {Object} [options.movementService]
   * @param {Object} [options.catalogoService]
   * @param {Object} [options.configCatalogo] - Configuración en memoria para el catálogo.
   * @param {Function|Date|string} [options.reloj] - Reloj inyectable.
   * @param {Function|Date|string} [options.clock] - Alias de reloj.
   */
  constructor(options = {}) {
    const RepoClass = (typeof SheetsRepository !== 'undefined')
      ? SheetsRepository
      : (typeof require !== 'undefined' ? require('./Repository').SheetsRepository : null);
    if (!RepoClass && !options.repository) {
      throw new Error('SheetsRepository no está disponible en CuadreService');
    }
    this.repo = options.repository || new RepoClass();

    const MovementClass = (typeof MovementService !== 'undefined')
      ? MovementService
      : (typeof require !== 'undefined' ? require('./MovementService').MovementService : null);
    this.movementService = options.movementService || (MovementClass
      ? new MovementClass({ repository: this.repo, lockService: options.lockService })
      : null);
    if (!this.movementService) {
      throw new Error('MovementService no está disponible en CuadreService');
    }

    const CatalogoClass = (typeof CatalogoService !== 'undefined')
      ? CatalogoService
      : (typeof require !== 'undefined' ? require('./CatalogoService').CatalogoService : null);
    this.catalogoService = options.catalogoService || (CatalogoClass
      ? new CatalogoClass({
        repository: this.repo,
        config: options.configCatalogo || options.config || null
      })
      : null);

    this.reloj = options.reloj !== undefined ? options.reloj : options.clock;
  }

  /**
   * Genera un identificador único (D-024).
   * @param {string} prefijo
   * @returns {string}
   * @private
   */
  _nuevoId_(prefijo) {
    const fn = typeof nuevoId === 'function'
      ? nuevoId
      : (typeof global !== 'undefined' ? global.nuevoId : null);
    if (typeof fn !== 'function') throw new Error('nuevoId no está disponible en CuadreService');
    return fn(prefijo);
  }

  /**
   * Fecha y hora actual del servicio.
   * @returns {Date}
   * @private
   */
  _ahora_() {
    const valor = typeof this.reloj === 'function'
      ? this.reloj()
      : (this.reloj !== undefined && this.reloj !== null ? this.reloj : new Date());
    const fecha = valor instanceof Date ? valor : new Date(valor);
    return isNaN(fecha.getTime()) ? new Date() : fecha;
  }

  /**
   * Configuración del catálogo, sin romper si el servicio no está disponible.
   * @returns {{ atributos: Array<Object>, reglas: Array<Object>, catalogo: Array<Object>, agrupaciones: Array<Object> }}
   * @private
   */
  _configCuadre_() {
    const vacia = { atributos: [], reglas: [], catalogo: [], agrupaciones: [] };
    if (!this.catalogoService || typeof this.catalogoService.obtenerConfiguracion !== 'function') return vacia;
    try {
      const config = this.catalogoService.obtenerConfiguracion();
      return config && typeof config === 'object'
        ? {
          atributos: Array.isArray(config.atributos) ? config.atributos : [],
          reglas: Array.isArray(config.reglas) ? config.reglas : [],
          catalogo: Array.isArray(config.catalogo) ? config.catalogo : [],
          agrupaciones: Array.isArray(config.agrupaciones) ? config.agrupaciones : []
        }
        : vacia;
    } catch (e) {
      return vacia;
    }
  }

  /**
   * Devuelve el cuadre del momento: familias, artículos y cajas que debería haber.
   *
   * @param {Object} [datos] - Datos ya cargados (opcional): `{ movimientos, stockRows }`.
   * @returns {{ id_cuadre: string, generado_en: string, familias: Array<Object> }}
   */
  obtenerCuadre(datos = {}) {
    const datosPrevios = datos && typeof datos === 'object' ? datos : {};
    const ahora = this._ahora_();
    const ahoraMs = ahora.getTime();
    const limiteMs = ahoraMs - CUADRE_DIAS_RECIENTES_ * 24 * 60 * 60 * 1000;

    const stockRows = Array.isArray(datosPrevios.stockRows)
      ? datosPrevios.stockRows
      : _leerTablaCuadre_(this.repo, 'getStockActual');
    const movimientos = Array.isArray(datosPrevios.movimientos)
      ? datosPrevios.movimientos
      : _leerTablaCuadre_(this.repo, 'getMovimientos');
    const config = this._configCuadre_();
    const defs = _definirFamiliasCuadre_(config.agrupaciones);

    const stock = new Map();
    for (const fila of stockRows) {
      if (!fila) continue;
      const articulo = String(fila.codigo_articulo || '').trim();
      const envase = String(fila.codigo_envase || '').trim();
      if (!articulo || !envase) continue;
      const clave = fila.stock_key ? String(fila.stock_key).trim() : _claveCuadre_(articulo, envase);
      stock.set(clave, Number(fila.cajas_actuales || 0));
    }

    const reciente = new Set();
    for (const movimiento of movimientos) {
      if (!movimiento) continue;
      if (String(movimiento.estado || '').trim().toUpperCase() === 'ANULADO') continue;
      const articulo = String(movimiento.codigo_articulo || '').trim();
      const envase = String(movimiento.codigo_envase || '').trim();
      if (!articulo || !envase) continue;
      const ms = Math.max(
        _fechaMsCuadre_(movimiento.fecha_hora),
        _fechaMsCuadre_(movimiento.fecha_negocio)
      );
      if (ms && ms >= limiteMs) {
        reciente.add(_claveCuadre_(articulo, envase));
      }
    }

    const claves = new Set();
    for (const [clave, cajas] of stock.entries()) {
      if (Number(cajas || 0) > 0) claves.add(clave);
    }
    for (const clave of reciente.values()) {
      claves.add(clave);
    }

    const clasificacionCache = new Map();
    const buckets = new Map();
    for (const clave of claves) {
      const partes = clave.split('|');
      if (partes.length !== 2 || !partes[0] || !partes[1]) continue;
      const articulo = partes[0];
      const envase = partes[1];

      let grupo = CUADRE_FAMILIA_SIN_CLASIFICAR_;
      if (this.catalogoService && typeof this.catalogoService.clasificar === 'function') {
        if (!clasificacionCache.has(clave)) {
          let res = null;
          try {
            res = this.catalogoService.clasificar(articulo, envase);
          } catch (e) {
            res = null;
          }
          const cajon = res && res.cajones ? res.cajones[CUADRE_AGRUPACION_] : null;
          const grupoCrudo = cajon && cajon.grupo ? String(cajon.grupo).trim() : '';
          clasificacionCache.set(clave, grupoCrudo || CUADRE_FAMILIA_SIN_CLASIFICAR_);
        }
        grupo = clasificacionCache.get(clave) || CUADRE_FAMILIA_SIN_CLASIFICAR_;
      }

      let def = defs.mapa.get(_normalizarCuadre_(grupo));
      if (!def) def = defs.mapa.get(_normalizarCuadre_(CUADRE_FAMILIA_SIN_CLASIFICAR_));
      if (!def) continue;

      if (!buckets.has(def.clave)) {
        buckets.set(def.clave, { def, articulos: [] });
      }
      buckets.get(def.clave).articulos.push({
        articulo,
        envase,
        deberia: Number(stock.get(clave) || 0)
      });
    }

    const cuadres = _leerTablaCuadre_(this.repo, 'getCuadres');
    const ultimoPorFamilia = new Map();
    for (const fila of cuadres) {
      if (!fila) continue;
      const familia = String(fila.familia || '').trim();
      if (!familia) continue;
      ultimoPorFamilia.set(_normalizarCuadre_(familia), fila);
    }

    const familias = [];
    for (const def of defs.lista) {
      const bucket = buckets.get(def.clave);
      if (!bucket || bucket.articulos.length === 0) continue;

      bucket.articulos.sort(_compararArticulosCuadre_);
      const cajas = bucket.articulos.reduce((total, articulo) => total + Number(articulo.deberia || 0), 0);
      const filaCuadre = ultimoPorFamilia.get(def.clave) || null;
      const ids = filaCuadre ? _idsAjustesCuadre_(filaCuadre.ids_ajustes) : [];

      familias.push({
        familia: def.familia,
        orden: def.orden,
        color: def.color,
        cajas,
        articulos: bucket.articulos,
        ultimo_cuadre: filaCuadre
          ? {
            fecha_hora: String(filaCuadre.fecha_hora || ''),
            usuario: String(filaCuadre.usuario || ''),
            ajustes: ids.length
          }
          : null
      });
    }

    return {
      generado_en: ahora.toISOString(),
      familias,
      id_cuadre: this._nuevoId_('CUADRE')
    };
  }

  /**
   * Devuelve la respuesta guardada de un cuadre ya confirmado (idempotencia).
   * @param {Object} fila
   * @returns {Object}
   * @private
   */
  _respuestaGuardada_(fila) {
    const ids = _idsAjustesCuadre_(fila.ids_ajustes);
    return {
      success: true,
      status: 'CONFIRMADO',
      idempotente: true,
      id_cuadre: String(fila.id_cuadre || ''),
      familia: String(fila.familia || ''),
      fecha_hora: String(fila.fecha_hora || ''),
      usuario: String(fila.usuario || ''),
      lineas_contadas: Number(fila.lineas_contadas || 0),
      lineas_con_diferencia: Number(fila.lineas_con_diferencia || 0),
      cajas_diferencia: Number(fila.cajas_diferencia || 0),
      ids_ajustes: ids,
      ajustes: ids.length
    };
  }

  /**
   * Confirma el recuento de una familia: valida, comprueba concurrencia, aplica los
   * ajustes RECUENTO que hagan falta y guarda la fila de CUADRES.
   *
   * @param {Object} params
   * @param {string} params.id_cuadre
   * @param {string} params.familia
   * @param {Array<{articulo: string, envase: string, deberia: number, hay: number|null|string}>} params.lineas
   * @param {string} [usuario='SISTEMA']
   * @returns {Object}
   */
  confirmarFamilia(params, usuario = 'SISTEMA') {
    const opciones = params && typeof params === 'object' ? params : {};
    const idCuadre = String(opciones.id_cuadre || '').trim();
    const familia = String(opciones.familia || '').trim();
    const usuarioLimpio = String(usuario === null || usuario === undefined ? '' : usuario).trim() || 'SISTEMA';

    if (!idCuadre) throw new Error('Cuadre: falta id_cuadre.');
    if (!familia) throw new Error('Cuadre: falta la familia.');
    if (!Array.isArray(opciones.lineas) || opciones.lineas.length === 0) {
      throw new Error('Cuadre: la familia no tiene líneas para confirmar.');
    }

    // Idempotencia: si esta familia ya se confirmó con este id_cuadre, se devuelve lo guardado.
    const cuadres = _leerTablaCuadre_(this.repo, 'getCuadres');
    const yaConfirmado = cuadres.find(fila => (
      String(fila && fila.id_cuadre || '').trim() === idCuadre
      && _normalizarCuadre_(fila && fila.familia) === _normalizarCuadre_(familia)
    ));
    if (yaConfirmado) return this._respuestaGuardada_(yaConfirmado);

    // Validación previa completa: si una línea falla, no se aplica nada.
    const lineas = opciones.lineas.map((linea, indice) => {
      const articulo = String(linea && linea.articulo || '').trim();
      const envase = String(linea && linea.envase || '').trim();
      if (!articulo || !envase) {
        throw new Error(`Cuadre: la línea ${indice + 1} no tiene artículo o envase.`);
      }
      const deberia = _enteroCuadre_(linea && linea.deberia);
      if (deberia === null) {
        throw new Error(`Cuadre: «debería» de ${articulo} debe ser un entero ≥ 0.`);
      }
      const hayCrudo = linea ? linea.hay : null;
      const hayVacio = hayCrudo === null || hayCrudo === undefined || String(hayCrudo).trim() === '';
      const hay = hayVacio ? null : _enteroCuadre_(hayCrudo);
      if (!hayVacio && hay === null) {
        throw new Error(`Cuadre: «hay» de ${articulo} debe ser un entero ≥ 0.`);
      }
      return {
        articulo,
        envase,
        clave: _claveCuadre_(articulo, envase),
        deberia,
        hay,
        diferencia: hay === null ? 0 : hay - deberia
      };
    });

    // Concurrencia: si el stock actual no es el que se vio al abrir el cuadre, no se toca nada.
    const stock = new Map();
    for (const fila of _leerTablaCuadre_(this.repo, 'getStockActual')) {
      if (!fila) continue;
      const articulo = String(fila.codigo_articulo || '').trim();
      const envase = String(fila.codigo_envase || '').trim();
      if (!articulo || !envase) continue;
      const clave = fila.stock_key ? String(fila.stock_key).trim() : _claveCuadre_(articulo, envase);
      stock.set(clave, Number(fila.cajas_actuales || 0));
    }

    const cambiadas = lineas.filter(linea => Number(stock.get(linea.clave) || 0) !== linea.deberia);
    if (cambiadas.length > 0) {
      return {
        success: false,
        status: 'STOCK_CAMBIADO',
        id_cuadre: idCuadre,
        familia,
        lineas: lineas.map(linea => {
          const actual = Number(stock.get(linea.clave) || 0);
          return {
            articulo: linea.articulo,
            envase: linea.envase,
            deberia: linea.deberia,
            hay: linea.hay,
            actual,
            cambiado: actual !== linea.deberia
          };
        })
      };
    }

    const conDiferencia = lineas.filter(linea => linea.diferencia !== 0);
    const aplicados = [];
    const noAplicados = [];
    const idsAjustes = [];

    for (let i = 0; i < conDiferencia.length; i++) {
      const linea = conDiferencia[i];
      let resultado = null;
      try {
        resultado = this.movementService.registrarAjuste({
          codigo_articulo: linea.articulo,
          codigo_envase: linea.envase,
          cajas: Math.abs(linea.diferencia),
          signo: linea.diferencia > 0 ? 1 : -1,
          motivo: CUADRE_MOTIVO_,
          observaciones: `CUADRE:${idCuadre}`
        }, usuarioLimpio);
      } catch (err) {
        resultado = { success: false, message: err && err.message ? err.message : String(err) };
      }

      if (resultado && resultado.success === true && resultado.movimientoId) {
        idsAjustes.push(String(resultado.movimientoId));
        aplicados.push({
          articulo: linea.articulo,
          envase: linea.envase,
          diferencia: linea.diferencia,
          movimientoId: String(resultado.movimientoId)
        });
        continue;
      }

      const motivoFallo = resultado && (resultado.message || resultado.status)
        ? String(resultado.message || resultado.status)
        : 'No se pudo aplicar el ajuste.';
      for (let j = i; j < conDiferencia.length; j++) {
        noAplicados.push({
          articulo: conDiferencia[j].articulo,
          envase: conDiferencia[j].envase,
          diferencia: conDiferencia[j].diferencia,
          motivo: j === i ? motivoFallo : 'NO_INTENTADO'
        });
      }
      break;
    }

    if (noAplicados.length > 0) {
      return {
        success: false,
        status: 'PARCIAL',
        id_cuadre: idCuadre,
        familia,
        message: 'No se pudieron aplicar todos los ajustes del cuadre.',
        aplicados,
        no_aplicados: noAplicados
      };
    }

    const filaCuadre = {
      id_cuadre: idCuadre,
      familia,
      fecha_hora: this._ahora_().toISOString(),
      usuario: usuarioLimpio,
      lineas_contadas: lineas.length,
      lineas_con_diferencia: conDiferencia.length,
      cajas_diferencia: _sumaDiferenciasCuadre_(conDiferencia),
      ids_ajustes: idsAjustes.join(',')
    };

    try {
      if (typeof this.repo.appendCuadre !== 'function') {
        throw new Error('El repositorio no permite guardar en CUADRES.');
      }
      this.repo.appendCuadre(filaCuadre);
    } catch (err) {
      return {
        success: false,
        status: 'ERROR_GUARDADO',
        id_cuadre: idCuadre,
        familia,
        message: err && err.message ? err.message : String(err),
        aplicados,
        no_aplicados: [],
        ids_ajustes: idsAjustes
      };
    }

    return {
      success: true,
      status: 'CONFIRMADO',
      id_cuadre: idCuadre,
      familia,
      fecha_hora: filaCuadre.fecha_hora,
      usuario: usuarioLimpio,
      lineas_contadas: filaCuadre.lineas_contadas,
      lineas_con_diferencia: filaCuadre.lineas_con_diferencia,
      cajas_diferencia: filaCuadre.cajas_diferencia,
      ids_ajustes: idsAjustes,
      ajustes: idsAjustes.length,
      aplicados
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CuadreService
  };
}
