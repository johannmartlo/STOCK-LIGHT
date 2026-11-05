# T-023 — Aceptación comprobada

Rama: `ticket/T-023-superficie-servidor` (desde `origin/main`, tras el merge de T-001).
Fecha: 2026-11-05.

## Punto 1 — Cada ADMIN rechaza a visitante/otro usuario sin escribir y se ejecuta con el propietario

Comprobado en `test/t023_superficie.test.js`:

- Prueba 1: `exigirPropietario_` acepta al propietario y lanza exactamente
  `Operación reservada al administrador` con un `Session` de visitante (email vacío), con otro
  usuario (`ana@empresa.es`) y con un `Session` vacío.
- Prueba 3: recorre las 13 funciones ADMIN con `Session` de visitante y de otro usuario. En cada
  caso comprueba el mensaje exacto y que el contador de escrituras sigue a cero. El entorno usa
  `blindarEscrituras`, que sustituye `setValues`/`clearContent`/`clear` de todas las hojas por un
  mock que lanza si se llama.
- Prueba 4: con el propietario, las 13 funciones ADMIN se ejecutan y devuelven el resultado
  esperado (init, reconstrucción, ajuste, autodiagnóstico, configuración, ingesta, cambio de
  envase, catálogo histórico, conciliación y prueba aislada).

Funciones ADMIN cubiertas: `initDatabase`, `ejecutarReconstruccionStock`,
`registrarAjusteManual`, `testNucleoAppsScript`, `configurarSpreadsheetId`,
`configurarDriveFolderId`, `apiIngestarMatrizArticuloEnvase`,
`apiCambiarEnvasePredeterminado`, `apiCargarCatalogoHistorico`, `apiConciliarStock`,
`apiEjecutarPruebaAisladaInicializacion`, `setSpreadsheetIdConfig` y `setDriveFolderIdConfig`.
Las 13 empiezan con `exigirPropietario_()` como primera sentencia.

## Punto 2 — El usuario de auditoría lo decide el servidor

Comprobado en `test/t023_superficie.test.js`:

- Prueba 5: con `Session` de `ana@empresa.es`, `apiRegistrarAjusteNegativo(params, 'HACKER')`
  registra el movimiento con `usuario = 'ana@empresa.es'`; el `'HACKER'` del navegador se ignora.
- Prueba 6: con `Session` sin email, el mismo movimiento queda con `usuario = 'SIN_IDENTIFICAR'`.

Además, todas las funciones globales de escritura que reciben `usuario` usan `usuarioActual_()`
(`confirmarDocumentoRevisado`, `confirmarCompraPendiente`, `apiRegistrarAjuste*`,
`apiProcesarEntradaDocumento`, `apiProcesarSalidaDocumento`, `apiEjecutarAjusteOperativo`,
`apiEjecutarCorreccionHistorica`, `apiAnular*`, `apiCorregir*`, `apiDividirEntrada` y
`apiConfirmarDocumentoRevisado`).

## Punto 3 — Toda función global está clasificada y la prueba falla si falta una

- Prueba 7: recorre `src/**/*.js`, extrae las funciones `^function nombre(` cuyo nombre no termina
  en `_` y comprueba que cada una aparece en la tabla de `docs/API_PUBLICA.md`. Resultado:
  88 funciones globales, 88 clasificadas, 0 sin clasificar y 0 obsoletas.
- Prueba 8: alimenta la comprobación con una fuente sintética y verifica que una función nueva sin
  clasificar aparece como pendiente.
- Comprobación manual: se creó temporalmente `src/__temp_t023_cobertura.js` con
  `function funcionGlobalTemporalSinClasificar()`. `node test/t023_superficie.test.js` falló con
  «Expected values to be strictly deep-equal: [ 'funcionGlobalTemporalSinClasificar' ]» (7
  superadas, 1 fallida; salida en `logs/T-023/cobertura-fallo-manual.txt`). El archivo temporal se
  eliminó y la suite volvió a 0 fallos.

## Punto 4 — Ninguna aserción existente cambia

No se modificó ninguna aserción. Solo se inyectó `Session` en las suites existentes que llaman a
una función ADMIN sin propietario simulado:

- `test/fase8_2_apps_script_v8_loading.test.js`: el mock de `Session` del contexto V8 ahora
  incluye `getEffectiveUser` con el mismo email que `getActiveUser`. Es necesario porque la suite
  llama a `apiEjecutarPruebaAisladaInicializacion` (ADMIN).
- `test/persistence_runtime.test.js`: se carga `src/Seguridad.js` en el ámbito global y el test D
  simula al propietario antes de llamar a `setSpreadsheetIdConfig` (ADMIN). Es un cambio de
  preparación, no de aserción.

No hay otras suites no manuales que llamen a funciones ADMIN (revisado con búsqueda sobre
`test/*.test.js`).

## Punto 5 — `node test/run_all.js` con 0 fallos

Ejecutado el 2026-11-05. Salida completa en `logs/T-023/tests.txt`.

- Suites: 17 (16 existentes + `t023_superficie.test.js`).
- Suites superadas: 17.
- Suites fallidas: 0.
- Pruebas superadas: 221 (213 de la línea base + 8 nuevas).
- Resultado final: `TODO EN VERDE (0 fallos)`.

## Archivos tocados

- `src/Seguridad.js` (nuevo)
- `src/Código.js`
- `src/Config.js` (solo el guardia de los dos `set*`)
- `docs/API_PUBLICA.md` (nuevo)
- `test/t023_superficie.test.js` (nuevo)
- `test/fase8_2_apps_script_v8_loading.test.js` (solo mock de `Session`)
- `test/persistence_runtime.test.js` (solo inyección de `Session`/guardia)
- `logs/T-023/*`
