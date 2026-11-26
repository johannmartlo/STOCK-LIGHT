# T-031 — Informe de entrega

## Resumen (5 líneas)

1. Rama `ticket/T-031-exclusiones`, creada desde `origin/main` `c1cbdbe`; el primer commit
   (`e788b0d`) contiene solo el ticket, sin editar.
2. Nueva hoja `CLIENTES_EXCLUIDOS` y estado `CLIENTE_EXCLUIDO`: las ventas a clientes
   excluidos no generan movimientos ni pendientes y se cuentan en
   `IMPORTACIONES.lineas_cliente_excluido`.
3. `src/Exclusiones.js` añade `adminConfigurarClientesExcluidos` y
   `adminConfigurarArticulosFuera`, idempotentes y con `exigirPropietario_`; los nombres
   comerciales fuera se implementan como reglas `SEGUIMIENTO = NO` con prioridad 1.
4. `apiListarExclusiones` (CONSULTA) y documentación en `BUSINESS_RULES.md`,
   `IMPORT_SPECS.md`, `DATA_MODEL.md` y `docs/API_PUBLICA.md`; sin nombres reales.
5. `node test/run_all.js`: **37 suites, 367 pruebas, 0 fallos**. Sin merge.

## git status

Salida capturada tras el commit de trabajo `b2be5b6`, antes del commit que añade este informe.

```text
On branch ticket/T-031-exclusiones
Your branch is ahead of 'origin/main' by 2 commits.
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
b2be5b6 feat(T-031): exclusiones de clientes y nombres comerciales fuera
e788b0d docs(tickets): anadir T-031 exclusiones
c1cbdbe docs(T-030): completar informe de entrega
6213c2b fix(T-030): lector CSV por columnas para formatos reales
4b01200 docs(tickets): anadir T-030 lector por columnas
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
    `IMPORT_SPECS.md` y 8 de `BUSINESS_RULES.md`; el ticket pedía documentar las reglas, pero
    no fijaba la numeración ni la extensión.
12. **No se añadieron nombres reales.** Todos los ejemplos y pruebas usan `CLIENTE FICTICIO`,
    `DESTINATARIO INVENTADO`, `NOMBRE COMERCIAL X/Y` y similares.
