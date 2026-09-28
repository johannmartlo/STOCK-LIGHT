/**
 * STOCK-LIGHT — MaestroResolver.js
 * 
 * Servicio de Resolución contra el Catálogo de MAESTRO.
 * Resuelve códigos oficiales de artículo y envase evitando matching difuso agresivo.
 * 
 * Regla de Prioridad:
 * 1. Código explícito en el documento verificado en MAESTRO.
 * 2. Correspondencia exacta de descripción en MAESTRO.
 * 3. Sinónimos / alias tipificados explícitamente.
 * 4. Si no se resuelve: emitir REQUIERE_REVISION sin adivinar.
 */

class MaestroResolver {
  /**
   * @param {Array<Object>} maestroRecords - Lista de registros de la hoja MAESTRO:
   *   - codigo_articulo, codigo_envase, nombre_articulo, descripcion_envase, grupo_comercial, activo
   * @param {Array<Object>} [aliasRecords] - Mapeos opcionales de alias/sinónimos
   */
  constructor(maestroRecords = [], aliasRecords = []) {
    this.maestro = maestroRecords || [];
    this.alias = aliasRecords || [];

    // Índices de búsqueda rápida
    this._articleByCode = new Map();
    this._articleByName = new Map();
    this._envaseByCode = new Map();
    this._envaseByName = new Map();
    this._stockKeySet = new Set();

    this._buildIndexes();
  }

  _buildIndexes() {
    for (const row of this.maestro) {
      const artCode = String(row.codigo_articulo || '').trim();
      const artName = String(row.nombre_articulo || '').trim();
      const envCode = String(row.codigo_envase || '').trim();
      const envName = String(row.descripcion_envase || '').trim();

      if (artCode) {
        if (!this._articleByCode.has(artCode)) {
          this._articleByCode.set(artCode, { code: artCode, name: artName });
        }
      }
      if (artName) {
        this._articleByName.set(artName.toUpperCase(), { code: artCode, name: artName });
      }

      if (envCode) {
        if (!this._envaseByCode.has(envCode)) {
          this._envaseByCode.set(envCode, { code: envCode, name: envName });
        }
      }
      if (envName) {
        this._envaseByName.set(envName.toUpperCase(), { code: envCode, name: envName });
      }

      if (artCode && envCode) {
        this._stockKeySet.add(`${artCode}|${envCode}`);
      }
    }
  }

  /**
   * Resuelve el código y nombre canónico de un artículo.
   * 
   * @param {string} rawCode - Código encontrado en el documento (si existe)
   * @param {string} rawName - Nombre o descripción encontrada en el documento
   * @returns {Object} { resolved: boolean, code: string, name: string, method: string }
   */
  resolveArticle(rawCode, rawName) {
    const code = String(rawCode || '').trim();
    const name = String(rawName || '').trim();

    // 1. Código explícito presente en MAESTRO
    if (code && this._articleByCode.has(code)) {
      const match = this._articleByCode.get(code);
      return {
        resolved: true,
        code: match.code,
        name: match.name || name,
        method: 'CODIGO_EXPLICITO'
      };
    }

    // 2. Coincidencia exacta de nombre en MAESTRO
    if (name && this._articleByName.has(name.toUpperCase())) {
      const match = this._articleByName.get(name.toUpperCase());
      return {
        resolved: true,
        code: match.code,
        name: match.name,
        method: 'NOMBRE_EXACTO'
      };
    }

    // 3. Búsqueda en sinónimos conocidos
    const upperName = name.toUpperCase();
    const aliasMatch = this.alias.find(a => 
      a.tipo === 'ARTICULO' && String(a.alias || '').trim().toUpperCase() === upperName
    );
    if (aliasMatch && aliasMatch.codigo_oficial) {
      return {
        resolved: true,
        code: aliasMatch.codigo_oficial,
        name: aliasMatch.nombre_oficial || name,
        method: 'ALIAS_REGLA'
      };
    }

    // 4. No adivinar
    return {
      resolved: false,
      code: code || null,
      name: name || null,
      method: 'NO_RESUELTO',
      reason: `No se pudo resolver unívocamente el artículo (código='${code}', nombre='${name}')`
    };
  }

  /**
   * Resuelve el código y descripción canónica de un envase.
   * 
   * @param {string} rawCode 
   * @param {string} rawName 
   * @returns {Object} { resolved: boolean, code: string, name: string, method: string }
   */
  resolveEnvase(rawCode, rawName) {
    const code = String(rawCode || '').trim();
    const name = String(rawName || '').trim();

    // 1. Código explícito
    if (code && this._envaseByCode.has(code)) {
      const match = this._envaseByCode.get(code);
      return {
        resolved: true,
        code: match.code,
        name: match.name || name,
        method: 'CODIGO_EXPLICITO'
      };
    }

    // 2. Coincidencia exacta de descripción
    if (name && this._envaseByName.has(name.toUpperCase())) {
      const match = this._envaseByName.get(name.toUpperCase());
      return {
        resolved: true,
        code: match.code,
        name: match.name,
        method: 'DESCRIPCION_EXACTA'
      };
    }

    // 3. Normalizaciones habituales de envases conocidos (ej. EPS 104 vs EPS104)
    const normalizedKey = name.toUpperCase().replace(/[\s\-_]/g, '');
    for (const [key, val] of this._envaseByName.entries()) {
      if (key.replace(/[\s\-_]/g, '') === normalizedKey) {
        return {
          resolved: true,
          code: val.code,
          name: val.name,
          method: 'NORMALIZACION_ESPACIOS'
        };
      }
    }

    // 4. No adivinar
    return {
      resolved: false,
      code: code || null,
      name: name || null,
      method: 'NO_RESUELTO',
      reason: `No se pudo resolver unívocamente el envase (código='${code}', nombre='${name}')`
    };
  }

  /**
   * Verifica si la combinación (codigoArticulo, codigoEnvase) está registrada en MAESTRO.
   * @param {string} codigoArticulo 
   * @param {string} codigoEnvase 
   * @returns {boolean}
   */
  isValidStockPair(codigoArticulo, codigoEnvase) {
    const key = `${String(codigoArticulo || '').trim()}|${String(codigoEnvase || '').trim()}`;
    return this._stockKeySet.has(key);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MaestroResolver
  };
}
