# T-026 — Aceptación

Ticket: `docs/tickets/T-026-deuda-menor.md`.
Rama: `ticket/T-026-deuda-menor`, creada desde `origin/main` `bb816bc`.
Primer commit de la rama: solo el archivo del ticket, sin editar.
Resultado de `node test/run_all.js`: **32 suites, 347 pruebas, 0 fallos**. Salida completa en
`logs/T-026/tests.txt`.

## Aceptación 1 — desconocida sin stock y aplicación posterior

- **Prueba:** `test/t026_deuda_menor.test.js`, caso 1.
- Se importa una venta de 15 cajas de `CALABACIN DEUDA`, un artículo sin regla de
  seguimiento. El documento queda `PENDIENTE_REVISION` y con `total_cajas = 0`.
- Se añade al final la regla que lo hace SEGUIDA y se reintenta **sin stock**:
  - no se aplica ningún movimiento;
  - el pendiente pasa a `STOCK_INSUFICIENTE`;
  - el documento sigue `PENDIENTE_REVISION`, pero `total_cajas` ya es 15.
- Se añade stock (compra de 50 cajas) y se reintenta de nuevo:
  - el movimiento de salida se aplica;
  - el documento queda `CONFIRMADO`;
  - `total_cajas` sigue siendo 15, no 30;
  - `total_cajas` = suma de las cajas de los movimientos `ENTRADA`/`SALIDA` confirmados del
    documento.

## Aceptación 2 — aplicada en el mismo reintento

- **Prueba:** caso 2.
- Se importa una venta de 20 cajas del mismo artículo desconocido.
- Se carga stock antes de añadir la regla y se añade la regla de seguimiento.
- Un único `reintentarPendientes` aplica la línea: el documento queda `CONFIRMADO`,
  `total_cajas = 20` y la suma de sus movimientos es 20. No se suma dos veces.

## Aceptación 3 — 30 semillas de días desordenados

- **Prueba:** caso 3.
- Se ejecutan 30 semillas independientes. Cada semilla importa 5 documentos en un orden de
  fechas no cronológico:
  - venta de un artículo desconocido (`CALABACIN SEMILLA`), 5 cajas;
  - venta de un artículo conocido, 10 cajas;
  - segunda venta del desconocido, 7 cajas;
  - compra de 20 cajas del artículo conocido;
  - al final, una compra grande de 1000 cajas del desconocido, que desbloquea todo.
- En cada semilla, antes de la compra grande se añade la regla de seguimiento al final y se
  reintenta sin stock: los dos documentos de venta del desconocido quedan con
  `total_cajas = 5` y `7` respectivamente, aunque sigan pendientes.
- Tras la compra grande, los 150 documentos (30 × 5) quedan `CONFIRMADO` y en todos se
  cumple `total_cajas` = suma de cajas de sus movimientos `ENTRADA`/`SALIDA` confirmados.
- Se reimportan los 5 CSV de cada semilla y no aparece ninguna fila `MODIFICADO_EN_ERP`.

## Aceptación 4 — pruebas

- `node test/run_all.js`: **32 suites, 347 pruebas, 0 fallos**.
- Salida completa en `logs/T-026/tests.txt`.

## Documentación

- `DATA_MODEL.md`:
  - `DOCUMENTOS.total_cajas` describe las cajas de las líneas seguidas, aplicadas o
    pendientes de stock, excluyendo ignoradas y seguimiento desconocido.
  - `origen_dato` de `MOVIMIENTOS` y `CAPAS_FIFO` incluye `STOCK_INICIAL`.
  - Nueva sección 3.12 con los motivos de copia `DIARIA`, `MANUAL`, `PRE_DESPLIEGUE` y
    `PRE_STOCK_INICIAL`, su creación y retención.
- `docs/RESTAURAR_COPIA.md`:
  - la lista de motivos incluye `PRE_STOCK_INICIAL`;
  - nueva sección que explica cuándo se crea y cómo restaurarla si una carga de stock
    inicial sale mal.
