/**
 * STOCK-LIGHT — Test Suite T-008: Pendientes (reintento automático y lista para revisar)
 *
 * Cubre todos los criterios de aceptación 1 a 9 de docs/tickets/T-008-pendientes.md:
 * 1. Venta antes que la compra (reintento automático al importar compra).
 * 2. Venta de producto reprocesado (reintento automático tras registrarReproceso).
 * 3. Todo o nada (documento de dos líneas no se aplica hasta que ambas tienen stock).
 * 4. Seguimiento desconocido (SEGUIDA aplica y confirma parcial; NO_SEGUIDA marca IGNORADA sin movimientos).
 * 5. Idempotencia (reintentar dos veces seguidas no duplica movimientos ni consumos).
 * 6. MODIFICADO_EN_ERP (una sola fila con la diferencia, aunque se reimporte varias veces; apiMarcarPendienteResuelto).
 * 7. Fallo del reintento (excepción simulada no deshace importación ni reproceso, log y aviso).
 * 8. Coherencia tras cada escenario (comprobarConsistencia y suma de CONSUMOS_FIFO por capa = cajas_consumidas).
 * 9. API con T-020 (apiListarPendientes, apiReintentarPendientes, apiMarcarPendienteResuelto).
 *
 * Ejecutable: node test/t008_pendientes.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');
const { PendientesService } = require('../src/importacion/PendientesService');
const { conContextoDePrueba_ } = require('../src/Seguridad');
const codigo = require('../src/Código');

const FIXTURE_DIR = path.join(__dirname, 'fixtures/csv');
const HEADER_COMPRAS = fs.readFileSync(path.join(FIXTURE_DIR, 'compras_t007.csv'), 'utf8').split(/\r?\n/)[0];
const HEADER_VENTAS = fs.readFileSync(path.join(FIXTURE_DIR, 'ventas_t007.csv'), 'utf8').split(/\r?\n/)[0];

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

function numeroEs(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return String(valor).replace('.', ',');
}

function cajasEs(valor) {
  const texto = numeroEs(valor);
  return texto.includes(',') ? texto : `${texto},000`;
}

function filaCompra(opciones = {}) {
  const {
    fecha = '02/11/2026',
    emisor = 'PROVEEDOR FICTICIO',
    numero = '100',
    serie = 'ACT27',
    linea = 1,
    articulo = 'TOMATE FICTICIO',
    envase = 'CAJA FICTICIA',
    cajas = 10,
    kg = 50
  } = opciones;
  const cajasTexto = cajasEs(cajas);
  return [
    fecha, emisor, String(numero), serie, String(linea), '', '',
    articulo, 'Descripcion ficticia', String(cajas), cajasTexto, String(cajas), '', '',
    1, 1, 1, '0', numeroEs(kg), 0, '', '', 'ENV-F', envase, cajasTexto
  ].join(';');
}

function filaVenta(opciones = {}) {
  const {
    fecha = '03/11/2026',
    numero = '200',
    serie = 'AVT27',
    linea = 1,
    articulo = 'TOMATE FICTICIO',
    envase = 'CAJA FICTICIA',
    cajas = 12,
    kg = 60,
    cliente = 'CLIENTE FICTICIO'
  } = opciones;
  return [
    fecha, `REF-${serie}-${numero}`, String(numero), `${serie}/${numero} (${linea})`,
    cliente, articulo, cajasEs(cajas), String(cajas), '0', numeroEs(kg), envase, '0', ''
  ].join(';');
}

function crearCsv(header, filas) {
  return [header].concat(filas).join('\n') + '\n';
}

function crearCatalogo(reglas, repo = null) {
  if (repo) {
    repo.replaceTable('ATRIBUTOS', [{ nombre: 'SEGUIMIENTO', descripcion: 'Seguimiento', activo: true }]);
    repo.replaceTable('REGLAS_CLASIFICACION', reglas);
    return new CatalogoService({ repository: repo });
  }
  return new CatalogoService({
    config: {
      atributos: [{ nombre: 'SEGUIMIENTO', activo: true }],
      reglas,
      catalogo: [],
      agrupaciones: []
    }
  });
}

function catalogoTomate(repo = null) {
  return crearCatalogo([
    { id: 'R1', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 1, articulo_contiene: 'TOMATE', activo: true },
    { id: 'R2', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 2, articulo_contiene: 'ROSA', activo: true },
    { id: 'R3', atributo: 'SEGUIMIENTO', valor: 'NO', prioridad: 3, articulo_contiene: 'PEPINO', activo: true }
  ], repo);
}

/**
 * Comprueba la coherencia exigida en el punto 8 de aceptación:
 * - comprobarConsistencia().consistente === true
 * - suma de CONSUMOS_FIFO por capa === cajas_consumidas de CAPAS_FIFO
 */
function verificarCoherencia(env) {
  const check = env.movService.comprobarConsistencia();
  assert.strictEqual(
    check.consistente,
    true,
    `Inconsistencia detectada: ${JSON.stringify(check)}`
  );
  assert.strictEqual(check.totalDiferencias, 0);

  const capas = env.repo.getCapasFifo();
  const consumos = env.repo.getConsumosFifo();
  const sumaPorCapa = new Map();
  for (const c of consumos) {
    const idCapa = String(c.id_capa || '').trim();
    sumaPorCapa.set(idCapa, (sumaPorCapa.get(idCapa) || 0) + Number(c.cajas || 0));
  }
  for (const capa of capas) {
    if (String(capa.estado_capa || '').toUpperCase() === 'ANULADA') continue;
    const esperado = Number(capa.cajas_consumidas || 0);
    const real = sumaPorCapa.get(String(capa.id_capa || '').trim()) || 0;
    assert.strictEqual(
      real,
      esperado,
      `Capa ${capa.id_capa}: suma CONSUMOS_FIFO (${real}) !== cajas_consumidas (${esperado})`
    );
  }
}

console.log('================================================================');
console.log(' TEST SUITE T-008 — PENDIENTES Y REINTENTO AUTOMÁTICO');
console.log('================================================================\n');

// --------------------------------------------------------------------------
// 1. ACEPTACIÓN 1: VENTA ANTES QUE LA COMPRA
// --------------------------------------------------------------------------
runTest('1. Venta antes que la compra: venta queda PENDIENTE_REVISION; al importar compra se aplica sola y cuadra FIFO', () => {
  const env = crearEntorno();
  const cat = catalogoTomate(env.repo);
  const imp = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: cat
  });

  // 1) Importar venta de 30 cajas sin stock
  const csvVenta = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '03/11/2026', serie: 'AVT27', numero: '301', linea: 1, articulo: 'TOMATE FICTICIO', envase: 'CAJA FICTICIA', cajas: 30 })
  ]);
  const prevV = imp.previsualizar(csvVenta);
  const confV = imp.confirmar(csvVenta, prevV.hash, 'encargado@test');
  assert.strictEqual(confV.success, true);

  const docVentaAntes = env.repo.getDocumentos().find(d => d.serie === 'AVT27' && d.numero === '301');
  assert.strictEqual(docVentaAntes.estado_proceso, 'PENDIENTE_REVISION');
  assert.strictEqual(env.repo.getPendientes().length, 1);
  assert.strictEqual(env.repo.getPendientes()[0].motivo, 'STOCK_INSUFICIENTE');
  assert.strictEqual(env.repo.getPendientes()[0].estado, 'PENDIENTE');

  // 2) Importar compra de 50 cajas -> dispara reintento automático
  const csvCompra = crearCsv(HEADER_COMPRAS, [
    filaCompra({ fecha: '02/11/2026', serie: 'ACT27', numero: '101', linea: 1, articulo: 'TOMATE FICTICIO', envase: 'CAJA FICTICIA', cajas: 50 })
  ]);
  const prevC = imp.previsualizar(csvCompra);
  const confC = imp.confirmar(csvCompra, prevC.hash, 'encargado@test');
  assert.strictEqual(confC.success, true);
  assert.ok(confC.reintentoPendientes, 'Debe devolver el resultado del reintento automático');
  assert.strictEqual(confC.reintentoPendientes.aplicados.STOCK_INSUFICIENTE, 1);

  // Stock final = 50 - 30 = 20
  const stock = env.repo.getStockActual().find(s => s.codigo_articulo === 'TOMATE FICTICIO' && s.codigo_envase === 'CAJA FICTICIA');
  assert.strictEqual(Number(stock.cajas_actuales), 20);

  // Documento de venta pasa a CONFIRMADO y pendiente pasa a APLICADA con fecha_resolucion
  const docVentaDespues = env.repo.getDocumentos().find(d => d.serie === 'AVT27' && d.numero === '301');
  assert.strictEqual(docVentaDespues.estado_proceso, 'CONFIRMADO');
  const pend = env.repo.getPendientes()[0];
  assert.strictEqual(pend.estado, 'APLICADA');
  assert.ok(pend.fecha_resolucion, 'Debe rellenar fecha_resolucion');

  // CONSUMOS_FIFO apunta a la capa de la compra
  const capaCompra = env.repo.getCapasFifo()[0];
  const consumos = env.repo.getConsumosFifo();
  assert.strictEqual(consumos.length, 1);
  assert.strictEqual(consumos[0].id_capa, capaCompra.id_capa);
  assert.strictEqual(Number(consumos[0].cajas), 30);

  verificarCoherencia(env);
});

// --------------------------------------------------------------------------
// 2. ACEPTACIÓN 2: VENTA DE PRODUCTO REPROCESADO
// --------------------------------------------------------------------------
runTest('2. Venta de producto reprocesado: venta de ROSA 500 queda pendiente; al registrar reproceso se aplica sola', () => {
  const env = crearEntorno();
  const cat = catalogoTomate(env.repo);
  const imp = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: cat
  });

  // Sembrar origen: TOMATE ROSA M | CARTON (100 cajas)
  env.movService.registrarEntrada({
    id_documento: 'DOC-ORIG-1',
    tipo_documento: 'COMPRA',
    serie: 'ACT27',
    numero: '10',
    fecha_documento: '2026-11-01',
    entidad_nombre: 'PROV ORIGEN'
  }, [
    { codigo_articulo: 'TOMATE ROSA M', codigo_envase: 'CARTON', cajas: 100, partida: 'P-10' }
  ], 'encargado@test');

  // Venta de ROSA 500 | EPS 106 sin stock -> pendiente
  const csvVenta = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '02/11/2026', serie: 'AVT27', numero: '401', linea: 1, articulo: 'ROSA 500', envase: 'EPS 106', cajas: 40 })
  ]);
  const prevV = imp.previsualizar(csvVenta);
  imp.confirmar(csvVenta, prevV.hash, 'encargado@test');
  assert.strictEqual(env.repo.getPendientes().length, 1);
  assert.strictEqual(env.repo.getPendientes()[0].estado, 'PENDIENTE');

  // Reproceso que crea 60 cajas de ROSA 500 | EPS 106
  const capaOrig = env.repo.getCapasFifo().find(c => c.codigo_articulo === 'TOMATE ROSA M');
  const resRepro = env.movService.registrarReproceso({
    origenes: [{ id_capa: capaOrig.id_capa, cajas: 50 }],
    destinos: [{ articulo: 'ROSA 500', envase: 'EPS 106', cajas: 60 }],
    destrio_cajas: 2
  }, 'encargado@test');

  assert.strictEqual(resRepro.success, true);
  assert.ok(resRepro.reintentoPendientes, 'registrarReproceso debe lanzar reintento automático');
  assert.strictEqual(resRepro.reintentoPendientes.aplicados.STOCK_INSUFICIENTE, 1);

  // Stock de ROSA 500 = 60 - 40 = 20
  const stockRosa = env.repo.getStockActual().find(s => s.codigo_articulo === 'ROSA 500' && s.codigo_envase === 'EPS 106');
  assert.strictEqual(Number(stockRosa.cajas_actuales), 20);

  // La venta consumió la capa creada por el reproceso
  const capaRepro = env.repo.getCapasFifo().find(c => c.codigo_articulo === 'ROSA 500' && c.codigo_envase === 'EPS 106');
  const consumoRepro = env.repo.getConsumosFifo().find(c => c.id_capa === capaRepro.id_capa);
  assert.ok(consumoRepro, 'Debe existir consumo FIFO sobre la capa del reproceso');
  assert.strictEqual(Number(consumoRepro.cajas), 40);

  // Pendiente en APLICADA y documento CONFIRMADO
  assert.strictEqual(env.repo.getPendientes()[0].estado, 'APLICADA');
  const docVenta = env.repo.getDocumentos().find(d => d.serie === 'AVT27' && d.numero === '401');
  assert.strictEqual(docVenta.estado_proceso, 'CONFIRMADO');

  verificarCoherencia(env);
});

// --------------------------------------------------------------------------
// 3. ACEPTACIÓN 3: TODO O NADA (DOCUMENTO DE DOS LÍNEAS)
// --------------------------------------------------------------------------
runTest('3. Todo o nada: documento de dos líneas (una con stock, otra sin él) no se aplica hasta que ambas tienen stock', () => {
  const env = crearEntorno();
  const cat = catalogoTomate(env.repo);
  const imp = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: cat
  });

  // Compra solo de artículo A (20 cajas)
  const csvCompraA = crearCsv(HEADER_COMPRAS, [
    filaCompra({ fecha: '01/11/2026', serie: 'ACT27', numero: '201', linea: 1, articulo: 'TOMATE A', envase: 'CAJA', cajas: 20 })
  ]);
  imp.confirmar(csvCompraA, imp.previsualizar(csvCompraA).hash, 'encargado@test');

  // Venta de 2 líneas: A (10 cajas, hay stock) y B (15 cajas, NO hay stock)
  const csvVentaAB = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '02/11/2026', serie: 'AVT27', numero: '501', linea: 1, articulo: 'TOMATE A', envase: 'CAJA', cajas: 10 }),
    filaVenta({ fecha: '02/11/2026', serie: 'AVT27', numero: '501', linea: 2, articulo: 'TOMATE B', envase: 'CAJA', cajas: 15 })
  ]);
  imp.confirmar(csvVentaAB, imp.previsualizar(csvVentaAB).hash, 'encargado@test');

  // Ninguna de las dos líneas se ha aplicado: A sigue en 20, ambas filas en PENDIENTE
  const stockAAntes = env.repo.getStockActual().find(s => s.codigo_articulo === 'TOMATE A');
  assert.strictEqual(Number(stockAAntes.cajas_actuales), 20);
  assert.strictEqual(env.repo.getPendientes().length, 2);

  // Reintentar manualmente mientras B sigue sin stock -> nada cambia
  const pendSvc = new PendientesService({ repository: env.repo, movementService: env.movService, catalogoService: cat });
  const reint1 = pendSvc.reintentarPendientes('encargado@test');
  assert.strictEqual(reint1.aplicados.total, 0);
  assert.strictEqual(reint1.siguenPendientes.STOCK_INSUFICIENTE, 2);
  assert.strictEqual(Number(env.repo.getStockActual().find(s => s.codigo_articulo === 'TOMATE A').cajas_actuales), 20);

  // Ahora llega compra de B (25 cajas) -> se aplican las DOS líneas juntas
  const csvCompraB = crearCsv(HEADER_COMPRAS, [
    filaCompra({ fecha: '02/11/2026', serie: 'ACT27', numero: '202', linea: 1, articulo: 'TOMATE B', envase: 'CAJA', cajas: 25 })
  ]);
  const confB = imp.confirmar(csvCompraB, imp.previsualizar(csvCompraB).hash, 'encargado@test');
  assert.strictEqual(confB.reintentoPendientes.aplicados.STOCK_INSUFICIENTE, 2);

  assert.strictEqual(Number(env.repo.getStockActual().find(s => s.codigo_articulo === 'TOMATE A').cajas_actuales), 10);
  assert.strictEqual(Number(env.repo.getStockActual().find(s => s.codigo_articulo === 'TOMATE B').cajas_actuales), 10);
  assert.strictEqual(env.repo.getDocumentos().find(d => d.serie === 'AVT27' && d.numero === '501').estado_proceso, 'CONFIRMADO');
  assert.ok(env.repo.getPendientes().every(p => p.estado === 'APLICADA'));

  verificarCoherencia(env);
});

// --------------------------------------------------------------------------
// 4. ACEPTACIÓN 4: SEGUIMIENTO DESCONOCIDO (SEGUIDA Y NO_SEGUIDA)
// --------------------------------------------------------------------------
runTest('4. Seguimiento: regla SEGUIDA aplica línea y pasa CONFIRMADO_PARCIAL a CONFIRMADO; regla NO marca IGNORADA sin movimientos', () => {
  const env = crearEntorno();
  const cat = catalogoTomate(env.repo);
  const imp = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: cat
  });

  // Compra con 1 línea seguida (TOMATE) y 2 líneas con seguimiento desconocido (CALABACIN y PIMIENTO)
  const csvCompra = crearCsv(HEADER_COMPRAS, [
    filaCompra({ fecha: '02/11/2026', serie: 'ACT27', numero: '301', linea: 1, articulo: 'TOMATE FICTICIO', envase: 'CAJA', cajas: 10 }),
    filaCompra({ fecha: '02/11/2026', serie: 'ACT27', numero: '301', linea: 2, articulo: 'CALABACIN NUEVO', envase: 'CAJA', cajas: 15 }),
    filaCompra({ fecha: '02/11/2026', serie: 'ACT27', numero: '301', linea: 3, articulo: 'PIMIENTO NUEVO', envase: 'CAJA', cajas: 20 })
  ]);
  imp.confirmar(csvCompra, imp.previsualizar(csvCompra).hash, 'encargado@test');

  const docParcial = env.repo.getDocumentos().find(d => d.serie === 'ACT27' && d.numero === '301');
  assert.strictEqual(docParcial.estado_proceso, 'CONFIRMADO_PARCIAL');
  assert.strictEqual(env.repo.getPendientes().length, 2);

  // 1) Añadir regla que hace CALABACIN -> SEGUIMIENTO = SI
  env.repo.upsertReglaClasificacion({
    id: 'R-CAL',
    atributo: 'SEGUIMIENTO',
    valor: 'SI',
    prioridad: 5,
    articulo_contiene: 'CALABACIN',
    activo: true
  });

  const pendSvc = new PendientesService({ repository: env.repo, movementService: env.movService, catalogoService: cat });
  const r1 = pendSvc.reintentarPendientes('encargado@test');
  assert.strictEqual(r1.aplicados.SEGUIMIENTO_DESCONOCIDO, 1);
  assert.strictEqual(r1.siguenPendientes.SEGUIMIENTO_DESCONOCIDO, 1);

  // CALABACIN ahora tiene 15 cajas en stock, documento sigue CONFIRMADO_PARCIAL porque falta PIMIENTO
  const stockCal = env.repo.getStockActual().find(s => s.codigo_articulo === 'CALABACIN NUEVO');
  assert.strictEqual(Number(stockCal.cajas_actuales), 15);
  assert.strictEqual(env.repo.getDocumentos().find(d => d.serie === 'ACT27' && d.numero === '301').estado_proceso, 'CONFIRMADO_PARCIAL');

  // 2) Añadir regla que hace PIMIENTO -> SEGUIMIENTO = NO
  const movsAntesIgnorar = env.repo.getMovimientos().length;
  env.repo.upsertReglaClasificacion({
    id: 'R-PIM',
    atributo: 'SEGUIMIENTO',
    valor: 'NO',
    prioridad: 6,
    articulo_contiene: 'PIMIENTO',
    activo: true
  });

  const r2 = pendSvc.reintentarPendientes('encargado@test');
  assert.strictEqual(r2.ignorados.SEGUIMIENTO_DESCONOCIDO, 1);
  assert.strictEqual(r2.aplicados.total, 0);
  assert.strictEqual(r2.siguenPendientes.total, 0);

  // No se crearon movimientos nuevos por PIMIENTO y el documento pasa a CONFIRMADO
  assert.strictEqual(env.repo.getMovimientos().length, movsAntesIgnorar);
  const pendPim = env.repo.getPendientes().find(p => p.articulo === 'PIMIENTO NUEVO');
  assert.strictEqual(pendPim.estado, 'IGNORADA');
  assert.ok(pendPim.fecha_resolucion);
  assert.strictEqual(env.repo.getDocumentos().find(d => d.serie === 'ACT27' && d.numero === '301').estado_proceso, 'CONFIRMADO');

  verificarCoherencia(env);
});

// --------------------------------------------------------------------------
// 5. ACEPTACIÓN 5: IDEMPOTENCIA
// --------------------------------------------------------------------------
runTest('5. Idempotencia: reintentar dos veces seguidas no duplica movimientos ni consumos', () => {
  const env = crearEntorno();
  const cat = catalogoTomate(env.repo);
  const imp = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: cat
  });

  // Venta pendiente
  const csvVenta = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '03/11/2026', serie: 'AVT27', numero: '601', linea: 1, articulo: 'TOMATE IDEM', envase: 'CAJA', cajas: 15 })
  ]);
  imp.confirmar(csvVenta, imp.previsualizar(csvVenta).hash, 'encargado@test');

  // Añadir entrada directamente (sin disparar reintento de ImportacionService)
  env.movService.registrarEntrada({
    id_documento: 'DOC-IDEM-1',
    tipo_documento: 'COMPRA',
    serie: 'ACT27',
    numero: '601',
    fecha_documento: '2026-11-02',
    entidad_nombre: 'PROV'
  }, [
    { codigo_articulo: 'TOMATE IDEM', codigo_envase: 'CAJA', cajas: 40 }
  ], 'encargado@test');

  const pendSvc = new PendientesService({ repository: env.repo, movementService: env.movService, catalogoService: cat });
  const r1 = pendSvc.reintentarPendientes('encargado@test');
  assert.strictEqual(r1.aplicados.STOCK_INSUFICIENTE, 1);

  const movsTras1 = env.repo.getMovimientos().length;
  const consumosTras1 = env.repo.getConsumosFifo().length;
  const stockTras1 = Number(env.repo.getStockActual().find(s => s.codigo_articulo === 'TOMATE IDEM').cajas_actuales);
  assert.strictEqual(stockTras1, 25);

  // Segundo reintento consecutivo -> 0 movimientos, 0 consumos nuevos, stock idéntico
  const r2 = pendSvc.reintentarPendientes('encargado@test');
  assert.strictEqual(r2.aplicados.total, 0);
  assert.strictEqual(r2.ignorados.total, 0);
  assert.strictEqual(r2.movimientosGenerados.length, 0);
  assert.strictEqual(env.repo.getMovimientos().length, movsTras1);
  assert.strictEqual(env.repo.getConsumosFifo().length, consumosTras1);
  assert.strictEqual(Number(env.repo.getStockActual().find(s => s.codigo_articulo === 'TOMATE IDEM').cajas_actuales), 25);

  verificarCoherencia(env);
});

// --------------------------------------------------------------------------
// 6. ACEPTACIÓN 6: MODIFICADO_EN_ERP Y MARCAR RESUELTO
// --------------------------------------------------------------------------
runTest('6. MODIFICADO_EN_ERP: crea una sola fila con la diferencia aunque se reimporte varias veces; apiMarcarPendienteResuelto la deja RESUELTA sin tocar stock', () => {
  const env = crearEntorno();
  const cat = catalogoTomate(env.repo);
  const imp = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: cat
  });

  // 1) Importar albarán original con 50 cajas
  const csvOrig = crearCsv(HEADER_COMPRAS, [
    filaCompra({ fecha: '02/11/2026', serie: 'ACT27', numero: '701', linea: 1, articulo: 'TOMATE MOD', envase: 'CAJA', cajas: 50 })
  ]);
  imp.confirmar(csvOrig, imp.previsualizar(csvOrig).hash, 'encargado@test');

  // 2) Reimportar el mismo albarán modificado a 65 cajas (+15)
  const csvMod1 = crearCsv(HEADER_COMPRAS, [
    filaCompra({ fecha: '02/11/2026', serie: 'ACT27', numero: '701', linea: 1, articulo: 'TOMATE MOD', envase: 'CAJA', cajas: 65 })
  ]);
  const confMod1 = imp.confirmar(csvMod1, imp.previsualizar(csvMod1).hash, 'encargado@test');
  assert.strictEqual(confMod1.conteos.modificados, 1);

  const pends1 = env.repo.getPendientes().filter(p => p.motivo === 'MODIFICADO_EN_ERP');
  assert.strictEqual(pends1.length, 1);
  assert.strictEqual(pends1[0].linea, '');
  assert.strictEqual(Number(pends1[0].cajas), 15);
  assert.strictEqual(pends1[0].estado, 'PENDIENTE');

  // 3) Reimportar otra versión distinta (70 cajas) -> NO duplica fila PENDIENTE
  const csvMod2 = crearCsv(HEADER_COMPRAS, [
    filaCompra({ fecha: '02/11/2026', serie: 'ACT27', numero: '701', linea: 1, articulo: 'TOMATE MOD', envase: 'CAJA', cajas: 70 })
  ]);
  imp.confirmar(csvMod2, imp.previsualizar(csvMod2).hash, 'encargado@test');
  const pends2 = env.repo.getPendientes().filter(p => p.motivo === 'MODIFICADO_EN_ERP');
  assert.strictEqual(pends2.length, 1, 'No debe duplicar la fila MODIFICADO_EN_ERP');

  // Reintentar pendientes nunca aplica MODIFICADO_EN_ERP
  const pendSvc = new PendientesService({ repository: env.repo, movementService: env.movService, catalogoService: cat });
  const rReint = pendSvc.reintentarPendientes('encargado@test');
  assert.strictEqual(rReint.aplicados.total, 0);
  assert.strictEqual(rReint.siguenPendientes.MODIFICADO_EN_ERP, 1);

  // Stock sigue en 50 (no se ha tocado)
  const movsAntes = env.repo.getMovimientos().length;
  assert.strictEqual(Number(env.repo.getStockActual().find(s => s.codigo_articulo === 'TOMATE MOD').cajas_actuales), 50);

  // 4) Marcar resuelto mediante API con contexto de prueba (T-020)
  conContextoDePrueba_('encargado@test', 'ENCARGADO', () => {
    const listado = codigo.apiListarPendientes({}, { repository: env.repo, movementService: env.movService, catalogoService: cat });
    assert.strictEqual(listado.porMotivo.MODIFICADO_EN_ERP.totalDocumentos, 1);
    assert.strictEqual(listado.porMotivo.MODIFICADO_EN_ERP.totalCajas, 15);

    const res = codigo.apiMarcarPendienteResuelto(
      pends1[0].id_pendiente,
      'Revisado con proveedor, ajuste manual aplicado',
      { repository: env.repo, movementService: env.movService, catalogoService: cat }
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.estado, 'RESUELTA');
    assert.strictEqual(res.nota, 'Revisado con proveedor, ajuste manual aplicado');
  });

  // Estado final en hoja PENDIENTES = RESUELTA, nota en LOG_OPERACIONES, stock intacto
  const pendFinal = env.repo.getPendientes().find(p => p.id_pendiente === pends1[0].id_pendiente);
  assert.strictEqual(pendFinal.estado, 'RESUELTA');
  assert.ok(pendFinal.fecha_resolucion);
  assert.strictEqual(env.repo.getMovimientos().length, movsAntes);
  assert.strictEqual(Number(env.repo.getStockActual().find(s => s.codigo_articulo === 'TOMATE MOD').cajas_actuales), 50);

  const logs = env.repo.getLogOperaciones();
  const logRes = logs.find(l => l.operacion === 'RESOLVER_PENDIENTE' && l.referencia === pends1[0].id_pendiente);
  assert.ok(logRes, 'Debe guardar la nota en LOG_OPERACIONES');
  assert.strictEqual(logRes.observaciones, 'Revisado con proveedor, ajuste manual aplicado');

  verificarCoherencia(env);
});

// --------------------------------------------------------------------------
// 7. ACEPTACIÓN 7: FALLO DEL REINTENTO NO DESHACE LA OPERACIÓN ORIGINAL
// --------------------------------------------------------------------------
runTest('7. Fallo del reintento: excepción simulada no deshace importación ni reproceso, registra log y devuelve aviso', () => {
  const env = crearEntorno();
  const cat = catalogoTomate(env.repo);
  const pendientesQueFalla = {
    reintentarPendientes() {
      throw new Error('FALLO_SIMULADO_REINTENTO');
    }
  };

  // A) Fallo durante ImportacionService.confirmar
  const imp = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: cat,
    pendientesService: pendientesQueFalla
  });
  const csvCompra = crearCsv(HEADER_COMPRAS, [
    filaCompra({ fecha: '02/11/2026', serie: 'ACT27', numero: '801', linea: 1, articulo: 'TOMATE FALLO', envase: 'CAJA', cajas: 80 })
  ]);
  const conf = imp.confirmar(csvCompra, imp.previsualizar(csvCompra).hash, 'encargado@test');
  assert.strictEqual(conf.success, true, 'La importación debe quedar aplicada');
  assert.ok(conf.avisoReintento && conf.avisoReintento.includes('FALLO_SIMULADO_REINTENTO'), 'Debe devolver aviso');
  assert.strictEqual(Number(env.repo.getStockActual().find(s => s.codigo_articulo === 'TOMATE FALLO').cajas_actuales), 80);

  // B) Fallo durante MovementService.registrarReproceso
  env.movService.pendientesService = pendientesQueFalla;
  const capa = env.repo.getCapasFifo().find(c => c.codigo_articulo === 'TOMATE FALLO');
  const resRepro = env.movService.registrarReproceso({
    origenes: [{ id_capa: capa.id_capa, cajas: 30 }],
    destinos: [{ articulo: 'TOMATE FALLO DEST', envase: 'CAJA', cajas: 30 }],
    destrio_cajas: 0
  }, 'encargado@test');
  assert.strictEqual(resRepro.success, true, 'El reproceso debe quedar aplicado');
  assert.ok(resRepro.avisoReintento && resRepro.avisoReintento.includes('FALLO_SIMULADO_REINTENTO'), 'Debe devolver aviso');
  assert.strictEqual(Number(env.repo.getStockActual().find(s => s.codigo_articulo === 'TOMATE FALLO DEST').cajas_actuales), 30);

  // Ambos errores registrados en LOG_OPERACIONES
  const logs = env.repo.getLogOperaciones();
  assert.ok(logs.some(l => l.operacion === 'REINTENTO_PENDIENTES_IMPORTACION' && l.observaciones.includes('FALLO_SIMULADO_REINTENTO')));
  assert.ok(logs.some(l => l.operacion === 'REINTENTO_PENDIENTES_REPROCESO' && l.observaciones.includes('FALLO_SIMULADO_REINTENTO')));

  verificarCoherencia(env);
});

// --------------------------------------------------------------------------
// 8. ACEPTACIÓN 9: APIs PROTEGIDAS POR SESIÓN (T-020) Y FUNCIONANDO CON CONTEXTO
// --------------------------------------------------------------------------
runTest('8. APIs de T-008 exigen sesión y funcionan correctamente dentro de conContextoDePrueba_', () => {
  const env = crearEntorno();
  const cat = catalogoTomate(env.repo);
  const opts = { repository: env.repo, movementService: env.movService, catalogoService: cat };

  // Sin sesión -> Acceso no autorizado
  assert.throws(() => codigo.apiListarPendientes({}, opts), /Acceso no autorizado/);
  assert.throws(() => codigo.apiReintentarPendientes(opts), /Acceso no autorizado/);
  assert.throws(() => codigo.apiMarcarPendienteResuelto('PEND-1', 'nota', opts), /Acceso no autorizado/);

  // Con sesión CONSULTA -> apiListarPendientes funciona
  conContextoDePrueba_('consulta@test', 'CONSULTA', () => {
    const lista = codigo.apiListarPendientes({}, opts);
    assert.strictEqual(lista.totalFilas, 0);
    assert.strictEqual(lista.totalDocumentos, 0);
  });

  // Con sesión ENCARGADO -> apiReintentarPendientes funciona
  conContextoDePrueba_('encargado@test', 'ENCARGADO', () => {
    const res = codigo.apiReintentarPendientes(opts);
    assert.strictEqual(res.aplicados.total, 0);
    assert.strictEqual(res.ignorados.total, 0);
    assert.strictEqual(res.siguenPendientes.total, 0);
  });

  verificarCoherencia(env);
});

// --------------------------------------------------------------------------
// 9. CORRECCIÓN PUNTO 1: PUNTO FIJO (COMPRA DÍA 4 DESBLOQUEA VENTA DÍA 2 EN UNA SOLA LLAMADA)
// --------------------------------------------------------------------------
runTest('9. Punto fijo: compra del día 4 desbloquea venta del día 2 en la misma llamada, con un solo lock y un solo _persistir', () => {
  const env = crearEntorno();
  const cat = catalogoTomate(env.repo);
  const imp = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: cat
  });

  // Venta del día 2 y compra del día 4 para un producto inicialmente con seguimiento desconocido
  const csvVentaDia2 = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '02/11/2026', serie: 'AVT27', numero: '901', linea: 1, articulo: 'CALABACIN PF', envase: 'CAJA', cajas: 15 })
  ]);
  const csvCompraDia4 = crearCsv(HEADER_COMPRAS, [
    filaCompra({ fecha: '04/11/2026', serie: 'ACT27', numero: '902', linea: 1, articulo: 'CALABACIN PF', envase: 'CAJA', cajas: 40 })
  ]);
  imp.confirmar(csvVentaDia2, imp.previsualizar(csvVentaDia2).hash, 'encargado@test');
  imp.confirmar(csvCompraDia4, imp.previsualizar(csvCompraDia4).hash, 'encargado@test');

  // Ahora añadimos regla que hace CALABACIN PF -> SEGUIDA
  env.repo.upsertReglaClasificacion({
    id: 'R-PF',
    atributo: 'SEGUIMIENTO',
    valor: 'SI',
    prioridad: 5,
    articulo_contiene: 'CALABACIN PF',
    activo: true
  });

  // Contar llamadas a _acquireLock y _persistir durante un único reintentarPendientes
  let locks = 0;
  let persistirs = 0;
  const origAcquire = env.movService._acquireLock.bind(env.movService);
  const origPersistir = env.movService._persistir.bind(env.movService);
  env.movService._acquireLock = (...args) => { locks++; return origAcquire(...args); };
  env.movService._persistir = (...args) => { persistirs++; return origPersistir(...args); };

  try {
    const pendSvc = new PendientesService({ repository: env.repo, movementService: env.movService, catalogoService: cat });
    const res = pendSvc.reintentarPendientes('encargado@test');

    assert.strictEqual(locks, 1, 'Debe usar exactamente un lock');
    assert.strictEqual(persistirs, 1, 'Debe hacer una sola llamada a _persistir');
    assert.strictEqual(res.aplicados.SEGUIMIENTO_DESCONOCIDO, 2);
    assert.strictEqual(res.aplicados.total, 2);
    assert.strictEqual(res.siguenPendientes.total, 0);
    assert.strictEqual(res.documentosConfirmados, 2);
  } finally {
    env.movService._acquireLock = origAcquire;
    env.movService._persistir = origPersistir;
  }

  // Stock final = 40 - 15 = 25, y ambos documentos CONFIRMADO
  const stock = env.repo.getStockActual().find(s => s.codigo_articulo === 'CALABACIN PF');
  assert.strictEqual(Number(stock.cajas_actuales), 25);
  assert.strictEqual(env.repo.getDocumentos().find(d => d.serie === 'AVT27' && d.numero === '901').estado_proceso, 'CONFIRMADO');
  assert.strictEqual(env.repo.getDocumentos().find(d => d.serie === 'ACT27' && d.numero === '902').estado_proceso, 'CONFIRMADO');
  assert.ok(env.repo.getPendientes().every(p => p.estado === 'APLICADA'));

  verificarCoherencia(env);
});

// --------------------------------------------------------------------------
// 10. CORRECCIÓN PUNTO 2: SEGUIMIENTO_DESCONOCIDO -> SEGUIDA SIN STOCK PASA A STOCK_INSUFICIENTE
// --------------------------------------------------------------------------
runTest('10. Fila SEGUIMIENTO_DESCONOCIDO ya SEGUIDA que no entra por stock pasa a motivo STOCK_INSUFICIENTE', () => {
  const env = crearEntorno();
  const cat = catalogoTomate(env.repo);
  const imp = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: cat
  });

  // Venta de producto desconocido sin stock
  const csvVenta = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '03/11/2026', serie: 'AVT27', numero: '903', linea: 1, articulo: 'CALABACIN SINSTOCK', envase: 'CAJA', cajas: 20 })
  ]);
  imp.confirmar(csvVenta, imp.previsualizar(csvVenta).hash, 'encargado@test');
  assert.strictEqual(env.repo.getPendientes()[0].motivo, 'SEGUIMIENTO_DESCONOCIDO');

  // Regla que la convierte en SEGUIDA, pero sigue sin haber stock
  env.repo.upsertReglaClasificacion({
    id: 'R-SS',
    atributo: 'SEGUIMIENTO',
    valor: 'SI',
    prioridad: 5,
    articulo_contiene: 'CALABACIN SINSTOCK',
    activo: true
  });

  const pendSvc = new PendientesService({ repository: env.repo, movementService: env.movService, catalogoService: cat });
  const res = pendSvc.reintentarPendientes('encargado@test');

  assert.strictEqual(res.aplicados.total, 0);
  assert.strictEqual(res.siguenPendientes.STOCK_INSUFICIENTE, 1);
  assert.strictEqual(res.siguenPendientes.SEGUIMIENTO_DESCONOCIDO, 0);
  assert.strictEqual(res.siguenPendientes.total, 1);

  const pend = env.repo.getPendientes()[0];
  assert.strictEqual(pend.estado, 'PENDIENTE');
  assert.strictEqual(pend.motivo, 'STOCK_INSUFICIENTE');

  verificarCoherencia(env);
});

// --------------------------------------------------------------------------
// 11. CORRECCIÓN PUNTO 3: marcarPendienteResuelto SOLO ADMITE MODIFICADO_EN_ERP
// --------------------------------------------------------------------------
runTest('11. marcarPendienteResuelto rechaza motivos distintos de MODIFICADO_EN_ERP con SOLO_MODIFICADO_EN_ERP sin tocar nada', () => {
  const env = crearEntorno();
  const cat = catalogoTomate(env.repo);
  const imp = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: cat
  });

  // Crear un pendiente STOCK_INSUFICIENTE y uno SEGUIMIENTO_DESCONOCIDO
  const csvVentaStock = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '03/11/2026', serie: 'AVT27', numero: '904', linea: 1, articulo: 'TOMATE FICTICIO', envase: 'CAJA', cajas: 10 })
  ]);
  const csvVentaDesc = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '03/11/2026', serie: 'AVT27', numero: '905', linea: 1, articulo: 'BERENJENA DESC', envase: 'CAJA', cajas: 5 })
  ]);
  imp.confirmar(csvVentaStock, imp.previsualizar(csvVentaStock).hash, 'encargado@test');
  imp.confirmar(csvVentaDesc, imp.previsualizar(csvVentaDesc).hash, 'encargado@test');

  const pStock = env.repo.getPendientes().find(p => p.motivo === 'STOCK_INSUFICIENTE');
  const pDesc = env.repo.getPendientes().find(p => p.motivo === 'SEGUIMIENTO_DESCONOCIDO');
  assert.ok(pStock && pDesc);

  const logsAntes = env.repo.getLogOperaciones().length;

  conContextoDePrueba_('encargado@test', 'ENCARGADO', () => {
    const r1 = codigo.apiMarcarPendienteResuelto(pStock.id_pendiente, 'intento', { repository: env.repo, movementService: env.movService, catalogoService: cat });
    assert.strictEqual(r1.success, false);
    assert.strictEqual(r1.errorCode, 'SOLO_MODIFICADO_EN_ERP');

    const r2 = codigo.apiMarcarPendienteResuelto(pDesc.id_pendiente, 'intento', { repository: env.repo, movementService: env.movService, catalogoService: cat });
    assert.strictEqual(r2.success, false);
    assert.strictEqual(r2.errorCode, 'SOLO_MODIFICADO_EN_ERP');
  });

  // Nada ha cambiado
  const pStockPost = env.repo.getPendientes().find(p => p.id_pendiente === pStock.id_pendiente);
  const pDescPost = env.repo.getPendientes().find(p => p.id_pendiente === pDesc.id_pendiente);
  assert.strictEqual(pStockPost.estado, 'PENDIENTE');
  assert.strictEqual(pDescPost.estado, 'PENDIENTE');
  assert.strictEqual(pStockPost.fecha_resolucion, '');
  assert.strictEqual(pDescPost.fecha_resolucion, '');
  assert.strictEqual(env.repo.getLogOperaciones().length, logsAntes);

  verificarCoherencia(env);
});

// --------------------------------------------------------------------------
// 12. CORRECCIÓN PUNTO 4: registrarReproceso CONSERVA AVISOS PREVIOS SI FALLA REINTENTO
// --------------------------------------------------------------------------
runTest('12. registrarReproceso añade el aviso de fallo del reintento a resultado.avisos sin borrar los previos', () => {
  const env = crearEntorno();

  env.movService.registrarEntrada({
    id_documento: 'DOC-AV-1',
    tipo_documento: 'COMPRA',
    serie: 'ACT27',
    numero: '906',
    fecha_documento: '2026-11-01',
    entidad_nombre: 'PROV AV'
  }, [
    { codigo_articulo: 'TOMATE AVISO', codigo_envase: 'CAJA', cajas: 50, partida: 'P-AV' }
  ], 'encargado@test');

  const capa = env.repo.getCapasFifo().find(c => c.codigo_articulo === 'TOMATE AVISO');
  env.movService.pendientesService = {
    reintentarPendientes() {
      throw new Error('FALLO_CONSERVAR_AVISOS');
    }
  };

  const origPlanificar = global.planificarReproceso;
  global.planificarReproceso = (params, capas) => {
    const plan = origPlanificar(params, capas);
    plan.avisos = ['AVISO_PREVIO_REPROCESO'];
    return plan;
  };

  try {
    const res = env.movService.registrarReproceso({
      origenes: [{ id_capa: capa.id_capa, cajas: 20 }],
      destinos: [{ articulo: 'TOMATE AVISO DEST', envase: 'CAJA', cajas: 20 }],
      destrio_cajas: 0
    }, 'encargado@test');

    assert.strictEqual(res.success, true);
    assert.ok(Array.isArray(res.avisos), 'Debe devolver array avisos');
    assert.strictEqual(res.avisos.length, 2, 'Debe conservar el aviso previo y añadir el del fallo');
    assert.strictEqual(res.avisos[0], 'AVISO_PREVIO_REPROCESO');
    assert.ok(res.avisos[1].includes('FALLO_CONSERVAR_AVISOS'));
  } finally {
    global.planificarReproceso = origPlanificar;
  }

  verificarCoherencia(env);
});

console.log('\n================================================================');
console.log(` RESULTADOS T-008: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
