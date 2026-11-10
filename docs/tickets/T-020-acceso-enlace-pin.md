# T-020 — Acceso: usuarios, enlace personal, PIN, roles y despachador único

Carril: **B (operación y seguridad)**, con permiso expreso para los archivos indicados de otros carriles. Rama: `ticket/T-020-acceso-enlace-pin`, creada desde `main` **después del merge de T-005**. Sensible: **sí** (seguridad).
Especificación: **nueva versión, 2026-11-05**, con la decisión D-032 (resuelve P-1). Entra en el MVP. Decisiones D-022, D-024 y D-032; se apoya en T-023.

## Contexto (D-032)
- No hay Google Workspace. Unas 5 personas, aunque en la práctica el responsable lo hará casi todo.
- La web app **se ejecuta como el propietario** y la hoja **no se comparte**.
- Con cuentas Gmail personales, `Session.getActiveUser()` llega vacío en la web app, así que la identidad la gestiona la app: **enlace personal + PIN**.
- Roles: `CONSULTA` (solo lectura), `ENCARGADO` (lectura y operaciones) y `ADMIN` (además, configuración y usuarios).

## Lo que ya existe (verificado en 5d8328a; no lo rehagas)
- `src/Seguridad.js` (T-023): `exigirPropietario_(session)` para las funciones del editor y `usuarioActual_(session)`, que hoy devuelve el email de la sesión o `SIN_IDENTIFICAR`.
- `docs/API_PUBLICA.md` clasifica cada función global en LECTURA, ESCRITURA, ADMIN o INTERNA. `t023_superficie.test.js` (prueba 7) exige que estén todas.
- `doGet` en `src/Código.js` sirve `Index`.
- **`src/Index.html` hace todas sus llamadas al servidor desde un único puente**, `api.call(fnName, ...args)` (`google.script.run[fnName](...args)`). El cambio de cliente se limita a ese puente y a una pantalla de entrada.
- `src/appsscript.json` **no tiene** sección `webapp`.

## Reglas
1. **Hoja `USUARIOS`** en `SCHEMA_DEFINITIONS` (permiso expreso en `src/Repository.js`; **añádela al final, después de `LOG_OPERACIONES`**), con las columnas:
   `id_usuario, nombre, rol (CONSULTA|ENCARGADO|ADMIN), activo, token_hash, pin_hash, pin_salt, intentos_fallidos, bloqueado_hasta, version_credenciales, fecha_alta, ultimo_acceso`.
   - **Nunca** se guardan el token ni el PIN en claro.
   - Los ids se crean con `nuevoId('USR')`.
2. **Lógica pura en `src/Seguridad.js`**, probada en Node con reloj, aleatoriedad y almacenamiento inyectables.
   - **Token del enlace:**
     - al menos 128 bits aleatorios (por ejemplo, dos `Utilities.getUuid()` sin guiones);
     - se guarda solo su SHA-256;
     - al regenerarlo, cambia el hash y sube `version_credenciales`, lo que invalida las sesiones anteriores.
   - **PIN:**
     - de 4 a 6 cifras;
     - se guarda `SHA-256(salt + pin)`, con `pin_salt` aleatorio por usuario;
     - 5 intentos fallidos seguidos dejan `bloqueado_hasta` = ahora + 15 minutos;
     - un acierto pone los intentos a 0.
   - **Sesión:**
     - un identificador aleatorio guardado en `CacheService.getScriptCache()` con `{ id_usuario, version_credenciales }`;
     - dura 6 horas y se renueva con el uso;
     - en cada llamada se comprueba que el usuario sigue activo y que su `version_credenciales` no ha cambiado.
3. **Despachador único: `apiLlamar(sesion, nombreApi, args)`.** Es la **única** función que llama la interfaz.
   - Comprueba la sesión. Si no vale, devuelve `{ success: false, errorCode: 'SESION_INVALIDA' }`.
   - Comprueba que `nombreApi` está en la tabla `PERMISOS_API` (en `Seguridad.js`: nombre → rol mínimo) y que el rol del usuario llega:
     - CONSULTA < ENCARGADO < ADMIN;
     - las de LECTURA piden CONSULTA; las de ESCRITURA, ENCARGADO; las de configuración y usuarios, ADMIN.
   - Fija el **contexto de usuario** de la ejecución, llama a la función y limpia el contexto en un `finally`.
   - Un nombre que no está en la tabla se rechaza.
4. **Guarda en cada `api*`:** toda función `api*` de LECTURA o ESCRITURA empieza con `exigirSesionApi_();`.
   - Esa función lanza «Acceso no autorizado» si no hay contexto, es decir, si se ha llamado directamente desde el navegador sin pasar por `apiLlamar`.
   - Las funciones ADMIN del editor siguen con `exigirPropietario_`.
5. **`usuarioActual_()`** devuelve, por este orden: el **nombre** del usuario del contexto, el email de la sesión de Apps Script (propietario en el editor) o `SIN_IDENTIFICAR`. La auditoría de movimientos queda firmada con el nombre.
6. **Gestión de usuarios:**
   - **Funciones del editor** (`exigirPropietario_`, tipo ADMIN):
     - `crearUsuario(nombre, rol)`: devuelve el **enlace personal**, URL de la implementación + `?k=<token>`, que se muestra una sola vez;
     - `regenerarEnlace(idUsuario)`;
     - `desactivarUsuario(idUsuario)`;
     - `listarUsuarios()`: sin hashes.

     La primera cuenta de ADMIN se crea así.
   - **Versiones para la app**, con rol ADMIN en `PERMISOS_API`: `apiListarUsuarios`, `apiCrearUsuario`, `apiRegenerarEnlace` y `apiDesactivarUsuario`.
7. **Entrada en la app:**
   - `apiEntrar(token, pin)` y `apiEstablecerPin(token, pin)` son las **únicas** funciones públicas sin sesión. Están limitadas por los bloqueos de la regla 2 y devuelven `{ sesion, nombre, rol }` o un error genérico, sin revelar si falló el token o el PIN;
   - `apiEstablecerPin` solo funciona si el usuario aún no tiene PIN, o tras regenerar el enlace;
   - `apiSalir(sesion)` borra la sesión.
8. **`doGet(e)`:**
   - pasa `e.parameter.k`, si existe, a la plantilla;
   - mantiene el viewport y el título actuales;
   - en el cliente, el token se guarda en `localStorage` (con try/catch) y se quita de la URL con `google.script.history.replace`.
9. **`src/appsscript.json`:** `"webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE" }`. Quien entra necesita al menos estar conectado con una cuenta de Google; la identidad real la da el enlace con PIN.
10. **Cliente** (`src/Index.html`, permiso expreso y mínimo):
    - `api.call(fnName, ...args)` pasa a llamar a `apiLlamar(sesion, fnName, args)`;
    - si recibe `SESION_INVALIDA`, muestra la pantalla de entrada;
    - **pantalla de entrada:** sin token, «Abre tu enlace personal»; con token y sin PIN, crear PIN; con token y PIN, teclado numérico grande para el PIN. Áreas de pulsación de al menos 44 px (D-014);
    - en la cabecera, nombre del usuario y botón «Salir»;
    - el modo demo local (`localApiBridge`) sigue funcionando.

    No se rediseña nada más.
11. **Clasificación:**
    - `docs/API_PUBLICA.md`: clasifica las funciones nuevas. `apiLlamar`, `apiEntrar`, `apiEstablecerPin` y `apiSalir` van en una categoría nueva, **ENTRADA**, con su explicación;
    - `docs/SEGURIDAD.md` (nuevo): resumen para el responsable de cómo dar de alta, regenerar y desactivar, qué hacer si se pierde un móvil, y que el enlace debe guardarse en la pantalla de inicio del móvil.

## Aceptación
1. **Prueba nueva (credenciales):**
   - el token y el PIN no aparecen en claro en ninguna hoja;
   - un PIN correcto abre sesión y uno incorrecto no;
   - 5 fallos bloquean 15 minutos (con reloj inyectado);
   - un acierto pone los intentos a 0.
2. **Prueba nueva (sesión):**
   - caduca a las 6 horas sin uso;
   - desactivar al usuario o regenerar su enlace invalida al momento sus sesiones abiertas.
3. **Prueba nueva (despachador y roles):**
   - CONSULTA puede llamar a una función de LECTURA, pero no a una de ESCRITURA;
   - ENCARGADO puede llamar a ESCRITURA, pero no a `apiCrearUsuario`;
   - ADMIN puede llamar a todo;
   - un nombre fuera de `PERMISOS_API` se rechaza;
   - una sesión inválida devuelve `SESION_INVALIDA`.
4. **Prueba nueva (sin atajos):** llamar a cualquier `api*` de LECTURA o ESCRITURA **directamente**, sin `apiLlamar`, lanza «Acceso no autorizado» y no escribe nada.
5. **Prueba nueva (cobertura).** Se recorre `src/*.js`:
   - toda función `api*` clasificada como LECTURA o ESCRITURA empieza con `exigirSesionApi_();` y está en `PERMISOS_API`;
   - toda entrada de `PERMISOS_API` existe;
   - así, una `api*` nueva sin guarda o sin permiso hace fallar la prueba. Compruébalo una vez a mano y anótalo.
6. **Prueba nueva (auditoría):** un ajuste hecho mediante `apiLlamar` con la sesión de «Ana» queda en MOVIMIENTOS con usuario «Ana», aunque el cliente envíe otro usuario en los parámetros.
7. **Pruebas existentes** que llaman a `api*` directamente (por ejemplo, `t023_superficie`, `t018_copias`, `t004_clave_nombre`, `fase7_frontend_ux_integration`): se adaptan para llamar dentro de un contexto de prueba (`conContextoDePrueba_(usuario, rol, fn)` en `Seguridad.js`, tipo INTERNA), **sin cambiar lo que comprueban**. Cada una se lista en `aceptacion.md`.
8. Prueba manual en la implementación de prueba, anotada en `logs/T-020/aceptacion.md`:
   - crear un ADMIN desde el editor;
   - abrir el enlace en un móvil real (marca y modelo);
   - fijar el PIN, salir y volver a entrar con PIN;
   - desactivar y comprobar que ya no entra.
9. `docs/API_PUBLICA.md` y `docs/SEGURIDAD.md` al día. `node test/run_all.js` con 0 fallos, salida en `logs/T-020/tests.txt`.

## Archivos previstos
- `src/Seguridad.js`
- `src/Código.js` (despachador, guardas, `doGet`, gestión de usuarios)
- `src/appsscript.json`
- `docs/API_PUBLICA.md`
- `docs/SEGURIDAD.md` (nuevo)
- `src/Repository.js` (**solo** la hoja USUARIOS al final de `SCHEMA_DEFINITIONS` y su lectura y escritura; permiso expreso, carril A)
- `src/Index.html` (**solo** la regla 10; permiso expreso, carril D)
- `test/t020_acceso.test.js` (nuevo)
- Pruebas existentes de la aceptación 7 (solo para envolverlas en el contexto de prueba)
- `docs/tickets/T-020-acceso-enlace-pin.md` (este ticket, primer commit, sin editar)
- `logs/T-020/*`

Si necesitas otro, para y pregunta. **No toques** `src/MovementService.js`, `src/Libro.js`, `src/Catalogo*.js` ni `src/importacion/*`.

## Trabajo en paralelo
Los carriles A (T-009) y C (T-007) añaden funciones `api*` nuevas en `src/Código.js` al mismo tiempo.
- Si alguna llega a `main` antes que este ticket, al rebasar **añádele la guarda y su entrada en `PERMISOS_API`**: la aceptación 5 lo exige.
- Si este ticket llega antes, serán ellos quienes las añadan al rebasar.

## Fuera de alcance
- Instalación guiada y stock inicial (T-011).
- Iniciar sesión con Google (descartado en D-032).
- Pantallas de trabajo y la pantalla de gestión de usuarios: ahora se usa la API desde el editor; la pantalla llega con T-012.

## Parar y preguntar si
- `google.script.history` o `localStorage` no funcionan en el móvil de prueba: describe el síntoma y no improvises otra solución.
- Alguna `api*` no encaja en LECTURA o ESCRITURA.
- **Cualquier cambio no descrito en este ticket, aunque sea en un archivo previsto, se lista en «Dudas».**
