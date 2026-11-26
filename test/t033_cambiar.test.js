/**
 * STOCK-LIGHT — Test Suite T-033: Cambiar, Destrío y Ajustes (Servidor + Cliente)
 *
 * Cubre Precisión 3 (pruebas de servidor de apiRegistrarAjustePartida) y
 * Aceptación 1 (pruebas de cliente de cambiar.html y destrio-ajuste.html).
 *
 * Ejecutable: node test/t033_cambiar.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { crearEntorno } = require('./helpers/mockSheets');
const { InicioService } = require('../src/InicioService');
const { CatalogoService } = require('../src/CatalogoService');
const { CorreccionService } = require('../src/CorreccionService');
const { conContextoDePrueba_, PERMISOS_API, crearServicioAcceso_ } = require('../src/Seguridad');
const codigo = require('../src/Código');

const SRC_DIR = path.resolve(__dirname, '../src');

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
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    failed++;
  }
}

function sembrarDosCapas(env) {
  env.movService.registrarEntrada({
    id_documento: 'DOC-T033-1',
    tipo_documento: 'COMPRA',
    serie: 'ACT27',
    numero: '101',
    fecha_documento: '2026-11-20',
    entidad_nombre: 'FINCA ANTIGUA',
    origen_dato: 'CSV'
  }, [
    { codigo_articulo: 'TOMATE ROSA GRANEL M', codigo_envase: 'CARTON 40X30', cajas: 50, partida: 'P-OLD' }
  ], 'Ana');

  env.movService.registrarEntrada({
    id_documento: 'DOC-T033-2',
    tipo_documento: 'COMPRA',
    serie: 'ACT27',
    numero: '102',
    fecha_documento: '2026-11-24',
    entidad_nombre: 'FINCA NUEVA',
    origen_dato: 'CSV'
  }, [
    { codigo_articulo: 'TOMATE ROSA GRANEL M', codigo_envase: 'CARTON 40X30', cajas: 40, partida: 'P-NEW' }
  ], 'Ana');

  const capas = env.repo.getCapasFifo();
  const antigua = capas.find(c => c.fecha_capa === '2026-11-20');
  const nueva = capas.find(c => c.fecha_capa === '2026-11-24');
  assert.ok(antigua && nueva, 'Deben existir dos capas FIFO');
  return { antigua, nueva };
}

function cargarScriptDeParcialEnVm(nombreArchivo) {
  const html = fs.readFileSync(path.join(SRC_DIR, 'ui', nombreArchivo), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match && match[1], `src/ui/${nombreArchivo} debe contener <script>`);
  const sandbox = {
    window: { innerWidth: 1440, addEventListener: () => {} },
    document: {
      readyState: 'loading',
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox);
  return { window: sandbox.window, html };
}

console.log('================================================================');
console.log(' TEST SUITE T-033 — CAMBIAR, DESTRÍO Y AJUSTES');
console.log('================================================================\n');

// --------------------------------------------------------------------------
// 1. SERVIDOR: Destrío dirigido consume esa partida y no otra más antigua
// --------------------------------------------------------------------------
runTest('1. apiRegistrarAjustePartida consume la partida indicada y NO la más antigua, y mantiene consistencia', () => {
  const env = crearEntorno();
  const { antigua, nueva } = sembrarDosCapas(env);

  const res = conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiRegistrarAjustePartida({
      id_capa: nueva.id_capa,
      signo: -1,
      cajas: 7,
      motivo: 'DESTRIO',
      nota: 'ROTURA: golpe en cámara',
      fecha: '2026-11-26'
    }, {
      repository: env.repo,
      movementService: env.movService,
      lockService: env.lock,
      reloj: () => '2026-11-26'
    })
  );

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.stockAnterior, 90);
  assert.strictEqual(res.stockNuevo, 83);
  assert.ok(res.movimientoId);

  const capasDespues = env.repo.getCapasFifo();
  const cAnt = capasDespues.find(c => c.id_capa === antigua.id_capa);
  const cNue = capasDespues.find(c => c.id_capa === nueva.id_capa);
  assert.strictEqual(Number(cAnt.cajas_restantes), 50, 'La partida más antigua debe quedar intacta (50)');
  assert.strictEqual(Number(cNue.cajas_restantes), 33, 'La partida elegida debe bajar de 40 a 33');

  const cons = env.movService.comprobarConsistencia();
  assert.strictEqual(cons.consistente, true, 'comprobarConsistencia() debe ser true');
});

// --------------------------------------------------------------------------
// 2. SERVIDOR: apiAnularAjuste devuelve las cajas a esa misma partida
// --------------------------------------------------------------------------
runTest('2. apiAnularAjuste devuelve las cajas de un destrío dirigido a la misma partida', () => {
  const env = crearEntorno();
  const { antigua, nueva } = sembrarDosCapas(env);

  const reg = conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiRegistrarAjustePartida({
      id_capa: nueva.id_capa,
      signo: -1,
      cajas: 10,
      motivo: 'DESTRIO',
      nota: 'PODRIDO',
      fecha: '2026-11-26'
    }, {
      repository: env.repo,
      movementService: env.movService,
      lockService: env.lock,
      reloj: () => '2026-11-26'
    })
  );
  assert.strictEqual(reg.success, true);
  assert.strictEqual(Number(env.repo.getCapasFifo().find(c => c.id_capa === nueva.id_capa).cajas_restantes), 30);

  const corrSvc = new CorreccionService({
    repository: env.repo,
    movementService: env.movService,
    lockService: env.lock
  });
  const an = conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiAnularAjuste(reg.movimientoId, 'Error al registrar', {
      repository: env.repo,
      movementService: env.movService,
      correccionService: corrSvc,
      lockService: env.lock
    })
  );
  assert.strictEqual(an.success, true);

  const capasTras = env.repo.getCapasFifo();
  assert.strictEqual(Number(capasTras.find(c => c.id_capa === antigua.id_capa).cajas_restantes), 50);
  assert.strictEqual(Number(capasTras.find(c => c.id_capa === nueva.id_capa).cajas_restantes), 40, 'Las 10 cajas deben volver a la partida nueva');
  assert.strictEqual(env.movService.comprobarConsistencia().consistente, true);
});

// --------------------------------------------------------------------------
// 3. SERVIDOR: Restar de más se rechaza sin cambiar nada
// --------------------------------------------------------------------------
runTest('3. Restar más cajas de las que quedan en la partida se rechaza sin escribir nada', () => {
  const env = crearEntorno();
  const { nueva } = sembrarDosCapas(env);
  const movsAntes = env.repo.getMovimientos().length;

  const res = conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiRegistrarAjustePartida({
      id_capa: nueva.id_capa,
      signo: -1,
      cajas: 45,
      motivo: 'RECUENTO',
      nota: 'Conteo físico',
      fecha: '2026-11-26'
    }, {
      repository: env.repo,
      movementService: env.movService,
      lockService: env.lock,
      reloj: () => '2026-11-26'
    })
  );

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.errorCode, 'STOCK_INSUFICIENTE');
  assert.ok(/40/.test(res.message), 'El mensaje debe indicar cuántas cajas quedan');
  assert.strictEqual(env.repo.getMovimientos().length, movsAntes, 'No debe añadir ningún movimiento');
  assert.strictEqual(Number(env.repo.getCapasFifo().find(c => c.id_capa === nueva.id_capa).cajas_restantes), 40);
});

// --------------------------------------------------------------------------
// 4. SERVIDOR: Seguridad T-020 (sin sesión, CONSULTA denegado, ENCARGADO permitido)
// --------------------------------------------------------------------------
runTest('4. apiRegistrarAjustePartida exige sesión, rechaza CONSULTA y permite ENCARGADO', () => {
  assert.strictEqual(PERMISOS_API.apiRegistrarAjustePartida, 'ENCARGADO');
  assert.strictEqual(PERMISOS_API.apiListarCombinacionesCatalogo, 'CONSULTA');
  assert.throws(() => codigo.apiRegistrarAjustePartida({ id_capa: 'X', signo: -1, cajas: 1, motivo: 'DESTRIO' }), /Acceso no autorizado/);

  const env = crearEntorno();
  const { nueva } = sembrarDosCapas(env);
  const cacheMap = new Map();
  const acceso = crearServicioAcceso_({
    repository: env.repo,
    cache: {
      get: k => cacheMap.get(k) || null,
      put: (k, v) => cacheMap.set(k, v),
      remove: k => cacheMap.delete(k)
    },
    lock: env.lock,
    urlImplementacion: 'https://ejemplo.local/exec'
  });

  const uCons = acceso.crearUsuario('Lucia', 'CONSULTA');
  const sCons = acceso.establecerPin(new URL(uCons.enlace).searchParams.get('k'), '1234');
  const uEnc = acceso.crearUsuario('Mario', 'ENCARGADO');
  const sEnc = acceso.establecerPin(new URL(uEnc.enlace).searchParams.get('k'), '5678');

  const origCrear = global.crearServicioAcceso_;
  global.crearServicioAcceso_ = () => acceso;
  try {
    const resCons = codigo.apiLlamar(sCons.sesion, 'apiRegistrarAjustePartida', [{
      id_capa: nueva.id_capa, signo: -1, cajas: 2, motivo: 'DESTRIO', fecha: '2026-11-26'
    }]);
    assert.strictEqual(resCons.success, false);
    assert.strictEqual(resCons.errorCode, 'PERMISO_DENEGADO');

    const resCatCons = codigo.apiLlamar(sCons.sesion, 'apiListarCombinacionesCatalogo', [{ repository: env.repo }]);
    assert.ok(Array.isArray(resCatCons.combinaciones) && resCatCons.combinaciones.length >= 1);

    const resEnc = codigo.apiLlamar(sEnc.sesion, 'apiRegistrarAjustePartida', [
      { id_capa: nueva.id_capa, signo: -1, cajas: 2, motivo: 'DESTRIO', fecha: '2026-11-26' },
      { repository: env.repo, movementService: env.movService, lockService: env.lock, reloj: () => '2026-11-26' }
    ]);
    assert.strictEqual(resEnc.success, true);
  } finally {
    global.crearServicioAcceso_ = origCrear;
  }
});

// --------------------------------------------------------------------------
// 5. SERVIDOR: El destrío dirigido cuenta en destrio7 de InicioService
// --------------------------------------------------------------------------
runTest('5. El destrío dirigido con motivo DESTRIO cuenta en destrio7 de InicioService', () => {
  const env = crearEntorno();
  const { nueva } = sembrarDosCapas(env);
  const catSvc = new CatalogoService({ repository: env.repo });
  const inicioSvc = new InicioService({
    repository: env.repo,
    catalogoService: catSvc,
    reloj: () => '2026-11-26'
  });

  const antes = inicioSvc.obtenerInicio();
  assert.strictEqual(antes.destrio7, 0);

  conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiRegistrarAjustePartida({
      id_capa: nueva.id_capa,
      signo: -1,
      cajas: 6,
      motivo: 'DESTRIO',
      nota: 'CALIDAD',
      fecha: '2026-11-26'
    }, {
      repository: env.repo,
      movementService: env.movService,
      lockService: env.lock,
      reloj: () => '2026-11-26'
    })
  );

  const despues = inicioSvc.obtenerInicio();
  assert.strictEqual(despues.destrio7, 6, 'destrio7 debe sumar las 6 cajas de destrío');
});

// --------------------------------------------------------------------------
// 6. SERVIDOR: Validación de fecha futura y nota obligatoria con OTRO
// --------------------------------------------------------------------------
runTest('6. apiRegistrarAjustePartida rechaza fecha futura y motivo OTRO sin nota', () => {
  const env = crearEntorno();
  const { nueva } = sembrarDosCapas(env);

  assert.throws(() => conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiRegistrarAjustePartida({
      id_capa: nueva.id_capa, signo: -1, cajas: 2, motivo: 'DESTRIO', fecha: '2026-11-27'
    }, { repository: env.repo, movementService: env.movService, lockService: env.lock, reloj: () => '2026-11-26' })
  ), /futura/);

  assert.throws(() => conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiRegistrarAjustePartida({
      id_capa: nueva.id_capa, signo: 1, cajas: 2, motivo: 'OTRO', nota: '', fecha: '2026-11-26'
    }, { repository: env.repo, movementService: env.movService, lockService: env.lock, reloj: () => '2026-11-26' })
  ), /nota/);
});

// --------------------------------------------------------------------------
// 7. CLIENTE: Sugerencia rellena destino con origen × proporción redondeado
// --------------------------------------------------------------------------
runTest('7. Al elegir una sugerencia, el destino se rellena con origen × proporción redondeado a entero', () => {
  const { window: win } = cargarScriptDeParcialEnVm('cambiar.html');
  const sug = {
    destinos: [{ articulo: 'TOMATE ROSA 500G', envase: 'EPS 106 9X500', proporcion: 1.43 }],
    proporcion_total: 1.43
  };
  const r60 = win.SLCambiar.calcularDestinoSugerido(60, sug);
  assert.strictEqual(r60[0].cajas, 86, '60 × 1.43 = 85.8 → 86');

  const r10 = win.SLCambiar.calcularDestinoSugerido(10, {
    destinos: [{ articulo: 'TOMATE RAMA 500G', envase: 'EPS 106', proporcion: 1 }],
    proporcion_total: 1
  });
  assert.strictEqual(r10[0].cajas, 10, '10 × 1 = 10');
});

// --------------------------------------------------------------------------
// 8. CLIENTE: Destrío obligatorio si cambia envase, 0 válido y botón «Sin destrío»
// --------------------------------------------------------------------------
runTest('8. Destrío obligatorio al cambiar de envase, 0 válido y botón «Sin destrío» pone 0', () => {
  const { window: win, html } = cargarScriptDeParcialEnVm('cambiar.html');
  const base = {
    origenes: [{ id_capa: 'C1', articulo: 'TOMATE RAMA EXTRA M', envase: 'CARTON 40X30', disponibles: 50, cajas: 20 }],
    destinos: [{ articulo: 'TOMATE RAMA 500G', envase: 'EPS 106 9X500', cajas: 20 }],
    fecha: '2026-11-26',
    hoy: '2026-11-26'
  };

  assert.strictEqual(win.SLCambiar.cambiaEnvase(base.origenes, base.destinos), true);

  const sinDestrioCampoVacio = win.SLCambiar.validarCambio(Object.assign({}, base, { destrioCajasRaw: '' }));
  assert.strictEqual(sinDestrioCampoVacio.ok, false, 'Debe rechazar destrío vacío cuando cambia de envase');
  assert.ok(/destrío/i.test(sinDestrioCampoVacio.error));

  const conCero = win.SLCambiar.validarCambio(Object.assign({}, base, { destrioCajasRaw: '0' }));
  assert.strictEqual(conCero.ok, true, '0 debe ser válido al cambiar de envase');
  assert.strictEqual(conCero.destrioCajas, 0);

  // Botón «Sin destrío» presente en ordenador y móvil y asigna '0'
  assert.ok(html.includes('id="btnChgSinDestrio"') && html.includes('Sin destrío'));
  assert.ok(html.includes("St.destrioCajasRaw = '0'"));
});

// --------------------------------------------------------------------------
// 9. CLIENTE: Fecha futura rechazada en Cambiar y en Destrío/Ajuste
// --------------------------------------------------------------------------
runTest('9. La fecha futura se rechaza en Cambiar y en Destrío/Ajuste', () => {
  const { window: winChg } = cargarScriptDeParcialEnVm('cambiar.html');
  const resChg = winChg.SLCambiar.validarCambio({
    origenes: [{ id_capa: 'C1', articulo: 'TOMATE A', envase: 'CARTON', disponibles: 50, cajas: 10 }],
    destinos: [{ articulo: 'TOMATE B', envase: 'CARTON', cajas: 10 }],
    destrioCajasRaw: '0',
    fecha: '2026-11-27',
    hoy: '2026-11-26'
  });
  assert.strictEqual(resChg.ok, false);
  assert.ok(/futura/i.test(resChg.error));

  const { window: winDa } = cargarScriptDeParcialEnVm('destrio-ajuste.html');
  const resDa = winDa.SLDestrioAjuste.validarOperacionDestrioAjuste({
    modo: 'DESTRIO',
    signo: -1,
    cajas: 3,
    disponibles: 20,
    motivo: 'ROTURA',
    nota: '',
    fecha: '2026-11-27',
    hoy: '2026-11-26'
  });
  assert.strictEqual(resDa.ok, false);
  assert.ok(/futura/i.test(resDa.error));
});

// --------------------------------------------------------------------------
// 10. CLIENTE: CONSULTA no ve botones de Cambiar, Destrío ni Ajuste
// --------------------------------------------------------------------------
runTest('10. CONSULTA no tiene botones de Cambiar, Destrío ni Ajuste', () => {
  const indexHtml = fs.readFileSync(path.join(SRC_DIR, 'Index.html'), 'utf8');
  const cambiarHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'cambiar.html'), 'utf8');
  const daHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'destrio-ajuste.html'), 'utf8');

  assert.ok(/id="navCambios"[^>]*data-solo-escritura="1"/.test(indexHtml), '#navCambios debe llevar data-solo-escritura="1"');
  assert.ok(/id="btnChgConfirmar"[^>]*data-solo-escritura="1"/.test(cambiarHtml), '#btnChgConfirmar debe llevar data-solo-escritura="1"');
  assert.ok(/id="btnChgMobConfirmar"[^>]*data-solo-escritura="1"/.test(cambiarHtml), '#btnChgMobConfirmar debe llevar data-solo-escritura="1"');
  assert.ok(/id="btnDaAccion"[^>]*data-solo-escritura="1"/.test(daHtml), '#btnDaAccion debe llevar data-solo-escritura="1"');
  assert.ok(daHtml.includes("setAttribute('data-solo-escritura', '1')"), 'Los botones Ajuste inyectados deben llevar data-solo-escritura="1"');
  assert.ok(cambiarHtml.includes("est.rol === 'CONSULTA'"), 'SLCambiar.abrir debe bloquear CONSULTA');
  assert.ok(daHtml.includes("est.rol === 'CONSULTA'"), 'SLDestrioAjuste debe bloquear CONSULTA');
});

// --------------------------------------------------------------------------
// 11. CORRECCIÓN: Anular ajuste POSITIVO dirigido a una partida
// --------------------------------------------------------------------------
runTest('11. Sumar 5 a una partida y anular con apiAnularAjuste vuelve a su valor y no toca las demás', () => {
  const env = crearEntorno();
  const { antigua, nueva } = sembrarDosCapas(env);

  const reg = conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiRegistrarAjustePartida({
      id_capa: nueva.id_capa,
      signo: 1,
      cajas: 5,
      motivo: 'RECUENTO',
      nota: 'Sobraban 5 cajas en cámara',
      fecha: '2026-11-26'
    }, {
      repository: env.repo,
      movementService: env.movService,
      lockService: env.lock,
      reloj: () => '2026-11-26'
    })
  );
  assert.strictEqual(reg.success, true);
  assert.strictEqual(Number(env.repo.getCapasFifo().find(c => c.id_capa === antigua.id_capa).cajas_restantes), 50);
  assert.strictEqual(Number(env.repo.getCapasFifo().find(c => c.id_capa === nueva.id_capa).cajas_restantes), 45);
  assert.strictEqual(env.movService.comprobarConsistencia().consistente, true);

  const corrSvc = new CorreccionService({
    repository: env.repo,
    movementService: env.movService,
    lockService: env.lock
  });

  const prev = conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiPrevisualizarAnularAjuste(reg.movimientoId, {
      repository: env.repo,
      movementService: env.movService,
      correccionService: corrSvc,
      lockService: env.lock
    })
  );
  assert.strictEqual(prev.posible, true);
  assert.strictEqual(prev.partidas_bajan.length, 1);
  assert.strictEqual(prev.partidas_bajan[0].id_capa, nueva.id_capa);
  assert.strictEqual(prev.partidas_bajan[0].cajas, 5);

  const an = conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiAnularAjuste(reg.movimientoId, 'Error en recuento', {
      repository: env.repo,
      movementService: env.movService,
      correccionService: corrSvc,
      lockService: env.lock
    })
  );
  assert.strictEqual(an.success, true);

  const capasTras = env.repo.getCapasFifo();
  assert.strictEqual(Number(capasTras.find(c => c.id_capa === antigua.id_capa).cajas_restantes), 50, 'La partida antigua no debe cambiar');
  assert.strictEqual(Number(capasTras.find(c => c.id_capa === nueva.id_capa).cajas_restantes), 40, 'La partida nueva debe volver a 40');
  assert.strictEqual(env.movService.comprobarConsistencia().consistente, true, 'comprobarConsistencia() debe ser true');
});

// --------------------------------------------------------------------------
// 12. CORRECCIÓN: Sumar a partida, vender todo y anular → rechazado sin cambios
// --------------------------------------------------------------------------
runTest('12. Sumar a una partida, vender todo y anular se rechaza con motivo claro y sin cambios', () => {
  const env = crearEntorno();
  const { antigua, nueva } = sembrarDosCapas(env);

  const reg = conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiRegistrarAjustePartida({
      id_capa: nueva.id_capa,
      signo: 1,
      cajas: 5,
      motivo: 'RECUENTO',
      nota: 'Recuento inicial',
      fecha: '2026-11-26'
    }, {
      repository: env.repo,
      movementService: env.movService,
      lockService: env.lock,
      reloj: () => '2026-11-26'
    })
  );
  assert.strictEqual(reg.success, true);

  // Vender todo el stock (50 + 45 = 95 cajas)
  const sal = env.movService.registrarSalida({
    id_documento: 'DOC-T033-SAL-ALL',
    tipo_documento: 'SALIDA',
    serie: 'AVT27',
    numero: '999',
    fecha_documento: '2026-11-26',
    entidad_nombre: 'CLIENTE TOTAL',
    origen_dato: 'CSV'
  }, [
    { codigo_articulo: 'TOMATE ROSA GRANEL M', codigo_envase: 'CARTON 40X30', cajas: 95 }
  ], 'Ana');
  assert.strictEqual(sal.success, true);

  const movsAntes = env.repo.getMovimientos().length;
  const corrSvc = new CorreccionService({
    repository: env.repo,
    movementService: env.movService,
    lockService: env.lock
  });

  const prev = conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiPrevisualizarAnularAjuste(reg.movimientoId, {
      repository: env.repo,
      movementService: env.movService,
      correccionService: corrSvc,
      lockService: env.lock
    })
  );
  assert.strictEqual(prev.posible, false);
  assert.ok(/ya han salido de la partida/i.test(prev.motivo), `Motivo esperado claro, recibido: ${prev.motivo}`);

  const an = conContextoDePrueba_('Mario', 'ENCARGADO', () =>
    codigo.apiAnularAjuste(reg.movimientoId, 'Intentar anular vendido', {
      repository: env.repo,
      movementService: env.movService,
      correccionService: corrSvc,
      lockService: env.lock
    })
  );
  assert.strictEqual(an.success, false);
  assert.ok(/ya han salido de la partida/i.test(an.message));
  assert.strictEqual(env.repo.getMovimientos().length, movsAntes, 'No debe escribir ningún movimiento');
  assert.strictEqual(Number(env.repo.getCapasFifo().find(c => c.id_capa === antigua.id_capa).cajas_restantes), 0);
  assert.strictEqual(Number(env.repo.getCapasFifo().find(c => c.id_capa === nueva.id_capa).cajas_restantes), 0);
  assert.strictEqual(env.movService.comprobarConsistencia().consistente, true, 'comprobarConsistencia() debe ser true');
});

console.log('\n================================================================');
console.log(` RESULTADOS T-033 (CAMBIAR/DESTRÍO/AJUSTES): ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
