/**
 * STOCK-LIGHT — Test Suite T-027: correcciones desde Hispatec
 *
 * Cubre los puntos de aceptación 1 a 10 de docs/tickets/T-027-correcciones-hispatec.md.
 * Ejecutable: node test/t027_correcciones.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');
const { PendientesService } = require('../src/importacion/PendientesService');
const { CorreccionService } = require('../src/CorreccionService');
const { PERMISOS_API, conContextoDePrueba_ } = require('../src/Seguridad');
const codigo = require('../src/Código');

const HEADER_COMPRAS = fs.readFileSync(path.join(__dirname, 'fixtures/csv/compras_t007.csv'), 'utf8').split(/\r?\n/)[0];
const HEADER_VENTAS = fs.readFileSync(path.join(__dirname, 'fixtures/csv/ventas_t007.csv'), 'utf8').split(/\r?\n/)[0];

let passed = 0;
let failed = 0;

function runTest(nombre, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${nombre}`);
    passed++;
  } catch (error) {
    console.error(`  ❌ [FAIL] ${nombre}`);
    console.error(`     Error: ${error.message}`);
    if (error.stack) console.error(error.stack.split('\n').slice(1, 4).join('\n'));
    failed++;
  }
}

function crearCatalogo() {
  return new CatalogoService({
    config: {
      atributos: [
        { nombre: 'SEGUIMIENTO', activo: true },
        { nombre: 'FAMILIA', activo: true }
      ],
      reglas: [
        { id: 'R1', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 1, activo: true },
        { id: 'R2', atributo: 'FAMILIA', valor: 'ROSA', prioridad: 1, articulo_contiene: 'ROSA', activo: true },
        { id: 'R3', atributo: 'FAMILIA', valor: 'OTROS', prioridad: 2, activo: true }
      ],
      catalogo: [],
      agrupaciones: [
        { agrupacion: 'COMERCIAL', orden: 1, grupo: 'ROSA', filtro: 'FAMILIA=ROSA', activo: true },
        { agrupacion: 'COMERCIAL', orden: 2, grupo: 'OTROS', filtro: '', activo: true }
      ]
    }
  });
}

function crearImportacion(entorno, catalogo) {
  return new ImportacionService({
    repository: entorno.repo,
    movementService: entorno.movService,
    catalogoService: catalogo || crearCatalogo()
  });
}

function crearCorreccion(entorno, catalogo) {
  return new CorreccionService({
    repository: entorno.repo,
    movementService: entorno.movService,
    catalogoService: catalogo || crearCatalogo()
  });
}

function cajasTexto(valor) {
  const texto = String(valor).replace('.', ',');
  return texto.includes(',') ? texto : `${texto},000`;
}

function filaCompra(opciones = {}) {
  const {
    fecha = '02/11/2026',
    emisor = 'FINCA A',
    numero = '100',
    serie = 'ACT27',
    linea = 1,
    articulo = 'TOMATE ROSA',
    envase = 'MADERA',
    cajas = 100,
    kg = 10
  } = opciones;
  return [
    fecha, emisor, String(numero), serie, String(linea), '', '',
    articulo, 'Descripcion ficticia', String(cajas), cajasTexto(cajas), String(cajas), '', '',
    1, 1, 1, '0', String(kg).replace('.', ','), 0, '', '', 'ENV-F', envase, cajasTexto(cajas)
  ].join(';');
}

function filaVenta(opciones = {}) {
  const {
    fecha = '03/11/2026',
    numero = '200',
    serie = 'AVT27',
    linea = 1,
    articulo = 'TOMATE ROSA',
    envase = 'MADERA',
    cajas = 10,
    kg = 0,
    cliente = 'CLIENTE'
  } = opciones;
  return [
    fecha, `REF-${serie}-${numero}`, String(numero), `${serie}/${numero} (${linea})`,
    cliente, articulo, cajasTexto(cajas), String(cajas), '0', String(kg).replace('.', ','), envase, '0', ''
  ].join(';');
}

function csv(header, filas) {
  return [header].concat(filas).join('\n') + '\n';
}

function importar(importacion, texto, usuario = 'encargado@test') {
  const previa = importacion.previsualizar(texto);
  return importacion.confirmar(texto, previa.hash, usuario);
}

function pendienteModificado(entorno) {
  return entorno.repo.getPendientes().find(p =>
    String(p.motivo || '').toUpperCase() === 'MODIFICADO_EN_ERP' &&
    String(p.estado || '').toUpperCase() === 'PENDIENTE'
  );
}

function instantanea(entorno) {
  return JSON.stringify([...entorno.ss.sheets.entries()].map(([nombre, hoja]) => [nombre, hoja.rows]));
}

function stockTotal(entorno) {
  return entorno.repo.getStockActual().reduce((total, fila) => total + Number(fila.cajas_actuales || 0), 0);
}

function sumaConsumosPorCapa(entorno) {
  const mapa = {};
  for (const fila of entorno.repo.getConsumosFifo()) {
    mapa[fila.id_capa] = (mapa[fila.id_capa] || 0) + Number(fila.cajas || 0);
  }
  return mapa;
}

function comprobarSanidad(entorno) {
  const consistencia = entorno.movService.comprobarConsistencia();
  assert.strictEqual(consistencia.consistente, true);
  assert.strictEqual(consistencia.totalDiferencias, 0);
  for (const capa of entorno.repo.getCapasFifo()) {
    assert.ok(Number(capa.cajas_restantes || 0) >= 0, `Capa negativa: ${capa.id_capa}`);
    assert.ok(Number(capa.cajas_consumidas || 0) >= 0, `Consumidas negativas: ${capa.id_capa}`);
  }
  const consumos = sumaConsumosPorCapa(entorno);
  for (const capa of entorno.repo.getCapasFifo()) {
    assert.strictEqual(
      Number(consumos[capa.id_capa] || 0),
      Number(capa.cajas_consumidas || 0),
      `Consumos no cuadran en ${capa.id_capa}`
    );
  }
}

// --------------------------------------------------------------------------
// Aceptación 1: corregir una salida
// --------------------------------------------------------------------------
runTest('1. Corregir una venta de 30 a 20 sube el stock 10, devuelve a sus capas y reimportar da YA_IMPORTADO', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogo();
  const importacion = crearImportacion(entorno, catalogo);
  const correccion = crearCorreccion(entorno, catalogo);

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '100', cajas: 100, articulo: 'TOMATE ROSA', envase: 'MADERA', emisor: 'FINCA A' })
  ]));
  const ventaOriginal = csv(HEADER_VENTAS, [
    filaVenta({ numero: '200', cajas: 30, articulo: 'TOMATE ROSA', envase: 'MADERA' })
  ]);
  importar(importacion, ventaOriginal);
  const stockAntes = stockTotal(entorno);

  const ventaCorregida = csv(HEADER_VENTAS, [
    filaVenta({ numero: '200', cajas: 20, articulo: 'TOMATE ROSA', envase: 'MADERA' })
  ]);
  importar(importacion, ventaCorregida);
  const pendiente = pendienteModificado(entorno);
  assert.ok(pendiente, 'Debe existir un MODIFICADO_EN_ERP');

  const antesPreview = instantanea(entorno);
  const preview = correccion.previsualizarVersion(pendiente.id_pendiente);
  assert.strictEqual(preview.posible, true);
  assert.strictEqual(instantanea(entorno), antesPreview);
  assert.strictEqual(preview.efecto_variedades[0].cajas, 10);
  assert.ok(preview.lineas_cambian.some(linea => linea.cambios.includes('cajas')));

  const antes = instantanea(entorno);
  const resultado = correccion.aplicarVersion(pendiente.id_pendiente, 'Corrección de venta en Hispatec', 'encargado@test');
  assert.strictEqual(resultado.success, true);
  assert.strictEqual(resultado.status, 'APLICADA');
  assert.strictEqual(instantanea(entorno) === antes, false);
  assert.strictEqual(stockTotal(entorno), stockAntes + 10);

  const capa = entorno.repo.getCapasFifo().find(c => c.codigo_articulo === 'TOMATE ROSA' && c.estado_capa === 'ACTIVA');
  assert.ok(capa);
  assert.strictEqual(Number(capa.cajas_consumidas), 20);
  assert.strictEqual(Number(capa.cajas_restantes), 80);
  comprobarSanidad(entorno);

  const reimportada = importar(importacion, ventaCorregida);
  assert.strictEqual(reimportada.status, 'YA_IMPORTADO');
  assert.strictEqual(entorno.repo.getVersionesDocumento().filter(v => v.estado === 'PENDIENTE').length, 0);
  assert.strictEqual(pendienteModificado(entorno), undefined);
});

// --------------------------------------------------------------------------
// Aceptación 2: entrada sin consumos
// --------------------------------------------------------------------------
runTest('2. Una compra de finca A que pasa a finca B deja la partida con el proveedor nuevo y la misma fecha', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogo();
  const importacion = crearImportacion(entorno, catalogo);
  const correccion = crearCorreccion(entorno, catalogo);

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '101', cajas: 50, emisor: 'FINCA A', articulo: 'TOMATE ROSA', envase: 'MADERA' })
  ]));
  const antes = instantanea(entorno);

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '101', cajas: 50, emisor: 'FINCA B', articulo: 'TOMATE ROSA', envase: 'MADERA' })
  ]));
  const pendiente = pendienteModificado(entorno);
  assert.ok(pendiente);
  assert.strictEqual(instantanea(entorno) === antes, false);

  const preview = correccion.previsualizarVersion(pendiente.id_pendiente);
  assert.strictEqual(preview.posible, true);
  const resultado = correccion.aplicarVersion(pendiente.id_pendiente, 'Finca mal identificada en Hispatec', 'encargado@test');
  assert.strictEqual(resultado.success, true);

  const capas = entorno.repo.getCapasFifo();
  const activa = capas.find(c => c.estado_capa === 'ACTIVA' && c.codigo_articulo === 'TOMATE ROSA');
  assert.ok(activa);
  assert.strictEqual(activa.proveedor, 'FINCA B');
  assert.strictEqual(activa.fecha_capa, '2026-11-02');
  assert.strictEqual(Number(activa.cajas_iniciales), 50);
  assert.strictEqual(stockTotal(entorno), 50);
  comprobarSanidad(entorno);

  const reimportada = importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '101', cajas: 50, emisor: 'FINCA B', articulo: 'TOMATE ROSA', envase: 'MADERA' })
  ]));
  assert.strictEqual(reimportada.status, 'YA_IMPORTADO');
});

// --------------------------------------------------------------------------
// Aceptación 3: cascada del caso del responsable
// --------------------------------------------------------------------------
runTest('3. Cascada: compra de finca A a finca B con venta, cambio y venta del Rosa 500 conserva las cajas y usa la partida nueva', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogo();
  const importacion = crearImportacion(entorno, catalogo);
  const correccion = crearCorreccion(entorno, catalogo);

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '102', cajas: 100, emisor: 'FINCA A', articulo: 'TOMATE MORESCO G', envase: 'MADERA' })
  ]));
  entorno.movService.registrarSalida({
    id_documento: 'DOC-S30',
    tipo_documento: 'SALIDA',
    serie: 'AVT27',
    numero: '230',
    fecha_documento: '2026-11-02',
    entidad_nombre: 'CLIENTE 30'
  }, [{ codigo_articulo: 'TOMATE MORESCO G', codigo_envase: 'MADERA', cajas: 30 }], 'test@user');

  const capaMoresco = entorno.repo.getCapasFifo().find(c => c.codigo_articulo === 'TOMATE MORESCO G' && c.estado_capa === 'ACTIVA');
  const reproceso = entorno.movService.registrarReproceso({
    origenes: [{ id_capa: capaMoresco.id_capa, cajas: 20 }],
    destinos: [{ articulo: 'TOMATE ROSA 500', envase: 'EPS 106', cajas: 20 }],
    destrio_cajas: 0,
    fecha: '2026-11-03'
  }, 'test@user');
  assert.strictEqual(reproceso.success, true);

  entorno.movService.registrarSalida({
    id_documento: 'DOC-S10',
    tipo_documento: 'SALIDA',
    serie: 'AVT27',
    numero: '231',
    fecha_documento: '2026-11-04',
    entidad_nombre: 'CLIENTE 10'
  }, [{ codigo_articulo: 'TOMATE ROSA 500', codigo_envase: 'EPS 106', cajas: 10 }], 'test@user');

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '102', cajas: 100, emisor: 'FINCA B', articulo: 'TOMATE MORESCO G', envase: 'MADERA' })
  ]));
  const pendiente = pendienteModificado(entorno);
  assert.ok(pendiente);

  const stockAntes = stockTotal(entorno);
  const preview = correccion.previsualizarVersion(pendiente.id_pendiente);
  assert.strictEqual(preview.posible, true);
  assert.ok(preview.operaciones_rehechas.some(op => op.tipo === 'REPROCESO'));
  assert.ok(preview.operaciones_rehechas.some(op => op.tipo === 'SALIDA'));

  const resultado = correccion.aplicarVersion(pendiente.id_pendiente, 'Finca mal identificada', 'test@user');
  assert.strictEqual(resultado.success, true);
  assert.strictEqual(stockTotal(entorno), stockAntes);

  const capas = entorno.repo.getCapasFifo();
  const morescoActiva = capas.find(c => c.codigo_articulo === 'TOMATE MORESCO G' && c.estado_capa === 'ACTIVA');
  const rosaActiva = capas.find(c => c.codigo_articulo === 'TOMATE ROSA 500' && c.estado_capa === 'ACTIVA');
  assert.ok(morescoActiva);
  assert.ok(rosaActiva);
  assert.strictEqual(morescoActiva.proveedor, 'FINCA B');
  assert.strictEqual(rosaActiva.proveedor, 'FINCA B');
  assert.strictEqual(rosaActiva.id_capa_origen, morescoActiva.id_capa);
  assert.strictEqual(Number(morescoActiva.cajas_restantes), 50);
  assert.strictEqual(Number(rosaActiva.cajas_restantes), 10);
  assert.ok(capas.filter(c => c.codigo_articulo === 'TOMATE MORESCO G' && c.proveedor === 'FINCA A' && c.estado_capa === 'ANULADA').length >= 1);
  comprobarSanidad(entorno);
});

// --------------------------------------------------------------------------
// Aceptación 4: a pendientes
// --------------------------------------------------------------------------
runTest('4. Una compra corregida con menos cajas de las vendidas deja la venta en PENDIENTES y mantiene el resto', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogo();
  const importacion = crearImportacion(entorno, catalogo);
  const correccion = crearCorreccion(entorno, catalogo);

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '103', cajas: 100, emisor: 'FINCA A', articulo: 'TOMATE ROSA', envase: 'MADERA' })
  ]));
  entorno.movService.registrarSalida({
    id_documento: 'DOC-S80',
    tipo_documento: 'SALIDA',
    serie: 'AVT27',
    numero: '280',
    fecha_documento: '2026-11-02',
    entidad_nombre: 'CLIENTE 80'
  }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'MADERA', cajas: 80 }], 'test@user');

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '103', cajas: 20, emisor: 'FINCA B', articulo: 'TOMATE ROSA', envase: 'MADERA' })
  ]));
  const pendiente = pendienteModificado(entorno);
  assert.ok(pendiente);

  const preview = correccion.previsualizarVersion(pendiente.id_pendiente);
  assert.strictEqual(preview.posible, true);
  assert.strictEqual(preview.ventas_a_pendientes.length, 1);
  assert.strictEqual(preview.ventas_a_pendientes[0].cajas, 80);

  const resultado = correccion.aplicarVersion(pendiente.id_pendiente, 'La compra real trae menos cajas', 'test@user');
  assert.strictEqual(resultado.success, true);
  assert.strictEqual(stockTotal(entorno), 20);
  const pendientesStock = entorno.repo.getPendientes().filter(p => p.motivo === 'STOCK_INSUFICIENTE' && p.estado === 'PENDIENTE');
  assert.strictEqual(pendientesStock.length, 1);
  assert.strictEqual(Number(pendientesStock[0].cajas), 80);
  assert.strictEqual(pendientesStock[0].serie, 'AVT27');
  assert.strictEqual(pendientesStock[0].numero, '280');
  const ventaDoc = entorno.repo.getDocumentos().find(d => d.serie === 'AVT27' && d.numero === '280');
  assert.strictEqual(ventaDoc.estado_proceso, 'PENDIENTE_REVISION');
  comprobarSanidad(entorno);
});

// --------------------------------------------------------------------------
// Aceptación 5: imposible
// --------------------------------------------------------------------------
runTest('5. Si la línea de origen de un cambio dependiente desaparece, posible es false y nada cambia', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogo();
  const importacion = crearImportacion(entorno, catalogo);
  const correccion = crearCorreccion(entorno, catalogo);

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '104', linea: 1, cajas: 10, articulo: 'TOMATE ROSA', envase: 'MADERA', emisor: 'FINCA A' }),
    filaCompra({ numero: '104', linea: 2, cajas: 10, articulo: 'TOMATE VERDE', envase: 'MADERA', emisor: 'FINCA A' })
  ]));
  const capaRosa = entorno.repo.getCapasFifo().find(c => c.codigo_articulo === 'TOMATE ROSA');
  entorno.movService.registrarReproceso({
    origenes: [{ id_capa: capaRosa.id_capa, cajas: 5 }],
    destinos: [{ articulo: 'TOMATE CAMBIO', envase: 'MADERA', cajas: 5 }],
    destrio_cajas: 0,
    fecha: '2026-11-03'
  }, 'test@user');

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '104', linea: 2, cajas: 10, articulo: 'TOMATE VERDE', envase: 'MADERA', emisor: 'FINCA A' })
  ]));
  const pendiente = pendienteModificado(entorno);
  assert.ok(pendiente);
  const preview = correccion.previsualizarVersion(pendiente.id_pendiente);
  assert.strictEqual(preview.posible, false);
  assert.ok(preview.motivo.length > 0);

  const antes = instantanea(entorno);
  const resultado = correccion.aplicarVersion(pendiente.id_pendiente, 'La línea de tomate desaparece', 'test@user');
  assert.strictEqual(resultado.success, false);
  assert.strictEqual(instantanea(entorno), antes);
});

// --------------------------------------------------------------------------
// Aceptación 6: vista previa = real con semillas
// --------------------------------------------------------------------------
runTest('6. En 30 escenarios, la vista previa coincide con la corrección real y la sanidad se mantiene', () => {
  function semilla(valor) {
    let estado = valor >>> 0;
    return function () {
      estado += 0x6D2B79F5;
      let t = estado;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function entre(rng, minimo, maximo) {
    return minimo + Math.floor(rng() * (maximo - minimo + 1));
  }

  for (let escenario = 1; escenario <= 30; escenario++) {
    const rng = semilla(escenario * 3571);
    const entorno = crearEntorno();
    const catalogo = crearCatalogo();
    const importacion = crearImportacion(entorno, catalogo);
    const correccion = crearCorreccion(entorno, catalogo);

    const articuloOriginal = rng() > 0.5 ? 'TOMATE ROSA' : 'TOMATE VERDE';
    const envaseOriginal = rng() > 0.5 ? 'MADERA' : 'CAJA';
    const cajasOriginal = entre(rng, 60, 120);
    importar(importacion, csv(HEADER_COMPRAS, [
      filaCompra({
        numero: `2${String(escenario).padStart(2, '0')}`,
        cajas: cajasOriginal,
        emisor: 'FINCA A',
        articulo: articuloOriginal,
        envase: envaseOriginal
      })
    ]));

    entorno.movService.registrarSalida({
      id_documento: `DOC-S-${escenario}`,
      tipo_documento: 'SALIDA',
      serie: 'AVT27',
      numero: `3${String(escenario).padStart(2, '0')}`,
      fecha_documento: '2026-11-02',
      entidad_nombre: 'CLIENTE'
    }, [{ codigo_articulo: articuloOriginal, codigo_envase: envaseOriginal, cajas: entre(rng, 5, 20) }], 'test@user');

    const capa = entorno.repo.getCapasFifo().find(c => c.codigo_articulo === articuloOriginal && c.estado_capa === 'ACTIVA');
    if (capa && Number(capa.cajas_restantes) > 10) {
      entorno.movService.registrarReproceso({
        origenes: [{ id_capa: capa.id_capa, cajas: entre(rng, 5, 10) }],
        destinos: [{ articulo: 'TOMATE CAMBIO', envase: 'EPS', cajas: entre(rng, 5, 10) }],
        destrio_cajas: 0,
        fecha: '2026-11-03'
      }, 'test@user');
    }

    entorno.movService.registrarAjusteNegativo({
      codigo_articulo: articuloOriginal,
      codigo_envase: envaseOriginal,
      cajas: entre(rng, 1, 5),
      motivo: 'DESTRIO',
      fecha: '2026-11-04'
    }, 'test@user');

    const articuloNuevo = rng() > 0.7 ? 'TOMATE ROSA 2' : articuloOriginal;
    const envaseNuevo = rng() > 0.8 ? 'CAJA' : envaseOriginal;
    const cajasNueva = entre(rng, 20, 120);
    importar(importacion, csv(HEADER_COMPRAS, [
      filaCompra({
        numero: `2${String(escenario).padStart(2, '0')}`,
        cajas: cajasNueva,
        emisor: rng() > 0.5 ? 'FINCA B' : 'FINCA C',
        articulo: articuloNuevo,
        envase: envaseNuevo
      })
    ]));
    const pendiente = pendienteModificado(entorno);
    if (!pendiente) continue;

    const preview = correccion.previsualizarVersion(pendiente.id_pendiente);
    const antes = instantanea(entorno);
    const resultado = correccion.aplicarVersion(pendiente.id_pendiente, `Corrección escenario ${escenario}`, 'test@user');
    assert.strictEqual(preview.posible, resultado.success === true,
      `Escenario ${escenario}: preview=${preview.posible}, real=${resultado.success} (${resultado.message || ''})`);
    if (!preview.posible) {
      assert.strictEqual(instantanea(entorno), antes);
      continue;
    }
    assert.strictEqual(instantanea(entorno) === antes, false);
    const normalizarPartidas = partidas => (partidas || []).map(partida => {
      const copia = { ...partida };
      delete copia.id_capa;
      return copia;
    });
    assert.deepStrictEqual(
      normalizarPartidas(resultado.partidas_cambian),
      normalizarPartidas(preview.partidas_cambian)
    );
    assert.deepStrictEqual(resultado.ventas_a_pendientes, preview.ventas_a_pendientes);
    comprobarSanidad(entorno);
  }
});

// --------------------------------------------------------------------------
// Aceptación 7: una sola versión pendiente
// --------------------------------------------------------------------------
runTest('7. Reimportar dos veces un albarán modificado deja una sola versión PENDIENTE y una sola fila MODIFICADO_EN_ERP', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogo();
  const importacion = crearImportacion(entorno, catalogo);
  const correccion = crearCorreccion(entorno, catalogo);

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '105', cajas: 50, emisor: 'FINCA A' })
  ]));
  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '105', cajas: 65, emisor: 'FINCA A' })
  ]));
  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '105', cajas: 70, emisor: 'FINCA A' })
  ]));

  const pendientes = entorno.repo.getPendientes().filter(p => p.motivo === 'MODIFICADO_EN_ERP');
  assert.strictEqual(pendientes.length, 1);
  const versiones = entorno.repo.getVersionesDocumento();
  assert.strictEqual(versiones.filter(v => v.estado === 'PENDIENTE').length, 1);
  assert.strictEqual(versiones.filter(v => v.estado === 'DESCARTADA').length, 1);
  const listado = correccion.listarVersionesPendientes();
  assert.strictEqual(listado.length, 1);
  assert.strictEqual(listado[0].id_pendiente, pendientes[0].id_pendiente);
  assert.strictEqual(listado[0].lineas.length, 1);
});

// --------------------------------------------------------------------------
// Aceptación 8: anular ajustes
// --------------------------------------------------------------------------
runTest('8. anularAjuste devuelve el destrío a sus capas y rechaza un ajuste positivo con consumos', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogo();
  const correccion = crearCorreccion(entorno, catalogo);

  entorno.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE ROSA',
    codigo_envase: 'MADERA',
    cajas: 100,
    motivo: 'STOCK_INICIAL',
    fecha: '2026-11-01'
  }, 'test@user');
  const capa = entorno.repo.getCapasFifo()[0];
  const destrio = entorno.movService.registrarAjusteNegativo({
    codigo_articulo: 'TOMATE ROSA',
    codigo_envase: 'MADERA',
    cajas: 20,
    motivo: 'DESTRIO',
    fecha: '2026-11-02'
  }, 'test@user');
  assert.strictEqual(destrio.success, true);

  const preview = correccion.previsualizarAnularAjuste(destrio.movimientoId);
  assert.strictEqual(preview.posible, true);
  const resultado = correccion.anularAjuste(destrio.movimientoId, 'Destrío mal registrado', 'test@user');
  assert.strictEqual(resultado.success, true);
  assert.strictEqual(stockTotal(entorno), 100);
  assert.strictEqual(Number(entorno.repo.getCapasFifo().find(c => c.id_capa === capa.id_capa).cajas_restantes), 100);
  comprobarSanidad(entorno);

  const entorno2 = crearEntorno();
  const correccion2 = crearCorreccion(entorno2, catalogo);
  const positivo = entorno2.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE VERDE',
    codigo_envase: 'CAJA',
    cajas: 10,
    motivo: 'AJUSTE',
    fecha: '2026-11-01'
  }, 'test@user');
  entorno2.movService.registrarSalida({
    id_documento: 'DOC-CONS',
    tipo_documento: 'SALIDA',
    serie: 'AVT27',
    numero: '999',
    fecha_documento: '2026-11-02',
    entidad_nombre: 'CLIENTE'
  }, [{ codigo_articulo: 'TOMATE VERDE', codigo_envase: 'CAJA', cajas: 5 }], 'test@user');
  const antes = instantanea(entorno2);
  const preview2 = correccion2.previsualizarAnularAjuste(positivo.movimientoId);
  assert.strictEqual(preview2.posible, false);
  assert.ok(preview2.motivo.length > 0);
  const resultado2 = correccion2.anularAjuste(positivo.movimientoId, 'Intento no permitido', 'test@user');
  assert.strictEqual(resultado2.success, false);
  assert.strictEqual(instantanea(entorno2), antes);
});

// --------------------------------------------------------------------------
// Aceptación 9: rendimiento
// --------------------------------------------------------------------------
runTest('9. Con 5.000 movimientos y 50 dependientes, aplicar la corrección tarda menos de 10 s', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogo();
  const importacion = crearImportacion(entorno, catalogo);
  const correccion = crearCorreccion(entorno, catalogo);

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '106', cajas: 1000, emisor: 'FINCA A', articulo: 'TOMATE ROSA', envase: 'MADERA' })
  ]));
  for (let i = 0; i < 50; i++) {
    entorno.movService.registrarSalida({
      id_documento: `DOC-PERF-${i}`,
      tipo_documento: 'SALIDA',
      serie: 'AVT27',
      numero: String(1000 + i),
      fecha_documento: '2026-11-02',
      entidad_nombre: `CLIENTE ${i}`
    }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'MADERA', cajas: 10 }], 'test@user');
  }

  // 5.000 movimientos adicionales sintéticos para medir el coste de recorrerlos.
  const movimientos = [];
  const capasExtra = [];
  for (let i = 0; i < 4950; i++) {
    const idMov = `MOV-VOL-${i}`;
    const idCapa = `CAPA-VOL-${i}`;
    const fecha = '2026-10-01';
    movimientos.push({
      id_movimiento: idMov,
      fecha_hora: `${fecha}T08:00:00.000Z`,
      tipo_movimiento: 'ENTRADA',
      id_documento_ref: `DOC-VOL-${i}`,
      codigo_articulo: 'TOMATE VOLUMEN',
      codigo_envase: 'CAJA',
      cajas: 1,
      signo: 1,
      partida_origen: '',
      motivo_ajuste: '',
      usuario: 'test@user',
      observaciones: '',
      estado: 'CONFIRMADO',
      fecha_negocio: fecha,
      entidad_nombre: 'PROVEEDOR VOLUMEN',
      secuencia: '',
      origen_dato: 'CSV',
      kg_informativo: '',
      id_movimiento_ref: '',
      id_capa_objetivo: '',
      id_capa_creada: idCapa
    });
    capasExtra.push({
      id_capa: idCapa,
      id_movimiento_entrada: idMov,
      fecha_capa: fecha,
      codigo_articulo: 'TOMATE VOLUMEN',
      codigo_envase: 'CAJA',
      cajas_iniciales: 1,
      cajas_consumidas: 0,
      cajas_restantes: 1,
      estado_capa: 'ACTIVA',
      partida: '',
      documento_ref: `DOC-VOL-${i}`,
      proveedor: 'PROVEEDOR VOLUMEN',
      id_capa_origen: '',
      origen_dato: 'CSV'
    });
  }
  entorno.repo.appendMovimientos(movimientos);
  entorno.repo.saveCapasFifo(entorno.repo.getCapasFifo().concat(capasExtra));
  entorno.repo.saveStockActual(entorno.repo.getStockActual().concat([{
    stock_key: 'TOMATE VOLUMEN|CAJA',
    codigo_articulo: 'TOMATE VOLUMEN',
    nombre_articulo: 'TOMATE VOLUMEN',
    codigo_envase: 'CAJA',
    descripcion_envase: 'CAJA',
    cajas_actuales: 4950,
    fecha_ultima_actualizacion: '2026-10-01T00:00:00.000Z',
    ultimo_movimiento_id: 'MOV-VOL-4949'
  }]));

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '106', cajas: 1000, emisor: 'FINCA B', articulo: 'TOMATE ROSA', envase: 'MADERA' })
  ]));
  const pendiente = pendienteModificado(entorno);
  assert.ok(pendiente);

  const inicio = Date.now();
  const resultado = correccion.aplicarVersion(pendiente.id_pendiente, 'Prueba de rendimiento', 'test@user');
  const duracion = Date.now() - inicio;
  assert.strictEqual(resultado.success, true);
  assert.ok(duracion < 10000, `La corrección tardó ${duracion} ms`);
});

// --------------------------------------------------------------------------
// Aceptación 10: API y permisos
// --------------------------------------------------------------------------
runTest('10. Las cinco API de corrección existen, tienen rol ENCARGADO y rechazan sin sesión', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogo();
  const nombres = [
    'apiListarVersionesPendientes',
    'apiPrevisualizarVersion',
    'apiAplicarVersion',
    'apiPrevisualizarAnularAjuste',
    'apiAnularAjuste'
  ];
  for (const nombre of nombres) {
    assert.strictEqual(typeof codigo[nombre], 'function', `${nombre} debe existir`);
    assert.throws(
      () => codigo[nombre](),
      error => error instanceof Error && error.message === 'Acceso no autorizado',
      `${nombre} debe exigir sesión`
    );
  }
  for (const nombre of nombres.slice(1)) {
    assert.strictEqual(PERMISOS_API[nombre], 'ENCARGADO', `${nombre} debe ser ENCARGADO`);
  }
  assert.strictEqual(PERMISOS_API.apiListarVersionesPendientes, 'CONSULTA');

  const listado = conContextoDePrueba_('ana@stocklight.test', 'CONSULTA', () => (
    codigo.apiListarVersionesPendientes({
      repository: entorno.repo,
      movementService: entorno.movService,
      catalogoService: catalogo
    })
  ));
  assert.deepStrictEqual(listado, []);
});

runTest('11. Todo o nada: si una línea de una venta dependiente no tiene stock, el albarán entero va a PENDIENTES y reintentar lo aplica completo', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogo();
  const importacion = crearImportacion(entorno, catalogo);
  const correccion = crearCorreccion(entorno, catalogo);

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '107', linea: 1, cajas: 10, articulo: 'TOMATE A', envase: 'CAJA', emisor: 'FINCA A' }),
    filaCompra({ numero: '107', linea: 2, cajas: 10, articulo: 'TOMATE B', envase: 'CAJA', emisor: 'FINCA A' }),
    filaCompra({ numero: '107', linea: 3, cajas: 10, articulo: 'TOMATE C', envase: 'CAJA', emisor: 'FINCA A' })
  ]));

  entorno.movService.registrarSalida({
    id_documento: 'DOC-S-3LINEAS',
    tipo_documento: 'SALIDA',
    serie: 'AVT27',
    numero: '300',
    fecha_documento: '2026-11-02',
    entidad_nombre: 'CLIENTE TRES LINEAS'
  }, [
    { codigo_articulo: 'TOMATE A', codigo_envase: 'CAJA', cajas: 2 },
    { codigo_articulo: 'TOMATE B', codigo_envase: 'CAJA', cajas: 2 },
    { codigo_articulo: 'TOMATE C', codigo_envase: 'CAJA', cajas: 2 }
  ], 'test@user');

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '107', linea: 1, cajas: 10, articulo: 'TOMATE A', envase: 'CAJA', emisor: 'FINCA A' }),
    filaCompra({ numero: '107', linea: 2, cajas: 10, articulo: 'TOMATE B', envase: 'CAJA', emisor: 'FINCA A' })
  ]));
  const pendiente = pendienteModificado(entorno);
  assert.ok(pendiente);

  const preview = correccion.previsualizarVersion(pendiente.id_pendiente);
  assert.strictEqual(preview.posible, true);
  assert.strictEqual(preview.ventas_a_pendientes.length, 3, 'Debe listar las tres líneas del albarán');

  const resultado = correccion.aplicarVersion(pendiente.id_pendiente, 'La compra ya no incluye el tomate C', 'test@user');
  assert.strictEqual(resultado.success, true);
  assert.strictEqual(resultado.ventas_a_pendientes.length, 3);

  const pendientesStock = entorno.repo.getPendientes().filter(p =>
    p.motivo === 'STOCK_INSUFICIENTE' &&
    p.estado === 'PENDIENTE' &&
    String(p.serie) === 'AVT27' &&
    String(p.numero) === '300'
  );
  assert.strictEqual(pendientesStock.length, 3);
  assert.deepStrictEqual(pendientesStock.map(p => p.articulo).sort(), ['TOMATE A', 'TOMATE B', 'TOMATE C']);
  const docVenta = entorno.repo.getDocumentos().find(d => d.id_documento === 'DOC-S-3LINEAS');
  assert.strictEqual(docVenta.estado_proceso, 'PENDIENTE_REVISION');
  assert.strictEqual(stockTotal(entorno), 20);

  const movimientosSalidaActivos = entorno.movService._cargarEstado().estado.consumosPorMovimiento;
  const salidasActivas = Object.keys(movimientosSalidaActivos).filter(idMov => {
    const consumos = movimientosSalidaActivos[idMov] || [];
    if (!consumos.some(consumo => Number(consumo.cajas || 0) > 0)) return false;
    const mov = entorno.repo.getMovimientos().find(m => String(m.id_movimiento) === String(idMov));
    return mov && mov.tipo_movimiento === 'SALIDA' && mov.id_documento_ref === 'DOC-S-3LINEAS';
  });
  assert.strictEqual(salidasActivas.length, 0, 'Ninguna línea de la venta puede quedar aplicada');

  // Entra stock del artículo que faltaba y el reintento aplica el albarán entero.
  entorno.movService.registrarEntrada({
    id_documento: 'DOC-C-EXTRA',
    tipo_documento: 'COMPRA',
    serie: 'ACT27',
    numero: '900',
    fecha_documento: '2026-11-05',
    entidad_nombre: 'FINCA C'
  }, [{ codigo_articulo: 'TOMATE C', codigo_envase: 'CAJA', cajas: 2 }], 'test@user');

  const pendientesSvc = new PendientesService({
    repository: entorno.repo,
    movementService: entorno.movService,
    catalogoService: catalogo
  });
  const reintento = pendientesSvc.reintentarPendientes('test@user');
  assert.strictEqual(reintento.aplicados.total, 3);
  const docVentaFinal = entorno.repo.getDocumentos().find(d => d.id_documento === 'DOC-S-3LINEAS');
  assert.strictEqual(docVentaFinal.estado_proceso, 'CONFIRMADO');
  assert.strictEqual(entorno.repo.getPendientes().filter(p =>
    p.motivo === 'STOCK_INSUFICIENTE' && p.estado === 'PENDIENTE' &&
    String(p.serie) === 'AVT27' && String(p.numero) === '300'
  ).length, 0);
  assert.strictEqual(stockTotal(entorno), 16); // 30 iniciales - 6 vendidas + 2 del tomate C que faltaba - 10 quitadas de la compra
  comprobarSanidad(entorno);
});

runTest('12. La versión nueva de una venta sin stock deja el albarán entero en PENDIENTES, sin aplicar ninguna línea', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogo();
  const importacion = crearImportacion(entorno, catalogo);
  const correccion = crearCorreccion(entorno, catalogo);

  importar(importacion, csv(HEADER_COMPRAS, [
    filaCompra({ numero: '108', linea: 1, cajas: 10, articulo: 'TOMATE A', envase: 'CAJA', emisor: 'FINCA A' }),
    filaCompra({ numero: '108', linea: 2, cajas: 10, articulo: 'TOMATE B', envase: 'CAJA', emisor: 'FINCA A' })
  ]));
  importar(importacion, csv(HEADER_VENTAS, [
    filaVenta({ numero: '400', linea: 1, cajas: 1, articulo: 'TOMATE A', envase: 'CAJA' }),
    filaVenta({ numero: '400', linea: 2, cajas: 1, articulo: 'TOMATE B', envase: 'CAJA' })
  ]));

  importar(importacion, csv(HEADER_VENTAS, [
    filaVenta({ numero: '400', linea: 1, cajas: 20, articulo: 'TOMATE A', envase: 'CAJA' }),
    filaVenta({ numero: '400', linea: 2, cajas: 20, articulo: 'TOMATE B', envase: 'CAJA' })
  ]));
  const pendiente = pendienteModificado(entorno);
  assert.ok(pendiente);

  const preview = correccion.previsualizarVersion(pendiente.id_pendiente);
  assert.strictEqual(preview.posible, true);
  assert.strictEqual(preview.ventas_a_pendientes.length, 2);

  const resultado = correccion.aplicarVersion(pendiente.id_pendiente, 'La venta real es mucho mayor', 'test@user');
  assert.strictEqual(resultado.success, true);
  const pends = entorno.repo.getPendientes().filter(p =>
    p.motivo === 'STOCK_INSUFICIENTE' && p.estado === 'PENDIENTE' &&
    String(p.serie) === 'AVT27' && String(p.numero) === '400'
  );
  assert.strictEqual(pends.length, 2);
  const docVenta = entorno.repo.getDocumentos().find(d => d.serie === 'AVT27' && d.numero === '400');
  assert.strictEqual(docVenta.estado_proceso, 'PENDIENTE_REVISION');
  assert.strictEqual(stockTotal(entorno), 20);
  const consumos = entorno.movService._cargarEstado().estado.consumosPorMovimiento;
  const activas = Object.keys(consumos).filter(id => {
    const lista = consumos[id] || [];
    if (!lista.some(c => Number(c.cajas || 0) > 0)) return false;
    const mov = entorno.repo.getMovimientos().find(m => String(m.id_movimiento) === String(id));
    return mov && mov.tipo_movimiento === 'SALIDA' && mov.id_documento_ref === docVenta.id_documento;
  });
  assert.strictEqual(activas.length, 0);
  comprobarSanidad(entorno);
});

console.log(`\nRESULTADOS T-027: ${passed} SUPERADAS | ${failed} FALLIDAS`);
if (failed) process.exit(1);
