# T-041 — Pulido de lectura: nombres, gráfico honesto, contraste y carga oscura

Rama: `ticket/T-041-pulido-lectura`, creada desde `main` = `d3f4ba0`. Sensible: **POCO** (presentación; no toca el libro, el FIFO ni la importación).
Especificación: 2026-11-27. Origen: `analisis/VALORACION_DISENO_2026-11-27.md` (nota global 6,6; objetivo 9,5).
**Convive con T-039** (otra rama, también toca `app.html` e `InicioService.js`): no toques `calcularDesgloseArticulos`, `construirDesgloseHtml`, `construirTextoWhatsApp` ni `construirVariedad`. Se fusionará una detrás de otra con rebase.

## Problema (visto en DEV el 27/11 con 4.293 cajas)
1. **Nombres:** «Huevo De Toro», «Tomates De Autor», «Volley Hd Q5», «Naturfresh Sat», «Carton», «Generica».
2. **Gráfico de Existencias:** la curva sube de 0 a 4.293 y dice «+4.293 cajas esta semana». El stock inicial se cuenta como entrada de la semana. Es falso y quita confianza en el número.
3. **Movimientos:**
   - el detalle dice «26/11 · STOCK INICIAL · STOCK_INICIAL»: el código técnico se repite;
   - los motivos salen como códigos (`RECUENTO`, `ERROR_CARGA`…);
   - el autor sale como correo cuando se ejecutó desde el editor y como nombre en lo demás.
4. **Contraste:**
   - `--sl-text-label` #5C6068 sobre #0A0A0B = 3,1:1;
   - `--sl-out` #71717A = 4,1:1;
   - AA pide 4,5:1 para texto normal.
5. **Texto pequeño:** unas 82 reglas con 10-12 px.
6. **Pantalla blanca al cargar:** la hoja de Google Fonts va enlazada en `<head>` antes de cualquier estilo y bloquea el pintado; hasta que llega, el fondo es blanco.

## Reglas
1. **Nombres legibles** (`src/NombresLegibles.js` y su réplica `nombreLegible` en `src/ui/app.html` y `src/ui/parte.html`; **las tres copias con las mismas reglas**):
   - **Siglas** que van en mayúscula: añade `HD`, `TDA`, `SAT`, `SL`, `SA`, `SLL`, `IFCO`, `LL`, `EPS`, `POOL`, `S/C` a las existentes.
   - **Palabras de enlace** en minúscula salvo si son la primera: `de`, `del`, `la`, `las`, `el`, `los`, `y`, `en`, `con`, `para`.
   - **Tildes** (diccionario cerrado; solo palabra completa): CARTON→Cartón, GENERICA→Genérica, GENERICO→Genérico, JAPONES→Japonés, CORAZON→Corazón, PLASTICO→Plástico, CAMARA→Cámara.
   - El resto, como hoy. Nada cambia en los datos guardados: **solo es presentación**.
2. **Gráfico y variación semanal** (`InicioService`, solo la serie de 30 días; `app.html`, solo `calcularDeltaSemanal`):
   - Los movimientos de **stock inicial** (`motivo_ajuste` o `origen_dato` = `STOCK_INICIAL`) **no suman** a `entradas` de la serie.
   - La respuesta incluye `fecha_inicio_datos`: la fecha del primer stock inicial confirmado, o vacía si no hay.
   - Los días de la serie anteriores a esa fecha salen con `stock: null` (el gráfico no los dibuja; no es 0).
   - `calcularDeltaSemanal` compara con el primer día de la ventana de 7 días **que tenga dato**. Si la ventana empieza antes de `fecha_inicio_datos`, compara con el stock de ese día después de aplicar el stock inicial. Con el stock inicial del 26/11 y nada más, hoy dice «0 cajas esta semana» (y, si hay datos de menos de 7 días, «desde el 26/11» en lugar de «esta semana»).
   - El gráfico (donde se pinte la serie en `app.html`) **corta la línea** en los `null`: no dibuja una rampa desde 0.
3. **Movimientos** (`OperacionesService`, construcción de `detalle` y `usuario` de las transacciones):
   - Si la transacción es de stock inicial, el detalle **no** repite el motivo.
   - Los motivos se traducen con un mapa cerrado: STOCK_INICIAL→Stock inicial, RECUENTO→Recuento, ERROR_CARGA→Error de carga, DESTRIO→Destrío, OTRO→Otro, ANULACION_AJUSTE→Anulación de ajuste, REPROCESO→Cambio de confección. Lo que no esté en el mapa se muestra en minúsculas con la primera en mayúscula y `_` → espacio.
   - **Autor visible:** si `usuario` contiene `@`, se muestra el nombre del único usuario ADMIN activo de la hoja USUARIOS; si no hay exactamente uno, la parte anterior a la `@`. El dato guardado no cambia.
   - La búsqueda (`_busqueda`) sigue incluyendo el valor original.
4. **Contraste** (`src/ui/estilos.html`):
   - `--sl-text-label` → `#80858E` (5,3:1 sobre el fondo; 4,8:1 sobre el panel);
   - `--sl-out` → `#8B8B94` (5,9:1);
   - comprueba que ningún otro color de texto sobre `#0A0A0B`, `#121214` o `#18181B` quede por debajo de 4,5:1 y lista en el informe los que cambies.
5. **Tamaños** (todas las hojas de estilo de `src/ui/` e `Index.html`):
   - ningún texto por debajo de **12 px**;
   - el texto secundario de las filas (detalle debajo del nombre en variedades, partidas y movimientos) a **13 px**;
   - las cifras protagonistas y los botones no cambian.
   - En el informe, tabla «selector · antes · después».
6. **Carga oscura** (`src/Index.html`):
   - primera línea dentro de `<head>`: `<style>html,body{background:#0A0A0B;color:#EDEDEF}</style>`;
   - las fuentes: `preconnect` también a `https://fonts.gstatic.com` con `crossorigin`, y la hoja de Geist con carga no bloqueante (`media="print" onload="this.media='all'"` y un `<noscript>` con el enlace normal);
   - mientras llega `apiObtenerInicio`, la pantalla de Existencias muestra un esqueleto (bloques grises #18181B con la misma forma que la cifra, el gráfico y 6 filas) en lugar de vacío; respeta `prefers-reduced-motion` (sin pulso).

## Aceptación
1. **Prueba nueva** (`test/t041_pulido.test.js`) de nombres, con las tres copias (servidor, `app.html` y `parte.html` extraídas del HTML como en las pruebas de T-024) dando **el mismo resultado**:
   - «TOMATE HUEVO DE TORO ROJO I GG» → «Huevo de Toro Rojo I GG»;
   - «MADERA 40X30X11 TOMATES DE AUTOR» → «Madera 40x30x11 Tomates de Autor»;
   - «CARTON 40X30X11 VOLLEY HD Q5» → «Cartón 40x30x11 Volley HD Q5»;
   - «NATURFRESH SAT» → «Naturfresh SAT»;
   - «CARTON 40X30X14 GENERICA» → «Cartón 40x30x14 Genérica»;
   - «DE LA HUERTA» → «De la Huerta».
2. **Prueba nueva:** solo stock inicial el día D y nada más → `entradas` de la serie = 0 todos los días; días anteriores a D con `stock: null`; `fecha_inicio_datos` = D; `calcularDeltaSemanal` = «0 cajas…».
3. **Prueba nueva:** stock inicial el día D + una entrada de 10 cajas en D+1 → `entradas` de D+1 = 10 y variación +10.
4. **Prueba nueva:** transacción de stock inicial → `detalle` sin «STOCK_INICIAL»; ajuste con motivo `ERROR_CARGA` → «Error de carga»; usuario `x@y.com` con un ADMIN «Ana» → «Ana»; con dos ADMIN → «x».
5. **Prueba nueva:** lee `estilos.html` y comprueba los dos tokens nuevos y que no queda ningún `font-size` menor de 12 px en `src/ui/*.html` ni en `Index.html`.
6. **Prueba nueva:** `Index.html` tiene el `<style>` de fondo **antes** de cualquier `<link>`.
7. Ninguna prueba existente se debilita. Si una prueba existente comprobaba un nombre con la regla vieja («De», «Carton»), actualízala **solo en ese valor esperado** y lístala en «Dudas». `node test/run_all.js` con 0 fallos, salida en `logs/T-041/tests.txt`.

## Archivos previstos
- `src/NombresLegibles.js`
- `src/InicioService.js` (solo la serie de 30 días y `fecha_inicio_datos`)
- `src/OperacionesService.js` (solo `detalle` y usuario visible de las transacciones)
- `src/ui/app.html` (`nombreLegible`, `SIGLAS_LEGIBLES`, `calcularDeltaSemanal`, el pintado de la curva y el esqueleto)
- `src/ui/parte.html` (solo `nombreLegible`)
- `src/ui/estilos.html` y, si tienen tamaños propios, los demás `src/ui/*.html` (solo `font-size`)
- `src/Index.html` (solo `<head>` y el esqueleto)
- `test/t041_pulido.test.js` (nuevo, datos ficticios)
- `docs/tickets/T-041-pulido-lectura.md` (este ticket, primer commit, sin editar), `logs/T-041/*`

**No toques** `MovementService.js`, `Libro.js`, `InventoryEngine.js`, `Seguridad.js`, nada de `importacion/`, ni las funciones que reserva T-039. **Nada de datos reales.** Si necesitas otro archivo, para y pregunta.

## Fuera de alcance (tickets siguientes)
- Alias cortos de proveedores (hoja PROVEEDORES, D-016).
- Sesión recordada y errores de acceso (T-042).
- Sello de hora y avisos.
- Nombres cortos en el desglose (P1-3).
- Pasada completa a 375 px.

## Entrega
`logs/T-041/informe.md`: resumen de 5 líneas, tablas de colores y tamaños cambiados, `git status`, `git log --oneline -5` y **«Dudas»** con TODO cambio no pedido.
