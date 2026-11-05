/**
 * STOCK-LIGHT — Helper de Mocks para Google Sheets y Entorno de Pruebas
 * Exporta MockRange, MockSheet, MockSpreadsheet y crearEntorno(opciones).
 */

const { SheetsRepository } = require('../../src/Repository');
const { CommercialGroupResolver } = require('../../src/CommercialGroupResolver');
const { MovementService } = require('../../src/MovementService');
const { StockQueryService } = require('../../src/StockQueryService');
const { OperationalSafetyService } = require('../../src/OperationalSafetyService');

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
  constructor(id = 'TEST_SPREADSHEET') {
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

/**
 * Crea un entorno completo de prueba simulado.
 * Replica createTestEnvironment de fase6_1_correcciones_historicas.test.js.
 * 
 * @param {Object} [opciones]
 * @returns {Object}
 */
function crearEntorno(opciones = {}) {
  const ss = opciones.spreadsheet || new MockSpreadsheet(opciones.id || 'TEST_SPREADSHEET');
  const repo = opciones.repository || new SheetsRepository({ spreadsheet: ss });
  if (!opciones.skipProvision) {
    repo.provisionDatabase();
  }

  const resolver = opciones.commercialResolver || new CommercialGroupResolver({ repository: repo });
  const lockMock = opciones.lockService || { waitLock: () => true, releaseLock: () => {} };
  const movService = opciones.movementService || new MovementService({ repository: repo, lockService: lockMock });
  const queryService = opciones.stockQueryService || new StockQueryService({ repository: repo, commercialGroupResolver: resolver });
  const safetyService = opciones.operationalSafetyService || new OperationalSafetyService({
    repository: repo,
    movementService: movService,
    commercialResolver: resolver,
    stockQueryService: queryService,
    lockService: lockMock
  });

  return {
    ss,
    spreadsheet: ss,
    repo,
    repository: repo,
    resolver,
    commercialResolver: resolver,
    movService,
    movementService: movService,
    queryService,
    stockQueryService: queryService,
    safetyService,
    operationalSafetyService: safetyService,
    lock: lockMock,
    lockService: lockMock
  };
}

module.exports = {
  MockRange,
  MockSheet,
  MockSpreadsheet,
  crearEntorno
};
