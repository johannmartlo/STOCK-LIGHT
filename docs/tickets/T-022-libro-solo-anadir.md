# T-022 — Libro de movimientos de solo añadir: la reconstrucción siempre coincide con el estado vivo

Carril: A (núcleo). Rama: `ticket/T-022-libro-solo-anadir`, creada desde `main` tras el merge de T-002. Sensible: **sí, el más delicado del plan** (toca todas las operaciones que escriben stock).
Especificación: 2026-11-04. Decisiones D-012, D-022, D-024. Problema **demostrado** por el director técnico con el mock de las suites (`analisis/REVISION_DEUDA_TECNICA_2026-11-04.md`, §2 A1).

## Problema
Hoy hay dos fuentes de verdad, MOVIMIENTOS y CAPAS_FIFO, y pueden divergir. Casos demostrados:

| Caso | Vivo | Tras `rebuildStock()` |
| :--- | ---: | ---: |
| Entradas de 100 y 50; se anula la de 100 | 50 | 150 |
| Entrada de 100; salida de 40 corregida a 30 | 70 | 80 |

Causas, en `src/MovementService.js`:
- `anularEntrada` (línea 1335) pone la capa a 0 y escribe un movimiento ANULACION que la reconstrucción ignora, porque `rebuildStockFromMovements` solo procesa `estado === 'CONFIRMADO'`.
- `corregirCantidadSalida` (1573) y `corregirCantidadEntrada` (1760) **reescriben el movimiento original** (`mov.cajas = nuevaCantidad`, líneas 1691 y 1731, más `replaceTable('MOVIMIENTOS')`) y además añaden un ajuste. Por eso la reconstrucción cuenta dos veces.
- `corregirCantidadEntrada` (1813-1852), `corregirEntradaParcial` (1950-1954), `dividirCapaEntrada` (2109-2110), `registrarMovimientoPartida` (799) y las restituciones de `anularSalida` (1494, 1512) **modifican capas directamente**, sin un movimiento que la reconstrucción sepa repetir.
- La persistencia está copiada en unos 15 sitios, y no siempre en el mismo orden: a veces movimientos antes que capas, a veces al revés.

## Idea de la solución (por qué así)
**Una sola función pura decide qué le hace cada movimiento al estado.** Tanto la operación en vivo como la reconstrucción usan esa función. Si las dos pasan por el mismo código, coinciden por construcción, no por casualidad.

## Lo que ya existe (verificado; no lo rehagas)
- `processMovement` (`src/InventoryEngine.js:108`) es puro: ENTRADA, SALIDA y AJUSTE con FIFO.
- `rebuildStockFromMovements` (`src/InventoryEngine.js:359`) ya reproduce en orden de registro. T-002 lo ordena por `secuencia`.
- Las validaciones de cada operación (stock insuficiente, entrada consumida que no se puede anular, etc.) y sus mensajes. **Se conservan.**

## Reglas
1. **Nuevo módulo puro `src/Libro.js`:**
   - `aplicarMovimiento(estado, movimiento)` devuelve `{ ok, estado, consumos, error }` **sin mutar la entrada**.
   - `estado = { capas, stock, consumosPorMovimiento }`. Este último es `{ id_movimiento: [{ id_capa, cajas }] }`, en el orden en que se consumió.
   - `reconstruir(movimientos)` = aplicar en orden de `secuencia` (T-002) partiendo del estado vacío.
   - Puede apoyarse en `processMovement`, pero toda la lógica de capas vive aquí.
2. **Columnas nuevas en MOVIMIENTOS**, al final: `id_movimiento_ref`, `id_capa_objetivo`, `id_capa_creada`.
3. **Semántica de cada movimiento**, que es la única que existe:

   | Movimiento | Efecto |
   | :--- | :--- |
   | ENTRADA, o AJUSTE + sin `id_capa_objetivo` | Crea la capa `id_capa_creada` con `fecha_capa = fecha_negocio` y `proveedor = entidad_nombre` |
   | AJUSTE + con `id_capa_objetivo` | Devuelve cajas a esa capa (restitución) |
   | SALIDA, o AJUSTE − sin `id_capa_objetivo` | Consume por FIFO y anota los consumos |
   | AJUSTE − con `id_capa_objetivo` | Consume solo de esa capa (consumo dirigido) |
   | ANULACION con `id_movimiento_ref` = una entrada | Consume todo lo que quede en la capa creada por ella y la marca `ANULADA`. Si la capa ya tiene consumos, error (como hoy) |
   | ANULACION con `id_movimiento_ref` = una salida o un ajuste − | Devuelve a cada capa exactamente lo que ese movimiento consumió, según `consumosPorMovimiento` (D-012) |

4. **Reescritura de las operaciones de `MovementService`.** Cada operación:
   1. valida como hoy;
   2. construye la lista de movimientos nuevos;
   3. los aplica con `aplicarMovimiento` sobre el estado cargado;
   4. persiste.

   Equivalencias:
   - **Anular** = un movimiento ANULACION, con estado `CONFIRMADO` y `id_movimiento_ref`.
   - **Corregir la cantidad de una salida a la baja** = AJUSTE + con `id_movimiento_ref` a la salida. Devuelve las cajas a las capas de esa salida, en orden inverso al consumo.
   - **Corregir una salida al alza** = AJUSTE − por FIFO con `id_movimiento_ref`.
   - **Corregir la cantidad de una entrada** = AJUSTE ± con `id_capa_objetivo` = su capa. `cajas_iniciales` de la capa **no se toca**: la capa muestra su historial.
   - **Dividir capa, corregir entrada parcial, reclasificar y mover partida** = combinaciones de consumo dirigido + creación de capas, con la fecha y el proveedor de la capa de origen.
   - **El movimiento original nunca se modifica.** Queda prohibido `replaceTable('MOVIMIENTOS', …)` y cualquier escritura que cambie una fila existente de MOVIMIENTOS.
5. **Un único método de persistencia** `_persistir({ movimientos, estado, documentos })`, dentro del lock y en este orden:
   1. añadir movimientos (con su `secuencia`);
   2. reescribir CAPAS_FIFO;
   3. reescribir STOCK_ACTUAL;
   4. actualizar DOCUMENTOS.

   Ningún otro método escribe esas hojas.
6. **Identificadores (D-024):** módulo `src/Ids.js` con `nuevoId(prefijo)`, que usa `Utilities.getUuid()` en Apps Script y `crypto.randomUUID()` en Node. Sustituye **todos** los `Date.now()` y aleatorios usados como ID en `InventoryEngine.js` y `MovementService.js`.
7. **Comprobación de consistencia:** `comprobarConsistencia()` en `MovementService` reconstruye en memoria y compara con CAPAS_FIFO y STOCK_ACTUAL guardados. Devuelve las diferencias por capa y por clave. **No escribe nada.**
8. **Filas antiguas:** un ANULACION antiguo con estado `ANULADO` y sin `id_movimiento_ref` se trata así:
   - si su `id_documento_ref` identifica la entrada o la salida anulada, se aplica con esa referencia;
   - si no, `reconstruir` lo informa en una lista `avisos`. No lanza error ni lo ignora en silencio.
9. **El JSON `FIFO:` de `observaciones`** se sigue escribiendo y leyendo en este ticket (T-003 lo sustituirá). El estado vivo carga `consumosPorMovimiento` desde ahí.

## Aceptación
1. **Prueba nueva:** los dos casos de la tabla del problema. Tras cada operación, `reconstruir(movimientos)` da las mismas cajas restantes por capa (mismos `id_capa`) y el mismo stock por clave que el estado vivo.
2. **Prueba nueva, de propiedades:** 200 operaciones aleatorias con semilla fija, mezclando entradas, salidas, ajustes ±, anulaciones, correcciones al alza y a la baja, división y reclasificación. Tras **cada** operación, `comprobarConsistencia()` devuelve 0 diferencias. Si falla, la prueba imprime la semilla y el número de operación.
3. **Prueba nueva:** ninguna fila de MOVIMIENTOS cambia después de escribirse. La prueba guarda una copia tras cada operación y compara el prefijo.
4. **Prueba nueva:** 1.000 llamadas a `nuevoId('MOV')` en un bucle no repiten ningún valor.
5. **Prueba nueva:** una base con un ANULACION antiguo (`ANULADO`, sin referencia) se reconstruye con su aviso y sin excepción.
6. Las suites existentes siguen en verde. Si una aserción comprueba que el movimiento original se reescribe, o que `cajas_iniciales` cambia, D-022 autoriza a adaptarla. **Lista cada una** en `logs/T-022/aceptacion.md`, con la línea y el motivo. Cualquier otra aserción que falle: para y pregunta.
7. `grep -n "replaceTable('MOVIMIENTOS'" src/` no devuelve nada. `grep -n "Date.now()" src/InventoryEngine.js src/MovementService.js` solo devuelve usos que no son identificadores (por ejemplo, medir tiempos).
8. `DATA_MODEL.md` y `BUSINESS_RULES.md` documentan la tabla de semántica de la regla 3. `node test/run_all.js` con 0 fallos, salida en `logs/T-022/tests.txt`.

## Archivos previstos
- `src/Libro.js` (nuevo)
- `src/Ids.js` (nuevo)
- `src/InventoryEngine.js`
- `src/MovementService.js`
- `src/Repository.js` (columnas nuevas)
- `src/OperationalSafetyService.js` (solo si llama a métodos cuya firma cambia)
- `DATA_MODEL.md`
- `BUSINESS_RULES.md`
- `test/t022_libro.test.js` (nuevo)
- `test/t022_propiedades.test.js` (nuevo)
- Suites existentes, solo en los casos de la aceptación 6
- `logs/T-022/*`

Si necesitas otro, para y pregunta. **No toques `src/Código.js`** (carril B).

## Fuera de alcance
- La hoja CONSUMOS_FIFO (T-003).
- El reproceso nuevo de varias partidas (T-009).
- Pantallas, y exponer `comprobarConsistencia` en la API (lo hará T-021).

## Parar y preguntar si
- Alguna operación existente no se puede expresar con la tabla de la regla 3.
- Mantener una validación existente exige leer algo que no está en `estado`.
- El ticket supera un día de trabajo: avisa con lo hecho y lo que falta, en vez de recortar pruebas.
