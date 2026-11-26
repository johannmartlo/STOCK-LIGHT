# T-030 — Aceptación

Ticket: `docs/tickets/T-030-lector-por-columnas.md`.
Rama: `ticket/T-030-lector-por-columnas`, creada desde `origin/main` `e9abb1f`.
Primer commit de la rama: `4b01200`, solo el archivo del ticket sin editar.
Resultado de `node test/run_all.js`: **36 suites, 361 pruebas, 0 fallos**. Salida completa en
`logs/T-030/tests.txt`.

## Aceptación 1 — fixtures nuevos con cabeceras reales exactas

- **Archivos:** `test/fixtures/csv/compras_formato_real.csv` y
  `test/fixtures/csv/ventas_formato_real.csv`.
- Compras usa la cabecera real de 25 columnas, en ASCII, con CRLF, decimales con coma y una
  compra de dos líneas. Ventas usa la cabecera real de 19 columnas, en UTF-8, con `Albarán`,
  `ÑANDÚ`, CRLF, decimales con coma y una venta de dos líneas.
- Los dos terminan con una fila formada solo por separadores (`;;;;…`).
- Todos los nombres, clientes, proveedores y números son inventados; no hay datos reales.
- **Prueba:** `test/t030_lector_por_columnas.test.js`, caso 1: comprueba CRLF, UTF-8 con Ñ y
  tilde, fila final de separadores y los dos documentos.

## Aceptación 2 — detección, previsualización y confirmación

- **Prueba:** caso 1.
- `detectarTipo` devuelve `COMPRAS` y `VENTAS`.
- `parsear` devuelve 2 líneas por informe y `errores: []`.
- La previsualización no tiene `ERROR_DATOS`; la compra y la venta se confirman.
- Stock resultante: `TOMATE FICTICIO / CAJA FICTICIA` = 7 cajas y
  `TOMATE FICTICIO DOS / CAJA FICTICIA` = 3 cajas (10+5 comprados, 3+2 vendidos).
- No hay documentos fantasma ni pendientes.

## Aceptación 3 — misma firma y mismo stock en formato antiguo y real

- **Prueba:** caso 2.
- Se construyen los mismos documentos con las cabeceras antiguas y se importan en entornos
  separados.
- `firma_lineas` coincide para `COMPRA|ACT26|9001` y `SALIDA|AVT26|9001`; el stock coincide.
- Al reimportar el formato antiguo en el entorno que ya tiene el real, la previsualización
  devuelve `YA_IMPORTADO`, no se duplican movimientos y no aparece `MODIFICADO_EN_ERP`.

## Aceptación 4 — orden, columnas obligatorias y columnas extra

- **Prueba:** caso 3.
- Cabeceras con todas las columnas en orden inverso: se detectan y producen exactamente las
  mismas líneas canónicas.
- Eliminar `NombreEnvaseAC` de compras: `detectarTipo` lanza un error que nombra
  `NombreEnvaseAC`.
- Añadir una columna desconocida: se ignora y las líneas no cambian.
- Cabecera en mayúsculas: se detecta y produce las mismas líneas.
- Ventas reales sin `Palet` (opcional en el formato real): se detectan y parsean igual.
- Una venta del formato antiguo con `Numero` distinto de `Albarán` deja `numero = null` y un
  aviso de `numero` (la línea queda en `ERROR_DATOS` al clasificarse).

## Aceptación 5 — precios e importes ignorados

- **Prueba:** caso 4.
- Tras importar compras y ventas reales, se recorren todas las hojas y ninguna celda contiene
  `PrecioFunc`, `UdPrecio`, `ImporteNetoFunc`, `4321,09`, `4321.09`, `8765,43` ni
  `8765.43`.
- El stock sigue siendo el esperado (7 cajas).

## Aceptación 6 — pruebas

- `node test/run_all.js`: **36 suites, 361 pruebas, 0 fallos**.
- Salida completa en `logs/T-030/tests.txt`.

## Documentación

- `IMPORT_SPECS.md`, apartado 2.4: cabeceras reales de compras y ventas, columnas
  obligatorias, detección por nombre, opcionales, precios ignorados, filas vacías, CRLF,
  UTF-8, decimales con coma y firma de líneas.
