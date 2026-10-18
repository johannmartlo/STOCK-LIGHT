# STOCK-LIGHT

> **Utilidad Ligera de Control y Conciliación de Existencias por Cajas (Hispatec)**

---

## 1. Identidad y Alcance del Proyecto

**STOCK-LIGHT** es una herramienta ágil, precisa y ligera diseñada exclusivamente para **controlar y conciliar existencias físicas de productos hortofrutícolas en cajas/envases**, calculadas a partir de documentos oficiales de entrada y salida emitidos por Hispatec:
* **Entradas activas:** Albaranes de Compra (series `ACT`, `NT`).
* **Salidas activas:** Albaranes de Salida (series `AVT`).
*(Nota: Las recepciones de mercancía/medianería quedan fuera del MVP activo por decisión de diseño de la Fase 2.1).*

### ⚠️ Lo que STOCK-LIGHT NO ES
* **NO es CCO**: CCO gestiona la operativa física del almacén, operarios en campo, tablets, flujos de trabajo en tiempo real y automatizaciones de planta. STOCK-LIGHT **no interfiere ni replica** la operativa de CCO.
* **NO es un WMS (Warehouse Management System)**: No gestiona ubicaciones de estantería, rutas de picking, cross-docking ni operarios.
* **NO es un ERP**: No gestiona facturación, contabilidad, cobros ni precios.
* **Propósito**: Servir como solución táctica intermedia, fiable e inmediata para tener la certeza absoluta de:  
  **"¿Cuántas cajas deberían quedar actualmente de cada ARTÍCULO + ENVASE?"**

---

## 2. Entorno y Repositorio

* **Workspace local:** `<RUTA_LOCAL_DEL_PROYECTO>`  
  *(Raíz única del proyecto. No se accede ni modifican directorios hermanos como CCO).*
* **Fuente de Verdad del Código (VCS):**  
  GitHub: [https://github.com/johannmartlo/STOCK-LIGHT](https://github.com/johannmartlo/STOCK-LIGHT)
* **Proyecto Google Apps Script (desarrollo):**  
  ID: `<DEV_SCRIPT_ID>`  
  Editor: [Google Apps Script Editor](https://script.google.com/home/projects/<DEV_SCRIPT_ID>/edit)

> **Configuración local de Clasp:** el archivo `.clasp.json` real no se versiona. Copia `.clasp.json.example` a `.clasp.json`, sustituye `<DEV_SCRIPT_ID>` por el ID de tu proyecto de desarrollo y mantén ese archivo fuera de Git. El proyecto de producción debe ser independiente.

---

## 3. Pila Tecnológica

STOCK-LIGHT está concebido deliberadamente como un sistema ligero y de bajo volumen sin sobreingeniería:

* **Backend / Lógica de Negocio:** Google Apps Script (V8 Runtime, JavaScript moderno).
* **Persistencia de Datos:** Google Sheets (actuando estrictamente como almacén de datos tabular mediante lectura/escritura en bloque, sin lógica de fórmulas complejas).
* **Almacenamiento de Documentos:** Google Drive (resguardo seguro de PDFs originales y trazabilidad de hashes).
* **Frontend:** Google Apps Script HTML Service (interfaz ligera HTML5, CSS3, JavaScript modular para carga de documentos, revisión humana y balance de stock).
* **Sincronización:** Google Clasp (`@google/clasp`).

---

## 4. Estructura del Proyecto

```text
STOCK-LIGHT/
├── .clasp.json.example  # Plantilla de configuración local de Clasp
├── .claspignore         # Filtro de subida a Apps Script
├── .gitattributes       # Normalización de finales de línea y binarios
├── .gitignore           # Exclusiones de control de versiones
├── README.md            # Documento principal de inducción y alcance
├── ARCHITECTURE.md      # Diseño arquitectónico y desacoplamiento
├── BUSINESS_RULES.md    # Reglas de inventario, FIFO, unidad de stock y deduplicación
├── DATA_MODEL.md        # Esquema de tablas y persistencia en Google Sheets
├── IMPORT_SPECS.md      # Especificaciones de extracción documental e Hispatec
├── TECHNICAL_RISKS.md   # Análisis de cuotas, límites de GAS y mitigaciones
├── docs/
│   └── reference/       # Datos de referencia versionados para pruebas
├── src/                 # Código fuente Apps Script sincronizado por Clasp
│   ├── appsscript.json  # Manifiesto oficial del proyecto Apps Script
│   ├── Código.js        # Punto de entrada / API interna
│   ├── Index.html       # Interfaz web servida por HtmlService
│   ├── MasterInitializationService.js
│   ├── MatrizComercialData.js
│   └── ...              # Módulos de dominio, parsers y validadores
└── test/                # Suites Node y fixtures de pruebas
```

---

## 5. Ciclo de Trabajo con Git y Clasp

El flujo de trabajo es unidireccional y seguro:

```text
GitHub (origin/main)
   ↓ (git pull)
Repositorio Local (<RUTA_LOCAL_DEL_PROYECTO>)
   ↓
Desarrollo & Pruebas Locales
   ↓
Sincronización a Apps Script (`clasp push`)
   ↓
Verificación en entorno Google
   ↓
Git Commit & Git Push a GitHub
```

> **Repositorio público:** no subir CSV operativos, XLSX, ZIP, PDFs, muestras ni configuraciones locales. Los datos de calibración y los documentos originales se copian fuera de Git.

### Comandos de Utilidad

```powershell
# Instalar Clasp (una vez)
npm install -g @google/clasp
clasp login

# Comprobar estado de Git
git status

# Subir cambios al repositorio Apps Script
clasp push

# Descargar cambios desde Apps Script (en caso de ediciones en web)
clasp pull
```

### Pruebas

Las suites Node se ejecutan sin dependencias externas, salvo las que requieren el corpus privado de `docs/samples`:

```powershell
node test/inventory_engine.test.js
node test/movement_service.test.js
node test/trust_boundary.test.js
node test/compra_packaging_resolution.test.js
node test/fase6_seguridad_operativa.test.js
node test/fase6_1_correcciones_historicas.test.js
node test/fase7_1_confirmacion_lote_y_seguridad.test.js
```

`real_pdf_parsers.test.js` contiene una expectativa obsoleta sobre `RecepcionParser` y no debe considerarse verde hasta corregirla.

---

## 6. Documentación del Sistema

Para consultar las especificaciones técnicas completas, remitirse a:
* [ARCHITECTURE.md](ARCHITECTURE.md)
* [BUSINESS_RULES.md](BUSINESS_RULES.md)
* [DATA_MODEL.md](DATA_MODEL.md)
* [IMPORT_SPECS.md](IMPORT_SPECS.md)
* [TECHNICAL_RISKS.md](TECHNICAL_RISKS.md)
