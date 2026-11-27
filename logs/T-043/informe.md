# T-043 — Informe de entrega

## Resumen (5 líneas)

1. Rama `ticket/T-043-cierre-guiado`, rebasada sin conflictos sobre `origin/main` (`76a9eb8`, que ya incluye T-042). Commits de T-043: `c909cb3` (ticket), `96658d4` (implementación base de DeepSeek), `31ad9e8` (correcciones y revisión final) y este informe.
2. Implementa el cierre del día guiado: `src/CierreService.js`, hoja `CIERRE_DIA` en `src/Repository.js`, API `apiObtenerCierre` / `apiMarcarPasoCierre` (rol `ENCARGADO`), pantalla `src/ui/cierre.html` (`window.SLCierre`), tarjeta/contador y sello de hora en Inicio, línea «Cierre incompleto» y marca del paso 6 en Parte, y actualización de `docs/GUIA_USO.md`, `docs/API_PUBLICA.md` y `DATA_MODEL.md`.
3. Se ha revertido `src/CuadreService.js` (fuera de «Archivos previstos») sustituyendo los parámetros extra por un proxy de repositorio en `CierreService.js`, y se han corregido tres puntos detectados en revisión: `LockService` en `marcarPaso`, pintado del sello de hora para `CONSULTA` y formato de lista en `_textoCierreIncompletoParte_`.
4. `node test/run_all.js`: **51 suites, 499 pruebas, 0 fallos** (`logs/T-043/tests.txt`). Todos los puntos de aceptación 1–8 y el añadido del 27/11 comprobados en `logs/T-043/aceptacion.md`; capturas a 360 px y 1280 px en `logs/T-043/`.
5. Rama subida a `origin/ticket/T-043-cierre-guiado`. Sin merge ni `clasp push`.

## Reparto del trabajo (DeepSeek vs Antigravity)

### Parte realizada por DeepSeek (commit `96658d4`, originalmente `38c6467` sobre `9c24973`)
- Ya había dejado el trabajo commiteado en `ticket/T-043-cierre-guiado` (sin cambios pendientes en `src/`, `test/` ni `docs/`, solo `logs/T-043/` sin seguimiento), por lo que no hizo falta crear un commit `wip(...)`.
- Implementación inicial completa de `src/CierreService.js`, `src/ui/cierre.html`, `src/ui/estilos.html`, `src/Repository.js` (`CIERRE_DIA`), `src/Código.js`, `src/InicioService.js`, `src/ParteService.js`, `src/ui/parte.html`, `src/Index.html`, `src/ui/app.html`, `src/Seguridad.js`, `src/CuadreService.js`, `DATA_MODEL.md`, `docs/API_PUBLICA.md`, `docs/GUIA_USO.md` y `test/t043_cierre.test.js`.
- Capturas de pantalla (`logs/T-043/01-cierre-1280.png` a `04-inicio-cierre-360.png`) y primera versión de `aceptacion.md` / `tests.txt`.

### Parte realizada por Antigravity (rebase + commit `31ad9e8` + este informe)
- `git fetch origin` y `git rebase origin/main` (`76a9eb8`), manteniendo intacto todo T-042 (sesión guardada, errores con causa, `URL_APP`, `fecha_inicio_datos`).
- **Revertido `src/CuadreService.js`** al estado exacto de `origin/main` (estaba fuera de «Archivos previstos» y no era imprescindible): `CierreService.obtenerCierre` usa ahora un proxy `Object.create(this.repo)` con `getMovimientos` y `getStockActual` cacheados para invocar `CuadreService.obtenerCuadre()` sin argumentos ni relecturas extra.
- **Añadido `LockService` en `CierreService.marcarPaso`** (bloqueo de script en escritura a `CIERRE_DIA`, conforme a `AGENTS.md`).
- **Corregido `renderInicio` en `src/ui/cierre.html`**: movida la llamada `renderSello(data || {})` antes del `if (!cierre) return;`, para que los usuarios con rol `CONSULTA` (que no reciben `data.cierre`) también vean el sello «Actualizado a las HH:MM» en Inicio.
- **Corregido `_textoCierreIncompletoParte_` en `src/ParteService.js`**: al faltar 3 o más pasos formatea `"1, 2 y 3"` en lugar de `"1 y 2 y 3"`.
- Re-ejecución completa de `node test/run_all.js` tras el rebase (51 suites, 499 pruebas, 0 fallos), actualización de `logs/T-043/tests.txt` y `logs/T-043/aceptacion.md`, commit explícito y `git push`.

## git status

```text
On branch ticket/T-043-cierre-guiado
Untracked files:
  (use "git add <file>..." to include in what will be committed)
	logs/T-011/fusion.md
	logs/T-026/fusion.md
	logs/T-029/fusion.md
	logs/T-030/fusion.md
	logs/T-043/informe.md

nothing added to commit but untracked files present (use "git add" to track)
```

*(Los cuatro `logs/T-0xx/fusion.md` ya estaban sin seguimiento antes de empezar y no se tocan. `logs/T-043/informe.md` se añade en el commit final tras escribir este archivo.)*

## git log --oneline -8

```text
31ad9e8 fix(T-043): revertir CuadreService, LockService, sello CONSULTA y logs
96658d4 feat(T-043): cierre del dia guiado
c909cb3 docs(tickets): anadir T-043 cierre guiado
76a9eb8 docs(T-042): anadir informe de entrega
d267714 feat(T-042): sesion recordada, errores claros, URL_APP y fecha_inicio_datos
2b88915 docs(tickets): anadir T-042 acceso sin friccion
9c24973 docs(T-044): aceptacion e informe
e57f678 feat(T-044): recepciones agrupadas por almacen
```

## Dudas (cambios no pedidos por el ticket)

1. **`src/Seguridad.js` (único archivo fuera de «Archivos previstos»; imprescindible).** Se añaden las dos entradas obligatorias `apiObtenerCierre: 'ENCARGADO'` y `apiMarcarPasoCierre: 'ENCARGADO'` en `PERMISOS_API` (sin ellas, `despacharApi` bloquea ambos endpoints y fallan las pruebas de T-020/T-023) y el helper interno `rolActual_()` (11 líneas) para que `apiObtenerInicio`/`apiObtenerParte` sepan si el usuario tiene rol `ENCARGADO` o superior. No se toca nada del acceso de T-042. (`src/CuadreService.js`, que DeepSeek sí había tocado, ha sido completamente revertido.)
2. **`apiObtenerInicio` y `apiObtenerParte` filtran el cierre según el rol.** Para `ENCARGADO`/`ADMIN` incluyen `cierre`; para `CONSULTA` lo omiten (la pantalla y el botón del menú ya estaban ocultos para `CONSULTA`). El sello de hora (`ultimo_movimiento_hora`) sí se muestra a todos los roles.
3. **Semántica del día vacío.** Para cumplir «día vacío → 0 de 6» el paso 4 no se marca automáticamente si no hay pendientes ni actividad previa del día; el paso 5 tampoco se marca sin familias en `obtenerCuadre()`. Cuando hay importación, movimientos, marcas o pendientes, el paso 4 pasa a ser automático.
4. **Albarán en espera: deducción del artículo faltante.** `PENDIENTES` guarda todas las líneas del documento con `STOCK_INSUFICIENTE`, sin marcar cuál causó el déficit. `CierreService` agrupa por documento y compara contra `STOCK_ACTUAL`; los artículos con déficit salen en `faltantes`. Si varios albaranes pendientes compiten por el mismo stock, ambos pueden listar el déficit.
5. **Botón «Abrir Cambiar» sin artículo preseleccionado.** `SLCambiar.abrir(opciones)` solo admite `idCapa`/`variedad`, no artículo de destino. Conforme al ticket («si la API lo permite; si no, solo abre Cambiar»), abre Cambiar directamente.
6. **Textos del «Por qué».** La maqueta de Claude Artifacts requiere sesión y no pudo consultarse desde este entorno; los textos de «Qué hacer» y «Por qué» se redactaron a partir del ticket y del estilo de `parte.html`.
7. **`CIERRE_DIA` insertada antes de `USUARIOS` en `SCHEMA_DEFINITIONS`.** La prueba de T-020 exige que `USUARIOS` siga siendo la última hoja del esquema.
8. **Nombre del campo `ultimo_movimiento_hora` en `apiObtenerInicio`.** El ticket no fijaba el nombre exacto de la propiedad; se devuelve el ISO del último movimiento confirmado para pintar el sello sin una segunda llamada.
9. **`apiObtenerCierre` acepta `options.fecha`.** La API pública no requiere argumentos; se admite `options.fecha` para pruebas y consultas de fechas pasadas.
10. **Marca del paso 6 al enviar el correo.** `enviarParteDiario_` añade una fila `paso = 'parte', estado = 'HECHO'` a `CIERRE_DIA` cuando el correo se envía bien (sin romper el envío si `CIERRE_DIA` fallase).
11. **`tareas_dia.cambios.cajas` usa `total_retirado`.** El ticket no especifica si mostrar cajas retiradas o cajas de destino en la tarjeta de cambios de confección.
12. **`docs/GUIA_USO.md` añade la sección 10 («Cierre del día guiado»).** Además de actualizar el punto 1 de la sección 2 con la rutina de recepciones del día y ventas de hoy a mañana, se añadió la sección 10 para documentar la pantalla nueva.
13. **`LockService` en `CierreService.marcarPaso`.** Añadido para cumplir la regla de `AGENTS.md` (toda escritura en Sheets dentro de `LockService`).
14. **Formato de lista con comas en `_textoCierreIncompletoParte_`.** Cuando faltan 3 o más pasos se muestra `"1, 2 y 3"` en lugar de `"1 y 2 y 3"`.
