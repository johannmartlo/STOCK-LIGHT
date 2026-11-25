# T-024 — Base visual y Existencias (P-1 del plan de cierre)

Rama: `ticket/T-024-base-visual-existencias`, creada desde `main` = `bb816bc` (todo el servidor del MVP fusionado: T-007, T-008, T-009, T-011, T-020). Sensible: **no escribe stock**; sí toca el acceso (pantalla de PIN).
Especificación: 2026-11-25. Diseño cerrado: `DISENO.md` v3 (D-037), copiado más abajo en lo esencial.

## Referencia visual (obligatoria)
En tu carpeta, `samples/diseno/` (ignorada por git; **nunca la subas**: lleva datos reales):
- `01-existencias-ordenador.html` / `.png`, `01b-existencias-panel-partidas.png`;
- `04-existencias-movil.html` / `.png`, `04b-existencias-movil-hoja.png`;
- `05-partida-procedencia-movil.html` / `.png`;
- `08-pin-movil.html` / `.png`;
- `09-estados.html` / `.png`.

Ábrelos en tu navegador. Son el objetivo: misma jerarquía, tamaños, colores, densidad y animaciones. El resto de archivos (02, 03, 06, 07) son de los tickets siguientes; no los implementes, pero no hagas nada que los contradiga.

## Principios (DISENO.md v3)
- Una cifra protagonista con su evolución debajo, como el saldo de una cuenta. Tablas densas pero impecables: columnas alineadas, cifras en mono, miles con punto.
- Al tocar una fila se abre un panel lateral (ordenador) o una hoja inferior (móvil), sin cambiar de pantalla.
- Nada de recursos de app genérica: sin degradados de fondo, brillos, tarjetas de colores ni gráficos raros. El color es dato. La marca es solo el rojo tomate #F2553D (logo y curva del stock).

## Tokens (variables CSS en `:root`, para que CCO V2 pueda tener su tema)
- **Superficies:** fondo #0A0A0B · panel #121214 · elevado y hover #18181B · línea #1F1F23 · línea fuerte #27272A.
- **Texto:** #EDEDEF · secundario #8A8F98 · etiquetas #5C6068 · botón principal con fondo #EDEDEF y texto #0A0A0B.
- **Significado:** entradas y «al día» #4ADE80 · toca sacar #FBBF24 · destrío y error #F87171 · salidas #71717A.
- **Variedades por defecto** (si la agrupación no tiene color): #4FA37C, #F2553D, #2DD4BF, #F5A3B5, #EC4899, #60A5FA, y luego se repiten. Nunca el ámbar ni el rojo de aviso.
- **Tipografía:** Geist (texto; cifra protagonista en 600 con interletraje −3,5 %) y Geist Mono (cifras). Desde Google Fonts, con `system-ui` y `ui-monospace` de reserva. 14 px en ordenador, 15-16 px en móvil.
- **Radios:** 6-8 px en controles, 10-14 px en paneles; botones redondos solo en el móvil.
- **Barra de partidas:** un tramo por partida, la más antigua a la izquierda y más opaca (de 1 a 0,45).
- **Movimiento:**
  - entrada de pantalla 450 ms; la curva se dibuja en 1,4 s; barras 0,7-0,8 s;
  - panel lateral 300 ms; hoja inferior 380 ms;
  - `prefers-reduced-motion` quita todas las animaciones.
- **Formato:** miles con punto con una expresión regular (`toLocaleString('es-ES')` no pone el punto en 4 cifras); fechas `dd/mm`.

## Lo que ya existe (verificado en main; no lo rehagas)
- `doGet` con plantilla `Index`, token `k`, `tienePin`; puente cliente `apiLlamar(state.sesion, fnName, args)`; `localStorage`; `google.script.history.replace`; pantalla de entrada con teclado numérico (T-020). **`test/t020_acceso.test.js` 7.5 comprueba esas piezas dentro de `src/Index.html` y debe seguir en verde sin tocarla.**
- Capas con `proveedor`, `fecha_capa`, `id_capa_origen`; REPROCESOS y REPROCESO_LINEAS (`tipo` ORIGEN/DESTINO, `id_capa`, `proveedor`, `fecha_capa`) (T-009).
- Libro de solo añadir: el stock es la suma firmada de los movimientos CONFIRMADO, anulaciones incluidas (D-022).
- Catálogo con agrupaciones (D-029): AGRUPACIONES (`agrupacion, orden, grupo, subgrupo, filtro, activo`) y la clasificación de cada combinación en `CatalogoService`.
- `PendientesService.listarPendientes` (T-008).
- `src/Index.html` actual: 3.212 líneas de pantallas antiguas (PDF, grupos, matriz) que el MVP ya no usa.

## Reglas

### Servidor
1. **`src/InicioService.js`** (nuevo), con **`apiObtenerInicio()`** (LECTURA → CONSULTA). Lee cada hoja **una sola vez** y devuelve:
   - `total`: cajas vivas.
   - `serie`: 30 días con `{ fecha, stock, entradas, salidas }`.
     - `stock` es el total al cierre de ese día por fecha de negocio, con la misma suma firmada del libro.
     - `entradas` son las compras del día y `salidas` las ventas del día, netas de sus anulaciones.
     - Reprocesos y ajustes cambian el stock, pero no son ni entradas ni salidas.
     - **El último punto de la serie = `total`.**
   - `variedades`: los grupos de la agrupación `COMERCIAL`, en su `orden`. Cada uno con:
     - `grupo`, `color`, `cajas`;
     - `partidas`: capas vivas, la más antigua primero, con `id_capa, proveedor, fecha, articulo, envase, cajas` y `viene_de` si la creó un reproceso;
     - `sale_primero`: fecha de la capa más antigua, y `aviso_antiguedad = true` si supera `dias_aviso`;
     - `tendencia7`: cajas de hoy menos cajas de hace 7 días.

     El stock que no cae en ningún grupo va a un grupo final «Sin agrupar». La suma de `cajas` de todas las variedades = `total`.
   - `viene_de` es `{ id_reproceso, fecha, origenes: [{ proveedor, fecha_capa, articulo, envase, cajas }] }`, sacado de REPROCESO_LINEAS. Si el reproceso está anulado, no se muestra.
   - `pendientes`: recuento por motivo (`listarPendientes`).
   - `destrio7`: cajas de destrío de los últimos 7 días (reprocesos no anulados + ajustes negativos de destrío). Documenta qué motivos cuentan.
   - `importado_hasta`: la fecha de documento más reciente importada por CSV, por separado para compras y ventas.
   - `ultimos`: los 12 últimos movimientos, como transacciones: `{ fecha, tipo, texto, cajas con signo, usuario }`.
2. **`apiObtenerPartida(idCapa)`** (CONSULTA) devuelve una partida con su historia:
   - origen (compra, stock inicial, ajuste o reproceso con `viene_de`);
   - consumos (ventas y reprocesos que la usaron, con fecha y cajas);
   - `se_convirtio_en` si salió por un reproceso: los destinos de ese reproceso.
3. **Color y umbrales por variedad:** añade a AGRUPACIONES las columnas `color`, `dias_aviso` y `stock_bajo` (`provisionDatabase` las crea si faltan). Si están vacías: color de la paleta por defecto según el orden, `dias_aviso = 4`, `stock_bajo` sin aviso. No toques `SemillaCatalogo.js`.
4. Las dos API, en `PERMISOS_API` y en `docs/API_PUBLICA.md`.

### Cliente
5. **Partir `Index.html`:**
   - `src/Index.html` queda como armazón: `<head>`, fuentes, el puente de sesión y PIN de T-020 (sin cambiar su contrato) y la navegación;
   - las pantallas y estilos van en `src/ui/*.html` y se incluyen con `<?!= include('ui/estilos') ?>`;
   - añade `include(nombre)` en `Código.js`; es interna, así que termina en `_`, o se excluye explícitamente de la superficie si T-023 lo exige.

   Las pantallas antiguas (PDF, grupos, matriz, etc.) **se retiran**: el MVP no las usa y siguen en el historial de git. Enuméralas en «Dudas».
6. **Pantallas de este ticket:**
   1. **Existencias en ordenador (≥ 1024 px):**
      - barra lateral;
      - total con la curva de 30 días y las barras de entradas (verde) y salidas (gris), con detalle al pasar el ratón;
      - franja con «sale primero», pendientes, destrío de 7 días e «importado hasta»;
      - tabla de variedades: color, nombre, cajas, barra de partidas, fecha de «sale primero» (en ámbar si avisa) y tendencia de 7 días;
      - panel lateral con las partidas al pulsar una fila;
      - últimos movimientos.
   2. **Existencias en móvil (< 768 px):**
      - total con la curva;
      - 4 botones redondos (Cambiar, Importar, Destrío, Movimientos);
      - lista de variedades con su barra;
      - hoja inferior con las partidas y la etiqueta «⇄ Viene de…».
   3. **Partida con procedencia:** desde la hoja o el panel, con `apiObtenerPartida`.
   4. **PIN:** con el estilo nuevo, manteniendo todo lo que comprueba la prueba 7.5.
   5. **Estados:** cargando (esqueleto), vacío (sin stock todavía, con el siguiente paso), sin conexión y error con reintento.

   Entre 768 y 1023 px se usa la disposición de móvil a más anchura, sin desplazamiento horizontal.
7. Los botones de acciones que llegan en los tickets siguientes (Cambiar, Importar, Destrío, Movimientos) son visibles y muestran un aviso discreto, «Llega en la próxima versión». **No** enlazan a pantallas antiguas.
8. **Sin librerías:** ni frameworks ni librerías de gráficos. La curva y las barras son SVG hechos a mano. Solo Google Fonts como recurso externo.
9. **Vista previa local** en `tools/vista-previa/` (fuera de `src/`, así que `clasp` no la sube):
   - un servidor Node sin dependencias que monta `Index.html` con sus `include` y un `google.script.run` simulado;
   - los datos los genera el **`InicioService` real** sobre `test/helpers/mockSheets` con datos **ficticios**: 6 variedades, unas 40 partidas, 30 días de movimientos, 2 reprocesos con procedencia y algún pendiente;
   - un interruptor para ver los estados vacío, sin conexión y error.

## Aceptación
1. **Prueba nueva (invariantes de `apiObtenerInicio`):** con datos aleatorios (entradas, ventas, reprocesos, anulaciones):
   - último punto de la serie = `total`;
   - suma de variedades = `total`;
   - suma de partidas de cada variedad = sus `cajas`;
   - `sale_primero` = la capa viva más antigua;
   - un reproceso anulado no aparece en `viene_de`.
2. **Prueba nueva:** tras un reproceso, la partida destino trae `viene_de` con sus orígenes y `apiObtenerPartida` del origen trae `se_convirtio_en`.
3. **Prueba nueva (rendimiento):** con 5.000 movimientos simulados, `apiObtenerInicio` responde en menos de 2 s en Node y lee cada hoja una sola vez (cuenta las lecturas en el mock).
4. **Prueba nueva:** sin stock, devuelve una estructura vacía válida (para la pantalla de estado vacío).
5. Las API nuevas se rechazan sin sesión y la cobertura de `t020_acceso.test.js` sigue en verde, **7.5 incluida y sin modificarla**.
6. `test/fase7_frontend_ux_integration.test.js` prueba las pantallas antiguas. Se sustituye por `test/t024_interfaz.test.js`, que comprueba:
   - los `include`;
   - los tokens en `:root`;
   - `prefers-reduced-motion`;
   - que no hay librerías externas salvo Google Fonts;
   - los `id` de las pantallas nuevas.

   **Antes de borrar el archivo antiguo,** enumera en «Dudas» cada prueba que tenía y dónde queda cubierta o por qué ya no aplica.
7. **Capturas** con tu navegador sobre la vista previa, en `logs/T-024/`:
   - existencias a 1440 px y a 390 px;
   - panel lateral abierto y hoja inferior abierta;
   - partida con procedencia;
   - PIN;
   - los 4 estados;
   - comprobación de que no hay desplazamiento horizontal a 390, 768 y 1024 px.

   Ponlas junto a la referencia de `samples/diseno/` y, en el informe, enumera **las diferencias que queden** con la referencia.
8. `node test/run_all.js` con 0 fallos, salida en `logs/T-024/tests.txt`.

## Archivos previstos
- `src/InicioService.js` (nuevo)
- `src/Index.html` (armazón), `src/ui/*.html` (nuevos)
- `src/Código.js` (API e `include`), `src/Seguridad.js` (`PERMISOS_API`), `src/Repository.js` (solo las 3 columnas de AGRUPACIONES)
- `docs/API_PUBLICA.md`
- `tools/vista-previa/*` (nuevo)
- `test/t024_interfaz.test.js`, `test/t024_inicio.test.js` (nuevos); `test/fase7_frontend_ux_integration.test.js` (se borra, ver aceptación 6)
- `docs/tickets/T-024-base-visual-existencias.md` (este ticket, primer commit, sin editar)
- `logs/T-024/*`

Si necesitas otro, para y pregunta. **No toques** `src/Libro.js`, `src/InventoryEngine.js`, `src/Reproceso.js`, `src/MovementService.js`, `src/Catalogo*.js`, `src/SemillaCatalogo.js` ni `src/importacion/*`. **No subas nada de `samples/`.**

## Fuera de alcance (tickets siguientes)
- Cambiar (reproceso rápido), destrío, ajustes, movimientos con anulación y ⌘K: P-3.
- Importar y pendientes: P-2.
- Variedad y partidas a pantalla completa (02).
- Fotos de producto, logo trabajado y modo claro.

## Parar y preguntar si
- Mantener la prueba 7.5 exigiera dejar código antiguo en `Index.html`.
- `apiObtenerInicio` no pudiera cumplir el rendimiento sin tocar `MovementService` o el motor.

## Entrega
Escribe en `logs/T-024/informe.md`:
- un resumen de 5 líneas;
- la salida de `git status` y de `git log --oneline -5`;
- la lista de diferencias con la referencia visual;
- **«Dudas»** con TODO cambio no pedido por el ticket.
