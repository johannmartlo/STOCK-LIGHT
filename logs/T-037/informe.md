# T-037 — Informe de entrega

## Resumen (5 líneas)

1. Rama `ticket/T-037-fecha-corte`, creada desde `origin/main` `f3c0d2b`; el primer commit
   (`14a4e6a`) contiene solo el ticket, sin editar.
2. `FECHA_CORTE_IMPORTACION` se lee en `Config`, se fija con
   `adminConfigurarFechaCorte` y vacía significa «sin corte»; el estado nuevo
   `ANTERIOR_AL_CORTE` no genera movimientos, pendientes, versiones ni filas en `DOCUMENTOS`.
3. El corte se aplica por línea antes de normalizar equivalencias y clasificar; un documento
   cuyas líneas quedan todas anteriores se cuenta aparte en la previsualización y en
   `IMPORTACIONES.lineas_anteriores_corte` (columna al final).
4. La tarjeta de Importar muestra la fila gris de anteriores al stock inicial; `IMPORT_SPECS`,
   `DATA_MODEL` y `PUESTA_EN_MARCHA` documentan la propiedad, el estado y el paso posterior
   al stock inicial.
5. `node test/run_all.js`: **44 suites, 435 pruebas, 0 fallos**. Sin merge.

## git status

```text
On branch ticket/T-037-fecha-corte
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

## git log --oneline -5

```text
026a009 feat(T-037): fecha de corte de la importacion
14a4e6a docs(tickets): anadir T-037 fecha de corte
f3c0d2b docs(T-036): anotar correccion de recepciones
efb7aeb docs(T-036): corregir compras por recepciones
fcc6135 docs(T-036): anadir informe de entrega
```

## Dudas (cambios no pedidos por el ticket)

1. **Corte por línea y documento.** Marco cada línea con fecha ≤ corte; un documento se
   considera anterior si **todas** sus líneas lo están. Los documentos reales tienen una sola
   fecha, pero si llegara un documento con líneas de fechas distintas, las posteriores se
   clasificarían y las anteriores quedarían `ANTERIOR_AL_CORTE`.
2. **Contador de líneas.** `lineas_anteriores_corte` cuenta líneas, no documentos, como dice
   el nombre y el ticket.
3. **Fuente antes que corte.** El rechazo por `FUENTE_ENTRADAS` se comprueba antes del corte
   (un CSV de COMPRAS con fuente RECEPCIONES se rechaza, aunque sea antiguo). La regla de
   prioridad del ticket nombra serie, seguimiento, exclusiones y equivalencias, no la fuente.
4. **Reimportación ya confirmada.** Para que un CSV mixto reimportado devuelva
   `ANTERIOR_AL_CORTE` y `YA_IMPORTADO` por documento, el retorno temprano de `confirmar`
   ahora incluye `documentos` y `resumen`. Es un cambio de forma del resultado, no de
   escritura.
5. **Barra de la tarjeta.** Además de la fila gris pedida, añadí el tramo gris de
   `ANTERIOR_AL_CORTE` a la barra de proporciones, como ya se hace con clientes excluidos.
6. **Retorno de `adminConfigurarFechaCorte`.** Devuelve `anterior`, `nuevo`, `nueva`,
   `fechaAnterior` y `fechaNueva` para cubrir la redacción «valor anterior y nuevo»; el
   ticket no fijaba los nombres.
7. **Campos extra en la previsualización.** Añadí `lineasAnterioresCorte` en la parte superior
   y `totales.anterioresCorte`; no estaban nombrados en el ticket.
8. **Solo CSV.** El corte no toca stock inicial, reprocesos ni ajustes manuales. En la prueba
   de 30 semillas el stock inicial se crea con un movimiento manual del 26/11 y se excluye de
   la comprobación de «ningún movimiento de documentos ≤ corte».
9. **Estado nuevo en el clasificador.** Añadí `ANTERIOR_AL_CORTE` a la lista de estados de
   `agruparEnDocumentos` para que el resumen y los documentos lo cuenten. No se añadió lógica
   de clasificación para él: las líneas se marcan antes de clasificar.
10. **Sin fixture nuevo.** El ticket no pedía uno; las pruebas generan ventas y recepciones
    ficticias con los formatos reales.
11. **Fecha inválida en la propiedad.** `getFechaCorteImportacionConfig` también valida una
    propiedad guardada inválida y lanza; `adminConfigurarFechaCorte` valida antes de escribir,
    así que una fecha mal formada no cambia el valor anterior.
12. **No se tocaron** `MovementService.js`, `Libro.js`, `InventoryEngine.js`,
    `CorreccionService.js` ni `StockInicialService.js`.
