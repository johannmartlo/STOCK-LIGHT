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
`STOCK-LIGHT_COPIA_2026-11-05_2300_DIARIA`. La prueba 2b comprueba `existeCopiaDiariaDeHoy` con
la fecha del nombre y con `Date` en Europe/Madrid, y que una copia `MANUAL` del mismo día no cuenta.

## Punto 3 — Disparador diario idempotente

`test/t018_copias.test.js`, prueba 3: con mocks de `DriveApp`, `ScriptApp` y
`PropertiesService`, `adminInstalarCopiaDiaria()` llamado dos veces deja un solo disparador, con
handler `copiaDiariaProgramada` a las 23:00.

## Punto 4 — Guardia de T-023 en las funciones admin*

`test/t018_copias.test.js`, prueba 4: con `Session` de visitante (email vacío),
`adminCrearCopiaManual`, `adminInstalarCopiaDiaria` y `adminConfigurarCarpetaCopias` lanzan
exactamente `Operación reservada al administrador` y no llegan a crear copias ni disparadores.

## Punto 5 — Clasificación en docs/API_PUBLICA.md

`test/t018_copias.test.js`, prueba 9, comprueba que el documento incluye las siete funciones
nuevas. La prueba 7 de `test/t023_superficie.test.js` vuelve a recorrer todo `src/**/*.js` y
confirma que no queda ninguna función global sin clasificar.

Clasificaciones añadidas:

- ADMIN: `adminCrearCopiaManual`, `adminInstalarCopiaDiaria`, `adminConfigurarCarpetaCopias`.
- ESCRITURA: `copiaDiariaProgramada` (punto de entrada del disparador; no la usa la interfaz).
- INTERNA: `nombreCopiaSeguridad`, `existeCopiaDiariaDeHoy`, `seleccionarCopiasABorrar`.

Las funciones privadas (`crearCopiaSeguridad_`, `instalarCopiaDiaria_`,
`configurarCarpetaCopias_`, `registrarErrorCopia_` y auxiliares terminadas en `_`) no se exponen
al navegador y no requieren clasificación.

## Punto 6 — `node test/run_all.js` con 0 fallos

Ejecutado el 2026-11-05 tras rebasar sobre `origin/main` con T-022 y T-006B. Salida completa en
`logs/T-018/tests.txt`.

- Suites: 23 (22 existentes + `t018_copias.test.js`).
- Suites superadas: 23.
- Suites fallidas: 0.
- Pruebas superadas: 258 (246 de la línea base + 12 de T-018).
- Resultado final: `TODO EN VERDE (0 fallos)`.

## Punto 7 — Comprobación manual en DEV

Pendiente de la comprobación del responsable: crear una copia manual, instalar la copia diaria y
verificar al día siguiente que se ha creado. El código deja el disparador a las 23:00 de
Europe/Madrid y la carpeta configurada en `BACKUP_FOLDER_ID`.

## Cierre del agujero: una sola DIARIA por día

Antes de copiar, `crearCopiaSeguridad_('DIARIA')` lista la carpeta y llama a la función pura
`existeCopiaDiariaDeHoy(listaCopias, hoy)`, que compara la fecha `YYYY-MM-DD` del nombre de cada
copia DIARIA con la fecha de hoy en Europe/Madrid. Si ya existe, devuelve
`{ ok: true, omitida: true, motivo: 'YA_EXISTE_HOY' }` sin crear ni borrar nada. `MANUAL` y
`PRE_DESPLIEGUE` no pasan por este control.

- Prueba 10: 35 llamadas a `copiaDiariaProgramada` el mismo día dejan exactamente una copia DIARIA
  de hoy; las tres copias de días anteriores siguen sin `setTrashed` y la carpeta no crece.
- Prueba 11: al día siguiente, con el reloj de prueba fijado en 2026-11-06,
  `copiaDiariaProgramada` crea la copia nueva (`2026-11-06`) junto a la del día anterior.

## Archivos tocados

- `src/BackupService.js` (nuevo)
- `src/Código.js` (solo las tres funciones `admin*`, `copiaDiariaProgramada`, su carga y exports)
- `docs/API_PUBLICA.md`
- `docs/RESTAURAR_COPIA.md` (nuevo)
- `test/t018_copias.test.js` (nuevo)
- `logs/T-018/*`

No se ha tocado `src/appsscript.json`: los permisos de Drive y de disparadores los deduce Apps
Script del código. No se ha tocado ningún archivo del carril A.
