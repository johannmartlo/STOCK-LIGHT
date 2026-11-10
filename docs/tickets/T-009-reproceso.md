# T-009 — Reproceso: varios orígenes, varios destinos y destrío, sobre el libro

Carril: A (núcleo). Rama: `ticket/T-009-reproceso`, creada desde `main` **después del merge de T-005**. Sensible: **sí** (escribe stock).
Especificación: 2026-10-23, **re-basada el 2026-11-05** sobre T-022, T-003 y T-004, e incluida en el MVP por D-030. **Ajustada el 2026-11-07 con D-036 (destrío).** Decisiones D-011 (ampliada), D-012, D-022, D-024, D-030, D-036.

## Por qué ahora
Los reprocesos y cambios de envase ocurren **a diario**, y **Hispatec no los registra** (D-030). Ejemplos reales:
- Rosa de Sabor I M → tarrinas 500 en EPS 106 9X500;
- Rosa de Sabor I G + I GG → Rosa de Sabor I sin calibre en cartón 40X30X14;
- **calibrado:** entran 1.000 cajas en cartón sin calibre y se pasan a calibres, cada uno con su artículo y a menudo con otro envase. Se hace **por tandas**.

Sin reproceso, la venta del producto reprocesado no encuentra stock y el origen sigue figurando como existente.

## Lo que ya existe (verificado en 5d8328a; no lo rehagas)
- `Libro.aplicarMovimiento` tiene ya las dos piezas:
  - **CASO 5:** AJUSTE − con `id_capa_objetivo`, que consume de una capa concreta y apunta el consumo;
  - **CASO 1:** AJUSTE + sin capa objetivo, que crea una capa con `fecha_capa = fecha_negocio`, `proveedor = entidad_nombre` e `id_capa_origen`.

  **El reproceso es una combinación de esas dos piezas. No se toca el motor.**
- `MovementService._aplicar`, `_clave`, `_persistir` (un único punto de escritura) y el patrón de operación con varios movimientos bajo un lock (`dividirCapaEntrada`).
- CONSUMOS_FIFO (T-003), anulaciones exactas (D-012), `nuevoId` (D-024) y nombres normalizados (T-004).
- `registrarReclasificacion`, `registrarMovimientoPartida` y `dividirCapaEntrada` **no se modifican**. Su sustitución en pantalla es del ticket de pantallas (D-011).

## Reglas
1. **Lógica pura en `src/Reproceso.js`** (sin Sheets). `planificarReproceso(params, capas)` valida y devuelve la lista de movimientos que hay que aplicar, o un error. Parámetros:
   - **`origenes`**, de una de estas dos formas:
     - lista de `{ id_capa, cajas }`: partidas elegidas una a una;
     - `{ articulo, envase, cajas, ids_capa? }`: un total que se reparte por FIFO entre las partidas elegidas, o entre todas las capas activas de esa combinación si no se eligen.
   - **`destinos`**: 1..N elementos `{ articulo, envase, cajas }`, con cajas entero > 0. Se normalizan (T-004). Un destino puede tener la misma combinación que el origen.
   - **`destrio_cajas`**: entero ≥ 0, en **cajas de origen** (D-036). Es un **dato**, no un movimiento (D-011):
     - **si todos los orígenes y todos los destinos tienen el mismo envase** (normalizado), es opcional; si no viene, vale `max(0, total retirado − total destinos)`;
     - **si algún envase es distinto**, es **obligatorio** (puede ser 0). Si falta, error: «Indica el destrío en cajas: al cambiar de envase no se puede calcular». Nunca se deduce.
   - **`destrio_kg`** (opcional): número ≥ 0, informativo (D-025, D-036). Ninguna regla de stock lo lee.
   - **`fecha`** (opcional): fecha de registro del reproceso; por defecto, hoy en Europe/Madrid. **No** es la fecha de las capas destino.
   - **`observaciones`** (opcional).
   - **Por tandas:** reprocesar parte de una partida (por ejemplo, 400 de 1.000) es un reproceso normal; la partida conserva el resto. No hay estado «reproceso abierto».
2. **Validaciones**, que fallan con un mensaje claro y sin escribir nada:
   - cada capa de origen existe y está ACTIVA;
   - las cajas pedidas a cada capa no superan sus `cajas_restantes`. Mensaje: «La partida X solo tiene N cajas»;
   - total por combinación ≤ stock disponible;
   - destinos válidos (nombres no vacíos, sin `|`);
   - `destrio_cajas` presente cuando hay cambio de envase (regla 1); `destrio_cajas` y `destrio_kg`, si vienen, no negativos.
3. **Efectos**, en `MovementService.registrarReproceso(params, usuario)`: atómicos, con un solo lock y un solo `_persistir`, y todos con `id_documento_ref = REPROCESO:<id>` (`nuevoId('REP')`).
   - **Por cada capa de origen:** un AJUSTE − con `id_capa_objetivo` = esa capa y motivo `REPROCESO_ORIGEN` (CASO 5).
   - **Por cada destino:** un AJUSTE + con motivo `REPROCESO_DESTINO` (CASO 1), con:
     - `fecha_negocio` = la `fecha_capa` **más antigua** de las capas de origen (D-011);
     - `entidad_nombre`/proveedor = el proveedor común de los orígenes, o `VARIOS` si son distintos (D-030);
     - `id_capa_origen` = la capa de origen si es única; si hay varias, vacío (la relación está en la regla 4);
     - `origen_dato` = `MANUAL`.
   - Todo pasa por `_aplicar`. Después de la operación, la reconstrucción coincide con el estado en vivo (D-022).
4. **Registro del reproceso** (documento; no es un derivado). Dos hojas nuevas en `SCHEMA_DEFINITIONS`:
   - `REPROCESOS`: `id_reproceso, fecha, fecha_hora, usuario, total_retirado, total_destinos, destrio_cajas, destrio_kg, cambio_envase (SI|NO), estado (ACTIVO|ANULADO), observaciones`;
   - `REPROCESO_LINEAS`: `id_reproceso, tipo (ORIGEN|DESTINO), id_capa, codigo_articulo, codigo_envase, cajas, proveedor, fecha_capa, destrio_prorrateado, id_movimiento`.
     - En las líneas ORIGEN, `destrio_prorrateado` reparte `destrio_cajas` en proporción a las cajas retiradas de cada capa: enteros, y el resto a la capa con más cajas. La suma es exactamente `destrio_cajas` (D-030).
     - En las líneas DESTINO, `id_capa` es la capa creada.

   Se escriben dentro del mismo lock, **antes** que los derivados, siguiendo el orden de `_persistir`.
5. **`anularReproceso(idReproceso, usuario)`:**
   - si alguna capa destino tiene consumos (`cajas_consumidas > 0`), devuelve `REVISION_NECESARIA` y no toca nada;
   - si no, añade las ANULACION de cada movimiento del reproceso: las capas destino desaparecen y las cajas vuelven a cada capa de origen por CONSUMOS_FIFO (D-012). El reproceso pasa a ANULADO;
   - anular dos veces devuelve error sin escribir;
   - si el núcleo no permite anular el AJUSTE + que creó una capa, **para y pregunta**. No cambies el motor.
6. **`sugerenciasReproceso(articulo, envase, limite = 5)`:** conjuntos de destinos usados antes desde esa combinación de origen, del más reciente al más antiguo, con las cajas de la última vez. Un reproceso con tres destinos (por ejemplo, G, GG y M) se devuelve como **un conjunto**, para que la pantalla los proponga juntos. Solo lectura (D-030).
7. **API** en `src/Código.js`, clasificada en `docs/API_PUBLICA.md`:
   - `apiRegistrarReproceso(params)`: ESCRITURA;
   - `apiAnularReproceso(id)`: ESCRITURA;
   - `apiListarReprocesos(filtros)`: LECTURA;
   - `apiSugerenciasReproceso(articulo, envase)`: LECTURA.

   La auditoría usa `usuarioActual_()`. `apiObtenerDetallePartidas` debe devolver `proveedor` y `fecha_capa`; si no lo hace, añádelos.
8. Los motivos `REPROCESO_ORIGEN`, `REPROCESO_DESTINO` y `DESTRIO` existen en el catálogo de motivos de ajuste (BUSINESS_RULES §6). El destrío directo, sin reproceso, sigue siendo un AJUSTE − con motivo `DESTRIO`.

## Aceptación
1. **Prueba nueva (un origen, cambio de envase):**
   - capa A «TOMATE ROSA SABOR I M | CARTON 40X30X14 GENERICA», 100 cajas, proveedor «PROV A», fecha 2026-10-15;
   - se reprocesan 60 cajas a «TOMATE ROSA SABOR I | EPS 106 9X500» con 90 cajas;
   - **sin `destrio_cajas`**: error con el mensaje de la regla 1, y nada cambia;
   - con `destrio_cajas: 3` y `destrio_kg: 18`: A queda en 40; el destino tiene 90 cajas, fecha 2026-10-15, proveedor PROV A e `id_capa_origen` = A. REPROCESOS guarda 3, 18 y `cambio_envase = SI`;
   - CONSUMOS_FIFO tiene la fila del AJUSTE − sobre A.
2. **Prueba nueva (varios orígenes, mismo envase, género mezclado):**
   - capas «TOMATE ROSA SABOR I G | CARTON 40X30X14» (PROV A, 2026-10-10, 30 cajas) y «TOMATE ROSA SABOR I GG | CARTON 40X30X14» (PROV B, 2026-10-12, 20 cajas);
   - se reprocesan enteras a «TOMATE ROSA SABOR I S/C | CARTON 40X30X14» con 45 cajas, sin `destrio_cajas`;
   - resultado: el destino tiene fecha 2026-10-10 y proveedor VARIOS. El destrío se deduce como 5, con `cambio_envase = NO`, y REPROCESO_LINEAS lo prorratea en 3 y 2.
3. **Prueba nueva (calibrado por tandas, D-036):**
   - capa C «TOMATE SIN CALIBRE | CARTON 40X30X14», 1.000 cajas, PROV C, 2026-11-02;
   - tanda 1: 400 cajas → «… G | EPS 106» 180, «… GG | CARTON 40X30X14» 150, «… M | TARRINA 500» 50, con `destrio_cajas: 20`;
   - resultado: C queda en 600; los tres destinos tienen fecha 2026-11-02 y PROV C; REPROCESOS guarda 400 retiradas, 380 destinos y 20 de destrío;
   - tanda 2 sobre las 600 restantes: C queda en 0 y la suma de las dos tandas cuadra.
4. **Prueba nueva (total repartido por FIFO):** con capas de 50 (más antigua) y 40 de la misma combinación, retirar 70 consume 50 + 20.
5. **Prueba nueva (FIFO después):** con la capa del punto 1 y una compra posterior de la misma combinación destino, una venta de 100 consume primero la capa reprocesada (fecha 15/10).
6. **Prueba nueva (errores):** pedir más cajas de las que tiene una capa, usar una capa inactiva, enviar un destino vacío o un destrío negativo devuelve error, y MOVIMIENTOS, capas y REPROCESOS quedan igual.
7. **Prueba nueva (anular):**
   - sin consumos en destino, todo vuelve exactamente al estado anterior: capas, stock y CONSUMOS_FIFO;
   - con consumos, `REVISION_NECESARIA` y nada cambia;
   - una segunda anulación da error.
8. **Prueba nueva (sugerencias):** después de dos reprocesos de X a {Y} y uno de X a {Z1, Z2, Z3} (el último), `sugerenciasReproceso(X)` devuelve primero el conjunto {Z1, Z2, Z3} con sus cajas y luego {Y}.
9. **Prueba de propiedades.** Autorización expresa para **añadir** a `test/t022_propiedades.test.js` las operaciones REPROCESO (1-2 orígenes, 1-3 destinos; cuando el generador elija un envase distinto, envía `destrio_cajas`) y ANULAR_REPROCESO, sin cambiar la semilla, el número de operaciones ni las aserciones existentes. Tras cada operación siguen valiendo `comprobarConsistencia() = 0` y el invariante de consumos por capa de T-003.
10. Las pruebas de `registrarReclasificacion`, `registrarMovimientoPartida` y `dividirCapaEntrada` siguen en verde sin cambios.
11. `docs/API_PUBLICA.md` actualizado (prueba 7 de `t023_superficie.test.js` en verde). `BUSINESS_RULES.md` (§6, reproceso y destrío, con la regla de D-036) y `DATA_MODEL.md` (REPROCESOS y REPROCESO_LINEAS) actualizados. `node test/run_all.js` con 0 fallos, salida en `logs/T-009/tests.txt`.

## Archivos previstos
- `src/Reproceso.js` (nuevo, puro)
- `src/MovementService.js` (`registrarReproceso`, `anularReproceso`, `sugerenciasReproceso`)
- `src/Repository.js` (esquema y lectura/escritura de REPROCESOS y REPROCESO_LINEAS)
- `src/StockQueryService.js` (solo si `apiObtenerDetallePartidas` necesita `proveedor` y `fecha_capa`)
- `src/Código.js` y `docs/API_PUBLICA.md` (permiso expreso; carril B en paralelo, ver coordinación)
- `test/t009_reproceso.test.js` (nuevo)
- `test/t022_propiedades.test.js` (solo añadir operaciones; aceptación 9)
- `BUSINESS_RULES.md`, `DATA_MODEL.md`
- `docs/tickets/T-009-reproceso.md` (este ticket, primer commit, sin editar)
- `logs/T-009/*`

Si necesitas otro, para y pregunta. **No toques** `src/Libro.js` ni `src/InventoryEngine.js`. Si crees que hace falta tocarlos, para y pregunta.
**Puntos de inserción** (el carril C, con T-007, trabaja en paralelo sobre los mismos archivos, en otros puntos):
- `MovementService.js`: los métodos nuevos van **inmediatamente después de `dividirCapaEntrada`**;
- `Repository.js`: las hojas nuevas van **inmediatamente después de `CONSUMOS_FIFO`** en `SCHEMA_DEFINITIONS`;
- `Código.js`: la API va **inmediatamente después de `apiDividirEntrada`**.

**Coordinación con T-020 (acceso, carril B, en paralelo):** si al rebasar sobre `main` ya existe `exigirSesionApi_` (T-020 fusionado), toda `api*` nueva de este ticket empieza con `exigirSesionApi_();` y se añade a `PERMISOS_API` en `src/Seguridad.js` con su rol mínimo: LECTURA → CONSULTA, ESCRITURA → ENCARGADO. La prueba de cobertura de T-020 lo exige. Si T-020 aún no está fusionado, no hagas nada de esto.

## Fuera de alcance
- Pantalla de reproceso rápida (P-3 del plan de cierre).
- Reintento automático de pendientes tras el reproceso (T-008, D-030).
- Rendimiento por kilos y estadísticas de calidad por agricultor (después del cierre).
- Retirar de la interfaz la reclasificación, la división y el movimiento de partida (P-1/P-3).

## Parar y preguntar si
- El núcleo no permite alguna de las operaciones sin tocar `Libro.js`.
- La reconstrucción no coincide con el estado en vivo tras un reproceso o su anulación.
- **Cualquier cambio no descrito en este ticket, aunque sea en un archivo previsto, se lista en «Dudas».**
