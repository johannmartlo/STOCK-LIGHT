/**
 * STOCK-LIGHT — CierreService.js (T-043)
 *
 * Cierre del día guiado: calcula el estado de los seis pasos de la noche a partir de
 * los datos existentes (importaciones, pendientes, cuadres, movimientos y reprocesos)
 * y guarda las marcas manuales en la hoja CIERRE_DIA.
 *
 * No crea movimientos de stock ni modifica el libro: solo lee y anota pasos.
 */

if (typeof require !== 'undefined') {
  try {
    const fechasMod = require('./Fechas');
    global.hoyMadrid = global.hoyMadrid || fechasMod.hoyMadrid;
    global.normalizarFechaNegocio = global.normalizarFechaNegocio || fechasMod.normalizarFechaNegocio;
  } catch (e) {}
  try {
    const normMod = require('./Normalizacion');
    global.normalizarNombre = global.normalizarNombre || normMod.normalizarNombre;
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
  try {
    const cuadreMod = require('./CuadreService');
    global.CuadreService = global.CuadreService || cuadreMod.CuadreService;
  } catch (e) {}
}

const CIERRE_PASOS_ = [
  { n: 1, clave: 'recepciones', titulo: 'Importar recepciones' },
  { n: 2, clave: 'ventas', titulo: 'Importar ventas' },
  { n: 3, clave: 'cambios', titulo: 'Cambios de confección y destrío del día' },
  { n: 4, clave: 'pendientes', titulo: 'Revisar pendientes' },
  { n: 5, clave: 'cuadre', titulo: 'Cuadre de la noche' },
  { n: 6, clave: 'parte', titulo: 'Enviar el parte' }
];

// Paso → estado que admite la marca manual. El resto son automáticos.
const CIERRE_MARCAS_MANUALES_ = {
  recepciones: 'SALTADO',
  cambios: 'HECHO',
  parte: 'HECHO'
};

const CIERRE_MOTIVOS_DESTRIO_ = new Set(['DESTRIO', 'DESTRÍO', 'MERMA', 'ROTURA', 'DETERIORO']);

/**
 * Normaliza un nombre como las claves de stock (D-003).
 * @param {*} texto
 * @returns {string}
 */
function _normalizarCierre_(texto) {
  const fn = typeof normalizarNombre === 'function'
    ? normalizarNombre
    : (typeof global !== 'undefined' && typeof global.normalizarNombre === 'function' ? global.normalizarNombre : null);
  if (typeof fn === 'function') return fn(texto);
  return String(texto === null || texto === undefined ? '' : texto).trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Fecha canónica YYYY-MM-DD en Europe/Madrid.
 * @param {*} valor
 * @returns {string}
 */
function _fechaCierre_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (valor instanceof Date) {
    try {
      const fn = typeof hoyMadrid === 'function' ? hoyMadrid : (global.hoyMadrid || null);
      if (typeof fn === 'function') return fn(valor);
    } catch (e) {}
    return '';
  }
  const texto = String(valor).trim();
  if (!texto) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  try {
    const fn = typeof normalizarFechaNegocio === 'function'
      ? normalizarFechaNegocio
      : (global.normalizarFechaNegocio || null);
    if (typeof fn === 'function') return fn(texto);
  } catch (e) {}
  return '';
}

/**
 * Hora HH:mm en Europe/Madrid. Devuelve '' si no se puede interpretar.
 * @param {*} valor
 * @returns {string}
 */
function _horaCierre_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(fecha.getTime())) return '';
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    return Utilities.formatDate(fecha, 'Europe/Madrid', 'HH:mm');
  }
  try {
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(fecha);
    const hora = (partes.find(p => p.type === 'hour') || {}).value || '';
    const minuto = (partes.find(p => p.type === 'minute') || {}).value || '';
    return hora && minuto ? `${hora}:${minuto}` : '';
  } catch (e) {
    return '';
  }
}

/**
 * Lee una tabla del repositorio sin romper si la hoja no existe.
 * @param {Object} repo
 * @param {string} metodo
 * @returns {Array<Object>}
 */
function _leerTablaCierre_(repo, metodo) {
  try {
    if (!repo || typeof repo[metodo] !== 'function') return [];
    const filas = repo[metodo]();
    return Array.isArray(filas) ? filas : [];
  } catch (e) {
    return [];
  }
}

class CierreService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.repository]
   * @param {Object} [options.movementService]
   * @param {Object} [options.catalogoService]
   * @param {Object} [options.cuadreService]
   * @param {Function|Date|string} [options.reloj]
   * @param {Function|Date|string} [options.clock]
   */
  constructor(options = {}) {
    const RepoClass = (typeof SheetsRepository !== 'undefined')
      ? SheetsRepository
      : (typeof require !== 'undefined' ? require('./Repository').SheetsRepository : null);
    if (!RepoClass && !options.repository) {
      throw new Error('SheetsRepository no está disponible en CierreService');
    }
    this.repo = options.repository || new RepoClass();

    const MovementClass = (typeof MovementService !== 'undefined')
      ? MovementService
      : (typeof require !== 'undefined' ? require('./MovementService').MovementService : null);
    this.movementService = options.movementService || (MovementClass
      ? new MovementClass({ repository: this.repo, lockService: options.lockService })
      : null);

    const CatalogoClass = (typeof CatalogoService !== 'undefined')
      ? CatalogoService
      : (typeof require !== 'undefined' ? require('./CatalogoService').CatalogoService : null);
    this.catalogoService = options.catalogoService || (CatalogoClass
      ? new CatalogoClass({
        repository: this.repo,
        config: options.configCatalogo || options.config || null
      })
      : null);

    const CuadreClass = (typeof CuadreService !== 'undefined')
      ? CuadreService
      : (typeof require !== 'undefined' ? require('./CuadreService').CuadreService : null);
    this.cuadreService = options.cuadreService !== undefined
      ? options.cuadreService
      : (CuadreClass && this.movementService
        ? new CuadreClass({
          repository: this.repo,
          movementService: this.movementService,
          catalogoService: this.catalogoService,
          reloj: options.reloj !== undefined ? options.reloj : options.clock
        })
        : null);

    this.reloj = options.reloj !== undefined ? options.reloj : options.clock;
  }

  /**
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
   * @returns {string}
   * @private
   */
  _hoy_() {
    const fn = typeof hoyMadrid === 'function' ? hoyMadrid : (global.hoyMadrid || null);
    if (typeof fn === 'function') return fn(this.reloj);
    return this._ahora_().toISOString().slice(0, 10);
  }

  /**
   * @param {*} fecha
   * @returns {string}
   * @private
   */
  _fechaPedida_(fecha) {
    const canonica = _fechaCierre_(fecha);
    return canonica || this._hoy_();
  }

  /**
   * Última marca manual de cada paso para una fecha.
   * @param {Array<Object>} filas
   * @param {string} fecha
   * @returns {Object}
   * @private
   */
  _marcasPorPaso_(filas, fecha) {
    const mapa = {};
    for (const fila of filas) {
      if (!fila) continue;
      if (_fechaCierre_(fila.fecha) !== fecha) continue;
      const paso = String(fila.paso || '').trim().toLowerCase();
      if (!paso) continue;
      mapa[paso] = fila;
    }
    return mapa;
  }

  /**
   * Estado de una importación del día (pasos 1 y 2).
   * @private
   */
  _pasoImportacion_(n, clave, titulo, tipoCsv, fecha, importaciones, marca) {
    const delDia = importaciones
      .filter(fila => fila && String(fila.estado || '').trim().toUpperCase() === 'CONFIRMADA')
      .filter(fila => String(fila.tipo_csv || '').trim().toUpperCase() === tipoCsv)
      .filter(fila => _fechaCierre_(fila.fecha_hora) === fecha);
    const ultima = delDia.reduce((elegida, fila) => {
      if (!elegida) return fila;
      return String(fila.fecha_hora || '') >= String(elegida.fecha_hora || '') ? fila : elegida;
    }, null);

    if (ultima) {
      const documentos = Number(ultima.documentos_nuevos || 0)
        + Number(ultima.documentos_saltados || 0)
        + Number(ultima.documentos_pendientes || 0)
        + Number(ultima.documentos_modificados || 0);
      return {
        n,
        clave,
        titulo,
        estado: 'HECHO',
        detalle: documentos > 0 ? `${documentos} documentos de ${tipoCsv === 'RECEPCIONES' ? 'recepciones' : 'ventas'} importados` : 'Importación confirmada hoy',
        hora: _horaCierre_(ultima.fecha_hora),
        usuario: String(ultima.usuario || '')
      };
    }

    if (marca && String(marca.estado || '').trim().toUpperCase() === 'SALTADO') {
      return {
        n,
        clave,
        titulo,
        estado: 'SALTADO',
        detalle: 'Hoy no hubo entradas',
        hora: String(marca.hora || ''),
        usuario: String(marca.usuario || '')
      };
    }

    return {
      n,
      clave,
      titulo,
      estado: 'PENDIENTE',
      detalle: tipoCsv === 'RECEPCIONES' ? 'Falta importar las recepciones de hoy' : 'Falta importar las ventas de hoy',
      hora: '',
      usuario: ''
    };
  }

  /**
   * Cuenta destríos y cambios de confección registrados hoy.
   * @private
   */
  _tareasDia_(fecha, movimientos, reprocesos) {
    const destrios = { apuntes: 0, cajas: 0, ultima_hora: '' };
    const cambios = { apuntes: 0, cajas: 0, ultima_hora: '' };
    let ultimaDestrioMs = 0;
    let ultimaCambioMs = 0;

    for (const movimiento of movimientos) {
      if (!movimiento) continue;
      const fechaMov = _fechaCierre_(movimiento.fecha_hora) || _fechaCierre_(movimiento.fecha_negocio);
      if (fechaMov !== fecha) continue;
      const tipo = String(movimiento.tipo_movimiento || '').trim().toUpperCase();
      const signo = Number(movimiento.signo || 0);
      const motivo = String(movimiento.motivo_ajuste || '').trim().toUpperCase();
      if (tipo !== 'AJUSTE' || signo !== -1 || !CIERRE_MOTIVOS_DESTRIO_.has(motivo)) continue;
      destrios.apuntes++;
      destrios.cajas += Math.abs(Number(movimiento.cajas || 0));
      const ms = Date.parse(String(movimiento.fecha_hora || movimiento.fecha_negocio || ''));
      const hora = _horaCierre_(movimiento.fecha_hora || movimiento.fecha_negocio);
      if (hora && (!ultimaDestrioMs || (Number.isFinite(ms) && ms >= ultimaDestrioMs))) {
        destrios.ultima_hora = hora;
        ultimaDestrioMs = Number.isFinite(ms) ? ms : ultimaDestrioMs;
      }
    }

    for (const reproceso of reprocesos) {
      if (!reproceso) continue;
      if (String(reproceso.estado || '').trim().toUpperCase() === 'ANULADO') continue;
      const fechaRep = _fechaCierre_(reproceso.fecha_hora) || _fechaCierre_(reproceso.fecha);
      if (fechaRep !== fecha) continue;
      cambios.apuntes++;
      cambios.cajas += Math.abs(Number(reproceso.total_retirado || 0));
      const ms = Date.parse(String(reproceso.fecha_hora || reproceso.fecha || ''));
      const hora = _horaCierre_(reproceso.fecha_hora || reproceso.fecha);
      if (hora && (!ultimaCambioMs || (Number.isFinite(ms) && ms >= ultimaCambioMs))) {
        cambios.ultima_hora = hora;
        ultimaCambioMs = Number.isFinite(ms) ? ms : ultimaCambioMs;
      }
    }

    return { destrios, cambios };
  }

  /**
   * Construye los albaranes en espera del paso 4.
   * @private
   */
  _albaranesEnEspera_(pendientes, stockRows) {
    const stock = new Map();
    for (const fila of stockRows) {
      if (!fila) continue;
      const articulo = String(fila.codigo_articulo || '').trim();
      const envase = String(fila.codigo_envase || '').trim();
      if (!articulo || !envase) continue;
      stock.set(`${_normalizarCierre_(articulo)}|${_normalizarCierre_(envase)}`, Number(fila.cajas_actuales || 0));
    }

    const grupos = new Map();
    for (const pendiente of pendientes) {
      if (!pendiente) continue;
      if (String(pendiente.estado || '').trim().toUpperCase() !== 'PENDIENTE') continue;
      if (String(pendiente.motivo || '').trim().toUpperCase() !== 'STOCK_INSUFICIENTE') continue;
      const tipo = String(pendiente.tipo_doc || '').trim().toUpperCase();
      const serie = String(pendiente.serie || '').trim();
      const numero = String(pendiente.numero || '').trim();
      const clave = [tipo, serie, numero].join('|');
      if (!grupos.has(clave)) {
        grupos.set(clave, {
          tipo_doc: tipo,
          serie,
          numero,
          entidad: String(pendiente.entidad || '').trim(),
          fecha_negocio: _fechaCierre_(pendiente.fecha_negocio),
          lineas: []
        });
      }
      grupos.get(clave).lineas.push({
        articulo: String(pendiente.articulo || '').trim(),
        envase: String(pendiente.envase || '').trim(),
        cajas: Math.abs(Number(pendiente.cajas || 0)),
        linea: pendiente.linea === null || pendiente.linea === undefined ? '' : pendiente.linea,
        motivo: String(pendiente.motivo || '').trim()
      });
    }

    const documentos = [];
    for (const documento of grupos.values()) {
      const necesitado = new Map();
      for (const linea of documento.lineas) {
        const clave = `${_normalizarCierre_(linea.articulo)}|${_normalizarCierre_(linea.envase)}`;
        if (!necesitado.has(clave)) {
          necesitado.set(clave, { articulo: linea.articulo, envase: linea.envase, cajas: 0 });
        }
        necesitado.get(clave).cajas += linea.cajas;
      }
      const faltantes = [];
      for (const [clave, item] of necesitado.entries()) {
        const disponible = Number(stock.get(clave) || 0);
        if (disponible < item.cajas) {
          faltantes.push({
            articulo: item.articulo,
            envase: item.envase,
            cajas: item.cajas,
            disponible,
            faltan: item.cajas - disponible
          });
        }
      }
      documentos.push({
        tipo_doc: documento.tipo_doc,
        serie: documento.serie,
        numero: documento.numero,
        entidad: documento.entidad,
        fecha_negocio: documento.fecha_negocio,
        lineas: documento.lineas,
        faltantes,
        espera_entera: true
      });
    }

    documentos.sort((a, b) => {
      const fechaA = String(a.fecha_negocio || '');
      const fechaB = String(b.fecha_negocio || '');
      if (fechaA !== fechaB) return fechaA < fechaB ? -1 : 1;
      const serieA = `${a.serie}/${a.numero}`;
      const serieB = `${b.serie}/${b.numero}`;
      return serieA.localeCompare(serieB);
    });

    return documentos;
  }

  /**
   * Devuelve el cierre de una fecha.
   *
  * @param {string|Date} [fecha] - YYYY-MM-DD; si falta, hoy en Europe/Madrid.
   * @param {Object} [datos] - Datos ya cargados por InicioService para no releer MOVIMIENTOS/REPROCESOS.
   * @returns {Object}
   */
  obtenerCierre(fecha, datos = {}) {
    const fechaCanonica = this._fechaPedida_(fecha);
    const datosPrevios = datos && typeof datos === 'object' ? datos : {};
    const importaciones = _leerTablaCierre_(this.repo, 'getImportaciones');
    const pendientes = _leerTablaCierre_(this.repo, 'getPendientes');
    const cuadres = _leerTablaCierre_(this.repo, 'getCuadres');
    const movimientos = Array.isArray(datosPrevios.movimientos)
      ? datosPrevios.movimientos
      : _leerTablaCierre_(this.repo, 'getMovimientos');
    const reprocesos = Array.isArray(datosPrevios.reprocesos)
      ? datosPrevios.reprocesos
      : _leerTablaCierre_(this.repo, 'getReprocesos');
    const stockRows = Array.isArray(datosPrevios.stockRows)
      ? datosPrevios.stockRows
      : _leerTablaCierre_(this.repo, 'getStockActual');
    const filasCierre = _leerTablaCierre_(this.repo, 'getCierreDia');
    const marcas = this._marcasPorPaso_(filasCierre, fechaCanonica);

    const tareasDia = this._tareasDia_(fechaCanonica, movimientos, reprocesos);
    const paso1 = this._pasoImportacion_(1, 'recepciones', CIERRE_PASOS_[0].titulo, 'RECEPCIONES', fechaCanonica, importaciones, marcas.recepciones);
    const paso2 = this._pasoImportacion_(2, 'ventas', CIERRE_PASOS_[1].titulo, 'VENTAS', fechaCanonica, importaciones, marcas.ventas);

    let paso3;
    if (marcas.cambios && String(marcas.cambios.estado || '').trim().toUpperCase() === 'HECHO') {
      paso3 = {
        n: 3,
        clave: 'cambios',
        titulo: CIERRE_PASOS_[2].titulo,
        estado: 'HECHO',
        detalle: 'Está todo apuntado',
        hora: String(marcas.cambios.hora || ''),
        usuario: String(marcas.cambios.usuario || '')
      };
    } else {
      const apuntes = tareasDia.destrios.apuntes + tareasDia.cambios.apuntes;
      paso3 = {
        n: 3,
        clave: 'cambios',
        titulo: CIERRE_PASOS_[2].titulo,
        estado: 'PENDIENTE',
        detalle: apuntes > 0
          ? `${tareasDia.destrios.apuntes} destríos y ${tareasDia.cambios.apuntes} cambios apuntados`
          : 'Sin destríos ni cambios apuntados hoy',
        hora: tareasDia.cambios.ultima_hora || tareasDia.destrios.ultima_hora || '',
        usuario: ''
      };
    }

    const pendientesAbiertos = pendientes.filter(fila => fila && String(fila.estado || '').trim().toUpperCase() === 'PENDIENTE');
    const albaranesEspera = this._albaranesEnEspera_(pendientes, stockRows);
    const movimientosHoy = movimientos.some(fila => fila && _fechaCierre_(fila.fecha_hora) === fechaCanonica);
    const cuadresHoy = cuadres.filter(fila => fila && _fechaCierre_(fila.fecha_hora) === fechaCanonica);
    const hayContextoPaso4 = pendientes.length > 0
      || filasCierre.some(fila => fila && _fechaCierre_(fila.fecha) === fechaCanonica)
      || paso1.estado !== 'PENDIENTE'
      || paso2.estado !== 'PENDIENTE'
      || paso3.estado !== 'PENDIENTE'
      || movimientosHoy
      || cuadresHoy.length > 0;
    const paso4 = {
      n: 4,
      clave: 'pendientes',
      titulo: CIERRE_PASOS_[3].titulo,
      estado: pendientesAbiertos.length === 0 && hayContextoPaso4 ? 'HECHO' : 'PENDIENTE',
      detalle: pendientesAbiertos.length > 0
        ? `${pendientesAbiertos.length} pendientes abiertos`
        : (hayContextoPaso4 ? 'Sin pendientes abiertos' : 'Pendiente de revisar'),
      hora: '',
      usuario: '',
      espera: albaranesEspera
    };

    let paso5;
    let familias = [];
    let errorCuadre = '';
    if (Array.isArray(datosPrevios.familias)) {
      familias = datosPrevios.familias.map(familia => ({
        familia: typeof familia === 'string' ? familia : String((familia && familia.familia) || '')
      }));
    } else {
      let cuadre = null;
      try {
        cuadre = this.cuadreService && typeof this.cuadreService.obtenerCuadre === 'function'
          ? this.cuadreService.obtenerCuadre({ movimientos, stockRows })
          : null;
        if (!cuadre) errorCuadre = 'El cuadre no está disponible.';
      } catch (err) {
        errorCuadre = err && err.message ? err.message : String(err);
      }
      familias = cuadre && Array.isArray(cuadre.familias) ? cuadre.familias : [];
    }

    const familiasCuadradas = new Set(cuadresHoy.map(fila => _normalizarCierre_(fila.familia)));
    const faltanFamilias = familias.filter(familia => !familiasCuadradas.has(_normalizarCierre_(familia.familia)));
    if (errorCuadre) {
      paso5 = {
        n: 5,
        clave: 'cuadre',
        titulo: CIERRE_PASOS_[4].titulo,
        estado: 'PENDIENTE',
        detalle: errorCuadre,
        hora: '',
        usuario: ''
      };
    } else if (familias.length === 0) {
      paso5 = {
        n: 5,
        clave: 'cuadre',
        titulo: CIERRE_PASOS_[4].titulo,
        estado: 'PENDIENTE',
        detalle: 'No hay familias que cuadrar',
        hora: '',
        usuario: ''
      };
    } else if (faltanFamilias.length === 0) {
      const ultimaCuadre = cuadresHoy[cuadresHoy.length - 1] || null;
      paso5 = {
        n: 5,
        clave: 'cuadre',
        titulo: CIERRE_PASOS_[4].titulo,
        estado: 'HECHO',
        detalle: `Cuadre completo · ${familias.length} familias`,
        hora: ultimaCuadre ? _horaCierre_(ultimaCuadre.fecha_hora) : '',
        usuario: ultimaCuadre ? String(ultimaCuadre.usuario || '') : ''
      };
    } else {
      paso5 = {
        n: 5,
        clave: 'cuadre',
        titulo: CIERRE_PASOS_[4].titulo,
        estado: 'PENDIENTE',
        detalle: `Faltan ${faltanFamilias.length} familias: ${faltanFamilias.slice(0, 3).map(fila => fila.familia).join(', ')}`,
        hora: '',
        usuario: ''
      };
    }

    let paso6;
    if (marcas.parte && String(marcas.parte.estado || '').trim().toUpperCase() === 'HECHO') {
      paso6 = {
        n: 6,
        clave: 'parte',
        titulo: CIERRE_PASOS_[5].titulo,
        estado: 'HECHO',
        detalle: 'Parte copiado o enviado',
        hora: String(marcas.parte.hora || ''),
        usuario: String(marcas.parte.usuario || '')
      };
    } else {
      paso6 = {
        n: 6,
        clave: 'parte',
        titulo: CIERRE_PASOS_[5].titulo,
        estado: 'PENDIENTE',
        detalle: 'Falta copiar o enviar el parte',
        hora: '',
        usuario: ''
      };
    }

    const pasos = [paso1, paso2, paso3, paso4, paso5, paso6];
    const avisos = [];
    if (paso5.estado !== 'HECHO' && (paso3.estado === 'PENDIENTE' || paso4.estado === 'PENDIENTE')) {
      const numeros = [];
      if (paso3.estado === 'PENDIENTE') numeros.push(3);
      if (paso4.estado === 'PENDIENTE') numeros.push(4);
      const aviso = `Antes de cuadrar faltan pasos: ${numeros.join(' y ')}. Si cuadras ahora, las diferencias saldrán falsas.`;
      avisos.push(aviso);
      paso5.aviso = aviso;
    }

    const hechos = pasos.filter(paso => paso.estado === 'HECHO' || paso.estado === 'SALTADO').length;
    const siguiente = pasos.find(paso => paso.estado === 'PENDIENTE');

    return {
      fecha: fechaCanonica,
      pasos,
      hechos,
      siguiente: siguiente ? siguiente.n : null,
      tareas_dia: tareasDia,
      avisos
    };
  }

  /**
   * Guarda una marca manual del cierre. Solo admite los pasos con marca manual y el 6.
   *
   * @param {string|Date} fecha
   * @param {string} clave
   * @param {string} estado
   * @param {string} [usuario]
   * @returns {Object}
   */
  marcarPaso(fecha, clave, estado, usuario = 'SISTEMA') {
    const claveLimpia = String(clave === null || clave === undefined ? '' : clave).trim().toLowerCase();
    const estadoLimpio = String(estado === null || estado === undefined ? '' : estado).trim().toUpperCase();
    const fechaCanonica = this._fechaPedida_(fecha);

    if (!Object.prototype.hasOwnProperty.call(CIERRE_MARCAS_MANUALES_, claveLimpia)) {
      throw new Error(`El paso '${claveLimpia || ''}' es automático y no se puede marcar a mano.`);
    }
    const estadoPermitido = CIERRE_MARCAS_MANUALES_[claveLimpia];
    if (estadoLimpio !== estadoPermitido) {
      throw new Error(`El paso '${claveLimpia}' solo admite el estado ${estadoPermitido}.`);
    }
    if (!this.repo || typeof this.repo.appendCierreDia !== 'function') {
      throw new Error('El repositorio no permite guardar en CIERRE_DIA.');
    }

    const ahora = this._ahora_();
    const fila = {
      fecha: fechaCanonica,
      paso: claveLimpia,
      estado: estadoLimpio,
      usuario: String(usuario === null || usuario === undefined ? '' : usuario).trim() || 'SISTEMA',
      hora: _horaCierre_(ahora),
      nota: ''
    };
    this.repo.appendCierreDia(fila);
    return {
      success: true,
      fecha: fila.fecha,
      paso: fila.paso,
      estado: fila.estado,
      usuario: fila.usuario,
      hora: fila.hora
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CierreService,
    CIERRE_PASOS_,
    CIERRE_MARCAS_MANUALES_
  };
}
