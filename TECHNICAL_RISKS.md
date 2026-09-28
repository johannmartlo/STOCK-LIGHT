# TECHNICAL_RISKS.md — Análisis de Riesgos Técnicos y Mitigaciones

## 1. Matriz de Riesgos del Sistema

| ID | Riesgo Técnico / Operativo | Impacto | Probabilidad | Estrategia de Mitigación |
| :---: | :--- | :---: | :---: | :--- |
| **R-01** | **Timeout de 6 minutos en Apps Script** durante la subida masiva de 30-50 PDFs. | Alto | Alta | **Procesamiento fraccionado en lotes (Batching)** impulsado desde el frontend. La UI envía paquetes de 5 documentos por petición; nunca un único bucle monolítico. |
| **R-02** | **Límite de cuota de SpreadsheetApp** por llamadas celda a celda (*Rate Limiting*). | Alto | Media | **Lectura/Escritura masiva en memoria:** Cargar tablas completas con `getValues()`, computar en objetos JavaScript y volcar en una sola llamada atómica con `setValues()`. |
| **R-03** | **Condición de carrera (Race Condition)** al confirmar documentos o ajustes concurrentes. | Alto | Media | Uso estricto de `LockService.getScriptLock()` con timeout de espera de hasta 30 segundos en todas las transacciones de modificación de stock. |
| **R-04** | **Variabilidad en plantillas PDF de Hispatec** (cambios de tipografía, columnas o saltos de página). | Alto | Media | Arquitectura desacoplada de Parsers; validación estricta de estructura antes de aplicar movimientos; bandeja intermedia de revisión humana. |
| **R-05** | **Ambigüedad en Envases/Presentaciones** (un mismo envase nombrado como "EPS 104", "EPS-104" o "104"). | Medio | Alta | Diccionario de sinónimos/alias en la hoja `MAESTRO` y normalización previa a la asignación de claves de stock. |
| **R-06** | **Déficit de stock al registrar una salida** antes de haber importado el albarán de compra correspondiente. | Medio | Alta | **Prohibición de stock negativo silencioso:** El sistema bloquea el consumo automático y marca el albarán como `PENDIENTE_REVISION` hasta que se introduzca la entrada o el ajuste. |
| **R-07** | **Límites de tamaño en `google.script.run`** al transmitir múltiples archivos PDF codificados en Base64. | Medio | Media | Enviar los archivos binarios uno a uno directamente hacia Google Drive desde el cliente, pasando únicamente los metadatos y IDs de archivo a la cola de procesamiento. |
| **R-08** | **Tentación de sobreingeniería / Convertir STOCK-LIGHT en CCO o WMS.** | Alto | Media | Guardián arquitectónico: rechazar cualquier requerimiento que introduzca operarios, tablets, ubicaciones físicas, estados de preparación o cross-docking. |

---

## 2. Análisis Detallado de Cuotas y Restricciones de Google Workspace

### 2.1. Límite de Ejecución por Invocación
* **Restricción:** Google Apps Script limita cualquier ejecución síncrona a **6 minutos (360 segundos)** para cuentas estándar y Google Workspace.
* **Impacto en STOCK-LIGHT:** Parsear 40 PDFs mediante extracción de texto y comprobaciones de base de datos podría exceder fácilmente este umbral si se ejecuta en un único proceso lineal.
* **Solución Arquitectónica:**
  * La interfaz cliente HTML coordina el proceso mediante promesas asíncronas secuenciales.
  * Cada petición ejecuta un lote de $K$ documentos (típicamente $K = 5$), registrando el progreso y devolviendo el control al navegador.
  * Si un lote fallara o se interrumpiera por red, solo se reintenta ese subconjunto específico, sin perder el trabajo previo.

### 2.2. Rendimiento y Cuotas de Google Sheets
* **Restricción:** La API interna de `SpreadsheetApp` penaliza severamente el acceso celda a celda. Ejecutar `sheet.getRange(i, j).setValue(...)` 500 veces puede tomar más de 40 segundos y agotar cuotas diarias de tiempo de cálculo.
* **Solución Arquitectónica:**
  ```javascript
  // ANTIPATRÓN PROHIBIDO
  for (let i = 0; i < rows.length; i++) {
    sheet.getRange(i + 1, 1).setValue(rows[i].val); // LENTO Y RIESGOSO
  }

  // PATRÓN OBLIGATORIO EN STOCK-LIGHT
  const data = sheet.getDataRange().getValues(); // 1 sola llamada de lectura
  // ... procesamiento puro en memoria RAM con estructuras de datos nativas ...
  targetRange.setValues(updatedMatrix); // 1 sola llamada de escritura en bloque
  ```

### 2.3. Cuotas de Conversión OCR en Google Drive
* **Restricción:** La conversión de imagen a texto mediante la API avanzada de Drive está sujeta a límites diarios de cuotas y requiere mayor tiempo de procesamiento por documento (~4-8 segundos por página).
* **Solución Arquitectónica:**
  * STOCK-LIGHT implementa extracción nativa de streams de texto vectorial como primera opción.
  * Los documentos de Hispatec generados digitalmente son vectoriales en un 95% de los casos.
  * El OCR se mantiene como un recurso de último nivel únicamente para PDFs rasterizados.

---

## 3. Prevención de Deuda Técnica y Buenas Prácticas

1. **Desacoplamiento de Persistencia:**
   * La lógica de FIFO y de cálculo de saldos debe residir en funciones JavaScript puras (testables con Node.js o jest localmente si se desea), sin llamadas directas a `SpreadsheetApp` dentro de los algoritmos matemáticos.
2. **Cero Dependencia de Fórmulas en Hoja:**
   * Mantener las hojas de cálculo como meras tablas de almacenamiento. Ninguna celda dependerá de fórmulas que puedan romperse si un usuario filtra u ordena columnas manualmente en la web de Google Sheets.
3. **Control Estricto de Acceso Concurrente:**
   * Cualquier escritura que afecte a `CAPAS_FIFO` o `STOCK_ACTUAL` debe estar envuelta obligatoriamente en un bloque de adquisición y liberación segura de bloqueo:
   ```javascript
   const lock = LockService.getScriptLock();
   try {
     lock.waitLock(30000); // Espera máxima 30s
     // Ejecutar validación, FIFO y persistencia en lote
   } finally {
     lock.releaseLock();
   }
   ```
4. **Respeto a la Identidad del Producto:**
   * STOCK-LIGHT es una herramienta de existencias tácticas, no un sistema de trazabilidad de campo ni una aplicación de gestión de almacén (CCO). Mantener el alcance estrictamente acotado a la respuesta de:  
     *"¿Cuántas cajas deberían quedar de cada ARTÍCULO + ENVASE?"*
