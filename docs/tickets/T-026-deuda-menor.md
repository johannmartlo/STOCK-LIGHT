# T-026 — Deuda menor de T-008 y T-011

Rama: `ticket/T-026-deuda-menor`, creada desde `main` = `bb816bc`. Sensible: **sí** (toca el reintento de pendientes). Va en paralelo con T-024 (pantallas) y T-025 (servidor de operaciones): no toques sus archivos.
Especificación: 2026-11-25. Origen: verificación de T-008 (duda 2 de su informe) y de T-011 (dudas 9 y 10).

## Problema
1. **`DOCUMENTOS.total_cajas` se queda corto.** En `PendientesService.reintentarPendientes`, una fila `SEGUIMIENTO_DESCONOCIDO` que pasa a SEGUIDA:
   - si se aplica en ese reintento, suma sus cajas a `total_cajas`;
   - si no entra por stock, pasa a `STOCK_INSUFICIENTE`, y cuando se aplica más tarde **ya no las suma**.

   El documento confirmado queda con `total_cajas` menor que sus movimientos. Solo afecta a la diferencia que muestra una fila `MODIFICADO_EN_ERP`, pero el dato debe ser correcto.
2. `DATA_MODEL.md` no recoge `origen_dato = 'STOCK_INICIAL'` ni el motivo de copia `PRE_STOCK_INICIAL`.
3. `docs/RESTAURAR_COPIA.md` no menciona la copia `PRE_STOCK_INICIAL`.

## Reglas
1. **Significado de `total_cajas`:** las cajas de las líneas **seguidas** del documento, aplicadas o pendientes de stock. No cuentan las ignoradas ni las que siguen con seguimiento desconocido.
2. **Corrección:** cuando una fila `SEGUIMIENTO_DESCONOCIDO` pasa a SEGUIDA, sus cajas se suman a `total_cajas` **una sola vez, en ese momento**, tanto si se aplica ya como si pasa a `STOCK_INSUFICIENTE`. Al aplicarse después, no se vuelven a sumar.
3. **Documentación:**
   - en `DATA_MODEL.md`, añade `STOCK_INICIAL` a `origen_dato`, `PRE_STOCK_INICIAL` a los motivos de copia, y el significado de `total_cajas` de la regla 1;
   - en `docs/RESTAURAR_COPIA.md`, añade cuándo se crea la copia `PRE_STOCK_INICIAL` y cómo restaurarla si una carga de stock inicial sale mal.

## Aceptación
1. **Prueba nueva:** una línea desconocida pasa a SEGUIDA sin stock (motivo `STOCK_INSUFICIENTE`) y se aplica en un reintento posterior. El documento acaba `CONFIRMADO` con `total_cajas` = suma de las cajas de sus movimientos.
2. **Prueba nueva:** la misma línea aplicada en el mismo reintento suma sus cajas una sola vez.
3. **Prueba nueva (semillas):** con 30 semillas de días desordenados (ventas antes que compras, reglas añadidas al final y una compra grande que desbloquea todo), en todo documento `CONFIRMADO`, `total_cajas` = suma de las cajas de sus movimientos `ENTRADA`/`SALIDA` confirmados. Reimportar todos los CSV no crea filas `MODIFICADO_EN_ERP`.
4. `node test/run_all.js` con 0 fallos, salida en `logs/T-026/tests.txt`.

## Archivos previstos
- `src/importacion/PendientesService.js` (solo el cálculo de `total_cajas`)
- `DATA_MODEL.md`, `docs/RESTAURAR_COPIA.md`
- `test/t026_deuda_menor.test.js` (nuevo)
- `docs/tickets/T-026-deuda-menor.md` (este ticket, primer commit, sin editar)
- `logs/T-026/tests.txt`, `logs/T-026/informe.md`

Si necesitas otro, para y pregunta. **No toques** `src/Index.html`, `src/ui/`, `src/InicioService.js`, `src/OperacionesService.js`, `src/Código.js`, `src/Seguridad.js`, `docs/API_PUBLICA.md`, `src/MovementService.js`, `src/Libro.js` ni `src/InventoryEngine.js`.

## Entrega
Escribe en `logs/T-026/informe.md`:
- un resumen de 5 líneas;
- la salida de `git status` y de `git log --oneline -5`;
- **«Dudas»** con TODO cambio no pedido por el ticket.
