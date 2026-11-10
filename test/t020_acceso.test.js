/**
 * STOCK-LIGHT — Test Suite T-020: acceso por enlace personal, PIN, roles y despachador único
 *
 * Cubre los puntos de aceptación 1 a 6 y las reglas 1 a 11 del ticket
 * docs/tickets/T-020-acceso-enlace-pin.md (D-032).
 *
 * Ejecutable: node test/t020_acceso.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const codigo = require('../src/Código');
const { crearEntorno } = require('./helpers/mockSheets');
const { SCHEMA_DEFINITIONS } = require('../src/Repository');
const {
  ServicioAcceso,
  PERMISOS_API,
  conContextoDePrueba_,
  _sha256Hex_
} = require('../src/Seguridad');

const URL_IMPLEMENTACION = 'https://script.google.com/macros/s/PRUEBA_T020/exec';

let passed = 0;
let failed = 0;

function runTest(nombre, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${nombre}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${nombre}`);
    console.error(`     Error: ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'));
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Reloj, cache y aleatoriedad inyectables
// ---------------------------------------------------------------------------

function crearReloj(inicio = '2026-11-05T10:00:00.000Z') {
  let ms = new Date(inicio).getTime();
  return {
    ahora: () => new Date(ms),
    avanzarMinutos: (minutos) => { ms += Number(minutos) * 60 * 1000; }
  };
}

class CacheFalso {
  constructor(reloj) {
    this.reloj = reloj;
    this.datos = new Map();
  }

  get(clave) {
    const entrada = this.datos.get(clave);
    if (!entrada) return null;
    if (this.reloj.ahora().getTime() >= entrada.expira) {
      this.datos.delete(clave);
      return null;
    }
    return entrada.valor;
  }

  put(clave, valor, segundos) {
    this.datos.set(clave, {
      valor: String(valor),
      expira: this.reloj.ahora().getTime() + Number(segundos) * 1000
    });
  }

  remove(clave) {
    this.datos.delete(clave);
  }
}

function crearAleatorio() {
  let n = 0;
  return function () {
    n += 1;
    return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  };
}

function crearLockFalso() {
  return { waitLock: () => true, releaseLock: () => {} };
}

function crearLaboratorio(opciones = {}) {
  const reloj = opciones.reloj || crearReloj(new Date().toISOString());
  const cache = opciones.cache || new CacheFalso(reloj);
  const entorno = crearEntorno();
  const servicio = new ServicioAcceso({
    repository: entorno.repo,
    cache,
    clock: reloj.ahora,
    random: crearAleatorio(),
    lock: crearLockFalso(),
    urlImplementacion: URL_IMPLEMENTACION,
    sessionTtlSeconds: 6 * 60 * 60
  });
  return { reloj, cache, entorno, servicio };
}

function tokenDeEnlace(enlace) {
  const match = /[?&]k=([^&]+)/.exec(String(enlace || ''));
  return match ? decodeURIComponent(match[1]) : '';
}

function crearUsuarioConPin(lab, nombre, rol, pin = '1234') {
  const creado = lab.servicio.crearUsuario(nombre, rol);
  const token = tokenDeEnlace(creado.enlace);
  assert.ok(token, 'El enlace debe contener el token ?k=');
  const sesion = lab.servicio.establecerPin(token, pin);
  return { creado, token, sesion };
}

function leerUsuario(repo, idUsuario) {
  return repo.getUsuarios().find(u => String(u.id_usuario) === String(idUsuario)) || null;
}

// ---------------------------------------------------------------------------
// Globals para probar apiLlamar con sus dependencias por defecto
// ---------------------------------------------------------------------------

function instalarGlobals(lab) {
  const anterior = {
    SheetsRepository: global.SheetsRepository,
    CacheService: global.CacheService,
    ScriptApp: global.ScriptApp,
    LockService: global.LockService
  };

  global.SheetsRepository = function RepositorioDePrueba() { return lab.entorno.repo; };
  global.CacheService = { getScriptCache: () => lab.cache };
  global.ScriptApp = { getService: () => ({ getUrl: () => URL_IMPLEMENTACION }) };
  global.LockService = { getScriptLock: () => crearLockFalso() };

  return function restaurar() {
    global.SheetsRepository = anterior.SheetsRepository;
    global.CacheService = anterior.CacheService;
    global.ScriptApp = anterior.ScriptApp;
    global.LockService = anterior.LockService;
  };
}

// ---------------------------------------------------------------------------
// Cobertura de la superficie api* (aceptación 5)
// ---------------------------------------------------------------------------

function listarFuentesJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.js'))
    .map(e => ({
      archivo: e.name,
      contenido: fs.readFileSync(path.join(dir, e.name), 'utf8')
    }));
}

function extraerFunciones(fuente) {
  const salida = [];
  const regex = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
  let match;
  while ((match = regex.exec(fuente)) !== null) {
    const nombre = match[1];
    let i = match.index + match[0].length - 1;
    let profundidad = 0;
    for (; i < fuente.length; i++) {
      if (fuente[i] === '(') profundidad++;
      else if (fuente[i] === ')') {
        profundidad--;
        if (profundidad === 0) break;
      }
    }
    let j = i + 1;
    while (j < fuente.length && /\s/.test(fuente[j])) j++;
    if (fuente[j] !== '{') continue;
    j++;
    while (j < fuente.length && /\s/.test(fuente[j])) j++;
    salida.push({
      nombre,
      primeraSentencia: fuente.slice(j, j + 24)
    });
  }
  return salida;
}

function leerClasificaciones(documento) {
  const mapa = {};
  for (const linea of documento.split(/\r?\n/)) {
    const match = linea.match(/^\|\s*`([A-Za-z0-9_$]+)`\s*\|\s*`[^`]+`\s*\|\s*([A-Z]+)\s*\|/);
    if (match) mapa[match[1]] = match[2];
  }
  return mapa;
}

/**
 * Comprueba la cobertura de la superficie: toda api* LECTURA/ESCRITURA debe
 * empezar por exigirSesionApi_(); y estar en PERMISOS_API, y toda entrada de
 * PERMISOS_API debe existir como función.
 */
function analizarCobertura(fuentes, clasificaciones, permisos) {
  const problemas = [];
  const funciones = new Map();

  for (const fuente of fuentes) {
    for (const fn of extraerFunciones(fuente.contenido)) {
      if (!funciones.has(fn.nombre)) funciones.set(fn.nombre, fn.primeraSentencia);
    }
  }

  for (const [nombre, primera] of funciones.entries()) {
    if (!nombre.startsWith('api')) continue;
    const clasificacion = clasificaciones[nombre];
    if (!clasificacion) {
      problemas.push(`${nombre}: sin clasificar en API_PUBLICA.md`);
      continue;
    }
    if (clasificacion === 'LECTURA' || clasificacion === 'ESCRITURA') {
      if (!primera.startsWith('exigirSesionApi_();')) {
        problemas.push(`${nombre}: clasificada ${clasificacion} pero no empieza por exigirSesionApi_();`);
      }
      if (!permisos[nombre]) {
        problemas.push(`${nombre}: clasificada ${clasificacion} pero no está en PERMISOS_API`);
      }
    }
  }

  for (const nombre of Object.keys(permisos)) {
    if (!funciones.has(nombre)) problemas.push(`${nombre}: está en PERMISOS_API pero no existe`);
  }

  return problemas;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

console.log('\n================================================================');
console.log(' TEST SUITE T-020 — ACCESO POR ENLACE, PIN, ROLES Y DESPACHADOR');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// Aceptación 1: credenciales
// ---------------------------------------------------------------------------

runTest('1.1 La hoja USUARIOS está al final del esquema y no guarda token ni PIN en claro', () => {
  assert.deepStrictEqual(SCHEMA_DEFINITIONS.USUARIOS, [
    'id_usuario', 'nombre', 'rol', 'activo', 'token_hash', 'pin_hash', 'pin_salt',
    'intentos_fallidos', 'bloqueado_hasta', 'version_credenciales', 'fecha_alta', 'ultimo_acceso'
  ]);
  assert.strictEqual(Object.keys(SCHEMA_DEFINITIONS)[Object.keys(SCHEMA_DEFINITIONS).length - 1], 'USUARIOS');

  const lab = crearLaboratorio();
  const { creado, token } = crearUsuarioConPin(lab, 'Ana', 'ADMIN', '4821');
  const usuario = leerUsuario(lab.entorno.repo, creado.id_usuario);
  assert.ok(usuario, 'El usuario debe existir');
  assert.strictEqual(usuario.token_hash, _sha256Hex_(token));
  assert.strictEqual(usuario.pin_hash, _sha256Hex_(usuario.pin_salt + '4821'));
  assert.strictEqual(usuario.token_hash.length, 64);
  assert.strictEqual(usuario.pin_hash.length, 64);
  assert.ok(usuario.pin_salt && usuario.pin_salt.length >= 16);

  for (const hoja of lab.entorno.ss.sheets.values()) {
    for (const fila of hoja.rows) {
      for (const celda of fila) {
        assert.notStrictEqual(String(celda), token, `El token no puede estar en claro en ${hoja.name}`);
        assert.notStrictEqual(String(celda), '4821', `El PIN no puede estar en claro en ${hoja.name}`);
      }
    }
  }
});

runTest('1.2 Un PIN correcto abre sesión y uno incorrecto no', () => {
  const lab = crearLaboratorio();
  const { token, sesion } = crearUsuarioConPin(lab, 'Ana', 'ENCARGADO');

  const abierta = lab.servicio.entrar(token, '1234');
  assert.strictEqual(abierta.nombre, 'Ana');
  assert.strictEqual(abierta.rol, 'ENCARGADO');
  assert.ok(abierta.sesion);
  assert.strictEqual(lab.servicio.validarSesion(abierta.sesion).nombre, 'Ana');
  assert.ok(sesion.sesion);

  assert.throws(() => lab.servicio.entrar(token, '9999'), /Credenciales no válidas/);
  assert.throws(() => lab.servicio.entrar('token-que-no-existe', '1234'), /Credenciales no válidas/);

  const usuario = lab.entorno.repo.getUsuarios()[0];
  assert.strictEqual(Number(usuario.intentos_fallidos), 1);
});

runTest('1.3 Cinco fallos bloquean 15 minutos y un acierto deja los intentos a 0', () => {
  const reloj = crearReloj();
  const lab = crearLaboratorio({ reloj });
  const { token } = crearUsuarioConPin(lab, 'Ana', 'ENCARGADO');

  // Dos fallos y un acierto: el contador vuelve a 0.
  assert.throws(() => lab.servicio.entrar(token, '0000'), /Credenciales no válidas/);
  assert.throws(() => lab.servicio.entrar(token, '1111'), /Credenciales no válidas/);
  const bueno = lab.servicio.entrar(token, '1234');
  assert.ok(bueno.sesion);
  let usuario = lab.entorno.repo.getUsuarios()[0];
  assert.strictEqual(Number(usuario.intentos_fallidos), 0);

  // Cinco fallos seguidos: bloqueo de 15 minutos.
  for (let i = 0; i < 5; i++) {
    assert.throws(() => lab.servicio.entrar(token, '2222'), /Credenciales no válidas/);
  }
  usuario = lab.entorno.repo.getUsuarios()[0];
  assert.strictEqual(Number(usuario.intentos_fallidos), 5);
  const bloqueo = new Date(usuario.bloqueado_hasta).getTime();
  assert.strictEqual(bloqueo, reloj.ahora().getTime() + 15 * 60 * 1000);

  // A los 14 minutos sigue bloqueado, aunque el PIN sea correcto.
  reloj.avanzarMinutos(14);
  assert.throws(() => lab.servicio.entrar(token, '1234'), /Credenciales no válidas/);

  // A los 16 minutos el bloqueo ha caducado y el PIN correcto entra.
  reloj.avanzarMinutos(2);
  const despues = lab.servicio.entrar(token, '1234');
  assert.ok(despues.sesion);
  usuario = lab.entorno.repo.getUsuarios()[0];
  assert.strictEqual(Number(usuario.intentos_fallidos), 0);
});

runTest('1.4 apiEstablecerPin también respeta el bloqueo de 15 minutos', () => {
  const reloj = crearReloj();
  const lab = crearLaboratorio({ reloj });
  const creado = lab.servicio.crearUsuario('Ana', 'CONSULTA');
  const token = tokenDeEnlace(creado.enlace);

  for (let i = 0; i < 5; i++) {
    assert.throws(() => lab.servicio.entrar(token, '0000'), /Credenciales no válidas/);
  }

  reloj.avanzarMinutos(14);
  assert.throws(() => lab.servicio.establecerPin(token, '1234'), /Credenciales no válidas/);

  reloj.avanzarMinutos(2);
  const sesion = lab.servicio.establecerPin(token, '1234');
  assert.ok(sesion.sesion);
});

// ---------------------------------------------------------------------------
// Aceptación 2: sesiones
// ---------------------------------------------------------------------------

runTest('2.1 La sesión caduca a las 6 horas sin uso y se renueva con el uso', () => {
  const reloj = crearReloj();
  const lab = crearLaboratorio({ reloj });
  const { sesion } = crearUsuarioConPin(lab, 'Ana', 'CONSULTA');

  reloj.avanzarMinutos(5 * 60);
  assert.ok(lab.servicio.validarSesion(sesion.sesion), 'A las 5 horas debe seguir viva');

  // La validación anterior renueva 6 horas desde ese momento.
  reloj.avanzarMinutos(4 * 60);
  assert.ok(lab.servicio.validarSesion(sesion.sesion), 'La sesión se renueva con el uso');

  // Sin más uso, 6 horas y un minuto después de la última renovación caduca.
  reloj.avanzarMinutos(6 * 60 + 1);
  assert.strictEqual(lab.servicio.validarSesion(sesion.sesion), null);

  assert.strictEqual(lab.servicio.validarSesion('sesion-inventada'), null);
});

runTest('2.2 Desactivar al usuario o regenerar su enlace invalida sus sesiones abiertas', () => {
  const lab = crearLaboratorio();
  const { creado, sesion } = crearUsuarioConPin(lab, 'Ana', 'ENCARGADO');
  assert.ok(lab.servicio.validarSesion(sesion.sesion));

  lab.servicio.desactivarUsuario(creado.id_usuario);
  assert.strictEqual(lab.servicio.validarSesion(sesion.sesion), null);
  assert.strictEqual(leerUsuario(lab.entorno.repo, creado.id_usuario).activo, false);

  const otro = crearUsuarioConPin(lab, 'Beto', 'ENCARGADO');
  assert.ok(lab.servicio.validarSesion(otro.sesion.sesion));
  const regenerado = lab.servicio.regenerarEnlace(otro.creado.id_usuario);
  assert.strictEqual(lab.servicio.validarSesion(otro.sesion.sesion), null);
  assert.throws(() => lab.servicio.entrar(otro.token, '1234'), /Credenciales no válidas/);

  const tokenNuevo = tokenDeEnlace(regenerado.enlace);
  assert.ok(tokenNuevo && tokenNuevo !== otro.token);
  const nuevaSesion = lab.servicio.establecerPin(tokenNuevo, '5678');
  assert.ok(nuevaSesion.sesion);
});

// ---------------------------------------------------------------------------
// Aceptación 3: despachador y roles
// ---------------------------------------------------------------------------

runTest('3.1 CONSULTA, ENCARGADO y ADMIN respetan PERMISOS_API; sesión y nombres inválidos se rechazan', () => {
  const lab = crearLaboratorio();
  const ana = crearUsuarioConPin(lab, 'Ana', 'CONSULTA');
  const beto = crearUsuarioConPin(lab, 'Beto', 'ENCARGADO');
  const carla = crearUsuarioConPin(lab, 'Carla', 'ADMIN');
  const restaurar = instalarGlobals(lab);

  try {
    // CONSULTA: LECTURA sí, ESCRITURA no.
    const lectura = codigo.apiLlamar(ana.sesion.sesion, 'apiGetMaestroArticulos', []);
    assert.ok(Array.isArray(lectura), 'CONSULTA debe poder leer');
    const gruposLegado = codigo.apiLlamar(ana.sesion.sesion, 'apiGetGruposComerciales', []);
    assert.ok(Array.isArray(gruposLegado), 'La lectura obsoleta también pasa por el despachador');
    const escrituraAna = codigo.apiLlamar(ana.sesion.sesion, 'apiRegistrarAjustePositivo', [{
      codigo_articulo: 'ART-T020', codigo_envase: 'ENV-T020', cajas: 1, motivo: 'T020'
    }]);
    assert.strictEqual(escrituraAna.success, false);
    assert.strictEqual(escrituraAna.errorCode, 'PERMISO_DENEGADO');

    // ENCARGADO: ESCRITURA sí, usuarios no.
    const escrituraBeto = codigo.apiLlamar(beto.sesion.sesion, 'apiRegistrarAjustePositivo', [{
      codigo_articulo: 'ART-T020', codigo_envase: 'ENV-T020', cajas: 2, motivo: 'T020'
    }]);
    assert.strictEqual(escrituraBeto.success, true);
    const usuariosBeto = codigo.apiLlamar(beto.sesion.sesion, 'apiCrearUsuario', ['Nuevo', 'CONSULTA']);
    assert.strictEqual(usuariosBeto.success, false);
    assert.strictEqual(usuariosBeto.errorCode, 'PERMISO_DENEGADO');

    // ADMIN: lectura, escritura y usuarios.
    const usuariosCarla = codigo.apiLlamar(carla.sesion.sesion, 'apiListarUsuarios', []);
    assert.ok(Array.isArray(usuariosCarla));
    const creado = codigo.apiLlamar(carla.sesion.sesion, 'apiCrearUsuario', ['Nueva', 'CONSULTA']);
    assert.ok(creado && creado.enlace && creado.id_usuario);
    assert.strictEqual(creado.rol, 'CONSULTA');

    const regenerado = codigo.apiLlamar(carla.sesion.sesion, 'apiRegenerarEnlace', [creado.id_usuario]);
    assert.ok(regenerado && regenerado.enlace);
    const desactivado = codigo.apiLlamar(carla.sesion.sesion, 'apiDesactivarUsuario', [creado.id_usuario]);
    assert.strictEqual(desactivado.activo, false);

    // Nombre fuera de PERMISOS_API: se rechaza aunque exista.
    const desconocida = codigo.apiLlamar(carla.sesion.sesion, 'initDatabase', []);
    assert.strictEqual(desconocida.success, false);
    assert.strictEqual(desconocida.errorCode, 'API_NO_PERMITIDA');

    const prototipo = codigo.apiLlamar(carla.sesion.sesion, 'constructor', []);
    assert.strictEqual(prototipo.success, false);
    assert.strictEqual(prototipo.errorCode, 'API_NO_PERMITIDA');

    // Sesión inválida.
    const invalida = codigo.apiLlamar('sesion-inventada', 'apiGetMaestroArticulos', []);
    assert.strictEqual(invalida.success, false);
    assert.strictEqual(invalida.errorCode, 'SESION_INVALIDA');

    // apiSalir borra la sesión y deja de valer.
    const salida = codigo.apiLlamar(ana.sesion.sesion, 'apiSalir', [ana.sesion.sesion]);
    assert.strictEqual(salida.success, true);
    const despues = codigo.apiLlamar(ana.sesion.sesion, 'apiGetMaestroArticulos', []);
    assert.strictEqual(despues.errorCode, 'SESION_INVALIDA');
  } finally {
    restaurar();
  }
});

// ---------------------------------------------------------------------------
// Aceptación 4: sin atajos
// ---------------------------------------------------------------------------

runTest('4.1 Llamar directamente a una api* de LECTURA o ESCRITURA lanza «Acceso no autorizado» y no escribe', () => {
  const lab = crearLaboratorio();
  const { token } = crearUsuarioConPin(lab, 'Ana', 'ADMIN');
  assert.ok(token);

  const documento = fs.readFileSync(path.join(__dirname, '..', 'docs', 'API_PUBLICA.md'), 'utf8');
  const clasificaciones = leerClasificaciones(documento);
  const nombres = Object.keys(PERMISOS_API).filter(nombre => {
    const clasificacion = clasificaciones[nombre];
    return (clasificacion === 'LECTURA' || clasificacion === 'ESCRITURA') && typeof codigo[nombre] === 'function';
  });
  assert.ok(nombres.length > 20, 'Debe haber muchas funciones que comprobar');

  const antes = JSON.stringify([...lab.entorno.ss.sheets.entries()].map(([n, s]) => [n, s.rows]));

  for (const nombre of nombres) {
    assert.throws(
      () => codigo[nombre](),
      (err) => err instanceof Error && err.message === 'Acceso no autorizado',
      `${nombre} debe exigir sesión`
    );
  }

  const despues = JSON.stringify([...lab.entorno.ss.sheets.entries()].map(([n, s]) => [n, s.rows]));
  assert.strictEqual(despues, antes, 'Ninguna llamada directa puede escribir');
});

// ---------------------------------------------------------------------------
// Aceptación 5: cobertura de la superficie
// ---------------------------------------------------------------------------

runTest('5.1 Toda api* LECTURA/ESCRITURA tiene guarda y permiso; toda entrada de PERMISOS_API existe', () => {
  const srcDir = path.join(__dirname, '..', 'src');
  const fuentes = listarFuentesJs(srcDir);
  const documento = fs.readFileSync(path.join(__dirname, '..', 'docs', 'API_PUBLICA.md'), 'utf8');
  const clasificaciones = leerClasificaciones(documento);

  const problemas = analizarCobertura(fuentes, clasificaciones, PERMISOS_API);
  assert.deepStrictEqual(problemas, []);
});

runTest('5.2 La comprobación de cobertura detecta una api* nueva sin guarda o sin permiso', () => {
  const fuentes = [{
    archivo: 'sintetico.js',
    contenido: [
      'function apiSinGuarda() {',
      '  return 1;',
      '}',
      'function apiConGuarda() {',
      '  exigirSesionApi_();',
      '  return 1;',
      '}'
    ].join('\n')
  }];
  const clasificaciones = { apiSinGuarda: 'LECTURA', apiConGuarda: 'LECTURA' };
  const permisos = { apiConGuarda: 'CONSULTA' };
  const problemas = analizarCobertura(fuentes, clasificaciones, permisos);
  assert.ok(problemas.some(p => p.includes('apiSinGuarda') && p.includes('no empieza')));
  assert.ok(problemas.some(p => p.includes('apiSinGuarda') && p.includes('PERMISOS_API')));
  assert.strictEqual(problemas.filter(p => p.includes('apiConGuarda')).length, 0);
});

// ---------------------------------------------------------------------------
// Aceptación 6: auditoría
// ---------------------------------------------------------------------------

runTest('6.1 Un ajuste hecho por apiLlamar queda firmado con el nombre de la sesión, no con el del cliente', () => {
  const lab = crearLaboratorio();
  const ana = crearUsuarioConPin(lab, 'Ana', 'ENCARGADO');
  const restaurar = instalarGlobals(lab);

  try {
    const res = codigo.apiLlamar(ana.sesion.sesion, 'apiRegistrarAjustePositivo', [{
      codigo_articulo: 'ART-AUDITORIA',
      codigo_envase: 'ENV-AUDITORIA',
      cajas: 4,
      motivo: 'T020',
      usuario: 'OTRO_USUARIO'
    }, 'OTRO_USUARIO']);
    assert.strictEqual(res.success, true);

    const movimientos = lab.entorno.repo.getMovimientos();
    const ultimo = movimientos[movimientos.length - 1];
    assert.strictEqual(ultimo.usuario, 'Ana');
    assert.notStrictEqual(ultimo.usuario, 'OTRO_USUARIO');
  } finally {
    restaurar();
  }
});

// ---------------------------------------------------------------------------
// Reglas de entrada, doGet y configuración
// ---------------------------------------------------------------------------

runTest('7.1 apiEntrar devuelve un error genérico tanto con token malo como con PIN malo', () => {
  const lab = crearLaboratorio();
  const { token } = crearUsuarioConPin(lab, 'Ana', 'CONSULTA');
  const restaurar = instalarGlobals(lab);

  try {
    const pinMalo = codigo.apiEntrar(token, '0000');
    const tokenMalo = codigo.apiEntrar('token-que-no-existe', '1234');
    assert.strictEqual(pinMalo.errorCode, 'CREDENCIALES_INVALIDAS');
    assert.strictEqual(tokenMalo.errorCode, 'CREDENCIALES_INVALIDAS');
    assert.deepStrictEqual(Object.keys(pinMalo).sort(), Object.keys(tokenMalo).sort());

    const bueno = codigo.apiEntrar(token, '1234');
    assert.ok(bueno.sesion);
    assert.strictEqual(bueno.nombre, 'Ana');
    assert.strictEqual(bueno.rol, 'CONSULTA');
  } finally {
    restaurar();
  }
});

runTest('7.2 apiEstablecerPin solo funciona sin PIN previo; tras regenerar el enlace vuelve a funcionar', () => {
  const lab = crearLaboratorio();
  const { creado, token } = crearUsuarioConPin(lab, 'Ana', 'CONSULTA');
  const restaurar = instalarGlobals(lab);

  try {
    const repetido = codigo.apiEstablecerPin(token, '5678');
    assert.strictEqual(repetido.errorCode, 'CREDENCIALES_INVALIDAS');

    const regenerado = codigo.regenerarEnlace(creado.id_usuario, {
      session: {
        getActiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' }),
        getEffectiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' })
      }
    });
    const tokenNuevo = tokenDeEnlace(regenerado.enlace);
    const nueva = codigo.apiEstablecerPin(tokenNuevo, '5678');
    assert.ok(nueva.sesion);
  } finally {
    restaurar();
  }
});

runTest('7.3 doGet pasa el token y el estado del PIN a la plantilla', () => {
  const lab = crearLaboratorio();
  const { creado, token } = crearUsuarioConPin(lab, 'Ana', 'CONSULTA');
  const restaurar = instalarGlobals(lab);
  const anteriorHtml = global.HtmlService;
  let plantilla = null;

  global.HtmlService = {
    XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
    createTemplateFromFile: function () {
      plantilla = {
        k: null,
        tienePin: null,
        evaluate: function () {
          return {
            setTitle: function () { return this; },
            addMetaTag: function () { return this; },
            setXFrameOptionsMode: function () { return this; }
          };
        }
      };
      return plantilla;
    }
  };

  try {
    codigo.doGet({ parameter: { k: token } });
    assert.strictEqual(plantilla.k, token);
    assert.strictEqual(plantilla.tienePin, true);

    codigo.doGet({});
    assert.strictEqual(plantilla.k, '');
    assert.strictEqual(plantilla.tienePin, false);
    assert.ok(creado.id_usuario);
  } finally {
    global.HtmlService = anteriorHtml;
    restaurar();
  }
});

runTest('7.4 appsscript.json declara la web app ejecutada como propietario y accesible', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'appsscript.json'), 'utf8'));
  assert.deepStrictEqual(config.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE' });
});

runTest('7.5 El cliente usa apiLlamar, guarda el token en localStorage y quita la k de la URL', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Index.html'), 'utf8');
  assert.ok(html.includes('apiLlamar(state.sesion, fnName, args)'), 'El puente llama a apiLlamar');
  assert.ok(html.includes('localStorage'), 'El token se guarda en localStorage');
  assert.ok(html.includes('google.script.history.replace'), 'El token se quita de la URL');
  assert.ok(html.includes('id="pantallaEntrada"'), 'Existe pantalla de entrada');
  assert.ok(html.includes('id="btnSalir"'), 'Existe botón Salir');
  assert.ok(html.includes('id="lblUsuario"'), 'La cabecera muestra el usuario');
  assert.ok(html.includes('data-digito="1"'), 'Existe teclado numérico');
  assert.ok(/min-height:\s*5[0-9]px/.test(html), 'Las teclas tienen área de pulsación grande');
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-020: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
