/**
 * STOCK-LIGHT — CommercialGroupResolver.js
 * 
 * Capa de Clasificación Comercial y Agrupación Visual de Existencias.
 * 
 * PRINCIPIOS DE ARQUITECTURA:
 * 1. Independencia del Motor de Inventario: InventoryEngine calcula stock físico puro FIFO;
 *    CommercialGroupResolver clasifica comercialmente las combinaciones ARTÍCULO + ENVASE.
 * 2. Basado en Datos y Configuración: No utiliza bloques monolíticos de if/else acoplados.
 *    La clasificación se basa en la matriz de asociaciones validadas y en reglas declarativas
 *    priorizadas y configurables.
 * 3. Jerarquía y Subgrupos: Soporta grupos principales (EPS, HUEVO DE TORO, VOLLEY/CORAZÓN DE BUEY,
 *    JAPI/JAPONÉS, CARTÓN, CARREFOUR) y subgrupos (en CARTÓN: AZUL, ROSA, MORESCO, OTROS).
 * 4. Extensibilidad y Trazabilidad: Permite registrar dinámicamente nuevas combinaciones,
 *    desactivar asociaciones, redefinir reglas por campaña y auditar el origen/regla de cada asignación.
 */

// Importaciones condicionales para entorno Node.js
let _parseCsvFn = null;
if (typeof require !== 'undefined') {
  try {
    const importSchemaMod = require('./ImportSchema');
    _parseCsvFn = importSchemaMod.parseCSV;
  } catch (e) {
    // fallback interno
  }
}

/**
 * Normaliza cadenas de texto para búsqueda canónica:
 * Mayúsculas, sin acentos (NFD), espacios colapsados.
 * @param {string} text 
 * @returns {string}
 */
function normalizeCommercialText(text) {
  if (!text) return '';
  return String(text)
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[,;.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Grupos comerciales oficiales y sus especificaciones canónicas.
 */
const COMMERCIAL_GROUPS = {
  EPS: {
    id: 'EPS',
    name: 'TOMATE EN CAJA EPS',
    order: 1,
    subgroups: []
  },
  HUEVO_TORO: {
    id: 'HUEVO_TORO',
    name: 'TOMATE HUEVO DE TORO',
    order: 2,
    subgroups: []
  },
  VOLLEY: {
    id: 'VOLLEY',
    name: 'TOMATE VOLLEY Y CORAZÓN DE BUEY',
    order: 3,
    subgroups: []
  },
  JAPI_JAPONES: {
    id: 'JAPI_JAPONES',
    name: 'TOMATE JAPI Y JAPONÉS',
    order: 4,
    subgroups: []
  },
  CARTON: {
    id: 'CARTON',
    name: 'TOMATES EN CAJA DE CARTÓN',
    order: 5,
    subgroups: [
      { id: 'AZUL', name: 'AZUL', order: 1 },
      { id: 'ROSA', name: 'ROSA', order: 2 },
      { id: 'MORESCO', name: 'MORESCO', order: 3 },
      { id: 'OTROS', name: 'OTROS', order: 4 }
    ]
  },
  CARREFOUR: {
    id: 'CARREFOUR',
    name: 'CARREFOUR',
    order: 6,
    subgroups: []
  },
  NO_CLASIFICADO: {
    id: 'NO_CLASIFICADO',
    name: 'PENDIENTE DE ASOCIACIÓN',
    order: 99,
    subgroups: []
  }
};

/**
 * Artículos reconocidos formalmente en el programa comercial Carrefour.
 */
const CARREFOUR_OFFICIAL_ARTICLES = [
  'TOMATE PERA RAMA I M',
  'TOMATE COCKTAIL I M',
  'TOMATE COCKTAIL SUNSTREAM I M',
  'TOMATE COCKTAIL SAO PAULO I M',
  'TOMATE CHERRY RAMA SUNSTREAM TERMO EXTRA',
  'TOMATE CHERRY RAMA SAO PAULO TERMO EXTRA'
];

/**
 * Mapeo de nombres descriptivos de la matriz hacia el modelo canónico { groupId, groupName, subgroupId, subgroupName }.
 * @param {string} rawGroupName 
 * @returns {{ groupId: string, groupName: string, subgroupId: string|null, subgroupName: string|null }}
 */
function parseRawGroupName(rawGroupName) {
  const norm = normalizeCommercialText(rawGroupName);
  if (!norm) {
    return {
      groupId: COMMERCIAL_GROUPS.NO_CLASIFICADO.id,
      groupName: COMMERCIAL_GROUPS.NO_CLASIFICADO.name,
      subgroupId: null,
      subgroupName: null
    };
  }

  if (norm.includes('CARREFOUR')) {
    return {
      groupId: COMMERCIAL_GROUPS.CARREFOUR.id,
      groupName: COMMERCIAL_GROUPS.CARREFOUR.name,
      subgroupId: null,
      subgroupName: null
    };
  }

  if (norm.includes('EPS')) {
    return {
      groupId: COMMERCIAL_GROUPS.EPS.id,
      groupName: COMMERCIAL_GROUPS.EPS.name,
      subgroupId: null,
      subgroupName: null
    };
  }

  if (norm.includes('HUEVO DE TORO') || norm.includes('HUEVO TORO')) {
    return {
      groupId: COMMERCIAL_GROUPS.HUEVO_TORO.id,
      groupName: COMMERCIAL_GROUPS.HUEVO_TORO.name,
      subgroupId: null,
      subgroupName: null
    };
  }

  if (norm.includes('VOLLEY') || norm.includes('CORAZON DE BUEY') || norm.includes('CORAZON BUEY')) {
    return {
      groupId: COMMERCIAL_GROUPS.VOLLEY.id,
      groupName: COMMERCIAL_GROUPS.VOLLEY.name,
      subgroupId: null,
      subgroupName: null
    };
  }

  if (norm.includes('JAPI') || norm.includes('JAPONES')) {
    return {
      groupId: COMMERCIAL_GROUPS.JAPI_JAPONES.id,
      groupName: COMMERCIAL_GROUPS.JAPI_JAPONES.name,
      subgroupId: null,
      subgroupName: null
    };
  }

  if (norm.includes('CARTON')) {
    let subgroupId = 'OTROS';
    let subgroupName = 'OTROS';
    if (norm.includes('AZUL')) {
      subgroupId = 'AZUL';
      subgroupName = 'AZUL';
    } else if (norm.includes('ROSA')) {
      subgroupId = 'ROSA';
      subgroupName = 'ROSA';
    } else if (norm.includes('MORESCO')) {
      subgroupId = 'MORESCO';
      subgroupName = 'MORESCO';
    }
    return {
      groupId: COMMERCIAL_GROUPS.CARTON.id,
      groupName: COMMERCIAL_GROUPS.CARTON.name,
      subgroupId,
      subgroupName
    };
  }

  return {
    groupId: COMMERCIAL_GROUPS.NO_CLASIFICADO.id,
    groupName: COMMERCIAL_GROUPS.NO_CLASIFICADO.name,
    subgroupId: null,
    subgroupName: null
  };
}

/**
 * Extrae categoría comercial y calibre a partir de la denominación del artículo.
 * @param {string} nombreArticulo 
 * @returns {{ categoria: string, calibre: string, calibreCategoria: string }}
 */
function extraerCalibreYCategoria(nombreArticulo) {
  const norm = normalizeCommercialText(nombreArticulo);
  if (!norm) {
    return { categoria: 'S/C', calibre: 'S/C', calibreCategoria: 'S/C' };
  }

  // 1. Detección de Categoría
  let categoria = '';
  if (/\bEXTRA\b/.test(norm)) {
    categoria = 'EXTRA';
  } else if (/\bII\b/.test(norm)) {
    categoria = '2ª CATEGORÍA (II)';
  } else if (/\bI\b/.test(norm)) {
    categoria = '1ª CATEGORÍA (I)';
  } else if (norm.includes('VOLLEY')) {
    categoria = '1ª CATEGORÍA (VOLLEY)';
  } else if (norm.includes('CORAZON DE BUEY')) {
    categoria = '2ª CATEGORÍA (CORAZÓN DE BUEY)';
  } else if (norm.includes('JAPI')) {
    categoria = '1ª CATEGORÍA (JAPI)';
  } else if (norm.includes('JAPONES')) {
    categoria = '2ª CATEGORÍA (JAPONÉS)';
  } else {
    categoria = 'ESTÁNDAR';
  }

  // 2. Detección de Calibre
  let calibre = '';
  const tokens = norm.split(' ');
  // Tokens típicos de calibre al final o aislados
  const calibrePatterns = [
    'S/C', 'GGG', 'GG/GGG', 'GG', 'G', 'MMM', 'MM', 'M', 'UND', 'UNID',
    '500G', '750G', '300G', '250G', '200G', '180G', '225G'
  ];

  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/[(),;]/g, '');
    if (calibrePatterns.includes(t)) {
      calibre = t;
      break;
    }
  }

  if (!calibre) {
    // Buscar patrones con regex
    const matchKg = norm.match(/\b(\d+(?:[.,]\d+)?\s*(?:KG|G))\b/);
    if (matchKg) {
      calibre = matchKg[1];
    } else {
      calibre = 'S/C';
    }
  }

  const calibreCategoria = (categoria && calibre !== 'S/C') ? `${categoria} - ${calibre}` : categoria;

  return { categoria, calibre, calibreCategoria };
}

class CommercialGroupResolver {
  /**
   * @param {Object} [options]
   * @param {Array<Object>} [options.matrixRecords] - Registros iniciales de matriz explícita
   * @param {string} [options.matrixCsvText] - CSV con la matriz validada
   * @param {string} [options.matrixFilePath] - Ruta al CSV de referencia en disco
   * @param {Array<Object>} [options.customRules] - Reglas declarativas adicionales
   * @param {boolean} [options.autoLoadDefaultMatrix=true] - Si intenta cargar la matriz base en Node.js
   */
  constructor(options = {}) {
    this.groups = { ...COMMERCIAL_GROUPS };
    this.associations = new Map(); // key: norm(articulo)|norm(envase) -> associationObject
    this.rules = [];
    this.auditLog = [];

    // Inicializar reglas declarativas base por prioridad
    this._initBaseRules();

    // Cargar reglas personalizadas si se proporcionan
    if (Array.isArray(options.customRules)) {
      options.customRules.forEach(r => this.registerRule(r));
    }

    // Cargar grupos comerciales dinámicos si se proporcionan
    if (Array.isArray(options.gruposComerciales)) {
      this.loadGroups(options.gruposComerciales);
    }

    // Cargar desde repositorio de persistencia si se proporciona
    if (options.repository) {
      this.loadFromRepository(options.repository);
    }

    // Cargar matriz explícita
    if (Array.isArray(options.matrixRecords)) {
      this.loadMatrix(options.matrixRecords);
    } else if (typeof options.matrixCsvText === 'string') {
      this.loadMatrixCsv(options.matrixCsvText);
    } else if (options.matrixFilePath && typeof require !== 'undefined') {
      try {
        const fs = require('fs');
        const text = fs.readFileSync(options.matrixFilePath, 'utf8');
        this.loadMatrixCsv(text);
      } catch (e) {
        // archivo no accesible
      }
    } else if (options.autoLoadDefaultMatrix !== false && typeof require !== 'undefined') {
      try {
        const fs = require('fs');
        const path = require('path');
        const defaultPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
        if (fs.existsSync(defaultPath)) {
          const text = fs.readFileSync(defaultPath, 'utf8');
          this.loadMatrixCsv(text);
        }
      } catch (e) {
        // entorno sin fs o sin ruta
      }
    }
  }

  /**
   * Inicializa las reglas declarativas comerciales con orden estricto de precedencia:
   * NIVEL 1: REGLA ESPECÍFICA DE ARTÍCULO (priority 1..19)
   * NIVEL 2: ASOCIACIÓN ARTÍCULO + ENVASE (priority 20..39)
   * NIVEL 3: REGLA DE ENVASE (priority 40..59)
   * NIVEL 4: REGLA GENÉRICA (priority 60..89)
   * NIVEL 5: PENDIENTE DE ASOCIACIÓN (priority 999)
   * @private
   */
  _initBaseRules() {
    this.rules = [
      // NIVEL 1: REGLAS ESPECÍFICAS DE ARTÍCULO (Tier: ARTICLE_SPECIFIC, Prioridad 1..19)
      // Determina la clasificación con independencia del envase
      // REGLA ESPECIAL FASE 5: TOMATE ROSA DE SABOR pertenece siempre a CARTÓN / ROSA independientemente del envase.
      {
        id: 'REGLA_ROSA_DE_SABOR',
        tier: 'ARTICLE_SPECIFIC',
        priority: 5,
        description: 'Tomate Rosa de Sabor clasifica siempre en CARTÓN / ROSA independientemente del envase utilizado',
        matches: (artNorm, envNorm) => {
          return artNorm.includes('ROSA DE SABOR') || 
                 artNorm.includes('ROSA SABOR');
        },
        resolve: (artNorm, envNorm) => ({
          groupId: COMMERCIAL_GROUPS.CARTON.id,
          groupName: COMMERCIAL_GROUPS.CARTON.name,
          subgroupId: 'ROSA',
          subgroupName: 'ROSA',
          status: 'CLASIFICADO',
          ruleId: 'REGLA_ROSA_DE_SABOR'
        })
      },

      // NIVEL 2: ASOCIACIÓN ARTÍCULO + ENVASE / PARES OFICIALES (Tier: EXPLICIT_PAIR, Prioridad 20..39)
      // Combinaciones oficiales Carrefour con sus envases correspondientes
      {
        id: 'REGLA_CARREFOUR',
        tier: 'EXPLICIT_PAIR',
        priority: 25,
        description: 'Combinaciones oficiales Carrefour con envases correspondientes',
        matches: (artNorm, envNorm) => {
          const isCarrefourArticle = CARREFOUR_OFFICIAL_ARTICLES.some(cArt => {
            const cArtNorm = normalizeCommercialText(cArt);
            return artNorm === cArtNorm || artNorm.startsWith(cArtNorm);
          });
          if (!isCarrefourArticle) return false;

          // Si el envase está vacío o es genérico no Carrefour, no asume Carrefour
          if (!envNorm) return false;

          // Envases correspondientes homologados para Carrefour
          const isCarrefourPackaging = 
            envNorm.includes('IFCO') ||
            envNorm.includes('PURA RAZA') ||
            envNorm.includes('MADERA 8X300') ||
            envNorm.includes('MADERA 10X300') ||
            envNorm.includes('MADERA 10X500') ||
            envNorm.includes('10X225') ||
            envNorm.includes('8X225') ||
            envNorm.includes('CARREFOUR') ||
            envNorm.includes('CARTON 40X30X14 GENERICA');

          return isCarrefourPackaging;
        },
        resolve: (artNorm, envNorm, rawArt, rawEnv) => ({
          groupId: COMMERCIAL_GROUPS.CARREFOUR.id,
          groupName: COMMERCIAL_GROUPS.CARREFOUR.name,
          subgroupId: null,
          subgroupName: null,
          status: 'CLASIFICADO',
          ruleId: 'REGLA_CARREFOUR'
        })
      },

      // NIVEL 3: REGLAS DE ENVASE (Tier: PACKAGING_RULE, Prioridad 40..59)
      // Todo envase EPS se clasifica en EPS (tiene prioridad sobre la regla general de artículo)
      {
        id: 'REGLA_ENVASE_EPS',
        tier: 'PACKAGING_RULE',
        priority: 45,
        description: 'Cualquier tomate comercializado en envase EPS',
        matches: (artNorm, envNorm) => {
          return envNorm.includes('EPS') || envNorm.startsWith('EPS');
        },
        resolve: (artNorm, envNorm) => ({
          groupId: COMMERCIAL_GROUPS.EPS.id,
          groupName: COMMERCIAL_GROUPS.EPS.name,
          subgroupId: null,
          subgroupName: null,
          status: 'CLASIFICADO',
          ruleId: 'REGLA_ENVASE_EPS'
        })
      },

      // NIVEL 4: REGLAS GENÉRICAS (Tier: GENERIC_RULE, Prioridad 60..89)
      // Regla 4.1: HUEVO DE TORO (Prioridad 60)
      {
        id: 'REGLA_HUEVO_DE_TORO',
        tier: 'GENERIC_RULE',
        priority: 60,
        description: 'Tomate Huevo de Toro en formatos tradicionales',
        matches: (artNorm, envNorm) => {
          return artNorm.includes('HUEVO DE TORO') || artNorm.includes('HUEVO TORO');
        },
        resolve: (artNorm, envNorm) => ({
          groupId: COMMERCIAL_GROUPS.HUEVO_TORO.id,
          groupName: COMMERCIAL_GROUPS.HUEVO_TORO.name,
          subgroupId: null,
          subgroupName: null,
          status: 'CLASIFICADO',
          ruleId: 'REGLA_HUEVO_DE_TORO'
        })
      },

      // Regla 4.2: VOLLEY / CORAZÓN DE BUEY (Prioridad 65)
      {
        id: 'REGLA_VOLLEY_CORAZON_BUEY',
        tier: 'GENERIC_RULE',
        priority: 65,
        description: 'Tomates Volley y Corazón de Buey',
        matches: (artNorm, envNorm) => {
          return artNorm.includes('VOLLEY') || artNorm.includes('CORAZON DE BUEY') || artNorm.includes('CORAZON BUEY');
        },
        resolve: (artNorm, envNorm) => {
          if (envNorm.includes('40X30X11 VOLLEY HD Q5') || (envNorm.includes('40X30X11') && envNorm.includes('VOLLEY'))) {
            return {
              groupId: COMMERCIAL_GROUPS.NO_CLASIFICADO.id,
              groupName: COMMERCIAL_GROUPS.NO_CLASIFICADO.name,
              subgroupId: null,
              subgroupName: null,
              status: 'REVISAR',
              ruleId: 'VOLLEY_FORMATO_EXCLUIDO'
            };
          }

          const isVolley = artNorm.includes('VOLLEY');
          return {
            groupId: COMMERCIAL_GROUPS.VOLLEY.id,
            groupName: COMMERCIAL_GROUPS.VOLLEY.name,
            subgroupId: null,
            subgroupName: null,
            categoria: isVolley ? '1ª CATEGORÍA (VOLLEY)' : '2ª CATEGORÍA (CORAZÓN DE BUEY)',
            status: 'CLASIFICADO',
            ruleId: isVolley ? 'REGLA_VOLLEY' : 'REGLA_CORAZON_DE_BUEY'
          };
        }
      },

      // Regla 4.3: JAPI / JAPONÉS (Prioridad 70)
      {
        id: 'REGLA_JAPI_JAPONES',
        tier: 'GENERIC_RULE',
        priority: 70,
        description: 'Tomates Japi y Japonés',
        matches: (artNorm, envNorm) => {
          return artNorm.includes('JAPI') || artNorm.includes('JAPONES');
        },
        resolve: (artNorm, envNorm) => {
          const isJapi = artNorm.includes('JAPI');
          return {
            groupId: COMMERCIAL_GROUPS.JAPI_JAPONES.id,
            groupName: COMMERCIAL_GROUPS.JAPI_JAPONES.name,
            subgroupId: null,
            subgroupName: null,
            categoria: isJapi ? '1ª CATEGORÍA (JAPI)' : '2ª CATEGORÍA (JAPONÉS)',
            status: 'CLASIFICADO',
            ruleId: 'REGLA_JAPI_JAPONES'
          };
        }
      },

      // Regla 4.4: TOMATES EN CAJA DE CARTÓN (Prioridad 80)
      {
        id: 'REGLA_CARTON',
        tier: 'GENERIC_RULE',
        priority: 80,
        description: 'Tomates comercializados en envases de cartón',
        matches: (artNorm, envNorm) => {
          return envNorm.includes('CARTON') || envNorm.startsWith('CT') || envNorm.includes('CART');
        },
        resolve: (artNorm, envNorm) => {
          let subgroupId = 'OTROS';
          let subgroupName = 'OTROS';
          let ruleId = 'REGLA_CARTON_OTROS';

          if (artNorm.includes('AZUL')) {
            subgroupId = 'AZUL';
            subgroupName = 'AZUL';
            ruleId = 'REGLA_CARTON_AZUL';
          } else if (artNorm.includes('ROSA')) {
            subgroupId = 'ROSA';
            subgroupName = 'ROSA';
            ruleId = 'REGLA_CARTON_ROSA';
          } else if (artNorm.includes('MORESCO')) {
            subgroupId = 'MORESCO';
            subgroupName = 'MORESCO';
            ruleId = 'REGLA_CARTON_MORESCO';
          }

          return {
            groupId: COMMERCIAL_GROUPS.CARTON.id,
            groupName: COMMERCIAL_GROUPS.CARTON.name,
            subgroupId,
            subgroupName,
            status: 'CLASIFICADO',
            ruleId
          };
        }
      },

      // NIVEL 5: FALLBACK GENERAL — PENDIENTE DE ASOCIACIÓN (Prioridad 999)
      {
        id: 'FALLBACK_PENDIENTE_ASOCIACION',
        tier: 'FALLBACK',
        priority: 999,
        description: 'Combinaciones sin regla comercial asignada — Pendiente de asociación',
        matches: () => true,
        resolve: () => ({
          groupId: COMMERCIAL_GROUPS.NO_CLASIFICADO.id,
          groupName: COMMERCIAL_GROUPS.NO_CLASIFICADO.name,
          subgroupId: null,
          subgroupName: null,
          status: 'PENDIENTE_ASOCIACION',
          ruleId: 'FALLBACK_PENDIENTE_ASOCIACION'
        })
      }
    ];

    // Ordenar reglas por prioridad ascendente (menor número = mayor prioridad)
    this.rules.sort((a, b) => (a.priority || 100) - (b.priority || 100));
  }

  /**
   * Genera la clave compuesta canónica para una asociación artículo-envase.
   * @param {string} articulo 
   * @param {string} envase 
   * @returns {string}
   */
  _buildKey(articulo, envase) {
    return `${normalizeCommercialText(articulo)}|${normalizeCommercialText(envase)}`;
  }

  /**
   * Carga asociaciones explícitas a partir de un texto CSV.
   * @param {string} csvText 
   * @returns {number} Cantidad de asociaciones cargadas
   */
  loadMatrixCsv(csvText) {
    if (!csvText || typeof csvText !== 'string') return 0;
    const parseFn = _parseCsvFn || ((txt) => {
      // Parser básico de líneas si parseCSV no está disponible
      return txt.split(/\r?\n/).map(l => l.split(',').map(s => s.trim().replace(/^"|"$/g, '')));
    });

    const rows = parseFn(csvText);
    if (!rows || rows.length <= 1) return 0;

    const records = [];
    const header = rows[0].map(h => normalizeCommercialText(h));
    const idxArt = header.findIndex(h => h.includes('ARTICULO'));
    const idxEnv = header.findIndex(h => h.includes('ENVASE'));
    const idxGrp = header.findIndex(h => h.includes('GRUPO') || h.includes('GRUPO_COMERCIAL'));
    const idxReg = header.findIndex(h => h.includes('REGLA') || h.includes('REGLA_CLASIFICACION'));
    const idxEst = header.findIndex(h => h.includes('ESTADO'));

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;
      // Detener si es la tabla resumen
      if (r[0] === 'ESTADO' || r[0] === 'CLASIFICADO' && r.length <= 4) continue;

      const art = r[idxArt >= 0 ? idxArt : 0] || '';
      const env = r[idxEnv >= 0 ? idxEnv : 1] || '';
      const grp = r[idxGrp >= 0 ? idxGrp : 3] || '';
      const reg = r[idxReg >= 0 ? idxReg : 4] || '';
      const est = r[idxEst >= 0 ? idxEst : 5] || 'CLASIFICADO';

      if (art) {
        records.push({
          articulo: art,
          envase: env,
          grupoComercial: grp,
          regla: reg,
          estado: est
        });
      }
    }

    return this.loadMatrix(records);
  }

  /**
   * Carga una lista de registros de asociación en memoria.
   * @param {Array<Object>} records 
   * @returns {number}
   */
  loadMatrix(records = []) {
    let count = 0;
    for (const rec of records) {
      if (!rec || !rec.articulo) continue;
      this.addAssociation(rec.articulo, rec.envase || '', {
        grupoComercial: rec.grupoComercial || rec.grupo_comercial,
        groupId: rec.groupId,
        groupName: rec.groupName,
        subgroupId: rec.subgroupId,
        subgroupName: rec.subgroupName,
        status: rec.estado || rec.status || 'CLASIFICADO',
        ruleId: rec.regla || rec.ruleId || 'MATRIZ_VALIDADA',
        activo: rec.activo !== false
      });
      count++;
    }
    return count;
  }

  /**
   * Añade o actualiza una asociación explícita artículo + envase.
   * Permite que la configuración determine prioridades sobre clasificaciones genéricas.
   * 
   * @param {string} articulo 
   * @param {string} envase 
   * @param {Object} mapping 
   * @returns {Object}
   */
  /**
   * Añade o actualiza una asociación explícita artículo + envase.
   * Permite que la configuración determine prioridades sobre clasificaciones genéricas.
   * 
   * @param {string} articulo 
   * @param {string} envase 
   * @param {Object} mapping 
   * @returns {Object}
   */
  addAssociation(articulo, envase, mapping = {}) {
    const key = this._buildKey(articulo, envase);

    let parsedGroup = {
      groupId: mapping.groupId || null,
      groupName: mapping.groupName || null,
      subgroupId: mapping.subgroupId || mapping.subgrupo || null,
      subgroupName: mapping.subgroupName || mapping.subgrupo || null
    };

    const rawGroupName = mapping.grupoComercial || mapping.grupo_comercial;
    if (!parsedGroup.groupId && rawGroupName) {
      // Buscar primero si coincide con algún grupo dinámico ya registrado por ID o Nombre
      const normRaw = normalizeCommercialText(rawGroupName);
      const matchedGroup = Object.values(this.groups).find(g => 
        normalizeCommercialText(g.id) === normRaw ||
        normalizeCommercialText(g.name) === normRaw
      );
      if (matchedGroup) {
        parsedGroup.groupId = matchedGroup.id;
        parsedGroup.groupName = matchedGroup.name;
      } else {
        parsedGroup = parseRawGroupName(rawGroupName);
      }
    }

    const priority = mapping.priority != null ? Number(mapping.priority) : 
                     (mapping.prioridad != null ? Number(mapping.prioridad) : 25); // Default Nivel 2

    const association = {
      id: mapping.id || key,
      articulo: String(articulo || '').trim(),
      envase: String(envase || '').trim(),
      groupId: parsedGroup.groupId || COMMERCIAL_GROUPS.NO_CLASIFICADO.id,
      groupName: parsedGroup.groupName || COMMERCIAL_GROUPS.NO_CLASIFICADO.name,
      subgroupId: mapping.subgroupId || mapping.subgrupo || parsedGroup.subgroupId,
      subgroupName: mapping.subgroupName || mapping.subgrupo || parsedGroup.subgroupName,
      status: mapping.status || mapping.estado || 'CLASIFICADO',
      ruleId: mapping.ruleId || mapping.regla || 'ASOCIACION_CONFIGURADA',
      activo: mapping.activo !== false,
      priority: priority,
      origen: mapping.origen || 'CONFIGURACION',
      observaciones: mapping.observaciones || '',
      fechaActualizacion: new Date().toISOString()
    };

    this.associations.set(key, association);
    return association;
  }

  /**
   * Desactiva o elimina una asociación explícita.
   * @param {string} articulo 
   * @param {string} envase 
   * @returns {boolean}
   */
  removeAssociation(articulo, envase) {
    const key = this._buildKey(articulo, envase);
    return this.associations.delete(key);
  }

  /**
   * Registra una nueva regla declarativa en el resolver.
   * @param {Object} ruleDef 
   */
  registerRule(ruleDef) {
    if (!ruleDef || !ruleDef.id || typeof ruleDef.matches !== 'function' || typeof ruleDef.resolve !== 'function') {
      throw new Error('registerRule: Definición de regla inválida (requiere id, matches, resolve).');
    }
    // Si ya existe la reemplaza
    this.rules = this.rules.filter(r => r.id !== ruleDef.id);
    this.rules.push(ruleDef);
    this.rules.sort((a, b) => (a.priority || 100) - (b.priority || 100));
  }

  /**
   * Registra una regla de artículo específica (NIVEL 1, prioridad 1..19).
   * @param {Object} ruleDef 
   */
  registerArticleRule(ruleDef) {
    if (!ruleDef || !ruleDef.id || typeof ruleDef.matches !== 'function' || typeof ruleDef.resolve !== 'function') {
      throw new Error('registerArticleRule: Requiere id, matches y resolve.');
    }
    const def = {
      ...ruleDef,
      tier: 'ARTICLE_SPECIFIC',
      priority: ruleDef.priority != null ? Number(ruleDef.priority) : 10
    };
    this.registerRule(def);
    return def;
  }

  /**
   * Registra una regla de envase específica (NIVEL 3, prioridad 40..59).
   * @param {Object} ruleDef 
   */
  registerPackagingRule(ruleDef) {
    if (!ruleDef || !ruleDef.id || typeof ruleDef.matches !== 'function' || typeof ruleDef.resolve !== 'function') {
      throw new Error('registerPackagingRule: Requiere id, matches y resolve.');
    }
    const def = {
      ...ruleDef,
      tier: 'PACKAGING_RULE',
      priority: ruleDef.priority != null ? Number(ruleDef.priority) : 45
    };
    this.registerRule(def);
    return def;
  }

  /**
   * Registra o actualiza un grupo comercial.
   * Permite incorporar nuevos grupos dinámicamente sin modificar código.
   * @param {Object} groupDef 
   */
  registerGroup(groupDef) {
    if (!groupDef || !groupDef.id || (!groupDef.name && !groupDef.nombre)) {
      throw new Error('registerGroup: Se requiere id y name/nombre.');
    }
    const id = String(groupDef.id).trim().toUpperCase();
    const name = String(groupDef.name || groupDef.nombre).trim();
    const order = groupDef.order != null ? Number(groupDef.order) : 
                  (groupDef.orden_visual != null ? Number(groupDef.orden_visual) : 50);
    const activo = groupDef.activo !== false;
    const tipo = groupDef.tipo || 'COMERCIAL';
    const rawSubgroups = groupDef.subgroups || groupDef.subgrupos || [];
    const subgroups = rawSubgroups.map(sg => {
      if (typeof sg === 'string') {
        return { id: sg.toUpperCase(), name: sg, order: 50 };
      }
      return {
        id: String(sg.id || sg.nombre || '').toUpperCase(),
        name: String(sg.name || sg.nombre || sg.id || ''),
        order: sg.order != null ? Number(sg.order) : (sg.orden_visual != null ? Number(sg.orden_visual) : 50)
      };
    });

    this.groups[id] = {
      id,
      name,
      order,
      activo,
      tipo,
      subgroups
    };
    return this.groups[id];
  }

  /**
   * Carga una lista de grupos comerciales.
   * @param {Array<Object>} groupsList 
   * @returns {number}
   */
  loadGroups(groupsList = []) {
    if (!Array.isArray(groupsList)) return 0;
    let count = 0;
    for (const g of groupsList) {
      if (!g || !g.id) continue;
      this.registerGroup(g);
      count++;
    }
    return count;
  }

  /**
   * Carga grupos comerciales y matriz de asociaciones desde una instancia de SheetsRepository.
   * @param {Object} repository 
   * @returns {{ grupos: number, asociaciones: number }}
   */
  loadFromRepository(repository) {
    if (!repository) return { grupos: 0, asociaciones: 0 };
    let gruposCount = 0;
    let asociacionesCount = 0;

    if (typeof repository.getGruposComerciales === 'function') {
      const grupos = repository.getGruposComerciales();
      if (Array.isArray(grupos) && grupos.length > 0) {
        gruposCount = this.loadGroups(grupos);
      }
    }

    if (typeof repository.getMatrizArticuloEnvase === 'function') {
      const matriz = repository.getMatrizArticuloEnvase();
      if (Array.isArray(matriz) && matriz.length > 0) {
        for (const row of matriz) {
          if (!row || !row.articulo) continue;
          this.addAssociation(row.articulo, row.envase || '', {
            id: row.id,
            grupoComercial: row.grupo_comercial,
            subgrupo: row.subgrupo,
            prioridad: row.prioridad,
            activo: row.activo !== false,
            observaciones: row.observaciones,
            origen: 'REPOSITORIO'
          });
          asociacionesCount++;
        }
      }
    }

    return { grupos: gruposCount, asociaciones: asociacionesCount };
  }

  /**
   * Obtiene todos los grupos configurados ordenados por prioridad visual.
   * @param {Object} [options]
   * @param {boolean} [options.includeInactive=false]
   * @returns {Array<Object>}
   */
  getGroups(options = {}) {
    const includeInactive = options.includeInactive === true;
    return Object.values(this.groups)
      .filter(g => includeInactive || g.activo !== false)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Clasifica una combinación artículo + envase siguiendo la jerarquía estricta de 5 niveles:
   * 
   * NIVEL 1: REGLA ESPECÍFICA DE ARTÍCULO (priority 1..19)
   *          Prevalece sobre envases y asociaciones. Ej: ROSA DE SABOR -> CARTÓN / ROSA siempre.
   *   ↓
   * NIVEL 2: ASOCIACIÓN ARTÍCULO + ENVASE (priority 20..39)
   *          Matriz explícita y pares oficiales (Carrefour con envases homologados).
   *   ↓
   * NIVEL 3: REGLA DE ENVASE (priority 40..59)
   *          El envase determina el grupo. Ej: EPS -> TOMATE EN CAJA EPS.
   *   ↓
   * NIVEL 4: REGLA GENÉRICA (priority 60..89)
   *          Reglas comerciales genéricas (HUEVO DE TORO, VOLLEY, JAPI/JAPONÉS, CARTÓN).
   *   ↓
   * NIVEL 5: PENDIENTE DE ASOCIACIÓN (priority 999)
   *          Fallback estricto sin inventar agrupaciones arbitrarias.
   * 
   * @param {string|Object} articuloParam - Nombre o código del artículo, u objeto con metadatos
   * @param {string} [envaseParam] - Nombre o código del envase
   * @param {Object} [options]
   * @param {boolean} [options.ignoreExplicitMatrix=false] - Forzar evaluación de reglas
   * @returns {{
   *   groupId: string,
   *   groupName: string,
   *   subgroupId: string|null,
   *   subgroupName: string|null,
   *   status: string,
   *   ruleId: string,
   *   categoria: string,
   *   calibre: string,
   *   calibreCategoria: string,
   *   articulo: string,
   *   envase: string,
   *   auditTrace: string
   * }}
   */
  resolve(articuloParam, envaseParam = '', options = {}) {
    let artRaw = '';
    let envRaw = '';

    if (articuloParam && typeof articuloParam === 'object') {
      artRaw = articuloParam.nombre_articulo || articuloParam.nombreArticulo || articuloParam.articulo || articuloParam.codigo_articulo || '';
      envRaw = envaseParam || articuloParam.descripcion_envase || articuloParam.descripcionEnvase || articuloParam.envase || articuloParam.codigo_envase || '';
    } else {
      artRaw = String(articuloParam || '').trim();
      envRaw = String(envaseParam || '').trim();
    }

    const artNorm = normalizeCommercialText(artRaw);
    const envNorm = normalizeCommercialText(envRaw);
    const key = `${artNorm}|${envNorm}`;

    const { categoria, calibre, calibreCategoria } = extraerCalibreYCategoria(artRaw);

    // =========================================================================
    // NIVEL 1: REGLAS ESPECÍFICAS DE ARTÍCULO (Priority 1..19)
    // Determina la clasificación con total independencia del envase utilizado.
    // Ejemplo crítico: TOMATE ROSA DE SABOR pertenece siempre a CARTÓN / ROSA.
    // =========================================================================
    for (const rule of this.rules) {
      if ((rule.tier === 'ARTICLE_SPECIFIC' || (rule.priority != null && rule.priority < 20)) &&
          typeof rule.matches === 'function' && rule.matches(artNorm, envNorm, artRaw, envRaw)) {
        const res = rule.resolve(artNorm, envNorm, artRaw, envRaw);
        return {
          groupId: res.groupId,
          groupName: res.groupName,
          subgroupId: res.subgroupId || null,
          subgroupName: res.subgroupName || null,
          status: res.status || 'CLASIFICADO',
          ruleId: res.ruleId || rule.id,
          categoria: res.categoria || categoria,
          calibre,
          calibreCategoria,
          articulo: artRaw,
          envase: envRaw,
          auditTrace: `[NIVEL 1 - Regla Artículo P${rule.priority || 10}] ${rule.id}: ${rule.description || ''}`
        };
      }
    }

    // =========================================================================
    // NIVEL 2: ASOCIACIÓN ARTÍCULO + ENVASE (Matriz explícita o pares oficiales)
    // Priority 20..39
    // =========================================================================
    // 2.1 Coincidencia en matriz explícita validada o cargada desde configuración
    if (!options.ignoreExplicitMatrix && this.associations.has(key)) {
      const assoc = this.associations.get(key);
      if (assoc.activo !== false) {
        if (assoc.status === 'FUERA_CATALOGO') {
          return {
            groupId: COMMERCIAL_GROUPS.NO_CLASIFICADO.id,
            groupName: COMMERCIAL_GROUPS.NO_CLASIFICADO.name,
            subgroupId: null,
            subgroupName: null,
            status: 'FUERA_CATALOGO',
            ruleId: assoc.ruleId || 'FUERA_CATALOGO',
            categoria,
            calibre,
            calibreCategoria,
            articulo: artRaw,
            envase: envRaw,
            auditTrace: `[NIVEL 2 - Matriz explícita] FUERA_CATALOGO (regla: ${assoc.ruleId})`
          };
        }

        if (assoc.status === 'REVISAR') {
          return {
            groupId: COMMERCIAL_GROUPS.NO_CLASIFICADO.id,
            groupName: COMMERCIAL_GROUPS.NO_CLASIFICADO.name,
            subgroupId: null,
            subgroupName: null,
            status: 'REVISAR',
            ruleId: assoc.ruleId || 'REVISAR',
            categoria,
            calibre,
            calibreCategoria,
            articulo: artRaw,
            envase: envRaw,
            auditTrace: `[NIVEL 2 - Matriz explícita] REVISAR (regla: ${assoc.ruleId})`
          };
        }

        if (assoc.status === 'PENDIENTE_ASOCIACION' || assoc.status === 'PENDIENTE DE ASOCIACION' || assoc.status === 'PENDIENTE DE ASOCIACIÓN') {
          return {
            groupId: COMMERCIAL_GROUPS.NO_CLASIFICADO.id,
            groupName: COMMERCIAL_GROUPS.NO_CLASIFICADO.name,
            subgroupId: null,
            subgroupName: null,
            status: 'PENDIENTE_ASOCIACION',
            ruleId: assoc.ruleId || 'HISTORICO_PENDIENTE_ASOCIACION',
            categoria,
            calibre,
            calibreCategoria,
            articulo: artRaw,
            envase: envRaw,
            auditTrace: `[NIVEL 2 - Matriz explícita] PENDIENTE DE ASOCIACIÓN (regla: ${assoc.ruleId})`
          };
        }

        return {
          groupId: assoc.groupId,
          groupName: assoc.groupName,
          subgroupId: assoc.subgroupId || null,
          subgroupName: assoc.subgroupName || null,
          status: assoc.status || 'CLASIFICADO',
          ruleId: assoc.ruleId || 'MATRIZ_ASOCIACION_EXPLICITA',
          categoria,
          calibre,
          calibreCategoria,
          articulo: artRaw,
          envase: envRaw,
          auditTrace: `[NIVEL 2 - Matriz explícita] Coincidencia exacta (regla: ${assoc.ruleId})`
        };
      }
    }

    // 2.2 Reglas declarativas de par explícito (ej. REGLA_CARREFOUR con prioridad 20..39)
    for (const rule of this.rules) {
      if ((rule.tier === 'EXPLICIT_PAIR' || (rule.priority >= 20 && rule.priority < 40)) &&
          typeof rule.matches === 'function' && rule.matches(artNorm, envNorm, artRaw, envRaw)) {
        const res = rule.resolve(artNorm, envNorm, artRaw, envRaw);
        return {
          groupId: res.groupId,
          groupName: res.groupName,
          subgroupId: res.subgroupId || null,
          subgroupName: res.subgroupName || null,
          status: res.status || 'CLASIFICADO',
          ruleId: res.ruleId || rule.id,
          categoria: res.categoria || categoria,
          calibre,
          calibreCategoria,
          articulo: artRaw,
          envase: envRaw,
          auditTrace: `[NIVEL 2 - Regla Par P${rule.priority || 25}] ${rule.id}: ${rule.description || ''}`
        };
      }
    }

    // =========================================================================
    // NIVEL 3: REGLAS DE ENVASE (Priority 40..59)
    // Ejemplo: Todo tomate comercializado en EPS -> TOMATE EN CAJA EPS
    // =========================================================================
    for (const rule of this.rules) {
      if ((rule.tier === 'PACKAGING_RULE' || (rule.priority >= 40 && rule.priority < 60)) &&
          typeof rule.matches === 'function' && rule.matches(artNorm, envNorm, artRaw, envRaw)) {
        const res = rule.resolve(artNorm, envNorm, artRaw, envRaw);
        return {
          groupId: res.groupId,
          groupName: res.groupName,
          subgroupId: res.subgroupId || null,
          subgroupName: res.subgroupName || null,
          status: res.status || 'CLASIFICADO',
          ruleId: res.ruleId || rule.id,
          categoria: res.categoria || categoria,
          calibre,
          calibreCategoria,
          articulo: artRaw,
          envase: envRaw,
          auditTrace: `[NIVEL 3 - Regla Envase P${rule.priority || 45}] ${rule.id}: ${rule.description || ''}`
        };
      }
    }

    // =========================================================================
    // NIVEL 4: REGLAS GENÉRICAS (Priority 60..89)
    // Huevo de Toro, Volley/Corazón de Buey, Japi/Japonés, Cartón genérico
    // =========================================================================
    for (const rule of this.rules) {
      if ((rule.tier === 'GENERIC_RULE' || (rule.priority >= 60 && rule.priority < 100)) &&
          typeof rule.matches === 'function' && rule.matches(artNorm, envNorm, artRaw, envRaw)) {
        const res = rule.resolve(artNorm, envNorm, artRaw, envRaw);
        return {
          groupId: res.groupId,
          groupName: res.groupName,
          subgroupId: res.subgroupId || null,
          subgroupName: res.subgroupName || null,
          status: res.status || 'CLASIFICADO',
          ruleId: res.ruleId || rule.id,
          categoria: res.categoria || categoria,
          calibre,
          calibreCategoria,
          articulo: artRaw,
          envase: envRaw,
          auditTrace: `[NIVEL 4 - Regla Genérica P${rule.priority || 70}] ${rule.id}: ${rule.description || ''}`
        };
      }
    }

    // =========================================================================
    // NIVEL 5: FALLBACK PENDIENTE DE ASOCIACIÓN (Priority 999)
    // No se inventa grupo ni se clasifica arbitrariamente
    // =========================================================================
    return {
      groupId: COMMERCIAL_GROUPS.NO_CLASIFICADO.id,
      groupName: COMMERCIAL_GROUPS.NO_CLASIFICADO.name,
      subgroupId: null,
      subgroupName: null,
      status: 'PENDIENTE_ASOCIACION',
      ruleId: 'FALLBACK_PENDIENTE_ASOCIACION',
      categoria,
      calibre,
      calibreCategoria,
      articulo: artRaw,
      envase: envRaw,
      auditTrace: '[NIVEL 5 - Fallback] Combinación no contemplada — PENDIENTE DE ASOCIACIÓN'
    };
  }

  /**
   * Alias de resolve() para compatibilidad léxica.
   */
  classify(articulo, envase, options = {}) {
    return this.resolve(articulo, envase, options);
  }

  /**
   * Proporciona explicación detallada y traza de auditoría para una combinación.
   * @param {string} articulo 
   * @param {string} envase 
   * @returns {Object}
   */
  explain(articulo, envase) {
    const classification = this.resolve(articulo, envase);
    return {
      articulo,
      envase,
      resultado: classification,
      trazaAuditoria: classification.auditTrace
    };
  }

  /**
   * Carga un catálogo histórico adicional de combinaciones (ej. histórico de ventas).
   * 
   * REGLA ARQUITECTURAL ESTRICTA:
   * Cuando exista una combinación histórica no contemplada en las asociaciones actuales,
   * NO crearla automáticamente en un grupo arbitrario. Marcarla como:
   * PENDIENTE DE ASOCIACIÓN (status: 'PENDIENTE_ASOCIACION')
   * para que pueda ser revisada posteriormente por el supervisor.
   * 
   * El sistema queda preparado para incorporar posteriormente catálogos adicionales sin alterar código.
   * 
   * @param {Array<Object>|string} catalogData - Array de objetos { articulo, envase, ... } o CSV
   * @param {Object} [options]
   * @param {boolean} [options.preserveExisting=true] - Mantener intactas combinaciones ya validadas
   * @returns {{ totalProcesados: number, nuevosPendientes: number, existentesValidados: number }}
   */
  loadHistoricalCatalog(catalogData, options = {}) {
    const preserveExisting = options.preserveExisting !== false;
    let records = [];

    if (typeof catalogData === 'string') {
      const parseFn = _parseCsvFn || ((txt) => txt.split(/\r?\n/).map(l => l.split(',').map(s => s.trim().replace(/^"|"$/g, ''))));
      const rows = parseFn(catalogData);
      if (rows && rows.length > 1) {
        const header = rows[0].map(h => normalizeCommercialText(h));
        const idxArt = header.findIndex(h => h.includes('ARTICULO'));
        const idxEnv = header.findIndex(h => h.includes('ENVASE'));
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.length === 0) continue;
          records.push({
            articulo: r[idxArt >= 0 ? idxArt : 0] || '',
            envase: r[idxEnv >= 0 ? idxEnv : 1] || ''
          });
        }
      }
    } else if (Array.isArray(catalogData)) {
      records = catalogData;
    }

    let nuevosPendientes = 0;
    let existentesValidados = 0;

    for (const rec of records) {
      const art = rec.articulo || rec.nombre_articulo || rec.codigo_articulo || '';
      const env = rec.envase || rec.descripcion_envase || rec.codigo_envase || '';
      if (!art) continue;

      const key = this._buildKey(art, env);
      const existing = this.associations.get(key);

      if (existing && existing.status === 'CLASIFICADO' && preserveExisting) {
        existentesValidados++;
        continue;
      }

      if (!existing || existing.status === 'PENDIENTE_ASOCIACION' || !preserveExisting) {
        this.addAssociation(art, env, {
          groupId: COMMERCIAL_GROUPS.NO_CLASIFICADO.id,
          groupName: COMMERCIAL_GROUPS.NO_CLASIFICADO.name,
          subgroupId: null,
          subgroupName: null,
          status: 'PENDIENTE_ASOCIACION',
          ruleId: 'HISTORICO_PENDIENTE_ASOCIACION',
          origen: 'HISTORICO_VENTAS',
          activo: true
        });
        nuevosPendientes++;
      }
    }

    return {
      totalProcesados: records.length,
      nuevosPendientes,
      existentesValidados
    };
  }

  /**
   * Obtiene la lista de combinaciones pendientes de asociación o que requieren revisión.
   * @returns {Array<Object>}
   */
  getCombinacionesPendientes() {
    const pendientes = [];
    for (const assoc of this.associations.values()) {
      if (assoc.status === 'PENDIENTE_ASOCIACION' || assoc.status === 'REVISAR' || assoc.groupId === COMMERCIAL_GROUPS.NO_CLASIFICADO.id) {
        pendientes.push({ ...assoc });
      }
    }
    return pendientes;
  }
}

// Exportación compatible para Node.js y Google Apps Script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CommercialGroupResolver,
    COMMERCIAL_GROUPS,
    CARREFOUR_OFFICIAL_ARTICLES,
    normalizeCommercialText,
    extraerCalibreYCategoria,
    parseRawGroupName
  };
}
