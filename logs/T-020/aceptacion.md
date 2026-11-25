# T-020 — Aceptación

Ticket: `docs/tickets/T-020-acceso-enlace-pin.md` (carril B).
Rama: `ticket/T-020-acceso-enlace-pin`, creada desde `main` `1443dcc` y re-basada sobre
`main` `abed2b5` (T-007 fusionado) el 2026-11-25, sin conflictos.
Primer commit de la rama: `0785a26` — solo el archivo del ticket, sin editar.
Commit de trabajo: el que sigue a `0785a26` en esta rama (incluye código, pruebas y estos logs).

Resultado de `node test/run_all.js`: **28 suites, 312 pruebas, 0 fallos**. Salida completa en
`logs/T-020/tests.txt`.

## Aceptación 1 — credenciales

- **Prueba nueva:** `test/t020_acceso.test.js`, casos 1.1 a 1.4.
- 1.1: la hoja `USUARIOS` está al final de `SCHEMA_DEFINITIONS`, con las 12 columnas del
  ticket. Tras crear un usuario y fijar su PIN, se recorren todas las hojas y ninguna celda
  contiene el token ni el PIN en claro. Se comprueba que `token_hash = SHA-256(token)` y
  `pin_hash = SHA-256(pin_salt + PIN)`, ambos de 64 caracteres hexadecimales.
- 1.2: el PIN correcto abre sesión; uno incorrecto no; un token inexistente tampoco.
- 1.3: con reloj inyectado, 5 fallos seguidos dejan `intentos_fallidos = 5` y
  `bloqueado_hasta = ahora + 15 min`. A los 14 minutos el PIN correcto sigue rechazado; a los
  16 minutos entra. Antes, 2 fallos + 1 acierto dejan `intentos_fallidos = 0`.
- 1.4: `apiEstablecerPin` también respeta el bloqueo de 15 minutos (regla 7 del ticket).

## Aceptación 2 — sesión

- **Prueba nueva:** `test/t020_acceso.test.js`, casos 2.1 y 2.2.
- 2.1: una sesión sin uso caduca a las 6 horas; una validación a las 5 horas la renueva y
  sigue viva 4 horas después; 6 horas y 1 minuto después de la última renovación devuelve
  `null`. Una sesión inventada también devuelve `null`.
- 2.2: `desactivarUsuario` invalida al momento la sesión abierta (y marca `activo = false`);
  `regenerarEnlace` también invalida la sesión abierta, invalida el token anterior y permite
  fijar un PIN nuevo con el token nuevo.

## Aceptación 3 — despachador y roles

- **Prueba nueva:** `test/t020_acceso.test.js`, caso 3.1.
- CONSULTA puede llamar a `apiGetMaestroArticulos` (LECTURA) y recibe `PERMISO_DENEGADO` al
  intentar `apiRegistrarAjustePositivo` (ESCRITURA).
- ENCARGADO puede ejecutar `apiRegistrarAjustePositivo` y recibe `PERMISO_DENEGADO` al
  intentar `apiCrearUsuario`.
- ADMIN puede listar y crear usuarios; también pasa las comprobaciones de lectura/escritura.
- `initDatabase` (nombre fuera de `PERMISOS_API`) devuelve `API_NO_PERMITIDA`; `constructor`
  (propiedad heredada del prototipo) también se rechaza.
- Una sesión inválida devuelve exactamente `{ success: false, errorCode: 'SESION_INVALIDA' }`.
- `apiSalir` borra la sesión y la siguiente llamada devuelve `SESION_INVALIDA`.

## Aceptación 4 — sin atajos

- **Prueba nueva:** `test/t020_acceso.test.js`, caso 4.1.
- Se recorren todas las entradas de `PERMISOS_API` clasificadas LECTURA o ESCRITURA en
  `docs/API_PUBLICA.md` —empiecen o no por `api` (`revisarDocumentoHispatec`,
  `confirmarDocumentoRevisado`, `confirmarCompraPendiente`), incluidas las dos API de
  importación que llegaron con T-007— y se llaman **directamente**, sin `apiLlamar`.
- Todas lanzan exactamente `Acceso no autorizado`. Se comparan las hojas antes y después y no
  hay ninguna escritura.

## Aceptación 5 — cobertura

- **Prueba nueva:** `test/t020_acceso.test.js`, casos 5.1 a 5.4.
- 5.1 recorre `src/*.js`, extrae todas las funciones globales, lee las clasificaciones de
  `docs/API_PUBLICA.md` y comprueba:
  - toda función global LECTURA o ESCRITURA, empiece o no por `api`, empieza por
    `exigirSesionApi_();`, salvo las dos excepciones de la prueba 5.3;
  - toda función global LECTURA o ESCRITURA está en `PERMISOS_API`;
  - toda entrada de `PERMISOS_API` existe como función.
- 5.2 caso sintético: una `api*` LECTURA sin guarda y sin permiso produce dos problemas; una
  función que no empieza por `api` y también es LECTURA sin guarda ni permiso produce otros
  dos; las que tienen guarda y permiso no producen ninguno. Así se demuestra que la prueba
  falla si aparece una función nueva sin guarda o sin permiso.
- 5.3 fija las únicas excepciones: `doGet` (entrada HTTP que sirve la pantalla de entrada) y
  `copiaDiariaProgramada` (la ejecuta el disparador diario sin usuario). Ambas deben funcionar
  sin sesión, así que no llevan guarda ni están en `PERMISOS_API`. La prueba impide que la
  lista de excepciones crezca sin revisión.
- 5.4 comprueba el rol mínimo de las entradas nuevas: `revisarDocumentoHispatec` y
  `apiPrevisualizarImportacionCsv` → CONSULTA; `apiConfirmarImportacionCsv` → ENCARGADO.
- **Comprobación manual de que la prueba falla:** se quitó temporalmente la guarda de
  `revisarDocumentoHispatec` y `node test/t020_acceso.test.js` dio **2 fallidas** (4.1 y 5.1).
  El mensaje de 5.1 fue
  `revisarDocumentoHispatec: clasificada LECTURA pero no empieza por exigirSesionApi_();`
  y 4.1 falló con `revisarDocumentoHispatec debe exigir sesión`. Se restauró la guarda y la
  suite volvió a 0 fallos.
- La prueba 7 de `t023_superficie` sigue exigiendo que toda función global no privada esté
  clasificada en `docs/API_PUBLICA.md`.

## Aceptación 6 — auditoría

- **Prueba nueva:** `test/t020_acceso.test.js`, caso 6.1.
- Se crea la usuaria «Ana» (ENCARGADO), se abre sesión y se llama a
  `apiLlamar(sesion, 'apiRegistrarAjustePositivo', [paramsConUsuarioOtro, 'OTRO_USUARIO'])`.
- El movimiento queda en MOVIMIENTOS con `usuario = 'Ana'`; el usuario enviado por el cliente
  se ignora.

## Aceptación 7 — pruebas existentes adaptadas

Se adaptaron **solo** para envolver las llamadas directas a `api*` en
`conContextoDePrueba_(usuario, rol, fn)`. No se cambió ninguna aserción.

- `test/t023_superficie.test.js` (pruebas 5 y 6): `apiRegistrarAjusteNegativo` se envuelve con
  `conContextoDePrueba_(null, 'ENCARGADO', ...)`. Se pasa `null` como usuario para conservar
  exactamente lo que comprobaban: que la auditoría usa el email de `Session` cuando no hay
  nombre de contexto (`ana@empresa.es` / `SIN_IDENTIFICAR`), no el usuario que envía el
  navegador.
- `test/t005_catalogo.test.js` (pruebas 3 y 5): `apiUpsertExcepcionCatalogo`,
  `apiUpsertReglaClasificacion`, `apiUpsertGrupoComercial` y `apiUpsertMatrizArticuloEnvase`
  se envuelven con `conContextoDePrueba_('Prueba', 'ADMIN', ...)`. Las aserciones sobre
  excepciones, validación de atributos y error de obsoletos no cambian.
- `test/fase7_frontend_ux_integration.test.js` (pruebas 11 a 16): las llamadas a
  `apiGetMaestroArticulos`, `apiGetMaestroEnvases`, `apiObtenerStockVisualResumen`,
  `apiObtenerDetallePartidas` y `apiSubirYAnalizarPdf` se envuelven con
  `conContextoDePrueba_('Prueba', 'CONSULTA', ...)`. Las aserciones de datos y de rechazo de
  payloads no cambian.
- `test/t018_copias.test.js` y `test/t004_clave_nombre.test.js`: revisadas; **no llaman a
  ninguna `api*` directamente** (t018 usa las funciones ADMIN de copias y t004 el motor de
  claves). No necesitaron cambios.
- `test/fase8_2_apps_script_v8_loading.test.js`: llama a
  `apiEjecutarPruebaAisladaInicializacion`, que es ADMIN y sigue protegida por
  `exigirPropietario_`; no necesita contexto de sesión.
- `test/t007_importacion_lote.test.js` (prueba 13): es de T-007 y llegó a `main` durante el
  rebase. Sus dos llamadas directas a `apiPrevisualizarImportacionCsv` y
  `apiConfirmarImportacionCsv` se envuelven con `conContextoDePrueba_('PruebaT007', ...)`,
  CONSULTA y ENCARGADO respectivamente. No se cambia ninguna aserción.

## Aceptación 8 — prueba manual en móvil (pendiente del responsable y del director técnico)

Preparada para ejecutarse en la implementación de prueba. No se ha ejecutado desde el entorno
del agente (no hay despliegue ni móvil real).

1. Desplegar la web app con la configuración de `src/appsscript.json`:
   `executeAs: USER_DEPLOYING`, `access: ANYONE`.
2. En el editor de Apps Script, ejecutar `initDatabase()` si la hoja es nueva.
3. En el editor, ejecutar `crearUsuario('Nombre del responsable', 'ADMIN')`. Copiar el
   `enlace` devuelto (solo se muestra esa vez).
4. Abrir el enlace en un **móvil real**. Anotar marca y modelo: ______________________.
5. Comprobar que aparece la pantalla «Elige un PIN de 4 a 6 cifras», crear el PIN y entrar.
6. Comprobar que la cabecera muestra el nombre y el botón «Salir».
7. Pulsar «Salir», volver a abrir la app y entrar con el PIN.
8. En el editor, ejecutar `listarUsuarios()` y localizar el `id_usuario`.
9. Ejecutar `desactivarUsuario('USR-...')` y comprobar en el móvil que ya no entra.
10. (Opcional) `regenerarEnlace('USR-...')`: el enlace anterior deja de valer y el nuevo pide
    crear PIN otra vez.

Resultado y fecha de la prueba manual: ______________________.

## Aceptación 9 — documentación y pruebas

- `docs/API_PUBLICA.md`: nueva categoría **ENTRADA**; clasificadas `apiLlamar`, `apiEntrar`,
  `apiEstablecerPin`, `apiSalir`, las cuatro funciones de usuarios de la app, las cuatro del
  editor y todas las `api*` existentes. Se actualizó la explicación de ADMIN y la nota de
  `PERMISOS_API`. En la revisión del 2026-11-25 se añadió que `revisarDocumentoHispatec` exige
  sesión y que `doGet` y `copiaDiariaProgramada` son las excepciones sin sesión.
- `docs/SEGURIDAD.md`: nuevo, con alta, enlace, PIN, roles, regenerar, desactivar, móvil
  perdido y reglas técnicas.
- `node test/run_all.js`: 28 suites, 312 pruebas, **0 fallos**. Salida en
  `logs/T-020/tests.txt`.

## Capturas (D-014)

Con datos ficticios del modo demo local, a 360 px y 1280 px:

- `logs/T-020/entrada-360.png` y `logs/T-020/entrada-1280.png`: pantalla de entrada, creación
  de PIN, teclado de 56 px de alto.
- `logs/T-020/app-360.png` y `logs/T-020/app-1280.png`: cabecera con nombre y «Salir», sin
  desplazamiento horizontal a 360 px.

## Cambios no pedidos expresamente (para «Dudas»)

1. Se añadió `exigirSesionApi_();` también a `confirmarDocumentoRevisado` y
   `confirmarCompraPendiente` (no son `api*`, pero son ESCRITURA expuestas y la primera la usa
   la interfaz). Sin la guarda, el despachador único quedaría sorteable.
2. Las funciones obsoletas `apiGetGruposComerciales`, `apiUpsertGrupoComercial`,
   `apiGetMatrizArticuloEnvase` y `apiUpsertMatrizArticuloEnvase` pasaron de la clasificación
   `OBSOLETA` a LECTURA/ESCRITURA en `docs/API_PUBLICA.md`, con guarda y entrada en
   `PERMISOS_API`. Es necesario para que la vista de Maestros siga funcionando a través del
   despachador y para que no queden llamadas directas sin sesión.
3. `apiSalir` se añadió a `PERMISOS_API` con rol CONSULTA para que el cliente pueda cerrar
   sesión a través de `apiLlamar` (el despachador es la única vía de la interfaz).
4. La sesión guarda `expira_en` además de `{ id_usuario, version_credenciales }` en el valor
   de `CacheService`, para que la caducidad de 6 horas se pueda comprobar con reloj inyectado
   sin depender solo del TTL del cache.
5. `doGet` pasa también `tienePin` a la plantilla (además de `k`) para que el cliente sepa si
   debe mostrar «crear PIN» o el teclado de entrada. Se lee desde atributos `data-*` para no
   construir JavaScript con un valor de la URL.
6. `PERMISOS_API` exige rol ADMIN para las escrituras de configuración
   (`apiUpsertReglaClasificacion`, `apiUpsertExcepcionCatalogo`), aunque en
   `docs/API_PUBLICA.md` figuren como ESCRITURA. Se aplica D-032 («configuración y usuarios,
   ADMIN»); la tabla de permisos es la autoridad del rol.
7. En móvil (<= 900 px) se oculta `#lblUltimaActualizacion` y se limita el ancho del nombre
   para que la cabecera con nombre + «Salir» quepa a 360 px sin desplazamiento horizontal.
8. `crearUsuario` devuelve un objeto `{ id_usuario, nombre, rol, enlace }`, no una cadena
   suelta, para que el editor pueda identificar al usuario sin volver a listar.
9. `apiLlamar` admite que la función destino sea `confirmarDocumentoRevisado` o
   `confirmarCompraPendiente`, que no empiezan por `api`, porque la primera la llama la
   interfaz y ambas son ESCRITURA.
10. En la prueba de cobertura se excluyen expresamente `doGet` y `copiaDiariaProgramada`,
    aunque `docs/API_PUBLICA.md` las clasifica como LECTURA y ESCRITURA: `doGet` sirve la
    pantalla de entrada y `copiaDiariaProgramada` la ejecuta un disparador sin usuario, así
    que no pueden exigir sesión ni estar en `PERMISOS_API`. La regla literal «toda función
    LECTURA/ESCRITURA» rompería el acceso a la app y la copia diaria. La lista de excepciones
    está fijada en la prueba 5.3 y documentada en `docs/API_PUBLICA.md`.
11. Se adaptó `test/t007_importacion_lote.test.js` (prueba 13), archivo del carril C que llegó
    a `main` con T-007, para envolver sus dos llamadas directas a las API de importación en
    `conContextoDePrueba_`. Sin ese cambio, las guardas nuevas hacían fallar la suite. No se
    cambió ninguna aserción.
12. Se añadieron a `docs/API_PUBLICA.md` las notas de `doGet` y `copiaDiariaProgramada` y se
    ajustó el párrafo general para dejar escrita la excepción de sesión.
