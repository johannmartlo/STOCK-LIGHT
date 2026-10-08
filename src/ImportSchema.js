/**
 * STOCK-LIGHT — ImportSchema.js
 * 
 * Definición de esquemas de ingesta, sinónimos de encabezados y
 * utilidades de parsing y mapeo flexible de columnas para importación de maestros.
 */

// Sinónimos de encabezados reconocidos para MAESTRO_ENVASES
const ENVASES_HEADER_SYNONYMS = {
  codigo_envase: [
    'codigo', 'código', 'envasecodigo', 'codenvase', 'cod_articulo',
    'codigoarticulo', 'cod_envase', 'codigo_envase'
  ],
  descripcion_envase: [
    'nombre', 'descripcion', 'descripción', 'envasedescripcioncorta',
    'nomarticulo', 'nombre_envase', 'descripcion_envase', 'nombrearticulo'
  ],
  alias: [
    'alias', 'descrip_corta', 'descripcioncorta', 'descripción corta',
    'mnemonic', 'aliasarticulo'
  ],
  codigo_familia: [
    'codigofamilia', 'código familia', 'codfamilia', 'familiacodigo',
    'codigo_familia', 'cod_familia'
  ],
  familia: [
    'familia', 'nombrefamilia', 'familianombre', 'nombre_familia',
    'nom_familia'
  ],
  tara_kg: [
    'tara', 'tarakg', 'tara_kg', 'pesotara', 'tara (kg)',
    'tara_unit', 'tara unitaria', 'tara_oficial'
  ],
  activo: [
    'activo', 'estado', 'baja', 'is_active'
  ],
  es_retornable_pool: [
    'esretornable', 'es_retornable', 'espool', 'es_pool',
    'pool', 'fianza', 'retornable'
  ]
};

// Sinónimos de encabezados reconocidos para ARTICULO_ENVASE
const ARTICULO_ENVASE_HEADER_SYNONYMS = {
  codigo_articulo: [
    'codigoarticulo', 'código artículo', 'articulocodigo',
    'codarticulo', 'codigo_articulo', 'artículo', 'articulo',
    'codigo_art', 'cod_art'
  ],
  nombre_articulo: [
    'nombrearticulo', 'articulonombre', 'nomarticulo',
    'descripcion_articulo', 'nombre_articulo', 'descripcionarticulo',
    'nom_articulo'
  ],
  codigo_envase: [
    'codigoenvase', 'código envase', 'envasecodigo',
    'codenvase', 'codigo_envase', 'envase', 'cod_envase'
  ],
  nombre_envase: [
    'nombreenvase', 'envasenombre', 'descripcionenvase',
    'envasedescripcioncorta', 'nombre_envase', 'nom_envase'
  ],
  es_predeterminado: [
    'espredeterminado', 'es_predeterminado', 'predeterminado',
    'defecto', 'is_default'
  ],
  activo: [
    'activo', 'estado', 'baja', 'is_active'
  ],
  tenant_id: [
    'tenantid', 'tenant_id', 'tenant', 'empresa', 'company_id'
  ],
  grupo_comercial: [
    'grupocomercial', 'grupo_comercial', 'grupocom', 'grupo'
  ]
};

// Especificación de obligatoriedad
const ENVASES_SCHEMA_SPEC = {
  mandatory: ['codigo_envase', 'descripcion_envase', 'codigo_familia', 'familia'],
  optional: ['alias', 'tara_kg', 'activo', 'es_retornable_pool']
};

const ARTICULO_ENVASE_SCHEMA_SPEC = {
  mandatory: ['codigo_articulo', 'nombre_articulo', 'codigo_envase', 'nombre_envase'],
  optional: ['es_predeterminado', 'activo', 'tenant_id', 'grupo_comercial']
};

/**
 * Normaliza una cadena de texto para matching de encabezados:
 * minúsculas, sin tildes ni caracteres especiales, sin espacios superfluos.
 * @param {string} header
 * @returns {string}
 */
function normalizeHeaderName(header) {
  if (!header || typeof header !== 'string') return '';
  return header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Resuelve el mapeo de columnas entre encabezados físicos y campos lógicos.
 * Detecta duplicados de columna física y valida presencia de campos obligatorios.
 * 
 * @param {Array<string>} rawHeaders Encabezados extraídos del archivo CSV
 * @param {Object} synonymDict Diccionario de sinónimos lógicos -> lista de cadenas
 * @param {Object} spec Especificación { mandatory: [...], optional: [...] }
 * @returns {Object} { ok: boolean, mapping: Object, errors: Array<string>, warnings: Array<string> }
 */
function resolveHeaderMapping(rawHeaders, synonymDict, spec) {
  const mapping = {};
  const seenLogicalFields = {};
  const errors = [];
  const warnings = [];

  rawHeaders.forEach((rawH, colIdx) => {
    const normH = normalizeHeaderName(rawH);
    if (!normH) return;

    // Buscar a qué campo lógico corresponde
    let matchedLogical = null;
    for (const [logicalField, synonyms] of Object.entries(synonymDict)) {
      for (const syn of synonyms) {
        if (normH === normalizeHeaderName(syn)) {
          matchedLogical = logicalField;
          break;
        }
      }
      if (matchedLogical) break;
    }

    if (matchedLogical) {
      if (seenLogicalFields[matchedLogical] !== undefined) {
        errors.push(`Columna duplicada detectada: '${rawH}' colisiona con la columna '${rawHeaders[seenLogicalFields[matchedLogical]]}' para el campo lógico '${matchedLogical}'.`);
      } else {
        seenLogicalFields[matchedLogical] = colIdx;
        mapping[matchedLogical] = {
          colIndex: colIdx,
          rawHeader: rawH
        };
      }
    }
  });

  // Verificar presencia de campos obligatorios
  for (const mandField of spec.mandatory) {
    if (!mapping[mandField]) {
      errors.push(`Columna obligatoria ausente: No se encontró ninguna columna coincidente para '${mandField}'.`);
    }
  }

  return {
    ok: errors.length === 0,
    mapping,
    errors,
    warnings
  };
}

/**
 * Parser de texto CSV robusto con soporte para comas, puntos y comas,
 * comillas escapadas y saltos de línea internos.
 * 
 * @param {string} csvText
 * @param {string} [forcedDelimiter]
 * @returns {Array<Array<string>>}
 */
function parseCSV(csvText, forcedDelimiter = null) {
  if (!csvText || typeof csvText !== 'string') return [];
  const text = csvText.trim();
  if (text.length === 0) return [];

  // Detección automática de delimitador si no se fuerza
  let delimiter = forcedDelimiter;
  if (!delimiter) {
    const firstLine = text.split(/\r?\n/)[0] || '';
    const commas = (firstLine.match(/,/g) || []).length;
    const semicolons = (firstLine.match(/;/g) || []).length;
    const tabs = (firstLine.match(/\t/g) || []).length;
    if (semicolons > commas && semicolons > tabs) {
      delimiter = ';';
    } else if (tabs > commas && tabs > semicolons) {
      delimiter = '\t';
    } else {
      delimiter = ',';
    }
  }

  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // Saltar comilla escapada
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // Tratar \r\n como un único salto
      }
      currentRow.push(currentField.trim());
      currentField = '';
      if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ENVASES_HEADER_SYNONYMS,
    ARTICULO_ENVASE_HEADER_SYNONYMS,
    ENVASES_SCHEMA_SPEC,
    ARTICULO_ENVASE_SCHEMA_SPEC,
    normalizeHeaderName,
    resolveHeaderMapping,
    parseCSV
  };
}
