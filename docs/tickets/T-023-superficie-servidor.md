# T-023 — Superficie del servidor: funciones de administración protegidas y usuario decidido en el servidor

Carril: B (operación y seguridad). Rama: `ticket/T-023-superficie-servidor`, creada desde `main` tras el merge de T-001. Sensible: sí (acceso). **No depende de P-1.**
Especificación: 2026-11-04. Decisiones D-014. Problema verificado por el director técnico (`analisis/REVISION_DEUDA_TECNICA_2026-11-04.md`, §2 A3).

## Problema
1. En Apps Script, **cualquier función global cuyo nombre no termine en `_` se puede llamar desde el navegador** con `google.script.run`, y no solo las que usa la interfaz. Todos los archivos `.js` comparten el ámbito global. Hoy quedan expuestas funciones de administración que no deberían estarlo:
   - en `src/Código.js`:
     - `initDatabase`;
     - `ejecutarReconstruccionStock`;
     - `registrarAjusteManual`;
     - `testNucleoAppsScript`;
     - `configurarSpreadsheetId` y `configurarDriveFolderId`, que cambian la hoja en la que escribe el sistema;
     - `apiCargarCatalogoHistorico`;
     - `apiIngestarMatrizArticuloEnvase`;
     - `apiEjecutarPruebaAisladaInicializacion`;
     - `apiConciliarStock`;
     - `apiCambiarEnvasePredeterminado`;
   - en `src/Config.js`: `setSpreadsheetIdConfig` y `setDriveFolderIdConfig`.
2. El usuario de la auditoría lo decide el navegador. La interfaz envía siempre `'OPERADOR'` (`src/Index.html:2160, 2194, 2234, 2306`) y el servidor lo acepta: `const user = usuario || Session…` (`src/Código.js`, en todas las `api*` de escritura). Cualquiera puede firmar como cualquiera, y hoy toda la auditoría dice «OPERADOR».

## Idea de la solución
- Las funciones de administración se ejecutan desde el editor de Apps Script, no desde la app.
- Un guardia comprueba que quien ejecuta es el **propietario** del script. Desde la app, ejecutada como propietario, un visitante con Gmail no se identifica (`getActiveUser()` vacío) y un usuario de otro dominio tiene otro email. En los dos casos, la llamada se rechaza.
- **No se renombra nada**, para no romper llamadas ni pruebas.

## Reglas
1. Nuevo archivo `src/Seguridad.js` con:
   - `exigirPropietario_()`: si `Session.getActiveUser().getEmail()` está vacío o es distinto de `Session.getEffectiveUser().getEmail()`, lanza `Error('Operación reservada al administrador')`.
   - `usuarioActual_()`: devuelve el email de `Session.getActiveUser()` si existe; si no, `'SIN_IDENTIFICAR'`. T-020 lo completará con la identidad por PIN, según P-1.
   - Las dos funciones aceptan un `Session` inyectable para probarlas en Node.
2. Todas las funciones de administración del punto 1 del problema llaman a `exigirPropietario_()` como **primera línea**.
3. Todas las `api*` y funciones globales que escriben datos **ignoran el parámetro `usuario` que llega del navegador** y usan `usuarioActual_()`. Se mantiene el parámetro en la firma para no romper las llamadas de `Index.html`.
4. Nuevo `docs/API_PUBLICA.md`: lista de todas las funciones globales de `src/` con su clasificación:
   - **LECTURA** (puede llamarla la app);
   - **ESCRITURA** (puede llamarla la app; usa `usuarioActual_()`);
   - **ADMIN** (protegida por el guardia);
   - **INTERNA** (función pura sin efectos; queda expuesta pero no hace daño).
5. Nueva prueba que recorre `src/*.js`, extrae todas las funciones globales (`^function nombre(`) que no terminan en `_` y comprueba que cada una está en `docs/API_PUBLICA.md`. Así, una función nueva no puede quedar expuesta sin que nadie la clasifique.

## Aceptación
1. **Prueba nueva:** con un `Session` simulado de visitante (email vacío) y de otro usuario (email distinto), cada función ADMIN lanza «Operación reservada al administrador» **y no escribe nada** (mock de hoja que falla si se llama a `setValues`). Con el propietario, se ejecuta.
2. **Prueba nueva:** `apiRegistrarAjusteNegativo(params, 'HACKER')` con `Session` simulado de `ana@empresa.es` registra el movimiento con usuario `ana@empresa.es`. Sin email, con `SIN_IDENTIFICAR`.
3. **Prueba nueva:** la prueba de la regla 5 pasa, y falla si se añade una función global sin clasificar (compruébalo una vez a mano y anótalo en la aceptación).
4. Ninguna aserción existente cambia. Si una prueba existente llama a una función ADMIN sin propietario simulado, añade el `Session` simulado en esa prueba (no es un cambio de aserción) y lístalo.
5. `node test/run_all.js` con 0 fallos, salida en `logs/T-023/tests.txt`.

## Archivos previstos
- `src/Seguridad.js` (nuevo)
- `src/Código.js`
- `src/Config.js` (solo el guardia en los dos `set*`)
- `docs/API_PUBLICA.md` (nuevo)
- `test/t023_superficie.test.js` (nuevo)
- Suites existentes, solo para inyectar `Session` (aceptación 4)
- `logs/T-023/*`

Si necesitas otro, para y pregunta. **No toques `src/MovementService.js`, `src/InventoryEngine.js` ni `src/Repository.js`** (carril A).

## Fuera de alcance
- Identidad por PIN y lista blanca (T-020, tras P-1).
- Cambiar `Index.html`.
- La configuración de la implementación web («ejecutar como», «quién tiene acceso»), que se documenta en T-011.

## Parar y preguntar si
- Alguna función ADMIN la usa la interfaz (`Index.html`).
- El guardia impide algún flujo que hoy funciona desde la app.
