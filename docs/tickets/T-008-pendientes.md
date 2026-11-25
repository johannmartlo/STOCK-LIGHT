# T-008 — Pendientes: reintento automático y lista para revisar (versión recortada)

Rama: `ticket/T-008-pendientes`, creada desde `main` **después del merge de T-009**. Sensible: **sí** (escribe stock).
Especificación: 2026-10-23; **reescrita y recortada el 2026-11-25** (plan de cierre, D-028 aplazada, D-029, D-030). Se apoya en T-007 (PENDIENTES, IMPORTACIONES, `aplicarDocumentosEnLote`), T-009 (reproceso) y T-020 (acceso).

## Qué cambia respecto a la versión de octubre
- **Desaparece `SIN_ASOCIAR` y `asociarCombinacion`:** con el catálogo (D-029) no hay que asociar combinaciones a grupos. El motivo equivalente es `SEGUIMIENTO_DESCONOCIDO`, y se resuelve añadiendo una regla al catálogo.
- **Equivalencias de nombres (D-028): fuera**, quedan para después del arranque.
- **Nuevo:** el reintento también se lanza **después de cada reproceso** (D-030), porque las ventas de un producto reprocesado suelen llegar antes que el reproceso.
- **Nuevo:** los albaranes `MODIFICADO_EN_ERP` (T-007) aparecen en la lista de pendientes para que se vean. **No** se corrigen solos: se resuelven a mano con un ajuste visible (D-022).

## Lo que ya existe (verificado en main; no lo rehagas)
- Hoja PENDIENTES: `id_pendiente, id_importacion, tipo_doc, serie, numero, linea, fecha_negocio, entidad, articulo, envase, cajas, kg, motivo, estado, fecha_alta, fecha_resolucion` (T-007).
- `ImportacionService` y `MovementService.aplicarDocumentosEnLote(documentos, usuario, opciones)`: todo o nada por documento, un solo lock y un solo `_persistir` por tramo (T-007).
- Documentos en `PENDIENTE_REVISION` (sin stock) y `CONFIRMADO_PARCIAL` (con líneas `SEGUIMIENTO_DESCONOCIDO`).
- `CatalogoService.esCombinacionSeguida(articulo, envase)` (T-005).
- `MovementService.registrarReproceso` (T-009).
- Guarda de sesión `exigirSesionApi_()` y tabla `PERMISOS_API` (T-020).

## Reglas
1. **`reintentarPendientes(usuario, opciones)`**, en `src/importacion/PendientesService.js` (nuevo):
   1. Lee las filas de PENDIENTES con `estado = PENDIENTE`.
   2. **`STOCK_INSUFICIENTE`:** reconstruye cada documento a partir de sus filas (todas las líneas del mismo tipo + serie + número) y lo reintenta con `aplicarDocumentosEnLote`, en el orden D-007 (fecha; el mismo día, entradas antes que salidas; serie, número, línea). Si ahora hay stock, se aplica entero: sus filas pasan a `APLICADA` con `fecha_resolucion`, y el documento pasa a `CONFIRMADO`. Si sigue sin stock, no cambia nada.
   3. **`SEGUIMIENTO_DESCONOCIDO`:** vuelve a consultar `esCombinacionSeguida`. Si ahora es SEGUIDA, la línea se aplica (como en T-007). Si es NO_SEGUIDA, pasa a `IGNORADA`. Si sigue desconocida, no cambia nada. Cuando un documento `CONFIRMADO_PARCIAL` ya no tiene líneas pendientes, pasa a `CONFIRMADO`.
   4. Todo en **un solo lock** y con la misma escritura en lote de T-007. Una fila `APLICADA` o `IGNORADA` no se vuelve a procesar nunca.
   5. Devuelve `{ aplicados, ignorados, siguenPendientes }` con recuentos por motivo.
2. **Regla de consumo tardío:** un pendiente que se aplica tarde consume FIFO sobre las capas **tal como están en ese momento**. No se rehacen los consumos de salidas posteriores. Documéntalo en BUSINESS_RULES.md §5.
3. **Reintento automático**, sin que el usuario haga nada:
   - al final de `ImportacionService.confirmar` cuando se haya creado al menos una capa;
   - al final de `MovementService.registrarReproceso` cuando haya salido bien.

   Si el reintento falla, la operación original **no** se deshace: se registra el error en LOG_OPERACIONES y se devuelve un aviso.
4. **`MODIFICADO_EN_ERP`:** cuando `confirmar` detecta un documento modificado, añade una fila a PENDIENTES con `motivo = MODIFICADO_EN_ERP`, una línea por documento con `linea = ''` y `cajas` = la diferencia total de cajas (nuevo − importado), si no existe ya una fila PENDIENTE para ese documento. Nunca se aplica sola. Se marca como resuelta con `marcarPendienteResuelto(idPendiente, nota, usuario)`, que pasa el estado a `RESUELTA` y guarda la nota. No toca el stock.
5. **API** en `src/Código.js`, con `exigirSesionApi_()` y entrada en `PERMISOS_API`, clasificada en `docs/API_PUBLICA.md`:
   - `apiListarPendientes(filtros)`: LECTURA → CONSULTA. Agrupado por motivo y por documento, con cajas totales, fechas y entidad.
   - `apiReintentarPendientes()`: ESCRITURA → ENCARGADO.
   - `apiMarcarPendienteResuelto(idPendiente, nota)`: ESCRITURA → ENCARGADO.
6. Añade `RESUELTA` como estado válido de PENDIENTES en DATA_MODEL.md. **No cambies** las columnas de la hoja.

## Aceptación
1. **Prueba nueva (venta antes que la compra):** se importa una venta sin stock → `PENDIENTE_REVISION`. Se importa la compra → el reintento automático aplica la venta y el stock queda en compra − venta. CONSUMOS_FIFO apunta a la capa de la compra.
2. **Prueba nueva (venta de producto reprocesado):** venta de «ROSA 500» sin stock → pendiente. Se registra un reproceso que crea «ROSA 500» → la venta se aplica sola y consume la capa creada por el reproceso.
3. **Prueba nueva (todo o nada):** un documento con dos líneas, una con stock y otra sin él, no se aplica hasta que las dos tienen stock.
4. **Prueba nueva (seguimiento):** una línea `SEGUIMIENTO_DESCONOCIDO`; se añade al catálogo una regla que la hace SEGUIDA → al reintentar se aplica y el documento pasa de `CONFIRMADO_PARCIAL` a `CONFIRMADO`. Con una regla NO → `IGNORADA` sin movimientos.
5. **Prueba nueva (idempotencia):** reintentar dos veces seguidas no duplica movimientos ni consumos.
6. **Prueba nueva (modificado):** reimportar un albarán con otras cajas crea una fila `MODIFICADO_EN_ERP` con la diferencia, una sola aunque se reimporte varias veces. `apiMarcarPendienteResuelto` la deja en `RESUELTA` sin tocar el stock.
7. **Prueba nueva (fallo del reintento):** si el reintento lanza una excepción simulada, la importación o el reproceso que lo lanzó queda aplicado y se devuelve un aviso.
8. **Prueba nueva (coherencia):** tras cada escenario, `comprobarConsistencia().consistente === true` y la suma de CONSUMOS_FIFO por capa = `cajas_consumidas`.
9. La prueba de cobertura de `t020_acceso.test.js` sigue en verde con las API nuevas. `node test/run_all.js` con 0 fallos, salida en `logs/T-008/tests.txt`.

## Archivos previstos
- `src/importacion/PendientesService.js` (nuevo)
- `src/importacion/ImportacionService.js` (solo la llamada al reintento y la fila `MODIFICADO_EN_ERP`)
- `src/MovementService.js` (solo la llamada al reintento al final de `registrarReproceso`)
- `src/Código.js`, `src/Seguridad.js` (`PERMISOS_API`), `docs/API_PUBLICA.md`
- `BUSINESS_RULES.md` (§5), `DATA_MODEL.md`
- `test/t008_pendientes.test.js` (nuevo)
- `docs/tickets/T-008-pendientes.md` (este ticket, primer commit, sin editar)
- `logs/T-008/tests.txt`, `logs/T-008/informe.md`

Si necesitas otro, para y pregunta. **No toques** `src/Libro.js`, `src/InventoryEngine.js`, `src/Reproceso.js` ni `src/Catalogo*.js`.

## Entrega
Escribe en `logs/T-008/informe.md`:
- un resumen de 5 líneas;
- la salida de `git status` y de `git log --oneline -5`;
- **«Dudas»** con TODO cambio no pedido por el ticket.

## Fuera de alcance
- Equivalencias de nombres (D-028).
- Corrección automática de albaranes modificados en el ERP.
- Pantalla de pendientes (ticket de pantallas).
- Rehacer consumos de salidas ya aplicadas.

## Parar y preguntar si
- Aplicar un pendiente obligaría a modificar movimientos ya confirmados.
- El reintento dentro de `registrarReproceso` exigiera cambiar el motor o romper el lock único.
