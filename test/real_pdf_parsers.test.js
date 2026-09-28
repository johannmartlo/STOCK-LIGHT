/**
 * STOCK-LIGHT — Test Suite Oficial de Parsers con Muestras Reales Hispatec
 * Ejecutable con Node.js: `node test/real_pdf_parsers.test.js`
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { CompraParser } = require('../src/parsers/CompraParser');
const { RecepcionParser } = require('../src/parsers/RecepcionParser');
const { SalidaParser } = require('../src/parsers/SalidaParser');
const { DocumentParserRegistry } = require('../src/parsers/DocumentParserRegistry');
const { MaestroResolver } = require('../src/MaestroResolver');
const { DocumentValidator } = require('../src/DocumentValidator');

console.log('================================================================');
console.log(' INICIANDO VALIDACIÓN DE PARSERS CON DOCUMENTOS REALES HISPATEC');
console.log('================================================================\n');

// 1. Catálogo MAESTRO oficial representativo de la operativa
const sampleMaestro = [
  { codigo_articulo: '2112000', codigo_envase: 'EPS104', nombre_articulo: 'TOMATE ROSA I', descripcion_envase: 'EPS 104' },
  { codigo_articulo: '2112000', codigo_envase: 'EPS106', nombre_articulo: 'TOMATE ROSA I M', descripcion_envase: 'EPS 106 9x500' },
  { codigo_articulo: '2112001', codigo_envase: 'EPS106', nombre_articulo: 'TOMATE RAMA I M', descripcion_envase: 'EPS106 9x500' },
  { codigo_articulo: '2112002', codigo_envase: 'EPS104', nombre_articulo: 'TOMATE KUMATO I M', descripcion_envase: 'EPS104 5x500' },
  { codigo_articulo: '2112003', codigo_envase: 'EPS154', nombre_articulo: 'TOMATE PERA SUELTA M', descripcion_envase: 'EPS154' },
  { codigo_articulo: '2112004', codigo_envase: 'CARTON', nombre_articulo: 'TOMATE COCKTAIL I M', descripcion_envase: 'CARTON 40x30X9.7 MADERA 8X300' }
];

const resolver = new MaestroResolver(sampleMaestro);
const validator = new DocumentValidator({ maestroResolver: resolver });
const registry = new DocumentParserRegistry({
  validator,
  maestroResolver: resolver
});

const samplesDir = path.join(__dirname, '..', 'docs', 'samples');

// ----------------------------------------------------
// TEST 1: Albarán de Venta (Salida) AVT26 6227
// ----------------------------------------------------
console.log('--- TEST 1: AVT26 6227 ALBARAN DE VENTA.pdf ---');
const txtSalida = fs.readFileSync(path.join(samplesDir, 'AVT26 6227 ALBARAN DE VENTA.pdf.extracted.txt'), 'utf8');
const reviewSalida = registry.reviewDocument(txtSalida, {
  fileMeta: { fileName: 'AVT26 6227 ALBARAN DE VENTA.pdf', sha256Hash: 'hash_salida_123' }
});

console.log(`  Documento: ${reviewSalida.documentoDetectado} ${reviewSalida.serieNumero}`);
console.log(`  Cliente: ${reviewSalida.entidad}`);
console.log(`  Fecha: ${reviewSalida.fecha}`);
console.log(`  Total Cajas Extraídas: ${reviewSalida.totalCajasDetectadas} (Kilos 2.225 kg ignorados)`);
console.log(`  Líneas procesadas: ${reviewSalida.lineasDetectadas.length}`);
console.log(`  Estado de Validación: ${reviewSalida.estadoValidacion}`);

assert.strictEqual(reviewSalida.documentoDetectado, 'SALIDA');
assert.strictEqual(reviewSalida.serie, 'AVT26');
assert.strictEqual(reviewSalida.numero, '6227');
assert.strictEqual(reviewSalida.fecha, '2026-09-24');
assert.strictEqual(reviewSalida.totalCajasDetectadas, 584);
assert.strictEqual(reviewSalida.lineasDetectadas.length, 5);

// Verificar desglose por línea
const expectedSalidaLines = [
  { art: 'TOMATE RAMA I M', env: 'EPS106', cajas: 32 },
  { art: 'TOMATE KUMATO I M', env: 'EPS104', cajas: 64 },
  { art: 'TOMATE ROSA I M', env: 'EPS106', cajas: 92 },
  { art: 'TOMATE PERA SUELTA M', env: 'EPS154', cajas: 44 },
  { art: 'TOMATE ROSA I', env: 'EPS104', cajas: 352 }
];

expectedSalidaLines.forEach((exp, idx) => {
  const line = reviewSalida.lineasDetectadas[idx];
  assert.strictEqual(line.nombreArticulo, exp.art);
  assert.strictEqual(line.codigoEnvase, exp.env);
  assert.strictEqual(line.cajas, exp.cajas);
});
console.log('  ✅ [PASS] Salida validada al 100%: 584 cajas coincidentes.\n');


// ----------------------------------------------------
// TEST 2: Entrada Recepción RCT26/473 (150 cajas)
// ----------------------------------------------------
console.log('--- TEST 2: ENTRADA RECEPCION.pdf (RCT26/473) ---');
const txtRec1 = fs.readFileSync(path.join(samplesDir, 'ENTRADA RECEPCION.pdf.extracted.txt'), 'utf8');
const reviewRec1 = registry.reviewDocument(txtRec1, {
  fileMeta: { fileName: 'ENTRADA RECEPCION.pdf', sha256Hash: 'hash_rec_473' }
});

console.log(`  Documento: ${reviewRec1.documentoDetectado} ${reviewRec1.serieNumero}`);
console.log(`  Fecha: ${reviewRec1.fecha}`);
console.log(`  Total Cajas: ${reviewRec1.totalCajasDetectadas} (Kilos 216 kg ignorados, medianería con 0 bultos excluida)`);
console.log(`  Partida: ${reviewRec1.lineasDetectadas[0].partida}`);

assert.strictEqual(reviewRec1.documentoDetectado, 'RECEPCION');
assert.strictEqual(reviewRec1.serie, 'RCT26');
assert.strictEqual(reviewRec1.numero, '473');
assert.strictEqual(reviewRec1.fecha, '2026-05-01');
assert.strictEqual(reviewRec1.totalCajasDetectadas, 150);
assert.strictEqual(reviewRec1.lineasDetectadas[0].cajas, 150);
assert.strictEqual(reviewRec1.lineasDetectadas[0].partida, '324138');
console.log('  ✅ [PASS] Recepción 1 validada al 100%: 150 cajas, medianería filtrada.\n');


// ----------------------------------------------------
// TEST 3: Entrada Recepción RCT26/474 (248 cajas multilínea)
// ----------------------------------------------------
console.log('--- TEST 3: ENTRADA RECEPCION 2.pdf (RCT26/474) ---');
const txtRec2 = fs.readFileSync(path.join(samplesDir, 'ENTRADA RECEPCION 2.pdf.extracted.txt'), 'utf8');
const reviewRec2 = registry.reviewDocument(txtRec2, {
  fileMeta: { fileName: 'ENTRADA RECEPCION 2.pdf', sha256Hash: 'hash_rec_474' }
});

console.log(`  Documento: ${reviewRec2.documentoDetectado} ${reviewRec2.serieNumero}`);
console.log(`  Fecha: ${reviewRec2.fecha}`);
console.log(`  Total Cajas: ${reviewRec2.totalCajasDetectadas} (553 kg ignorados, medianero Ali Zennou con 0 bultos excluido)`);
console.log(`  Líneas:`);
reviewRec2.lineasDetectadas.forEach(l => {
  console.log(`    - ${l.nombreArticulo} | ${l.nombreEnvase} | ${l.cajas} cajas | Partida: ${l.partida}`);
});

assert.strictEqual(reviewRec2.documentoDetectado, 'RECEPCION');
assert.strictEqual(reviewRec2.serie, 'RCT26');
assert.strictEqual(reviewRec2.numero, '474');
assert.strictEqual(reviewRec2.fecha, '2026-05-02');
assert.strictEqual(reviewRec2.totalCajasDetectadas, 248);
assert.strictEqual(reviewRec2.lineasDetectadas.length, 2);
assert.strictEqual(reviewRec2.lineasDetectadas[0].cajas, 111);
assert.strictEqual(reviewRec2.lineasDetectadas[1].cajas, 137);
console.log('  ✅ [PASS] Recepción 2 validada al 100%: 248 cajas (111 + 137), medianería filtrada.\n');


// ----------------------------------------------------
// TEST 4: Albarán de Compra ACT26/3089 (240 cajas)
// ----------------------------------------------------
console.log('--- TEST 4: ALBARAN DE COMPRA POR PARTIDAS.pdf (ACT26/3089) ---');
const txtCompra = fs.readFileSync(path.join(samplesDir, 'ALBARAN DE COMPRA POR PARTIDAS.pdf.extracted.txt'), 'utf8');
const reviewCompra = registry.reviewDocument(txtCompra, {
  fileMeta: { fileName: 'ALBARAN DE COMPRA POR PARTIDAS.pdf', sha256Hash: 'hash_compra_3089' }
});

console.log(`  Documento: ${reviewCompra.documentoDetectado} ${reviewCompra.serieNumero}`);
console.log(`  Proveedor: ${reviewCompra.entidad}`);
console.log(`  Fecha: ${reviewCompra.fecha}`);
console.log(`  Total Cajas: ${reviewCompra.totalCajasDetectadas} (720 kg netos ignorados)`);
console.log(`  Partida: ${reviewCompra.lineasDetectadas[0].partida}`);

assert.strictEqual(reviewCompra.documentoDetectado, 'COMPRA');
assert.strictEqual(reviewCompra.serie, 'ACT26');
assert.strictEqual(reviewCompra.numero, '3089');
assert.strictEqual(reviewCompra.fecha, '2026-09-24');
assert.strictEqual(reviewCompra.totalCajasDetectadas, 240);
assert.strictEqual(reviewCompra.lineasDetectadas[0].cajas, 240);
assert.strictEqual(reviewCompra.lineasDetectadas[0].partida, '336492');
console.log('  ✅ [PASS] Compra validada al 100%: 240 cajas.\n');


// ----------------------------------------------------
// TEST 5: Detección de Duplicados en Staging
// ----------------------------------------------------
console.log('--- TEST 5: Detección de Documento Duplicado ---');
const existingDocs = [
  {
    id_documento: 'DOC-HISTORICO-1',
    tipo_documento: 'SALIDA',
    serie: 'AVT26',
    numero: '6227',
    fecha_documento: '2026-09-24',
    sha256_hash: 'hash_salida_123'
  }
];

const reviewDupe = registry.reviewDocument(txtSalida, {
  fileMeta: { fileName: 'AVT26 6227 REPETIDO.pdf', sha256Hash: 'hash_salida_123' },
  existingDocuments: existingDocs
});

console.log(`  Estado esperado: DUPLICADO | Estado obtenido: ${reviewDupe.estadoValidacion}`);
console.log(`  Apto para confirmar: ${reviewDupe.aptoParaConfirmar}`);
console.log(`  Errores: ${reviewDupe.errores.join('; ')}`);

assert.strictEqual(reviewDupe.estadoValidacion, 'DUPLICADO');
assert.strictEqual(reviewDupe.aptoParaConfirmar, false);
console.log('  ✅ [PASS] Bloqueo de duplicado verificado exitosamente.\n');

console.log('================================================================');
console.log(' ✅ TODAS LAS PRUEBAS DE CALIBRACIÓN REAL HAN SIDO SUPERADAS');
console.log('================================================================');
