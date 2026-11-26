# T-029 — Informe de entrega

## Resumen (5 líneas)

1. Rama `ticket/T-029-parte-noche`, creada desde `origin/main` `1581b23`; el primer commit
   (`d78536d`) contiene solo el ticket, sin editar.
2. Nuevos `src/ParteService.js` (parte de solo lectura a partir de `InicioService.obtenerInicio()`)
   y `src/NombresLegibles.js` (mismas reglas que el cliente), con `texto` para WhatsApp y
   `html` para correo.
3. Añadidos `apiObtenerParte` (LECTURA/CONSULTA), `adminConfigurarParte`,
   `adminInstalarParteDiario` y `adminEnviarParteAhora` (ADMIN), con `enviarParteDiario_`
   por `MailApp` a `PARTE_DESTINATARIOS` y registro en `LOG_OPERACIONES`.
4. Actualizados `docs/API_PUBLICA.md` y el paso «Parte de la noche» de
   `docs/PUESTA_EN_MARCHA.md`.
5. `node test/run_all.js`: **35 suites, 357 pruebas, 0 fallos**. Sin merge.

## Texto de un parte de ejemplo (datos ficticios)

```text
STOCK · 26/11 · 21:00
Total: 2.522 cajas

MORESCO · 1.337
I GG Cartón 40x30 686 · I G Cartón 40x30 424 · I M Cartón 40x30 227
Sale primero: 10/11 (16 días)

RAMA · 352
Extra G Caja 352
Sale primero: 20/11 (6 días)

CARTÓN · 833
I Caja 833
Sale primero: 22/11 (4 días)

Pendientes: 2 ventas sin stock · Importado hasta: C 26/11 · V 26/11
```

## git status

Salida capturada tras el commit de trabajo `804580f`, antes del commit que añade este informe.

```text
On branch ticket/T-029-parte-noche
Your branch is ahead of 'origin/main' by 2 commits.
  (use "git push" to publish your local commits)

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	logs/T-011/fusion.md
	logs/T-026/fusion.md

nothing added to commit but untracked files present (use "git add" to track)
```

`logs/T-011/fusion.md` y `logs/T-026/fusion.md` son archivos pendientes de tickets
anteriores; no forman parte de T-029 y no se han incluido en ningún commit.

## git log --oneline -5

```text
804580f feat(T-029): parte de stock de la noche en servidor
d78536d docs(tickets): anadir T-029 parte de noche
1581b23 docs(T-024): anadir seccion de correccion al informe
7ec78c3 fix(T-024): correcciones de existencias, nombres legibles, desglose, buscador movil, WhatsApp y rol CONSULTA
0b458ba docs(T-024): completar informe de entrega
```

## Dudas (cambios no pedidos por el ticket)

1. **Cabeceras de variedad en mayúsculas.** El formato del ticket muestra `MORESCO · 1.337`;
   el cliente devuelve `Moresco` con `nombreLegible`. En el parte usé
   `nombreLegible(grupo).toUpperCase()` para respetar el ejemplo. El resto de nombres
   (artículos y envases) usa la misma regla que el cliente.
2. **`etiquetaArticuloEnVariedad_` en `NombresLegibles.js`.** Además de `nombreLegible`,
   porté la función que quita el prefijo de la variedad al artículo (`Moresco I GG` → `I GG`).
   No estaba nombrada en el ticket, pero es necesaria para que el desglose coincida con la
   pantalla.
3. **Alias `nombreLegible`.** El ticket no fija el nombre de la función del servidor. Dejé
   `nombreLegible_` (privada para Apps Script) y exporté `nombreLegible` como alias para las
   pruebas y para que coincida con el nombre del cliente.
4. **Texto de pendientes ampliado.** El ejemplo solo muestra «2 ventas sin stock». Si hay
   otros motivos, el bloque añade «documentos con seguimiento desconocido» o «modificados en
   ERP»; si no hay desglose, usa «documentos pendientes». Es una decisión de redacción no
   pedida.
5. **`Importado hasta` con guiones.** Si no hay compras o ventas importadas, se muestra
   `C —` / `V —`; el ticket solo dice que el bloque sale siempre.
6. **Propiedad `PARTE_HORA`.** El ticket solo nombra `PARTE_DESTINATARIOS`; para guardar la
   hora usé `PARTE_HORA` en ScriptProperties.
7. **`adminConfigurarParte` acepta lista vacía.** No valida que haya al menos un
   destinatario: guarda vacío y `enviarParteDiario_` lo trata como «sin destinatarios». El
   ticket no dice qué hacer al configurar una lista vacía.
8. **`enviarParteDiario_` vive en `ParteService.js`** y no en `Código.js`; termina en `_`, así
   que no es una función pública. Las funciones `admin*` de `Código.js` la llaman.
9. **Solo se registra el envío cuando falla o no hay destinatarios.** El ticket exige esos
   dos registros; no añadí una línea de éxito en `LOG_OPERACIONES`.
10. **`generarParte(options)` y funciones `admin*` aceptan `options`.** Son parámetros
    opcionales para inyectar reloj, servicio de inicio, MailApp o propiedades en las pruebas;
    las firmas del ticket no los muestran.
11. **`datos` es el objeto completo de `obtenerInicio()`.** El ticket no detalla su forma; lo
    devuelvo tal cual para que la pantalla futura pueda reutilizarlo.
12. **El `html` incluye una tabla con una fila por variedad.** El ticket pide «una tabla
    sencilla»; elegí una tabla de dos columnas (variedad/cajas) con el desglose y la venta
    primera dentro de la celda de variedad.
