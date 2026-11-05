/**
 * STOCK-LIGHT — Test Suite de Propiedades: T-022 Libro de Solo Añadir
 * Ejecutable con Node.js: `node test/t022_propiedades.test.js`
 *
 * Aceptación 2 de T-022:
 * 200 operaciones aleatorias con semilla fija, mezclando entradas, salidas, ajustes ±,
 * anulaciones, correcciones al alza y a la baja, división y reclasificación.
 * Tras CADA operación, `comprobarConsistencia()` devuelve 0 diferencias.
 * Si falla, la prueba imprime la semilla y el número de operación.
 */

const assert = require('assert');
const { crearEntorno } = require('./helpers/mockSheets');

console.log('================================================================');
console.log(' TEST SUITE T-022 — PROPIEDADES (200 OPERACIONES CON SEMILLA FIJA)');
console.log('================================================================\n');

/**
 * Generador pseudoaleatorio determinista Mulberry32.
 * @param {number} seed
 */
function crearPrng(seed) {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    pick(arr) {
      if (!arr || arr.length === 0) return null;
      return arr[this.int(0, arr.length - 1)];
    }
  };
}

const SEED = 20261104;
const TOTAL_OPERACIONES = 200;

const ARTICULOS = ['ART-ALPHA', 'ART-BETA', 'ART-GAMMA'];
const ENVASES = ['ENV-CAJA-A', 'ENV-CAJA-B', 'ENV-CAJA-C'];
const PROVEEDORES = ['PROVEEDOR NORTE', 'PROVEEDOR SUR', 'COOPERATIVA CENTRAL'];
const CLIENTES = ['CLIENTE UNO', 'CLIENTE DOS', 'CLIENTE TRES'];

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
      console.error(err.stack.split('\n').slice(1, 5).join('\n'));
    }
    failed++;
  }
}

runTest(`1. 200 operaciones aleatorias (semilla=${SEED}): comprobarConsistencia() devuelve 0 diferencias tras CADA operación`, () => {
  const rng = crearPrng(SEED);
  const env = crearEntorno();

  // Sembrar algunas entradas iniciales para que haya stock variado desde el principio
  let docCounter = 1;
  const entradasRegistradas = []; // [{ serie, numero, id_documento }]
  const salidasRegistradas = [];  // [{ serie, numero, id_documento, anulada }]

  const contadoresTipo = {
    ENTRADA: 0,
    SALIDA: 0,
    AJUSTE_POS: 0,
    AJUSTE_NEG: 0,
    ANULAR_ENTRADA: 0,
    ANULAR_SALIDA: 0,
    CORR_SALIDA_BAJA: 0,
    CORR_SALIDA_ALZA: 0,
    CORR_ENTRADA_BAJA: 0,
    CORR_ENTRADA_ALZA: 0,
    DIVIDIR_CAPA: 0,
    RECLASIFICACION: 0
  };

  for (let opIdx = 1; opIdx <= TOTAL_OPERACIONES; opIdx++) {
    const dia = String(rng.int(1, 28)).padStart(2, '0');
    const fechaOp = `2026-10-${dia}`;
    let descripcionOp = '';

    try {
      const capasActuales = env.repo.getCapasFifo();
      const stockActualList = env.repo.getStockActual();
      const stockMap = {};
      for (const s of stockActualList) {
        stockMap[s.stock_key] = Number(s.cajas_actuales || 0);
      }

      const clavesConStock = Object.keys(stockMap).filter(k => stockMap[k] >= 10);
      const capasSinConsumoActivas = capasActuales.filter(
        c => c.estado_capa === 'ACTIVA' && Number(c.cajas_consumidas || 0) === 0 && Number(c.cajas_restantes || 0) > 0 && c.documento_ref && c.documento_ref.startsWith('ENT/')
      );
      const capasActivasConSaldo = capasActuales.filter(
        c => c.estado_capa === 'ACTIVA' && Number(c.cajas_restantes || 0) >= 15
      );
      const salidasVivas = salidasRegistradas.filter(s => !s.anulada);

      // En las primeras 15 operaciones forzamos variedad o seguimos probabilidades ponderadas
      let tipoOp = '';
      if (opIdx <= 5 || clavesConStock.length === 0) {
        tipoOp = 'ENTRADA';
      } else {
        const candidatos = ['ENTRADA', 'SALIDA', 'AJUSTE_POS', 'AJUSTE_NEG', 'RECLASIFICACION'];
        if (capasSinConsumoActivas.length > 0) candidatos.push('ANULAR_ENTRADA');
        if (salidasVivas.length > 0) {
          candidatos.push('ANULAR_SALIDA', 'CORR_SALIDA_BAJA', 'CORR_SALIDA_ALZA');
        }
        if (capasActivasConSaldo.length > 0) {
          candidatos.push('CORR_ENTRADA_BAJA', 'CORR_ENTRADA_ALZA', 'DIVIDIR_CAPA');
        }
        tipoOp = rng.pick(candidatos);
      }

      if (tipoOp === 'ENTRADA') {
        const art = rng.pick(ARTICULOS);
        const envase = rng.pick(ENVASES);
        const cajas = rng.int(40, 150);
        const num = String(docCounter++);
        const idDoc = `DOC-E-${num}`;
        descripcionOp = `ENTRADA ENT/${num} (${art}|${envase}, ${cajas} cajas, fecha=${fechaOp})`;

        const res = env.movService.registrarEntrada({
          id_documento: idDoc,
          tipo_documento: 'COMPRA',
          serie: 'ENT',
          numero: num,
          fecha_documento: fechaOp,
          entidad_nombre: rng.pick(PROVEEDORES)
        }, [
          { codigo_articulo: art, codigo_envase: envase, cajas, partida: `P-${num}` }
        ], 'prop@test');
        assert.strictEqual(res.success, true);
        entradasRegistradas.push({ serie: 'ENT', numero: num, id_documento: idDoc });
        contadoresTipo.ENTRADA++;
      } else if (tipoOp === 'SALIDA') {
        const key = rng.pick(clavesConStock);
        const [art, envase] = key.split('|');
        const disp = stockMap[key];
        const cajas = rng.int(5, Math.min(45, disp));
        const num = String(docCounter++);
        const idDoc = `DOC-S-${num}`;
        descripcionOp = `SALIDA SAL/${num} (${key}, ${cajas} cajas, fecha=${fechaOp})`;

        const res = env.movService.registrarSalida({
          id_documento: idDoc,
          tipo_documento: 'SALIDA',
          serie: 'SAL',
          numero: num,
          fecha_documento: fechaOp,
          entidad_nombre: rng.pick(CLIENTES)
        }, [
          { codigo_articulo: art, codigo_envase: envase, cajas }
        ], 'prop@test');
        assert.strictEqual(res.success, true);
        salidasRegistradas.push({ serie: 'SAL', numero: num, id_documento: idDoc, key, cajasActuales: cajas, anulada: false });
        contadoresTipo.SALIDA++;
      } else if (tipoOp === 'AJUSTE_POS') {
        const art = rng.pick(ARTICULOS);
        const envase = rng.pick(ENVASES);
        const cajas = rng.int(10, 60);
        descripcionOp = `AJUSTE_POS (${art}|${envase}, +${cajas})`;

        const res = env.movService.registrarAjuste({
          codigo_articulo: art,
          codigo_envase: envase,
          cajas,
          signo: 1,
          motivo: 'DIFERENCIA_INVENTARIO',
          observaciones: `Ajuste positivo op ${opIdx}`,
          fecha: fechaOp,
          entidad_nombre: rng.pick(PROVEEDORES)
        }, 'prop@test');
        assert.strictEqual(res.success, true);
        contadoresTipo.AJUSTE_POS++;
      } else if (tipoOp === 'AJUSTE_NEG') {
        const key = rng.pick(clavesConStock);
        const [art, envase] = key.split('|');
        const disp = stockMap[key];
        const cajas = rng.int(1, Math.min(20, disp));
        descripcionOp = `AJUSTE_NEG (${key}, -${cajas})`;

        const res = env.movService.registrarAjuste({
          codigo_articulo: art,
          codigo_envase: envase,
          cajas,
          signo: -1,
          motivo: 'MERMA',
          observaciones: `Ajuste negativo op ${opIdx}`,
          fecha: fechaOp
        }, 'prop@test');
        assert.strictEqual(res.success, true);
        contadoresTipo.AJUSTE_NEG++;
      } else if (tipoOp === 'ANULAR_ENTRADA') {
        const capa = rng.pick(capasSinConsumoActivas);
        descripcionOp = `ANULAR_ENTRADA (id_capa=${capa.id_capa}, doc=${capa.documento_ref})`;

        const res = env.movService.anularEntrada({
          id_capa: capa.id_capa,
          motivo: 'Error documental'
        }, 'prop@test');
        assert.strictEqual(res.success, true);
        contadoresTipo.ANULAR_ENTRADA++;
      } else if (tipoOp === 'ANULAR_SALIDA') {
        const sal = rng.pick(salidasVivas);
        descripcionOp = `ANULAR_SALIDA (${sal.serie}/${sal.numero})`;

        const res = env.movService.anularSalida({
          serie: sal.serie,
          numero: sal.numero,
          motivo: 'Cancelación pedido'
        }, 'prop@test');
        assert.strictEqual(res.success, true);
        sal.anulada = true;
        contadoresTipo.ANULAR_SALIDA++;
      } else if (tipoOp === 'CORR_SALIDA_BAJA') {
        const candidatasBaja = salidasVivas.filter(s => s.cajasActuales > 2);
        if (candidatasBaja.length > 0) {
          const sal = rng.pick(candidatasBaja);
          const reduccion = rng.int(1, Math.max(1, Math.floor(sal.cajasActuales / 2)));
          const nuevaCant = sal.cajasActuales - reduccion;
          descripcionOp = `CORR_SALIDA_BAJA (${sal.serie}/${sal.numero}: ${sal.cajasActuales} -> ${nuevaCant})`;

          const res = env.movService.corregirCantidadSalida({
            serie: sal.serie,
            numero: sal.numero,
            nuevaCantidad: nuevaCant,
            motivo: 'Menos cajas cargadas'
          }, 'prop@test');
          assert.strictEqual(res.success, true);
          sal.cajasActuales = nuevaCant;
          contadoresTipo.CORR_SALIDA_BAJA++;
        } else {
          // Fallback a ajuste positivo
          const art = rng.pick(ARTICULOS);
          const envase = rng.pick(ENVASES);
          env.movService.registrarAjustePositivo({ codigo_articulo: art, codigo_envase: envase, cajas: 15, fecha: fechaOp }, 'prop@test');
          contadoresTipo.AJUSTE_POS++;
        }
      } else if (tipoOp === 'CORR_SALIDA_ALZA') {
        const sal = rng.pick(salidasVivas);
        const disp = stockMap[sal.key] || 0;
        if (disp >= 5) {
          const aumento = rng.int(1, Math.min(15, disp));
          const nuevaCant = sal.cajasActuales + aumento;
          descripcionOp = `CORR_SALIDA_ALZA (${sal.serie}/${sal.numero}: ${sal.cajasActuales} -> ${nuevaCant})`;

          const res = env.movService.corregirCantidadSalida({
            serie: sal.serie,
            numero: sal.numero,
            nuevaCantidad: nuevaCant,
            motivo: 'Más cajas cargadas'
          }, 'prop@test');
          assert.strictEqual(res.success, true);
          sal.cajasActuales = nuevaCant;
          contadoresTipo.CORR_SALIDA_ALZA++;
        } else {
          const art = rng.pick(ARTICULOS);
          const envase = rng.pick(ENVASES);
          env.movService.registrarAjustePositivo({ codigo_articulo: art, codigo_envase: envase, cajas: 20, fecha: fechaOp }, 'prop@test');
          contadoresTipo.AJUSTE_POS++;
        }
      } else if (tipoOp === 'CORR_ENTRADA_BAJA') {
        const capa = rng.pick(capasActivasConSaldo);
        const allMovs = env.repo.getMovimientos();
        const cantEfectiva = env.movService._calcularCantidadEfectivaEntrada(capa, allMovs);
        const maxReduccion = Math.min(10, Number(capa.cajas_restantes) - 1);
        if (maxReduccion >= 1 && cantEfectiva > maxReduccion) {
          const reduccion = rng.int(1, maxReduccion);
          const nuevaCant = cantEfectiva - reduccion;
          descripcionOp = `CORR_ENTRADA_BAJA (id_capa=${capa.id_capa}: ${cantEfectiva} -> ${nuevaCant})`;

          const res = env.movService.corregirCantidadEntrada({
            id_capa: capa.id_capa,
            nuevaCantidad: nuevaCant,
            motivo: 'Reducción entrada'
          }, 'prop@test');
          assert.strictEqual(res.success, true);
          contadoresTipo.CORR_ENTRADA_BAJA++;
        } else {
          const art = rng.pick(ARTICULOS);
          const envase = rng.pick(ENVASES);
          env.movService.registrarAjustePositivo({ codigo_articulo: art, codigo_envase: envase, cajas: 15, fecha: fechaOp }, 'prop@test');
          contadoresTipo.AJUSTE_POS++;
        }
      } else if (tipoOp === 'CORR_ENTRADA_ALZA') {
        const capa = rng.pick(capasActivasConSaldo);
        const allMovs = env.repo.getMovimientos();
        const cantEfectiva = env.movService._calcularCantidadEfectivaEntrada(capa, allMovs);
        const aumento = rng.int(5, 25);
        const nuevaCant = cantEfectiva + aumento;
        descripcionOp = `CORR_ENTRADA_ALZA (id_capa=${capa.id_capa}: ${cantEfectiva} -> ${nuevaCant})`;

        const res = env.movService.corregirCantidadEntrada({
          id_capa: capa.id_capa,
          nuevaCantidad: nuevaCant,
          motivo: 'Aumento entrada'
        }, 'prop@test');
        assert.strictEqual(res.success, true);
        contadoresTipo.CORR_ENTRADA_ALZA++;
      } else if (tipoOp === 'DIVIDIR_CAPA') {
        const capa = rng.pick(capasActivasConSaldo);
        const consumidas = Number(capa.cajas_consumidas || 0);
        const restantes = Number(capa.cajas_restantes || 0);
        const totalActual = consumidas + restantes;
        const transferir = rng.int(5, Math.min(20, restantes - 1));
        const quedanOrig = totalActual - transferir;

        const otrosArticulos = ARTICULOS.filter(a => a !== capa.codigo_articulo);
        const artDest = rng.pick(otrosArticulos);
        descripcionOp = `DIVIDIR_CAPA (id_capa=${capa.id_capa}, total=${totalActual} -> ${quedanOrig} orig + ${transferir} ${artDest})`;

        const res = env.movService.dividirCapaEntrada({
          id_capa: capa.id_capa,
          divisiones: [
            { codigo_articulo: capa.codigo_articulo, codigo_envase: capa.codigo_envase, cajas: quedanOrig, partida: capa.partida },
            { codigo_articulo: artDest, codigo_envase: capa.codigo_envase, cajas: transferir, partida: `${capa.partida}-DIV` }
          ],
          motivo: 'División lote'
        }, 'prop@test');
        assert.strictEqual(res.success, true);
        contadoresTipo.DIVIDIR_CAPA++;
      } else if (tipoOp === 'RECLASIFICACION') {
        const keyOrigen = rng.pick(clavesConStock);
        const [artOrig, envOrig] = keyOrigen.split('|');
        const otrosEnvases = ENVASES.filter(e => e !== envOrig);
        const envDest = rng.pick(otrosEnvases);
        const disp = stockMap[keyOrigen];
        const cajas = rng.int(2, Math.min(20, disp));
        descripcionOp = `RECLASIFICACION (${artOrig}|${envOrig} -> ${artOrig}|${envDest}, ${cajas} cajas)`;

        const res = env.movService.registrarReclasificacion({
          codigo_articulo_origen: artOrig,
          codigo_envase_origen: envOrig,
          codigo_articulo_destino: artOrig,
          codigo_envase_destino: envDest,
          cajas,
          motivo: 'RECLASIFICACION_ALEATORIA'
        }, 'prop@test');
        assert.strictEqual(res.success, true);
        contadoresTipo.RECLASIFICACION++;
      }

      // INVARIANTE TRAS CADA OPERACIÓN: comprobarConsistencia() === 0 diferencias
      const check = env.movService.comprobarConsistencia();
      if (!check.consistente || check.totalDiferencias > 0) {
        console.error(`\n[FALLO DE PROPIEDAD] Semilla=${SEED}, Operación #${opIdx}: ${descripcionOp}`);
        console.error('Diferencias en capas:', JSON.stringify(check.diferenciasCapas, null, 2));
        console.error('Diferencias en stock:', JSON.stringify(check.diferenciasStock, null, 2));
        assert.fail(`Inconsistencia en semilla=${SEED}, operación #${opIdx} (${descripcionOp}): ${check.totalDiferencias} diferencias`);
      }
    } catch (err) {
      console.error(`\n[EXCEPCIÓN EN PROPIEDAD] Semilla=${SEED}, Operación #${opIdx}: ${descripcionOp}`);
      throw new Error(`Fallo en semilla=${SEED}, operación #${opIdx} (${descripcionOp}): ${err.message}`);
    }
  }

  // Verificar que todas las familias de operaciones se ejercitaron durante las 200 operaciones
  for (const [k, count] of Object.entries(contadoresTipo)) {
    assert.ok(count > 0, `El tipo de operación ${k} debe haberse ejecutado al menos una vez en las 200 operaciones`);
  }
});

console.log('\n================================================================');
console.log(` RESULTADOS T-022 PROPIEDADES: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
