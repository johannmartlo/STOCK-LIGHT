# T-031 — Aceptación

Ticket: `docs/tickets/T-031-exclusiones.md`.
Rama: `ticket/T-031-exclusiones`, creada desde `origin/main` `c1cbdbe`.
Primer commit de la rama: `e788b0d`, solo el archivo del ticket sin editar.
Resultado de `node test/run_all.js`: **37 suites, 367 pruebas, 0 fallos**. Salida completa en
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
  `total_cajas = 0`.
- Al reimportar el mismo CSV, `confirmar` devuelve `YA_IMPORTADO`; no se crean documentos,
  movimientos, pendientes ni importaciones nuevas.

## Aceptación 5 — 30 semillas

- **Prueba:** caso 5.
- 30 entornos independientes mezclan compras y ventas en orden rotado, con:
  - ventas a dos clientes excluidos;
  - ventas de dos nombres comerciales fuera;
  - ventas normales antes o después de las compras (con pendientes temporales).
- Al final:
  - stock de los artículos seguidos = compras − ventas normales aplicadas
    (15 y 11 cajas);
  - stock de los nombres fuera = 0;
  - ningún movimiento procede de un cliente excluido ni de un nombre comercial fuera;
  - no quedan pendientes activos;
  - `comprobarConsistencia().consistente === true` en las 30 semillas.

## Aceptación 6 — API

- **Prueba:** caso 6.
- `PERMISOS_API.apiListarExclusiones === 'CONSULTA'`.
- `apiListarExclusiones()` sin sesión lanza `Acceso no autorizado`.
- Dentro de un contexto CONSULTA devuelve `{ clientesExcluidos, articulosFuera }` con las
  dos listas normalizadas.
- `t020_acceso.test.js` sigue en verde (18 pruebas).

## Aceptación 7 — pruebas

- `node test/run_all.js`: **37 suites, 367 pruebas, 0 fallos**.
- Salida completa en `logs/T-031/tests.txt`.

## Documentación

- `BUSINESS_RULES.md`, sección 8: clientes excluidos y nombres comerciales fuera, con
  ejemplos ficticios.
- `IMPORT_SPECS.md`, sección 2.5: estados, recuento, configuración y ejemplos ficticios.
- `DATA_MODEL.md`: hoja `CLIENTES_EXCLUIDOS` (3.13) y columna
  `IMPORTACIONES.lineas_cliente_excluido`.
- `docs/API_PUBLICA.md`: `apiListarExclusiones` (LECTURA) y las dos funciones `admin*`
  (ADMIN).
