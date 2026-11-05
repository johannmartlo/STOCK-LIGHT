# T-018 — Copias de seguridad automáticas de la hoja de datos

Carril: B (operación y seguridad). Rama: `ticket/T-018-copias-seguridad`, creada desde `main` tras el merge de T-023. Sensible: no (no toca stock; crea copias).
Especificación: 2026-11-04. Origen: PLAN_PRODUCCION §2.

## Problema
No existe ninguna copia de la hoja de datos. Un error humano, un fallo a mitad de escritura o un ticket defectuoso desplegado en producción pueden dejar el stock dañado sin forma de volver atrás.

## Reglas
1. Nuevo `src/BackupService.js`, separado en dos partes:
   - **lógica pura** (probada en Node): nombre de la copia y qué copias borrar;
   - **acceso a Drive**, mínimo.
2. `crearCopiaSeguridad_(motivo)`:
   - copia el archivo de la hoja de datos (`resolveDatabaseSpreadsheet`) con `DriveApp.getFileById(id).makeCopy(nombre, carpeta)`;
   - la carpeta es la de ScriptProperties `BACKUP_FOLDER_ID`; si no existe, error claro;
   - el nombre es `STOCK-LIGHT_COPIA_<YYYY-MM-DD_HHmm Europe/Madrid>_<motivo>`, con el motivo `DIARIA`, `MANUAL` o `PRE_DESPLIEGUE`;
   - devuelve `{ id, nombre }` y escribe una línea en la hoja `LOG_OPERACIONES`, o en la de auditoría que use hoy `apiObtenerLogOperaciones`.
3. Retención: tras cada copia `DIARIA`, se envían a la papelera (`setTrashed(true)`) las copias `DIARIA` más antiguas, hasta conservar 30. Las `MANUAL` y `PRE_DESPLIEGUE` no se borran nunca automáticamente. La decisión de qué borrar es una función pura: `seleccionarCopiasABorrar(listaCopias, 30)`.
4. Funciones de administración, protegidas con `exigirPropietario_()` (T-023):
   - `adminCrearCopiaManual()`;
   - `adminInstalarCopiaDiaria()`: crea un disparador temporal diario a las 23:00 que llama a `copiaDiariaProgramada()`. Antes borra cualquier disparador anterior de esa función, así que es idempotente;
   - `adminConfigurarCarpetaCopias(folderId)`.
5. `copiaDiariaProgramada()` llama a `crearCopiaSeguridad_('DIARIA')`. Si falla, escribe el error en el log y no lanza nada.
6. Nuevo `docs/RESTAURAR_COPIA.md`, con los pasos para restaurar:
   1. elegir la copia;
   2. hacer una copia `MANUAL` del estado actual;
   3. ejecutar `configurarSpreadsheetId(<id de la copia>)`;
   4. comprobar con `comprobarConsistencia` (T-022).

## Aceptación
1. **Prueba nueva:** `seleccionarCopiasABorrar` con 35 copias `DIARIA` y 3 `MANUAL` devuelve las 5 `DIARIA` más antiguas y ninguna `MANUAL`.
2. **Prueba nueva:** el nombre generado para 2026-11-05T22:00:00Z es `STOCK-LIGHT_COPIA_2026-11-05_2300_DIARIA`.
3. **Prueba nueva:** con mocks de `DriveApp`, `ScriptApp` y `PropertiesService`, `adminInstalarCopiaDiaria()` llamado dos veces deja un solo disparador.
4. **Prueba nueva:** `adminCrearCopiaManual()` sin propietario lanza el error de T-023.
5. `docs/API_PUBLICA.md` (T-023) incluye las funciones nuevas con su clasificación.
6. `node test/run_all.js` con 0 fallos, salida en `logs/T-018/tests.txt`.
7. **Comprobación manual en DEV**, la hace el responsable: crear una copia manual, instalar la copia diaria, ver al día siguiente que se ha creado.

## Archivos previstos
- `src/BackupService.js` (nuevo)
- `src/Código.js` (solo las tres funciones `admin*` y `copiaDiariaProgramada`)
- `src/appsscript.json` (solo si hacen falta permisos de Drive o de disparadores)
- `docs/API_PUBLICA.md`
- `docs/RESTAURAR_COPIA.md` (nuevo)
- `test/t018_copias.test.js` (nuevo)
- `logs/T-018/*`

Si necesitas otro, para y pregunta. No toques los archivos del carril A.

## Fuera de alcance
- Mostrar la última copia en el panel de salud (T-021).
- Copiar la carpeta de Drive con los CSV.
