# Registro de Aceptación — Ticket T-002

**Ticket:** T-002 — Fecha de negocio, zona horaria, secuencia y datos de trazabilidad en movimientos y capas  
**Carril:** A (núcleo)  
**Rama:** `ticket/T-002-fecha-negocio`  
**Fecha:** 2026-11-05  

---

## Verificación de Criterios de Aceptación

### 1. Orden FIFO con objetos Date normalizados desde Sheets
- **Criterio:** Capas cuyas fechas llegan como objetos `Date`, en distinto orden de inserción, salen ordenadas por fecha real en `sortFifoLayers` tras pasar por la normalización del repositorio (mock de `getValues` que devuelve `Date`).
- **Comprobación:** Implementado en `test/t002_fecha_negocio.test.js` (Test 1). Se simula un `MockSpreadsheet` donde `getValues()` devuelve instancias `new Date(Date.UTC(2026, 9, 23, 10, 0, 0))` y `new Date(Date.UTC(2026, 9, 19, 10, 0, 0))`. `readTable('CAPAS_FIFO')` normaliza a cadenas ISO `YYYY-MM-DD` ('2026-10-23' y '2026-10-19') y `sortFifoLayers()` las ordena cronológicamente (19/10 antes que 23/10).
- **Resultado:** ✅ SUPERADO (`test/t002_fecha_negocio.test.js: Test 1`).

### 2. Reconstrucción con albaranes en misma fecha_hora
- **Criterio:** Se registran entradas del 15/10 y del 17/10 y una salida del 19/10, todas con la misma `fecha_hora`. `rebuildStock()` produce las mismas capas (con `fecha_capa` 15/10 y 17/10, proveedor relleno) y las mismas cajas restantes por capa que el estado vivo.
- **Comprobación:** Implementado en `test/t002_fecha_negocio.test.js` (Test 2). Se configuran 3 movimientos con la misma marca temporal `fecha_hora = '2026-10-19T20:00:00.000Z'` pero fechas de negocio '2026-10-15', '2026-10-17' y '2026-10-19', con secuencias 1, 2, 3. La salida de 60 cajas consume primero las 50 cajas de la capa del 15/10 y 10 cajas de la capa del 17/10. `rebuildStockFromMovements()` reproduce exactamente el mismo saldo total (40 cajas) y las mismas capas resultantes (0 cajas restantes en capa 15/10 y 40 en capa 17/10, con proveedor preservado).
- **Resultado:** ✅ SUPERADO (`test/t002_fecha_negocio.test.js: Test 2`).

### 3. FIFO vivo y Reconstrucción ante orden de registro inverso a fecha de negocio
- **Criterio:** Se registra una entrada del 20/10 y después, en otra operación, una entrada del 05/10; luego una salida. El FIFO vivo consume primero la del 05/10, y `rebuildStock()` da exactamente las mismas cajas restantes por capa.
- **Comprobación:** Implementado en `test/t002_fecha_negocio.test.js` (Test 3). Se registran: Entrada A (20/10, secuencia 1, 100 cajas), Entrada B (05/10, secuencia 2, 100 cajas), Salida C (secuencia 3, 50 cajas). El FIFO vivo consume 50 cajas de la capa más antigua (05/10). `rebuildStockFromMovements()` reproduce por orden de registro (`secuencia` 1 -> 2 -> 3), manteniendo para el FIFO la antigüedad por `fecha_capa`, resultando en idénticas capas y saldo restante (100 en capa 20/10 y 50 en capa 05/10).
- **Resultado:** ✅ SUPERADO (`test/t002_fecha_negocio.test.js: Test 3`).

### 4. hoyMadrid() a las 23:30 UTC devuelve día siguiente en Europe/Madrid
- **Criterio:** `hoyMadrid()` con el reloj simulado en `2026-10-23T23:30:00Z` devuelve `2026-10-24`.
- **Comprobación:** Implementado en `test/t002_fecha_negocio.test.js` (Test 4). Se inyecta a `hoyMadrid(reloj)` una función de reloj que devuelve `new Date('2026-10-23T23:30:00.000Z')`. Se verifica que la fecha resultante es `'2026-10-24'`, demostrando la conversión horaria correcta a `Europe/Madrid` (UTC+2 en horario de verano).
- **Resultado:** ✅ SUPERADO (`test/t002_fecha_negocio.test.js: Test 4`).

### 5. Idempotencia de provisionDatabase() en hojas existentes
- **Criterio:** `provisionDatabase` sobre una hoja MOVIMIENTOS con el esquema antiguo y filas añade las cinco columnas al final y conserva las filas.
- **Comprobación:** Implementado en `test/t002_fecha_negocio.test.js` (Test 5). Se inicializa un `MockSpreadsheet` con hoja `MOVIMIENTOS` conteniendo las 13 columnas originales y 2 filas de datos históricos. Se ejecuta `repo.provisionDatabase()`. Se comprueba que la fila de cabeceras contiene ahora 18 columnas con las 5 columnas nuevas (`fecha_negocio`, `entidad_nombre`, `secuencia`, `origen_dato`, `kg_informativo`) añadidas al final, y las filas de datos se mantienen íntegras sin corrupción ni desplazamiento.
- **Resultado:** ✅ SUPERADO (`test/t002_fecha_negocio.test.js: Test 5`).

### 6. Secuencia estrictamente creciente en bloque y fuente única en appendMovimientos (Regla 4)
- **Criterio:** `secuencia` es estrictamente creciente en 50 movimientos registrados en un mismo bloque, y se asigna en un único punto centralizado (`SheetsRepository.appendMovimientos` en `src/Repository.js`) dentro del lock para todas las operaciones que escriben movimientos.
- **Cómo queda la Regla 4:**
  1. `SheetsRepository.appendMovimientos(movs)` (`src/Repository.js`) lee el máximo actual de `secuencia` en `MOVIMIENTOS` y asigna `max + 1`, `max + 2`… a los movimientos recibidos en el orden del array antes de delegar en `appendRecords('MOVIMIENTOS', movs)`.
  2. Se eliminó el cálculo duplicado de `maxSecuencia` de `registrarEntrada`, `registrarSalida` y `registrarAjuste` en `src/MovementService.js`, dejando `appendMovimientos` como única fuente de verdad.
  3. Se verificaron las 14 llamadas a `this.repo.appendMovimientos(...)` en `src/MovementService.js` (`registrarEntrada`, `registrarSalida`, `registrarAjuste`, `registrarReclasificacion`, `registrarMovimientoPartida`, `confirmarCompraPendiente`, `anularEntrada`, `anularSalida`, `corregirCantidadSalida` [x2], `corregirCantidadEntrada` [x2], `corregirEntradaParcial`, `dividirCapaEntrada`); todas se ejecutan dentro de `this._acquireLock(30000)` / `try ... finally { this._releaseLock(); }`.
  4. **Pruebas:**
     - `Test 6`: 50 movimientos en un mismo bloque reciben secuencia `1..50` estrictamente creciente.
     - `Test 8`: Tras ejecutar `registrarEntrada`, `registrarSalida`, `confirmarCompraPendiente`, `registrarReclasificacion`, `anularSalida` y `dividirCapaEntrada`, ninguna fila de `MOVIMIENTOS` tiene `secuencia` vacía y la columna es estrictamente creciente (`1..8`) en el orden de escritura.
     - `Test 9`: Entrada del 20/10, salida, y después `confirmarCompraPendiente` de una compra del 05/10: `rebuildStock()` reproduce los movimientos según `secuencia` y da exactamente las mismas cajas restantes por capa (60 en 20/10 y 80 en 05/10) que el estado vivo.
- **Resultado:** ✅ SUPERADO (`test/t002_fecha_negocio.test.js: Tests 6, 8 y 9`).

### 7. kg_informativo no altera saldo de stock en cajas
- **Criterio:** Una entrada con `kg: 444` guarda `kg_informativo = 444` y el stock en cajas no cambia respecto a la misma entrada sin kilos.
- **Comprobación:** Implementado en `test/t002_fecha_negocio.test.js` (Test 7). Se registran dos entradas de 100 cajas: una sin kilos y otra con `kg: 444`. Se verifica que en la segunda el registro en `MOVIMIENTOS` tiene `kg_informativo = 444`, mientras que el stock resultante en `STOCK_ACTUAL` es idéntico al cálculo en cajas puras (100 cajas por entrada, 200 en total), sin que los kilos afecten el saldo.
- **Resultado:** ✅ SUPERADO (`test/t002_fecha_negocio.test.js: Test 7`).

### 8. Actualización de DATA_MODEL.md
- **Criterio:** `DATA_MODEL.md` actualizado con las columnas nuevas, la regla de orden de este ticket y D-008.
- **Comprobación:** Tablas de `MOVIMIENTOS` y `CAPAS_FIFO` actualizadas con las nuevas columnas al final. Sección 4 redactada detallando la regla clave sobre el orden cronológico de reproducción por `secuencia`, el uso de `fecha_negocio` para la antigüedad de capas, y el tratamiento de zona horaria `Europe/Madrid` conforme a D-008, D-022 y D-025.
- **Resultado:** ✅ SUPERADO (`DATA_MODEL.md`).

### 9. Ejecutor único de pruebas con 0 fallos
- **Criterio:** `node test/run_all.js` con 0 fallos, salida en `logs/T-002/tests.txt`. Ninguna aserción existente cambia.
- **Comprobación:** Ejecutadas las 17 suites con un total de 222 pruebas. 17 suites superadas, 0 fallidas. Salida guardada en `logs/T-002/tests.txt` en UTF-8.
- **Resultado:** ✅ SUPERADO (17/17 suites, 222/222 pruebas OK).
