/**
 * STOCK-LIGHT — Test Suite T-032: entradas desde recepciones de Hispatec
 *
 * Cubre los puntos de aceptación de docs/tickets/T-032-lector-recepciones.md.
 * Ejecutable: node test/t032_recepciones.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');
const { CorreccionService } = require('../src/CorreccionService');
const {
  adminConfigurarEquivalencias,
  listarEquivalencias_
} = require('../src/Equivalencias');
const { PERMISOS_API, conContextoDePrueba_ } = require('../src/Seguridad');
const codigo = require('../src/Código');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'csv');
const RECEPCIONES_TEXTO = fs.readFileSync(path.join(FIXTURE_DIR, 'recepciones_formato_real.csv'), 'utf8');
const HEADER_RECEPCIONES = RECEPCIONES_TEXTO.split(/\r?\n/)[0];
const HEADER_VENTAS = fs.readFileSync(path.join(FIXTURE_DIR, 'ventas_formato_real.csv'), 'utf8').split(/\r?\n/)[0];

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

function numeroEs(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return String(valor).replace('.', ',');
}

function cajasEs(valor) {
  const texto = numeroEs(valor);
  return texto.includes(',') ? texto : `${texto},000`;
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
    fuenteEntradas: opciones.fuenteEntradas,
    propertiesService: opciones.propertiesService || null
  });
}

function crearCorreccion(env, catalogo) {
  return new CorreccionService({
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

function filaRecepcion(opciones = {}) {
  const {
    fecha = '23/11/2026',
    almacen = 'ALMACEN UNO',
    codigoProveedor = '400000001',
    recepcion = '/11737 (1)',
    descripcion = 'TOMATE FICTICIO I KG',
    envase = 'CAJA FICTICIA',
    cajas = 10,
    kg = 50,
    partida = '900001',
    numero = '11737',
    finca = 'FINCA FICTICIA'
  } = opciones;
  return [
    '', '', fecha, almacen, fecha, codigoProveedor, '', recepcion, '', descripcion,
    envase, cajasEs(cajas), envase, '1,000', numero, 'PALET', '4,720', cajasEs(kg),
    partida, '1', finca, '', 'TOMATE', 'PALET'
  ].join(';');
}

function filaProveedorRecepcion(nombre) {
  const campos = new Array(24).fill('');
  campos[1] = ' - ';
  campos[2] = `NombreProveedor: ${nombre}`;
  return campos.join(';');
}

function filaVenta(opciones = {}) {
  const {
    fecha = '24/11/2026',
    numero = '5001',
    cliente = 'CLIENTE INVENTADO',
    articulo = 'TOMATE FICTICIO I',
    envase = 'CAJA FICTICIA',
    cajas = 3
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

function crearCsv(header, filas) {
  return [header].concat(filas).join('\r\n') + '\r\n';
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

console.log('\n================================================================');
console.log(' TEST SUITE T-032 — RECEPCIONES DE HISPATEC');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// Aceptación 1 y 2: fixture real y lectura/importación
// ---------------------------------------------------------------------------

runTest('1. El fixture es RECEPCIONES y crea capas con proveedor, fecha, cajas y partida', () => {
  assert.ok(RECEPCIONES_TEXTO.includes('\r\n'), 'El fixture debe usar CRLF');
  assert.ok(RECEPCIONES_TEXTO.includes('Ñ'), 'El fixture debe ser UTF-8 con Ñ');
  assert.ok(/^;;;;;;;;;;;;;;;;;;;;;;;?\r?$/m.test(RECEPCIONES_TEXTO), 'Debe tener filas vacías de separación');

  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const importador = crearImportador(env, catalogo, { fuenteEntradas: 'RECEPCIONES' });
  const preview = importador.previsualizar(RECEPCIONES_TEXTO);
  assert.strictEqual(preview.tipoCsv, 'RECEPCIONES');
  assert.strictEqual(preview.resumen.porEstado.OK, 4);
  assert.strictEqual(preview.resumen.porEstado.ERROR_DATOS, 1);
  assert.strictEqual(preview.documentos.length, 5);

  const confirmada = importador.confirmar(RECEPCIONES_TEXTO, preview.hash, 'operador@test');
  assert.strictEqual(confirmada.success, true);

  const capas = env.repo.getCapasFifo();
  assert.strictEqual(capas.length, 4);
  const porPartida = new Map(capas.map(capa => [capa.partida, capa]));
  for (const partida of ['900001', '900002', '900003', '900004']) {
    assert.ok(porPartida.has(partida), `Falta la capa de la partida ${partida}`);
  }

  const capa1 = porPartida.get('900001');
  assert.strictEqual(capa1.codigo_articulo, 'TOMATE FICTICIO I');
  assert.strictEqual(capa1.codigo_envase, 'CAJA 40X30 FICTICIA');
  assert.strictEqual(Number(capa1.cajas_iniciales), 10);
  assert.strictEqual(capa1.proveedor, 'PROVEEDOR FICTICIO ÑANDÚ SL');
  assert.strictEqual(capa1.fecha_capa, '2026-11-23');
  assert.strictEqual(porPartida.get('900002').codigo_articulo, 'TOMATE FICTICIO I');
  assert.strictEqual(porPartida.get('900003').codigo_articulo, 'TOMATE FICTICIO II');
  assert.strictEqual(porPartida.get('900004').codigo_articulo, 'TOMATE FICTICIO III');

  const sinProveedor = preview.documentos.find(d => d.numero === '99999');
  assert.ok(sinProveedor);
  assert.strictEqual(sinProveedor.estado, 'SIN_LINEAS_APLICABLES');
  assert.strictEqual(sinProveedor.lineas[0].estado, 'ERROR_DATOS');
  assert.strictEqual(env.repo.getMovimientos().length, 4, 'La fila sin proveedor no debe generar movimiento');
});

// ---------------------------------------------------------------------------
// Aceptación 3: fuente única de entradas
// ---------------------------------------------------------------------------

runTest('2. Con FUENTE_ENTRADAS=RECEPCIONES se rechaza COMPRAS sin escribir; con COMPRAS funciona', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const properties = crearProperties();
  const compras = fs.readFileSync(path.join(FIXTURE_DIR, 'compras_t007.csv'), 'utf8');
  const antes = {
    docs: env.repo.getDocumentos().length,
    movs: env.repo.getMovimientos().length,
    imps: env.repo.getImportaciones().length
  };

  const conRecepciones = crearImportador(env, catalogo, { propertiesService: properties });
  properties.setProperty('FUENTE_ENTRADAS', 'RECEPCIONES');
  assert.throws(
    () => conRecepciones.previsualizar(compras),
    (err) => err instanceof Error && err.message === 'Las entradas se importan con el informe de recepciones'
  );
  assert.strictEqual(env.repo.getDocumentos().length, antes.docs);
  assert.strictEqual(env.repo.getMovimientos().length, antes.movs);
  assert.strictEqual(env.repo.getImportaciones().length, antes.imps);

  const cambio = codigo.adminConfigurarFuenteEntradas('COMPRAS', {
    propertiesService: properties,
    session: sesionPropietario()
  });
  assert.strictEqual(cambio.fuente, 'COMPRAS');
  assert.strictEqual(cambio.anterior, 'RECEPCIONES');
  const conCompras = crearImportador(env, catalogo, { propertiesService: properties });
  const preview = conCompras.previsualizar(compras);
  assert.strictEqual(preview.tipoCsv, 'COMPRAS');
  assert.throws(
    () => codigo.adminConfigurarFuenteEntradas('OTRA', {
      propertiesService: properties,
      session: sesionPropietario()
    }),
    /FUENTE_ENTRADAS debe ser/
  );
  assert.throws(
    () => codigo.adminConfigurarFuenteEntradas('COMPRAS', { propertiesService: properties }),
    /Operación reservada al administrador/
  );
});

// ---------------------------------------------------------------------------
// Aceptación 4: nombres, equivalencias y aviso
// ---------------------------------------------------------------------------

runTest('3. Normaliza sufijos KG/UNID, aplica equivalencias y avisa SIN_PAREJA_EN_VENTAS', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const importador = crearImportador(env, catalogo, { fuenteEntradas: 'RECEPCIONES' });
  const preview = importador.previsualizar(RECEPCIONES_TEXTO);
  const lineasOk = preview.documentos.reduce((lista, doc) => lista.concat(doc.lineas || []), [])
    .filter(linea => linea.estado === 'OK');
  assert.ok(lineasOk.some(linea => linea.articulo === 'TOMATE FICTICIO I'));
  assert.ok(lineasOk.some(linea => linea.articulo === 'TOMATE FICTICIO II'));
  assert.ok(lineasOk.some(linea => (linea.avisos || []).includes('SIN_PAREJA_EN_VENTAS')));
  assert.ok(preview.avisos.some(aviso => aviso.tipo === 'SIN_PAREJA_EN_VENTAS'));

  const alta = adminConfigurarEquivalencias([
    ['TOMATE FICTICIO II', 'TOMATE FICTICIO II S/C']
  ], { repository: env.repo, session: sesionPropietario() });
  assert.deepStrictEqual(alta.anadidos, ['TOMATE FICTICIO II']);
  const repetida = adminConfigurarEquivalencias([
    ['TOMATE FICTICIO II', 'TOMATE FICTICIO II S/C']
  ], { repository: env.repo, session: sesionPropietario() });
  assert.deepStrictEqual(repetida.yaEstaban, ['TOMATE FICTICIO II']);

  const env2 = crearEntorno();
  const catalogo2 = crearCatalogo(env2.repo);
  adminConfigurarEquivalencias([['TOMATE FICTICIO II', 'TOMATE FICTICIO II S/C']], {
    repository: env2.repo,
    session: sesionPropietario()
  });
  const importador2 = crearImportador(env2, catalogo2, { fuenteEntradas: 'RECEPCIONES' });
  importar(importador2, RECEPCIONES_TEXTO);
  assert.strictEqual(stockDe(env2, 'TOMATE FICTICIO II S/C', 'CAJA 40X30 FICTICIA'), 4);

  const venta = crearCsv(HEADER_VENTAS, [
    filaVenta({
      numero: '5101',
      cliente: 'CLIENTE INVENTADO',
      articulo: 'TOMATE FICTICIO II S/C',
      envase: 'CAJA 40X30 FICTICIA',
      cajas: 2
    })
  ]);
  importar(importador2, venta);
  assert.strictEqual(stockDe(env2, 'TOMATE FICTICIO II S/C', 'CAJA 40X30 FICTICIA'), 2);
  comprobarSanidad(env2);
});

// ---------------------------------------------------------------------------
// Aceptación 5: reimportación y versión de una recepción corregida
// ---------------------------------------------------------------------------

runTest('4. Reimportar da YA_IMPORTADO; cambiar cajas crea versión y aplicarVersion deja el stock correcto', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  const importador = crearImportador(env, catalogo, { fuenteEntradas: 'RECEPCIONES' });
  const correccion = crearCorreccion(env, catalogo);

  importar(importador, RECEPCIONES_TEXTO);
  const stockAntes = stockDe(env, 'TOMATE FICTICIO I', 'CAJA 40X30 FICTICIA');
  assert.strictEqual(stockAntes, 15);

  const repetida = importador.confirmar(
    RECEPCIONES_TEXTO,
    importador.previsualizar(RECEPCIONES_TEXTO).hash,
    'operador@test'
  );
  assert.strictEqual(repetida.status, 'YA_IMPORTADO');

  const corregida = RECEPCIONES_TEXTO.replace(
    'CAJA 40x30 FICTICIA;10,000;',
    'CAJA 40x30 FICTICIA;12,000;'
  );
  assert.notStrictEqual(corregida, RECEPCIONES_TEXTO);
  const previewCorreccion = importador.previsualizar(corregida);
  assert.strictEqual(previewCorreccion.documentos.find(d => d.numero === '11737').estado, 'MODIFICADO_EN_ERP');
  const confirmada = importador.confirmar(corregida, previewCorreccion.hash, 'operador@test');
  assert.strictEqual(confirmada.success, true);

  const pendiente = env.repo.getPendientes().find(p =>
    String(p.motivo) === 'MODIFICADO_EN_ERP'
    && String(p.estado) === 'PENDIENTE'
    && String(p.numero) === '11737'
  );
  assert.ok(pendiente);
  const previewVersion = correccion.previsualizarVersion(pendiente.id_pendiente);
  assert.strictEqual(previewVersion.posible, true);
  const aplicada = correccion.aplicarVersion(pendiente.id_pendiente, 'Cambian las cajas de la recepción', 'operador@test');
  assert.strictEqual(aplicada.success, true);
  assert.strictEqual(stockDe(env, 'TOMATE FICTICIO I', 'CAJA 40X30 FICTICIA'), 17);
  comprobarSanidad(env);
});

// ---------------------------------------------------------------------------
// Aceptación 6: invariante de 30 semillas
// ---------------------------------------------------------------------------

runTest('5. 30 semillas de recepciones y ventas en orden arbitrario: stock y consistencia', () => {
  for (let semilla = 0; semilla < 30; semilla++) {
    const env = crearEntorno();
    const catalogo = crearCatalogo(env.repo);
    const importador = crearImportador(env, catalogo, { fuenteEntradas: 'RECEPCIONES' });
    const proveedor = `PROVEEDOR FICTICIO ${semilla}`;
    const totalRecepciones = 40 + (semilla % 5);
    const totalVentas = 10 + (semilla % 7);

    const recepcion = crearCsv(HEADER_RECEPCIONES, [
      filaProveedorRecepcion(proveedor),
      filaRecepcion({
        fecha: '23/11/2026',
        recepcion: `/R${semilla} (1)`,
        descripcion: 'TOMATE FICTICIO INV',
        envase: 'CAJA FICTICIA',
        cajas: totalRecepciones,
        kg: totalRecepciones * 5,
        partida: `900${semilla}`,
        numero: `R${semilla}`,
        finca: 'FINCA FICTICIA'
      })
    ]);
    const venta = crearCsv(HEADER_VENTAS, [
      filaVenta({
        fecha: '24/11/2026',
        numero: String(6000 + semilla),
        cliente: 'CLIENTE INVENTADO',
        articulo: 'TOMATE FICTICIO INV',
        envase: 'CAJA FICTICIA',
        cajas: totalVentas
      })
    ]);

    const orden = semilla % 2 === 0 ? [venta, recepcion] : [recepcion, venta];
    for (const csv of orden) {
      const preview = importador.previsualizar(csv);
      const confirmada = importador.confirmar(csv, preview.hash, 'operador@test');
      assert.strictEqual(confirmada.success, true, `Semilla ${semilla}: confirmar`);
      comprobarSanidad(env);
    }

    assert.strictEqual(
      stockTotal(env),
      totalRecepciones - totalVentas,
      `Semilla ${semilla}: stock incorrecto`
    );
    comprobarSanidad(env);
  }
});

// ---------------------------------------------------------------------------
// Aceptación 7: API y propietario
// ---------------------------------------------------------------------------

runTest('6. API y administración de equivalencias: CONSULTA, propietario e idempotencia', () => {
  const env = crearEntorno();
  const catalogo = crearCatalogo(env.repo);
  assert.strictEqual(PERMISOS_API.apiListarEquivalencias, 'CONSULTA');
  assert.throws(
    () => codigo.apiListarEquivalencias({ repository: env.repo }),
    (err) => err instanceof Error && err.message === 'Acceso no autorizado'
  );
  assert.throws(
    () => adminConfigurarEquivalencias([['A', 'B']], { repository: env.repo }),
    /Operación reservada al administrador/
  );

  const opciones = { repository: env.repo, session: sesionPropietario() };
  adminConfigurarEquivalencias([['TOMATE A', 'TOMATE B']], opciones);
  const listado = conContextoDePrueba_('consulta@ficticio.test', 'CONSULTA', () =>
    codigo.apiListarEquivalencias({ repository: env.repo })
  );
  assert.deepStrictEqual(listado.equivalencias.map(e => e.descripcion), ['TOMATE A']);
  assert.deepStrictEqual(listado.equivalencias.map(e => e.nombre_articulo), ['TOMATE B']);
  assert.strictEqual(listarEquivalencias_(env.repo).equivalencias.length, 1);
  assert.ok(catalogo);
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-032: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
