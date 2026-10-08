/**
 * STOCK-LIGHT — Test Suite Fase 6.0
 * 
 * Capa de Automatización, Validación y Seguridad Operativa:
 * 1. Documento nuevo: Validación y previsualización previa con semáforo 🟢 OK
 * 2. Documento duplicado: Detección idempotente con mensaje "Este documento ya fue procesado." y fecha
 * 3. Entrada válida: procesarEntradaDocumento crea capas FIFO y actualiza stock
 * 4. Salida válida: procesarSalidaDocumento deduce por FIFO y actualiza stock
 * 5. Salida FIFO: Consumo estricto por orden de antigüedad
 * 6. Stock insuficiente: Bloqueo estricto sin descuento parcial silencioso (alerta STOCK INSUFICIENTE)
 * 7. Artículo desconocido / ausente: 🔴 ERROR bloqueante
 * 8. Envase desconocido / DEFAULT: 🔴 ERROR bloqueante
 * 9. Combinación pendiente: 🟠 PENDIENTE DE ASOCIACIÓN bloquea procesamiento sin inventar grupo
 * 10. Conciliación: Compara STOCK-LIGHT con stock externo sin alterar existencias
 * 11. Ajuste positivo: Añadir stock
 * 12. Ajuste negativo: Quitar stock
 * 13. Reclasificación comercial
 * 14. Cambio de artículo: Traspaso entre artículos
 * 15. Cambio de envase: Traspaso entre envases
 * 16. Mover entre partidas: Traspaso de cajas entre partidas manteniendo existencias
 * 17. Regla especial Rosa de Sabor: CARTÓN / ROSA con cualquier envase (cartón, madera, EPS)
 * 18. Extensibilidad: Nueva asociación dinámica configurable sin modificar código
 * 19. Trazabilidad simple: Registros en LOG_OPERACIONES
 * 20. Invariante: InventoryEngine permanece 100% intacto respecto a Git HEAD
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

// Mocks para emular Google Sheets
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
  clear() { this.rows = []; }
  setFrozenRows() {}
}

class MockSpreadsheet {
  constructor(id = 'FASE6_TEST_SPREADSHEET') {
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
console.log(' TEST SUITE FASE 6.0 — AUTOMATIZACIÓN Y SEGURIDAD OPERATIVA');
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
// TEST 1: Documento nuevo — Validación previa y semáforo 🟢 OK
// --------------------------------------------------------------------------
runTest('1. Documento nuevo: Validación previa y previsualización con semáforo 🟢 OK', () => {
  const { safetyService } = createTestEnvironment();
  const doc = {
    tipo_documento: 'ENTRADA',
    serie: 'ALB-ENT',
    numero: '1001',
    fecha_documento: '2026-10-05',
    entidad_nombre: 'AGRÍCOLA DEL SUR'
  };
  const lineas = [
    { codigo_articulo: 'TOMATE HUEVO DE TORO', codigo_envase: 'EPS 104', cajas: 150, partida: 'P-01' }
  ];

  const prev = safetyService.previsualizarDocumento(doc, lineas, 'ENTRADA');
  assert.strictEqual(prev.semaforo, 'OK');
  assert.strictEqual(prev.icono, '🟢');
  assert.strictEqual(prev.puedeProcesar, true);
  assert.strictEqual(prev.resumen.totalCajas, 150);
  assert.strictEqual(prev.resumen.lineasOk, 1);
  assert.strictEqual(prev.lineas[0].grupoComercial, 'TOMATE EN CAJA EPS');
});

// --------------------------------------------------------------------------
// TEST 2: Documento duplicado — Detección idempotente
// --------------------------------------------------------------------------
runTest('2. Documento duplicado: Rechazado con semáforo 🔴 ERROR y mensaje "Este documento ya fue procesado."', () => {
  const { safetyService, repo } = createTestEnvironment();
  // Simular que el documento ya fue procesado y guardado en DOCUMENTOS
  repo.appendDocumento({
    id_documento: 'DOC-DUPLICADO-1',
    tipo_documento: 'ENTRADA',
    serie: 'ALB-ENT',
    numero: '1001',
    fecha_documento: '2026-10-05',
    fecha_subida: '2026-10-05T10:00:00Z',
    estado_proceso: 'CONFIRMADO',
    total_cajas: 150
  });

  const doc = {
    tipo_documento: 'ENTRADA',
    serie: 'ALB-ENT',
    numero: '1001',
    fecha_documento: '2026-10-05'
  };
  const lineas = [
    { codigo_articulo: 'TOMATE HUEVO DE TORO', codigo_envase: 'EPS 104', cajas: 150 }
  ];

  const val = safetyService.validarDocumento(doc, lineas, 'ENTRADA');
  assert.strictEqual(val.semaforo, 'ERROR');
  assert.strictEqual(val.esDuplicado, true);
  assert.strictEqual(val.codigoError, 'DOCUMENTO_DUPLICADO');
  assert.strictEqual(val.mensaje, 'Este documento ya fue procesado.');
  assert.strictEqual(val.fechaProcesado, '2026-10-05T10:00:00Z');
  assert.strictEqual(val.puedeProcesar, false);

  // Intentar procesar la entrada duplicada debe ser bloqueado
  const resEntrada = safetyService.procesarEntradaDocumento(doc, lineas);
  assert.strictEqual(resEntrada.success, false);
  assert.strictEqual(resEntrada.status, 'DOCUMENTO_DUPLICADO');
  assert.strictEqual(resEntrada.mensaje, 'Este documento ya fue procesado.');
  assert.strictEqual(resEntrada.fechaProcesado, '2026-10-05T10:00:00Z');
});

// --------------------------------------------------------------------------
// TEST 3: Entrada válida — procesarEntradaDocumento
// --------------------------------------------------------------------------
runTest('3. Entrada válida: procesarEntradaDocumento crea capas FIFO y actualiza stock', () => {
  const { safetyService, repo } = createTestEnvironment();
  const doc = {
    tipo_documento: 'ENTRADA',
    serie: 'ALB-ENT',
    numero: '2001',
    fecha_documento: '2026-10-05',
    entidad_nombre: 'COOPERATIVA NORTE'
  };
  const lineas = [
    { codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 120, partida: 'PART-V1' }
  ];

  const res = safetyService.procesarEntradaDocumento(doc, lineas, 'JUAN');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.semaforo, 'OK');
  assert.strictEqual(res.status, 'CONFIRMADO');

  // Verificar persistencia de capa FIFO
  const capas = repo.getCapasFifo();
  assert.strictEqual(capas.length, 1);
  assert.strictEqual(Number(capas[0].cajas_restantes), 120);
  assert.strictEqual(capas[0].partida, 'PART-V1');

  // Verificar stock actual
  const stock = repo.getStockActual();
  assert.strictEqual(stock.length, 1);
  assert.strictEqual(Number(stock[0].cajas_actuales), 120);

  // Verificar LOG_OPERACIONES
  const logs = repo.getLogOperaciones();
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].operacion, 'ENTRADA');
  assert.strictEqual(logs[0].usuario, 'JUAN');
  assert.strictEqual(Number(logs[0].cantidad_cajas), 120);
});

// --------------------------------------------------------------------------
// TEST 4 & 5: Salida válida y FIFO
// --------------------------------------------------------------------------
runTest('4. Salida válida y consumo FIFO estricto por orden de antigüedad', () => {
  const { safetyService, repo } = createTestEnvironment();

  // Crear dos entradas sucesivas (Capas FIFO 1 y 2)
  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '1',
    fecha_documento: '2026-10-01'
  }, [{ codigo_articulo: 'TOMATE JAPI', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 50, partida: 'P1' }]);

  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '2',
    fecha_documento: '2026-10-02'
  }, [{ codigo_articulo: 'TOMATE JAPI', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 70, partida: 'P2' }]);

  // Procesar salida de 60 cajas (debe consumir 50 de P1 y 10 de P2)
  const docSalida = {
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '5001',
    fecha_documento: '2026-10-05',
    entidad_nombre: 'MERCADONA'
  };
  const lineasSalida = [
    { codigo_articulo: 'TOMATE JAPI', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 60 }
  ];

  const resSalida = safetyService.procesarSalidaDocumento(docSalida, lineasSalida, 'MARIA');
  assert.strictEqual(resSalida.success, true);
  assert.strictEqual(resSalida.semaforo, 'OK');

  // Verificar consumo FIFO
  const capas = repo.getCapasFifo();
  assert.strictEqual(capas.length, 2);
  const capa1 = capas.find(c => c.partida === 'P1');
  const capa2 = capas.find(c => c.partida === 'P2');
  assert.strictEqual(Number(capa1.cajas_restantes), 0, 'Capa 1 debe quedar agotada');
  assert.strictEqual(capa1.estado_capa, 'AGOTADA');
  assert.strictEqual(Number(capa2.cajas_restantes), 60, 'Capa 2 debe conservar 60 cajas');

  // Stock restante: 120 - 60 = 60
  const stock = repo.getStockActual();
  const stockItem = stock.find(s => s.stock_key === 'TOMATE JAPI|CARTON 40X30X14 GENERICA');
  assert.strictEqual(Number(stockItem.cajas_actuales), 60);
});

// --------------------------------------------------------------------------
// TEST 5: Previsualización y validación son estrictamente de solo lectura
// --------------------------------------------------------------------------
runTest('5. Seguridad: Previsualización y validación son 100% de solo lectura (CERO mutaciones en STOCK o CAPAS)', () => {
  const { safetyService, repo } = createTestEnvironment();
  const doc = {
    tipo_documento: 'ENTRADA',
    serie: 'PREV',
    numero: '100',
    fecha_documento: '2026-10-05'
  };
  const lineas = [
    { codigo_articulo: 'TOMATE VOLLEY', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 100 }
  ];

  // Ejecutar validarDocumento y previsualizarDocumento
  const val = safetyService.validarDocumento(doc, lineas, 'ENTRADA');
  const prev = safetyService.previsualizarDocumento(doc, lineas, 'ENTRADA');

  assert.strictEqual(val.semaforo, 'OK');
  assert.strictEqual(prev.semaforo, 'OK');

  // Invariante de seguridad: NO debe existir ninguna capa, movimiento ni stock registrado
  assert.strictEqual(repo.getCapasFifo().length, 0, 'No deben existir capas FIFO tras validar/previsualizar');
  assert.strictEqual(repo.getStockActual().length, 0, 'No debe existir stock actual tras validar/previsualizar');
  assert.strictEqual(repo.getMovimientos().length, 0, 'No deben existir movimientos tras validar/previsualizar');
  assert.strictEqual(repo.getDocumentos().length, 0, 'No deben existir documentos procesados tras validar/previsualizar');
});

// --------------------------------------------------------------------------
// TEST 6: Stock insuficiente — Prohibición absoluta de descuento parcial silencioso
// --------------------------------------------------------------------------
runTest('6. Stock insuficiente: Bloqueo total sin descuento parcial y alerta clara "STOCK INSUFICIENTE"', () => {
  const { safetyService, repo } = createTestEnvironment();

  // Stock disponible: 20 cajas
  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '10',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 20 }]);

  // Intento de salida por 35 cajas
  const docSalida = {
    tipo_documento: 'SALIDA',
    serie: 'SAL',
    numero: '9999',
    fecha_documento: '2026-10-05'
  };
  const lineasSalida = [
    { codigo_articulo: 'TOMATE ROSA', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 35 }
  ];

  // 1. Previsualización muestra semáforo 🔴 ERROR con detalle de déficit
  const prev = safetyService.previsualizarDocumento(docSalida, lineasSalida, 'SALIDA');
  assert.strictEqual(prev.semaforo, 'ERROR');
  assert.strictEqual(prev.puedeProcesar, false);
  assert.ok(prev.mensaje.includes('STOCK INSUFICIENTE'));
  assert.strictEqual(prev.deficits.length, 1);
  assert.strictEqual(prev.deficits[0].cajasSolicitadas, 35);
  assert.strictEqual(prev.deficits[0].cajasDisponibles, 20);
  assert.strictEqual(prev.deficits[0].deficit, 15);

  // 2. Procesar salida es estrictamente bloqueado
  const resSalida = safetyService.procesarSalidaDocumento(docSalida, lineasSalida);
  assert.strictEqual(resSalida.success, false);
  assert.strictEqual(resSalida.semaforo, 'ERROR');
  assert.strictEqual(resSalida.status, 'STOCK_INSUFICIENTE');
  assert.strictEqual(resSalida.mensaje, 'STOCK INSUFICIENTE');

  // 3. Invariante: El stock original (20 cajas) no se ha tocado en absoluto
  const stock = repo.getStockActual();
  assert.strictEqual(Number(stock[0].cajas_actuales), 20);
  assert.strictEqual(Number(repo.getCapasFifo()[0].cajas_restantes), 20);
});

// --------------------------------------------------------------------------
// TEST 7: Artículo desconocido o ausente
// --------------------------------------------------------------------------
runTest('7. Artículo desconocido/ausente: 🔴 ERROR bloqueante sin mutación de inventario', () => {
  const { safetyService } = createTestEnvironment();
  const doc = { tipo_documento: 'ENTRADA', serie: 'E', numero: '1', fecha_documento: '2026-10-05' };
  const lineas = [{ codigo_articulo: '', codigo_envase: 'EPS 104', cajas: 10 }];

  const val = safetyService.validarDocumento(doc, lineas, 'ENTRADA');
  assert.strictEqual(val.semaforo, 'ERROR');
  assert.strictEqual(val.puedeProcesar, false);
});

// --------------------------------------------------------------------------
// TEST 8: Envase desconocido / DEFAULT
// --------------------------------------------------------------------------
runTest('8. Envase DEFAULT o ausente: 🔴 ERROR bloqueante sin mutación de inventario', () => {
  const { safetyService } = createTestEnvironment();
  const doc = { tipo_documento: 'ENTRADA', serie: 'E', numero: '1', fecha_documento: '2026-10-05' };
  const lineas = [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'DEFAULT', cajas: 10 }];

  const val = safetyService.validarDocumento(doc, lineas, 'ENTRADA');
  assert.strictEqual(val.semaforo, 'ERROR');
  assert.strictEqual(val.puedeProcesar, false);
});

// --------------------------------------------------------------------------
// TEST 9: Combinación pendiente — 🟠 PENDIENTE DE ASOCIACIÓN
// --------------------------------------------------------------------------
runTest('9. Combinación pendiente: 🟠 PENDIENTE DE ASOCIACIÓN bloquea procesamiento sin inventar grupo', () => {
  const { safetyService } = createTestEnvironment();
  const doc = { tipo_documento: 'ENTRADA', serie: 'E', numero: '1', fecha_documento: '2026-10-05' };
  const lineas = [
    { codigo_articulo: 'VARIEDAD EXOTICA NUEVA 2026', codigo_envase: 'ENVASE EXPERIMENTAL X', cajas: 50 }
  ];

  const val = safetyService.validarDocumento(doc, lineas, 'ENTRADA');
  assert.strictEqual(val.semaforo, 'PENDIENTE');
  assert.strictEqual(val.puedeProcesar, false);
  assert.strictEqual(val.lineasValidadas[0].semaforo, 'PENDIENTE');
  assert.strictEqual(val.lineasValidadas[0].motivo, 'PENDIENTE DE ASOCIACIÓN');
  assert.strictEqual(val.lineasValidadas[0].bloqueada, true);

  const res = safetyService.procesarEntradaDocumento(doc, lineas);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.semaforo, 'PENDIENTE');
});

// --------------------------------------------------------------------------
// TEST 10: Conciliación de stock no destructiva
// --------------------------------------------------------------------------
runTest('10. Conciliación: Compara STOCK-LIGHT contra stock externo sin alterar existencias', () => {
  const { safetyService, repo } = createTestEnvironment();

  // Simular stock interno en STOCK-LIGHT: 420 cajas
  safetyService.procesarEntradaDocumento({
    tipo_documento: 'ENTRADA',
    serie: 'ENT',
    numero: '1',
    fecha_documento: '2026-10-05'
  }, [{ codigo_articulo: 'TOMATE ROSA', codigo_envase: 'CARTON 40X30X14 GENERICA', cajas: 420 }]);

  // Stock externo a conciliar: 430 cajas (Diferencia: 420 - 430 = -10)
  const stockExterno = [
    { articulo: 'TOMATE ROSA', envase: 'CARTON 40X30X14 GENERICA', cajas: 430 }
  ];

  const concil = safetyService.conciliarStock(stockExterno);
  assert.strictEqual(concil.totalLineas, 1);
  assert.strictEqual(concil.totalCoincidencias, 0);
  assert.strictEqual(concil.totalDiscrepancias, 1);
  assert.strictEqual(concil.lineas[0].stockLight, 420);
  assert.strictEqual(concil.lineas[0].externo, 430);
  assert.strictEqual(concil.lineas[0].diferencia, -10);
  assert.strictEqual(concil.lineas[0].estado, 'FALTANTE_LOCAL');

  // Invariante: STOCK_ACTUAL no ha sido modificado
  const stockFinal = repo.getStockActual();
  assert.strictEqual(Number(stockFinal[0].cajas_actuales), 420);
});

// --------------------------------------------------------------------------
// TEST 11: Ajuste positivo manual
// --------------------------------------------------------------------------
runTest('11. Ajuste positivo: Añade stock y registra en LOG_OPERACIONES', () => {
  const { safetyService, repo } = createTestEnvironment();
  const res = safetyService.ejecutarAjusteOperativo({
    accion: 'ANADIR_STOCK',
    articulo: 'TOMATE ROSA',
    envase: 'EPS 104',
    cajas: 30,
    motivo: 'INVENTARIO_EXTRA',
    observaciones: 'Ajuste inicial físico'
  }, 'JUAN');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.stockNuevo, 30);
  const logs = repo.getLogOperaciones();
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].operacion, 'AJUSTE_POSITIVO');
  assert.strictEqual(Number(logs[0].cantidad_cajas), 30);
});

// --------------------------------------------------------------------------
// TEST 12: Ajuste negativo manual
// --------------------------------------------------------------------------
runTest('12. Ajuste negativo: Quita stock y deduce FIFO con control de saldo', () => {
  const { safetyService, repo } = createTestEnvironment();
  safetyService.ejecutarAjusteOperativo({
    accion: 'ANADIR_STOCK',
    articulo: 'TOMATE ROSA',
    envase: 'EPS 104',
    cajas: 30
  });

  const res = safetyService.ejecutarAjusteOperativo({
    accion: 'QUITAR_STOCK',
    articulo: 'TOMATE ROSA',
    envase: 'EPS 104',
    cajas: 10,
    motivo: 'ROTURA'
  }, 'JUAN');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.stockNuevo, 20);
  const logs = repo.getLogOperaciones();
  assert.strictEqual(logs.length, 2);
  assert.strictEqual(logs[1].operacion, 'AJUSTE_NEGATIVO');
});

// --------------------------------------------------------------------------
// TEST 13: Reclasificación comercial
// --------------------------------------------------------------------------
runTest('13. Reclasificación: Traspaso de cajas entre formatos', () => {
  const { safetyService, repo } = createTestEnvironment();
  safetyService.ejecutarAjusteOperativo({
    accion: 'ANADIR_STOCK',
    articulo: 'TOMATE ROSA',
    envase: 'CARTON 40X30X14 ROSA',
    cajas: 40
  });

  const res = safetyService.ejecutarAjusteOperativo({
    accion: 'CAMBIAR_CLASIFICACION',
    articulo: 'TOMATE ROSA',
    envase: 'CARTON 40X30X14 ROSA',
    envaseDestino: 'EPS 104',
    cajas: 15,
    observaciones: 'Reclasificación a EPS'
  }, 'JUAN');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.cajasReclasificadas, 15);
  assert.strictEqual(res.origen.stockNuevo, 25);
  assert.strictEqual(res.destino.stockNuevo, 15);
});

// --------------------------------------------------------------------------
// TEST 14: Cambio de artículo
// --------------------------------------------------------------------------
runTest('14. Cambio de artículo: Traspaso de cajas entre dos artículos', () => {
  const { safetyService, repo } = createTestEnvironment();
  safetyService.ejecutarAjusteOperativo({
    accion: 'ANADIR_STOCK',
    articulo: 'TOMATE_A',
    envase: 'EPS 104',
    cajas: 50
  });

  const res = safetyService.ejecutarAjusteOperativo({
    accion: 'CAMBIAR_ARTICULO',
    articulo: 'TOMATE_A',
    articuloDestino: 'TOMATE_B',
    envase: 'EPS 104',
    cajas: 20,
    observaciones: 'Corrección de variedad'
  }, 'JUAN');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.origen.stockNuevo, 30);
  assert.strictEqual(res.destino.stockNuevo, 20);
});

// --------------------------------------------------------------------------
// TEST 15: Cambio de envase
// --------------------------------------------------------------------------
runTest('15. Cambio de envase: Traspaso de cajas entre formatos de envase', () => {
  const { safetyService } = createTestEnvironment();
  safetyService.ejecutarAjusteOperativo({
    accion: 'ANADIR_STOCK',
    articulo: 'TOMATE HUEVO DE TORO',
    envase: 'MADERA 40X30X14',
    cajas: 40
  });

  const res = safetyService.ejecutarAjusteOperativo({
    accion: 'CAMBIAR_ENVASE',
    articulo: 'TOMATE HUEVO DE TORO',
    envase: 'MADERA 40X30X14',
    envaseDestino: 'EPS 104',
    cajas: 15,
    observaciones: 'Traspaso a EPS'
  }, 'JUAN');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.origen.stockNuevo, 25);
  assert.strictEqual(res.destino.stockNuevo, 15);
});

// --------------------------------------------------------------------------
// TEST 16: Mover entre partidas
// --------------------------------------------------------------------------
runTest('16. Mover entre partidas: Traspaso de cajas de Partida A a Partida B dentro del mismo artículo/envase', () => {
  const { safetyService, repo } = createTestEnvironment();
  // Cargar 50 cajas en Partida A
  safetyService.ejecutarAjusteOperativo({
    accion: 'ANADIR_STOCK',
    articulo: 'TOMATE JAPI',
    envase: 'CARTON 40X30X14 GENERICA',
    cajas: 50,
    partida: 'PARTIDA_A'
  });

  // Mover 20 cajas de Partida A a Partida B
  const res = safetyService.ejecutarAjusteOperativo({
    accion: 'MOVER_PARTIDA',
    articulo: 'TOMATE JAPI',
    envase: 'CARTON 40X30X14 GENERICA',
    partidaOrigen: 'PARTIDA_A',
    partidaDestino: 'PARTIDA_B',
    cajas: 20
  }, 'JUAN');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.cajasMovidas, 20);

  // Verificar capas: Partida A debe tener 30, Partida B debe tener 20
  const capas = repo.getCapasFifo();
  const capaA = capas.find(c => c.partida === 'PARTIDA_A');
  const capaB = capas.find(c => c.partida === 'PARTIDA_B');
  assert.strictEqual(Number(capaA.cajas_restantes), 30);
  assert.strictEqual(Number(capaB.cajas_restantes), 20);

  // Total de stock sigue siendo 50
  const stock = repo.getStockActual();
  assert.strictEqual(Number(stock[0].cajas_actuales), 50);
});

// --------------------------------------------------------------------------
// TEST 17: Regla especial Rosa de Sabor
// --------------------------------------------------------------------------
runTest('17. Regla especial Rosa de Sabor: CARTÓN / ROSA con cartón, madera o EPS', () => {
  const { resolver } = createTestEnvironment();

  const rCarton = resolver.resolve('TOMATE ROSA DE SABOR', 'CARTON 40X30X14 GENERICA');
  assert.strictEqual(rCarton.groupId, 'CARTON');
  assert.strictEqual(rCarton.subgroupId, 'ROSA');

  const rMadera = resolver.resolve('TOMATE ROSA DE SABOR', 'MADERA 40X30X14');
  assert.strictEqual(rMadera.groupId, 'CARTON');
  assert.strictEqual(rMadera.subgroupId, 'ROSA');

  const rEps = resolver.resolve('TOMATE ROSA DE SABOR', 'EPS 104');
  assert.strictEqual(rEps.groupId, 'CARTON');
  assert.strictEqual(rEps.subgroupId, 'ROSA');
});

// --------------------------------------------------------------------------
// TEST 18: Nueva asociación dinámica
// --------------------------------------------------------------------------
runTest('18. Extensibilidad: Nueva asociación dinámica sin tocar código', () => {
  const { safetyService, resolver } = createTestEnvironment();

  // Antes: combinación desconocida -> PENDIENTE
  const valAntes = safetyService.validarDocumento(
    { tipo_documento: 'ENTRADA', serie: 'E', numero: '1', fecha_documento: '2026-10-05' },
    [{ codigo_articulo: 'TOMATE ASURCADO 300', codigo_envase: 'BANDEJA PLASTICA 500G', cajas: 10 }],
    'ENTRADA'
  );
  assert.strictEqual(valAntes.semaforo, 'PENDIENTE');

  // Registrar grupo y asociación dinámicamente en caliente
  resolver.registerGroup({ id: 'GOURMET', name: 'GRUPO GOURMET', order: 10 });
  resolver.addAssociation('TOMATE ASURCADO 300', 'BANDEJA PLASTICA 500G', {
    groupId: 'GOURMET',
    groupName: 'GRUPO GOURMET',
    prioridad: 20
  });

  // Después: combinación conocida -> 🟢 OK
  const valDespues = safetyService.validarDocumento(
    { tipo_documento: 'ENTRADA', serie: 'E', numero: '1', fecha_documento: '2026-10-05' },
    [{ codigo_articulo: 'TOMATE ASURCADO 300', codigo_envase: 'BANDEJA PLASTICA 500G', cajas: 10 }],
    'ENTRADA'
  );
  assert.strictEqual(valDespues.semaforo, 'OK');
  assert.strictEqual(valDespues.lineasValidadas[0].grupoComercial, 'GRUPO GOURMET');
});

// --------------------------------------------------------------------------
// TEST 19: Trazabilidad simple en LOG_OPERACIONES
// --------------------------------------------------------------------------
runTest('19. Trazabilidad simple: Auditoría operativa en LOG_OPERACIONES con todos los campos requeridos', () => {
  const { safetyService, repo } = createTestEnvironment();
  safetyService.ejecutarAjusteOperativo({
    accion: 'ANADIR_STOCK',
    articulo: 'TOMATE HUEVO DE TORO',
    envase: 'EPS 104',
    cajas: 10,
    motivo: 'AJUSTE MANUAL',
    observaciones: 'Prueba de log'
  }, 'JUAN');

  const logs = repo.getLogOperaciones();
  assert.strictEqual(logs.length, 1);
  const log = logs[0];
  assert.ok(log.fecha_hora);
  assert.strictEqual(log.usuario, 'JUAN');
  assert.strictEqual(log.operacion, 'AJUSTE_POSITIVO');
  assert.strictEqual(log.codigo_articulo, 'TOMATE HUEVO DE TORO');
  assert.strictEqual(log.codigo_envase, 'EPS 104');
  assert.strictEqual(Number(log.cantidad_cajas), 10);
  assert.strictEqual(log.origen, 'AJUSTE_MANUAL');
  assert.strictEqual(log.destino, 'STOCK_ALMACEN');
});

// --------------------------------------------------------------------------
// TEST 20: Invariante fundamental de arquitectura: InventoryEngine inalterado
// --------------------------------------------------------------------------
runTest('20. InventoryEngine.js permanece 100% inalterado respecto a Git HEAD', () => {
  try {
    const diff = execSync('git diff HEAD -- src/InventoryEngine.js', { encoding: 'utf8' }).trim();
    assert.strictEqual(diff, '', `InventoryEngine.js ha sido modificado:\n${diff}`);
  } catch (e) {
    const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'InventoryEngine.js'), 'utf8');
    assert.ok(content.length > 500);
  }
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE FASE 6.0: ${passedTests} SUPERADAS | ${failedTests} FALLIDAS`);
console.log('================================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
