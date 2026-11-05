/**
 * STOCK-LIGHT — Test Suite: T-002 Fecha de Negocio, Secuencia, Trazabilidad y Kilos Informativos
 * Ejecutable con Node.js: `node test/t002_fecha_negocio.test.js`
 */

const assert = require('assert');
const { MockSpreadsheet, MockSheet, MockRange, crearEntorno } = require('./helpers/mockSheets');
const { hoyMadrid, normalizarFechaNegocio } = require('../src/Fechas');
const { sortFifoLayers, processMovement, rebuildStockFromMovements, buildStockKey } = require('../src/InventoryEngine');
const { SheetsRepository } = require('../src/Repository');

console.log('================================================================');
console.log(' TEST SUITE T-002 — FECHA DE NEGOCIO, SECUENCIA Y TRAZABILIDAD');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function runTest(desc, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(`     Error: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
    failed++;
  }
}

// --------------------------------------------------------------------------
// PRUEBA 1: Orden FIFO con fechas Date leídas de Sheets tras normalización
// --------------------------------------------------------------------------
runTest('1. Capas con fechas como objetos Date en distinto orden salen ordenadas por fecha real', () => {
  const ss = new MockSpreadsheet('SS_PRUEBA_1');
  const repo = new SheetsRepository({ spreadsheet: ss });
  repo.provisionDatabase();

  const sheetCapas = ss.getSheetByName('CAPAS_FIFO');
  // Insertar filas con fechas como Date:
  // Fila 1: 2026-10-23 (Viernes -> 'Fri Oct 23...')
  // Fila 2: 2026-10-19 (Lunes -> 'Mon Oct 19...')
  // En orden alfabético puro por String(Date), 'Fri...' iría antes que 'Mon...',
  // pero el 19 de octubre es ANTERIOR al 23 de octubre.
  const date23 = new Date(Date.UTC(2026, 9, 23, 10, 0, 0));
  const date19 = new Date(Date.UTC(2026, 9, 19, 10, 0, 0));

  const headers = repo.readTable ? ['id_capa', 'id_movimiento_entrada', 'fecha_capa', 'codigo_articulo', 'codigo_envase', 'cajas_iniciales', 'cajas_consumidas', 'cajas_restantes', 'estado_capa', 'partida', 'documento_ref', 'proveedor', 'id_capa_origen', 'origen_dato'] : [];
  
  sheetCapas.rows = [
    headers,
    ['CAPA-01', 'MOV-01', date23, 'ART1', 'ENV1', 100, 0, 100, 'ACTIVA', 'LOTE-23', 'DOC-23', 'PROV A', '', 'MANUAL'],
    ['CAPA-02', 'MOV-02', date19, 'ART1', 'ENV1', 50, 0, 50, 'ACTIVA', 'LOTE-19', 'DOC-19', 'PROV B', '', 'MANUAL']
  ];

  // Al leer mediante readTable, normaliza Date a 'YYYY-MM-DD'
  const capasLeidas = repo.getCapasFifo();
  assert.strictEqual(capasLeidas.length, 2);
  assert.strictEqual(typeof capasLeidas[0].fecha_capa, 'string');
  assert.strictEqual(capasLeidas[0].fecha_capa, '2026-10-23');
  assert.strictEqual(capasLeidas[1].fecha_capa, '2026-10-19');

  // sortFifoLayers debe ordenar 19 de octubre ANTES que 23 de octubre
  const ordenadas = sortFifoLayers(capasLeidas);
  assert.strictEqual(ordenadas[0].id_capa, 'CAPA-02');
  assert.strictEqual(ordenadas[0].fecha_capa, '2026-10-19');
  assert.strictEqual(ordenadas[1].id_capa, 'CAPA-01');
  assert.strictEqual(ordenadas[1].fecha_capa, '2026-10-23');
});

// --------------------------------------------------------------------------
// PRUEBA 2: Entradas 15/10 y 17/10 con salida 19/10 (misma fecha_hora)
// --------------------------------------------------------------------------
runTest('2. Entradas 15/10 y 17/10 y salida 19/10 con misma fecha_hora reconstruyen idéntico a vivo', () => {
  const env = crearEntorno();
  const fechaHoraComun = '2026-10-19T20:00:00.000Z';

  // Entrada 1 (15/10): 100 cajas
  env.movService.registrarEntrada({
    id_documento: 'DOC-E1',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '101',
    fecha_documento: '2026-10-15',
    entidad_nombre: 'AGRICOLA ALHAMBRA'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100, partida: 'L-15' }
  ], 'operador@test');

  // Entrada 2 (17/10): 50 cajas
  env.movService.registrarEntrada({
    id_documento: 'DOC-E2',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '102',
    fecha_documento: '2026-10-17',
    entidad_nombre: 'COOPERATIVA VEGA'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 50, partida: 'L-17' }
  ], 'operador@test');

  // Salida (19/10): 120 cajas
  env.movService.registrarSalida({
    id_documento: 'DOC-S1',
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '201',
    fecha_documento: '2026-10-19',
    entidad_nombre: 'MERCADONA'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 120 }
  ], 'operador@test');

  // Simular que todos los movimientos tuvieron la misma fecha_hora física de registro
  const movsSheet = env.ss.getSheetByName('MOVIMIENTOS');
  for (let r = 1; r < movsSheet.rows.length; r++) {
    movsSheet.rows[r][1] = fechaHoraComun; // columna fecha_hora
  }

  // Estado vivo actual
  const capasVivas = env.repo.getCapasFifo();
  assert.strictEqual(capasVivas.length, 2);
  
  const capa15Vivo = capasVivas.find(c => c.partida === 'L-15');
  const capa17Vivo = capasVivas.find(c => c.partida === 'L-17');

  assert.strictEqual(capa15Vivo.fecha_capa, '2026-10-15');
  assert.strictEqual(capa15Vivo.proveedor, 'AGRICOLA ALHAMBRA');
  assert.strictEqual(capa15Vivo.cajas_restantes, 0);
  assert.strictEqual(capa15Vivo.estado_capa, 'AGOTADA');

  assert.strictEqual(capa17Vivo.fecha_capa, '2026-10-17');
  assert.strictEqual(capa17Vivo.proveedor, 'COOPERATIVA VEGA');
  assert.strictEqual(capa17Vivo.cajas_restantes, 30); // 150 - 120 = 30
  assert.strictEqual(capa17Vivo.estado_capa, 'ACTIVA');

  // Reconstrucción determinista a partir de movimientos
  const movsParaRebuild = env.repo.getMovimientos();
  const resRebuild = rebuildStockFromMovements(movsParaRebuild, env.repo.getMaestro());

  assert.strictEqual(resRebuild.isConsistent, true);
  assert.strictEqual(resRebuild.reconstructedLayers.length, 2);

  const capa15Rebuild = resRebuild.reconstructedLayers.find(c => c.partida === 'L-15');
  const capa17Rebuild = resRebuild.reconstructedLayers.find(c => c.partida === 'L-17');

  assert.strictEqual(capa15Rebuild.fecha_capa, '2026-10-15');
  assert.strictEqual(capa15Rebuild.proveedor, 'AGRICOLA ALHAMBRA');
  assert.strictEqual(capa15Rebuild.cajas_restantes, 0);
  assert.strictEqual(capa15Rebuild.estado_capa, 'AGOTADA');

  assert.strictEqual(capa17Rebuild.fecha_capa, '2026-10-17');
  assert.strictEqual(capa17Rebuild.proveedor, 'COOPERATIVA VEGA');
  assert.strictEqual(capa17Rebuild.cajas_restantes, 30);
  assert.strictEqual(capa17Rebuild.estado_capa, 'ACTIVA');
});

// --------------------------------------------------------------------------
// PRUEBA 3: Entrada 20/10 y luego entrada 05/10; salida posterior consume 05/10 primero
// --------------------------------------------------------------------------
runTest('3. Entrada 20/10 registrada antes que 05/10: salida consume 05/10 primero y rebuild coincide', () => {
  const env = crearEntorno();

  // Operación 1: Entrada 20/10 (100 cajas)
  env.movService.registrarEntrada({
    id_documento: 'DOC-E20',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '301',
    fecha_documento: '2026-10-20',
    entidad_nombre: 'AGRICULTOR OCTUBRE'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100, partida: 'L-20' }
  ], 'operador@test');

  // Operación 2: Entrada 05/10 registrada con posterioridad (50 cajas)
  env.movService.registrarEntrada({
    id_documento: 'DOC-E05',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '302',
    fecha_documento: '2026-10-05',
    entidad_nombre: 'AGRICULTOR TEMPRANO'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 50, partida: 'L-05' }
  ], 'operador@test');

  // Operación 3: Salida 21/10 (60 cajas)
  env.movService.registrarSalida({
    id_documento: 'DOC-S21',
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '303',
    fecha_documento: '2026-10-21',
    entidad_nombre: 'CLIENTE SUR'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 60 }
  ], 'operador@test');

  // En vivo: la capa más antigua por FIFO es 05/10, por lo que consume 50 de L-05 y 10 de L-20
  const capasVivas = env.repo.getCapasFifo();
  const c05Vivo = capasVivas.find(c => c.partida === 'L-05');
  const c20Vivo = capasVivas.find(c => c.partida === 'L-20');

  assert.strictEqual(c05Vivo.cajas_restantes, 0, 'L-05 debe quedar agotada');
  assert.strictEqual(c05Vivo.estado_capa, 'AGOTADA');
  assert.strictEqual(c20Vivo.cajas_restantes, 90, 'L-20 debe conservar 90 cajas');
  assert.strictEqual(c20Vivo.estado_capa, 'ACTIVA');

  // Reconstrucción: reproduce en orden de registro (secuencia: E20, luego E05, luego S21)
  const movs = env.repo.getMovimientos();
  const rebuild = rebuildStockFromMovements(movs, env.repo.getMaestro());

  const c05Rebuild = rebuild.reconstructedLayers.find(c => c.partida === 'L-05');
  const c20Rebuild = rebuild.reconstructedLayers.find(c => c.partida === 'L-20');

  assert.strictEqual(c05Rebuild.cajas_restantes, 0, 'En reconstrucción L-05 debe quedar agotada');
  assert.strictEqual(c05Rebuild.estado_capa, 'AGOTADA');
  assert.strictEqual(c20Rebuild.cajas_restantes, 90, 'En reconstrucción L-20 debe conservar 90 cajas');
  assert.strictEqual(c20Rebuild.estado_capa, 'ACTIVA');
  assert.strictEqual(rebuild.isConsistent, true);
});

// --------------------------------------------------------------------------
// PRUEBA 4: hoyMadrid() con reloj simulado a las 23:30 UTC
// --------------------------------------------------------------------------
runTest('4. hoyMadrid() simulado en 2026-10-23T23:30:00Z devuelve 2026-10-24', () => {
  const fechaUtc = new Date('2026-10-23T23:30:00Z');
  const resultado = hoyMadrid(fechaUtc);
  assert.strictEqual(resultado, '2026-10-24');

  // Probando con función reloj inyectable
  const relojFn = () => new Date('2026-10-23T23:30:00Z');
  assert.strictEqual(hoyMadrid(relojFn), '2026-10-24');
});

// --------------------------------------------------------------------------
// PRUEBA 5: provisionDatabase añade las 5 columnas al final y conserva filas
// --------------------------------------------------------------------------
runTest('5. provisionDatabase añade 5 columnas al final de MOVIMIENTOS y conserva datos', () => {
  const ss = new MockSpreadsheet('SS_MIGRACION');
  const repo = new SheetsRepository({ spreadsheet: ss });

  // Crear hoja MOVIMIENTOS con esquema anterior de 13 columnas y 2 filas de datos
  const sheetMov = ss.insertSheet('MOVIMIENTOS');
  const headersAntiguos = [
    'id_movimiento', 'fecha_hora', 'tipo_movimiento', 'id_documento_ref',
    'codigo_articulo', 'codigo_envase', 'cajas', 'signo', 'partida_origen',
    'motivo_ajuste', 'usuario', 'observaciones', 'estado'
  ];

  sheetMov.rows = [
    [...headersAntiguos],
    ['MOV-01', '2026-09-01T10:00:00.000Z', 'ENTRADA', 'DOC-01', 'ART1', 'ENV1', 10, 1, 'P1', '', 'user1', '', 'CONFIRMADO'],
    ['MOV-02', '2026-09-01T11:00:00.000Z', 'SALIDA', 'DOC-02', 'ART1', 'ENV1', 5, -1, '', '', 'user2', '', 'CONFIRMADO']
  ];

  // Ejecutar provisionDatabase
  repo.provisionDatabase();

  // Verificar que la cabecera ahora tiene 18 columnas
  const headersNuevos = sheetMov.rows[0];
  assert.strictEqual(headersNuevos.length, 18);
  assert.strictEqual(headersNuevos[13], 'fecha_negocio');
  assert.strictEqual(headersNuevos[14], 'entidad_nombre');
  assert.strictEqual(headersNuevos[15], 'secuencia');
  assert.strictEqual(headersNuevos[16], 'origen_dato');
  assert.strictEqual(headersNuevos[17], 'kg_informativo');

  // Verificar que las dos filas de datos se preservaron
  assert.strictEqual(sheetMov.rows.length, 3);
  assert.strictEqual(sheetMov.rows[1][0], 'MOV-01');
  assert.strictEqual(sheetMov.rows[1][6], 10);
  assert.strictEqual(sheetMov.rows[2][0], 'MOV-02');
  assert.strictEqual(sheetMov.rows[2][6], 5);

  // Leer a través de readTable
  const registros = repo.getMovimientos();
  assert.strictEqual(registros.length, 2);
  assert.strictEqual(registros[0].id_movimiento, 'MOV-01');
  assert.strictEqual(registros[0].fecha_negocio, '');
  assert.strictEqual(registros[1].id_movimiento, 'MOV-02');
});

// --------------------------------------------------------------------------
// PRUEBA 6: secuencia estrictamente creciente en 50 movimientos en un mismo bloque
// --------------------------------------------------------------------------
runTest('6. secuencia es estrictamente creciente en 50 movimientos del mismo bloque', () => {
  const env = crearEntorno();

  const lineas50 = [];
  for (let i = 1; i <= 50; i++) {
    lineas50.push({
      codigo_articulo: '2112000',
      codigo_envase: 'EPS104',
      cajas: 1,
      partida: `PART-${i}`
    });
  }

  const res = env.movService.registrarEntrada({
    id_documento: 'DOC-50-ITEMS',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '500',
    fecha_documento: '2026-10-22',
    entidad_nombre: 'PROVEEDOR LOTE 50'
  }, lineas50, 'operador@test');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.totalCajas, 50);

  const movs = env.repo.getMovimientos();
  assert.strictEqual(movs.length, 50);

  for (let i = 0; i < movs.length; i++) {
    const sec = Number(movs[i].secuencia);
    assert.ok(!isNaN(sec), `Secuencia debe ser numérica en índice ${i}`);
    assert.strictEqual(sec, i + 1, `Secuencia esperada ${i + 1}, obtenida ${sec}`);
    if (i > 0) {
      assert.ok(sec > Number(movs[i - 1].secuencia), `Secuencia ${sec} debe ser mayor que ${movs[i - 1].secuencia}`);
    }
  }
});

// --------------------------------------------------------------------------
// PRUEBA 7: kg_informativo = 444 guardado y stock en cajas idéntico
// --------------------------------------------------------------------------
runTest('7. Entrada con kg: 444 guarda kg_informativo=444 y el stock en cajas no se altera', () => {
  const env = crearEntorno();

  // Entrada 1: Sin kilos (100 cajas)
  env.movService.registrarEntrada({
    id_documento: 'DOC-SIN-KG',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '601',
    fecha_documento: '2026-10-23',
    entidad_nombre: 'AGRICULTOR A'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100 }
  ], 'operador@test');

  const stock1 = env.queryService.obtenerStockActual();
  const item1 = stock1.find(s => s.stock_key === '2112000|EPS104');
  assert.strictEqual(item1.cajas_actuales, 100);

  // Entrada 2: Con kg: 444 (100 cajas)
  env.movService.registrarEntrada({
    id_documento: 'DOC-CON-KG',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '602',
    fecha_documento: '2026-10-23',
    entidad_nombre: 'AGRICULTOR B'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100, kg: 444 }
  ], 'operador@test');

  const stock2 = env.queryService.obtenerStockActual();
  const item2 = stock2.find(s => s.stock_key === '2112000|EPS104');
  assert.strictEqual(item2.cajas_actuales, 200, 'El stock debe incrementar exactamente en 100 cajas (total 200)');

  const movs = env.repo.getMovimientos();
  const movConKg = movs.find(m => m.id_documento_ref === 'DOC-CON-KG');
  assert.ok(movConKg, 'Debe existir el movimiento con kg');
  assert.strictEqual(Number(movConKg.kg_informativo), 444, 'kg_informativo debe ser 444');
  assert.strictEqual(movConKg.entidad_nombre, 'AGRICULTOR B');

  const movSinKg = movs.find(m => m.id_documento_ref === 'DOC-SIN-KG');
  assert.strictEqual(movSinKg.kg_informativo, '');
});

// --------------------------------------------------------------------------
// PRUEBA 8 (a): Secuencia asignada en appendMovimientos para todas las operaciones
// --------------------------------------------------------------------------
runTest('8. Todas las operaciones que escriben movimientos asignan secuencia creciente sin vacíos', () => {
  const env = crearEntorno();

  env.repo.saveMaestro([
    {
      tenant_id: 'DEFAULT',
      codigo_articulo: '2112000',
      nombre_articulo: 'TOMATE ROSA I G',
      codigo_envase: 'EPS104',
      descripcion_envase: 'EPS 104',
      activo: true,
      es_predeterminado: true
    },
    {
      tenant_id: 'DEFAULT',
      codigo_articulo: '2112000',
      nombre_articulo: 'TOMATE ROSA I G',
      codigo_envase: 'CT4395',
      descripcion_envase: 'CARTON 4395',
      activo: true,
      es_predeterminado: false
    },
    {
      tenant_id: 'DEFAULT',
      codigo_articulo: '2112001',
      nombre_articulo: 'TOMATE ROSA I GG',
      codigo_envase: 'EPS104',
      descripcion_envase: 'EPS 104',
      activo: true,
      es_predeterminado: true
    }
  ]);

  // 1) registrarEntrada (1 movimiento -> sec 1)
  const r1 = env.movService.registrarEntrada({
    id_documento: 'DOC-OP-1',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '701',
    fecha_documento: '2026-10-10',
    entidad_nombre: 'PROV 1'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100, partida: 'P-1' }
  ], 'operador@test');
  assert.strictEqual(r1.success, true);

  // 2) registrarSalida (1 movimiento -> sec 2)
  const r2 = env.movService.registrarSalida({
    id_documento: 'DOC-OP-2',
    tipo_documento: 'SALIDA',
    serie: 'ALB26',
    numero: '702',
    fecha_documento: '2026-10-11',
    entidad_nombre: 'CLI 1'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 20 }
  ], 'operador@test');
  assert.strictEqual(r2.success, true);

  // 3) confirmarCompraPendiente (1 movimiento -> sec 3)
  env.repo.appendDocumento({
    id_documento: 'DOC-OP-3-PEND',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '703',
    fecha_documento: '2026-10-12',
    entidad_nombre: 'PROV PEND',
    total_lineas: 1,
    total_cajas: 50,
    estado_proceso: 'PENDIENTE_REVISION'
  });
  const r3 = env.movService.confirmarCompraPendiente(
    {
      idDocumento: 'DOC-OP-3-PEND',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'EPS104' }]
    },
    'operador@test',
    null,
    {
      canonicalLines: [
        { lineIndex: 1, codigo_articulo: '2112000', nombre_articulo: 'TOMATE ROSA I G', cajas: 50, partida: 'P-PEND' }
      ]
    }
  );
  assert.strictEqual(r3.success, true);

  // 4) registrarReclasificacion (2 movimientos -> sec 4, 5)
  const r4 = env.movService.registrarReclasificacion({
    codigo_articulo_origen: '2112000',
    codigo_envase_origen: 'EPS104',
    codigo_articulo_destino: '2112000',
    codigo_envase_destino: 'CT4395',
    cajas: 15,
    fecha: '2026-10-13'
  }, 'operador@test');
  assert.strictEqual(r4.success, true);

  // 5) anularSalida (1 movimiento -> sec 6)
  const r5 = env.movService.anularSalida({
    id_documento: 'DOC-OP-2',
    serie: 'ALB26',
    numero: '702',
    motivo: 'ERROR_PEDIDO'
  }, 'operador@test');
  assert.strictEqual(r5.success, true);

  // 6) dividirCapaEntrada (2 movimientos -> sec 7, 8)
  const r6 = env.movService.dividirCapaEntrada({
    serie: 'ACT26',
    numero: '703',
    codigo_articulo: '2112000',
    codigo_envase: 'EPS104',
    divisiones: [
      { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 30, partida: 'P-PEND' },
      { codigo_articulo: '2112001', codigo_envase: 'EPS104', cajas: 20, partida: 'P-PEND' }
    ]
  }, 'operador@test');
  assert.strictEqual(r6.success, true);

  const movs = env.repo.getMovimientos();
  assert.strictEqual(movs.length, 8, 'Deben haberse escrito exactamente 8 movimientos en total');

  for (let i = 0; i < movs.length; i++) {
    const rawSec = movs[i].secuencia;
    assert.ok(rawSec !== '' && rawSec !== null && rawSec !== undefined, `La fila ${i} no debe tener secuencia vacía`);
    const sec = Number(rawSec);
    assert.ok(Number.isInteger(sec) && sec > 0, `La secuencia en fila ${i} debe ser entero positivo`);
    assert.strictEqual(sec, i + 1, `La secuencia en posición ${i} debe ser ${i + 1}`);
    if (i > 0) {
      assert.ok(sec > Number(movs[i - 1].secuencia), 'La columna secuencia debe ser estrictamente creciente');
    }
  }
});

// --------------------------------------------------------------------------
// PRUEBA 9 (b): Entrada 20/10, salida, y confirmarCompraPendiente 05/10 -> rebuild = vivo
// --------------------------------------------------------------------------
runTest('9. Entrada 20/10, salida y después confirmarCompraPendiente del 05/10: rebuild coincide con vivo', () => {
  const env = crearEntorno();

  env.repo.saveMaestro([
    {
      tenant_id: 'DEFAULT',
      codigo_articulo: '2112000',
      nombre_articulo: 'TOMATE ROSA I G',
      codigo_envase: 'EPS104',
      descripcion_envase: 'EPS 104',
      activo: true,
      es_predeterminado: true
    }
  ]);

  // 1. Entrada del 20/10 (100 cajas)
  env.movService.registrarEntrada({
    id_documento: 'DOC-20OCT-B',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '801',
    fecha_documento: '2026-10-20',
    entidad_nombre: 'PROV 20'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 100, partida: 'PART-20OCT' }
  ], 'operador@test');

  // 2. Salida de 40 cajas (consume de la única capa existente en ese momento: la del 20/10)
  env.movService.registrarSalida({
    id_documento: 'DOC-SAL-B',
    tipo_documento: 'SALIDA',
    serie: 'ALB26',
    numero: '802',
    fecha_documento: '2026-10-21',
    entidad_nombre: 'CLIENTE B'
  }, [
    { codigo_articulo: '2112000', codigo_envase: 'EPS104', cajas: 40 }
  ], 'operador@test');

  // 3. Después se confirma una compra pendiente cuya fecha de documento era 05/10 (80 cajas)
  env.repo.appendDocumento({
    id_documento: 'DOC-PEND-05OCT',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '803',
    fecha_documento: '2026-10-05',
    entidad_nombre: 'PROV 05',
    total_lineas: 1,
    total_cajas: 80,
    estado_proceso: 'PENDIENTE_REVISION'
  });

  const resConfirm = env.movService.confirmarCompraPendiente(
    {
      idDocumento: 'DOC-PEND-05OCT',
      lineResolutions: [{ lineIndex: 1, codigoEnvase: 'EPS104' }]
    },
    'operador@test',
    null,
    {
      canonicalLines: [
        { lineIndex: 1, codigo_articulo: '2112000', nombre_articulo: 'TOMATE ROSA I G', cajas: 80, partida: 'PART-05OCT' }
      ]
    }
  );
  assert.strictEqual(resConfirm.success, true);

  // Estado vivo antes de rebuild
  const capasVivas = env.repo.getCapasFifo();
  const viva20 = capasVivas.find(c => c.partida === 'PART-20OCT');
  const viva05 = capasVivas.find(c => c.partida === 'PART-05OCT');
  assert.strictEqual(viva20.cajas_restantes, 60, 'En vivo, la capa del 20/10 tiene 60 cajas restantes');
  assert.strictEqual(viva05.cajas_restantes, 80, 'En vivo, la capa del 05/10 confirmada después tiene 80 cajas restantes');

  // Ejecutar rebuildStock()
  const rebuildRes = env.movService.rebuildStock();
  assert.strictEqual(rebuildRes.success, true);
  assert.strictEqual(rebuildRes.report.isConsistent, true);

  const capasRebuild = env.repo.getCapasFifo();
  const reb20 = capasRebuild.find(c => c.partida === 'PART-20OCT');
  const reb05 = capasRebuild.find(c => c.partida === 'PART-05OCT');

  assert.strictEqual(reb20.fecha_capa, '2026-10-20');
  assert.strictEqual(reb20.cajas_restantes, viva20.cajas_restantes, 'Rebuild debe dejar 60 cajas en la capa 20/10');
  assert.strictEqual(reb05.fecha_capa, '2026-10-05');
  assert.strictEqual(reb05.cajas_restantes, viva05.cajas_restantes, 'Rebuild debe dejar 80 cajas en la capa 05/10');
});

console.log('\n================================================================');
console.log(` RESULTADOS T-002 FECHA DE NEGOCIO: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
