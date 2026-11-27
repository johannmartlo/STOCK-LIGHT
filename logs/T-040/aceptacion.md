# T-040 — Comprobación de aceptación

Fecha: 2026-11-27. Rama `ticket/T-040-cuadre-noche`, rebasada sobre `5585962` (T-041).
Comando único: `node test/run_all.js` → **48 suites, 475 pruebas, 0 fallos** (`logs/T-040/tests.txt`).

## Puntos de aceptación del ticket

### 1. Familia con 3 artículos; `hay` = [igual, −7, vacío]
**Cómo se comprueba:** `test/t040_cuadre.test.js`, caso 1.

- Se crean tres artículos ficticios en la familia «SOLAR». El artículo de la diferencia
  tiene dos partidas: 4 cajas del 10/01/2026 y 16 del 10/02/2026.
- `obtenerCuadre()` devuelve la familia `SOLAR` con 3 artículos ordenados por
  `compararArticulos` y 35 cajas de `deberia`.
- Se confirma con `hay` = 10 (igual), 13 (−7) y vacío.
- Resultado: 1 ajuste con `motivo_ajuste = RECUENTO`, `signo = −1`, 7 cajas y
  `observaciones = CUADRE:<id_cuadre>`.
- La partida más antigua queda con 4 cajas consumidas y 0 restantes; la siguiente, con 3
  consumidas y 13 restantes. El stock final del artículo es 13.
- `CUADRES` tiene una fila: `lineas_contadas = 3`, `lineas_con_diferencia = 1`,
  `cajas_diferencia = −7` e `ids_ajustes` con el ajuste creado.
- `comprobarConsistencia().consistente === true` y la suma de `CONSUMOS_FIFO` por capa es
  igual a `cajas_consumidas`.

### 2. Diferencia positiva +5
**Cómo se comprueba:** caso 2 de la misma suite.

- Un artículo con 10 cajas, `hay = 15`.
- Se crea un único ajuste `RECUENTO` de +5, con capa FIFO nueva de 5 cajas.
- Stock final 15; `comprobarConsistencia().consistente === true`; consumos FIFO por capa OK.

### 3. El stock cambia entre abrir y confirmar
**Cómo se comprueba:** caso 3.

- Se abre el cuadre con 10 cajas y, antes de confirmar, un ajuste externo deja 12.
- `confirmarFamilia` devuelve `{ success: false, status: 'STOCK_CAMBIADO' }`, con
  `deberia = 10` y `actual = 12` en la línea afectada.
- No se crea ningún movimiento de ajuste, no se guarda ninguna fila de `CUADRES` y el stock
  sigue en 12.

### 4. Confirmar dos veces el mismo `id_cuadre` + familia
**Cómo se comprueba:** caso 4.

- Primera confirmación: 1 ajuste y 1 fila de `CUADRES`.
- Segunda confirmación con los mismos datos: `idempotente = true`, los mismos `ids_ajustes`,
  ninguna fila nueva de `CUADRES` y ningún movimiento nuevo.

### 5. `hay` negativo o no numérico
**Cómo se comprueba:** caso 5.

- `hay = −1`, `'abc'`, `2.5` y `1.5` lanzan error de validación antes de escribir.
- Tras los cuatro intentos siguen existiendo solo el movimiento de entrada, cero filas de
  `CUADRES` y el stock original de 10.

### 6. Anular el ajuste con `apiAnularAjuste`
**Cómo se comprueba:** caso 6.

- Se confirma un recuento de 3 cajas (ajuste −7); el stock queda en 3.
- `apiAnularAjuste(idAjuste, 'Recuento mal contado', …)` devuelve `ANULADO` y el stock vuelve
  a 10. `comprobarConsistencia().consistente === true`.

### 7. Acceso: sin sesión y con rol CONSULTA
**Cómo se comprueba:** caso 7.

- `apiObtenerCuadre` y `apiConfirmarCuadreFamilia` sin contexto lanzan exactamente
  «Acceso no autorizado».
- `PERMISOS_API` fija `ENCARGADO` para las dos; `rolAlcanza_('CONSULTA', 'ENCARGADO')` es
  `false`.
- Con una sesión real de `ServicioAcceso` de rol CONSULTA, `apiLlamar` devuelve
  `{ success: false, errorCode: 'PERMISO_DENEGADO' }` para las dos API.

### 8. Invariantes con 25 semillas
**Cómo se comprueba:** caso 8.

Para 25 semillas deterministas se generan 3 artículos con 1-3 capas de cajas aleatorias y
recuentos aleatorios (vacío, igual o diferencia entre −10 y +10, nunca `hay < 0`):

- `comprobarConsistencia().consistente === true` en todas.
- Suma de `CONSUMOS_FIFO` por capa = `cajas_consumidas` en todas.
- Stock final de cada artículo = `hay` (o `deberia` si la línea iba vacía).
- Una fila de `CUADRES` por semilla con los contadores y cajas de diferencia del resultado.

### 9. Pruebas existentes y salida del ejecutor
**Cómo se comprueba:** `git diff --name-only 5585962..HEAD -- test/` solo devuelve
`test/t040_cuadre.test.js` (las pruebas que T-041 cambió ya vienen en la base, no las toca
esta rama). `node test/run_all.js` termina con **48 suites, 475 pruebas, 0 fallos** y la salida
completa está en `logs/T-040/tests.txt` (UTF-8 sin BOM).

## Reglas adicionales comprobadas

- **Esquema `CUADRES`**: caso 0. La hoja se define en `SCHEMA_DEFINITIONS`, se crea al
  aprovisionar y una segunda provisión no la recrea (`createdSheets` vacío).
- **Pantalla y navegación**: caso 9. `Index.html` incluye `ui/cuadre`, tiene `navCuadre` con
  `data-solo-escritura="1"`; `app.html` conmuta la vista y añade la acción del móvil;
  `cuadre.html` usa `inputmode="numeric"`, `<label>` accesible por campo, `aria-live="polite"`,
  trata `STOCK_CAMBIADO`, tiene «Volver a cargar», «Saltar» y el texto «Cuadra · siguiente
  familia». Las clases `.sl-cuadre-*` están al final de `estilos.html`.
- **Diseño**: capturas con datos ficticios en `logs/T-040/`:
  - `01-cuadre-familia-1280.png`, `02-cuadre-familia-360.png`;
  - `03-cuadre-final-1280.png`, `04-cuadre-final-360.png`;
  - `05-cuadre-stock-cambiado-360.png`, `06-cuadre-stock-cambiado-1280.png`;
  - `07-movil-accion-cuadre-360.png` (acción del móvil) y
    `08-escritorio-menu-cuadre-1280.png` (entrada del menú).
- **Sin desplazamiento horizontal** a 360 px y a 1280 px: medido con Chrome/CDP,
  `innerWidth = document.documentElement.scrollWidth = document.body.scrollWidth` en ambos
  casos (360 y 1280).
- **Sin datos reales**: las pruebas y las capturas usan datos ficticios de
  `test/t040_cuadre.test.js` y `tools/vista-previa/datosFicticios.js`.

## Nota sobre la maqueta

El enlace de la maqueta (`https://claude.ai/artifact/3rc3BBKCXQF8UJ6VkFkBTD#play-Cuadre`)
devuelve la pantalla de acceso de Claude también desde un proxy de lectura, así que no se pudo
abrir sin sesión. La pantalla se ha construido con la descripción del ticket, el patrón de
`parte.html` y los tokens de `estilos.html`.
