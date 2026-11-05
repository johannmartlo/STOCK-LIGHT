# API pública de STOCK-LIGHT

Inventario de todas las funciones globales de `src/`. Lo exige T-023: en Google Apps Script
cualquier función global cuyo nombre **no** termine en `_` se puede invocar desde el navegador
con `google.script.run`, aunque la interfaz no la use. Este documento fija qué hace cada una y
qué nivel de acceso tiene.

## Clasificación

| Clasificación | Significado |
| :--- | :--- |
| **LECTURA** | La app puede llamarla. No modifica stock, configuración ni hojas. |
| **ESCRITURA** | La app puede llamarla. Escribe datos; la auditoría usa siempre `usuarioActual_()` y **nunca** el usuario que envía el navegador. |
| **ADMIN** | Reservada al propietario del script. Empieza con `exigirPropietario_()`, que lanza `Operación reservada al administrador` si el usuario activo no coincide con el efectivo o no se identifica. Se ejecuta desde el editor de Apps Script, no desde la web app. |
| **INTERNA** | Función auxiliar pura o de infraestructura. Queda expuesta por la plataforma, pero no toca stock ni configuración y no la usa la interfaz. |

Las funciones de `src/Seguridad.js` (`exigirPropietario_`, `usuarioActual_`, `_emailSesion_`) y
cualquier otra función terminada en `_` **no** aparecen aquí porque Apps Script no las expone.

## Funciones globales

| Función | Archivo | Clasificación | Notas |
| :--- | :--- | :--- | :--- |
| `initDatabase` | `src/Código.js` | ADMIN | Aprovisiona las hojas maestras. |
| `ejecutarReconstruccionStock` | `src/Código.js` | ADMIN | Reconstruye derivados desde MOVIMIENTOS. |
| `registrarAjusteManual` | `src/Código.js` | ADMIN | Ajuste manual ejecutado desde el editor. |
| `testNucleoAppsScript` | `src/Código.js` | ADMIN | Autodiagnóstico del núcleo. |
| `revisarDocumentoHispatec` | `src/Código.js` | LECTURA | Analiza un documento sin mutar inventario. |
| `confirmarDocumentoRevisado` | `src/Código.js` | ESCRITURA | Confirma un documento canónico; usuario del servidor. |
| `configurarSpreadsheetId` | `src/Código.js` | ADMIN | Cambia la hoja de trabajo del sistema. |
| `configurarDriveFolderId` | `src/Código.js` | ADMIN | Cambia la carpeta de Drive del sistema. |
| `apiObtenerStockActual` | `src/Código.js` | LECTURA | Stock actual completo. |
| `apiObtenerResumenPorGrupos` | `src/Código.js` | LECTURA | Resumen agregado por grupo de envase. |
| `apiObtenerStockPorGrupo` | `src/Código.js` | LECTURA | Existencias filtradas por grupo. |
| `apiObtenerDetalleGrupo` | `src/Código.js` | LECTURA | Detalle desglosado de un grupo. |
| `apiObtenerDetalleStock` | `src/Código.js` | LECTURA | Saldo de un par artículo + envase. |
| `confirmarCompraPendiente` | `src/Código.js` | ESCRITURA | Confirma una compra pendiente; usuario del servidor. |
| `apiIngestarMatrizArticuloEnvase` | `src/Código.js` | ADMIN | Ingesta la matriz artículo-envase en MAESTRO. |
| `apiCambiarEnvasePredeterminado` | `src/Código.js` | ADMIN | Cambia el envase predeterminado de un artículo. |
| `apiObtenerStockVisualResumen` | `src/Código.js` | LECTURA | Resumen visual para las tarjetas del panel. |
| `apiObtenerStockVisualDetalle` | `src/Código.js` | LECTURA | Detalle visual por grupo comercial. |
| `apiClasificarArticuloEnvase` | `src/Código.js` | LECTURA | Clasificación comercial de una combinación. |
| `apiCargarCatalogoHistorico` | `src/Código.js` | ADMIN | Carga un catálogo histórico de combinaciones. |
| `apiObtenerCombinacionesPendientesAsociacion` | `src/Código.js` | LECTURA | Combinaciones pendientes de asociar. |
| `apiObtenerDetallePartidas` | `src/Código.js` | LECTURA | Capas FIFO vivas de una combinación. |
| `apiRegistrarAjustePositivo` | `src/Código.js` | ESCRITURA | Ajuste positivo; usuario del servidor. |
| `apiRegistrarAjusteNegativo` | `src/Código.js` | ESCRITURA | Ajuste negativo; usuario del servidor. |
| `apiRegistrarReclasificacion` | `src/Código.js` | ESCRITURA | Reclasificación entre formatos; usuario del servidor. |
| `apiGetGruposComerciales` | `src/Código.js` | LECTURA | Grupos comerciales configurados. |
| `apiUpsertGrupoComercial` | `src/Código.js` | ESCRITURA | Inserta o actualiza un grupo comercial. |
| `apiGetMatrizArticuloEnvase` | `src/Código.js` | LECTURA | Asociaciones de la matriz artículo + envase. |
| `apiUpsertMatrizArticuloEnvase` | `src/Código.js` | ESCRITURA | Inserta o actualiza una asociación de la matriz. |
| `_resolveOperationalSafetyService` | `src/Código.js` | INTERNA | Resuelve el servicio de seguridad operativa. |
| `apiValidarDocumento` | `src/Código.js` | LECTURA | Valida un documento sin mutar datos. |
| `apiPrevisualizarDocumento` | `src/Código.js` | LECTURA | Previsualización con semáforo. |
| `apiProcesarEntradaDocumento` | `src/Código.js` | ESCRITURA | Procesa una entrada; usuario del servidor. |
| `apiProcesarSalidaDocumento` | `src/Código.js` | ESCRITURA | Procesa una salida; usuario del servidor. |
| `apiConciliarStock` | `src/Código.js` | ADMIN | Compara contra un inventario externo sin alterar existencias. |
| `apiEjecutarAjusteOperativo` | `src/Código.js` | ESCRITURA | Ajuste o reclasificación unificada; usuario del servidor. |
| `apiObtenerLogOperaciones` | `src/Código.js` | LECTURA | Log de trazabilidad operativa. |
| `apiPrevisualizarCorreccionHistorica` | `src/Código.js` | LECTURA | Previsualiza una corrección histórica. |
| `apiEjecutarCorreccionHistorica` | `src/Código.js` | ESCRITURA | Ejecuta una corrección histórica; usuario del servidor. |
| `apiAnularEntrada` | `src/Código.js` | ESCRITURA | Anula una entrada; usuario del servidor. |
| `apiAnularSalida` | `src/Código.js` | ESCRITURA | Anula una salida; usuario del servidor. |
| `apiCorregirEntrada` | `src/Código.js` | ESCRITURA | Corrige una entrada; usuario del servidor. |
| `apiCorregirSalida` | `src/Código.js` | ESCRITURA | Corrige una salida; usuario del servidor. |
| `apiDividirEntrada` | `src/Código.js` | ESCRITURA | Divide una entrada; usuario del servidor. |
| `doGet` | `src/Código.js` | LECTURA | Punto de entrada HTTP que sirve la interfaz. |
| `apiConfirmarDocumentoRevisado` | `src/Código.js` | ESCRITURA | Confirma un documento revisado; usuario del servidor. |
| `apiGetMaestroArticulos` | `src/Código.js` | LECTURA | Catálogo maestro de artículos. |
| `apiGetMaestroEnvases` | `src/Código.js` | LECTURA | Catálogo maestro de envases. |
| `apiSubirYAnalizarPdf` | `src/Código.js` | LECTURA | Analiza un PDF sin mutar stock. |
| `apiEjecutarPruebaAisladaInicializacion` | `src/Código.js` | ADMIN | Prueba aislada de inicialización en la hoja autorizada. |
| `getSpreadsheetIdConfig` | `src/Config.js` | INTERNA | Lee el SPREADSHEET_ID configurado. |
| `setSpreadsheetIdConfig` | `src/Config.js` | ADMIN | Persiste el SPREADSHEET_ID. |
| `getDriveFolderIdConfig` | `src/Config.js` | INTERNA | Lee el DRIVE_FOLDER_ID configurado. |
| `setDriveFolderIdConfig` | `src/Config.js` | ADMIN | Persiste el DRIVE_FOLDER_ID. |
| `resolveDatabaseSpreadsheet` | `src/Config.js` | INTERNA | Resuelve la hoja de cálculo de trabajo. |
| `normalizeCommercialText` | `src/CommercialGroupResolver.js` | INTERNA | Normaliza texto comercial. |
| `parseRawGroupName` | `src/CommercialGroupResolver.js` | INTERNA | Parsea el nombre crudo de un grupo. |
| `extraerCalibreYCategoria` | `src/CommercialGroupResolver.js` | INTERNA | Extrae calibre y categoría de un artículo. |
| `normalizeDocKey` | `src/DeduplicationService.js` | INTERNA | Normaliza la clave de un documento. |
| `buildDocumentIdentityKey` | `src/DeduplicationService.js` | INTERNA | Construye la identidad tipo + serie + número. |
| `buildLineIdentityKey` | `src/DeduplicationService.js` | INTERNA | Construye la identidad de una línea. |
| `checkDocumentDuplicate` | `src/DeduplicationService.js` | INTERNA | Detecta documentos duplicados. |
| `filterBatchForOverlaps` | `src/DeduplicationService.js` | INTERNA | Filtra solapamientos de un lote. |
| `extractPdfVectorialStreams` | `src/DriveService.js` | INTERNA | Extrae texto vectorial de un PDF. |
| `extractViaDriveDocsOcr` | `src/DriveService.js` | INTERNA | OCR temporal con Drive/Docs; no toca stock. |
| `normalizeHeaderName` | `src/ImportSchema.js` | INTERNA | Normaliza un encabezado CSV. |
| `resolveHeaderMapping` | `src/ImportSchema.js` | INTERNA | Resuelve encabezados contra un esquema. |
| `parseCSV` | `src/ImportSchema.js` | INTERNA | Parsea texto CSV. |
| `buildStockKey` | `src/InventoryEngine.js` | INTERNA | Construye la clave artículo + envase. |
| `validateMovementInput` | `src/InventoryEngine.js` | INTERNA | Valida la entrada de un movimiento. |
| `sortFifoLayers` | `src/InventoryEngine.js` | INTERNA | Ordena capas por FIFO. |
| `calculateAvailableStock` | `src/InventoryEngine.js` | INTERNA | Calcula el stock disponible. |
| `processMovement` | `src/InventoryEngine.js` | INTERNA | Cálculo puro de un movimiento. |
| `rebuildStockFromMovements` | `src/InventoryEngine.js` | INTERNA | Reconstrucción pura desde MOVIMIENTOS. |
| `createNormalizedLine` | `src/NormalizedDocument.js` | INTERNA | Crea una línea canónica. |
| `createNormalizedDocument` | `src/NormalizedDocument.js` | INTERNA | Crea un documento canónico. |
| `_getResolveHeaderMappingAE` | `src/ArticuloEnvaseValidator.js` | INTERNA | Resuelve la dependencia de mapeo de encabezados. |
| `_getParseCSVAE` | `src/ArticuloEnvaseValidator.js` | INTERNA | Resuelve la dependencia de parseo CSV. |
| `_getArticuloEnvaseHeaderSynonyms` | `src/ArticuloEnvaseValidator.js` | INTERNA | Sinónimos de encabezados artículo-envase. |
| `_getArticuloEnvaseSchemaSpec` | `src/ArticuloEnvaseValidator.js` | INTERNA | Esquema artículo-envase. |
| `_getDiagnosticCodesAE` | `src/ArticuloEnvaseValidator.js` | INTERNA | Códigos de diagnóstico. |
| `_getDiagnosticReportClassAE` | `src/ArticuloEnvaseValidator.js` | INTERNA | Clase de informe de diagnóstico. |
| `_getResolveHeaderMappingME` | `src/MaestroEnvasesValidator.js` | INTERNA | Resuelve la dependencia de mapeo de encabezados. |
| `_getParseCSVME` | `src/MaestroEnvasesValidator.js` | INTERNA | Resuelve la dependencia de parseo CSV. |
| `_getEnvasesHeaderSynonyms` | `src/MaestroEnvasesValidator.js` | INTERNA | Sinónimos de encabezados de envases. |
| `_getEnvasesSchemaSpec` | `src/MaestroEnvasesValidator.js` | INTERNA | Esquema de envases. |
| `_getDiagnosticCodesME` | `src/MaestroEnvasesValidator.js` | INTERNA | Códigos de diagnóstico. |
| `_getDiagnosticReportClassME` | `src/MaestroEnvasesValidator.js` | INTERNA | Clase de informe de diagnóstico. |
