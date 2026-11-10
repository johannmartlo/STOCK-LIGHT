# T-007 — Importar un CSV de Hispatec al stock: previsualizar y confirmar en lote

Carril: **C (importación)**, con permiso expreso para los archivos indicados de otros carriles. Rama: `ticket/T-007-importacion-lote`, creada desde `main` **después del merge de T-005**. Sensible: **sí** (escribe stock).
Especificación: 2026-10-23, **re-basada el 2026-11-05** sobre T-022, T-003, T-004, T-005 (catálogo), T-006 y T-006B. Decisiones D-002, D-004, D-006 (actualizada), D-007, D-008, D-009, D-010, D-016, D-022, D-023, D-024, D-025, D-027, D-029, D-031.

## Qué ha cambiado desde la versión de octubre
- **Ya existen:**
  - el lector `src/importacion/CsvHispatecParser.js` (`parsear(textoCsv)` → `{ tipo, lineas, errores }`, con líneas canónicas: `tipoDoc, serie, numero, linea, fecha, entidad, articulo, envase, cajas, unidades, kg, origenDato`);
  - el clasificador `src/importacion/ClasificadorLineas.js` (`clasificar`, `agruparEnDocumentos`, `resumenImportacion`).
- **El stock ya no se escribe con `processMovement` ni con `procesarSalidaDocumento`.** Desde T-022, toda escritura va por `MovementService`: `_cargarEstado` → `_aplicar` (por movimiento) → `_persistir` (un único punto de escritura). Hoy `registrarEntrada` y `registrarSalida` hacen ese ciclo **por documento**. Este ticket añade la versión **en lote**.
- **Seguimiento (D-029):** `esCombinacionSeguida` viene de `CatalogoService` (T-005). Una línea de tomate sin clasificación comercial **es SEGUIDA y se aplica**. PENDIENTE solo significa «no se sabe si se sigue» (cuarentena).
- **Abonos (D-031):** una línea con cajas ≤ 0 es un abono, **no mueve stock y no es error**.
- **Volumen (D-027):** hasta unas 100 líneas al día. El ensayo T-015 importará un mes.

## Reglas
1. **Clasificador** (`ClasificadorLineas.js`, carril C): nuevo estado `ABONO`.
   - Una línea con artículo y cajas numéricas **≤ 0** (entero o no) pasa a `ABONO`, después de las comprobaciones de serie, de datos que faltan y de `NO_SEGUIDA`. No crea movimientos y se cuenta en el resumen.
   - Las cajas no enteras **> 0** siguen siendo `ERROR_DATOS`.
   - `agruparEnDocumentos` y `resumenImportacion` incluyen `ABONO` en sus recuentos.
   - Se actualizan las aserciones de `t006b_clasificador.test.js` que esperaban `ERROR_DATOS` para cajas ≤ 0, listándolas en `aceptacion.md`.
2. **Servicio nuevo `src/importacion/ImportacionService.js`:**
   - `previsualizar(textoCsv)`: parsea, clasifica, cruza con DOCUMENTOS y **simula** la aplicación completa en memoria sobre el estado actual. **No escribe nada.** Devuelve:
     - el resumen de T-006B;
     - por documento, uno de estos estados: `NUEVO`, `YA_IMPORTADO`, `MODIFICADO_EN_ERP` (D-010), `STOCK_INSUFICIENTE` (simulado) o `SIN_LINEAS_APLICABLES`;
     - el `hash` del texto (SHA-256 en hexadecimal; `Utilities.computeDigest` en Apps Script y `crypto` en Node).
   - `confirmar(textoCsv, hashEsperado, usuario)`: el servidor vuelve a parsear el texto, comprueba el hash y aplica. **El cliente no envía líneas, solo el archivo.**
     - Si el hash no coincide, se rechaza.
     - Si ese hash ya está confirmado en IMPORTACIONES, no hace nada y lo dice.
3. **Identidad y cambios (D-010, D-023):**
   - un documento se identifica por tipo + serie + número;
   - DOCUMENTOS gana la columna `firma_lineas`, **añadida al final**: un hash de las líneas del documento **tal como vienen en el CSV** (línea, artículo y envase normalizados, cajas), ordenadas. No depende de la clasificación;
   - si el documento ya existe con la misma firma → `YA_IMPORTADO`, se salta. Con firma distinta → `MODIFICADO_EN_ERP`: no se aplica nada de ese documento y se informa.
4. **Aplicación en lote** en `MovementService.aplicarDocumentosEnLote(documentos, usuario, opciones)`. Es un método nuevo, con permiso expreso: **añádelo inmediatamente después de `registrarSalida`** y no toques otros métodos.
   - Un solo lock, un solo `_cargarEstado` y **un solo `_persistir`** por tramo.
   - Los documentos van en el orden D-007 (fecha; el mismo día, entradas antes que salidas; serie, número, línea), que ya da `agruparEnDocumentos`.
   - Cada línea `OK` se convierte en un movimiento ENTRADA o SALIDA y pasa por `_aplicar`, con:
     - `fecha_negocio` = fecha del albarán (D-008);
     - `entidad_nombre` = `entidad` (en compras, el proveedor de la capa, D-016);
     - `origen_dato = 'CSV'`;
     - `kg_informativo` = `kg` (D-025);
     - `id_documento_ref` = el id del documento creado con `nuevoId`.
   - **Un documento es todo o nada (D-009).** Si alguna línea de salida no tiene stock, se descarta todo lo aplicado de ese documento: hay que volver al estado anterior al documento con `clonarEstadoLibro`. El documento queda en `PENDIENTE_REVISION`, y sus líneas `OK` se guardan en PENDIENTES con el motivo `STOCK_INSUFICIENTE`.
   - Las líneas `PENDIENTE` (seguimiento desconocido) van a PENDIENTES con el motivo `SEGUIMIENTO_DESCONOCIDO` y no crean movimientos. Si un documento tiene líneas `OK` y `PENDIENTE`, se aplican las `OK` y el documento queda `CONFIRMADO_PARCIAL`.
   - `NO_SEGUIDA`, `ABONO`, `SERIE_IGNORADA`, `VACIA` y `ERROR_DATOS` no crean movimientos y se cuentan.
   - Después, la reconstrucción coincide con el estado en vivo (D-022).
5. **Hojas nuevas** en `SCHEMA_DEFINITIONS`, **añadidas inmediatamente después de `DOCUMENTOS`**:
   - `PENDIENTES`: `id_pendiente, id_importacion, tipo_doc, serie, numero, linea, fecha_negocio, entidad, articulo, envase, cajas, kg, motivo (SEGUIMIENTO_DESCONOCIDO|STOCK_INSUFICIENTE), estado (PENDIENTE|APLICADA|IGNORADA), fecha_alta, fecha_resolucion`;
   - `IMPORTACIONES`: `id_importacion, fecha_hora, usuario, tipo_csv, hash, documentos_nuevos, documentos_saltados, documentos_modificados, documentos_pendientes, lineas_ok, lineas_no_seguidas, lineas_abono, lineas_series_ignoradas, lineas_pendientes, lineas_error, estado (EN_CURSO|CONFIRMADA), ultimo_tramo`.

   La escritura de PENDIENTES, IMPORTACIONES y DOCUMENTOS va dentro del mismo lock que los movimientos, respetando el orden de `_persistir`. Si hace falta que `_persistir` acepte una lista de documentos, amplíalo **sin cambiar** su comportamiento actual y anótalo en «Dudas».
6. **Troceo y reanudación.** Si un archivo tiene más documentos aplicables que el umbral (`Config.js`, por defecto 150), se aplica por tramos de documentos completos, cada tramo con su lock y su escritura.
   - IMPORTACIONES guarda `ultimo_tramo` y el estado `EN_CURSO`.
   - Reintentar `confirmar` con el mismo archivo continúa desde el siguiente tramo, sin repetir documentos: los ya aplicados se reconocen como `YA_IMPORTADO` por su firma.
7. **API** en `src/Código.js`, **añadida inmediatamente después de `apiProcesarSalidaDocumento`** y clasificada en `docs/API_PUBLICA.md`:
   - `apiPrevisualizarImportacionCsv(textoCsv)`: LECTURA;
   - `apiConfirmarImportacionCsv(textoCsv, hash)`: ESCRITURA, con `usuarioActual_()`.

## Aceptación
1. **Prueba nueva (flujo completo):** con los fixtures de `test/fixtures/csv/` se confirma primero compras y luego ventas.
   - Las capas, el stock y CONSUMOS_FIFO son los esperados, calculados a mano en la prueba.
   - La capa de compra tiene `proveedor` = `NombreEmisor`, `fecha_capa` = fecha del albarán, `origen_dato = 'CSV'` y `kg_informativo`.
   - Las líneas `ACA` (serie ignorada) y las no seguidas no crean movimientos.
2. **Prueba nueva (repetir):** confirmar dos veces el mismo archivo no cambia nada la segunda vez, e informa de que ya estaba importado. Lo mismo con un archivo distinto que contiene los mismos documentos.
3. **Prueba nueva (modificado):** un albarán ya importado que llega con una línea de más, o con otras cajas, queda `MODIFICADO_EN_ERP` y no aplica nada de ese albarán. Los demás documentos del archivo sí se aplican.
4. **Prueba nueva (sin stock):** una venta cuya compra no se ha importado deja el albarán en `PENDIENTE_REVISION`, con sus líneas en PENDIENTES (`STOCK_INSUFICIENTE`), sin tocar capas, aunque una de sus líneas sí tuviera stock (todo o nada).
5. **Prueba nueva (D-029):**
   - una venta de un tomate sin clasificación comercial, con su compra en el mismo archivo, **se aplica**;
   - un artículo que no es tomate no crea movimientos (`NO_SEGUIDA`);
   - con un catálogo sin reglas de seguimiento, la línea va a PENDIENTES con `SEGUIMIENTO_DESCONOCIDO`.
6. **Prueba nueva (abonos, D-031):** una línea de venta con `NroEnvases` = 0 y otra con −5 quedan en `ABONO`, no mueven stock, no son error y aparecen en `lineas_abono`.
7. **Prueba nueva:** `previsualizar` no escribe en ninguna hoja, comprobado con un mock que falla si se escribe. Su resultado coincide con lo que después aplica `confirmar`.
8. **Prueba nueva:** `confirmar` con un hash distinto del del texto se rechaza sin escribir.
9. **Prueba nueva (rendimiento con mock):**
   - 300 documentos sintéticos se aplican con **una sola** lectura y **una sola** escritura por hoja y por tramo. La prueba cuenta las llamadas a `getValues`/`setValues`, o al método equivalente del mock;
   - con el umbral de 150 se aplican en 2 tramos.
10. **Prueba nueva (interrupción):** si la aplicación se interrumpe tras el primer tramo (excepción simulada) y se reintenta, el resultado es idéntico al de una aplicación sin interrupción, incluidos stock y CONSUMOS_FIFO.
11. **Prueba nueva (coherencia):** tras importar compras y ventas, `comprobarConsistencia()` da 0 diferencias y la suma de CONSUMOS_FIFO por capa es igual a `cajas_consumidas`.
12. `docs/API_PUBLICA.md` actualizado (prueba 7 de `t023_superficie.test.js` en verde). `DATA_MODEL.md` documenta PENDIENTES, IMPORTACIONES y `firma_lineas`. `node test/run_all.js` con 0 fallos, salida en `logs/T-007/tests.txt`.

## Archivos previstos
- `src/importacion/ImportacionService.js` (nuevo)
- `src/importacion/ClasificadorLineas.js` (regla 1)
- `test/t006b_clasificador.test.js` (solo las aserciones de la regla 1)
- `src/MovementService.js` (**solo** el método nuevo de la regla 4 y, si hace falta, la ampliación de `_persistir`; permiso expreso, carril A)
- `src/Repository.js` (hojas nuevas y `firma_lineas`; permiso expreso)
- `src/Código.js` y `docs/API_PUBLICA.md` (regla 7; permiso expreso)
- `src/Config.js` (umbral de troceo)
- `test/t007_importacion_lote.test.js` (nuevo)
- `test/fixtures/csv/*` (solo si hace falta añadir fixtures inventados)
- `DATA_MODEL.md`
- `docs/tickets/T-007-importacion-lote.md` (este ticket, primer commit, sin editar)
- `logs/T-007/*`

Si necesitas otro, para y pregunta. **No toques** `src/Libro.js`, `src/InventoryEngine.js`, `src/Catalogo.js` ni `src/CatalogoService.js`.
Trabajo en paralelo: el carril A (T-009) también añade cosas a `MovementService.js`, `Repository.js` y `Código.js`, pero en otros puntos. Respeta los puntos de inserción indicados.

**Coordinación con T-020 (acceso, carril B, en paralelo):** si al rebasar sobre `main` ya existe `exigirSesionApi_` (T-020 fusionado), toda `api*` nueva de este ticket empieza con `exigirSesionApi_();` y se añade a `PERMISOS_API` en `src/Seguridad.js` con su rol mínimo: LECTURA → CONSULTA, ESCRITURA → ENCARGADO. La prueba de cobertura de T-020 lo exige. Si T-020 aún no está fusionado, no hagas nada de esto.

## Fuera de alcance
- Reintentar pendientes, equivalencias de nombres y pendientes inteligentes (T-008, D-028, D-030).
- Pantallas (T-012).
- Maestro de Hispatec (T-010).
- Unidades del JAPI (T-017; hoy no se sigue).
- PDF y fotos (F-1).

## Parar y preguntar si
- Aplicar en lote obliga a cambiar `Libro.js` o el comportamiento de `registrarEntrada`/`registrarSalida`.
- El formato real de los fixtures no coincide con lo que espera el parser.
- Una prueba existente falla por un motivo que no entiendes.
- **Cualquier cambio no descrito en este ticket, aunque sea en un archivo previsto, se lista en «Dudas».**
