/**
 * STOCK-LIGHT — Test Suite: T-022 Libro de Movimientos de Solo Añadir
 * Ejecutable con Node.js: `node test/t022_libro.test.js`
 *
 * Cubre los puntos de aceptación 1, 3, 4 y 5 de T-022 (D-012, D-022, D-024):
 * - Aceptación 1: Los dos casos de la tabla del problema; tras cada operación,
 *   `reconstruir(movimientos)` da las mismas cajas restantes por capa (mismos `id_capa`)
 *   y el mismo stock por clave que el estado vivo.
 * - Aceptación 3: Ninguna fila de MOVIMIENTOS cambia después de escribirse (comparación de prefijo tras cada operación).
 * - Aceptación 4: 1.000 llamadas a `nuevoId('MOV')` en un bucle no repiten ningún valor.
 * - Aceptación 5: Una base con un ANULACION antiguo (`ANULADO`, sin referencia) se reconstruye con su aviso y sin excepción.
 */

const assert = require('assert');
const { crearEntorno } = require('./helpers/mockSheets');
const { nuevoId } = require('../src/Ids');
const { aplicarMovimiento, reconstruir } = require('../src/Libro');

console.log('================================================================');
console.log(' TEST SUITE T-022 — LIBRO DE MOVIMIENTOS DE SOLO AÑADIR');
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

/**
 * Helper que verifica que `reconstruir(movimientos)` produce exactamente
 * las mismas cajas restantes por capa (mismos `id_capa`) y el mismo stock por clave que el estado vivo,
 * y que `comprobarConsistencia()` devuelve 0 diferencias.
 */
function assertReconstruccionCoincideConVivo(env, contexto = '') {
  const movs = env.repo.getMovimientos();
  const capasVivas = env.repo.getCapasFifo();
  const stockVivoList = env.repo.getStockActual();

  const rec = reconstruir(movs);
  assert.strictEqual(rec.ok, true, `[${contexto}] reconstruir debe devolver ok=true`);
  assert.strictEqual(rec.isConsistent, true, `[${contexto}] reconstruir debe ser internamente consistente`);

  // Mismo número de capas y mismos id_capa con mismas cajas_restantes y estado_capa
  assert.strictEqual(
    rec.estado.capas.length,
    capasVivas.length,
    `[${contexto}] Número de capas reconstruidas (${rec.estado.capas.length}) !== vivas (${capasVivas.length})`
  );

  for (const capaViva of capasVivas) {
    const capaRec = rec.estado.capas.find(c => c.id_capa === capaViva.id_capa);
    assert.ok(capaRec, `[${contexto}] La capa '${capaViva.id_capa}' debe existir en la reconstrucción con el mismo id_capa`);
    assert.strictEqual(
      Number(capaRec.cajas_restantes),
      Number(capaViva.cajas_restantes),
      `[${contexto}] cajas_restantes de capa '${capaViva.id_capa}': reconstruida (${capaRec.cajas_restantes}) !== viva (${capaViva.cajas_restantes})`
    );
    assert.strictEqual(
      Number(capaRec.cajas_iniciales),
      Number(capaViva.cajas_iniciales),
      `[${contexto}] cajas_iniciales de capa '${capaViva.id_capa}': reconstruida (${capaRec.cajas_iniciales}) !== viva (${capaViva.cajas_iniciales})`
    );
    assert.strictEqual(
      Number(capaRec.cajas_consumidas),
      Number(capaViva.cajas_consumidas),
      `[${contexto}] cajas_consumidas de capa '${capaViva.id_capa}': reconstruida (${capaRec.cajas_consumidas}) !== viva (${capaViva.cajas_consumidas})`
    );
    assert.strictEqual(
      capaRec.estado_capa,
      capaViva.estado_capa,
      `[${contexto}] estado_capa de '${capaViva.id_capa}': reconstruida (${capaRec.estado_capa}) !== viva (${capaViva.estado_capa})`
    );
  }

  // Mismo stock por clave
  const stockVivoMap = {};
  for (const s of stockVivoList) {
    stockVivoMap[s.stock_key] = Number(s.cajas_actuales || 0);
  }
  const todasClaves = new Set([...Object.keys(stockVivoMap), ...Object.keys(rec.estado.stock)]);
  for (const k of todasClaves) {
    assert.strictEqual(
      Number(rec.estado.stock[k] || 0),
      Number(stockVivoMap[k] || 0),
      `[${contexto}] Stock para '${k}': reconstruido (${rec.estado.stock[k]}) !== vivo (${stockVivoMap[k]})`
    );
  }

  // comprobarConsistencia() = 0 diferencias
  const consistencia = env.movService.comprobarConsistencia();
  assert.strictEqual(consistencia.consistente, true, `[${contexto}] comprobarConsistencia debe ser true`);
  assert.strictEqual(consistencia.totalDiferencias, 0, `[${contexto}] comprobarConsistencia debe devolver 0 diferencias`);
}

// --------------------------------------------------------------------------
// ACEPTACIÓN 1 (Caso 1): Entradas de 100 y 50; se anula la de 100 -> Vivo 50, Rebuild 50
// --------------------------------------------------------------------------
runTest('1a. Caso 1 tabla problema: Entradas de 100 y 50, se anula la de 100 -> vivo 50 y reconstruir 50 (mismos id_capa)', () => {
  const env = crearEntorno();

  // Paso 1: Entrada de 100
  const r1 = env.movService.registrarEntrada({
    id_documento: 'DOC-C1-100',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '101',
    fecha_documento: '2026-10-01',
    entidad_nombre: 'PROVEEDOR UNO'
  }, [
    { codigo_articulo: 'ART-ROSA', codigo_envase: 'ENV-EPS', cajas: 100, partida: 'P-100' }
  ], 'operador@test');
  assert.strictEqual(r1.success, true);
  assertReconstruccionCoincideConVivo(env, 'Caso 1 tras entrada 100');

  // Paso 2: Entrada de 50
  const r2 = env.movService.registrarEntrada({
    id_documento: 'DOC-C1-50',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '102',
    fecha_documento: '2026-10-02',
    entidad_nombre: 'PROVEEDOR DOS'
  }, [
    { codigo_articulo: 'ART-ROSA', codigo_envase: 'ENV-EPS', cajas: 50, partida: 'P-50' }
  ], 'operador@test');
  assert.strictEqual(r2.success, true);
  assertReconstruccionCoincideConVivo(env, 'Caso 1 tras entrada 50');

  // Paso 3: Se anula la entrada de 100
  const r3 = env.movService.anularEntrada({
    serie: 'ENT',
    numero: '101',
    motivo: 'Albarán duplicado por proveedor'
  }, 'operador@test');
  assert.strictEqual(r3.success, true);
  assert.strictEqual(r3.cajasAnuladas, 100);
  assert.strictEqual(r3.stockRestante, 50);

  // Verificar estado vivo = 50 y reconstruir(movimientos) = 50 con mismos id_capa
  assertReconstruccionCoincideConVivo(env, 'Caso 1 tras anular entrada de 100');

  // Además, ejecutar rebuildStock() y comprobar que mantiene 50
  const reb = env.movService.rebuildStock();
  assert.strictEqual(reb.success, true);
  assert.strictEqual(reb.report.totalCajasPorStock, 50);
  assert.strictEqual(reb.report.totalCajasPorCapas, 50);
});

// --------------------------------------------------------------------------
// ACEPTACIÓN 1 (Caso 2): Entrada de 100; salida de 40 corregida a 30 -> Vivo 70, Rebuild 70
// --------------------------------------------------------------------------
runTest('1b. Caso 2 tabla problema: Entrada de 100, salida de 40 corregida a 30 -> vivo 70 y reconstruir 70 (mismos id_capa)', () => {
  const env = crearEntorno();

  // Paso 1: Entrada de 100
  const r1 = env.movService.registrarEntrada({
    id_documento: 'DOC-C2-ENT',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '201',
    fecha_documento: '2026-10-05',
    entidad_nombre: 'PROVEEDOR NORTE'
  }, [
    { codigo_articulo: 'ART-ROSA', codigo_envase: 'ENV-EPS', cajas: 100, partida: 'P-201' }
  ], 'operador@test');
  assert.strictEqual(r1.success, true);
  assertReconstruccionCoincideConVivo(env, 'Caso 2 tras entrada 100');

  // Paso 2: Salida de 40 (quedan 60)
  const r2 = env.movService.registrarSalida({
    id_documento: 'DOC-C2-SAL',
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '202',
    fecha_documento: '2026-10-06',
    entidad_nombre: 'CLIENTE CENTRO'
  }, [
    { codigo_articulo: 'ART-ROSA', codigo_envase: 'ENV-EPS', cajas: 40 }
  ], 'operador@test');
  assert.strictEqual(r2.success, true);
  assertReconstruccionCoincideConVivo(env, 'Caso 2 tras salida 40');

  // Paso 3: Salida de 40 corregida a 30 (devuelve 10 -> quedan 70)
  const r3 = env.movService.corregirCantidadSalida({
    serie: 'SAL',
    numero: '202',
    nuevaCantidad: 30,
    motivo: 'Error en conteo de palet'
  }, 'operador@test');
  assert.strictEqual(r3.success, true);
  assert.strictEqual(r3.cajasRestauradas, 10);
  assert.strictEqual(r3.stockNuevo, 70);

  // El movimiento original de salida sigue teniendo cajas = 40 (inmutable, D-022)
  const movs = env.repo.getMovimientos();
  const movSalidaOriginal = movs.find(m => m.tipo_movimiento === 'SALIDA');
  assert.strictEqual(Number(movSalidaOriginal.cajas), 40, 'El movimiento original de salida NO debe reescribirse');

  // Verificar estado vivo = 70 y reconstruir(movimientos) = 70 con mismos id_capa
  assertReconstruccionCoincideConVivo(env, 'Caso 2 tras corregir salida de 40 a 30');

  // Además, ejecutar rebuildStock() y comprobar que mantiene 70 (no 80)
  const reb = env.movService.rebuildStock();
  assert.strictEqual(reb.success, true);
  assert.strictEqual(reb.report.totalCajasPorStock, 70);
  assert.strictEqual(reb.report.totalCajasPorCapas, 70);
});

// --------------------------------------------------------------------------
// ACEPTACIÓN 3: Ninguna fila de MOVIMIENTOS cambia después de escribirse
// --------------------------------------------------------------------------
runTest('3. Inmutabilidad estricta: ninguna fila de MOVIMIENTOS cambia después de escribirse (comparación de prefijo)', () => {
  const env = crearEntorno();
  let snapshotPrevio = [];

  function verificarPrefijoInmutable(nombreOperacion) {
    const actuales = env.repo.getMovimientos().map(m => JSON.stringify(m));
    assert.ok(
      actuales.length >= snapshotPrevio.length,
      `[${nombreOperacion}] El número de filas de MOVIMIENTOS nunca puede disminuir (${actuales.length} < ${snapshotPrevio.length})`
    );
    for (let i = 0; i < snapshotPrevio.length; i++) {
      assert.strictEqual(
        actuales[i],
        snapshotPrevio[i],
        `[${nombreOperacion}] La fila histórica #${i + 1} de MOVIMIENTOS fue modificada después de escribirse`
      );
    }
    snapshotPrevio = actuales;
    assertReconstruccionCoincideConVivo(env, nombreOperacion);
  }

  // 1. Entrada 1 (200 cajas)
  env.movService.registrarEntrada({
    id_documento: 'DOC-INM-1',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '1',
    fecha_documento: '2026-10-01',
    entidad_nombre: 'PROV A'
  }, [{ codigo_articulo: 'ART-A', codigo_envase: 'ENV-1', cajas: 200, partida: 'LOTE-A' }]);
  verificarPrefijoInmutable('Entrada 1');

  // 2. Entrada 2 (80 cajas, para anular después)
  env.movService.registrarEntrada({
    id_documento: 'DOC-INM-2',
    tipo_documento: 'COMPRA',
    serie: 'ENT',
    numero: '2',
    fecha_documento: '2026-10-02',
    entidad_nombre: 'PROV B'
  }, [{ codigo_articulo: 'ART-B', codigo_envase: 'ENV-1', cajas: 80, partida: 'LOTE-B' }]);
  verificarPrefijoInmutable('Entrada 2');

  // 3. Salida de 50 cajas de ART-A
  env.movService.registrarSalida({
    id_documento: 'DOC-INM-3',
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '10',
    fecha_documento: '2026-10-03',
    entidad_nombre: 'CLI 1'
  }, [{ codigo_articulo: 'ART-A', codigo_envase: 'ENV-1', cajas: 50 }]);
  verificarPrefijoInmutable('Salida 1');

  // 4. Corregir cantidad de salida a la baja (50 -> 35)
  env.movService.corregirCantidadSalida({
    serie: 'SAL',
    numero: '10',
    nuevaCantidad: 35,
    motivo: 'Devolución en muelle'
  });
  verificarPrefijoInmutable('Corregir salida a la baja (50 -> 35)');

  // 5. Corregir cantidad de salida al alza (35 -> 60)
  env.movService.corregirCantidadSalida({
    serie: 'SAL',
    numero: '10',
    nuevaCantidad: 60,
    motivo: 'Ampliación de carga'
  });
  verificarPrefijoInmutable('Corregir salida al alza (35 -> 60)');

  // 6. Corregir cantidad de entrada a la baja (200 -> 180)
  env.movService.corregirCantidadEntrada({
    serie: 'ENT',
    numero: '1',
    nuevaCantidad: 180,
    motivo: 'Destrío inicial'
  });
  verificarPrefijoInmutable('Corregir entrada a la baja (200 -> 180)');

  // 7. Corregir cantidad de entrada al alza (180 -> 190)
  env.movService.corregirCantidadEntrada({
    serie: 'ENT',
    numero: '1',
    nuevaCantidad: 190,
    motivo: 'Palet adicional'
  });
  verificarPrefijoInmutable('Corregir entrada al alza (180 -> 190)');

  // 8. Reclasificación (20 cajas de ART-A|ENV-1 a ART-A|ENV-2)
  env.movService.registrarReclasificacion({
    codigo_articulo_origen: 'ART-A',
    codigo_envase_origen: 'ENV-1',
    codigo_articulo_destino: 'ART-A',
    codigo_envase_destino: 'ENV-2',
    cajas: 20,
    motivo: 'RECLASIFICACION'
  });
  verificarPrefijoInmutable('Reclasificación');

  // 9. Movimiento entre partidas (15 cajas de LOTE-A a LOTE-A2)
  env.movService.registrarMovimientoPartida({
    codigo_articulo: 'ART-A',
    codigo_envase: 'ENV-1',
    partida_origen: 'LOTE-A',
    partida_destino: 'LOTE-A2',
    cajas: 15,
    motivo: 'MOVER_PARTIDA'
  });
  verificarPrefijoInmutable('Movimiento entre partidas');

  // 10. División de entrada (capa LOTE-A tiene 60+20+15=95 consumidas y 95 restantes -> total 190; dividir en 140 ART-A + 50 ART-C)
  env.movService.dividirCapaEntrada({
    serie: 'ENT',
    numero: '1',
    codigo_articulo: 'ART-A',
    codigo_envase: 'ENV-1',
    divisiones: [
      { codigo_articulo: 'ART-A', codigo_envase: 'ENV-1', cajas: 140, partida: 'LOTE-A' },
      { codigo_articulo: 'ART-C', codigo_envase: 'ENV-1', cajas: 50, partida: 'LOTE-C' }
    ],
    motivo: 'DIVISION'
  });
  verificarPrefijoInmutable('División de capa');

  // 11. Corrección de entrada parcial (trasladar las 45 restantes de LOTE-A a ART-D)
  env.movService.corregirEntradaParcial({
    serie: 'ENT',
    numero: '1',
    codigo_articulo: 'ART-A',
    codigo_envase: 'ENV-1',
    nuevoArticulo: 'ART-D',
    motivo: 'CORRECCION_PARCIAL'
  });
  verificarPrefijoInmutable('Corrección entrada parcial');

  // 12. Anular salida (SAL/10)
  env.movService.anularSalida({
    serie: 'SAL',
    numero: '10',
    motivo: 'ANULAR_SALIDA'
  });
  verificarPrefijoInmutable('Anular salida');

  // 13. Anular entrada sin consumos (ENT/2)
  env.movService.anularEntrada({
    serie: 'ENT',
    numero: '2',
    motivo: 'ANULAR_ENTRADA'
  });
  verificarPrefijoInmutable('Anular entrada');
});

// --------------------------------------------------------------------------
// ACEPTACIÓN 4: 1.000 llamadas a nuevoId('MOV') en un bucle no repiten ningún valor
// --------------------------------------------------------------------------
runTest('4. 1.000 llamadas a nuevoId("MOV") en un bucle generan 1.000 identificadores únicos sin colisión', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) {
    const id = nuevoId('MOV');
    assert.ok(typeof id === 'string' && id.startsWith('MOV-'), `ID inválido en iteración ${i}: ${id}`);
    assert.ok(!ids.has(id), `Colisión detectada en iteración ${i}: ${id}`);
    ids.add(id);
  }
  assert.strictEqual(ids.size, 1000);
});

// --------------------------------------------------------------------------
// ACEPTACIÓN 5: Base con un ANULACION antiguo (ANULADO, sin referencia)
// --------------------------------------------------------------------------
runTest('5. Base con un ANULACION antiguo (ANULADO, sin referencia identificable) se reconstruye con aviso y sin excepción', () => {
  const movimientosConLegacy = [
    {
      id_movimiento: 'MOV-ENT-1',
      fecha_hora: '2026-10-01T08:00:00.000Z',
      tipo_movimiento: 'ENTRADA',
      id_documento_ref: 'DOC-1',
      codigo_articulo: 'ART-1',
      codigo_envase: 'ENV-1',
      cajas: 100,
      signo: 1,
      partida_origen: 'P1',
      motivo_ajuste: '',
      usuario: 'op@test',
      observaciones: '',
      estado: 'CONFIRMADO',
      fecha_negocio: '2026-10-01',
      entidad_nombre: 'PROV 1',
      secuencia: 1,
      origen_dato: 'MANUAL',
      kg_informativo: '',
      id_movimiento_ref: '',
      id_capa_objetivo: '',
      id_capa_creada: 'CAPA-1'
    },
    // ANULACION antiguo con estado ANULADO y sin id_movimiento_ref ni id_documento_ref identificable
    {
      id_movimiento: 'MOV-ANUL-HUERFANO',
      fecha_hora: '2026-10-02T09:00:00.000Z',
      tipo_movimiento: 'ANULACION',
      id_documento_ref: 'DOC-INEXISTENTE-999',
      codigo_articulo: 'ART-1',
      codigo_envase: 'ENV-1',
      cajas: 40,
      signo: -1,
      partida_origen: '',
      motivo_ajuste: 'ANULAR_ENTRADA',
      usuario: 'op@test',
      observaciones: 'Fila histórica sin referencia',
      estado: 'ANULADO',
      fecha_negocio: '2026-10-02',
      entidad_nombre: '',
      secuencia: 2,
      origen_dato: 'MANUAL',
      kg_informativo: '',
      id_movimiento_ref: '',
      id_capa_objetivo: '',
      id_capa_creada: ''
    }
  ];

  const rec = reconstruir(movimientosConLegacy);
  assert.strictEqual(rec.ok, true, 'No debe lanzar excepción');
  assert.strictEqual(rec.avisos.length, 1, 'Debe registrar exactamente 1 aviso por el ANULACION antiguo sin referencia');
  assert.strictEqual(rec.avisos[0].id_movimiento, 'MOV-ANUL-HUERFANO');
  assert.strictEqual(rec.estado.stock['ART-1|ENV-1'], 100);

  // También comprobar que si el ANULACION antiguo SÍ tiene id_documento_ref que identifica la entrada, la anula
  const movimientosConLegacyIdentificable = [
    movimientosConLegacy[0],
    {
      ...movimientosConLegacy[1],
      id_movimiento: 'MOV-ANUL-CON-DOC',
      id_documento_ref: 'DOC-1',
      cajas: 100
    }
  ];
  const rec2 = reconstruir(movimientosConLegacyIdentificable);
  assert.strictEqual(rec2.ok, true);
  assert.strictEqual(rec2.avisos.length, 0, 'Con id_documento_ref identificable se aplica sin aviso');
  assert.strictEqual(rec2.estado.stock['ART-1|ENV-1'], 0);
  assert.strictEqual(rec2.estado.capas[0].estado_capa, 'ANULADA');
});

console.log('\n================================================================');
console.log(` RESULTADOS T-022 LIBRO: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
