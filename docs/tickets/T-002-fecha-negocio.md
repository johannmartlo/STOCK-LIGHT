# T-002 — Fecha de negocio, zona horaria, secuencia y datos de trazabilidad en movimientos y capas

Carril: A (núcleo). Rama: `ticket/T-002-fecha-negocio`, creada desde `main` tras el merge de T-001. Sensible: **sí** (cambia el esquema y el orden FIFO).
Especificación: 2026-10-23, revisada el 2026-11-04. Decisiones D-008, D-022, D-023, D-025. Problema verificado por el director técnico.

## Problema
Tres defectos hacen que el FIFO pueda salir mal con datos reales, aunque las pruebas actuales pasen (las pruebas usan cadenas de texto; Sheets no).

1. **Orden FIFO con fechas leídas de Sheets.**
   - `sortFifoLayers` compara `fecha_capa` como texto (`src/InventoryEngine.js:62`).
   - `SheetsRepository.readTable` devuelve el valor tal cual lo da `getValues()`.
   - Sheets convierte el texto «2026-10-19», escrito con `setValues`, en un objeto Date. `String(Date)` da «Mon Oct 19 2026 …», así que el orden pasa a ser alfabético por el nombre del día de la semana.
2. **La reconstrucción no conoce la fecha del albarán.**
   - El movimiento no guarda la fecha de negocio, solo `fecha_hora`, que es el momento de registro.
   - `rebuildStockFromMovements` (`src/InventoryEngine.js:359`) deriva de ahí la fecha de la capa: `fecha_hora.slice(0, 10)`.
   - Si se importa un mes de albaranes de golpe, todas las capas reconstruidas quedan con la fecha de la importación.
   - Además, dos movimientos registrados en el mismo milisegundo (importación en lote) no tienen un orden fiable.
3. **«Hoy» en UTC.** `new Date().toISOString().slice(0, 10)` da el día anterior entre las 00:00 y las 02:00 de Madrid. Aparece en:
   - `src/InventoryEngine.js:126, 292`
   - `src/MovementService.js:489, 637, 790, 1712`
   - `src/OperationalSafetyService.js:91, 364`

Además, ni MOVIMIENTOS ni CAPAS_FIFO guardan el proveedor o el cliente, el origen del dato (D-023) ni los kilos informativos (D-025). Las previsiones y estadísticas futuras los necesitan desde el primer día.

## Regla clave sobre el orden (no confundir)
- La **reconstrucción reproduce los movimientos en el orden en que se registraron** (columna nueva `secuencia`). Solo así da el mismo resultado que el estado vivo: una venta consumió las partidas que existían cuando se registró.
- La **fecha de negocio** decide la fecha de cada capa, y con ella qué capa es la más antigua para el FIFO. **No** decide el orden de reproducción.
- La versión anterior de este ticket pedía ordenar la reconstrucción por `fecha_negocio`. **Queda anulado.**

## Lo que ya existe (verificado; no lo rehagas)
- `appsscript.json` ya tiene `"timeZone": "Europe/Madrid"`.
- `provisionDatabase` crea las hojas que faltan.
- `replaceTable` y `appendRecords` escriben en bloque, por posición de cabecera.
- `rebuildStockFromMovements` ya reproduce en orden de registro (`fecha_hora`, después `id_movimiento`). Hay que mantenerlo, sustituyendo ese orden por `secuencia` cuando exista.

## Reglas
1. Nuevo módulo puro `src/Fechas.js`:
   - `hoyMadrid()` devuelve `YYYY-MM-DD` en Europe/Madrid. En Apps Script usa `Utilities.formatDate`; en Node, `Intl.DateTimeFormat` con `timeZone: 'Europe/Madrid'`. Acepta un reloj inyectable para las pruebas.
   - `normalizarFechaNegocio(valor)` acepta Date, `YYYY-MM-DD`, ISO completo y `dd/mm/yyyy`, y devuelve `YYYY-MM-DD`. Un Date se interpreta en Europe/Madrid. Lanza un error si el valor no es válido.
2. Todas las llamadas citadas en el punto 3 del problema pasan a `hoyMadrid()`.
3. Esquema (`SCHEMA_DEFINITIONS`), con columnas **añadidas al final** para no mover las existentes:
   - MOVIMIENTOS: `fecha_negocio`, `entidad_nombre`, `secuencia`, `origen_dato`, `kg_informativo`.
   - CAPAS_FIFO: `proveedor`, `id_capa_origen`, `origen_dato`.
4. `secuencia` es un entero creciente que asigna el servicio **dentro del lock**: el máximo actual + 1, y así para cada movimiento del mismo bloque. Nunca se reutiliza.
5. `readTable` normaliza con `normalizarFechaNegocio` las columnas `fecha_negocio`, `fecha_capa` y `fecha_documento` si llegan como Date. Al escribir, esas columnas se escriben como texto (`setNumberFormat('@')` en la columna) para que Sheets no las convierta.
6. `processMovement`:
   - rellena `fecha_negocio` (de `movementInput.fecha`, normalizada; si falta, `hoyMadrid()`), `entidad_nombre` (de `movementInput.entidad`), `origen_dato` (de `movementInput.origenDato`; por defecto `MANUAL`) y `kg_informativo` (de `movementInput.kg`; vacío si no viene);
   - en las entradas y los ajustes positivos, la capa recibe `proveedor` (de `movementInput.entidad`), `fecha_capa = fecha_negocio` y `origen_dato`.
7. `rebuildStockFromMovements`:
   - ordena por `secuencia`. Las filas antiguas sin `secuencia` van antes, ordenadas como hoy (`fecha_hora`, `id_movimiento`);
   - usa `fecha_negocio` como fecha de capa (las filas antiguas sin ella usan `fecha_hora` recortada, como hasta ahora);
   - pasa `entidad`, `origenDato` y `kg` a `processMovement`.
8. `provisionDatabase` es idempotente: si una hoja existe pero le faltan columnas del esquema, las añade al final de la fila 1 sin tocar los datos.
9. `registrarEntrada` y `registrarSalida` pasan `entidad: docPayload.entidad_nombre` y, si vienen, `origenDato` y `kg` de cada línea.
10. `kg_informativo` **no interviene nunca** en el stock (D-004, D-025). Ningún cálculo de cajas lo lee.

## Aceptación
1. **Prueba nueva:** capas cuyas fechas llegan como objetos `Date`, en distinto orden de inserción, salen ordenadas por fecha real en `sortFifoLayers` tras pasar por la normalización del repositorio (mock de `getValues` que devuelve Date).
2. **Prueba nueva:** se registran entradas del 15/10 y del 17/10 y una salida del 19/10, todas con la misma `fecha_hora`. `rebuildStock()` produce las mismas capas (con `fecha_capa` 15/10 y 17/10, proveedor relleno) y las mismas cajas restantes por capa que el estado vivo.
3. **Prueba nueva:** se registra una entrada del 20/10 y después, en otra operación, una entrada del 05/10; luego una salida. El FIFO vivo consume primero la del 05/10, y `rebuildStock()` da exactamente las mismas cajas restantes por capa.
4. **Prueba nueva:** `hoyMadrid()` con el reloj simulado en 2026-10-23T23:30:00Z devuelve `2026-10-24`.
5. **Prueba nueva:** `provisionDatabase` sobre una hoja MOVIMIENTOS con el esquema antiguo y filas añade las cinco columnas al final y conserva las filas.
6. **Prueba nueva:** `secuencia` es estrictamente creciente en 50 movimientos registrados en un mismo bloque.
7. **Prueba nueva:** una entrada con `kg: 444` guarda `kg_informativo = 444` y el stock en cajas no cambia respecto a la misma entrada sin kilos.
8. `DATA_MODEL.md` actualizado con las columnas nuevas, la regla de orden de este ticket y D-008.
9. `node test/run_all.js` con 0 fallos, salida en `logs/T-002/tests.txt`. Ninguna aserción existente cambia.

## Archivos previstos
- `src/Fechas.js` (nuevo)
- `src/InventoryEngine.js`
- `src/Repository.js`
- `src/MovementService.js`
- `src/OperationalSafetyService.js` (solo las dos líneas de «hoy»)
- `DATA_MODEL.md`
- `test/t002_fecha_negocio.test.js` (nuevo; usa `test/helpers/mockSheets.js`)
- `logs/T-002/*`

Si necesitas otro, para y pregunta. **No toques `src/Código.js`**: lo está cambiando el carril B (T-023).

## Fuera de alcance
- Las anulaciones y correcciones en la reconstrucción (T-022).
- La clave de stock (T-004) y la hoja de consumos FIFO (T-003).
- Las pantallas.

## Parar y preguntar si
Alguna función fuera de las listadas escribe o lee `fecha_capa` y no está cubierta por estas reglas.
