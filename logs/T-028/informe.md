# Informe de entrega — T-028 (Pantallas de Importar y Pendientes, P-2)

## Resumen (5 líneas)
1. Creado `src/SeguimientoService.js` (`decidirSeguimiento`) reutilizando `guardarExcepcionCatalogo_` (compartida con `apiUpsertExcepcionCatalogo`) + `PendientesService.reintentarPendientes` + `LOG_OPERACIONES`, y expuesta `apiDecidirSeguimiento` (ESCRITURA, rol `ENCARGADO`) en `src/Código.js`, `src/Seguridad.js` y `docs/API_PUBLICA.md`.
2. Creadas `src/ui/importar.html` y `src/ui/pendientes.html` e integradas en `src/Index.html`, `src/ui/estilos.html` y `src/ui/app.html` con lectura múltiple de CSV (`UTF-8` con fallback automático a `windows-1252`), orden automático compras → ventas, confirmación por tramos con progreso y aviso `beforeunload`, pestaña `Stock inicial` solo `ADMIN` y tres bloques de `Pendientes` con solo lectura para `CONSULTA`.
3. Ampliada `tools/vista-previa/` con los servicios reales (`ImportacionService`, `PendientesService`, `SeguimientoService`, `StockInicialService`) y los tres bloques de pendientes poblados para el recorrido interactivo.
4. Creada `test/t028_importar_pendientes.test.js` (7 pruebas de servidor y cliente) y ejecutado `node test/run_all.js`: **35/35 suites, 359 pruebas, 0 fallos** (`logs/T-028/tests.txt`).
5. Completado el recorrido de aceptación 3 en navegador sobre la vista previa y verificadas las 9 capturas en `logs/T-028/` sin desplazamiento horizontal a 390, 768 y 1024 px.

## Codificación de los CSV (`test/fixtures/csv/`)
Se verificaron los 5 archivos de `test/fixtures/csv/` (`compras_ejemplo.csv`, `compras_t007.csv`, `stock_inicial_ejemplo.csv`, `ventas_ejemplo.csv`, `ventas_t007.csv`): todos están en **UTF-8 sin BOM** y sin caracteres de reemplazo (`U+FFFD`). En cliente (`decodificarBytesCsv` / `leerArchivoCsvConCodificacion`), cada archivo se decodifica primero en `UTF-8` y, si aparece algún carácter de reemplazo (`\uFFFD`), se vuelve a decodificar automáticamente en `windows-1252` (probado en `test/t028_importar_pendientes.test.js`, prueba 6).

## Recorrido de la aceptación 3 (navegador sobre vista previa)
1. **Importar vacío y soltar ventas + compras a la vez (en orden inverso):**
   - Se abre Importar (`01-importar-vacio-1440.png`) y se sueltan a la vez `ventas_t007.csv` primero y `compras_t007.csv` después.
   - La previsualización los ordena automáticamente **Compras → Ventas** (`#1 compras_t007.csv` `+23 cajas entran al stock`, `#2 ventas_t007.csv` con `AVT27/200` 12 cj y `AVT27/201` 6 cj) (`02-importar-preview-1440.png` y `04-importar-movil-390.png`).
   - Al pulsar **«Confirmar importación»**, se aplican primero las compras (`+23 cj`) y luego las ventas (`−18 cj`): **5 documentos aplicados, 0 ventas sin stock y 1 pendiente resuelta sola** (`03-importar-resultado-1440.png`).
2. **Venta sin stock en Pendientes que desaparece sola al importar su compra:**
   - En Pendientes (`05-pendientes-1440.png`, `06-pendientes-390.png`) figuran **2 ventas sin stock** (`AVT27/901` Rosa 500g · EPS 106 9x500 por 95 cj y `AVT27/902` Cocktail I M · Ifco 8x300 por 140 cj), **1 artículo nuevo sin decidir** (`Albaricoque Ficticio G · Carton 40x30`, 24 cj) y **1 albarán cambiado en Hispatec** (`AVT27/701`, diferencia `+15 cj`).
   - Se importa desde Importar una compra ficticia de 100 cj de `TOMATE ROSA 500G` / `EPS 106 9X500` (`ACT27/888`). Al confirmar, el resultado muestra `Cajas que entran +100` y **2 pendientes resueltas solas** (las ventas sin stock pasan de `2` a `0` automáticamente).
3. **«Seguir este artículo» en Pendientes:**
   - Sobre `Albaricoque Ficticio G · Carton 40x30` se pulsa **«Seguir este artículo»** y se confirma la acción inline.
   - El bloque de artículos sin decidir baja de `1` a `0` y aparece el aviso: `Albaricoque Ficticio G · Carton 40x30 marcado como seguido. Líneas aplicadas: 1.` (`09-recorrido-pendiente-resuelta-1440.png`).
4. **Stock inicial (ADMIN) y vista CONSULTA:**
   - En la pestaña **Stock inicial** (solo `ADMIN`) se previsualiza `stock_inicial_ejemplo.csv` mostrando totales por artículo + envase, por proveedor y general (`15 cajas · 2 filas OK`), bloqueo por 1 fila desconocida, aviso de copia previa (`PRE_STOCK_INICIAL`) y casilla «Añadir al stock existente» (`07-stock-inicial-admin-1440.png`).
   - Con rol `CONSULTA` (`?rol=CONSULTA&vista=pendientes`) la barra lateral solo muestra `Existencias`, `Pendientes 4` y `Movimientos`, y Pendientes se presenta en solo lectura sin botones de acción (`08-pendientes-consulta-1440.png`).

## Verificación responsive (sin desplazamiento horizontal)
- Importar: `390px` (`scrollW=390`), `768px` (`scrollW=768`), `1024px` (`scrollW=1024`).
- Pendientes: `390px` (`scrollW=390`), `768px` (`scrollW=753`), `1024px` (`scrollW=1024`).

## Estado git (`feat(T-028)` `7d08115`)

### `git status`
```text
On branch ticket/T-028-importar-pendientes
Your branch is ahead of 'origin/main' by 2 commits.
  (use "git push" to publish your local commits)

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	logs/T-008/fusion.md
	logs/T-009/fusion.md
	logs/T-024/fusion.md

nothing added to commit but untracked files present (use "git add" to track)
```

### `git log --oneline -5`
```text
7d08115 feat(T-028): pantallas de Importar, Stock inicial y Pendientes + SeguimientoService
16c055a docs(T-028): anadir ticket de importar y pendientes
1581b23 docs(T-024): anadir seccion de correccion al informe
7ec78c3 fix(T-024): correcciones de existencias, nombres legibles, desglose, buscador movil, WhatsApp y rol CONSULTA
0b458ba docs(T-024): completar informe de entrega
```

## Diferencias con la referencia visual (`samples/diseno/07-importar-movil.png`)
- **Topbar global + selector de pestañas**: en móvil (`04-importar-movil-390.png`) se mantiene la barra superior de la app (`Stock Light` + avatar/Salir) y las pestañas `CSV de Hispatec / Pendientes / Stock inicial` encima de la zona de soltar, permitiendo cambiar entre Importar, Pendientes y Stock inicial sin salir de la sección.
- **Zona de soltar visible encima de la previsualización**: permite soltar o añadir varios archivos (compras y ventas a la vez) en lugar de mostrar un único archivo fijo como en la maqueta `07`.
- **Tarjetas múltiples con indicador de orden (`#1 · Leído`, `#2 · Leído`) y listas desplegables (`<details>`)**: cada archivo muestra su bloque `QUÉ VA A PASAR`, barra segmentada y estados desplegables por albarán, con el botón **«Confirmar importación»** y **«Limpiar»** debajo de la lista en flujo normal (en lugar de fijado al borde inferior sobre la pantalla).

## Dudas (todo cambio no pedido expresamente en las reglas)
- **`src/Código.js` (`guardarExcepcionCatalogo_`)**: para no duplicar la lógica de validación y guardado de excepciones entre `apiUpsertExcepcionCatalogo` y `SeguimientoService.decidirSeguimiento` (regla 1), se extrajo la función interna `guardarExcepcionCatalogo_` (terminada en `_`, no expuesta a `google.script.run`).
- **`src/Index.html` (`#navPendientes` con `.sl-consulta-only`)**: como T-024 prohíbe mostrar el botón `Importar` a `CONSULTA` (`test/t024_interfaz.test.js` prueba 11), se mantuvo `#navImportar` oculto para `CONSULTA` y se añadió el enlace `#navPendientes` visible únicamente cuando el rol es `CONSULTA` (además de hacer clicable el KPI «Por revisar» en Existencias para todos los roles), de modo que `CONSULTA` accede a Pendientes en solo lectura sin romper T-024.
- **`src/ui/app.html` (`resumirCajasPorAlbaranCsv`)**: como `ImportacionService.previsualizar` no devuelve las cajas por documento (y `src/importacion/*` está en «No toques»), se añadió un pequeño cálculo informativo en cliente que suma `CantidadEnvasesAC`/`NroEnvases` por albarán del CSV ya leído solo para mostrar las cifras en la previsualización y el resumen de confirmación (nunca calcula stock ni FIFO).
- **`tools/vista-previa/server.js`**: se añadieron `?vista=importar|pendientes|stock_inicial`, `GET /fixtures/<archivo>.csv` y `POST /reset` para facilitar la vista previa y el recorrido automatizado.
- **Ampliación autorizada por el responsable (variedad al «Seguir este artículo»)**:
  - En Pendientes, al pulsar «Seguir este artículo» se muestra un diálogo inline (`#pendDialogoSeguir`) con un desplegable (`#selGrupoSeguir`) con los grupos activos de la agrupación `COMERCIAL` (en su orden de `AGRUPACIONES`) y la opción «Sin agrupar».
  - `SeguimientoService.decidirSeguimiento(articulo, envase, decision, grupo, usuario)` y `apiDecidirSeguimiento(articulo, envase, decision, grupo)` leen el filtro del grupo elegido en `AGRUPACIONES` y traducen sus condiciones (`ATRIBUTO=v1|v2` → excepción con `v1`; `ATRIBUTO!=v3` no requiere atributo; formato desconocido lanza error) a excepciones en `CATALOGO` junto con `SEGUIMIENTO=SI`.
  - Añadida prueba 8 en `test/t028_importar_pendientes.test.js` verificando que tras `SEGUIR` con grupo `ROSA`, `obtenerInicio()` coloca las cajas en la variedad `ROSA` y no en «Sin agrupar» (**35/35 suites, 360 pruebas, 0 fallos** en `logs/T-028/tests.txt`).
  - Añadida captura `logs/T-028/10-dialogo-seguir-variedad-1440.png` y actualizada `logs/T-028/09-recorrido-pendiente-resuelta-1440.png`.
  - `git log --oneline -5` tras la ampliación: `6c29347` (`feat(T-028): selector de variedad al seguir articulo y traduccion de filtro de AGRUPACIONES`).

## Corrección
- **Rebase sobre `origin/main` (`c1cbdbe`, T-029 y T-030)**: resuelto el único conflicto en `src/Código.js` conservando ambas partes (`ParteService` y `SeguimientoService`). Verificado `node test/run_all.js` con 0 fallos tras el rebase (`37/37` suites, `369` pruebas).
- **1. Previsualización con varios archivos (`src/ui/app.html`)**: cuando en la misma importación hay un archivo de compras, en cada archivo de ventas se sustituye el bloque rojo «X sin stock» por el bloque gris `Se comprueba al aplicar las compras de esta importación` y el titular pasa a mostrar `hasta N cajas salen` (`N` = cajas de las ventas nuevas). Solo cliente. Verificado en `test/t028_importar_pendientes.test.js` (prueba 10) y en la captura `logs/T-028/02b-importar-preview-compras-y-ventas-1440.png`.
- **2. Plurales correctos (`src/ui/app.html`)**: añadida `pluraliza(n, singular, plural)` y aplicada en toda la interfaz (`1 línea / 2 líneas`, `1 albarán / 2 albaranes`, `1 serie ignorada`, `1 ya importado`, `1 línea de artículo sin decidir`, Stock inicial, Pendientes, Existencias y Partida). Prueba unitaria en `test/t028_importar_pendientes.test.js` (prueba 9).
- **3. Sin «−0» ni «+0» (`src/ui/app.html`)**: sustituidas las concatenaciones manuales de `+` / `−` por `fmtSigned(...)` para que `0` se muestre siempre como `0`. Verificado en las pruebas 9 y 10 de `test/t028_importar_pendientes.test.js`.
- **4. Estado vacío de Existencias (`src/ui/existencias.html`)**: cambiado «Carga el stock inicial desde el Excel…» por «Carga el stock inicial (conteo con los nombres de Hispatec) y después importa las compras y ventas de Hispatec.». Verificado en `test/t028_importar_pendientes.test.js` (prueba 11).
- **Pruebas finales (`logs/T-028/tests.txt`)**: `node test/run_all.js` → **37/37 suites, 372 pruebas, 0 fallos**.

### `git log --oneline -5`
```text
35b6b0c fix(T-028): previsualizacion multiarchivo, plurales, ceros sin signo y texto vacio
9a86b51 docs(T-028): documentar ampliacion de variedad en informe
4a34b27 feat(T-028): selector de variedad al seguir articulo y traduccion de filtro de AGRUPACIONES
5cc320b docs(T-028): completar informe de entrega
8c1784c feat(T-028): pantallas de Importar, Stock inicial y Pendientes + SeguimientoService
```

### Dudas
- **`src/ui/app.html` (`construirHtmlPrevisualizacionImportacion` y exportación en `window.SLApp`)**: se extrajo la generación de HTML de `renderPrevisualizacionImportacion` a `construirHtmlPrevisualizacionImportacion(archivos)` y se expusieron `pluraliza`, `fmtSigned` y `construirHtmlPrevisualizacionImportacion` en `window.SLApp` para probarlos directamente en Node (`test/t028_importar_pendientes.test.js`).
- **Barra segmentada en ventas diferidas (`src/ui/app.html`)**: cuando hay un archivo de compras en el mismo lote, los albaranes `STOCK_INSUFICIENTE` del archivo de ventas también se pintan en gris (`#71717A`) en la barra segmentada en lugar de en rojo, en coherencia con el bloque de detalle gris.
- **Extensión de `fmtSigned` a Existencias y Partida (`src/ui/app.html`)**: para cumplir de forma estricta «Nunca `−0` ni `+0`» en toda la pantalla, también se aplicó `fmtSigned` al tooltip del gráfico de ordenador y a los consumos/destinos de la vista de Partida.

## Ajuste recepciones
- **`src/ui/app.html` (`detectarTipoArchivoCsv`)**:
  - `tipoCsv === 'RECEPCION'` o `'RECEPCIONES'` → `'COMPRA'`.
  - Comprobación de cabecera `/FechaRecepcion|Recepci[oó]n/i` antes de la regla de `NroEnvases` → `'COMPRA'`.
  - Nombre de archivo `/recepci/i` → `'COMPRA'`.
- **`test/t028_importar_pendientes.test.js` (prueba 12)**: verifica que un archivo ficticio con cabecera `Almacen;FechaRecepcion;Recepción;DescripcionArticulo;Envase;NroEnvases` soltado después de unas ventas queda primero al ordenar (`ordenarArchivosImportacion`), así como los casos de `tipoCsv` y nombre de archivo.
- **Pruebas (`logs/T-028/tests.txt`)**: `node test/run_all.js` → **37/37 suites, 373 pruebas, 0 fallos**.
- **Dudas**: ninguna.

## Rebase sobre 45b9480
- **Conflictos resueltos (conservando ambas partes)**:
  - `src/Código.js`: conservados los `require` y asignaciones globales de `CorreccionService` y `Exclusiones` (de `main`, T-027 y T-031) junto con `SeguimientoService` (de T-028).
  - `src/Seguridad.js`: conservados `apiAplicarVersion` y `apiAnularAjuste` (de `main`) junto con `apiDecidirSeguimiento` (de T-028) en `PERMISOS_API`.
- **Ajuste `lineasClienteExcluido` (`src/ui/app.html`)**: si `preview.lineasClienteExcluido > 0`, se muestra en la tarjeta del archivo una fila gris «N líneas de clientes excluidos · no cuentan» (con `pluraliza` y sin `+0`/`−0`). «Aplicar la versión nueva» en Pendientes sigue desactivado con «Disponible pronto». Prueba 13 añadida en `test/t028_importar_pendientes.test.js`.
- **Pruebas (`logs/T-028/tests.txt`)**: `node test/run_all.js` → **39/39 suites, 396 pruebas, 0 fallos** (incluye `t027_correcciones.test.js`, `t028_importar_pendientes.test.js` y `t031_exclusiones.test.js`).

### `git log --oneline -5`
```text
3406165 feat(T-028): mostrar lineasClienteExcluido en previsualizacion de importar
f5b5d5e fix(T-028): clasificar CSV de RECEPCIONES como entradas antes que ventas
995c42b docs(T-028): anadir seccion de correccion al informe
abd055a fix(T-028): previsualizacion multiarchivo, plurales, ceros sin signo y texto vacio
78f0d45 docs(T-028): documentar ampliacion de variedad en informe
```

### Dudas
- **Barra segmentada en `src/ui/app.html`**: se sumó `nClienteExcluido` al tramo gris (`#71717A`) de la barra segmentada para mantener coherencia visual con la fila gris de clientes excluidos.
