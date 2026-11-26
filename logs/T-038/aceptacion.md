# Aceptación — T-038 (Bloqueo en Apps Script real)

Comprobación punto por punto de los criterios de aceptación de `docs/tickets/T-038-bloqueo-apps-script.md`:

1. **Prueba nueva `test/t038_bloqueo.test.js` con tres locks simulados:**
   - **Estilo Apps Script (`waitLock` devuelve `undefined`):** comprobado en los casos `1a` (`registrarAjustePositivo`), `1b` (importación de CSV con `ImportacionService`), `1c` (stock inicial con copia simulada en `StockInicialService`) y `1d` (`registrarReproceso`). Todos se completan con éxito y persisten los datos esperados.
   - **`waitLock` que lanza:** comprobado en los casos `2a`–`2d` para las mismas 4 operaciones. Todas fallan con el mensaje `No se pudo adquirir el bloqueo de concurrencia tras 30000ms. Otra operación está en curso.` y mantienen intacto el número de filas de `MOVIMIENTOS`, `CAPAS_FIFO` y `STOCK_ACTUAL`.
   - **`waitLock` que devuelve `false`:** comprobado en los casos `3a`–`3d` para las mismas 4 operaciones. Mismo mensaje de error y cero escrituras.
   - **Adicional (`tryLock` sin `waitLock`):** comprobado en el caso `4` (`true` funciona y libera; `false` falla sin escribir).

2. **Prueba nueva de `_escribirLogCopia_`:**
   - Comprobado en `test/t038_bloqueo.test.js` casos `5a` (lock estilo Apps Script: escribe en `LOG_OPERACIONES` y libera el bloqueo), `5b` (lock que lanza: lanza el error de bloqueo sin escribir en `LOG_OPERACIONES` ni liberar un bloqueo no adquirido) y `5c` (lock que devuelve `false`: mismo fallo sin escribir).

3. **Equilibrio de bloqueos (`releaseLock === adquisiciones`):**
   - Comprobado en `test/t038_bloqueo.test.js` en todos los casos con éxito (`1a`, `1b`, `1c`, `1d`, `4`, `5a`): tras cada operación correcta, `lock.adquisiciones > 0`, `lock.liberaciones === lock.adquisiciones` y `lock.bloqueado === false`.

4. **Suite completa `node test/run_all.js` con 0 fallos y sin modificar pruebas existentes:**
   - Ejecutado `node test/run_all.js`: **44/44 suites superadas, 446 pruebas superadas, 0 fallos** (salida guardada en `logs/T-038/tests.txt`).
   - Ninguna prueba existente ha sido modificada; solo se ha actualizado el lock por defecto en `test/helpers/mockSheets.js` (regla 3) y se ha añadido `test/t038_bloqueo.test.js`.
