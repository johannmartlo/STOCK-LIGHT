# Aceptación T-003 — Hoja CONSUMOS_FIFO derivada del libro y fin de los repartos a ciegas

- **Fecha:** 2026-11-05
- **Carril:** A (Núcleo)
- **Rama:** `ticket/T-003-consumos-fifo`

---

## Verificación de Criterios de Aceptación

### 1. Salida de 100 con Capas A (70) y B (50): 2 filas en CONSUMOS_FIFO y sin `FIFO:` en observaciones
- **Comprobación:** Implementado en `test/t003_consumos_fifo.test.js` (Prueba 1).
- **Resultado:**
  - `CONSUMOS_FIFO` contiene exactamente 2 filas:
    - Fila 1: `id_capa = capaA.id_capa`, `orden = 1`, `cajas = 70`, `codigo_articulo = 'ART1'`, `codigo_envase = 'ENV1'`, `fecha_negocio = '2026-10-03'`.
    - Fila 2: `id_capa = capaB.id_capa`, `orden = 2`, `cajas = 30`, `codigo_articulo = 'ART1'`, `codigo_envase = 'ENV1'`, `fecha_negocio = '2026-10-03'`.
  - El movimiento registrado en `MOVIMIENTOS` conserva sus notas originales (`Albarán salida urgente`) y no contiene `FIFO:`.
- **Estado:** ✅ SUPERADO

---

### 2. Anulación de salida restituye A y B y elimina filas de CONSUMOS_FIFO
- **Comprobación:** Implementado en `test/t003_consumos_fifo.test.js` (Prueba 2).
- **Resultado:**
  - Capa A recupera sus 70 cajas restantes (`cajas_restantes = 70`, `estado_capa = 'ACTIVA'`).
  - Capa B recupera sus 50 cajas restantes (`cajas_restantes = 50`, `estado_capa = 'ACTIVA'`).
  - `CONSUMOS_FIFO` queda con 0 filas para ese movimiento (hoja limpia con solo cabeceras al no quedar más salidas activas).
- **Estado:** ✅ SUPERADO

---

### 3. Corrección de salida de 100 a 80 devuelve 20 cajas a B en orden inverso; CONSUMOS_FIFO queda A 70 y B 10
- **Comprobación:** Implementado en `test/t003_consumos_fifo.test.js` (Prueba 3).
- **Resultado:**
  - Capa B recibe las 20 cajas reintegradas pasando a 40 restantes.
  - Capa A no se altera (sigue con 0 restantes y 70 consumidas).
  - `CONSUMOS_FIFO` mantiene exactamente 2 filas para la salida:
    - Fila 1: `id_capa = Capa A`, `orden = 1`, `cajas = 70`.
    - Fila 2: `id_capa = Capa B`, `orden = 2`, `cajas = 10`.
- **Estado:** ✅ SUPERADO

---

### 4. Fuente es la hoja y no el texto: observaciones vacías en mock y anulación exacta
- **Comprobación:** Implementado en `test/t003_consumos_fifo.test.js` (Prueba 4).
- **Resultado:**
  - Tras registrar varias entradas y salidas, se vacía físicamente la columna `observaciones` de todas las filas en el mock de `MOVIMIENTOS`.
  - Al ejecutar `anularSalida`, `_cargarEstado()` lee los consumos exclusivamente de la tabla `CONSUMOS_FIFO`.
  - Las cajas se restituyen exactamente a las capas correspondientes (Capa A: 40 restantes, Capa B: 100 restantes).
  - `comprobarConsistencia()` reporta 0 diferencias en capas, stock y consumos.
- **Estado:** ✅ SUPERADO

---

### 5. Primera ejecución tras despliegue: CONSUMOS_FIFO vacía se regenera desde `reconstruir(movimientos)`
- **Comprobación:** Implementado en `test/t003_consumos_fifo.test.js` (Prueba 5).
- **Resultado:**
  - Con salidas activas en `MOVIMIENTOS` y la pestaña `CONSUMOS_FIFO` completamente limpia sin filas de datos, `_cargarEstado()` detecta la ausencia de consumos materializados y llama automáticamente a `libro.reconstruir(movimientos)`.
  - La anulación de una salida se ejecuta con fidelidad y `_persistir` materializa en `CONSUMOS_FIFO` los consumos vigentes de las restantes salidas.
  - La hoja queda rellena y `comprobarConsistencia()` verifica 0 diferencias.
- **Estado:** ✅ SUPERADO

---

### 6. Fin de los repartos a ciegas: `REVISION_NECESARIA` en vivo y `avisos` en reconstruir
- **Comprobación:** Implementado en `test/t003_consumos_fifo.test.js` (Prueba 6).
- **Resultado:**
  - En vivo:
    - `AJUSTE +` con `id_movimiento_ref` huérfano devuelve `{ success: false, status: 'REVISION_NECESARIA', errorCode: 'CONSUMOS_DESCONOCIDOS' }` y no altera capas ni stock.
    - `ANULACION` con `id_movimiento_ref` huérfano devuelve `errorCode: 'CONSUMOS_DESCONOCIDOS'` y no altera capas ni stock.
  - En `reconstruir(movimientos)`:
    - Ambos movimientos con consumos desconocidos se añaden a la lista `avisos` (`motivo: 'Consumos desconocidos...'`), el proceso continúa sin lanzar excepción y ninguna capa se ve modificada.
- **Estado:** ✅ SUPERADO

---

### 7. Fidelidad tras `rebuildStock`: CONSUMOS_FIFO coincide fila a fila
- **Comprobación:** Implementado en `test/t003_consumos_fifo.test.js` (Prueba 7).
- **Resultado:**
  - Tras múltiples entradas, salidas y correcciones, se capturan las filas de `CONSUMOS_FIFO`.
  - Se invoca `rebuildStock()`, el cual regenera y reescribe `CONSUMOS_FIFO`.
  - Se comparan fila a fila (`assert.deepStrictEqual` en cada índice): todas las columnas (`id_movimiento`, `orden`, `id_capa`, `codigo_articulo`, `codigo_envase`, `cajas`, `fecha_negocio`) coinciden exactamente antes y después del rebuild.
- **Estado:** ✅ SUPERADO

---

### 8. Suite de propiedades T-022 (`t022_propiedades.test.js`) con 0 diferencias
- **Comprobación:** Ejecución de `test/t022_propiedades.test.js` con semilla fija `20261104` y 200 operaciones aleatorias.
- **Resultado:**
  - `comprobarConsistencia()` incluye ahora `diferenciasConsumos` y su sumatorio en `totalDiferencias`.
  - Tras las 200 operaciones aleatorias (entradas, salidas, ajustes ±, correcciones al alza y a la baja, anulaciones, divisiones y reclasificaciones), `comprobarConsistencia()` devolvió `0 diferencias` en todas y cada una de las operaciones.
- **Estado:** ✅ SUPERADO

---

### 9. Sin llamadas a `anexarConsumosFifoAObservaciones` en `MovementService.js`
- **Comprobación:** `git grep -n "anexarConsumosFifoAObservaciones(" src/MovementService.js`
- **Resultado:** 0 coincidencias (código de salida 1).
- **Funciones globales nuevas:** No se introdujeron funciones globales nuevas en el ámbito raíz; la superficie del servidor se mantiene intacta (`test/t023_superficie.test.js` pasa 8/8).
- **Estado:** ✅ SUPERADO

---

### 10. `DATA_MODEL.md` y ejecución global limpia
- **Comprobación:**
  - `DATA_MODEL.md` actualizado con `CONSUMOS_FIFO` en el diagrama Entidad-Relación (ER) y en la Sección 3.6 como tabla derivada (D-022).
  - `node test/run_all.js` ejecutado con 0 fallos: 24/24 suites ejecutadas y superadas, 265 pruebas en verde.
  - Salida completa archivada en `logs/T-003/tests.txt`.
- **Estado:** ✅ SUPERADO
