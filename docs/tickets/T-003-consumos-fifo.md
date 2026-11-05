# T-003 — Hoja CONSUMOS_FIFO derivada del libro y fin de los repartos a ciegas

Carril: A (núcleo). Rama: `ticket/T-003-consumos-fifo`, creada desde `main` (850dda4 o posterior). Sensible: **sí** (anulaciones y correcciones).
Especificación: 2026-10-23, **re-basada el 2026-11-05 sobre T-022** (`src/Libro.js`). Decisiones D-012, D-022. Problema verificado por el director técnico sobre `main` 850dda4.

## Qué ha cambiado desde la versión de octubre
T-022 ya resolvió la mitad: `Libro.aplicarMovimiento` calcula y lleva los consumos de cada movimiento en `estado.consumosPorMovimiento`, y `reconstruir` los recalcula igual. Lo que queda es **dónde se guardan** y **qué pasa cuando no se conocen**.

## Problema
1. **Los consumos viven como texto en `observaciones`.** `MovementService` escribe `FIFO:[...]` con `anexarConsumosFifoAObservaciones` (4 llamadas) y `_cargarEstado` reconstruye `consumosPorMovimiento` parseando ese texto en **todos** los movimientos en cada operación.
   - Si alguien edita la celda, o el JSON supera el límite de una celda en una salida muy fragmentada, la anulación ya no devuelve las cajas a su partida.
   - No se puede consultar «de qué partidas salió este albarán» sin parsear texto.
2. **Quedan dos repartos a ciegas en `src/Libro.js`.** Si los consumos del movimiento referenciado no se conocen:
   - AJUSTE + con `id_movimiento_ref` (corrección de salida a la baja): «Fallback si la salida era antigua…» devuelve cajas a las capas con consumos, de la más nueva a la más antigua;
   - ANULACION de una salida o ajuste −: «Fallback para filas antiguas…» hace lo mismo.

   Eso devuelve cajas a partidas que quizá no eran de esa venta. Rompe D-012: anular devuelve a la partida original, o no hace nada.

## Idea de la solución
CONSUMOS_FIFO es **un derivado más**, como CAPAS_FIFO y STOCK_ACTUAL (D-022): es la foto de `estado.consumosPorMovimiento`. Se escribe entera en `_persistir` y se puede regenerar siempre desde MOVIMIENTOS. No hace falta un estado ACTIVO/REVERTIDO: la historia completa sigue en MOVIMIENTOS, que es de solo añadir.

## Lo que ya existe (verificado; no lo rehagas)
- `Libro.aplicarMovimiento` y `Libro.reconstruir` con `consumosPorMovimiento`, en orden de consumo.
- `_persistir` como único punto de escritura (T-022).
- `comprobarConsistencia` compara capas y stock.
- No hay datos reales en producción: la compatibilidad con filas antiguas solo tiene que **no romper**, no ser perfecta.

## Reglas
1. **Hoja nueva en `SCHEMA_DEFINITIONS`:** `CONSUMOS_FIFO` con `id_movimiento`, `orden`, `id_capa`, `codigo_articulo`, `codigo_envase`, `cajas`, `fecha_negocio`.
   - Una fila por cada elemento de `consumosPorMovimiento[id_movimiento]`, con `orden` = su posición (1, 2…) y `cajas` = las que siguen consumidas hoy.
   - `fecha_negocio` es la del movimiento que consume. Se escribe como texto, igual que las demás fechas (T-002).
2. **`_persistir`** reescribe CONSUMOS_FIFO a partir de `estado.consumosPorMovimiento` justo después de CAPAS_FIFO, dentro del mismo lock. Ningún otro método escribe esa hoja.
3. **`_cargarEstado`** carga `consumosPorMovimiento` desde CONSUMOS_FIFO, no desde `observaciones`.
   - Si la hoja está vacía y MOVIMIENTOS tiene movimientos que consumen (primera ejecución tras desplegar), obtiene los consumos con `libro.reconstruir(movimientos)` y sigue. La siguiente persistencia ya escribe la hoja.
4. **Se deja de escribir `FIFO:`** en `observaciones`: se quitan las llamadas a `anexarConsumosFifoAObservaciones`. `extraerConsumosFifoDeObservaciones` se conserva **solo** dentro de `Libro.js`, para filas antiguas que lo traigan.
5. **Fin de los repartos a ciegas** en `Libro.aplicarMovimiento`: si no se conocen los consumos del movimiento referenciado (ni en `consumosPorMovimiento` ni en el JSON antiguo), devuelve `ok: false` con `errorCode: 'CONSUMOS_DESCONOCIDOS'` y **no toca ninguna capa**.
   - En vivo, la operación devuelve `REVISION_NECESARIA` con un mensaje claro.
   - En `reconstruir`, ese movimiento se informa en `avisos` y no se aplica. Así vivo y reconstrucción siguen coincidiendo.
6. **`rebuildStock`** escribe también CONSUMOS_FIFO.
7. **`comprobarConsistencia`** compara también CONSUMOS_FIFO guardada con la reconstruida (por `id_movimiento` + `id_capa`, cajas) y devuelve `diferenciasConsumos`. Cuenta en `totalDiferencias`.

## Aceptación
1. **Prueba nueva:** con capas A (70 restantes, más antigua) y B (50), una salida de 100 escribe dos filas en CONSUMOS_FIFO (A 70, orden 1; B 30, orden 2) y su `observaciones` no contiene `FIFO:`.
2. **Prueba nueva:** al anular esa salida, A y B recuperan exactamente sus cajas restantes anteriores y CONSUMOS_FIFO ya no tiene filas de ese movimiento.
3. **Prueba nueva:** corregir esa salida de 100 a 80 devuelve las 20 cajas a B (orden inverso al consumo). CONSUMOS_FIFO queda con A 70 y B 10.
4. **Prueba nueva (la fuente es la hoja, no el texto):** tras varias salidas, se vacía la columna `observaciones` de todas las filas de MOVIMIENTOS en el mock; anular una de esas salidas devuelve las cajas a sus capas exactas.
5. **Prueba nueva (primera ejecución):** con MOVIMIENTOS con salidas y CONSUMOS_FIFO vacía, anular una salida funciona igual que en la prueba 2, y después la hoja está rellena.
6. **Prueba nueva (sin repartos a ciegas):** una ANULACION y un AJUSTE + cuyo `id_movimiento_ref` apunta a un movimiento sin consumos conocidos devuelven `REVISION_NECESARIA` en vivo, sin cambiar ninguna capa. En `reconstruir`, aparecen en `avisos` y no cambian capas.
7. **Prueba nueva:** tras `rebuildStock`, CONSUMOS_FIFO coincide fila a fila con la de antes del rebuild.
8. La prueba de propiedades de T-022 (`t022_propiedades.test.js`) sigue con 0 diferencias tras cada operación, **ahora incluyendo `diferenciasConsumos`**. No cambies su semilla ni el número de operaciones.
9. `grep -n "anexarConsumosFifoAObservaciones(" src/MovementService.js` no devuelve nada. Las funciones globales nuevas, si las hay, están en `docs/API_PUBLICA.md`.
10. `DATA_MODEL.md` documenta la hoja nueva como derivada (D-022). `node test/run_all.js` con 0 fallos, salida en `logs/T-003/tests.txt`.

## Archivos previstos
- `src/Libro.js` (regla 5)
- `src/MovementService.js`
- `src/Repository.js` (esquema y lectura/escritura de la hoja)
- `DATA_MODEL.md`
- `docs/API_PUBLICA.md` (solo si hay funciones globales nuevas)
- `test/t003_consumos_fifo.test.js` (nuevo)
- `docs/tickets/T-003-consumos-fifo.md` (este ticket, primer commit, sin editar)
- `logs/T-003/*`

Si necesitas otro, para y pregunta. **No toques `src/Código.js`** (carril B).

## Fuera de alcance
- Pantallas y consulta «de qué partidas salió este albarán» en la interfaz.
- Optimizar la reescritura completa de CONSUMOS_FIFO (se medirá en T-015).
- Cambiar el algoritmo FIFO.

## Parar y preguntar si
- Alguna aserción existente comprueba el texto `FIFO:` en `observaciones`.
- Alguna operación existente depende de uno de los repartos a ciegas de la regla 5 para funcionar.
