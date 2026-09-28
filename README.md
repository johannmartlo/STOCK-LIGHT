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

* **Workspace local exclusivo:** `C:\Users\juanalberto\Desktop\ALMACEN\STOCK`  
  *(Raíz única del proyecto. No se accede ni modifican directorios hermanos como CCO).*
* **Fuente de Verdad del Código (VCS):**  
  GitHub: [https://github.com/johannmartlo/STOCK-LIGHT](https://github.com/johannmartlo/STOCK-LIGHT)
* **Proyecto Google Apps Script Independiente:**  
  ID: `1CORuYQvroAC8ifn0D-P-GbcceQN4mm6EnISVQHy5ID8zyfF20j7jydfg`  
  Editor: [Google Apps Script Editor](https://script.google.com/home/projects/1CORuYQvroAC8ifn0D-P-GbcceQN4mm6EnISVQHy5ID8zyfF20j7jydfg/edit)

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
STOCK/
├── .clasp.json          # Configuración de Clasp hacia el script ID oficial
├── .claspignore         # Filtro de subida a Apps Script
├── .gitignore           # Exclusiones de control de versiones
├── README.md            # Documento principal de inducción y alcance
├── ARCHITECTURE.md      # Diseño arquitectónico y desacoplamiento
├── BUSINESS_RULES.md    # Reglas de inventario, FIFO, unidad de stock y deduplicación
├── DATA_MODEL.md        # Esquema de tablas y persistencia en Google Sheets
├── IMPORT_SPECS.md      # Especificaciones de extracción documental e Hispatec
├── TECHNICAL_RISKS.md   # Análisis de cuotas, límites de GAS y mitigaciones
└── src/                 # Código fuente Apps Script sincronizado por Clasp
    ├── appsscript.json  # Manifiesto oficial del proyecto Apps Script
    └── Código.js        # Punto de entrada / API interna
```

---

## 5. Ciclo de Trabajo con Git y Clasp

El flujo de trabajo es unidireccional y seguro:

```text
GitHub (origin/main)
   ↓ (git pull)
Repositorio Local (C:\Users\juanalberto\Desktop\ALMACEN\STOCK)
   ↓
Desarrollo & Pruebas Locales
   ↓
Sincronización a Apps Script (`clasp push`)
   ↓
Verificación en entorno Google
   ↓
Git Commit & Git Push a GitHub
```

### Comandos de Utilidad

```powershell
# Comprobar estado de Git
git status

# Subir cambios al repositorio Apps Script
clasp push

# Descargar cambios desde Apps Script (en caso de ediciones en web)
clasp pull
```

---

## 6. Documentación del Sistema

Para consultar las especificaciones técnicas completas, remitirse a:
* [ARCHITECTURE.md](file:///C:/Users/juanalberto/Desktop/ALMACEN/STOCK/ARCHITECTURE.md)
* [BUSINESS_RULES.md](file:///C:/Users/juanalberto/Desktop/ALMACEN/STOCK/BUSINESS_RULES.md)
* [DATA_MODEL.md](file:///C:/Users/juanalberto/Desktop/ALMACEN/STOCK/DATA_MODEL.md)
* [IMPORT_SPECS.md](file:///C:/Users/juanalberto/Desktop/ALMACEN/STOCK/IMPORT_SPECS.md)
* [TECHNICAL_RISKS.md](file:///C:/Users/juanalberto/Desktop/ALMACEN/STOCK/TECHNICAL_RISKS.md)
