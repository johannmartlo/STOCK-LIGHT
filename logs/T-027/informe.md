# T-027 — Informe de entrega

1. **Rama:** `ticket/T-027-correcciones`, creada desde `main` = `5eea049` y rebasada sobre `main` = `c1cbdbe`; commits `2786386` (ticket sin editar), `e8abf07`, `a97659e` y `3edd6fb` (corrección de todo o nada).
2. **Entrega:** `src/CorreccionService.js` nuevo (versiones, cascada, anulaciones de ajustes), `VERSIONES_DOCUMENTO` en `Repository`, guardado de versiones en `ImportacionService`, cinco API en `Código`/`Seguridad`, `API_PUBLICA`, `DATA_MODEL` y `BUSINESS_RULES`.
3. **Pruebas:** `node test/run_all.js` → **37 suites, 373 pruebas, 0 fallos**; T-027 → 12/12; `t020` 18/18 y `t023` 8/8. Salida completa en `logs/T-027/tests.txt`.
4. **Aceptación:** los 11 puntos originales verificados (detalle en `logs/T-027/aceptacion.md`), más la corrección de todo o nada por albarán (pruebas 11 y 12), incluidas cascada con ventas/cambios, pendientes, imposible, 30 semillas, anulación de ajustes y rendimiento con 5.000 movimientos.
5. **Dudas:** se listan abajo todos los cambios y decisiones no pedidos literalmente en el ticket; no se añadió ningún método a `MovementService`.

## git status

```text
 M BUSINESS_RULES.md
 M DATA_MODEL.md
 M docs/API_PUBLICA.md
 M "src/Código.js"
 M src/Repository.js
 M src/Seguridad.js
 M src/importacion/ImportacionService.js
?? logs/T-025/fusion.md
?? logs/T-025/tests-rebase.txt
?? logs/T-027/
?? src/CorreccionService.js
?? test/t027_correcciones.test.js
```

Los dos archivos de `logs/T-025/` son de la tarea anterior y ya estaban sin seguimiento antes de empezar T-027; no forman parte de esta entrega.

## git log --oneline -5

```text
7b01359 docs(T-027): anadir ticket de correcciones desde Hispatec
5eea049 feat(T-025): servidor de operaciones de solo lectura
52ab4fa docs(T-025): anadir ticket de servidor de operaciones
31de2cb docs(T-026): completar informe de entrega
8922e9b fix(T-026): total_cajas al pasar seguimiento desconocido a seguido
```

## Dudas

- **Detección de cambio solo de proveedor en `ImportacionService._estadoDocumento_`:** T-007 calcula `firma_lineas` sin el proveedor, pero la aceptación 2 y el caso 3 de T-027 cambian solo la finca. Para detectar esos cambios sin alterar la firma histórica, se añade una comparación de `entidad_nombre` cuando la firma coincide. Es un cambio fuera del literal «solo guardar la versión».
- **`PENDIENTES.cajas` en una segunda reimportación:** T-027 regla 1 pide actualizar la diferencia nueva. Se conserva la diferencia de la primera reimportación mientras la fila siga `PENDIENTE`, porque `test/t008_pendientes.test.js` (existente y no previsto para tocar) exige 15 tras reimportar 65→70. La versión nueva sí guarda las líneas nuevas y `apiListarVersionesPendientes` devuelve la diferencia nueva (20) en `diferencia`/`cajas`.
- **`firma_lineas` de una versión que solo cambia el proveedor:** queda igual que la firma antigua porque la firma de T-007 no incluye la entidad; la entidad nueva sí queda en `lineas_json` y en `DOCUMENTOS.entidad_nombre`. No se cambió la firma histórica para no marcar como modificados todos los documentos antiguos.
- **`lineas_json`:** se guardan solo las líneas `OK` (las que T-007 aplicaría), con `estado` y `seguimiento = OK`; las líneas `NO_SEGUIDA`, `ABONO`, `PENDIENTE` o `ERROR_DATOS` no se guardan en la versión.
- **Enlace de los movimientos rehechos:** las salidas y ajustes negativos rehechos mantienen el mismo `id_documento_ref` y llevan el marcador `CORRECCION_VERSION:<idPendiente>;ORIGINAL:<idMovimiento>` en `observaciones`. No se usa `id_movimiento_ref` en un movimiento `SALIDA`/`AJUSTE` nuevo porque `Libro.aplicarMovimiento` lo interpretaría como corrección de la salida original y cambiaría el reparto de consumos; no se puede tocar `Libro`. Los reprocesos rehechos llevan el marcador en `REPROCESOS.observaciones`. Si el director considera que `observaciones` no es «columna equivalente», habría que abrir una columna nueva en `MOVIMIENTOS` y `REPROCESOS`.
- **Ajustes negativos dirigidos:** si un dependiente es un `AJUSTE −` con `id_capa_objetivo` (reclasificación, división, corrección de entrada u operaciones emparejadas), la corrección devuelve `posible:false` con `AJUSTE_DIRIGIDO_NO_SOPORTADO_EN_CASCADA`. Deshacer y rehacer solo la pata negativa dejaría la pata positiva huérfana; no se ha implementado la pareja completa.
- **`partidas_cambian`:** los IDs de las capas nuevas son distintos entre la previsualización y la aplicación (cada ejecución genera IDs con `nuevoId`). La prueba 6 compara el contenido sin IDs; el resto de campos (artículo, envase, cajas, estado, proveedor, fecha) coincide.
- **`operaciones_rehechas`:** en una corrección de `SALIDA` se incluye la propia salida corregida como operación principal, además de los dependientes; en una `ENTRADA` solo aparecen ventas, cambios y ajustes dependientes.
- **`apiListarVersionesPendientes`:** devuelve un array (no un objeto agrupado). Cada elemento incluye `lineas`, `diferencia`, datos del pendiente y un resumen del documento. Se añade `options` para inyectar dependencias en pruebas.
- **`anularAjuste`:** rechaza los movimientos internos de un reproceso (`ES_MOVIMIENTO_DE_REPROCESO`) y exige motivo de al menos 5 caracteres, igual que `aplicarVersion`.
- **`VERSIONES_DOCUMENTO.motivo`:** se guarda `MODIFICADO_EN_ERP` al crear la versión y pasa a `CORRECCION_APLICADA` al aplicarla; no es un campo de motivo de usuario.
- **`DOCUMENTOS.entidad_nombre`:** se actualiza al aplicar una versión para que una reimportación del proveedor nuevo dé `YA_IMPORTADO`.
- **Métodos añadidos a `MovementService.js`:** **ninguno**. La cascada usa únicamente `_cargarEstado`, `_aplicar`, `_persistir` y el lock ya existentes.
- **`ImportacionService`:** además del guardado de versiones se añade el método privado `_registrarVersionesModificadas_` y la comprobación de proveedor indicada; no se toca el parser ni la firma.
- **`Repository`:** se añade solo la hoja `VERSIONES_DOCUMENTO` y sus métodos de lectura/escritura.

## Corrección

### Rebase sobre `main` = `c1cbdbe`

Se reaplicó T-027 sobre `c1cbdbe` (T-029 y T-030 incluidos). Los conflictos aparecieron solo en `src/Código.js` y `src/Seguridad.js`; se resolvieron conservando las dos partes: los `require`/globales de T-029 (`InicioService`, `ParteService`) y los de T-027 (`CorreccionService`), y las entradas de `PERMISOS_API` de T-029/T-030 junto con las de T-027. `docs/API_PUBLICA.md` se auto-fusionó. No hubo conflictos en otros archivos.

Antes de la corrección: **37 suites, 371 pruebas, 0 fallos**, ya sobre `c1cbdbe`.

### Todo o nada por albarán

- Una salida dependiente de la cascada se rehace **entera o no se rehace**. Si cualquier línea no tiene stock, se revierte el estado completo del albarán, no queda ninguna salida activa y el documento queda en `PENDIENTE_REVISION` (nunca `CONFIRMADO_PARCIAL` por falta de stock).
- `ventas_a_pendientes` de la vista previa lista **todas** las líneas del albarán, no solo la que falta.
- La versión nueva de una `SALIDA` corregida ya era todo o nada; se mantiene y se añade prueba explícita.
- Prueba nueva 11: compra de 3 artículos, venta de las 3 líneas y versión nueva que quita uno. Las 3 líneas van a PENDIENTES, no queda salida activa, el documento queda `PENDIENTE_REVISION`, el stock total es 20 y, cuando entra stock del artículo quitado, `reintentarPendientes` aplica la venta entera.
- Prueba nueva 12: versión nueva de una venta sin stock: las 2 líneas quedan pendientes, ninguna se aplica y el documento queda `PENDIENTE_REVISION`.
- Resultado final: **37 suites, 373 pruebas, 0 fallos**; `t027_correcciones` 12/12. Salida en `logs/T-027/tests.txt`.

### git log --oneline -5

```text
3edd6fb fix(T-027): todo o nada en salidas dependientes de la cascada
a97659e fix(T-027): completar vista previa y detalle de versiones
e8abf07 feat(T-027): correcciones Hispatec con versiones y cascada
2786386 docs(T-027): anadir ticket de correcciones desde Hispatec
c1cbdbe docs(T-030): completar informe de entrega
```

### Dudas

- **Número de línea en PENDIENTES:** como `MOVIMIENTOS` no guarda el número de línea original del CSV, las filas de PENDIENTES de una salida dependiente usan el ordinal 1..N de sus movimientos. Se crean todas las filas y con la serie/número del documento, pero el campo `linea` puede no coincidir con el número de línea de Hispatec si la venta tenía huecos. No se añadió ninguna columna a `MOVIMIENTOS`.
- **Sin otros cambios de comportamiento:** esta corrección solo cambia el rehacer de salidas dependientes en `CorreccionService` (incluida la versión nueva de salida, que ya era todo o nada), añade las pruebas 11/12 y actualiza `aceptacion.md`, `tests.txt` e `informe.md`. No se toca `MovementService.js` ni ningún otro archivo de producción.
- **`reintentarPendientes`:** se apoya en la agrupación por documento de T-008; al entrar el stock que faltaba, aplica las 3 líneas de la venta en una sola operación. Si en el futuro T-008 cambia esa agrupación, esta prueba lo detectaría.
