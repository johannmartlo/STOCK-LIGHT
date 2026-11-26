# T-029 — Aceptación

Ticket: `docs/tickets/T-029-parte-noche.md`.
Rama: `ticket/T-029-parte-noche`, creada desde `origin/main` `1581b23`.
Primer commit de la rama: `d78536d`, solo el archivo del ticket sin editar.
Resultado de `node test/run_all.js`: **35 suites, 357 pruebas, 0 fallos**. Salida completa en
`logs/T-029/tests.txt`.

## Aceptación 1 — coherencia con obtenerInicio()

- **Prueba:** `test/t029_parte_noche.test.js`, caso 1.
- `ParteService.generarParte()` llama una sola vez a `InicioService.obtenerInicio()`.
- Con datos de ejemplo, el `Total` del texto coincide con `inicio.total` y la cabecera de
  cada variedad coincide con sus cajas.
- La suma de las cajas del desglose de cada variedad es igual al total de esa variedad.
- `datos` devuelve el objeto de `obtenerInicio()` sin recalcular nada.

## Aceptación 2 — formato del texto

- **Prueba:** caso 2.
- Cabecera `STOCK · 26/11 · 21:00` y `Total: 2.522 cajas`, con miles separados por punto.
- Variedades en el orden de `obtenerInicio()` y, dentro, partidas de mayor a menor:
  `I GG Cartón 40x30 686 · I G Cartón 40x30 424 · I M Cartón 40x30 227`.
- Una variedad con 0 cajas no aparece.
- `Sale primero: 10/11 (16 días)`.
- Con pendientes: `Pendientes: 2 ventas sin stock · Importado hasta: C 26/11 · V 26/11`.
- Sin pendientes no aparece el bloque, pero sí `Importado hasta`.
- Sin importaciones: `Importado hasta: C — · V —` (siempre aparece).
- El `html` es una tabla con estilos en línea, fondo claro, sin imágenes externas y con los
  mismos totales, desglose, pendientes e importado.

## Aceptación 3 — nombres legibles

- **Prueba:** caso 3.
- Se carga `nombreLegible` del cliente desde `src/ui/app.html` en un contexto VM, igual que
  hace T-024.
- Los 6 ejemplos de `test/t024_interfaz.test.js` dan el mismo resultado en
  `src/NombresLegibles.js` (servidor) que en el cliente:
  - Volley II M · Madera 50x30
  - Moresco I GG · Cartón 40x30
  - Rosa Granel MMM · EPS 106 9x500
  - Rama Extra G · POOL 60x40
  - Cocktail II MM · Ifco 8x300
  - Pera I GGG → Rosa 500g

## Aceptación 4 — correo y disparador

- **Prueba:** caso 4.
- `enviarParteDiario_` con MailApp simulado envía a
  `uno@ficticio.test,dos@ficticio.test`, asunto `Stock 26/11 · 2.522 cajas`, `body` con el
  texto y `htmlBody` con la tabla.
- Sin destinatarios no llama a MailApp y registra `SIN_DESTINATARIOS` en `LOG_OPERACIONES`.
- Si MailApp lanza, no propaga la excepción y registra `ERROR_ENVIO` con el mensaje.
- `adminInstalarParteDiario` dos veces deja un solo disparador de `enviarParteDiario_`, a la
  hora configurada (22 en la prueba).
- `adminConfigurarParte` guarda destinatarios y hora (`PARTE_DESTINATARIOS` y `PARTE_HORA`).

## Aceptación 5 — API y guardas

- **Prueba:** caso 5.
- `PERMISOS_API.apiObtenerParte === 'CONSULTA'`.
- `apiObtenerParte()` sin sesión lanza exactamente `Acceso no autorizado`.
- `adminConfigurarParte`, `adminInstalarParteDiario` y `adminEnviarParteAhora` sin sesión
  lanzan `Operación reservada al administrador`.
- Las cuatro funciones están clasificadas en `docs/API_PUBLICA.md`.
- `t020_acceso.test.js` sigue en verde (18 pruebas), incluida la cobertura de toda función
  LECTURA/ESCRITURA con guarda y `PERMISOS_API`.

## Aceptación 6 — pruebas

- `node test/run_all.js`: **35 suites, 357 pruebas, 0 fallos**.
- Salida completa en `logs/T-029/tests.txt`.

## Documentación

- `docs/API_PUBLICA.md`: `apiObtenerParte` como LECTURA/CONSULTA y las tres funciones
  `admin*` como ADMIN.
- `docs/PUESTA_EN_MARCHA.md`: paso 8 «Parte de la noche», con configuración de destinatarios
  y hora, instalación del disparador y envío de prueba.
