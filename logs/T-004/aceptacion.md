# Aceptación T-004 — Clave de stock por nombre normalizado de artículo y envase

Registro de comprobación punto por punto según la especificación de `docs/tickets/T-004-clave-por-nombre.md` (D-003, D-022, D-023).

---

### 1. Entrada y salida con espacios y mayúsculas/minúsculas comparten clave canónica
- **Cómo se ha comprobado:** Prueba 1 en `test/t004_clave_nombre.test.js`.
- **Detalle:** Se registró una entrada para «TOMATE ROSA I M» / «EPS 106 9x500» (50 cajas) y posteriormente una salida para «tomate rosa i m » / «EPS \u00a0106 9X500» (con doble espacio y espacio duro U+00A0, 20 cajas).
- **Resultado:** Ambas operaciones resuelven la clave canónica `TOMATE ROSA I M|EPS 106 9X500`. La salida consume 20 cajas de la capa de entrada (dejando 30 cajas restantes), y se genera una fila en `CONSUMOS_FIFO` que apunta al `id_capa` de la entrada, cumpliendo con la deducción cronológica FIFO exacta.

---

### 2. Comportamiento puro de `normalizarNombre`
- **Cómo se ha comprobado:** Prueba 2 en `test/t004_clave_nombre.test.js`.
- **Detalle:** Se probó directamente la función `normalizarNombre` de `src/Normalizacion.js`:
  - Conserva tildes y caracteres especiales: `CARTON 40X30X9,5 MORESCO` y `CORUÑA` no se alteran.
  - Colapsa tabuladores `\t`, dobles espacios y espacios duros U+00A0: `'  tomate\trosa\u00a0\u00a0i   m  '` -> `'TOMATE ROSA I M'`.
  - Transforma minúsculas a mayúsculas: `'eps\t106   9x500'` -> `'EPS 106 9X500'`.
  - Manejo nulo/indefinido seguro devolviendo `''`.
- **Resultado:** Superado sin modificar `src/Normalizacion.js`.

---

### 3. Cobertura de todas las operaciones de inventario y consistencia
- **Cómo se ha comprobado:** Prueba 3 en `test/t004_clave_nombre.test.js`.
- **Detalle:** Se ejecutaron con nombres en minúsculas y espacios irregulares las siguientes operaciones:
  - `registrarEntrada` inicial.
  - `registrarAjuste` (+ y −).
  - `registrarReclasificacion`.
  - `registrarMovimientoPartida`.
  - `dividirCapaEntrada`, pasando el artículo original en minúsculas.
  - `corregirEntradaParcial`.
  - `anularEntrada` por serie, número y artículo sin normalizar.
  - `StockQueryService.obtenerDetalleStock` con minúsculas y espacios.
- **Resultado:**
  - En todas las tablas (`MOVIMIENTOS`, `CAPAS_FIFO`, `STOCK_ACTUAL`, `CONSUMOS_FIFO`), cada fila cumple `normalizarNombre(x) === x` para `codigo_articulo` y `codigo_envase`.
  - `env.movService.comprobarConsistencia()` devuelve 0 diferencias en capas (`diferenciasCapas = []`), 0 en stock (`diferenciasStock = []`) y 0 en consumos (`diferenciasConsumos = []`).
- **Comparaciones normalizadas adicionales (Regla 3):**
  - `MovementService.registrarReclasificacion`: comparación entre combinación origen y destino normalizadas con `this._clave`.
  - `MovementService.corregirEntradaParcial`: soporte para parámetros alternativos en snake_case (`articulo_destino`, `envase_destino`).
  - `Libro.reconstruir`: comparación de artículo y envase en ANULACION legacy normalizada con `_normNombre_`.
  - `OperationalSafetyService.validarDocumento`: normalización de líneas de entrada y cálculo de claves para demanda de salida.
  - `OperationalSafetyService.conciliarStock`: normalización tanto del stock local como de las líneas de stock externo.
  - `StockQueryService.obtenerDetalleStock` y `obtenerDetallePartidas`: normalización de filtros de entrada y comparación contra registros normalizados.

---

### 4. `STOCK_ACTUAL` con nombres descriptivos (MAESTRO vs Fallback a clave)
- **Cómo se ha comprobado:** Prueba 4 en `test/t004_clave_nombre.test.js`.
- **Detalle:**
  - Para una clave presente en MAESTRO (`SANDIA NEGRA|BOX`), `nombre_articulo` y `descripcion_envase` toman los valores descriptivos de MAESTRO (`SANDÍA EXTRA DULCE` y `BOX CARTÓN 300KG`).
  - Para una clave ausente en MAESTRO (`MELON PIEL DE SAPO|CAJA 15KG`), `nombre_articulo` y `descripcion_envase` toman automáticamente las dos partes de la clave (`MELON PIEL DE SAPO` y `CAJA 15KG`), evitando en todo momento campos vacíos en `STOCK_ACTUAL`.
- **Resultado:** Superado estrictamente.

---

### 5. Validación estricta: artículo o envase vacío o con "|"
- **Cómo se ha comprobado:** Prueba 5 en `test/t004_clave_nombre.test.js`.
- **Detalle:**
  - `Libro.aplicarMovimiento` devuelve `{ ok: false, errorCode: 'VALIDATION_ERROR' }` ante entradas vacías, solo espacios o con `|`.
  - `MovementService._clave` lanza excepción de clave inválida ante vacíos o `|`.
  - `MovementService.registrarEntrada` rechaza la llamada y garantiza que no se persiste ninguna fila en ninguna hoja.
  - `OperationalSafetyService.validarDocumento` marca la línea con semáforo `ERROR`, bloqueada y con `puedeProcesar: false`.
- **Resultado:** Superado con éxito.

---

### 6. Comprobaciones de arquitectura (grep y diff limpio)
- **Cómo se ha comprobado:** Prueba 6 en `test/t004_clave_nombre.test.js` y verificación en terminal:
  - `this.libro.aplicarMovimiento(` aparece exactamente 1 vez en `src/MovementService.js` (dentro de `_aplicar`).
  - `engine.buildStockKey(` aparece exactamente 1 vez en `src/MovementService.js` (dentro de `_clave`).
  - `engine.buildStockKey(` aparece exactamente 0 veces en `src/OperationalSafetyService.js`.
  - `git diff main -- src/InventoryEngine.js src/Código.js src/Normalizacion.js` devuelve salida vacía (cero modificaciones).
- **Resultado:** 100% conforme con las restricciones del carril A y de arquitectura.

---

### 7. Suites existentes intactas
- **Cómo se ha comprobado:** Ejecución de `test/t022_propiedades.test.js`, `test/t003_consumos_fifo.test.js` y `test/t023_superficie.test.js`.
- **Resultado:** Todas en verde sin ninguna modificación a las aserciones existentes.

---

### 8. Documentación actualizada
- **Cómo se ha comprobado:** Se actualizaron `BUSINESS_RULES.md` (§1) y `DATA_MODEL.md` (secciones 3.3, 3.4, 3.5 y 3.6).
- **Detalle:** Se documentó que la clave primaria de stock se rige por nombre normalizado (D-003), los dos puntos de normalización centralizada (`_clave` y `_aplicar`), la prevención de caracteres `|` y la justificación técnica debida a la estructura del ERP.

---

### 9. Ejecutor único de pruebas (`test/run_all.js`)
- **Cómo se ha comprobado:** Ejecución limpia con `node test/run_all.js`.
- **Resultado:** 25 suites ejecutadas, 25 superadas, 0 fallidas (273 pruebas superadas). Salida completa guardada en `logs/T-004/tests.txt`.
