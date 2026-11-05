# T-006 — Lector de los CSV de Hispatec a líneas canónicas (lógica pura)

Carril: C (importación). Rama: `ticket/T-006-parser-csv`, creada desde `main` tras el merge de T-001. Sensible: no (lógica pura, no escribe).
Especificación: 2026-10-23, **dividida el 2026-11-04**: la clasificación de líneas pasa a T-006B, que depende de T-005. Este ticket no depende de ningún otro salvo T-001 y puede hacerse en paralelo con el carril A.
Decisiones D-002, D-003, D-004, D-015, D-023, D-025.

## Problema
No existe forma de leer los informes CSV del ERP, que son la fuente principal de datos (D-023). Este ticket construye solo la lectura a **líneas canónicas**. La clasificación es T-006B y la aplicación al stock es T-007.

## Formato real verificado (muestras de octubre de 2026, que no entran en el repositorio)
Común a los dos archivos:
- UTF-8, quizá con BOM; separador `;`; coma decimal («80,000»); fechas `dd/mm/yyyy`.
- La última línea puede venir con todos los campos vacíos («;;;;»).

**Compras** — «ALBARANES_DE_COMPRA_POR_LINEA.csv». Cabecera exacta:
`FechaAlbaran;NombreEmisor;NumeroAlbaran;SerieAlbaran;OrdenLinea;NumeracionProveedor;ReferenciaAC;NombreArticulo;DescripcionArticulo;UnidadesEnvase;CantidadLineaAlbaran;CantidadTotal;ReferenciaLineaAlbaran;ObservacionesLineaAlbaran;CantidadPrecioPor;Factor;PorCada;PesoBrutoLACCA;PesoNetoLACCA;NroPaletsAC;PaletAC;NombrePaletAC;CodigoEnvaseAC;NombreEnvaseAC;CantidadEnvasesAC`

Hay líneas «de cabecera» sin artículo y con todo a 0 (p. ej. ACA27/2354, línea 1).

**Ventas** — «ALBARANES_DE_VENTA_POR_LINEA.csv». Cabecera exacta:
`Fecha;RefAV;Numero;Albarán;NombreCliente;NombreArticulo;NroEnvases;Cantidad;Piezas;PesoNetoEnviado;NombreEnvase;NroPalets;Palet`

La columna `Albarán` trae serie, número y línea juntos: «AVT27/160 (2)». Puede faltar la línea (1) de un albarán.

## Reglas
1. **Nuevo módulo puro `src/Normalizacion.js`**, compartido; T-004 lo reutilizará:
   - `normalizarNombre(texto)` (D-003): mayúsculas, quitar espacios al principio y al final, colapsar los espacios internos en uno. **Nada más**: no se quitan tildes, puntos, comas ni signos. Con `null` o `undefined` devuelve `''`.
   - `parsearNumeroEs(texto)`: «1.234,500» → 1234.5; «80,000» → 80; «» → `null`. Si el texto no es un número válido, devuelve `NaN`.
   - `parsearFechaDdMmYyyy(texto)`: «02/11/2026» → «2026-11-02». Si la fecha no es válida (p. ej. 31/02), devuelve `null`.
2. **Nuevo módulo puro `src/importacion/CsvHispatecParser.js`:**
   - `detectarTipo(textoCsv)` devuelve `COMPRAS`, `VENTAS` o lanza un error. Compara la fila de cabecera **exacta** tras quitar el BOM y los espacios finales.
   - `parsear(textoCsv)` devuelve `{ tipo, lineas, errores }`. Cada línea es un objeto canónico:

     ```
     { tipoDoc: 'ENTRADA'|'SALIDA', serie, numero, linea, fecha (YYYY-MM-DD),
       entidad, articulo, envase, cajas, unidades, kg,
       codigoEnvaseHispatec, origenDato: 'CSV', filaCsv }
     ```

   - Los campos que no se pueden interpretar se dejan en `null`, con un aviso en `errores` (`{ filaCsv, campo, valor }`). **La línea no se descarta:** decidir qué hacer con ella es de T-006B.
   - Los valores entre comillas (`"A;B"`) se respetan como un solo campo.
3. **Mapeo:**

   | Campo | Compras | Ventas |
   | :--- | :--- | :--- |
   | serie | `SerieAlbaran` | de `Albarán`* |
   | numero | `NumeroAlbaran` | de `Albarán`* |
   | linea | `OrdenLinea` | de `Albarán`* |
   | fecha | `FechaAlbaran` | `Fecha` |
   | entidad | `NombreEmisor` | `NombreCliente` |
   | articulo | `NombreArticulo` | `NombreArticulo` |
   | envase | `NombreEnvaseAC` | `NombreEnvase` |
   | cajas (D-004) | `CantidadEnvasesAC` | `NroEnvases` |
   | unidades | `CantidadLineaAlbaran` | `Piezas` |
   | kg (D-025, informativo) | `PesoNetoLACCA` | `PesoNetoEnviado` |
   | codigoEnvaseHispatec | `CodigoEnvaseAC` | — |

   \* Expresión: `^\s*([A-Z]+\d*)\s*/\s*(\d+)\s*\(\s*(\d+)\s*\)\s*$`. Si no encaja, serie, número y línea quedan en `null`, con un aviso.

   El artículo, el envase y la entidad pasan por `normalizarNombre`.
4. Ningún módulo de este ticket llama a `SpreadsheetApp`, `DriveApp`, `LockService` ni `Session`. Deben funcionar igual en Node y en Apps Script: sin `require` en tiempo de ejecución de Apps Script, siguiendo el patrón de exportación que ya usan `src/InventoryEngine.js` y `src/ImportSchema.js`.

## Aceptación
1. **Fixtures inventados** con la estructura exacta: `test/fixtures/csv/compras_ejemplo.csv` y `test/fixtures/csv/ventas_ejemplo.csv`. Deben llevar:
   - la misma cabecera, el mismo separador, coma decimal y fechas `dd/mm/yyyy`;
   - una línea final «;;;;» y una línea de cabecera a ceros;
   - una serie `ACA`;
   - una línea con cajas «12,500» y otra con un número de miles «1.234,000»;
   - un valor entre comillas con `;`;
   - una venta con «AVT27/160» sin paréntesis;
   - al menos dos días distintos.

   Los nombres de proveedores y clientes son **ficticios**.
2. **Prueba nueva:** `detectarTipo` reconoce ambos archivos (con y sin BOM) y rechaza una cabecera con una columna de menos.
3. **Prueba nueva:** una línea de compra produce el objeto canónico esperado completo, con «EPS 106 9x500» normalizado a «EPS 106 9X500», «44,000» convertido en 44 y los kg leídos.
4. **Prueba nueva:** «AVT27/160 (2)» da serie AVT27, número 160 y línea 2. «AVT27/160» deja `null` y un aviso.
5. **Prueba nueva:** «12,500» da `cajas = 12.5` (el parser no decide si es válido) y «1.234,000» da 1234.
6. **Prueba nueva:** pruebas unitarias de las tres funciones de `Normalizacion.js`, incluidos los casos límite de la regla 1.
7. `node test/run_all.js` con 0 fallos, salida en `logs/T-006/tests.txt`.

## Archivos previstos
- `src/Normalizacion.js` (nuevo)
- `src/importacion/CsvHispatecParser.js` (nuevo)
- `test/fixtures/csv/*` (nuevo, datos ficticios)
- `test/t006_parser_csv.test.js` (nuevo)
- `logs/T-006/*`

Si necesitas otro, para y pregunta. **No toques ningún archivo existente de `src/`** (son de los carriles A y B).

## Fuera de alcance
- Clasificar líneas: series, seguidas, pendientes (T-006B).
- Escribir en Sheets. Pantallas. Los albaranes en PDF.

## Parar y preguntar si
Hace falta una columna que no está en las cabeceras de arriba.
