/**
 * STOCK-LIGHT — Test Suite T-037: fecha de corte de la importación
 *
 * Cubre los puntos de aceptación de docs/tickets/T-037-fecha-corte.md.
 * Ejecutable: node test/t037_fecha_corte.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');
const { adminConfigurarFechaCorte } = require('../src/FechaCorte');
const {
  adminConfigurarClientesExcluidos,
  adminConfigurarArticulosFuera
} = require('../src/Exclusiones');
const codigo = require('../src/Código');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'csv');
const HEADER_VENTAS = fs.readFileSync(path.join(FIXTURE_DIR, 'ventas_formato_real.csv'), 'utf8').split(/\r?\n/)[0];
const HEADER_RECEPCIONES = fs.readFileSync(path.join(FIXTURE_DIR, 'recepciones_proveedor_columna.csv'), 'utf8').split(/\r?\n/)[0];
const CORTE = '2026-11-26';

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

function crearProperties() {
  const valores = new Map();
  return {
    getProperty: (clave) => (valores.has(clave) ? valores.get(clave) : null),
    setProperty: (clave, valor) => { valores.set(clave, String(valor)); },
    _valores: valores
  };
}

function cajasEs(valor) {
  const texto = String(valor).replace('.', ',');
  return texto.includes(',') ? texto : `${texto},000`;
}

function crearCsv(header, filas) {
  return [header].concat(filas).join('\r\n') + '\r\n';
}

function filaVenta(opciones = {}) {
  const {
    fecha,
    numero,
    cliente = 'CLIENTE INVENTADO',
    articulo = 'TOMATE FICTICIO',
    envase = 'CAJA FICTICIA',
    cajas = 2
  } = opciones;
  return [
    fecha,
    `AVT26/${numero} (1)`,
    `REF-${numero}`,
    '1',
    cliente,
    articulo,
    cajasEs(cajas),
    '0',
    '1',
    cajasEs(cajas),
    'CAJA',
    '0',
    '0',
    '0',
    '0',
    cajasEs(cajas),
    envase,
    '1',
    'PALET'
  ].join(';');
}

function filaRecepcion(opciones = {}) {
  const {
    fecha,
    numero,
    proveedor = 'PROVEEDOR FICTICIO',
    articulo = 'TOMATE FICTICIO',
    envase = 'CAJA FICTICIA',
    cajas = 5,
    partida = '900001'
  } = opciones;
  return [
    '', fecha, 'USUARIO', 'ALMACEN UNO', proveedor, fecha, '40000000001', '',
    `/${numero} (1)`, '', articulo, envase, cajasEs(cajas), envase, '1,000',
    'PALET', '4,720', cajasEs(cajas), partida, '1', 'FINCA FICTICIA', '', 'TOMATE', 'PALET'
  ].join(';');
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

function crearImportador(env, catalogo, opciones = {}) {
  return new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogo,
    fuenteEntradas: opciones.fuenteEntradas || 'COMPRAS',
    fechaCorte: opciones.fechaCorte !== undefined ? opciones.fechaCorte : CORTE,
    propertiesService: opciones.propertiesService || null
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

function stockTotal(env) {
  return env.repo.getStockActual().reduce((total, fila) => total + Number(fila.cajas_actuales || 0), 0);
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
}

function cargarStockInicial(env, cajas = 10, idDocumento = 'INI-T037') {
  env.movService.registrarEntrada({
    id_documento: idDocumento,
    tipo_documento: 'COMPRA',
    serie: 'INI',
    numero: '1',
    fecha_documento: '2026-11-26',
    entidad_nombre: 'INVENTARIO INICIAL'
  }, [{ codigo_articulo: 'TOMATE FICTICIO', codigo_envase: 'CAJA FICTICIA', cajas }], 'test');
}

console.log('\n================================================================');
console.log(' TEST SUITE T-037 — FECHA DE CORTE DE LA IMPORTACIÓN');
console.log('================================================================\n');

runTest('1. Ventas y recepciones de 25/26/11 quedan ANTERIOR_AL_CORTE y la del 27 se aplica', () => {
  const ventasEnv = crearEntorno();
  const catVentas = crearCatalogo(ventasEnv.repo);
  cargarStockInicial(ventasEnv, 10);
  const ventas = crearImportador(ventasEnv, catVentas);
  const csvVentas = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '25/11/2026', numero: '101', cajas: 2 }),
    filaVenta({ fecha: '26/11/2026', numero: '102', cajas: 2 }),
    filaVenta({ fecha: '27/11/2026', numero: '103', cajas: 2 })
  ]);
  const previewVentas = ventas.previsualizar(csvVentas);
  assert.strictEqual(previewVentas.resumen.porEstado.ANTERIOR_AL_CORTE, 2);
  assert.strictEqual(previewVentas.lineasAnterioresCorte, 2);
  assert.deepStrictEqual(
    previewVentas.documentos.map(doc => doc.estado),
    ['ANTERIOR_AL_CORTE', 'ANTERIOR_AL_CORTE', 'NUEVO']
  );
  const confirmadaVentas = ventas.confirmar(csvVentas, previewVentas.hash, 'operador@test');
  assert.strictEqual(confirmadaVentas.success, true);
  assert.strictEqual(stockDe(ventasEnv, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 8);
  assert.strictEqual(confirmadaVentas.importacion.lineas_anteriores_corte, 2);
  const docsVentas = ventasEnv.repo.getDocumentos().filter(doc => ['101', '102'].includes(String(doc.numero)));
  assert.strictEqual(docsVentas.length, 0);
  assert.strictEqual(ventasEnv.repo.getMovimientos().filter(mov => mov.id_documento_ref === 'DOC-101').length, 0);
  assert.strictEqual(ventasEnv.repo.getPendientes().length, 0);
  assert.strictEqual(ventasEnv.repo.getVersionesDocumento().length, 0);

  const recepcionesEnv = crearEntorno();
  const catRecepciones = crearCatalogo(recepcionesEnv.repo);
  const recepciones = crearImportador(recepcionesEnv, catRecepciones, { fuenteEntradas: 'RECEPCIONES' });
  const csvRecepciones = crearCsv(HEADER_RECEPCIONES, [
    filaRecepcion({ fecha: '25/11/2026', numero: '201', cajas: 3, partida: '900201' }),
    filaRecepcion({ fecha: '26/11/2026', numero: '202', cajas: 4, partida: '900202' }),
    filaRecepcion({ fecha: '27/11/2026', numero: '203', cajas: 5, partida: '900203' })
  ]);
  const previewRecepciones = recepciones.previsualizar(csvRecepciones);
  assert.strictEqual(previewRecepciones.resumen.porEstado.ANTERIOR_AL_CORTE, 2);
  assert.deepStrictEqual(
    previewRecepciones.documentos.map(doc => doc.estado),
    ['ANTERIOR_AL_CORTE', 'ANTERIOR_AL_CORTE', 'NUEVO']
  );
  const confirmadaRecepciones = recepciones.confirmar(csvRecepciones, previewRecepciones.hash, 'operador@test');
  assert.strictEqual(confirmadaRecepciones.success, true);
  assert.strictEqual(stockDe(recepcionesEnv, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 5);
  assert.strictEqual(recepcionesEnv.repo.getCapasFifo().length, 1);
  assert.strictEqual(recepcionesEnv.repo.getCapasFifo()[0].partida, '900203');
  assert.strictEqual(recepcionesEnv.repo.getDocumentos().length, 1);
  assert.strictEqual(recepcionesEnv.repo.getVersionesDocumento().length, 0);
  comprobarSanidad(recepcionesEnv);
});

runTest('2. Reimportar el CSV mantiene anteriores al corte y el 27 como YA_IMPORTADO', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  cargarStockInicial(env, 10);
  const importador = crearImportador(env, catalogo, { fuenteEntradas: 'COMPRAS' });
  const csv = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '25/11/2026', numero: '301', cajas: 1 }),
    filaVenta({ fecha: '26/11/2026', numero: '302', cajas: 1 }),
    filaVenta({ fecha: '27/11/2026', numero: '303', cajas: 1 })
  ]);
  importar(importador, csv);
  const docsAntes = env.repo.getDocumentos().length;
  const movsAntes = env.repo.getMovimientos().length;
  const impsAntes = env.repo.getImportaciones().length;

  const preview = importador.previsualizar(csv);
  assert.deepStrictEqual(
    preview.documentos.map(doc => doc.estado),
    ['ANTERIOR_AL_CORTE', 'ANTERIOR_AL_CORTE', 'YA_IMPORTADO']
  );
  const repetida = importador.confirmar(csv, preview.hash, 'operador@test');
  assert.strictEqual(repetida.status, 'YA_IMPORTADO');
  assert.deepStrictEqual(
    repetida.documentos.map(doc => doc.estado),
    ['ANTERIOR_AL_CORTE', 'ANTERIOR_AL_CORTE', 'YA_IMPORTADO']
  );
  assert.strictEqual(env.repo.getDocumentos().length, docsAntes);
  assert.strictEqual(env.repo.getMovimientos().length, movsAntes);
  assert.strictEqual(env.repo.getImportaciones().length, impsAntes);
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO', 'CAJA FICTICIA'), 9);
});

runTest('3. El corte gana a cliente excluido, nombre fuera y serie ignorada', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  adminConfigurarClientesExcluidos(['CLIENTE EXCLUIDO'], {
    repository: env.repo,
    session: sesionPropietario()
  });
  adminConfigurarArticulosFuera(['NOMBRE COMERCIAL FUERA'], {
    repository: env.repo,
    session: sesionPropietario()
  });
  catalogo.invalidarCache();
  const importador = crearImportador(env, catalogo, { fuenteEntradas: 'COMPRAS' });
  const csv = crearCsv(HEADER_VENTAS, [
    filaVenta({ fecha: '26/11/2026', numero: '401', cliente: 'CLIENTE EXCLUIDO' }),
    filaVenta({ fecha: '26/11/2026', numero: '402', articulo: 'TOMATE NOMBRE COMERCIAL FUERA X' }),
    (() => {
      const fila = filaVenta({ fecha: '26/11/2026', numero: '403' }).split(';');
      fila[1] = 'ZZZ26/403 (1)';
      return fila.join(';');
    })()
  ]);
  const preview = importador.previsualizar(csv);
  assert.strictEqual(preview.resumen.porEstado.ANTERIOR_AL_CORTE, 3);
  assert.deepStrictEqual(preview.documentos.map(doc => doc.estado), [
    'ANTERIOR_AL_CORTE', 'ANTERIOR_AL_CORTE', 'ANTERIOR_AL_CORTE'
  ]);
  const confirmada = importador.confirmar(csv, preview.hash, 'operador@test');
  assert.strictEqual(confirmada.success, true);
  assert.strictEqual(env.repo.getDocumentos().length, 0);
  assert.strictEqual(env.repo.getMovimientos().length, 0);
  assert.strictEqual(env.repo.getPendientes().length, 0);
});

runTest('4. adminConfigurarFechaCorte valida, exige propietario y devuelve anterior/nuevo', () => {
  const props = crearProperties();
  const session = sesionPropietario();
  const alta = codigo.adminConfigurarFechaCorte(CORTE, { propertiesService: props, session });
  assert.strictEqual(alta.anterior, '');
  assert.strictEqual(alta.nuevo, CORTE);
  assert.strictEqual(alta.nueva, CORTE);
  assert.strictEqual(props.getProperty('FECHA_CORTE_IMPORTACION'), CORTE);

  const cambio = codigo.adminConfigurarFechaCorte('', { propertiesService: props, session });
  assert.strictEqual(cambio.anterior, CORTE);
  assert.strictEqual(cambio.nuevo, '');
  assert.strictEqual(props.getProperty('FECHA_CORTE_IMPORTACION'), '');

  props.setProperty('FECHA_CORTE_IMPORTACION', CORTE);
  assert.throws(
    () => codigo.adminConfigurarFechaCorte('2026-13-40', { propertiesService: props, session }),
    /FECHA_CORTE_IMPORTACION/
  );
  assert.strictEqual(props.getProperty('FECHA_CORTE_IMPORTACION'), CORTE);
  assert.throws(
    () => codigo.adminConfigurarFechaCorte(CORTE, { propertiesService: props }),
    /Operación reservada al administrador/
  );
  assert.throws(
    () => adminConfigurarFechaCorte(CORTE, { propertiesService: props }),
    /Operación reservada al administrador/
  );
});

runTest('5. 30 semillas: stock inicial + recepciones > corte − ventas aplicadas > corte', () => {
  for (let semilla = 0; semilla < 30; semilla++) {
    const env = crearEntorno();
    const catalogo = crearCatalogo(env.repo);
    cargarStockInicial(env, 20, `INI-T037-${semilla}`);
    const ventas = crearImportador(env, catalogo, { fuenteEntradas: 'COMPRAS' });
    const recepciones = crearImportador(env, catalogo, { fuenteEntradas: 'RECEPCIONES' });
    const cajasRecibidas = 10 + (semilla % 5);
    const cajasVendidas = 3 + (semilla % 3);

    const docs = [
      { tipo: 'RECEPCION', texto: crearCsv(HEADER_RECEPCIONES, [
        filaRecepcion({ fecha: '25/11/2026', numero: `30${semilla}1`, cajas: 99, partida: `800${semilla}1` })
      ]) },
      { tipo: 'VENTA', texto: crearCsv(HEADER_VENTAS, [
        filaVenta({ fecha: '26/11/2026', numero: `40${semilla}1`, cajas: 99 })
      ]) },
      { tipo: 'RECEPCION', texto: crearCsv(HEADER_RECEPCIONES, [
        filaRecepcion({ fecha: '27/11/2026', numero: `30${semilla}2`, cajas: cajasRecibidas, partida: `800${semilla}2` })
      ]) },
      { tipo: 'VENTA', texto: crearCsv(HEADER_VENTAS, [
        filaVenta({ fecha: '27/11/2026', numero: `40${semilla}2`, cajas: cajasVendidas })
      ]) }
    ];
    const desplazamiento = semilla % docs.length;
    const orden = docs.slice(desplazamiento).concat(docs.slice(0, desplazamiento));
    for (const item of orden) {
      importar(item.tipo === 'RECEPCION' ? recepciones : ventas, item.texto);
      comprobarSanidad(env);
    }

    const antesDocs = env.repo.getDocumentos().length;
    const antesMovs = env.repo.getMovimientos().length;
    for (const item of docs) {
      const importador = item.tipo === 'RECEPCION' ? recepciones : ventas;
      const preview = importador.previsualizar(item.texto);
      const repetida = importador.confirmar(item.texto, preview.hash, 'operador@test');
      assert.strictEqual(repetida.status, 'YA_IMPORTADO');
    }
    assert.strictEqual(env.repo.getDocumentos().length, antesDocs);
    assert.strictEqual(env.repo.getMovimientos().length, antesMovs);

    const esperado = 20 + cajasRecibidas - cajasVendidas;
    assert.strictEqual(stockTotal(env), esperado, `Semilla ${semilla}: stock`);
    for (const movimiento of env.repo.getMovimientos()) {
      if (movimiento.id_documento_ref === `INI-T037-${semilla}`) continue;
      assert.ok(
        String(movimiento.fecha_negocio || '') > CORTE,
        `Semilla ${semilla}: movimiento de documento anterior al corte`
      );
    }
    comprobarSanidad(env);
  }
});

runTest('6. La tarjeta de Importar incluye la fila gris de anteriores al corte', () => {
  const appHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.html'), 'utf8');
  assert.ok(appHtml.includes('nAnteriorCorte'));
  assert.ok(appHtml.includes('anteriores al stock inicial'));
  assert.ok(appHtml.includes('lineasAnterioresCorte'));
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-037: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
