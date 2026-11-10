# Seguridad de acceso — STOCK-LIGHT

Guía para el responsable (T-020, decisión D-032). No hay Google Workspace: la web app se
ejecuta como el propietario y la hoja de cálculo **no se comparte** con nadie. La identidad la
gestiona la propia app con un **enlace personal** y un **PIN**.

## Roles

| Rol | Puede |
| :--- | :--- |
| `CONSULTA` | Ver stock, catálogo, incidencias y log. No modifica nada. |
| `ENCARGADO` | Todo lo de CONSULTA y las operaciones: entradas, salidas, ajustes, correcciones, reprocesos. |
| `ADMIN` | Todo lo anterior y, además, usuarios y configuración. |

El rol mínimo de cada llamada está en `PERMISOS_API` (`src/Seguridad.js`). Se comprueba en el
servidor en cada petición; el navegador no decide permisos.

## Dar de alta a una persona

1. Abre el editor de Apps Script del proyecto.
2. Ejecuta `crearUsuario('Nombre de la persona', 'CONSULTA' | 'ENCARGADO' | 'ADMIN')`.
3. La función devuelve un objeto con `enlace`. **Cópialo y envíalo por un canal privado**: el
   token solo se muestra esa vez. En la hoja `USUARIOS` queda únicamente su hash SHA-256.
4. La persona abre el enlace en el móvil, elige un PIN de 4 a 6 cifras y entra.
5. Que guarde la app en la pantalla de inicio del móvil. El enlace ya queda recordado en ese
   dispositivo; las siguientes veces solo pedirá el PIN.

La primera cuenta `ADMIN` se crea también así, desde el editor. No hay usuario por defecto.

## Entrar y salir

- Cada persona debe abrir **su** enlace. Si abre el de otra persona, entra como esa persona.
- El PIN se pide al abrir la app y tras cerrar sesión con «Salir».
- La sesión dura 6 horas y se renueva con el uso. Pasado ese tiempo sin actividad, hay que
  volver a introducir el PIN.
- Tras 5 intentos fallidos seguidos, la cuenta queda bloqueada 15 minutos. Un acierto pone el
  contador a cero.

## Regenerar el enlace

Útil si alguien pierde el móvil, cambia de teléfono o cree que su enlace se ha filtrado.

1. Ejecuta `listarUsuarios()` para ver los `id_usuario` (no muestra hashes).
2. Ejecuta `regenerarEnlace('USR-...')`.
3. Envía el nuevo enlace por un canal privado. El anterior deja de funcionar al momento y se
   borra el PIN: la persona tendrá que crear uno nuevo.
4. Las sesiones abiertas de esa persona también quedan invalidadas.

## Desactivar a una persona

1. Ejecuta `desactivarUsuario('USR-...')`.
2. Su enlace y sus sesiones dejan de valer inmediatamente. La fila se conserva en `USUARIOS`
   con `activo = FALSE` para no perder la trazabilidad.

No hay función para reactivar; si vuelve a hacer falta, se crea una cuenta nueva.

## Si se pierde un móvil

1. Desactiva a esa persona o regenera su enlace **cuanto antes**.
2. Comprueba en `LOG_OPERACIONES` y en `MOVIMIENTOS` la actividad reciente.
3. Si el móvil tenía la sesión abierta, la desactivación la invalida en la siguiente llamada.

## Reglas técnicas que no se deben romper

- La hoja de cálculo no se comparte con los usuarios: solo la abre la app con la cuenta del
  propietario. Nadie debe poder editar `USUARIOS` a mano.
- En `USUARIOS` nunca se guarda el token ni el PIN en claro: solo `token_hash`,
  `pin_hash` y `pin_salt`.
- El token se guarda en el `localStorage` del móvil y se quita de la barra de direcciones al
  abrir la app. No se debe copiar el enlace a sitios públicos ni a chats grupales.
- `src/appsscript.json` declara la web app como `executeAs: USER_DEPLOYING` y
  `access: ANYONE`. Quien abra la URL necesita una cuenta de Google, pero la identidad real
  la da el enlace con PIN.
- No se usa `Session.getActiveUser()` para identificar a los usuarios de la web app: con
  cuentas Gmail personales llega vacío. Solo se usa como respaldo en el editor.
