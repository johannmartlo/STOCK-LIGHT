/**
 * Datos 100 % ficticios para la vista previa local de T-024 (D-015).
 * Genera sobre `test/helpers/mockSheets`:
 * - 6 variedades en AGRUPACIONES (COMERCIAL)
 * - ~40 partidas vivas
 * - 30 días de movimientos (entradas, salidas, ajustes de destrío)
 * - 2 reprocesos activos con procedencia (`viene_de` / `se_convirtio_en`)
 * - 2 pendientes por stock insuficiente
 */

const { crearEntorno } = require('../../test/helpers/mockSheets');
const { CatalogoService } = require('../../src/CatalogoService');
const { InicioService } = require('../../src/InicioService');
const { ImportacionService } = require('../../src/importacion/ImportacionService');
const { PendientesService } = require('../../src/importacion/PendientesService');
const { StockInicialService } = require('../../src/importacion/StockInicialService');
const { SeguimientoService } = require('../../src/SeguimientoService');
const { hoyMadrid } = require('../../src/Fechas');
const { crearServicioAcceso_ } = require('../../src/Seguridad');

function sumarDias(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

function crearEntornoVistaPrevia() {
  const env = crearEntorno();
  const hoy = hoyMadrid();

  // 1. Configurar catálogo ficticio de 6 variedades
  env.repo.saveAtributos([
    { nombre: 'SEGUIMIENTO', descripcion: 'Seguimiento en stock', activo: true },
    { nombre: 'VARIEDAD', descripcion: 'Variedad ficticia', activo: true }
  ]);

  const variedadesDef = [
    { nombre: 'Moresco Ficticio', patron: 'MORESCO', color: '#4FA37C', dias_aviso: 4 },
    { nombre: 'Rama Ficticia', patron: 'RAMA', color: '#F2553D', dias_aviso: 4 },
    { nombre: 'Volley Ficticio', patron: 'VOLLEY', color: '#2DD4BF', dias_aviso: 4 },
    { nombre: 'Rosa Granel Ficticio', patron: 'ROSA GRANEL', color: '#F5A3B5', dias_aviso: 4 },
    { nombre: 'Rosa 500 Ficticio', patron: 'ROSA 500', color: '#EC4899', dias_aviso: 4 },
    { nombre: 'Cocktail Ficticio', patron: 'COCKTAIL', color: '#60A5FA', dias_aviso: 4 }
  ];

  const reglas = [
    { id: 'REG-SEG-1', atributo: 'SEGUIMIENTO', valor: 'SI', prioridad: 1, articulo_contiene: 'TOMATE', activo: true }
  ];
  const agrupaciones = [];

  variedadesDef.forEach((v, idx) => {
    reglas.push({
      id: `REG-VAR-${idx + 1}`,
      atributo: 'VARIEDAD',
      valor: v.patron,
      prioridad: 10 + idx,
      articulo_contiene: v.patron,
      activo: true
    });
    agrupaciones.push({
      agrupacion: 'COMERCIAL',
      orden: idx + 1,
      grupo: v.nombre,
      subgrupo: '',
      filtro: `VARIEDAD=${v.patron}`,
      activo: true,
      color: v.color,
      dias_aviso: v.dias_aviso,
      stock_bajo: ''
    });
  });

  env.repo.saveReglasClasificacion(reglas);
  env.repo.saveAgrupaciones(agrupaciones);

  // 2. Generar 30 días de movimientos ficticios (~40 partidas vivas)
  const proveedores = ['FINCA SOLANA', 'HUERTA NORTE', 'COOPERATIVA VALLE', 'AGRO VERDE'];
  const clientes = ['MERCADO CENTRAL', 'FRUTAS DEL NORTE', 'SUPERMERCADOS SUR'];

  const combinaciones = [
    { art: 'TOMATE MORESCO I GG', env: 'CARTON 40X30', base: 45 },
    { art: 'TOMATE MORESCO I G', env: 'CARTON 40X30', base: 38 },
    { art: 'TOMATE MORESCO I M', env: 'CARTON 40X30', base: 24 },
    { art: 'TOMATE RAMA EXTRA M', env: 'CARTON 40X30', base: 52 },
    { art: 'TOMATE VOLLEY I G', env: 'MADERA 50X30', base: 30 },
    { art: 'TOMATE VOLLEY II M', env: 'MADERA 50X30', base: 26 },
    { art: 'TOMATE ROSA GRANEL M', env: 'CARTON 40X30', base: 44 },
    { art: 'TOMATE COCKTAIL I M', env: 'IFCO 8X300', base: 28 }
  ];

  // Primeros 24 días: entradas y salidas que dejan stock creciente y movimientos diarios
  for (let d = -26; d <= -5; d++) {
    const fecha = sumarDias(hoy, d);
    const comb = combinaciones[(d + 26) % combinaciones.length];
    const prov = proveedores[(d + 26) % proveedores.length];
    const cli = clientes[(d + 26) % clientes.length];
    const cajasEnt = comb.base + ((d + 26) % 5) * 8;
    const cajasSal = Math.max(10, cajasEnt - 18);

    env.movService.registrarEntrada({
      id_documento: `DOC-PREV-E-${d + 30}`,
      tipo_documento: 'COMPRA',
      serie: 'ACT27',
      numero: String(100 + d + 30),
      fecha_documento: fecha,
      entidad_nombre: prov,
      origen_dato: 'CSV'
    }, [
      { codigo_articulo: comb.art, codigo_envase: comb.env, cajas: cajasEnt, partida: `P-${d + 30}` }
    ], 'Juan Alberto');

    env.movService.registrarSalida({
      id_documento: `DOC-PREV-S-${d + 30}`,
      tipo_documento: 'SALIDA',
      serie: 'AVT27',
      numero: String(500 + d + 30),
      fecha_documento: fecha,
      entidad_nombre: cli,
      origen_dato: 'CSV'
    }, [
      { codigo_articulo: comb.art, codigo_envase: comb.env, cajas: cajasSal }
    ], 'Juan Alberto');
  }

  // Últimos 4 días (-4 .. 0): múltiples partidas vivas (~35 adicionales) con fechas recientes (algunas >= 4 días para aviso ámbar)
  const entradasRecientes = [
    // Hace 4 días (dispara aviso "para sacar" en Moresco, Volley y Cocktail)
    { d: -4, art: 'TOMATE MORESCO I GG', env: 'CARTON 40X30', cajas: 190, prov: 'FINCA SOLANA' },
    { d: -4, art: 'TOMATE MORESCO I G', env: 'CARTON 40X30', cajas: 145, prov: 'FINCA SOLANA' },
    { d: -4, art: 'TOMATE MORESCO I M', env: 'CARTON 40X30', cajas: 82, prov: 'HUERTA NORTE' },
    { d: -4, art: 'TOMATE VOLLEY I G', env: 'MADERA 50X30', cajas: 64, prov: 'COOPERATIVA VALLE' },
    { d: -4, art: 'TOMATE COCKTAIL I M', env: 'IFCO 8X300', cajas: 56, prov: 'AGRO VERDE' },
    // Hace 3 días
    { d: -3, art: 'TOMATE MORESCO I GG', env: 'CARTON 40X30', cajas: 210, prov: 'FINCA SOLANA' },
    { d: -3, art: 'TOMATE MORESCO I G', env: 'CARTON 40X30', cajas: 160, prov: 'HUERTA NORTE' },
    { d: -3, art: 'TOMATE RAMA EXTRA M', env: 'CARTON 40X30', cajas: 140, prov: 'COOPERATIVA VALLE' },
    { d: -3, art: 'TOMATE VOLLEY II M', env: 'MADERA 50X30', cajas: 75, prov: 'COOPERATIVA VALLE' },
    { d: -3, art: 'TOMATE ROSA GRANEL M', env: 'CARTON 40X30', cajas: 130, prov: 'HUERTA NORTE' },
    // Hace 2 días
    { d: -2, art: 'TOMATE MORESCO I M', env: 'CARTON 40X30', cajas: 95, prov: 'FINCA SOLANA' },
    { d: -2, art: 'TOMATE RAMA EXTRA M', env: 'CARTON 40X30', cajas: 110, prov: 'AGRO VERDE' },
    { d: -2, art: 'TOMATE VOLLEY I G', env: 'MADERA 50X30', cajas: 48, prov: 'COOPERATIVA VALLE' },
    { d: -2, art: 'TOMATE ROSA GRANEL M', env: 'CARTON 40X30', cajas: 90, prov: 'FINCA SOLANA' },
    { d: -2, art: 'TOMATE COCKTAIL I M', env: 'IFCO 8X300', cajas: 44, prov: 'AGRO VERDE' },
    // Hace 1 día
    { d: -1, art: 'TOMATE MORESCO I GG', env: 'CARTON 40X30', cajas: 185, prov: 'FINCA SOLANA' },
    { d: -1, art: 'TOMATE MORESCO I G', env: 'CARTON 40X30', cajas: 120, prov: 'HUERTA NORTE' },
    { d: -1, art: 'TOMATE RAMA EXTRA M', env: 'CARTON 40X30', cajas: 95, prov: 'COOPERATIVA VALLE' },
    { d: -1, art: 'TOMATE VOLLEY II M', env: 'MADERA 50X30', cajas: 58, prov: 'AGRO VERDE' },
    { d: -1, art: 'TOMATE ROSA GRANEL M', env: 'CARTON 40X30', cajas: 70, prov: 'HUERTA NORTE' },
    // Hoy
    { d: 0, art: 'TOMATE MORESCO I GG', env: 'CARTON 40X30', cajas: 112, prov: 'FINCA SOLANA' },
    { d: 0, art: 'TOMATE RAMA EXTRA M', env: 'CARTON 40X30', cajas: 68, prov: 'COOPERATIVA VALLE' }
  ];

  entradasRecientes.forEach((e, idx) => {
    const fecha = sumarDias(hoy, e.d);
    env.movService.registrarEntrada({
      id_documento: `DOC-REC-E-${idx + 1}`,
      tipo_documento: 'COMPRA',
      serie: 'ACT27',
      numero: String(300 + idx),
      fecha_documento: fecha,
      entidad_nombre: e.prov,
      origen_dato: 'CSV',
      firma_lineas: `FIRMA-E-${idx + 1}`
    }, [
      { codigo_articulo: e.art, codigo_envase: e.env, cajas: e.cajas, partida: `PR-${idx + 1}` }
    ], 'Juan Alberto');
  });

  // Salidas recientes
  [
    { d: -2, art: 'TOMATE MORESCO I GG', env: 'CARTON 40X30', cajas: 65, cli: 'MERCADO CENTRAL' },
    { d: -1, art: 'TOMATE RAMA EXTRA M', env: 'CARTON 40X30', cajas: 80, cli: 'FRUTAS DEL NORTE' },
    { d: -1, art: 'TOMATE VOLLEY I G', env: 'MADERA 50X30', cajas: 35, cli: 'SUPERMERCADOS SUR' },
    { d: 0, art: 'TOMATE MORESCO I G', env: 'CARTON 40X30', cajas: 55, cli: 'MERCADO CENTRAL' }
  ].forEach((s, idx) => {
    const fecha = sumarDias(hoy, s.d);
    env.movService.registrarSalida({
      id_documento: `DOC-REC-S-${idx + 1}`,
      tipo_documento: 'SALIDA',
      serie: 'AVT27',
      numero: String(700 + idx),
      fecha_documento: fecha,
      entidad_nombre: s.cli,
      origen_dato: 'CSV',
      firma_lineas: `FIRMA-S-${idx + 1}`
    }, [
      { codigo_articulo: s.art, codigo_envase: s.env, cajas: s.cajas }
    ], 'Juan Alberto');
  });

  // 3. Dos reprocesos activos con procedencia (`viene_de`)
  const capasVivas = env.repo.getCapasFifo().filter(c => Number(c.cajas_restantes) > 0);
  const capaRosaGranel = capasVivas.find(c => c.codigo_articulo === 'TOMATE ROSA GRANEL M' && Number(c.cajas_restantes) >= 60);
  if (capaRosaGranel) {
    env.movService.registrarReproceso({
      origenes: [{ id_capa: capaRosaGranel.id_capa, cajas: 60 }],
      destinos: [{ articulo: 'TOMATE ROSA 500G', envase: 'EPS 106 9X500', cajas: 86 }],
      destrio_cajas: 2,
      destrio_kg: 12,
      observaciones: 'Confección tarrinas 500 g'
    }, 'Juan Alberto');
  }

  const capaRama = capasVivas.find(c => c.codigo_articulo === 'TOMATE RAMA EXTRA M' && Number(c.cajas_restantes) >= 40);
  if (capaRama) {
    env.movService.registrarReproceso({
      origenes: [{ id_capa: capaRama.id_capa, cajas: 35 }],
      destinos: [{ articulo: 'TOMATE COCKTAIL I M', envase: 'IFCO 8X300', cajas: 32 }],
      destrio_cajas: 3,
      destrio_kg: 15,
      observaciones: 'Selección calibre'
    }, 'Juan Alberto');
  }

  // Ajuste de destrío directo para que aparezca en últimos movimientos y destrio7
  const capaVolley = env.repo.getCapasFifo().find(c => c.codigo_articulo === 'TOMATE VOLLEY II M' && Number(c.cajas_restantes) >= 10);
  if (capaVolley) {
    env.movService.registrarAjusteNegativo({
      codigo_articulo: capaVolley.codigo_articulo,
      codigo_envase: capaVolley.codigo_envase,
      cajas: 3,
      motivo: 'ROTURA',
      id_capa_objetivo: capaVolley.id_capa,
      observaciones: 'Cajas golpeadas en cámara'
    }, 'Ana');
  }

  // 4. Pendientes con los tres bloques poblados (STOCK_INSUFICIENTE, SEGUIMIENTO_DESCONOCIDO, MODIFICADO_EN_ERP)
  env.repo.appendPendientes([
    {
      id_pendiente: 'PEND-PREV-1',
      id_importacion: 'IMP-PREV-1',
      tipo_doc: 'SALIDA',
      serie: 'AVT27',
      numero: '901',
      linea: 1,
      fecha_negocio: hoy,
      entidad: 'MERCADO CENTRAL',
      articulo: 'TOMATE ROSA 500G',
      envase: 'EPS 106 9X500',
      cajas: 95,
      kg: 427.5,
      motivo: 'STOCK_INSUFICIENTE',
      estado: 'PENDIENTE',
      fecha_alta: new Date().toISOString(),
      fecha_resolucion: ''
    },
    {
      id_pendiente: 'PEND-PREV-2',
      id_importacion: 'IMP-PREV-1',
      tipo_doc: 'SALIDA',
      serie: 'AVT27',
      numero: '902',
      linea: 1,
      fecha_negocio: hoy,
      entidad: 'FRUTAS DEL NORTE',
      articulo: 'TOMATE COCKTAIL I M',
      envase: 'IFCO 8X300',
      cajas: 140,
      kg: 420,
      motivo: 'STOCK_INSUFICIENTE',
      estado: 'PENDIENTE',
      fecha_alta: new Date().toISOString(),
      fecha_resolucion: ''
    },
    {
      id_pendiente: 'PEND-PREV-3',
      id_importacion: 'IMP-PREV-2',
      tipo_doc: 'ENTRADA',
      serie: 'ACT27',
      numero: '910',
      linea: 1,
      fecha_negocio: hoy,
      entidad: 'FINCA SOLANA',
      articulo: 'ALBARICOQUE FICTICIO G',
      envase: 'CARTON 40X30',
      cajas: 24,
      kg: 120,
      motivo: 'SEGUIMIENTO_DESCONOCIDO',
      estado: 'PENDIENTE',
      fecha_alta: new Date().toISOString(),
      fecha_resolucion: ''
    },
    {
      id_pendiente: 'PEND-PREV-4',
      id_importacion: 'IMP-PREV-2',
      tipo_doc: 'SALIDA',
      serie: 'AVT27',
      numero: '701',
      linea: '',
      fecha_negocio: sumarDias(hoy, -1),
      entidad: 'FRUTAS DEL NORTE',
      articulo: '',
      envase: '',
      cajas: 15,
      kg: '',
      motivo: 'MODIFICADO_EN_ERP',
      estado: 'PENDIENTE',
      fecha_alta: new Date().toISOString(),
      fecha_resolucion: ''
    }
  ]);

  // 5. Usuario de prueba para probar la pantalla de PIN (PIN 1234)
  const cacheMap = new Map();
  const accesoSvc = crearServicioAcceso_({
    repository: env.repo,
    cache: {
      get: k => cacheMap.get(k) || null,
      put: (k, v) => { cacheMap.set(k, v); },
      remove: k => { cacheMap.delete(k); }
    },
    lock: env.lock,
    urlImplementacion: 'http://localhost:3099/'
  });
  const usr = accesoSvc.crearUsuario('Juan Alberto', 'ADMIN');
  const tokenPreview = new URL(usr.enlace).searchParams.get('k');
  const sesionInicial = accesoSvc.establecerPin(tokenPreview, '1234');

  const catalogoSvc = new CatalogoService({ repository: env.repo });
  const pendientesSvc = new PendientesService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogoSvc,
    lockService: env.lock
  });
  const importacionSvc = new ImportacionService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogoSvc,
    pendientesService: pendientesSvc,
    lockService: env.lock
  });
  const seguimientoSvc = new SeguimientoService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogoSvc,
    pendientesService: pendientesSvc,
    lockService: env.lock
  });
  const stockInicialSvc = new StockInicialService({
    repository: env.repo,
    movementService: env.movService,
    catalogoService: catalogoSvc,
    pendientesService: pendientesSvc,
    lockService: env.lock,
    crearCopiaSeguridad: () => ({ id: 'COPIA-PREV-1', nombre: 'PRE_STOCK_INICIAL_preview' })
  });
  const inicioSvc = new InicioService({
    repository: env.repo,
    catalogoService: catalogoSvc,
    pendientesService: pendientesSvc,
    reloj: () => hoy
  });

  return {
    env,
    inicioSvc,
    importacionSvc,
    pendientesSvc,
    seguimientoSvc,
    stockInicialSvc,
    accesoSvc,
    tokenPreview,
    sesionInicial
  };
}

module.exports = {
  crearEntornoVistaPrevia
};
