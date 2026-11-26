# Informe de entrega — T-033 (Pantallas de Cambiar, Destrío y Ajustes, P-3a)

## Resumen
1. Añadidas en `src/Código.js` `apiRegistrarAjustePartida(params)` (ESCRITURA, rol `ENCARGADO`, delegando en `MovementService.registrarAjuste` con `id_capa_objetivo` sin tocar `MovementService.js`) y `apiListarCombinacionesCatalogo()` (LECTURA, rol `CONSULTA`), registradas en `PERMISOS_API` (`src/Seguridad.js`) y `docs/API_PUBLICA.md`.
2. Creadas `src/ui/cambiar.html` (ordenador primero con búsqueda multi-palabra, sugerencias habituales con proporción automática, selector de combinaciones de Hispatec + aviso de nombre nuevo, destrío obligatorio con `0` válido y botón «Sin destrío (0)», fecha no futura, aviso «rinde distinto», éxito con Deshacer + vista previa + «Otro cambio», teclado Tab/Intro/Esc y versión móvil basada en la referencia `06`) y `src/ui/destrio-ajuste.html` (modal de destrío directo y ajuste +/− con confirmación con resumen).
3. Integración mínima en `src/Index.html` (`id="navCambios"` e `include_` de los dos parciales) y `src/ui/app.html` (`actualizarNavActivo`, `mostrarVista`, enlace de botones `Cambiar`/`Destrío` y `obtenerEstadoActual`); `src/ui/estilos.html`, `src/ui/partida.html`, `src/ui/existencias.html` y los archivos de T-034 no se han tocado.
4. Ampliada `tools/vista-previa/` con `OperacionesService`, `CorreccionService` y las APIs de reprocesos, combinaciones, destrío y ajustes para recorrer los tres flujos en local.
5. Creada `test/t033_cambiar.test.js` (10 pruebas de servidor y cliente) y ejecutado `node test/run_all.js`: **40/40 suites, 406 pruebas, 0 fallos** (`logs/T-033/tests.txt`).

## Cambios mínimos en archivos compartidos (aislamiento frente a T-034)
- `src/Index.html`: añadido `id="navCambios"` al botón lateral `Cambios` (sin `data-proxima-version="1"`) e incluidos `<?!= include_('ui/cambiar') ?>` y `<?!= include_('ui/destrio-ajuste') ?>`.
- `src/ui/app.html`: añadida la vista `cambiar` en `actualizarNavActivo` y `mostrarVista`; en `enlazarEventos` enlazados `#navCambios` y los botones `Cambiar`/`⇄ Cambiar` y `Destrío` hacia `window.SLCambiar` y `window.SLDestrioAjuste`; expuestos `mostrarVista` y `obtenerEstadoActual` en `window.SLApp`.
- `src/ui/estilos.html`: sin modificaciones (todo el CSS vive en `<style>` dentro de `cambiar.html` y `destrio-ajuste.html`).

## Recorrido en navegador sobre la vista previa
1. **Ordenador (`1440×950`) — cambio con teclado y sugerencia habitual (`01-cambiar-ordenador-1440.png`)**:
   - Desde Existencias se abre `Cambios` (`#navCambios`), se escribe `rosa cart` en `#chgOrigenBuscar`, se pulsa `Enter`, se introducen `60` cajas y se elige la sugerencia `Rosa 500g · EPS 106 9x500`.
   - El destino se rellena automáticamente con `86` y muestra `60 → 86 · 1 caja → 1,43 · lo habitual`. Al intentar confirmar 60 cajas sobre una partida con 36 disponibles, el formulario bloquea con «No puedes sacar más cajas de las disponibles (36).».
   - Cambiando a la partida `Entrada 23/11 · Huerta Norte` (`hay 70`), `60 → 86` con destrío `2` y `Enter` confirma el cambio (y resuelve automáticamente la venta pendiente de `Rosa 500g`; al pulsar `Deshacer`, la vista previa bloquea correctamente la anulación al tener la capa destino 86 cajas consumidas).
2. **Deshacer con vista previa (`02-cambiar-exito-deshacer-1440.png`)**:
   - Con «Otro cambio» se registra `20 → 29` (`destrío 1 cj`) sobre `Rosa Granel M` (`Entrada 24/11 · Finca Solana`).
   - Al pulsar `Deshacer`, `apiPrevisualizarAnulacion` muestra: `Vuelven al stock: Rosa Granel M (+20 cj)` y `Desaparecen: Rosa 500g (−29 cj)` con el botón `Sí, deshacer cambio` activo. Al confirmarlo, el cambio queda anulado y el formulario se reinicia.
3. **Tres cambios seguidos con «Otro cambio» (incluyendo 1:1 con «Sin destrío»)**:
   - Cambio 1: `Rosa Granel M` (`15 cj`) → `Rosa 500g · EPS 106 9x500` (`21 cj`, destrío `1`).
   - Cambio 2 (1:1 con cambio de envase y «Sin destrío»): `Rama Extra M · Carton 40x30` (`10 cj`) → `TOMATE RAMA EXTRA M · EPS 106 9X500` (`10 cj`), pulsando `Sin destrío (0)` → confirmado como `sin destrío`.
   - Cambio 3: `Moresco I M · Carton 40x30` (`Entrada 18/11`, `12 cj`) → `TOMATE MORESCO I G · CARTON 40X30` (`12 cj`) → confirmado (`12 cajas → 12 cajas · sin destrío`).
4. **Móvil (`390×844`) y verificación responsive (`03-cambiar-movil-390.png`)**:
   - Sin desplazamiento horizontal en `390 px`, `768 px` y `1024 px` (delta horizontal `0`).
   - En móvil se selecciona `Rosa Granel M` (`hay 36`), se pulsa `50 %` (`−18`), se elige la sugerencia `Rosa 500g` (`+26`, `↗ 1 caja → 1,43 · lo habitual`), se sube destrío a `2` y se confirma con `Cambiar 18 cajas` (`Cambio registrado — 18 cajas → 26 cajas · destrío 2 cj`).
5. **Destrío y ajuste desde una partida concreta (`04-destrio-partida-1440.png`)**:
   - En `Moresco Ficticio` → `Moresco I M · Carton 40x30` (`Entrada 18/11`, `36 cajas`):
     - Destrío `−3` (`Rotura`) con resumen previo → la partida baja de `36` a `33`.
     - Ajuste `+2` (`Recuento`) con resumen previo → la partida sube de `33` a `35`.
   - También verificado el rechazo cuando se intenta restar más de lo disponible (`No se pueden restar 3 cajas: solo hay 2 disponibles.` sobre la partida de `2 cj`).

## Estado git (`feat(T-033)` `674ee8e`)

### `git status`
```text
On branch ticket/T-033-cambiar-destrio-ajustes
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
674ee8e feat(T-033): pantallas Cambiar, Destrio y Ajustes + apiRegistrarAjustePartida
452ec68 docs(T-033): anadir ticket de cambiar, destrio y ajustes
81dc81c docs(T-028): documentar rebase sobre 45b9480 en informe
3406165 feat(T-028): mostrar lineasClienteExcluido en previsualizacion de importar
f5b5d5e fix(T-028): clasificar CSV de RECEPCIONES como entradas antes que ventas
```

## Diferencias con la referencia móvil (`samples/diseno/06-cambiar-movil.png`)
- **Topbar global de la app visible arriba**: en `03-cambiar-movil-390.png` se mantiene la barra superior común de la app (`Stock Light` + avatar `JA` + `Salir`) encima de la cabecera `× Cambiar`, en coherencia con el resto de pantallas móviles (Existencias e Importar).
- **Botón rápido «Sin destrío» en móvil**: cuando cambia el envase y el destrío está vacío (`—`), aparece una píldora `Sin destrío` junto al contador de destrío para poner `0` en un toque (precisión 1 del 26/11).
- **Selectores inline de origen y destino**: al tocar la tarjeta «De» o la tarjeta «A» se despliega un selector inline con las partidas vivas o las sugerencias/combinaciones del catálogo, permitiendo completar el flujo real sin salir de la pantalla.
- **Formato del envase legible**: muestra el nombre normalizado legible del envase completo (`Carton 40x30`, `EPS 106 9x500`) en lugar de las etiquetas abreviadas estáticas de la maqueta (`Cartón`, `Tarrina · EPS 106`).

## Dudas (todo cambio no pedido expresamente en las reglas)
- **Inyección dinámica de los botones `Ajuste` desde `src/ui/destrio-ajuste.html`**: para no tocar `src/ui/partida.html` ni `src/ui/existencias.html` (evitando solapamientos con T-034 y manteniéndonos dentro de «Archivos previstos»), `destrio-ajuste.html` añade `#btnPartidaAjuste` en el pie de `#viewPartida` (pasándolo a 3 columnas) y `#btnPanelAjuste` en el panel lateral `#panelVariedad`, ambos con `data-solo-escritura="1"`.
- **Combinaciones conocidas en `apiListarCombinacionesCatalogo`**: además de `CATALOGO`, también recoge combinaciones ya vistas en `CAPAS_FIFO` y `STOCK_ACTUAL` (deduplicadas por nombre normalizado) para que los artículos con stock vigente aparezcan siempre como conocidos aunque no tengan excepciones manuales en `CATALOGO`.
- **`tools/vista-previa/server.js` (`?vista=cambiar`)**: añadido soporte de query param `?vista=cambiar` (junto a `importar`, `pendientes` y `stock_inicial`) para abrir directamente la vista de Cambiar durante las pruebas y capturas.
