# Verificación de Aceptación — T-022 (Libro de movimientos de solo añadir)

Fecha: 2026-11-05
Carril: A (núcleo)
Rama: `ticket/T-022-libro-solo-anadir`
Decisiones: D-012, D-022, D-024

---

## Comprobación punto por punto de «Aceptación»

### 1. Prueba nueva: los dos casos de la tabla del problema
- **Estado:** Cumplido ✅
- **Cómo se ha comprobado:**
  - En `test/t022_libro.test.js` se implementaron las pruebas `1a` y `1b`:
    - **Caso 1 (`1a`):** Entradas de 100 y 50 cajas; se anula la de 100 (`anularEntrada`). Tras cada operación se verifica que `reconstruir(movimientos)` devuelve exactamente las mismas `cajas_restantes` por capa (con los mismos `id_capa`), el mismo stock por clave (`50` cajas en vivo y `50` en reconstrucción) y `comprobarConsistencia().totalDiferencias === 0`.
    - **Caso 2 (`1b`):** Entrada de 100 cajas; salida de 40 corregida a 30 (`corregirCantidadSalida`). Se verifica que el movimiento original de salida conserva `cajas === 40` intacto y que tanto el estado vivo como `reconstruir(movimientos)` y `rebuildStock()` dan `70` cajas restantes en el mismo `id_capa` y `70` en stock.

### 2. Prueba nueva, de propiedades: 200 operaciones aleatorias con semilla fija
- **Estado:** Cumplido ✅
- **Cómo se ha comprobado:**
  - En `test/t022_propiedades.test.js` se implementó un generador PRNG determinista (`Mulberry32`, semilla fija `20261104`) que ejecuta 200 operaciones mezclando:
    - `registrarEntrada`
    - `registrarSalida`
    - `registrarAjuste` positivo (`+1`) y negativo (`-1`)
    - `anularEntrada` y `anularSalida`
    - `corregirCantidadSalida` a la baja y al alza
    - `corregirCantidadEntrada` a la baja y al alza
    - `dividirCapaEntrada`
    - `registrarReclasificacion`
  - Tras **cada una** de las 200 operaciones se ejecuta `comprobarConsistencia()` verificando `consistente === true` y `totalDiferencias === 0`. En caso de fallo imprime la semilla y el número de operación.

### 3. Prueba nueva: ninguna fila de MOVIMIENTOS cambia después de escribirse
- **Estado:** Cumplido ✅
- **Cómo se ha comprobado:**
  - En `test/t022_libro.test.js` (prueba `3`) se encadenan las 13 operaciones de escritura del servicio (`registrarEntrada`, `registrarSalida`, `corregirCantidadSalida` baja/alza, `corregirCantidadEntrada` baja/alza, `registrarReclasificacion`, `registrarMovimientoPartida`, `dividirCapaEntrada`, `corregirEntradaParcial`, `anularSalida`, `anularEntrada`).
  - Tras cada operación se guarda una copia serializada de `repo.getMovimientos()` y se comprueba que el prefijo completo coincide carácter por carácter con el estado anterior.

### 4. Prueba nueva: 1.000 llamadas a `nuevoId('MOV')` en un bucle no repiten ningún valor
- **Estado:** Cumplido ✅
- **Cómo se ha comprobado:**
  - En `test/t022_libro.test.js` (prueba `4`) se invoca `nuevoId('MOV')` 1.000 veces consecutivas en un bucle y se comprueba que `Set.size === 1000` y que todos los valores comienzan por `'MOV-'`.

### 5. Prueba nueva: una base con un ANULACION antiguo (`ANULADO`, sin referencia) se reconstruye con su aviso y sin excepción
- **Estado:** Cumplido ✅
- **Cómo se ha comprobado:**
  - En `test/t022_libro.test.js` (prueba `5`) se pasa a `reconstruir(movimientos)` una base con un movimiento `ANULACION` con `estado: 'ANULADO'` y sin `id_movimiento_ref` ni `id_documento_ref` identificable: devuelve `ok: true` sin lanzar excepción e incluye el aviso en `rec.avisos`. También se verifica que cuando `id_documento_ref` sí identifica la entrada original, se aplica la anulación sin aviso.

### 6. Suites existentes en verde y listado de aserciones adaptadas (D-022)
- **Estado:** Cumplido ✅
- **Cómo se ha comprobado:**
  - Las 20 suites (`node test/run_all.js`, 233 pruebas) pasan con 0 fallos.
  - **Lista explícita de aserciones adaptadas en suites existentes:**
    1. `test/fase6_1_correcciones_historicas.test.js`, **línea 245** (Prueba 2: `Corrección entrada parcialmente consumida`):
       - **Antes:** `assert.strictEqual(Number(capaG.cajas_consumidas), 120);`
       - **Ahora:** `assert.strictEqual(Number(capaG.cajas_iniciales), 200);` y `assert.strictEqual(Number(capaG.cajas_consumidas), 200);`
       - **Motivo (autorizado por D-022 y Aceptación 6):** Antes `corregirEntradaParcial` sobrescribía `layer.cajas_iniciales = 120` en la capa original en lugar de consumir las 80 cajas trasladadas. Con la Regla 4 de T-022 (`cajas_iniciales` de la capa no se toca y el traslado se ejecuta como consumo dirigido `AJUSTE −` con `id_capa_objetivo`), `cajas_iniciales` permanece en `200` y `cajas_consumidas` pasa de `120` a `200` (120 de la venta + 80 del traslado dirigido), quedando `cajas_restantes = 0` y `estado_capa = 'AGOTADA'`.
    2. `test/t002_fecha_negocio.test.js`, **línea 266** (Prueba 5: `provisionDatabase añade 5 columnas al final de MOVIMIENTOS y conserva datos`):
       - **Antes:** `assert.strictEqual(headersNuevos.length, 18);`
       - **Ahora:** `assert.strictEqual(headersNuevos.length, 21);`
       - **Motivo:** La Regla 2 de T-022 añade 3 columnas nuevas al final de `SCHEMA_DEFINITIONS.MOVIMIENTOS` (`id_movimiento_ref`, `id_capa_objetivo`, `id_capa_creada`), pasando el esquema total de `MOVIMIENTOS` de 18 a 21 columnas (conservando intactas las posiciones 13 a 17 de T-002).

### 7. Comprobación con `grep` de `replaceTable('MOVIMIENTOS'` y `Date.now()`
- **Estado:** Cumplido ✅
- **Cómo se ha comprobado:**
  - Búsqueda de `replaceTable('MOVIMIENTOS'` en `src/`: **0 coincidencias**.
  - Búsqueda de `Date.now()` en `src/InventoryEngine.js` y `src/MovementService.js`: **0 coincidencias**.
  - Persistencia unificada en `MovementService._persistir({ movimientos, estado, documentos })`, invocada siempre dentro del lock en el orden: 1) `appendMovimientos`, 2) `saveCapasFifo`, 3) `saveStockActual`, 4) `DOCUMENTOS`.

### 8. Documentación en `DATA_MODEL.md` y `BUSINESS_RULES.md` y ejecución de `node test/run_all.js`
- **Estado:** Cumplido ✅
- **Cómo se ha comprobado:**
  - `DATA_MODEL.md` documenta las 3 columnas nuevas de `MOVIMIENTOS` (`id_movimiento_ref`, `id_capa_objetivo`, `id_capa_creada`) y la tabla de semántica de la Regla 3 (§3.3.1).
  - `BUSINESS_RULES.md` documenta la tabla de semántica única de la Regla 3 y las equivalencias de correcciones históricas (§2).
  - Salida íntegra de `node test/run_all.js` guardada en `logs/T-022/tests.txt` (20 suites, 233 pruebas, 0 fallos).

---

## Funciones globales nuevas (`src/Ids.js` y `src/Libro.js`) — Clasificación `INTERNA`
*(Nota del director técnico: dado que `docs/API_PUBLICA.md` aún no existe en `origin/main`, se listan aquí como `INTERNA` para T-020):*

| Archivo | Función global | Clasificación |
| :--- | :--- | :--- |
| `src/Ids.js` | `nuevoId(prefijo)` | `INTERNA` |
| `src/Libro.js` | `aplicarMovimiento(estado, movimiento)` | `INTERNA` |
| `src/Libro.js` | `reconstruir(movimientos)` | `INTERNA` |
| `src/Libro.js` | `ordenarMovimientosPorSecuencia(movimientos)` | `INTERNA` |
| `src/Libro.js` | `extraerConsumosFifoDeObservaciones(observaciones)` | `INTERNA` |
| `src/Libro.js` | `anexarConsumosFifoAObservaciones(observaciones, consumos)` | `INTERNA` |
| `src/Libro.js` | `clonarEstadoLibro(estado)` | `INTERNA` |
| `src/Libro.js` | `_keyLibro(codigoArticulo, codigoEnvase)` | `INTERNA` |
| `src/Libro.js` | `_ordenarCapasFifo(layers)` | `INTERNA` |
| `src/Libro.js` | `_resolverFechaNegocioMovimiento(movimiento)` | `INTERNA` |
| `src/Libro.js` | `_generarIdLibro(prefijo)` | `INTERNA` |
| `src/Libro.js` | `_calcularDisponibleCapas(stockKey, capas)` | `INTERNA` |
