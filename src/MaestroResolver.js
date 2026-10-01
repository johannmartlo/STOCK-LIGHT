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

/**
 * Reglas deterministas homologadas para resolución de envases en Albaranes de Compra Hispatec.
 * Aisladas y explícitas. Si no hay regla homologada para un artículo, pasa obligatoriamente a PENDIENTE_REVISION.
 */
const DETERMINISTIC_COMPRA_RULES = [
  // 1. Tomate Rosa I (granel / kilos / modalidad 19xxxxxx) -> EPS104
  {
    ruleName: 'REGLA_COMPRA_ROSA_I_EPS104',
    matches: (artCode, artName, unit) => {
      const name = String(artName || '').trim().toUpperCase();
      const code = String(artCode || '').trim();
      return name === 'TOMATE ROSA I' || code === '19127111';
    },
    envaseCode: 'EPS104',
    envaseName: 'EPS 104'
  },
  // 2. Tomate Rosa I M en UNIDADES (confección bandejas 9x500 / modalidad 10xxxxxx) -> EPS106
  {
    ruleName: 'REGLA_COMPRA_ROSA_IM_UNID_EPS106',
    matches: (artCode, artName, unit) => {
      const name = String(artName || '').trim().toUpperCase();
      const code = String(artCode || '').trim();
      const u = String(unit || '').trim().toUpperCase();
      return (name === 'TOMATE ROSA I M' || code === '10127111') && u === 'UNID';
    },
    envaseCode: 'EPS106',
    envaseName: 'EPS 106 9x500'
  },
  // 3. Tomate Moresco I MM -> CT4395MAD (Madera)
  {
    ruleName: 'REGLA_COMPRA_MORESCO_IMM_CT4395MAD',
    matches: (artCode, artName, unit) => {
      const name = String(artName || '').trim().toUpperCase();
      return name === 'TOMATE MORESCO I MM';
    },
    envaseCode: 'CT4395MAD',
    envaseName: 'CT4395MAD'
  },
  // 4. Tomate Moresco (I M, I G, I GG) -> CT4395 (Moresco estándar)
  {
    ruleName: 'REGLA_COMPRA_MORESCO_CT4395',
    matches: (artCode, artName, unit) => {
      const name = String(artName || '').trim().toUpperCase();
      return ['TOMATE MORESCO I M', 'TOMATE MORESCO I G', 'TOMATE MORESCO I GG'].includes(name);
    },
    envaseCode: 'CT4395',
    envaseName: 'CT4395 MORESCO'
  },
  // 5. Tomate Rosa Sabor (I G, I GG, I M) -> CT4395 (Royal Pink)
  {
    ruleName: 'REGLA_COMPRA_ROSA_SABOR_CT4395',
    matches: (artCode, artName, unit) => {
      const name = String(artName || '').trim().toUpperCase();
      return ['TOMATE ROSA SABOR I G', 'TOMATE ROSA SABOR I GG', 'TOMATE ROSA SABOR I M'].includes(name);
    },
    envaseCode: 'CT4395',
    envaseName: 'CARTON 40x30x9,5 ROYAL PINK'
  }
];

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

      // DEFAULT nunca es un envase comercial válido de stock
      if (envCode && envCode !== 'DEFAULT' && envCode !== 'ENVASE_NO_DETERMINABLE_DESDE_PDF') {
        if (!this._envaseByCode.has(envCode)) {
          this._envaseByCode.set(envCode, { code: envCode, name: envName });
        }
        if (envName) {
          this._envaseByName.set(envName.toUpperCase(), { code: envCode, name: envName });
        }
        if (artCode) {
          this._stockKeySet.add(`${artCode}|${envCode}`);
        }
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

    // 0. Bloqueo estricto de DEFAULT o valores inválidos
    if (code === 'DEFAULT' || name === 'DEFAULT' || code === 'ENVASE_NO_DETERMINABLE_DESDE_PDF') {
      return {
        resolved: false,
        code: null,
        name: null,
        method: 'NO_RESUELTO',
        reason: 'DEFAULT o valor no determinable no es un envase válido de stock.'
      };
    }

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
   * Resuelve el envase para una línea de ALBARÁN DE COMPRA mediante reglas deterministas homologadas.
   * Si no existe regla que aplique determinísticamente, devuelve resolved: false con PENDIENTE_REVISION.
   * 
   * @param {string} artCode - Código resuelto o raw del artículo
   * @param {string} artName - Nombre del artículo
   * @param {string} [unit] - Unidad ('KG' o 'UNID')
   * @returns {Object} { resolved: boolean, code: string|null, name: string|null, method: string, reason?: string }
   */
  resolveEnvaseCompra(artCode, artName, unit = '') {
    const artC = String(artCode || '').trim();
    const artN = String(artName || '').trim();

    for (const rule of DETERMINISTIC_COMPRA_RULES) {
      if (rule.matches(artC, artN, unit)) {
        // Verificar que la combinación sea válida en MAESTRO para este artículo
        if (this.isValidStockPair(artC, rule.envaseCode)) {
          return {
            resolved: true,
            code: rule.envaseCode,
            name: rule.envaseName,
            method: rule.ruleName
          };
        }
      }
    }

    return {
      resolved: false,
      code: null,
      name: null,
      method: 'REQUIERE_REVISION_HUMANA',
      reason: 'ENVASE_NO_DETERMINABLE_DESDE_PDF'
    };
  }

  /**
   * Obtiene la lista de envases comerciales activos permitidos para un artículo según MAESTRO.
   * Excluye estrictamente 'DEFAULT' o cadenas no comerciales.
   * 
   * @param {string} codigoArticulo 
   * @returns {Array<{ codigo_envase: string, descripcion_envase: string }>}
   */
  getEnvasesPermitidos(codigoArticulo) {
    const artCode = String(codigoArticulo || '').trim();
    if (!artCode) return [];

    const permitidos = [];
    const seen = new Set();

    for (const row of this.maestro) {
      if (String(row.codigo_articulo || '').trim() === artCode && row.activo !== false) {
        const envCode = String(row.codigo_envase || '').trim();
        if (envCode && envCode !== 'DEFAULT' && envCode !== 'ENVASE_NO_DETERMINABLE_DESDE_PDF' && !seen.has(envCode)) {
          seen.add(envCode);
          permitidos.push({
            codigo_envase: envCode,
            descripcion_envase: String(row.descripcion_envase || envCode).trim()
          });
        }
      }
    }

    return permitidos;
  }

  /**
   * Valida si un código de envase está específicamente permitido para un artículo.
   * 
   * @param {string} codigoArticulo 
   * @param {string} codigoEnvase 
   * @returns {boolean}
   */
  isEnvasePermitidoParaArticulo(codigoArticulo, codigoEnvase) {
    const artCode = String(codigoArticulo || '').trim();
    const envCode = String(codigoEnvase || '').trim();
    if (!artCode || !envCode || envCode === 'DEFAULT' || envCode === 'ENVASE_NO_DETERMINABLE_DESDE_PDF') {
      return false;
    }
    const permitidos = this.getEnvasesPermitidos(artCode);
    return permitidos.some(p => p.codigo_envase === envCode);
  }

  /**
   * Verifica si la combinación (codigoArticulo, codigoEnvase) está registrada en MAESTRO.
   * @param {string} codigoArticulo 
   * @param {string} codigoEnvase 
   * @returns {boolean}
   */
  isValidStockPair(codigoArticulo, codigoEnvase) {
    const artCode = String(codigoArticulo || '').trim();
    const envCode = String(codigoEnvase || '').trim();
    if (!artCode || !envCode || envCode === 'DEFAULT' || envCode === 'ENVASE_NO_DETERMINABLE_DESDE_PDF') {
      return false;
    }
    const key = `${artCode}|${envCode}`;
    return this._stockKeySet.has(key);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MaestroResolver,
    DETERMINISTIC_COMPRA_RULES
  };
}
