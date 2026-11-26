# T-035 — Aceptación

Ticket: `docs/tickets/T-035-recepciones-proveedor-columna.md`.
Rama: `ticket/T-035-recepciones-proveedor-columna`, creada desde `main` `e0cd99f`.
Primer commit de la rama: `7245877`, solo el archivo del ticket sin editar.
Resultado de `node test/run_all.js`: **43 suites, 429 pruebas, 0 fallos**. Salida completa en
`logs/T-035/tests.txt`.

## Aceptación 1 — fixture con proveedor en columna

- **Archivo:** `test/fixtures/csv/recepciones_proveedor_columna.csv`.
- Cabecera exacta con `Usuario` y `NombreProveedor` en columna, fila de empresa, sin filas
  de grupo `NombreProveedor:`.
- Tres proveedores distintos en la columna, recepciones sin serie y `RNT27/26 (2)`, sufijos
  `KG`/`UNID`, una fila con la celda de proveedor vacía y filas vacías finales.
- CRLF, UTF-8 sin BOM y con `Ñ`; todos los datos son ficticios.
- **Prueba:** caso 1, que comprueba cabecera, CRLF, `Ñ`, ausencia de filas de grupo y los
  cinco registros leídos.

## Aceptación 2 — capas y fila sin proveedor

- **Prueba:** caso 1.
- La previsualización da 4 líneas `OK` y 1 `ERROR_DATOS`.
- Las 4 capas llevan el proveedor de la columna, fecha `2026-11-23`, cajas y partida:
  - `900001` y `900002` → `TOMATE FICTICIO I`, proveedor `PROVEEDOR FICTICIO ÑANDÚ UNO SL`;
  - `900003` → `TOMATE FICTICIO II`, proveedor `PROVEEDOR FICTICIO DOS SL`;
  - `900004` → `TOMATE FICTICIO III`, proveedor `PROVEEDOR FICTICIO TRES SL`.
- La fila con la celda `NombreProveedor` vacía y sin grupo previo queda `ERROR_DATOS`
  (`Proveedor no encontrado`) y no genera movimiento.

## Aceptación 3 — el fixture de T-032 sigue funcionando

- **Prueba:** caso 2.
- `recepciones_formato_real.csv` (proveedor en filas de grupo) sigue detectándose como
  `RECEPCIONES`, con 4 líneas `OK`, 1 `ERROR_DATOS` y las capas con sus proveedores de
  grupo.

## Aceptación 4 — ventas pendientes cuentan como pareja

- **Prueba:** caso 3.
- Se importa primero una venta de `TOMATE FICTICIO I` sin stock; queda en `PENDIENTES` con
  `tipo_doc = SALIDA`.
- La previsualización posterior de recepciones no lleva `SIN_PAREJA_EN_VENTAS` para
  `TOMATE FICTICIO I`, ni en la línea ni en el array superior de avisos.

## Aceptación 5 — reimportación

- **Prueba:** caso 4.
- Reimportar el fixture nuevo devuelve `YA_IMPORTADO`; no cambian documentos, movimientos ni
  importaciones.

## Aceptación 6 — pruebas

- `node test/run_all.js`: **43 suites, 429 pruebas, 0 fallos**.
- Salida completa en `logs/T-035/tests.txt`.

## Documentación

- `IMPORT_SPECS.md`, sección 2.6: variante con `NombreProveedor` en columna, prioridad de la
  columna sobre el grupo, columna opcional y aviso con ventas pendientes.
- `.gitattributes`: excepción de CRLF para el fixture nuevo.
