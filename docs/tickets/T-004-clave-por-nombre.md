# T-004 — Clave de stock por nombre normalizado de artículo y envase

Carril: A (núcleo). Rama: `ticket/T-004-clave-por-nombre`, creada desde `main` **después del merge de T-003**. Sensible: **sí** (identidad del stock).
Especificación: 2026-10-23, **re-basada el 2026-11-05** sobre T-022, T-003 y T-006. Decisiones D-003, D-022, D-023. Comprobado por el director técnico con un prototipo sobre T-003 (24/24 suites).

## Qué ha cambiado desde la versión de octubre
- `normalizarNombre` **ya existe** en `src/Normalizacion.js` (T-006, carril C) y cumple D-003: mayúsculas, `trim` y espacios colapsados (`\s` incluye tabuladores y U+00A0). **No se crea ni se modifica**: se reutiliza.
- Desde T-022, todo movimiento pasa por `Libro.aplicarMovimiento`, y STOCK_ACTUAL se escribe en un único sitio (`_persistir`). Por eso la normalización ya no se hace operación a operación, sino en **dos puntos únicos**.
- `src/InventoryEngine.js` **no se toca**: siete suites (fase6_1, fase7, fase8…) exigen que no cambie.
- `src/Código.js` **no se toca**: todas las `api*` delegan en los servicios, que son los que normalizan.

## Problema
- El CSV de ventas no trae códigos, solo `NombreArticulo` y `NombreEnvase`. El de compras escribe el mismo envase con otras mayúsculas («EPS 106 9x500» frente a «EPS 106 9X500»).
- Hoy, la clave es el texto tal como llega, solo con `trim` (`buildStockKey`). Una venta escrita «tomate rosa i m» no encuentra la partida de «TOMATE ROSA I M».
- Además, algunos métodos comparan el texto recibido directamente con el guardado. Ejemplo verificado: `dividirCapaEntrada` con «tomate rosa i m» falla con «la cantidad asignada a la combinación original (0) es inferior a las cajas consumidas», aunque la clave fuera correcta.
- Si no hay MAESTRO para la clave, `nombre_articulo` y `descripcion_envase` de STOCK_ACTUAL quedan vacíos.

## Reglas
1. **Clave única y normalizada.**
   - `Libro._keyLibro(art, env)` aplica `normalizarNombre` a las dos partes antes de construir la clave.
   - En `MovementService`, un método nuevo `_clave(art, env)` hace lo mismo y sustituye **todas** las llamadas `this.engine.buildStockKey(` (hoy, 16).
   - En `OperationalSafetyService`, las claves se construyen con `this.movementService._clave(...)`. Eso incluye la que hoy se arma a mano con `` `${s.codigo_articulo}|${s.codigo_envase}` `` en `validarDocumento`.
   - Si una parte normalizada está vacía o contiene `|`, es un error de validación: el movimiento no se aplica.
2. **Lo que se guarda va normalizado.** Un método nuevo `MovementService._aplicar(estado, mov)` normaliza `mov.codigo_articulo` y `mov.codigo_envase` y llama a `this.libro.aplicarMovimiento`. Sustituye **todas** las llamadas `this.libro.aplicarMovimiento(` (hoy, 18). Ese movimiento normalizado es el que se persiste, y las capas que crea heredan sus nombres.
3. **Comparaciones con texto de fuera.** Donde se compare un artículo o envase recibido del cliente con uno guardado, el recibido se normaliza antes. Sitios verificados en 4ef98fd; localízalos por el nombre de la función:
   - `MovementService._findLayer` (filtro por artículo y envase);
   - `MovementService.dividirCapaEntrada` (divisiones frente a la capa original);
   - `OperationalSafetyService.previsualizarCorreccionHistorica` (la misma comprobación de divisiones, y `nuevoArticulo`);
   - `OperationalSafetyService.validarDocumento` y `conciliarStock` (artículo y envase de las líneas y del stock externo);
   - `StockQueryService.obtenerDetalleStock` y `obtenerDetallePartidas` (filtros recibidos).

   Si encuentras otra comparación de este tipo en el flujo activo, normalízala igual y anótala en `aceptacion.md`.
4. **STOCK_ACTUAL nunca con nombres vacíos.** En `_persistir`:
   - si hay fila de MAESTRO para la clave (buscada con `_clave`), se usan sus nombres;
   - si no, `nombre_articulo` y `descripcion_envase` toman las dos partes de la clave.
5. **Fuera del flujo activo.** El flujo de PDF antiguo (`MaestroResolver`, `confirmarCompraPendiente`) no se modifica. Si pasa por `_aplicar`, quedará normalizado sin más; no hay que hacer nada aparte.

## Aceptación
1. **Prueba nueva:** una entrada «TOMATE ROSA I M» / «EPS 106 9x500» y una salida «tomate rosa i m » / «EPS  106 9X500» (doble espacio y espacio duro U+00A0) comparten clave `TOMATE ROSA I M|EPS 106 9X500`. La salida consume la capa de la entrada y su fila de CONSUMOS_FIFO apunta a esa capa.
2. **Prueba nueva:** `normalizarNombre` conserva tildes y signos («CARTON 40X30X9,5 MORESCO» y «CORUÑA» no cambian) y colapsa tabuladores, espacios dobles y espacios duros. Solo se prueba; `Normalizacion.js` no se modifica.
3. **Prueba nueva (todas las operaciones):** con nombres en minúsculas y espacios irregulares, funcionan:
   - `registrarAjuste` (+ y −);
   - `registrarReclasificacion`;
   - `registrarMovimientoPartida`;
   - `dividirCapaEntrada`, con el artículo original escrito en minúsculas;
   - `corregirEntradaParcial`;
   - `anularEntrada` por serie, número y artículo;
   - `StockQueryService.obtenerDetalleStock`.

   Al final, en MOVIMIENTOS, CAPAS_FIFO, STOCK_ACTUAL y CONSUMOS_FIFO, toda fila cumple `normalizarNombre(x) === x` en `codigo_articulo` y `codigo_envase`, y `comprobarConsistencia()` da 0 diferencias.
4. **Prueba nueva:** STOCK_ACTUAL de una clave sin fila en MAESTRO tiene `nombre_articulo` y `descripcion_envase` rellenos. Con fila en MAESTRO, usa los nombres del maestro.
5. **Prueba nueva:** un artículo o envase vacío, o con `|`, devuelve error de validación y no escribe nada.
6. Comprobaciones con `grep`:
   - `this.libro.aplicarMovimiento(` aparece **una sola vez** en `src/MovementService.js` (dentro de `_aplicar`);
   - `engine.buildStockKey(` aparece una sola vez en `MovementService.js` (dentro de `_clave`) y ninguna en `OperationalSafetyService.js`;
   - `git diff main -- src/InventoryEngine.js src/Código.js src/Normalizacion.js` está vacío.
7. `t022_propiedades.test.js` y `t003_consumos_fifo.test.js` siguen en verde, sin cambios.
8. `DATA_MODEL.md` y `BUSINESS_RULES.md` (§1) explican que la clave es por nombre normalizado (D-003), dónde se normaliza (reglas 1 y 2) y por qué.
9. `node test/run_all.js` con 0 fallos, salida en `logs/T-004/tests.txt`.
   - Si alguna prueba existente depende de que el texto se guarde sin normalizar (por ejemplo, minúsculas), **para y pregunta** antes de tocarla. En el prototipo del director técnico no hubo ninguna.

## Archivos previstos
- `src/Libro.js` (solo `_keyLibro`)
- `src/MovementService.js`
- `src/OperationalSafetyService.js`
- `src/StockQueryService.js` (solo normalizar los filtros recibidos; permiso expreso de este ticket)
- `DATA_MODEL.md`
- `BUSINESS_RULES.md`
- `test/t004_clave_nombre.test.js` (nuevo)
- `docs/tickets/T-004-clave-por-nombre.md` (este ticket, primer commit, sin editar)
- `logs/T-004/*`

Si necesitas otro, para y pregunta. **No toques** `src/InventoryEngine.js`, `src/Código.js` (carril B) ni `src/Normalizacion.js` (carril C).
No hay funciones globales nuevas: `_clave` y `_aplicar` son métodos privados. Si añades alguna global, clasifícala en `docs/API_PUBLICA.md` (prueba 7 de T-023) y avisa.

## Fuera de alcance
- El importador CSV (T-007), que ya produce nombres normalizados.
- Los grupos comerciales (T-005).
- El flujo de PDF antiguo.
- Convertir datos guardados antes de este ticket: no hay datos reales en producción.

## Parar y preguntar si
- Algún punto del flujo activo construye la clave sin pasar por `_clave` o `_keyLibro`, y no puedes cambiarlo sin tocar un archivo de otro carril.
- Una prueba existente comprueba texto sin normalizar.
