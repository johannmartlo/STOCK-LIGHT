# T-006B — Clasificación de líneas canónicas y agrupación en documentos (lógica pura)

Carril: C (importación). Rama: `ticket/T-006B-clasificador`, creada desde `main` tras el merge de T-006. Sensible: no (lógica pura).
**No espera a T-005:** `esCombinacionSeguida` se inyecta como parámetro con la firma que fija T-005, que devuelve `SEGUIDA`, `NO_SEGUIDA` o `PENDIENTE`. Las pruebas usan una versión simulada, y la conexión con la real la hace T-007.
Especificación: 2026-11-04. Separado de T-006 (2026-10-23), con las mismas reglas de clasificación.
Decisiones D-002, D-004, D-006, D-007, D-021, D-023.

## Problema
T-006 convierte los CSV en líneas canónicas, pero no decide cuáles cuentan. Este ticket las clasifica y las agrupa en documentos, listas para que T-007 las aplique. **Sirve para cualquier fuente** (D-023): CSV, PDF, foto o manual producen las mismas líneas canónicas.

## Reglas
1. Nuevo módulo puro `src/importacion/ClasificadorLineas.js`. La función `clasificar(lineas, config, esCombinacionSeguida)` asigna a cada línea un estado.
   - `config.prefijosEntrada` (por defecto `['ACT', 'NT']`) y `config.prefijosSalida` (por defecto `['AVT']`) vienen de `src/Config.js` (D-002).
   - `esCombinacionSeguida` es la función de T-005. Se inyecta para poder probar el módulo sin hojas.

   **Orden de evaluación:**
   1. `VACIA`: sin artículo y con cajas 0 o vacías. Se descarta sin aviso.
   2. `SERIE_IGNORADA`: la serie no empieza por ningún prefijo de su tipo. Solo aplica a las líneas con origen `CSV` o `PDF`; las de origen `FOTO` y `MANUAL` no tienen serie del ERP.
   3. `ERROR_DATOS`: falta la fecha, el artículo, el envase o (para CSV y PDF) serie, número y línea. Lleva un mensaje y la `filaCsv`.
   4. `NO_SEGUIDA`: el grupo tiene `seguido = NO`.
   5. `ERROR_DATOS`: las cajas no son un entero exacto o son ≤ 0.
   6. `PENDIENTE`, si la combinación no tiene grupo; `OK`, si es seguida.

   Así, el género que no se sigue no genera errores de cantidad.
2. `agruparEnDocumentos(lineasClasificadas)`:
   - agrupa por tipo + serie + número (D-010);
   - ordena los documentos según D-007: fecha, después las entradas antes que las salidas, después serie, número y línea;
   - cada documento lleva sus líneas `OK`, sus `PENDIENTE` y un resumen de las demás.
3. `resumenImportacion(lineasClasificadas, documentos)` devuelve los recuentos por estado y por documento, para la pantalla.
4. Ningún módulo de `src/importacion/` llama a `SpreadsheetApp`, `DriveApp`, `LockService` ni `Session`.

## Aceptación
1. **Prueba nueva:** con los fixtures de T-006 y una función `esCombinacionSeguida` simulada, cada estado de la regla 1 aparece al menos una vez, con los recuentos esperados escritos en la prueba.
2. **Prueba nueva:** una línea no seguida con cajas «12,5» queda en `NO_SEGUIDA`, no en `ERROR_DATOS`.
3. **Prueba nueva:** con entradas y salidas de varios días, el orden de los documentos cumple D-007.
4. **Prueba nueva:** una línea de origen `MANUAL` sin serie no queda en `SERIE_IGNORADA` ni en `ERROR_DATOS` por falta de serie.
5. **Prueba nueva:** los prefijos se leen de la configuración. Con `prefijosEntrada = ['NT']`, una línea `ACT27` queda en `SERIE_IGNORADA`.
6. `node test/run_all.js` con 0 fallos, salida en `logs/T-006B/tests.txt`.

## Archivos previstos
- `src/importacion/ClasificadorLineas.js` (nuevo)
- `src/Config.js` (prefijos de series por defecto)
- `test/t006b_clasificador.test.js` (nuevo)
- `logs/T-006B/*`

Si necesitas otro, para y pregunta.

## Fuera de alcance
Escribir en Sheets (T-007). Pantallas. Artículos por unidades (T-017).

## Parar y preguntar si
Una línea real no encaja en ningún estado.
