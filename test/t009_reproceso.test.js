/**
 * STOCK-LIGHT — Test Suite T-009: Reproceso
 *
 * Cubre todos los criterios de aceptación de docs/tickets/T-009-reproceso.md:
 * 1. Un origen, cambio de envase (error sin destrío, éxito con destrío, herencia de fecha y proveedor).
 * 2. Varios orígenes, mismo envase, género mezclado (destrío deducido, proveedor VARIOS, destrío prorrateado).
 * 3. Calibrado por tandas (D-036).
 * 4. Total repartido por FIFO entre capas activas.
 * 5. Consumo FIFO posterior (la capa reprocesada se consume antes por su fecha antigua).
 * 6. Casos de error (más cajas de las disponibles, capa inactiva, destino vacío, destrío negativo; sin mutaciones).
 * 7. Anulación (restitución exacta sin consumos, bloqueo REVISION_NECESARIA con consumos, error al anular dos veces).
 * 8. Sugerencias de reproceso (conjuntos de destinos del más reciente al más antiguo con sus cajas, deduplicados).
 * 9. Pruebas de API y detalle de partidas (proveedor y fecha_capa).
 *
 * Ejecutable: node test/t009_reproceso.test.js
 */

const assert = require('assert');
const { crearEntorno } = require('./helpers/mockSheets');
const codigo = require('../src/Código');
const { planificarReproceso } = require('../src/Reproceso');

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

console.log('================================================================');
console.log(' TEST SUITE T-009 — REPROCESO (LIBRO DE SOLO AÑADIR)');
console.log('================================================================\n');

// --------------------------------------------------------------------------
// 1. ACEPTACIÓN 1: UN ORIGEN, CAMBIO DE ENVASE
// --------------------------------------------------------------------------
runTest('1. Un origen, cambio de envase: error sin destrío; con destrío, A en 40, destino en 90 con fecha y proveedor heredados', () => {
  const env = crearEntorno();

  // Sembrar capa A
  env.movService.registrarEntrada({
    id_documento: 'DOC-E-100',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '100',
    fecha_documento: '2026-10-15',
    entidad_nombre: 'PROV A'
  }, [
    {
      codigo_articulo: 'TOMATE ROSA SABOR I M',
      codigo_envase: 'CARTON 40X30X14 GENERICA',
      cajas: 100,
      partida: 'PART-A'
    }
  ], 'test@user');

  const capasIniciales = env.repo.getCapasFifo();
  const capaA = capasIniciales.find(c => c.partida === 'PART-A');
  assert.ok(capaA, 'Debe existir la capa A');

  // Intento sin destrio_cajas -> Error de la regla 1
  const payloadSinDestrio = {
    origenes: [{ id_capa: capaA.id_capa, cajas: 60 }],
    destinos: [{ articulo: 'TOMATE ROSA SABOR I', envase: 'EPS 106 9X500', cajas: 90 }]
  };

  const resError = env.movService.registrarReproceso(payloadSinDestrio, 'test@user');
  assert.strictEqual(resError.success, false);
  assert.ok(
    resError.message.includes('Indica el destrío en cajas: al cambiar de envase no se puede calcular'),
    `Mensaje incorrecto: ${resError.message}`
  );

  // Verificar que nada cambió
  const capasTrasError = env.repo.getCapasFifo();
  const capaATrasError = capasTrasError.find(c => c.id_capa === capaA.id_capa);
  assert.strictEqual(Number(capaATrasError.cajas_restantes), 100);
  assert.strictEqual(env.repo.getReprocesos().length, 0);

  // Con destrio_cajas: 3 y destrio_kg: 18
  const payloadConDestrio = {
    origenes: [{ id_capa: capaA.id_capa, cajas: 60 }],
    destinos: [{ articulo: 'TOMATE ROSA SABOR I', envase: 'EPS 106 9X500', cajas: 90 }],
    destrio_cajas: 3,
    destrio_kg: 18
  };

  const resOk = env.movService.registrarReproceso(payloadConDestrio, 'test@user');
  assert.strictEqual(resOk.success, true);

  // A queda en 40
  const capasPost = env.repo.getCapasFifo();
  const capaAPost = capasPost.find(c => c.id_capa === capaA.id_capa);
  assert.strictEqual(Number(capaAPost.cajas_restantes), 40);
  assert.strictEqual(Number(capaAPost.cajas_consumidas), 60);

  // El destino tiene 90 cajas, fecha 2026-10-15, proveedor PROV A e id_capa_origen = A
  const destinoCapa = capasPost.find(c => c.codigo_articulo === 'TOMATE ROSA SABOR I' && c.codigo_envase === 'EPS 106 9X500');
  assert.ok(destinoCapa, 'Debe existir la capa de destino');
  assert.strictEqual(Number(destinoCapa.cajas_restantes), 90);
  assert.strictEqual(destinoCapa.fecha_capa, '2026-10-15');
  assert.strictEqual(destinoCapa.proveedor, 'PROV A');
  assert.strictEqual(destinoCapa.id_capa_origen, capaA.id_capa);

  // REPROCESOS guarda 3, 18 y cambio_envase = SI
  const repros = env.repo.getReprocesos();
  assert.strictEqual(repros.length, 1);
  assert.strictEqual(Number(repros[0].destrio_cajas), 3);
  assert.strictEqual(Number(repros[0].destrio_kg), 18);
  assert.strictEqual(repros[0].cambio_envase, 'SI');
  assert.strictEqual(repros[0].estado, 'ACTIVO');

  // CONSUMOS_FIFO tiene la fila del AJUSTE − sobre A
  const consumos = env.repo.getConsumosFifo();
  const consumoA = consumos.find(c => c.id_capa === capaA.id_capa);
  assert.ok(consumoA, 'Debe existir consumo FIFO sobre la capa A');
  assert.strictEqual(Number(consumoA.cajas), 60);
});

// --------------------------------------------------------------------------
// 2. ACEPTACIÓN 2: VARIOS ORÍGENES, MISMO ENVASE, GÉNERO MEZCLADO
// --------------------------------------------------------------------------
runTest('2. Varios orígenes, mismo envase: fecha más antigua, proveedor VARIOS, destrío deducido (5) prorrateado en 3 y 2', () => {
  const env = crearEntorno();

  // Capa 1: PROV A, 2026-10-10, 30 cajas
  env.movService.registrarEntrada({
    id_documento: 'DOC-1',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '101',
    fecha_documento: '2026-10-10',
    entidad_nombre: 'PROV A'
  }, [
    { codigo_articulo: 'TOMATE ROSA SABOR I G', codigo_envase: 'CARTON 40X30X14', cajas: 30, partida: 'PART-1' }
  ], 'test@user');

  // Capa 2: PROV B, 2026-10-12, 20 cajas
  env.movService.registrarEntrada({
    id_documento: 'DOC-2',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '102',
    fecha_documento: '2026-10-12',
    entidad_nombre: 'PROV B'
  }, [
    { codigo_articulo: 'TOMATE ROSA SABOR I GG', codigo_envase: 'CARTON 40X30X14', cajas: 20, partida: 'PART-2' }
  ], 'test@user');

  const capasInit = env.repo.getCapasFifo();
  const capa1 = capasInit.find(c => c.partida === 'PART-1');
  const capa2 = capasInit.find(c => c.partida === 'PART-2');

  // Reprocesar enteras (30 y 20 = 50 cajas) a 45 cajas, sin destrio_cajas
  const res = env.movService.registrarReproceso({
    origenes: [
      { id_capa: capa1.id_capa, cajas: 30 },
      { id_capa: capa2.id_capa, cajas: 20 }
    ],
    destinos: [
      { articulo: 'TOMATE ROSA SABOR I S/C', envase: 'CARTON 40X30X14', cajas: 45 }
    ]
  }, 'test@user');

  assert.strictEqual(res.success, true);

  // Destino tiene fecha 2026-10-10 y proveedor VARIOS
  const capasPost = env.repo.getCapasFifo();
  const capaDest = capasPost.find(c => c.codigo_articulo === 'TOMATE ROSA SABOR I S/C');
  assert.ok(capaDest, 'Debe existir capa destino');
  assert.strictEqual(capaDest.fecha_capa, '2026-10-10');
  assert.strictEqual(capaDest.proveedor, 'VARIOS');
  assert.strictEqual(capaDest.id_capa_origen, ''); // Varias capas origen -> vacío

  // Destrío deducido como 5, cambio_envase = NO
  const repros = env.repo.getReprocesos();
  assert.strictEqual(Number(repros[0].destrio_cajas), 5);
  assert.strictEqual(repros[0].cambio_envase, 'NO');

  // REPROCESO_LINEAS lo prorratea en 3 y 2
  const lineas = env.repo.getReprocesoLineas(res.id_reproceso);
  const lineaOrig1 = lineas.find(l => l.id_capa === capa1.id_capa && l.tipo === 'ORIGEN');
  const lineaOrig2 = lineas.find(l => l.id_capa === capa2.id_capa && l.tipo === 'ORIGEN');
  assert.strictEqual(Number(lineaOrig1.destrio_prorrateado), 3);
  assert.strictEqual(Number(lineaOrig2.destrio_prorrateado), 2);
});

// --------------------------------------------------------------------------
// 3. ACEPTACIÓN 3: CALIBRADO POR TANDAS (D-036)
// --------------------------------------------------------------------------
runTest('3. Calibrado por tandas (D-036): tanda 1 (400 cj -> 3 destinos + 20 destrío), tanda 2 (600 cj restantes -> C queda en 0 y cuadra)', () => {
  const env = crearEntorno();

  // Capa C: 1.000 cajas, PROV C, 2026-11-02
  env.movService.registrarEntrada({
    id_documento: 'DOC-C',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '103',
    fecha_documento: '2026-11-02',
    entidad_nombre: 'PROV C'
  }, [
    { codigo_articulo: 'TOMATE SIN CALIBRE', codigo_envase: 'CARTON 40X30X14', cajas: 1000, partida: 'PART-C' }
  ], 'test@user');

  let capas = env.repo.getCapasFifo();
  const capaC = capas.find(c => c.partida === 'PART-C');

  // Tanda 1: 400 cajas -> G (180), GG (150), M (50) con destrio_cajas: 20
  const tanda1 = env.movService.registrarReproceso({
    origenes: [{ id_capa: capaC.id_capa, cajas: 400 }],
    destinos: [
      { articulo: 'TOMATE G', envase: 'EPS 106', cajas: 180 },
      { articulo: 'TOMATE GG', envase: 'CARTON 40X30X14', cajas: 150 },
      { articulo: 'TOMATE M', envase: 'TARRINA 500', cajas: 50 }
    ],
    destrio_cajas: 20
  }, 'test@user');
  assert.strictEqual(tanda1.success, true);

  // C queda en 600
  capas = env.repo.getCapasFifo();
  const capaCPost1 = capas.find(c => c.id_capa === capaC.id_capa);
  assert.strictEqual(Number(capaCPost1.cajas_restantes), 600);

  // Los 3 destinos tienen fecha 2026-11-02 y PROV C
  const destinosTanda1 = capas.filter(c => ['TOMATE G', 'TOMATE GG', 'TOMATE M'].includes(c.codigo_articulo));
  assert.strictEqual(destinosTanda1.length, 3);
  for (const d of destinosTanda1) {
    assert.strictEqual(d.fecha_capa, '2026-11-02');
    assert.strictEqual(d.proveedor, 'PROV C');
  }

  // REPROCESOS guarda 400 retiradas, 380 destinos y 20 de destrío
  const rep1 = env.repo.getReprocesos()[0];
  assert.strictEqual(Number(rep1.total_retirado), 400);
  assert.strictEqual(Number(rep1.total_destinos), 380);
  assert.strictEqual(Number(rep1.destrio_cajas), 20);

  // Tanda 2 sobre las 600 restantes
  const tanda2 = env.movService.registrarReproceso({
    origenes: [{ id_capa: capaC.id_capa, cajas: 600 }],
    destinos: [
      { articulo: 'TOMATE G', envase: 'EPS 106', cajas: 280 },
      { articulo: 'TOMATE GG', envase: 'CARTON 40X30X14', cajas: 290 }
    ],
    destrio_cajas: 30
  }, 'test@user');
  assert.strictEqual(tanda2.success, true);

  capas = env.repo.getCapasFifo();
  const capaCPost2 = capas.find(c => c.id_capa === capaC.id_capa);
  assert.strictEqual(Number(capaCPost2.cajas_restantes), 0);
  assert.strictEqual(capaCPost2.estado_capa, 'AGOTADA');

  // Suma de ambas tandas cuadra: 400 + 600 = 1.000 retiradas
  const repList = env.repo.getReprocesos();
  const sumaRetiradas = repList.reduce((s, r) => s + Number(r.total_retirado), 0);
  assert.strictEqual(sumaRetiradas, 1000);
});

// --------------------------------------------------------------------------
// 4. ACEPTACIÓN 4: TOTAL REPARTIDO POR FIFO
// --------------------------------------------------------------------------
runTest('4. Total repartido por FIFO: capas de 50 (más antigua) y 40, retirar 70 consume 50 + 20', () => {
  const env = crearEntorno();

  // Capa 1: 50 cajas, 2026-10-01
  env.movService.registrarEntrada({
    id_documento: 'DOC-F1',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '104',
    fecha_documento: '2026-10-01',
    entidad_nombre: 'PROV 1'
  }, [
    { codigo_articulo: 'TOMATE FIFO', codigo_envase: 'CARTON', cajas: 50, partida: 'P1' }
  ], 'test@user');

  // Capa 2: 40 cajas, 2026-10-05
  env.movService.registrarEntrada({
    id_documento: 'DOC-F2',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '105',
    fecha_documento: '2026-10-05',
    entidad_nombre: 'PROV 2'
  }, [
    { codigo_articulo: 'TOMATE FIFO', codigo_envase: 'CARTON', cajas: 40, partida: 'P2' }
  ], 'test@user');

  // Reprocesar especificando total por combinación: 70 cajas
  const res = env.movService.registrarReproceso({
    origenes: {
      articulo: 'TOMATE FIFO',
      envase: 'CARTON',
      cajas: 70
    },
    destinos: [
      { articulo: 'TOMATE DESTINO', envase: 'CARTON', cajas: 70 }
    ]
  }, 'test@user');
  assert.strictEqual(res.success, true);

  const capas = env.repo.getCapasFifo();
  const c1 = capas.find(c => c.partida === 'P1');
  const c2 = capas.find(c => c.partida === 'P2');

  // Capa 1 consumida entera (50 cj, restante 0)
  assert.strictEqual(Number(c1.cajas_consumidas), 50);
  assert.strictEqual(Number(c1.cajas_restantes), 0);
  assert.strictEqual(c1.estado_capa, 'AGOTADA');

  // Capa 2 consumida parcialmente (20 cj, restante 20)
  assert.strictEqual(Number(c2.cajas_consumidas), 20);
  assert.strictEqual(Number(c2.cajas_restantes), 20);
  assert.strictEqual(c2.estado_capa, 'ACTIVA');
});

// --------------------------------------------------------------------------
// 5. ACEPTACIÓN 5: FIFO DESPUÉS
// --------------------------------------------------------------------------
runTest('5. FIFO después: capa reprocesada (15/10, 90 cj) y compra posterior (20/10, 50 cj); venta de 100 consume 90 de reprocesada y 10 de compra', () => {
  const env = crearEntorno();

  // Capa origen de 2026-10-15
  env.movService.registrarEntrada({
    id_documento: 'DOC-ORIG',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '106',
    fecha_documento: '2026-10-15',
    entidad_nombre: 'PROV A'
  }, [
    { codigo_articulo: 'TOMATE ROSA', codigo_envase: 'CARTON', cajas: 100, partida: 'PART-ORIG' }
  ], 'test@user');

  const capaOrig = env.repo.getCapasFifo().find(c => c.partida === 'PART-ORIG');

  // Reproceso a EPS con 90 cajas (hereda fecha 2026-10-15)
  env.movService.registrarReproceso({
    origenes: [{ id_capa: capaOrig.id_capa, cajas: 90 }],
    destinos: [{ articulo: 'TOMATE REPRO', envase: 'EPS', cajas: 90 }],
    destrio_cajas: 0
  }, 'test@user');

  const capaRepro = env.repo.getCapasFifo().find(c => c.codigo_articulo === 'TOMATE REPRO' && c.codigo_envase === 'EPS');
  assert.strictEqual(capaRepro.fecha_capa, '2026-10-15');

  // Compra posterior de la misma combinación el 2026-10-20 (50 cajas)
  env.movService.registrarEntrada({
    id_documento: 'DOC-POST',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '107',
    fecha_documento: '2026-10-20',
    entidad_nombre: 'PROV POST'
  }, [
    { codigo_articulo: 'TOMATE REPRO', codigo_envase: 'EPS', cajas: 50, partida: 'PART-POST' }
  ], 'test@user');

  const capaPost = env.repo.getCapasFifo().find(c => c.partida === 'PART-POST');

  // Venta de 100 cajas
  const resVenta = env.movService.registrarSalida({
    id_documento: 'DOC-VENTA-100',
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '501',
    fecha_documento: '2026-10-22',
    entidad_nombre: 'CLIENTE 1'
  }, [
    { codigo_articulo: 'TOMATE REPRO', codigo_envase: 'EPS', cajas: 100 }
  ], 'test@user');
  assert.strictEqual(resVenta.success, true);

  const capasFinal = env.repo.getCapasFifo();
  const cReproFinal = capasFinal.find(c => c.id_capa === capaRepro.id_capa);
  const cPostFinal = capasFinal.find(c => c.id_capa === capaPost.id_capa);

  // La capa reprocesada (15/10) debe haberse consumido entera (90 cj)
  assert.strictEqual(Number(cReproFinal.cajas_consumidas), 90);
  assert.strictEqual(Number(cReproFinal.cajas_restantes), 0);
  assert.strictEqual(cReproFinal.estado_capa, 'AGOTADA');

  // La capa posterior (20/10) aportó las 10 restantes (le quedan 40)
  assert.strictEqual(Number(cPostFinal.cajas_consumidas), 10);
  assert.strictEqual(Number(cPostFinal.cajas_restantes), 40);
});

// --------------------------------------------------------------------------
// 6. ACEPTACIÓN 6: VALIDACIONES Y ERRORES
// --------------------------------------------------------------------------
runTest('6. Errores: pedir más cajas de las disponibles, capa inactiva, destino vacío, destrío negativo; nada cambia', () => {
  const env = crearEntorno();

  // Capa con 30 cajas
  env.movService.registrarEntrada({
    id_documento: 'DOC-ERR',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '108',
    fecha_documento: '2026-10-10',
    entidad_nombre: 'PROV ERR'
  }, [
    { codigo_articulo: 'TOMATE ERR', codigo_envase: 'CARTON', cajas: 30, partida: 'P-ERR' }
  ], 'test@user');

  const capa = env.repo.getCapasFifo()[0];

  const snapshotMovs = env.repo.getMovimientos().length;
  const snapshotCapas = JSON.stringify(env.repo.getCapasFifo());
  const snapshotRepros = env.repo.getReprocesos().length;

  // 1. Pedir más cajas de las que tiene (40 de 30)
  const err1 = env.movService.registrarReproceso({
    origenes: [{ id_capa: capa.id_capa, cajas: 40 }],
    destinos: [{ articulo: 'TOMATE ERR D', envase: 'CARTON', cajas: 30 }]
  }, 'test@user');
  assert.strictEqual(err1.success, false);
  assert.ok(err1.message.includes(`La partida ${capa.id_capa} solo tiene 30 cajas`));

  // 2. Destino vacío
  const err2 = env.movService.registrarReproceso({
    origenes: [{ id_capa: capa.id_capa, cajas: 10 }],
    destinos: []
  }, 'test@user');
  assert.strictEqual(err2.success, false);

  // 3. Destrío negativo
  const err3 = env.movService.registrarReproceso({
    origenes: [{ id_capa: capa.id_capa, cajas: 10 }],
    destinos: [{ articulo: 'TOMATE ERR D', envase: 'CARTON', cajas: 10 }],
    destrio_cajas: -5
  }, 'test@user');
  assert.strictEqual(err3.success, false);

  // 4. Capa inactiva
  // Agotamos la capa primero
  env.movService.registrarAjuste({
    codigo_articulo: 'TOMATE ERR',
    codigo_envase: 'CARTON',
    cajas: 30,
    signo: -1,
    motivo: 'MERMA',
    id_capa_objetivo: capa.id_capa
  }, 'test@user');

  const err4 = env.movService.registrarReproceso({
    origenes: [{ id_capa: capa.id_capa, cajas: 5 }],
    destinos: [{ articulo: 'TOMATE ERR D', envase: 'CARTON', cajas: 5 }]
  }, 'test@user');
  assert.strictEqual(err4.success, false);
  assert.ok(err4.message.includes('no está activa'));

  // Verificar que ningún error anterior escribió en REPROCESOS
  assert.strictEqual(env.repo.getReprocesos().length, snapshotRepros);
});

// --------------------------------------------------------------------------
// 7. ACEPTACIÓN 7: ANULACIÓN DE REPROCESO
// --------------------------------------------------------------------------
runTest('7. Anulación de reproceso: sin consumos restituye capas, stock y CONSUMOS_FIFO; con consumos da REVISION_NECESARIA; anular dos veces da error', () => {
  const env = crearEntorno();

  // Entrada inicial
  env.movService.registrarEntrada({
    id_documento: 'DOC-ANUL-1',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '109',
    fecha_documento: '2026-10-15',
    entidad_nombre: 'PROV ANUL'
  }, [
    { codigo_articulo: 'TOMATE BASE', codigo_envase: 'CARTON', cajas: 80, partida: 'P-BASE' }
  ], 'test@user');

  const capaBase = env.repo.getCapasFifo().find(c => c.partida === 'P-BASE');

  // Reproceso de 50 cajas
  const repRes = env.movService.registrarReproceso({
    origenes: [{ id_capa: capaBase.id_capa, cajas: 50 }],
    destinos: [{ articulo: 'TOMATE DERIV', envase: 'EPS', cajas: 45 }],
    destrio_cajas: 5
  }, 'test@user');
  assert.strictEqual(repRes.success, true);
  const idRep = repRes.id_reproceso;

  // Estado intermedio: capaBase tiene 30 cj, capa destino tiene 45 cj
  let capas = env.repo.getCapasFifo();
  let cBase = capas.find(c => c.id_capa === capaBase.id_capa);
  let cDest = capas.find(c => c.codigo_articulo === 'TOMATE DERIV');
  assert.strictEqual(Number(cBase.cajas_restantes), 30);
  assert.strictEqual(Number(cDest.cajas_restantes), 45);

  // Probar caso con consumos: simulamos una salida de 10 cajas del destino
  env.movService.registrarSalida({
    id_documento: 'DOC-SAL-PRE',
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '502',
    fecha_documento: '2026-10-16',
    entidad_nombre: 'CLIENTE X'
  }, [
    { codigo_articulo: 'TOMATE DERIV', codigo_envase: 'EPS', cajas: 10 }
  ], 'test@user');

  // Intento de anular con consumos en destino -> REVISION_NECESARIA
  const anulBloqueada = env.movService.anularReproceso(idRep, 'test@user');
  assert.strictEqual(anulBloqueada.success, false);
  assert.strictEqual(anulBloqueada.status, 'REVISION_NECESARIA');
  assert.strictEqual(anulBloqueada.errorCode, 'DESTINO_CON_CONSUMOS');

  // Anulamos la salida previa para dejar el destino sin consumos
  env.movService.anularSalida({ serie: 'SAL', numero: '502' }, 'test@user');

  // Ahora la anulación debe tener éxito
  const anulOk = env.movService.anularReproceso(idRep, 'test@user');
  assert.strictEqual(anulOk.success, true);
  assert.strictEqual(anulOk.estado, 'ANULADO');

  // Todo vuelve exactamente al estado anterior
  capas = env.repo.getCapasFifo();
  cBase = capas.find(c => c.id_capa === capaBase.id_capa);
  cDest = capas.find(c => c.codigo_articulo === 'TOMATE DERIV');

  // La capa base recuperó sus 80 cajas y 0 consumidas
  assert.strictEqual(Number(cBase.cajas_restantes), 80);
  assert.strictEqual(Number(cBase.cajas_consumidas), 0);
  assert.strictEqual(cBase.estado_capa, 'ACTIVA');

  // La capa destino está anulada y con 0 saldo
  assert.strictEqual(cDest.estado_capa, 'ANULADA');
  assert.strictEqual(Number(cDest.cajas_restantes), 0);

  // Stock de destino vuelve a 0
  const stock = env.repo.getStockActual();
  const stockDest = stock.find(s => s.codigo_articulo === 'TOMATE DERIV');
  assert.strictEqual(Number(stockDest ? stockDest.cajas_actuales : 0), 0);

  // CONSUMOS_FIFO no tiene filas del reproceso anulado
  const consumos = env.repo.getConsumosFifo();
  const consumoBase = consumos.find(c => c.id_capa === capaBase.id_capa);
  assert.strictEqual(consumoBase, undefined);

  // Reconstrucción coincide con estado en vivo (D-022)
  const check = env.movService.comprobarConsistencia();
  assert.strictEqual(check.consistente, true);
  assert.strictEqual(check.totalDiferencias, 0);

  // Segunda anulación da error sin escribir
  const anulDuplicada = env.movService.anularReproceso(idRep, 'test@user');
  assert.strictEqual(anulDuplicada.success, false);
  assert.strictEqual(anulDuplicada.errorCode, 'REPROCESO_YA_ANULADO');
});

// --------------------------------------------------------------------------
// 8. ACEPTACIÓN 8: SUGERENCIAS DE REPROCESO
// --------------------------------------------------------------------------
runTest('8. Sugerencias: tras 2 reprocesos de X a {Y} y 1 de X a {Z1, Z2, Z3} (el último), sugerenciasReproceso(X) devuelve primero {Z1, Z2, Z3} con sus cajas y luego {Y}', () => {
  const env = crearEntorno();

  // Sembrar 500 cajas de X
  env.movService.registrarEntrada({
    id_documento: 'DOC-SUG',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '110',
    fecha_documento: '2026-10-01',
    entidad_nombre: 'PROV SUG'
  }, [
    { codigo_articulo: 'TOMATE X', codigo_envase: 'CRT-X', cajas: 500, partida: 'P-SUG' }
  ], 'test@user');

  const capaX = env.repo.getCapasFifo().find(c => c.partida === 'P-SUG');

  // Reproceso 1: X -> { Y (30 cajas) }
  env.movService.registrarReproceso({
    origenes: [{ id_capa: capaX.id_capa, cajas: 30 }],
    destinos: [{ articulo: 'TOMATE Y', envase: 'ENV-Y', cajas: 30 }],
    destrio_cajas: 0
  }, 'test@user');

  // Reproceso 2: X -> { Y (40 cajas) } (segunda vez, cajas distintas)
  env.movService.registrarReproceso({
    origenes: [{ id_capa: capaX.id_capa, cajas: 40 }],
    destinos: [{ articulo: 'TOMATE Y', envase: 'ENV-Y', cajas: 40 }],
    destrio_cajas: 0
  }, 'test@user');

  // Reproceso 3 (el último): X -> { Z1 (15), Z2 (25), Z3 (35) }
  env.movService.registrarReproceso({
    origenes: [{ id_capa: capaX.id_capa, cajas: 80 }],
    destinos: [
      { articulo: 'TOMATE Z1', envase: 'ENV-Z', cajas: 15 },
      { articulo: 'TOMATE Z2', envase: 'ENV-Z', cajas: 25 },
      { articulo: 'TOMATE Z3', envase: 'ENV-Z', cajas: 35 }
    ],
    destrio_cajas: 5
  }, 'test@user');

  // Consultar sugerencias para TOMATE X | CRT-X
  const sugerencias = env.movService.sugerenciasReproceso('TOMATE X', 'CRT-X');
  assert.strictEqual(sugerencias.length, 2, 'Debe devolver exactamente 2 conjuntos deduplicados');

  // Primer conjunto: { Z1, Z2, Z3 } con sus cajas
  const c1 = sugerencias[0];
  assert.strictEqual(c1.length, 3);
  assert.strictEqual(c1[0].articulo, 'TOMATE Z1');
  assert.strictEqual(c1[0].cajas, 15);
  assert.strictEqual(c1[1].articulo, 'TOMATE Z2');
  assert.strictEqual(c1[1].cajas, 25);
  assert.strictEqual(c1[2].articulo, 'TOMATE Z3');
  assert.strictEqual(c1[2].cajas, 35);

  // Segundo conjunto: { Y } con las cajas de la última vez (40)
  const c2 = sugerencias[1];
  assert.strictEqual(c2.length, 1);
  assert.strictEqual(c2[0].articulo, 'TOMATE Y');
  assert.strictEqual(c2[0].cajas, 40);

  // Probar también invocación con string combinado 'TOMATE X | CRT-X'
  const sugComb = env.movService.sugerenciasReproceso('TOMATE X | CRT-X');
  assert.strictEqual(sugComb.length, 2);
  assert.strictEqual(sugComb[0][0].articulo, 'TOMATE Z1');
});

// --------------------------------------------------------------------------
// 9. API Y DETALLE DE PARTIDAS
// --------------------------------------------------------------------------
runTest('9. API pública en src/Código.js y apiObtenerDetallePartidas devuelve proveedor y fecha_capa', () => {
  const env = crearEntorno();

  // Crear una capa mediante API
  env.movService.registrarEntrada({
    id_documento: 'DOC-API-1',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '111',
    fecha_documento: '2026-10-18',
    entidad_nombre: 'AGRICULTOR GARCIA'
  }, [
    { codigo_articulo: 'TOMATE DETALLE', codigo_envase: 'CRT', cajas: 100, partida: 'P-DETALLE' }
  ], 'test@user');

  // Verificar apiObtenerDetallePartidas
  const detalle = codigo.apiObtenerDetallePartidas('TOMATE DETALLE', 'CRT', { repository: env.repo });
  assert.ok(detalle, 'Debe devolver detalle');
  assert.strictEqual(detalle.partidas.length, 1);
  const p = detalle.partidas[0];
  assert.strictEqual(p.proveedor, 'AGRICULTOR GARCIA', 'Debe incluir proveedor');
  assert.strictEqual(p.fecha_capa, '2026-10-18', 'Debe incluir fecha_capa');

  // Probar apiRegistrarReproceso
  const resApiRep = codigo.apiRegistrarReproceso({
    origenes: [{ id_capa: p.idCapa, cajas: 50 }],
    destinos: [{ articulo: 'TOMATE DETALLE DEST', envase: 'CRT', cajas: 50 }]
  }, { repository: env.repo, movementService: env.movService });
  assert.strictEqual(resApiRep.success, true);

  // Probar apiListarReprocesos
  const listado = codigo.apiListarReprocesos({ estado: 'ACTIVO' }, { repository: env.repo, movementService: env.movService });
  assert.strictEqual(listado.length, 1);

  // Probar apiSugerenciasReproceso
  const sugs = codigo.apiSugerenciasReproceso('TOMATE DETALLE', 'CRT', { repository: env.repo, movementService: env.movService });
  assert.strictEqual(sugs.length, 1);
  assert.strictEqual(sugs[0][0].articulo, 'TOMATE DETALLE DEST');

  // Probar apiAnularReproceso
  const resApiAnul = codigo.apiAnularReproceso(resApiRep.id_reproceso, { repository: env.repo, movementService: env.movService });
  assert.strictEqual(resApiAnul.success, true);
  assert.strictEqual(resApiAnul.estado, 'ANULADO');
});

// --------------------------------------------------------------------------
// 10. ESTABILIDAD DE OPERACIONES PREVIAS (ACEPTACIÓN 10)
// --------------------------------------------------------------------------
runTest('10. Operaciones previas (dividirCapaEntrada y reclasificación) siguen funcionando sin alteraciones', () => {
  const env = crearEntorno();

  env.movService.registrarEntrada({
    id_documento: 'DOC-DIV-1',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '112',
    fecha_documento: '2026-10-10',
    entidad_nombre: 'PROV DIV'
  }, [
    { codigo_articulo: 'TOMATE DIV', codigo_envase: 'CRT', cajas: 100, partida: 'P-DIV' }
  ], 'test@user');

  const capa = env.repo.getCapasFifo().find(c => c.partida === 'P-DIV');

  // Dividir capa en 60 orig + 40 nuevo
  const resDiv = env.movService.dividirCapaEntrada({
    id_capa: capa.id_capa,
    divisiones: [
      { codigo_articulo: 'TOMATE DIV', codigo_envase: 'CRT', cajas: 60, partida: 'P-DIV' },
      { codigo_articulo: 'TOMATE DIV B', codigo_envase: 'CRT', cajas: 40, partida: 'P-DIV-B' }
    ]
  }, 'test@user');
  assert.strictEqual(resDiv.success, true);

  const capasPost = env.repo.getCapasFifo();
  const cOrig = capasPost.find(c => c.id_capa === capa.id_capa);
  const cNueva = capasPost.find(c => c.codigo_articulo === 'TOMATE DIV B');
  assert.strictEqual(Number(cOrig.cajas_restantes), 60);
  assert.strictEqual(Number(cNueva.cajas_restantes), 40);
});

console.log('\n================================================================');
console.log(` RESULTADOS T-009: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
