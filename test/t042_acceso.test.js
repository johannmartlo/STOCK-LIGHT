/**
 * Suite de pruebas T-042 — Acceso sin fricción, errores claros y gráfico desde el stock inicial.
 *
 * Todos los datos, usuarios, URLs y tokens son ficticios (D-015).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { crearEntorno } = require('./helpers/mockSheets');

const {
  PERMISOS_API,
  ServicioAcceso
} = require('../src/Seguridad');
const { InicioService } = require('../src/InicioService');
const codigo = require('../src/Código');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.stack || err.message}`);
    failed++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.stack || err.message}`);
    failed++;
  }
}

const URL_APP_FICTICIA = 'https://script.google.com/macros/s/AKfycb_FICTICIO_T042/exec';
const URL_DEV_FICTICIA = 'https://script.google.com/macros/s/AKfycb_FICTICIO_T042/dev';

function crearCacheMemoria(reloj) {
  const mapa = new Map();
  return {
    mapa,
    get(clave) {
      const entrada = mapa.get(clave);
      if (!entrada) return null;
      if (entrada.expiraEn <= reloj().getTime()) {
        mapa.delete(clave);
        return null;
      }
      return entrada.valor;
    },
    put(clave, valor, ttlSegundos) {
      mapa.set(clave, {
        valor: String(valor),
        expiraEn: reloj().getTime() + Number(ttlSegundos || 0) * 1000
      });
    },
    remove(clave) {
      mapa.delete(clave);
    }
  };
}

function crearPropertiesMemoria(inicial = {}) {
  const store = Object.assign({}, inicial);
  return {
    store,
    getProperty(clave) {
      return Object.prototype.hasOwnProperty.call(store, clave) ? store[clave] : null;
    },
    setProperty(clave, valor) {
      store[clave] = String(valor);
    }
  };
}

function crearLockSimple() {
  return {
    waitLock() {},
    releaseLock() {}
  };
}

function sesionPropietario() {
  return {
    getActiveUser: () => ({ getEmail: () => 'admin@ejemplo.test' }),
    getEffectiveUser: () => ({ getEmail: () => 'admin@ejemplo.test' })
  };
}

function sesionVisitante() {
  return {
    getActiveUser: () => ({ getEmail: () => 'visitante@ejemplo.test' }),
    getEffectiveUser: () => ({ getEmail: () => 'admin@ejemplo.test' })
  };
}

function crearLaboratorio(opts = {}) {
  const entorno = crearEntorno();
  let ahoraMs = Date.parse('2026-11-27T10:00:00.000Z');
  const reloj = () => new Date(ahoraMs);
  const cache = crearCacheMemoria(reloj);
  const lock = crearLockSimple();
  const properties = crearPropertiesMemoria(opts.properties || {});
  let contadorUuid = 0;
  const random = () => {
    contadorUuid += 1;
    return `00000000-0000-4000-8000-${String(contadorUuid).padStart(12, '0')}`;
  };

  const opcionesServicio = {
    repository: entorno.repo,
    cache,
    clock: reloj,
    random,
    lock,
    propertiesService: properties
  };
  if (opts.urlImplementacion !== undefined) {
    opcionesServicio.urlImplementacion = opts.urlImplementacion;
  }

  const servicio = new ServicioAcceso(opcionesServicio);
  return {
    entorno,
    servicio,
    cache,
    lock,
    properties,
    reloj,
    avanzarSegundos(seg) {
      ahoraMs += seg * 1000;
    },
    avanzarMinutos(min) {
      ahoraMs += min * 60 * 1000;
    },
    opcionesApi() {
      return Object.assign({}, opcionesServicio);
    }
  };
}

function tokenDeEnlace(enlace) {
  const match = String(enlace || '').match(/[?&]k=([^&]+)/);
  assert.ok(match, `El enlace no contiene k=: ${enlace}`);
  return decodeURIComponent(match[1]);
}

function configurarCatalogoMinimo(repo) {
  repo.replaceTable('ATRIBUTOS', [
    { atributo: 'SEGUIMIENTO', valores_permitidos: 'SI,NO', obligatorio: true }
  ]);
  repo.replaceTable('REGLAS_CLASIFICACION', [
    { prioridad: 10, atributo: 'SEGUIMIENTO', valor: 'SI', condicion_articulo: 'TOMATE', condicion_envase: '', activa: true }
  ]);
  repo.replaceTable('CATALOGO', []);
  repo.replaceTable('AGRUPACIONES', [
    { agrupacion: 'COMERCIAL', orden: 1, grupo: 'TOMATE', subgrupo: '', filtro: '', color: '#F2553D', dias_aviso: 4, stock_bajo: '', activa: true }
  ]);
}

/**
 * Monta un DOM mínimo en Node vm y ejecuta el <script> de src/Index.html.
 */
function montarInterfazEntrada(opts = {}) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Index.html'), 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'No se encontró <script> en src/Index.html');
  const codigoScript = scriptMatch[1];

  const storageData = Object.assign({}, opts.localStorage || {});
  const setItemCalls = [];
  const localStorageMock = {
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(storageData, k) ? storageData[k] : null;
    },
    setItem(k, v) {
      setItemCalls.push({ key: String(k), value: String(v) });
      storageData[String(k)] = String(v);
    },
    removeItem(k) {
      delete storageData[String(k)];
    }
  };

  function crearEl(id, attrs = {}) {
    const classes = new Set();
    const listeners = {};
    const attributes = Object.assign({}, attrs);
    return {
      id,
      style: { display: '' },
      textContent: '',
      innerHTML: '',
      disabled: false,
      title: '',
      dataset: Object.assign({}, attrs.dataset || {}),
      classList: {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        toggle(c, force) {
          if (force === undefined) {
            if (classes.has(c)) classes.delete(c);
            else classes.add(c);
          } else if (force) classes.add(c);
          else classes.delete(c);
        },
        contains(c) { return classes.has(c); }
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
      },
      setAttribute(name, val) {
        attributes[name] = String(val);
      },
      addEventListener(ev, fn) {
        if (!listeners[ev]) listeners[ev] = [];
        listeners[ev].push(fn);
      },
      click() {
        (listeners.click || []).forEach(fn => fn({ target: this }));
      }
    };
  }

  const elementos = {
    pantallaEntrada: crearEl('pantallaEntrada', {
      'data-token': opts.tokenInicial || '',
      'data-tiene-pin': opts.tienePin ? '1' : '0'
    }),
    entradaTitulo: crearEl('entradaTitulo'),
    entradaTexto: crearEl('entradaTexto'),
    entradaPin: crearEl('entradaPin'),
    entradaTeclado: crearEl('entradaTeclado'),
    btnEntradaConfirmar: crearEl('btnEntradaConfirmar'),
    entradaError: crearEl('entradaError'),
    btnCambiarModo: crearEl('btnCambiarModo'),
    app: crearEl('app'),
    lblUsuario: crearEl('lblUsuario'),
    lblUsuarioAvatar: crearEl('lblUsuarioAvatar'),
    lblUsuarioAvatarMob: crearEl('lblUsuarioAvatarMob'),
    btnSalir: crearEl('btnSalir'),
    btnSalirMob: crearEl('btnSalirMob')
  };

  const botonesDigito = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(d =>
    crearEl('digito_' + d, { dataset: { digito: d } })
  );
  const btnBorrar = crearEl('btnBorrar');
  const bodyEl = crearEl('body');

  const docMock = {
    readyState: 'complete',
    title: 'Stock Light',
    body: bodyEl,
    getElementById(id) {
      return elementos[id] || null;
    },
    querySelectorAll(sel) {
      if (sel === '#entradaTeclado [data-digito]') return botonesDigito;
      return [];
    },
    querySelector(sel) {
      if (sel === '#entradaTeclado [data-accion="borrar"]') return btnBorrar;
      return null;
    },
    addEventListener() {}
  };

  const llamadasBridge = [];
  const winMock = {
    localStorage: localStorageMock,
    location: { href: 'https://script.google.com/macros/s/AKfycb_FICTICIO_T042/exec' },
    history: { replaceState() {} },
    SLApp: {
      rolAplicado: null,
      iniciosCargados: 0,
      aplicarRol(rol) { this.rolAplicado = rol; },
      cargarInicio() { this.iniciosCargados += 1; }
    },
    localApiBridge(fnName, args, resolve, reject) {
      llamadasBridge.push({ fnName, args });
      if (typeof opts.onApi === 'function') {
        opts.onApi(fnName, args, resolve, reject);
      } else {
        resolve({ ok: false });
      }
    }
  };

  const sandbox = {
    window: winMock,
    document: docMock,
    URL,
    console,
    Promise,
    Date,
    Number,
    String,
    Boolean,
    Object,
    Array,
    JSON,
    Math,
    Error
  };

  vm.runInNewContext(codigoScript, sandbox);

  function teclearPin(pin) {
    for (const ch of String(pin)) {
      const btn = botonesDigito.find(b => b.dataset.digito === ch);
      assert.ok(btn, `No se encontró tecla para ${ch}`);
      btn.click();
    }
  }

  return {
    html,
    codigoScript,
    elementos,
    storageData,
    setItemCalls,
    llamadasBridge,
    winMock,
    teclearPin
  };
}

function flushMicrotasks() {
  return new Promise(resolve => setImmediate(resolve));
}

async function main() {
  console.log('\n================================================================');
  console.log(' TEST SUITE T-042 — ACCESO SIN FRICCIÓN, ERRORES Y GRÁFICO');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // Aceptación 1: apiComprobarSesion
  // -------------------------------------------------------------------------
  runTest('1. apiComprobarSesion: válida devuelve ok y renueva TTL; caducada/inventada/tras apiSalir -> ok:false', () => {
    const lab = crearLaboratorio({ urlImplementacion: URL_APP_FICTICIA });
    const creado = lab.servicio.crearUsuario('Lucia', 'ENCARGADO');
    const token = tokenDeEnlace(creado.enlace);
    const entrada = lab.servicio.establecerPin(token, '4321');
    const opts = lab.opcionesApi();

    // Inventada -> ok:false
    assert.deepStrictEqual(codigo.apiComprobarSesion('sesion-inventada', opts), { ok: false });

    // Válida tras 4 horas -> ok:true y renueva otras 6 horas
    lab.avanzarSegundos(4 * 3600);
    const check1 = codigo.apiComprobarSesion(entrada.sesion, opts);
    assert.deepStrictEqual(check1, { ok: true, nombre: 'Lucia', rol: 'ENCARGADO' });

    // Otras 4 horas después (8h desde inicio, pero solo 4h desde renovación) -> sigue válida
    lab.avanzarSegundos(4 * 3600);
    const check2 = codigo.apiComprobarSesion(entrada.sesion, opts);
    assert.deepStrictEqual(check2, { ok: true, nombre: 'Lucia', rol: 'ENCARGADO' });

    // Tras apiSalir -> ok:false
    const salida = codigo.apiSalir(entrada.sesion, opts);
    assert.strictEqual(salida.success, true);
    assert.deepStrictEqual(codigo.apiComprobarSesion(entrada.sesion, opts), { ok: false });

    // Nueva sesión que caduca tras >6h sin uso -> ok:false
    const entrada2 = lab.servicio.entrar(token, '4321');
    lab.avanzarSegundos(6 * 3600 + 5);
    assert.deepStrictEqual(codigo.apiComprobarSesion(entrada2.sesion, opts), { ok: false });
  });

  // -------------------------------------------------------------------------
  // Aceptación 2: motivos de error en apiEntrar y reinicio de contador
  // -------------------------------------------------------------------------
  runTest('2. apiEntrar: ENLACE_NO_VALIDO, PIN_INCORRECTO con intentos_restantes, BLOQUEADO con hasta, reinicio tras éxito y ERROR_SERVIDOR', () => {
    const lab = crearLaboratorio({ urlImplementacion: URL_APP_FICTICIA });
    const creado = lab.servicio.crearUsuario('Mateo', 'CONSULTA');
    const token = tokenDeEnlace(creado.enlace);
    lab.servicio.establecerPin(token, '2468');
    const opts = lab.opcionesApi();

    // Token inexistente -> ENLACE_NO_VALIDO
    const resToken = codigo.apiEntrar('token-no-existe-t042', '2468', opts);
    assert.strictEqual(resToken.success, false);
    assert.strictEqual(resToken.errorCode, 'ENLACE_NO_VALIDO');

    // PIN mal (1er fallo) -> PIN_INCORRECTO con intentos_restantes = 4
    const fallo1 = codigo.apiEntrar(token, '0000', opts);
    assert.strictEqual(fallo1.success, false);
    assert.strictEqual(fallo1.errorCode, 'PIN_INCORRECTO');
    assert.strictEqual(fallo1.intentos_restantes, 4);

    // PIN bien tras un fallo -> entra y reinicia intentos_fallidos a 0
    const okTrasFallo = codigo.apiEntrar(token, '2468', opts);
    assert.ok(okTrasFallo.sesion);
    assert.strictEqual(okTrasFallo.nombre, 'Mateo');
    assert.strictEqual(lab.servicio.listarUsuarios()[0].intentos_fallidos, 0);

    // 4 fallos consecutivos -> intentos_restantes 4, 3, 2, 1
    for (let i = 1; i <= 4; i++) {
      const f = codigo.apiEntrar(token, '9999', opts);
      assert.strictEqual(f.errorCode, 'PIN_INCORRECTO');
      assert.strictEqual(f.intentos_restantes, 5 - i);
    }

    // 5º fallo -> alcanza el límite -> BLOQUEADO con hasta
    const bloqueado5 = codigo.apiEntrar(token, '9999', opts);
    assert.strictEqual(bloqueado5.success, false);
    assert.strictEqual(bloqueado5.errorCode, 'BLOQUEADO');
    assert.ok(bloqueado5.hasta && !isNaN(Date.parse(bloqueado5.hasta)), 'bloqueado debe incluir hasta ISO válido');

    // Intento con PIN correcto durante el bloqueo -> sigue BLOQUEADO con hasta
    const bloqueadoCorrecto = codigo.apiEntrar(token, '2468', opts);
    assert.strictEqual(bloqueadoCorrecto.success, false);
    assert.strictEqual(bloqueadoCorrecto.errorCode, 'BLOQUEADO');
    assert.strictEqual(bloqueadoCorrecto.hasta, bloqueado5.hasta);

    // Excepción inesperada -> ERROR_SERVIDOR sin filtrar mensaje interno
    const resErrorServidor = codigo.apiEntrar(token, '2468', {
      repository: {
        getUsuarios() {
          throw new Error('Fallo interno simulado secreto');
        }
      },
      cache: lab.cache,
      lock: lab.lock
    });
    assert.deepStrictEqual(resErrorServidor, { success: false, errorCode: 'ERROR_SERVIDOR' });
  });

  // -------------------------------------------------------------------------
  // Aceptación 3: tras regenerarEnlace, el token viejo da ENLACE_NO_VALIDO
  // -------------------------------------------------------------------------
  runTest('3. Tras regenerarEnlace el token viejo da ENLACE_NO_VALIDO y el usuario inactivo también', () => {
    const lab = crearLaboratorio({ urlImplementacion: URL_APP_FICTICIA });
    const creado = lab.servicio.crearUsuario('Sofia', 'ENCARGADO');
    const tokenViejo = tokenDeEnlace(creado.enlace);
    lab.servicio.establecerPin(tokenViejo, '1357');
    const opts = lab.opcionesApi();

    const regenerado = lab.servicio.regenerarEnlace(creado.id_usuario);
    const tokenNuevo = tokenDeEnlace(regenerado.enlace);
    assert.notStrictEqual(tokenNuevo, tokenViejo);

    const conViejo = codigo.apiEntrar(tokenViejo, '1357', opts);
    assert.strictEqual(conViejo.success, false);
    assert.strictEqual(conViejo.errorCode, 'ENLACE_NO_VALIDO');

    // Con el nuevo puede fijar PIN; tras desactivar, también da ENLACE_NO_VALIDO
    const conNuevo = codigo.apiEstablecerPin(tokenNuevo, '5678', opts);
    assert.ok(conNuevo.sesion);
    lab.servicio.desactivarUsuario(creado.id_usuario);
    const trasDesactivar = codigo.apiEntrar(tokenNuevo, '5678', opts);
    assert.strictEqual(trasDesactivar.errorCode, 'ENLACE_NO_VALIDO');
  });

  // -------------------------------------------------------------------------
  // Aceptación 4: URL_APP y adminConfigurarUrlApp
  // -------------------------------------------------------------------------
  runTest('4. URL_APP: regenerarEnlace sin urlImplementacion usa URL_APP; adminConfigurarUrlApp valida formato y propietario', () => {
    const lab = crearLaboratorio(); // sin urlImplementacion inyectada
    const anteriorScriptApp = global.ScriptApp;
    global.ScriptApp = {
      getService: () => ({ getUrl: () => URL_DEV_FICTICIA })
    };

    try {
      // Sin ser propietario -> rechaza
      assert.throws(
        () => codigo.adminConfigurarUrlApp(URL_APP_FICTICIA, {
          session: sesionVisitante(),
          propertiesService: lab.properties
        }),
        /Operación reservada al administrador/
      );

      // Rechaza /dev y otros dominios
      assert.throws(
        () => codigo.adminConfigurarUrlApp(URL_DEV_FICTICIA, {
          session: sesionPropietario(),
          propertiesService: lab.properties
        }),
        /exec/
      );
      assert.throws(
        () => codigo.adminConfigurarUrlApp('https://ejemplo.test/macros/s/ABC/exec', {
          session: sesionPropietario(),
          propertiesService: lab.properties
        }),
        /script\.google\.com/
      );

      // Propietario configura URL_APP válida
      const conf = codigo.adminConfigurarUrlApp(URL_APP_FICTICIA, {
        session: sesionPropietario(),
        propertiesService: lab.properties
      });
      assert.strictEqual(conf.nueva, URL_APP_FICTICIA);

      // crearUsuario y regenerarEnlace sin urlImplementacion usan URL_APP (no /dev de ScriptApp)
      const creado = codigo.crearUsuario('Carlos', 'ENCARGADO', {
        session: sesionPropietario(),
        repository: lab.entorno.repo,
        cache: lab.cache,
        clock: lab.reloj,
        lock: lab.lock,
        propertiesService: lab.properties
      });
      assert.ok(creado.enlace.startsWith(URL_APP_FICTICIA + '?k='), `Enlace esperado con URL_APP: ${creado.enlace}`);

      const regenerado = codigo.regenerarEnlace(creado.id_usuario, {
        session: sesionPropietario(),
        repository: lab.entorno.repo,
        cache: lab.cache,
        clock: lab.reloj,
        lock: lab.lock,
        propertiesService: lab.properties
      });
      assert.ok(regenerado.enlace.startsWith(URL_APP_FICTICIA + '?k='), `Enlace regenerado esperado con URL_APP: ${regenerado.enlace}`);
      assert.ok(!regenerado.enlace.includes('/dev'), 'Nunca debe generar enlace /dev cuando URL_APP está configurada');
    } finally {
      global.ScriptApp = anteriorScriptApp;
    }
  });

  // -------------------------------------------------------------------------
  // Aceptación 5: InicioService.fecha_inicio_datos
  // -------------------------------------------------------------------------
  runTest('5. InicioService: stock inicial 23, 24 y 26/11 -> fecha_inicio_datos=26/11 con y sin fecha de corte, días previos null, entradas=0', () => {
    const env = crearEntorno();
    configurarCatalogoMinimo(env.repo);

    const partidas = [
      { fecha: '2026-11-23', cajas: 100 },
      { fecha: '2026-11-24', cajas: 250 },
      { fecha: '2026-11-26', cajas: 400 }
    ];
    for (const p of partidas) {
      env.movService.registrarAjustePositivo({
        codigo_articulo: 'TOMATE PERA I G',
        codigo_envase: 'CARTON 40X30',
        cajas: p.cajas,
        motivo: 'STOCK_INICIAL',
        origen_dato: 'STOCK_INICIAL',
        fecha: p.fecha
      }, 'admin@ejemplo.test');
    }

    const inicioSvc = new InicioService({ repository: env.repo, reloj: () => '2026-11-27' });

    // Caso A: con fecha de corte 2026-11-26
    const propsConCorte = crearPropertiesMemoria({ FECHA_CORTE_IMPORTACION: '2026-11-26' });
    const conCorte = inicioSvc.obtenerInicio({ hoy: '2026-11-27', propertiesService: propsConCorte });
    assert.strictEqual(conCorte.fecha_inicio_datos, '2026-11-26');
    for (const punto of conCorte.serie) {
      assert.strictEqual(punto.entradas, 0, `entradas debe ser 0 el ${punto.fecha}`);
      if (punto.fecha < '2026-11-26') {
        assert.strictEqual(punto.stock, null, `stock debe ser null antes del 26/11 (${punto.fecha})`);
      } else {
        assert.strictEqual(punto.stock, 750, `stock debe ser 750 desde el 26/11 (${punto.fecha})`);
      }
    }

    // Caso B: sin fecha de corte -> toma la más reciente de stock inicial (26/11, no 23/11)
    const propsSinCorte = crearPropertiesMemoria({});
    const sinCorte = inicioSvc.obtenerInicio({ hoy: '2026-11-27', propertiesService: propsSinCorte });
    assert.strictEqual(sinCorte.fecha_inicio_datos, '2026-11-26');
    assert.strictEqual(sinCorte.serie.find(p => p.fecha === '2026-11-23').stock, null);
    assert.strictEqual(sinCorte.serie.find(p => p.fecha === '2026-11-24').stock, null);
    assert.strictEqual(sinCorte.serie.find(p => p.fecha === '2026-11-26').stock, 750);

    // Caso C: si la fecha de corte es posterior al último movimiento de stock inicial (p. ej. 27/11), manda la fecha de corte
    const propsCorte27 = crearPropertiesMemoria({ FECHA_CORTE_IMPORTACION: '2026-11-27' });
    const conCorte27 = inicioSvc.obtenerInicio({ hoy: '2026-11-27', propertiesService: propsCorte27 });
    assert.strictEqual(conCorte27.fecha_inicio_datos, '2026-11-27');
    assert.strictEqual(conCorte27.serie.find(p => p.fecha === '2026-11-26').stock, null);
    assert.strictEqual(conCorte27.serie.find(p => p.fecha === '2026-11-27').stock, 750);
  });

  // -------------------------------------------------------------------------
  // Aceptación 6: interfaz (extrayendo de src/Index.html)
  // -------------------------------------------------------------------------
  await runAsyncTest('6. Interfaz Index.html: guarda sl_sesion (sin PIN), auto-entra con apiComprobarSesion, borra al salir y con ENLACE_NO_VALIDO borra sl_token', async () => {
    // 6.1 Entrar con PIN guarda sl_sesion (nunca el PIN) y Salir la borra
    const ui1 = montarInterfazEntrada({
      localStorage: { sl_token: 'tok-ficticio-1', 'sl_pin_tok-ficticio-1': '1' },
      onApi(fnName, args, resolve) {
        if (fnName === 'apiEntrar') {
          resolve({ sesion: 'ses-ficticia-001', nombre: 'Elena', rol: 'ENCARGADO' });
          return;
        }
        if (fnName === 'apiSalir') {
          resolve({ success: true });
          return;
        }
        resolve({ ok: false });
      }
    });

    // Comprobación estática: aviso fijo del enlace presente y ningún localStorage.setItem guarda el PIN
    assert.ok(
      ui1.html.includes('Para entrar en otro dispositivo usa tu enlace personal (el del mensaje); copiar la dirección del navegador no sirve.'),
      'Falta el aviso fijo sobre el enlace en Index.html'
    );
    const llamadasGuardarAlmacen = ui1.codigoScript.match(/(?:localStorage\.setItem|guardarAlmacen)\s*\([^)]*\)/g) || [];
    for (const llamada of llamadasGuardarAlmacen) {
      assert.ok(!/\bpin\b|\bpinBuffer\b/i.test(llamada), `Ningún setItem puede guardar el PIN: ${llamada}`);
    }

    ui1.teclearPin('4829');
    ui1.elementos.btnEntradaConfirmar.click();
    await flushMicrotasks();

    assert.ok(ui1.storageData.sl_sesion, 'Debe guardar sl_sesion al entrar');
    const sesionGuardada = JSON.parse(ui1.storageData.sl_sesion);
    assert.deepStrictEqual(sesionGuardada, { sesion: 'ses-ficticia-001', nombre: 'Elena', rol: 'ENCARGADO' });
    // Verificar que el PIN 4829 no está en ningún valor de localStorage
    for (const [k, v] of Object.entries(ui1.storageData)) {
      assert.ok(!String(v).includes('4829'), `El PIN no debe guardarse en localStorage (${k})`);
    }
    assert.strictEqual(ui1.elementos.app.style.display, 'flex');

    // Pulsar Salir -> llama a apiSalir y borra sl_sesion
    ui1.elementos.btnSalir.click();
    await flushMicrotasks();
    assert.ok(ui1.llamadasBridge.some(c => c.fnName === 'apiSalir'), 'Salir debe llamar a apiSalir');
    assert.strictEqual(ui1.storageData.sl_sesion, undefined, 'Salir debe borrar sl_sesion');

    // 6.2 Al recargar con sl_sesion válida -> llama a apiComprobarSesion y entra directo sin PIN
    const ui2 = montarInterfazEntrada({
      localStorage: {
        sl_token: 'tok-ficticio-1',
        'sl_pin_tok-ficticio-1': '1',
        sl_sesion: JSON.stringify({ sesion: 'ses-ficticia-002', nombre: 'Elena', rol: 'ENCARGADO' })
      },
      onApi(fnName, args, resolve) {
        if (fnName === 'apiComprobarSesion') {
          resolve({ ok: true, nombre: 'Elena', rol: 'ENCARGADO' });
          return;
        }
        resolve({ ok: false });
      }
    });
    await flushMicrotasks();
    assert.strictEqual(ui2.llamadasBridge[0].fnName, 'apiComprobarSesion');
    assert.strictEqual(ui2.elementos.app.style.display, 'flex');
    assert.strictEqual(ui2.elementos.pantallaEntrada.style.display, 'none');

    // 6.3 Con ENLACE_NO_VALIDO borra sl_token, pasa a sin-token y muestra el mensaje exacto
    const ui3 = montarInterfazEntrada({
      localStorage: { sl_token: 'tok-caducado-9', 'sl_pin_tok-caducado-9': '1' },
      onApi(fnName, args, resolve) {
        if (fnName === 'apiEntrar') {
          resolve({ success: false, errorCode: 'ENLACE_NO_VALIDO' });
          return;
        }
        resolve({ ok: false });
      }
    });
    ui3.teclearPin('1234');
    ui3.elementos.btnEntradaConfirmar.click();
    await flushMicrotasks();
    assert.strictEqual(ui3.storageData.sl_token, undefined, 'ENLACE_NO_VALIDO debe borrar sl_token');
    assert.strictEqual(ui3.storageData['sl_pin_tok-caducado-9'], undefined, 'ENLACE_NO_VALIDO debe borrar sl_pin_<token>');
    assert.strictEqual(ui3.elementos.entradaError.textContent, 'Este enlace ya no vale. Pide uno nuevo al responsable.');
    assert.strictEqual(ui3.elementos.entradaTitulo.textContent, 'Acceso con enlace');

    // 6.4 Mensajes de PIN_INCORRECTO, BLOQUEADO y ERROR_SERVIDOR
    let respuestaActual = { success: false, errorCode: 'PIN_INCORRECTO', intentos_restantes: 3 };
    const ui4 = montarInterfazEntrada({
      localStorage: { sl_token: 'tok-ficticio-4', 'sl_pin_tok-ficticio-4': '1' },
      onApi(fnName, args, resolve) {
        resolve(respuestaActual);
      }
    });

    ui4.teclearPin('1111');
    ui4.elementos.btnEntradaConfirmar.click();
    await flushMicrotasks();
    assert.strictEqual(ui4.elementos.entradaError.textContent, 'PIN incorrecto. Te quedan 3 intentos.');

    respuestaActual = { success: false, errorCode: 'BLOQUEADO', hasta: '14:35' };
    ui4.teclearPin('1111');
    ui4.elementos.btnEntradaConfirmar.click();
    await flushMicrotasks();
    assert.strictEqual(ui4.elementos.entradaError.textContent, 'Demasiados intentos. Prueba otra vez a las 14:35.');

    respuestaActual = { success: false, errorCode: 'ERROR_SERVIDOR' };
    ui4.teclearPin('1111');
    ui4.elementos.btnEntradaConfirmar.click();
    await flushMicrotasks();
    assert.strictEqual(ui4.elementos.entradaError.textContent, 'No se pudo conectar. Inténtalo en un momento.');
  });

  // -------------------------------------------------------------------------
  // Aceptación 7 y textos de Importar
  // -------------------------------------------------------------------------
  runTest('7. Cobertura T-020/T-023 (PERMISOS_API + API_PUBLICA.md) y textos «recepciones» en Importar', () => {
    assert.strictEqual(PERMISOS_API.apiComprobarSesion, 'CONSULTA');
    const apiDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'API_PUBLICA.md'), 'utf8');
    assert.ok(apiDoc.includes('| `apiComprobarSesion` |'), 'apiComprobarSesion debe estar en docs/API_PUBLICA.md');
    assert.ok(apiDoc.includes('| `adminConfigurarUrlApp` |'), 'adminConfigurarUrlApp debe estar en docs/API_PUBLICA.md');

    const importarHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'importar.html'), 'utf8');
    assert.ok(!/compras/i.test(importarHtml), 'src/ui/importar.html no debe mencionar «compras»');
    assert.ok(/recepciones/i.test(importarHtml), 'src/ui/importar.html debe mencionar «recepciones»');
  });

  console.log('\n================================================================');
  console.log(` RESULTADOS SUITE T-042: ${passed} SUPERADAS | ${failed} FALLIDAS`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
