/**
 * STOCK-LIGHT — Test Suite T-018: Copias de seguridad
 *
 * Verifica:
 * 1. seleccionarCopiasABorrar conserva 30 DIARIA y no toca MANUAL.
 * 2. El nombre de la copia usa Europe/Madrid.
 * 3. adminInstalarCopiaDiaria es idempotente.
 * 4. Las funciones admin* exigen propietario (T-023).
 * 5. Creación manual y registro en LOG_OPERACIONES.
 * 6. La copia diaria no lanza si falla y deja el error en el log.
 * 7. Retención real sobre una carpeta simulada.
 * 8. docs/API_PUBLICA.md clasifica las funciones nuevas.
 *
 * Ejecutable: node test/t018_copias.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const codigo = require('../src/Código');
const backup = require('../src/BackupService');
const { crearEntorno } = require('./helpers/mockSheets');

const MENSAJE_ADMIN = 'Operación reservada al administrador';

const SESIONES = {
  propietario: {
    getActiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' }),
    getEffectiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' })
  },
  visitante: {
    getActiveUser: () => ({ getEmail: () => '' }),
    getEffectiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' })
  }
};

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

function crearArchivo(id, nombre, fecha) {
  return {
    id,
    nombre,
    fecha,
    trashed: false,
    getId() { return this.id; },
    getName() { return this.nombre; },
    getDateCreated() { return this.fecha; },
    setTrashed(valor) { this.trashed = valor; }
  };
}

/**
 * Crea un entorno de prueba con dobles de DriveApp, ScriptApp y PropertiesService.
 * No toca Google Drive ni Google Sheets reales.
 */
function crearMocks(opciones = {}) {
  const entorno = crearEntorno();
  const store = {
    SPREADSHEET_ID: 'SS_PRINCIPAL',
    BACKUP_FOLDER_ID: 'CARPETA_COPIAS'
  };
  if (opciones.sinCarpeta) delete store.BACKUP_FOLDER_ID;

  const propertiesService = {
    getProperty: (clave) => (Object.prototype.hasOwnProperty.call(store, clave) ? store[clave] : null),
    setProperty: (clave, valor) => { store[clave] = String(valor); }
  };

  const carpeta = {
    archivos: [],
    getFiles() {
      let indice = 0;
      const lista = carpeta.archivos.slice();
      return {
        hasNext: () => indice < lista.length,
        next: () => lista[indice++]
      };
    }
  };

  const archivos = new Map();
  let contador = 0;

  function registrarArchivo(id, nombre, fecha, destino) {
    const archivo = crearArchivo(id, nombre, fecha);
    archivos.set(id, archivo);
    if (destino) destino.archivos.push(archivo);
    return archivo;
  }

  // Copias previas para probar la retención.
  if (opciones.copiasPrevias) {
    for (let i = 0; i < opciones.copiasPrevias; i++) {
      const fecha = new Date(Date.UTC(2020, 0, 1 + i));
      registrarArchivo('VIEJA_' + i, `STOCK-LIGHT_COPIA_2020-01-${String(i + 1).padStart(2, '0')}_0100_DIARIA`, fecha, carpeta);
    }
  }

  const driveApp = {
    getFolderById: (id) => {
      if (id !== 'CARPETA_COPIAS') throw new Error(`Carpeta no encontrada: ${id}`);
      return carpeta;
    },
    getFileById: (id) => {
      if (id === 'SS_PRINCIPAL') {
        return {
          makeCopy: (nombre, destino) => {
            contador++;
            return registrarArchivo('COPIA_' + contador, nombre, new Date(), destino);
          }
        };
      }
      return archivos.get(id) || null;
    }
  };

  const triggers = [];
  const scriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (trigger) => {
      const indice = triggers.indexOf(trigger);
      if (indice >= 0) triggers.splice(indice, 1);
    },
    newTrigger: (handler) => ({
      timeBased: () => ({
        atHour: (hora) => ({
          everyDays: (dias) => ({
            create: () => {
              const trigger = { handler, hora, dias, getHandlerFunction: () => handler };
              triggers.push(trigger);
              return trigger;
            }
          })
        })
      })
    })
  };

  return {
    entorno,
    store,
    propertiesService,
    carpeta,
    archivos,
    driveApp,
    scriptApp,
    triggers,
    spreadsheet: { getId: () => 'SS_PRINCIPAL', getSheetByName: () => null }
  };
}

/**
 * Ejecuta fn con los globales que usan las funciones sin parámetros de inyección.
 */
function conEntornoCopias(mocks, sesion, fn) {
  const valores = {
    Session: sesion,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => mocks.spreadsheet,
      openById: () => mocks.spreadsheet
    },
    PropertiesService: { getScriptProperties: () => mocks.propertiesService },
    DriveApp: mocks.driveApp,
    ScriptApp: mocks.scriptApp,
    SheetsRepository: function RepositorioFalso() { return mocks.entorno.repo; }
  };
  const previos = {};
  for (const clave of Object.keys(valores)) {
    previos[clave] = global[clave];
    global[clave] = valores[clave];
  }
  try {
    return fn();
  } finally {
    for (const clave of Object.keys(valores)) {
      if (previos[clave] === undefined) delete global[clave];
      else global[clave] = previos[clave];
    }
  }
}

/**
 * Ejecuta fn con una fecha fija, sustituyendo Date mientras dura la llamada.
 * Solo se usa en pruebas para simular "hoy" y "mañana" sin tocar el reloj real.
 */
function conFechaFija(iso, fn) {
  const RealDate = global.Date;
  const fija = new RealDate(iso);
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fija.getTime());
      else super(...args);
    }
    static now() { return fija.getTime(); }
  }
  global.Date = FakeDate;
  try {
    return fn();
  } finally {
    global.Date = RealDate;
  }
}

console.log('\n================================================================');
console.log(' TEST SUITE T-018 — COPIAS DE SEGURIDAD');
console.log('================================================================\n');

// --------------------------------------------------------------------------
// 1. Retención: lógica pura
// --------------------------------------------------------------------------
runTest('1. seleccionarCopiasABorrar devuelve las 5 DIARIA más antiguas y ninguna MANUAL', () => {
  const copias = [];
  for (let i = 0; i < 35; i++) {
    const fecha = new Date(Date.UTC(2026, 0, 1 + i));
    copias.push({
      id: 'DIARIA_' + i,
      nombre: `STOCK-LIGHT_COPIA_2026-01-${String(i + 1).padStart(2, '0')}_0100_DIARIA`,
      motivo: 'DIARIA',
      fechaCreacion: fecha
    });
  }
  for (let i = 0; i < 3; i++) {
    copias.push({
      id: 'MANUAL_' + i,
      nombre: `STOCK-LIGHT_COPIA_2025-12-0${i + 1}_0100_MANUAL`,
      motivo: 'MANUAL',
      fechaCreacion: new Date(Date.UTC(2025, 11, 1 + i))
    });
  }

  const aBorrar = backup.seleccionarCopiasABorrar(copias, 30);
  assert.strictEqual(aBorrar.length, 5);
  assert.deepStrictEqual(aBorrar.map((c) => c.id), ['DIARIA_0', 'DIARIA_1', 'DIARIA_2', 'DIARIA_3', 'DIARIA_4']);
  assert.ok(aBorrar.every((c) => c.motivo === 'DIARIA'));
});

// --------------------------------------------------------------------------
// 2. Nombre canónico en Europe/Madrid
// --------------------------------------------------------------------------
runTest('2. El nombre de la copia usa Europe/Madrid (22:00Z -> 23:00)', () => {
  const nombre = backup.nombreCopiaSeguridad(new Date('2026-11-05T22:00:00Z'), 'DIARIA');
  assert.strictEqual(nombre, 'STOCK-LIGHT_COPIA_2026-11-05_2300_DIARIA');
});

runTest('2b. existeCopiaDiariaDeHoy compara la fecha del nombre y no cuenta MANUAL', () => {
  const copias = [
    { nombre: 'STOCK-LIGHT_COPIA_2026-11-05_2300_DIARIA' },
    { nombre: 'STOCK-LIGHT_COPIA_2026-11-04_2300_DIARIA' },
    { nombre: 'STOCK-LIGHT_COPIA_2026-11-05_2300_MANUAL' }
  ];
  assert.strictEqual(backup.existeCopiaDiariaDeHoy(copias, '2026-11-05'), true);
  assert.strictEqual(backup.existeCopiaDiariaDeHoy(copias, '2026-11-06'), false);
  assert.strictEqual(backup.existeCopiaDiariaDeHoy(copias, new Date('2026-11-05T22:00:00Z')), true);
  assert.strictEqual(backup.existeCopiaDiariaDeHoy([
    { nombre: 'STOCK-LIGHT_COPIA_2026-11-05_2300_MANUAL' }
  ], '2026-11-05'), false);
});

// --------------------------------------------------------------------------
// 3. Disparador diario idempotente
// --------------------------------------------------------------------------
runTest('3. adminInstalarCopiaDiaria llamado dos veces deja un solo disparador', () => {
  const mocks = crearMocks();
  conEntornoCopias(mocks, SESIONES.propietario, () => {
    codigo.adminInstalarCopiaDiaria();
    codigo.adminInstalarCopiaDiaria();
  });
  assert.strictEqual(mocks.triggers.length, 1);
  assert.strictEqual(mocks.triggers[0].getHandlerFunction(), 'copiaDiariaProgramada');
});

// --------------------------------------------------------------------------
// 4. Guardia de T-023 en las tres funciones admin*
// --------------------------------------------------------------------------
runTest('4. Las funciones admin* sin propietario lanzan el error de T-023', () => {
  const mocks = crearMocks();
  conEntornoCopias(mocks, SESIONES.visitante, () => {
    for (const invocar of [
      () => codigo.adminCrearCopiaManual(),
      () => codigo.adminInstalarCopiaDiaria(),
      () => codigo.adminConfigurarCarpetaCopias('CARPETA_COPIAS')
    ]) {
      assert.throws(invocar, (err) => err instanceof Error && err.message === MENSAJE_ADMIN);
    }
  });
});

// --------------------------------------------------------------------------
// 5. Configuración de carpeta y copia manual
// --------------------------------------------------------------------------
runTest('5. adminConfigurarCarpetaCopias persiste BACKUP_FOLDER_ID', () => {
  const mocks = crearMocks();
  conEntornoCopias(mocks, SESIONES.propietario, () => {
    const res = codigo.adminConfigurarCarpetaCopias('CARPETA_NUEVA_1234567890');
    assert.deepStrictEqual(res, { folderId: 'CARPETA_NUEVA_1234567890' });
    assert.strictEqual(mocks.store.BACKUP_FOLDER_ID, 'CARPETA_NUEVA_1234567890');
  });
});

runTest('6. adminCrearCopiaManual crea la copia y registra LOG_OPERACIONES', () => {
  const mocks = crearMocks();
  const res = conEntornoCopias(mocks, SESIONES.propietario, () => codigo.adminCrearCopiaManual());

  assert.ok(res.id);
  assert.ok(/^STOCK-LIGHT_COPIA_\d{4}-\d{2}-\d{2}_\d{4}_MANUAL$/.test(res.nombre));

  const logs = mocks.entorno.repo.getLogOperaciones();
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].operacion, 'COPIA_SEGURIDAD');
  assert.strictEqual(logs[0].motivo, 'MANUAL');
  assert.strictEqual(logs[0].referencia, res.id);
  assert.strictEqual(logs[0].estado, 'CORRECTA');
  assert.strictEqual(logs[0].usuario, 'dueno@stocklight.test');
});

// --------------------------------------------------------------------------
// 6. La copia diaria no lanza y registra el error
// --------------------------------------------------------------------------
runTest('7. copiaDiariaProgramada no lanza si falta BACKUP_FOLDER_ID y deja ERROR en el log', () => {
  const mocks = crearMocks({ sinCarpeta: true });
  const res = conEntornoCopias(mocks, SESIONES.propietario, () => codigo.copiaDiariaProgramada());

  assert.strictEqual(res.ok, false);
  assert.ok(/BACKUP_FOLDER_ID/.test(res.error));
  const logs = mocks.entorno.repo.getLogOperaciones();
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].operacion, 'COPIA_SEGURIDAD');
  assert.strictEqual(logs[0].estado, 'ERROR');
});

// --------------------------------------------------------------------------
// 7. Retención real sobre la carpeta simulada
// --------------------------------------------------------------------------
runTest('8. Una copia DIARIA nueva manda a la papelera la más antigua si ya hay 30', () => {
  const mocks = crearMocks({ copiasPrevias: 30 });
  const res = conEntornoCopias(mocks, SESIONES.propietario, () => codigo.copiaDiariaProgramada());

  assert.ok(res.id);
  assert.strictEqual(mocks.carpeta.archivos.length, 31);
  const borradas = mocks.carpeta.archivos.filter((a) => a.trashed);
  assert.strictEqual(borradas.length, 1);
  assert.strictEqual(borradas[0].getId(), 'VIEJA_0');
});

// --------------------------------------------------------------------------
// 9. Una sola copia DIARIA por día aunque se llame muchas veces
// --------------------------------------------------------------------------
runTest('10. 35 llamadas a copiaDiariaProgramada el mismo día dejan una sola copia y no borran las anteriores', () => {
  const mocks = crearMocks({ copiasPrevias: 3 });
  const resultados = conEntornoCopias(mocks, SESIONES.propietario, () => conFechaFija('2026-11-05T10:00:00Z', () => {
    const salida = [];
    for (let i = 0; i < 35; i++) salida.push(codigo.copiaDiariaProgramada());
    return salida;
  }));

  assert.ok(resultados[0].id, 'La primera llamada debe crear la copia');
  for (let i = 1; i < resultados.length; i++) {
    assert.strictEqual(resultados[i].ok, true);
    assert.strictEqual(resultados[i].omitida, true);
    assert.strictEqual(resultados[i].motivo, 'YA_EXISTE_HOY');
  }

  const deHoy = mocks.carpeta.archivos.filter((a) => a.nombre.includes('_2026-11-05_') && a.nombre.endsWith('_DIARIA'));
  assert.strictEqual(deHoy.length, 1);
  assert.strictEqual(mocks.carpeta.archivos.length, 4);
  assert.strictEqual(mocks.carpeta.archivos.filter((a) => a.trashed).length, 0);
});

// --------------------------------------------------------------------------
// 10. Al día siguiente sí se crea la copia
// --------------------------------------------------------------------------
runTest('11. Al día siguiente copiaDiariaProgramada crea la copia nueva', () => {
  const mocks = crearMocks();
  const dia1 = conEntornoCopias(mocks, SESIONES.propietario, () => conFechaFija('2026-11-05T10:00:00Z', () => codigo.copiaDiariaProgramada()));
  const dia2 = conEntornoCopias(mocks, SESIONES.propietario, () => conFechaFija('2026-11-06T10:00:00Z', () => codigo.copiaDiariaProgramada()));

  assert.ok(dia1.id);
  assert.ok(dia2.id);
  assert.ok(dia1.nombre.includes('_2026-11-05_'));
  assert.ok(dia2.nombre.includes('_2026-11-06_'));
  assert.strictEqual(mocks.carpeta.archivos.length, 2);
});

// --------------------------------------------------------------------------
// 11. Documentación de la superficie
// --------------------------------------------------------------------------
runTest('9. docs/API_PUBLICA.md clasifica las funciones nuevas', () => {
  const documento = fs.readFileSync(path.join(__dirname, '..', 'docs', 'API_PUBLICA.md'), 'utf8');
  const nuevas = [
    'adminCrearCopiaManual',
    'adminInstalarCopiaDiaria',
    'adminConfigurarCarpetaCopias',
    'copiaDiariaProgramada',
    'nombreCopiaSeguridad',
    'existeCopiaDiariaDeHoy',
    'seleccionarCopiasABorrar'
  ];
  for (const nombre of nuevas) {
    assert.ok(documento.includes('`' + nombre + '`'), `Falta ${nombre} en docs/API_PUBLICA.md`);
  }
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-018: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
