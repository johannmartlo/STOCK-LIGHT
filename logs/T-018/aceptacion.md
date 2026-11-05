# T-018 — Aceptación comprobada

Rama: `ticket/T-018-copias-seguridad` (desde `origin/main` con T-023 fusionado).
Fecha: 2026-11-05.

## Punto 1 — Retención de copias DIARIA

`test/t018_copias.test.js`, prueba 1: con 35 copias `DIARIA` y 3 `MANUAL`,
`seleccionarCopiasABorrar(lista, 30)` devuelve exactamente las 5 `DIARIA` más antiguas
(`DIARIA_0` a `DIARIA_4`), ninguna `MANUAL`, y no muta la lista de entrada.

La prueba de integración 8 crea 30 copias `DIARIA` previas y una nueva: tras la copia, la más
antigua (`VIEJA_0`) queda con `setTrashed(true)` y la carpeta conserva 31 archivos (30 vivas + la
nueva, antes de contar la papelera).

## Punto 2 — Nombre de la copia en Europe/Madrid

`test/t018_copias.test.js`, prueba 2:
`nombreCopiaSeguridad(new Date('2026-11-05T22:00:00Z'), 'DIARIA')` devuelve exactamente
`STOCK-LIGHT_COPIA_2026-11-05_2300_DIARIA`.

## Punto 3 — Disparador diario idempotente

`test/t018_copias.test.js`, prueba 3: con mocks de `DriveApp`, `ScriptApp` y
`PropertiesService`, `adminInstalarCopiaDiaria()` llamado dos veces deja un solo disparador, con
handler `copiaDiariaProgramada` a las 23:00.

## Punto 4 — Guardia de T-023 en las funciones admin*

`test/t018_copias.test.js`, prueba 4: con `Session` de visitante (email vacío),
`adminCrearCopiaManual`, `adminInstalarCopiaDiaria` y `adminConfigurarCarpetaCopias` lanzan
exactamente `Operación reservada al administrador` y no llegan a crear copias ni disparadores.

## Punto 5 — Clasificación en docs/API_PUBLICA.md

`test/t018_copias.test.js`, prueba 9, comprueba que el documento incluye las seis funciones
nuevas. La prueba 7 de `test/t023_superficie.test.js` vuelve a recorrer todo `src/**/*.js` y
confirma que no queda ninguna función global sin clasificar.

Clasificaciones añadidas:

- ADMIN: `adminCrearCopiaManual`, `adminInstalarCopiaDiaria`, `adminConfigurarCarpetaCopias`.
- ESCRITURA: `copiaDiariaProgramada` (punto de entrada del disparador; no la usa la interfaz).
- INTERNA: `nombreCopiaSeguridad`, `seleccionarCopiasABorrar`.

Las funciones privadas (`crearCopiaSeguridad_`, `instalarCopiaDiaria_`,
`configurarCarpetaCopias_`, `registrarErrorCopia_` y auxiliares terminadas en `_`) no se exponen
al navegador y no requieren clasificación.

## Punto 6 — `node test/run_all.js` con 0 fallos

Ejecutado el 2026-11-05. Salida completa en `logs/T-018/tests.txt`.

- Suites: 20 (19 existentes + `t018_copias.test.js`).
- Suites superadas: 20.
- Suites fallidas: 0.
- Pruebas superadas: 244 (235 de la línea base + 9 nuevas).
- Resultado final: `TODO EN VERDE (0 fallos)`.

## Punto 7 — Comprobación manual en DEV

Pendiente de la comprobación del responsable: crear una copia manual, instalar la copia diaria y
verificar al día siguiente que se ha creado. El código deja el disparador a las 23:00 de
Europe/Madrid y la carpeta configurada en `BACKUP_FOLDER_ID`.

## Archivos tocados

- `src/BackupService.js` (nuevo)
- `src/Código.js` (solo las tres funciones `admin*`, `copiaDiariaProgramada`, su carga y exports)
- `docs/API_PUBLICA.md`
- `docs/RESTAURAR_COPIA.md` (nuevo)
- `test/t018_copias.test.js` (nuevo)
- `logs/T-018/*`

No se ha tocado `src/appsscript.json`: los permisos de Drive y de disparadores los deduce Apps
Script del código. No se ha tocado ningún archivo del carril A.
