# T-031 — Exclusiones: clientes excluidos y nombres comerciales fuera

Rama: `ticket/T-031-exclusiones`, creada desde `main` (el hash te lo indico al lanzarlo). Sensible: **sí** (decide qué entra en el stock).
Especificación: 2026-11-26, revisada el mismo día. Decisiones del responsable (D-039), tras la primera prueba con CSV reales:
1. **Las entradas saldrán del informe de RECEPCIONES de Hispatec** (lo que llega físicamente al almacén), no del informe de entradas. Su lector va en T-032. Por eso este ticket **no** cambia las series de compra.
2. **Las ventas a ciertos clientes no pasan por el almacén** (compras entre empresas y clientes servidos directamente) y no deben tocar el stock.
3. **Ciertos nombres comerciales nunca pasan por el almacén** y quedan fuera aunque aparezcan.

## Lo que ya existe (verificado en main; no lo rehagas)
- `PREFIJOS_SERIES_IMPORTACION` en `src/Config.js`: entradas `['ACT', 'NT']`, salidas `['AVT']`. `ClasificadorLineas` marca `SERIE_IGNORADA` lo que no cuenta.
- Las reglas de catálogo (REGLAS_CLASIFICACION, D-029) con `articulo_contiene`, `valor` SI/NO y `prioridad`. La semilla pone «TOMATE → SI» y el resto → NO.
- Las líneas de venta llevan la entidad (cliente) en el campo que ya usa T-007.

## Reglas
1. **Clientes excluidos:**
   - hoja nueva **`CLIENTES_EXCLUIDOS`** (`patron, activo, nota, fecha_alta, usuario`);
   - una línea de **venta** cuya entidad contiene, tras normalizar (mayúsculas, sin acentos ni espacios sobrantes), algún `patron` activo → estado nuevo **`CLIENTE_EXCLUIDO`**;
   - una línea `CLIENTE_EXCLUIDO` no genera movimientos, no va a PENDIENTES y no cuenta como sin stock;
   - en la previsualización y en IMPORTACIONES se cuenta aparte (`lineas_cliente_excluido`);
   - un documento con todas sus líneas excluidas queda registrado como importado, para que reimportarlo dé `YA_IMPORTADO`.
2. **Nombres comerciales fuera:** con reglas de catálogo de seguimiento `NO` y **prioridad mayor** que la regla «TOMATE → SI», para que ganen. No con código nuevo.
3. **Configuración sin datos reales en el repositorio** (es público): **ni la semilla ni el código** llevan nombres de clientes. Funciones de administración con `exigirPropietario_()`:
   - `adminConfigurarClientesExcluidos(patrones)`: añade los patrones que falten; idempotente; no borra;
   - `adminConfigurarArticulosFuera(patrones)`: crea o actualiza las reglas de la regla 2 con esos patrones; idempotente.
   - Las dos devuelven qué se añadió y qué ya estaba.
4. **API** de solo lectura `apiListarExclusiones()` (CONSULTA): clientes excluidos y nombres fuera, para la futura pantalla de configuración.
5. **`IMPORT_SPECS.md` y `BUSINESS_RULES.md`:** documenta las dos reglas en lenguaje llano, con ejemplos **ficticios**.

## Aceptación
1. **Prueba nueva:** con `adminConfigurarClientesExcluidos(['CLIENTE FICTICIO'])`:
   - una venta a «Cliente Ficticio, S.L.» queda `CLIENTE_EXCLUIDO`, sin movimientos ni pendientes;
   - una venta del mismo artículo a otro cliente consume stock normalmente;
   - el recuento aparece en la previsualización.
2. **Prueba nueva:** con `adminConfigurarArticulosFuera(['NOMBRE COMERCIAL X'])`, «TOMATE NOMBRE COMERCIAL X EXTRA» queda `NO_SEGUIDA` aunque empiece por TOMATE, y otro tomate sigue SEGUIDO.
3. **Prueba nueva:** las dos funciones `admin*` llamadas dos veces dejan el mismo estado; sin ser propietario, lanzan.
4. **Prueba nueva:** reimportar un CSV con documentos totalmente excluidos da `YA_IMPORTADO`, sin filas nuevas.
5. **Prueba nueva (invariante):** con 30 semillas aleatorias que mezclan clientes excluidos y nombres fuera:
   - el stock = compras de artículos seguidos − ventas no excluidas aplicadas;
   - ningún movimiento procede de líneas excluidas;
   - `comprobarConsistencia().consistente === true`.
6. `apiListarExclusiones` se rechaza sin sesión y la cobertura de `t020_acceso.test.js` sigue en verde.
7. `node test/run_all.js` con 0 fallos, salida en `logs/T-031/tests.txt`.

## Archivos previstos
- `src/importacion/ClasificadorLineas.js` (estado `CLIENTE_EXCLUIDO`)
- `src/importacion/ImportacionService.js` (**solo** el recuento `lineas_cliente_excluido` y pasar la lista de excluidos al clasificador)
- `src/Repository.js` (solo la hoja `CLIENTES_EXCLUIDOS` y la columna de IMPORTACIONES)
- `src/Exclusiones.js` (nuevo: las dos funciones `admin*` y la lectura)
- `src/Código.js`, `src/Seguridad.js`, `docs/API_PUBLICA.md`, `IMPORT_SPECS.md`, `BUSINESS_RULES.md`, `DATA_MODEL.md`
- `test/t031_exclusiones.test.js` (nuevo)
- `docs/tickets/T-031-exclusiones.md` (este ticket, primer commit, sin editar)
- `logs/T-031/*`

**No toques** `src/importacion/CsvHispatecParser.js` (T-030), `CorreccionService.js` (T-027), `src/ui/`, `MovementService.js`, `Libro.js` ni `InventoryEngine.js`. **Ningún nombre real de cliente ni de proveedor en el repositorio.** Si necesitas otro archivo, para y pregunta.

## Entrega
Escribe en `logs/T-031/informe.md`:
- un resumen de 5 líneas;
- la salida de `git status` y de `git log --oneline -5`;
- **«Dudas»** con TODO cambio no pedido.
