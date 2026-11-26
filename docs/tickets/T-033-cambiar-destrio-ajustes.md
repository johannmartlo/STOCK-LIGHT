# T-033 — Pantallas de Cambiar, Destrío y Ajustes (P-3a)

Rama: `ticket/T-033-cambiar-destrio-ajustes`, creada desde `main` = `81dc81c` (T-027, T-031 y T-028 fusionados). Sensible: **sí** (registra operaciones que cambian el stock).
Especificación: 2026-11-26. Usuarios (`UX_MAPA_USUARIOS.md`): **el administrativo** registra los cambios de confección y el destrío **desde el ordenador y a posteriori**, a partir de lo que le pasan del almacén. Diseño: DISENO.md v3 y la referencia `samples/diseno/06-cambiar-movil.html/.png` (versión móvil; la de ordenador se diseña aquí con el mismo lenguaje).

## Lo que ya existe (verificado en main; no lo rehagas)
- `apiRegistrarReproceso`, `apiAnularReproceso`, `apiListarReprocesos` (T-009, D-036: el destrío es obligatorio si cambia el envase).
- `apiSugerenciasCambio(articulo, envase)` y `apiEvaluarCambio(origenCajas, destinos, sugerencia)` (T-025): destinos habituales con la **proporción habitual** (mediana de los 5 últimos) y el aviso «rinde distinto» (> 10 %).
- `apiPrevisualizarAnulacion('REPROCESO', id)` (T-025).
- `apiRegistrarAjustePositivo` / `apiRegistrarAjusteNegativo` (ENCARGADO): por artículo + envase; el negativo consume por FIFO.
- `MovementService.registrarAjuste` (sin API propia) admite `id_capa_objetivo`: consumo dirigido (−) o devolución (+) a una partida concreta (T-022).
- `apiPrevisualizarAnularAjuste` / `apiAnularAjuste` (T-027): anulan ajustes y destrío.
- Base visual, `nombreLegible`, panel lateral y hoja inferior de T-024; navegación y Pendientes de T-028.

## Reglas
1. **Cambiar (ordenador primero):** pantalla «Cambios» en la barra lateral y botón **Cambiar** en el panel de una partida o variedad.
   1. **Origen:** buscar escribiendo («rosa mad» → partidas vivas de Rosa I cartón madera), elegir una o varias partidas (sale primero la más antigua) y escribir las cajas que salen. Atajos: 25 %, 50 % y Toda.
   2. **Destino:** las **sugerencias habituales** (`apiSugerenciasCambio`) se ofrecen arriba como botones; al elegir una, las cajas de destino se **rellenan con la proporción habitual** («60 → 86 · 1 caja → 1,43 · lo habitual»). También se puede escribir otro destino.
   3. **Destinos nuevos:** el destino se elige de la lista de combinaciones artículo + envase de Hispatec ya vistas (CATALOGO). Si no está, se puede escribir el nombre exacto de Hispatec, con aviso «nombre que nunca ha aparecido en Hispatec».
   4. **Destrío** en cajas; **obligatorio si cambia el envase** (D-036). Kilos opcionales.
   5. **Fecha del cambio:** hoy por defecto; se puede elegir ayer u otra fecha pasada (nunca futura).
   6. **Aviso:** «rinde distinto» en ámbar cuando `apiEvaluarCambio` lo indique; no bloquea.
   7. **Confirmar** → pantalla de éxito con **Deshacer**, que usa la vista previa de `apiPrevisualizarAnulacion` antes de anular. Después, **«Otro cambio»** deja la pantalla lista para el siguiente sin volver al inicio.
   8. **Todo con teclado:** Tab e Intro avanzan, Esc cancela; se puede registrar un cambio completo sin ratón.
   9. **Móvil:** la versión de la referencia 06 (tarjetas «De» y «A», teclado numérico), con la misma lógica.
2. **Destrío directo:** botón **Destrío** en el panel o la hoja de una partida y en la barra de acciones. Cajas, motivo (lista: rotura, podrido, calidad, otro + texto) y fecha. Usa un ajuste negativo con motivo `DESTRIO` (el que cuenta `destrio7` en InicioService). Confirmación con resumen.
3. **Ajuste:** desde el panel de una partida (o por artículo + envase): **sumar o restar cajas**, motivo obligatorio (recuento, error de carga, otro + texto) y fecha. Restar más de lo que hay se rechaza con un mensaje claro.
4. **Permisos en cliente:** CONSULTA no ve Cambiar, Destrío ni Ajuste (el servidor ya lo rechaza).
5. **Tras cada operación,** Existencias y la partida se refrescan, y la partida destino muestra «⇄ Viene de…».
6. **Vista previa local:** amplía `tools/vista-previa/` para recorrer los tres flujos con datos ficticios.

## Precisiones del 26/11 (tarde)
1. **Destrío 0 permitido.** El servidor ya acepta `destrio_cajas = 0` cuando cambia el envase (entero ≥ 0, `Reproceso.js`). En la pantalla el campo sigue siendo obligatorio, pero **0 es válido**, y hay un botón rápido **«Sin destrío»** que pone 0. Caso real: rama granel en cartón → rama 500, caja por caja y sin destrío. La proporción habitual acabará siendo «1 caja → 1». No rellenes el destrío solo: lo escribe o lo confirma el usuario.
2. **Destrío y ajuste desde una partida concreta.** `apiRegistrarAjusteNegativo` consume por FIFO y no sirve para «esta partida». Añade en `src/Código.js` **`apiRegistrarAjustePartida(params)`**:
   - ESCRITURA, rol ENCARGADO, con su entrada en `PERMISOS_API` y en `docs/API_PUBLICA.md`;
   - `params`: `id_capa`, `signo` (−1 o +1), `cajas` (entero > 0), `motivo` (`DESTRIO`, `RECUENTO`, `ERROR_CARGA` u `OTRO`), `nota` (obligatoria con `OTRO`), `fecha` (no futura) y `kg` opcional;
   - toma el artículo y el envase de la capa y llama a `MovementService.registrarAjuste` con `id_capa_objetivo = id_capa`. **No toques `MovementService.js`**;
   - restar más de lo que queda en la partida devuelve un error claro, sin escribir nada.

   Desde el panel de una partida se usa esta API. Desde la barra de acciones (sin partida elegida) se siguen usando las de artículo + envase con FIFO.
3. **Pruebas de servidor** de `apiRegistrarAjustePartida` en `test/t033_cambiar.test.js`:
   - un destrío dirigido consume esa partida y no otra más antigua;
   - el stock baja y `comprobarConsistencia().consistente === true`;
   - `apiAnularAjuste` devuelve las cajas a esa misma partida;
   - restar de más se rechaza y no cambia nada;
   - sin sesión se rechaza y CONSULTA no puede llamarla;
   - el destrío cuenta en `destrio7`.
4. **Para no chocar con T-034, que se hace a la vez:** el JavaScript y el CSS de tus pantallas van en sus propios parciales (`cambiar.html`, `destrio-ajuste.html`), con su `<script>` y su `<style>`. En `app.html`, `estilos.html` e `Index.html` toca solo lo mínimo: navegación, `include_` y la llamada para abrir tus pantallas. Lista esos cambios en el informe.

## Aceptación
1. **Prueba nueva (cliente):**
   - al elegir una sugerencia, el destino se rellena con origen × proporción, redondeado a caja entera;
   - el destrío es obligatorio si cambia el envase, **0 es válido** y «Sin destrío» pone 0;
   - la fecha futura se rechaza;
   - CONSULTA no tiene los botones.
2. **Pruebas de servidor** de la precisión 3.
3. **Recorrido con tu navegador sobre la vista previa,** contado en el informe con capturas:
   - **ordenador:** un cambio solo con teclado con sugerencia, Deshacer con vista previa, y tres cambios seguidos con «Otro cambio»; uno de ellos de cambio de envase 1:1 con «Sin destrío»;
   - **móvil:** un cambio;
   - un destrío desde una partida (baja esa partida) y un ajuste.
4. **Capturas en `logs/T-033/`** a 1440 y 390 px, sin desplazamiento horizontal a 390, 768 y 1024. Compara la móvil con `samples/diseno/06-cambiar-movil.png` y enumera las diferencias.
5. `node test/run_all.js` con 0 fallos, salida en `logs/T-033/tests.txt`.

## Archivos previstos
- `src/ui/cambiar.html`, `src/ui/destrio-ajuste.html` (nuevos), `src/ui/app.html`, `src/ui/estilos.html`, `src/Index.html` (lo mínimo: navegación, `include_` y apertura)
- `src/Código.js` (`apiRegistrarAjustePartida` y, si hace falta, una API de lectura de las combinaciones de CATALOGO con rol CONSULTA), `src/Seguridad.js` (solo `PERMISOS_API`) y `docs/API_PUBLICA.md`
- `tools/vista-previa/*`, `test/t033_cambiar.test.js` (nuevo)
- `docs/tickets/T-033-cambiar-destrio-ajustes.md` (este ticket, primer commit, sin editar), `logs/T-033/*`

**No toques** el servidor de operaciones (`MovementService.js`, `Reproceso.js`, `Libro.js`, `OperacionesService.js`, `CorreccionService.js`, `src/importacion/*`) ni `src/ui/movimientos*.html`, `ui/parte*.html`, `ui/buscar*.html` o `ui/pendientes.html` (los hace T-034 a la vez). **Nada de `samples/` a git.**

## Entrega
Escribe en `logs/T-033/informe.md`:
- un resumen;
- el recorrido;
- la salida de `git status` y de `git log --oneline -5`;
- las diferencias con la referencia;
- **«Dudas»** con TODO cambio no pedido.
