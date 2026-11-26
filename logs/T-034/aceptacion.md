# T-034 — Aceptación

Rama: `ticket/T-034-movimientos-buscar-parte`, creada desde `main` = `81dc81c`.

Comando único: `node test/run_all.js` → **40 suites, 406 pruebas, 0 fallos** (salida completa en `logs/T-034/tests.txt`).
Suite nueva: `test/t034_movimientos.test.js` → **10 pruebas, 0 fallos**.

## Aceptación 1 — Prueba nueva de cliente

1. **Sin vista previa no hay confirmación de anular ni de aplicar versión.**
   - `test/t034_movimientos.test.js` prueba 1: `renderPreviewAnulacion(null)` y `renderPreviewVersion(null)` no incluyen
     `data-confirmar-anulacion` ni `data-confirmar-version`; `puedeConfirmarAnulacion(null, …)` y
     `puedeConfirmarVersion(null, …)` devuelven `false`.
   - En la pantalla, el pie del modal de versión empieza oculto (`pintarPreview` solo lo muestra con `posible:true`).

2. **`posible:false` oculta el botón de confirmar y enseña el motivo.**
   - Prueba 2: `AJUSTE_CON_CONSUMOS` muestra «consumos posteriores», `PENDIENTE_NO_PENDIENTE` muestra «ya está resuelto»,
     `STOCK_INSUFICIENTE` muestra «stock suficiente» y un código desconocido se muestra tal cual.
   - Captura `logs/T-034/anulacion-imposible.png`: el cambio con destino ya consumido enseña el motivo en lenguaje llano
     y no ofrece confirmar.

3. **Motivo obligatorio.**
   - Prueba 3: `validarMotivo('')`, `'   '` y `'ok'` son falsos; el botón nace `disabled` y solo se activa con un motivo
     de al menos 5 caracteres. Se exige en anulación y en «Aplicar la versión nueva».

4. **`sin_movimientos_stock:true` muestra «La versión nueva no mueve stock».**
   - Prueba 4: el aviso exacto aparece arriba, antes de «Líneas: antes → después», y el motivo sigue siendo obligatorio.

5. **CONSULTA no tiene Anular ni «Aplicar la versión nueva».**
   - Prueba 5: `renderDetalleHtml` con `esConsulta:true` no pinta el confirmar de anulación; el botón de aplicar versión
     lleva `data-solo-escritura="1"`; `SLApp.aplicarRol('CONSULTA')` lo oculta; `SLPendientes.abrirVersion` no abre para
     CONSULTA. Captura `logs/T-034/consulta.png`: panel de detalle sin Anular.

6. **«Copiar texto» copia exactamente `parte.texto`.**
   - Prueba 6: `textoParaCopiar(parte) === parte.texto` y `copiarTexto` llama a `navigator.clipboard.writeText` con el
     texto exacto, incluyendo saltos de línea y sin transformaciones.

## Aceptación 2 — Capturas y responsive

Capturas en `logs/T-034/`:

- `movimientos-1440.png`: Movimientos a 1440 px.
- `movimientos-390.png`: Movimientos a 390 px.
- `detalle-anular.png`: panel de detalle con la vista previa de anulación, motivo y botón Anular.
- `anulacion-imposible.png`: vista previa con `posible:false` y motivo.
- `version-preview.png`: «Aplicar la versión nueva» con líneas, operaciones, partidas y ventas a pendientes resaltadas.
- `buscar-1440.png`: ⌘K con resultados agrupados.
- `parte-390.png`: parte completo a 390 px (captura de página completa).
- `consulta.png`: vista CONSULTA sin acciones de escritura.

Comprobación de desplazamiento horizontal con el viewport real (CDP, no solo el ancho de la captura):

| Ancho | `innerWidth` | `document.scrollWidth` | Elementos que sobresalen |
| :---: | :---: | :---: | :---: |
| 390 | 390 | 390 | 0 |
| 768 | 768 | 768 | 0 |
| 1024 | 1024 | 1024 | 0 |

Diferencias con `samples/diseno/03-movimientos.png`: ver `logs/T-034/informe.md`.

## Aceptación 3 — Ejecutor

`node test/run_all.js` → 40 suites, 406 pruebas, 0 fallos. Salida completa en `logs/T-034/tests.txt`.
