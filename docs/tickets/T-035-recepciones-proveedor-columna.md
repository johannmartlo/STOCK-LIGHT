# T-035 — Recepciones: proveedor en columna y aviso de pareja con pendientes

Rama: `ticket/T-035-recepciones-proveedor-columna`, creada desde `main` = `e0cd99f`. Sensible: **sí** (sin esto no entra ninguna recepción real).
Especificación: 2026-11-26 (tarde). Hallazgo del director técnico al pasar el informe real de recepciones del 23 al 26/11 por la app.

## Problema (verificado con el informe real)
1. **Proveedor en columna.** IT ha configurado el informe de RECEPCIONES con el proveedor **como columna** (`NombreProveedor`), sin filas de grupo `NombreProveedor: …`. La cabecera real es así (datos inventados):
   ```
   FechaCreacion;;Usuario;Almacen;NombreProveedor;FechaRecepcion;CodigoProveedor;Referencia;Recepción;Asociación;DescripcionArticulo;Envase;NroEnvases;ENVDescripcion;NroPalets;PALDescCorta;UnidadesEnvase;Cantidad;Partida;CodigoFinca;Finca;DescFinca;Cultivo;Palet
    - ;Empresa: EMPRESA FICTICIA SL;;;;;;;;;;;;;;;;;;;;;;
   ;23/11/2026;USUARIO;ALMACEN UNO;PROVEEDOR FICTICIO UNO SL;23/11/2026;40000000001;;/11724 (1);;TOMATE FICTICIO I  KG;CARTON 40x30x14 FICTICIA;104,000;CARTON 40x30x14 FICTICIA;1,000;PALET 1000x1200;5,400;562,000;900001;;;;;PALET MADERA 1000x1200
   ```
   El lector de T-032 solo toma el proveedor de las filas de grupo, así que **las 86 líneas reales salen `ERROR_DATOS` («Proveedor no encontrado»)**.
2. **Aviso `SIN_PAREJA_EN_VENTAS` con ruido.** Solo mira CATALOGO y las SALIDAS aplicadas. Cuando las ventas de esos artículos están en PENDIENTES (por ejemplo, porque se importaron antes que las recepciones), todos los artículos salen «sin pareja», aunque tengan ventas.

## Reglas
1. En el formato RECEPCIONES, si la cabecera tiene la columna `NombreProveedor`, la entidad de cada fila de datos es el **valor de esa columna**. Si la columna no existe o la celda está vacía, se usa como hoy la última fila de grupo `NombreProveedor: …`. Si no hay ninguna de las dos → `ERROR_DATOS` como hoy.
2. La detección de RECEPCIONES no cambia (las columnas obligatorias siguen siendo las mismas; `NombreProveedor` es opcional).
3. `SIN_PAREJA_EN_VENTAS`: un artículo también tiene pareja si aparece en **PENDIENTES** con `tipo_doc = SALIDA` (cualquier estado).
4. Nada más cambia: series, partida, equivalencias, fuente única, versiones y exclusiones funcionan igual.

## Aceptación
1. **Fixture nuevo ficticio** `test/fixtures/csv/recepciones_proveedor_columna.csv` con la estructura exacta de arriba: CRLF, fila de empresa, 3 proveedores en columna, recepciones sin serie y RNT, sufijos KG/UNID, filas vacías finales, una fila con la celda de proveedor vacía y sin fila de grupo previa (→ `ERROR_DATOS`). **Nada de datos reales.** Añádelo a `.gitattributes` como el de T-032.
2. **Prueba nueva:** con ese fixture, cada línea válida crea su capa con el proveedor de la columna, su fecha, cajas y partida; la fila sin proveedor da `ERROR_DATOS`.
3. **Prueba nueva:** el fixture de T-032 (proveedor en filas de grupo) sigue funcionando igual.
4. **Prueba nueva:** importar primero unas ventas que quedan pendientes y después la recepción de ese artículo → la previsualización **no** lleva `SIN_PAREJA_EN_VENTAS` para ese artículo.
5. Reimportar el fixture nuevo da `YA_IMPORTADO`.
6. `node test/run_all.js` con 0 fallos, salida en `logs/T-035/tests.txt`.

## Archivos previstos
- `src/importacion/CsvHispatecParser.js` (regla 1)
- `src/importacion/ImportacionService.js` (solo `_articulosConVenta_`, regla 3)
- `IMPORT_SPECS.md` (documentar las dos variantes del informe)
- `test/t035_recepciones_columna.test.js`, `test/fixtures/csv/recepciones_proveedor_columna.csv` (nuevos, ficticios), `.gitattributes`
- `docs/tickets/T-035-recepciones-proveedor-columna.md` (este ticket, primer commit, sin editar)
- `logs/T-035/*`

**No toques** nada más. Si necesitas otro archivo, para y pregunta.

## Entrega
Escribe en `logs/T-035/informe.md`: resumen de 5 líneas, `git status`, `git log --oneline -5` y **«Dudas»** con TODO cambio no pedido.
