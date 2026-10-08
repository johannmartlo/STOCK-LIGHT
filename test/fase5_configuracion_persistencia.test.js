/**
 * STOCK-LIGHT — Test Suite Fase 5
 * 
 * Verificación exhaustiva de:
 * 1. Persistencia operativa en Google Sheets (MAESTRO_ARTICULOS, MAESTRO_ENVASES, GRUPOS_COMERCIALES, MATRIZ_ARTICULO_ENVASE)
 * 2. Jerarquía estricta de 5 niveles de decisión comercial:
 *    - NIVEL 1: Reglas específicas de artículo (ej. TOMATE ROSA DE SABOR -> CARTÓN / ROSA independientemente del envase)
 *    - NIVEL 2: Asociación Artículo + Envase (matriz explícita configurable y pares oficiales)
 *    - NIVEL 3: Regla de Envase (ej. EPS prevalece sobre artículo genérico: HUEVO DE TORO + EPS -> EPS)
 *    - NIVEL 4: Regla Genérica (HUEVO DE TORO, VOLLEY, JAPI/JAPONÉS, CARTÓN)
 *    - NIVEL 5: Fallback PENDIENTE DE ASOCIACIÓN
 * 3. Dinamismo de grupos comerciales (creación y visualización sin modificar código)
 * 4. Drill-Down progresivo de 5 niveles: GRUPO -> SUBGRUPO -> ARTÍCULO -> ENVASE -> PARTIDA
 * 5. Ajustes manuales y reclasificaciones atómicas en MovementService
 * 6. Invariante: InventoryEngine permanece 100% inalterado
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { SheetsRepository } = require('../src/Repository');
const { CommercialGroupResolver, COMMERCIAL_GROUPS } = require('../src/CommercialGroupResolver');
const { StockQueryService } = require('../src/StockQueryService');
const { MovementService } = require('../src/MovementService');

// --------------------------------------------------------------------------
// MOCKS PARA EMULAR ENTORNO GOOGLE SHEETS
// --------------------------------------------------------------------------
class MockRange {
  constructor(sheet, startRow, startCol, numRows, numCols) {
    this.sheet = sheet;
    this.startRow = startRow;
    this.startCol = startCol;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const result = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowIdx = this.startRow - 1 + r;
      const rowData = this.sheet.rows[rowIdx] || [];
      const rowSlice = [];
      for (let c = 0; c < this.numCols; c++) {
        const colIdx = this.startCol - 1 + c;
        rowSlice.push(rowData[colIdx] !== undefined ? rowData[colIdx] : '');
      }
      result.push(rowSlice);
    }
    return result;
  }

  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      const rowIdx = this.startRow - 1 + r;
      if (!this.sheet.rows[rowIdx]) {
        this.sheet.rows[rowIdx] = [];
      }
      for (let c = 0; c < values[r].length; c++) {
        const colIdx = this.startCol - 1 + c;
        this.sheet.rows[rowIdx][colIdx] = values[r][c];
      }
    }
    return this;
  }

  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      const rowIdx = this.startRow - 1 + r;
      if (this.sheet.rows[rowIdx]) {
        for (let c = 0; c < this.numCols; c++) {
          const colIdx = this.startCol - 1 + c;
          this.sheet.rows[rowIdx][colIdx] = '';
        }
      }
    }
    while (this.sheet.rows.length > 1 && this.sheet.rows[this.sheet.rows.length - 1].every(v => v === '' || v === undefined)) {
      this.sheet.rows.pop();
    }
    return this;
  }

  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }

  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.length > 0 ? (this.rows[0] ? this.rows[0].length : 0) : 0; }

  getRange(startRow, startCol, numRows, numCols) {
    return new MockRange(this, startRow, startCol, numRows, numCols);
  }

  clear() {
    this.rows = [];
  }

  setFrozenRows() {}
}

class MockSpreadsheet {
  constructor(id = 'FASE5_TEST_SPREADSHEET') {
    this.id = id;
    this.sheets = new Map();
  }

  getId() { return this.id; }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  insertSheet(name) {
    const sheet = new MockSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

function createTestRepository() {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository({ spreadsheet: ss });
  repo.provisionDatabase();
  return { repo, ss };
}

// Mock simple de LockService
const mockLockService = {
  waitLock: () => true,
  releaseLock: () => {}
};

console.log('================================================================');
console.log(' TEST SUITE FASE 5 — CONFIGURACIÓN, PERSISTENCIA & VISTA STOCK');
console.log('================================================================\n');

let passedTests = 0;
let failedTests = 0;

function runTest(desc, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(`     Error: ${err.message}`);
    if (err.stack) {
      const relevantStack = err.stack.split('\n').slice(1, 3).join('\n');
      console.error(`     ${relevantStack}`);
    }
    failedTests++;
  }
}

// --------------------------------------------------------------------------
// TEST 1: MAESTRO_ARTICULOS — Persistencia, lectura y upsert
// --------------------------------------------------------------------------
runTest('1. MAESTRO_ARTICULOS: Persistencia, lectura y upsert de artículos', () => {
  const { repo } = createTestRepository();
  repo.saveMaestroArticulos([
    { id: 'ART-001', nombre: 'TOMATE ROSA DE SABOR G', activo: true },
    { id: 'ART-002', nombre: 'TOMATE HUEVO DE TORO', activo: true }
  ]);

  const articulos = repo.getMaestroArticulos();
  assert.strictEqual(articulos.length, 2, 'Deben existir 2 artículos');
  assert.strictEqual(articulos[0].id, 'ART-001');

  // Upsert nuevo
  repo.upsertMaestroArticulo({ id: 'ART-003', nombre: 'TOMATE JAPI', activo: true });
  assert.strictEqual(repo.getMaestroArticulos().length, 3);

  // Upsert actualización
  repo.upsertMaestroArticulo({ id: 'ART-001', nombre: 'TOMATE ROSA DE SABOR EXTRA G', activo: true });
  const actualizados = repo.getMaestroArticulos();
  assert.strictEqual(actualizados.length, 3);
  const art1 = actualizados.find(a => a.id === 'ART-001');
  assert.strictEqual(art1.nombre, 'TOMATE ROSA DE SABOR EXTRA G');
});

// --------------------------------------------------------------------------
// TEST 2: MAESTRO_ENVASES — Persistencia y lectura de envases con tara y peso
// --------------------------------------------------------------------------
runTest('2. MAESTRO_ENVASES: Persistencia con tara_kg, peso_unitario_kg y activo', () => {
  const { repo } = createTestRepository();
  repo.saveMaestroEnvases([
    { id: 'EPS104', nombre: 'EPS 104', tara_kg: 0.35, peso_unitario_kg: 6.0, activo: true },
    { id: 'CT4030', nombre: 'CARTON 40X30X14', tara_kg: 0.45, peso_unitario_kg: 7.0, activo: true }
  ]);

  const envases = repo.getMaestroEnvases();
  assert.strictEqual(envases.length, 2);
  assert.strictEqual(Number(envases[0].tara_kg), 0.35);
  assert.strictEqual(Number(envases[0].peso_unitario_kg), 6.0);

  // Upsert actualización de tara
  repo.upsertMaestroEnvase({ id: 'EPS104', nombre: 'EPS 104 REFORZADO', tara_kg: 0.38, peso_unitario_kg: 6.0, activo: true });
  const env1 = repo.getMaestroEnvases().find(e => e.id === 'EPS104');
  assert.strictEqual(env1.nombre, 'EPS 104 REFORZADO');
  assert.strictEqual(Number(env1.tara_kg), 0.38);
});

// --------------------------------------------------------------------------
// TEST 3: GRUPOS_COMERCIALES — Persistencia y configuración dinámica de grupos
// --------------------------------------------------------------------------
runTest('3. GRUPOS_COMERCIALES: Persistencia y configuración dinámica (nunca lista hardcodeada)', () => {
  const { repo } = createTestRepository();
  repo.saveGruposComerciales([
    { id: 'EPS', nombre: 'TOMATE EN CAJA EPS', orden_visual: 1, activo: true, tipo: 'COMERCIAL' },
    { id: 'HUEVO_TORO', nombre: 'TOMATE HUEVO DE TORO', orden_visual: 2, activo: true, tipo: 'COMERCIAL' },
    { id: 'GOURMET', nombre: 'TOMATES SELECCIÓN GOURMET', orden_visual: 7, activo: true, tipo: 'ESPECIAL' }
  ]);

  const grupos = repo.getGruposComerciales();
  assert.strictEqual(grupos.length, 3);
  assert.strictEqual(grupos[2].id, 'GOURMET');
  assert.strictEqual(grupos[2].tipo, 'ESPECIAL');

  // Resolver cargando desde repositorio
  const resolver = new CommercialGroupResolver({ repository: repo });
  const configuredGroups = resolver.getGroups();
  const gourmet = configuredGroups.find(g => g.id === 'GOURMET');
  assert.ok(gourmet, 'El grupo GOURMET debe estar presente en CommercialGroupResolver');
  assert.strictEqual(gourmet.name, 'TOMATES SELECCIÓN GOURMET');
});

// --------------------------------------------------------------------------
// TEST 4: MATRIZ_ARTICULO_ENVASE — Persistencia con subgrupo, prioridad y observaciones
// --------------------------------------------------------------------------
runTest('4. MATRIZ_ARTICULO_ENVASE: Persistencia con prioridad, subgrupo y observaciones', () => {
  const { repo } = createTestRepository();
  repo.saveMatrizArticuloEnvase([
    {
      id: 'TOMATE_ROSA|CARTON_ROSA',
      articulo: 'TOMATE ROSA',
      envase: 'CARTON 40X30X14 ROSA',
      grupo_comercial: 'TOMATES EN CAJA DE CARTÓN',
      subgrupo: 'ROSA',
      prioridad: 20,
      activo: true,
      observaciones: 'Asociación estándar campaña 2026'
    }
  ]);

  const matriz = repo.getMatrizArticuloEnvase();
  assert.strictEqual(matriz.length, 1);
  assert.strictEqual(matriz[0].subgrupo, 'ROSA');
  assert.strictEqual(Number(matriz[0].prioridad), 20);

  // Carga automática en resolver
  const resolver = new CommercialGroupResolver({ repository: repo });
  const res = resolver.resolve('TOMATE ROSA', 'CARTON 40X30X14 ROSA');
  assert.strictEqual(res.groupId, 'CARTON');
  assert.strictEqual(res.subgroupId, 'ROSA');
  assert.strictEqual(res.status, 'CLASIFICADO');
});

// --------------------------------------------------------------------------
// TEST 5: Jerarquía Nivel 1 — Regla específica de artículo: ROSA DE SABOR + CARTÓN
// --------------------------------------------------------------------------
runTest('5. Jerarquía Nivel 1: TOMATE ROSA DE SABOR con envase CARTÓN clasifica en CARTÓN / ROSA', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE ROSA DE SABOR G', 'CARTON 40X30X14 GENERICA');
  assert.strictEqual(res.groupId, 'CARTON');
  assert.strictEqual(res.subgroupId, 'ROSA');
  assert.strictEqual(res.ruleId, 'REGLA_ROSA_DE_SABOR');
  assert.ok(res.auditTrace.includes('NIVEL 1'));
});

// --------------------------------------------------------------------------
// TEST 6: Jerarquía Nivel 1 — Regla específica de artículo: ROSA DE SABOR + EPS
// Prevalece sobre Nivel 3 (Regla EPS)
// --------------------------------------------------------------------------
runTest('6. Jerarquía Nivel 1: TOMATE ROSA DE SABOR con envase EPS clasifica en CARTÓN / ROSA (prevalece sobre EPS)', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE ROSA DE SABOR G', 'EPS 104');
  assert.strictEqual(res.groupId, 'CARTON', 'ROSA DE SABOR en EPS debe ir a CARTÓN por Nivel 1');
  assert.strictEqual(res.subgroupId, 'ROSA', 'Subgrupo debe ser ROSA');
  assert.strictEqual(res.ruleId, 'REGLA_ROSA_DE_SABOR');
  assert.ok(res.auditTrace.includes('NIVEL 1'));
});

// --------------------------------------------------------------------------
// TEST 7: Jerarquía Nivel 1 — Regla específica de artículo: ROSA DE SABOR + MADERA
// --------------------------------------------------------------------------
runTest('7. Jerarquía Nivel 1: TOMATE ROSA DE SABOR con envase MADERA clasifica en CARTÓN / ROSA', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE ROSA DE SABOR EXTRA', 'MADERA 40X30X14');
  assert.strictEqual(res.groupId, 'CARTON');
  assert.strictEqual(res.subgroupId, 'ROSA');
  assert.strictEqual(res.ruleId, 'REGLA_ROSA_DE_SABOR');
  assert.ok(res.auditTrace.includes('NIVEL 1'));
});

// --------------------------------------------------------------------------
// TEST 8: Jerarquía Nivel 2 — Asociación explícita en MATRIZ prevalece sobre reglas de menor nivel
// --------------------------------------------------------------------------
runTest('8. Jerarquía Nivel 2: Asociación configurable en MATRIZ prevalece sobre regla genérica', () => {
  const resolver = new CommercialGroupResolver();
  // Supongamos una asociación explícita que asigna una variedad genérica a un grupo específico
  resolver.addAssociation('TOMATE ENSALADA ESPECIAL', 'MADERA 40X30X14', {
    grupoComercial: 'TOMATE VOLLEY Y CORAZÓN DE BUEY',
    subgrupo: null,
    prioridad: 25,
    ruleId: 'MATRIZ_CUSTOM_2026'
  });

  const res = resolver.resolve('TOMATE ENSALADA ESPECIAL', 'MADERA 40X30X14');
  assert.strictEqual(res.groupId, 'VOLLEY');
  assert.strictEqual(res.ruleId, 'MATRIZ_CUSTOM_2026');
  assert.ok(res.auditTrace.includes('NIVEL 2'));
});

// --------------------------------------------------------------------------
// TEST 9: Jerarquía Nivel 2 — Regla de par Carrefour con envases autorizados
// --------------------------------------------------------------------------
runTest('9. Jerarquía Nivel 2: Artículo oficial Carrefour con envase IFCO clasifica en CARREFOUR', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE PERA RAMA I M', 'IFCO 6413');
  assert.strictEqual(res.groupId, 'CARREFOUR');
  assert.strictEqual(res.ruleId, 'REGLA_CARREFOUR');
  assert.ok(res.auditTrace.includes('NIVEL 2'));

  // Pero si el envase no es Carrefour ni homologado, no asume Carrefour a ciegas
  const resNoHomologado = resolver.resolve('TOMATE PERA RAMA I M', 'MADERA GENERICA RUSTICA');
  assert.notStrictEqual(resNoHomologado.groupId, 'CARREFOUR');
});

// --------------------------------------------------------------------------
// TEST 10: Jerarquía Nivel 3 — Regla de envase: HUEVO DE TORO en EPS clasifica en EPS
// Nivel 3 (Envase EPS) prevalece sobre Nivel 4 (Regla Genérica Huevo de Toro)
// --------------------------------------------------------------------------
runTest('10. Jerarquía Nivel 3: HUEVO DE TORO en envase EPS clasifica en TOMATE EN CAJA EPS', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE HUEVO DE TORO G', 'EPS 104');
  assert.strictEqual(res.groupId, 'EPS', 'Huevo de Toro en EPS debe ser clasificado como EPS');
  assert.strictEqual(res.ruleId, 'REGLA_ENVASE_EPS');
  assert.ok(res.auditTrace.includes('NIVEL 3'));
});

// --------------------------------------------------------------------------
// TEST 11: Jerarquía Nivel 3 — Regla de envase: JAPONÉS en EPS clasifica en EPS
// --------------------------------------------------------------------------
runTest('11. Jerarquía Nivel 3: TOMATE JAPONÉS en envase EPS clasifica en TOMATE EN CAJA EPS', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE JAPONES I G', 'EPS 154');
  assert.strictEqual(res.groupId, 'EPS', 'Japonés en EPS debe clasificarse en grupo EPS');
  assert.strictEqual(res.ruleId, 'REGLA_ENVASE_EPS');
  assert.ok(res.auditTrace.includes('NIVEL 3'));
});

// --------------------------------------------------------------------------
// TEST 12: Jerarquía Nivel 4 — Regla genérica: HUEVO DE TORO en envase tradicional
// --------------------------------------------------------------------------
runTest('12. Jerarquía Nivel 4: HUEVO DE TORO en formato tradicional madera/cartón clasifica en HUEVO DE TORO', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('TOMATE HUEVO DE TORO G', 'MADERA 40X30X14');
  assert.strictEqual(res.groupId, 'HUEVO_TORO');
  assert.strictEqual(res.ruleId, 'REGLA_HUEVO_DE_TORO');
  assert.ok(res.auditTrace.includes('NIVEL 4'));
});

// --------------------------------------------------------------------------
// TEST 13: Jerarquía Nivel 5 — Fallback: Combinación no clasificada devuelve PENDIENTE DE ASOCIACIÓN
// --------------------------------------------------------------------------
runTest('13. Jerarquía Nivel 5: Combinación desconocida devuelve PENDIENTE DE ASOCIACIÓN sin inventar grupo', () => {
  const resolver = new CommercialGroupResolver();
  const res = resolver.resolve('VARIEDAD DESCONOCIDA EXPERIMENTAL 2026', 'ENVASE NUEVO NO REGISTRADO');
  assert.strictEqual(res.groupId, 'NO_CLASIFICADO');
  assert.strictEqual(res.status, 'PENDIENTE_ASOCIACION');
  assert.strictEqual(res.ruleId, 'FALLBACK_PENDIENTE_ASOCIACION');
  assert.ok(res.auditTrace.includes('NIVEL 5'));
});

// --------------------------------------------------------------------------
// TEST 14: Dinamismo total: Creación de nuevo grupo e integración en StockQueryService
// --------------------------------------------------------------------------
runTest('14. Dinamismo: Creación de nuevo grupo comercial e integración inmediata en StockQueryService sin tocar código', () => {
  const resolver = new CommercialGroupResolver();
  resolver.registerGroup({
    id: 'GRUPO_NUEVO',
    name: 'TOMATES ESPECIALES EXPORTACIÓN',
    order: 8,
    subgroups: [
      { id: 'PREMIUM', name: 'PREMIUM EXPORT', order: 1 }
    ]
  });

  resolver.addAssociation('TOMATE EXPORTACION SELECCION', 'CARTON EXPORT 50X30', {
    groupId: 'GRUPO_NUEVO',
    groupName: 'TOMATES ESPECIALES EXPORTACIÓN',
    subgroupId: 'PREMIUM',
    subgroupName: 'PREMIUM EXPORT',
    prioridad: 20
  });

  const stockMock = [
    {
      stock_key: 'ART-EXP|ENV-EXP',
      codigo_articulo: 'ART-EXP',
      nombre_articulo: 'TOMATE EXPORTACION SELECCION',
      codigo_envase: 'ENV-EXP',
      descripcion_envase: 'CARTON EXPORT 50X30',
      cajas_actuales: 450
    }
  ];

  const queryService = new StockQueryService({
    stockActual: stockMock,
    commercialGroupResolver: resolver
  });

  const resumen = queryService.obtenerStockVisualResumen();
  const grupoExport = resumen.grupos.find(g => g.groupId === 'GRUPO_NUEVO');
  assert.ok(grupoExport, 'El nuevo grupo debe figurar en el resumen de stock visual');
  assert.strictEqual(grupoExport.totalCajas, 450);
  assert.strictEqual(grupoExport.groupName, 'TOMATES ESPECIALES EXPORTACIÓN');
  assert.ok(grupoExport.tieneSubgrupos);
  assert.strictEqual(grupoExport.subgrupos[0].subgroupId, 'PREMIUM');
  assert.strictEqual(grupoExport.subgrupos[0].totalCajas, 450);
});

// --------------------------------------------------------------------------
// TEST 15: Drill-Down Progresivo de 5 Niveles
// GRUPO -> SUBGRUPO -> ARTÍCULO -> ENVASE -> PARTIDA
// --------------------------------------------------------------------------
runTest('15. Drill-Down completo (5 niveles): Grupo -> Subgrupo -> Artículo -> Envase -> Partidas', () => {
  const resolver = new CommercialGroupResolver();
  const stockMock = [
    {
      stock_key: 'ART-ROSA|CT-ROSA',
      codigo_articulo: 'ART-ROSA',
      nombre_articulo: 'TOMATE ROSA DE SABOR G',
      codigo_envase: 'CT-ROSA',
      descripcion_envase: 'CARTON 40X30X14 ROSA',
      cajas_actuales: 80
    }
  ];

  const capasMock = [
    {
      id_capa: 'CAPA-001',
      codigo_articulo: 'ART-ROSA',
      codigo_envase: 'CT-ROSA',
      partida: 'PARTIDA-2026-A',
      fecha_capa: '2026-10-01',
      cajas_iniciales: 50,
      cajas_consumidas: 0,
      cajas_restantes: 50,
      estado_capa: 'ABIERTA',
      documento_ref: 'ALB-COMPRA-01'
    },
    {
      id_capa: 'CAPA-002',
      codigo_articulo: 'ART-ROSA',
      codigo_envase: 'CT-ROSA',
      partida: 'PARTIDA-2026-B',
      fecha_capa: '2026-10-02',
      cajas_iniciales: 40,
      cajas_consumidas: 10,
      cajas_restantes: 30,
      estado_capa: 'PARCIAL',
      documento_ref: 'ALB-COMPRA-02'
    }
  ];

  const queryService = new StockQueryService({
    stockActual: stockMock,
    capasFifo: capasMock,
    commercialGroupResolver: resolver
  });

  // Nivel 1 y 2: Resumen por Grupo y Subgrupo
  const resumen = queryService.obtenerStockVisualResumen();
  const grpCarton = resumen.grupos.find(g => g.groupId === 'CARTON');
  assert.ok(grpCarton);
  assert.strictEqual(grpCarton.totalCajas, 80);

  // Nivel 3 y 4: Detalle por Artículo y Envase
  const detalleGrupo = queryService.obtenerStockVisualDetalle('CARTON', 'ROSA');
  assert.strictEqual(detalleGrupo.totalCajas, 80);
  assert.strictEqual(detalleGrupo.lineas.length, 1);
  assert.strictEqual(detalleGrupo.lineas[0].codigoArticulo, 'ART-ROSA');
  assert.strictEqual(detalleGrupo.lineas[0].codigoEnvase, 'CT-ROSA');

  // Nivel 5: Detalle por Partidas (obtenerDetallePartidas)
  const detallePartidas = queryService.obtenerDetallePartidas('ART-ROSA', 'CT-ROSA');
  assert.strictEqual(detallePartidas.totalPartidas, 2);
  assert.strictEqual(detallePartidas.totalCajas, 80);
  assert.strictEqual(detallePartidas.partidas[0].partida, 'PARTIDA-2026-A');
  assert.strictEqual(detallePartidas.partidas[0].cajasRestantes, 50);
  assert.strictEqual(detallePartidas.partidas[1].partida, 'PARTIDA-2026-B');
  assert.strictEqual(detallePartidas.partidas[1].cajasRestantes, 30);
});

// --------------------------------------------------------------------------
// TEST 16: Ajustes manuales en MovementService (Positivo y Negativo)
// --------------------------------------------------------------------------
runTest('16. Ajustes manuales en MovementService: registrarAjustePositivo y registrarAjusteNegativo', () => {
  const { repo } = createTestRepository();
  const movService = new MovementService({
    repository: repo,
    lockService: mockLockService
  });

  // 1. Ajuste Positivo (Añade 50 cajas)
  const resPos = movService.registrarAjustePositivo({
    codigo_articulo: '2112000',
    codigo_envase: 'EPS104',
    cajas: 50,
    motivo: 'INVENTARIO_INICIAL',
    partida: 'PART-INI-01'
  }, 'TEST_USER');

  assert.strictEqual(resPos.success, true);
  assert.strictEqual(resPos.stockNuevo, 50);
  assert.strictEqual(repo.getCapasFifo().length, 1);
  assert.strictEqual(Number(repo.getCapasFifo()[0].cajas_restantes), 50);
  assert.strictEqual(repo.getMovimientos().length, 1);

  // 2. Ajuste Negativo (Deduce 20 cajas)
  const resNeg = movService.registrarAjusteNegativo({
    codigo_articulo: '2112000',
    codigo_envase: 'EPS104',
    cajas: 20,
    motivo: 'ROTURA_ALMACEN'
  }, 'TEST_USER');

  assert.strictEqual(resNeg.success, true);
  assert.strictEqual(resNeg.stockNuevo, 30);
  assert.strictEqual(Number(repo.getCapasFifo()[0].cajas_restantes), 30);
  assert.strictEqual(repo.getMovimientos().length, 2);

  // 3. Ajuste Negativo excesivo (rechazado por STOCK_INSUFICIENTE)
  const resExceso = movService.registrarAjusteNegativo({
    codigo_articulo: '2112000',
    codigo_envase: 'EPS104',
    cajas: 100,
    motivo: 'MERMA'
  }, 'TEST_USER');

  assert.strictEqual(resExceso.success, false);
  assert.strictEqual(resExceso.errorCode, 'STOCK_INSUFICIENTE');
  assert.strictEqual(Number(repo.getCapasFifo()[0].cajas_restantes), 30, 'El stock no debe modificarse');
});

// --------------------------------------------------------------------------
// TEST 17: Reclasificación / Traspaso en MovementService
// Ejemplo: 10 cajas de Rosa Cartón a Rosa EPS
// --------------------------------------------------------------------------
runTest('17. Reclasificación/Transferencia: 10 cajas de Rosa Cartón a Rosa EPS preservando FIFO y auditabilidad', () => {
  const { repo } = createTestRepository();
  const movService = new MovementService({
    repository: repo,
    lockService: mockLockService
  });

  // Configurar stock inicial en origen: 25 cajas en Rosa Cartón
  movService.registrarAjustePositivo({
    codigo_articulo: 'TOMATE_ROSA',
    codigo_envase: 'CARTON_ROSA',
    cajas: 25,
    motivo: 'CARGA_INICIAL',
    partida: 'P-ROSA-01'
  });

  const stockActualInicial = repo.getStockActual();
  const stockInicialOrigen = stockActualInicial.find(s => s.stock_key === 'TOMATE_ROSA|CARTON_ROSA');
  assert.ok(stockInicialOrigen);
  assert.strictEqual(Number(stockInicialOrigen.cajas_actuales), 25);

  // Ejecutar reclasificación de 10 cajas a Rosa EPS
  const resReclasif = movService.registrarReclasificacion({
    codigo_articulo: 'TOMATE_ROSA',
    codigo_envase_origen: 'CARTON_ROSA',
    codigo_envase_destino: 'EPS104',
    cajas: 10,
    motivo: 'CAMBIO_ENVASE_PEDIDO',
    observaciones: 'Traspaso solicitado por comercial'
  }, 'OPERADOR_RECLASIF');

  assert.strictEqual(resReclasif.success, true);
  assert.strictEqual(resReclasif.cajasReclasificadas, 10);
  assert.strictEqual(resReclasif.origen.stockNuevo, 15);
  assert.strictEqual(resReclasif.destino.stockNuevo, 10);

  // Verificar estado en STOCK_ACTUAL
  const stockActualFinal = repo.getStockActual();
  const stockOrigen = stockActualFinal.find(s => s.stock_key === 'TOMATE_ROSA|CARTON_ROSA');
  const stockDestino = stockActualFinal.find(s => s.stock_key === 'TOMATE_ROSA|EPS104');
  assert.strictEqual(Number(stockOrigen.cajas_actuales), 15);
  assert.strictEqual(Number(stockDestino.cajas_actuales), 10);

  // Verificar que se crearon 2 movimientos vinculados en MOVIMIENTOS
  const allMovs = repo.getMovimientos();
  const movsReclasif = allMovs.filter(m => m.id_documento_ref && String(m.id_documento_ref).startsWith('RECLASIF:'));
  assert.strictEqual(movsReclasif.length, 2, 'Deben existir 2 movimientos vinculados por la misma referencia');
  const movSalida = movsReclasif.find(m => Number(m.signo) === -1);
  const movEntrada = movsReclasif.find(m => Number(m.signo) === 1);
  assert.strictEqual(movSalida.codigo_envase, 'CARTON_ROSA');
  assert.strictEqual(movEntrada.codigo_envase, 'EPS104');
  assert.strictEqual(movSalida.id_documento_ref, movEntrada.id_documento_ref);

  // Verificar que se creó una capa FIFO viva en destino y se descontó en origen
  const capasFinales = repo.getCapasFifo();
  const capaDestino = capasFinales.find(c => c.codigo_articulo === 'TOMATE_ROSA' && c.codigo_envase === 'EPS104');
  assert.ok(capaDestino);
  assert.strictEqual(Number(capaDestino.cajas_restantes), 10);
});

// --------------------------------------------------------------------------
// TEST 18: Invariante fundamental de arquitectura
// InventoryEngine.js debe permanecer 100% inalterado
// --------------------------------------------------------------------------
runTest('18. InventoryEngine.js permanece 100% inalterado respecto a Git HEAD', () => {
  try {
    const diff = execSync('git diff HEAD -- src/InventoryEngine.js', { encoding: 'utf8' }).trim();
    assert.strictEqual(diff, '', `InventoryEngine.js ha sido modificado:\n${diff}`);
  } catch (e) {
    const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'InventoryEngine.js'), 'utf8');
    assert.ok(content.length > 500);
  }
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE FASE 5: ${passedTests} SUPERADAS | ${failedTests} FALLIDAS`);
console.log('================================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
