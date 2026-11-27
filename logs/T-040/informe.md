# T-040 — Informe de entrega

## Resumen (5 líneas)

1. Rama `ticket/T-040-cuadre-noche`, creada desde `main` = `43c22cd`. El primer commit
   (`2092b5e`) contiene solo el ticket sin editar; la implementación va en `6b2b293`.
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
5. `node test/run_all.js`: **47 suites, 468 pruebas, 0 fallos** (`logs/T-040/tests.txt`). Sin
   merge, sin `clasp push`; no se tocaron `MovementService.js`, `Libro.js`,
   `InventoryEngine.js`, `importacion/`, `NombresLegibles.js` ni `InicioService.js`.

## git status

```text
On branch ticket/T-040-cuadre-noche
Untracked files:
  (use "git add <file>..." to include in what will be committed)
	logs/T-011/fusion.md
	logs/T-026/fusion.md
	logs/T-029/fusion.md
	logs/T-030/fusion.md
	logs/T-040/

nothing added to commit but untracked files present (use "git add" to track)
```

`logs/T-040/` es esta entrega (informe, aceptación, salida de pruebas y capturas) y entra en
el commit siguiente. Los `logs/*/fusion.md` ya estaban sin seguimiento antes de empezar.

## git log --oneline -5

```text
6b2b293 feat(T-040): cuadre de la noche por familia
2092b5e docs(tickets): anadir T-040 cuadre de la noche
43c22cd docs(T-039): anadir informe de entrega
4749c85 feat(T-039): orden por calibre y subtotales por categoria
5f2b9e1 docs(tickets): anadir T-039 orden por calibre
```

## Dudas (cambios no pedidos por el ticket)

1. **`src/Seguridad.js` (PERMISOS_API).** No está en «Archivos previstos», pero sin las dos
   entradas `apiObtenerCuadre: 'ENCARGADO'` y `apiConfirmarCuadreFamilia: 'ENCARGADO'` el
   despachador las rechaza con `API_NO_PERMITIDA` y la prueba de cobertura de T-020 falla
   (`docs/API_PUBLICA.md` exige que toda función LECTURA/ESCRITURA esté en `PERMISOS_API`).
   Es el mismo archivo del carril B; no se cambió nada más.
2. **`id_cuadre` en la respuesta de `obtenerCuadre()`.** La forma del ticket solo enumera
   `generado_en` y `familias`, pero `confirmarFamilia` necesita un `id_cuadre` que agrupe las
   familias de una misma sesión de cuadre. Se añade como campo extra generado con
   `nuevoId('CUADRE')`; no se envía desde el navegador.
3. **Acción del móvil inyectada desde `app.html`.** La barra `.sl-mobile-actions` vive en
   `existencias.html`, que no está en «Archivos previstos». Para no tocar ese archivo, la
   acción «Cuadre» se crea desde `app.html` al enlazar eventos y se inserta en la barra; por
   eso el contenedor pasa a 5 columnas con un `style` en línea. El botón lleva
   `data-solo-escritura="1"`, así que CONSULTA no lo ve.
4. **Familia «SIN CLASIFICAR» de respaldo.** El ticket dice que las familias salen de
   `AGRUPACIONES COMERCIAL`. Si un artículo con stock o movimiento reciente no cae en ningún
   cajón (catálogo incompleto), se añade una familia «SIN CLASIFICAR» al final para que no
   desaparezca del cuadre (coherente con D-029). Si la agrupación ya define ese cajón, se
   respeta su orden y color.
5. **Artículos con 0 cajas pero movimiento reciente.** La regla del ticket es por familia
   («stock > 0 o algún artículo con movimiento en los últimos 7 días»). Se incluyen en la
   lista los artículos con 0 cajas si tuvieron movimiento reciente, para poder confirmar el
   cero; el resto de artículos a 0 sin movimiento no se muestran.
6. **Ajustes de una en una.** `MovementService` no tiene un método para aplicar varios
   movimientos bajo un único bloqueo y persistencia, y el ticket prohíbe tocarlo sin
   preguntar. Se aplican en orden con `registrarAjuste`; si falla uno, se devuelven
   `aplicados` y `no_aplicados`, y cada aplicado se puede anular con `apiAnularAjuste`. Esto
   es exactamente el camino alternativo que permite el ticket; queda anotado aquí como pide.
7. **Fila de `CUADRES` después de los ajustes.** Se escribe al final, cuando todos los ajustes
   se han aplicado. Si la escritura de `CUADRES` falla después, se devuelve
   `status: 'ERROR_GUARDADO'` con los `aplicados` para que se puedan anular; el ticket no
   define ese caso.
8. **`ultimo_cuadre.ajustes`.** El ticket no fija el tipo. Se devuelve el número de ids de
   `ids_ajustes` (0 si la familia cuadró entera). `cajas` de cada familia es la suma de los
   `deberia` de sus artículos incluidos.
9. **Orden de `CUADRES` en `SCHEMA_DEFINITIONS`.** Se inserta antes de `USUARIOS` porque la
   prueba de T-020 exige que `USUARIOS` siga siendo la última hoja del esquema. No cambia el
   comportamiento de ninguna hoja.
10. **`hay` como texto numérico.** El servidor acepta `"7"` además del número `7` (la interfaz
    envía números, pero el campo nativo es de texto); rechaza decimales, negativos y cualquier
    texto no numérico. Un valor vacío o solo espacios significa «cuadra».
11. **Maqueta.** El enlace de Claude Artifacts pide sesión y no se pudo abrir desde este
    entorno; la pantalla se ha construido con la descripción del ticket, el patrón de
    `parte.html` y los tokens de `estilos.html`. Las capturas están en `logs/T-040/` con datos
    ficticios.
12. **Pruebas extra.** Además de los 8 puntos de aceptación, la suite incluye un caso 0
    (esquema `CUADRES` idempotente) y un caso 9 (include, navegación, accesibilidad y tamaños
    mínimos de la pantalla). No cambian comportamiento de producto.
