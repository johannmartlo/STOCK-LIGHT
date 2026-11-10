/**
 * STOCK-LIGHT — Seguridad.js
 *
 * Superficie del servidor (T-023) y acceso por enlace personal + PIN (T-020, D-032).
 *
 * Apps Script expone con google.script.run TODA función global cuyo nombre no
 * termine en "_". Las funciones de administración del editor se protegen
 * comprobando que quien ejecuta es el propietario del script.
 *
 * Las funciones api* de LECTURA o ESCRITURA se protegen con exigirSesionApi_():
 * solo funcionan dentro del contexto que fija apiLlamar(). El contexto se
 * establece después de validar la sesión y el rol, y se limpia en un finally.
 *
 * La lógica de credenciales y sesiones es pura y recibe por inyección el
 * repositorio, el reloj, la fuente de aleatoriedad y el almacenamiento de
 * sesiones, para poder probarla en Node sin Google Apps Script.
 */

// Importaciones condicionales para Node.js / Testing.
if (typeof require !== 'undefined') {
  try {
    const idsMod = require('./Ids');
    global.nuevoId = global.nuevoId || idsMod.nuevoId;
  } catch (e) {}
}

/** Roles de la aplicación, de menor a mayor privilegio (D-032). */
const ROLES_USUARIO = {
  CONSULTA: 1,
  ENCARGADO: 2,
  ADMIN: 3
};

/**
 * Permisos de las funciones que pueden llamarse a través de apiLlamar.
 * El valor es el rol mínimo. Esta tabla es la única autoridad de permisos:
 * un nombre que no aparezca aquí se rechaza aunque exista como función global.
 */
const PERMISOS_API = {
  // LECTURA — CONSULTA
  apiObtenerStockActual: 'CONSULTA',
  apiObtenerResumenPorGrupos: 'CONSULTA',
  apiObtenerStockPorGrupo: 'CONSULTA',
  apiObtenerDetalleGrupo: 'CONSULTA',
  apiObtenerDetalleStock: 'CONSULTA',
  apiObtenerStockVisualResumen: 'CONSULTA',
  apiObtenerStockVisualDetalle: 'CONSULTA',
  apiClasificarArticuloEnvase: 'CONSULTA',
  apiObtenerCombinacionesPendientesAsociacion: 'CONSULTA',
  apiObtenerDetallePartidas: 'CONSULTA',
  apiGetConfiguracionCatalogo: 'CONSULTA',
  apiClasificarCombinacion: 'CONSULTA',
  apiValidarDocumento: 'CONSULTA',
  apiPrevisualizarDocumento: 'CONSULTA',
  apiObtenerLogOperaciones: 'CONSULTA',
  apiPrevisualizarCorreccionHistorica: 'CONSULTA',
  apiGetMaestroArticulos: 'CONSULTA',
  apiGetMaestroEnvases: 'CONSULTA',
  apiSubirYAnalizarPdf: 'CONSULTA',
  apiGetGruposComerciales: 'CONSULTA',
  apiGetMatrizArticuloEnvase: 'CONSULTA',

  // LECTURA de usuarios — ADMIN
  apiListarUsuarios: 'ADMIN',

  // ESCRITURA — ENCARGADO
  confirmarDocumentoRevisado: 'ENCARGADO',
  confirmarCompraPendiente: 'ENCARGADO',
  apiRegistrarAjustePositivo: 'ENCARGADO',
  apiRegistrarAjusteNegativo: 'ENCARGADO',
  apiRegistrarReclasificacion: 'ENCARGADO',
  apiProcesarEntradaDocumento: 'ENCARGADO',
  apiProcesarSalidaDocumento: 'ENCARGADO',
  apiEjecutarAjusteOperativo: 'ENCARGADO',
  apiEjecutarCorreccionHistorica: 'ENCARGADO',
  apiAnularEntrada: 'ENCARGADO',
  apiAnularSalida: 'ENCARGADO',
  apiCorregirEntrada: 'ENCARGADO',
  apiCorregirSalida: 'ENCARGADO',
  apiDividirEntrada: 'ENCARGADO',
  apiConfirmarDocumentoRevisado: 'ENCARGADO',
  apiUpsertGrupoComercial: 'ENCARGADO',
  apiUpsertMatrizArticuloEnvase: 'ENCARGADO',

  // ESCRITURA de configuración y usuarios — ADMIN
  apiUpsertReglaClasificacion: 'ADMIN',
  apiUpsertExcepcionCatalogo: 'ADMIN',
  apiCrearUsuario: 'ADMIN',
  apiRegenerarEnlace: 'ADMIN',
  apiDesactivarUsuario: 'ADMIN',

  // ENTRADA — cualquier sesión válida
  apiSalir: 'CONSULTA'
};

// ---------------------------------------------------------------------------
// Contexto de usuario de la ejecución
// ---------------------------------------------------------------------------

let _contextoUsuarioActual_ = null;

/**
 * Exige que la ejecución tenga un contexto de usuario fijado por apiLlamar().
 * Lanza exactamente 'Acceso no autorizado' cuando no lo hay, es decir, cuando
 * se ha llamado directamente desde el navegador sin pasar por el despachador.
 */
function exigirSesionApi_() {
  if (!_contextoUsuarioActual_ || !_contextoUsuarioActual_.rol) {
    throw new Error('Acceso no autorizado');
  }
}

/**
 * Ejecuta una función dentro de un contexto de usuario (INTERNA).
 * La usa apiLlamar después de validar la sesión y el rol.
 *
 * @param {string|null} usuario - Nombre del usuario; null para usar el email de Session.
 * @param {string} rol - CONSULTA | ENCARGADO | ADMIN
 * @param {Function} fn - Función que se ejecuta dentro del contexto.
 * @returns {*} Resultado de fn.
 */
function ejecutarConContexto_(usuario, rol, fn) {
  const anterior = _contextoUsuarioActual_;
  _contextoUsuarioActual_ = {
    id_usuario: null,
    nombre: usuario === null || usuario === undefined ? null : String(usuario),
    rol: String(rol || 'ADMIN').toUpperCase()
  };
  try {
    return fn();
  } finally {
    _contextoUsuarioActual_ = anterior;
  }
}

/**
 * Fija un contexto de usuario para pruebas automatizadas (INTERNA).
 * No se expone al navegador porque termina en "_".
 *
 * @param {string|null} usuario - Nombre del usuario, o null para usar el email de Session.
 * @param {string} rol - CONSULTA | ENCARGADO | ADMIN
 * @param {Function} fn - Función que se ejecuta dentro del contexto.
 * @returns {*} Resultado de fn.
 */
function conContextoDePrueba_(usuario, rol, fn) {
  return ejecutarConContexto_(usuario, rol, fn);
}

/**
 * Indica si un rol alcanza el mínimo exigido.
 *
 * @param {string} rolUsuario
 * @param {string} rolMinimo
 * @returns {boolean}
 */
function rolAlcanza_(rolUsuario, rolMinimo) {
  const claveUsuario = String(rolUsuario || '').trim().toUpperCase();
  const claveMinimo = String(rolMinimo || '').trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(ROLES_USUARIO, claveUsuario)) return false;
  if (!Object.prototype.hasOwnProperty.call(ROLES_USUARIO, claveMinimo)) return false;
  return ROLES_USUARIO[claveUsuario] >= ROLES_USUARIO[claveMinimo];
}

/**
 * Lee el email de un usuario de Session de forma defensiva.
 * Devuelve '' si Session, el método o el email no están disponibles.
 *
 * @param {Object|null} session
 * @param {string} metodo - 'getActiveUser' | 'getEffectiveUser'
 * @returns {string}
 */
function _emailSesion_(session, metodo) {
  try {
    if (!session || typeof session[metodo] !== 'function') return '';
    const usuario = session[metodo]();
    if (!usuario || typeof usuario.getEmail !== 'function') return '';
    return String(usuario.getEmail() || '').trim();
  } catch (e) {
    return '';
  }
}

/**
 * Exige que quien ejecuta sea el propietario del script.
 * Lanza exactamente 'Operación reservada al administrador' en cualquier otro caso.
 *
 * @param {Object} [session] - Session inyectable (por defecto, Session global)
 */
function exigirPropietario_(session) {
  const ses = session || (typeof Session !== 'undefined' ? Session : null);
  const activo = _emailSesion_(ses, 'getActiveUser');
  const efectivo = _emailSesion_(ses, 'getEffectiveUser');
  if (!activo || !efectivo || activo.toLowerCase() !== efectivo.toLowerCase()) {
    throw new Error('Operación reservada al administrador');
  }
}

/**
 * Devuelve el nombre del usuario del contexto (T-020), el email del usuario
 * activo de Session o 'SIN_IDENTIFICAR'. El servidor usa SIEMPRE este valor
 * para la auditoría; nunca el que envía el navegador.
 *
 * @param {Object} [session] - Session inyectable (por defecto, Session global)
 * @returns {string}
 */
function usuarioActual_(session) {
  if (_contextoUsuarioActual_ && _contextoUsuarioActual_.nombre) {
    return String(_contextoUsuarioActual_.nombre);
  }
  const ses = session || (typeof Session !== 'undefined' ? Session : null);
  return _emailSesion_(ses, 'getActiveUser') || 'SIN_IDENTIFICAR';
}

// ---------------------------------------------------------------------------
// Criptografía, aleatoriedad y entorno
// ---------------------------------------------------------------------------

/**
 * Calcula SHA-256 de un texto y devuelve el hash en hexadecimal minúsculas.
 *
 * @param {string} texto
 * @returns {string}
 */
function _sha256Hex_(texto) {
  const valor = String(texto === null || texto === undefined ? '' : texto);

  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.computeDigest === 'function') {
    const charset = (Utilities.Charset && Utilities.Charset.UTF_8) ? Utilities.Charset.UTF_8 : 'UTF-8';
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, valor, charset);
    return bytes.map(function (b) {
      const normalizado = b < 0 ? b + 256 : b;
      return normalizado.toString(16).padStart(2, '0');
    }).join('');
  }

  if (typeof require !== 'undefined') {
    return require('crypto').createHash('sha256').update(valor, 'utf8').digest('hex');
  }

  throw new Error('No hay un generador SHA-256 disponible en este entorno.');
}

/**
 * Comparación de hashes en tiempo constante.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function _hashesIguales_(a, b) {
  const uno = String(a || '');
  const dos = String(b || '');
  if (uno.length !== dos.length) return false;
  let diferencia = 0;
  for (let i = 0; i < uno.length; i++) {
    diferencia |= uno.charCodeAt(i) ^ dos.charCodeAt(i);
  }
  return diferencia === 0;
}

/**
 * Genera un UUID con el generador disponible (Utilities, crypto o Node).
 *
 * @returns {string}
 */
function _uuidSeguro_() {
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.getUuid === 'function') {
    return String(Utilities.getUuid());
  }
  if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
    return String(crypto.randomUUID());
  }
  if (typeof require !== 'undefined') {
    return String(require('crypto').randomUUID());
  }
  throw new Error('No se encontró un generador de UUID válido.');
}

/**
 * Genera un valor aleatorio hexadecimal a partir de UUIDs.
 *
 * @param {Function} generador - Función que devuelve un UUID.
 * @param {number} [vueltas=2]
 * @returns {string}
 */
function _aleatorioHex_(generador, vueltas) {
  const total = Math.max(1, Number(vueltas) || 1);
  let salida = '';
  for (let i = 0; i < total; i++) {
    salida += String(generador()).replace(/-/g, '');
  }
  return salida.toLowerCase();
}

/**
 * Reloj por defecto.
 *
 * @returns {Date}
 */
function _relojPredeterminado_() {
  return new Date();
}

/**
 * Resuelve el repositorio por defecto (SheetsRepository).
 *
 * @returns {Object}
 */
function _repositorioPredeterminado_() {
  if (typeof SheetsRepository !== 'undefined' && typeof SheetsRepository === 'function') {
    return new SheetsRepository();
  }
  if (typeof require !== 'undefined') {
    const modulo = require('./Repository');
    return new modulo.SheetsRepository();
  }
  throw new Error('SheetsRepository no está disponible en este entorno.');
}

/**
 * Resuelve el almacenamiento de sesiones por defecto (CacheService).
 *
 * @returns {Object|null}
 */
function _cachePredeterminado_() {
  try {
    if (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function') {
      return CacheService.getScriptCache();
    }
  } catch (e) {}
  return null;
}

/**
 * Resuelve el bloqueo por defecto (LockService).
 *
 * @returns {Object|null}
 */
function _lockPredeterminado_() {
  try {
    if (typeof LockService !== 'undefined' && LockService && typeof LockService.getScriptLock === 'function') {
      return LockService.getScriptLock();
    }
  } catch (e) {}
  return null;
}

/**
 * Obtiene la URL de la implementación desde ScriptApp, si está disponible.
 *
 * @returns {string}
 */
function _urlImplementacionPredeterminada_() {
  try {
    if (typeof ScriptApp !== 'undefined' && ScriptApp && typeof ScriptApp.getService === 'function') {
      const servicio = ScriptApp.getService();
      if (servicio && typeof servicio.getUrl === 'function') {
        return String(servicio.getUrl() || '');
      }
    }
  } catch (e) {}
  return '';
}

// ---------------------------------------------------------------------------
// Servicio de acceso
// ---------------------------------------------------------------------------

/**
 * Servicio de credenciales, sesiones y usuarios (D-032).
 *
 * Dependencias inyectables:
 * - repository: SheetsRepository (o compatible).
 * - cache: CacheService.getScriptCache() (get/put/remove).
 * - clock: función que devuelve Date.
 * - random: función que devuelve un UUID.
 * - lock: LockService.getScriptLock() (waitLock/releaseLock).
 * - urlImplementacion: string o función que devuelve la URL base.
 */
class ServicioAcceso {
  constructor(options = {}) {
    this.repository = options.repository || options.repositorio || _repositorioPredeterminado_();
    const almacenamiento = options.cache !== undefined ? options.cache : options.almacenamiento;
    this.cache = almacenamiento !== undefined ? almacenamiento : _cachePredeterminado_();
    this.clock = options.clock || options.reloj || _relojPredeterminado_;
    this.random = options.random || options.aleatoriedad || _uuidSeguro_;
    const bloqueo = options.lock !== undefined ? options.lock : options.lockService;
    this.lock = bloqueo !== undefined ? bloqueo : _lockPredeterminado_();
    this.urlImplementacion = options.urlImplementacion !== undefined
      ? options.urlImplementacion
      : _urlImplementacionPredeterminada_;
    this.prefijoCache = options.prefijoCache || 'SL_SESION_';
    const ttl = options.sessionTtlSeconds !== undefined ? options.sessionTtlSeconds : options.duracionSesionSegundos;
    this.sessionTtlSeconds = Number(ttl) > 0 ? Number(ttl) : 6 * 60 * 60;
    this.intentosMaximos = Number(options.intentosMaximos) > 0 ? Number(options.intentosMaximos) : 5;
    this.bloqueoMinutos = Number(options.bloqueoMinutos) > 0 ? Number(options.bloqueoMinutos) : 15;
  }

  // --- utilidades internas ---

  _ahora_() {
    const valor = this.clock();
    const fecha = valor instanceof Date ? valor : new Date(valor);
    if (isNaN(fecha.getTime())) {
      throw new Error('Reloj inválido en ServicioAcceso.');
    }
    return fecha;
  }

  _nuevoToken_() {
    return _aleatorioHex_(this.random, 2);
  }

  _nuevoSalt_() {
    return _aleatorioHex_(this.random, 1);
  }

  _nuevaSesionId_() {
    return _aleatorioHex_(this.random, 2);
  }

  _urlBase_() {
    const valor = typeof this.urlImplementacion === 'function'
      ? this.urlImplementacion()
      : this.urlImplementacion;
    return String(valor || '').trim();
  }

  _construirEnlace_(token, baseParam) {
    const base = baseParam !== undefined ? String(baseParam || '').trim() : this._urlBase_();
    if (!base) {
      throw new Error('No se pudo obtener la URL de la implementación. Publica la web app antes de crear usuarios.');
    }
    const separador = base.indexOf('?') >= 0 ? '&' : '?';
    return base + separador + 'k=' + encodeURIComponent(token);
  }

  _conBloqueo_(fn) {
    const lock = this.lock;
    if (!lock) return fn();

    let adquirido = false;
    try {
      if (typeof lock.waitLock === 'function') {
        lock.waitLock(30000);
        adquirido = true;
      } else if (typeof lock.tryLock === 'function') {
        adquirido = lock.tryLock(30000);
        if (!adquirido) throw new Error('No se pudo obtener el bloqueo de usuarios.');
      } else {
        adquirido = true;
      }
      return fn();
    } finally {
      if (adquirido && typeof lock.releaseLock === 'function') {
        try { lock.releaseLock(); } catch (e) {}
      }
    }
  }

  _leerUsuarios_() {
    if (!this.repository || typeof this.repository.getUsuarios !== 'function') {
      return [];
    }
    return this.repository.getUsuarios() || [];
  }

  _guardarUsuarios_(usuarios) {
    const lista = Array.isArray(usuarios) ? usuarios : [];
    const guardar = () => {
      if (this.repository && typeof this.repository.saveUsuarios === 'function') {
        return this.repository.saveUsuarios(lista);
      }
      if (this.repository && typeof this.repository.replaceTable === 'function') {
        return this.repository.replaceTable('USUARIOS', lista);
      }
      throw new Error('El repositorio no permite escribir la hoja USUARIOS.');
    };

    try {
      return guardar();
    } catch (err) {
      if (this.repository && typeof this.repository.provisionDatabase === 'function') {
        this.repository.provisionDatabase();
        return guardar();
      }
      throw err;
    }
  }

  _buscarPorId_(idUsuario) {
    const id = String(idUsuario || '').trim();
    if (!id) return null;
    return this._leerUsuarios_().find(u => String(u.id_usuario || '').trim() === id) || null;
  }

  _buscarPorToken_(token) {
    const valor = String(token || '').trim();
    if (!valor) return null;
    const hash = _sha256Hex_(valor);
    return this._leerUsuarios_().find(u => _hashesIguales_(u.token_hash, hash)) || null;
  }

  _guardarUsuario_(usuario) {
    const lista = this._leerUsuarios_();
    const id = String(usuario.id_usuario || '');
    const indice = lista.findIndex(u => String(u.id_usuario || '') === id);
    if (indice < 0) throw new Error('Usuario no encontrado.');
    lista[indice] = usuario;
    this._guardarUsuarios_(lista);
    return usuario;
  }

  _crearSesion_(usuario) {
    if (!this.cache) {
      throw new Error('El almacenamiento de sesiones no está disponible.');
    }
    const sesion = this._nuevaSesionId_();
    const ahora = this._ahora_();
    const datos = {
      id_usuario: String(usuario.id_usuario),
      version_credenciales: Number(usuario.version_credenciales || 1),
      expira_en: ahora.getTime() + this.sessionTtlSeconds * 1000
    };
    this.cache.put(this.prefijoCache + sesion, JSON.stringify(datos), this.sessionTtlSeconds);
    return {
      sesion,
      nombre: String(usuario.nombre || ''),
      rol: String(usuario.rol || '').toUpperCase()
    };
  }

  _usuarioPublico_(usuario) {
    return {
      id_usuario: String(usuario.id_usuario || ''),
      nombre: String(usuario.nombre || ''),
      rol: String(usuario.rol || '').toUpperCase(),
      activo: _usuarioEstaActivo_(usuario),
      version_credenciales: Number(usuario.version_credenciales || 1)
    };
  }

  // --- gestión de usuarios (editor y app ADMIN) ---

  /**
   * Crea un usuario y devuelve su enlace personal (el token solo se muestra aquí).
   *
   * @param {string} nombre
   * @param {string} rol - CONSULTA | ENCARGADO | ADMIN
   * @returns {{ id_usuario: string, nombre: string, rol: string, enlace: string }}
   */
  crearUsuario(nombre, rol) {
    const nombreLimpio = String(nombre === null || nombre === undefined ? '' : nombre).trim();
    const rolLimpio = String(rol === null || rol === undefined ? '' : rol).trim().toUpperCase();

    if (!nombreLimpio) throw new Error('El nombre del usuario es obligatorio.');
    if (!ROLES_USUARIO[rolLimpio]) {
      throw new Error("El rol debe ser CONSULTA, ENCARGADO o ADMIN.");
    }

    // Se comprueba la URL antes de escribir: si no hay implementación, no se deja un usuario sin enlace.
    const base = this._urlBase_();
    if (!base) {
      throw new Error('No se pudo obtener la URL de la implementación. Publica la web app antes de crear usuarios.');
    }

    const token = this._nuevoToken_();
    const ahora = this._ahora_();

    return this._conBloqueo_(() => {
      const usuarios = this._leerUsuarios_();
      const usuario = {
        id_usuario: nuevoId('USR'),
        nombre: nombreLimpio,
        rol: rolLimpio,
        activo: true,
        token_hash: _sha256Hex_(token),
        pin_hash: '',
        pin_salt: '',
        intentos_fallidos: 0,
        bloqueado_hasta: '',
        version_credenciales: 1,
        fecha_alta: ahora.toISOString(),
        ultimo_acceso: ''
      };
      usuarios.push(usuario);
      this._guardarUsuarios_(usuarios);
      return {
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        rol: usuario.rol,
        enlace: this._construirEnlace_(token, base)
      };
    });
  }

  /**
   * Regenera el enlace de un usuario. Invalida sus sesiones y obliga a fijar un PIN nuevo.
   *
   * @param {string} idUsuario
   * @returns {{ id_usuario: string, enlace: string }}
   */
  regenerarEnlace(idUsuario) {
    const id = String(idUsuario || '').trim();
    if (!id) throw new Error('El identificador de usuario es obligatorio.');
    const base = this._urlBase_();
    if (!base) {
      throw new Error('No se pudo obtener la URL de la implementación. Publica la web app antes de regenerar enlaces.');
    }

    const token = this._nuevoToken_();

    return this._conBloqueo_(() => {
      const usuarios = this._leerUsuarios_();
      const indice = usuarios.findIndex(u => String(u.id_usuario || '') === id);
      if (indice < 0) throw new Error('Usuario no encontrado.');

      const usuario = usuarios[indice];
      usuario.token_hash = _sha256Hex_(token);
      usuario.pin_hash = '';
      usuario.pin_salt = '';
      usuario.intentos_fallidos = 0;
      usuario.bloqueado_hasta = '';
      usuario.version_credenciales = Number(usuario.version_credenciales || 1) + 1;
      usuarios[indice] = usuario;
      this._guardarUsuarios_(usuarios);

      return { id_usuario: usuario.id_usuario, enlace: this._construirEnlace_(token, base) };
    });
  }

  /**
   * Desactiva a un usuario e invalida su enlace y sus sesiones.
   *
   * @param {string} idUsuario
   * @returns {{ id_usuario: string, activo: boolean }}
   */
  desactivarUsuario(idUsuario) {
    const id = String(idUsuario || '').trim();
    if (!id) throw new Error('El identificador de usuario es obligatorio.');

    return this._conBloqueo_(() => {
      const usuarios = this._leerUsuarios_();
      const indice = usuarios.findIndex(u => String(u.id_usuario || '') === id);
      if (indice < 0) throw new Error('Usuario no encontrado.');

      const usuario = usuarios[indice];
      usuario.activo = false;
      usuario.version_credenciales = Number(usuario.version_credenciales || 1) + 1;
      usuarios[indice] = usuario;
      this._guardarUsuarios_(usuarios);

      return { id_usuario: usuario.id_usuario, activo: false };
    });
  }

  /**
   * Lista los usuarios sin tokens, hashes ni sales.
   *
   * @returns {Array<Object>}
   */
  listarUsuarios() {
    return this._leerUsuarios_().map(u => ({
      id_usuario: String(u.id_usuario || ''),
      nombre: String(u.nombre || ''),
      rol: String(u.rol || '').toUpperCase(),
      activo: _usuarioEstaActivo_(u),
      tiene_pin: !!String(u.pin_hash || '').trim(),
      intentos_fallidos: Number(u.intentos_fallidos || 0),
      bloqueado_hasta: String(u.bloqueado_hasta || ''),
      version_credenciales: Number(u.version_credenciales || 1),
      fecha_alta: String(u.fecha_alta || ''),
      ultimo_acceso: String(u.ultimo_acceso || '')
    }));
  }

  /**
   * Indica si el token corresponde a un usuario activo con PIN ya establecido.
   * Solo lo usa doGet para decidir qué pantalla de entrada mostrar.
   *
   * @param {string} token
   * @returns {boolean}
   */
  tienePinEstablecido(token) {
    const usuario = this._buscarPorToken_(token);
    return !!(usuario && _usuarioEstaActivo_(usuario) && String(usuario.pin_hash || '').trim());
  }

  // --- entrada ---

  /**
   * Abre sesión con token + PIN. Lanza un error genérico si algo falla.
   *
   * @param {string} token
   * @param {string} pin
   * @returns {{ sesion: string, nombre: string, rol: string }}
   */
  entrar(token, pin) {
    const usuarioToken = this._buscarPorToken_(token);
    if (!usuarioToken || !_usuarioEstaActivo_(usuarioToken)) {
      throw new Error('Credenciales no válidas');
    }

    return this._conBloqueo_(() => {
      const usuarios = this._leerUsuarios_();
      const indice = usuarios.findIndex(u => String(u.id_usuario || '') === String(usuarioToken.id_usuario));
      if (indice < 0) throw new Error('Credenciales no válidas');

      const usuario = usuarios[indice];
      if (!_usuarioEstaActivo_(usuario)) throw new Error('Credenciales no válidas');

      const ahora = this._ahora_();
      let intentos = Number(usuario.intentos_fallidos || 0);
      const bloqueadoHasta = _fechaBloqueo_(usuario.bloqueado_hasta);

      if (bloqueadoHasta && bloqueadoHasta.getTime() > ahora.getTime()) {
        throw new Error('Credenciales no válidas');
      }
      if (bloqueadoHasta && bloqueadoHasta.getTime() <= ahora.getTime()) {
        intentos = 0;
        usuario.bloqueado_hasta = '';
      }

      if (!String(usuario.pin_hash || '').trim() || !String(usuario.pin_salt || '').trim()) {
        intentos += 1;
        usuario.intentos_fallidos = intentos;
        if (intentos >= this.intentosMaximos) {
          usuario.bloqueado_hasta = new Date(ahora.getTime() + this.bloqueoMinutos * 60 * 1000).toISOString();
        }
        usuarios[indice] = usuario;
        this._guardarUsuarios_(usuarios);
        throw new Error('Credenciales no válidas');
      }

      const hash = _sha256Hex_(String(usuario.pin_salt) + String(pin));
      if (!_hashesIguales_(hash, usuario.pin_hash)) {
        intentos += 1;
        usuario.intentos_fallidos = intentos;
        if (intentos >= this.intentosMaximos) {
          usuario.bloqueado_hasta = new Date(ahora.getTime() + this.bloqueoMinutos * 60 * 1000).toISOString();
        }
        usuarios[indice] = usuario;
        this._guardarUsuarios_(usuarios);
        throw new Error('Credenciales no válidas');
      }

      usuario.intentos_fallidos = 0;
      usuario.bloqueado_hasta = '';
      usuario.ultimo_acceso = ahora.toISOString();
      usuarios[indice] = usuario;
      this._guardarUsuarios_(usuarios);
      return this._crearSesion_(usuario);
    });
  }

  /**
   * Fija el PIN de un usuario que aún no lo tiene o cuyo enlace se ha regenerado.
   * Si tiene éxito, abre sesión y devuelve { sesion, nombre, rol }.
   *
   * @param {string} token
   * @param {string} pin
   * @returns {{ sesion: string, nombre: string, rol: string }}
   */
  establecerPin(token, pin) {
    const pinLimpio = String(pin === null || pin === undefined ? '' : pin).trim();
    if (!/^\d{4,6}$/.test(pinLimpio)) {
      throw new Error('El PIN debe tener entre 4 y 6 cifras.');
    }

    const usuarioToken = this._buscarPorToken_(token);
    if (!usuarioToken || !_usuarioEstaActivo_(usuarioToken)) {
      throw new Error('Credenciales no válidas');
    }

    return this._conBloqueo_(() => {
      const usuarios = this._leerUsuarios_();
      const indice = usuarios.findIndex(u => String(u.id_usuario || '') === String(usuarioToken.id_usuario));
      if (indice < 0) throw new Error('Credenciales no válidas');

      const usuario = usuarios[indice];
      if (!_usuarioEstaActivo_(usuario)) throw new Error('Credenciales no válidas');
      if (String(usuario.pin_hash || '').trim()) {
        throw new Error('El usuario ya tiene PIN establecido.');
      }

      const ahora = this._ahora_();
      const bloqueadoHasta = _fechaBloqueo_(usuario.bloqueado_hasta);
      if (bloqueadoHasta && bloqueadoHasta.getTime() > ahora.getTime()) {
        throw new Error('Credenciales no válidas');
      }
      if (bloqueadoHasta && bloqueadoHasta.getTime() <= ahora.getTime()) {
        usuario.intentos_fallidos = 0;
        usuario.bloqueado_hasta = '';
      }

      const salt = this._nuevoSalt_();
      usuario.pin_salt = salt;
      usuario.pin_hash = _sha256Hex_(salt + pinLimpio);
      usuario.intentos_fallidos = 0;
      usuario.bloqueado_hasta = '';
      usuario.ultimo_acceso = ahora.toISOString();
      usuarios[indice] = usuario;
      this._guardarUsuarios_(usuarios);

      return this._crearSesion_(usuario);
    });
  }

  /**
   * Valida una sesión y renueva su duración. Devuelve el usuario público o null.
   *
   * @param {string} sesion
   * @returns {Object|null}
   */
  validarSesion(sesion) {
    const idSesion = String(sesion || '').trim();
    if (!idSesion || !this.cache) return null;

    const clave = this.prefijoCache + idSesion;
    let crudo = null;
    try {
      crudo = this.cache.get(clave);
    } catch (e) {
      return null;
    }
    if (!crudo) return null;

    let datos = null;
    try {
      datos = JSON.parse(String(crudo));
    } catch (e) {
      return null;
    }
    if (!datos || !datos.id_usuario) return null;

    const ahora = this._ahora_().getTime();
    const expiraEn = Number(datos.expira_en || 0);
    if (!expiraEn || expiraEn <= ahora) {
      try { this.cache.remove(clave); } catch (e) {}
      return null;
    }

    const usuario = this._buscarPorId_(datos.id_usuario);
    if (!usuario || !_usuarioEstaActivo_(usuario)) {
      try { this.cache.remove(clave); } catch (e) {}
      return null;
    }
    if (Number(usuario.version_credenciales || 1) !== Number(datos.version_credenciales || 0)) {
      try { this.cache.remove(clave); } catch (e) {}
      return null;
    }

    // Renovación: cada uso vuelve a dejar la sesión con 6 horas por delante.
    const nuevaExpiracion = ahora + this.sessionTtlSeconds * 1000;
    try {
      this.cache.put(clave, JSON.stringify({
        id_usuario: String(datos.id_usuario),
        version_credenciales: Number(datos.version_credenciales),
        expira_en: nuevaExpiracion
      }), this.sessionTtlSeconds);
    } catch (e) {}

    return this._usuarioPublico_(usuario);
  }

  /**
   * Borra una sesión.
   *
   * @param {string} sesion
   * @returns {boolean}
   */
  salir(sesion) {
    const idSesion = String(sesion || '').trim();
    if (!idSesion || !this.cache) return false;
    try {
      this.cache.remove(this.prefijoCache + idSesion);
      return true;
    } catch (e) {
      return false;
    }
  }
}

/**
 * Indica si una fila de USUARIOS está activa.
 * Considera inactivos false, 0, 'FALSE', 'NO' y variantes vacías explícitas.
 *
 * @param {Object} usuario
 * @returns {boolean}
 */
function _usuarioEstaActivo_(usuario) {
  if (!usuario) return false;
  const valor = usuario.activo;
  if (valor === false || valor === 0) return false;
  const texto = String(valor === undefined || valor === null ? '' : valor).trim().toUpperCase();
  if (!texto) return true; // Compatibilidad con filas antiguas sin columna.
  return texto !== 'FALSE' && texto !== 'NO' && texto !== '0';
}

/**
 * Convierte bloqueado_hasta en Date o null.
 *
 * @param {string|Date} valor
 * @returns {Date|null}
 */
function _fechaBloqueo_(valor) {
  if (!valor) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Crea el servicio de acceso con las dependencias indicadas.
 *
 * @param {Object} [options]
 * @returns {ServicioAcceso}
 */
function crearServicioAcceso_(options) {
  return new ServicioAcceso(options || {});
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PERMISOS_API,
    ROLES_USUARIO,
    ServicioAcceso,
    crearServicioAcceso_,
    exigirPropietario_,
    exigirSesionApi_,
    ejecutarConContexto_,
    conContextoDePrueba_,
    usuarioActual_,
    rolAlcanza_,
    _sha256Hex_,
    _uuidSeguro_
  };
}
