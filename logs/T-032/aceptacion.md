# T-032 — Aceptación

Ticket: `docs/tickets/T-032-lector-recepciones.md`.
Rama: `ticket/T-032-lector-recepciones`, creada desde `main` `81dc81c`.
Primer commit de la rama: `630f1bd`, solo el archivo del ticket sin editar.
Resultado de `node test/run_all.js`: **40 suites, 402 pruebas, 0 fallos**. Salida completa en
`logs/T-032/tests.txt`.

## Aceptación 1 — fixture ficticio con formato real

- **Archivo:** `test/fixtures/csv/recepciones_formato_real.csv`.
- Cabecera exacta de 24 columnas, con las dos columnas sin nombre.
- Filas de empresa, tres grupos `NombreProveedor:`, filas vacías, recepciones sin serie
  (`/11737 (1)`) y con serie (`RNT27/26 (2)`), sufijos `KG`/`UNID` y una fila de datos antes
  del primer proveedor.
- CRLF, UTF-8 sin BOM y con `Ñ`; decimales con coma. Todos los nombres, proveedores, fincas
  y números son inventados.
- **Prueba:** caso 1, que comprueba CRLF, `Ñ`, filas vacías y los cinco documentos leídos.

## Aceptación 2 — detección, capas y fila sin proveedor

- **Prueba:** caso 1.
- `detectarTipo` devuelve `RECEPCIONES`; la previsualización devuelve 4 líneas `OK` y 1
  `ERROR_DATOS`.
- Se crean 4 capas, una por línea válida, con:
  - proveedor del grupo (`PROVEEDOR FICTICIO ÑANDÚ SL`, etc.);
  - fecha `2026-11-23` (de `FechaRecepcion`);
  - cajas de `NroEnvases`;
  - partida de `Partida` (`900001`…`900004`);
  - artículo normalizado y envase.
- La fila sin proveedor anterior queda `ERROR_DATOS` y no genera movimiento.
- Las filas de empresa, proveedor, separadores y finales se saltan sin error.

## Aceptación 3 — una sola fuente de entradas

- **Prueba:** caso 2.
- Con `FUENTE_ENTRADAS = RECEPCIONES`, `previsualizar` de un CSV de COMPRAS lanza
  `Las entradas se importan con el informe de recepciones` y no escribe documentos,
  movimientos ni importaciones.
- `adminConfigurarFuenteEntradas('COMPRAS')` cambia la propiedad y conserva el anterior.
- Con `COMPRAS`, el mismo CSV se previsualiza como `COMPRAS`.
- Sin propietario, `adminConfigurarFuenteEntradas` lanza
  `Operación reservada al administrador`; un valor distinto de `COMPRAS`/`RECEPCIONES`
  también se rechaza.

## Aceptación 4 — nombres, equivalencias y aviso

- **Prueba:** caso 3.
- `TOMATE FICTICIO I KG` y `TOMATE FICTICIO I UNID` se convierten en
  `TOMATE FICTICIO I` (sin sufijo).
- Con la equivalencia `TOMATE FICTICIO II → TOMATE FICTICIO II S/C`, una venta de
  `TOMATE FICTICIO II S/C` consume la partida recibida como `TOMATE FICTICIO II KG`.
- Sin equivalencia, las líneas seguidas sin venta previa llevan
  `SIN_PAREJA_EN_VENTAS` en `linea.avisos` y en `preview.avisos`; no bloquea.
- `adminConfigurarEquivalencias` es idempotente, exige propietario y solo cambia el nombre
  del artículo, nunca el envase.

## Aceptación 5 — reimportación y versión de una recepción

- **Prueba:** caso 4.
- Reimportar el mismo informe devuelve `YA_IMPORTADO`.
- Cambiar las cajas de la recepción `/11737 (1)` da `MODIFICADO_EN_ERP` con su versión.
- `CorreccionService.aplicarVersion` aplica la versión, deja el stock correcto (17 cajas de
  `TOMATE FICTICIO I`) y `comprobarConsistencia().consistente === true`.

## Aceptación 6 — 30 semillas

- **Prueba:** caso 5.
- 30 entornos independientes generan recepciones y ventas ficticias en formato real y las
  importan en orden arbitrario (venta antes o después de la recepción).
- Al final el stock es exactamente `cajas recibidas − ventas aplicadas` y
  `comprobarConsistencia().consistente === true` en las 30 semillas.

## Aceptación 7 — API y administración

- **Prueba:** caso 6.
- `PERMISOS_API.apiListarEquivalencias === 'CONSULTA'`.
- `apiListarEquivalencias()` sin sesión lanza `Acceso no autorizado`; dentro de un contexto
  CONSULTA devuelve `{ equivalencias: [...] }`.
- `adminConfigurarEquivalencias` sin propietario lanza
  `Operación reservada al administrador`.
- `t020_acceso.test.js` sigue en verde.

## Aceptación 8 — pruebas

- `node test/run_all.js`: **40 suites, 402 pruebas, 0 fallos**; incluye T-027, T-031 y T-032.
- Salida completa en `logs/T-032/tests.txt`.

## Documentación

- `IMPORT_SPECS.md`, sección 2.6: formato de recepciones, detección, proveedor por grupo,
  series, partida, normalización, equivalencias, aviso y fuente de entradas.
- `DATA_MODEL.md`, sección 3.14: hoja `EQUIVALENCIAS_ARTICULO`.
- `docs/API_PUBLICA.md`: `apiListarEquivalencias` (LECTURA), `adminConfigurarEquivalencias`
  y `adminConfigurarFuenteEntradas` (ADMIN).
- `docs/PUESTA_EN_MARCHA.md`, paso 6: fuente de entradas y equivalencias.
