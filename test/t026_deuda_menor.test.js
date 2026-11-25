/**
 * STOCK-LIGHT — Test Suite T-026: deuda menor de T-008 y T-011
 *
 * Cubre los puntos de aceptación 1 a 4 de docs/tickets/T-026-deuda-menor.md.
 * Ejecutable: node test/t026_deuda_menor.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');
const { PendientesService } = require('../src/importacion/PendientesService');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'csv');
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
    if (err.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'));
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
    serie = 'ACT26',
    linea = 1,
    articulo = 'TOMATE FICTICIO',
    envase = 'CAJA',
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
    serie = 'AVT26',
    linea = 1,
    articulo = 'TOMATE FICTICIO',
    envase = 'CAJA',
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

function crearCatalogo(repo) {
  repo.replaceTable('ATRIBUTOS', [{ nombre: 'SEGUIMIENTO', descripcion: 'Seguimiento', activo: true }]);
  repo.replaceTable('REGLAS_CLASIFICACION', [
    { id: 'R-TOMATE', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 1, articulo_contiene: 'TOMATE FICTICIO', activo: true },
    { id: 'R-PEPINO', atributo: 'SEGUIMIENTO', valor: 'NO', prioridad: 2, articulo_contiene: 'PEPINO FICTICIO', activo: true }
  ]);
  return new CatalogoService({ repository: repo });
}

function documentoDe(repo, tipo, serie, numero) {
  return repo.getDocumentos().find(doc => (
    String(doc.tipo_documento || '').trim().toUpperCase() === String(tipo).trim().toUpperCase()
    && String(doc.serie || '').trim() === String(serie).trim()
    && String(doc.numero || '').trim() === String(numero).trim()
  ));
}

function sumaMovimientosDocumento(repo, documento) {
  const id = String(documento && documento.id_documento || '').trim();
  return repo.getMovimientos()
    .filter(mov => (
      String(mov.id_documento_ref || '').trim() === id
      && String(mov.estado || '').trim().toUpperCase() === 'CONFIRMADO'
      && ['ENTRADA', 'SALIDA'].includes(String(mov.tipo_movimiento || '').trim().toUpperCase())
    ))
    .reduce((total, mov) => total + Math.abs(Number(mov.cajas) || 0), 0);
}

function pendientesModificados(repo) {
  return repo.getPendientes().filter(p => String(p.motivo || '').trim().toUpperCase() === 'MODIFICADO_EN_ERP');
}

console.log('\n================================================================');
console.log(' TEST SUITE T-026 — DEUDA MENOR DE T-008 Y T-011');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// Aceptación 1: desconocida -> SEGUIDA sin stock y aplicación posterior
// ---------------------------------------------------------------------------

runTest('1. Una línea desconocida que pasa a SEGUIDA sin stock suma total_cajas y luego aplica sin duplicarlo', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const importacion = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogo
  });

  const csvVenta = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '03/11/2026', serie: 'AVT26', numero: '1001', articulo: 'CALABACIN DEUDA', cajas: 15 })
  ]);
  const confirmada = importacion.confirmar(csvVenta, importacion.previsualizar(csvVenta).hash, 'operador@test');
  assert.strictEqual(confirmada.success, true);

  let documento = documentoDe(env.repo, 'SALIDA', 'AVT26', '1001');
  assert.ok(documento, 'Debe existir el documento de la venta');
  assert.strictEqual(documento.estado_proceso, 'PENDIENTE_REVISION');
  assert.strictEqual(Number(documento.total_cajas), 0, 'La línea desconocida aún no cuenta');

  // La regla se añade al final: la línea pasa a SEGUIDA, pero todavía no hay stock.
  env.repo.upsertReglaClasificacion({
    id: 'R-CALABACIN-DEUDA',
    atributo: 'SEGUIMIENTO',
    valor: 'SI',
    prioridad: 1,
    articulo_contiene: 'CALABACIN DEUDA',
    activo: true
  });
  catalogo.invalidarCache();

  const pendientes = new PendientesService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogo
  });

  const primero = pendientes.reintentarPendientes('operador@test');
  assert.strictEqual(primero.aplicados.total, 0);
  assert.strictEqual(primero.siguenPendientes.STOCK_INSUFICIENTE, 1);
  documento = documentoDe(env.repo, 'SALIDA', 'AVT26', '1001');
  assert.strictEqual(documento.estado_proceso, 'PENDIENTE_REVISION');
  assert.strictEqual(
    Number(documento.total_cajas),
    15,
    'Al pasar a SEGUIDA sin stock, las cajas deben entrar en total_cajas'
  );
  assert.strictEqual(env.repo.getMovimientos().length, 0);

  // Llega el stock y se reintenta más tarde.
  env.movService.registrarEntrada({
    id_documento: 'DOC-COMPRA-T026-1',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '2001',
    fecha_documento: '2026-11-02',
    entidad_nombre: 'PROVEEDOR FICTICIO'
  }, [
    { codigo_articulo: 'CALABACIN DEUDA', codigo_envase: 'CAJA', cajas: 50 }
  ], 'operador@test');

  const segundo = pendientes.reintentarPendientes('operador@test');
  assert.strictEqual(segundo.aplicados.STOCK_INSUFICIENTE, 1);
  documento = documentoDe(env.repo, 'SALIDA', 'AVT26', '1001');
  assert.strictEqual(documento.estado_proceso, 'CONFIRMADO');
  assert.strictEqual(Number(documento.total_cajas), 15, 'No debe sumarse una segunda vez');
  assert.strictEqual(sumaMovimientosDocumento(env.repo, documento), 15);
  assert.strictEqual(Number(documento.total_cajas), sumaMovimientosDocumento(env.repo, documento));
});

// ---------------------------------------------------------------------------
// Aceptación 2: la misma línea aplicada en el mismo reintento
// ---------------------------------------------------------------------------

runTest('2. La misma línea aplicada en el mismo reintento suma sus cajas una sola vez', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const importacion = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogo
  });

  const csvVenta = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '03/11/2026', serie: 'AVT26', numero: '1002', articulo: 'CALABACIN DEUDA', cajas: 20 })
  ]);
  importacion.confirmar(csvVenta, importacion.previsualizar(csvVenta).hash, 'operador@test');

  // Hay stock antes de añadir la regla: la línea se aplicará en el mismo reintento.
  env.movService.registrarEntrada({
    id_documento: 'DOC-COMPRA-T026-2',
    tipo_documento: 'COMPRA',
    serie: 'ACT26',
    numero: '2002',
    fecha_documento: '2026-11-02',
    entidad_nombre: 'PROVEEDOR FICTICIO'
  }, [
    { codigo_articulo: 'CALABACIN DEUDA', codigo_envase: 'CAJA', cajas: 50 }
  ], 'operador@test');

  env.repo.upsertReglaClasificacion({
    id: 'R-CALABACIN-DEUDA-2',
    atributo: 'SEGUIMIENTO',
    valor: 'SI',
    prioridad: 1,
    articulo_contiene: 'CALABACIN DEUDA',
    activo: true
  });
  catalogo.invalidarCache();

  const pendientes = new PendientesService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogo
  });
  const resultado = pendientes.reintentarPendientes('operador@test');
  assert.strictEqual(resultado.aplicados.SEGUIMIENTO_DESCONOCIDO, 1);

  const documento = documentoDe(env.repo, 'SALIDA', 'AVT26', '1002');
  assert.strictEqual(documento.estado_proceso, 'CONFIRMADO');
  assert.strictEqual(Number(documento.total_cajas), 20);
  assert.strictEqual(sumaMovimientosDocumento(env.repo, documento), 20);
});

// ---------------------------------------------------------------------------
// Aceptación 3: 30 semillas de días desordenados
// ---------------------------------------------------------------------------

runTest('3. 30 semillas: documentos CONFIRMADOS con total_cajas correcto y sin MODIFICADO_EN_ERP al reimportar', () => {
  let documentosRevisados = 0;
  let documentosConfirmados = 0;

  for (let semilla = 0; semilla < 30; semilla++) {
    const env = crearEntorno();
    const catalogo = crearCatalogo(env.repo);
    const importacion = new ImportacionService({
      repository: env.repo,
      movementService: env.movService,
      catalogoService: catalogo
    });

    // Días desordenados: el orden de importación no es el orden cronológico.
    const dia = (offset) => `${String(((semilla * 3 + offset * 5) % 28) + 1).padStart(2, '0')}/01/2026`;
    const csvs = [];

    const importar = (csv) => {
      const preview = importacion.previsualizar(csv);
      const resultado = importacion.confirmar(csv, preview.hash, 'operador@test');
      assert.strictEqual(resultado.success, true, `Semilla ${semilla}: ${resultado.error || ''}`);
      csvs.push(csv);
      return resultado;
    };

    // Ventas antes que compras; dos de ellas con artículo desconocido.
    importar(crearCsv(HEADER_VENTAS, [
      filaVenta({ fecha: dia(20), serie: 'AVT26', numero: String(3000 + semilla * 10 + 1), articulo: 'CALABACIN SEMILLA', cajas: 5 })
    ]));
    importar(crearCsv(HEADER_VENTAS, [
      filaVenta({ fecha: dia(2), serie: 'AVT26', numero: String(3000 + semilla * 10 + 2), articulo: 'TOMATE FICTICIO', cajas: 10 })
    ]));
    importar(crearCsv(HEADER_VENTAS, [
      filaVenta({ fecha: dia(10), serie: 'AVT26', numero: String(3000 + semilla * 10 + 3), articulo: 'CALABACIN SEMILLA', cajas: 7 })
    ]));
    importar(crearCsv(HEADER_COMPRAS, [
      filaCompra({ fecha: dia(1), serie: 'ACT26', numero: String(4000 + semilla * 10 + 1), articulo: 'TOMATE FICTICIO', cajas: 20 })
    ]));

    // Regla al final: CALABACIN SEMILLA pasa a SEGUIDA, todavía sin stock.
    env.repo.upsertReglaClasificacion({
      id: `R-SEMILLA-${semilla}`,
      atributo: 'SEGUIMIENTO',
      valor: 'SI',
      prioridad: 1,
      articulo_contiene: 'CALABACIN SEMILLA',
      activo: true
    });
    catalogo.invalidarCache();

    const pendientes = new PendientesService({
      repository: env.repo,
      movementService: env.movService,
      catalogoService: catalogo
    });
    pendientes.reintentarPendientes('operador@test');

    const venta1 = documentoDe(env.repo, 'SALIDA', 'AVT26', String(3000 + semilla * 10 + 1));
    const venta2 = documentoDe(env.repo, 'SALIDA', 'AVT26', String(3000 + semilla * 10 + 3));
    assert.strictEqual(Number(venta1.total_cajas), 5, `Semilla ${semilla}: venta 1 sin stock`);
    assert.strictEqual(Number(venta2.total_cajas), 7, `Semilla ${semilla}: venta 2 sin stock`);
    assert.strictEqual(venta1.estado_proceso, 'PENDIENTE_REVISION');
    assert.strictEqual(venta2.estado_proceso, 'PENDIENTE_REVISION');

    // Compra grande que desbloquea todo.
    importar(crearCsv(HEADER_COMPRAS, [
      filaCompra({ fecha: dia(15), serie: 'ACT26', numero: String(4000 + semilla * 10 + 2), articulo: 'CALABACIN SEMILLA', cajas: 1000 })
    ]));

    const documentos = env.repo.getDocumentos();
    for (const documento of documentos) {
      documentosRevisados++;
      assert.strictEqual(
        documento.estado_proceso,
        'CONFIRMADO',
        `Semilla ${semilla}: documento ${documento.serie}/${documento.numero} quedó ${documento.estado_proceso}`
      );
      documentosConfirmados++;
      assert.strictEqual(
        Number(documento.total_cajas),
        sumaMovimientosDocumento(env.repo, documento),
        `Semilla ${semilla}: total_cajas incorrecto en ${documento.serie}/${documento.numero}`
      );
    }
    assert.strictEqual(pendientesModificados(env.repo).length, 0, `Semilla ${semilla}: MODIFICADO_EN_ERP inesperado`);

    // Reimportar todos los CSV no debe crear MODIFICADO_EN_ERP.
    for (const csv of csvs) {
      const preview = importacion.previsualizar(csv);
      const resultado = importacion.confirmar(csv, preview.hash, 'operador@test');
      assert.strictEqual(resultado.success, true, `Semilla ${semilla}: reimportación fallida`);
    }
    assert.strictEqual(pendientesModificados(env.repo).length, 0, `Semilla ${semilla}: MODIFICADO_EN_ERP tras reimportar`);
  }

  assert.ok(documentosRevisados >= 30 * 5, 'Deben revisarse todos los documentos de las 30 semillas');
  assert.strictEqual(documentosConfirmados, documentosRevisados);
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-026: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
