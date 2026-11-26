# T-027 — Aceptación

Rama: `ticket/T-027-correcciones` (desde `main` = `5eea049`).
Comando único: `node test/run_all.js` → **34 suites, 365 pruebas, 0 fallos** (salida completa en `logs/T-027/tests.txt`).
Suite nueva: `test/t027_correcciones.test.js` → **10 pruebas, 0 fallos**.

1. **Corregir una salida** — prueba 1.
   - Venta de 30 cajas corregida a 20. Tras aplicar: stock +10, la capa recupera las 30 y vuelve a consumir 20 por FIFO (quedan 80), el documento guarda la firma nueva y reimportar el mismo CSV da `YA_IMPORTADO`.
   - La versión queda `APLICADA` y la fila `MODIFICADO_EN_ERP` `RESUELTA`.

2. **Entrada sin consumos** — prueba 2.
   - Compra de 50 cajas de finca A corregida a finca B. La capa nueva conserva las 50 cajas, la fecha del albarán y el proveedor `FINCA B`; la capa vieja queda `ANULADA`. Reimportar da `YA_IMPORTADO`.

3. **Cascada del caso del responsable** — prueba 3.
   - Compra de 100 Moresco G de finca A, venta de 30, cambio de 20 a Rosa 500 y venta de 10 del Rosa 500. Al corregir la compra a finca B: el total sigue en 60 cajas, las dos ventas y el cambio se rehacen contra la partida nueva, el Rosa 500 tiene `id_capa_origen` = capa nueva de Moresco, no se duplica ni pierde ninguna caja y `comprobarConsistencia()` da 0.

4. **A pendientes** — prueba 4.
   - Compra corregida de 100 a 20 con una venta de 80. La venta queda en PENDIENTES con `STOCK_INSUFICIENTE` y 80 cajas, el documento de venta queda `PENDIENTE_REVISION`, el stock queda en 20 y el resto de la corrección se aplica.

5. **Imposible** — prueba 5.
   - Un cambio dependiente cuya línea de origen desaparece en la versión nueva devuelve `posible = false` y un motivo; `aplicarVersion` no escribe nada (instantánea de todas las hojas antes = después).

6. **Vista previa = real con 30 semillas** — prueba 6.
   - 30 escenarios deterministas con compras, ventas, reprocesos, ajustes negativos y versiones nuevas que cambian cajas, artículo, envase y proveedor.
   - La vista previa no escribe. `posible` coincide con el resultado real. `partidas_cambian` (comparadas por contenido, sin los IDs que genera cada ejecución) y `ventas_a_pendientes` coinciden.
   - Después de cada corrección: `comprobarConsistencia().consistente === true`, ninguna capa negativa y la suma de CONSUMOS_FIFO por capa = `cajas_consumidas`.

7. **Una sola versión pendiente** — prueba 7.
   - Reimportar un albarán modificado a 65 y después a 70 deja una sola fila `MODIFICADO_EN_ERP`, una versión `PENDIENTE` (la última) y la anterior `DESCARTADA`. `apiListarVersionesPendientes` devuelve una.

8. **Anular ajustes** — prueba 8.
   - `anularAjuste` de un destrío de 20 devuelve las cajas a su capa exacta (stock 100).
   - Un ajuste positivo cuya capa ya tiene consumos devuelve `posible = false` y no cambia ninguna hoja.

9. **Rendimiento** — prueba 9.
   - Con 5.000 movimientos y 50 dependientes, `aplicarVersion` termina en menos de 10 s en Node (la prueba mide con `Date.now()`).

10. **API, permisos y acceso** — prueba 10 y `test/t020_acceso.test.js`.
    - Las cinco API existen, las cinco rechazan sin sesión y las cuatro de escritura/lectura sensible tienen rol mínimo `ENCARGADO`; `apiListarVersionesPendientes` es `CONSULTA`.
    - `t020_acceso.test.js` sigue en verde (18/18), incluida la cobertura de `PERMISOS_API`.

11. **Ejecutor** — `node test/run_all.js` con 0 fallos; salida en `logs/T-027/tests.txt`.

## Notas de alcance

- No se ha modificado ningún método existente de `MovementService.js`: no se añadió ningún método nuevo allí.
- No se tocó `Libro.js`, `InventoryEngine.js`, `Reproceso.js` ni la interfaz (`src/Index.html`, `src/ui/`, `src/InicioService.js`).
- No se borra ni edita ninguna fila de `MOVIMIENTOS`: la corrección añade anulaciones y movimientos nuevos.
