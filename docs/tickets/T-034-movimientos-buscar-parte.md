# T-034 — Pantallas de Movimientos, búsqueda ⌘K, parte de la noche y «Aplicar la versión nueva» (P-3b)

Rama: `ticket/T-034-movimientos-buscar-parte`, creada desde `main` = `81dc81c` (T-027, T-031 y T-028 fusionados). Sensible: **sí** (desde aquí se anula y se aplican correcciones).
Especificación: 2026-11-26. Diseño: DISENO.md v3 y la referencia `samples/diseno/03-movimientos.html/.png`. Usuarios: `UX_MAPA_USUARIOS.md` (el administrativo corrige y envía el parte cada noche; los comerciales consultan).

## Lo que ya existe (verificado en main; no lo rehagas)
- `apiListarMovimientos(filtros)` (T-025): por día, filtros, paginado, un cambio = un elemento, anulados enlazados.
- `apiPrevisualizarAnulacion(tipo, id)` (T-025, ENTRADA/SALIDA/REPROCESO). Anulaciones reales: `apiAnularEntrada`, `apiAnularSalida` y `apiAnularReproceso` (ENCARGADO).
- `apiPrevisualizarAnularAjuste` / `apiAnularAjuste` (T-027, ajustes y destrío).
- `apiBuscar(texto)` (T-025): variedades, partidas, albaranes y cambios.
- `apiObtenerParte()` (T-029): `texto` para WhatsApp, `html` y datos.
- `apiListarVersionesPendientes`, `apiPrevisualizarVersion(idPendiente)` y `apiAplicarVersion(idPendiente, motivo)` (T-027). La vista previa devuelve `lineas_cambian`, `operaciones_rehechas`, `partidas_cambian`, `ventas_a_pendientes`, `efecto_variedades` y, desde T-031, `sin_movimientos_stock` y `mensaje`.
- Pendientes de T-028 (`src/ui/pendientes.html`), con el botón «Aplicar la versión nueva» **desactivado** («Disponible pronto»).
- Base visual, `nombreLegible`, `fmtDias`, `pluraliza`, `fmtSigned` y paneles de T-024 y T-028.

## Reglas
1. **Movimientos** (barra lateral «Movimientos» y «Ver todos» de Existencias):
   - lista agrupada por día, como los movimientos del banco (referencia 03), con cabecera de día y total del día;
   - filtros: tipo, variedad, fechas y texto;
   - carga más al llegar al final (paginado de `apiListarMovimientos`);
   - cada elemento abre un panel con el detalle (líneas, partidas afectadas, usuario y hora) y, si es `anulable` y el usuario es ENCARGADO o ADMIN, el botón **Anular**.
2. **Anular siempre con vista previa:**
   - antes de confirmar se muestra lo que dice la vista previa: «vuelven: …», «desaparecen o bajan: …» y el efecto por variedad;
   - si `posible: false`, se muestra el motivo en lenguaje llano y no hay botón de confirmar;
   - **motivo obligatorio** al confirmar;
   - lo anulado queda tachado y enlazado con su anulación.
3. **«Aplicar la versión nueva»** en Pendientes (bloque «Albaranes cambiados en Hispatec»): se activa el botón.
   - abre una vista previa con `apiPrevisualizarVersion`: líneas vieja → nueva, operaciones que se rehacen, partidas que cambian y **ventas que pasarán a pendientes** (resaltadas);
   - si `posible: false`, se muestra el motivo;
   - motivo obligatorio, y después `apiAplicarVersion`; resultado y refresco de Pendientes y Existencias.
4. **Búsqueda ⌘K / Ctrl+K** (y un icono de lupa en el móvil):
   - ventana flotante con `apiBuscar`, resultados agrupados por tipo y navegación con flechas e Intro;
   - al elegir, se abre la variedad, la partida, el albarán (en Movimientos, filtrado) o el cambio;
   - sin distinguir mayúsculas ni acentos.
5. **Parte de la noche:** pantalla «Parte» (barra lateral y acceso desde Existencias):
   - el parte de `apiObtenerParte` con **diseño pensado para captura en el móvil**: fecha y hora, total y cada variedad con su desglose y «sale primero», que quepa en 1 o 2 pantallazos a 390 px;
   - botón **«Copiar texto»** (el `texto` para pegar en el canal de WhatsApp) con confirmación «Copiado».
6. **Permisos en cliente:** CONSULTA ve Movimientos, búsqueda y Parte, pero no Anular ni «Aplicar la versión nueva».
7. **Vista previa local:** amplía `tools/vista-previa/` con datos ficticios para Movimientos (con anulables, no anulables y anulados), una versión pendiente y el parte.

## Precisiones del 26/11 (tarde)
1. **Versión que no mueve stock.** Si la vista previa trae `sin_movimientos_stock: true` (por ejemplo, una venta corregida en Hispatec a un cliente excluido), se muestra arriba en gris el texto «La versión nueva no mueve stock», junto a lo que se deshace. Sigue pidiendo motivo y se puede aplicar.
2. **Motivos en lenguaje llano** para los `posible: false` más habituales: `DOCUMENTO_SIN_VERSION_ACTIVA`, `PENDIENTE_NO_PENDIENTE`, `VERSION_NO_PENDIENTE`, falta de stock (todo o nada) y `AJUSTE_CON_CONSUMOS`. Con un código desconocido, se muestra el código.
3. **Ajustes dirigidos a una partida (T-033)** salen en Movimientos como ajuste o destrío con su partida, y se anulan con `apiPrevisualizarAnularAjuste` / `apiAnularAjuste`.
4. **Para no chocar con T-033, que se hace a la vez:** el JavaScript y el CSS de tus pantallas van en sus propios parciales (`movimientos.html`, `buscar.html`, `parte.html`), con su `<script>` y su `<style>`. En `app.html`, `estilos.html` e `Index.html` toca solo lo mínimo: navegación, `include_`, el atajo ⌘K y la llamada para abrir tus pantallas. En `pendientes.html`, solo el botón y su flujo. Lista esos cambios en el informe.

## Aceptación
1. **Prueba nueva (cliente):**
   - sin vista previa no hay confirmación de anular ni de aplicar versión;
   - `posible: false` oculta el botón de confirmar y enseña el motivo;
   - motivo obligatorio;
   - con `sin_movimientos_stock: true` se ve «La versión nueva no mueve stock»;
   - CONSULTA no tiene Anular ni «Aplicar la versión nueva»;
   - «Copiar texto» copia exactamente `parte.texto`.
2. **Capturas en `logs/T-034/`** sobre la vista previa:
   - Movimientos a 1440 y 390 px;
   - panel de detalle con Anular y vista previa;
   - anulación imposible con su motivo;
   - «Aplicar la versión nueva» con vista previa y ventas a pendientes;
   - ⌘K con resultados;
   - Parte a 390 px (todo el parte);
   - vista CONSULTA.

   Sin desplazamiento horizontal a 390, 768 y 1024. Compara Movimientos con `samples/diseno/03-movimientos.png` y enumera las diferencias.
3. `node test/run_all.js` con 0 fallos, salida en `logs/T-034/tests.txt`.

## Archivos previstos
- `src/ui/movimientos.html`, `src/ui/buscar.html`, `src/ui/parte.html` (nuevos), `src/ui/pendientes.html` (solo el botón y su flujo), `src/ui/app.html`, `src/ui/estilos.html`, `src/Index.html` (lo mínimo)
- `tools/vista-previa/*`, `test/t034_movimientos.test.js` (nuevo)
- `docs/tickets/T-034-movimientos-buscar-parte.md` (este ticket, primer commit, sin editar), `logs/T-034/*`

**No toques** ningún archivo de servidor (`src/*.js` y `src/importacion/*`): todo lo necesario ya existe; si falta algo, para y pregunta. Tampoco `src/ui/cambiar.html` ni `src/ui/destrio-ajuste.html` (los hace T-033 a la vez). **Nada de `samples/` a git.**

## Entrega
Escribe en `logs/T-034/informe.md`:
- un resumen;
- la salida de `git status` y de `git log --oneline -5`;
- las diferencias con la referencia;
- **«Dudas»** con TODO cambio no pedido.
