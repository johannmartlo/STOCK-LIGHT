# T-029 — Parte de stock de la noche (servidor)

Rama: `ticket/T-029-parte-noche`, creada desde `main` = `1581b23`. Sensible: **no escribe stock**; envía correos.
Especificación: 2026-11-26. Origen: `UX_MAPA_USUARIOS.md`, punto 2. Hoy se envía cada noche el Excel con pantallazos por un canal de WhatsApp. Este ticket prepara el **texto del parte** (para copiar y pegar en el canal) y un **correo automático** de respaldo. La pantalla del parte irá en un ticket de interfaz posterior: **no toques nada de interfaz.**

## Lo que ya existe (verificado en main; no lo rehagas)
- `InicioService.obtenerInicio()` (T-024): total, variedades con partidas (artículo, envase, proveedor, fecha, cajas), `sale_primero`, pendientes, `importado_hasta`, `destrio7`.
- Los nombres legibles los hace hoy el **cliente** (`nombreLegible` en `src/ui/app.html`):
  - quita el prefijo «TOMATE »;
  - pone la primera letra de cada palabra en mayúscula;
  - deja en mayúsculas G, GG, GGG, M, MM, MMM, I, II, EPS y POOL;
  - pone las medidas en minúscula (50X30 → 50x30, 500G → 500g).

## Reglas
1. **`src/ParteService.js`** (nuevo), de solo lectura. `generarParte()` **usa `InicioService.obtenerInicio()`**, sin recalcular nada por su cuenta, para que el parte diga exactamente lo mismo que la pantalla. Devuelve `{ fecha, hora, texto, html, datos }`.
2. **`texto`**, para WhatsApp: sin emojis decorativos; miles con punto; nombres legibles; variedades en su orden y, dentro, por cajas de mayor a menor. Formato:
   ```
   STOCK · 26/11 · 21:00
   Total: 2.522 cajas

   MORESCO · 1.337
   I GG Cartón 40x30 686 · I G Cartón 40x30 424 · I M Cartón 40x30 227
   Sale primero: 10/11 (16 días)

   RAMA · 352
   …

   Pendientes: 2 ventas sin stock · Importado hasta: C 26/11 · V 26/11
   ```
   - Las variedades sin stock no salen.
   - El bloque de pendientes solo sale si hay alguno.
   - «Importado hasta» sale siempre, para que se sepa si el parte está al día.
3. **`html`**, para el correo: lo mismo en una tabla sencilla y legible en Gmail del móvil (estilos en línea, fondo claro, sin imágenes externas).
4. **Nombres legibles en servidor:** `src/NombresLegibles.js` (nuevo) con las **mismas reglas** que el cliente. Prueba con los 6 ejemplos que usa `test/t024_interfaz.test.js`, que deben dar el mismo resultado que la función del cliente.
5. **Correo automático:**
   - `enviarParteDiario_()` envía el `html` (y el `texto` como alternativa) con `MailApp` a los destinatarios de la propiedad `PARTE_DESTINATARIOS` (lista separada por comas);
   - asunto: «Stock 26/11 · 2.522 cajas»;
   - si no hay destinatarios, no envía y lo registra; si falla, lo registra en LOG_OPERACIONES y no lanza.
6. **Funciones de administración** (con `exigirPropietario_()`):
   - `adminConfigurarParte(destinatarios, hora)`: guarda los destinatarios y la hora (por defecto, 21);
   - `adminInstalarParteDiario()`: crea el disparador diario a esa hora, en zona horaria Europe/Madrid. Es idempotente: no duplica disparadores;
   - `adminEnviarParteAhora()`: para probar.
7. **API:** `apiObtenerParte()` como LECTURA, rol CONSULTA (para la pantalla futura y para copiar el texto).
8. En `docs/PUESTA_EN_MARCHA.md`, añade un paso «Parte de la noche»: configurar destinatarios, instalar el disparador y probar.

## Aceptación
1. **Prueba nueva (coherencia):** con datos aleatorios, el total y las cajas de cada variedad del parte son iguales a los de `obtenerInicio()`, y la suma del desglose de cada variedad = sus cajas.
2. **Prueba nueva (formato):**
   - miles con punto;
   - orden por cajas dentro de cada variedad;
   - sin variedades vacías;
   - el bloque de pendientes solo aparece si los hay;
   - «Importado hasta» siempre aparece.
3. **Prueba nueva (nombres):** los 6 ejemplos dan lo mismo en servidor que en cliente.
4. **Prueba nueva (correo, con MailApp simulado):**
   - envía a los destinatarios configurados con el asunto correcto;
   - sin destinatarios no envía;
   - un fallo de MailApp no lanza y queda registrado;
   - instalar el disparador dos veces deja uno solo.
5. `apiObtenerParte` se rechaza sin sesión; las funciones `admin*` exigen al propietario; la cobertura de `t020_acceso.test.js` sigue en verde.
6. `node test/run_all.js` con 0 fallos, salida en `logs/T-029/tests.txt`.

## Archivos previstos
- `src/ParteService.js`, `src/NombresLegibles.js` (nuevos)
- `src/Código.js` (solo la API y las funciones `admin*`), `src/Seguridad.js` (solo `PERMISOS_API`), `docs/API_PUBLICA.md`, `docs/PUESTA_EN_MARCHA.md`
- `test/t029_parte_noche.test.js` (nuevo)
- `docs/tickets/T-029-parte-noche.md` (este ticket, primer commit, sin editar)
- `logs/T-029/*`

**No toques** nada de `src/ui/`, `src/Index.html` ni `src/InicioService.js` (solo llamarlo), ni `src/MovementService.js`, `src/importacion/*`, `src/CorreccionService.js` o `src/SeguimientoService.js` (los están tocando otros agentes). Si necesitas otro archivo, para y pregunta.

## Entrega
Escribe en `logs/T-029/informe.md`:
- un resumen de 5 líneas;
- el texto completo de un parte de ejemplo (con datos ficticios);
- la salida de `git status` y de `git log --oneline -5`;
- **«Dudas»** con TODO cambio no pedido.
