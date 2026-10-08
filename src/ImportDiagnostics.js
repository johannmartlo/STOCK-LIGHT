/**
 * STOCK-LIGHT — ImportDiagnostics.js
 * 
 * Códigos de diagnóstico estructurados y generador de informes de validación
 * para importación de maestros y matrices relacionales.
 */

const DIAGNOSTIC_CODES = {
  // Errores de Envases
  ENVASE_CODIGO_VACIO: 'ENVASE_CODIGO_VACIO',
  ENVASE_CODIGO_DUPLICADO: 'ENVASE_CODIGO_DUPLICADO',
  ENVASE_CODIGO_UUID: 'ENVASE_CODIGO_UUID',
  ENVASE_DESCRIPCION_VACIA: 'ENVASE_DESCRIPCION_VACIA',
  ENVASE_DESCRIPCION_CORTA: 'ENVASE_DESCRIPCION_CORTA',
  ENVASE_DESCRIPCION_INCONSISTENTE: 'ENVASE_DESCRIPCION_INCONSISTENTE',
  ENVASE_FAMILIA_VACIA: 'ENVASE_FAMILIA_VACIA',
  TARA_NEGATIVA: 'TARA_NEGATIVA',

  // Warnings de Envases
  TARA_NO_INFORMADA: 'TARA_NO_INFORMADA',
  TARA_CERO_REQUIERE_REVISION: 'TARA_CERO_REQUIERE_REVISION',
  WARNING_HISTORICO_TARA: 'WARNING_HISTORICO_TARA',

  // Errores de Articulo-Envase
  ARTICULO_CODIGO_VACIO: 'ARTICULO_CODIGO_VACIO',
  ARTICULO_NO_EXISTE: 'ARTICULO_NO_EXISTE',
  ENVASE_NO_EXISTE: 'ENVASE_NO_EXISTE',
  RELACION_DUPLICADA: 'RELACION_DUPLICADA',
  ARTICULO_INACTIVO: 'ARTICULO_INACTIVO',
  ENVASE_INACTIVO: 'ENVASE_INACTIVO',

  // Estructura y Archivo
  COLUMNA_OBLIGATORIA_FALTANTE: 'COLUMNA_OBLIGATORIA_FALTANTE',
  COLUMNA_DUPLICADA: 'COLUMNA_DUPLICADA',
  ARCHIVO_DUPLICADO_SHA256: 'ARCHIVO_DUPLICADO_SHA256',

  // Conflictos de predeterminado y reglas de negocio
  CONFLICTO_PREDETERMINADO_MULTIPLE: 'CONFLICTO_PREDETERMINADO_MULTIPLE',
  TENANT_INVALIDO: 'TENANT_INVALIDO',
  ENVASE_COMERCIAL_INVALIDO: 'ENVASE_COMERCIAL_INVALIDO'
};

class DiagnosticReport {
  /**
   * @param {string} [archivo] Nombre del archivo evaluado
   */
  constructor(archivo = '') {
    this.archivo = archivo;
    this.totalFilas = 0;
    this.filasConError = new Set();
    this.filasConWarning = new Set();
    this.errores = [];
    this.warnings = [];
    this.registrosNormalizados = [];
    this.cardinalidad = {};
    this.conciliacion = null;
  }

  /**
   * Registra un error de validación
   */
  addError({ fila = 0, campo = '', valor = '', codigoError = '', descripcion = '', archivo = '' }) {
    const file = archivo || this.archivo;
    this.errores.push({
      archivo: file,
      fila,
      campo,
      valor: String(valor !== undefined && valor !== null ? valor : ''),
      codigoError,
      descripcion
    });
    if (fila > 0) this.filasConError.add(fila);
  }

  /**
   * Registra una advertencia de validación
   */
  addWarning({ fila = 0, campo = '', valor = '', codigoWarning = '', descripcion = '', archivo = '' }) {
    const file = archivo || this.archivo;
    this.warnings.push({
      archivo: file,
      fila,
      campo,
      valor: String(valor !== undefined && valor !== null ? valor : ''),
      codigoWarning,
      descripcion
    });
    if (fila > 0) this.filasConWarning.add(fila);
  }

  addNormalizedRecord(record) {
    this.registrosNormalizados.push(record);
  }

  setCardinality(cardinalityMap) {
    this.cardinalidad = cardinalityMap || {};
  }

  setReconciliation(reconciliationReport) {
    this.conciliacion = reconciliationReport || null;
  }

  toObject() {
    const totalConError = this.filasConError.size;
    const totalConWarning = this.filasConWarning.size;
    const validas = Math.max(0, this.totalFilas - totalConError);
    const ok = this.errores.length === 0;

    return {
      ok,
      archivo: this.archivo,
      totalFilas: this.totalFilas,
      filasValidas: validas,
      filasConWarning: totalConWarning,
      filasConError: totalConError,
      errores: this.errores,
      warnings: this.warnings,
      registrosNormalizados: this.registrosNormalizados,
      cardinalidad: this.cardinalidad,
      conciliacion: this.conciliacion,
      resumen: {
        totalErrores: this.errores.length,
        totalWarnings: this.warnings.length,
        estadoGeneral: ok ? (this.warnings.length > 0 ? 'VALIDO_CON_ADVERTENCIAS' : 'VALIDO') : 'RECHAZADO'
      }
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIAGNOSTIC_CODES,
    DiagnosticReport
  };
}
