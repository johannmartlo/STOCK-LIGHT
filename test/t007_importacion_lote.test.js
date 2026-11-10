/**
 * STOCK-LIGHT — Test Suite T-007: Importación en lote desde CSV de Hispatec
 *
 * Cubre los puntos de aceptación 1 a 12 de docs/tickets/T-007-importacion-lote.md.
 * Ejecutable: node test/t007_importacion_lote.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { crearEntorno } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { ImportacionService } = require('../src/importacion/ImportacionService');
const { clasificar, agruparEnDocumentos, resumenImportacion } = require('../src/importacion/ClasificadorLineas');
const { PREFIJOS_SERIES_IMPORTACION, UMBRAL_DOCUMENTOS_POR_TRAMO } = require('../src/Config');
const codigo = require('../src/Código');

const FIXTURE_DIR = path.join(__dirname, 'fixtures/csv');
const COMPRAS_TEXTO = fs.readFileSync(path.join(FIXTURE_DIR, 'compras_t007.csv'), 'utf8');
const VENTAS_TEXTO = fs.readFileSync(path.join(FIXTURE_DIR, 'ventas_t007.csv'), 'utf8');
const HEADER_COMPRAS = COMPRAS_TEXTO.split(/\r?\n/)[0];
const HEADER_VENTAS = VENTAS_TEXTO.split(/\r?\n/)[0];

let passed = 0;
let failed = 0;

function runTest(descripcion, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${descripcion}`);
    passed++;
  } catch (error) {
    console.error(`  ❌ [FAIL] ${descripcion}`);
    console.error(`     Error: ${error.message}`);
    if (error.stack) console.error(error.stack.split('\n').slice(1, 4).join('\n'));
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

function crearCatalogo(reglas) {
  return new CatalogoService({
    config: {
      atributos: [{ nombre: 'SEGUIMIENTO', activo: true }],
      reglas,
      catalogo: [],
      agrupaciones: []
    }
  });
}

function catalogoBase() {
  return crearCatalogo([
    { id: 'R1', atributo: 'SEGUIMIENTO', valor: 'NO', prioridad: 1, articulo_contiene: 'PRODUCTO NO SEGUIDO', activo: true },
    { id: 'R2', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 2, articulo_contiene: 'TOMATE', activo: true },
    { id: 'R3', atributo: 'SEGUIMIENTO', valor: 'NO', prioridad: 3, activo: true }
  ]);
}

function catalogoSoloTomate() {
  return crearCatalogo([
    { id: 'R2', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 2, articulo_contiene: 'TOMATE', activo: true },
    { id: 'R3', atributo: 'SEGUIMIENTO', valor: 'NO', prioridad: 3, activo: true }
  ]);
}

function catalogoSinReglas() {
  return crearCatalogo([]);
}

function crearServicio(entorno, catalogo, umbralTramos) {
  return new ImportacionService({
    repository: entorno.repo,
    movementService: entorno.movService,
    catalogoService: catalogo,
    umbralTramos
  });
}

function stockMap(repo) {
  const mapa = {};
  for (const fila of repo.getStockActual()) {
    mapa[fila.stock_key] = Number(fila.cajas_actuales || 0);
  }
  return mapa;
}

function capasNormalizadas(repo) {
  return repo.getCapasFifo().map(capa => ({
    articulo: capa.codigo_articulo,
    envase: capa.codigo_envase,
    fecha: capa.fecha_capa,
    iniciales: Number(capa.cajas_iniciales || 0),
    consumidas: Number(capa.cajas_consumidas || 0),
    restantes: Number(capa.cajas_restantes || 0),
    proveedor: capa.proveedor,
    origen: capa.origen_dato
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function consumosNormalizados(repo) {
  return repo.getConsumosFifo().map(fila => ({
    articulo: fila.codigo_articulo,
    envase: fila.codigo_envase,
    fecha: fila.fecha_negocio,
    cajas: Number(fila.cajas || 0)
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function instantanea(entorno) {
  return {
    movimientos: entorno.repo.getMovimientos().length,
    documentos: entorno.repo.getDocumentos().length,
    importaciones: entorno.repo.getImportaciones().length,
    stock: stockMap(entorno.repo),
    capas: capasNormalizadas(entorno.repo),
    consumos: consumosNormalizados(entorno.repo)
  };
}

/**
 * Bloquea setValues/clearContent en todas las hojas. Permite desbloquear para continuar.
 */
function blindarEscrituras(spreadsheet) {
  let intentos = 0;
  let bloqueado = true;

  for (const hoja of spreadsheet.sheets.values()) {
    const getRangeOriginal = hoja.getRange.bind(hoja);
    hoja.getRange = (...args) => {
      const rango = getRangeOriginal(...args);
      const setValuesOriginal = rango.setValues.bind(rango);
      const clearContentOriginal = rango.clearContent.bind(rango);
      rango.setValues = (valores) => {
        if (bloqueado) {
          intentos++;
          throw new Error('Escritura bloqueada por la prueba: setValues');
        }
        return setValuesOriginal(valores);
      };
      rango.clearContent = () => {
        if (bloqueado) {
          intentos++;
          throw new Error('Escritura bloqueada por la prueba: clearContent');
        }
        return clearContentOriginal();
      };
      return rango;
    };

    const clearOriginal = hoja.clear.bind(hoja);
    hoja.clear = () => {
      if (bloqueado) {
        intentos++;
        throw new Error('Escritura bloqueada por la prueba: clear');
      }
      return clearOriginal();
    };
  }

  return {
    intentos: () => intentos,
    desbloquear: () => { bloqueado = false; }
  };
}

function contarLlamadas(spreadsheet) {
  const conteo = {};
  for (const [nombre, hoja] of spreadsheet.sheets.entries()) {
    conteo[nombre] = { getValues: 0, setValues: 0 };
    const getRangeOriginal = hoja.getRange.bind(hoja);
    hoja.getRange = (...args) => {
      const rango = getRangeOriginal(...args);
      const getValuesOriginal = rango.getValues.bind(rango);
      const setValuesOriginal = rango.setValues.bind(rango);
      rango.getValues = () => {
        conteo[nombre].getValues++;
        return getValuesOriginal();
      };
      rango.setValues = (valores) => {
        conteo[nombre].setValues++;
        return setValuesOriginal(valores);
      };
      return rango;
    };
  }
  return conteo;
}

// --------------------------------------------------------------------------
// Aceptación 1: flujo completo con los fixtures de compras y ventas
// --------------------------------------------------------------------------
runTest('1. Flujo completo: compras y ventas dejan capas, stock y CONSUMOS_FIFO esperados', () => {
  const entorno = crearEntorno();
  const servicio = crearServicio(entorno, catalogoBase());

  const previaCompras = servicio.previsualizar(COMPRAS_TEXTO);
  assert.strictEqual(previaCompras.documentos.length, 5);
  assert.deepStrictEqual(previaCompras.documentos.map(doc => doc.estado), [
    'NUEVO', 'NUEVO', 'SIN_LINEAS_APLICABLES', 'NUEVO', 'SIN_LINEAS_APLICABLES'
  ]);
  assert.deepStrictEqual(previaCompras.resumen.porEstado, {
    OK: 3,
    SERIE_IGNORADA: 1,
    NO_SEGUIDA: 1
  });

  const confirmadaCompras = servicio.confirmar(COMPRAS_TEXTO, previaCompras.hash, 'operador@stocklight.test');
  assert.strictEqual(confirmadaCompras.status, 'CONFIRMADA');
  assert.strictEqual(confirmadaCompras.documentos.filter(doc => doc.estado === 'NUEVO').length, 3);

  const documentos = entorno.repo.getDocumentos();
  assert.strictEqual(documentos.length, 3, 'Solo los documentos con líneas aplicables se registran');
  assert.ok(documentos.every(doc => String(doc.firma_lineas || '').length === 64));

  const movimientos = entorno.repo.getMovimientos();
  assert.strictEqual(movimientos.length, 3, 'Ni ACA ni el producto no seguido crean movimientos');
  assert.ok(movimientos.every(mov => mov.origen_dato === 'CSV'));
  assert.deepStrictEqual(movimientos.map(mov => Number(mov.kg_informativo)), [50, 40, 25]);
  assert.deepStrictEqual(movimientos.map(mov => mov.entidad_nombre), [
    'PROVEEDOR FICTICIO A', 'PROVEEDOR FICTICIO B', 'PROVEEDOR FICTICIO C'
  ]);

  const capas = entorno.repo.getCapasFifo();
  assert.strictEqual(capas.length, 3);
  const capaDiez = capas.find(capa => Number(capa.cajas_iniciales) === 10);
  assert.strictEqual(capaDiez.fecha_capa, '2026-11-02');
  assert.strictEqual(capaDiez.proveedor, 'PROVEEDOR FICTICIO A');
  assert.strictEqual(capaDiez.origen_dato, 'CSV');

  assert.deepStrictEqual(stockMap(entorno.repo), { 'TOMATE FICTICIO|CAJA FICTICIA': 23 });

  const previaVentas = servicio.previsualizar(VENTAS_TEXTO);
  assert.deepStrictEqual(previaVentas.documentos.map(doc => doc.estado), ['NUEVO', 'NUEVO']);

  const confirmadaVentas = servicio.confirmar(VENTAS_TEXTO, previaVentas.hash, 'operador@stocklight.test');
  assert.strictEqual(confirmadaVentas.status, 'CONFIRMADA');

  assert.deepStrictEqual(stockMap(entorno.repo), { 'TOMATE FICTICIO|CAJA FICTICIA': 5 });

  const capasFinales = capasNormalizadas(entorno.repo);
  assert.deepStrictEqual(capasFinales.map(capa => [capa.iniciales, capa.consumidas, capa.restantes]), [
    [10, 10, 0], [8, 8, 0], [5, 0, 5]
  ]);

  const consumos = entorno.repo.getConsumosFifo();
  assert.strictEqual(consumos.length, 3);
  assert.deepStrictEqual(consumos.map(fila => Number(fila.cajas)).sort((a, b) => a - b), [2, 6, 10]);
  assert.strictEqual(entorno.repo.getMovimientos().length, 5);
});

// --------------------------------------------------------------------------
// Aceptación 2: repetir la misma importación
// --------------------------------------------------------------------------
runTest('2. Confirmar dos veces el mismo archivo no cambia nada y avisa de que ya estaba importado', () => {
  const entorno = crearEntorno();
  const servicio = crearServicio(entorno, catalogoBase());
  const previa = servicio.previsualizar(COMPRAS_TEXTO);
  servicio.confirmar(COMPRAS_TEXTO, previa.hash, 'operador@stocklight.test');
  const antes = instantanea(entorno);

  const repetida = servicio.confirmar(COMPRAS_TEXTO, previa.hash, 'operador@stocklight.test');
  assert.strictEqual(repetida.success, true);
  assert.strictEqual(repetida.status, 'YA_IMPORTADO');
  assert.strictEqual(repetida.yaImportado, true);
  assert.deepStrictEqual(instantanea(entorno), antes);

  const filas = COMPRAS_TEXTO.split(/\r?\n/).slice(1).filter(Boolean).reverse();
  const reordenado = crearCsv(HEADER_COMPRAS, filas);
  const previaReordenada = servicio.previsualizar(reordenado);
  assert.notStrictEqual(previaReordenada.hash, previa.hash);

  const otraCopia = servicio.confirmar(reordenado, previaReordenada.hash, 'operador@stocklight.test');
  assert.strictEqual(otraCopia.status, 'CONFIRMADA');
  assert.strictEqual(otraCopia.conteos.nuevos, 0);
  assert.strictEqual(otraCopia.conteos.saltados, 3);
  assert.strictEqual(instantanea(entorno).movimientos, antes.movimientos);
  assert.strictEqual(instantanea(entorno).documentos, antes.documentos);
  assert.strictEqual(instantanea(entorno).importaciones, antes.importaciones + 1);
});

// --------------------------------------------------------------------------
// Aceptación 3: albarán modificado en el ERP
// --------------------------------------------------------------------------
runTest('3. Un albarán ya importado con otras cajas o una línea de más queda MODIFICADO_EN_ERP y no se aplica', () => {
  const entorno = crearEntorno();
  const servicio = crearServicio(entorno, catalogoBase());
  const previa = servicio.previsualizar(COMPRAS_TEXTO);
  servicio.confirmar(COMPRAS_TEXTO, previa.hash, 'operador@stocklight.test');

  const conCajasDistintas = crearCsv(HEADER_COMPRAS, [
    filaCompra({ numero: '100', linea: 1, cajas: 11 }),
    filaCompra({ numero: '100', linea: 2, cajas: 5 }),
    filaCompra({ numero: '106', linea: 1, cajas: 4 })
  ]);
  const previaCajas = servicio.previsualizar(conCajasDistintas);
  assert.strictEqual(previaCajas.documentos[0].estado, 'MODIFICADO_EN_ERP');
  const confirmadaCajas = servicio.confirmar(conCajasDistintas, previaCajas.hash, 'operador@stocklight.test');
  assert.strictEqual(confirmadaCajas.documentos.find(doc => doc.numero === '100').estado, 'MODIFICADO_EN_ERP');
  assert.strictEqual(confirmadaCajas.documentos.find(doc => doc.numero === '106').estado, 'NUEVO');
  assert.strictEqual(entorno.repo.getMovimientos().length, 4);
  assert.deepStrictEqual(stockMap(entorno.repo), { 'TOMATE FICTICIO|CAJA FICTICIA': 27 });
  assert.deepStrictEqual(
    entorno.repo.getCapasFifo().filter(capa => capa.documento_ref === 'ACT27/100').map(capa => Number(capa.cajas_iniciales)),
    [10]
  );

  const conLineaDeMas = crearCsv(HEADER_COMPRAS, [
    filaCompra({ numero: '100', linea: 1, cajas: 10 }),
    filaCompra({ numero: '100', linea: 2, cajas: 5 }),
    filaCompra({ numero: '100', linea: 3, cajas: 2 }),
    filaCompra({ numero: '107', linea: 1, cajas: 6 })
  ]);
  const previaLinea = servicio.previsualizar(conLineaDeMas);
  assert.strictEqual(previaLinea.documentos[0].estado, 'MODIFICADO_EN_ERP');
  const confirmadaLinea = servicio.confirmar(conLineaDeMas, previaLinea.hash, 'operador@stocklight.test');
  assert.strictEqual(confirmadaLinea.documentos.find(doc => doc.numero === '107').estado, 'NUEVO');
  assert.strictEqual(entorno.repo.getMovimientos().length, 5);
  assert.deepStrictEqual(stockMap(entorno.repo), { 'TOMATE FICTICIO|CAJA FICTICIA': 33 });
  assert.strictEqual(
    entorno.repo.getCapasFifo().filter(capa => capa.documento_ref === 'ACT27/100').length,
    1
  );
});

// --------------------------------------------------------------------------
// Aceptación 4: salida sin stock (todo o nada)
// --------------------------------------------------------------------------
runTest('4. Una venta sin compra importada deja el albarán en PENDIENTE_REVISION y no toca capas aunque una línea tenga stock', () => {
  const entorno = crearEntorno();
  const servicio = crearServicio(entorno, catalogoBase());

  servicio.confirmar(crearCsv(HEADER_COMPRAS, [
    filaCompra({ numero: '900', linea: 1, cajas: 10 })
  ]), null, 'operador@stocklight.test');

  const capasAntes = capasNormalizadas(entorno.repo);
  const venta = crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '910', linea: 1, articulo: 'TOMATE FICTICIO', cajas: 5 }),
    filaVenta({ numero: '910', linea: 2, articulo: 'TOMATE SIN COMPRA', cajas: 5 })
  ]);

  const previa = servicio.previsualizar(venta);
  assert.strictEqual(previa.documentos[0].estado, 'STOCK_INSUFICIENTE');

  const confirmada = servicio.confirmar(venta, previa.hash, 'operador@stocklight.test');
  assert.strictEqual(confirmada.documentos[0].estado, 'STOCK_INSUFICIENTE');
  assert.strictEqual(confirmada.documentos[0].estadoProceso, 'PENDIENTE_REVISION');

  const documentos = entorno.repo.getDocumentos();
  const documentoVenta = documentos.find(doc => doc.serie === 'AVT27' && doc.numero === '910');
  assert.strictEqual(documentoVenta.estado_proceso, 'PENDIENTE_REVISION');

  const pendientes = entorno.repo.getPendientes();
  assert.strictEqual(pendientes.length, 2);
  assert.ok(pendientes.every(fila => fila.motivo === 'STOCK_INSUFICIENTE'));
  assert.deepStrictEqual(pendientes.map(fila => Number(fila.cajas)).sort((a, b) => a - b), [5, 5]);

  assert.strictEqual(entorno.repo.getMovimientos().length, 1, 'Solo la compra genera movimiento');
  assert.deepStrictEqual(stockMap(entorno.repo), { 'TOMATE FICTICIO|CAJA FICTICIA': 10 });
  assert.deepStrictEqual(capasNormalizadas(entorno.repo), capasAntes);
  assert.strictEqual(entorno.repo.getConsumosFifo().length, 0);
});

// --------------------------------------------------------------------------
// Aceptación 5: D-029 (seguimiento independiente de la clasificación comercial)
// --------------------------------------------------------------------------
runTest('5. D-029: tomate sin clasificación comercial se aplica, no tomate va a NO_SEGUIDA y sin reglas va a PENDIENTES', () => {
  const entornoTomate = crearEntorno();
  const catalogoTomate = catalogoSoloTomate();
  const servicioTomate = crearServicio(entornoTomate, catalogoTomate);
  assert.strictEqual(catalogoTomate.clasificar('TOMATE FICTICIO', 'CAJA FICTICIA').seguimiento, 'SEGUIDA');
  assert.deepStrictEqual(catalogoTomate.clasificar('TOMATE FICTICIO', 'CAJA FICTICIA').cajones, {});

  servicioTomate.confirmar(crearCsv(HEADER_COMPRAS, [
    filaCompra({ numero: '920', linea: 1, cajas: 10 })
  ]), null, 'operador@stocklight.test');
  const ventaTomate = crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '921', linea: 1, cajas: 4 })
  ]);
  const confirmadaTomate = servicioTomate.confirmar(ventaTomate, servicioTomate.previsualizar(ventaTomate).hash, 'operador@stocklight.test');
  assert.strictEqual(confirmadaTomate.documentos[0].estado, 'NUEVO');
  assert.deepStrictEqual(stockMap(entornoTomate.repo), { 'TOMATE FICTICIO|CAJA FICTICIA': 6 });
  assert.strictEqual(entornoTomate.repo.getMovimientos().length, 2);

  const entornoNoSeguido = crearEntorno();
  const servicioNoSeguido = crearServicio(entornoNoSeguido, catalogoBase());
  const ventaNoSeguida = crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '930', linea: 1, articulo: 'PRODUCTO NO SEGUIDO', cajas: 7 })
  ]);
  const previaNoSeguida = servicioNoSeguido.previsualizar(ventaNoSeguida);
  assert.strictEqual(previaNoSeguida.resumen.porEstado.NO_SEGUIDA, 1);
  const confirmadaNoSeguida = servicioNoSeguido.confirmar(ventaNoSeguida, previaNoSeguida.hash, 'operador@stocklight.test');
  assert.strictEqual(confirmadaNoSeguida.status, 'CONFIRMADA');
  assert.strictEqual(entornoNoSeguido.repo.getMovimientos().length, 0);
  assert.strictEqual(entornoNoSeguido.repo.getDocumentos().length, 0);
  assert.strictEqual(confirmadaNoSeguida.importacion.lineas_no_seguidas, 1);

  const entornoSinReglas = crearEntorno();
  const servicioSinReglas = crearServicio(entornoSinReglas, catalogoSinReglas());
  const compraPendiente = crearCsv(HEADER_COMPRAS, [
    filaCompra({ numero: '940', linea: 1, cajas: 5 })
  ]);
  const previaPendiente = servicioSinReglas.previsualizar(compraPendiente);
  assert.strictEqual(previaPendiente.resumen.porEstado.PENDIENTE, 1);
  const confirmadaPendiente = servicioSinReglas.confirmar(compraPendiente, previaPendiente.hash, 'operador@stocklight.test');
  assert.strictEqual(confirmadaPendiente.documentos[0].estado, 'NUEVO');
  assert.strictEqual(entornoSinReglas.repo.getMovimientos().length, 0);
  const pendientes = entornoSinReglas.repo.getPendientes();
  assert.strictEqual(pendientes.length, 1);
  assert.strictEqual(pendientes[0].motivo, 'SEGUIMIENTO_DESCONOCIDO');
  assert.strictEqual(entornoSinReglas.repo.getDocumentos()[0].estado_proceso, 'PENDIENTE_REVISION');
});

// --------------------------------------------------------------------------
// Aceptación 6: abonos (D-031)
// --------------------------------------------------------------------------
runTest('6. Los abonos (cajas 0 o negativas) quedan en ABONO, no mueven stock y se cuentan', () => {
  const lineas = [
    { tipoDoc: 'SALIDA', serie: 'AVT27', numero: '1', linea: 1, fecha: '2026-11-03', entidad: 'C', articulo: 'TOMATE', envase: 'CAJA', cajas: 0, origenDato: 'CSV' },
    { tipoDoc: 'SALIDA', serie: 'AVT27', numero: '1', linea: 2, fecha: '2026-11-03', entidad: 'C', articulo: 'TOMATE', envase: 'CAJA', cajas: -5, origenDato: 'CSV' },
    { tipoDoc: 'SALIDA', serie: 'AVT27', numero: '1', linea: 3, fecha: '2026-11-03', entidad: 'C', articulo: 'TOMATE', envase: 'CAJA', cajas: 12.5, origenDato: 'CSV' },
    { tipoDoc: 'SALIDA', serie: 'AVT27', numero: '1', linea: 4, fecha: '2026-11-03', entidad: 'C', articulo: 'TOMATE', envase: 'CAJA', cajas: 5, origenDato: 'CSV' }
  ];
  const clasificadas = clasificar(lineas, PREFIJOS_SERIES_IMPORTACION, () => 'SEGUIDA');
  assert.deepStrictEqual(clasificadas.map(linea => linea.estado), ['ABONO', 'ABONO', 'ERROR_DATOS', 'OK']);
  const documentos = agruparEnDocumentos(clasificadas);
  assert.strictEqual(documentos[0].resumen.porEstado.ABONO, 2);
  assert.strictEqual(resumenImportacion(clasificadas, documentos).porEstado.ABONO, 2);

  const entorno = crearEntorno();
  const servicio = crearServicio(entorno, catalogoBase());
  const ventasAbono = crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '300', linea: 1, cajas: 0 }),
    filaVenta({ numero: '300', linea: 2, cajas: -5 })
  ]);
  const previa = servicio.previsualizar(ventasAbono);
  assert.strictEqual(previa.resumen.porEstado.ABONO, 2);
  assert.strictEqual(previa.resumen.porEstado.ERROR_DATOS, undefined);
  assert.strictEqual(previa.documentos[0].estado, 'SIN_LINEAS_APLICABLES');

  const confirmada = servicio.confirmar(ventasAbono, previa.hash, 'operador@stocklight.test');
  assert.strictEqual(confirmada.importacion.lineas_abono, 2);
  assert.strictEqual(confirmada.importacion.lineas_error, 0);
  assert.strictEqual(entorno.repo.getMovimientos().length, 0);
  assert.strictEqual(entorno.repo.getPendientes().length, 0);
  assert.deepStrictEqual(stockMap(entorno.repo), {});
});

// --------------------------------------------------------------------------
// Aceptación 7: previsualizar no escribe y coincide con confirmar
// --------------------------------------------------------------------------
runTest('7. previsualizar no escribe en ninguna hoja y su resultado coincide con confirmar', () => {
  const entorno = crearEntorno();
  const servicio = crearServicio(entorno, catalogoBase());
  const blindaje = blindarEscrituras(entorno.ss);

  const previa = servicio.previsualizar(COMPRAS_TEXTO);
  assert.strictEqual(blindaje.intentos(), 0, 'previsualizar no debe intentar escribir');
  assert.strictEqual(entorno.repo.getMovimientos().length, 0);
  assert.strictEqual(entorno.repo.getDocumentos().length, 0);
  assert.strictEqual(entorno.repo.getCapasFifo().length, 0);

  blindaje.desbloquear();
  const confirmada = servicio.confirmar(COMPRAS_TEXTO, previa.hash, 'operador@stocklight.test');

  assert.deepStrictEqual(
    previa.documentos.map(doc => [doc.tipoDoc, doc.serie, doc.numero, doc.estado]),
    confirmada.documentos.map(doc => [doc.tipoDoc, doc.serie, doc.numero, doc.estado])
  );
  assert.deepStrictEqual(previa.stockSimulado, stockMap(entorno.repo));
  assert.deepStrictEqual(previa.resumen.porEstado, confirmada.resumen.porEstado);
});

// --------------------------------------------------------------------------
// Aceptación 8: hash distinto
// --------------------------------------------------------------------------
runTest('8. Confirmar con un hash distinto del texto se rechaza sin escribir', () => {
  const entorno = crearEntorno();
  const servicio = crearServicio(entorno, catalogoBase());
  const blindaje = blindarEscrituras(entorno.ss);

  const resultado = servicio.confirmar(COMPRAS_TEXTO, '0'.repeat(64), 'operador@stocklight.test');
  assert.strictEqual(resultado.success, false);
  assert.strictEqual(resultado.status, 'HASH_NO_COINCIDE');
  assert.strictEqual(blindaje.intentos(), 0);
  assert.strictEqual(entorno.repo.getMovimientos().length, 0);
  assert.strictEqual(entorno.repo.getDocumentos().length, 0);
  assert.strictEqual(entorno.repo.getImportaciones().length, 0);
});

// --------------------------------------------------------------------------
// Aceptación 9: rendimiento y troceo con mock
// --------------------------------------------------------------------------
runTest('9. 300 documentos se aplican en 2 tramos con una lectura y una escritura por hoja y tramo', () => {
  assert.strictEqual(UMBRAL_DOCUMENTOS_POR_TRAMO, 150);
  const entorno = crearEntorno();
  const servicio = crearServicio(entorno, catalogoBase(), UMBRAL_DOCUMENTOS_POR_TRAMO);

  const filas = [];
  for (let i = 1; i <= 300; i++) {
    filas.push(filaCompra({
      numero: String(i),
      linea: 1,
      emisor: `PROVEEDOR ${i}`,
      cajas: 1,
      kg: 1
    }));
  }
  const csv = crearCsv(HEADER_COMPRAS, filas);

  const conteo = contarLlamadas(entorno.ss);
  const resultado = servicio.confirmar(csv, null, 'operador@stocklight.test');

  assert.strictEqual(resultado.status, 'CONFIRMADA');
  assert.strictEqual(resultado.tramos, 2);
  assert.strictEqual(resultado.importacion.ultimo_tramo, 2);
  assert.strictEqual(entorno.repo.getMovimientos().length, 300);
  assert.strictEqual(entorno.repo.getDocumentos().length, 300);
  assert.deepStrictEqual(stockMap(entorno.repo), { 'TOMATE FICTICIO|CAJA FICTICIA': 300 });

  for (const nombre of ['MOVIMIENTOS', 'DOCUMENTOS', 'CAPAS_FIFO', 'STOCK_ACTUAL', 'IMPORTACIONES']) {
    assert.ok(conteo[nombre].getValues <= 2, `${nombre}: ${conteo[nombre].getValues} lecturas para 2 tramos`);
    assert.ok(conteo[nombre].setValues <= 2, `${nombre}: ${conteo[nombre].setValues} escrituras para 2 tramos`);
  }
  assert.strictEqual(conteo.MOVIMIENTOS.getValues, 2);
  assert.strictEqual(conteo.MOVIMIENTOS.setValues, 2);
  assert.strictEqual(conteo.DOCUMENTOS.setValues, 2);
  assert.strictEqual(conteo.CAPAS_FIFO.setValues, 2);
  assert.strictEqual(conteo.STOCK_ACTUAL.setValues, 2);
  assert.strictEqual(conteo.IMPORTACIONES.setValues, 2);
});

// --------------------------------------------------------------------------
// Aceptación 10: interrupción y reanudación
// --------------------------------------------------------------------------
runTest('10. Interrumpir tras el primer tramo y reintentar da el mismo resultado que sin interrupción', () => {
  const compras = crearCsv(HEADER_COMPRAS, [
    filaCompra({ numero: '950', linea: 1, cajas: 100 })
  ]);
  const ventas = crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '960', linea: 1, cajas: 12 }),
    filaVenta({ numero: '961', linea: 1, cajas: 2 }),
    filaVenta({ numero: '962', linea: 1, cajas: 3 }),
    filaVenta({ numero: '963', linea: 1, cajas: 4 })
  ]);

  function ejecutar(interrumpir) {
    const entorno = crearEntorno();
    const servicio = crearServicio(entorno, catalogoBase(), 2);
    servicio.confirmar(compras, null, 'operador@stocklight.test');
    const previa = servicio.previsualizar(ventas);

    if (!interrumpir) {
      const resultado = servicio.confirmar(ventas, previa.hash, 'operador@stocklight.test');
      return { entorno, servicio, resultado };
    }

    const original = entorno.movService.aplicarDocumentosEnLote.bind(entorno.movService);
    let llamadas = 0;
    entorno.movService.aplicarDocumentosEnLote = (...args) => {
      llamadas++;
      if (llamadas === 1) return original(...args);
      throw new Error('INTERRUPCION SIMULADA');
    };

    let interrumpida = false;
    try {
      servicio.confirmar(ventas, previa.hash, 'operador@stocklight.test');
    } catch (error) {
      interrumpida = true;
    }
    assert.strictEqual(interrumpida, true, 'La segunda llamada debe interrumpirse');

    const enCurso = entorno.repo.getImportaciones().find(fila =>
      String(fila.hash) === previa.hash
    );
    assert.ok(enCurso, 'IMPORTACIONES debe guardar el tramo en curso');
    assert.strictEqual(enCurso.estado, 'EN_CURSO');
    assert.strictEqual(Number(enCurso.ultimo_tramo), 1);

    entorno.movService.aplicarDocumentosEnLote = original;
    const resultado = servicio.confirmar(ventas, previa.hash, 'operador@stocklight.test');
    return { entorno, servicio, resultado };
  }

  const normal = ejecutar(false);
  const interrumpido = ejecutar(true);

  assert.strictEqual(normal.resultado.tramos, 2);
  assert.strictEqual(interrumpido.resultado.tramos, 2);
  assert.deepStrictEqual(stockMap(interrumpido.entorno.repo), stockMap(normal.entorno.repo));
  assert.deepStrictEqual(capasNormalizadas(interrumpido.entorno.repo), capasNormalizadas(normal.entorno.repo));
  assert.deepStrictEqual(consumosNormalizados(interrumpido.entorno.repo), consumosNormalizados(normal.entorno.repo));
  assert.strictEqual(interrumpido.servicio.movementService.comprobarConsistencia().totalDiferencias, 0);
});

// --------------------------------------------------------------------------
// Aceptación 11: coherencia tras importar compras y ventas
// --------------------------------------------------------------------------
runTest('11. Tras importar compras y ventas la reconstrucción coincide y CONSUMOS_FIFO cuadra con cajas_consumidas', () => {
  const entorno = crearEntorno();
  const servicio = crearServicio(entorno, catalogoBase());
  servicio.confirmar(COMPRAS_TEXTO, servicio.previsualizar(COMPRAS_TEXTO).hash, 'operador@stocklight.test');
  servicio.confirmar(VENTAS_TEXTO, servicio.previsualizar(VENTAS_TEXTO).hash, 'operador@stocklight.test');

  const informe = entorno.movService.comprobarConsistencia();
  assert.strictEqual(informe.consistente, true);
  assert.strictEqual(informe.totalDiferencias, 0);

  const consumos = entorno.repo.getConsumosFifo();
  const totalPorCapa = {};
  for (const fila of consumos) {
    totalPorCapa[fila.id_capa] = (totalPorCapa[fila.id_capa] || 0) + Number(fila.cajas || 0);
  }
  for (const capa of entorno.repo.getCapasFifo()) {
    assert.strictEqual(
      Number(totalPorCapa[capa.id_capa] || 0),
      Number(capa.cajas_consumidas || 0),
      `CONSUMOS_FIFO no cuadra en la capa ${capa.id_capa}`
    );
  }
  assert.strictEqual(consumos.reduce((total, fila) => total + Number(fila.cajas || 0), 0), 18);
});

// --------------------------------------------------------------------------
// Regla 4: documento con líneas OK y PENDIENTE
// --------------------------------------------------------------------------
runTest('12. Un documento con líneas OK y PENDIENTE aplica las OK y queda CONFIRMADO_PARCIAL', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogo([
    { id: 'R2', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 1, articulo_contiene: 'TOMATE', activo: true }
  ]);
  const servicio = crearServicio(entorno, catalogo);

  servicio.confirmar(crearCsv(HEADER_COMPRAS, [
    filaCompra({ numero: '970', linea: 1, cajas: 10 })
  ]), null, 'operador@stocklight.test');

  const venta = crearCsv(HEADER_VENTAS, [
    filaVenta({ numero: '971', linea: 1, articulo: 'TOMATE FICTICIO', cajas: 2 }),
    filaVenta({ numero: '971', linea: 2, articulo: 'OTRO PRODUCTO', cajas: 3 })
  ]);
  const confirmada = servicio.confirmar(venta, servicio.previsualizar(venta).hash, 'operador@stocklight.test');

  assert.strictEqual(confirmada.documentos[0].estadoProceso, 'CONFIRMADO_PARCIAL');
  assert.strictEqual(confirmada.importacion.lineas_pendientes, 1);
  const documento = entorno.repo.getDocumentos().find(doc => doc.numero === '971');
  assert.strictEqual(documento.estado_proceso, 'CONFIRMADO_PARCIAL');
  assert.deepStrictEqual(stockMap(entorno.repo), { 'TOMATE FICTICIO|CAJA FICTICIA': 8 });

  const pendientes = entorno.repo.getPendientes();
  assert.strictEqual(pendientes.length, 1);
  assert.strictEqual(pendientes[0].motivo, 'SEGUIMIENTO_DESCONOCIDO');
  assert.strictEqual(pendientes[0].articulo, 'OTRO PRODUCTO');
  assert.strictEqual(entorno.repo.getMovimientos().length, 2);
});

// --------------------------------------------------------------------------
// API pública (regla 7)
// --------------------------------------------------------------------------
runTest('13. Las dos API de importación están expuestas y delegan en el servicio', () => {
  const entorno = crearEntorno();
  const catalogo = catalogoBase();
  const previa = codigo.apiPrevisualizarImportacionCsv(COMPRAS_TEXTO, {
    repository: entorno.repo,
    movementService: entorno.movService,
    catalogoService: catalogo
  });
  assert.strictEqual(typeof previa.hash, 'string');
  assert.strictEqual(previa.hash.length, 64);

  const confirmada = codigo.apiConfirmarImportacionCsv(COMPRAS_TEXTO, previa.hash, {
    repository: entorno.repo,
    movementService: entorno.movService,
    catalogoService: catalogo
  });
  assert.strictEqual(confirmada.status, 'CONFIRMADA');
  assert.strictEqual(entorno.repo.getMovimientos().length, 3);
});

console.log(`\nRESULTADOS T-007: ${passed} SUPERADAS | ${failed} FALLIDAS`);
if (failed) process.exit(1);
