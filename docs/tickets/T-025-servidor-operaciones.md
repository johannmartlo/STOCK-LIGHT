# T-025 — Servidor de Cambiar, Movimientos y búsqueda (para P-3)

Rama: `ticket/T-025-servidor-operaciones`, creada desde `main` = `bb816bc`. Sensible: **no escribe nada**; todo es de solo lectura. Va en paralelo con T-024, que hace las pantallas: **no toques nada de interfaz**.
Especificación: 2026-11-25. Diseño: `DISENO.md` v3 (D-037), apartado «Cambios de servidor que pide el diseño», puntos 3, 5 y 6, más el historial de movimientos.

## Lo que ya existe (verificado en main; no lo rehagas)
- `MovementService.sugerenciasReproceso(articulo, envase, limite)`: conjuntos de destinos de reprocesos anteriores con el mismo origen, sin proporciones.
- `anularReproceso`, `anularEntrada` y `anularSalida`, con sus reglas de rechazo (por ejemplo, destinos ya vendidos).
- REPROCESOS (`destrio_cajas`, `estado`, …) y REPROCESO_LINEAS (`tipo` ORIGEN/DESTINO, `id_capa`, `cajas`, `proveedor`, `fecha_capa`).
- Libro de solo añadir: anular crea movimientos `ANULACION` (D-022).
- Agrupación `COMERCIAL` del catálogo (D-029) para saber a qué variedad pertenece cada artículo + envase.

## Reglas
Todo va en **`src/OperacionesService.js`** (nuevo), de solo lectura: lee cada hoja una vez por llamada y nunca escribe.

1. **`apiSugerenciasCambio(articulo, envase)`** (CONSULTA) devuelve los conjuntos de destino habituales para ese origen, los más recientes primero, como mucho 5. Cada conjunto lleva:
   - `destinos: [{ articulo, envase, proporcion }]`, donde `proporcion` es la mediana, en los **5 últimos** reprocesos no anulados con ese origen y ese conjunto, de cajas de ese destino dividido entre cajas de origen;
   - `proporcion_total`: la mediana de cajas destino totales dividido entre cajas de origen;
   - `destrio_habitual`: la mediana de cajas de destrío dividido entre cajas de origen;
   - `veces`: cuántas veces se ha usado y `ultima_vez` (fecha).

   Sin historial, devuelve una lista vacía.
2. **`evaluarCambio_(origenCajas, destinos, sugerencia)`** (interna, para la pantalla vía `apiSugerenciasCambio` o una API ligera `apiEvaluarCambio`, CONSULTA):
   - devuelve `{ esperado, real, desviacion_pct, rinde_distinto }`;
   - `rinde_distinto` es verdadero si la desviación supera el 10 %; deja el umbral como constante con nombre;
   - con el ejemplo del diseño: 60 cajas → 86 da «1 caja → 1,43».
3. **`apiPrevisualizarAnulacion(tipo, id)`** (CONSULTA), con `tipo` = `REPROCESO`, `ENTRADA` o `SALIDA`, devuelve sin escribir nada:
   - `posible` (sí/no) y `motivo` si no es posible, con las **mismas reglas** que la anulación real;
   - qué partidas **vuelven** (con cajas) y cuáles **desaparecen o bajan**;
   - el efecto en cajas por variedad.

   **Invariante obligatorio:** `posible` coincide siempre con el resultado de la anulación real (ver aceptación 3). Si para eso necesitas reutilizar una comprobación interna de `MovementService`, llámala; **no la copies ni la cambies**. Si no se puede sin modificar `MovementService`, para y pregunta.
4. **`apiListarMovimientos(filtros)`** (CONSULTA) devuelve el historial como transacciones de banco, **agrupado por fecha de negocio** (lo más reciente arriba).
   - **Filtros:** `tipo` (entrada, salida, cambio, destrío, ajuste, stock inicial, anulación), `variedad`, `desde`, `hasta` y `texto` (proveedor, cliente, artículo o albarán; sin distinguir mayúsculas ni acentos).
   - **Paginado:** `limite` (50 por defecto) y `cursor`.
   - **Cada elemento:** `{ id, tipo, texto, detalle, cajas (con signo), variedad, documento, usuario, fecha_hora, anulable, anulado, anulado_por }`.
   - Un reproceso sale como **un solo elemento** (tipo cambio, «60 Rosa madera → 86 Rosa 500 · destrío 2»), no como varios movimientos.
   - Una anulación sale enlazada con lo que anula. Lo anulado queda marcado como `anulado` y no se cuenta dos veces.
5. **`apiBuscar(texto)`** (CONSULTA), la búsqueda ⌘K:
   - como mucho 20 resultados, agrupados en `variedades`, `partidas` (proveedor, artículo, fecha), `albaranes` (serie/número) y `cambios`;
   - sin distinguir mayúsculas ni acentos;
   - cada resultado con lo necesario para abrirlo (`id` y `tipo`).
6. Las API nuevas, en `PERMISOS_API` y en `docs/API_PUBLICA.md`, todas como LECTURA y rol CONSULTA.

## Aceptación
1. **Prueba nueva (proporción):** con 7 reprocesos del mismo origen y conjunto, la proporción es la mediana de los 5 últimos. Un reproceso anulado no cuenta. Con 60 → 86 sale 1,43.
2. **Prueba nueva (rinde distinto):** una desviación del 9 % no avisa y una del 11 % sí.
3. **Prueba nueva (anulación, con semillas aleatorias):** en 30 escenarios con entradas, ventas, reprocesos y anulaciones:
   - para cada operación, `apiPrevisualizarAnulacion` y después la anulación real sobre una copia del entorno deben coincidir en `posible`;
   - las cajas que la vista previa dice que vuelven o desaparecen deben ser las que cambian de verdad;
   - la vista previa no modifica nada (compara una instantánea de antes y después).
4. **Prueba nueva (movimientos):** la suma de `cajas` de los elementos no anulados de todo el historial = stock total actual. Un reproceso aparece una sola vez. Los filtros por tipo, variedad, fecha y texto devuelven solo lo que corresponde. El paginado no repite ni pierde elementos.
5. **Prueba nueva (búsqueda):** encuentra «rosa» en «ROSA» y «Rosá». Encuentra un albarán por su número. Nunca devuelve más de 20 resultados.
6. **Prueba nueva (rendimiento):** con 5.000 movimientos simulados, cada API responde en menos de 2 s en Node.
7. Las API nuevas se rechazan sin sesión y la cobertura de `t020_acceso.test.js` sigue en verde.
8. `node test/run_all.js` con 0 fallos, salida en `logs/T-025/tests.txt`.

## Archivos previstos
- `src/OperacionesService.js` (nuevo)
- `src/Código.js` (solo las API nuevas), `src/Seguridad.js` (solo `PERMISOS_API`), `docs/API_PUBLICA.md`
- `test/t025_operaciones.test.js` (nuevo)
- `docs/tickets/T-025-servidor-operaciones.md` (este ticket, primer commit, sin editar)
- `logs/T-025/tests.txt`, `logs/T-025/informe.md`

Si necesitas otro, para y pregunta. **No toques** `src/Index.html`, `src/ui/`, `src/InicioService.js` (los hace T-024), `src/MovementService.js`, `src/Libro.js`, `src/InventoryEngine.js`, `src/Reproceso.js`, `src/Catalogo*.js`, `src/SemillaCatalogo.js` ni `src/importacion/*`.

## Fuera de alcance
- Pantallas (P-3).
- Registrar cambios o anular: ya existen.
- Recuento rápido.

## Parar y preguntar si
- La vista previa de anulación no pudiera garantizar el invariante sin modificar `MovementService`.
- Hiciera falta escribir en alguna hoja.

## Entrega
Escribe en `logs/T-025/informe.md`:
- un resumen de 5 líneas;
- la salida de `git status` y de `git log --oneline -5`;
- **«Dudas»** con TODO cambio no pedido por el ticket.
