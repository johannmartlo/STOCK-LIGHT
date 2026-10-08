/**
 * STOCK-LIGHT — Test Suite FASE 4: Clasificación Comercial y Stock Visual
 * 
 * Verifica rigurosamente las reglas de negocio y arquitectura de CommercialGroupResolver
 * y su integración visual en StockQueryService:
 * 
 * 1. Envase EPS -> grupo TOMATE EN CAJA EPS.
 * 2. Artículo HUEVO DE TORO -> grupo TOMATE HUEVO DE TORO.
 * 3. Artículo VOLLEY -> grupo TOMATE VOLLEY Y CORAZÓN DE BUEY (1ª categoría).
 * 4. Artículo CORAZÓN DE BUEY -> grupo TOMATE VOLLEY Y CORAZÓN DE BUEY (2ª categoría).
 * 5. Artículo JAPI -> grupo TOMATE JAPI Y JAPONÉS (1ª categoría).
 * 6. Artículo JAPONÉS -> grupo TOMATE JAPI Y JAPONÉS (categoría inferior).
 * 7. AZUL + CARTÓN -> TOMATES EN CAJA DE CARTÓN / subgrupo AZUL.
 * 8. ROSA + CARTÓN -> TOMATES EN CAJA DE CARTÓN / subgrupo ROSA.
 * 9. MORESCO + CARTÓN -> TOMATES EN CAJA DE CARTÓN / subgrupo MORESCO.
 * 10. Tomate en cartón no especial -> TOMATES EN CAJA DE CARTÓN / subgrupo OTROS.
 * 11. Combinaciones Carrefour válidas -> CARREFOUR (incluso con envases EPS o IFCO).
 * 12. Combinación no conocida -> NO_CLASIFICADO / PENDIENTE_ASIGNACION.
 * 13. Extensibilidad dinámica: futuras asociaciones pueden añadirse sin modificar el resolver.
 * 14. Prioridad de configuración: asociación explícita tiene prioridad sobre clasificación genérica.
 * 15. Formatos excluidos: VOLLEY formato 40x30x11 excluido comercialmente -> status REVISAR.
 * 16. Prioridad EPS sobre artículo: HUEVO DE TORO o JAPONÉS en EPS -> clasifica en EPS.
 * 17. Extracción de Calibre y Categoría para detalle visual comercial.
 * 18. StockQueryService.obtenerStockVisualResumen() genera árbol jerárquico responsivo con subtotales.
 * 19. StockQueryService.obtenerStockVisualDetalle() llega a nivel Artículo + Envase + Calibre/Categoría + Cajas.
 * 20. InventoryEngine.js permanece 100% inalterado respecto a Git HEAD.
 * 
 * Ejecutable: `node test/commercial_group_resolver.test.js`
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  CommercialGroupResolver,
  COMMERCIAL_GROUPS,
  extraerCalibreYCategoria,
  normalizeCommercialText
} = require('../src/CommercialGroupResolver');

const { StockQueryService } = require('../src/StockQueryService');

console.log('================================================================');
console.log(' TEST SUITE FASE 4 — CLASIFICACIÓN COMERCIAL & STOCK VISUAL');
console.log('================================================================\n');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
    failedTests++;
  }
}

// --------------------------------------------------------------------------
// TEST 1: EPS -> grupo TOMATE EN CAJA EPS
// --------------------------------------------------------------------------
runTest('1. EPS -> clasifica en grupo TOMATE EN CAJA EPS', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE RAMA I M', 'EPS 106');

  assert.strictEqual(res.groupId, 'EPS');
  assert.strictEqual(res.groupName, 'TOMATE EN CAJA EPS');
  assert.strictEqual(res.subgroupId, null);
  assert.strictEqual(res.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 2: HUEVO DE TORO -> grupo TOMATE HUEVO DE TORO
// --------------------------------------------------------------------------
runTest('2. HUEVO DE TORO -> clasifica en grupo TOMATE HUEVO DE TORO', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE HUEVO DE TORO ROJO I GG', 'MADERA 40X30X11 TOMATES DE AUTOR');

  assert.strictEqual(res.groupId, 'HUEVO_TORO');
  assert.strictEqual(res.groupName, 'TOMATE HUEVO DE TORO');
  assert.strictEqual(res.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 3: VOLLEY -> grupo VOLLEY (1ª categoría)
// --------------------------------------------------------------------------
runTest('3. VOLLEY -> clasifica en grupo TOMATE VOLLEY Y CORAZÓN DE BUEY como 1ª categoría', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE VOLLEY I G', 'CARTON 60X40X11 VOLLEY HD Q5');

  assert.strictEqual(res.groupId, 'VOLLEY');
  assert.strictEqual(res.groupName, 'TOMATE VOLLEY Y CORAZÓN DE BUEY');
  assert.strictEqual(res.categoria, '1ª CATEGORÍA (I)');
  assert.strictEqual(res.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 4: CORAZÓN DE BUEY -> grupo VOLLEY (2ª categoría)
// --------------------------------------------------------------------------
runTest('4. CORAZÓN DE BUEY -> clasifica en grupo TOMATE VOLLEY Y CORAZÓN DE BUEY como 2ª categoría', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE CORAZON DE BUEY II GG', 'CARTON 60X40X11 NATURFRESH');

  assert.strictEqual(res.groupId, 'VOLLEY');
  assert.strictEqual(res.groupName, 'TOMATE VOLLEY Y CORAZÓN DE BUEY');
  assert.strictEqual(res.categoria, '2ª CATEGORÍA (II)');
  assert.strictEqual(res.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 5: JAPI -> grupo JAPI / JAPONÉS (1ª categoría)
// --------------------------------------------------------------------------
runTest('5. JAPI -> clasifica en grupo TOMATE JAPI Y JAPONÉS como 1ª categoría', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE JAPI I M', 'CARTON 40X30X8 JAPI');

  assert.strictEqual(res.groupId, 'JAPI_JAPONES');
  assert.strictEqual(res.groupName, 'TOMATE JAPI Y JAPONÉS');
  assert.strictEqual(res.categoria, '1ª CATEGORÍA (I)');
  assert.strictEqual(res.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 6: JAPONÉS -> grupo JAPI / JAPONÉS (categoría inferior)
// --------------------------------------------------------------------------
runTest('6. JAPONÉS -> clasifica en grupo TOMATE JAPI Y JAPONÉS como categoría inferior', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE JAPONES II S/C', 'MADERA 40X30X8 GENERICA');

  assert.strictEqual(res.groupId, 'JAPI_JAPONES');
  assert.strictEqual(res.groupName, 'TOMATE JAPI Y JAPONÉS');
  assert.strictEqual(res.categoria, '2ª CATEGORÍA (II)');
  assert.strictEqual(res.calibre, 'S/C');
  assert.strictEqual(res.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 7: AZUL + CARTÓN -> CARTÓN / AZUL
// --------------------------------------------------------------------------
runTest('7. AZUL + CARTÓN -> clasifica en TOMATES EN CAJA DE CARTÓN con subgrupo AZUL', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE AZUL I G', 'CARTON 60X40X11 HARLEM');

  assert.strictEqual(res.groupId, 'CARTON');
  assert.strictEqual(res.groupName, 'TOMATES EN CAJA DE CARTÓN');
  assert.strictEqual(res.subgroupId, 'AZUL');
  assert.strictEqual(res.subgroupName, 'AZUL');
  assert.strictEqual(res.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 8: ROSA + CARTÓN -> CARTÓN / ROSA
// --------------------------------------------------------------------------
runTest('8. ROSA + CARTÓN -> clasifica en TOMATES EN CAJA DE CARTÓN con subgrupo ROSA', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE ROSA ASURCADO I GG', 'CARTON 40X30X9.5 ROYAL PINK');

  assert.strictEqual(res.groupId, 'CARTON');
  assert.strictEqual(res.groupName, 'TOMATES EN CAJA DE CARTÓN');
  assert.strictEqual(res.subgroupId, 'ROSA');
  assert.strictEqual(res.subgroupName, 'ROSA');
  assert.strictEqual(res.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 9: MORESCO + CARTÓN -> CARTÓN / MORESCO
// --------------------------------------------------------------------------
runTest('9. MORESCO + CARTÓN -> clasifica en TOMATES EN CAJA DE CARTÓN con subgrupo MORESCO', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE MORESCO I M', 'CARTON 40X30X9,5 MORESCO');

  assert.strictEqual(res.groupId, 'CARTON');
  assert.strictEqual(res.groupName, 'TOMATES EN CAJA DE CARTÓN');
  assert.strictEqual(res.subgroupId, 'MORESCO');
  assert.strictEqual(res.subgroupName, 'MORESCO');
  assert.strictEqual(res.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 10: Tomate de cartón no especial -> CARTÓN / OTROS
// --------------------------------------------------------------------------
runTest('10. Tomate de cartón no especial -> clasifica en TOMATES EN CAJA DE CARTÓN con subgrupo OTROS', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE ASURCADO I G', 'CARTON 40X30X14 GENERICA');

  assert.strictEqual(res.groupId, 'CARTON');
  assert.strictEqual(res.groupName, 'TOMATES EN CAJA DE CARTÓN');
  assert.strictEqual(res.subgroupId, 'OTROS');
  assert.strictEqual(res.subgroupName, 'OTROS');
  assert.strictEqual(res.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 11: Combinaciones Carrefour válidas -> CARREFOUR
// --------------------------------------------------------------------------
runTest('11. Combinaciones Carrefour válidas -> clasifica en grupo independiente CARREFOUR', () => {
  const resolver = new CommercialGroupResolver();

  // A. Tomate Cocktail en cartón Carrefour
  const res1 = resolver.resolve('TOMATE COCKTAIL I M', 'CARTON 40X30X14 GENERICA');
  assert.strictEqual(res1.groupId, 'CARREFOUR');
  assert.strictEqual(res1.groupName, 'CARREFOUR');
  assert.strictEqual(res1.status, 'CLASIFICADO');

  // B. Tomate Pera Rama en IFCO Carrefour
  const res2 = resolver.resolve('TOMATE PERA RAMA I M', 'IFCO 6410 10X500');
  assert.strictEqual(res2.groupId, 'CARREFOUR');
  assert.strictEqual(res2.status, 'CLASIFICADO');

  // C. Tomate Cocktail Sunstream en EPS Carrefour (asociación específica Carrefour)
  const res3 = resolver.resolve('TOMATE COCKTAIL SUNSTREAM I M', 'EPS 154 10X225');
  assert.strictEqual(res3.groupId, 'CARREFOUR');
  assert.strictEqual(res3.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 12: Combinación no conocida -> PENDIENTE DE ASOCIACIÓN
// --------------------------------------------------------------------------
runTest('12. Combinación no conocida -> devuelve PENDIENTE DE ASOCIACIÓN sin inventar grupo', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('PEPINO ALMERIA EXTRA', 'PALET 120X80');

  assert.strictEqual(res.groupId, 'NO_CLASIFICADO');
  assert.strictEqual(res.groupName, 'PENDIENTE DE ASOCIACIÓN');
  assert.strictEqual(res.subgroupId, null);
  assert.strictEqual(res.status, 'PENDIENTE_ASOCIACION');
  assert.strictEqual(res.ruleId, 'FALLBACK_PENDIENTE_ASOCIACION');
});

// --------------------------------------------------------------------------
// TEST 13: Futuras asociaciones pueden añadirse sin modificar el resolver
// --------------------------------------------------------------------------
runTest('13. Extensibilidad dinámica: futuras asociaciones se añaden sin alterar código', () => {
  const resolver = new CommercialGroupResolver();

  // Combinación inicialmente no clasificada
  const pre = resolver.resolve('TOMATE NUEVA VARIEDAD', 'ENVASE EXPERIMENTAL');
  assert.strictEqual(pre.groupId, 'NO_CLASIFICADO');

  // Añadir asociación dinámica
  resolver.addAssociation('TOMATE NUEVA VARIEDAD', 'ENVASE EXPERIMENTAL', {
    groupId: 'CARTON',
    subgroupId: 'AZUL',
    status: 'CLASIFICADO',
    ruleId: 'ASOCIACION_CAMPAÑA_2027'
  });

  const post = resolver.resolve('TOMATE NUEVA VARIEDAD', 'ENVASE EXPERIMENTAL');
  assert.strictEqual(post.groupId, 'CARTON');
  assert.strictEqual(post.subgroupId, 'AZUL');
  assert.strictEqual(post.ruleId, 'ASOCIACION_CAMPAÑA_2027');
  assert.strictEqual(post.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 14: Asociación explícita tiene prioridad sobre clasificación genérica
// --------------------------------------------------------------------------
runTest('14. Asociación explícita tiene prioridad sobre regla genérica cuando la configuración lo determina', () => {
  const resolver = new CommercialGroupResolver();

  // TOMATE COCKTAIL SUNSTREAM I M con EPS 154 normalmente caería en regla genérica EPS (Prioridad 20),
  // pero la matriz validada contiene la asociación explícita a CARREFOUR (Prioridad 10 / Matriz):
  const resCarrefour = resolver.resolve('TOMATE COCKTAIL SUNSTREAM I M', 'EPS 154 10X225');
  assert.strictEqual(resCarrefour.groupId, 'CARREFOUR');

  // Supongamos que se asocia explícitamente un artículo de Huevo de Toro a una promoción especial
  resolver.addAssociation('TOMATE HUEVO DE TORO AMARILLO I G', 'MADERA ESPECIAL VIP', {
    groupId: 'CARREFOUR',
    status: 'CLASIFICADO',
    ruleId: 'REGLA_PROMO_VIP'
  });

  const resPromo = resolver.resolve('TOMATE HUEVO DE TORO AMARILLO I G', 'MADERA ESPECIAL VIP');
  assert.strictEqual(resPromo.groupId, 'CARREFOUR');
  assert.strictEqual(resPromo.ruleId, 'REGLA_PROMO_VIP');
});

// --------------------------------------------------------------------------
// TEST 15: Formatos excluidos de Volley clasificados como REVISAR
// --------------------------------------------------------------------------
runTest('15. Formatos de Volley excluidos comercialmente (40x30x11) -> status REVISAR', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE VOLLEY I GG', 'CARTON 40X30X11 VOLLEY HD Q5');

  assert.strictEqual(res.status, 'REVISAR');
  assert.strictEqual(res.groupId, 'NO_CLASIFICADO');
  assert.strictEqual(res.ruleId, 'VOLLEY_FORMATO_EXCLUIDO');
});

// --------------------------------------------------------------------------
// TEST 16: Prioridad de EPS sobre clasificación genérica de artículo
// --------------------------------------------------------------------------
runTest('16. Si HUEVO DE TORO o JAPONÉS aparece en EPS -> clasifica automáticamente en EPS', () => {
  const resolver = new CommercialGroupResolver();

  // Sin asociación en la matriz, por regla declarativa el envase EPS (Prioridad 20)
  // tiene precedencia sobre la regla de artículo Huevo de Toro (Prioridad 30) y Japonés (Prioridad 50):
  const resHuevoToroEPS = resolver.resolve('TOMATE HUEVO DE TORO NUEVO', 'EPS 104');
  assert.strictEqual(resHuevoToroEPS.groupId, 'EPS');
  assert.strictEqual(resHuevoToroEPS.groupName, 'TOMATE EN CAJA EPS');

  const resJaponesEPS = resolver.resolve('TOMATE JAPONES EXPERIMENTAL', 'EPS 154');
  assert.strictEqual(resJaponesEPS.groupId, 'EPS');
  assert.strictEqual(resJaponesEPS.groupName, 'TOMATE EN CAJA EPS');
});

// --------------------------------------------------------------------------
// TEST 17: Extracción precisa de Calibre y Categoría
// --------------------------------------------------------------------------
runTest('17. Extracción precisa de Calibre y Categoría comercial', () => {
  const t1 = extraerCalibreYCategoria('TOMATE ROSA ASURCADO I GG');
  assert.strictEqual(t1.categoria, '1ª CATEGORÍA (I)');
  assert.strictEqual(t1.calibre, 'GG');

  const t2 = extraerCalibreYCategoria('TOMATE JAPONES II S/C');
  assert.strictEqual(t2.categoria, '2ª CATEGORÍA (II)');
  assert.strictEqual(t2.calibre, 'S/C');

  const t3 = extraerCalibreYCategoria('TOMATE VOLLEY I G');
  assert.strictEqual(t3.categoria, '1ª CATEGORÍA (I)');
  assert.strictEqual(t3.calibre, 'G');

  const t4 = extraerCalibreYCategoria('TOMATE CORAZON DE BUEY II GGG');
  assert.strictEqual(t4.categoria, '2ª CATEGORÍA (II)');
  assert.strictEqual(t4.calibre, 'GGG');

  const t5 = extraerCalibreYCategoria('TOMATE ROSA YARIMARU EXTRA');
  assert.strictEqual(t5.categoria, 'EXTRA');
});

// --------------------------------------------------------------------------
// TEST 18: StockQueryService.obtenerStockVisualResumen()
// --------------------------------------------------------------------------
runTest('18. StockQueryService.obtenerStockVisualResumen() genera árbol jerárquico visual', () => {
  const stockMock = [
    { stock_key: '2112000|EPS104', codigo_articulo: '2112000', nombre_articulo: 'TOMATE ROSA I', codigo_envase: 'EPS104', descripcion_envase: 'EPS 104', cajas_actuales: 100 },
    { stock_key: '2112005|CT4395', codigo_articulo: '2112005', nombre_articulo: 'TOMATE MORESCO I M', codigo_envase: 'CT4395', descripcion_envase: 'CARTON 40X30X9,5 MORESCO', cajas_actuales: 250 },
    { stock_key: '2112008|CARTON', codigo_articulo: '2112008', nombre_articulo: 'TOMATE AZUL I G', codigo_envase: 'CARTON', descripcion_envase: 'CARTON 60X40X11 HARLEM', cajas_actuales: 80 },
    { stock_key: '2112010|CARTON', codigo_articulo: '2112010', nombre_articulo: 'TOMATE COCKTAIL I M', codigo_envase: 'CARTON', descripcion_envase: 'CARTON 40X30X14 GENERICA', cajas_actuales: 300 }
  ];

  const service = new StockQueryService({ stockActual: stockMock });
  const resumen = service.obtenerStockVisualResumen();

  assert.ok(Array.isArray(resumen.grupos), 'Debe devolver array de grupos');
  assert.strictEqual(resumen.granTotalCajas, 730);
  assert.strictEqual(resumen.granTotalLineas, 4);

  // Verificar grupo EPS
  const grpEps = resumen.grupos.find(g => g.groupId === 'EPS');
  assert.ok(grpEps);
  assert.strictEqual(grpEps.totalCajas, 100);

  // Verificar grupo CARTON y sus subgrupos
  const grpCarton = resumen.grupos.find(g => g.groupId === 'CARTON');
  assert.ok(grpCarton);
  assert.strictEqual(grpCarton.totalCajas, 330); // 250 (MORESCO) + 80 (AZUL)

  const subMoresco = grpCarton.subgrupos.find(s => s.subgroupId === 'MORESCO');
  assert.ok(subMoresco);
  assert.strictEqual(subMoresco.totalCajas, 250);

  const subAzul = grpCarton.subgrupos.find(s => s.subgroupId === 'AZUL');
  assert.ok(subAzul);
  assert.strictEqual(subAzul.totalCajas, 80);

  // Verificar grupo CARREFOUR
  const grpCarrefour = resumen.grupos.find(g => g.groupId === 'CARREFOUR');
  assert.ok(grpCarrefour);
  assert.strictEqual(grpCarrefour.totalCajas, 300);
});

// --------------------------------------------------------------------------
// TEST 19: StockQueryService.obtenerStockVisualDetalle()
// --------------------------------------------------------------------------
runTest('19. StockQueryService.obtenerStockVisualDetalle() desglosa hasta Artículo + Envase + Calibre/Categoría + Cajas', () => {
  const stockMock = [
    { stock_key: '2112005|CT4395', codigo_articulo: '2112005', nombre_articulo: 'TOMATE MORESCO I M', codigo_envase: 'CT4395', descripcion_envase: 'CARTON 40X30X9,5 MORESCO', cajas_actuales: 150 },
    { stock_key: '2112006|CT4395', codigo_articulo: '2112006', nombre_articulo: 'TOMATE MORESCO I GG', codigo_envase: 'CT4395', descripcion_envase: 'CARTON 40X30X9,5 MORESCO', cajas_actuales: 50 },
    { stock_key: '2112008|CARTON', codigo_articulo: '2112008', nombre_articulo: 'TOMATE AZUL I G', codigo_envase: 'CARTON', descripcion_envase: 'CARTON 60X40X11 HARLEM', cajas_actuales: 80 }
  ];

  const service = new StockQueryService({ stockActual: stockMock });

  // Detalle subgrupo MORESCO en CARTON
  const detalleMoresco = service.obtenerStockVisualDetalle('CARTON', 'MORESCO');
  assert.strictEqual(detalleMoresco.groupId, 'CARTON');
  assert.strictEqual(detalleMoresco.subgroupId, 'MORESCO');
  assert.strictEqual(detalleMoresco.totalCajas, 200);
  assert.strictEqual(detalleMoresco.lineas.length, 2);

  // Verificar que incluye calibre y categoría desglosados
  const l1 = detalleMoresco.lineas.find(l => l.nombreArticulo.includes(' I M'));
  assert.ok(l1);
  assert.strictEqual(l1.calibre, 'M');
  assert.strictEqual(l1.categoria, '1ª CATEGORÍA (I)');
  assert.strictEqual(l1.cajas, 150);

  const l2 = detalleMoresco.lineas.find(l => l.nombreArticulo.includes(' I GG'));
  assert.ok(l2);
  assert.strictEqual(l2.calibre, 'GG');
  assert.strictEqual(l2.categoria, '1ª CATEGORÍA (I)');
  assert.strictEqual(l2.cajas, 50);
});

// --------------------------------------------------------------------------
// TEST 20: InventoryEngine permanece 100% inalterado
// --------------------------------------------------------------------------
runTest('20. InventoryEngine.js permanece 100% inalterado respecto a Git HEAD', () => {
  const enginePath = path.join(__dirname, '..', 'src', 'InventoryEngine.js');
  assert.ok(fs.existsSync(enginePath), 'InventoryEngine.js debe existir');

  const diff = execSync('git diff HEAD -- src/InventoryEngine.js', {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.strictEqual(diff.trim(), '', 'InventoryEngine.js NO debe tener ninguna modificación respecto a HEAD');
});

// --------------------------------------------------------------------------
// TEST 21: Combinación histórica no contemplada -> PENDIENTE DE ASOCIACIÓN
// --------------------------------------------------------------------------
runTest('21. Combinación histórica no contemplada -> NO crear automáticamente, marcar como PENDIENTE DE ASOCIACIÓN', () => {
  const resolver = new CommercialGroupResolver();
  
  // Combinación simulada del histórico de ventas que nunca estuvo en la matriz
  const res = resolver.resolve('TOMATE CHERRY PERA EXOTICO HISTORICO', 'ENVASE OBSOLETO 2021');

  assert.strictEqual(res.groupId, 'NO_CLASIFICADO');
  assert.strictEqual(res.groupName, 'PENDIENTE DE ASOCIACIÓN');
  assert.strictEqual(res.status, 'PENDIENTE_ASOCIACION');
  assert.strictEqual(res.ruleId, 'FALLBACK_PENDIENTE_ASOCIACION');
});

// --------------------------------------------------------------------------
// TEST 22: loadHistoricalCatalog ingesta catálogo adicional sin tocar arquitectura
// --------------------------------------------------------------------------
runTest('22. loadHistoricalCatalog() ingesta catálogo adicional preservando validados y marcando nuevos como PENDIENTE DE ASOCIACIÓN', () => {
  const resolver = new CommercialGroupResolver();

  // Histórico con una combinación ya validada (TOMATE RAMA I M en EPS 106)
  // y dos combinaciones históricas no contempladas en las asociaciones actuales
  const catalogoHistorico = [
    { articulo: 'TOMATE RAMA I M', envase: 'EPS 106' }, // ya validado -> EPS
    { articulo: 'TOMATE KUMATO ESPECIAL HISTORICO', envase: 'CARTON 30X20 RETRO' }, // no contemplada -> PENDIENTE
    { articulo: 'TOMATE MINI CIRUELA HISTORICO', envase: 'TARRINA 250G DESCATALOGADA' } // no contemplada -> PENDIENTE
  ];

  const resultado = resolver.loadHistoricalCatalog(catalogoHistorico);
  assert.strictEqual(resultado.totalProcesados, 3);
  assert.strictEqual(resultado.existentesValidados, 1);
  assert.strictEqual(resultado.nuevosPendientes, 2);

  // Verificar resolución de la combinación ya validada: mantiene EPS
  const resValidada = resolver.resolve('TOMATE RAMA I M', 'EPS 106');
  assert.strictEqual(resValidada.groupId, 'EPS');
  assert.strictEqual(resValidada.status, 'CLASIFICADO');

  // Verificar resolución de las no contempladas: PENDIENTE DE ASOCIACIÓN
  const resPendiente1 = resolver.resolve('TOMATE KUMATO ESPECIAL HISTORICO', 'CARTON 30X20 RETRO');
  assert.strictEqual(resPendiente1.groupId, 'NO_CLASIFICADO');
  assert.strictEqual(resPendiente1.groupName, 'PENDIENTE DE ASOCIACIÓN');
  assert.strictEqual(resPendiente1.status, 'PENDIENTE_ASOCIACION');
  assert.strictEqual(resPendiente1.ruleId, 'HISTORICO_PENDIENTE_ASOCIACION');

  const resPendiente2 = resolver.resolve('TOMATE MINI CIRUELA HISTORICO', 'TARRINA 250G DESCATALOGADA');
  assert.strictEqual(resPendiente2.groupName, 'PENDIENTE DE ASOCIACIÓN');
  assert.strictEqual(resPendiente2.status, 'PENDIENTE_ASOCIACION');
});

// --------------------------------------------------------------------------
// TEST 23: getCombinacionesPendientes extrae items para revisión por supervisor
// --------------------------------------------------------------------------
runTest('23. getCombinacionesPendientes() extrae lista de items pendientes para posterior revisión', () => {
  const resolver = new CommercialGroupResolver();

  resolver.loadHistoricalCatalog([
    { articulo: 'TOMATE RAF HISTORICO 2019', envase: 'CAJA MADERA VINTAGE' }
  ]);

  const pendientes = resolver.getCombinacionesPendientes();
  assert.ok(Array.isArray(pendientes));
  const encontrado = pendientes.find(p => p.articulo === 'TOMATE RAF HISTORICO 2019');
  assert.ok(encontrado, 'Debe encontrar la combinación histórica en pendientes');
  assert.strictEqual(encontrado.status, 'PENDIENTE_ASOCIACION');
  assert.strictEqual(encontrado.groupName, 'PENDIENTE DE ASOCIACIÓN');
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE FASE 4: ${passedTests} SUPERADAS | ${failedTests} FALLIDAS`);
console.log('================================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
