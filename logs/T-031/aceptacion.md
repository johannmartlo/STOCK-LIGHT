# T-031 — Aceptación

Ticket: `docs/tickets/T-031-exclusiones.md`.
Rama: `ticket/T-031-exclusiones`, creada originalmente desde `origin/main` `c1cbdbe` y
rebasada sobre `9c54b7b` (que incluye T-027).
Primer commit de la rama tras el rebase: `aba247a`, solo el archivo del ticket sin editar.
Resultado de `node test/run_all.js`: **38 suites, 383 pruebas, 0 fallos** (incluye T-027 y
T-031). Salida completa en
`logs/T-031/tests.txt`.

## Aceptación 1 — clientes excluidos

- **Prueba:** `test/t031_exclusiones.test.js`, caso 1.
- `adminConfigurarClientesExcluidos(['CLIENTE FICTICIO'])` añade el patrón.
- Una compra de 10 cajas de TOMATE FICTICIO deja el stock en 10.
- La venta de 3 cajas a «Cliente Ficticio, S.L.» queda `CLIENTE_EXCLUIDO`:
  - la previsualización devuelve `lineasClienteExcluido = 1` y
    `resumen.porEstado.CLIENTE_EXCLUIDO = 1`;
  - no genera movimientos;
  - no va a `PENDIENTES`;
  - la fila de `IMPORTACIONES` guarda `lineas_cliente_excluido = 1`.
- La venta de 2 cajas al mismo artículo a «DESTINATARIO INVENTADO» descuenta stock
  normalmente: el stock queda en 8.

## Aceptación 2 — nombres comerciales fuera

- **Prueba:** caso 2.
- Con `adminConfigurarArticulosFuera(['NOMBRE COMERCIAL X'])`, «TOMATE NOMBRE COMERCIAL X
  EXTRA» queda `NO_SEGUIDA` aunque empiece por TOMATE, porque la regla `SEGUIMIENTO = NO`
  tiene prioridad 1 y gana a la regla «TOMATE → SI» (prioridad 30).
- «TOMATE FICTICIO» sigue siendo `SEGUIDA`.

## Aceptación 3 — idempotencia y propietario

- **Prueba:** caso 3.
- Primera llamada de `adminConfigurarClientesExcluidos` con dos patrones: 2 añadidos.
  Segunda llamada: 0 añadidos y 2 en `yaEstaban`; la hoja sigue con 2 filas.
- Primera llamada de `adminConfigurarArticulosFuera` con dos patrones: 2 añadidos. Segunda:
  0 añadidos y 2 en `yaEstaban`; no se duplican reglas.
- Las dos funciones sin `session` de propietario lanzan
  `Operación reservada al administrador`.

## Aceptación 4 — documento totalmente excluido

- **Prueba:** caso 4.
- Un CSV con dos líneas de venta al `CLIENTE FICTICIO UNO` no crea movimientos ni
  pendientes.
- El documento queda registrado en `DOCUMENTOS` con `estado_proceso = CONFIRMADO` y
  `total_cajas = 0`, y guarda una versión de partida `BASE` (T-031 × T-027).
- Al reimportar el mismo CSV, `confirmar` devuelve `YA_IMPORTADO`; no se crean documentos,
  movimientos, pendientes ni importaciones nuevas.

## Corrección exclusiones × versiones

- **Pruebas:** casos 5 a 9.
- **Caso 5, normal → cliente excluido:** la salida aplicada se anula, el stock vuelve, no
  aparece una salida nueva ni un pendiente `STOCK_INSUFICIENTE`; la versión guarda la línea
  como `CLIENTE_EXCLUIDO` y el pendiente calcula solo cajas que mueven stock (−4).
- **Caso 6, excluida entera → cliente normal:** el albarán excluido guarda su versión
  `BASE`; al aplicar la versión nueva se crea la salida y el stock baja.
- **Caso 7, excluida entera → cambian cajas y sigue excluida:** la versión es válida, se
  aplica sin mover stock, no deja un pendiente imposible y el stock sigue en 0.
- **Caso 8, normal → todas las líneas con nombre fuera:** igual que el caso 5; la versión
  guarda `NO_SEGUIDA`, el stock vuelve y no hay salida nueva.
- **Caso 9, 30 semillas:** compras y ventas en tres lotes desordenados, clientes normales y
  excluidos, un nombre fuera, reimportación completa sin novedades y 1-3 correcciones por
  semilla. Tras cada paso se comprueba `comprobarConsistencia`, consumos por capa =
  `cajas_consumidas` y ausencia de stock del nombre fuera. Al final:
  `(compras − stock) + pendientes por stock = ventas vigentes a clientes no excluidos`.

## Aceptación 5 — 30 semillas

- **Prueba:** caso 9.
- 30 entornos independientes mezclan compras y ventas en lotes desordenados, con:
  - ventas a clientes excluidos;
  - ventas de un nombre comercial fuera;
  - ventas normales antes o después de las compras (con pendientes temporales).
- Al final:
  - la ecuación `(compras − stock) + pendientes por stock = ventas vigentes` se cumple;
  - no hay stock de nombres fuera;
  - los consumos por capa coinciden con `cajas_consumidas`;
  - `comprobarConsistencia().consistente === true` en las 30 semillas.

## Aceptación 6 — API

- **Prueba:** caso 10.
- `PERMISOS_API.apiListarExclusiones === 'CONSULTA'`.
- `apiListarExclusiones()` sin sesión lanza `Acceso no autorizado`.
- Dentro de un contexto CONSULTA devuelve `{ clientesExcluidos, articulosFuera }` con las
  dos listas normalizadas.
- `t020_acceso.test.js` sigue en verde (18 pruebas).

## Aceptación 7 — pruebas

- `node test/run_all.js`: **38 suites, 383 pruebas, 0 fallos** (incluye las 12 pruebas de
  T-027 y las 10 de T-031).
- Salida completa en `logs/T-031/tests.txt`.

## Documentación

- `BUSINESS_RULES.md`, sección 9: clientes excluidos y nombres comerciales fuera, con
  ejemplos ficticios.
- `IMPORT_SPECS.md`, sección 2.5: estados, recuento, configuración y ejemplos ficticios.
- `DATA_MODEL.md`: hoja `CLIENTES_EXCLUIDOS` (3.13) y columna
  `IMPORTACIONES.lineas_cliente_excluido`.
- `docs/API_PUBLICA.md`: `apiListarExclusiones` (LECTURA) y las dos funciones `admin*`
  (ADMIN).
