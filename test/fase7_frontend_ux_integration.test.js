/**
 * STOCK-LIGHT — Test Suite de Integración de Fase 7.0: Frontend, UX/UI e Integración Operativa
 * 
 * Verifica:
 * 1. Punto de entrada HTTP doGet(e) y configuración de HtmlService
 * 2. Integridad y completitud del archivo src/Index.html (Componentes, Dashboard, Modales, Navegación responsive)
 * 3. Contratos de integración de las APIs expuestas en src/Código.js para el Frontend
 * 4. Extracción y análisis seguro de PDFs vía apiSubirYAnalizarPdf (con SHA-256 en servidor)
 * 5. Invariante innegociable: InventoryEngine.js permanece 100% inalterado
 * 
 * Ejecutable: node test/fase7_frontend_ux_integration.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Mocks para simular el entorno Google Apps Script si no existen globalmente
global.HtmlService = {
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
  createTemplateFromFile: function(filename) {
    const filePath = path.resolve(__dirname, `../src/${filename}.html`);
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    return {
      evaluate: function() {
        return {
          content,
          title: '',
          metaTags: [],
          xFrameMode: '',
          setTitle: function(t) { this.title = t; return this; },
          addMetaTag: function(name, val) { this.metaTags.push({ name, content: val }); return this; },
          setXFrameOptionsMode: function(mode) { this.xFrameMode = mode; return this; },
          getContent: function() { return this.content; }
        };
      }
    };
  }
};

const codigo = require('../src/Código');
const { conContextoDePrueba_ } = require('../src/Seguridad');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
    failed++;
  }
}

/**
 * Mock en memoria para pruebas de repositorio
 */
class InMemoryRepository {
  constructor() {
    this.articulos = [
      { codigo_articulo: '2112000', nombre_articulo: 'TOMATE ROSA M', activo: true },
      { codigo_articulo: '2111000', nombre_articulo: 'TOMATE HUEVO DE TORO', activo: true }
    ];
    this.envases = [
      { codigo_envase: 'EPS104', descripcion_envase: 'EPS 104', tara_kg: 0.25, peso_unitario_kg: 6.0, activo: true },
      { codigo_envase: 'CRT01', descripcion_envase: 'CARTON 30X40', tara_kg: 0.30, peso_unitario_kg: 5.0, activo: true }
    ];
    this.gruposComerciales = [
      { grupo_id: 'EPS', nombre_grupo: 'TOMATE EN CAJA EPS', activo: true },
      { grupo_id: 'HUEVO_DE_TORO', nombre_grupo: 'TOMATE HUEVO DE TORO', activo: true },
      { grupo_id: 'VOLLEY', nombre_grupo: 'TOMATE VOLLEY Y CORAZÓN DE BUEY', activo: true },
      { grupo_id: 'JAPI', nombre_grupo: 'TOMATE JAPI Y JAPONÉS', activo: true },
      { grupo_id: 'CARTON', nombre_grupo: 'TOMATES EN CAJA DE CARTÓN', activo: true },
      { grupo_id: 'CARREFOUR', nombre_grupo: 'CARREFOUR', activo: true }
    ];
    this.matriz = [
      { codigo_articulo: '2112000', codigo_envase: 'CRT01', grupo_id: 'CARTON', subgrupo: 'ROSA', prioridad: 1, activo: true }
    ];
    this.capasFifo = [
      { capa_id: 'CAPA_1', codigo_articulo: '2112000', codigo_envase: 'CRT01', partida: 'PART-001', cajas_iniciales: 100, cajas_consumidas: 20, cajas_restantes: 80, fecha_entrada: '2026-10-01' }
    ];
    this.stockActual = [
      { stock_key: '2112000|CRT01', codigo_articulo: '2112000', nombre_articulo: 'TOMATE ROSA M', codigo_envase: 'CRT01', descripcion_envase: 'CARTON 30X40', cajas_actuales: 80, total_cajas: 80, total_kilos: 480 }
    ];
  }

  getMaestroArticulos() { return [...this.articulos]; }
  getMaestroEnvases() { return [...this.envases]; }
  getGruposComerciales() { return [...this.gruposComerciales]; }
  getMatrizArticuloEnvase() { return [...this.matriz]; }
  getStockActual() { return [...this.stockActual]; }
  getCapasFifo() { return [...this.capasFifo]; }
}

console.log('\n================================================================');
console.log(' TEST SUITE FASE 7.0 — FRONTEND, UX/UI E INTEGRACIÓN OPERATIVA');
console.log('================================================================\n');

// -------------------------------------------------------------
// BLOQUE 1: ENTRY POINT Y HTML SERVICE
// -------------------------------------------------------------
runTest('1. doGet(e) devuelve HtmlOutput configurado con título, viewport responsive y xFrameMode', () => {
  const output = codigo.doGet({});
  assert.ok(output, 'doGet debe devolver un objeto output');
  assert.strictEqual(output.title, 'STOCK-LIGHT — Control de Existencias Hortofrutícola');
  
  const viewportTag = output.metaTags.find(m => m.name === 'viewport');
  assert.ok(viewportTag, 'Debe incluir meta tag viewport');
  assert.ok(viewportTag.content.includes('width=device-width'), 'Viewport debe ser responsive');
  assert.strictEqual(output.xFrameMode, 'DEFAULT');
});

// -------------------------------------------------------------
// BLOQUE 2: ARQUITECTURA E INTEGRIDAD DE Index.html
// -------------------------------------------------------------
const htmlPath = path.resolve(__dirname, '../src/Index.html');
let htmlContent = '';

runTest('2. src/Index.html existe y es un documento HTML5 completo y autocontenido', () => {
  assert.ok(fs.existsSync(htmlPath), 'El archivo src/Index.html debe existir');
  htmlContent = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(htmlContent.length > 5000, 'El archivo Index.html debe contener una interfaz sustancial');
  assert.ok(htmlContent.includes('<!DOCTYPE html>'), 'Debe tener doctype HTML5');
  assert.ok(htmlContent.includes('<html lang="es">'), 'Debe estar en español');
});

runTest('3. Index.html define las 6 tarjetas de Grupos Comerciales requeridas y su estilizado específico', () => {
  // Verificamos clases CSS y lógica de clasificación para los 6 grupos comerciales
  assert.ok(htmlContent.includes('grp-eps') && htmlContent.includes('--grp-eps-bg'), 'Debe incluir estilo y tarjeta EPS');
  assert.ok(htmlContent.includes('grp-huevo-toro') && htmlContent.includes('--grp-huevo-bg'), 'Debe incluir estilo y tarjeta Huevo de Toro');
  assert.ok(htmlContent.includes('grp-volley') && htmlContent.includes('--grp-volley-bg'), 'Debe incluir estilo y tarjeta Volley / Corazón de Buey');
  assert.ok(htmlContent.includes('grp-japi') && htmlContent.includes('--grp-japi-bg'), 'Debe incluir estilo y tarjeta Japi / Japonés');
  assert.ok(htmlContent.includes('grp-carton') && htmlContent.includes('--grp-carton-bg'), 'Debe incluir estilo y tarjeta Tomates en Cartón');
  assert.ok(htmlContent.includes('grp-carrefour') && htmlContent.includes('--grp-carrefour-bg'), 'Debe incluir estilo y tarjeta Carrefour');
  assert.ok(htmlContent.includes('groupsGrid'), 'Contenedor dinámico de tarjetas presente');
});

runTest('4. Index.html implementa los subgrupos comerciales para CARTÓN (AZUL, ROSA, MORESCO, OTROS)', () => {
  assert.ok(htmlContent.includes('subgroupsFilterContainer'), 'Debe incluir contenedor de subgrupos');
  assert.ok(htmlContent.includes('subgroupsChips'), 'Debe incluir píldoras de subgrupos');
  assert.ok(htmlContent.includes('subgroup-pill'), 'Debe incluir clases para badges de subgrupos');
  assert.ok(htmlContent.includes('subgroupsHtml') || htmlContent.includes('subgrupos'), 'Lógica de renderizado de subgrupos presente');
});

runTest('5. Index.html implementa navegación Drill-Down y Miga de Pan (Breadcrumb)', () => {
  assert.ok(htmlContent.includes('id="breadcrumbs"'), 'Debe existir contenedor de miga de pan');
  assert.ok(htmlContent.includes('id="viewDetalleGrupo"'), 'Debe existir vista de detalle de grupo');
  assert.ok(htmlContent.includes('id="viewDetallePartidas"'), 'Debe existir vista de detalle de partidas');
  assert.ok(htmlContent.includes('id="btnVolverDashboard"'), 'Debe existir botón para volver a dashboard');
  assert.ok(htmlContent.includes('id="btnVolverDetalleGrupo"'), 'Debe existir botón para volver a artículos');
});

runTest('6. Index.html implementa formularios de Movimientos (Entrada, Salida, Ajuste, Reclasificación)', () => {
  assert.ok(htmlContent.includes('id="formEntrada"'), 'Formulario de Entrada debe existir');
  assert.ok(htmlContent.includes('id="formSalida"'), 'Formulario de Salida debe existir');
  assert.ok(htmlContent.includes('id="formAjuste"'), 'Formulario de Ajuste debe existir');
  assert.ok(htmlContent.includes('id="aj_camposReclasificacion"'), 'Campos de Reclasificación deben existir');
  assert.ok(htmlContent.includes('sal_stockDisponible'), 'Comprobación de stock en tiempo real debe existir');
});

runTest('7. Index.html implementa sección reforzada de Correcciones Históricas con previsualización obligatoria', () => {
  assert.ok(htmlContent.includes('id="tabCorrecciones"'), 'Pestaña de Correcciones Históricas');
  assert.ok(htmlContent.includes('id="formCorreccion"'), 'Formulario de Corrección Histórica');
  assert.ok(htmlContent.includes('id="btnPrevisualizarCorreccion"'), 'Botón de previsualización analítica obligatoria');
  assert.ok(htmlContent.includes('id="btnEjecutarCorreccion"'), 'Botón de confirmación con salvaguarda');
  assert.ok(htmlContent.includes('id="corr_previewResult"'), 'Contenedor de previsualización de impacto');
  assert.ok(htmlContent.includes('id="corr_motivo"'), 'Campo de motivo obligatorio');
});

runTest('8. Index.html implementa zona de carga de Documentos (Drag & Drop y selector múltiple)', () => {
  assert.ok(htmlContent.includes('id="pdfDropZone"'), 'Zona Drag & Drop');
  assert.ok(htmlContent.includes('id="pdfFileInput"'), 'Input de archivos');
  assert.ok(htmlContent.includes('multiple'), 'Soporte para múltiples documentos');
  assert.ok(htmlContent.includes('id="tblStagingBody"'), 'Tabla de lote documental');
  assert.ok(htmlContent.includes('id="btnProcesarLote"'), 'Botón para análisis en servidor');
});

runTest('9. Index.html implementa Centro de Incidencias, Maestros y Auditoría de Operaciones', () => {
  assert.ok(htmlContent.includes('id="viewIncidencias"'), 'Centro de Incidencias');
  assert.ok(htmlContent.includes('id="viewConfiguracion"'), 'Vista de Maestros & Matriz');
  assert.ok(htmlContent.includes('id="viewAuditoria"'), 'Vista de Auditoría');
  assert.ok(htmlContent.includes('id="tblLogBody"'), 'Tabla de LOG_OPERACIONES');
});

runTest('10. Index.html implementa diseño responsive (Sidebar de escritorio y Bottom-Nav móvil)', () => {
  assert.ok(htmlContent.includes('class="sidebar"'), 'Sidebar presente en el marcado');
  assert.ok(htmlContent.includes('class="mobile-nav"'), 'Barra de navegación inferior para móvil presente');
  assert.ok(htmlContent.includes('@media (max-width: 900px)'), 'Media queries para pantallas móviles/tablets');
});

// -------------------------------------------------------------
// BLOQUE 3: CONTRATOS DE INTEGRACIÓN BACKEND -> FRONTEND
// -------------------------------------------------------------
const mockRepo = new InMemoryRepository();

runTest('11. apiGetMaestroArticulos devuelve el catálogo maestro para selectores del UI', () => {
  const articulos = conContextoDePrueba_('Prueba', 'CONSULTA', () => codigo.apiGetMaestroArticulos({ repository: mockRepo }));
  assert.ok(Array.isArray(articulos), 'Debe ser un array');
  assert.strictEqual(articulos.length, 2);
  assert.strictEqual(articulos[0].codigo_articulo, '2112000');
});

runTest('12. apiGetMaestroEnvases devuelve catálogo de envases con taras y pesos unitarios', () => {
  const envases = conContextoDePrueba_('Prueba', 'CONSULTA', () => codigo.apiGetMaestroEnvases({ repository: mockRepo }));
  assert.ok(Array.isArray(envases), 'Debe ser un array');
  assert.strictEqual(envases.length, 2);
  assert.strictEqual(envases[0].codigo_envase, 'EPS104');
  assert.strictEqual(envases[0].tara_kg, 0.25);
  assert.strictEqual(envases[0].peso_unitario_kg, 6.0);
});

runTest('13. apiObtenerStockVisualResumen devuelve estructura requerida por las tarjetas', () => {
  const resumen = conContextoDePrueba_('Prueba', 'CONSULTA', () => codigo.apiObtenerStockVisualResumen({ repository: mockRepo }));
  assert.ok(resumen, 'Debe devolver resumen');
  assert.ok(Array.isArray(resumen.grupos), 'Debe contener array de grupos');
  assert.ok(typeof resumen.granTotalCajas === 'number', 'Debe contener granTotalCajas');
  assert.ok(typeof resumen.granTotalLineas === 'number', 'Debe contener granTotalLineas');
});

runTest('14. apiObtenerDetallePartidas devuelve capas FIFO vivas para drill-down', () => {
  const detalle = conContextoDePrueba_('Prueba', 'CONSULTA', () => codigo.apiObtenerDetallePartidas('2112000', 'CRT01', { repository: mockRepo }));
  assert.ok(detalle, 'Debe devolver detalle');
  assert.ok(Array.isArray(detalle.partidas), 'Debe devolver array de partidas');
  assert.strictEqual(detalle.partidas.length, 1);
  assert.strictEqual(detalle.partidas[0].partida, 'PART-001');
  assert.strictEqual(detalle.partidas[0].cajasRestantes, 80);
});

// -------------------------------------------------------------
// BLOQUE 4: INGESTA Y REVISIÓN SEGURA DE PDFS (SERVER-SIDE)
// -------------------------------------------------------------
runTest('15. apiSubirYAnalizarPdf calcula SHA-256 en servidor y valida integridad sin mutar stock', () => {
  const dummyPdfText = '%PDF-1.4\nBT /F1 12 Tf (ALBARAN DE SALIDA AVT26/9999) Tj ET\n%%EOF';
  const dummyBase64 = Buffer.from(dummyPdfText).toString('base64');
  
  const payload = {
    fileName: 'AVT26_9999.pdf',
    base64: dummyBase64
  };

  const resultado = conContextoDePrueba_('Prueba', 'CONSULTA', () => codigo.apiSubirYAnalizarPdf(payload, { repository: mockRepo }));
  assert.ok(resultado, 'Debe devolver resultado estructurado');
  assert.strictEqual(resultado.fileName, 'AVT26_9999.pdf');
  assert.ok(resultado.sha256Hash && resultado.sha256Hash.length === 64, 'Debe calcular hash SHA-256 canónico de 64 caracteres');
  
  // Verificar que el stock no fue mutado
  assert.strictEqual(mockRepo.getStockActual()[0].total_cajas, 80, 'El stock debe permanecer intacto');
});

runTest('16. apiSubirYAnalizarPdf rechaza payloads inválidos o sin datos binarios', () => {
  assert.throws(() => {
    conContextoDePrueba_('Prueba', 'CONSULTA', () => codigo.apiSubirYAnalizarPdf(null));
  }, /apiSubirYAnalizarPdf/);

  assert.throws(() => {
    conContextoDePrueba_('Prueba', 'CONSULTA', () => codigo.apiSubirYAnalizarPdf({ fileName: 'test.pdf' }));
  }, /apiSubirYAnalizarPdf/);
});

// -------------------------------------------------------------
// BLOQUE 5: SEGURIDAD Y CONEXIÓN CLIENTE (BRIDGE)
// -------------------------------------------------------------
runTest('17. Frontend contiene puente de comunicación seguro api.call con fallback y manejo de errores', () => {
  assert.ok(htmlContent.includes('const api = {'), 'Objeto api puente definido');
  assert.ok(htmlContent.includes('google.script.run'), 'Integración nativa con Apps Script');
  assert.ok(htmlContent.includes('withSuccessHandler'), 'Manejo de respuestas asíncronas');
  assert.ok(htmlContent.includes('withFailureHandler'), 'Manejo de fallos en servidor');
});

runTest('18. El frontend no contiene lógica de cálculo de saldos FIFO ni manipulación directa de existencias', () => {
  assert.ok(!htmlContent.includes('rebuildStockFromMovements'), 'El cliente nunca reconstruye stock');
  assert.ok(!htmlContent.includes('processMovement('), 'El cliente nunca procesa movimientos directamente');
  assert.ok(!htmlContent.includes('capasFifo.pop'), 'El cliente nunca descuenta capas FIFO');
});

// -------------------------------------------------------------
// BLOQUE 6: INVARIANTE INNEGOCIABLE DE INVENTORY ENGINE
// -------------------------------------------------------------
runTest('19. Invariante Innegociable: InventoryEngine.js permanece 100% inalterado respecto a Git HEAD', () => {
  const diff = execSync('git diff -- src/InventoryEngine.js', { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.strictEqual(diff.trim(), '', 'InventoryEngine.js debe tener CERO diferencias respecto a Git HEAD');
});

console.log('\n================================================================');
console.log(` RESULTADOS SUITE FASE 7.0: ${passed} SUPERADAS | ${failed} FALLIDAS`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
