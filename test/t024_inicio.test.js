/**
 * STOCK-LIGHT — Test Suite T-024 (Servidor): InicioService, apiObtenerInicio y apiObtenerPartida
 *
 * Cubre los puntos de aceptación 1 a 5 de docs/tickets/T-024-base-visual-existencias.md:
 * 1. Invariantes de apiObtenerInicio con datos aleatorios (entradas, ventas, reprocesos, anulaciones).
 * 2. Trazabilidad de reprocesos: viene_de en partida destino y se_convirtio_en en partida origen.
 * 3. Rendimiento con 5.000 movimientos (< 2s en Node y lectura única por hoja).
 * 4. Estado sin stock devuelve estructura vacía válida.
 * 5. Guardas de sesión T-020 (rechaza sin sesión; ejecuta dentro de conContextoDePrueba_) y columnas AGRUPACIONES.
 *
 * Ejecutable: node test/t024_inicio.test.js
 */

const assert = require('assert');
const { crearEntorno } = require('./helpers/mockSheets');
const { SCHEMA_DEFINITIONS } = require('../src/Repository');
const { InicioService } = require('../src/InicioService');
const { CatalogoService } = require('../src/CatalogoService');
const { conContextoDePrueba_ } = require('../src/Seguridad');
const codigo = require('../src/Código');

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
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    failed++;
  }
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function configurarCatalogo(repo) {
  repo.saveAtributos([
    { nombre: 'SEGUIMIENTO', descripcion: 'Seguimiento', activo: true },
    { nombre: 'FAMILIA', descripcion: 'Familia', activo: true }
  ]);
  repo.saveReglasClasificacion([
    { id: 'R-SEG', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 1, articulo_contiene: 'TOMATE', activo: true },
    { id: 'R-ROSA', atributo: 'FAMILIA', valor: 'ROSA', prioridad: 10, articulo_contiene: 'ROSA', activo: true },
    { id: 'R-MOR', atributo: 'FAMILIA', valor: 'MORESCO', prioridad: 20, articulo_contiene: 'MORESCO', activo: true },
    { id: 'R-VOL', atributo: 'FAMILIA', valor: 'VOLLEY', prioridad: 30, articulo_contiene: 'VOLLEY', activo: true }
  ]);
  repo.saveAgrupaciones([
    { agrupacion: 'COMERCIAL', orden: 1, grupo: 'Rosa', subgrupo: '', filtro: 'FAMILIA=ROSA', activo: true, color: '#EC4899', dias_aviso: 4, stock_bajo: '' },
    { agrupacion: 'COMERCIAL', orden: 2, grupo: 'Moresco', subgrupo: '', filtro: 'FAMILIA=MORESCO', activo: true, color: '', dias_aviso: '', stock_bajo: '' }
  ]);
}

console.log('================================================================');
console.log(' TEST SUITE T-024 — INICIO SERVICE Y PARTIDAS');
console.log('================================================================\n');

// --------------------------------------------------------------------------
// 1. INVARIANTES CON DATOS ALEATORIOS (ENTRADAS, VENTAS, REPROCESOS, ANULACIONES)
// --------------------------------------------------------------------------
runTest('1. Invariantes de apiObtenerInicio con datos aleatorios (serie, variedades, partidas, sale_primero, anulaciones)', () => {
  const env = crearEntorno();
  configurarCatalogo(env.repo);
  const rand = rng(424242);

  const productos = [
    { art: 'TOMATE ROSA M', env: 'CARTON' },
    { art: 'TOMATE MORESCO G', env: 'CARTON' },
    { art: 'TOMATE VOLLEY I', env: 'MADERA' }, // sin grupo en COMERCIAL -> va a Sin agrupar
    { art: 'TOMATE COCKTAIL I', env: 'IFCO' }  // sin grupo en COMERCIAL -> va a Sin agrupar
  ];

  const hoy = '2026-11-20';
  const fechas = [];
  for (let d = 0; d < 25; d++) {
    const dt = new Date(Date.UTC(2026, 10, 20 - (24 - d)));
    fechas.push(dt.toISOString().slice(0, 10));
  }

  let docNum = 1;
  const salidasDocs = [];
  let reprocesoAnuladoId = null;

  for (let i = 0; i < 35; i++) {
    const p = productos[Math.floor(rand() * productos.length)];
    const fecha = fechas[Math.floor(rand() * fechas.length)];
    const cajas = 20 + Math.floor(rand() * 60);
    docNum++;
    env.movService.registrarEntrada({
      id_documento: `DOC-RND-${docNum}`,
      tipo_documento: 'COMPRA',
      serie: 'ACT27',
      numero: String(docNum),
      fecha_documento: fecha,
      entidad_nombre: `PROV-${(i % 3) + 1}`,
      origen_dato: 'CSV',
      firma_lineas: `F-${docNum}`
    }, [{ codigo_articulo: p.art, codigo_envase: p.env, cajas, partida: `P-${docNum}` }], 'test');

    if (rand() < 0.5) {
      docNum++;
      const cajasSal = 5 + Math.floor(rand() * 15);
      const resSal = env.movService.registrarSalida({
        id_documento: `DOC-RND-${docNum}`,
        tipo_documento: 'SALIDA',
        serie: 'AVT27',
        numero: String(docNum),
        fecha_documento: fecha,
        entidad_nombre: 'CLIENTE-1',
        origen_dato: 'CSV',
        firma_lineas: `F-${docNum}`
      }, [{ codigo_articulo: p.art, codigo_envase: p.env, cajas: cajasSal }], 'test');
      if (resSal.success) salidasDocs.push({ serie: 'AVT27', numero: String(docNum) });
    }
  }

  // Anular una salida
  if (salidasDocs.length > 0) {
    env.movService.anularSalida(salidasDocs[0], 'test');
  }

  // Reproceso activo y reproceso anulado
  const capasActivas = env.repo.getCapasFifo().filter(c => Number(c.cajas_restantes) >= 15);
  assert.ok(capasActivas.length >= 2, 'Debe haber capas suficientes para reprocesar');

  const rActivo = env.movService.registrarReproceso({
    origenes: [{ id_capa: capasActivas[0].id_capa, cajas: 10 }],
    destinos: [{ articulo: 'TOMATE ROSA 500', envase: 'EPS', cajas: 12 }],
    destrio_cajas: 1
  }, 'test');
  assert.strictEqual(rActivo.success, true);

  const rAnular = env.movService.registrarReproceso({
    origenes: [{ id_capa: capasActivas[1].id_capa, cajas: 10 }],
    destinos: [{ articulo: 'TOMATE MORESCO 500', envase: 'EPS', cajas: 10 }],
    destrio_cajas: 0
  }, 'test');
  assert.strictEqual(rAnular.success, true);
  reprocesoAnuladoId = rAnular.id_reproceso;

  const anulRes = env.movService.anularReproceso(reprocesoAnuladoId, 'test');
  assert.strictEqual(anulRes.success, true);

  const inicio = conContextoDePrueba_('Ana', 'CONSULTA', () =>
    codigo.apiObtenerInicio({ repository: env.repo, reloj: () => hoy })
  );

  // Invariante 1: último punto de la serie = total
  assert.strictEqual(inicio.serie.length, 30);
  assert.strictEqual(inicio.serie[inicio.serie.length - 1].stock, inicio.total);

  // Invariante 2: suma de variedades = total
  const sumaVars = inicio.variedades.reduce((acc, v) => acc + v.cajas, 0);
  assert.strictEqual(sumaVars, inicio.total);

  // Invariante 3 y 4: suma de partidas = cajas de variedad y sale_primero = capa más antigua
  for (const v of inicio.variedades) {
    const sumaPartidas = v.partidas.reduce((acc, p) => acc + p.cajas, 0);
    assert.strictEqual(sumaPartidas, v.cajas);
    const fechaMin = v.partidas.reduce((min, p) => (!min || p.fecha < min ? p.fecha : min), '');
    assert.strictEqual(v.sale_primero, fechaMin);
    assert.strictEqual(v.partidas[0].fecha, fechaMin);

    // Invariante 5: ningún reproceso anulado aparece en viene_de
    for (const p of v.partidas) {
      if (p.viene_de) {
        assert.notStrictEqual(p.viene_de.id_reproceso, reprocesoAnuladoId);
      }
    }
  }

  // Sin agrupar al final
  assert.strictEqual(inicio.variedades[inicio.variedades.length - 1].grupo, 'Sin agrupar');
});

// --------------------------------------------------------------------------
// 2. TRAZABILIDAD DE REPROCESO: viene_de Y se_convirtio_en
// --------------------------------------------------------------------------
runTest('2. Reproceso: partida destino trae viene_de con orígenes y apiObtenerPartida del origen trae se_convirtio_en', () => {
  const env = crearEntorno();
  configurarCatalogo(env.repo);

  env.movService.registrarEntrada({
    id_documento: 'DOC-TRAZ-1',
    tipo_documento: 'COMPRA',
    serie: 'ACT27',
    numero: '10',
    fecha_documento: '2026-11-16',
    entidad_nombre: 'FINCA SOLANA',
    origen_dato: 'CSV',
    firma_lineas: 'F10'
  }, [{ codigo_articulo: 'TOMATE ROSA GRANEL', codigo_envase: 'CARTON', cajas: 100, partida: 'P-10' }], 'Ana');

  const capaOrigen = env.repo.getCapasFifo()[0];

  const rep = env.movService.registrarReproceso({
    origenes: [{ id_capa: capaOrigen.id_capa, cajas: 60 }],
    destinos: [{ articulo: 'TOMATE ROSA 500', envase: 'EPS', cajas: 86 }],
    destrio_cajas: 2
  }, 'Juan');
  assert.strictEqual(rep.success, true);

  const capaDestino = rep.capasCreadas[0];

  const inicio = conContextoDePrueba_('Ana', 'CONSULTA', () =>
    codigo.apiObtenerInicio({ repository: env.repo, reloj: () => '2026-11-20' })
  );

  const varRosa = inicio.variedades.find(v => v.grupo === 'Rosa');
  const partidaDest = varRosa.partidas.find(p => p.id_capa === capaDestino.id_capa);
  assert.ok(partidaDest, 'Debe aparecer la partida destino en su variedad');
  assert.ok(partidaDest.viene_de, 'Debe incluir viene_de');
  assert.strictEqual(partidaDest.viene_de.id_reproceso, rep.id_reproceso);
  assert.strictEqual(partidaDest.viene_de.origenes.length, 1);
  assert.strictEqual(partidaDest.viene_de.origenes[0].proveedor, 'FINCA SOLANA');
  assert.strictEqual(partidaDest.viene_de.origenes[0].fecha_capa, '2026-11-16');
  assert.strictEqual(partidaDest.viene_de.origenes[0].articulo, 'TOMATE ROSA GRANEL');
  assert.strictEqual(partidaDest.viene_de.origenes[0].cajas, 60);

  // Últimos movimientos: el reproceso aparece como UNA sola línea agrupada (sin líneas sueltas origen/destino)
  const cambiosUltimos = inicio.ultimos.filter(u => u.id === rep.id_reproceso);
  assert.strictEqual(cambiosUltimos.length, 1, 'Un cambio debe aparecer como una sola línea en ultimos');
  assert.strictEqual(cambiosUltimos[0].tipo, 'cambio');
  assert.strictEqual(cambiosUltimos[0].texto, 'TOMATE ROSA GRANEL → TOMATE ROSA 500');
  assert.strictEqual(cambiosUltimos[0].detalle, '60 → 86 · destrío 2');
  assert.ok(
    !inicio.ultimos.some(u => String(u.texto || '').includes('REPROCESO_ORIGEN') || String(u.texto || '').includes('REPROCESO_DESTINO')),
    'No debe haber líneas sueltas de origen/destino de reproceso'
  );

  // apiObtenerPartida sobre el ORIGEN trae se_convirtio_en
  const detalleOrigen = conContextoDePrueba_('Ana', 'CONSULTA', () =>
    codigo.apiObtenerPartida(capaOrigen.id_capa, { repository: env.repo })
  );
  assert.strictEqual(detalleOrigen.origen.tipo, 'COMPRA');
  assert.ok(Array.isArray(detalleOrigen.se_convirtio_en));
  assert.strictEqual(detalleOrigen.se_convirtio_en.length, 1);
  assert.strictEqual(detalleOrigen.se_convirtio_en[0].id_capa, capaDestino.id_capa);
  assert.strictEqual(detalleOrigen.se_convirtio_en[0].articulo, 'TOMATE ROSA 500');
  assert.strictEqual(detalleOrigen.se_convirtio_en[0].cajas, 86);
  assert.ok(detalleOrigen.consumos.some(c => c.tipo === 'REPROCESO' && c.cajas === 60));

  // apiObtenerPartida sobre el DESTINO trae origen.viene_de
  const detalleDest = conContextoDePrueba_('Ana', 'CONSULTA', () =>
    codigo.apiObtenerPartida(capaDestino.id_capa, { repository: env.repo })
  );
  assert.strictEqual(detalleDest.origen.tipo, 'REPROCESO');
  assert.strictEqual(detalleDest.origen.viene_de.id_reproceso, rep.id_reproceso);
  assert.strictEqual(detalleDest.origen.viene_de.origenes[0].cajas_restantes, 40);
});

// --------------------------------------------------------------------------
// 3. RENDIMIENTO CON 5.000 MOVIMIENTOS Y LECTURA MÁXIMO 2 VECES POR HOJA
// --------------------------------------------------------------------------
runTest('3. Rendimiento: con 5.000 movimientos apiObtenerInicio tarda < 2 s y lee cada hoja como mucho dos veces', () => {
  const env = crearEntorno();
  configurarCatalogo(env.repo);

  const hoy = '2026-11-20';
  const fechas = [];
  for (let i = 0; i < 30; i++) {
    const dt = new Date(Date.UTC(2026, 10, 20 - (29 - i)));
    fechas.push(dt.toISOString().slice(0, 10));
  }

  const movs = [];
  const capas = [];
  for (let i = 0; i < 5000; i++) {
    const fecha = fechas[i % 30];
    const esEntrada = (i % 2) === 0;
    const art = i % 3 === 0 ? 'TOMATE ROSA M' : (i % 3 === 1 ? 'TOMATE MORESCO G' : 'TOMATE OTRO');
    const envase = 'CARTON';
    movs.push({
      id_movimiento: `MOV-PERF-${i}`,
      fecha_hora: `${fecha}T10:00:00.000Z`,
      tipo_movimiento: esEntrada ? 'ENTRADA' : 'SALIDA',
      id_documento_ref: `DOC-PERF-${i}`,
      codigo_articulo: art,
      codigo_envase: envase,
      cajas: esEntrada ? 20 : 10,
      signo: esEntrada ? 1 : -1,
      partida_origen: '',
      motivo_ajuste: '',
      usuario: 'perf',
      observaciones: '',
      estado: 'CONFIRMADO',
      fecha_negocio: fecha,
      entidad_nombre: 'PROV PERF',
      secuencia: i + 1,
      origen_dato: 'CSV',
      kg_informativo: 100,
      id_movimiento_ref: '',
      id_capa_objetivo: '',
      id_capa_creada: esEntrada ? `CAPA-PERF-${i}` : ''
    });
    if (esEntrada && i >= 4900) {
      capas.push({
        id_capa: `CAPA-PERF-${i}`,
        id_movimiento_entrada: `MOV-PERF-${i}`,
        fecha_capa: fecha,
        codigo_articulo: art,
        codigo_envase: envase,
        cajas_iniciales: 20,
        cajas_consumidas: 10,
        cajas_restantes: 10,
        estado_capa: 'ACTIVA',
        partida: '',
        documento_ref: `DOC-${i}`,
        proveedor: 'PROV PERF',
        id_capa_origen: '',
        origen_dato: 'CSV'
      });
    }
  }
  env.repo.appendRecords('MOVIMIENTOS', movs);
  env.repo.saveCapasFifo(capas);

  // Contar lecturas por hoja en readTable
  const lecturas = {};
  const origReadTable = env.repo.readTable.bind(env.repo);
  env.repo.readTable = (sheetName) => {
    lecturas[sheetName] = (lecturas[sheetName] || 0) + 1;
    return origReadTable(sheetName);
  };

  const t0 = Date.now();
  const inicio = conContextoDePrueba_('Ana', 'CONSULTA', () =>
    codigo.apiObtenerInicio({ repository: env.repo, reloj: () => hoy })
  );
  const duracionMs = Date.now() - t0;

  assert.ok(duracionMs < 2000, `Demasiado lento: ${duracionMs} ms`);
  assert.strictEqual(inicio.total, capas.reduce((s, c) => s + c.cajas_restantes, 0));

  for (const [hoja, count] of Object.entries(lecturas)) {
    assert.ok(count <= 2, `La hoja '${hoja}' se leyó ${count} veces (debe ser <= 2)`);
  }
});

// --------------------------------------------------------------------------
// 4. ESTADO SIN STOCK DEVUELVE ESTRUCTURA VACÍA VÁLIDA
// --------------------------------------------------------------------------
runTest('4. Sin stock: apiObtenerInicio devuelve estructura vacía válida para pantalla vacía', () => {
  const env = crearEntorno();
  configurarCatalogo(env.repo);

  const inicio = conContextoDePrueba_('Ana', 'CONSULTA', () =>
    codigo.apiObtenerInicio({ repository: env.repo, reloj: () => '2026-11-20' })
  );

  assert.strictEqual(inicio.total, 0);
  assert.deepStrictEqual(inicio.variedades, []);
  assert.strictEqual(inicio.serie.length, 30);
  assert.ok(inicio.serie.every(p => p.stock === 0 && p.entradas === 0 && p.salidas === 0));
  assert.strictEqual(inicio.pendientes.total, 0);
  assert.strictEqual(inicio.destrio7, 0);
  assert.deepStrictEqual(inicio.importado_hasta, { compras: null, ventas: null });
  assert.deepStrictEqual(inicio.ultimos, []);
});

// --------------------------------------------------------------------------
// 5. SEGURIDAD T-020 Y COLUMNAS DE AGRUPACIONES
// --------------------------------------------------------------------------
runTest('5. APIs exigen sesión (T-020) y AGRUPACIONES tiene color, dias_aviso y stock_bajo', () => {
  assert.deepStrictEqual(SCHEMA_DEFINITIONS.AGRUPACIONES, [
    'agrupacion', 'orden', 'grupo', 'subgrupo', 'filtro', 'activo', 'color', 'dias_aviso', 'stock_bajo'
  ]);

  const env = crearEntorno();
  assert.throws(() => codigo.apiObtenerInicio({ repository: env.repo }), /Acceso no autorizado/);
  assert.throws(() => codigo.apiObtenerPartida('CAPA-1', { repository: env.repo }), /Acceso no autorizado/);
});

console.log('\n================================================================');
console.log(` RESULTADOS T-024 (INICIO): ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
