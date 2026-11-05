/**
 * STOCK-LIGHT — Test Suite Fase 8.0
 * 
 * AUDITORÍA DE MAESTROS E INICIALIZACIÓN CONTROLADA
 * 
 * Verifica:
 * 1. Auditoría del esquema oficial de 9 hojas en SheetsRepository (SCHEMA_DEFINITIONS).
 * 2. Cifras de contraste de datos de referencia (162 artículos, 83 envases, 6 grupos, 300 homologadas, 83 revisar, 55 fuera).
 * 3. Idempotencia absoluta: la ejecución sucesiva no duplica filas ni corrompe datos.
 * 4. Inmutabilidad de inventario: CERO movimientos, CERO capas FIFO y CERO stock generado.
 * 5. Integración con CommercialGroupResolver y ausencia de asignaciones ambiguas.
 * 6. Invariante Innegociable: InventoryEngine.js permanece 100% inalterado.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { SheetsRepository, SCHEMA_DEFINITIONS } = require('../src/Repository');
const { MasterInitializationService, GRUPOS_COMERCIALES_INICIALES } = require('../src/MasterInitializationService');
const { CommercialGroupResolver, COMMERCIAL_GROUPS } = require('../src/CommercialGroupResolver');

// Harness de prueba en memoria para SheetsRepository
function createInMemoryRepository() {
  const tables = {};
  for (const name in SCHEMA_DEFINITIONS) {
    tables[name] = [];
  }

  const dummySheet = (name) => ({
    getName: () => name,
    getLastColumn: () => (SCHEMA_DEFINITIONS[name] ? SCHEMA_DEFINITIONS[name].length : 1),
    getRange: () => ({
      setValues: () => {},
      setBackground: () => ({ setFontColor: () => ({ setFontWeight: () => {} }) })
    }),
    setFrozenRows: () => {}
  });

  const dummySS = {
    getSheetByName: (name) => {
      if (tables[name] !== undefined) return dummySheet(name);
      return null;
    },
    insertSheet: (name) => {
      tables[name] = tables[name] || [];
      return dummySheet(name);
    }
  };

  const repo = new SheetsRepository(dummySS);

  // Sobrescribir readTable y replaceTable para trabajar puramente en memoria
  repo.readTable = (tableName) => {
    return (tables[tableName] || []).map(r => ({ ...r }));
  };

  repo.replaceTable = (tableName, records) => {
    tables[tableName] = records.map(r => ({ ...r }));
    return records.length;
  };

  repo.appendRecords = (tableName, records) => {
    tables[tableName] = (tables[tableName] || []).concat(records.map(r => ({ ...r })));
    return records.length;
  };

  repo._tables = tables;
  return repo;
}

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}\n`);
    failed++;
  }
}

console.log('\n================================================================');
console.log(' TEST SUITE FASE 8.0 — AUDITORÍA DE MAESTROS E INICIALIZACIÓN');
console.log('================================================================\n');

// -------------------------------------------------------------
// BLOQUE 1: AUDITORÍA DEL ESQUEMA DE DATOS (9 HOJAS)
// -------------------------------------------------------------
runTest('1. Auditoría de esquema: Las 9 hojas oficiales contienen exactamente sus columnas homologadas', () => {
  const expectedSheets = [
    'MAESTRO_ARTICULOS',
    'MAESTRO_ENVASES',
    'GRUPOS_COMERCIALES',
    'MATRIZ_ARTICULO_ENVASE',
    'DOCUMENTOS',
    'MOVIMIENTOS',
    'CAPAS_FIFO',
    'STOCK_ACTUAL',
    'LOG_OPERACIONES'
  ];

  for (const sheetName of expectedSheets) {
    assert.ok(SCHEMA_DEFINITIONS[sheetName], `La hoja '${sheetName}' debe estar definida en SCHEMA_DEFINITIONS`);
    assert.ok(Array.isArray(SCHEMA_DEFINITIONS[sheetName]), `Las cabeceras de '${sheetName}' deben ser un Array`);
    assert.ok(SCHEMA_DEFINITIONS[sheetName].length > 0, `Las cabeceras de '${sheetName}' no pueden estar vacías`);
  }

  // Verificar columnas obligatorias críticas
  assert.deepStrictEqual(SCHEMA_DEFINITIONS.MAESTRO_ARTICULOS, ['id', 'nombre', 'activo']);
  assert.deepStrictEqual(SCHEMA_DEFINITIONS.MAESTRO_ENVASES, ['id', 'nombre', 'tara_kg', 'peso_unitario_kg', 'activo']);
  assert.deepStrictEqual(SCHEMA_DEFINITIONS.GRUPOS_COMERCIALES, ['id', 'nombre', 'orden_visual', 'activo', 'tipo']);
  assert.deepStrictEqual(SCHEMA_DEFINITIONS.MATRIZ_ARTICULO_ENVASE, ['id', 'articulo', 'envase', 'grupo_comercial', 'subgrupo', 'prioridad', 'activo', 'observaciones']);
  assert.deepStrictEqual(SCHEMA_DEFINITIONS.LOG_OPERACIONES, [
    'id_log', 'fecha_hora', 'usuario', 'operacion', 'codigo_articulo',
    'nombre_articulo', 'codigo_envase', 'descripcion_envase',
    'cantidad_cajas', 'origen', 'destino', 'motivo', 'referencia',
    'estado', 'observaciones'
  ]);
});

// -------------------------------------------------------------
// BLOQUE 2: VERIFICACIÓN DE ARCHIVOS DE REFERENCIA Y CIFRAS
// -------------------------------------------------------------
runTest('2. Cifras de contraste: MATRIZ_COMERCIAL_BASE.csv contiene exactamente 162 artículos, 83 envases, 6 grupos y 300 homologadas', () => {
  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  assert.ok(fs.existsSync(csvPath), 'El archivo MATRIZ_COMERCIAL_BASE.csv debe existir en docs/reference/');

  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const service = new MasterInitializationService();
  const catalogos = service.construirCatalogos(csvContent);

  const t = catalogos.totalesAuditados;
  assert.strictEqual(t.totalCombinaciones, 438, 'El total de filas combinadas debe ser exactamente 438');
  assert.strictEqual(t.totalArticulos, 162, 'Debe haber exactamente 162 artículos únicos');
  assert.strictEqual(t.totalEnvases, 83, 'Debe haber exactamente 83 envases únicos');
  assert.strictEqual(t.totalHomologadas, 300, 'Debe haber exactamente 300 combinaciones homologadas (CLASIFICADO)');
  assert.strictEqual(t.totalRevisar, 83, 'Debe haber exactamente 83 combinaciones a revisar (REVISAR)');
  assert.strictEqual(t.totalFueraCatalogo, 55, 'Debe haber exactamente 55 combinaciones fuera de catálogo');

  // Verificar aislamiento de las 83 a revisar: 81 sin envase y 2 formato excluido
  const sinEnvaseCount = catalogos.pendientesRevisar.filter(r => !r.envase).length;
  const formatoExcluidoCount = catalogos.pendientesRevisar.filter(r => r.envase).length;
  assert.strictEqual(sinEnvaseCount, 81, 'Exactamente 81 registros de REVISAR deben tener envase vacío (SIN_ENVASE)');
  assert.strictEqual(formatoExcluidoCount, 2, 'Exactamente 2 registros de REVISAR deben ser exclusiones expresas de formato');
});

runTest('3. Enriquecimiento referencial: MAESTRO_BASE.json aporta códigos oficiales sin colisionar con la matriz', () => {
  const jsonPath = path.join(__dirname, '..', 'docs', 'reference', 'MAESTRO_BASE.json');
  assert.ok(fs.existsSync(jsonPath), 'El archivo MAESTRO_BASE.json debe existir en docs/reference/');

  const jsonContent = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');

  const service = new MasterInitializationService();
  const catalogos = service.construirCatalogos(csvContent, jsonContent);

  assert.strictEqual(catalogos.articulos.length, 162);
  assert.strictEqual(catalogos.envases.length, 83);

  // Verificar que artículos con código oficial como 'TOMATE ROSA I' incorporan id oficial 2112000
  const rosaI = catalogos.articulos.find(a => a.nombre === 'TOMATE ROSA I');
  assert.ok(rosaI, 'TOMATE ROSA I debe existir en el catálogo');
  assert.strictEqual(rosaI.id, '2112000', 'TOMATE ROSA I debe adoptar el código oficial 2112000');
});

// -------------------------------------------------------------
// BLOQUE 3: IDEMPOTENCIA Y SEGURIDAD DE LA IMPORTACIÓN
// -------------------------------------------------------------
runTest('4. Carga inicial (Paso 1): Inserta maestros y siembra el catálogo de forma controlada', () => {
  const repo = createInMemoryRepository();
  const service = new MasterInitializationService({ repository: repo });

  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const catalogos = service.construirCatalogos(csvContent);

  const res1 = service.ejecutarCargaInicial(catalogos, { usuario: 'AUDITOR_FASE_8' });

  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.resumen.articulos.insertados, 162);
  assert.strictEqual(res1.resumen.envases.insertados, 83);
  assert.strictEqual(res1.resumen.catalogo.atributos.insertados, 5);
  assert.strictEqual(res1.resumen.catalogo.reglas.insertados, 16);
  assert.strictEqual(res1.resumen.catalogo.agrupaciones.insertados, 11);

  // Verificar contenido persistido (maestros y hojas de catálogo D-029)
  assert.strictEqual(repo.getMaestroArticulos().length, 162);
  assert.strictEqual(repo.getMaestroEnvases().length, 83);
  assert.strictEqual(repo.getAtributos().length, 5);
  assert.strictEqual(repo.getReglasClasificacion().length, 16);
  assert.strictEqual(repo.getAgrupaciones().length, 11);
});

runTest('5. Idempotencia estricta (Paso 2): Segunda ejecución no duplica registros (0 insertados, 0 duplicados)', () => {
  const repo = createInMemoryRepository();
  const service = new MasterInitializationService({ repository: repo });

  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const catalogos = service.construirCatalogos(csvContent);

  // Primera ejecución
  service.ejecutarCargaInicial(catalogos, { usuario: 'AUDITOR_FASE_8' });

  // Segunda ejecución idéntica
  const res2 = service.ejecutarCargaInicial(catalogos, { usuario: 'AUDITOR_FASE_8' });

  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.resumen.articulos.insertados, 0, 'No debe insertar artículos duplicados');
  assert.strictEqual(res2.resumen.articulos.omitidos, 162, 'Debe omitir los 162 artículos existentes');
  assert.strictEqual(res2.resumen.envases.insertados, 0, 'No debe insertar envases duplicados');
  assert.strictEqual(res2.resumen.envases.omitidos, 83, 'Debe omitir los 83 envases existentes');
  assert.strictEqual(res2.resumen.catalogo.atributos.insertados, 0, 'No debe duplicar atributos');
  assert.strictEqual(res2.resumen.catalogo.reglas.insertados, 0, 'No debe duplicar reglas');
  assert.strictEqual(res2.resumen.catalogo.agrupaciones.insertados, 0, 'No debe duplicar agrupaciones');

  // Recuento final idéntico
  assert.strictEqual(repo.getMaestroArticulos().length, 162);
  assert.strictEqual(repo.getMaestroEnvases().length, 83);
  assert.strictEqual(repo.getAtributos().length, 5);
  assert.strictEqual(repo.getReglasClasificacion().length, 16);
  assert.strictEqual(repo.getAgrupaciones().length, 11);
});

runTest('6. Inmutabilidad de inventario: La inicialización de maestros produce exactamente CERO stock, movimientos y capas FIFO', () => {
  const repo = createInMemoryRepository();
  const service = new MasterInitializationService({ repository: repo });

  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const catalogos = service.construirCatalogos(csvContent);

  const res = service.ejecutarCargaInicial(catalogos);

  assert.strictEqual(res.verificacionSeguridadInventario.documentos, 0);
  assert.strictEqual(res.verificacionSeguridadInventario.movimientos, 0);
  assert.strictEqual(res.verificacionSeguridadInventario.capasFifo, 0);
  assert.strictEqual(res.verificacionSeguridadInventario.stockActual, 0);
  assert.strictEqual(res.verificacionSeguridadInventario.inventarioInmutable, true);

  assert.strictEqual(repo.getDocumentos().length, 0, 'La tabla DOCUMENTOS debe permanecer con 0 registros');
  assert.strictEqual(repo.getMovimientos().length, 0, 'La tabla MOVIMIENTOS debe permanecer con 0 registros');
  assert.strictEqual(repo.getCapasFifo().length, 0, 'La tabla CAPAS_FIFO debe permanecer con 0 registros');
  assert.strictEqual(repo.getStockActual().length, 0, 'La tabla STOCK_ACTUAL debe permanecer con 0 registros');
});

runTest('7. Aislamiento estricto: Las combinaciones a revisar y fuera de catálogo no se homologan ni reciben grupos ambiguos', () => {
  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const service = new MasterInitializationService();
  const catalogos = service.construirCatalogos(csvContent);

  // Las 300 homologadas tienen activo: true
  assert.ok(catalogos.matrizHomologada.every(m => m.activo === true));

  // Las 83 a revisar tienen activo: false y observaciones explícitas
  assert.strictEqual(catalogos.pendientesRevisar.length, 83);
  assert.ok(catalogos.pendientesRevisar.every(m => m.activo === false));
  assert.ok(catalogos.pendientesRevisar.every(m => m.observaciones.startsWith('REVISAR:')));

  // Las 55 fuera de catálogo tienen activo: false y observaciones explícitas
  assert.strictEqual(catalogos.fueraCatalogo.length, 55);
  assert.ok(catalogos.fueraCatalogo.every(m => m.activo === false));
  assert.ok(catalogos.fueraCatalogo.every(m => m.observaciones.startsWith('FUERA_CATALOGO:')));
});

runTest('8. Integración con CommercialGroupResolver: Carga limpia de grupos y matriz en el clasificador en vivo', () => {
  const repo = createInMemoryRepository();
  const service = new MasterInitializationService({ repository: repo });

  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const catalogos = service.construirCatalogos(csvContent);

  service.ejecutarCargaInicial(catalogos);

  // Inicializar CommercialGroupResolver desde el repositorio inicializado
  const resolver = new CommercialGroupResolver({ repository: repo });
  const counts = resolver.loadFromRepository(repo);

  assert.strictEqual(counts.vinculado, true);
  assert.strictEqual(resolver.getGroups().length, 7);

  // Validar clasificación de una combinación homologada: Tomate Rosa I M en EPS 106 9x500
  const clasifRosa = resolver.classify('TOMATE ROSA I M', 'EPS 106 9X500');
  assert.strictEqual(clasifRosa.groupId, 'EPS');
  assert.strictEqual(clasifRosa.status, 'CLASIFICADO');

  // Validar clasificación de Tomate Moresco en Cartón con subgrupo MORESCO
  const clasifMoresco = resolver.classify('TOMATE MORESCO I M', 'CT4395 MORESCO');
  assert.strictEqual(clasifMoresco.groupId, 'CARTON');
  assert.strictEqual(clasifMoresco.subgroupId, 'MORESCO');
});

runTest('9. Trazabilidad: La operación se registra en LOG_OPERACIONES con detalle y usuario auditor', () => {
  const repo = createInMemoryRepository();
  const service = new MasterInitializationService({ repository: repo });

  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const catalogos = service.construirCatalogos(csvContent);

  service.ejecutarCargaInicial(catalogos, { usuario: 'JEFE_ALMACEN' });

  const logs = repo.getLogOperaciones();
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].operacion, 'INICIALIZACION_MAESTROS');
  assert.strictEqual(logs[0].usuario, 'JEFE_ALMACEN');
  assert.strictEqual(logs[0].estado, 'COMPLETADO');
  assert.strictEqual(logs[0].referencia, 'T-005');
});

runTest('10. Invariante Innegociable: InventoryEngine.js permanece 100% inalterado respecto a Git HEAD', () => {
  const diff = execSync('git diff -- src/InventoryEngine.js', { encoding: 'utf8' });
  assert.strictEqual(diff.trim(), '', 'InventoryEngine.js NO debe contener modificaciones');
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE FASE 8.0: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
