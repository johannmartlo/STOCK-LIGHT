# T-040 — Informe de entrega

## Resumen (5 líneas)

1. Rama `ticket/T-040-cuadre-noche`, rebasada sobre `5585962` (T-041) desde la base anterior
   `43c22cd`. El primer commit (`85d0391`) contiene solo el ticket sin editar; la
   implementación va en `f0e1bca` y los logs/capturas en `885f2f9`.
2. Servicio nuevo `src/CuadreService.js`: `obtenerCuadre()` agrupa por la agrupación
   `COMERCIAL`, ordena artículos con `compararArticulos` y devuelve el `deberia` de
   `STOCK_ACTUAL`; `confirmarFamilia()` valida todo antes de escribir, bloquea con
   `STOCK_CAMBIADO` si el stock cambió, aplica ajustes `RECUENTO` por FIFO y es idempotente
   por `id_cuadre` + familia.
3. `apiObtenerCuadre` y `apiConfirmarCuadreFamilia` en `src/Código.js` (LECTURA/ESCRITURA,
   rol ENCARGADO), clasificadas en `docs/API_PUBLICA.md`; la hoja `CUADRES` está en
   `SCHEMA_DEFINITIONS` y se crea con el aprovisionamiento, también desde
   `adminInstalarStockLight`.
4. Pantalla nueva `src/ui/cuadre.html` con cabecera, progreso, tabla Artículo · Debería ·
   Hay · Dif., resumen `aria-live`, aviso `STOCK_CAMBIADO`, botones Saltar / Confirmar y
   resumen final con enlace a Movimientos; entrada «Cuadre» en el menú lateral y en la barra
   de acciones del móvil, oculta para CONSULTA.
5. `node test/run_all.js`: **48 suites, 475 pruebas, 0 fallos** (`logs/T-040/tests.txt`),
   incluyendo la suite nueva de T-041 que ya viene en la base. Sin merge, sin `clasp push`;
   no se tocaron `MovementService.js`, `Libro.js`, `InventoryEngine.js`, `importacion/`,
   `NombresLegibles.js` ni `InicioService.js`.

## Rebase sobre T-041

`git fetch origin` dejó `origin/main` en `43c22cd` (T-041 estaba en la rama
`origin/ticket/T-041-pulido-lectura`, punta `5585962`). Como el mensaje indica que la nueva
base es `5585962` y el recuento esperado es 48 suites / 475 pruebas, el rebase se hizo sobre
ese commit:

```text
git rebase 5585962
Rebasing (1/3) ... (2/3) ... (3/3)
Successfully rebased and updated refs/heads/ticket/T-040-cuadre-noche.
```

No hubo conflictos. Los commits de T-041 pasan a ser ancestros de esta rama. Las capturas se
regeneraron sobre la base nueva (T-041 cambia nombres, contraste y tamaños de letra) y siguen
sin desplazamiento horizontal a 360 y 1280 px.

## git status

```text
On branch ticket/T-040-cuadre-noche
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
	modified:   logs/T-040/01-cuadre-familia-1280.png
	modified:   logs/T-040/02-cuadre-familia-360.png
	modified:   logs/T-040/03-cuadre-final-1280.png
	modified:   logs/T-040/04-cuadre-final-360.png
	modified:   logs/T-040/05-cuadre-stock-cambiado-360.png
	modified:   logs/T-040/06-cuadre-stock-cambiado-1280.png
	modified:   logs/T-040/07-movil-accion-cuadre-360.png
	modified:   logs/T-040/08-escritorio-menu-cuadre-1280.png
	modified:   logs/T-040/aceptacion.md
	modified:   logs/T-040/informe.md
	modified:   logs/T-040/tests.txt

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	logs/T-011/fusion.md
	logs/T-026/fusion.md
	logs/T-029/fusion.md
	logs/T-030/fusion.md

no changes added to commit (use "git add" and/or "git commit -a")
```

Todo lo modificado de `logs/T-040/` entra en el commit de actualización del rebase. Los
`logs/*/fusion.md` ya estaban sin seguimiento antes de empezar y no se tocan.

## git log --oneline -5

```text
885f2f9 docs(T-040): aceptacion, informe y capturas
f0e1bca feat(T-040): cuadre de la noche por familia
85d0391 docs(tickets): anadir T-040 cuadre de la noche
5585962 docs(T-041): actualizar informe tras rebase sobre 43c22cd
5b7769e feat(T-041): ajustar subtotal del desglose y pruebas tras rebase sobre 43c22cd
```

## Dudas (cambios no pedidos por el ticket)

1. **Base del rebase.** `origin/main` seguía en `43c22cd` al hacer `git fetch`; T-041 está en
   `origin/ticket/T-041-pulido-lectura` con punta `5585962`. Para cumplir la nueva base que
   indica el mensaje y el recuento esperado (48/475), rebasé sobre `5585962`, no sobre
   `origin/main`. Sin conflictos. Si la fusión de T-041 no acaba siendo exactamente ese
   commit, habrá que rehacer el rebase.
2. **`src/Seguridad.js` (PERMISOS_API).** No está en «Archivos previstos», pero sin las dos
   entradas `apiObtenerCuadre: 'ENCARGADO'` y `apiConfirmarCuadreFamilia: 'ENCARGADO'` el
   despachador las rechaza con `API_NO_PERMITIDA` y la prueba de cobertura de T-020 falla
   (`docs/API_PUBLICA.md` exige que toda función LECTURA/ESCRITURA esté en `PERMISOS_API`).
   Es el mismo archivo del carril B; no se cambió nada más.
3. **`id_cuadre` en la respuesta de `obtenerCuadre()`.** La forma del ticket solo enumera
   `generado_en` y `familias`, pero `confirmarFamilia` necesita un `id_cuadre` que agrupe las
   familias de una misma sesión de cuadre. Se añade como campo extra generado con
   `nuevoId('CUADRE')`; no se envía desde el navegador.
4. **Acción del móvil inyectada desde `app.html`.** La barra `.sl-mobile-actions` vive en
   `existencias.html`, que no está en «Archivos previstos». Para no tocar ese archivo, la
   acción «Cuadre» se crea desde `app.html` al enlazar eventos y se inserta en la barra; por
   eso el contenedor pasa a 5 columnas con un `style` en línea. El botón lleva
   `data-solo-escritura="1"`, así que CONSULTA no lo ve.
5. **Familia «SIN CLASIFICAR» de respaldo.** El ticket dice que las familias salen de
   `AGRUPACIONES COMERCIAL`. Si un artículo con stock o movimiento reciente no cae en ningún
   cajón (catálogo incompleto), se añade una familia «SIN CLASIFICAR» al final para que no
   desaparezca del cuadre (coherente con D-029). Si la agrupación ya define ese cajón, se
   respeta su orden y color.
6. **Artículos con 0 cajas pero movimiento reciente.** La regla del ticket es por familia
   («stock > 0 o algún artículo con movimiento en los últimos 7 días»). Se incluyen en la
   lista los artículos con 0 cajas si tuvieron movimiento reciente, para poder confirmar el
   cero; el resto de artículos a 0 sin movimiento no se muestran.
7. **Ajustes de una en una.** `MovementService` no tiene un método para aplicar varios
   movimientos bajo un único bloqueo y persistencia, y el ticket prohíbe tocarlo sin
   preguntar. Se aplican en orden con `registrarAjuste`; si falla uno, se devuelven
   `aplicados` y `no_aplicados`, y cada aplicado se puede anular con `apiAnularAjuste`. Esto
   es exactamente el camino alternativo que permite el ticket; queda anotado aquí como pide.
8. **Fila de `CUADRES` después de los ajustes.** Se escribe al final, cuando todos los ajustes
   se han aplicado. Si la escritura de `CUADRES` falla después, se devuelve
   `status: 'ERROR_GUARDADO'` con los `aplicados` para que se puedan anular; el ticket no
   define ese caso.
9. **`ultimo_cuadre.ajustes`.** El ticket no fija el tipo. Se devuelve el número de ids de
   `ids_ajustes` (0 si la familia cuadró entera). `cajas` de cada familia es la suma de los
   `deberia` de sus artículos incluidos.
10. **Orden de `CUADRES` en `SCHEMA_DEFINITIONS`.** Se inserta antes de `USUARIOS` porque la
    prueba de T-020 exige que `USUARIOS` siga siendo la última hoja del esquema. No cambia el
    comportamiento de ninguna hoja.
11. **`hay` como texto numérico.** El servidor acepta `"7"` además del número `7` (la interfaz
    envía números, pero el campo nativo es de texto); rechaza decimales, negativos y cualquier
    texto no numérico. Un valor vacío o solo espacios significa «cuadra».
12. **Maqueta.** El enlace de Claude Artifacts pide sesión y no se pudo abrir desde este
    entorno; la pantalla se ha construido con la descripción del ticket, el patrón de
    `parte.html` y los tokens de `estilos.html`. Las capturas están en `logs/T-040/` con datos
    ficticios.
13. **Pruebas extra.** Además de los 8 puntos de aceptación, la suite incluye un caso 0
    (esquema `CUADRES` idempotente) y un caso 9 (include, navegación, accesibilidad y tamaños
    mínimos de la pantalla). No cambian comportamiento de producto.
