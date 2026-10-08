/**
 * STOCK-LIGHT — TEST SUITE FASE 6.1
 * Correcciones históricas, movimientos parcialmente consumidos y resolución segura de incidencias.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { SheetsRepository } = require('../src/Repository');
const { CommercialGroupResolver } = require('../src/CommercialGroupResolver');
const { MovementService } = require('../src/MovementService');
const { StockQueryService } = require('../src/StockQueryService');
const { OperationalSafetyService } = require('../src/OperationalSafetyService');

// --- MOCK SPREADSHEET INFRASTRUCTURE ---

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
      const row = this.sheet.rows[rowIdx] || [];
      const slice = [];
      for (let c = 0; c < this.numCols; c++) {
        const colIdx = this.startCol - 1 + c;
        slice.push(row[colIdx] !== undefined ? row[colIdx] : '');
      }
      result.push(slice);
    }
    return result;
  }

  setValues(values) {
    for (let r = 0; r < this.numRows; r++) {
      const rowIdx = this.startRow - 1 + r;
      if (!this.sheet.rows[rowIdx]) {
        this.sheet.rows[rowIdx] = [];
      }
      for (let c = 0; c < this.numCols; c++) {
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
  clear() { this.rows = []; }
  setFrozenRows() {}
}

class MockSpreadsheet {
  constructor(id = 'FASE6_1_TEST_SPREADSHEET') {
    this.id = id;
    this.sheets = new Map();
  }
  getId() { return this.id; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    const sheet = new MockSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

function createTestEnvironment() {
  const ss = new MockSpreadsheet();
  const repo = new SheetsRepository({ spreadsheet: ss });
  repo.provisionDatabase();

  const resolver = new CommercialGroupResolver({ repository: repo });
  const lockMock = { waitLock: () => true, releaseLock: () => {} };
  const movService = new MovementService({ repository: repo, lockService: lockMock });
  const queryService = new StockQueryService({ repository: repo, commercialGroupResolver: resolver });
  const safetyService = new OperationalSafetyService({
    repository: repo,
    movementService: movService,
    commercialResolver: resolver,
    stockQueryService: queryService,
    lockService: lockMock
  });

  return { repo, resolver, movService, queryService, safetyService };
}

console.log('================================================================');
console.log(' TEST SUITE FASE 6.1 — CORRECCIONES HISTÓRICAS & SEGURIDAD');
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
      const lines = err.stack.split('\n');
      console.error(`     ${lines[1] || ''}`);
      console.error(`     ${lines[2] || ''}`);
    }
    failedTests++;
  }
}

// --------------------------------------------------------------------------
// TEST 1: Corrección de entrada sin consumo (Caso A)
// --------------------------------------------------------------------------
runTest('1. Corrección entrada sin consumo: Modifica artículo íntegramente de forma segura', () => {
  const { safetyService, repo } = createTestEnvironment();

  // Entrada de 100 VOLLEY I G
  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '101',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY I G', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }]);

  // Corregir entrada a VOLLEY I GG
  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'CORRECCION_ENTRADA_PARCIAL',
    serie: 'ENT',
    numero: '101',
    nuevoArticulo: 'TOMATE VOLLEY I GG',
    motivo: 'Error de calibre al recepcionar'
  }, 'JUAN');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.cajasReclasificadas, 100);
  assert.strictEqual(res.cajasMantenidasConsumidas, 0);

  // Stock: VOLLEY I G debe ser 0, VOLLEY I GG debe ser 100
  const stock = repo.getStockActual();
  const stockG = stock.find(s => s.codigo_articulo === 'TOMATE VOLLEY I G');
  const stockGG = stock.find(s => s.codigo_articulo === 'TOMATE VOLLEY I GG');

  assert.strictEqual(Number(stockG ? stockG.cajas_actuales : 0), 0);
  assert.strictEqual(Number(stockGG ? stockGG.cajas_actuales : 0), 100);

  // Registro en LOG_OPERACIONES
  const logs = repo.getLogOperaciones();
  assert.strictEqual(logs.length, 2); // Entrada + Corrección
  const logCorr = logs.find(l => l.operacion === 'CORRECCION_ENTRADA_PARCIAL');
  assert.strictEqual(logCorr.motivo, 'Error de calibre al recepcionar');
  assert.strictEqual(logCorr.estado, 'CORREGIDA');
});

// --------------------------------------------------------------------------
// TEST 2: Corrección de entrada parcialmente consumida (Caso B)
// --------------------------------------------------------------------------
runTest('2. Corrección entrada parcialmente consumida: Mantiene ventas en origen y traslada saldo restante', () => {
  const { safetyService, repo } = createTestEnvironment();

  // 1. Entrada de 200 VOLLEY I G
  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '201',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY I G', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 200 }]);

  // 2. Salida de 120 VOLLEY I G
  safetyService.procesarSalidaDocumento({
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '201',
    fecha_documento: '2026-10-06'
  }, [{ codigo_articulo: 'TOMATE VOLLEY I G', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 120 }]);

  // Saldo: 80 cajas de VOLLEY I G
  let stock = repo.getStockActual();
  assert.strictEqual(Number(stock.find(s => s.codigo_articulo === 'TOMATE VOLLEY I G').cajas_actuales), 80);

  // 3. Corregir entrada original: Descubrimos que eran VOLLEY I GG
  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'CORRECCION_ENTRADA_PARCIAL',
    serie: 'ENT',
    numero: '201',
    nuevoArticulo: 'TOMATE VOLLEY I GG',
    motivo: 'Error de calibre en albarán de compra'
  }, 'JUAN');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.cajasMantenidasConsumidas, 120, '120 cajas consumidas deben mantenerse en origen');
  assert.strictEqual(res.cajasReclasificadas, 80, '80 cajas disponibles deben trasladarse a destino');

  // Stock resultante: VOLLEY I G pasa a 0, VOLLEY I GG pasa a 80
  stock = repo.getStockActual();
  const stockG = stock.find(s => s.codigo_articulo === 'TOMATE VOLLEY I G');
  const stockGG = stock.find(s => s.codigo_articulo === 'TOMATE VOLLEY I GG');
  assert.strictEqual(Number(stockG.cajas_actuales), 0);
  assert.strictEqual(Number(stockGG.cajas_actuales), 80);

  // Capas FIFO: La capa original queda agotada con 120 consumidas, y la nueva activa con 80
  const capas = repo.getCapasFifo();
  const capaG = capas.find(c => c.codigo_articulo === 'TOMATE VOLLEY I G');
  const capaGG = capas.find(c => c.codigo_articulo === 'TOMATE VOLLEY I GG');

  assert.strictEqual(Number(capaG.cajas_consumidas), 120);
  assert.strictEqual(Number(capaG.cajas_restantes), 0);
  assert.strictEqual(capaG.estado_capa, 'AGOTADA');

  assert.strictEqual(Number(capaGG.cajas_restantes), 80);
  assert.strictEqual(capaGG.estado_capa, 'ACTIVA');
});

// --------------------------------------------------------------------------
// TEST 3: División de una entrada sin consumos
// --------------------------------------------------------------------------
runTest('3. División entrada: 100 VOLLEY I G dividida en 60 G + 40 GG', () => {
  const { safetyService, repo } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '301',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY I G', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }]);

  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'DIVIDIR_ENTRADA',
    serie: 'ENT',
    numero: '301',
    divisiones: [
      { articulo: 'TOMATE VOLLEY I G', cajas: 60 },
      { articulo: 'TOMATE VOLLEY I GG', cajas: 40 }
    ],
    motivo: 'Lote mixto no desglosado'
  }, 'JUAN');

  assert.strictEqual(res.success, true);

  const stock = repo.getStockActual();
  const sG = stock.find(s => s.codigo_articulo === 'TOMATE VOLLEY I G');
  const sGG = stock.find(s => s.codigo_articulo === 'TOMATE VOLLEY I GG');

  assert.strictEqual(Number(sG.cajas_actuales), 60);
  assert.strictEqual(Number(sGG.cajas_actuales), 40);
});

// --------------------------------------------------------------------------
// TEST 4: División con consumo previo (Caso C: Seguro vs Bloqueado)
// --------------------------------------------------------------------------
runTest('4. División con consumo previo: 100 G (60 consumidas) -> 60 G + 40 GG permitido, pero 30 G + 70 GG bloqueado', () => {
  const { safetyService, repo } = createTestEnvironment();

  // Entrada 100 G
  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '401',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY I G', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }]);

  // Salida 60 G
  safetyService.procesarSalidaDocumento({
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '401',
    fecha_documento: '2026-10-06'
  }, [{ codigo_articulo: 'TOMATE VOLLEY I G', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 60 }]);

  // Intento inseguro: 30 G + 70 GG (pero ya se consumieron 60 de G, requeriría -30 de stock)
  const resInseguro = safetyService.ejecutarCorreccionHistorica({
    accion: 'DIVIDIR_ENTRADA',
    serie: 'ENT',
    numero: '401',
    divisiones: [
      { articulo: 'TOMATE VOLLEY I G', cajas: 30 },
      { articulo: 'TOMATE VOLLEY I GG', cajas: 70 }
    ],
    motivo: 'División errónea'
  });

  assert.strictEqual(resInseguro.success, false);
  assert.strictEqual(resInseguro.status, 'REVISION_NECESARIA');

  // Intento seguro: 60 G (cubre exactamente las 60 consumidas) + 40 GG
  const resSeguro = safetyService.ejecutarCorreccionHistorica({
    accion: 'DIVIDIR_ENTRADA',
    serie: 'ENT',
    numero: '401',
    divisiones: [
      { articulo: 'TOMATE VOLLEY I G', cajas: 60 },
      { articulo: 'TOMATE VOLLEY I GG', cajas: 40 }
    ],
    motivo: 'Desglose exacto de lote'
  });

  assert.strictEqual(resSeguro.success, true);

  const stock = repo.getStockActual();
  const sG = stock.find(s => s.codigo_articulo === 'TOMATE VOLLEY I G');
  const sGG = stock.find(s => s.codigo_articulo === 'TOMATE VOLLEY I GG');

  assert.strictEqual(Number(sG.cajas_actuales), 0);
  assert.strictEqual(Number(sGG.cajas_actuales), 40);
});

// --------------------------------------------------------------------------
// TEST 5: Anulación de entrada sin consumos
// --------------------------------------------------------------------------
runTest('5. Anulación de entrada sin consumo: Descuenta stock y marca ANULADA', () => {
  const { safetyService, repo } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '501',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'CARTON 40X30X14 ROSA', cajas: 100 }]);

  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'ANULAR_ENTRADA',
    serie: 'ENT',
    numero: '501',
    motivo: 'Albarán introducido por error'
  }, 'JUAN');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.estado, 'ANULADA');
  assert.strictEqual(res.cajasAnuladas, 100);

  const stock = repo.getStockActual();
  assert.strictEqual(Number(stock[0].cajas_actuales), 0);

  const capas = repo.getCapasFifo();
  assert.strictEqual(capas[0].estado_capa, 'ANULADA');
  assert.strictEqual(Number(capas[0].cajas_restantes), 0);

  const docs = repo.getDocumentos();
  assert.strictEqual(docs[0].estado_proceso, 'ANULADO');
});

// --------------------------------------------------------------------------
// TEST 6: Anulación de entrada con consumos
// --------------------------------------------------------------------------
runTest('6. Anulación de entrada con consumo: Bloqueo total "NO SE PUEDE ANULAR AUTOMÁTICAMENTE" sin stock negativo', () => {
  const { safetyService, repo } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '601',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'CARTON 40X30X14 ROSA', cajas: 100 }]);

  safetyService.procesarSalidaDocumento({
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '601',
    fecha_documento: '2026-10-06'
  }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'CARTON 40X30X14 ROSA', cajas: 60 }]);

  // Intento de anular la entrada
  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'ANULAR_ENTRADA',
    serie: 'ENT',
    numero: '601',
    motivo: 'Intento de anulación'
  });

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.status, 'REVISION_NECESARIA');
  assert.ok(res.mensaje.includes('NO SE PUEDE ANULAR AUTOMÁTICAMENTE'));
  assert.ok(res.mensaje.includes('60 cajas consumidas'));

  // Invariante: Stock sigue siendo 40 (100 - 60)
  const stock = repo.getStockActual();
  assert.strictEqual(Number(stock[0].cajas_actuales), 40);
});

// --------------------------------------------------------------------------
// TEST 7: Corrección de cantidad de entrada
// --------------------------------------------------------------------------
runTest('7. Corrección de cantidad de entrada: Reducción válida con saldo disponible vs bloqueo si saldo insuficiente', () => {
  const { safetyService, repo } = createTestEnvironment();

  // Caso 1: 100 disponibles -> corregir a 80 (delta -20) -> permitido
  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '701',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }]);

  const res1 = safetyService.ejecutarCorreccionHistorica({
    accion: 'CORRECCION_CANTIDAD_ENTRADA',
    serie: 'ENT',
    numero: '701',
    nuevaCantidad: 80,
    motivo: 'Error de pesaje'
  });

  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.cajasReducidas, 20);
  assert.strictEqual(Number(repo.getStockActual()[0].cajas_actuales), 80);

  // Caso 2: Se consumen 75 cajas (quedan 5)
  safetyService.procesarSalidaDocumento({
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '701',
    fecha_documento: '2026-10-06'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 75 }]);

  assert.strictEqual(Number(repo.getStockActual()[0].cajas_actuales), 5);

  // Intentar reducir a 60 cajas (requiere restar 20 de la capa, pero solo quedan 5)
  const res2 = safetyService.ejecutarCorreccionHistorica({
    accion: 'CORRECCION_CANTIDAD_ENTRADA',
    serie: 'ENT',
    numero: '701',
    nuevaCantidad: 60,
    motivo: 'Segunda corrección excesiva'
  });

  assert.strictEqual(res2.success, false);
  assert.strictEqual(res2.status, 'REVISION_NECESARIA');
  assert.ok(res2.mensaje.includes('Solo quedan 5 cajas disponibles'));
  assert.strictEqual(Number(repo.getStockActual()[0].cajas_actuales), 5, 'Stock no debe ser alterado');
});

// --------------------------------------------------------------------------
// TEST 8: Corrección de cantidad de salida
// --------------------------------------------------------------------------
runTest('8. Corrección de cantidad de salida: 100 cajas -> 70 cajas restituye 30 cajas a FIFO', () => {
  const { safetyService, repo } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '801',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }]);

  safetyService.procesarSalidaDocumento({
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '801',
    fecha_documento: '2026-10-06'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }]);

  assert.strictEqual(Number(repo.getStockActual()[0].cajas_actuales), 0);

  // Corregir salida de 100 a 70
  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'CORRECCION_CANTIDAD_SALIDA',
    serie: 'SAL',
    numero: '801',
    nuevaCantidad: 70,
    motivo: 'Error en conteo de carga'
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.cajasRestauradas, 30);
  assert.strictEqual(res.stockNuevo, 30);

  // Capa FIFO recuperó 30 cajas
  const capa = repo.getCapasFifo()[0];
  assert.strictEqual(Number(capa.cajas_restantes), 30);
  assert.strictEqual(capa.estado_capa, 'ACTIVA');
});

// --------------------------------------------------------------------------
// TEST 9: Anulación de salida con restitución exacta FIFO
// --------------------------------------------------------------------------
runTest('9. Anulación salida: Restitución exacta a capas FIFO múltiples (A: 100, B: 20 -> ambas 100)', () => {
  const { safetyService, repo } = createTestEnvironment();

  // Capa A: 100 cajas
  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: 'A',
    fecha_documento: '2026-10-01'
  }, [{ codigo_articulo: 'TOMATE JAPI', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100, partida: 'PART_A' }]);

  // Capa B: 100 cajas
  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: 'B',
    fecha_documento: '2026-10-02'
  }, [{ codigo_articulo: 'TOMATE JAPI', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100, partida: 'PART_B' }]);

  // Salida de 120 cajas (consume 100 de A y 20 de B)
  safetyService.procesarSalidaDocumento({
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '901',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE JAPI', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 120 }]);

  assert.strictEqual(Number(repo.getStockActual()[0].cajas_actuales), 80);

  // Anular la salida
  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'ANULAR_SALIDA',
    serie: 'SAL',
    numero: '901',
    motivo: 'Venta cancelada por cliente antes de expedición'
  }, 'JUAN');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.cajasRestauradas, 120);

  // Capas FIFO restauradas exactamente: A -> 100, B -> 100
  const capas = repo.getCapasFifo();
  const capaA = capas.find(c => c.partida === 'PART_A');
  const capaB = capas.find(c => c.partida === 'PART_B');

  assert.strictEqual(Number(capaA.cajas_restantes), 100);
  assert.strictEqual(Number(capaA.cajas_consumidas), 0);
  assert.strictEqual(capaA.estado_capa, 'ACTIVA');

  assert.strictEqual(Number(capaB.cajas_restantes), 100);
  assert.strictEqual(Number(capaB.cajas_consumidas), 0);
  assert.strictEqual(capaB.estado_capa, 'ACTIVA');

  assert.strictEqual(Number(repo.getStockActual()[0].cajas_actuales), 200);
});

// --------------------------------------------------------------------------
// TEST 10: Salida duplicada
// --------------------------------------------------------------------------
runTest('10. Salida duplicada: Idempotencia estricta bloquea segundo intento sin descontar dos veces', () => {
  const { safetyService, repo } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '1001',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }]);

  const docSalida = {
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '123',
    fecha_documento: '2026-10-05'
  };
  const lineasSalida = [
    { codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 40 }
  ];

  // Primera ejecución: OK
  const res1 = safetyService.procesarSalidaDocumento(docSalida, lineasSalida);
  assert.strictEqual(res1.success, true);
  assert.strictEqual(Number(repo.getStockActual()[0].cajas_actuales), 60);

  // Segunda ejecución con mismo documento: BLOQUEADA
  const res2 = safetyService.procesarSalidaDocumento(docSalida, lineasSalida);
  assert.strictEqual(res2.success, false);
  assert.strictEqual(res2.status, 'DOCUMENTO_DUPLICADO');
  assert.strictEqual(res2.mensaje, 'Este documento ya fue procesado.');

  // Invariante: Stock no se descuenta dos veces
  assert.strictEqual(Number(repo.getStockActual()[0].cajas_actuales), 60);
});

// --------------------------------------------------------------------------
// TEST 11: Corrección de artículo y recálculo comercial (Rosa de Sabor)
// --------------------------------------------------------------------------
runTest('11. Corrección de artículo: ROSA -> ROSA DE SABOR recalcula clasificación comercial automáticamente (CARTÓN / ROSA)', () => {
  const { safetyService, resolver, repo } = createTestEnvironment();

  // Entrada con EPS 104
  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '1101',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'EPS 104', cajas: 100 }]);

  // Corregir artículo a ROSA DE SABOR
  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'CAMBIAR_ARTICULO',
    serie: 'ENT',
    numero: '1101',
    nuevoArticulo: 'TOMATE ROSA DE SABOR',
    motivo: 'Corrección de variedad a Rosa de Sabor'
  });

  assert.strictEqual(res.success, true);

  // Verificar que CommercialGroupResolver asigna Rosa de Sabor a CARTÓN / ROSA aunque sea EPS
  const classRes = resolver.resolve('TOMATE ROSA DE SABOR', 'EPS 104');
  assert.strictEqual(classRes.groupId, 'CARTON');
  assert.strictEqual(classRes.subgroupId, 'ROSA');
});

// --------------------------------------------------------------------------
// TEST 12: Corrección de envase
// --------------------------------------------------------------------------
runTest('12. Corrección de envase: ROSA CARTÓN 100 -> ROSA EPS 100 descuenta origen, crea destino y reclasifica', () => {
  const { safetyService, repo } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '1201',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'CARTON 40X30X14 ROSA', cajas: 100 }]);

  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'CAMBIAR_ENVASE',
    serie: 'ENT',
    numero: '1201',
    nuevoEnvase: 'EPS 104',
    motivo: 'Cambio de formato de envasado'
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.stockOrigen, 0);
  assert.strictEqual(res.stockDestino, 100);
});

// --------------------------------------------------------------------------
// TEST 13: Corrección de calibre / categoría
// --------------------------------------------------------------------------
runTest('13. Corrección de calibre/categoría: VOLLEY I G 100 -> VOLLEY I GG 100 como combinación comercial segura', () => {
  const { safetyService, repo } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '1301',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY I G', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }]);

  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'CAMBIAR_CALIBRE',
    serie: 'ENT',
    numero: '1301',
    nuevoArticulo: 'TOMATE VOLLEY I GG',
    motivo: 'Corrección de etiqueta de calibre'
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.stockOrigen, 0);
  assert.strictEqual(res.stockDestino, 100);
});

// --------------------------------------------------------------------------
// TEST 14: Movimiento entre partidas
// --------------------------------------------------------------------------
runTest('14. Movimiento entre partidas: Partida A 100 -> mover 20 a Partida B conserva total de 100 cajas', () => {
  const { safetyService, repo } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '1401',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE HUEVO DE TORO', codigo_envase: 'MADERA 40X30X14', cajas: 100, partida: 'PART_A' }]);

  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'MOVER_PARTIDA',
    serie: 'ENT',
    numero: '1401',
    partidaOrigen: 'PART_A',
    partidaDestino: 'PART_B',
    cajas: 20,
    motivo: 'Reubicación de palet'
  });

  assert.strictEqual(res.success, true);

  const capas = repo.getCapasFifo();
  const capaA = capas.find(c => c.partida === 'PART_A');
  const capaB = capas.find(c => c.partida === 'PART_B');

  assert.strictEqual(Number(capaA.cajas_restantes), 80);
  assert.strictEqual(Number(capaB.cajas_restantes), 20);

  // Total de stock permanece idéntico en 100
  assert.strictEqual(Number(repo.getStockActual()[0].cajas_actuales), 100);
});

// --------------------------------------------------------------------------
// TEST 15: Cadena de movimientos y corrección
// --------------------------------------------------------------------------
runTest('15. Cadena de movimientos: ENTRADA -> SALIDA -> AJUSTE -> RECLASIFICACIÓN -> SALIDA y análisis de corrección', () => {
  const { safetyService, repo } = createTestEnvironment();

  // 1. Entrada 100
  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'CADENA',
    numero: '1',
    fecha_documento: '2026-10-01'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }]);

  // 2. Salida 20 (saldo 80)
  safetyService.procesarSalidaDocumento({
    tipo_documento: 'SALIDA',
    serie: 'CADENA',
    numero: '2',
    fecha_documento: '2026-10-02'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 20 }]);

  // 3. Ajuste negativo 10 (saldo 70)
  safetyService.ejecutarAjusteOperativo({
    accion: 'QUITAR_STOCK',
    articulo: 'TOMATE VOLLEY',
    envase: 'CARTON 40X30X14 GENERICA',
    cajas: 10,
    motivo: 'MERMA'
  });

  // 4. Reclasificación 20 a EPS (saldo origen: 50, saldo destino: 20)
  safetyService.ejecutarAjusteOperativo({
    accion: 'CAMBIAR_ENVASE',
    articulo: 'TOMATE VOLLEY',
    envase: 'CARTON 40X30X14 GENERICA',
    envaseDestino: 'EPS 104',
    cajas: 20
  });

  // 5. Nueva salida de 30 de CARTON (saldo origen: 20)
  safetyService.procesarSalidaDocumento({
    tipo_documento: 'SALIDA',
    serie: 'CADENA',
    numero: '3',
    fecha_documento: '2026-10-04'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 30 }]);

  // Comprobar saldo restante en origen: 20
  const stockOrig = repo.getStockActual().find(s => s.stock_key === 'TOMATE VOLLEY|CARTON 40X30X14 GENERICA');
  assert.strictEqual(Number(stockOrig.cajas_actuales), 20);

  // Intentar modificar entrada original reduciendo en 50 cajas (cuando solo quedan 20)
  const resInseguro = safetyService.ejecutarCorreccionHistorica({
    accion: 'CORRECCION_CANTIDAD_ENTRADA',
    serie: 'CADENA',
    numero: '1',
    nuevaCantidad: 50, // reducción de 50
    motivo: 'Ajuste excesivo'
  });
  assert.strictEqual(resInseguro.success, false);
  assert.strictEqual(resInseguro.status, 'REVISION_NECESARIA');

  // Intentar modificar entrada original reduciendo en 10 cajas (saldo 20 >= 10: PERMITIR)
  const resSeguro = safetyService.ejecutarCorreccionHistorica({
    accion: 'CORRECCION_CANTIDAD_ENTRADA',
    serie: 'CADENA',
    numero: '1',
    nuevaCantidad: 90, // reducción de 10
    motivo: 'Ajuste seguro'
  });
  assert.strictEqual(resSeguro.success, true);
  assert.strictEqual(resSeguro.cajasReducidas, 10);
  assert.strictEqual(resSeguro.stockNuevo, 10);
});

// --------------------------------------------------------------------------
// TEST 16: Detección de impacto analítica
// --------------------------------------------------------------------------
runTest('16. Detección de impacto: Previsualización precisa de cajas iniciales, consumidas y disponibles', () => {
  const { safetyService } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'IMP',
    numero: '1',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }]);

  safetyService.procesarSalidaDocumento({
    tipo_documento: 'SALIDA',
    serie: 'IMP',
    numero: '2',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 40 }]);

  const prev = safetyService.previsualizarCorreccionHistorica({
    accion: 'CORRECCION_ENTRADA_PARCIAL',
    serie: 'IMP',
    numero: '1',
    nuevoArticulo: 'TOMATE VOLLEY I GG'
  });

  assert.strictEqual(prev.cantidadOriginal, 100);
  assert.strictEqual(prev.cantidadConsumida, 40);
  assert.strictEqual(prev.cantidadDisponible, 60);
  assert.strictEqual(prev.movimientosPosteriores.length, 1);
  assert.strictEqual(prev.esSegura, true);
});

// --------------------------------------------------------------------------
// TEST 17: Bloqueo de operación insegura con diagnóstico completo
// --------------------------------------------------------------------------
runTest('17. Bloqueo de operación insegura: No inventar reconstrucciones -> REVISIÓN NECESARIA con diagnóstico', () => {
  const { safetyService } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'BLOQ',
    numero: '1',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'CARTON 40X30X14 ROSA', cajas: 50 }]);

  // Consumir la totalidad de la entrada
  safetyService.procesarSalidaDocumento({
    tipo_documento: 'SALIDA',
    serie: 'BLOQ',
    numero: '2',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'CARTON 40X30X14 ROSA', cajas: 50 }]);

  // Intentar reclasificar cuando no queda nada disponible
  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'CORRECCION_ENTRADA_PARCIAL',
    serie: 'BLOQ',
    numero: '1',
    nuevoArticulo: 'TOMATE ROSA DE SABOR',
    motivo: 'Reclasificación tardía'
  });

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.status, 'REVISION_NECESARIA');
  assert.strictEqual(res.estado, 'REVISION_NECESARIA');
  assert.ok(res.mensaje.includes('REVISIÓN NECESARIA'));
  assert.ok(res.movimientoAfectado !== null);
  assert.strictEqual(res.cantidadConsumida, 50);
});

// --------------------------------------------------------------------------
// TEST 18: Previsualización obligatoria y de solo lectura
// --------------------------------------------------------------------------
runTest('18. Previsualización obligatoria: Función idempotente y 100% de solo lectura (CERO mutaciones)', () => {
  const { safetyService, repo } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'PREV',
    numero: '1',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }]);

  const stockAntes = JSON.stringify(repo.getStockActual());
  const capasAntes = JSON.stringify(repo.getCapasFifo());
  const movsAntes = JSON.stringify(repo.getMovimientos());

  const prev = safetyService.previsualizarCorreccionHistorica({
    accion: 'ANULAR_ENTRADA',
    serie: 'PREV',
    numero: '1'
  });

  assert.strictEqual(prev.semaforo, 'OK');
  assert.strictEqual(prev.estado, 'CORRECCION_SEGURA');

  // Comprobar que ningún dato ha mutado
  assert.strictEqual(JSON.stringify(repo.getStockActual()), stockAntes);
  assert.strictEqual(JSON.stringify(repo.getCapasFifo()), capasAntes);
  assert.strictEqual(JSON.stringify(repo.getMovimientos()), movsAntes);
});

// --------------------------------------------------------------------------
// TEST 19: Registro de motivo obligatorio y trazabilidad
// --------------------------------------------------------------------------
runTest('19. Registro de motivo obligatorio: Sin motivo la operación se rechaza; con motivo se audita', () => {
  const { safetyService, repo } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'MOT',
    numero: '1',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 50 }]);

  // Intento 1: Sin motivo -> rechazado
  const resSinMotivo = safetyService.ejecutarCorreccionHistorica({
    accion: 'CAMBIAR_ENVASE',
    serie: 'MOT',
    numero: '1',
    nuevoEnvase: 'EPS 104'
    // sin motivo
  });

  assert.strictEqual(resSinMotivo.success, false);
  assert.strictEqual(resSinMotivo.status, 'ERROR_MOTIVO_OBLIGATORIO');
  assert.ok(resSinMotivo.mensaje.includes('El motivo es obligatorio'));

  // Intento 2: Con motivo -> ejecutado y registrado
  const resConMotivo = safetyService.ejecutarCorreccionHistorica({
    accion: 'CAMBIAR_ENVASE',
    serie: 'MOT',
    numero: '1',
    nuevoEnvase: 'EPS 104',
    motivo: 'Error de envase'
  }, 'JUAN_LOG');

  assert.strictEqual(resConMotivo.success, true);

  const logs = repo.getLogOperaciones();
  const logCorr = logs.find(l => l.usuario === 'JUAN_LOG');
  assert.strictEqual(logCorr.motivo, 'Error de envase');
  assert.strictEqual(logCorr.estado, 'CORREGIDA');
  assert.strictEqual(logCorr.operacion, 'CAMBIAR_ENVASE');
});

// --------------------------------------------------------------------------
// TEST 20: Conciliación matemática e integridad final de stock
// --------------------------------------------------------------------------
runTest('20. Integridad final de stock: Verificación matemática estricta (stock_antes + impacto == stock_despues)', () => {
  const { safetyService, repo } = createTestEnvironment();

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'INT',
    numero: '1',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }]);

  const res = safetyService.ejecutarCorreccionHistorica({
    accion: 'ANULAR_ENTRADA',
    serie: 'INT',
    numero: '1',
    motivo: 'Anulación para comprobación de integridad'
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.conciliacion.integridadVerificada, true);
  assert.strictEqual(res.conciliacion.stockAntes, 100);
  assert.strictEqual(res.conciliacion.impacto, -100);
  assert.strictEqual(res.conciliacion.stockDespues, 0);
  assert.strictEqual(res.conciliacion.stockAntes + res.conciliacion.impacto, res.conciliacion.stockDespues);
});

// --------------------------------------------------------------------------
// TEST 21: Invariante absoluta de InventoryEngine.js
// --------------------------------------------------------------------------
runTest('21. InventoryEngine.js permanece 100% inalterado respecto a Git HEAD', () => {
  try {
    const diff = execSync('git diff HEAD -- src/InventoryEngine.js', { encoding: 'utf8' });
    assert.strictEqual(diff.trim(), '', 'InventoryEngine.js NO debe tener ninguna modificación respecto a HEAD.');
  } catch (err) {
    if (err.message.includes('InventoryEngine.js NO debe tener')) throw err;
    console.log('    [INFO] git diff no disponible en este entorno; verificando existencia de archivo.');
    assert.ok(fs.existsSync(path.join(__dirname, '../src/InventoryEngine.js')));
  }
});

// --------------------------------------------------------------------------
// RESUMEN FINAL
// --------------------------------------------------------------------------
console.log('\n================================================================');
console.log(` RESULTADOS SUITE FASE 6.1: ${passedTests} SUPERADAS | ${failedTests} FALLIDAS`);
console.log('================================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
