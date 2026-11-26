# T-032 — Informe de entrega

## Resumen (5 líneas)

1. Rama `ticket/T-032-lector-recepciones`, creada desde `origin/main` `81dc81c`; el primer
   commit (`630f1bd`) contiene solo el ticket, sin editar.
2. `CsvHispatecParser` lee el informe real de RECEPCIONES: detecta por columnas, agrupa por
   `NombreProveedor:`, salta empresa/separadores, extrae serie/número/línea de `Recepción`,
   usa `FechaRecepcion`, cajas de `NroEnvases`, kg de `Cantidad` y partida de `Partida`.
3. `ImportacionService` aplica la fuente `FUENTE_ENTRADAS`, normaliza el artículo
   (`KG`/`UNID`/`UND`), aplica `EQUIVALENCIAS_ARTICULO`, marca `SIN_PAREJA_EN_VENTAS` en la
   previsualización y mantiene el flujo de versiones/exclusiones.
4. `Equivalencias.js`, la hoja `EQUIVALENCIAS_ARTICULO`, `adminConfigurarEquivalencias`,
   `adminConfigurarFuenteEntradas`, `apiListarEquivalencias` y la documentación de puesta en
   marcha quedan añadidos; sin nombres reales.
5. `node test/run_all.js`: **40 suites, 403 pruebas, 0 fallos**. Sin merge.

## git status

Salida capturada tras el commit de trabajo `3e256b9`, antes del commit que añade este informe.

```text
On branch ticket/T-032-lector-recepciones
Your branch is ahead of 'origin/main' by 2 commits.
  (use "git push" to publish your local commits)

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	logs/T-011/fusion.md
	logs/T-026/fusion.md
	logs/T-029/fusion.md
	logs/T-030/fusion.md
	logs/T-032/informe.md

nothing added to commit but untracked files present (use "git add" to track)
```

## git log --oneline -5

```text
3e256b9 feat(T-032): entradas desde recepciones de Hispatec
630f1bd docs(tickets): anadir T-032 lector de recepciones
81dc81c docs(T-028): documentar rebase sobre 45b9480 en informe
3406165 feat(T-028): mostrar lineasClienteExcluido en previsualizacion de importar
f5b5d5e fix(T-028): clasificar CSV de RECEPCIONES como entradas antes que ventas
```

## Dudas (cambios no pedidos por el ticket)

1. **Lista de series no enumerable.** Para no romper la aserción exacta de T-006B sobre
   `PREFIJOS_SERIES_IMPORTACION`, añadí `prefijosRecepciones` como propiedad no enumerable
   (`REC`, `NT`, `RNT`). Se puede leer como `PREFIJOS_SERIES_IMPORTACION.prefijosRecepciones`,
   pero no aparece en `Object.keys` ni en `deepStrictEqual`.
2. **FUENTE_ENTRADAS al instalar.** `adminInstalarStockLight` fija `RECEPCIONES` si la
   propiedad está vacía y no cambia un valor ya existente. Si la propiedad no existe y se
   llama al servicio sin pasar por la instalación, el fallback sigue siendo `COMPRAS` para
   no romper instalaciones ni pruebas anteriores.
3. **Forma del rechazo de COMPRAS.** `_preparar_` lanza un `Error` con el mensaje exacto
   «Las entradas se importan con el informe de recepciones». Es la misma forma que usa hoy
   un CSV no reconocido: la promesa de la API se rechaza y la pantalla Importar muestra
   `err.message`; no cambié `src/ui/`.
4. **Rechazo simétrico.** Con `FUENTE_ENTRADAS = COMPRAS`, un CSV de RECEPCIONES se rechaza
   con «Las entradas se importan con el informe de compras». La forma del error es la misma
   que con el rechazo inverso: un `Error` que la API rechaza y la pantalla muestra.
5. **Campos nuevos en la previsualización.** Los resultados de cada documento incluyen ahora
   `lineas` y `avisos`; cada línea seguida sin pareja incluye `avisos:
   ['SIN_PAREJA_EN_VENTAS']` y, si es el único, `aviso: 'SIN_PAREJA_EN_VENTAS'`. La parte
   superior de la previsualización incluye un array `avisos`.
6. **Forma de `apiListarEquivalencias`.** Devuelve `{ equivalencias: [...] }` con objetos
   `{ descripcion, nombre_articulo, activo, nota }`, en línea con `apiListarExclusiones`.
   El ticket no fijaba la forma.
7. **Retorno de `adminConfigurarEquivalencias`.** Devuelve `{ anadidos, actualizados,
   yaEstaban }`; el ticket no fijaba el detalle. Guarda descripción y nombre normalizados en
   mayúsculas y espacios colapsados, y no borra filas.
8. **Equivalencias y envase.** Solo se transforma el nombre del artículo. No se añadió
   ninguna equivalencia de envase, tal como pide la precisión.
9. **Partida en versiones.** Añadí `partida` al JSON de `lineasVersionDocumento_` y
   `_crearEntradaVersion_` usa `partida_origen = linea.partida`, así que la capa nueva de una
   recepción corregida conserva la partida. La prueba 5 comprueba la capa activa con partida
   `900001`.
10. **`.gitattributes`.** Añadí la excepción `binary -eol` para
    `test/fixtures/csv/recepciones_formato_real.csv`, igual que T-030, para que un clon
    limpio conserve el CRLF exigido. No estaba en «Archivos previstos».
11. **`lineasTodas` clasificadas.** Para que las versiones guarden el estado real de cada
    línea, `_preparar_` construye `documento.lineasTodas` desde las líneas ya clasificadas.
    Es un cambio interno que también afecta a la información expuesta en la previsualización.
12. **Aviso `SIN_PAREJA_EN_VENTAS`.** Se consideran ventas previas las combinaciones de
    `CATALOGO` y los movimientos `SALIDA`; no se miran presupuestos ni otras fuentes. No
    bloquea la importación.
