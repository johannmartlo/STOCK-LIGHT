# Informe de entrega — T-024 (Base visual y Existencias, P-1)

## Resumen (5 líneas)
1. Creado `src/InicioService.js` (`apiObtenerInicio`, `apiObtenerPartida`) leyendo cada hoja una sola vez, con caché de clasificación, `viene_de` sin reprocesos anulados y `se_convirtio_en`.
2. Añadidas las columnas `color`, `dias_aviso` y `stock_bajo` a `AGRUPACIONES` en `src/Repository.js`, y registradas las nuevas funciones en `src/Código.js`, `src/Seguridad.js` y `docs/API_PUBLICA.md`.
3. Partida `src/Index.html` en armazón compatible con `t020_acceso.test.js` (7.5 intacta) + `src/ui/{estilos,existencias,partida,app}.html` sin librerías externas salvo Google Fonts.
4. Creada la vista previa local en `tools/vista-previa/` con datos 100 % ficticios sobre `InicioService` real y verificadas las capturas desktop, tablet, móvil, PIN y 4 estados sin scroll horizontal.
5. Sustituida `test/fase7_frontend_ux_integration.test.js` por `test/t024_inicio.test.js` (5 pruebas) y `test/t024_interfaz.test.js` (7 pruebas): `node test/run_all.js` 32/32 suites, 337 pruebas, 0 fallos.

## Estado git (`feat(T-024)` b7e3a6f)

### `git status`
```text
On branch ticket/T-024-base-visual-existencias
Your branch and 'origin/main' have diverged,
and have 2 and 3 different commits each, respectively.
  (use "git pull" if you want to integrate the remote branch with yours)

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	logs/T-008/fusion.md
	logs/T-009/fusion.md

nothing added to commit but untracked files present (use "git add <file>..." to track)
```
*(Nota: `logs/T-008/fusion.md` y `logs/T-009/fusion.md` proceden de entregas/fusiones previas de otros tickets y no se han tocado ni incluido en el commit; `samples/` está ignorado y tampoco se ha tocado en git.)*

### `git log --oneline -5`
```text
b7e3a6f feat(T-024): base visual y existencias (InicioService, UI modular y vista previa)
d31d32b docs(T-024): anadir ticket de base visual y existencias
bb816bc docs(T-011): completar informe de entrega
288a6bc feat(T-011): instalacion, stock inicial y puesta en marcha
36fd197 docs(tickets): anadir T-011 puesta en marcha
```

## Diferencias que quedan con la referencia visual (`samples/diseno/`)
- **Formato de fechas (`dd/mm` vs `20 nov`)**: en Existencias (`01` y `04`) el ticket pide fechas `dd/mm` (`25/11`, `09/11`), mientras la maqueta `01`/`04` mostraba el mes abreviado (`20 nov`, `05 nov`).
- **Métrica de destrío (`8 cj` vs `%`)**: según la regla 1 del ticket, `destrio7` devuelve cajas de destrío de los últimos 7 días (`8 cj`), a diferencia del porcentaje de la maqueta `01`.
- **«Importado hasta» (`C dd/mm · V dd/mm`)**: la regla 1 pide la fecha más reciente importada por CSV para compras y ventas por separado; la pantalla muestra la última fecha principal y el detalle `C dd/mm · V dd/mm`.
- **Subtítulo de variedades y «Últimos movimientos»**: la tabla calcula `<N> agricultores · <M> partidas` desde las capas vivas de `CAPAS_FIFO` en lugar de textos comerciales estáticos, y «Últimos movimientos» muestra las 12 líneas reales devueltas por `ultimos` (`Compra`, `Venta`, `Cambio`, `Destrío`) en vez de resúmenes agrupados por día; además la vista previa usa datos 100 % ficticios (`Moresco Ficticio`, etc.).
- **Botón de confirmación en PIN (`08`)**: debajo del teclado numérico se mantiene el botón discreto `Entrar` / `Crear PIN` (`#btnEntradaConfirmar`) para soportar PIN de 4 a 6 cifras exigido por T-020 (`08` solo mostraba 4 puntos sin botón).
- **Estados (`09`)**: los estados cargando, vacío, sin conexión y error se renderizan dentro de la propia aplicación (en `sin_conexion`, si hay caché local, se muestra aviso ámbar superior manteniendo los datos atenuados; si no hay caché, tarjeta sin conexión con reintento). El cuarto estado de `09` («Error de importación» de `.xlsx`) corresponde a P-2; en T-024 el cuarto estado es el error genérico de carga con reintento.

## Dudas (todo cambio no pedido expresamente en las reglas, pantallas retiradas y equivalencia de las pruebas de `test/fase7_frontend_ux_integration.test.js`)

### 1. Cambios o decisiones técnicas menores en archivos previstos
- **`src/InicioService.js`**:
  - Se fijó el conjunto `MOTIVOS_DESTRIO_INICIO_ = new Set(['DESTRIO', 'MERMA', 'ROTURA', 'DETERIORO'])` para los ajustes negativos que computan en `destrio7` (documentado en cabecera, tal como pide la regla 1).
  - Además de los campos mínimos descritos en el ticket, cada variedad incluye `dias` (antigüedad de la capa más antigua), `dias_aviso`, `stock_bajo`, `aviso_stock_bajo` y `serie7` (7 puntos diarios para dibujar la minigráfica sin cálculos en cliente), y `pendientes` incluye `total`, `totalDocumentos`, `totalFilas` y `filasPorMotivo` junto a `porMotivo`.
  - Se añade `fecha_referencia` en la raíz del objeto de `obtenerInicio()` para que el cliente formatee encabezados respecto a la fecha efectiva.
- **`src/Código.js` y `docs/API_PUBLICA.md`**:
  - El ticket menciona «añade `include(nombre)` en `Código.js`; es interna, así que termina en `_`, o se excluye explícitamente de la superficie si T-023 lo exige», mientras la regla de armazón exige `<?!= include('ui/estilos') ?>` con ese nombre exacto. Para cumplir ambos a la vez, se mantuvo `function include(filename)` y se clasificó como `INTERNA` en `docs/API_PUBLICA.md`, de modo que `t023_superficie.test.js` pasa sin modificarse.
- **`src/Index.html` y `src/ui/app.html` (compatibilidad T-020 7.5)**:
  - `test/t020_acceso.test.js` prueba 7.5 busca cadenas literales dentro de `src/Index.html` (`apiLlamar(state.sesion, fnName, args)`, `const api = {`, `localStorage`, `google.script.history.replace`, `id="pantallaEntrada"`, `id="btnSalir"`, `id="lblUsuario"`, `data-digito="1"`, `min-height: 56px`). Se conservaron en `src/Index.html` (junto con el puente `api`) sin ninguna pantalla antigua, dejando toda la UI y lógica de pantallas modularizada en `src/ui/*.html`.
  - En la pantalla PIN (`#pantallaEntrada`) se mantuvo `#btnEntradaConfirmar` (`Entrar` / `Crear PIN`) para soportar PIN de 4 a 6 cifras sin romper el flujo existente de T-020.
  - Se añadieron anchos de tabla adaptativos en `src/ui/estilos.html` (`.sl-table-inner` con `min-width: 680px`) para evitar solapamientos a `1024 px` con barra lateral visible.

### 2. Pantallas y código antiguo retirados de `src/Index.html` (regla 5)
Se retiraron de `src/Index.html` (permanecen intactos en el historial git) todas las vistas heredadas de fases previas que el MVP ya no utiliza:
- Vista anterior de grupos comerciales fijos (tarjetas CSS estáticas `grp-eps`, etc.) y filtros de subgrupo de `CARTÓN` (`subgroupsFilterContainer`).
- Vistas de detalle jerárquico anteriores (`viewDetalleGrupo`, `viewDetallePartidas` y breadcrumbs).
- Formularios manuales de movimientos (`formEntrada`, `formSalida`, `formAjuste`) y pestaña de correcciones históricas (`tabCorrecciones`).
- Zona de subida/análisis de PDF (`pdfDropZone`, `tblStagingBody`).
- Pantallas antiguas de Incidencias, Maestros & Matriz y Auditoría, así como los estilos responsivos antiguos (`@media (max-width: 900px)`).

### 3. Enumeración de las 19 pruebas de `test/fase7_frontend_ux_integration.test.js` (aceptación 6)
1. **Configuración de `HtmlOutput` en `doGet(e)`**: **cubierta** en `test/t024_interfaz.test.js` (prueba 1).
2. **Estructura HTML5 y texto en español en `Index.html`**: **cubierta** en `test/t024_interfaz.test.js` y `src/Index.html`.
3. **Estilos CSS de los 6 grupos comerciales fijos (`grp-eps`, etc.)**: **no aplica** (diseño sustituido por tabla configurable de `AGRUPACIONES` con paleta `:root`).
4. **Filtros de subgrupo de `CARTÓN` (`subgroupsFilterContainer`)**: **no aplica** (sustituido por tabla `Variedades` y filtros `Todas`, `Para sacar`, `Buscar`).
5. **Vistas de desglose (`viewDetalleGrupo`, `viewDetallePartidas`, breadcrumbs)**: **sustituida** por panel lateral `#panelVariedad`, hoja inferior `#hojaVariedad` y pantalla `#viewPartida` (cubiertas en `test/t024_interfaz.test.js`).
6. **Formularios manuales de movimientos (`formEntrada`, `formSalida`, `formAjuste`)**: **no aplica en P-1** (retirados de `Index.html`; los flujos de cambios/destrío/movimientos llegan en P-3; en T-024 muestran aviso discreto «Llega en la próxima versión»).
7. **Pestaña de correcciones históricas (`tabCorrecciones`)**: **no aplica** (retirada del MVP).
8. **Zona de arrastrar/soltar PDF (`pdfDropZone`, `tblStagingBody`)**: **no aplica** (el MVP usa CSV desde T-007 y la pantalla de importación llega en P-2).
9. **Vistas de Incidencias, Maestros & Matriz y Auditoría**: **no aplica** (retiradas del armazón inicial / diferidas a P-2 y P-3).
10. **Regla responsive antigua (`@media (max-width: 900px)`)**: **sustituida** por diseño responsivo en `src/ui/estilos.html` (`>= 1024px` desktop con barra lateral / `< 1024px` móvil-tablet sin desplazamiento horizontal).
11. **`apiGetMaestroArticulos`**: **API de servidor intacta** (sin uso en pantalla P-1 de Existencias).
12. **`apiGetMaestroEnvases`**: **API de servidor intacta** (sin uso en pantalla P-1 de Existencias).
13. **`apiObtenerStockVisualResumen`**: **sustituida en P-1** por `apiObtenerInicio` (sigue cubierta en servidor por `test/stock_query.test.js`).
14. **`apiObtenerDetallePartidas`**: **sustituida en P-1** por `variedades[].partidas` y `apiObtenerPartida` (sigue cubierta en servidor por `test/stock_query.test.js`).
15. **`apiSubirYAnalizarPdf` (existencia/estructura)**: **API de servidor heredada sin uso en UI** (el MVP procesa CSV, no PDF).
16. **`apiSubirYAnalizarPdf` (validación/flujo)**: **no aplica en la nueva UI** (sin visor/subida de PDF en cliente).
17. **Puente cliente `const api = {` en `Index.html`**: **conservado y cubierto** por `test/t020_acceso.test.js` (7.5).
18. **Ausencia de cálculo FIFO en el cliente**: **cubierta** en `test/t024_interfaz.test.js` (prueba 7).
19. **Integridad de `InventoryEngine.js` sin cambios visuales**: **cubierta** en `test/t024_interfaz.test.js` (prueba 7) y por la suite completa.

---

## Corrección

### Lo hecho
- **Rebase sobre `origin/main` (`5eea049`)**: reaplicada la rama `ticket/T-024-base-visual-existencias` sobre `main` (con T-025 incluido), resolviendo conflictos solo en `src/Código.js` y `src/Seguridad.js` conservando las API de T-025 y T-024.
- **1. Últimos movimientos**: `InicioService.obtenerInicio` usa `OperacionesService.listarMovimientos({ limite: 12 })` aplanando los grupos; cada cambio sale en UNA línea (`Rosa Granel M → Rosa 500g`, detalle `60 → 86 · destrío 2`) sin líneas sueltas de origen/destino. Prueba de rendimiento ajustada en `test/t024_inicio.test.js` (`< 2 s` con 5.000 movimientos, cada hoja leída `<= 2` veces).
- **2. Nombres legibles en cliente (`nombreLegible`)**: quita el prefijo `TOMATE `, capitaliza palabras, conserva en mayúsculas calibres/categorías (`G, GG, GGG, M, MM, MMM, I, II, EPS, POOL`) y pasa medidas a minúscula (`50X30 → 50x30`, `40X30 → 40x30`, `9X500 → 9x500`, `500G → 500g`) sin alterar los datos del servidor. Aplicada en toda la UI y probada con 6 ejemplos en `test/t024_interfaz.test.js` (prueba 8).
- **3. Delta semanal en cajas**: `calcularDeltaSemanal` muestra siempre cajas (`+2.168 cajas esta semana`), verde si sube y gris (`var(--sl-text-secondary)`) si baja, nunca `%`.
- **4. Días legibles (`fmtDias`)**: `0 → hoy`, `1 → 1 día`, `n → n días` en KPI, tabla y partidas.
- **5. Barra lateral sticky**: `.sl-sidebar` mantiene `position: sticky; top: 0; height: 100vh;` (con `overflow-x: clip` en `html, body` y `align-self: flex-start`) y `.sl-sidebar-footer` queda fijado abajo.
- **6. Renombrado `include` → `include_`**: renombrada en `src/Código.js`, `src/Index.html`, `tools/vista-previa/server.js` y `test/t024_interfaz.test.js`; retirada la fila de `docs/API_PUBLICA.md` (`t023_superficie.test.js` en verde).
- **7. Buscador móvil (ampliación autorizada)**: `#inputBuscarMob` arriba de `Variedades` en móvil, sincronizado con escritorio, filtrando al instante variedades y artículos sin distinguir mayúsculas ni acentos (`mor` → `Moresco`).
- **8. Desglose por artículo + envase (ampliación autorizada)**: añadido en `#panelVariedad` y `#hojaVariedad` arriba de las partidas, ordenado por cajas descendente (`I GG · Carton 40x30   686`).
- **9. Usuario `CONSULTA` (ampliación autorizada)**: usa el `rol` que devuelve la sesión de T-020 (`aplicarRol`) para ocultar todos los botones de acción (`Cambiar`, `Cambios`, `Importar`, `Importar CSV`, `Destrío`, `Cargar stock inicial`) en escritorio, móvil, barra lateral, panel y ficha de partida.
- **10. Compartir por WhatsApp y Copiar (ampliación autorizada)**: botones «Compartir» (`https://wa.me/?text=…` en pestaña nueva) y «Copiar» en el panel lateral y la hoja inferior, con miles separados por punto, desglose ordenado por cajas y fecha `Sale primero`.
- **11. Pruebas y capturas**: `node test/run_all.js` → **34/34 suites, 352 pruebas, 0 fallos** (`logs/T-024/tests.txt`). Capturas actualizadas en `logs/T-024/`: `01-existencias-1440.png`, `04-existencias-390.png`, `04b-hoja-inferior-390.png`, `04c-busqueda-mor-390.png`, `10-consulta-1440.png` y `10b-consulta-390.png`.

### `git log --oneline -5`
```text
7ec78c3 fix(T-024): correcciones de existencias, nombres legibles, desglose, buscador movil, WhatsApp y rol CONSULTA
0b458ba docs(T-024): completar informe de entrega
9202c1f feat(T-024): base visual y existencias (InicioService, UI modular y vista previa)
c2dc347 docs(T-024): anadir ticket de base visual y existencias
5eea049 feat(T-025): servidor de operaciones de solo lectura
```

### Dudas (corrección)
- **Ampliación autorizada por el responsable (puntos 7–11)**: buscador móvil arriba de Variedades sin distinción de mayúsculas/acentos, desglose por artículo + envase ordenado por cajas arriba de partidas en hoja y panel, ocultación de botones de acción para usuarios `CONSULTA` (usando el `rol` ya devuelto por la sesión de T-020), botones «Compartir» (`https://wa.me/?text=…`) y «Copiar» con texto formateado, y sus pruebas unitarias en `test/t024_interfaz.test.js`.
- **Ajustes técnicos menores para dar soporte a las correcciones**:
  - En `src/ui/estilos.html` se cambió `overflow-x: hidden` por `overflow-x: clip` en `html, body` para que `position: sticky; top: 0; height: 100vh` en `.sl-sidebar` no quede bloqueado por un contenedor con overflow en Chromium/WebKit.
  - En `test/t024_interfaz.test.js` (prueba 5) se permitió el prefijo `https://wa.me/` como enlace de acción de WhatsApp (sin ser recurso ni librería externa).
  - En `tools/vista-previa/server.js` se añadió soporte opcional de parámetro `?rol=CONSULTA` para previsualizar y capturar la vista de un usuario `CONSULTA`.
