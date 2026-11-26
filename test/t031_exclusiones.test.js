/**
 * STOCK-LIGHT — Test Suite T-031: exclusiones de clientes y nombres comerciales
 *
 * Cubre los puntos de aceptación 1 a 7 de docs/tickets/T-031-exclusiones.md.
 * Ejecutable: node test/t031_exclusiones.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');
const {
  adminConfigurarClientesExcluidos,
  adminConfigurarArticulosFuera,
  esClienteExcluido_
} = require('../src/Exclusiones');
const { PERMISOS_API, conContextoDePrueba_ } = require('../src/Seguridad');
const codigo = require('../src/Código');

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

function sesionPropietario() {
  return {
    getActiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' }),
    getEffectiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' })
  };
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
    serie = 'AVT26',
    linea = 1,
    articulo = 'TOMATE FICTICIO',
    envase = 'CAJA FICTICIA',
    cajas = 12,
    kg = 60,
    cliente = 'DESTINATARIO INVENTADO'
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
  repo.replaceTable('REGLAS_CLASIFICACION', [{
    id: 'R-TOMATE',
    atributo: 'SEGUIMIENTO',
    valor: 'SI',
    prioridad: 30,
    articulo_contiene: 'TOMATE',
    activo: true
  }]);
  return new CatalogoService({ repository: repo });
}

function crearImportador(env, catalogo) {
  return new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogo
  });
}

function importar(importador, texto) {
  const preview = importador.previsualizar(texto);
  const confirmada = importador.confirmar(texto, preview.hash, 'operador@test');
  assert.strictEqual(confirmada.success, true, confirmada.error || 'La importación debe confirmarse');
  return { preview, confirmada };
}

function stockDe(env, articulo, envase) {
  const fila = env.repo.getStockActual().find(item => (
    item.codigo_articulo === articulo && item.codigo_envase === envase
  ));
  return fila ? Number(fila.cajas_actuales) : 0;
}

console.log('\n================================================================');
console.log(' TEST SUITE T-031 — EXCLUSIONES DE CLIENTES Y NOMBRES COMERCIALES');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// Aceptación 1: clientes excluidos
// ---------------------------------------------------------------------------

runTest('1. Una venta a cliente excluido no toca stock ni pendientes y se cuenta aparte', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const alta = adminConfigurarClientesExcluidos(['CLIENTE FICTICIO'], {
    repository: env.repo,
    session: sesionPropietario()
  });
  assert.deepStrictEqual(alta.anadidos, ['CLIENTE FICTICIO']);

  const importador = crearImportador(env, catalogo);
  importar(importador, crearCsv(HEADER_COMPRAS, [
    filaCompra({ numero: '9101', articulo: 'TOMATE FICTICIO', cajas: 10 })
  ]));
  assert.strictEqual(env.repo.getMovimientos().length, 1);

  const ventaExcluida = crearCsv(HEADER_VENTAS, [
    filaVenta({
      numero: '9102',
      cliente: 'Cliente Ficticio, S.L.',
      articulo: 'TOMATE FICTICIO',
      cajas: 3
    })
  ]);
  const previewExcluida = importador.previsualizar(ventaExcluida);
  assert.strictEqual(previewExcluida.lineasClienteExcluido, 1);
  assert.strictEqual(previewExcluida.resumen.porEstado.CLIENTE_EXCLUIDO, 1);
  const confirmadaExcluida = importador.confirmar(ventaExcluida, previewExcluida.hash, 'operador@test');
  assert.strictEqual(confirmadaExcluida.success, true);
  assert.strictEqual(env.repo.getMovimientos().length, 1, 'La venta excluida no genera movimientos');
  assert.strictEqual(env.repo.getPendientes().length, 0, 'La venta excluida no va a pendientes');
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 10);

  const filaImportacion = env.repo.getImportaciones().find(fila => fila.hash === previewExcluida.hash);
  assert.ok(filaImportacion);
  assert.strictEqual(Number(filaImportacion.lineas_cliente_excluido), 1);

  importar(importador, crearCsv(HEADER_VENTAS, [
    filaVenta({
      numero: '9103',
      cliente: 'DESTINATARIO INVENTADO',
      articulo: 'TOMATE FICTICIO',
      cajas: 2
    })
  ]));
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 8);
  assert.strictEqual(env.repo.getMovimientos().filter(mov => mov.tipo_movimiento === 'SALIDA').length, 1);
});

// ---------------------------------------------------------------------------
// Aceptación 2: nombres comerciales fuera
// ---------------------------------------------------------------------------

runTest('2. Un nombre comercial fuera queda NO_SEGUIDA aunque empiece por TOMATE', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const alta = adminConfigurarArticulosFuera(['NOMBRE COMERCIAL X'], {
    repository: env.repo,
    session: sesionPropietario()
  });
  assert.deepStrictEqual(alta.anadidos, ['NOMBRE COMERCIAL X']);
  catalogo.invalidarCache();

  assert.strictEqual(
    catalogo.esCombinacionSeguida('TOMATE NOMBRE COMERCIAL X EXTRA', 'CAJA FICTICIA'),
    'NO_SEGUIDA'
  );
  assert.strictEqual(
    catalogo.esCombinacionSeguida('TOMATE FICTICIO', 'CAJA FICTICIA'),
    'SEGUIDA'
  );
});

// ---------------------------------------------------------------------------
// Aceptación 3: idempotencia y propietario
// ---------------------------------------------------------------------------

runTest('3. Las funciones admin son idempotentes y solo las ejecuta el propietario', () => {
  const env = crearEntorno();
  const opciones = { repository: env.repo, session: sesionPropietario() };

  const clientes1 = adminConfigurarClientesExcluidos(['CLIENTE FICTICIO UNO', 'CLIENTE FICTICIO DOS'], opciones);
  const clientes2 = adminConfigurarClientesExcluidos(['CLIENTE FICTICIO UNO', 'CLIENTE FICTICIO DOS'], opciones);
  assert.strictEqual(clientes1.anadidos.length, 2);
  assert.strictEqual(clientes2.anadidos.length, 0);
  assert.deepStrictEqual(clientes2.yaEstaban.sort(), ['CLIENTE FICTICIO DOS', 'CLIENTE FICTICIO UNO']);
  assert.strictEqual(env.repo.readTable('CLIENTES_EXCLUIDOS').length, 2);

  const fuera1 = adminConfigurarArticulosFuera(['NOMBRE COMERCIAL X', 'NOMBRE COMERCIAL Y'], opciones);
  const reglasTrasPrimera = env.repo.getReglasClasificacion().length;
  const fuera2 = adminConfigurarArticulosFuera(['NOMBRE COMERCIAL X', 'NOMBRE COMERCIAL Y'], opciones);
  assert.strictEqual(fuera1.anadidos.length, 2);
  assert.strictEqual(fuera2.anadidos.length, 0);
  assert.deepStrictEqual(fuera2.yaEstaban.sort(), ['NOMBRE COMERCIAL X', 'NOMBRE COMERCIAL Y']);
  assert.strictEqual(env.repo.getReglasClasificacion().length, reglasTrasPrimera);

  assert.throws(
    () => adminConfigurarClientesExcluidos(['NADIE'], { repository: env.repo }),
    /Operación reservada al administrador/
  );
  assert.throws(
    () => adminConfigurarArticulosFuera(['NADIE'], { repository: env.repo }),
    /Operación reservada al administrador/
  );
});

// ---------------------------------------------------------------------------
// Aceptación 4: documento totalmente excluido y reimportación
// ---------------------------------------------------------------------------

runTest('4. Un CSV con todas las líneas excluidas se reimporta como YA_IMPORTADO sin filas nuevas', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  adminConfigurarClientesExcluidos(['CLIENTE FICTICIO UNO'], {
    repository: env.repo,
    session: sesionPropietario()
  });

  const importador = crearImportador(env, catalogo);
  const csv = crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '9301', linea: 1, cliente: 'CLIENTE FICTICIO UNO', cajas: 4 }),
    filaVenta({ numero: '9301', linea: 2, cliente: 'CLIENTE FICTICIO UNO', cajas: 6 })
  ]);

  const primera = importador.confirmar(csv, importador.previsualizar(csv).hash, 'operador@test');
  assert.strictEqual(primera.success, true);
  assert.strictEqual(env.repo.getDocumentos().length, 1);
  assert.strictEqual(env.repo.getMovimientos().length, 0);
  assert.strictEqual(env.repo.getPendientes().length, 0);
  assert.strictEqual(env.repo.getImportaciones().length, 1);

  const segunda = importador.confirmar(csv, importador.previsualizar(csv).hash, 'operador@test');
  assert.strictEqual(segunda.success, true);
  assert.strictEqual(segunda.status, 'YA_IMPORTADO');
  assert.strictEqual(segunda.yaImportado, true);
  assert.strictEqual(env.repo.getDocumentos().length, 1);
  assert.strictEqual(env.repo.getMovimientos().length, 0);
  assert.strictEqual(env.repo.getPendientes().length, 0);
  assert.strictEqual(env.repo.getImportaciones().length, 1);
});

// ---------------------------------------------------------------------------
// Aceptación 5: 30 semillas de exclusiones mezcladas
// ---------------------------------------------------------------------------

runTest('5. 30 semillas: stock correcto, sin movimientos de líneas excluidas y consistencia', () => {
  const patronesClientes = ['CLIENTE EXCLUIDO UNO', 'CLIENTE EXCLUIDO DOS'];
  const patronesFuera = ['NOMBRE COMERCIAL FUERA X', 'NOMBRE COMERCIAL FUERA Y'];

  for (let semilla = 0; semilla < 30; semilla++) {
    const env = crearEntorno();
    const catalogo = crearCatalogo(env.repo);
    const opciones = { repository: env.repo, session: sesionPropietario() };
    adminConfigurarClientesExcluidos(patronesClientes, opciones);
    adminConfigurarArticulosFuera(patronesFuera, opciones);
    catalogo.invalidarCache();

    const dia = (offset) => `${String(((semilla * 3 + offset * 5) % 28) + 1).padStart(2, '0')}/01/2026`;
    const compraA = crearCsv(HEADER_COMPRAS, [
      filaCompra({ fecha: dia(1), numero: String(5000 + semilla * 10 + 1), articulo: 'TOMATE FICTICIO', cajas: 20 })
    ]);
    const compraB = crearCsv(HEADER_COMPRAS, [
      filaCompra({ fecha: dia(2), numero: String(5000 + semilla * 10 + 2), articulo: 'TOMATE FICTICIO DOS', cajas: 15 })
    ]);
    const compraFuera = crearCsv(HEADER_COMPRAS, [
      filaCompra({ fecha: dia(3), numero: String(5000 + semilla * 10 + 3), articulo: 'TOMATE NOMBRE COMERCIAL FUERA X', cajas: 10 })
    ]);
    const ventaA = crearCsv(HEADER_VENTAS, [
      filaVenta({ fecha: dia(10), numero: String(6000 + semilla * 10 + 1), cliente: 'DESTINATARIO INVENTADO', articulo: 'TOMATE FICTICIO', cajas: 5 })
    ]);
    const ventaB = crearCsv(HEADER_VENTAS, [
      filaVenta({ fecha: dia(11), numero: String(6000 + semilla * 10 + 2), cliente: 'DESTINATARIO INVENTADO', articulo: 'TOMATE FICTICIO DOS', cajas: 4 })
    ]);
    const ventaExcluidaA = crearCsv(HEADER_VENTAS, [
      filaVenta({ fecha: dia(12), numero: String(6000 + semilla * 10 + 3), cliente: 'CLIENTE EXCLUIDO UNO', articulo: 'TOMATE FICTICIO', cajas: 3 })
    ]);
    const ventaExcluidaB = crearCsv(HEADER_VENTAS, [
      filaVenta({ fecha: dia(13), numero: String(6000 + semilla * 10 + 4), cliente: 'CLIENTE EXCLUIDO DOS', articulo: 'TOMATE FICTICIO DOS', cajas: 2 })
    ]);
    const ventaFuera = crearCsv(HEADER_VENTAS, [
      filaVenta({ fecha: dia(14), numero: String(6000 + semilla * 10 + 5), cliente: 'DESTINATARIO INVENTADO', articulo: 'TOMATE NOMBRE COMERCIAL FUERA X', cajas: 1 })
    ]);

    const importador = crearImportador(env, catalogo);
    const documentos = [compraA, compraB, compraFuera, ventaA, ventaB, ventaExcluidaA, ventaExcluidaB, ventaFuera];
    const desplazamiento = semilla % documentos.length;
    const orden = documentos.slice(desplazamiento).concat(documentos.slice(0, desplazamiento));
    for (const csv of orden) importar(importador, csv);

    assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 15, `Semilla ${semilla}: stock A`);
    assert.strictEqual(stockDe(env, 'TOMATE FICTICIO DOS', 'CAJA FICTICIA'), 11, `Semilla ${semilla}: stock B`);
    assert.strictEqual(stockDe(env, 'TOMATE NOMBRE COMERCIAL FUERA X', 'CAJA FICTICIA'), 0, `Semilla ${semilla}: fuera`);
    assert.strictEqual(
      env.repo.getPendientes().filter(p => p.estado === 'PENDIENTE').length,
      0,
      `Semilla ${semilla}: no deben quedar pendientes activos`
    );

    for (const movimiento of env.repo.getMovimientos()) {
      assert.ok(
        !esClienteExcluido_(movimiento.entidad_nombre, patronesClientes),
        `Semilla ${semilla}: movimiento de cliente excluido`
      );
      assert.ok(
        !String(movimiento.codigo_articulo || '').includes('NOMBRE COMERCIAL FUERA'),
        `Semilla ${semilla}: movimiento de nombre comercial fuera`
      );
    }
    const check = env.movService.comprobarConsistencia();
    assert.strictEqual(check.consistente, true, `Semilla ${semilla}: inconsistencia ${JSON.stringify(check)}`);
  }
});

// ---------------------------------------------------------------------------
// Aceptación 6: API de exclusiones
// ---------------------------------------------------------------------------

runTest('6. apiListarExclusiones exige sesión y devuelve la configuración con CONSULTA', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  adminConfigurarClientesExcluidos(['CLIENTE FICTICIO'], {
    repository: env.repo,
    session: sesionPropietario()
  });
  adminConfigurarArticulosFuera(['NOMBRE COMERCIAL X'], {
    repository: env.repo,
    session: sesionPropietario()
  });

  assert.strictEqual(PERMISOS_API.apiListarExclusiones, 'CONSULTA');
  assert.throws(
    () => codigo.apiListarExclusiones({ repository: env.repo }),
    (err) => err instanceof Error && err.message === 'Acceso no autorizado'
  );

  conContextoDePrueba_('consulta@ficticio.test', 'CONSULTA', () => {
    const listado = codigo.apiListarExclusiones({ repository: env.repo });
    assert.deepStrictEqual(listado.clientesExcluidos, ['CLIENTE FICTICIO']);
    assert.deepStrictEqual(listado.articulosFuera, ['NOMBRE COMERCIAL X']);
  });
  assert.ok(catalogo);
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-031: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
