/**
 * STOCK-LIGHT — SemillaCatalogo.js
 * Datos iniciales de campaña para atributos, reglas de clasificación y agrupaciones (D-029).
 * Único archivo de src/ con nombres de productos, envases o clientes.
 */

const ATRIBUTOS_SEMILLA = [
  {
    nombre: 'SEGUIMIENTO',
    descripcion: 'Decide si la combinación artículo + envase cuenta en el stock vivo (SI / NO)',
    activo: true
  },
  {
    nombre: 'FAMILIA',
    descripcion: 'Variedad o familia comercial del artículo',
    activo: true
  },
  {
    nombre: 'MATERIAL',
    descripcion: 'Material o tipo físico del envase',
    activo: true
  },
  {
    nombre: 'PROGRAMA',
    descripcion: 'Programa de cliente específico cuando prevalece sobre material y familia',
    activo: true
  },
  {
    nombre: 'REVISAR',
    descripcion: 'Marca combinaciones con formato comercialmente excluido (SI)',
    activo: true
  }
];

const REGLAS_CLASIFICACION_SEMILLA = [
  // 1. SEGUIMIENTO (D-021, D-029)
  {
    id: 'REG-SEG-JAPI-UNID',
    atributo: 'SEGUIMIENTO',
    valor: 'NO',
    prioridad: 10,
    articulo_contiene: 'JAPI UNID',
    articulo_excluye: '',
    envase_contiene: '',
    envase_excluye: '',
    activo: true,
    observaciones: 'JAPI por unidades no se sigue hasta T-017 (D-021)'
  },
  {
    id: 'REG-SEG-NO-TOMATE',
    atributo: 'SEGUIMIENTO',
    valor: 'NO',
    prioridad: 20,
    articulo_contiene: '',
    articulo_excluye: 'TOMATE',
    envase_contiene: '',
    envase_excluye: '',
    activo: true,
    observaciones: 'Solo se lleva stock de tomate'
  },
  {
    id: 'REG-SEG-TOMATE',
    atributo: 'SEGUIMIENTO',
    valor: 'SI',
    prioridad: 30,
    articulo_contiene: 'TOMATE',
    articulo_excluye: '',
    envase_contiene: '',
    envase_excluye: '',
    activo: true,
    observaciones: 'Todo artículo de tomate (salvo excepciones previas) es seguido'
  },

  // 2. MATERIAL
  {
    id: 'REGLA_ENVASE_EPS',
    atributo: 'MATERIAL',
    valor: 'EPS',
    prioridad: 10,
    articulo_contiene: '',
    articulo_excluye: '',
    envase_contiene: 'EPS',
    envase_excluye: '',
    activo: true,
    observaciones: 'Envase EPS'
  },
  {
    id: 'REGLA_ENVASE_MADERA',
    atributo: 'MATERIAL',
    valor: 'MADERA',
    prioridad: 20,
    articulo_contiene: '',
    articulo_excluye: '',
    envase_contiene: 'MADERA',
    envase_excluye: 'CARTON',
    activo: true,
    observaciones: 'Envase de madera (excluyendo cartón con serigrafía madera)'
  },
  {
    id: 'REGLA_CARTON',
    atributo: 'MATERIAL',
    valor: 'CARTON',
    prioridad: 30,
    articulo_contiene: '',
    articulo_excluye: '',
    envase_contiene: 'CARTON;CART;CT',
    envase_excluye: '',
    activo: true,
    observaciones: 'Envase de cartón'
  },

  // 3. PROGRAMA
  {
    id: 'REGLA_CARREFOUR',
    atributo: 'PROGRAMA',
    valor: 'CARREFOUR',
    prioridad: 10,
    articulo_contiene: 'TOMATE PERA RAMA I M;TOMATE COCKTAIL I M;TOMATE COCKTAIL SUNSTREAM I M;TOMATE COCKTAIL SAO PAULO I M;TOMATE CHERRY RAMA SUNSTREAM TERMO EXTRA;TOMATE CHERRY RAMA SAO PAULO TERMO EXTRA',
    articulo_excluye: '',
    envase_contiene: 'IFCO;PURA RAZA;MADERA 8X300;MADERA 10X300;MADERA 10X500;10X225;8X225;CARREFOUR;CARTON 40X30X14 GENERICA',
    envase_excluye: '',
    activo: true,
    observaciones: 'Combinaciones oficiales del programa Carrefour'
  },

  // 4. FAMILIA (orden relativo de prioridad: Huevo de Toro, Volley, Japi, Japonés, Rosa Sabor antes que Rosa, Azul, Rosa, Moresco)
  {
    id: 'REGLA_HUEVO_DE_TORO',
    atributo: 'FAMILIA',
    valor: 'HUEVO DE TORO',
    prioridad: 10,
    articulo_contiene: 'HUEVO DE TORO;HUEVO TORO',
    articulo_excluye: '',
    envase_contiene: '',
    envase_excluye: '',
    activo: true,
    observaciones: 'Familia Huevo de Toro'
  },
  {
    id: 'REGLA_VOLLEY',
    atributo: 'FAMILIA',
    valor: 'VOLLEY',
    prioridad: 20,
    articulo_contiene: 'VOLLEY;CORAZON DE BUEY;CORAZON BUEY',
    articulo_excluye: '',
    envase_contiene: '',
    envase_excluye: '',
    activo: true,
    observaciones: 'Familia Volley y Corazón de Buey'
  },
  {
    id: 'REGLA_JAPI',
    atributo: 'FAMILIA',
    valor: 'JAPI',
    prioridad: 30,
    articulo_contiene: 'JAPI',
    articulo_excluye: '',
    envase_contiene: '',
    envase_excluye: '',
    activo: true,
    observaciones: 'Familia Japi'
  },
  {
    id: 'REGLA_JAPONES',
    atributo: 'FAMILIA',
    valor: 'JAPONES',
    prioridad: 40,
    articulo_contiene: 'JAPONES',
    articulo_excluye: '',
    envase_contiene: '',
    envase_excluye: '',
    activo: true,
    observaciones: 'Familia Japonés'
  },
  {
    id: 'REGLA_ROSA_SABOR',
    atributo: 'FAMILIA',
    valor: 'ROSA SABOR',
    prioridad: 50,
    articulo_contiene: 'ROSA SABOR;ROSA DE SABOR',
    articulo_excluye: '',
    envase_contiene: '',
    envase_excluye: '',
    activo: true,
    observaciones: 'Familia Rosa Sabor (evaluada antes que Rosa)'
  },
  {
    id: 'REGLA_CARTON_AZUL',
    atributo: 'FAMILIA',
    valor: 'AZUL',
    prioridad: 60,
    articulo_contiene: 'AZUL',
    articulo_excluye: '',
    envase_contiene: '',
    envase_excluye: '',
    activo: true,
    observaciones: 'Familia Azul'
  },
  {
    id: 'REGLA_CARTON_ROSA',
    atributo: 'FAMILIA',
    valor: 'ROSA',
    prioridad: 70,
    articulo_contiene: 'ROSA',
    articulo_excluye: '',
    envase_contiene: '',
    envase_excluye: '',
    activo: true,
    observaciones: 'Familia Rosa'
  },
  {
    id: 'REGLA_CARTON_MORESCO',
    atributo: 'FAMILIA',
    valor: 'MORESCO',
    prioridad: 80,
    articulo_contiene: 'MORESCO',
    articulo_excluye: '',
    envase_contiene: '',
    envase_excluye: '',
    activo: true,
    observaciones: 'Familia Moresco'
  },

  // 5. REVISAR
  {
    id: 'VOLLEY_FORMATO_EXCLUIDO',
    atributo: 'REVISAR',
    valor: 'SI',
    prioridad: 10,
    articulo_contiene: 'VOLLEY;CORAZON DE BUEY;CORAZON BUEY',
    articulo_excluye: '',
    envase_contiene: '40X30X11 VOLLEY HD Q5;40X30X11+VOLLEY',
    envase_excluye: '',
    activo: true,
    observaciones: 'Formato 40X30X11 de Volley excluido comercialmente'
  }
];

const AGRUPACIONES_SEMILLA = [
  {
    agrupacion: 'COMERCIAL',
    orden: 1,
    grupo: 'CARREFOUR',
    subgrupo: '',
    filtro: 'PROGRAMA=CARREFOUR',
    activo: true
  },
  {
    agrupacion: 'COMERCIAL',
    orden: 2,
    grupo: 'EPS',
    subgrupo: '',
    filtro: 'MATERIAL=EPS',
    activo: true
  },
  {
    agrupacion: 'COMERCIAL',
    orden: 3,
    grupo: 'HUEVO_TORO',
    subgrupo: '',
    filtro: 'FAMILIA=HUEVO DE TORO',
    activo: true
  },
  {
    agrupacion: 'COMERCIAL',
    orden: 4,
    grupo: 'VOLLEY',
    subgrupo: '',
    filtro: 'FAMILIA=VOLLEY; REVISAR!=SI',
    activo: true
  },
  {
    agrupacion: 'COMERCIAL',
    orden: 5,
    grupo: 'JAPI_JAPONES',
    subgrupo: '',
    filtro: 'FAMILIA=JAPI|JAPONES',
    activo: true
  },
  {
    agrupacion: 'COMERCIAL',
    orden: 6,
    grupo: 'JAPI_JAPONES',
    subgrupo: '',
    filtro: 'FAMILIA=ROSA SABOR; MATERIAL=MADERA',
    activo: true
  },
  {
    agrupacion: 'COMERCIAL',
    orden: 7,
    grupo: 'CARTON',
    subgrupo: 'AZUL',
    filtro: 'MATERIAL=CARTON; FAMILIA=AZUL',
    activo: true
  },
  {
    agrupacion: 'COMERCIAL',
    orden: 8,
    grupo: 'CARTON',
    subgrupo: 'ROSA',
    filtro: 'MATERIAL=CARTON; FAMILIA=ROSA|ROSA SABOR',
    activo: true
  },
  {
    agrupacion: 'COMERCIAL',
    orden: 9,
    grupo: 'CARTON',
    subgrupo: 'MORESCO',
    filtro: 'MATERIAL=CARTON; FAMILIA=MORESCO',
    activo: true
  },
  {
    agrupacion: 'COMERCIAL',
    orden: 10,
    grupo: 'CARTON',
    subgrupo: 'OTROS',
    filtro: 'MATERIAL=CARTON; REVISAR!=SI',
    activo: true
  },
  {
    agrupacion: 'COMERCIAL',
    orden: 11,
    grupo: 'SIN CLASIFICAR',
    subgrupo: '',
    filtro: '',
    activo: true
  }
];

const CATALOGO_SEMILLA = [];

const METADATOS_GRUPOS_COMERCIALES = {
  EPS: {
    id: 'EPS',
    name: 'TOMATE EN CAJA EPS',
    order: 1,
    activo: true,
    subgroups: []
  },
  HUEVO_TORO: {
    id: 'HUEVO_TORO',
    name: 'TOMATE HUEVO DE TORO',
    order: 2,
    activo: true,
    subgroups: []
  },
  VOLLEY: {
    id: 'VOLLEY',
    name: 'TOMATE VOLLEY Y CORAZÓN DE BUEY',
    order: 3,
    activo: true,
    subgroups: []
  },
  JAPI_JAPONES: {
    id: 'JAPI_JAPONES',
    name: 'TOMATE JAPI Y JAPONÉS',
    order: 4,
    activo: true,
    subgroups: []
  },
  CARTON: {
    id: 'CARTON',
    name: 'TOMATES EN CAJA DE CARTÓN',
    order: 5,
    activo: true,
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
    activo: true,
    subgroups: []
  },
  NO_CLASIFICADO: {
    id: 'NO_CLASIFICADO',
    name: 'PENDIENTE DE ASOCIACIÓN',
    order: 99,
    activo: true,
    subgroups: []
  }
};

const SEMILLA_CATALOGO = {
  atributos: ATRIBUTOS_SEMILLA,
  reglas: REGLAS_CLASIFICACION_SEMILLA,
  catalogo: CATALOGO_SEMILLA,
  agrupaciones: AGRUPACIONES_SEMILLA
};

/**
 * Siembra de forma idempotente las hojas ATRIBUTOS, REGLAS_CLASIFICACION y AGRUPACIONES
 * en el repositorio indicado, añadiendo únicamente las filas que no existan sin sobrescribir
 * ni borrar las existentes (Regla 5).
 *
 * @param {Object} repo - Instancia de SheetsRepository
 * @returns {{
 *   atributos: { insertados: number, omitidos: number, total: number },
 *   reglas: { insertados: number, omitidos: number, total: number },
 *   agrupaciones: { insertados: number, omitidos: number, total: number }
 * }}
 * @private
 */
function sembrarCatalogoEnRepositorio_(repo) {
  if (!repo) {
    throw new Error('sembrarCatalogoEnRepositorio_: Se requiere una instancia de repositorio.');
  }

  if (typeof repo.provisionDatabase === 'function') {
    repo.provisionDatabase();
  }

  // 1. ATRIBUTOS (clave: nombre)
  const atributosActuales = typeof repo.getAtributos === 'function' ? repo.getAtributos() : [];
  const nombresExistentes = new Set(
    atributosActuales.map(a => String(a.nombre || '').trim().toUpperCase()).filter(Boolean)
  );
  const atributosNuevos = [];
  let atributosOmitidos = 0;

  for (let i = 0; i < ATRIBUTOS_SEMILLA.length; i++) {
    const fila = ATRIBUTOS_SEMILLA[i];
    const clave = String(fila.nombre || '').trim().toUpperCase();
    if (nombresExistentes.has(clave)) {
      atributosOmitidos++;
    } else {
      atributosNuevos.push({ ...fila });
      nombresExistentes.add(clave);
    }
  }
  if (atributosNuevos.length > 0 && typeof repo.appendAtributos === 'function') {
    repo.appendAtributos(atributosNuevos);
  }

  // 2. REGLAS_CLASIFICACION (clave: id)
  const reglasActuales = typeof repo.getReglasClasificacion === 'function' ? repo.getReglasClasificacion() : [];
  const idsReglasExistentes = new Set(
    reglasActuales.map(r => String(r.id || '').trim().toUpperCase()).filter(Boolean)
  );
  const reglasNuevas = [];
  let reglasOmitidas = 0;

  for (let i = 0; i < REGLAS_CLASIFICACION_SEMILLA.length; i++) {
    const fila = REGLAS_CLASIFICACION_SEMILLA[i];
    const clave = String(fila.id || '').trim().toUpperCase();
    if (idsReglasExistentes.has(clave)) {
      reglasOmitidas++;
    } else {
      reglasNuevas.push({ ...fila });
      idsReglasExistentes.add(clave);
    }
  }
  if (reglasNuevas.length > 0 && typeof repo.appendReglasClasificacion === 'function') {
    repo.appendReglasClasificacion(reglasNuevas);
  }

  // 3. AGRUPACIONES (clave: agrupacion + orden)
  const agrupacionesActuales = typeof repo.getAgrupaciones === 'function' ? repo.getAgrupaciones() : [];
  const clavesAgrupExistentes = new Set(
    agrupacionesActuales.map(a => `${String(a.agrupacion || '').trim().toUpperCase()}|${Number(a.orden)}`)
  );
  const agrupacionesNuevas = [];
  let agrupacionesOmitidas = 0;

  for (let i = 0; i < AGRUPACIONES_SEMILLA.length; i++) {
    const fila = AGRUPACIONES_SEMILLA[i];
    const clave = `${String(fila.agrupacion || '').trim().toUpperCase()}|${Number(fila.orden)}`;
    if (clavesAgrupExistentes.has(clave)) {
      agrupacionesOmitidas++;
    } else {
      agrupacionesNuevas.push({ ...fila });
      clavesAgrupExistentes.add(clave);
    }
  }
  if (agrupacionesNuevas.length > 0 && typeof repo.appendAgrupaciones === 'function') {
    repo.appendAgrupaciones(agrupacionesNuevas);
  }

  const totalInsertados = atributosNuevos.length + reglasNuevas.length + agrupacionesNuevas.length;
  const totalOmitidos = atributosOmitidos + reglasOmitidas + agrupacionesOmitidas;

  return {
    atributos: {
      insertados: atributosNuevos.length,
      omitidos: atributosOmitidos,
      anadidas: atributosNuevos.length,
      conservadas: atributosOmitidos,
      total: atributosActuales.length + atributosNuevos.length
    },
    reglas: {
      insertados: reglasNuevas.length,
      omitidos: reglasOmitidas,
      anadidas: reglasNuevas.length,
      conservadas: reglasOmitidas,
      total: reglasActuales.length + reglasNuevas.length
    },
    agrupaciones: {
      insertados: agrupacionesNuevas.length,
      omitidos: agrupacionesOmitidas,
      anadidas: agrupacionesNuevas.length,
      conservadas: agrupacionesOmitidas,
      total: agrupacionesActuales.length + agrupacionesNuevas.length
    },
    totalInsertados,
    totalOmitidos,
    totalAnadidas: totalInsertados,
    totalConservadas: totalOmitidos
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ATRIBUTOS_SEMILLA,
    REGLAS_CLASIFICACION_SEMILLA,
    AGRUPACIONES_SEMILLA,
    CATALOGO_SEMILLA,
    METADATOS_GRUPOS_COMERCIALES,
    SEMILLA_CATALOGO,
    sembrarCatalogoEnRepositorio_
  };
}
