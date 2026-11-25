# T-011 — Instalación, stock inicial y despliegue

Rama: `ticket/T-011-puesta-en-marcha`, creada desde `main` = `c99e7d4` (T-007, T-008, T-009 y T-020 fusionados). Sensible: **sí** (escribe stock y prepara PROD).
Especificación: 2026-10-23; **reescrita el 2026-11-25** (plan de cierre; D-022, D-029, P-5). La identidad ya la resuelve T-020 y el catálogo, T-005 (D-029): aquí ya no hay matriz ni grupos.

## Lo que ya existe (verificado en main; no lo rehagas)
- `doGet` con plantilla `Index`, token `k` y PIN; `appsscript.json` con `webapp` (`USER_DEPLOYING`, `ANYONE`) (T-020).
- `crearUsuario(nombre, rol)` devuelve el enlace personal; `exigirPropietario_()`; `PERMISOS_API`; `exigirSesionApi_()` (T-020).
- `initDatabase` / `provisionDatabase` (idempotente), `configurarSpreadsheetId`, `configurarDriveFolderId`.
- `sembrarCatalogoEnRepositorio_(repo)` en `SemillaCatalogo.js`: hoy no lo llama nadie.
- Copias (T-018): `crearCopiaSeguridad_(motivo)`, `configurarCarpetaCopias_`, `instalarCopiaDiaria_`, `docs/RESTAURAR_COPIA.md`.
- `MovementService.registrarAjuste` acepta `fecha`, `entidad`, `motivo` y `origen_dato`. Es **uno por llamada** (un lock y un `_persistir` por fila): no sirve para cargar cientos de partidas.
- `CatalogoService.esCombinacionSeguida(articulo, envase)` y la hoja CATALOGO con las combinaciones vistas.
- `PendientesService.reintentarPendientes` (T-008).
- `.gitignore` ya excluye `.clasp.json` y `.clasprc.json`.

## Reglas
1. **`adminInstalarStockLight()`** en `src/Instalacion.js` (nuevo), con `exigirPropietario_()`, idempotente y ejecutable desde el editor:
   1. provisiona las hojas (`provisionDatabase`);
   2. comprueba que están configurados el Spreadsheet y la carpeta de Drive; si falta alguno, lo dice con la función exacta que hay que ejecutar y **no sigue**;
   3. siembra el catálogo **solo si** ATRIBUTOS y REGLAS_CLASIFICACION están vacías (nunca pisa reglas existentes);
   4. si hay carpeta de copias, instala la copia diaria (`instalarCopiaDiaria_`); si no, avisa con la función que hay que ejecutar;
   5. si no hay ningún usuario ADMIN, crea uno con el nombre recibido (`adminInstalarStockLight('Juan')`) y devuelve su enlace.

   Devuelve un informe `{ hecho: [...], yaEstaba: [...], falta: [...] }`. La segunda ejecución no cambia nada y lo dice.
2. **Stock inicial**, en `src/importacion/StockInicialService.js` (nuevo):
   1. **Entrada:** filas `Fecha;Proveedor;Articulo;Envase;Cajas` y, opcionalmente, `;Kg`, con la cabecera exacta. Dos fuentes con el mismo núcleo:
      - texto CSV, para la pantalla futura;
      - una hoja `STOCK_INICIAL_ENTRADA` que el usuario rellena o pega en el Spreadsheet. La crea `adminInstalarStockLight` con solo la cabecera.
   2. **`previsualizar(filas)`** devuelve cada fila con un estado:
      - `OK`;
      - `NO_SEGUIDA`: el catálogo dice NO; se salta y se avisa;
      - `DESCONOCIDA`: el catálogo no sabe; **bloquea**, hay que añadir la regla;
      - `ERROR_DATOS`: fecha inválida o futura, cajas que no son entero > 0, o campo vacío; **bloquea**.

      Además, un aviso `NO_VISTA` (no bloquea) cuando la combinación artículo + envase no está en CATALOGO, porque puede ser un nombre mal escrito respecto a Hispatec.

      Incluye totales de cajas por artículo + envase, por proveedor y total general (para cuadrar con el Excel o el conteo) y un `hash` del contenido.
   3. **`confirmar(filas, hash, usuario, { anadir })`:**
      - rechaza si el hash no coincide o si queda alguna fila que bloquea;
      - rechaza si ya hay movimientos confirmados en MOVIMIENTOS y no viene `anadir: true`;
      - antes de escribir, crea una copia con `crearCopiaSeguridad_('PRE_STOCK_INICIAL')`. Si la copia falla, **no carga**;
      - crea un movimiento `AJUSTE`, signo +1, por fila OK, con:
        - `motivo_ajuste = 'STOCK_INICIAL'` y `origen_dato = 'STOCK_INICIAL'`;
        - `fecha_negocio = Fecha` y `entidad_nombre = Proveedor`;
        - `kg_informativo = Kg` si viene;
        - una capa por fila;
      - todo en **un solo lock y un solo `_persistir`**, como hace `PendientesService.reintentarPendientes`. Es todo o nada: si una fila falla, no se escribe ninguna;
      - registra una línea en LOG_OPERACIONES con el hash, las filas y las cajas;
      - lanza `reintentarPendientes` al final; si falla, avisa y no deshace.
   4. **Vuelta atrás:** no hay anulación de la carga. Si la carga está mal, se restaura la copia `PRE_STOCK_INICIAL` con `docs/RESTAURAR_COPIA.md`. Indícalo en el resultado de `confirmar`.
3. **Funciones de uso:**
   - `adminPrevisualizarStockInicialDesdeHoja()` y `adminConfirmarStockInicialDesdeHoja(hash, anadir)` en `src/Código.js`, con `exigirPropietario_()`;
   - `apiPrevisualizarStockInicial(textoCsv)` y `apiConfirmarStockInicial(textoCsv, hash, anadir)`, como ESCRITURA y rol **ADMIN**, en `PERMISOS_API` y en `docs/API_PUBLICA.md`.
4. **`docs/PUESTA_EN_MARCHA.md`** (nuevo), en pasos numerados para alguien que no programa:
   1. **DEV y PROD:** dos hojas y dos proyectos de Apps Script. PROD pertenece a la **cuenta Gmail dedicada (P-5)**.
   2. **clasp:** `clasp login` con cada cuenta; un `.clasp.json` por entorno guardado **fuera del repositorio** (p. ej. `.clasp.dev.json` y `.clasp.prod.json`, añadidos a `.gitignore`), y cómo cambiar entre ellos.
   3. **Primera instalación:** configurar IDs → `adminConfigurarCarpetaCopias` → `adminInstalarStockLight('Nombre')` → crear usuarios → implementación web app → URL.
   4. **Stock inicial:**
      - rellenar `STOCK_INICIAL_ENTRADA` con los **nombres exactos de artículo y envase de Hispatec**, no los del Excel;
      - una fila por partida (proveedor + fecha + artículo + envase);
      - previsualizar, cuadrar los totales con el Excel o el conteo, y confirmar.
   5. **Regla de corte:** el stock inicial es el del cierre del día D; desde D+1 se importan solo CSV con fecha posterior a D.
   6. **Desplegar versiones sin cambiar la URL:** `clasp push` y `clasp deploy -i <id de la implementación>`; prueba rápida; vuelta atrás a la versión anterior.

   Sin IDs reales, emails ni nombres de clientes o proveedores reales.
5. `docs/reference/stock_inicial_plantilla.csv` (solo la cabecera) y `test/fixtures/csv/stock_inicial_ejemplo.csv` (ficticio).

## Aceptación
1. **Prueba nueva:** `adminInstalarStockLight` dos veces deja el mismo estado; la segunda informa de que no hay cambios. No pisa reglas de catálogo ya existentes. Crea el primer ADMIN solo una vez.
2. **Prueba nueva:** sin Spreadsheet o carpeta de Drive configurados, para y dice qué ejecutar, sin escribir nada.
3. **Prueba nueva:** el CSV de ejemplo crea una capa por fila con su fecha y proveedor; los totales de la previsualización cuadran con las capas creadas; `comprobarConsistencia().consistente === true`.
4. **Prueba nueva (bloqueos):** una fila `DESCONOCIDA` o `ERROR_DATOS` impide confirmar y no escribe nada. Una `NO_SEGUIDA` se salta. Una `NO_VISTA` avisa y se carga.
5. **Prueba nueva:** una segunda carga sin `anadir` se rechaza sin escribir nada; con `anadir: true` se añade.
6. **Prueba nueva (todo o nada):** si falla la copia previa o una fila durante la aplicación, no queda ningún movimiento de la carga.
7. **Prueba nueva (FIFO):** tras cargar dos partidas de la misma combinación con fechas distintas, una venta importada (T-007) consume primero la más antigua.
8. **Prueba nueva:** una venta pendiente de T-008 se aplica sola tras la carga.
9. Las API nuevas se rechazan sin sesión y con un rol menor que ADMIN (la cobertura de `t020_acceso.test.js` sigue en verde).
10. `node test/run_all.js` con 0 fallos, salida en `logs/T-011/tests.txt`.

## Archivos previstos
- `src/Instalacion.js` (nuevo)
- `src/importacion/StockInicialService.js` (nuevo)
- `src/Código.js`, `src/Seguridad.js` (`PERMISOS_API`), `docs/API_PUBLICA.md`
- `src/Repository.js` (**solo** si hace falta crear o leer la hoja `STOCK_INICIAL_ENTRADA`; lístalo en «Dudas»)
- `docs/PUESTA_EN_MARCHA.md` (nuevo), `docs/reference/stock_inicial_plantilla.csv` (nuevo), `.gitignore`
- `test/t011_puesta_en_marcha.test.js` (nuevo), `test/fixtures/csv/stock_inicial_ejemplo.csv` (nuevo)
- `docs/tickets/T-011-puesta-en-marcha.md` (este ticket, primer commit, sin editar)
- `logs/T-011/tests.txt`, `logs/T-011/informe.md`

Si necesitas otro, para y pregunta. **No toques** `src/Libro.js`, `src/InventoryEngine.js`, `src/Reproceso.js`, `src/Catalogo*.js`, `src/SemillaCatalogo.js`, `src/importacion/PendientesService.js` ni `src/importacion/ImportacionService.js`.

## Fuera de alcance
- Pantalla de stock inicial (va en las pantallas).
- Conversión automática del Excel a la plantilla (el Excel no usa los nombres de Hispatec).
- Anular una carga (se restaura la copia).
- Pantalla de usuarios.

## Parar y preguntar si
- Aplicar en lote obligara a cambiar `MovementService._persistir` o el motor.
- La copia previa no pudiera hacerse desde el mismo proceso.

## Entrega
Escribe en `logs/T-011/informe.md`:
- un resumen de 5 líneas;
- la salida de `git status` y de `git log --oneline -5`;
- **«Dudas»** con TODO cambio no pedido por el ticket.
