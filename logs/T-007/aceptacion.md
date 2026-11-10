# T-007 — Aceptación

Rama: `ticket/T-007-importacion-lote` (creada desde `main` 1443dcc).
Fecha: 2026-11-10.
Comando único: `node test/run_all.js` → **27 suites, 294 pruebas, 0 fallos** (salida completa en `logs/T-007/tests.txt`).
Suite nueva: `test/t007_importacion_lote.test.js` → **13 pruebas, 0 fallos**.

## Puntos de aceptación

1. **Flujo completo con los fixtures de `test/fixtures/csv/`** — `t007_importacion_lote.test.js`, prueba 1.
   - Se confirman primero `compras_t007.csv` y después `ventas_t007.csv` con el mismo servicio.
   - Capas esperadas calculadas a mano: 10 cajas (02/11), 8 cajas (03/11) y 5 cajas (04/11); tras las ventas quedan 10/10/0, 8/8/0 y 5/0/5.
   - Stock final `TOMATE FICTICIO|CAJA FICTICIA` = 5.
   - CONSUMOS_FIFO: 3 filas con 10, 2 y 6 cajas (total 18).
   - La capa de compra guarda `proveedor = NombreEmisor`, `fecha_capa` = fecha del albarán, `origen_dato = 'CSV'` y el `kg_informativo` del movimiento.
   - La línea `ACA` del fixture nuevo (artículo presente, 99 cajas) queda `SERIE_IGNORADA`; el artículo no seguido queda `NO_SEGUIDA`. Ninguna crea movimientos ni documento.

2. **Repetir la misma importación** — prueba 2.
   - La segunda confirmación del mismo texto devuelve `status = 'YA_IMPORTADO'` y no cambia movimientos, documentos, importaciones, capas, stock ni consumos.
   - Un archivo distinto con las mismas líneas en otro orden tiene otro hash, pero sus documentos aplicables se reconocen por `firma_lineas` como `YA_IMPORTADO`; no se duplica nada y se crea una fila nueva en IMPORTACIONES.

3. **Albarán modificado** — prueba 3.
   - Se importa `ACT27/100`. Después llega con cajas distintas y con una línea de más: en ambos casos queda `MODIFICADO_EN_ERP` y no se aplica nada de ese albarán.
   - Los documentos nuevos del mismo archivo (`ACT27/106` y `ACT27/107`) sí se aplican; el stock y las capas de `ACT27/100` no cambian.

4. **Salida sin stock (todo o nada)** — prueba 4.
   - Se importa una compra de 10 cajas. Una venta con dos líneas (una con stock y otra sin compra) queda `STOCK_INSUFICIENTE` y el documento `PENDIENTE_REVISION`.
   - Sus dos líneas OK van a PENDIENTES con motivo `STOCK_INSUFICIENTE`; no hay movimientos de la venta, no se crea capa ni consumo y el stock sigue en 10.

5. **D-029** — prueba 5.
   - Con un catálogo que solo define `SEGUIMIENTO = SI` para tomate y sin agrupaciones comerciales, la compra y la venta de tomate se aplican (stock 6 y 2 movimientos).
   - Un artículo no tomate da `NO_SEGUIDA` y no crea movimientos (`lineas_no_seguidas = 1`).
   - Con un catálogo sin reglas de seguimiento, la línea queda `PENDIENTE` y va a PENDIENTES con `SEGUIMIENTO_DESCONOCIDO`; el documento queda `PENDIENTE_REVISION` y no hay movimientos.
   - Nota: el parser detecta un único tipo de CSV por archivo (compras o ventas), así que «compra en el mismo archivo» se ha verificado como compra y venta confirmadas en el mismo flujo de importación (dos CSV), igual que pide la aceptación 1.

6. **Abonos (D-031)** — prueba 6.
   - `clasificar` devuelve `ABONO` para cajas 0 y −5; 12,5 cajas siguen siendo `ERROR_DATOS`; 5 cajas siguen siendo `OK`.
   - `agruparEnDocumentos` y `resumenImportacion` cuentan `ABONO`.
   - La confirmación de una venta con esas dos líneas no crea movimientos ni pendientes, no cambia el stock y guarda `lineas_abono = 2` y `lineas_error = 0` en IMPORTACIONES.
   - **t006b:** en esta rama ninguna aserción de `test/t006b_clasificador.test.js` esperaba `ERROR_DATOS` para cajas ≤ 0 (los casos del fixture son 12,5 y una línea sintética de 12,5, ambas > 0). No se modificó ninguna aserción; la suite sigue en verde.

7. **`previsualizar` no escribe y coincide con `confirmar`** — prueba 7.
   - Con todas las hojas blindadas, `previsualizar` hace 0 intentos de escritura y deja MOVIMIENTOS, DOCUMENTOS, CAPAS_FIFO y CONSUMOS_FIFO vacíos.
   - Después se desbloquea y se confirma el mismo texto: los estados por documento, el `resumen.porEstado` y el `stockSimulado` coinciden con lo aplicado.

8. **Hash distinto** — prueba 8.
   - `confirmar(texto, '0'.repeat(64), usuario)` devuelve `success = false`, `status = 'HASH_NO_COINCIDE'` y 0 escrituras (hojas blindadas); no crea movimientos, documentos ni importaciones.

9. **Rendimiento con mock y troceo** — prueba 9.
   - 300 documentos sintéticos con umbral 150 se aplican en 2 tramos (`ultimo_tramo = 2`, 300 movimientos, 300 documentos, stock 300).
   - Contando `getValues`/`setValues` por hoja: MOVIMIENTOS 2 lecturas y 2 escrituras (una por tramo); DOCUMENTOS, CAPAS_FIFO, STOCK_ACTUAL e IMPORTACIONES no superan 2 lecturas ni 2 escrituras. El umbral de `Config.js` es 150.

10. **Interrupción y reintento** — prueba 10.
    - Se importa una compra y un archivo de 4 ventas con umbral 2. Se simula una excepción en la segunda llamada a `aplicarDocumentosEnLote`: el primer tramo queda guardado y la fila de IMPORTACIONES queda `EN_CURSO` con `ultimo_tramo = 1`.
    - Al reintentar con el mismo texto y hash se aplican solo las ventas restantes (las primeras se reconocen por firma). Stock, CAPAS_FIFO y CONSUMOS_FIFO coinciden exactamente con la ejecución sin interrupción y `comprobarConsistencia()` da 0 diferencias.

11. **Coherencia** — prueba 11.
    - Tras importar compras y ventas, `comprobarConsistencia()` devuelve `consistente = true` y `totalDiferencias = 0`.
    - La suma de CONSUMOS_FIFO por capa coincide con `cajas_consumidas` de cada capa (total 18 cajas).

12. **Documentación y ejecutor** — prueba 13 y `docs/API_PUBLICA.md`.
    - `apiPrevisualizarImportacionCsv` y `apiConfirmarImportacionCsv` están expuestas en `src/Código.js` y clasificadas (LECTURA / ESCRITURA) en `docs/API_PUBLICA.md`; la prueba 7 de `t023_superficie.test.js` sigue en verde.
    - `DATA_MODEL.md` documenta `DOCUMENTOS.firma_lineas`, `PENDIENTES` e `IMPORTACIONES`.
    - `node test/run_all.js` termina con 0 fallos; la salida completa está en `logs/T-007/tests.txt`.

## Cambios no pedidos por el ticket (van también en «Dudas» del resumen)

- `Repository.appendMovimientos` acepta un segundo parámetro opcional con los movimientos ya cargados, para no releer MOVIMIENTOS dentro del tramo (aceptación 9). Sin el parámetro se comporta igual que antes.
- `MovementService._persistir` acepta `movimientosExistentes`, `pendientes` e `importaciones`; si `documentos.append` es un array, lo escribe en un solo `appendRecords` en vez de una llamada por documento. El resultado es el mismo y el ticket permitía ampliar `_persistir` para listas de documentos.
- `Repository` añade `getPendientes`, `appendPendientes`, `savePendientes`, `getImportaciones`, `appendImportaciones` y `saveImportaciones` (necesarios para las hojas nuevas de la regla 5).
- `ImportacionService` devuelve campos adicionales (`stockSimulado`, `totales`, `conteos`, `idImportacion`) además del mínimo pedido.
- Un documento preexistente con `firma_lineas` vacía se considera `YA_IMPORTADO` (no hay firma antigua con la que comparar); se documenta como interpretación.
- Un documento con solo líneas `PENDIENTE` se registra en DOCUMENTOS como `PENDIENTE_REVISION`; el ticket solo fija ese estado expresamente para stock insuficiente.
- Las APIs nuevas aceptan un parámetro `options` final para inyectar repositorio/servicios en pruebas, como el resto de `api*` existentes; la firma pública pedida (`textoCsv`, `hash`) sigue siendo la de uso normal.
- Se añaden dos fixtures inventados: `test/fixtures/csv/compras_t007.csv` y `ventas_t007.csv` (el ticket permite añadir fixtures si hacen falta).
- El umbral se expone como `UMBRAL_DOCUMENTOS_POR_TRAMO` en `src/Config.js` (el ticket no fijaba el nombre).
