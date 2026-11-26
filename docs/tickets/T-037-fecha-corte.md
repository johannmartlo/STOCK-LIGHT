# T-037 — Fecha de corte del stock inicial

Rama: `ticket/T-037-fecha-corte`, creada desde `main` = `f3c0d2b`. Sensible: **MUCHO** (decide qué entra en el stock el primer día).
Especificación: 2026-11-26 (noche). Arranque real el 27/11.

## Problema
El stock inicial sale del Excel del responsable con fecha **26/11** (todo lo vendido y recibido hasta el cierre de ese día). Pero en Hispatec hay recepciones y ventas con fecha ≤ 26/11 que se darán de alta o se exportarán **después** (por ejemplo, entradas del 26/11 que se graban el 27). Si se importan, **se cuentan dos veces**: ya están en el stock inicial. Lo mismo con cualquier albarán antiguo que se corrija o se reexporte más adelante.

## Reglas
1. **Propiedad `FECHA_CORTE_IMPORTACION`** (`yyyy-MM-dd`, vacía por defecto = sin corte, comportamiento actual).
   - `adminConfigurarFechaCorte('2026-11-26')` la fija (propietario, `exigirPropietario_()`); con `''` la quita. Devuelve el valor anterior y el nuevo.
   - Lectura en `src/Config.js` (`getFechaCorteImportacionConfig`), como `FUENTE_ENTRADAS`.
2. **Importación** (`ImportacionService`, previsualizar y confirmar; recepciones, compras y ventas): un **documento** cuya fecha de negocio es **≤ fecha de corte** queda en el estado nuevo **`ANTERIOR_AL_CORTE`**:
   - no genera movimientos ni pendientes ni versiones;
   - **no se registra** en DOCUMENTOS (reimportarlo vuelve a dar `ANTERIOR_AL_CORTE`, nunca `MODIFICADO_EN_ERP`);
   - se cuenta aparte en la previsualización y en IMPORTACIONES (`lineas_anteriores_corte`, columna nueva al final).
   Los documentos con fecha > corte siguen exactamente como hoy.
3. **Prioridad:** el corte se aplica **antes** que serie, seguimiento, exclusiones y equivalencias (un documento anterior al corte nunca llega a clasificarse).
4. **Pantalla Importar** (`src/ui/app.html`, solo la tarjeta de previsualización): si `lineasAnterioresCorte > 0`, fila gris «N líneas anteriores al stock inicial · no cuentan», con `pluraliza`, como la de clientes excluidos.
5. **Stock inicial y reprocesos/ajustes manuales no cambian** (el corte solo afecta a la importación de CSV).
6. **Documentación:** `IMPORT_SPECS.md` y `docs/PUESTA_EN_MARCHA.md` (paso nuevo: tras confirmar el stock inicial, fijar el corte en su fecha).

## Aceptación
1. **Prueba nueva:** con corte 26/11, un CSV de ventas con albaranes del 25/11, 26/11 y 27/11 → los dos primeros `ANTERIOR_AL_CORTE` sin movimientos ni pendientes ni documentos; el del 27 se aplica normal. Igual con un CSV de recepciones (formato de T-035).
2. **Prueba nueva:** reimportar el mismo CSV → los anteriores siguen `ANTERIOR_AL_CORTE`, el del 27 `YA_IMPORTADO`; ninguna fila nueva.
3. **Prueba nueva:** un documento del 26/11 con cliente excluido, nombre fuera o serie ignorada → `ANTERIOR_AL_CORTE` (el corte va primero).
4. **Prueba nueva:** sin corte configurado, todas las pruebas existentes siguen igual (no se modifica ninguna).
5. **Prueba nueva (invariante, 30 semillas):** stock inicial + recepciones y ventas aleatorias con fechas a ambos lados del corte, importadas en lotes desordenados y repetidas → stock = stock inicial + recepciones (> corte) − ventas aplicadas (> corte); `comprobarConsistencia().consistente === true`; ningún movimiento de documentos ≤ corte.
6. **Prueba nueva:** `adminConfigurarFechaCorte` sin propietario lanza; con fecha mal formada lanza sin cambiar nada.
7. `node test/run_all.js` con 0 fallos, salida en `logs/T-037/tests.txt`.

## Archivos previstos
- `src/importacion/ImportacionService.js`, `src/importacion/ClasificadorLineas.js` (si el estado nuevo vive ahí)
- `src/Config.js`, `src/Repository.js` (solo la columna de IMPORTACIONES)
- `src/Exclusiones.js` **o** un archivo nuevo `src/FechaCorte.js` (función `admin*`), `src/Código.js` y `docs/API_PUBLICA.md` (clasificarla)
- `src/ui/app.html` (solo la fila de la regla 4)
- `IMPORT_SPECS.md`, `docs/PUESTA_EN_MARCHA.md`, `DATA_MODEL.md`
- `test/t037_fecha_corte.test.js` (nuevo, datos ficticios)
- `docs/tickets/T-037-fecha-corte.md` (este ticket, primer commit, sin editar), `logs/T-037/*`

**No toques** `MovementService.js`, `Libro.js`, `InventoryEngine.js`, `CorreccionService.js` ni `StockInicialService.js`. **Nada de datos reales.** Si necesitas otro archivo, para y pregunta.

## Entrega
`logs/T-037/informe.md`: resumen de 5 líneas, `git status`, `git log --oneline -5` y **«Dudas»** con TODO cambio no pedido.
