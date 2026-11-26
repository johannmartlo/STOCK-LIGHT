# T-038 — URGENTE: el bloqueo falla siempre en Apps Script real

Rama: `ticket/T-038-bloqueo-apps-script`, creada desde `main` = `f3c0d2b`. Sensible: **MUCHO** (sin esto no funciona ninguna operación que escribe).
Especificación: 2026-11-26 (22:30). Detectado al cargar el stock inicial en DEV: «No se pudo adquirir el bloqueo de concurrencia tras 30000ms. Otra operación está en curso», en 4 segundos y sin ninguna otra ejecución en marcha.

## Causa (verificada)
En Google Apps Script, `Lock.waitLock(timeoutMs)` **no devuelve nada** (`undefined`) cuando consigue el bloqueo y **lanza una excepción** si no lo consigue. `tryLock(timeoutMs)` es la que devuelve `true`/`false`.

El código trata `waitLock` como si devolviera un booleano:
- `src/MovementService.js`, `_acquireLock`: `const success = this.lock.waitLock(timeoutMs); if (!success) throw …` → en Apps Script `success` es `undefined` y **lanza siempre**. Por aquí pasan importar, stock inicial, cambios, destrío, ajustes, pendientes, correcciones y anulaciones.
- `src/BackupService.js`, `_escribirLogCopia_`: `bloqueado = lock.waitLock(10000); if (!bloqueado) throw …` → mismo fallo.

Las pruebas no lo detectan porque el simulador (`test/helpers/mockSheets.js`) devuelve `true` en `waitLock`. `src/Seguridad.js` (`_conBloqueo_`) ya lo hace bien: llama a `waitLock` y da por bueno que no lance.

## Reglas
1. **`MovementService._acquireLock(timeoutMs)`:**
   - si hay `waitLock`: llamarlo dentro de `try`; si **lanza**, o si devuelve **exactamente `false`** (compatibilidad con simuladores), lanzar el error de siempre («No se pudo adquirir el bloqueo de concurrencia tras …ms. Otra operación está en curso.»). `undefined` o `true` = conseguido;
   - si no hay `waitLock` pero sí `tryLock`: usar `tryLock(timeoutMs)` y lanzar si devuelve `false`;
   - sin lock: no hace nada (como hoy).
2. **`BackupService._escribirLogCopia_`:** la misma lógica (`bloqueado = true` salvo excepción o `false` explícito).
3. **Simulador realista:** en `test/helpers/mockSheets.js`, el lock por defecto pasa a comportarse como Apps Script: `waitLock` devuelve `undefined` (y lleva la cuenta de bloqueos/liberaciones). **No cambies ninguna otra prueba**: deben seguir pasando todas con el simulador nuevo. Si alguna falla, es otro sitio con el mismo error: corrígelo en `src/` y anótalo en «Dudas».
4. Busca en `src/` cualquier otro uso del valor devuelto por `waitLock` y corrígelo igual; lista cada uno en el informe.

## Aceptación
1. **Prueba nueva** `test/t038_bloqueo.test.js` con tres locks simulados:
   - estilo Apps Script (`waitLock` devuelve `undefined`): `registrarAjustePositivo`, una importación de CSV, el stock inicial (con la copia simulada) y un reproceso funcionan;
   - `waitLock` que **lanza**: la operación falla con el mensaje de bloqueo y **no escribe nada** (mismas filas en MOVIMIENTOS, CAPAS_FIFO y STOCK_ACTUAL);
   - `waitLock` que devuelve `false`: igual que el anterior.
2. **Prueba nueva:** `_escribirLogCopia_` con lock estilo Apps Script escribe la línea en LOG_OPERACIONES; con lock que lanza, falla sin escribir.
3. **Prueba nueva:** tras cada operación correcta, el número de `releaseLock` es igual al de bloqueos conseguidos (no se queda ningún bloqueo cogido).
4. `node test/run_all.js` con **0 fallos y ninguna prueba existente modificada** (salvo el simulador de la regla 3), salida en `logs/T-038/tests.txt`.

## Archivos previstos
- `src/MovementService.js` (solo `_acquireLock`), `src/BackupService.js` (solo `_escribirLogCopia_`)
- otros `src/*.js` solo si la regla 4 encuentra el mismo error (lístalos)
- `test/helpers/mockSheets.js` (solo el lock por defecto), `test/t038_bloqueo.test.js` (nuevo)
- `docs/tickets/T-038-bloqueo-apps-script.md` (este ticket, primer commit, sin editar), `logs/T-038/*`

**No toques** nada más. Nada de pantallas.

## Entrega
`logs/T-038/informe.md`: resumen de 5 líneas, la lista de sitios corregidos, `git status`, `git log --oneline -5` y **«Dudas»**.
