# Aceptación T-041 — Pulido de lectura

1. **Nombres legibles en las tres copias (`src/NombresLegibles.js`, `src/ui/app.html`, `src/ui/parte.html`):**
   - Comprobado en `test/t041_pulido.test.js` (prueba 1) extrayendo `app.html` y `parte.html` con `vm` y comparando contra `NombresLegibles.nombreLegible`: los 6 casos exigidos dan el mismo resultado exacto en las tres copias.
2. **Solo stock inicial el día D:**
   - Comprobado en `test/t041_pulido.test.js` (prueba 2): `entradas = 0` todos los días de la serie, días anteriores a D con `stock: null`, `fecha_inicio_datos = D`, y `calcularDeltaSemanal` devuelve `0 cajas desde el 26/11`.
3. **Stock inicial en D + entrada de 10 cajas en D+1:**
   - Comprobado en `test/t041_pulido.test.js` (prueba 3): `entradas` de D = 0, `entradas` de D+1 = 10 y `calcularDeltaSemanal` devuelve `+10 cajas desde el 26/11`.
4. **Movimientos (detalle sin `STOCK_INICIAL`, motivos traducidos y autor visible):**
   - Comprobado en `test/t041_pulido.test.js` (prueba 4): transacción de stock inicial sin `STOCK_INICIAL` en `detalle`; ajuste `ERROR_CARGA` muestra `Error de carga` sin código técnico; `x@y.com` con un único ADMIN activo `Ana` muestra `Ana` y con dos ADMIN muestra `x`; `_busqueda` mantiene los valores originales (`x@y.com`, `ERROR_CARGA`).
5. **Contraste AA y tamaños mínimos (12 px / 13 px secundarios):**
   - Comprobado en `test/t041_pulido.test.js` (prueba 5): `src/ui/estilos.html` define `--sl-text-label: #80858E` y `--sl-out: #8B8B94`, y no queda ningún `font-size` ni shorthand `font` menor de 12 px en `src/ui/*.html` ni `src/Index.html`.
6. **Carga oscura y esqueleto en `Index.html` / `existencias.html`:**
   - Comprobado en `test/t041_pulido.test.js` (prueba 6): `<style>html,body{background:#0A0A0B;color:#EDEDEF}</style>` precede a cualquier `<link>`, incluye `preconnect` a `fonts.gstatic.com` con `crossorigin`, carga no bloqueante de Geist con `<noscript>`, y esqueleto `#estadoCargando` con 6 filas y `prefers-reduced-motion` sin pulso.
7. **Suite completa `node test/run_all.js`:**
   - 46 suites superadas, 0 fallidas, 458 pruebas superadas. Salida completa guardada en `logs/T-041/tests.txt`.
