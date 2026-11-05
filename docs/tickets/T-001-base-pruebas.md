# T-001 — Ejecutor único de pruebas, suites manuales y helper de mocks

Carril: A (núcleo). Rama: `ticket/T-001-base-pruebas`, creada desde **`prep/public-baseline`** (773fc40). Sensible: no.
Especificación: 2026-10-23, re-basada el 2026-11-04. Decisiones D-015. Problema verificado por el director técnico en un clon limpio de `prep/public-baseline`.

## Problema
- No hay un comando único para ejecutar las pruebas. Cada suite se lanza a mano (`node test/xxx.test.js`).
- Cinco suites completas fallan en cualquier máquina sin los PDFs reales de `docs/samples/` (excluida en `.gitignore`, como debe ser):
  - `drive_ingestion.test.js`
  - `fase7_1_confirmacion_lote_y_seguridad.test.js`
  - `phase2_1_hardening.test.js`
  - `real_pdf_parsers.test.js`
  - `trust_boundary.test.js`

  A eso se suma el caso 1 de `compra_packaging_resolution.test.js`. Todas fallan con `ENOENT` sobre `docs/samples/...`.
- Consecuencia: «todo en verde» no se puede comprobar. Un agente no distingue un fallo real de uno por falta de muestras.
- La infraestructura de mocks de la hoja de cálculo (`MockRange`, `MockSheet`, `MockSpreadsheet`) está copiada en 10 archivos de prueba. Todos los tickets siguientes la necesitan.

## Lo que ya existe (verificado; no lo rehagas)
- 14 suites pasan sin muestras en `prep/public-baseline`.
- Los scripts `test/inspect_*.js`, `test/deep_inspect.js` y `test/catalog_scan.js` no son pruebas.

## Reglas
1. **Primer paso:** fusionar `prep/public-baseline` en `main` es un avance rápido (`main` es ancestro de `prep/public-baseline`). **No lo hagas tú.** Trabaja en tu rama desde `prep/public-baseline`; el responsable fusionará las dos en `main` al verificar este ticket.
2. `test/run_all.js` ejecuta en orden alfabético todas las `test/*.test.js`, cada una en un proceso aparte (`child_process`), con un límite de 120 s por suite. Imprime el resultado de cada suite y un total, y termina con código 1 si alguna falla.
3. Las suites que necesitan PDFs reales pasan a `test/manual/` sin cambiar su contenido; solo se ajustan las rutas relativas de `require` y de los fixtures.
4. `compra_packaging_resolution.test.js` se queda en `test/`. Su caso 1 se mueve a `test/manual/compra_packaging_resolution_real.test.js` con el mismo código. Los demás casos no cambian.
5. Los scripts `inspect_*`, `deep_inspect.js` y `catalog_scan.js` pasan a `test/manual/tools/`.
6. `test/manual/README.md` explica en tres líneas que esas suites necesitan los PDFs reales en `docs/samples/` y que no cuentan para «0 fallos».
7. Nuevo `test/helpers/mockSheets.js`. Exporta `MockRange`, `MockSheet`, `MockSpreadsheet` y `crearEntorno(opciones)`. Esta última crea la hoja, el repositorio con `provisionDatabase()`, el resolver, `MovementService`, `StockQueryService` y `OperationalSafetyService` con un lock simulado, igual que `createTestEnvironment` de `fase6_1_correcciones_historicas.test.js`.
   - **No migres las suites existentes al helper.** Solo se crea, con una prueba propia (`test/helpers_mock.test.js`) que registre una entrada y lea el stock.
8. `test/helpers/` no contiene pruebas: `run_all.js` solo ejecuta `test/*.test.js`.

## Aceptación
1. `node test/run_all.js` en un clon limpio (sin `docs/samples/`) termina con código 0 y muestra el número de suites y de pruebas superadas.
2. El total de suites en verde es 14 + `helpers_mock.test.js`. Anota en `logs/T-001/aceptacion.md` el número exacto de pruebas antes y después.
3. Ninguna aserción cambia. Compruébalo con `git diff --stat -M` y con el diff de los archivos movidos, que solo debe mostrar cambios de ruta.
4. Salida completa en `logs/T-001/tests.txt`.
5. **Primer commit de la rama**, solo de documentación: `AGENTS.md` (en la raíz), `docs/STATE.md`, `docs/decisions.md`, `docs/PLAN_PRODUCCION.md` y `docs/tickets/`, tal como los entrega el director técnico. Ya están copiados en la carpeta de trabajo y sin seguimiento. Comprueba con `git status` que son exactamente esos y no edites su contenido.

## Archivos previstos
- `test/run_all.js` (nuevo)
- `test/helpers/mockSheets.js` (nuevo)
- `test/helpers_mock.test.js` (nuevo)
- `test/manual/` (las suites movidas, más `README.md` y `tools/`)
- `test/compra_packaging_resolution.test.js` (solo se quita el caso 1)
- `AGENTS.md`, `docs/*` (commit de documentación)
- `logs/T-001/*`

Si necesitas otro, para y pregunta.

## Fuera de alcance
Arreglar o modernizar los parsers de PDF. Añadir dependencias npm. Migrar las suites al helper.

## Parar y preguntar si
Alguna de las 14 suites que hoy pasan falla en un clon limpio.
