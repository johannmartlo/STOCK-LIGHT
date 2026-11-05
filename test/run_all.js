/**
 * STOCK-LIGHT — Ejecutor único de pruebas (Test Runner)
 * 
 * Ejecuta en orden alfabético todas las suites `test/*.test.js` en procesos independientes
 * con límite de tiempo de 120 segundos por suite.
 * 
 * Uso: node test/run_all.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TEST_DIR = path.resolve(__dirname);
const TIMEOUT_MS = 120000; // 120 segundos

console.log('================================================================');
console.log(' EJECUTOR ÚNICO DE PRUEBAS — STOCK-LIGHT');
console.log('================================================================\n');

// Obtener todas las suites directas test/*.test.js en orden alfabético
const suiteFiles = fs.readdirSync(TEST_DIR, { withFileTypes: true })
  .filter(dirent => dirent.isFile() && dirent.name.endsWith('.test.js'))
  .map(dirent => dirent.name)
  .sort((a, b) => a.localeCompare(b));

console.log(`Suites detectadas (${suiteFiles.length}):`);
suiteFiles.forEach((file, idx) => {
  console.log(`  ${idx + 1}. ${file}`);
});
console.log('\n----------------------------------------------------------------\n');

let suitesPassed = 0;
let suitesFailed = 0;
let totalTestsPassed = 0;
const failures = [];
const startTime = Date.now();

for (let i = 0; i < suiteFiles.length; i++) {
  const file = suiteFiles[i];
  const fullPath = path.join(TEST_DIR, file);
  const suiteIndex = `[${i + 1}/${suiteFiles.length}]`;
  
  process.stdout.write(`${suiteIndex} Ejecutando ${file}... `);
  const suiteStart = Date.now();

  const result = spawnSync(process.execPath, [fullPath], {
    cwd: path.resolve(TEST_DIR, '..'),
    timeout: TIMEOUT_MS,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });

  const durationSec = ((Date.now() - suiteStart) / 1000).toFixed(2);
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const combinedOutput = stdout + (stderr ? '\n' + stderr : '');

  // Extraer número de pruebas superadas de la salida
  let testsInSuite = 0;
  const matchSuperadas = combinedOutput.match(/(\d+)\s+SUPERADAS/i);
  const matchAprobados = combinedOutput.match(/(\d+)\/\d+\s+TESTS APROBADOS/i);
  if (matchSuperadas) {
    testsInSuite = parseInt(matchSuperadas[1], 10);
  } else if (matchAprobados) {
    testsInSuite = parseInt(matchAprobados[1], 10);
  } else {
    const passMatches = combinedOutput.match(/(?:✅|\[PASS\])/g);
    testsInSuite = passMatches ? passMatches.length : (result.status === 0 ? 1 : 0);
  }

  if (result.error && result.error.code === 'ETIMEDOUT') {
    console.log(`❌ TIMEOUT (${durationSec}s > ${TIMEOUT_MS / 1000}s)`);
    suitesFailed++;
    failures.push({ file, reason: `Timeout tras ${TIMEOUT_MS / 1000}s`, output: combinedOutput });
  } else if (result.status !== 0) {
    console.log(`❌ FALLÓ (código ${result.status}, ${durationSec}s)`);
    suitesFailed++;
    failures.push({ file, reason: `Código de salida ${result.status}`, output: combinedOutput });
  } else {
    console.log(`✅ OK (${testsInSuite} pruebas, ${durationSec}s)`);
    suitesPassed++;
    totalTestsPassed += testsInSuite;
  }
}

const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

console.log('\n================================================================');
console.log(' RESUMEN GLOBAL DE EJECUCIÓN');
console.log('================================================================');
console.log(` Suites ejecutadas:  ${suiteFiles.length}`);
console.log(` Suites superadas:   ${suitesPassed}`);
console.log(` Suites fallidas:    ${suitesFailed}`);
console.log(` Pruebas superadas:  ${totalTestsPassed}`);
console.log(` Tiempo total:       ${totalDuration}s`);
console.log('================================================================\n');

if (failures.length > 0) {
  console.error('DETALLE DE FALLOS:');
  failures.forEach(f => {
    console.error(`\n--- Fallo en: ${f.file} (${f.reason}) ---`);
    console.error(f.output.trim());
  });
  console.log('\nRESULTADO FINAL: FALLIDO\n');
  process.exit(1);
} else {
  console.log('RESULTADO FINAL: TODO EN VERDE (0 fallos)\n');
  process.exit(0);
}
