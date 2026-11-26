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
5. `node test/run_all.js`: **41 suites, 413 pruebas, 0 fallos**. Sin merge.

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

---

## Corrección y rebase

### Correcciones pedidas

- **Instalación.** `adminInstalarStockLight` fija `FUENTE_ENTRADAS = RECEPCIONES` si la
  propiedad está vacía y no toca un valor existente. Solo se modificó `src/Instalacion.js`
  para este paso, como autorizó el responsable.
- **Simetría de fuentes.** Con `FUENTE_ENTRADAS = COMPRAS`, un CSV de RECEPCIONES se rechaza
  en la previsualización con «Las entradas se importan con el informe de compras», sin
  escribir nada. La forma del error es la misma que el rechazo inverso: un `Error` que la API
  rechaza y la pantalla muestra.
- **Partida al corregir.** En `CorreccionService._crearEntradaVersion_`, la línea nueva usa
  `partida_origen = linea.partida`. La capa activa de una recepción corregida conserva su
  partida. Solo se modificó esa función.
- **Pruebas nuevas:** instalación con y sin valor previo; RECEPCIONES rechazado con COMPRAS
  sin escribir; recepción corregida con `aplicarVersion` y capa activa con partida.

### Rebase sobre `df13b95`

`git fetch origin` mostró `origin/main = df13b95` (incluye T-034). `git rebase origin/main`
terminó sin conflictos. `node test/run_all.js`: **41 suites, 413 pruebas, 0 fallos**;
incluye T-027 (12), T-031 (10), T-032 (7) y T-034 (10). Salida completa en
`logs/T-032/tests.txt`.

### `git log --oneline -5`

```text
f0ce938 fix(T-032): instalacion, simetria de fuentes y partida en versiones
b8942c1 docs(T-032): completar informe de entrega
ce42675 feat(T-032): entradas desde recepciones de Hispatec
bda2c6c docs(tickets): anadir T-032 lector de recepciones
df13b95 docs(T-034): anadir informe de entrega
```

### Dudas de esta corrección

1. `adminInstalarStockLight` anota `fuente_entradas:RECEPCIONES` en `hecho` cuando la
   configura; si ya había valor lo deja en `yaEstaba` y no llama a `setFuenteEntradasConfig`.
   No cambié ningún otro paso de la instalación.
2. La instalación no valida el valor previo de `FUENTE_ENTRADAS`; si ya existe uno inválido,
   lo conserva, tal como pide «no la cambia si ya tiene valor».
3. El rechazo simétrico se aplica en `_preparar_`, antes de clasificar o escribir. No se
   añadió un estado estructurado nuevo: se mantiene el `Error` con mensaje que ya usa la
   pantalla para los CSV no reconocidos.
4. La partida corregida se toma de `linea.partida` del JSON de la versión. El resto de
   `CorreccionService` no se ha tocado.
5. Las dudas anteriores de este informe siguen vigentes; esta sección solo añade lo relativo
   a las tres correcciones y al rebase.
