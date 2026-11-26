# T-027 — Correcciones: aplicar la versión nueva de Hispatec, en cascada

Rama: `ticket/T-027-correcciones`, creada desde `main` = `5eea049` (T-025 incluido). Sensible: **MUCHO**. Reescribe la historia de stock por la vía del libro: solo añade anulaciones y movimientos nuevos, y **nunca borra ni edita** filas de MOVIMIENTOS.
Especificación: 2026-11-26. Decisiones del responsable (D-038):
- los errores se corrigen **en Hispatec** y se reimportan;
- la app aplica la versión nueva **en cascada**, aunque ya se haya vendido o cambiado de esas partidas;
- **sin límite de tiempo**;
- motivo obligatorio;
- vista previa antes de confirmar.

No hay corrección manual de albaranes dentro de la app: Hispatec es la fuente.

## Lo que ya existe (verificado en main; no lo rehagas)
- Libro de solo añadir (D-022): el estado se reconstruye reproduciendo MOVIMIENTOS por `secuencia`; anular = movimiento `ANULACION` con `id_movimiento_ref`.
- `MovementService.anularSalida` devuelve las cajas a las capas exactas que consumió. `anularReproceso` exige destinos intactos. `anularEntrada` **rechaza** (`ENTRADA_CON_CONSUMOS`) si la capa tiene consumos.
- `_cargarEstado` / `_aplicar` / `_persistir`, con un solo lock y una sola escritura, como los usa `PendientesService.reintentarPendientes` (T-008).
- `ImportacionService.confirmar` (T-007) detecta `MODIFICADO_EN_ERP` por `firma_lineas`. T-008 crea **una** fila PENDIENTES `MODIFICADO_EN_ERP` por documento, con la diferencia de cajas, y **descarta** las líneas nuevas.
- `PendientesService.marcarPendienteResuelto` (solo `MODIFICADO_EN_ERP`) y `reintentarPendientes`.
- `OperacionesService.previsualizarAnulacion` (T-025): ejecuta la operación real sobre un repositorio clonado en memoria. **Usa la misma técnica** para la vista previa.

## Reglas
1. **Guardar la versión nueva.** Cuando `confirmar` detecta un documento `MODIFICADO_EN_ERP`, guarda sus líneas nuevas (las mismas que T-007 aplicaría: tipo, serie, número, línea, fecha, entidad, artículo, envase, cajas, kg, seguimiento) y su `firma_lineas` en una hoja nueva `VERSIONES_DOCUMENTO`:
   - columnas: `id_version, id_pendiente, id_documento, firma_lineas, lineas_json, fecha_alta, estado (PENDIENTE|APLICADA|DESCARTADA), fecha_resolucion, usuario, motivo`;
   - si se reimporta otra vez con otra firma, la versión anterior PENDIENTE pasa a DESCARTADA, la nueva queda PENDIENTE y la fila de PENDIENTES se actualiza con la diferencia nueva (sigue habiendo una sola por documento).
2. **`CorreccionService.previsualizarVersion(idPendiente)`** (nuevo `src/CorreccionService.js`) devuelve, sin escribir nada:
   - `posible` y `motivo` si no lo es;
   - las líneas vieja → nueva (qué cambia);
   - `operaciones_rehechas`: las ventas, cambios y ajustes que se retiran y se vuelven a hacer;
   - `partidas_cambian`: antes y después por partida;
   - `ventas_a_pendientes`: las que se quedarían sin stock;
   - el efecto en cajas por variedad.

   Se calcula ejecutando la regla 3 sobre un repositorio clonado en memoria (técnica de T-025).
3. **`CorreccionService.aplicarVersion(idPendiente, motivo, usuario)`**: motivo obligatorio (mínimo 5 caracteres), **un solo lock y un solo `_persistir`**, todo o nada.
   - **Documento de SALIDA:**
     1. anula la versión vieja (las cajas vuelven a sus capas exactas);
     2. aplica la nueva por FIFO;
     3. si la nueva no tiene stock, sus líneas van a PENDIENTES `STOCK_INSUFICIENTE` (como en T-007).
   - **Documento de ENTRADA (cascada):**
     1. **Dependientes:** todas las operaciones confirmadas y no anuladas que consumieron de las capas de ese documento, **y transitivamente** las que consumieron de los destinos de esos cambios. Son salidas, reprocesos y ajustes negativos.
     2. **Deshacer** los dependientes en orden de `secuencia` **inverso**, con las anulaciones existentes. Después, anular la versión vieja de la entrada, que ya no tiene consumos.
     3. **Aplicar** la versión nueva: capas nuevas con la fecha y el proveedor del documento.
     4. **Rehacer** los dependientes en su orden **original**, como movimientos nuevos enlazados al original (`id_movimiento_ref` o una columna equivalente que ya exista; si no existe, para y pregunta):
        - **salidas:** mismo documento, líneas y cantidades, por FIFO; las que no entren van a PENDIENTES `STOCK_INSUFICIENTE`;
        - **reprocesos:** mismos destinos, cantidades y destrío. Un origen que apuntaba a una capa reemplazada pasa a la capa nueva de la **misma línea** del documento. Si la línea ya no existe o no tiene cajas suficientes, **toda** la corrección es `posible: false`;
        - **ajustes negativos:** igual que las salidas; si no entran, `posible: false`.
     5. Si hay más de **200** dependientes: `posible: false` con el motivo, para revisión manual.
   - **Al terminar:**
     - el documento queda con la `firma_lineas` nueva, de modo que reimportar el mismo CSV da `YA_IMPORTADO`;
     - la versión pasa a `APLICADA` y la fila `MODIFICADO_EN_ERP` a `RESUELTA`;
     - se escribe una línea en LOG_OPERACIONES con el motivo, el usuario y el resumen;
     - se lanza `reintentarPendientes`; si falla, avisa y no deshace.
4. **`CorreccionService.anularAjuste(idMovimiento, motivo, usuario)`** anula un ajuste o destrío (positivo o negativo) con un movimiento `ANULACION`:
   - un ajuste **negativo** devuelve las cajas a sus capas exactas, como `anularSalida`;
   - un ajuste **positivo** se rechaza si su capa tiene consumos, salvo que lo resuelva la misma cascada. En v1, **rechaza** con motivo claro.

   Tiene vista previa con la misma técnica.
5. **API** (`src/Código.js`, `PERMISOS_API`, `docs/API_PUBLICA.md`):
   - `apiListarVersionesPendientes()`: LECTURA, CONSULTA;
   - `apiPrevisualizarVersion(idPendiente)`: LECTURA, ENCARGADO;
   - `apiAplicarVersion(idPendiente, motivo)`: ESCRITURA, ENCARGADO;
   - `apiPrevisualizarAnularAjuste(idMovimiento)`: LECTURA, ENCARGADO;
   - `apiAnularAjuste(idMovimiento, motivo)`: ESCRITURA, ENCARGADO.
6. **`BUSINESS_RULES.md`:** nueva sección «Correcciones desde Hispatec» con la regla 3 en lenguaje llano y el ejemplo de la finca mal identificada.

## Aceptación
1. **Prueba nueva (salida):** una venta de 30 cajas se corrige a 20 en Hispatec. Tras aplicar, el stock sube 10, las cajas vuelven a sus capas exactas y reimportar el CSV da `YA_IMPORTADO`.
2. **Prueba nueva (entrada sin consumos):** una compra de finca A pasa a finca B. La partida queda con el proveedor nuevo y la misma fecha.
3. **Prueba nueva (cascada, el caso del responsable):** compra de 100 Moresco G de la finca A, venta de 30, cambio de 20 a Rosa 500 y venta de 10 de ese Rosa 500. En Hispatec, la compra pasa a ser de la finca B. Tras aplicar:
   - el total de cajas es el mismo;
   - las ventas y el cambio salen de la partida de la finca B;
   - el Rosa 500 «viene de» la partida nueva;
   - no hay ninguna caja duplicada ni perdida.
4. **Prueba nueva (a pendientes):** la compra corregida trae menos cajas de las ya vendidas. Las ventas que no caben van a PENDIENTES `STOCK_INSUFICIENTE` y el resto sigue aplicado.
5. **Prueba nueva (imposible):** un cambio dependiente cuya línea de origen desaparece en la versión nueva → `posible: false` y nada cambia (instantánea antes = después).
6. **Prueba nueva (vista previa = real), con semillas:** 30 escenarios aleatorios con compras, ventas, cambios, ajustes y anulaciones; después, versiones nuevas aleatorias de compras y ventas (cambiar cajas, artículo, envase o proveedor, y añadir o quitar líneas). Para cada corrección:
   - la vista previa no escribe nada;
   - su `posible` coincide con el resultado real;
   - `partidas_cambian` y `ventas_a_pendientes` son exactamente lo que ocurre;
   - después de cada corrección: `comprobarConsistencia().consistente === true`, la suma de CONSUMOS_FIFO por capa = `cajas_consumidas`, ninguna capa es negativa, y el **stock total = entradas − salidas aplicadas ± cambios ± ajustes**, recalculado desde cero a partir de lo que dice cada documento en su versión vigente.
7. **Prueba nueva:** reimportar dos veces un albarán modificado deja una sola versión PENDIENTE (la última) y una sola fila `MODIFICADO_EN_ERP`.
8. **Prueba nueva:** `anularAjuste` de un destrío devuelve las cajas a sus capas; el de un ajuste positivo con consumos se rechaza sin cambiar nada.
9. **Prueba nueva (rendimiento):** con 5.000 movimientos y 50 dependientes, aplicar la corrección tarda menos de 10 s en Node.
10. Las API nuevas se rechazan sin sesión y con un rol menor; la cobertura de `t020_acceso.test.js` sigue en verde.
11. `node test/run_all.js` con 0 fallos, salida en `logs/T-027/tests.txt`.

## Archivos previstos
- `src/CorreccionService.js` (nuevo)
- `src/importacion/ImportacionService.js` (**solo** guardar la versión nueva al detectar `MODIFICADO_EN_ERP`)
- `src/importacion/PendientesService.js` (**solo** si hace falta actualizar la fila `MODIFICADO_EN_ERP`)
- `src/Repository.js` (**solo** la hoja `VERSIONES_DOCUMENTO`)
- `src/Código.js`, `src/Seguridad.js`, `docs/API_PUBLICA.md`, `BUSINESS_RULES.md`, `DATA_MODEL.md`
- `test/t027_correcciones.test.js` (nuevo)
- `docs/tickets/T-027-correcciones-hispatec.md` (este ticket, primer commit, sin editar)
- `logs/T-027/tests.txt`, `logs/T-027/informe.md`

**No toques** `src/Libro.js`, `src/InventoryEngine.js`, `src/Reproceso.js` ni la interfaz (`src/Index.html`, `src/ui/`, `src/InicioService.js`: los está corrigiendo otro agente). En `src/MovementService.js` **solo puedes añadir** métodos nuevos si hacen falta (por ejemplo, un `_aplicarSinLock` interno); **no cambies ningún método existente**. Lista cada método añadido en «Dudas». Si necesitas otro archivo, para y pregunta.

## Fuera de alcance
- Pantallas (van en P-2/P-3: «Aplicar la versión nueva» en Pendientes y «Anular» en Movimientos).
- Corrección manual de albaranes en la app.
- Correcciones de documentos de stock inicial (se restaura la copia).

## Parar y preguntar si
- La cascada exigiera cambiar `Libro.js`, el motor o un método existente de `MovementService`.
- No hubiera forma de enlazar el movimiento rehecho con el original.

## Entrega
Escribe en `logs/T-027/informe.md`:
- un resumen de 5 líneas;
- la salida de `git status` y de `git log --oneline -5`;
- **«Dudas»** con TODO cambio no pedido por el ticket y todo método añadido a `MovementService`.
