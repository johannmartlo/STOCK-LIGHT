# T-039 — Orden por calibre y subtotales por categoría en Existencias

Rama: `ticket/T-039-orden-calibre`, creada desde `main` = `d3f4ba0`. Sensible: **POCO** (solo cambia el orden y la presentación; no toca el libro ni el FIFO).
Especificación: 2026-11-27. Hoja de ruta P1, puntos 1 y 2.

## Problema
En la ficha de una familia (panel del ordenador y hoja del móvil), el desglose por artículo se ordena **por cajas** (`calcularDesgloseArticulos`, `src/ui/app.html` ~l. 91) y las partidas **solo por fecha** (`InicioService`, ~l. 566). El almacén lee el stock como en la hoja VISTA MOVIL del Excel: variedad → categoría → calibre de grande a pequeño, con subtotales por categoría. Hoy «Rojo I GG» puede salir debajo de «Rojo II S/C» solo porque tiene menos cajas.

## Lo que ya existe (no lo rehagas)
- `src/CalibreCategoria.js` → `extraerCalibreYCategoria(nombre)` devuelve `categoria` (`EXTRA`, `1ª CATEGORÍA (I)`, `2ª CATEGORÍA (II)`, …) y `calibre` (`GGG`, `GG`, `G`, `M`, `MM`, `MMM`, `S/C`, pesos como `500G`…). **Reutilízalo**; no escribas otro extractor.
- `InicioService` construye cada variedad (`construirVariedad`) con sus `partidas` (`articulo`, `envase`, `fecha`, `cajas`, `proveedor`…).
- `app.html`: `calcularDesgloseArticulos`, `construirDesgloseHtml`, `construirListaPartidasHtml`, `construirTextoWhatsApp`.

## Referencia: cómo lo hace CCO (Almacén Inteligente)
`js_Stock_Consultas.html` → `obtenerStockFiltrado`: ordena por **nombre base** (variedad sin la talla), después por el **peso de la talla** en una tabla (`configApp.pesoTalla`, talla → rango; la que no está vale 99) y por último por antigüedad. `js_Tablet_Stock.html` → `agruparStockPorJerarquia`: partidas de cada artículo de la más antigua a la más nueva, con desempate estable por id. Se copia **la idea** (tabla de rangos con valor por defecto alto, orden estable); el código no, porque CCO lee la tabla de Supabase y aquí es una constante.

## Reglas
1. **Módulo nuevo `src/OrdenExistencias.js`**, funciones puras (sin Sheets ni DOM), exportadas para Node y globales en Apps Script como el resto de `src/`:
   - `claveOrdenArticulo(nombreArticulo)` → `{ variedadBase, rangoCategoria, rangoCalibre, categoriaCorta, calibre }`.
     - `variedadBase`: el nombre normalizado sin las palabras de categoría (`EXTRA`, `I`, `II`), sin el calibre detectado y sin el sufijo `KG`/`UNID` entre paréntesis o suelto. Ej.: `TOMATE HUEVO DE TORO ROJO I GG` → `TOMATE HUEVO DE TORO ROJO`.
     - `rangoCategoria`: EXTRA 0 · I 1 · II 2 · cualquier otra 3.
     - `rangoCalibre`: GGG 0 · GG/GGG 1 · GG 2 · G 3 · M 4 · MM 5 · MMM 6 · pesos (`500G`, `1KG`…) 7 · `S/C` 8 · cualquier otro 9.
     - `categoriaCorta`: `Extra`, `Cat. I`, `Cat. II` o `''`.
   - `compararArticulos(a, b)` con `a`/`b` = `{ articulo, envase }`: variedadBase (`localeCompare('es')`) → rangoCategoria → rangoCalibre → envase (`localeCompare('es')`) → articulo. Orden **total y estable**.
   - `construirDesgloseOrdenado(partidas)` → lista de bloques `{ variedadBase, categoriaCorta, cajas, lineas: [{ articulo, envase, cajas }] }`, un bloque por variedadBase + categoría, en el orden de `compararArticulos`; dentro, una línea por artículo + envase con la suma de cajas. Las líneas con 0 cajas no salen.
2. **`InicioService.construirVariedad`**:
   - ordena `partidas` con `compararArticulos` y, a igualdad, por **fecha ascendente** y después `id_capa` (lo que hace hoy queda como desempate);
   - añade a cada variedad `desglose: construirDesgloseOrdenado(partidas)`.
   - `sale_primero` y `dias` siguen siendo los de la partida **más antigua de toda la variedad** (calcúlalos con el mínimo de fecha, no con `partidas[0]`, porque `partidas[0]` deja de ser la más antigua).
3. **`app.html`** (solo estas funciones):
   - `calcularDesgloseArticulos(v)`: si `v.desglose` existe, devuelve sus líneas en ese orden; si no, el comportamiento actual (compatibilidad).
   - `construirDesgloseHtml(v)`: antes de las líneas de cada bloque, una fila de subtotal cuando la variedad tiene **más de un bloque**: «Rojo · Cat. I» y sus cajas, en `var(--sl-text-secondary)` y peso 600. Con un solo bloque no se pinta subtotal (no añade ruido).
   - `construirTextoWhatsApp`: mismo orden que el desglose (sin subtotales; el texto ya es corto).
   - `construirListaPartidasHtml`: no cambia; recibe las partidas ya ordenadas.
4. **No cambian**: el orden de las familias (sale de AGRUPACIONES), la lista de Inicio, el parte de la noche, la importación, el libro, el FIFO ni `CalibreCategoria.js`.
5. **Documentación**: `DATA_MODEL.md` o `docs/API_PUBLICA.md` (lo que corresponda) con el campo nuevo `desglose` de la respuesta de inicio.

## Aceptación
1. **Prueba nueva** (`test/t039_orden_calibre.test.js`, nombres ficticios con la misma forma que los reales): una variedad con `TOMATE FICTICIO ROJO II S/C` (300 cajas), `… ROJO I G` (10), `… ROJO I GGG` (50), `… ROJO I GG` (20), `… ROJO EXTRA GG` (5) y `… AMARILLO I G` (1) → orden: AMARILLO I G · ROJO EXTRA GG · ROJO I GGG · ROJO I GG · ROJO I G · ROJO II S/C. Tres bloques de ROJO con subtotales 5 / 80 / 300.
2. **Prueba nueva:** dos partidas del mismo artículo y envase con fechas distintas → la más antigua primero; con la misma fecha, por `id_capa`.
3. **Prueba nueva:** `sale_primero` = fecha mínima de la variedad aunque esa partida no sea la primera del orden nuevo.
4. **Prueba nueva:** artículos sin calibre ni categoría (`TOMATE FICTICIO AZUL`) y con peso (`… 500G`) no rompen nada y van detrás de los calibres, en el orden del punto 1.
5. **Prueba nueva:** `compararArticulos` es un orden total: para 200 artículos aleatorios, ordenar la lista barajada de 30 formas distintas da siempre el mismo resultado.
6. **Prueba nueva:** con `desglose` ausente, `calcularDesgloseArticulos` sigue ordenando por cajas (compatibilidad); con `desglose`, respeta su orden.
7. Ninguna prueba existente se modifica. `node test/run_all.js` con 0 fallos, salida en `logs/T-039/tests.txt`.

## Archivos previstos
- `src/OrdenExistencias.js` (nuevo)
- `src/InicioService.js` (solo `construirVariedad` y el `require` del módulo nuevo)
- `src/Código.js` (solo si hace falta exponer el módulo en Node, como los demás)
- `src/ui/app.html` (solo las tres funciones de la regla 3)
- `DATA_MODEL.md` o `docs/API_PUBLICA.md`
- `test/t039_orden_calibre.test.js` (nuevo, datos ficticios)
- `docs/tickets/T-039-orden-calibre.md` (este ticket, primer commit, sin editar), `logs/T-039/*`

**No toques** `MovementService.js`, `Libro.js`, `InventoryEngine.js`, `CalibreCategoria.js`, `ParteService.js` ni nada de `importacion/`. **Nada de datos reales.** Si necesitas otro archivo, para y pregunta.

## Fuera de alcance (tickets siguientes)
Nombres cortos («Rojo I GG · Madera TDA», P1-3), buscador «azul gg» (P1-4), semáforo y filtro «antiguas» (P1-9; CCO usa verde < 3 días, ámbar 3-5, rojo ≥ 6), mismo orden en el parte de la noche.

## Entrega
`logs/T-039/informe.md`: resumen de 5 líneas, `git status`, `git log --oneline -5` y **«Dudas»** con TODO cambio no pedido.
