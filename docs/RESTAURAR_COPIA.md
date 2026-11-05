# Restaurar una copia de seguridad de STOCK-LIGHT

Procedimiento para volver a un estado anterior de la hoja de datos usando las copias de
`BackupService.js` (T-018). Todas las operaciones de administración se ejecutan desde el editor
de Apps Script, como propietario del script; desde la web app se rechazan.

## Antes de empezar

- Comprueba que la carpeta de copias está configurada. Si no lo está, ejecuta una vez:
  `adminConfigurarCarpetaCopias('<ID_DE_LA_CARPETA_DE_DRIVE>')`.
- Comprueba que el disparador diario está instalado (opcional, pero recomendable):
  `adminInstalarCopiaDiaria()`. Crea una copia cada día a las 23:00 de Europe/Madrid.
- Las copias se llaman `STOCK-LIGHT_COPIA_<YYYY-MM-DD_HHmm>_<MOTIVO>`, con motivo `DIARIA`,
  `MANUAL` o `PRE_DESPLIEGUE`. Se conservan las 30 `DIARIA` más recientes; las `MANUAL` y
  `PRE_DESPLIEGUE` no se borran automáticamente.
- Solo se crea una copia `DIARIA` por día (Europe/Madrid). Si el disparador se ejecuta varias
  veces el mismo día, la segunda y siguientes se omiten sin crear ni borrar nada.

## Pasos para restaurar

1. **Elegir la copia.** En la carpeta de copias de Drive, localiza la copia por su nombre y
   anota su identificador de archivo (el ID que aparece en la URL de Drive).

2. **Hacer una copia MANUAL del estado actual.** Antes de cambiar nada, ejecuta desde el editor:
   `adminCrearCopiaManual()`. Así queda guardado el estado que vas a sustituir y se puede volver
   atrás si la restauración no sale como esperabas.

3. **Apuntar el sistema a la copia.** Ejecuta desde el editor:
   `configurarSpreadsheetId('<ID_DE_LA_COPIA>')`.
   A partir de este momento, STOCK-LIGHT lee y escribe en la copia restaurada. No borres ni muevas
   el archivo original: sigue siendo la referencia de la copia `MANUAL` del paso 2.

4. **Comprobar la consistencia.** Ejecuta `comprobarConsistencia` (T-022) y revisa que la
   reconstrucción coincide con el stock vivo y que los totales son los esperados. Si T-022 aún no
   está desplegado, revisa al menos el stock por grupos y el log de operaciones antes de seguir.

5. **Volver a producción, si hace falta.** Si tras revisar decides no usar la copia, ejecuta
   `configurarSpreadsheetId('<ID_DE_LA_HOJA_ORIGINAL>')` para devolver el sistema a la hoja que
   estaba activa antes de la restauración.

## Qué no hace este procedimiento

- No copia la carpeta de Drive con los CSV originales (fuera de alcance de T-018).
- No restaura automáticamente los archivos de Drive asociados a documentos; solo la hoja de datos.
- No muestra la última copia en el panel de salud (T-021).
