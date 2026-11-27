# Informe T-041 — Pulido de lectura

## Resumen
- **Rama:** `ticket/T-041-pulido-lectura` (rebasada sobre `main` = `43c22cd`, que ya incluye T-039)
- **Commits:** `d0bab93` (ticket), `f2223e3` (pulido inicial), `5b7769e` (ajustes tras rebase: subtotal del desglose y pruebas)
- **Pruebas:** `node test/run_all.js` → 47 suites superadas, 0 fallos, 465 pruebas superadas (`logs/T-041/tests.txt`)
- **Aceptación:** 7/7 puntos cumplidos (`logs/T-041/aceptacion.md`) + integración limpia con T-039
- **Dudas:** ver sección «Dudas» al final (actualizaciones de 3 pruebas existentes y ajustes detallados)

## Colores cambiados (contraste WCAG AA ≥ 4,5:1)

| Token / Color | Antes | Después | Contraste sobre `#0A0A0B` | Contraste sobre `#121214` | Contraste sobre `#18181B` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--sl-text-label` (`src/ui/estilos.html`) | `#5C6068` | `#80858E` | 5,34:1 | 5,05:1 | 4,78:1 |
| `--sl-out` (`src/ui/estilos.html`) | `#71717A` | `#8B8B94` | 5,86:1 | 5,54:1 | 5,25:1 |

Se comprobaron todos los demás colores de texto usados sobre `#0A0A0B`, `#121214` y `#18181B` (`--sl-text`, `--sl-text-secondary`, `--sl-green`, `--sl-amber`, `--sl-red`, `--sl-brand`, `--sl-pink`, `#A1A1AA`, `#A4ACB9`, `#FCA5A5`, `#FDE68A`, `#86EFAC`, `#F28CC4`, `#9DBBF5`): todos superan 4,5:1 (mínimo 5,18:1).

## Tamaños cambiados (`selector · antes · después`)

| Archivo | Selector / Ubicación | Antes | Después |
| :--- | :--- | :--- | :--- |
| `src/ui/estilos.html` | `.sl-nav-badge` | `11px` | `12px` |
| `src/ui/estilos.html` | `.sl-sidebar-footer .sl-avatar` | `11px` | `12px` |
| `src/ui/existencias.html` | Eje inferior gráfico (`#deskAxisStart` / `#deskAxisEnd` wrapper) | `11px` | `12px` |
| `src/ui/app.html` | Cabecera `QUÉ VA A PASAR` (`construirHtmlPrevisualizacionImportacion`) | `11px` | `12px` |
| `src/ui/app.html` | Subtítulo de fila variedad ordenador (`renderVariedades`) | `12px` | `13px` |
| `src/ui/app.html` | Subtítulo fecha fila variedad móvil (`renderVariedades`) | `12px` | `13px` |
| `src/ui/app.html` | Detalle de fila movimiento ordenador (`renderMovimientos`) | `12px` | `13px` |
| `src/ui/app.html` | Detalle de fila movimiento móvil (`renderMovimientos`) | `12px` | `13px` |
| `src/ui/app.html` | Detalle de fila partida (`construirListaPartidasHtml`) | `12px` | `13px` |
| `src/ui/app.html` | Subtítulo `Viene de` en fila partida (`construirListaPartidasHtml`) | `12px` | `13px` |
| `src/ui/buscar.html` | `.sl-buscar-esc` | `10.5px` | `12px` |
| `src/ui/buscar.html` | `.sl-buscar-grupo-titulo` | `10.5px` | `12px` |
| `src/ui/buscar.html` | `.sl-buscar-item-texto span` | `12px` | `13px` |
| `src/ui/buscar.html` | `.sl-buscar-pie` | `11.5px` | `12px` |
| `src/ui/buscar.html` | `.sl-buscar-pie kbd` | `10.5px` | `12px` |
| `src/ui/buscar.html` | `@media (max-width: 560px) .sl-buscar-pie` | `10.5px` | `12px` |
| `src/ui/cambiar.html` | `#btnChgMobSinDestrio` | `11px` | `12px` |
| `src/ui/cambiar.html` | Subtítulo partida en resultados origen (línea 971) | `11px` | `13px` |
| `src/ui/cambiar.html` | Código artículo secundario en selector catálogo (línea 1651) | `11px` | `12px` |
| `src/ui/movimientos.html` | `.sl-hist-campo > span` | `11px` | `12px` |
| `src/ui/movimientos.html` | `.sl-hist-dia-head` | `11.5px` | `12px` |
| `src/ui/movimientos.html` | `.sl-hist-detalle` | `12px` | `13px` |
| `src/ui/movimientos.html` | `.sl-hist-enlace button` | `11.5px` | `12px` |
| `src/ui/movimientos.html` | `.sl-hist-meta span` | `10.5px` | `12px` |
| `src/ui/movimientos.html` | `.sl-hist-preview-bloque h4` | `11px` | `12px` |
| `src/ui/parte.html` | `.sl-parte-kicker` | `10.5px` | `12px` |
| `src/ui/parte.html` | `.sl-parte-total-lbl` | `11px` | `12px` |
| `src/ui/parte.html` | `.sl-parte-desglose` | `11.5px` | `13px` |
| `src/ui/parte.html` | `.sl-parte-sale` | `11px` | `12px` |
| `src/ui/parte.html` | `.sl-parte-pie` | `11.5px` | `12px` |
| `src/ui/pendientes.html` | `.sl-ver-bloque h3` | `10.5px` | `12px` |
| `src/ui/pendientes.html` | `.sl-ver-etiqueta` | `10px` | `12px` |

## `git status`
```text
 M logs/T-038/informe.md
?? logs/T-008/fusion.md
?? logs/T-009/fusion.md
?? logs/T-024/fusion.md
```
*(Archivos preexistentes en el árbol de trabajo; no modificados ni añadidos en esta rama.)*

## `git log --oneline -5`
```text
5b7769e feat(T-041): ajustar subtotal del desglose y pruebas tras rebase sobre 43c22cd
4cac182 docs(T-041): anadir informe de entrega
f2223e3 feat(T-041): pulido de lectura, grafico honesto, contraste y carga oscura
d0bab93 docs(tickets): anadir T-041 pulido de lectura
43c22cd docs(T-039): anadir informe de entrega
```

## Dudas
1. **`test/t024_interfaz.test.js`:** actualizados 3 valores esperados antiguos por incompatibilidad directa con T-041: `#5C6068` → `#80858E` y `#71717A` → `#8B8B94` en la prueba 3 (tokens de contraste) y `'Cocktail II MM · Ifco 8x300'` → `'Cocktail II MM · IFCO 8x300'` en la prueba 8 (`IFCO` añadido a siglas).
2. **`test/t029_parte_noche.test.js`:** actualizado 1 valor esperado `'Cocktail II MM · Ifco 8x300'` → `'Cocktail II MM · IFCO 8x300'` en la prueba 7 (`IFCO` añadido a siglas).
3. **`src/NombresLegibles.js`, `src/ui/app.html` y `src/ui/parte.html`:** ampliada la expresión regular de dimensiones para soportar medidas de 3 factores (`40X30X11`), y expuesto `nombreLegible` en `window.SLParte` para poder probar la tercera copia desde `test/t041_pulido.test.js`.
4. **`src/OperacionesService.js`:**
   - Para ajustes sin documento real cuya referencia es sintética (`AJUSTE:<MOTIVO>`, generada por `MovementService`), se omite dicha referencia de `detalle` para no mostrar `AJUSTE:ERROR_CARGA` junto a `Error de carga`.
   - Para stock inicial, `etiquetaDocumento` pasa de `'STOCK INICIAL'` a `'Stock inicial'`.
   - En `_busqueda` se indexan tanto los valores originales (`usuario`, `motivo`) como los visibles (`usuarioVisible`, `motivoLegible`).
5. **`src/ui/existencias.html` y `src/ui/estilos.html`:** `#estadoCargando` se deja visible por defecto (sin `sl-hidden`) para evitar un fotograma vacío mientras llega `apiObtenerInicio`, y `.sl-sk` fija `background-color: #18181B` desactivando el degradado bajo `prefers-reduced-motion: reduce`.
6. **`src/ui/app.html`:** en `renderGraficoOrdenador`, al pasar el ratón sobre un día sin datos (`stock: null`), se oculta el marcador de curva y el tooltip muestra `Sin datos`; si solo hay un día con dato, se dibuja un punto `<circle>` sin rampa desde 0.
7. **`src/ui/buscar.html` y `src/ui/cambiar.html`:** subidos a `13px` el texto secundario de fila en resultados de búsqueda (`.sl-buscar-item-texto span`) y el subtítulo de partida en resultados de origen de Cambiar (línea 971), además de `.sl-parte-desglose` en `src/ui/parte.html`.
8. **Rebase sobre `main` (`43c22cd`, con T-039) y `test/t039_orden_calibre.test.js`:** rebase limpio sin conflictos; actualizados únicamente los 3 valores esperados de nombres legibles afectados por T-041 (`'Rojo I GGG · Carton 40x30'` → `'Rojo I GGG · Cartón 40x30'`, `'Rojo I G · Carton 40x30'` → `'Rojo I G · Cartón 40x30'` en las pruebas 1 y 6, y `'Rojo II S/c'` → `'Rojo II S/C'`). No fue necesario ajustar nada más en la prueba de T-039 porque no comprobaba estilos en línea.
9. **Subtotal del desglose (`construirDesgloseHtml` en `src/ui/app.html` y `src/ui/estilos.html`):** trasladados los estilos en línea del subtotal a `.sl-desglose-subtotal` en `src/ui/estilos.html` (`12px`, mayúsculas, `letter-spacing: 0.06em`, `color: var(--sl-text-label)`, peso `600`, y `.sl-mono` en `var(--sl-text-secondary)`), y envuelto cada bloque en `<div class="sl-desglose-bloque" role="group" aria-label="<Variedad · Categoría>, N cajas">` (con singular/plural vía `pluraliza`). Añadida la prueba 7 en `test/t041_pulido.test.js`.
