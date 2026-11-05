# AGENTS.md — Cómo trabajar en STOCK-LIGHT

Instrucciones para cualquier agente de código (Codex, DeepSeek, Gemini Antigravity, OpenCode…) que ejecute un ticket de este repositorio. Actualizado el 2026-11-04: trabajo en paralelo por carriles. 2026-11-05: regla de «Dudas» (Al terminar, punto 6).

## Antes de empezar
1. Lee `docs/STATE.md` (carriles, orden y estado) y `docs/decisions.md` (reglas cerradas).
2. Lee el ticket completo, `docs/tickets/T-0xx-*.md`, **y comprueba que es de tu carril**.
3. `git fetch` y crea la rama que indica el ticket, desde la rama que indica el ticket, actualizada.
4. Lee los documentos de referencia: `BUSINESS_RULES.md`, `DATA_MODEL.md`, `ARCHITECTURE.md`. Si el ticket contradice alguno, manda el ticket. Actualiza el documento en el mismo ticket solo si el ticket lo pide.
5. Los números de línea de los tickets se verificaron en `prep/public-baseline` (773fc40). Si no coinciden, localiza el código por el nombre de la función. Si no lo encuentras, para y pregunta.

## Trabajo en paralelo: carriles
Varios agentes trabajan a la vez, cada uno en su carril. Para que no se pisen:
- **Cada carril es dueño de unos archivos** (tabla de `docs/STATE.md`). No modifiques archivos de otro carril aunque te parezca necesario: para y pregunta.
- **Un ticket a la vez por carril.** El siguiente ticket de tu carril empieza desde `main` cuando el anterior está fusionado, no desde tu rama anterior.
- Si al empezar `main` tiene cambios de otro carril en archivos que tu ticket va a tocar, trabaja sobre esa versión: no la deshagas.

## Durante el trabajo
- **Un ticket, un objetivo.** No hagas nada que no esté en «Aceptación». No toques archivos que no estén en «Archivos previstos». Si necesitas otro archivo, para y pregunta.
- **Lógica pura y persistencia separadas.** Los cálculos (FIFO, parseo, clasificación) van en funciones que no llaman a `SpreadsheetApp`, `DriveApp`, `Session` ni `UrlFetchApp`, para que se puedan probar en Node. La escritura en Sheets va siempre en bloque y dentro de `LockService` (TECHNICAL_RISKS §3).
- **El libro de movimientos es de solo añadir (D-022).** Nunca modifiques ni borres una fila existente de MOVIMIENTOS.
- **Identificadores con `nuevoId()`** (D-024), nunca con `Date.now()`.
- **Funciones globales nuevas** (las que no terminan en `_`): clasifícalas en `docs/API_PUBLICA.md` en el mismo ticket. La prueba de T-023 falla si no.
- **Nada de reglas de negocio fijas en el código.** Ningún nombre de producto, cliente, serie ni grupo escrito a fuego. Todo eso viene de configuración (D-005, D-002).
- **Datos reales, nunca.** Las pruebas usan archivos inventados con la estructura exacta del real (D-015).
- **No cambies las aserciones de las pruebas existentes**, salvo que el ticket lo diga expresamente y diga cuáles.
- Para pruebas nuevas usa `test/helpers/mockSheets.js` (T-001); no copies otra vez los mocks.

## Pruebas
- Comando único: `node test/run_all.js`.
- Guarda la salida completa en `logs/T-0xx/tests.txt` (UTF-8). Resultado exigido: 0 fallos. Las suites manuales (`test/manual/`) no cuentan.
- Si el ticket toca pantallas, añade a `logs/T-0xx/` capturas con datos ficticios a 360 px y a 1280 px de ancho.

## Al terminar
1. Comprueba uno por uno todos los puntos de «Aceptación» y anota en `logs/T-0xx/aceptacion.md` cómo has comprobado cada uno.
2. Commit en la rama del ticket, con una lista explícita de archivos (`git add <archivo>`; nunca `git add .`). No subas nada de `docs/samples/` ni datos reales.
3. `git push -u origin <rama del ticket>`.
4. **No hagas merge ni `clasp push`.** El director técnico (Claude) verifica la rama contra el ticket, y el responsable fusiona.
5. Termina con un resumen de 5 líneas: rama, commit, número de pruebas, puntos de aceptación cumplidos y dudas.
6. **En «Dudas» se lista todo cambio que no esté descrito en las reglas del ticket**, aunque sea pequeño y aunque esté en un archivo previsto. «Dudas: ninguna» solo es válido si no has hecho nada que el ticket no pida. (Añadido el 2026-11-05.)

## Parar y preguntar
Para y pregunta, sin improvisar, si:
- el código real no coincide con lo que describe el ticket;
- hace falta cambiar el esquema de una hoja que el ticket no menciona;
- hace falta tocar un archivo de otro carril;
- hace falta decidir algo de negocio (qué cuenta, qué se muestra, qué se bloquea);
- una prueba existente falla por un motivo que no entiendes.
