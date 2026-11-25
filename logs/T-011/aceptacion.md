# T-011 — Aceptación

Ticket: `docs/tickets/T-011-puesta-en-marcha.md` (carril B).
Rama: `ticket/T-011-puesta-en-marcha`, creada desde `origin/main` `c99e7d4`.
Primer commit de la rama: solo el archivo del ticket, sin editar.
Resultado de `node test/run_all.js`: **31 suites, 344 pruebas, 0 fallos**. Salida completa en
`logs/T-011/tests.txt`.

## Aceptación 1 — instalación idempotente

- **Prueba:** `test/t011_puesta_en_marcha.test.js`, caso 1.
- La primera ejecución de `adminInstalarStockLight('Ana Ficticia', ...)` provisiona las hojas,
  siembra el catálogo vacío, instala la copia diaria y crea el primer ADMIN con su enlace.
- La segunda ejecución devuelve `hecho: []` y `sinCambios: true`; informa en `yaEstaba` de
  hojas, catálogo, copia diaria y usuario ADMIN. No duplica usuarios ni reglas.
- Con un catálogo ya existente (`ATRIBUTOS` y `REGLAS_CLASIFICACION` no vacíos) no se siembra
  ni se pisa la regla propia `REGLA_PROPIA`.
- El primer ADMIN se crea una sola vez: la segunda ejecución mantiene un único usuario.

## Aceptación 2 — sin configuración no se escribe

- **Prueba:** caso 2.
- Sin `SPREADSHEET_ID`, el informe incluye `configurarSpreadsheetId(...)` y no crea ninguna
  hoja (`env.ss.sheets.size === 0`).
- Sin `DRIVE_FOLDER_ID`, incluye `configurarDriveFolderId(...)` y tampoco escribe.
- La comprobación de ambas configuraciones se hace antes de `provisionDatabase`, para no
  dejar hojas creadas a medias.

## Aceptación 3 — CSV de ejemplo, capas y totales

- **Prueba:** caso 3.
- `test/fixtures/csv/stock_inicial_ejemplo.csv` tiene 3 filas ficticias:
  - 20/10/2026, PROVEEDOR FICTICIO UNO, TOMATE FICTICIO / CAJA FICTICIA, 10 cajas, 50 kg.
  - 21/10/2026, PROVEEDOR FICTICIO DOS, TOMATE FICTICIO / CAJA FICTICIA, 5 cajas, 25 kg.
  - 21/10/2026, PROVEEDOR FICTICIO UNO, PEPINO FICTICIO / CAJA FICTICIA, 8 cajas, sin kg.
- La previsualización da 3 filas `OK`, 23 cajas y totales por artículo + envase (15 y 8) y
  por proveedor (18 y 5).
- La confirmación crea 3 capas, una por fila, con su fecha y proveedor; la suma de
  `cajas_iniciales` coincide con el total de la previsualización.
- También se comprueba la cabecera sin `Kg`: `Fecha;Proveedor;Articulo;Envase;Cajas`.
- `comprobarConsistencia().consistente === true`.
- El movimiento lleva `motivo_ajuste = STOCK_INICIAL`, `origen_dato = STOCK_INICIAL`, signo +1
  y `fecha_negocio` de la fila. Se registra una línea en `LOG_OPERACIONES` con el hash y las
  cajas.

## Aceptación 4 — bloqueos y avisos

- **Prueba:** caso 4.
- Una fila `ARTICULO DESCONOCIDO` queda `DESCONOCIDA`; una fila con `Cajas = 0` queda
  `ERROR_DATOS` con motivo `CAJAS_INVALIDAS`. La previsualización marca `bloquea: true`,
  `bloqueos: 2`; la confirmación devuelve `BLOQUEADA` y no escribe nada.
- Una fila `CALABACIN NO SEGUIDO` (regla de seguimiento NO) queda `NO_SEGUIDA`; se salta.
- Una fila `TOMATE FICTICIO NUEVO` (regla de seguimiento SÍ, pero ausente de `CATALOGO`)
  queda `OK` con aviso `NO_VISTA`; se carga.
- En la carga sin bloqueos: 2 capas (la `OK` y la `NO_VISTA`), 1 fila saltada y 2 avisos
  `NO_VISTA` (la `NO_SEGUIDA` tampoco está en `CATALOGO`).

## Aceptación 5 — segunda carga

- **Prueba:** caso 5.
- Tras la primera carga, una segunda confirmación sin `anadir` devuelve
  `YA_HAY_MOVIMIENTOS`, no escribe y no crea otra copia.
- Con `anadir: true` se añade: se duplican movimientos y capas (6 capas) y se crea una segunda
  copia `PRE_STOCK_INICIAL`.

## Aceptación 6 — todo o nada

- **Prueba:** caso 6.
- Si la copia previa falla, `confirmar` devuelve `COPIA_FALLIDA` y no deja movimientos ni
  capas.
- Si una fila falla durante `_aplicar` (fallo simulado en la segunda fila), devuelve
  `ERROR_APLICACION` y no queda ningún movimiento ni capa de la carga: no se llama a
  `_persistir`.

## Aceptación 7 — FIFO

- **Prueba:** caso 7.
- Se cargan dos partidas de TOMATE FICTICIO / CAJA FICTICIA: 5 cajas del 01/10/2026 y 10 del
  10/10/2026.
- Una venta de 7 cajas importada con T-007 (15/10/2026) consume 5 de la capa antigua y 2 de
  la nueva; el stock queda en 8 cajas.

## Aceptación 8 — pendiente de T-008

- **Prueba:** caso 8.
- Una venta de 30 cajas de T-007 sin stock queda en `PENDIENTES` como `STOCK_INSUFICIENTE`.
- Al confirmar el stock inicial de 50 cajas, `StockInicialService` lanza
  `reintentarPendientes`: el resultado devuelve `aplicados.STOCK_INSUFICIENTE === 1`, el
  pendiente pasa a `APLICADA`, el documento a `CONFIRMADO` y el stock queda en 20.

## Aceptación 9 — API y roles

- **Prueba:** caso 9.
- `apiPrevisualizarStockInicial` y `apiConfirmarStockInicial` llamadas directamente lanzan
  `Acceso no autorizado`.
- `PERMISOS_API` las declara con rol `ADMIN`.
- Un `ENCARGADO` recibe `PERMISO_DENEGADO` al intentar previsualizar y al intentar confirmar.
- Un `ADMIN` puede previsualizar por `apiLlamar` y recibe las 3 filas del CSV.
- `test/t020_acceso.test.js` sigue en verde (18 pruebas), incluida su cobertura de funciones
  LECTURA/ESCRITURA con guarda y `PERMISOS_API`.

## Aceptación 10 — pruebas

- `node test/run_all.js`: **31 suites, 344 pruebas, 0 fallos**.
- Salida completa en `logs/T-011/tests.txt`.

## Documentación y archivos

- `docs/PUESTA_EN_MARCHA.md`: pasos numerados para DEV/PROD, clasp, primera instalación,
  stock inicial, regla de corte y despliegue sin cambiar la URL.
- `docs/reference/stock_inicial_plantilla.csv`: solo la cabecera.
- `test/fixtures/csv/stock_inicial_ejemplo.csv`: datos ficticios.
- `docs/API_PUBLICA.md`: clasificadas las cinco funciones nuevas.
- `src/Repository.js`: hoja `STOCK_INICIAL_ENTRADA` en `SCHEMA_DEFINITIONS`, antes de
  `USUARIOS` para que `USUARIOS` siga siendo la última hoja que exige T-020.
- `src/BackupService.js`: motivo `PRE_STOCK_INICIAL` admitido (autorizado expresamente por el
  responsable; no estaba en «Archivos previstos»).
