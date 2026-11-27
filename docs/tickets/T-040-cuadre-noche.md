# T-040 — Asistente de cuadre de la noche (artículo por artículo, por familia)

Rama: `ticket/T-040-cuadre-noche`, creada desde `main` = `43c22cd`. Sensible: **SÍ** (crea ajustes de stock).
Especificación: 2026-11-27. Hoja de ruta P1-7. Maqueta aprobada: lienzo «Stock Light · Rediseño por momentos del día», artboard **3 · Cuadre de la noche** (https://claude.ai/artifact/3rc3BBKCXQF8UJ6VkFkBTD#play-Cuadre). Rúbrica: `RUBRICA_DISENO.md` (A4, B6, D12-D14).
**Convive con T-041** (Antigravity): no toques `NombresLegibles.js`, `estilos.html` (salvo añadir clases nuevas al final), `InicioService.js` ni las funciones de `app.html` que no sean la navegación.

## Problema
Cada noche se cuenta en cámara **artículo por artículo, dentro de su familia**, y se compara a mano con el Excel. En Stock Light hoy solo se puede ir partida por partida con Destrío/Ajuste: lento y sin registro de qué se cuadró, cuándo y quién.

## Decisión del responsable (27/11)
Se cuenta **siempre artículo por artículo** (artículo + caja), y cada artículo va en su familia (AGRUPACIONES COMERCIAL). La familia se confirma entera.

## Lo que ya existe (no lo rehagas)
- `MovementService.registrarAjuste` (y `registrarAjustePositivo` / `registrarAjusteNegativo`): ajuste por FIFO con `motivo`; `apiAnularAjuste` lo anula.
- Motivo `RECUENTO` ya admitido (`Código.js` ~l. 772, `destrio-ajuste.html`).
- `OrdenExistencias.compararArticulos` (T-039) para el orden; `CommercialGroupResolver` / catálogo para saber la familia de cada artículo + caja.
- Patrón de pantalla: `src/ui/parte.html` (`window.SLParte` con `setVisible` y `cargar`), incluida en `Index.html` y conmutada en `mostrarVista` de `app.html`.

## Reglas
1. **Servicio nuevo `src/CuadreService.js`**:
   - `obtenerCuadre()` → `{ generado_en, familias: [{ familia, orden, color, cajas, articulos: [{ articulo, envase, deberia }], ultimo_cuadre: { fecha_hora, usuario, ajustes } | null }] }`.
     - Familias en el orden de AGRUPACIONES COMERCIAL, solo las que tienen stock > 0 o algún artículo con movimiento en los últimos 7 días.
     - Artículos ordenados con `compararArticulos`.
     - `deberia` = cajas actuales de STOCK_ACTUAL para ese artículo + caja.
   - `confirmarFamilia({ id_cuadre, familia, lineas: [{ articulo, envase, deberia, hay }] }, usuario)`:
     - `hay` vacío o `null` = «cuadra» (no se toca).
     - **Concurrencia:** si para alguna línea `deberia` ≠ stock actual, **no aplica nada** y devuelve `{ success:false, status:'STOCK_CAMBIADO', lineas:[…con el stock nuevo] }` («El stock de X ha cambiado desde que abriste el cuadre: vuelve a cargar»).
     - **Validación previa:** `hay` entero ≥ 0; si algo falla, no aplica nada.
     - Por cada diferencia ≠ 0: un ajuste con motivo `RECUENTO`, signo según la diferencia, FIFO (negativo: de la partida más antigua; positivo: como hace hoy `registrarAjuste`). `observaciones` = `CUADRE:<id_cuadre>`.
     - Si `MovementService` permite aplicar varios movimientos bajo un único bloqueo y persistencia, úsalo. Si no, aplica en orden y, ante un fallo a mitad, devuelve `aplicados` y `no_aplicados` (cada aplicado se puede anular con `apiAnularAjuste`) y **anótalo en «Dudas»**.
     - **Idempotencia:** el mismo `id_cuadre` + `familia` confirmado dos veces no crea ajustes nuevos; devuelve el resultado guardado.
     - Guarda una fila por familia confirmada en la hoja nueva **`CUADRES`**: `id_cuadre, familia, fecha_hora, usuario, lineas_contadas, lineas_con_diferencia, cajas_diferencia, ids_ajustes` (solo añadir).
2. **API en `src/Código.js`** (clasifícalas en `docs/API_PUBLICA.md`):
   - `apiObtenerCuadre()`: LECTURA, rol ENCARGADO.
   - `apiConfirmarCuadreFamilia(params)`: ESCRITURA, rol ENCARGADO.
   - Ambas lanzan «Acceso no autorizado» sin sesión (guardas de T-020).
   - `SCHEMA_DEFINITIONS` + `adminInstalarStockLight` crean `CUADRES` (idempotente).
3. **Pantalla nueva `src/ui/cuadre.html`** (`window.SLCuadre`, mismo patrón que `parte.html`), como en la maqueta:
   - Cabecera: cerrar, «Cuadre de la noche», «N de M» y barra de progreso.
   - Familia actual con su color.
   - Tabla Artículo · Debería · Hay · Dif.
     - El campo «Hay» es numérico (`inputmode="numeric"`), vacío = cuadra, con `<label>` accesible.
     - La diferencia: «✓» verde si coincide, «+N» / «−N» en ámbar.
   - Resumen en vivo: «2 ajustes de recuento · −7 cajas…» con `aria-live="polite"`.
   - Botones abajo: **Saltar** y **Confirmar y seguir** («Cuadra · siguiente familia» si no hay diferencias). Al terminar, resumen del cuadre completo con enlace a Movimientos filtrado.
   - Nombres con `nombreLegible`, artículos por calibre (orden del servidor).
   - Zonas táctiles ≥ 44 px, contraste ≥ 4,5:1, solo tokens de `estilos.html` (clases nuevas `.sl-cuadre-*` al final del archivo).
   - Navegación: entrada «Cuadre» en el menú lateral y en la barra de acciones del móvil (`mostrarVista('cuadre')` en `app.html`), solo para rol ENCARGADO o superior.
   - `STOCK_CAMBIADO` muestra el aviso y un botón «Volver a cargar».
4. **No cambian:** el motor (FIFO, libro, `InventoryEngine`), la importación, ni el parte.

## Aceptación
1. **Prueba nueva** (`test/t040_cuadre.test.js`, datos ficticios): familia con 3 artículos; `hay` = [igual, −7, vacío] → 1 ajuste RECUENTO de −7 sobre la partida más antigua; stock final correcto; `CUADRES` con 1 fila (3 contadas, 1 con diferencia, −7).
2. **Prueba nueva:** diferencia positiva +5 → ajuste +5; consistencia del libro OK.
3. **Prueba nueva:** cambia el stock entre `obtenerCuadre` y `confirmarFamilia` → `STOCK_CAMBIADO` y **ningún** ajuste.
4. **Prueba nueva:** confirmar dos veces el mismo `id_cuadre` + familia → los mismos ajustes, ninguno nuevo.
5. **Prueba nueva:** `hay` negativo o no numérico → error y nada aplicado.
6. **Prueba nueva:** anular con `apiAnularAjuste` un ajuste del cuadre devuelve el stock anterior.
7. **Prueba nueva:** sin sesión → «Acceso no autorizado» en las dos API; con rol CONSULTA → rechazado.
8. **Prueba nueva (invariantes, 25 semillas):** stock aleatorio + cuadre con diferencias aleatorias → `comprobarConsistencia().consistente`; suma de CONSUMOS_FIFO por capa = `cajas_consumidas`; stock final de cada artículo = `hay` (o `deberia` si vacío).
9. Ninguna prueba existente se modifica. `node test/run_all.js` con 0 fallos, salida en `logs/T-040/tests.txt`.

## Archivos previstos
- `src/CuadreService.js` (nuevo)
- `src/Código.js` (las dos API)
- `src/Repository.js` (hoja `CUADRES` en `SCHEMA_DEFINITIONS` y acceso)
- `src/Instalacion.js` (solo si la creación de hojas vive ahí)
- `src/ui/cuadre.html` (nuevo)
- `src/Index.html` (solo el `include_` de `ui/cuadre` y la entrada de menú)
- `src/ui/app.html` (solo `mostrarVista`, `actualizarNavActivo` y la acción del móvil)
- `src/ui/estilos.html` (solo clases nuevas `.sl-cuadre-*` al final)
- `docs/API_PUBLICA.md`, `DATA_MODEL.md`
- `test/t040_cuadre.test.js` (nuevo, datos ficticios)
- `docs/tickets/T-040-cuadre-noche.md` (este ticket, primer commit, sin editar), `logs/T-040/*`

**No toques** `MovementService.js` salvo que haga falta un método para aplicar varios ajustes bajo un solo bloqueo. En ese caso **para y pregunta antes**. Tampoco `Libro.js`, `InventoryEngine.js`, `importacion/`, `NombresLegibles.js` ni `InicioService.js`. **Nada de datos reales.**

## Fuera de alcance
- Tarjeta «Cuadre» en Inicio con el último cuadre (va con el sello de hora y los avisos).
- Recuento por cámara desde el móvil con escáner (P2-19).
- Parte de la noche con las diferencias del cuadre.

## Entrega
`logs/T-040/informe.md`: resumen de 5 líneas, `git status`, `git log --oneline -5` y **«Dudas»** con TODO cambio no pedido.
