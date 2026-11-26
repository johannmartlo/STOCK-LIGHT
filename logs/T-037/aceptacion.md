# T-037 — Aceptación

Ticket: `docs/tickets/T-037-fecha-corte.md`.
Rama: `ticket/T-037-fecha-corte`, creada desde `main` `f3c0d2b`.
Primer commit de la rama: `14a4e6a`, solo el archivo del ticket sin editar.
Resultado de `node test/run_all.js`: **44 suites, 435 pruebas, 0 fallos**. Salida completa en
`logs/T-037/tests.txt`.

## Aceptación 1 — ventas y recepciones a ambos lados del corte

- **Prueba:** caso 1.
- Con `FECHA_CORTE_IMPORTACION = 2026-11-26`, un CSV de ventas del 25, 26 y 27/11 deja los
  dos primeros en `ANTERIOR_AL_CORTE`:
  - 2 líneas anteriores y contador `lineasAnterioresCorte = 2`;
  - sin movimientos, pendientes ni documentos para esos dos;
  - el del 27 se aplica normal y descuenta stock.
- Lo mismo con un CSV de recepciones (formato T-035): las del 25 y 26 no crean capa ni
  documento; la del 27 crea una capa con su partida.
- La fila de `IMPORTACIONES` guarda `lineas_anteriores_corte = 2`.
- **Prueba:** caso 1.

## Aceptación 2 — reimportación

- **Prueba:** caso 2.
- Al reimportar el mismo CSV, el 25 y el 26 siguen `ANTERIOR_AL_CORTE`; el 27 queda
  `YA_IMPORTADO`. No cambian documentos, movimientos ni importaciones.

## Aceptación 3 — prioridad del corte

- **Prueba:** caso 3.
- Tres documentos del 26/11: uno con cliente excluido, otro con nombre comercial fuera y otro
  con serie ignorada. Los tres quedan `ANTERIOR_AL_CORTE`, sin clasificarse, sin movimientos
  ni pendientes.

## Aceptación 4 — sin corte configurado

- No se configuró corte en las pruebas existentes; las 43 suites anteriores siguen en verde
  sin cambios. La suite completa pasa de 43 a 44 suites por la nueva T-037.

## Aceptación 5 — invariante de 30 semillas

- **Prueba:** caso 5.
- Cada semilla parte de 20 cajas de stock inicial (movimiento manual del 26/11), importa
  recepciones y ventas del 25, 26 y 27/11 en orden rotado y las repite.
- El stock final es `20 + recepciones del 27 − ventas aplicadas del 27`; las recepciones y
  ventas anteriores al corte no dejan movimientos; `comprobarConsistencia().consistente` es
  `true` en las 30 semillas.

## Aceptación 6 — administración

- **Prueba:** caso 4.
- `adminConfigurarFechaCorte('2026-11-26')` devuelve el anterior (`''`) y el nuevo, y guarda
  la propiedad.
- `adminConfigurarFechaCorte('')` la quita y devuelve el anterior.
- Sin propietario lanza `Operación reservada al administrador`.
- Una fecha mal formada (`2026-13-40`) lanza y no cambia el valor previo.

## Aceptación 7 — pruebas

- `node test/run_all.js`: **44 suites, 435 pruebas, 0 fallos**.
- Salida completa en `logs/T-037/tests.txt`.

## Documentación y UI

- `IMPORT_SPECS.md`, sección 2.7: propiedad, estado `ANTERIOR_AL_CORTE`, prioridad, contador,
  no registro en `DOCUMENTOS` y alcance limitado a CSV.
- `docs/PUESTA_EN_MARCHA.md`: paso para fijar el corte tras confirmar el stock inicial.
- `DATA_MODEL.md`: columna `IMPORTACIONES.lineas_anteriores_corte` y propiedad
  `FECHA_CORTE_IMPORTACION`.
- `src/ui/app.html`: fila gris «N líneas anteriores al stock inicial · no cuentan» en la
  tarjeta de previsualización; prueba estática en el caso 6.
