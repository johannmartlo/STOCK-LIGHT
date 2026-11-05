# Aceptación de T-001 — Ejecutor único de pruebas y helper de mocks

Fecha de ejecución: 2026-11-05
Rama: `ticket/T-001-base-pruebas`
Commit inicial de documentación: `ec90bee`

## Verificación de Criterios de Aceptación

### 1. Ejecutor único de pruebas (`node test/run_all.js`)
- **Comprobación:** Ejecutado en clon limpio sin `docs/samples/`.
- **Resultado:** Código de salida 0. El runner ejecuta las 16 suites en orden alfabético en procesos `child_process` independientes con timeout de 120 s por suite.
- **Salida:** Muestra 16 suites ejecutadas, 16 superadas, 0 fallidas, 213 pruebas superadas en ~11.35 segundos.

### 2. Suites y conteo exacto de pruebas antes y después
- **Antes (en `prep/public-baseline` sin `docs/samples/`):**
  - Total archivos de prueba: 20 suites.
  - Suites superadas: 14 suites (202 pruebas unitarias y de integración pasando).
  - Suites fallidas por requerir PDFs reales de `docs/samples/`: 6 suites:
    - 5 completas: `drive_ingestion.test.js`, `fase7_1_confirmacion_lote_y_seguridad.test.js`, `phase2_1_hardening.test.js`, `real_pdf_parsers.test.js`, `trust_boundary.test.js`.
    - 1 parcial: `compra_packaging_resolution.test.js` (fallaba su caso 1 con ENOENT en `docs/samples/COMPRAS/COMPRA 3026.pdf.extracted.txt`; 9 pruebas pasaban).
- **Después (en `ticket/T-001-base-pruebas`):**
  - Suites activas en `test/*.test.js`: 16 suites (todas en verde, código 0).
    - Las 14 suites originales que ya pasaban: 202 pruebas.
    - `compra_packaging_resolution.test.js` (permanece en `test/`, sin su caso 1 movido a manual): 9 pruebas.
    - `helpers_mock.test.js` (nueva suite propia del helper `mockSheets.js`): 2 pruebas.
    - **Total pruebas superadas:** 202 + 9 + 2 = 213 pruebas.
  - Suites en `test/manual/` (no ejecutadas por `run_all.js` ni computadas para 0 fallos):
    - `compra_packaging_resolution_real.test.js` (caso 1)
    - `drive_ingestion.test.js`
    - `fase7_1_confirmacion_lote_y_seguridad.test.js`
    - `phase2_1_hardening.test.js`
    - `real_pdf_parsers.test.js`
    - `trust_boundary.test.js`
    - `tools/` (6 scripts de inspección)

### 3. Ninguna aserción modificada
- **Comprobación:** Verificado mediante `git diff --stat -M` y revisión exhaustiva de `git diff -M`.
- **Resultado:**
  - Los archivos movidos a `test/manual/` y `test/manual/tools/` solo contienen ajustes en las rutas relativas (`../../src/...`, `../../docs/...`, `../../../docs/samples`).
  - En `test/compra_packaging_resolution.test.js` únicamente se eliminó el caso 1 (71 líneas), cuyo código fue trasladado íntegramente a `test/manual/compra_packaging_resolution_real.test.js`.
  - Cero aserciones modificadas.

### 4. Salida completa en `logs/T-001/tests.txt`
- **Comprobación:** Generado archivo `logs/T-001/tests.txt` en UTF-8 con la traza completa de ejecución de `node test/run_all.js`.
- **Resultado:** Registradas las 16 suites con sus tiempos y 213 pruebas con estado OK.

### 5. Primer commit de la rama (solo documentación)
- **Comprobación:** Realizado primer commit `ec90bee` con los archivos de documentación sin seguimiento entregados por el director técnico:
  - `AGENTS.md`
  - `docs/PLAN_PRODUCCION.md`
  - `docs/STATE.md`
  - `docs/decisions.md`
  - `docs/tickets/T-001-base-pruebas.md`
  - `docs/tickets/T-002-fecha-negocio.md`
  - `docs/tickets/T-006-parser-csv.md`
  - `docs/tickets/T-006B-clasificador-lineas.md`
  - `docs/tickets/T-018-copias-seguridad.md`
  - `docs/tickets/T-022-libro-solo-anadir.md`
  - `docs/tickets/T-023-superficie-servidor.md`
- **Resultado:** Verificado con `git status` y `git log -1`.
