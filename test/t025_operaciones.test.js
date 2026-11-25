/**
 * STOCK-LIGHT — Test Suite T-025: servidor de operaciones (solo lectura)
 *
 * Cubre los puntos de aceptación 1 a 8 de docs/tickets/T-025-servidor-operaciones.md.
 * Ejecutable: node test/t025_operaciones.test.js
 */

const assert = require('assert');
const { crearEntorno, MockSpreadsheet } = require('./helpers/mockSheets');
const { CatalogoService } = require('../src/CatalogoService');
const { OperacionesService } = require('../src/OperacionesService');
const { PERMISOS_API, conContextoDePrueba_ } = require('../src/Seguridad');
const codigo = require('../src/Código');

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

function crearCatalogoComercial() {
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

function crearOps(entorno, catalogo) {
  return new OperacionesService({
    repository: entorno.repo,
    movementService: entorno.movService,
    catalogoService: catalogo || crearCatalogoComercial()
  });
}

function filasHojas(spreadsheet) {
  return JSON.stringify([...spreadsheet.sheets.entries()].map(([nombre, hoja]) => [nombre, hoja.rows]));
}

function clonarEntorno(entorno) {
  const clon = new MockSpreadsheet('CLON-T025');
  for (const [nombre, hoja] of entorno.ss.sheets.entries()) {
    const nueva = clon.insertSheet(nombre);
    nueva.rows = hoja.rows.map(fila => fila.slice());
  }
  return crearEntorno({ spreadsheet: clon, skipProvision: true });
}

function mapaCapas(entorno) {
  const mapa = {};
  for (const capa of entorno.repo.getCapasFifo()) {
    mapa[String(capa.id_capa)] = Number(capa.cajas_restantes || 0);
  }
  return mapa;
}

function diferenciaCapas(antes, despues) {
  const mapa = {};
  for (const id of Object.keys(antes)) {
    const delta = Number(despues[id] || 0) - Number(antes[id] || 0);
    if (delta !== 0) mapa[id] = delta;
  }
  return mapa;
}

function diferenciaPreview(preview) {
  const mapa = {};
  for (const partida of preview.partidas_vuelven) {
    mapa[String(partida.id_capa)] = Number(partida.cajas || 0);
  }
  for (const partida of preview.partidas_bajan) {
    mapa[String(partida.id_capa)] = -Number(partida.cajas || 0);
  }
  for (const partida of preview.partidas_desaparecen) {
    mapa[String(partida.id_capa)] = -Number(partida.cajas || 0);
  }
  return mapa;
}

function totalStock(entorno) {
  return entorno.repo.getStockActual()
    .reduce((total, fila) => total + Number(fila.cajas_actuales || 0), 0);
}

function todosLosElementos(lista) {
  return lista.grupos.reduce((todos, grupo) => todos.concat(grupo.elementos), []);
}

function semillaAleatoria(seed) {
  let estado = seed >>> 0;
  return function siguiente() {
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

function anadirReprocesoDirecto(repo, id, fecha, totalDestino, anulado) {
  repo.appendReproceso({
    id_reproceso: id,
    fecha,
    fecha_hora: `${fecha}T10:00:00.000Z`,
    usuario: 'test@user',
    total_retirado: 60,
    total_destinos: totalDestino,
    destrio_cajas: 2,
    destrio_kg: '',
    cambio_envase: 'SI',
    estado: anulado ? 'ANULADO' : 'ACTIVO',
    observaciones: ''
  });
  repo.appendReprocesoLineas([
    {
      id_reproceso: id,
      tipo: 'ORIGEN',
      id_capa: `CAPA-${id}`,
      codigo_articulo: 'TOMATE ROSA',
      codigo_envase: 'MADERA',
      cajas: 60,
      proveedor: 'PROV HISTORICO',
      fecha_capa: '2026-10-01',
      destrio_prorrateado: 2,
      id_movimiento: `MOV-ORIGEN-${id}`
    },
    {
      id_reproceso: id,
      tipo: 'DESTINO',
      id_capa: `CAPA-DEST-${id}`,
      codigo_articulo: 'TOMATE ROSA',
      codigo_envase: '500',
      cajas: totalDestino,
      proveedor: 'PROV HISTORICO',
      fecha_capa: '2026-10-01',
      destrio_prorrateado: 0,
      id_movimiento: `MOV-DESTINO-${id}`
    }
  ]);
}

// --------------------------------------------------------------------------
// Aceptación 1: proporciones de los conjuntos de destino
// --------------------------------------------------------------------------
runTest('1. Con 7 reprocesos, la proporción es la mediana de los 5 últimos y un anulado no cuenta', () => {
  const entorno = crearEntorno();
  const ops = crearOps(entorno);

  const destinosPorFecha = [120, 120, 86, 86, 86, 86, 86];
  for (let i = 0; i < destinosPorFecha.length; i++) {
    anadirReprocesoDirecto(entorno.repo, `REP-${i + 1}`, `2026-11-0${i + 1}`, destinosPorFecha[i], false);
  }
  anadirReprocesoDirecto(entorno.repo, 'REP-ANULADO', '2026-11-08', 999, true);

  const sugerencias = ops.sugerenciasCambio('TOMATE ROSA', 'MADERA');
  assert.strictEqual(sugerencias.length, 1);
  const sugerencia = sugerencias[0];
  assert.strictEqual(sugerencia.destinos.length, 1);
  assert.strictEqual(sugerencia.destinos[0].articulo, 'TOMATE ROSA');
  assert.strictEqual(sugerencia.destinos[0].envase, '500');
  assert.strictEqual(sugerencia.destinos[0].proporcion, 1.43);
  assert.strictEqual(sugerencia.proporcion_total, 1.43);
  assert.strictEqual(sugerencia.destrio_habitual, 0.03);
  assert.strictEqual(sugerencia.veces, 7);
  assert.strictEqual(sugerencia.ultima_vez, '2026-11-07');
  assert.deepStrictEqual(ops.sugerenciasCambio('TOMATE SIN HISTORIAL', 'MADERA'), []);
});

// --------------------------------------------------------------------------
// Aceptación 2: rinde distinto
// --------------------------------------------------------------------------
runTest('2. Una desviación del 9 % no avisa y una del 11 % sí; 60 → 86 da 1,43', () => {
  const entorno = crearEntorno();
  const ops = crearOps(entorno);

  const exacto = ops.evaluarCambio_(60, [{ cajas: 86 }], { proporcion_total: 1.43 });
  assert.strictEqual(exacto.real, 1.43);
  assert.strictEqual(exacto.esperado, 1.43);
  assert.strictEqual(exacto.rinde_distinto, false);

  const nueve = ops.evaluarCambio_(100, [{ cajas: 109 }], { proporcion_total: 1 });
  assert.strictEqual(nueve.desviacion_pct, 9);
  assert.strictEqual(nueve.rinde_distinto, false);

  const once = ops.evaluarCambio_(100, [{ cajas: 111 }], { proporcion_total: 1 });
  assert.strictEqual(once.desviacion_pct, 11);
  assert.strictEqual(once.rinde_distinto, true);

  assert.strictEqual(ops.evaluarCambio_(100, [{ cajas: 90 }], null).esperado, 1);
});

// --------------------------------------------------------------------------
// Aceptación 3: previsualización de anulaciones con 30 escenarios
// --------------------------------------------------------------------------
runTest('3. En 30 escenarios, la vista previa coincide con la anulación real y no modifica nada', () => {
  const articulos = ['TOMATE ROSA', 'TOMATE VERDE', 'TOMATE ROSA SABOR'];
  const envases = ['MADERA', 'CAJA', 'EPS'];

  for (let escenario = 1; escenario <= 30; escenario++) {
    const rng = semillaAleatoria(escenario * 7919);
    const entorno = crearEntorno();
    const catalogo = crearCatalogoComercial();
    const ops = crearOps(entorno, catalogo);

    for (let i = 0; i < 3; i++) {
      const articulo = articulos[entre(rng, 0, articulos.length - 1)];
      const envase = envases[entre(rng, 0, envases.length - 1)];
      const cajas = entre(rng, 20, 60);
      const fecha = `2026-10-0${i + 1}`;
      entorno.movService.registrarEntrada({
        id_documento: `DOC-E-${escenario}-${i}`,
        tipo_documento: 'COMPRA',
        serie: 'ACT27',
        numero: `${escenario}${i}`,
        fecha_documento: fecha,
        entidad_nombre: `PROV ${escenario}`
      }, [{
        codigo_articulo: articulo,
        codigo_envase: envase,
        cajas,
        partida: `P-${escenario}-${i}`
      }], 'test@user');
    }

    const capas = entorno.repo.getCapasFifo();
    const capaVenta = capas[entre(rng, 0, capas.length - 1)];
    const cajasVenta = Math.max(1, Math.min(10, Number(capaVenta.cajas_restantes || 1)));
    entorno.movService.registrarSalida({
      id_documento: `DOC-S-${escenario}`,
      tipo_documento: 'SALIDA',
      serie: 'AVT27',
      numero: `${escenario}9`,
      fecha_documento: '2026-10-05',
      entidad_nombre: `CLIENTE ${escenario}`
    }, [{
      codigo_articulo: capaVenta.codigo_articulo,
      codigo_envase: capaVenta.codigo_envase,
      cajas: cajasVenta
    }], 'test@user');

    const capaReproceso = entorno.repo.getCapasFifo().find(capa =>
      String(capa.estado_capa) === 'ACTIVA' && Number(capa.cajas_restantes || 0) > 5
    );
    let idReproceso = '';
    if (capaReproceso) {
      const cajasReproceso = Math.min(5, Number(capaReproceso.cajas_restantes));
      const resultado = entorno.movService.registrarReproceso({
        origenes: [{ id_capa: capaReproceso.id_capa, cajas: cajasReproceso }],
        destinos: [{
          articulo: `TOMATE CAMBIO ${escenario}`,
          envase: 'EPS',
          cajas: cajasReproceso
        }],
        destrio_cajas: 0,
        fecha: '2026-10-06'
      }, 'test@user');
      assert.strictEqual(resultado.success, true);
      idReproceso = resultado.id_reproceso;
    }

    const extra = entorno.movService.registrarEntrada({
      id_documento: `DOC-ANUL-${escenario}`,
      tipo_documento: 'COMPRA',
      serie: 'ACT27',
      numero: `${escenario}8`,
      fecha_documento: '2026-10-07',
      entidad_nombre: `PROV ANUL ${escenario}`
    }, [{
      codigo_articulo: 'TOMATE ANULADO',
      codigo_envase: 'CAJA',
      cajas: 5
    }], 'test@user');
    const capaAnulada = entorno.repo.getCapasFifo().find(capa =>
      String(capa.id_movimiento_entrada) === String(extra.movimientosGenerados[0])
    );
    entorno.movService.anularEntrada({ id_capa: capaAnulada.id_capa }, 'test@user');

    const candidatasEntrada = entorno.repo.getCapasFifo()
      .filter(capa => String(capa.estado_capa) === 'ACTIVA' && Number(capa.cajas_restantes || 0) > 0
        && !capa.codigo_articulo.startsWith('TOMATE CAMBIO') && capa.codigo_articulo !== 'TOMATE ANULADO')
      .map(capa => ({ tipo: 'ENTRADA', id: capa.id_capa }));
    const candidatasSalida = [{ tipo: 'SALIDA', id: `DOC-S-${escenario}` }];
    const candidatasReproceso = idReproceso ? [{ tipo: 'REPROCESO', id: idReproceso }] : [];

    const tipoDeseado = escenario % 3;
    let candidatas = candidatasEntrada;
    if (tipoDeseado === 1) candidatas = candidatasSalida;
    if (tipoDeseado === 2 && candidatasReproceso.length > 0) candidatas = candidatasReproceso;
    if (candidatas.length === 0) candidatas = candidatasEntrada.concat(candidatasSalida, candidatasReproceso);

    const operacion = candidatas[entre(rng, 0, candidatas.length - 1)];
    const antesHojas = filasHojas(entorno.ss);
    const antesCapas = mapaCapas(entorno);
    const antesStock = totalStock(entorno);
    const preview = ops.previsualizarAnulacion(operacion.tipo, operacion.id);

    assert.strictEqual(filasHojas(entorno.ss), antesHojas, 'La vista previa no puede modificar las hojas');

    const clon = clonarEntorno(entorno);
    let real;
    if (operacion.tipo === 'ENTRADA') {
      real = clon.movService.anularEntrada({ id_capa: operacion.id }, 'test@user');
    } else if (operacion.tipo === 'SALIDA') {
      real = clon.movService.anularSalida({ id_documento: operacion.id }, 'test@user');
    } else {
      real = clon.movService.anularReproceso(operacion.id, 'test@user');
    }

    assert.strictEqual(
      preview.posible,
      real.success === true,
      `Escenario ${escenario}: posible=${preview.posible}, real=${real.success} (${real.message || ''})`
    );

    if (preview.posible) {
      const despuesCapas = mapaCapas(clon);
      assert.deepStrictEqual(
        diferenciaPreview(preview),
        diferenciaCapas(antesCapas, despuesCapas),
        `Escenario ${escenario}: las partidas de la vista previa no coinciden con la anulación real`
      );
      const efecto = preview.efecto_variedades.reduce((total, fila) => total + Number(fila.cajas || 0), 0);
      assert.strictEqual(efecto, totalStock(clon) - antesStock);
    }
  }
});

// --------------------------------------------------------------------------
// Aceptación 4: historial de movimientos
// --------------------------------------------------------------------------
runTest('4. El historial suma el stock, agrupa por fecha, filtra y pagina sin repetir', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogoComercial();
  const ops = crearOps(entorno, catalogo);

  entorno.movService.registrarEntrada({
    id_documento: 'DOC-ACT-1',
    tipo_documento: 'COMPRA',
    serie: 'ACT27',
    numero: '1',
    fecha_documento: '2026-11-01',
    entidad_nombre: 'PROV A'
  }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'MADERA', cajas: 100 }], 'test@user');
  entorno.movService.registrarEntrada({
    id_documento: 'DOC-ACT-2',
    tipo_documento: 'COMPRA',
    serie: 'ACT27',
    numero: '2',
    fecha_documento: '2026-11-02',
    entidad_nombre: 'PROV B'
  }, [{ codigo_articulo: 'TOMATE VERDE', codigo_envase: 'CAJA', cajas: 50 }], 'test@user');
  entorno.movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE ROSA',
    codigo_envase: 'MADERA',
    cajas: 10,
    motivo: 'STOCK_INICIAL',
    fecha: '2026-11-02'
  }, 'test@user');
  entorno.movService.registrarSalida({
    id_documento: 'DOC-SAL-1',
    tipo_documento: 'SALIDA',
    serie: 'AVT27',
    numero: '10',
    fecha_documento: '2026-11-03',
    entidad_nombre: 'CLIENTE A'
  }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'MADERA', cajas: 30 }], 'test@user');

  const capaRosa = entorno.repo.getCapasFifo().find(capa =>
    capa.codigo_articulo === 'TOMATE ROSA' && Number(capa.cajas_restantes || 0) > 20
  );
  assert.ok(capaRosa);
  entorno.movService.registrarReproceso({
    origenes: [{ id_capa: capaRosa.id_capa, cajas: 20 }],
    destinos: [{ articulo: 'TOMATE CAMBIO', envase: 'MADERA', cajas: 20 }],
    destrio_cajas: 0,
    fecha: '2026-11-05'
  }, 'test@user');
  entorno.movService.registrarAjusteNegativo({
    codigo_articulo: 'TOMATE ROSA',
    codigo_envase: 'MADERA',
    cajas: 5,
    motivo: 'DESTRIO',
    fecha: '2026-11-05'
  }, 'test@user');
  entorno.movService.registrarSalida({
    id_documento: 'DOC-SAL-2',
    tipo_documento: 'SALIDA',
    serie: 'AVT27',
    numero: '11',
    fecha_documento: '2026-11-06',
    entidad_nombre: 'CLIENTE B'
  }, [{ codigo_articulo: 'TOMATE VERDE', codigo_envase: 'CAJA', cajas: 10 }], 'test@user');
  entorno.movService.anularSalida({ id_documento: 'DOC-SAL-2' }, 'test@user');

  const historial = ops.listarMovimientos({ limite: 100 });
  const elementos = todosLosElementos(historial);
  assert.strictEqual(historial.total, 8);
  assert.strictEqual(elementos.filter(elemento => elemento.tipo === 'cambio').length, 1);
  assert.strictEqual(elementos.filter(elemento => elemento.tipo === 'anulacion').length, 1);

  const suma = elementos.filter(elemento => !elemento.anulado)
    .reduce((total, elemento) => total + Number(elemento.cajas || 0), 0);
  assert.strictEqual(suma, totalStock(entorno));

  const fechas = historial.grupos.map(grupo => grupo.fecha);
  assert.deepStrictEqual(fechas, fechas.slice().sort().reverse());

  const salidaAnulada = elementos.find(elemento => elemento.id === 'DOC-SAL-2' && elemento.tipo === 'salida');
  assert.ok(salidaAnulada);
  assert.strictEqual(salidaAnulada.anulado, true);
  assert.ok(salidaAnulada.anulado_por);
  const anulacion = elementos.find(elemento => elemento.tipo === 'anulacion');
  assert.strictEqual(anulacion.anula_id, 'DOC-SAL-2');

  const soloCambios = todosLosElementos(ops.listarMovimientos({ tipo: 'cambio', limite: 100 }));
  assert.strictEqual(soloCambios.length, 1);
  assert.strictEqual(soloCambios[0].tipo, 'cambio');

  const soloEntradas = todosLosElementos(ops.listarMovimientos({ tipo: 'entrada', limite: 100 }));
  assert.ok(soloEntradas.length >= 2);
  assert.ok(soloEntradas.every(elemento => elemento.tipo === 'entrada'));

  const soloRosa = todosLosElementos(ops.listarMovimientos({ variedad: 'ROSA', limite: 100 }));
  assert.ok(soloRosa.length >= 3);
  assert.ok(soloRosa.every(elemento => elemento.variedades.includes('ROSA')));

  const porFecha = todosLosElementos(ops.listarMovimientos({ desde: '2026-11-02', hasta: '2026-11-03', limite: 100 }));
  assert.ok(porFecha.length > 0);
  assert.ok(porFecha.every(elemento => elemento.fecha_negocio >= '2026-11-02' && elemento.fecha_negocio <= '2026-11-03'));

  const porTextoProveedor = todosLosElementos(ops.listarMovimientos({ texto: 'prov a', limite: 100 }));
  assert.ok(porTextoProveedor.some(elemento => elemento.tipo === 'entrada'));
  const porTextoCliente = todosLosElementos(ops.listarMovimientos({ texto: 'cliente b', limite: 100 }));
  assert.ok(porTextoCliente.some(elemento => elemento.id === 'DOC-SAL-2'));
  const porTextoAlbaran = todosLosElementos(ops.listarMovimientos({ texto: 'act27/1', limite: 100 }));
  assert.ok(porTextoAlbaran.some(elemento => elemento.documento === 'ACT27/1'));

  const idsCompletos = elementos.map(elemento => elemento.id);
  const idsPaginados = [];
  let cursor = null;
  do {
    const pagina = ops.listarMovimientos({ limite: 2, cursor });
    idsPaginados.push(...todosLosElementos(pagina).map(elemento => elemento.id));
    cursor = pagina.siguiente_cursor;
  } while (cursor !== null);
  assert.strictEqual(new Set(idsPaginados).size, idsPaginados.length);
  assert.deepStrictEqual(idsPaginados, idsCompletos);

  for (const elemento of elementos) {
    for (const campo of ['id', 'tipo', 'texto', 'detalle', 'cajas', 'variedad', 'documento', 'usuario', 'fecha_hora', 'anulable', 'anulado', 'anulado_por']) {
      assert.ok(Object.prototype.hasOwnProperty.call(elemento, campo), `Falta el campo ${campo}`);
    }
  }
});

// --------------------------------------------------------------------------
// Aceptación 5: búsqueda
// --------------------------------------------------------------------------
runTest('5. La búsqueda ignora mayúsculas y acentos, encuentra albaranes y nunca pasa de 20', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogoComercial();
  const ops = crearOps(entorno, catalogo);

  entorno.movService.registrarEntrada({
    id_documento: 'DOC-BUSCAR-1',
    tipo_documento: 'COMPRA',
    serie: 'ACT27',
    numero: '777',
    fecha_documento: '2026-11-01',
    entidad_nombre: 'PROVEEDOR BUSCABLE'
  }, [
    { codigo_articulo: 'TOMATE ROSA', codigo_envase: 'MADERA', cajas: 10 },
    { codigo_articulo: 'TOMATE ROSÁ', codigo_envase: 'MADERA', cajas: 5 }
  ], 'test@user');

  for (let i = 0; i < 40; i++) {
    entorno.movService.registrarEntrada({
      id_documento: `DOC-ROSA-${i}`,
      tipo_documento: 'COMPRA',
      serie: 'ACT27',
      numero: String(800 + i),
      fecha_documento: '2026-11-02',
      entidad_nombre: 'ROSA PROVEEDOR'
    }, [{ codigo_articulo: `ROSA ${i}`, codigo_envase: 'CAJA', cajas: 1 }], 'test@user');
  }

  const rosa = ops.buscar('rosa');
  assert.ok(rosa.variedades.some(fila => fila.grupo === 'ROSA'));
  assert.ok(rosa.partidas.some(fila => fila.articulo === 'TOMATE ROSÁ'));
  assert.ok(rosa.total <= 20, `La búsqueda devolvió ${rosa.total} resultados`);
  assert.ok(rosa.partidas.length <= 8);

  const mayusculas = ops.buscar('ROSA');
  assert.strictEqual(mayusculas.total, rosa.total);

  const acento = ops.buscar('rosá');
  assert.ok(acento.partidas.some(fila => fila.articulo === 'TOMATE ROSÁ'));

  const albaran = ops.buscar('777');
  assert.strictEqual(albaran.albaranes.length, 1);
  assert.strictEqual(albaran.albaranes[0].id, 'DOC-BUSCAR-1');
  assert.strictEqual(albaran.albaranes[0].numero, '777');

  const vacio = ops.buscar('no-existe-123');
  assert.deepStrictEqual(vacio, { variedades: [], partidas: [], albaranes: [], cambios: [], total: 0 });
});

// --------------------------------------------------------------------------
// Aceptación 6: rendimiento con 5.000 movimientos
// --------------------------------------------------------------------------
runTest('6. Con 5.000 movimientos, cada API responde en menos de 2 s', () => {
  const entorno = crearEntorno();
  const catalogo = crearCatalogoComercial();
  const ops = crearOps(entorno, catalogo);

  const movimientos = [];
  const capas = [];
  for (let i = 0; i < 5000; i++) {
    const idMov = `MOV-PERF-${i}`;
    const idCapa = `CAPA-PERF-${i}`;
    const fecha = `2026-${String(1 + Math.floor(i / 500)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
    movimientos.push({
      id_movimiento: idMov,
      fecha_hora: `${fecha}T08:00:00.000Z`,
      tipo_movimiento: 'ENTRADA',
      id_documento_ref: `DOC-PERF-${i}`,
      codigo_articulo: 'TOMATE ROSA',
      codigo_envase: 'MADERA',
      cajas: 1,
      signo: 1,
      partida_origen: '',
      motivo_ajuste: '',
      usuario: 'perf@test',
      observaciones: '',
      estado: 'CONFIRMADO',
      fecha_negocio: fecha,
      entidad_nombre: 'PROVEEDOR PERF',
      secuencia: '',
      origen_dato: 'CSV',
      kg_informativo: '',
      id_movimiento_ref: '',
      id_capa_objetivo: '',
      id_capa_creada: idCapa
    });
    capas.push({
      id_capa: idCapa,
      id_movimiento_entrada: idMov,
      fecha_capa: fecha,
      codigo_articulo: 'TOMATE ROSA',
      codigo_envase: 'MADERA',
      cajas_iniciales: 1,
      cajas_consumidas: 0,
      cajas_restantes: 1,
      estado_capa: 'ACTIVA',
      partida: '',
      documento_ref: `DOC-PERF-${i}`,
      proveedor: 'PROVEEDOR PERF',
      id_capa_origen: '',
      origen_dato: 'CSV'
    });
  }
  entorno.repo.appendMovimientos(movimientos);
  entorno.repo.saveCapasFifo(capas);
  entorno.repo.saveStockActual([{
    stock_key: 'TOMATE ROSA|MADERA',
    codigo_articulo: 'TOMATE ROSA',
    nombre_articulo: 'TOMATE ROSA',
    codigo_envase: 'MADERA',
    descripcion_envase: 'MADERA',
    cajas_actuales: 5000,
    fecha_ultima_actualizacion: '2026-11-25T00:00:00.000Z',
    ultimo_movimiento_id: 'MOV-PERF-4999'
  }]);

  for (let i = 0; i < 50; i++) {
    anadirReprocesoDirecto(entorno.repo, `REP-PERF-${i}`, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, 86, false);
  }

  const medir = (nombre, fn) => {
    const inicio = Date.now();
    fn();
    const duracion = Date.now() - inicio;
    assert.ok(duracion < 2000, `${nombre} tardó ${duracion} ms`);
    return duracion;
  };

  medir('apiSugerenciasCambio', () => ops.sugerenciasCambio('TOMATE ROSA', 'MADERA'));
  medir('apiEvaluarCambio', () => ops.evaluarCambio_(60, [{ cajas: 86 }], { proporcion_total: 1.43 }));
  medir('apiPrevisualizarAnulacion', () => ops.previsualizarAnulacion('ENTRADA', capas[0].id_capa));
  medir('apiListarMovimientos', () => ops.listarMovimientos({ limite: 50 }));
  medir('apiBuscar', () => ops.buscar('rosa'));
});

// --------------------------------------------------------------------------
// Aceptación 7: sesión y permisos
// --------------------------------------------------------------------------
runTest('7. Las cinco API nuevas son CONSULTA, rechazan sin sesión y funcionan con contexto', () => {
  const nombres = [
    'apiSugerenciasCambio',
    'apiEvaluarCambio',
    'apiPrevisualizarAnulacion',
    'apiListarMovimientos',
    'apiBuscar'
  ];
  for (const nombre of nombres) {
    assert.strictEqual(typeof codigo[nombre], 'function', `${nombre} debe existir`);
    assert.strictEqual(PERMISOS_API[nombre], 'CONSULTA', `${nombre} debe ser CONSULTA`);
    assert.throws(
      () => codigo[nombre](),
      error => error instanceof Error && error.message === 'Acceso no autorizado',
      `${nombre} debe exigir sesión`
    );
  }

  const entorno = crearEntorno();
  const catalogo = crearCatalogoComercial();
  const resultado = conContextoDePrueba_('ana@stocklight.test', 'CONSULTA', () => (
    codigo.apiListarMovimientos({ limite: 1 }, {
      repository: entorno.repo,
      movementService: entorno.movService,
      catalogoService: catalogo
    })
  ));
  assert.strictEqual(resultado.total, 0);
  assert.deepStrictEqual(resultado.grupos, []);
});

// --------------------------------------------------------------------------
// Aceptación 8: coherencia con el resto de la superficie (t020/t023)
// --------------------------------------------------------------------------
runTest('8. La cobertura de API_PUBLICA y PERMISOS_API sigue completa', () => {
  const fs = require('fs');
  const path = require('path');
  const documento = fs.readFileSync(path.join(__dirname, '..', 'docs', 'API_PUBLICA.md'), 'utf8');
  for (const nombre of ['apiSugerenciasCambio', 'apiEvaluarCambio', 'apiPrevisualizarAnulacion', 'apiListarMovimientos', 'apiBuscar']) {
    assert.ok(documento.includes(`| \`${nombre}\` |`), `${nombre} debe estar en API_PUBLICA.md`);
  }
});

console.log(`\nRESULTADOS T-025: ${passed} SUPERADAS | ${failed} FALLIDAS`);
if (failed) process.exit(1);
