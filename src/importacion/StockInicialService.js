/**
 * STOCK-LIGHT — StockInicialService.js
 *
 * Carga del stock inicial desde CSV o desde la hoja STOCK_INICIAL_ENTRADA (T-011).
 *
 * Reglas:
 * - estados por fila: OK, NO_SEGUIDA, DESCONOCIDA, ERROR_DATOS;
 * - aviso NO_VISTA (no bloquea) si la combinación no está en CATALOGO;
 * - confirmación todo o nada: una copia PRE_STOCK_INICIAL, un lock y un _persistir;
 * - cada fila OK crea un AJUSTE +1 con motivo y origen STOCK_INICIAL.
 */

if (typeof require !== 'undefined') {
  const normMod = require('../Normalizacion');
  const fechasMod = require('../Fechas');
  const importSchemaMod = require('../ImportSchema');
  const segMod = require('../Seguridad');
  const idsMod = require('../Ids');

  global.normalizarNombre = global.normalizarNombre || normMod.normalizarNombre;
  global.parsearNumeroEs = global.parsearNumeroEs || normMod.parsearNumeroEs;
  global.hoyMadrid = global.hoyMadrid || fechasMod.hoyMadrid;
  global.parseCSV = global.parseCSV || importSchemaMod.parseCSV;
  global.normalizeHeaderName = global.normalizeHeaderName || importSchemaMod.normalizeHeaderName;
  global._sha256Hex_ = global._sha256Hex_ || segMod._sha256Hex_;
  global.nuevoId = global.nuevoId || idsMod.nuevoId;
}

const STOCK_INICIAL_CABECERA = ['Fecha', 'Proveedor', 'Articulo', 'Envase', 'Cajas'];
const STOCK_INICIAL_CABECERA_KG = ['Fecha', 'Proveedor', 'Articulo', 'Envase', 'Cajas', 'Kg'];
const STOCK_INICIAL_ESTADOS = Object.freeze({
  OK: 'OK',
  NO_SEGUIDA: 'NO_SEGUIDA',
  DESCONOCIDA: 'DESCONOCIDA',
  ERROR_DATOS: 'ERROR_DATOS'
});
const STOCK_INICIAL_HOJA = 'STOCK_INICIAL_ENTRADA';

/**
 * Normaliza el nombre de una columna o de un artículo/envase.
 * @param {*} texto
 * @returns {string}
 */
function _stockInicialNombre_(texto) {
  if (typeof normalizarNombre === 'function') return normalizarNombre(texto);
  return String(texto === null || texto === undefined ? '' : texto).trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Normaliza una cabecera para compararla sin depender de mayúsculas o tildes.
 * @param {*} texto
 * @returns {string}
 */
function _stockInicialCabecera_(texto) {
  if (typeof normalizeHeaderName === 'function') return normalizeHeaderName(String(texto || ''));
  return String(texto || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

/**
 * Convierte un valor en texto limpio.
 * @param {*} valor
 * @returns {string}
 */
function _stockInicialTexto_(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

/**
 * Indica si una fila de catálogo está activa.
 * @param {*} valor
 * @returns {boolean}
 */
function _stockInicialActivo_(valor) {
  if (valor === false || valor === 0) return false;
  const texto = _stockInicialTexto_(valor).toUpperCase();
  return texto !== 'FALSE' && texto !== 'NO' && texto !== '0';
}

class StockInicialService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.repository]
   * @param {Object} [options.movementService]
   * @param {Object} [options.catalogoService]
   * @param {Object} [options.pendientesService]
   * @param {Function} [options.crearCopiaSeguridad]
   * @param {Object} [options.backupOptions]
   * @param {Function} [options.clock] - Reloj inyectable.
   * @param {number} [options.timeoutMs]
   */
  constructor(options = {}) {
    const RepoClass = (typeof SheetsRepository !== 'undefined')
      ? SheetsRepository
      : (typeof require !== 'undefined' ? require('../Repository').SheetsRepository : null);
    const MovementClass = (typeof MovementService !== 'undefined')
      ? MovementService
      : (typeof require !== 'undefined' ? require('../MovementService').MovementService : null);
    const CatalogoClass = (typeof CatalogoService !== 'undefined')
      ? CatalogoService
      : (typeof require !== 'undefined' ? require('../CatalogoService').CatalogoService : null);

    this.repo = options.repository || (RepoClass ? new RepoClass(options.repositoryOptions || {}) : null);
    if (!this.repo) throw new Error('SheetsRepository no está disponible en StockInicialService.');

    this.movementService = options.movementService || (MovementClass
      ? new MovementClass({ repository: this.repo, lockService: options.lockService })
      : null);
    if (!this.movementService) throw new Error('MovementService no está disponible en StockInicialService.');

    this.catalogoService = options.catalogoService || (CatalogoClass
      ? new CatalogoClass({
        repository: this.repo,
        config: options.configCatalogo || options.config || null
      })
      : null);

    this.pendientesService = options.pendientesService || null;
    this.crearCopiaSeguridad = options.crearCopiaSeguridad || null;
    this.backupOptions = options.backupOptions || {};
    this.clock = options.clock || options.reloj || (() => new Date());
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30000;
    this.hashFn = options.hash || null;
    this.nuevoIdFn = options.nuevoId || null;
  }

  _ahora_() {
    const valor = typeof this.clock === 'function' ? this.clock() : this.clock;
    const fecha = valor instanceof Date ? valor : new Date(valor);
    return isNaN(fecha.getTime()) ? new Date() : fecha;
  }

  _hoy_() {
    const fn = typeof hoyMadrid === 'function' ? hoyMadrid : null;
    if (fn) return fn(this.clock);
    return this._ahora_().toISOString().slice(0, 10);
  }

  _nuevoId_(prefijo) {
    if (typeof this.nuevoIdFn === 'function') return this.nuevoIdFn(prefijo);
    if (this.movementService && typeof this.movementService._nuevoId === 'function') {
      return this.movementService._nuevoId(prefijo);
    }
    if (typeof nuevoId === 'function') return nuevoId(prefijo);
    if (typeof require !== 'undefined') return require('../Ids').nuevoId(prefijo);
    throw new Error('nuevoId no está disponible en StockInicialService.');
  }

  _hash_(texto) {
    if (typeof this.hashFn === 'function') return this.hashFn(texto);
    if (typeof _sha256Hex_ === 'function') return _sha256Hex_(texto);
    if (typeof require !== 'undefined') return require('../Seguridad')._sha256Hex_(texto);
    throw new Error('SHA-256 no está disponible en StockInicialService.');
  }

  /**
   * Parsea el texto CSV con la cabecera exacta.
   * @param {string} textoCsv
   * @returns {{ cabecera: Array<string>, filas: Array<Object> }}
   */
  parsear(textoCsv) {
    const parsearCsv = (typeof parseCSV === 'function')
      ? parseCSV
      : (typeof require !== 'undefined' ? require('../ImportSchema').parseCSV : null);
    if (typeof parsearCsv !== 'function') throw new Error('parseCSV no está disponible.');

    const matriz = parsearCsv(String(textoCsv === null || textoCsv === undefined ? '' : textoCsv), ';');
    if (!Array.isArray(matriz) || matriz.length === 0) {
      throw new Error('El CSV está vacío o no tiene cabecera.');
    }

    const cabecera = matriz[0].map((valor) => _stockInicialTexto_(valor));
    const cabeceraNorm = cabecera.map(_stockInicialCabecera_);
    const base = STOCK_INICIAL_CABECERA.map(_stockInicialCabecera_);
    const kg = _stockInicialCabecera_('Kg');
    const cabeceraValida = cabeceraNorm.length >= base.length
      && cabeceraNorm.length <= base.length + 1
      && base.every((nombre, indice) => cabeceraNorm[indice] === nombre)
      && (cabeceraNorm.length === base.length || cabeceraNorm[base.length] === kg);

    if (!cabeceraValida) {
      throw new Error('Cabecera no válida. Se esperaba Fecha;Proveedor;Articulo;Envase;Cajas[;Kg].');
    }

    const filas = [];
    for (let i = 1; i < matriz.length; i++) {
      const fila = matriz[i] || [];
      while (fila.length > cabecera.length && _stockInicialTexto_(fila[fila.length - 1]) === '') {
        fila.pop();
      }
      if (fila.every((valor) => _stockInicialTexto_(valor) === '')) continue;

      const columnasOk = fila.length === cabecera.length
        || (fila.length === cabecera.length - 1 && cabeceraNorm[cabecera.length - 1] === kg);
      const registro = { _linea: i + 1, _columnasOk: columnasOk };
      for (let j = 0; j < cabecera.length; j++) {
        registro[cabecera[j]] = fila[j] !== undefined ? fila[j] : '';
      }
      filas.push(registro);
    }

    return { cabecera, filas };
  }

  /**
   * Lee las filas de la hoja STOCK_INICIAL_ENTRADA.
   * @returns {Array<Object>}
   */
  leerFilasHoja() {
    const repo = this.repo;
    const ss = repo.getSpreadsheet();
    const hoja = ss.getSheetByName(STOCK_INICIAL_HOJA);
    if (!hoja) {
      throw new Error(
        `No existe la hoja ${STOCK_INICIAL_HOJA}. Ejecuta adminInstalarStockLight('Nombre') para crearla.`
      );
    }
    return repo.readTable(STOCK_INICIAL_HOJA);
  }

  _valor_(fila, nombre) {
    if (!fila || typeof fila !== 'object') return '';
    const objetivo = _stockInicialCabecera_(nombre);
    for (const clave of Object.keys(fila)) {
      if (_stockInicialCabecera_(clave) === objetivo) return fila[clave];
    }
    return '';
  }

  _normalizarEntrada_(filas) {
    if (typeof filas === 'string') {
      return this.parsear(filas).filas;
    }
    if (!Array.isArray(filas)) {
      throw new Error('Las filas deben ser un array de objetos o un texto CSV.');
    }

    return filas.map((fila, indice) => {
      if (Array.isArray(fila)) {
        const columnas = STOCK_INICIAL_CABECERA_KG;
        const columnasOk = fila.length === columnas.length || fila.length === columnas.length - 1;
        const objeto = { _linea: indice + 1, _columnasOk: columnasOk };
        for (let i = 0; i < columnas.length; i++) objeto[columnas[i]] = fila[i] !== undefined ? fila[i] : '';
        return objeto;
      }
      const linea = fila && (fila._linea !== undefined || fila.linea !== undefined)
        ? Number(fila._linea !== undefined ? fila._linea : fila.linea)
        : indice + 1;
      return {
        _linea: linea,
        _columnasOk: fila && fila._columnasOk !== undefined ? fila._columnasOk !== false : true,
        Fecha: this._valor_(fila, 'Fecha'),
        Proveedor: this._valor_(fila, 'Proveedor'),
        Articulo: this._valor_(fila, 'Articulo'),
        Envase: this._valor_(fila, 'Envase'),
        Cajas: this._valor_(fila, 'Cajas'),
        Kg: this._valor_(fila, 'Kg')
      };
    });
  }

  _textoHash_(valor) {
    if (valor instanceof Date) {
      const fn = typeof hoyMadrid === 'function' ? hoyMadrid : null;
      return fn ? fn(valor) : valor.toISOString().slice(0, 10);
    }
    return _stockInicialTexto_(valor);
  }

  _hashFilas_(filas) {
    const payload = filas.map((fila) => ([
      this._textoHash_(fila.Fecha),
      this._textoHash_(fila.Proveedor),
      this._textoHash_(fila.Articulo),
      this._textoHash_(fila.Envase),
      this._textoHash_(fila.Cajas),
      this._textoHash_(fila.Kg)
    ]));
    return this._hash_(JSON.stringify(payload));
  }

  _fechaCanonica_(valor) {
    if (valor instanceof Date) {
      if (isNaN(valor.getTime())) throw new Error('Fecha inválida');
      const fn = typeof hoyMadrid === 'function' ? hoyMadrid : null;
      return fn ? fn(valor) : valor.toISOString().slice(0, 10);
    }

    const texto = _stockInicialTexto_(valor);
    if (!texto) throw new Error('Fecha vacía');

    let anio;
    let mes;
    let dia;
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(texto);
    const barras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
    if (iso) {
      anio = Number(iso[1]); mes = Number(iso[2]); dia = Number(iso[3]);
    } else if (barras) {
      dia = Number(barras[1]); mes = Number(barras[2]); anio = Number(barras[3]);
    } else {
      throw new Error('Formato de fecha no válido');
    }

    if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || anio < 1900) {
      throw new Error('Fecha fuera de rango');
    }
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
      throw new Error('Fecha inexistente');
    }
    return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }

  _numero_(valor) {
    const fn = typeof parsearNumeroEs === 'function' ? parsearNumeroEs : null;
    if (fn) return fn(valor);
    const texto = _stockInicialTexto_(valor);
    if (!texto) return null;
    const numero = Number(texto.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(numero) ? numero : NaN;
  }

  _seguimiento_(articulo, envase) {
    if (!this.catalogoService || typeof this.catalogoService.esCombinacionSeguida !== 'function') {
      return 'PENDIENTE';
    }
    try {
      const estado = this.catalogoService.esCombinacionSeguida(articulo, envase);
      return String(estado || 'PENDIENTE').trim().toUpperCase();
    } catch (err) {
      return 'PENDIENTE';
    }
  }

  _estaEnCatalogo_(articulo, envase) {
    if (!this.catalogoService || typeof this.catalogoService.obtenerConfiguracion !== 'function') {
      return false;
    }
    let config;
    try {
      config = this.catalogoService.obtenerConfiguracion();
    } catch (err) {
      return false;
    }
    const filas = config && Array.isArray(config.catalogo) ? config.catalogo : [];
    const art = _stockInicialNombre_(articulo);
    const env = _stockInicialNombre_(envase);
    return filas.some((fila) => (
      _stockInicialActivo_(fila && fila.activo)
      && _stockInicialNombre_(fila && fila.articulo) === art
      && _stockInicialNombre_(fila && fila.envase) === env
    ));
  }

  _filaBase_(crudo, extras) {
    return Object.assign({
      linea: crudo.linea,
      fecha: _stockInicialTexto_(crudo.fechaRaw),
      proveedor: _stockInicialNombre_(crudo.proveedorRaw),
      articulo: _stockInicialNombre_(crudo.articuloRaw),
      envase: _stockInicialNombre_(crudo.envaseRaw),
      cajas: _stockInicialTexto_(crudo.cajasRaw),
      kg: _stockInicialTexto_(crudo.kgRaw),
      estado: STOCK_INICIAL_ESTADOS.ERROR_DATOS,
      motivo: '',
      aviso: ''
    }, extras || {});
  }

  _evaluarFila_(fila) {
    const crudo = {
      linea: fila._linea,
      fechaRaw: fila.Fecha,
      proveedorRaw: fila.Proveedor,
      articuloRaw: fila.Articulo,
      envaseRaw: fila.Envase,
      cajasRaw: fila.Cajas,
      kgRaw: fila.Kg
    };

    if (fila._columnasOk === false) {
      return this._filaBase_(crudo, { estado: STOCK_INICIAL_ESTADOS.ERROR_DATOS, motivo: 'COLUMNAS_INVALIDAS' });
    }

    const faltan = [];
    if (!_stockInicialTexto_(fila.Fecha)) faltan.push('Fecha');
    if (!_stockInicialTexto_(fila.Proveedor)) faltan.push('Proveedor');
    if (!_stockInicialTexto_(fila.Articulo)) faltan.push('Articulo');
    if (!_stockInicialTexto_(fila.Envase)) faltan.push('Envase');
    if (!_stockInicialTexto_(fila.Cajas)) faltan.push('Cajas');
    if (faltan.length > 0) {
      return this._filaBase_(crudo, {
        estado: STOCK_INICIAL_ESTADOS.ERROR_DATOS,
        motivo: 'CAMPO_VACIO',
        detalle: faltan.join(', ')
      });
    }

    const articulo = _stockInicialNombre_(fila.Articulo);
    const envase = _stockInicialNombre_(fila.Envase);
    const seguimiento = this._seguimiento_(articulo, envase);
    const aviso = this._estaEnCatalogo_(articulo, envase) ? '' : 'NO_VISTA';

    if (seguimiento === 'NO_SEGUIDA') {
      return this._filaBase_(crudo, {
        estado: STOCK_INICIAL_ESTADOS.NO_SEGUIDA,
        motivo: 'SEGUIMIENTO_NO',
        aviso
      });
    }
    if (seguimiento !== 'SEGUIDA') {
      return this._filaBase_(crudo, {
        estado: STOCK_INICIAL_ESTADOS.DESCONOCIDA,
        motivo: 'SEGUIMIENTO_DESCONOCIDO',
        aviso
      });
    }

    let fecha;
    try {
      fecha = this._fechaCanonica_(fila.Fecha);
    } catch (err) {
      return this._filaBase_(crudo, { estado: STOCK_INICIAL_ESTADOS.ERROR_DATOS, motivo: 'FECHA_INVALIDA' });
    }
    if (fecha > this._hoy_()) {
      return this._filaBase_(crudo, { estado: STOCK_INICIAL_ESTADOS.ERROR_DATOS, motivo: 'FECHA_FUTURA' });
    }

    const cajas = this._numero_(fila.Cajas);
    if (cajas === null || Number.isNaN(cajas) || !Number.isInteger(cajas) || cajas <= 0) {
      return this._filaBase_(crudo, { estado: STOCK_INICIAL_ESTADOS.ERROR_DATOS, motivo: 'CAJAS_INVALIDAS' });
    }

    let kg = '';
    if (_stockInicialTexto_(fila.Kg) !== '') {
      kg = this._numero_(fila.Kg);
      if (kg === null || Number.isNaN(kg) || kg < 0) {
        return this._filaBase_(crudo, { estado: STOCK_INICIAL_ESTADOS.ERROR_DATOS, motivo: 'KG_INVALIDO' });
      }
    }

    return this._filaBase_(crudo, {
      fecha,
      articulo,
      envase,
      cajas,
      kg,
      estado: STOCK_INICIAL_ESTADOS.OK,
      motivo: '',
      aviso
    });
  }

  _previsualizacionVacia_(error) {
    return {
      status: 'ERROR_ENTRADA',
      error,
      filas: [],
      totales: { porArticuloEnvase: [], porProveedor: [], general: { cajas: 0, filas: 0 } },
      hash: '',
      bloquea: true,
      bloqueos: 0,
      avisos: 0
    };
  }

  /**
   * Previsualiza las filas sin escribir nada.
   * @param {Array<Object>|string} filas
   * @returns {Object}
   */
  previsualizar(filas) {
    let normalizadas;
    try {
      normalizadas = this._normalizarEntrada_(filas);
    } catch (err) {
      return this._previsualizacionVacia_(err.message);
    }

    const hash = this._hashFilas_(normalizadas);
    const resultados = normalizadas.map((fila) => this._evaluarFila_(fila));

    const porArticulo = new Map();
    const porProveedor = new Map();
    const general = { cajas: 0, filas: 0 };
    let bloqueos = 0;
    let avisos = 0;

    for (const fila of resultados) {
      if (fila.aviso === 'NO_VISTA') avisos++;
      if (fila.estado === STOCK_INICIAL_ESTADOS.ERROR_DATOS || fila.estado === STOCK_INICIAL_ESTADOS.DESCONOCIDA) {
        bloqueos++;
        continue;
      }
      if (fila.estado !== STOCK_INICIAL_ESTADOS.OK) continue;

      general.cajas += Number(fila.cajas);
      general.filas++;

      const claveArticulo = `${fila.articulo}|${fila.envase}`;
      if (!porArticulo.has(claveArticulo)) {
        porArticulo.set(claveArticulo, { articulo: fila.articulo, envase: fila.envase, cajas: 0 });
      }
      porArticulo.get(claveArticulo).cajas += Number(fila.cajas);

      if (!porProveedor.has(fila.proveedor)) {
        porProveedor.set(fila.proveedor, { proveedor: fila.proveedor, cajas: 0 });
      }
      porProveedor.get(fila.proveedor).cajas += Number(fila.cajas);
    }

    return {
      status: 'OK',
      error: '',
      filas: resultados,
      totales: {
        porArticuloEnvase: Array.from(porArticulo.values()),
        porProveedor: Array.from(porProveedor.values()),
        general
      },
      hash,
      bloquea: bloqueos > 0,
      bloqueos,
      avisos
    };
  }

  _crearCopia_() {
    const fn = this.crearCopiaSeguridad
      || (typeof crearCopiaSeguridad_ === 'function' ? crearCopiaSeguridad_ : null)
      || (typeof require !== 'undefined' ? require('../BackupService').crearCopiaSeguridad_ : null);
    if (typeof fn !== 'function') {
      throw new Error('No está disponible crearCopiaSeguridad_ para la copia previa.');
    }

    const opciones = Object.assign({}, this.backupOptions);
    if (!opciones.spreadsheet && this.repo && typeof this.repo.getSpreadsheet === 'function') {
      try {
        opciones.spreadsheet = this.repo.getSpreadsheet();
      } catch (err) {
        // Sin hoja inyectada, crearCopiaSeguridad_ intentará resolverla por configuración.
      }
    }
    return fn('PRE_STOCK_INICIAL', opciones);
  }

  _resolverPendientes_() {
    if (this.pendientesService) return this.pendientesService;
    const Svc = (typeof PendientesService !== 'undefined')
      ? PendientesService
      : (typeof require !== 'undefined' ? require('./PendientesService').PendientesService : null);
    if (!Svc) return null;
    this.pendientesService = new Svc({
      repository: this.repo,
      movementService: this.movementService,
      catalogoService: this.catalogoService,
      lockService: this.movementService.lock
    });
    return this.pendientesService;
  }

  _movimiento_(fila, usuario, hash) {
    return {
      id_movimiento: this._nuevoId_('MOV'),
      fecha_hora: this._ahora_().toISOString(),
      tipo_movimiento: 'AJUSTE',
      id_documento_ref: 'STOCK_INICIAL',
      codigo_articulo: fila.articulo,
      codigo_envase: fila.envase,
      cajas: Number(fila.cajas),
      signo: 1,
      partida_origen: '',
      motivo_ajuste: 'STOCK_INICIAL',
      usuario: usuario || 'SISTEMA',
      observaciones: `Carga de stock inicial (hash ${hash})`,
      estado: 'CONFIRMADO',
      fecha_negocio: fila.fecha,
      entidad_nombre: fila.proveedor,
      secuencia: '',
      origen_dato: 'STOCK_INICIAL',
      kg_informativo: fila.kg === '' || fila.kg === null || fila.kg === undefined ? '' : Number(fila.kg),
      id_movimiento_ref: '',
      id_capa_objetivo: '',
      id_capa_creada: this._nuevoId_('CAPA')
    };
  }

  _registrarLog_(usuario, hash, movimientos, cajas, filas) {
    const repo = this.repo;
    if (!repo || typeof repo.appendLogOperaciones !== 'function') return false;
    const registro = {
      id_log: this._nuevoId_('LOG'),
      fecha_hora: this._ahora_().toISOString(),
      usuario: usuario || 'SISTEMA',
      operacion: 'STOCK_INICIAL',
      codigo_articulo: '',
      nombre_articulo: '',
      codigo_envase: '',
      descripcion_envase: '',
      cantidad_cajas: cajas,
      origen: 'STOCK_INICIAL',
      destino: '',
      motivo: 'STOCK_INICIAL',
      referencia: hash,
      estado: 'CORRECTA',
      observaciones: JSON.stringify({
        hash,
        filas,
        cajas,
        movimientos
      })
    };
    repo.appendLogOperaciones([registro]);
    return true;
  }

  /**
   * Confirma la carga: valida hash y bloqueos, crea la copia previa y aplica
   * todos los AJUSTES en un solo lock y un solo _persistir.
   *
   * @param {Array<Object>|string} filas
   * @param {string} hash
   * @param {string} [usuario]
   * @param {Object} [opciones]
   * @param {boolean} [opciones.anadir]
   * @returns {Object}
   */
  confirmar(filas, hash, usuario = 'SISTEMA', opciones = {}) {
    const preview = this.previsualizar(filas);
    if (preview.status !== 'OK') {
      return { success: false, status: 'ENTRADA_INVALIDA', error: preview.error };
    }

    const hashRecibido = _stockInicialTexto_(hash).toLowerCase();
    if (hashRecibido !== String(preview.hash || '').toLowerCase()) {
      return {
        success: false,
        status: 'HASH_NO_COINCIDE',
        hashCalculado: preview.hash,
        hashEsperado: hashRecibido
      };
    }

    if (preview.bloquea) {
      return {
        success: false,
        status: 'BLOQUEADA',
        error: 'Hay filas DESCONOCIDA o ERROR_DATOS: corrige el CSV/hoja antes de confirmar.',
        bloqueos: preview.filas.filter((fila) => (
          fila.estado === STOCK_INICIAL_ESTADOS.DESCONOCIDA || fila.estado === STOCK_INICIAL_ESTADOS.ERROR_DATOS
        ))
      };
    }

    const filasOk = preview.filas.filter((fila) => fila.estado === STOCK_INICIAL_ESTADOS.OK);
    if (filasOk.length === 0) {
      return { success: false, status: 'SIN_FILAS_OK', error: 'No hay ninguna fila OK que cargar.' };
    }

    const anadir = opciones && opciones.anadir === true;
    const totalCajas = filasOk.reduce((total, fila) => total + Number(fila.cajas), 0);
    let copia = null;
    let movimientosCreados = [];
    let logRegistrado = false;
    let avisoLog = '';

    this.movementService._acquireLock(this.timeoutMs);
    try {
      const cargado = this.movementService._cargarEstado();
      let estado = cargado.estado;
      const movimientosExistentes = cargado.movimientos || [];

      const confirmados = movimientosExistentes.filter(
        (mov) => String(mov && mov.estado || '').trim().toUpperCase() === 'CONFIRMADO'
      );
      if (!anadir && confirmados.length > 0) {
        return {
          success: false,
          status: 'YA_HAY_MOVIMIENTOS',
          error: 'Ya hay movimientos confirmados en MOVIMIENTOS. Usa anadir: true solo si la carga es intencionada.',
          movimientosExistentes: confirmados.length
        };
      }

      try {
        copia = this._crearCopia_();
      } catch (err) {
        return { success: false, status: 'COPIA_FALLIDA', error: err.message };
      }
      if (!copia || !copia.id) {
        return {
          success: false,
          status: 'COPIA_FALLIDA',
          error: 'La copia PRE_STOCK_INICIAL no devolvió un identificador; no se carga nada.'
        };
      }

      const movimientos = [];
      for (const fila of filasOk) {
        const movimiento = this._movimiento_(fila, usuario, preview.hash);
        const res = this.movementService._aplicar(estado, movimiento);
        if (!res || !res.ok) {
          return {
            success: false,
            status: 'ERROR_APLICACION',
            error: (res && res.error) || `No se pudo aplicar la fila ${fila.linea}.`,
            fila: fila.linea
          };
        }
        estado = res.estado;
        movimientos.push(movimiento);
      }

      this.movementService._persistir({
        movimientos,
        movimientosExistentes,
        estado
      });
      movimientosCreados = movimientos;

      try {
        logRegistrado = this._registrarLog_(usuario, preview.hash, movimientos.length, totalCajas, movimientos.length);
      } catch (err) {
        avisoLog = `El stock se cargó, pero no se pudo registrar en LOG_OPERACIONES: ${err.message}`;
      }
    } finally {
      this.movementService._releaseLock();
    }

    let reintentoPendientes = null;
    let avisoPendientes = '';
    try {
      const pendientes = this._resolverPendientes_();
      if (pendientes && typeof pendientes.reintentarPendientes === 'function') {
        reintentoPendientes = pendientes.reintentarPendientes(usuario || 'SISTEMA');
      }
    } catch (err) {
      avisoPendientes = `El stock se cargó, pero falló el reintento de pendientes: ${err.message}`;
    }

    return {
      success: true,
      status: 'CONFIRMADO',
      hash: preview.hash,
      filasCargadas: movimientosCreados.length,
      filasSaltadas: preview.filas.filter((fila) => fila.estado === STOCK_INICIAL_ESTADOS.NO_SEGUIDA).length,
      filasNoVistas: preview.filas.filter((fila) => fila.aviso === 'NO_VISTA').length,
      cajasCargadas: totalCajas,
      movimientos: movimientosCreados.map((mov) => mov.id_movimiento),
      copia,
      logRegistrado,
      avisoLog,
      reintentoPendientes,
      avisoPendientes,
      avisoVueltaAtras: 'No hay anulación de la carga. Si es incorrecta, restaura la copia PRE_STOCK_INICIAL con docs/RESTAURAR_COPIA.md.'
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    StockInicialService,
    STOCK_INICIAL_CABECERA,
    STOCK_INICIAL_CABECERA_KG,
    STOCK_INICIAL_ESTADOS,
    STOCK_INICIAL_HOJA
  };
}
