# T-006B — Comprobación de aceptación

1. **Clasificación y recuentos:** se usan los fixtures de T-006 más líneas sintéticas ficticias. La prueba comprueba los seis estados y sus recuentos: `VACIA` 1, `SERIE_IGNORADA` 1, `ERROR_DATOS` 2, `NO_SEGUIDA` 1, `PENDIENTE` 1 y `OK` 1. También comprueba los recuentos por documento.
2. **No seguida con decimales:** la primera línea de ventas del fixture tiene 12,5 cajas; la función simulada la devuelve como `NO_SEGUIDA` y se verifica que ese estado prevalece sobre el error de cantidad.
3. **Orden D-007:** se verifican fechas, entradas antes que salidas, series y números de documento. Los números de documento `9` y `10` llegan como texto y quedan ordenados numéricamente; dentro del documento 9 las líneas numéricas 9 y 10 también quedan en orden numérico.
4. **Origen manual:** una línea `MANUAL` sin serie ni número pasa a `OK`, sin `SERIE_IGNORADA` ni error por campos de ERP ausentes.
5. **Prefijos configurables:** se comprueban los valores por defecto exportados desde `src/Config.js` (`ACT`, `NT`, `AVT`) y que, al pasar `prefijosEntrada: ['NT']`, una línea `ACT27` queda `SERIE_IGNORADA`.
6. **Suite completa:** `node test/run_all.js` finalizó con 18 suites, 223 pruebas superadas y 0 fallidas. Salida completa guardada en `logs/T-006B/tests.txt`.

El único cambio en `src/Config.js` añade los prefijos predeterminados y los exporta. No se modificaron otros archivos existentes.
