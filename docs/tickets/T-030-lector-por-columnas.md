# T-030 — Lector de CSV por nombre de columna (formatos reales de Hispatec)

Rama: `ticket/T-030-lector-por-columnas`, creada desde `main` = `e9abb1f`. Sensible: **sí** (es la puerta de entrada de todo el stock). **Bloquea el ensayo con datos reales.**
Especificación: 2026-11-26. Origen: primera prueba con los CSV reales exportados de Hispatec. `CsvHispatecParser.detectarTipo` exige la cabecera **exacta** y rechaza los dos informes reales («Cabecera CSV de Hispatec no reconocida»).

## Formatos reales (cabeceras copiadas de los informes; no son datos sensibles)
**Compras (informe de entradas):**
```
FechaAlbaran;NombreEmisor;SerieAlbaran;NumeroAlbaran;OrdenLinea;NumeracionProveedor;ReferenciaAC;NombreArticulo;DescripcionArticulo;UnidadesEnvase;CantidadLineaAlbaran;CantidadTotal;ReferenciaLineaAlbaran;ObservacionesLineaAlbaran;CantidadPrecioPor;Factor;PorCada;PesoBrutoLACCA;PesoNetoLACCA;NroPaletsAC;PaletAC;NombrePaletAC;CodigoEnvaseAC;NombreEnvaseAC;CantidadEnvasesAC
```
Respecto a la cabecera prevista, `SerieAlbaran` y `NumeroAlbaran` van en orden inverso.

**Ventas (informe de salidas):**
```
Fecha;Albarán;RefAV;RefLineaAV;NombreCliente;NombreArticulo;Cantidad;PesoNetoEnviado;CantidadPrecioPor;Piezas;Abreviatura;PrecioFunc;UdPrecio;ImporteNetoFunc;PesoNetoVendido;NroEnvases;NombreEnvase;NroPalets;Palet
```
Es otro informe:
- columnas nuevas, entre ellas precios e importes;
- no tiene `Numero`;
- serie, número y línea van en `Albarán` («AVT27/783 (1)»).

**Ambos:**
- terminan en CRLF;
- traen una fila final solo con separadores (`;;;;…`);
- ventas viene en UTF-8 (`Albarán`, nombres con Ñ); compras, en ASCII;
- los decimales llevan coma (`315,000`).

## Reglas
1. **Detección por columnas, no por cabecera exacta:**
   - es **COMPRAS** si están todas las columnas obligatorias de compras (`FechaAlbaran`, `NombreEmisor`, `SerieAlbaran`, `NumeroAlbaran`, `OrdenLinea`, `NombreArticulo`, `NombreEnvaseAC`, `CantidadEnvasesAC`);
   - es **VENTAS** si están las obligatorias de ventas (`Fecha`, `Albarán`, `NombreCliente`, `NombreArticulo`, `NroEnvases`, `NombreEnvase`);
   - las columnas se buscan **por nombre**, en cualquier orden, sin distinguir mayúsculas, espacios sobrantes ni la tilde de `Albarán`;
   - si faltan obligatorias, el error dice **cuáles faltan**, no «cabecera no reconocida».
2. **Opcionales** (`PesoNetoLACCA`, `PesoNetoEnviado`, `NroPalets`…): si están, se usan; si no, quedan vacías.
3. **Ventas:**
   - serie, número y línea salen de `Albarán` como hoy;
   - si existe una columna `Numero`, debe coincidir con la de `Albarán`; si no coincide, es `ERROR_DATOS` en esa línea.
4. **Columnas de precio o importe** (`PrecioFunc`, `ImporteNetoFunc`, `UdPrecio`…): **se ignoran** y **nunca** se guardan en ninguna hoja ni en logs.
5. **Filas vacías o solo con separadores:** se saltan sin error.
6. **Compatibilidad:** los fixtures actuales (`compras_t007.csv`, `ventas_t007.csv`, etc.) siguen funcionando igual.
7. **Firma de líneas** (`firma_lineas`, T-007): **no puede cambiar** para un mismo contenido. La firma se calcula con los campos normalizados, nunca con la línea de texto cruda ni con el orden de las columnas. Así no se marca nada como «modificado en el ERP» por cambiar de formato.

## Aceptación
1. **Fixtures nuevos ficticios con las cabeceras reales exactas:** `test/fixtures/csv/compras_formato_real.csv` y `ventas_formato_real.csv`. Inventa emisores, clientes, números y artículos; **nada de datos reales**. Cada uno con:
   - CRLF y fila final `;;;;`;
   - UTF-8 con Ñ y tilde en ventas;
   - decimales con coma;
   - una venta con varias líneas y una compra con varias líneas.
2. **Prueba nueva:** los dos se detectan bien, se previsualizan y se confirman. El stock resultante es el esperado, sin `ERROR_DATOS` ni filas fantasma.
3. **Prueba nueva:** las mismas líneas en el formato antiguo y en el real dan la **misma firma** y el mismo stock. Importar una versión y luego la otra da `YA_IMPORTADO`, no `MODIFICADO_EN_ERP`.
4. **Prueba nueva:**
   - columnas en otro orden → mismo resultado;
   - una columna obligatoria eliminada → error que la nombra;
   - columnas extra desconocidas → se ignoran.
5. **Prueba nueva:** después de importar ventas con precios, ninguna hoja contiene `PrecioFunc` ni `ImporteNetoFunc` ni sus valores.
6. `node test/run_all.js` con 0 fallos, salida en `logs/T-030/tests.txt`.

## Archivos previstos
- `src/importacion/CsvHispatecParser.js`
- `IMPORT_SPECS.md` (documenta los dos formatos y la detección por columnas)
- `test/t030_lector_por_columnas.test.js` (nuevo), `test/fixtures/csv/compras_formato_real.csv`, `test/fixtures/csv/ventas_formato_real.csv` (nuevos, ficticios)
- `docs/tickets/T-030-lector-por-columnas.md` (este ticket, primer commit, sin editar)
- `logs/T-030/tests.txt`, `logs/T-030/informe.md`

**No toques** `ImportacionService.js`, `PendientesService.js` ni `CorreccionService.js` (los están tocando otros agentes), ni `src/ui/`, `MovementService.js`, `Libro.js` o `InventoryEngine.js`. Si para cumplir la regla 7 hiciera falta tocar `ImportacionService.js`, para y pregunta.

## Entrega
Escribe en `logs/T-030/informe.md`:
- un resumen de 5 líneas;
- la salida de `git status` y de `git log --oneline -5`;
- **«Dudas»** con TODO cambio no pedido.
