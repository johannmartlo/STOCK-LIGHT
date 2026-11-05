# T-006 — Comprobación de aceptación

1. **Fixtures CSV inventados:** `compras_ejemplo.csv` y `ventas_ejemplo.csv` usan las cabeceras exactas, `;`, decimales con coma, fechas `dd/mm/yyyy`, línea final `;;;;` y nombres ficticios. Compras incluye la línea de cabecera de ceros, ACA27, `12,500`, `1.234,000`, un campo entrecomillado con `;` y dos fechas; ventas incluye `AVT27/160 (2)`, `AVT27/160` sin paréntesis y dos fechas. Verificado en `test/t006_parser_csv.test.js`.
2. **Detección de tipo:** la prueba reconoce ambos fixtures con y sin BOM y confirma que una cabecera con una columna menos lanza error.
3. **Compra canónica:** la prueba compara el objeto completo esperado, incluido `EPS 106 9X500`, 44 cajas, kg 45.25, origen CSV y fila de origen.
4. **Referencia de venta:** la prueba verifica AVT27, 160 y línea 2 para la referencia completa; sin paréntesis los tres campos quedan `null` y se registra aviso.
5. **Números:** la prueba confirma `12,500` → 12.5 y `1.234,000` → 1234.
6. **Normalización:** pruebas de nombre (null, undefined, espacios, mayúsculas y conservación de tildes/signos), números (vacío, inválido) y fechas (válida, imposible, formato incorrecto y null).
7. **Suite completa:** `node test/run_all.js` finalizó con 17 suites, 218 pruebas superadas y 0 fallidas. Salida completa guardada en `logs/T-006/tests.txt`.

No se modificó ningún archivo existente de `src/`.
