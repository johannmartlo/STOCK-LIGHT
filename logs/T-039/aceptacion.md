# T-039 — Aceptación

Ticket: `docs/tickets/T-039-orden-calibre.md`.
Rama: `ticket/T-039-orden-calibre`, creada desde `main` `d3f4ba0`.
Primer commit de la rama: `5f2b9e1`, solo el archivo del ticket sin editar.
Resultado de `node test/run_all.js`: **46 suites, 458 pruebas, 0 fallos**. Salida completa en
`logs/T-039/tests.txt`.

## Aceptación 1 — orden por calibre y tres bloques de ROJO

- **Prueba:** caso 1 de `test/t039_orden_calibre.test.js`.
- Seis capas ficticias en una sola variedad: `TOMATE FICTICIO ROJO II S/C` (300),
  `… ROJO I G` (10), `… ROJO I GGG` (50), `… ROJO I GG` (20), `… ROJO EXTRA GG` (5) y
  `… AMARILLO I G` (1).
- Orden de las partidas: AMARILLO I G · ROJO EXTRA GG · ROJO I GGG · ROJO I GG · ROJO I G ·
  ROJO II S/C.
- `variedades[0].desglose`: cuatro bloques (AMARILLO · Cat. I y los tres de ROJO). Los tres
  bloques de ROJO tienen subtotales 5 / 80 / 300 y sus líneas van de calibre grande a pequeño.
- `construirDesgloseOrdenado(v.partidas)` coincide con `v.desglose`.
- En la interfaz, `construirDesgloseHtml` pinta «Rojo · Cat. I» y sus cajas antes de las líneas
  del bloque, y `construirTextoWhatsApp` sigue el mismo orden sin subtotales.

## Aceptación 2 — fecha e id_capa como desempate

- **Prueba:** caso 2.
- Cuatro capas del mismo artículo y envase: la del 05/11 sale primero; las tres del 10/11 salen
  por `id_capa` ascendente (`CAPA-1`, `CAPA-3`, `CAPA-4`). Las cuatro se funden en una sola
  línea de desglose de 100 cajas.

## Aceptación 3 — sale_primero = fecha mínima

- **Prueba:** caso 3.
- `TOMATE FICTICIO ALFA I G` (18/11) abre el orden nuevo y `TOMATE FICTICIO ZETA I G` (08/11)
  va después; `sale_primero` sigue siendo `2026-11-08` y `dias` = 12 (referencia 20/11).

## Aceptación 4 — sin calibre/categoría y con peso

- **Prueba:** caso 4.
- `TOMATE FICTICIO AZUL I GG` (calibre G), `… AZUL 500G` (peso), `… AZUL` (S/C),
  `… AZUL UND` (otro → rango 9) y `… BLANCO I G`: el orden es GG · 500G · S/C · UND y después
  la otra variedad base; los bloques son AZUL · Cat. I (4), AZUL · '' (6) y BLANCO · Cat. I (5).
- `claveOrdenArticulo` devuelve rangoCalibre 7 para `500G`, 8 para S/C y 9 para `UND`.

## Aceptación 5 — orden total

- **Prueba:** caso 5.
- 200 pares artículo + envase únicos (5 variedades base × 4 categorías × 10 calibres ×
  4 envases) barajados con 30 semillas distintas: siempre el mismo orden. Además el orden es
  estricto entre pares distintos y el comparador es antisimétrico.

## Aceptación 6 — compatibilidad del cliente

- **Prueba:** caso 6.
- Sin `desglose`, `calcularDesgloseArticulos` mantiene el orden por cajas (M 410 · GG 310 ·
  G 220). Con `desglose`, respeta el orden recibido aunque no coincida con el de cajas.
- `construirDesgloseHtml` pinta subtotales solo cuando la variedad tiene más de un bloque; con
  un bloque no añade la fila.

## Aceptación 7 — pruebas

- `node test/run_all.js`: **46 suites, 458 pruebas, 0 fallos**.
- Salida completa en `logs/T-039/tests.txt`.
- **Cambio autorizado en una prueba existente:** se quitó una sola aserción de
  `test/t024_inicio.test.js` (caso 1): `v.partidas[0].fecha === fechaMin`. La regla 2 de T-039
  ordena `partidas` por variedad/categoría/calibre, así que `partidas[0]` deja de ser la más
  antigua por diseño (el ticket lo asume al calcular `sale_primero` con el mínimo). Se mantiene
  la aserción `v.sale_primero === fechaMin` y el resto de T-024 sin tocar.

## Documentación

- `docs/API_PUBLICA.md`: clasificación de `claveOrdenArticulo`, `compararArticulos` y
  `construirDesgloseOrdenado` (INTERNA) y sección con el campo nuevo
  `variedades[].desglose` de la respuesta de inicio (campos, orden y subtotales).
- No se tocó `DATA_MODEL.md`: el campo es calculado en la respuesta, no una columna persistida.

## Archivos tocados

- `src/OrdenExistencias.js` (nuevo).
- `src/InicioService.js` (solo el `require` del módulo nuevo y `construirVariedad`).
- `src/ui/app.html` (solo `calcularDesgloseArticulos`, `construirDesgloseHtml` y la lista de
  exports de `window.SLApp` para poder probar el desglose).
- `docs/API_PUBLICA.md`.
- `test/t039_orden_calibre.test.js` (nuevo) y `test/t024_inicio.test.js` (aserción obsoleta
  retirada, autorizada).
- `logs/T-039/*`.
