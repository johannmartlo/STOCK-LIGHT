/**
 * STOCK-LIGHT — Test Suite Oficial: Ingesta, Validación y Diagnóstico de Maestro de Envases
 * Ejecutable con Node.js: `node test/maestro_envases_import.test.js`
 * 
 * Verifica el cumplimiento riguroso de las 22 reglas de validación sin importación productiva.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { MaestroEnvasesValidator } = require('../src/MaestroEnvasesValidator');
const { ArticuloEnvaseValidator } = require('../src/ArticuloEnvaseValidator');
const { DIAGNOSTIC_CODES } = require('../src/ImportDiagnostics');
const { resolveHeaderMapping, ENVASES_HEADER_SYNONYMS, ENVASES_SCHEMA_SPEC } = require('../src/ImportSchema');

console.log('================================================================');
console.log(' INICIANDO TEST SUITE FASE 3.8 — VALIDADOR MAESTRO DE ENVASES');
console.log('================================================================\n');

// Cargar catálogo de referencia MAESTRO_BASE.json
const maestroBasePath = path.join(__dirname, '..', 'docs', 'reference', 'MAESTRO_BASE.json');
const maestroBase = JSON.parse(fs.readFileSync(maestroBasePath, 'utf8'));

// Catálogo simulado de artículos conocidos
const sampleArticulos = [
  { codigo_articulo: '10102111', nombre_articulo: 'TOMATE PERA RAMA I M', activo: true },
  { codigo_articulo: '19127111', nombre_articulo: 'TOMATE ROSA I', activo: true },
  { codigo_articulo: '10127111', nombre_articulo: 'TOMATE ROSA I M', activo: true },
  { codigo_articulo: '2112000', nombre_articulo: 'TOMATE ROSA I', activo: true },
  { codigo_articulo: '2112005', nombre_articulo: 'TOMATE MORESCO I M', activo: true },
  { codigo_articulo: '2112006', nombre_articulo: 'TOMATE MORESCO I MM', activo: true },
  { codigo_articulo: '10101100', nombre_articulo: 'TOMATE LARGA VIDA S/C', activo: true },
  { codigo_articulo: '99999999', nombre_articulo: 'TOMATE OBSOLETO', activo: false }
];

// Instancia estándar del validador con catálogo base
const validatorEnvases = new MaestroEnvasesValidator({ maestroBase });

// Rutas a fixtures
const fixturesDir = path.join(__dirname, 'fixtures');
const csvValido = fs.readFileSync(path.join(fixturesDir, 'maestro_envases_valido.csv'), 'utf8');
const csvErrores = fs.readFileSync(path.join(fixturesDir, 'maestro_envases_errores.csv'), 'utf8');
const csvArtEnvValido = fs.readFileSync(path.join(fixturesDir, 'articulo_envase_valido.csv'), 'utf8');
const csvArtEnvMulti = fs.readFileSync(path.join(fixturesDir, 'articulo_envase_multiformato.csv'), 'utf8');

// ============================================================================
// BATERÍA DE PRUEBAS
// ============================================================================

// --- TEST 1: Código de envase duplicado ---
console.log('--- TEST 1: Código de envase duplicado ---');
const reportErrores = validatorEnvases.validate(csvErrores);
const dupError = reportErrores.errores.find(e => e.codigoError === DIAGNOSTIC_CODES.ENVASE_CODIGO_DUPLICADO && e.valor === '3112000');
assert.ok(dupError, 'Debe detectar código duplicado 3112000');
console.log('  ✅ [PASS] Test 1: Código duplicado detectado y bloqueado.');

// --- TEST 2: Tara negativa ---
console.log('--- TEST 2: Tara negativa ---');
const negTaraError = reportErrores.errores.find(e => e.codigoError === DIAGNOSTIC_CODES.TARA_NEGATIVA);
assert.ok(negTaraError, 'Debe detectar tara negativa');
assert.strictEqual(negTaraError.valor, '-0.500');
console.log('  ✅ [PASS] Test 2: Tara negativa (-0.500 kg) rechazada.');

// --- TEST 3: Tara vacía / no informada ---
console.log('--- TEST 3: Tara vacía / no informada ---');
const reportValido = validatorEnvases.validate(csvValido);
const warningNoInformada = reportValido.warnings.find(w => w.codigoWarning === DIAGNOSTIC_CODES.TARA_NO_INFORMADA);
assert.ok(warningNoInformada, 'Debe emitir warning para tara vacía');
const regTaraVacia = reportValido.registrosNormalizados.find(r => r.codigo_envase === '3121006');
assert.ok(regTaraVacia);
assert.strictEqual(regTaraVacia.estado_tara, 'NO_INFORMADA');
assert.strictEqual(regTaraVacia.tara_kg, null);
console.log('  ✅ [PASS] Test 3: Tara vacía clasificada como NO_INFORMADA sin inventar valor.');

// --- TEST 4: Tara 0.000 (requiere verificación física) ---
console.log('--- TEST 4: Tara 0.000 ---');
const warningCero = reportValido.warnings.find(w => w.codigoWarning === DIAGNOSTIC_CODES.TARA_CERO_REQUIERE_REVISION);
assert.ok(warningCero, 'Debe emitir warning para tara 0.000 kg');
const regTaraCero = reportValido.registrosNormalizados.find(r => r.codigo_envase === '410199');
assert.ok(regTaraCero);
assert.strictEqual(regTaraCero.estado_tara, 'OFICIAL_CERO');
assert.strictEqual(regTaraCero.tara_kg, 0.000);
console.log('  ✅ [PASS] Test 4: Tara 0.000 kg clasificada con alerta de pesaje.');

// --- TEST 5: Envase inexistente en relación ARTICULO_ENVASE ---
console.log('--- TEST 5: Envase inexistente en relación ARTICULO_ENVASE ---');
const validatorArtEnv = new ArticuloEnvaseValidator({
  maestroArticulos: sampleArticulos,
  maestroEnvasesValidados: reportValido.registrosNormalizados
});
const csvInexistente = `CodigoArticulo;NombreArticulo;CodigoEnvase;NombreEnvase
10102111;TOMATE PERA RAMA I M;CODIGO_INEXISTENTE_999;ENVASE FANTASMA`;
const repEnvNoExiste = validatorArtEnv.validate(csvInexistente);
const errEnvNoExiste = repEnvNoExiste.errores.find(e => e.codigoError === DIAGNOSTIC_CODES.ENVASE_NO_EXISTE);
assert.ok(errEnvNoExiste, 'Debe rechazar envase que no existe en MAESTRO_ENVASES');
console.log('  ✅ [PASS] Test 5: Envase inexistente detectado y rechazado.');

// --- TEST 6: Artículo inexistente en relación ARTICULO_ENVASE ---
console.log('--- TEST 6: Artículo inexistente en relación ARTICULO_ENVASE ---');
const csvArtInexistente = `CodigoArticulo;NombreArticulo;CodigoEnvase;NombreEnvase
88888888;TOMATE DESCONOCIDO;3112000;EPS 104`;
const repArtNoExiste = validatorArtEnv.validate(csvArtInexistente);
const errArtNoExiste = repArtNoExiste.errores.find(e => e.codigoError === DIAGNOSTIC_CODES.ARTICULO_NO_EXISTE);
assert.ok(errArtNoExiste, 'Debe rechazar artículo que no existe en MAESTRO');
console.log('  ✅ [PASS] Test 6: Artículo inexistente detectado y rechazado.');

// --- TEST 7: Relación duplicada en ARTICULO_ENVASE ---
console.log('--- TEST 7: Relación duplicada en ARTICULO_ENVASE ---');
const csvRelDuplicada = `CodigoArticulo;NombreArticulo;CodigoEnvase;NombreEnvase
10102111;TOMATE PERA RAMA I M;3111101;IF6410 10x500
10102111;TOMATE PERA RAMA I M;3111101;IF6410 10x500`;
const repRelDup = validatorArtEnv.validate(csvRelDuplicada);
const errRelDup = repRelDup.errores.find(e => e.codigoError === DIAGNOSTIC_CODES.RELACION_DUPLICADA);
assert.ok(errRelDup, 'Debe detectar relación articulo|envase duplicada');
console.log('  ✅ [PASS] Test 7: Relación duplicada bloqueada.');

// --- TEST 8: Envase inactivo en relación ARTICULO_ENVASE ---
console.log('--- TEST 8: Envase inactivo ---');
const csvEnvInactivo = `CodigoArticulo;NombreArticulo;CodigoEnvase;NombreEnvase
10102111;TOMATE PERA RAMA I M;2122000;CARTON 60x40x9,5 GENERICA`;
const repEnvInactivo = validatorArtEnv.validate(csvEnvInactivo);
const errEnvInactivo = repEnvInactivo.errores.find(e => e.codigoError === DIAGNOSTIC_CODES.ENVASE_INACTIVO);
assert.ok(errEnvInactivo, 'Debe rechazar relación con envase inactivo');
console.log('  ✅ [PASS] Test 8: Envase inactivo (activo: false) bloqueado.');

// --- TEST 9: Artículo inactivo en relación ARTICULO_ENVASE ---
console.log('--- TEST 9: Artículo inactivo ---');
const csvArtInactivo = `CodigoArticulo;NombreArticulo;CodigoEnvase;NombreEnvase
99999999;TOMATE OBSOLETO;3112000;EPS 104`;
const repArtInactivo = validatorArtEnv.validate(csvArtInactivo);
const errArtInactivo = repArtInactivo.errores.find(e => e.codigoError === DIAGNOSTIC_CODES.ARTICULO_INACTIVO);
assert.ok(errArtInactivo, 'Debe rechazar relación con artículo inactivo');
console.log('  ✅ [PASS] Test 9: Artículo inactivo bloqueado.');

// --- TEST 10: Cardinalidad múltiple (>=2 envases -> MULTIFORMATO) ---
console.log('--- TEST 10: Cardinalidad múltiple ---');
const repMulti = validatorArtEnv.validate(csvArtEnvMulti);
assert.ok(repMulti.ok, 'El archivo multiformato debe ser estructuralmente válido');
const card10127111 = repMulti.cardinalidad['10127111'];
assert.ok(card10127111, 'Debe existir cardinalidad para 10127111');
assert.strictEqual(card10127111.envasesActivos, 2);
assert.strictEqual(card10127111.clasificacion, 'MULTIFORMATO');
const cardLargaVida = repMulti.cardinalidad['10101100'];
assert.strictEqual(cardLargaVida.envasesActivos, 1);
assert.strictEqual(cardLargaVida.clasificacion, 'DETERMINISTA');
console.log('  ✅ [PASS] Test 10: Cardinalidad MULTIFORMATO (2 envases) y DETERMINISTA (1 envase) clasificadas.');

// --- TEST 11: UUID utilizado como código de envase (Alarma de Seguridad) ---
console.log('--- TEST 11: Detección y rechazo de UUID ---');
const uuidError = reportErrores.errores.find(e => e.codigoError === DIAGNOSTIC_CODES.ENVASE_CODIGO_UUID);
assert.ok(uuidError, 'Debe detectar y rechazar código con formato UUID');
assert.strictEqual(uuidError.valor, '00a066af-219e-40a7-805b-256b35722e0e');
console.log('  ✅ [PASS] Test 11: Código UUID de SaaS ajeno detectado y rechazado.');

// --- TEST 12: Conciliación contra MAESTRO_BASE (CODIGO_CAMBIADO y DESCRIPCION_CAMBIADA) ---
console.log('--- TEST 12: Conciliación contra base (CODIGO_CAMBIADO y DESCRIPCION_CAMBIADA) ---');
const concItemCod = reportValido.conciliacion.items.find(i => i.codigo === '2112000');
assert.ok(concItemCod);
assert.strictEqual(concItemCod.estadoConciliacion, 'CODIGO_CAMBIADO');

// Probar DESCRIPCION_CAMBIADA pasando CT4395 con denominación alterada
const csvDescCambiada = `Codigo;Nombre;Alias;CodigoFamilia;Familia;TaraKg;Activo;EsPool
CT4395;CARTON 40x30 MORESCO REVISADO;CT4395;2121;CAJAS 40x30;0.320;true;false`;
const repDescCamb = validatorEnvases.validate(csvDescCambiada);
const concItemDesc = repDescCamb.conciliacion.items.find(i => i.codigo === 'CT4395');
assert.ok(concItemDesc);
assert.strictEqual(concItemDesc.estadoConciliacion, 'DESCRIPCION_CAMBIADA');
console.log('  ✅ [PASS] Test 12: CODIGO_CAMBIADO y DESCRIPCION_CAMBIADA detectados en conciliación.');


// --- TEST 13: Discrepancia histórica de tara > 10% ---
console.log('--- TEST 13: Discrepancia histórica de tara > 10% ---');
const valWithHist = new MaestroEnvasesValidator({
  maestroBase,
  historicalTaras: {
    'CT4395 MORESCO': 0.400 // Histórico era 0.400 vs oficial 0.320 en fixture -> 20% discrepancia
  }
});
const repHist = valWithHist.validate(csvValido);
const warnHist = repHist.warnings.find(w => w.codigoWarning === DIAGNOSTIC_CODES.WARNING_HISTORICO_TARA && w.fila === 9);
assert.ok(warnHist, 'Debe emitir warning por discrepancia > 10%');
console.log('  ✅ [PASS] Test 13: Discrepancia histórica >10% advertida sin alterar tara oficial.');

// --- TEST 14: Archivo duplicado por SHA-256 ---
console.log('--- TEST 14: Archivo duplicado por SHA-256 ---');
const valDupHash = new MaestroEnvasesValidator({
  knownSha256List: ['hash_ya_procesado_abc123']
});
const repDupHash = valDupHash.validate(csvValido, {
  fileName: 'export_hispatec.csv',
  sha256Hash: 'hash_ya_procesado_abc123'
});
assert.strictEqual(repDupHash.ok, false);
const errHash = repDupHash.errores.find(e => e.codigoError === DIAGNOSTIC_CODES.ARCHIVO_DUPLICADO_SHA256);
assert.ok(errHash);
console.log('  ✅ [PASS] Test 14: Archivo duplicado bloqueado por SHA-256.');

// --- TEST 15: Idempotencia conceptual ---
console.log('--- TEST 15: Idempotencia conceptual ---');
const rep1 = validatorEnvases.validate(csvValido);
const rep2 = validatorEnvases.validate(csvValido);
assert.strictEqual(rep1.ok, rep2.ok);
assert.strictEqual(rep1.totalFilas, rep2.totalFilas);
assert.strictEqual(rep1.filasValidas, rep2.filasValidas);
assert.strictEqual(rep1.registrosNormalizados.length, rep2.registrosNormalizados.length);
console.log('  ✅ [PASS] Test 15: Validación idéntica en ejecuciones sucesivas (cero mutación de estado).');

// --- TEST 16: Encabezados alternativos (sinónimos flexibles) ---
console.log('--- TEST 16: Encabezados alternativos ---');
const csvAltHeaders = `EnvaseCodigo,EnvaseDescripcionCorta,AliasArticulo,CodFamilia,NomFamilia,Tara (kg),is_active,Pool
3112000,EPS 104,EPS1043K_,3112,CAJAS EPS,1.100,true,false`;
const repAlt = validatorEnvases.validate(csvAltHeaders);
assert.strictEqual(repAlt.ok, true);
assert.strictEqual(repAlt.registrosNormalizados.length, 1);
assert.strictEqual(repAlt.registrosNormalizados[0].codigo_envase, '3112000');
assert.strictEqual(repAlt.registrosNormalizados[0].tara_kg, 1.100);
console.log('  ✅ [PASS] Test 16: Encabezados alternativos resueltos exitosamente.');

// --- TEST 17: Columnas obligatorias ausentes ---
console.log('--- TEST 17: Columnas obligatorias ausentes ---');
const csvMissingCol = `Codigo,Alias,TaraKg\n3112000,EPS104,1.100`;
const repMissing = validatorEnvases.validate(csvMissingCol);
assert.strictEqual(repMissing.ok, false);
const errMissing = repMissing.errores.find(e => e.codigoError === DIAGNOSTIC_CODES.COLUMNA_OBLIGATORIA_FALTANTE);
assert.ok(errMissing);
console.log('  ✅ [PASS] Test 17: Archivo con columna obligatoria ausente rechazado.');

// --- TEST 18: Conservación estricta de Serie 21xx ---
console.log('--- TEST 18: Conservación estricta de Serie 21xx ---');
const reg2112 = reportValido.registrosNormalizados.find(r => r.codigo_envase === '2112000');
assert.ok(reg2112);
assert.strictEqual(reg2112.codigo_envase, '2112000');
assert.strictEqual(reg2112.codigo_familia, '2112');
console.log('  ✅ [PASS] Test 18: Código de serie 21xx preservado exactamente.');

// --- TEST 19: Conservación estricta de Serie 31xx ---
console.log('--- TEST 19: Conservación estricta de Serie 31xx ---');
const reg3112 = reportValido.registrosNormalizados.find(r => r.codigo_envase === '3112000');
assert.ok(reg3112);
assert.strictEqual(reg3112.codigo_envase, '3112000');
assert.strictEqual(reg3112.codigo_familia, '3112');
assert.notStrictEqual(reg2112.codigo_envase, reg3112.codigo_envase, 'Las series 21xx y 31xx no deben fusionarse');
console.log('  ✅ [PASS] Test 19: Código de serie 31xx preservado independientemente de la serie 21xx.');

// --- TEST 20: Conservación estricta de sufijo CA ---
console.log('--- TEST 20: Conservación estricta de sufijo CA ---');
const regCA = reportValido.registrosNormalizados.find(r => r.codigo_envase === '2112201CA');
assert.ok(regCA);
assert.strictEqual(regCA.codigo_envase, '2112201CA');
assert.strictEqual(regCA.es_retornable_pool, true);
console.log('  ✅ [PASS] Test 20: Sufijo CA preservado exactamente.');

// --- TEST 21: EPS104 3K y EPS104 4K tratados como entidades distintas ---
console.log('--- TEST 21: Variantes EPS104 3K vs 4K ---');
const reg3K = reportValido.registrosNormalizados.find(r => r.codigo_envase === '2112000');
const reg4K = reportValido.registrosNormalizados.find(r => r.codigo_envase === '2112006');
assert.ok(reg3K);
assert.ok(reg4K);
assert.notStrictEqual(reg3K.codigo_envase, reg4K.codigo_envase);
assert.strictEqual(reg3K.alias, 'EPS1043K');
assert.strictEqual(reg4K.alias, 'EPS1044K');
console.log('  ✅ [PASS] Test 21: Variantes 3K (2112000) y 4K (2112006) conservadas como entidades distintas.');

// --- TEST 22: EPS106 5.5K y EPS106 6K tratados como entidades distintas ---
console.log('--- TEST 22: Variantes EPS106 5.5K vs 6K ---');
const reg6K = reportValido.registrosNormalizados.find(r => r.codigo_envase === '2112200');
const reg55K = reportValido.registrosNormalizados.find(r => r.codigo_envase === '2112205');
assert.ok(reg6K);
assert.ok(reg55K);
assert.notStrictEqual(reg6K.codigo_envase, reg55K.codigo_envase);
assert.strictEqual(reg6K.alias, 'EPS1066K');
assert.strictEqual(reg55K.alias, 'EPS1065.5K');
console.log('  ✅ [PASS] Test 22: Variantes 6K (2112200) y 5.5K (2112205) conservadas como entidades distintas.');

console.log('\n================================================================');
console.log(' ✅ TEST SUITE FASE 3.8 SUPERADA: 22/22 TESTS APROBADOS (0 FAILS)');
console.log('================================================================\n');
