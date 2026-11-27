/**
 * STOCK-LIGHT — Test Suite T-029: parte de stock de la noche (servidor)
 *
 * Cubre los puntos de aceptación 1 a 6 de docs/tickets/T-029-parte-noche.md.
 * Ejecutable: node test/t029_parte_noche.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { crearEntorno } = require('./helpers/mockSheets');
const {
  ParteService,
  enviarParteDiario_,
  leerDestinatariosParte_,
  leerHoraParte_,
  normalizarDestinatariosParte_
} = require('../src/ParteService');
const { nombreLegible } = require('../src/NombresLegibles');
const { PERMISOS_API } = require('../src/Seguridad');
const codigo = require('../src/Código');

const SRC_DIR = path.resolve(__dirname, '../src');
const URL_IMPLEMENTACION = 'https://script.google.com/macros/s/PRUEBA_T029/exec';

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

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function crearInicioFalso(datos) {
  const inicio = JSON.parse(JSON.stringify(datos));
  const servicio = {
    llamadas: 0,
    repo: null,
    obtenerInicio: function () {
      servicio.llamadas++;
      return inicio;
    }
  };
  return servicio;
}

function crearInicioEjemplo() {
  return {
    fecha_referencia: '2026-11-26',
    total: 2522,
    variedades: [
      {
        grupo: 'MORESCO',
        cajas: 1337,
        sale_primero: '2026-11-10',
        dias: 16,
        partidas: [
          { articulo: 'TOMATE MORESCO I M', envase: 'CARTÓN 40X30', cajas: 227 },
          { articulo: 'TOMATE MORESCO I GG', envase: 'CARTÓN 40X30', cajas: 686 },
          { articulo: 'TOMATE MORESCO I G', envase: 'CARTÓN 40X30', cajas: 424 }
        ]
      },
      {
        grupo: 'RAMA',
        cajas: 352,
        sale_primero: '2026-11-20',
        dias: 6,
        partidas: [
          { articulo: 'TOMATE RAMA EXTRA G', envase: 'CAJA', cajas: 352 }
        ]
      },
      {
        grupo: 'CARTÓN',
        cajas: 833,
        sale_primero: '2026-11-22',
        dias: 4,
        partidas: [
          { articulo: 'TOMATE CARTÓN I', envase: 'CAJA', cajas: 833 }
        ]
      },
      {
        grupo: 'VACÍA',
        cajas: 0,
        sale_primero: '',
        dias: 0,
        partidas: []
      }
    ],
    pendientes: {
      total: 2,
      totalDocumentos: 2,
      totalFilas: 2,
      porMotivo: { STOCK_INSUFICIENTE: 2 },
      filasPorMotivo: { STOCK_INSUFICIENTE: 2 }
    },
    importado_hasta: { compras: '2026-11-26', ventas: '2026-11-26' }
  };
}

function crearProperties(valores = {}) {
  const store = Object.assign({}, valores);
  return {
    getProperty: (clave) => (Object.prototype.hasOwnProperty.call(store, clave) ? store[clave] : null),
    setProperty: (clave, valor) => { store[clave] = String(valor); },
    _store: store
  };
}

function sesionPropietario() {
  return {
    getActiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' }),
    getEffectiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' })
  };
}

function crearScriptAppFalso() {
  const triggers = [];
  return {
    triggers,
    getProjectTriggers: () => triggers.slice(),
    newTrigger: (handler) => ({
      timeBased: () => ({
        atHour: (hora) => ({
          everyDays: () => ({
            create: () => {
              triggers.push({
                getHandlerFunction: () => handler,
                _hora: hora
              });
            }
          })
        })
      })
    }),
    deleteTrigger: (trigger) => {
      const indice = triggers.indexOf(trigger);
      if (indice >= 0) triggers.splice(indice, 1);
    }
  };
}

/**
 * Carga el nombreLegible del cliente desde src/ui/app.html, igual que T-024.
 */
function cargarNombreLegibleCliente() {
  const appHtml = fs.readFileSync(path.join(SRC_DIR, 'ui', 'app.html'), 'utf8');
  const match = appHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match && match[1], 'src/ui/app.html debe contener un bloque <script>');

  const sandbox = {
    window: {
      innerWidth: 1440,
      addEventListener: () => {}
    },
    document: {
      readyState: 'loading',
      body: {
        classList: {
          toggle: () => {},
          contains: () => false
        }
      },
      addEventListener: () => {},
      getElementById: () => null,
      querySelectorAll: () => []
    },
    navigator: { onLine: true },
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox);
  return sandbox.window.SLApp.nombreLegible;
}

function extraerCajasDeLinea(linea) {
  const partes = String(linea || '').split(' · ');
  return partes.reduce((total, parte) => {
    const match = /(\d[\d.]*)\s*$/.exec(parte.trim());
    if (!match) return total;
    return total + Number(match[1].replace(/\./g, ''));
  }, 0);
}

console.log('\n================================================================');
console.log(' TEST SUITE T-029 — PARTE DE STOCK DE LA NOCHE');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// Aceptación 1: coherencia con obtenerInicio()
// ---------------------------------------------------------------------------

runTest('1. El total y las cajas de cada variedad coinciden con obtenerInicio() y el desglose suma', () => {
  const inicio = crearInicioEjemplo();
  const inicioService = crearInicioFalso(inicio);
  const servicio = new ParteService({
    inicioService,
    clock: () => new Date('2026-11-26T20:00:00Z')
  });

  const parte = servicio.generarParte();
  assert.strictEqual(inicioService.llamadas, 1, 'Debe llamar a obtenerInicio() una sola vez');
  assert.strictEqual(parte.datos.total, inicio.total);
  assert.strictEqual(parte.fecha, '26/11');
  assert.strictEqual(parte.hora, '21:00');
  assert.ok(parte.texto.includes(`Total: 2.522 cajas`));

  const lineas = parte.texto.split('\n');
  for (const variedad of inicio.variedades) {
    if (Number(variedad.cajas) <= 0) continue;
    const cabecera = lineas.find(linea => linea.startsWith(`${variedad.grupo} · `));
    assert.ok(cabecera, `Falta la variedad ${variedad.grupo}`);
    const cajasCabecera = Number(cabecera.split(' · ')[1].replace(/\./g, ''));
    assert.strictEqual(cajasCabecera, Number(variedad.cajas), `Cajas de ${variedad.grupo}`);

    const posicion = lineas.indexOf(cabecera);
    const desglose = lineas[posicion + 1] || '';
    assert.strictEqual(
      extraerCajasDeLinea(desglose),
      Number(variedad.cajas),
      `El desglose de ${variedad.grupo} debe sumar sus cajas`
    );
  }
});

// ---------------------------------------------------------------------------
// Aceptación 2: formato del texto
// ---------------------------------------------------------------------------

runTest('2. Formato: miles, orden, sin variedades vacías, pendientes condicionales e importado siempre', () => {
  const inicio = crearInicioEjemplo();
  const servicio = new ParteService({
    inicioService: crearInicioFalso(inicio),
    clock: () => new Date('2026-11-26T20:00:00Z')
  });
  const parte = servicio.generarParte();
  const lineas = parte.texto.split('\n');

  assert.strictEqual(lineas[0], 'STOCK · 26/11 · 21:00');
  assert.strictEqual(lineas[1], 'Total: 2.522 cajas');
  assert.ok(parte.texto.includes('MORESCO · 1.337'));
  assert.ok(parte.texto.includes('RAMA · 352'));
  assert.ok(!parte.texto.includes('VACÍA'), 'Las variedades sin stock no salen');

  const posMoresco = lineas.indexOf('MORESCO · 1.337');
  assert.ok(posMoresco >= 0);
  assert.strictEqual(
    lineas[posMoresco + 1],
    'I GG Cartón 40x30 686 · I G Cartón 40x30 424 · I M Cartón 40x30 227',
    'El desglose debe ir de mayor a menor'
  );
  assert.strictEqual(lineas[posMoresco + 2], 'Sale primero: 10/11 (16 días)');
  assert.ok(parte.texto.includes('Pendientes: 2 ventas sin stock · Importado hasta: C 26/11 · V 26/11'));

  // Sin pendientes: no aparece el bloque, pero sí «Importado hasta».
  const sinPendientes = crearInicioEjemplo();
  sinPendientes.pendientes = { total: 0, totalDocumentos: 0, totalFilas: 0, porMotivo: {}, filasPorMotivo: {} };
  const servicioSin = new ParteService({
    inicioService: crearInicioFalso(sinPendientes),
    clock: () => new Date('2026-11-26T20:00:00Z')
  });
  const parteSin = servicioSin.generarParte();
  assert.ok(!parteSin.texto.includes('Pendientes:'), 'Sin pendientes no debe aparecer el bloque');
  assert.ok(parteSin.texto.includes('Importado hasta: C 26/11 · V 26/11'));

  // Sin importaciones: el bloque sigue apareciendo con guiones.
  const sinImportado = crearInicioEjemplo();
  sinImportado.importado_hasta = { compras: null, ventas: null };
  const servicioSinImportado = new ParteService({ inicioService: crearInicioFalso(sinImportado) });
  assert.ok(servicioSinImportado.generarParte().texto.includes('Importado hasta: C — · V —'));

  assert.ok(parte.html.includes('<table'), 'El HTML debe llevar tabla');
  assert.ok(parte.html.includes('Total: <strong>2.522 cajas</strong>'));
  assert.ok(parte.html.includes('MORESCO'));
  assert.ok(parte.html.includes('I GG'));
  assert.ok(parte.html.includes('Pendientes: 2 ventas sin stock'));
  assert.ok(parte.html.includes('Importado hasta: C 26/11 · V 26/11'));
  assert.ok(parte.html.includes('style="'), 'El HTML debe usar estilos en línea');
  assert.ok(!/<img\b/i.test(parte.html), 'El HTML no debe tener imágenes');
});

// ---------------------------------------------------------------------------
// Aceptación 3: nombres legibles servidor/cliente
// ---------------------------------------------------------------------------

runTest('3. Los 6 ejemplos de nombreLegible dan lo mismo en servidor que en cliente', () => {
  const nombreLegibleCliente = cargarNombreLegibleCliente();
  const casos = [
    ['TOMATE VOLLEY II M · MADERA 50X30', 'Volley II M · Madera 50x30'],
    ['TOMATE MORESCO I GG · CARTÓN 40X30', 'Moresco I GG · Cartón 40x30'],
    ['TOMATE ROSA GRANEL MMM · EPS 106 9X500', 'Rosa Granel MMM · EPS 106 9x500'],
    ['TOMATE RAMA EXTRA G · POOL 60X40', 'Rama Extra G · POOL 60x40'],
    ['TOMATE COCKTAIL II MM · IFCO 8X300', 'Cocktail II MM · IFCO 8x300'],
    ['TOMATE PERA I GGG → TOMATE ROSA 500G', 'Pera I GGG → Rosa 500g']
  ];

  for (const [entrada, esperado] of casos) {
    assert.strictEqual(nombreLegible(entrada), esperado, `Servidor: '${entrada}'`);
    assert.strictEqual(nombreLegibleCliente(entrada), esperado, `Cliente: '${entrada}'`);
    assert.strictEqual(nombreLegible(entrada), nombreLegibleCliente(entrada), `Servidor y cliente difieren en '${entrada}'`);
  }
});

// ---------------------------------------------------------------------------
// Aceptación 4: correo y disparador
// ---------------------------------------------------------------------------

runTest('4. Correo con MailApp simulado, sin destinatarios, fallo y disparador idempotente', () => {
  const env = crearEntorno();
  const inicioService = crearInicioFalso(crearInicioEjemplo());
  inicioService.repo = env.repo;
  const parteService = new ParteService({
    inicioService,
    clock: () => new Date('2026-11-26T20:00:00Z')
  });

  const props = crearProperties({
    PARTE_DESTINATARIOS: 'uno@ficticio.test, dos@ficticio.test',
    PARTE_HORA: '21'
  });
  assert.deepStrictEqual(leerDestinatariosParte_({ propertiesService: props }), ['uno@ficticio.test', 'dos@ficticio.test']);
  assert.strictEqual(leerHoraParte_({ propertiesService: props }), 21);
  assert.deepStrictEqual(normalizarDestinatariosParte_(' a@test, ,b@test '), ['a@test', 'b@test']);

  const enviados = [];
  const mailApp = { sendEmail: (opciones) => { enviados.push(opciones); } };
  const resultado = enviarParteDiario_({
    parteService,
    propertiesService: props,
    mailApp,
    repository: env.repo,
    usuario: 'prueba@ficticio.test'
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].to, 'uno@ficticio.test,dos@ficticio.test');
  assert.strictEqual(enviados[0].subject, 'Stock 26/11 · 2.522 cajas');
  assert.ok(enviados[0].body.includes('STOCK · 26/11 · 21:00'));
  assert.ok(enviados[0].htmlBody.includes('<table'));

  // Sin destinatarios: no envía y registra en LOG_OPERACIONES.
  const propsVacios = crearProperties({});
  const enviadosVacios = [];
  const sinDestinatarios = enviarParteDiario_({
    parteService,
    propertiesService: propsVacios,
    mailApp: { sendEmail: (opciones) => { enviadosVacios.push(opciones); } },
    repository: env.repo,
    usuario: 'prueba@ficticio.test'
  });
  assert.strictEqual(sinDestinatarios.ok, false);
  assert.strictEqual(sinDestinatarios.motivo, 'SIN_DESTINATARIOS');
  assert.strictEqual(enviadosVacios.length, 0);
  const logSin = env.repo.getLogOperaciones().find(log => log.motivo === 'SIN_DESTINATARIOS');
  assert.ok(logSin, 'Debe registrar la falta de destinatarios');
  assert.strictEqual(logSin.operacion, 'PARTE_DIARIO');

  // Fallo de MailApp: no lanza y queda registrado.
  const fallo = enviarParteDiario_({
    parteService,
    propertiesService: props,
    mailApp: { sendEmail: () => { throw new Error('SMTP caído'); } },
    repository: env.repo,
    usuario: 'prueba@ficticio.test'
  });
  assert.strictEqual(fallo.ok, false);
  assert.strictEqual(fallo.motivo, 'ERROR_ENVIO');
  const logError = env.repo.getLogOperaciones().find(log => log.motivo === 'ERROR_ENVIO');
  assert.ok(logError, 'Debe registrar el fallo de envío');
  assert.ok(String(logError.observaciones).includes('SMTP caído'));

  // Disparador idempotente.
  const scriptApp = crearScriptAppFalso();
  const propsHora = crearProperties({ PARTE_HORA: '22' });
  const opcionesAdmin = { scriptApp, propertiesService: propsHora, session: sesionPropietario() };
  codigo.adminInstalarParteDiario(opcionesAdmin);
  codigo.adminInstalarParteDiario(opcionesAdmin);
  assert.strictEqual(scriptApp.triggers.length, 1, 'Dos instalaciones dejan un solo disparador');
  assert.strictEqual(scriptApp.triggers[0].getHandlerFunction(), 'enviarParteDiario_');
  assert.strictEqual(scriptApp.triggers[0]._hora, 22);

  // Configuración de destinatarios y hora.
  const config = codigo.adminConfigurarParte('uno@ficticio.test, dos@ficticio.test', 22, {
    propertiesService: propsHora,
    session: sesionPropietario()
  });
  assert.deepStrictEqual(config.destinatarios, ['uno@ficticio.test', 'dos@ficticio.test']);
  assert.strictEqual(config.hora, 22);
  assert.strictEqual(propsHora.getProperty('PARTE_DESTINATARIOS'), 'uno@ficticio.test,dos@ficticio.test');
  assert.strictEqual(propsHora.getProperty('PARTE_HORA'), '22');
});

// ---------------------------------------------------------------------------
// Aceptación 5: API y guardas de administración
// ---------------------------------------------------------------------------

runTest('5. apiObtenerParte exige sesión y las funciones admin exigen al propietario', () => {
  assert.strictEqual(PERMISOS_API.apiObtenerParte, 'CONSULTA');
  assert.throws(
    () => codigo.apiObtenerParte(),
    (err) => err instanceof Error && err.message === 'Acceso no autorizado'
  );

  assert.throws(
    () => codigo.adminConfigurarParte('x@ficticio.test', 21),
    /Operación reservada al administrador/
  );
  assert.throws(
    () => codigo.adminInstalarParteDiario(),
    /Operación reservada al administrador/
  );
  assert.throws(
    () => codigo.adminEnviarParteAhora(),
    /Operación reservada al administrador/
  );

  const documento = fs.readFileSync(path.join(__dirname, '..', 'docs', 'API_PUBLICA.md'), 'utf8');
  assert.ok(documento.includes('`apiObtenerParte`'));
  assert.ok(documento.includes('`adminConfigurarParte`'));
  assert.ok(documento.includes('`adminInstalarParteDiario`'));
  assert.ok(documento.includes('`adminEnviarParteAhora`'));
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-029: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
