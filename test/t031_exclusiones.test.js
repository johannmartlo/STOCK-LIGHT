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
const { CorreccionService } = require('../src/CorreccionService');
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

function crearCorreccion(env, catalogo) {
  return new CorreccionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogo
  });
}

function pendienteModificadoDe(env, numero) {
  return env.repo.getPendientes().find(p =>
    String(p.motivo || '').toUpperCase() === 'MODIFICADO_EN_ERP'
    && String(p.estado || '').toUpperCase() === 'PENDIENTE'
    && String(p.tipo_doc || '').toUpperCase() === 'SALIDA'
    && String(p.numero || '') === String(numero)
  );
}

function sumaConsumosPorCapa(env) {
  const mapa = {};
  for (const fila of env.repo.getConsumosFifo()) {
    mapa[fila.id_capa] = (mapa[fila.id_capa] || 0) + Number(fila.cajas || 0);
  }
  return mapa;
}

function comprobarSanidad(env) {
  const consistencia = env.movService.comprobarConsistencia();
  assert.strictEqual(consistencia.consistente, true, JSON.stringify(consistencia));
  assert.strictEqual(consistencia.totalDiferencias, 0);
  const consumos = sumaConsumosPorCapa(env);
  for (const capa of env.repo.getCapasFifo()) {
    assert.strictEqual(
      Number(consumos[capa.id_capa] || 0),
      Number(capa.cajas_consumidas || 0),
      `Consumos no cuadran en ${capa.id_capa}`
    );
  }
  for (const fila of env.repo.getStockActual()) {
    if (String(fila.codigo_articulo || '').includes('NOMBRE COMERCIAL FUERA')) {
      assert.strictEqual(Number(fila.cajas_actuales || 0), 0, 'Un nombre fuera no puede tener stock');
    }
  }
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

function stockTotal(env) {
  return env.repo.getStockActual().reduce((total, fila) => total + Number(fila.cajas_actuales || 0), 0);
}

function pendientesStockTotal(env) {
  return env.repo.getPendientes()
    .filter(p => String(p.estado || '').toUpperCase() === 'PENDIENTE'
      && String(p.motivo || '').toUpperCase() === 'STOCK_INSUFICIENTE')
    .reduce((total, p) => total + Math.abs(Number(p.cajas) || 0), 0);
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
// Aceptación 5: una venta aplicada pasa a cliente excluido
// ---------------------------------------------------------------------------

runTest('5. Normal aplicada → cliente excluido: vuelve el stock, no hay salida nueva ni pendiente de stock', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  adminConfigurarClientesExcluidos(['CLIENTE FICTICIO'], {
    repository: env.repo,
    session: sesionPropietario()
  });
  const importador = crearImportador(env, catalogo);
  const correccion = crearCorreccion(env, catalogo);

  importar(importador, crearCsv(HEADER_COMPRAS, [
    filaCompra({ numero: '9401', articulo: 'TOMATE FICTICIO', cajas: 10 })
  ]));
  importar(importador, crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '9402', cliente: 'DESTINATARIO INVENTADO', articulo: 'TOMATE FICTICIO', cajas: 4 })
  ]));
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 6);

  const doc = env.repo.getDocumentos().find(d => String(d.numero) === '9402');
  assert.ok(doc);
  const antesSalidas = env.repo.getMovimientos().filter(m =>
    m.tipo_movimiento === 'SALIDA' && String(m.id_documento_ref) === String(doc.id_documento)
  ).length;
  assert.strictEqual(antesSalidas, 1);

  const csvCorregido = crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '9402', cliente: 'Cliente Ficticio, S.L.', articulo: 'TOMATE FICTICIO', cajas: 4 })
  ]);
  const previewCorreccion = importador.previsualizar(csvCorregido);
  const confirmada = importador.confirmar(csvCorregido, previewCorreccion.hash, 'operador@test');
  assert.strictEqual(confirmada.success, true);

  const pendiente = pendienteModificadoDe(env, '9402');
  assert.ok(pendiente, 'Debe quedar un MODIFICADO_EN_ERP para aplicar la versión');
  assert.strictEqual(Number(pendiente.cajas), -4, 'La diferencia solo cuenta las líneas que mueven stock');
  const version = env.repo.getVersionesDocumento()
    .filter(v => String(v.id_pendiente) === String(pendiente.id_pendiente) && v.estado === 'PENDIENTE')[0];
  assert.ok(version);
  assert.ok(JSON.parse(version.lineas_json).every(linea => linea.estado === 'CLIENTE_EXCLUIDO'));

  const preview = correccion.previsualizarVersion(pendiente.id_pendiente);
  assert.strictEqual(preview.posible, true);
  assert.ok(preview.mensaje.includes('no mueve stock'));
  const resultado = correccion.aplicarVersion(pendiente.id_pendiente, 'Cliente excluido en Hispatec', 'operador@test');
  assert.strictEqual(resultado.success, true);
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 10);

  const salidas = env.repo.getMovimientos().filter(m =>
    m.tipo_movimiento === 'SALIDA' && String(m.id_documento_ref) === String(doc.id_documento)
  );
  assert.strictEqual(salidas.length, antesSalidas, 'No debe crearse una salida nueva');
  assert.strictEqual(env.repo.getPendientes().filter(p =>
    p.motivo === 'STOCK_INSUFICIENTE' && p.estado === 'PENDIENTE'
  ).length, 0);
  comprobarSanidad(env);
});

// ---------------------------------------------------------------------------
// Aceptación 6: una venta totalmente excluida pasa a cliente normal
// ---------------------------------------------------------------------------

runTest('6. Excluida entera → cliente normal: aplicarVersion crea la salida', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  adminConfigurarClientesExcluidos(['CLIENTE FICTICIO'], {
    repository: env.repo,
    session: sesionPropietario()
  });
  const importador = crearImportador(env, catalogo);
  const correccion = crearCorreccion(env, catalogo);

  importar(importador, crearCsv(HEADER_COMPRAS, [
    filaCompra({ numero: '9501', articulo: 'TOMATE FICTICIO', cajas: 10 })
  ]));
  importar(importador, crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '9502', cliente: 'CLIENTE FICTICIO', articulo: 'TOMATE FICTICIO', cajas: 5 })
  ]));
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 10);
  const bases = env.repo.getVersionesDocumento().filter(v => v.estado === 'BASE');
  assert.strictEqual(bases.length, 1, 'El albarán totalmente excluido debe guardar su versión de partida');

  const csvCorregido = crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '9502', cliente: 'DESTINATARIO INVENTADO', articulo: 'TOMATE FICTICIO', cajas: 5 })
  ]);
  const previewCorreccion = importador.previsualizar(csvCorregido);
  const confirmada = importador.confirmar(csvCorregido, previewCorreccion.hash, 'operador@test');
  assert.strictEqual(confirmada.success, true);
  const pendiente = pendienteModificadoDe(env, '9502');
  assert.ok(pendiente);
  assert.strictEqual(Number(pendiente.cajas), 5, 'La versión nueva añade 5 cajas de stock');

  const preview = correccion.previsualizarVersion(pendiente.id_pendiente);
  assert.strictEqual(preview.posible, true);
  const resultado = correccion.aplicarVersion(pendiente.id_pendiente, 'Cliente normal en Hispatec', 'operador@test');
  assert.strictEqual(resultado.success, true);
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 5);
  assert.strictEqual(env.repo.getMovimientos().filter(m =>
    m.tipo_movimiento === 'SALIDA' && m.id_documento_ref ===
      (env.repo.getDocumentos().find(d => String(d.numero) === '9502') || {}).id_documento
  ).length, 1);
  assert.strictEqual(env.repo.getPendientes().filter(p =>
    p.motivo === 'STOCK_INSUFICIENTE' && p.estado === 'PENDIENTE'
  ).length, 0);
  comprobarSanidad(env);
});

// ---------------------------------------------------------------------------
// Aceptación 7: una venta totalmente excluida cambia cajas y sigue excluida
// ---------------------------------------------------------------------------

runTest('7. Excluida entera → cambian cajas y sigue excluida: se aplica sin mover stock ni dejar pendiente', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  adminConfigurarClientesExcluidos(['CLIENTE FICTICIO'], {
    repository: env.repo,
    session: sesionPropietario()
  });
  const importador = crearImportador(env, catalogo);
  const correccion = crearCorreccion(env, catalogo);

  importar(importador, crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '9602', cliente: 'CLIENTE FICTICIO', articulo: 'TOMATE FICTICIO', cajas: 5 })
  ]));
  const doc = env.repo.getDocumentos().find(d => String(d.numero) === '9602');
  assert.ok(doc);

  const csvCorregido = crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '9602', cliente: 'CLIENTE FICTICIO', articulo: 'TOMATE FICTICIO', cajas: 7 })
  ]);
  const previewCorreccion = importador.previsualizar(csvCorregido);
  const confirmada = importador.confirmar(csvCorregido, previewCorreccion.hash, 'operador@test');
  assert.strictEqual(confirmada.success, true);
  const pendiente = pendienteModificadoDe(env, '9602');
  assert.ok(pendiente);
  assert.strictEqual(Number(pendiente.cajas), 0, 'Sin líneas que muevan stock no hay diferencia de cajas');

  const preview = correccion.previsualizarVersion(pendiente.id_pendiente);
  assert.strictEqual(preview.posible, true);
  assert.ok(preview.mensaje.includes('no mueve stock'));
  const resultado = correccion.aplicarVersion(pendiente.id_pendiente, 'Cambian las cajas del albarán excluido', 'operador@test');
  assert.strictEqual(resultado.success, true);
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 0);
  assert.strictEqual(env.repo.getMovimientos().filter(m =>
    m.id_documento_ref === doc.id_documento && m.tipo_movimiento === 'SALIDA'
  ).length, 0);
  assert.strictEqual(env.repo.getPendientes().filter(p =>
    p.estado === 'PENDIENTE' && p.motivo === 'MODIFICADO_EN_ERP'
  ).length, 0);
  comprobarSanidad(env);
});

// ---------------------------------------------------------------------------
// Aceptación 8: una venta aplicada pasa a todas las líneas con nombre fuera
// ---------------------------------------------------------------------------

runTest('8. Normal → todas las líneas con nombre fuera: igual que la 5, sin salida nueva', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  adminConfigurarArticulosFuera(['NOMBRE COMERCIAL X'], {
    repository: env.repo,
    session: sesionPropietario()
  });
  catalogo.invalidarCache();
  const importador = crearImportador(env, catalogo);
  const correccion = crearCorreccion(env, catalogo);

  importar(importador, crearCsv(HEADER_COMPRAS, [
    filaCompra({ numero: '9701', articulo: 'TOMATE FICTICIO', cajas: 10 })
  ]));
  importar(importador, crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '9702', cliente: 'DESTINATARIO INVENTADO', articulo: 'TOMATE FICTICIO', cajas: 4 })
  ]));
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 6);
  const doc = env.repo.getDocumentos().find(d => String(d.numero) === '9702');

  const csvCorregido = crearCsv(HEADER_VENTAS, [
    filaVenta({
      numero: '9702',
      cliente: 'DESTINATARIO INVENTADO',
      articulo: 'TOMATE NOMBRE COMERCIAL X EXTRA',
      cajas: 4
    })
  ]);
  const previewCorreccion = importador.previsualizar(csvCorregido);
  const confirmada = importador.confirmar(csvCorregido, previewCorreccion.hash, 'operador@test');
  assert.strictEqual(confirmada.success, true);
  const pendiente = pendienteModificadoDe(env, '9702');
  assert.ok(pendiente);
  assert.strictEqual(Number(pendiente.cajas), -4, 'La diferencia solo cuenta las líneas que mueven stock');
  const version = env.repo.getVersionesDocumento()
    .filter(v => String(v.id_pendiente) === String(pendiente.id_pendiente) && v.estado === 'PENDIENTE')[0];
  assert.ok(version);
  assert.ok(JSON.parse(version.lineas_json).every(linea => linea.estado === 'NO_SEGUIDA'));

  const preview = correccion.previsualizarVersion(pendiente.id_pendiente);
  assert.strictEqual(preview.posible, true);
  assert.ok(preview.mensaje.includes('no mueve stock'));
  const resultado = correccion.aplicarVersion(pendiente.id_pendiente, 'Nombre comercial fuera en Hispatec', 'operador@test');
  assert.strictEqual(resultado.success, true);
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 10);
  assert.strictEqual(env.repo.getMovimientos().filter(m =>
    m.tipo_movimiento === 'SALIDA' && String(m.id_documento_ref) === String(doc.id_documento)
  ).length, 1);
  assert.strictEqual(stockDe(env, 'TOMATE NOMBRE COMERCIAL X EXTRA', 'CAJA FICTICIA'), 0);
  assert.strictEqual(env.repo.getPendientes().filter(p =>
    p.motivo === 'STOCK_INSUFICIENTE' && p.estado === 'PENDIENTE'
  ).length, 0);
  comprobarSanidad(env);
});

// ---------------------------------------------------------------------------
// Aceptación 9: 30 semillas con versiones y exclusiones mezcladas
// ---------------------------------------------------------------------------

runTest('9. 30 semillas con versiones: consistencia, consumos, nada fuera y ecuación final', () => {
  const patronesClientes = ['CLIENTE EXCLUIDO'];
  const patronesFuera = ['NOMBRE COMERCIAL FUERA'];

  for (let semilla = 0; semilla < 30; semilla++) {
    const env = crearEntorno();
    const catalogo = crearCatalogo(env.repo);
    const opciones = { repository: env.repo, session: sesionPropietario() };
    adminConfigurarClientesExcluidos(patronesClientes, opciones);
    adminConfigurarArticulosFuera(patronesFuera, opciones);
    catalogo.invalidarCache();
    const importador = crearImportador(env, catalogo);
    const correccion = crearCorreccion(env, catalogo);

    const fecha = (offset) => `${String(((semilla * 2 + offset * 3) % 28) + 1).padStart(2, '0')}/02/2026`;
    const numeroCompra = (indice) => String(6000 + semilla * 10 + indice);
    const numeroVenta = (indice) => String(7000 + semilla * 10 + indice);
    const ventas = [
      { numero: numeroVenta(0), cliente: 'DESTINATARIO INVENTADO', articulo: 'TOMATE FICTICIO', cajas: 20 },
      { numero: numeroVenta(1), cliente: 'DESTINATARIO INVENTADO', articulo: 'TOMATE FICTICIO DOS', cajas: 15 },
      { numero: numeroVenta(2), cliente: 'CLIENTE EXCLUIDO', articulo: 'TOMATE FICTICIO', cajas: 10 },
      { numero: numeroVenta(3), cliente: 'DESTINATARIO INVENTADO', articulo: 'TOMATE FICTICIO', cajas: 5 },
      { numero: numeroVenta(4), cliente: 'DESTINATARIO INVENTADO', articulo: 'TOMATE NOMBRE COMERCIAL FUERA X', cajas: 7 }
    ];

    const loteCompras = crearCsv(HEADER_COMPRAS, [
      filaCompra({ fecha: fecha(1), numero: numeroCompra(1), articulo: 'TOMATE FICTICIO', cajas: 100 }),
      filaCompra({ fecha: fecha(2), numero: numeroCompra(2), articulo: 'TOMATE FICTICIO DOS', cajas: 80 }),
      filaCompra({ fecha: fecha(3), numero: numeroCompra(3), articulo: 'TOMATE NOMBRE COMERCIAL FUERA X', cajas: 50 })
    ]);
    const loteVentasA = crearCsv(HEADER_VENTAS, [
      filaVenta({ fecha: fecha(10), numero: ventas[0].numero, cliente: ventas[0].cliente, articulo: ventas[0].articulo, cajas: ventas[0].cajas }),
      filaVenta({ fecha: fecha(11), numero: ventas[1].numero, cliente: ventas[1].cliente, articulo: ventas[1].articulo, cajas: ventas[1].cajas })
    ]);
    const loteVentasB = crearCsv(HEADER_VENTAS, [
      filaVenta({ fecha: fecha(12), numero: ventas[2].numero, cliente: ventas[2].cliente, articulo: ventas[2].articulo, cajas: ventas[2].cajas }),
      filaVenta({ fecha: fecha(13), numero: ventas[3].numero, cliente: ventas[3].cliente, articulo: ventas[3].articulo, cajas: ventas[3].cajas }),
      filaVenta({ fecha: fecha(14), numero: ventas[4].numero, cliente: ventas[4].cliente, articulo: ventas[4].articulo, cajas: ventas[4].cajas })
    ]);

    const lotes = [loteCompras, loteVentasA, loteVentasB];
    const desplazamiento = semilla % lotes.length;
    const orden = lotes.slice(desplazamiento).concat(lotes.slice(0, desplazamiento));
    for (const lote of orden) {
      importar(importador, lote);
      comprobarSanidad(env);
    }

    const importacionesAntes = env.repo.getImportaciones().length;
    const documentosAntes = env.repo.getDocumentos().length;
    const movimientosAntes = env.repo.getMovimientos().length;
    for (const lote of lotes) {
      const preview = importador.previsualizar(lote);
      const repetida = importador.confirmar(lote, preview.hash, 'operador@test');
      assert.strictEqual(repetida.status, 'YA_IMPORTADO', `Semilla ${semilla}: reimportación`);
      comprobarSanidad(env);
    }
    assert.strictEqual(env.repo.getImportaciones().length, importacionesAntes);
    assert.strictEqual(env.repo.getDocumentos().length, documentosAntes);
    assert.strictEqual(env.repo.getMovimientos().length, movimientosAntes);

    const combinaciones = [
      [0], [1], [2], [3],
      [0, 1], [1, 2], [2, 3], [0, 2], [0, 3], [1, 3],
      [0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]
    ];
    const combinacion = combinaciones[semilla % combinaciones.length];
    for (const indice of combinacion) {
      const actual = ventas[indice];
      const nueva = Object.assign({}, actual);
      if (indice === 0) nueva.cliente = 'CLIENTE EXCLUIDO';
      if (indice === 1) nueva.cajas = 20;
      if (indice === 2) nueva.cliente = 'DESTINATARIO INVENTADO';
      if (indice === 3) nueva.articulo = 'TOMATE NOMBRE COMERCIAL FUERA X';

      const csvCorregido = crearCsv(HEADER_VENTAS, [
        filaVenta({
          fecha: fecha(20 + indice),
          numero: actual.numero,
          cliente: nueva.cliente,
          articulo: nueva.articulo,
          cajas: nueva.cajas
        })
      ]);
      const previewCorreccion = importador.previsualizar(csvCorregido);
      const confirmada = importador.confirmar(csvCorregido, previewCorreccion.hash, 'operador@test');
      assert.strictEqual(confirmada.success, true, `Semilla ${semilla}: confirmar corrección ${indice}`);
      const pendiente = pendienteModificadoDe(env, actual.numero);
      assert.ok(pendiente, `Semilla ${semilla}: pendiente de ${actual.numero}`);
      const previewVersion = correccion.previsualizarVersion(pendiente.id_pendiente);
      assert.strictEqual(previewVersion.posible, true, `Semilla ${semilla}: preview ${indice} ${previewVersion.motivo || ''}`);
      const aplicada = correccion.aplicarVersion(
        pendiente.id_pendiente,
        `Corrección de la venta ${actual.numero} en la semilla ${semilla}`,
        'operador@test'
      );
      assert.strictEqual(aplicada.success, true, `Semilla ${semilla}: aplicar ${indice} ${aplicada.message || ''}`);
      ventas[indice] = nueva;
      comprobarSanidad(env);
    }

    const comprasSeguimiento = 180;
    const ventasVigentes = ventas.reduce((total, venta) => {
      if (esClienteExcluido_(venta.cliente, patronesClientes)) return total;
      if (String(venta.articulo).includes('NOMBRE COMERCIAL FUERA')) return total;
      return total + Number(venta.cajas || 0);
    }, 0);
    const izquierda = (comprasSeguimiento - stockTotal(env)) + pendientesStockTotal(env);
    assert.strictEqual(
      izquierda,
      ventasVigentes,
      `Semilla ${semilla}: (compras - stock) + pendientes = ventas vigentes (${izquierda} != ${ventasVigentes})`
    );
  }
});

// ---------------------------------------------------------------------------
// Aceptación 6: API de exclusiones
// ---------------------------------------------------------------------------

runTest('10. apiListarExclusiones exige sesión y devuelve la configuración con CONSULTA', () => {
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
