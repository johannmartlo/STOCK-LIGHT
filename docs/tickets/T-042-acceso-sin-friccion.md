# T-042 — Acceso sin fricción, errores claros y gráfico desde el stock inicial

Rama: `ticket/T-042-acceso-sin-friccion`, creada desde `main` = `8ab70b2`. Sensible: **SÍ** (toca el acceso).
Especificación: 2026-11-27. Origen: `analisis/VALORACION_DISENO_2026-11-27.md` (Acceso 5,5) y uso real en DEV el 27/11. Rúbrica: B7, B8, E18.

## Problemas vistos en DEV el 27/11
1. **Cada recarga pide el PIN.**
   - El servidor guarda la sesión 6 h y la renueva con el uso (`Seguridad.js`, `sessionTtlSeconds`).
   - Pero el navegador la guarda solo en memoria (`state.sesion`, `Index.html`), así que al recargar o volver a la pestaña se pierde.
2. **Errores que confunden.**
   - `apiEntrar` y `apiEstablecerPin` devuelven siempre `CREDENCIALES_INVALIDAS` (`Código.js` ~l. 1895 y 1914), y la pantalla dice «No se pudo entrar. Comprueba el enlace y el PIN» (`Index.html` ~l. 438).
   - El 27/11 el fallo real era un **enlace viejo guardado en el navegador** (el usuario tenía el PIN bien): se perdió media hora.
3. **Copiar la dirección no sirve.** La app quita la clave de la barra (bien hecho), pero nadie lo explica.
4. **Enlaces con /dev.** `crearUsuario` y `regenerarEnlace` llamados desde el editor generan la URL `/dev` (solo vale para el propietario) si no se pasa `urlImplementacion`.
5. **Gráfico.**
   - Dice «+4.055 cajas desde el 23/11» y dibuja una rampa.
   - El stock inicial se cargó con la **fecha de cada partida** (23 a 26/11), y T-041 toma la primera como inicio.
   - Debe empezar el día de la carga, que coincide con la fecha de corte (26/11).
6. La pantalla Importar dice «compras» donde debe decir «recepciones» (deuda menor).

## Reglas
1. **Sesión recordada en el dispositivo** (`Index.html`):
   - al entrar, guarda `{ sesion, nombre, rol }` en `localStorage` (clave `sl_sesion`);
   - al cargar, si existe, la prueba con una llamada ligera nueva `apiComprobarSesion(sesion)` (LECTURA, sin rol mínimo: devuelve `{ ok, nombre, rol }` o `{ ok:false }`);
   - si vale, entra directo sin PIN; si no, la borra y muestra el PIN.
   - **Salir** la borra en el navegador e invalida la sesión en el servidor (`apiSalir`, ya existe).
   - **Caducidad:** la del servidor, sin cambios (6 h renovadas con el uso). No se alarga.
   - Lo que se guarda es el id de sesión, **nunca el PIN**.
2. **Errores que dicen la causa** (`Seguridad.js` devuelve el motivo; `Código.js` lo pasa; `Index.html` lo muestra):

   | Código | Cuándo | Mensaje |
   |---|---|---|
   | `ENLACE_NO_VALIDO` | el token no existe, el usuario está inactivo o el enlace se regeneró | «Este enlace ya no vale. Pide uno nuevo al responsable.» La app borra el token guardado y pasa a «sin enlace» |
   | `PIN_INCORRECTO` | | «PIN incorrecto. Te quedan N intentos.» |
   | `BLOQUEADO` | | «Demasiados intentos. Prueba otra vez a las HH:MM.» |
   | `ERROR_SERVIDOR` | cualquier otra excepción | «No se pudo conectar. Inténtalo en un momento.» Se registra el detalle en el log del servidor, nunca en pantalla |

   El conteo de intentos y el bloqueo actuales **no cambian**.
3. **Aviso sobre el enlace:** en la pantalla del PIN, debajo, una línea fija: «Para entrar en otro dispositivo usa tu enlace personal (el del mensaje); copiar la dirección del navegador no sirve.»
4. **URL de la app configurable** (`Seguridad.js`): si no se pasa `urlImplementacion`, `crearUsuario` y `regenerarEnlace` usan la propiedad del script `URL_APP`, y solo si está vacía, la de `ScriptApp`. Nueva función de editor `adminConfigurarUrlApp(url)` (ADMIN, exige `https://script.google.com/macros/s/…/exec`).
5. **Gráfico desde el stock inicial** (`InicioService`, solo `fecha_inicio_datos`):
   - `fecha_inicio_datos` = la **fecha de corte** (`FECHA_CORTE_IMPORTACION`) si está configurada; si no, la **fecha más reciente** de los movimientos de stock inicial (no la más antigua).
   - Los días anteriores van con `stock: null`; ese día, con el stock tras todo el stock inicial.
   - Con los datos de DEV, Inicio dice «sin movimientos desde el 26/11» o la variación real desde esa fecha.
6. **Importar:** «compras» → «recepciones» en los textos de la pantalla (solo textos).

## Aceptación
1. **Prueba nueva** (`test/t042_acceso.test.js`): `apiComprobarSesion` con sesión válida → `ok` y renueva; caducada o inventada → `ok:false`; tras `apiSalir` → `ok:false`.
2. **Prueba nueva:**
   - `apiEntrar` con token inexistente → `ENLACE_NO_VALIDO`;
   - con el PIN mal → `PIN_INCORRECTO` con `intentos_restantes` correcto;
   - tras el límite → `BLOQUEADO` con `hasta`;
   - con el PIN bien tras un fallo → entra y el contador se reinicia como hoy.
3. **Prueba nueva:** tras `regenerarEnlace`, el token viejo da `ENLACE_NO_VALIDO`.
4. **Prueba nueva:** `regenerarEnlace` sin `urlImplementacion` y con `URL_APP` configurada → enlace con esa URL; `adminConfigurarUrlApp` rechaza una URL `/dev` o de otro dominio; sin ser propietario → «reservada al administrador».
5. **Prueba nueva:** stock inicial con movimientos del 23, 24 y 26/11 y fecha de corte 26/11 → `fecha_inicio_datos` = 26/11, días anteriores `null`, entradas 0. Sin fecha de corte → 26/11 (la más reciente).
6. **Prueba nueva (interfaz, extrayendo de `Index.html`):** guarda `sl_sesion` al entrar, la borra al salir y con `ENLACE_NO_VALIDO` borra el token guardado. Ningún `localStorage.setItem` guarda el PIN.
7. Cobertura de T-020: `apiComprobarSesion` registrada en `PERMISOS_API` / lista de funciones públicas.
8. Ninguna prueba existente se debilita. Si alguna esperaba `CREDENCIALES_INVALIDAS`, cambia **solo** ese valor esperado y lístalo en «Dudas». `node test/run_all.js` con 0 fallos, salida en `logs/T-042/tests.txt`.

## Archivos previstos
- `src/Seguridad.js` (motivo del error, `URL_APP`, comprobación de sesión)
- `src/Código.js` (`apiEntrar`, `apiEstablecerPin`, `apiComprobarSesion`, `adminConfigurarUrlApp`)
- `src/Index.html` (sesión guardada, mensajes, aviso del enlace)
- `src/InicioService.js` (solo `fecha_inicio_datos`)
- `src/ui/importar.html` y/o `src/ui/app.html` (solo textos «compras» → «recepciones»)
- `docs/API_PUBLICA.md`, `docs/PUESTA_EN_MARCHA.md` (cómo configurar `URL_APP`)
- `test/t042_acceso.test.js` (nuevo, datos ficticios)
- `docs/tickets/T-042-acceso-sin-friccion.md` (este ticket, primer commit, sin editar), `logs/T-042/*`

**No toques** el motor (`MovementService`, `Libro`, `InventoryEngine`), `importacion/`, `CuadreService.js`. **Nada de datos reales ni de tokens reales** en pruebas o capturas.

## Entrega
`logs/T-042/informe.md`: resumen de 5 líneas, `git status`, `git log --oneline -5` y **«Dudas»** con TODO cambio no pedido.
