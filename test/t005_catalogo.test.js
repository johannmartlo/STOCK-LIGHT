/**
 * STOCK-LIGHT — Test Suite T-005: Catálogo y clasificación: seguimiento, atributos y agrupaciones configurables
 * Ejecutable con Node.js: `node test/t005_catalogo.test.js`
 *
 * Cubre los puntos de aceptación 1 a 8 de docs/tickets/T-005-catalogo-clasificacion.md (D-029).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { crearEntorno } = require('./helpers/mockSheets');
const { clasificarCombinacion, explicarCombinacion, cumpleFiltro } = require('../src/Catalogo');
const { CatalogoService } = require('../src/CatalogoService');
const { CommercialGroupResolver } = require('../src/CommercialGroupResolver');
const { clasificar } = require('../src/importacion/ClasificadorLineas');
const { conContextoDePrueba_ } = require('../src/Seguridad');
const codigo = require('../src/Código');

const SESION_PROPIETARIO = {
  getActiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' }),
  getEffectiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' })
};

const SESION_OPERADOR = {
  getActiveUser: () => ({ getEmail: () => 'operador@stocklight.test' }),
  getEffectiveUser: () => ({ getEmail: () => 'dueno@stocklight.test' })
};

function conSesion(mockSession, fn) {
  const prev = global.Session;
  global.Session = mockSession;
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete global.Session;
    } else {
      global.Session = prev;
    }
  }
}

function parsearCsvMatrizReferencia(csvText) {
  const lines = csvText.split(/\r?\n/);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('ESTADO,CANTIDAD') || line.startsWith('CLASIFICADO,') || line.startsWith('REVISAR,') || line.startsWith('FUERA_CATALOGO,')) {
      break;
    }

    const cols = [];
    let current = '';
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cols.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cols.push(current.trim());

    rows.push({
      lineaCsv: i + 1,
      articulo: cols[0] || '',
      envase: cols[1] || '',
      frecuencia: Number(cols[2] || 0),
      grupo_comercial: cols[3] || '',
      regla_clasificacion: cols[4] || '',
      estado: cols[5] || ''
    });
  }

  return rows;
}

function mapearGrupoCsvACanonico(rawGroup) {
  const norm = String(rawGroup || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (!norm) return { grupo: 'SIN CLASIFICAR', subgrupo: null };
  if (norm.includes('CARREFOUR')) return { grupo: 'CARREFOUR', subgrupo: null };
  if (norm.includes('EPS')) return { grupo: 'EPS', subgrupo: null };
  if (norm.includes('HUEVO DE TORO') || norm.includes('HUEVO TORO')) return { grupo: 'HUEVO_TORO', subgrupo: null };
  if (norm.includes('VOLLEY') || norm.includes('CORAZON DE BUEY')) return { grupo: 'VOLLEY', subgrupo: null };
  if (norm.includes('JAPI') || norm.includes('JAPONES')) return { grupo: 'JAPI_JAPONES', subgrupo: null };

  if (norm.includes('CARTON')) {
    if (norm.includes('/')) {
      const parts = norm.split('/').map(s => s.trim());
      return { grupo: 'CARTON', subgrupo: parts[1] || 'OTROS' };
    }
    return { grupo: 'CARTON', subgrupo: 'OTROS' };
  }

  return { grupo: norm, subgrupo: null };
}

console.log('================================================================');
console.log(' TEST SUITE T-005 — CATÁLOGO Y CLASIFICACIÓN (D-029)');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function runTest(desc, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(`     Error: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
    failed++;
  }
}

// -----------------------------------------------------------------------------
// Aceptación 1: Rosa Sabor en la agrupación COMERCIAL
// -----------------------------------------------------------------------------
runTest('1. Rosa Sabor en agrupación COMERCIAL (madera -> JAPI_JAPONES; cartón y cartón madera -> CARTON/ROSA):', () => {
  const env = crearEntorno();
  conSesion(SESION_PROPIETARIO, () => {
    codigo.sembrarCatalogo({ repository: env.repo });
  });

  const catalogoService = new CatalogoService({ repository: env.repo });
  const resolver = new CommercialGroupResolver({ repository: env.repo });

  // 1) TOMATE ROSA SABOR I G con MADERA 40X30X8 TOMATES DE AUTOR -> JAPI_JAPONES
  const r1 = catalogoService.clasificar('TOMATE ROSA SABOR I G', 'MADERA 40X30X8 TOMATES DE AUTOR');
  assert.deepStrictEqual(r1.cajones.COMERCIAL, { grupo: 'JAPI_JAPONES', subgrupo: null });
  const f1 = resolver.resolve('TOMATE ROSA SABOR I G', 'MADERA 40X30X8 TOMATES DE AUTOR');
  assert.strictEqual(f1.groupId, 'JAPI_JAPONES');
  assert.strictEqual(f1.subgroupId, null);

  // 2) TOMATE ROSA SABOR I G con CARTON 40X30X9,5 ROYAL PINK -> CARTON/ROSA
  const r2 = catalogoService.clasificar('TOMATE ROSA SABOR I G', 'CARTON 40X30X9,5 ROYAL PINK');
  assert.deepStrictEqual(r2.cajones.COMERCIAL, { grupo: 'CARTON', subgrupo: 'ROSA' });
  const f2 = resolver.resolve('TOMATE ROSA SABOR I G', 'CARTON 40X30X9,5 ROYAL PINK');
  assert.strictEqual(f2.groupId, 'CARTON');
  assert.strictEqual(f2.subgroupId, 'ROSA');

  // 3) TOMATE ROSA SABOR I G con CARTON 40X30X9,5 MADERA -> CARTON/ROSA
  const r3 = catalogoService.clasificar('TOMATE ROSA SABOR I G', 'CARTON 40X30X9,5 MADERA');
  assert.deepStrictEqual(r3.cajones.COMERCIAL, { grupo: 'CARTON', subgrupo: 'ROSA' });
  const f3 = resolver.resolve('TOMATE ROSA SABOR I G', 'CARTON 40X30X9,5 MADERA');
  assert.strictEqual(f3.groupId, 'CARTON');
  assert.strictEqual(f3.subgroupId, 'ROSA');
});

// -----------------------------------------------------------------------------
// Aceptación 2: Motor de reglas
// -----------------------------------------------------------------------------
runTest('2. Motor de reglas (menor prioridad gana, ; como O, + como Y, *_excluye, regla inactiva, atributos independientes e inexistentes):', () => {
  const config = {
    atributos: [
      { nombre: 'SEGUIMIENTO', descripcion: 'Control stock', activo: true },
      { nombre: 'FAMILIA', descripcion: 'Variedad', activo: true },
      { nombre: 'FORMATO', descripcion: 'Formato envase', activo: true },
      { nombre: 'INACTIVO_ATTR', descripcion: 'Desactivado', activo: false }
    ],
    reglas: [
      // Regla inactiva con menor prioridad: no debe contar
      {
        id: 'R-INACTIVA',
        atributo: 'FAMILIA',
        valor: 'NO_DEBE_SALIR',
        prioridad: 1,
        articulo_contiene: 'ESPECIAL',
        activo: false
      },
      // Regla con *_excluye: se anula si contiene DESCARTADO
      {
        id: 'R-PRIORIDAD-10-CON-EXCLUYE',
        atributo: 'FAMILIA',
        valor: 'PREMIER',
        prioridad: 10,
        articulo_contiene: 'ESPECIAL;SELECTO',
        articulo_excluye: 'DESCARTADO;DEFECTO',
        activo: true
      },
      // Regla de mayor número de prioridad (20): gana si la de 10 es excluida
      {
        id: 'R-PRIORIDAD-20',
        atributo: 'FAMILIA',
        valor: 'ESTANDAR',
        prioridad: 20,
        articulo_contiene: 'ESPECIAL;SELECTO',
        activo: true
      },
      // Regla en otro atributo independiente con + (Y) y ; (O)
      {
        id: 'R-FORMATO-Y',
        atributo: 'FORMATO',
        valor: 'CAJA_MIXTA',
        prioridad: 10,
        envase_contiene: '40X30+RECICLABLE;60X40+PREMIUM',
        envase_excluye: 'ROTO',
        activo: true
      },
      // Reglas con atributo inexistente e inactivo: se ignoran y se informan en explicar
      {
        id: 'R-ATTR-FANTASMA',
        atributo: 'NO_EXISTE',
        valor: 'X',
        prioridad: 1,
        articulo_contiene: 'ESPECIAL',
        activo: true
      },
      {
        id: 'R-ATTR-INACTIVO',
        atributo: 'INACTIVO_ATTR',
        valor: 'Y',
        prioridad: 1,
        articulo_contiene: 'ESPECIAL',
        activo: true
      }
    ],
    catalogo: [],
    agrupaciones: []
  };

  // A) Menor prioridad gana (10 gana a 20), ; funciona como O ('SELECTO') y + funciona como Y ('60X40' + 'PREMIUM')
  const exp1 = explicarCombinacion('ARTICULO SELECTO EXTRA', 'ENVASE 60X40 SUPER PREMIUM', config);
  assert.strictEqual(exp1.atributos.FAMILIA, 'PREMIER');
  assert.strictEqual(exp1.origenPorAtributo.FAMILIA, 'R-PRIORIDAD-10-CON-EXCLUYE');
  assert.strictEqual(exp1.atributos.FORMATO, 'CAJA_MIXTA');
  assert.strictEqual(exp1.origenPorAtributo.FORMATO, 'R-FORMATO-Y');

  // B) *_excluye anula la regla de prioridad 10 y gana la de prioridad 20; en FORMATO falta un término del + ('RECICLABLE')
  const exp2 = explicarCombinacion('ARTICULO ESPECIAL DESCARTADO', 'ENVASE 40X30 NORMAL', config);
  assert.strictEqual(exp2.atributos.FAMILIA, 'ESTANDAR');
  assert.strictEqual(exp2.origenPorAtributo.FAMILIA, 'R-PRIORIDAD-20');
  assert.strictEqual(exp2.atributos.FORMATO, undefined);

  // C) Atributos inexistentes o inactivos fueron ignorados e informados en explicar
  assert.strictEqual(exp1.atributos.NO_EXISTE, undefined);
  assert.strictEqual(exp1.atributos.INACTIVO_ATTR, undefined);
  assert.ok(exp1.ignorados.some(i => i.atributo === 'NO_EXISTE' && i.motivo === 'ATRIBUTO_INEXISTENTE'));
  assert.ok(exp1.ignorados.some(i => i.atributo === 'INACTIVO_ATTR' && i.motivo === 'ATRIBUTO_INACTIVO'));
});

// -----------------------------------------------------------------------------
// Aceptación 3: Catálogo de excepciones exactas
// -----------------------------------------------------------------------------
runTest('3. Excepción exacta en CATALOGO gana a las reglas solo para su atributo sin coincidencia parcial:', () => {
  const env = crearEntorno();
  conSesion(SESION_PROPIETARIO, () => {
    codigo.sembrarCatalogo({ repository: env.repo });
  });

  // Añadir excepción exacta para TOMATE ROSA I M con EPS 104 en atributo PROGRAMA = CARREFOUR
  conSesion(SESION_OPERADOR, () => {
    conContextoDePrueba_('Prueba', 'ADMIN', () => {
      codigo.apiUpsertExcepcionCatalogo({
        articulo: 'TOMATE ROSA I M',
        envase: 'EPS 104',
        atributo: 'PROGRAMA',
        valor: 'CARREFOUR',
        observaciones: 'Excepción puntual campaña'
      }, { repository: env.repo });
    });
  });

  const catalogoService = new CatalogoService({ repository: env.repo });

  // El par exacto toma la excepción en PROGRAMA, pero mantiene MATERIAL y FAMILIA por reglas
  const expExacta = catalogoService.explicar('TOMATE ROSA I M', 'EPS 104');
  assert.strictEqual(expExacta.atributos.PROGRAMA, 'CARREFOUR');
  assert.strictEqual(expExacta.origenPorAtributo.PROGRAMA, 'CATALOGO');
  assert.strictEqual(expExacta.atributos.MATERIAL, 'EPS');
  assert.strictEqual(expExacta.atributos.FAMILIA, 'ROSA');
  assert.deepStrictEqual(expExacta.cajones.COMERCIAL, { grupo: 'CARREFOUR', subgrupo: null });

  // «TOMATE ROSA I» con «EPS 104» NO toma la excepción de «TOMATE ROSA I M» con «EPS 104»
  const expParcial = catalogoService.explicar('TOMATE ROSA I', 'EPS 104');
  assert.strictEqual(expParcial.atributos.PROGRAMA, undefined);
  assert.deepStrictEqual(expParcial.cajones.COMERCIAL, { grupo: 'EPS', subgrupo: null });
});

// -----------------------------------------------------------------------------
// Aceptación 4: Seguimiento e integración con clasificar de T-006B
// -----------------------------------------------------------------------------
runTest('4. Seguimiento (SEGUIDA, NO_SEGUIDA, PENDIENTE) e integración con clasificar de T-006B:', () => {
  const env = crearEntorno();
  conSesion(SESION_PROPIETARIO, () => {
    codigo.sembrarCatalogo({ repository: env.repo });
  });

  const catalogoService = new CatalogoService({ repository: env.repo });

  // 1) «TOMATE COCKTAIL I M» -> SEGUIDA
  assert.strictEqual(catalogoService.esCombinacionSeguida('TOMATE COCKTAIL I M', 'EPS 106'), 'SEGUIDA');

  // 2) «TOMATE JAPI UNID» -> NO_SEGUIDA
  assert.strictEqual(catalogoService.esCombinacionSeguida('TOMATE JAPI UNID', 'CARTON 60X40X11 TDA 6X650 JAPI'), 'NO_SEGUIDA');

  // 3) «PIMIENTO CALIFORNIA ROJO» -> NO_SEGUIDA
  assert.strictEqual(catalogoService.esCombinacionSeguida('PIMIENTO CALIFORNIA ROJO', 'EPS 106'), 'NO_SEGUIDA');

  // 4) Un tomate inventado sin familia ni material reconocible -> SEGUIDA y en COMERCIAL cae en SIN CLASIFICAR
  const resInventado = catalogoService.clasificar('TOMATE EXPERIMENTAL MARCIANO', 'ENVASE BIO DESCONOCIDO');
  assert.strictEqual(resInventado.seguimiento, 'SEGUIDA');
  assert.deepStrictEqual(resInventado.cajones.COMERCIAL, { grupo: 'SIN CLASIFICAR', subgrupo: null });

  // 5) Pasando esCombinacionSeguida a clasificar de T-006B, las líneas salen OK y NO_SEGUIDA según corresponda
  const lineasImportadas = [
    {
      tipoDoc: 'SALIDA',
      origenDato: 'CSV',
      serie: 'AVT26',
      numero: '100',
      fecha: '2026-11-05',
      linea: 1,
      articulo: 'TOMATE COCKTAIL I M',
      envase: 'EPS 106',
      cajas: 25
    },
    {
      tipoDoc: 'SALIDA',
      origenDato: 'CSV',
      serie: 'AVT26',
      numero: '100',
      fecha: '2026-11-05',
      linea: 2,
      articulo: 'TOMATE JAPI UNID',
      envase: 'CARTON 60X40X11 TDA 6X650 JAPI',
      cajas: 10
    },
    {
      tipoDoc: 'SALIDA',
      origenDato: 'CSV',
      serie: 'AVT26',
      numero: '100',
      fecha: '2026-11-05',
      linea: 3,
      articulo: 'PIMIENTO CALIFORNIA ROJO',
      envase: 'EPS 106',
      cajas: 15
    }
  ];

  const clasificadas = clasificar(lineasImportadas, {}, catalogoService.esCombinacionSeguida);
  assert.strictEqual(clasificadas[0].estado, 'OK');
  assert.strictEqual(clasificadas[1].estado, 'NO_SEGUIDA');
  assert.strictEqual(clasificadas[2].estado, 'NO_SEGUIDA');

  // 6) Con una configuración sin reglas de SEGUIMIENTO, la línea sale PENDIENTE
  const svcSinReglasSeg = new CatalogoService({
    config: {
      atributos: [{ nombre: 'SEGUIMIENTO', descripcion: 'Seguimiento', activo: true }],
      reglas: [],
      catalogo: [],
      agrupaciones: []
    }
  });
  assert.strictEqual(svcSinReglasSeg.esCombinacionSeguida('TOMATE COCKTAIL I M', 'EPS 106'), 'PENDIENTE');
  const clasificadasPend = clasificar([lineasImportadas[0]], {}, svcSinReglasSeg.esCombinacionSeguida);
  assert.strictEqual(clasificadasPend[0].estado, 'PENDIENTE');
});

// -----------------------------------------------------------------------------
// Aceptación 5: Agrupaciones configurables y validaciones de API
// -----------------------------------------------------------------------------
runTest('5. Agrupaciones (Carrefour en EPS cae solo en CARREFOUR; nueva agrupación POR_MATERIAL sin tocar código; validación API):', () => {
  const env = crearEntorno();
  conSesion(SESION_PROPIETARIO, () => {
    codigo.sembrarCatalogo({ repository: env.repo });
  });

  // 1) Combinación Carrefour en envase EPS cae solo en CARREFOUR, no cuenta dos veces
  const catalogoService = new CatalogoService({ repository: env.repo });
  const resCrfEps = catalogoService.clasificar('TOMATE COCKTAIL SUNSTREAM I M', 'EPS 154 10X225');
  assert.strictEqual(resCrfEps.atributos.PROGRAMA, 'CARREFOUR');
  assert.strictEqual(resCrfEps.atributos.MATERIAL, 'EPS');
  assert.deepStrictEqual(resCrfEps.cajones.COMERCIAL, { grupo: 'CARREFOUR', subgrupo: null });

  // 2) Añadiendo en la hoja una agrupación POR_MATERIAL (EPS / CARTON / MADERA / resto), sin tocar código, devuelve su cajón
  env.repo.appendAgrupaciones([
    { agrupacion: 'POR_MATERIAL', orden: 1, grupo: 'ENVASES EPS', subgrupo: '', filtro: 'MATERIAL=EPS', activo: true },
    { agrupacion: 'POR_MATERIAL', orden: 2, grupo: 'ENVASES CARTON', subgrupo: '', filtro: 'MATERIAL=CARTON', activo: true },
    { agrupacion: 'POR_MATERIAL', orden: 3, grupo: 'ENVASES MADERA', subgrupo: '', filtro: 'MATERIAL=MADERA', activo: true },
    { agrupacion: 'POR_MATERIAL', orden: 4, grupo: 'RESTO MATERIALES', subgrupo: '', filtro: '', activo: true }
  ]);

  const resMat1 = catalogoService.clasificar('TOMATE COCKTAIL SUNSTREAM I M', 'EPS 154 10X225');
  assert.deepStrictEqual(resMat1.cajones.POR_MATERIAL, { grupo: 'ENVASES EPS', subgrupo: null });

  const resMat2 = catalogoService.clasificar('TOMATE ROSA SABOR I G', 'MADERA 40X30X8 TOMATES DE AUTOR');
  assert.deepStrictEqual(resMat2.cajones.POR_MATERIAL, { grupo: 'ENVASES MADERA', subgrupo: null });

  const resMat3 = catalogoService.clasificar('TOMATE PERA RAMA I M', 'IFCO 6410 10X500');
  assert.deepStrictEqual(resMat3.cajones.POR_MATERIAL, { grupo: 'RESTO MATERIALES', subgrupo: null });

  // 3) Validación de atributos y SEGUIMIENTO en API + auditoría con usuarioActual_()
  assert.throws(() => {
    conSesion(SESION_OPERADOR, () => {
      conContextoDePrueba_('Prueba', 'ADMIN', () => {
        codigo.apiUpsertReglaClasificacion({
          atributo: 'ATRIBUTO_FANTASMA',
          valor: 'X',
          prioridad: 10
        }, { repository: env.repo });
      });
    });
  }, /no existe en ATRIBUTOS/);

  assert.throws(() => {
    conSesion(SESION_OPERADOR, () => {
      conContextoDePrueba_('Prueba', 'ADMIN', () => {
        codigo.apiUpsertExcepcionCatalogo({
          articulo: 'TOMATE ROSA I M',
          envase: 'EPS 104',
          atributo: 'SEGUIMIENTO',
          valor: 'QUIZAS'
        }, { repository: env.repo });
      });
    });
  }, /SEGUIMIENTO solo admite los valores 'SI' o 'NO'/);
});

// -----------------------------------------------------------------------------
// Aceptación 6: No se pierde nada (reproducción de MATRIZ_COMERCIAL_BASE.csv con la semilla)
// -----------------------------------------------------------------------------
runTest('6. Reproducción de MATRIZ_COMERCIAL_BASE.csv usando la fachada con solo la semilla:', () => {
  const env = crearEntorno();
  conSesion(SESION_PROPIETARIO, () => {
    codigo.sembrarCatalogo({ repository: env.repo });
  });

  const csvPath = path.join(__dirname, '..', 'docs', 'reference', 'MATRIZ_COMERCIAL_BASE.csv');
  const csvText = fs.readFileSync(csvPath, 'utf8');
  const filasCsv = parsearCsvMatrizReferencia(csvText);
  assert.strictEqual(filasCsv.length, 438, 'El CSV debe tener 438 filas de datos');

  const resolver = new CommercialGroupResolver({ repository: env.repo });
  const catalogoService = new CatalogoService({ repository: env.repo });

  const filasConGrupo = filasCsv.filter(f => f.grupo_comercial !== '');
  const filasSinEnvase = filasCsv.filter(f => f.envase === '');
  const filasSinGrupoConEnvase = filasCsv.filter(f => f.grupo_comercial === '' && f.envase !== '');

  assert.strictEqual(filasConGrupo.length, 300);
  assert.strictEqual(filasSinEnvase.length, 81);
  assert.strictEqual(filasSinGrupoConEnvase.length, 57);

  // 6.1 Cada fila con GRUPO_COMERCIAL relleno resuelve al mismo grupo y subgrupo (<= 5 diferencias)
  const diferencias = [];
  for (const fila of filasConGrupo) {
    const esperado = mapearGrupoCsvACanonico(fila.grupo_comercial);
    const res = resolver.resolve(fila.articulo, fila.envase);
    if (res.groupId !== esperado.grupo || res.subgroupId !== esperado.subgrupo) {
      diferencias.push({
        lineaCsv: fila.lineaCsv,
        articulo: fila.articulo,
        envase: fila.envase,
        esperado,
        obtenido: { grupo: res.groupId, subgrupo: res.subgroupId }
      });
    }
  }

  assert.ok(
    diferencias.length <= 5,
    `Se esperaban como máximo 5 diferencias en las 300 filas clasificadas, pero hubo ${diferencias.length}: ${JSON.stringify(diferencias)}`
  );
  assert.strictEqual(diferencias.length, 1, 'Solo 1 fila difiere por pasar Carrefour de startsWith/igualdad a contiene (línea 218)');

  // 6.2 Las 2 de Volley con formato excluido quedan en SIN CLASIFICAR (y status REVISAR en la fachada)
  const filasVolleyExcluido = filasSinGrupoConEnvase.filter(f => f.regla_clasificacion === 'VOLLEY_FORMATO_EXCLUIDO');
  assert.strictEqual(filasVolleyExcluido.length, 2);
  for (const fila of filasVolleyExcluido) {
    const resCat = catalogoService.clasificar(fila.articulo, fila.envase);
    assert.deepStrictEqual(resCat.cajones.COMERCIAL, { grupo: 'SIN CLASIFICAR', subgrupo: null });
    const resFac = resolver.resolve(fila.articulo, fila.envase);
    assert.strictEqual(resFac.groupId, 'NO_CLASIFICADO');
    assert.strictEqual(resFac.status, 'REVISAR');
  }

  // 6.3 Filas sin grupo y con envase: todas son SEGUIDA; 7 de Rosa Sabor en madera van a JAPI_JAPONES y 50 quedan en SIN CLASIFICAR
  let sinClasificarConEnvaseCount = 0;
  let rosaSaborMaderaCount = 0;

  for (const fila of filasSinGrupoConEnvase) {
    const resCat = catalogoService.clasificar(fila.articulo, fila.envase);
    assert.strictEqual(
      resCat.seguimiento,
      'SEGUIDA',
      `Fila sin grupo y con envase en línea ${fila.lineaCsv} (${fila.articulo} | ${fila.envase}) debe ser SEGUIDA`
    );

    if (resCat.cajones.COMERCIAL.grupo === 'SIN CLASIFICAR') {
      sinClasificarConEnvaseCount++;
    } else if (fila.articulo.includes('ROSA SABOR') && fila.envase.includes('MADERA')) {
      assert.deepStrictEqual(resCat.cajones.COMERCIAL, { grupo: 'JAPI_JAPONES', subgrupo: null });
      rosaSaborMaderaCount++;
    } else {
      assert.fail(`Fila inesperada clasificada fuera de SIN CLASIFICAR: línea ${fila.lineaCsv} -> ${JSON.stringify(resCat.cajones.COMERCIAL)}`);
    }
  }

  assert.strictEqual(rosaSaborMaderaCount, 7, '7 filas de Rosa Sabor en madera pasan a JAPI_JAPONES');
  assert.strictEqual(sinClasificarConEnvaseCount, 50, '50 filas sin grupo y con envase quedan en SIN CLASIFICAR (48 fuera de catálogo + 2 Volley formato excluido)');
});

// -----------------------------------------------------------------------------
// Aceptación 7: Cero términos de negocio en Catalogo.js, CatalogoService.js y CommercialGroupResolver.js
// -----------------------------------------------------------------------------
runTest('7. grep sobre Catalogo.js, CatalogoService.js y CommercialGroupResolver.js no devuelve ningún nombre de negocio:', () => {
  const patronProhibido = /CARREFOUR|ROSA|JAPI|JAPONES|EPS|CARTON|VOLLEY|HUEVO|MORESCO|AZUL|MADERA|TOMATE/i;
  const archivos = [
    path.join(__dirname, '..', 'src', 'Catalogo.js'),
    path.join(__dirname, '..', 'src', 'CatalogoService.js'),
    path.join(__dirname, '..', 'src', 'CommercialGroupResolver.js')
  ];

  for (const ruta of archivos) {
    const contenido = fs.readFileSync(ruta, 'utf8');
    const lineas = contenido.split(/\r?\n/);
    for (let i = 0; i < lineas.length; i++) {
      const m = lineas[i].match(patronProhibido);
      if (m) {
        assert.fail(`Término prohibido '${m[0]}' encontrado en ${path.basename(ruta)}:${i + 1}: ${lineas[i]}`);
      }
    }
  }
});

// -----------------------------------------------------------------------------
// Aceptación 8: Siembra idempotente, conservación de cambios manuales y bloqueo de obsoletos
// -----------------------------------------------------------------------------
runTest('8. Siembra idempotente (dos veces deja las mismas filas y conserva cambios hechos a mano):', () => {
  const env = crearEntorno();

  // No-propietario rechazado en sembrarCatalogo
  assert.throws(() => {
    conSesion(SESION_OPERADOR, () => {
      codigo.sembrarCatalogo({ repository: env.repo });
    });
  }, /Operación reservada al administrador/);

  // 1ª siembra
  const res1 = conSesion(SESION_PROPIETARIO, () => {
    return codigo.sembrarCatalogo({ repository: env.repo });
  });
  assert.ok(res1.atributos.insertados > 0);
  assert.ok(res1.reglas.insertados > 0);
  assert.ok(res1.agrupaciones.insertados > 0);

  const countAttr1 = env.repo.getAtributos().length;
  const countReg1 = env.repo.getReglasClasificacion().length;
  const countAgr1 = env.repo.getAgrupaciones().length;

  // Modificar a mano una regla y una fila de agrupación existentes
  const reglas = env.repo.getReglasClasificacion();
  reglas[0].observaciones = 'CAMBIO_MANUAL_REGLA_CONSERVADO';
  env.repo.saveReglasClasificacion(reglas);

  const agrupaciones = env.repo.getAgrupaciones();
  agrupaciones[0].grupo = 'CARREFOUR_PERSONALIZADO';
  env.repo.saveAgrupaciones(agrupaciones);

  // 2ª siembra: deja las mismas filas y conserva los cambios manuales
  const res2 = conSesion(SESION_PROPIETARIO, () => {
    return codigo.sembrarCatalogo({ repository: env.repo });
  });
  assert.strictEqual(res2.atributos.insertados, 0);
  assert.strictEqual(res2.reglas.insertados, 0);
  assert.strictEqual(res2.agrupaciones.insertados, 0);

  assert.strictEqual(env.repo.getAtributos().length, countAttr1);
  assert.strictEqual(env.repo.getReglasClasificacion().length, countReg1);
  assert.strictEqual(env.repo.getAgrupaciones().length, countAgr1);
  assert.strictEqual(env.repo.getReglasClasificacion()[0].observaciones, 'CAMBIO_MANUAL_REGLA_CONSERVADO');
  assert.strictEqual(env.repo.getAgrupaciones()[0].grupo, 'CARREFOUR_PERSONALIZADO');

  // Métodos obsoletos lanzan Error('Obsoleto: usar el catálogo (D-029)')
  const resolver = new CommercialGroupResolver({ repository: env.repo });
  assert.throws(() => resolver.addAssociation('A', 'B', {}), /Obsoleto: usar el catálogo \(D-029\)/);
  assert.throws(() => resolver.registerRule({}), /Obsoleto: usar el catálogo \(D-029\)/);
  assert.throws(() => resolver.registerGroup({}), /Obsoleto: usar el catálogo \(D-029\)/);
  assert.throws(() => resolver.loadMatrix([]), /Obsoleto: usar el catálogo \(D-029\)/);
  assert.throws(() => conContextoDePrueba_('Prueba', 'ADMIN', () => codigo.apiUpsertGrupoComercial({})), /Obsoleto: usar el catálogo \(D-029\)/);
  assert.throws(() => conContextoDePrueba_('Prueba', 'ADMIN', () => codigo.apiUpsertMatrizArticuloEnvase({})), /Obsoleto: usar el catálogo \(D-029\)/);
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE T-005: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
