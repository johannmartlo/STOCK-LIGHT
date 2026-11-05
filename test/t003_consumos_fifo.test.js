/**
 * STOCK-LIGHT — Test Suite T-003: Hoja CONSUMOS_FIFO derivada del libro y fin de los repartos a ciegas
 * Ejecutable con Node.js: `node test/t003_consumos_fifo.test.js`
 *
 * Cumple los criterios de aceptación 1 a 7 y 9 de docs/tickets/T-003-consumos-fifo.md.
 */

const assert = require('assert');
const { crearEntorno } = require('./helpers/mockSheets');
const { rebuildStockFromMovements } = require('../src/InventoryEngine');

console.log('================================================================');
console.log(' TEST SUITE T-003 — HOJA CONSUMOS_FIFO DERIVADA DEL LIBRO');
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

// -----------------------------------------------------------------------------
// Aceptación 1: Salida escribe dos filas en CONSUMOS_FIFO y observaciones no contiene FIFO:
// -----------------------------------------------------------------------------
runTest('1. Capas A (70) y B (50), salida de 100 escribe 2 filas en CONSUMOS_FIFO (A 70 ord 1, B 30 ord 2) y observaciones sin FIFO:', () => {
  const env = crearEntorno();

  // Capa A: 70 cajas, 2026-10-01
  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'COM26',
    numero: '1001',
    fecha_documento: '2026-10-01',
    entidad_nombre: 'PROVEEDOR A'
  }, [{
    codigo_articulo: 'ART1',
    codigo_envase: 'ENV1',
    cajas: 70,
    partida: 'PART-A'
  }], 'test@almacen');

  // Capa B: 50 cajas, 2026-10-02
  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA',
    serie: 'COM26',
    numero: '1002',
    fecha_documento: '2026-10-02',
    entidad_nombre: 'PROVEEDOR B'
  }, [{
    codigo_articulo: 'ART1',
    codigo_envase: 'ENV1',
    cajas: 50,
    partida: 'PART-B'
  }], 'test@almacen');

  const capasIniciales = env.repo.getCapasFifo();
  assert.strictEqual(capasIniciales.length, 2);
  const capaA = capasIniciales[0];
  const capaB = capasIniciales[1];

  // Salida de 100 cajas el 2026-10-03
  const resSalida = env.movService.registrarSalida({
    tipo_documento: 'SALIDA',
    serie: 'SAL26',
    numero: '2001',
    fecha_documento: '2026-10-03',
    entidad_nombre: 'CLIENTE 1'
  }, [{
    codigo_articulo: 'ART1',
    codigo_envase: 'ENV1',
    cajas: 100,
    observaciones: 'Albarán salida urgente'
  }], 'test@almacen');

  assert.strictEqual(resSalida.success, true);

  // Verificar CONSUMOS_FIFO
  const consumos = env.repo.getConsumosFifo();
  assert.strictEqual(consumos.length, 2, 'Deben haberse registrado exactamente 2 filas de consumo');

  assert.strictEqual(consumos[0].id_capa, capaA.id_capa);
  assert.strictEqual(Number(consumos[0].orden), 1);
  assert.strictEqual(Number(consumos[0].cajas), 70);
  assert.strictEqual(consumos[0].codigo_articulo, 'ART1');
  assert.strictEqual(consumos[0].codigo_envase, 'ENV1');
  assert.strictEqual(consumos[0].fecha_negocio, '2026-10-03');

  assert.strictEqual(consumos[1].id_capa, capaB.id_capa);
  assert.strictEqual(Number(consumos[1].orden), 2);
  assert.strictEqual(Number(consumos[1].cajas), 30);
  assert.strictEqual(consumos[1].codigo_articulo, 'ART1');
  assert.strictEqual(consumos[1].codigo_envase, 'ENV1');
  assert.strictEqual(consumos[1].fecha_negocio, '2026-10-03');

  // Verificar que en MOVIMIENTOS la fila de SALIDA no contiene FIFO:
  const movs = env.repo.getMovimientos();
  const movSalida = movs.find(m => m.tipo_movimiento === 'SALIDA');
  assert.ok(movSalida, 'El movimiento de salida debe existir');
  assert.ok(!String(movSalida.observaciones || '').includes('FIFO:'), 'observaciones no debe contener FIFO:');
  assert.strictEqual(movSalida.observaciones, 'Albarán salida urgente');
});

// -----------------------------------------------------------------------------
// Aceptación 2: Al anular esa salida, A y B recuperan sus cajas y CONSUMOS_FIFO ya no tiene filas
// -----------------------------------------------------------------------------
runTest('2. Al anular la salida de 100, A y B recuperan sus cajas restantes y CONSUMOS_FIFO queda sin filas de ese movimiento', () => {
  const env = crearEntorno();

  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1001', fecha_documento: '2026-10-01', entidad_nombre: 'PROV A'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 70 }], 'test@almacen');

  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1002', fecha_documento: '2026-10-02', entidad_nombre: 'PROV B'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 50 }], 'test@almacen');

  env.movService.registrarSalida({
    tipo_documento: 'SALIDA', serie: 'SAL26', numero: '2001', fecha_documento: '2026-10-03', entidad_nombre: 'CLI 1'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 100 }], 'test@almacen');

  // Anular la salida
  const resAnul = env.movService.anularSalida({ serie: 'SAL26', numero: '2001' }, 'test@almacen');
  assert.strictEqual(resAnul.success, true);

  // Verificar que las capas A y B recuperaron sus saldos
  const capas = env.repo.getCapasFifo();
  const capaA = capas.find(c => c.documento_ref === 'COM26/1001');
  const capaB = capas.find(c => c.documento_ref === 'COM26/1002');
  assert.strictEqual(Number(capaA.cajas_restantes), 70);
  assert.strictEqual(capaA.estado_capa, 'ACTIVA');
  assert.strictEqual(Number(capaB.cajas_restantes), 50);
  assert.strictEqual(capaB.estado_capa, 'ACTIVA');

  // Verificar que CONSUMOS_FIFO ya no tiene filas para esa salida
  const consumos = env.repo.getConsumosFifo();
  assert.strictEqual(consumos.length, 0, 'CONSUMOS_FIFO debe estar vacío tras anular la única salida');
});

// -----------------------------------------------------------------------------
// Aceptación 3: Corregir salida de 100 a 80 devuelve 20 cajas a B; CONSUMOS_FIFO queda A 70 y B 10
// -----------------------------------------------------------------------------
runTest('3. Corregir salida de 100 a 80 devuelve 20 cajas a B; CONSUMOS_FIFO queda con A 70 y B 10', () => {
  const env = crearEntorno();

  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1001', fecha_documento: '2026-10-01', entidad_nombre: 'PROV A'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 70 }], 'test@almacen');

  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1002', fecha_documento: '2026-10-02', entidad_nombre: 'PROV B'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 50 }], 'test@almacen');

  env.movService.registrarSalida({
    tipo_documento: 'SALIDA', serie: 'SAL26', numero: '2001', fecha_documento: '2026-10-03', entidad_nombre: 'CLI 1'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 100 }], 'test@almacen');

  // Corregir a 80 cajas (reducción de 20 cajas)
  const resCorr = env.movService.corregirCantidadSalida({
    serie: 'SAL26',
    numero: '2001',
    nuevaCantidad: 80
  }, 'test@almacen');
  assert.strictEqual(resCorr.success, true);

  // Capas: B tenía 50 - 30 = 20 restantes; tras devolver 20 cajas, B debe tener 40 restantes.
  const capas = env.repo.getCapasFifo();
  const capaA = capas.find(c => c.documento_ref === 'COM26/1001');
  const capaB = capas.find(c => c.documento_ref === 'COM26/1002');
  assert.strictEqual(Number(capaA.cajas_restantes), 0);
  assert.strictEqual(Number(capaB.cajas_restantes), 40);

  // CONSUMOS_FIFO: A 70 (orden 1), B 10 (orden 2)
  const consumos = env.repo.getConsumosFifo();
  assert.strictEqual(consumos.length, 2);
  assert.strictEqual(consumos[0].id_capa, capaA.id_capa);
  assert.strictEqual(Number(consumos[0].cajas), 70);
  assert.strictEqual(Number(consumos[0].orden), 1);

  assert.strictEqual(consumos[1].id_capa, capaB.id_capa);
  assert.strictEqual(Number(consumos[1].cajas), 10);
  assert.strictEqual(Number(consumos[1].orden), 2);
});

// -----------------------------------------------------------------------------
// Aceptación 4: Fuente es la hoja, no el texto: observaciones vacías en mock y anular funciona
// -----------------------------------------------------------------------------
runTest('4. Tras varias salidas se vacía observaciones en MOVIMIENTOS; anular salida devuelve las cajas a sus capas exactas', () => {
  const env = crearEntorno();

  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1001', fecha_documento: '2026-10-01', entidad_nombre: 'PROV A'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 100 }], 'test@almacen');

  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1002', fecha_documento: '2026-10-02', entidad_nombre: 'PROV B'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 100 }], 'test@almacen');

  env.movService.registrarSalida({
    tipo_documento: 'SALIDA', serie: 'SAL26', numero: '2001', fecha_documento: '2026-10-03', entidad_nombre: 'CLI 1'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 60 }], 'test@almacen');

  env.movService.registrarSalida({
    tipo_documento: 'SALIDA', serie: 'SAL26', numero: '2002', fecha_documento: '2026-10-04', entidad_nombre: 'CLI 2'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 80 }], 'test@almacen');

  // Vaciar observaciones de todas las filas en el mock de MOVIMIENTOS
  const sheet = env.repo.getSpreadsheet().getSheetByName('MOVIMIENTOS');
  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const obsColIdx = headers.indexOf('observaciones') + 1;
  for (let r = 2; r <= lastRow; r++) {
    sheet.getRange(r, obsColIdx, 1, 1).setValues([['']]);
  }

  // Comprobar que en memoria del mock están vacías
  const movsConObsVacia = env.repo.getMovimientos();
  for (const m of movsConObsVacia) {
    assert.strictEqual(m.observaciones, '');
  }

  // Anular la segunda salida (SAL26/2002 consumió 40 de capa A y 40 de capa B)
  const resAnul = env.movService.anularSalida({ serie: 'SAL26', numero: '2002' }, 'test@almacen');
  assert.strictEqual(resAnul.success, true);

  const capas = env.repo.getCapasFifo();
  const capaA = capas.find(c => c.documento_ref === 'COM26/1001');
  const capaB = capas.find(c => c.documento_ref === 'COM26/1002');

  // Capa A: 100 inicial - 60 (salida 1) = 40 restantes
  // Capa B: 100 inicial - 0 (salida 2 anulada) = 100 restantes
  assert.strictEqual(Number(capaA.cajas_restantes), 40);
  assert.strictEqual(Number(capaB.cajas_restantes), 100);

  const check = env.movService.comprobarConsistencia();
  assert.strictEqual(check.consistente, true);
  assert.strictEqual(check.totalDiferencias, 0);
});

// -----------------------------------------------------------------------------
// Aceptación 5: Primera ejecución con MOVIMIENTOS y CONSUMOS_FIFO vacía
// -----------------------------------------------------------------------------
runTest('5. Con MOVIMIENTOS con salidas y CONSUMOS_FIFO vacía, anular salida funciona igual y después la hoja está rellena', () => {
  const env = crearEntorno();

  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1001', fecha_documento: '2026-10-01', entidad_nombre: 'PROV A'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 70 }], 'test@almacen');

  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1002', fecha_documento: '2026-10-02', entidad_nombre: 'PROV B'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 50 }], 'test@almacen');

  env.movService.registrarSalida({
    tipo_documento: 'SALIDA', serie: 'SAL26', numero: '2001', fecha_documento: '2026-10-03', entidad_nombre: 'CLI 1'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 50 }], 'test@almacen');

  env.movService.registrarSalida({
    tipo_documento: 'SALIDA', serie: 'SAL26', numero: '2002', fecha_documento: '2026-10-04', entidad_nombre: 'CLI 2'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 40 }], 'test@almacen');

  // Vaciar CONSUMOS_FIFO completamente (simulando primera ejecución tras despliegue)
  const ss = env.repo.getSpreadsheet();
  const consumosSheet = ss.getSheetByName('CONSUMOS_FIFO');
  const lastRow = consumosSheet.getLastRow();
  if (lastRow > 1) {
    consumosSheet.getRange(2, 1, lastRow - 1, consumosSheet.getLastColumn()).clearContent();
  }
  assert.strictEqual(env.repo.getConsumosFifo().length, 0, 'CONSUMOS_FIFO debe estar vacía para simular despliegue');

  // Anular la segunda salida (SAL26/2002)
  const resAnul = env.movService.anularSalida({ serie: 'SAL26', numero: '2002' }, 'test@almacen');
  assert.strictEqual(resAnul.success, true);

  // La hoja ahora debe estar rellena con los consumos de la salida 1 que sigue activa
  const consumosPost = env.repo.getConsumosFifo();
  assert.ok(consumosPost.length > 0, 'CONSUMOS_FIFO debe estar rellena tras la operación');
  assert.strictEqual(Number(consumosPost[0].cajas), 50);

  const check = env.movService.comprobarConsistencia();
  assert.strictEqual(check.consistente, true);
  assert.strictEqual(check.totalDiferencias, 0);
});

// -----------------------------------------------------------------------------
// Aceptación 6: Sin repartos a ciegas
// -----------------------------------------------------------------------------
runTest('6. ANULACION y AJUSTE + apuntando a movimiento sin consumos conocidos devuelven REVISION_NECESARIA en vivo y avisos en reconstruir', () => {
  const env = crearEntorno();

  // Crear estado inicial con stock
  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1001', fecha_documento: '2026-10-01', entidad_nombre: 'PROV A'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 50 }], 'test@almacen');

  const capasAntes = env.repo.getCapasFifo();

  // A) En vivo: AJUSTE + con id_movimiento_ref inexistente o sin consumos
  const resAjuste = env.movService.registrarAjuste({
    codigoArticulo: 'ART1',
    codigoEnvase: 'ENV1',
    cajas: 10,
    signo: 1,
    motivo: 'AJUSTE_TEST',
    id_movimiento_ref: 'MOV-INVENTADO-NO-EXISTE'
  }, 'test@almacen');

  assert.strictEqual(resAjuste.success, false);
  assert.strictEqual(resAjuste.status, 'REVISION_NECESARIA');
  assert.strictEqual(resAjuste.errorCode, 'CONSUMOS_DESCONOCIDOS');

  // Comprobar que no se modificó ninguna capa
  const capasTrasAjuste = env.repo.getCapasFifo();
  assert.deepStrictEqual(capasTrasAjuste, capasAntes);

  // B) En vivo: ANULACION con id_movimiento_ref inexistente
  const resAnul = env.movService.anularSalida({
    id_movimiento: 'MOV-SALIDA-NO-EXISTE'
  }, 'test@almacen');

  // Si no encuentra la salida en MOVIMIENTOS devuelve SALIDA_NO_ENCONTRADA
  assert.strictEqual(resAnul.success, false);
  assert.strictEqual(resAnul.status, 'REVISION_NECESARIA');

  // Directamente sobre aplicarMovimiento para ANULACION con ref huérfana
  const { estado } = env.movService._cargarEstado();
  const movAnulHuerfano = {
    id_movimiento: 'MOV-ANUL-TEST',
    fecha_hora: '2026-10-02T10:00:00Z',
    tipo_movimiento: 'ANULACION',
    codigo_articulo: 'ART1',
    codigo_envase: 'ENV1',
    cajas: 10,
    signo: 1,
    id_movimiento_ref: 'MOV-SALIDA-DESCONOCIDA',
    observaciones: '',
    estado: 'CONFIRMADO'
  };

  const resAplicarAnul = env.movService.libro.aplicarMovimiento(estado, movAnulHuerfano);
  assert.strictEqual(resAplicarAnul.ok, false);
  assert.strictEqual(resAplicarAnul.errorCode, 'CONSUMOS_DESCONOCIDOS');
  // Comprobar que no tocó capas
  assert.deepStrictEqual(resAplicarAnul.estado.capas, estado.capas);

  // C) En reconstruir:
  // Crear una lista de movimientos que contenga un movimiento válido y uno con consumos desconocidos
  const movsParaReconstruir = [
    {
      id_movimiento: 'MOV-1',
      secuencia: 1,
      tipo_movimiento: 'ENTRADA',
      codigo_articulo: 'ART1',
      codigo_envase: 'ENV1',
      cajas: 50,
      signo: 1,
      fecha_negocio: '2026-10-01',
      estado: 'CONFIRMADO',
      id_capa_creada: 'CAPA-1'
    },
    {
      id_movimiento: 'MOV-2',
      secuencia: 2,
      tipo_movimiento: 'ANULACION',
      codigo_articulo: 'ART1',
      codigo_envase: 'ENV1',
      cajas: 10,
      signo: 1,
      fecha_negocio: '2026-10-02',
      estado: 'CONFIRMADO',
      id_movimiento_ref: 'MOV-SALIDA-DESCONOCIDA',
      observaciones: ''
    },
    {
      id_movimiento: 'MOV-3',
      secuencia: 3,
      tipo_movimiento: 'AJUSTE',
      codigo_articulo: 'ART1',
      codigo_envase: 'ENV1',
      cajas: 5,
      signo: 1,
      fecha_negocio: '2026-10-03',
      estado: 'CONFIRMADO',
      id_movimiento_ref: 'MOV-OTRO-DESCONOCIDO',
      observaciones: ''
    }
  ];

  const rec = env.movService.libro.reconstruir(movsParaReconstruir);
  assert.strictEqual(rec.ok, true);
  assert.strictEqual(rec.avisos.length, 2, 'Ambos movimientos deben aparecer en avisos');
  assert.strictEqual(rec.avisos[0].id_movimiento, 'MOV-2');
  assert.strictEqual(rec.avisos[0].tipo_movimiento, 'ANULACION');
  assert.strictEqual(rec.avisos[1].id_movimiento, 'MOV-3');
  assert.strictEqual(rec.avisos[1].tipo_movimiento, 'AJUSTE');

  // Y no cambiaron capas: la capa 1 sigue intacta con 50 cajas restantes
  assert.strictEqual(rec.estado.capas.length, 1);
  assert.strictEqual(Number(rec.estado.capas[0].cajas_restantes), 50);
});

// -----------------------------------------------------------------------------
// Aceptación 7: Tras rebuildStock, CONSUMOS_FIFO coincide fila a fila
// -----------------------------------------------------------------------------
runTest('7. Tras rebuildStock, CONSUMOS_FIFO coincide fila a fila con la de antes del rebuild', () => {
  const env = crearEntorno();

  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1001', fecha_documento: '2026-10-01', entidad_nombre: 'PROV A'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 100 }], 'test@almacen');

  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1002', fecha_documento: '2026-10-02', entidad_nombre: 'PROV B'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 80 }], 'test@almacen');

  env.movService.registrarSalida({
    tipo_documento: 'SALIDA', serie: 'SAL26', numero: '2001', fecha_documento: '2026-10-03', entidad_nombre: 'CLI 1'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 120 }], 'test@almacen');

  env.movService.registrarSalida({
    tipo_documento: 'SALIDA', serie: 'SAL26', numero: '2002', fecha_documento: '2026-10-04', entidad_nombre: 'CLI 2'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 30 }], 'test@almacen');

  // Corregir la primera salida a 110 cajas
  env.movService.corregirCantidadSalida({
    serie: 'SAL26',
    numero: '2001',
    nuevaCantidad: 110
  }, 'test@almacen');

  const consumosAntes = env.repo.getConsumosFifo();
  assert.ok(consumosAntes.length > 0, 'Debe haber filas en CONSUMOS_FIFO antes del rebuild');

  // Ejecutar rebuildStock
  const resRebuild = env.movService.rebuildStock();
  assert.strictEqual(resRebuild.success, true);

  const consumosDespues = env.repo.getConsumosFifo();

  // Comparación estricta fila a fila
  assert.strictEqual(consumosDespues.length, consumosAntes.length, 'La cantidad de filas debe ser idéntica');
  for (let i = 0; i < consumosAntes.length; i++) {
    assert.deepStrictEqual(consumosDespues[i], consumosAntes[i], `Fila ${i} debe coincidir exactamente`);
  }
});

// -----------------------------------------------------------------------------
// Prueba 11: Corrección de venta al alza no duplica filas en CONSUMOS_FIFO
// -----------------------------------------------------------------------------
runTest('11. Entrada A (100), venta (10), corregir venta a 14: CONSUMOS_FIFO tiene UNA fila (14 cajas) y ninguna del ajuste; anular venta deja 100 y 0 filas', () => {
  const env = crearEntorno();

  // Entrada A de 100
  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1001', fecha_documento: '2026-10-01', entidad_nombre: 'PROV A'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 100 }], 'test@almacen');

  const capaA = env.repo.getCapasFifo()[0];

  // Venta de 10
  env.movService.registrarSalida({
    tipo_documento: 'SALIDA', serie: 'SAL26', numero: '2001', fecha_documento: '2026-10-02', entidad_nombre: 'CLI 1'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 10 }], 'test@almacen');

  const movVenta = env.repo.getMovimientos().find(m => m.tipo_movimiento === 'SALIDA');
  assert.ok(movVenta);

  // Corregir la venta a 14 (ampliación de 4 cajas)
  const resCorr = env.movService.corregirCantidadSalida({
    serie: 'SAL26',
    numero: '2001',
    nuevaCantidad: 14
  }, 'test@almacen');
  assert.strictEqual(resCorr.success, true);

  // CONSUMOS_FIFO tiene UNA sola fila (id_movimiento = la venta, capa A, 14 cajas) y ninguna del ajuste
  const consumos = env.repo.getConsumosFifo();
  assert.strictEqual(consumos.length, 1, 'Debe haber exactamente 1 fila en CONSUMOS_FIFO');
  assert.strictEqual(consumos[0].id_movimiento, movVenta.id_movimiento);
  assert.strictEqual(consumos[0].id_capa, capaA.id_capa);
  assert.strictEqual(Number(consumos[0].cajas), 14);
  assert.strictEqual(Number(consumos[0].orden), 1);

  // cajas_consumidas de A = 14
  const capas = env.repo.getCapasFifo();
  assert.strictEqual(Number(capas[0].cajas_consumidas), 14);
  assert.strictEqual(Number(capas[0].cajas_restantes), 86);

  // Anular la venta
  const resAnul = env.movService.anularSalida({ serie: 'SAL26', numero: '2001' }, 'test@almacen');
  assert.strictEqual(resAnul.success, true);

  // CONSUMOS_FIFO sin filas y A con 100 restantes
  const consumosPost = env.repo.getConsumosFifo();
  assert.strictEqual(consumosPost.length, 0, 'CONSUMOS_FIFO debe estar vacío tras anular la venta');

  const capasPost = env.repo.getCapasFifo();
  assert.strictEqual(Number(capasPost[0].cajas_restantes), 100);
  assert.strictEqual(Number(capasPost[0].cajas_consumidas), 0);
});

// -----------------------------------------------------------------------------
// Prueba 12: Corregir entrada al alza no decrementa cajas_consumidas de la capa
// -----------------------------------------------------------------------------
runTest('12. Entrada (100), venta (30), corregir entrada a 110 (queda consumidas 30 y restantes 80), corregir a 130 y anularEntrada da false sin cambios', () => {
  const env = crearEntorno();

  // Entrada de 100
  env.movService.registrarEntrada({
    tipo_documento: 'COMPRA', serie: 'COM26', numero: '1001', fecha_documento: '2026-10-01', entidad_nombre: 'PROV A'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 100 }], 'test@almacen');

  // Venta de 30
  env.movService.registrarSalida({
    tipo_documento: 'SALIDA', serie: 'SAL26', numero: '2001', fecha_documento: '2026-10-02', entidad_nombre: 'CLI 1'
  }, [{ codigo_articulo: 'ART1', codigo_envase: 'ENV1', cajas: 30 }], 'test@almacen');

  // Corregir la entrada a 110
  const resCorr1 = env.movService.corregirCantidadEntrada({
    serie: 'COM26',
    numero: '1001',
    nuevaCantidad: 110
  }, 'test@almacen');
  assert.strictEqual(resCorr1.success, true);

  // La capa queda con cajas_consumidas 30 y cajas_restantes 80
  let capas = env.repo.getCapasFifo();
  assert.strictEqual(Number(capas[0].cajas_consumidas), 30);
  assert.strictEqual(Number(capas[0].cajas_restantes), 80);

  // Corregir después a 130
  const resCorr2 = env.movService.corregirCantidadEntrada({
    serie: 'COM26',
    numero: '1001',
    nuevaCantidad: 130
  }, 'test@almacen');
  assert.strictEqual(resCorr2.success, true);

  capas = env.repo.getCapasFifo();
  assert.strictEqual(Number(capas[0].cajas_consumidas), 30);
  assert.strictEqual(Number(capas[0].cajas_restantes), 100);

  const capasSnapshot = JSON.stringify(capas);
  const movsSnapshot = JSON.stringify(env.repo.getMovimientos());

  // Llamar a anularEntrada
  const resAnul = env.movService.anularEntrada({
    serie: 'COM26',
    numero: '1001'
  }, 'test@almacen');

  // success false, y ni capas ni MOVIMIENTOS cambian
  assert.strictEqual(resAnul.success, false);
  assert.strictEqual(resAnul.status, 'REVISION_NECESARIA');
  assert.strictEqual(resAnul.errorCode, 'ENTRADA_CON_CONSUMOS');

  assert.strictEqual(JSON.stringify(env.repo.getCapasFifo()), capasSnapshot, 'Las capas no deben cambiar');
  assert.strictEqual(JSON.stringify(env.repo.getMovimientos()), movsSnapshot, 'MOVIMIENTOS no debe cambiar');
});

console.log('\n================================================================');
console.log(` RESULTADOS T-003 CONSUMOS FIFO: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
