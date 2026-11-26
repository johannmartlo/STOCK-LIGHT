# T-031 — Informe de entrega

## Resumen (5 líneas)

1. Rama `ticket/T-031-exclusiones`, creada originalmente desde `origin/main` `c1cbdbe` y
   rebasada sobre `9c54b7b`; el primer commit tras el rebase (`aba247a`) contiene solo el
   ticket, sin editar.
2. Nueva hoja `CLIENTES_EXCLUIDOS` y estado `CLIENTE_EXCLUIDO`: las ventas a clientes
   excluidos no generan movimientos ni pendientes y se cuentan en
   `IMPORTACIONES.lineas_cliente_excluido`.
3. `src/Exclusiones.js` añade `adminConfigurarClientesExcluidos` y
   `adminConfigurarArticulosFuera`, idempotentes y con `exigirPropietario_`; los nombres
   comerciales fuera se implementan como reglas `SEGUIMIENTO = NO` con prioridad 1.
4. `apiListarExclusiones` (CONSULTA) y documentación en `BUSINESS_RULES.md`,
   `IMPORT_SPECS.md`, `DATA_MODEL.md` y `docs/API_PUBLICA.md`; sin nombres reales.
5. `node test/run_all.js`: **38 suites, 383 pruebas, 0 fallos** (incluye T-027 y T-031).
   Sin merge.

## git status

Salida capturada tras el commit de pruebas `9bc10a9`, antes del commit que actualiza este
informe.

```text
On branch ticket/T-031-exclusiones
Your branch is ahead of 'origin/ticket/T-031-exclusiones' by 2 commits.
  (use "git push" to publish your local commits)

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	logs/T-011/fusion.md
	logs/T-026/fusion.md
	logs/T-029/fusion.md
	logs/T-030/fusion.md

nothing added to commit but untracked files present (use "git add" to track)
```

`logs/T-011/fusion.md`, `logs/T-026/fusion.md`, `logs/T-029/fusion.md` y
`logs/T-030/fusion.md` son archivos pendientes de tickets anteriores; no forman parte de
T-031 y no se han incluido en ningún commit.

## git log --oneline -5

```text
9bc10a9 docs(T-031): actualizar salida de pruebas
dd0efdb fix(T-031): registrar solo documentos totalmente excluidos
5b4ec16 docs(T-031): completar informe de entrega
b2be5b6 feat(T-031): exclusiones de clientes y nombres comerciales fuera
e788b0d docs(tickets): anadir T-031 exclusiones
```

## Dudas (cambios no pedidos por el ticket)

1. **`ImportacionService` también registra documentos totalmente excluidos en
   `DOCUMENTOS`.** El ticket decía «solo el recuento `lineas_cliente_excluido` y pasar la
   lista de excluidos al clasificador», pero la regla 1.4 pide que esos documentos queden
   registrados para que un CSV distinto con el mismo documento dé `YA_IMPORTADO`. Añadí el
   alta mínima del documento (estado `CONFIRMADO`, `total_cajas = 0`, firma y hash) después
   de aplicar el resto.
2. **Prioridad 1 para los nombres fuera.** El ticket dice «prioridad mayor» que la regla
   «TOMATE → SI» (prioridad 30). En este catálogo gana el número menor, así que usé 1. No
   cambié la prioridad de ninguna regla existente.
3. **Los patrones se guardan normalizados** (mayúsculas, sin acentos y con espacios
   colapsados), no con el texto original. La comparación y la idempotencia usan esa forma.
4. **Clientes inactivos.** `adminConfigurarClientesExcluidos` solo considera «ya estaba» un
   patrón activo. Si existe una fila inactiva con el mismo patrón, añade una nueva fila
   activa; no reactiva ni borra la anterior. El ticket no fija este caso.
5. **Reglas fuera creadas por T-031.** Se identifican por `observaciones = 'T-031 nombre
   comercial fuera'`. Si ya existe una regla manual del mismo patrón pero sin esa marca,
   `adminConfigurarArticulosFuera` crea otra regla en vez de modificarla. El ticket no
   distingue reglas manuales de las creadas por la administración.
6. **Devolución de las funciones admin.** Las dos devuelven `anadidos` y `yaEstaban`; la de
   artículos añade además `actualizados` cuando encuentra una regla de T-031 que necesita
   corrección. El ticket solo pide «qué se añadió y qué ya estaba».
7. **`apiListarExclusiones` devuelve listas de cadenas**, no filas completas:
   `{ clientesExcluidos: [...], articulosFuera: [...] }`. La pantalla futura puede necesitar
   más campos (nota, fecha, usuario); el ticket no fija la forma.
8. **`lineasClienteExcluido` en la previsualización y en `conteos`.** Además de
   `resumen.porEstado.CLIENTE_EXCLUIDO`, añadí esos dos campos de resumen; no estaban
   nombrados en el ticket.
9. **Estado del documento totalmente excluido.** Lo registro como `CONFIRMADO` con
   `total_cajas = 0`; el ticket no especifica el estado de proceso. No genera movimientos ni
   pendientes.
10. **Solo ventas CSV/PDF.** La exclusión de cliente se aplica a líneas con `origenDato`
    `CSV` o `PDF` y `tipoDoc = SALIDA`; una línea manual de otro origen no se marca
    `CLIENTE_EXCLUIDO`. El ticket habla de líneas de venta, pero no de ese detalle técnico.
11. **Documentación nueva.** Añadí las secciones 3.13 de `DATA_MODEL.md`, 2.5 de
    `IMPORT_SPECS.md` y 9 de `BUSINESS_RULES.md`; el ticket pedía documentar las reglas, pero
    no fijaba la numeración ni la extensión.
12. **No se añadieron nombres reales.** Todos los ejemplos y pruebas usan `CLIENTE FICTICIO`,
    `DESTINATARIO INVENTADO`, `NOMBRE COMERCIAL X/Y` y similares.

---

## Rebase sobre 9c54b7b

Las secciones «git status» y «git log» anteriores son del estado previo al rebase; el estado
final es el de esta sección. Rebase realizado sobre `9c54b7b` (incluye T-027). En el rebase
no se tocó `CorreccionService.js`; se modificó después, solo para el punto B de la
corrección exclusiones × versiones.

### Archivos con conflicto y resolución

- **`BUSINESS_RULES.md`**: T-027 había añadido la sección 8 «Correcciones desde Hispatec» y
  T-031 la sección 8 «Exclusiones de la Importación». Conservé íntegra la sección 8 de T-027
  y moví la de T-031 a la sección 9, con sus subsecciones 9.1, 9.2 y 9.3. No cambié ningún
  texto de T-027.
- **`src/Código.js`**: T-027 añadía `correccionMod` y su global `CorreccionService`; T-031
  añadía `exclusionesMod` y sus globales de exclusión. Conservé las dos declaraciones y los
  dos bloques de globales, y mantuve `apiListarExclusiones`.
- **`src/Seguridad.js`**: conservé los permisos de T-027
  (`apiListarVersionesPendientes`, `apiPrevisualizarVersion`, `apiPrevisualizarAnularAjuste`)
  y añadí `apiListarExclusiones: 'CONSULTA'`.

`DATA_MODEL.md`, `docs/API_PUBLICA.md`, `src/Repository.js` y
`src/importacion/ImportacionService.js` se fusionaron sin conflicto. Revisé el diff contra
`origin/main`: solo aparecen las adiciones de T-031; las líneas y funciones de T-027 siguen
intactas.

### Pruebas

`node test/run_all.js`: **38 suites, 383 pruebas, 0 fallos**. Incluye las 12 pruebas de T-027
y las 10 de T-031. Salida completa en `logs/T-031/tests.txt`.

### `git log --oneline -5`

```text
c3fcc3d docs(T-031): actualizar pruebas tras rebase
73f4062 docs(T-031): actualizar informe con el estado final
766cc43 docs(T-031): actualizar salida de pruebas
129b783 fix(T-031): registrar solo documentos totalmente excluidos
0808fe0 docs(T-031): completar informe de entrega
```

---

## Corrección exclusiones × versiones

### A. Versión con todas las líneas y su estado real

- `ImportacionService._preparar_` construye `documento.lineasTodas` desde las líneas ya
  clasificadas, no desde las líneas crudas del CSV.
- `_lineasVersionDocumento_` guarda **todas** las líneas con su estado real (`OK`,
  `PENDIENTE`, `CLIENTE_EXCLUIDO`, `NO_SEGUIDA`, etc.). Nunca pone `OK` por defecto.
- La diferencia de cajas del pendiente usa solo `doc.lineasOk` (las que mueven stock).

### B. Versión sin líneas OK

- `CorreccionService._contextoVersion_` ya no rechaza una versión sin líneas OK. Solo rechaza
  una versión sin líneas (`VERSION_SIN_LINEAS`).
- La cascada de T-027 se ejecuta igual: anula lo que hubiera aplicado y no crea movimientos
  nuevos.
- La previsualización y el resultado de aplicar incluyen
  `«La versión nueva no mueve stock»` en `mensaje`/`aviso` y
  `sin_movimientos_stock: true`.

### C. Albaranes totalmente excluidos

- Al importar un documento con todas sus líneas `CLIENTE_EXCLUIDO`, se registra también una
  versión de partida en `VERSIONES_DOCUMENTO` (`estado: 'BASE'`,
  `motivo: 'VERSION_INICIAL'`).
- Si después pasa a cliente normal, la versión nueva se aplica sobre esa base y crea la
  salida (o el pendiente por stock, con el todo o nada de T-027).
- Si solo cambian cajas y sigue excluido, **se aplica sin mover stock** y el pendiente queda
  resuelto. Elegí esta opción, en vez de no crear el pendiente, porque deja el documento y su
  versión coherentes y evita un `MODIFICADO_EN_ERP` imposible.
- Si no hay movimientos activos, `_contextoVersion_` usa la última versión `BASE` o
  `APLICADA` del documento para conocer la versión vigente. Así una corrección posterior de
  un documento que sigue sin movimientos no vuelve a caer en `DOCUMENTO_SIN_VERSION_ACTIVA`.

### Pruebas

- Casos nuevos 5 a 9 de `test/t031_exclusiones.test.js`:
  1. normal aplicada → excluida;
  2. excluida entera → cliente normal;
  3. excluida entera → cambian cajas y sigue excluida;
  4. normal → todas las líneas con nombre fuera;
  5. invariante de 30 semillas con lotes desordenados, reimportación, correcciones y
     ecuación final.
- `node test/run_all.js`: **38 suites, 383 pruebas, 0 fallos**. T-027 sigue con sus 12
  pruebas y T-031 tiene 10. Salida en `logs/T-031/tests.txt`.

### `git log --oneline -5`

```text
c70c01d fix(T-031): corregir versiones de documentos excluidos
31259fc docs(T-031): reflejar el rebase en la aceptacion e informe
2ff9573 docs(T-031): documentar rebase sobre 9c54b7b
c3fcc3d docs(T-031): actualizar pruebas tras rebase
73f4062 docs(T-031): actualizar informe con el estado final
```

### Dudas (cambios no pedidos)

1. **Estado `BASE` de la versión de partida.** El ticket pide «su versión de partida» pero no
   fija el estado. Usé `BASE` con `motivo: 'VERSION_INICIAL'` para distinguirla de
   `PENDIENTE`/`APLICADA`/`DESCARTADA`.
2. **Cajas que solo cambian en un excluido.** Elegí crear el pendiente normal de
   `MODIFICADO_EN_ERP` y aplicarlo sin mover stock, en vez de no crear pendiente. El resultado
   final no tiene pendientes activos y el stock no cambia.
3. **Fallback a la última versión `BASE`/`APLICADA` cuando no hay movimientos.** Es un cambio
   en `CorreccionService` más allá del rechazo de `VERSION_SIN_LINEAS_OK`, necesario para que
   un documento siga siendo corregible después de una versión sin movimientos.
4. **`VERSION_SIN_LINEAS`.** Para una versión vacía o corrupta mantengo un error, ahora con
   este nombre; antes ese caso también caía en `VERSION_SIN_LINEAS_OK`.
5. **`docFinal.total_lineas` ahora cuenta todas las líneas de la versión**, no solo las OK;
   `total_cajas` sigue contando solo las que mueven stock. La entidad y la fecha se toman de
   la primera línea nueva, aunque no sea OK.
6. **Campos nuevos `mensaje`, `aviso` y `sin_movimientos_stock`** en la previsualización y en
   el resultado de aplicar. No estaban en el contrato anterior.
7. **`lineasTodas` ahora lleva el estado de clasificación.** Es interno, pero cambia el
   contenido del objeto de documento que se usa para firma y versiones.
8. **La diferencia solo usa `lineasOk`.** Una línea `PENDIENTE` no se cuenta hasta que se
   aplique; es la interpretación de «líneas que mueven stock».
9. **La versión de partida se crea solo para documentos con todas las líneas
   `CLIENTE_EXCLUIDO`**, no para documentos con todas las líneas `NO_SEGUIDA` o de serie
   ignorada. El ticket habla de albaranes totalmente excluidos por cliente.
10. **El registro de la versión `BASE` se hace después de guardar `DOCUMENTOS` e
    `IMPORTACIONES`**, igual que el alta de documentos excluidos que ya existía. No añadí un
    lock nuevo.
