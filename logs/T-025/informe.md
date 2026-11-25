# T-025 — Informe de entrega

1. **Rama:** `ticket/T-025-servidor-operaciones`, creada desde `main` = `bb816bc`; commits `a89b4b3` (ticket sin editar) y el commit de implementación de esta entrega.
2. **Entrega:** `src/OperacionesService.js` nuevo, solo lectura, con sugerencias de cambio, evaluación de rendimiento, vista previa de anulaciones, historial de movimientos y búsqueda; más las cinco API en `src/Código.js`, `PERMISOS_API` y `docs/API_PUBLICA.md`.
3. **Pruebas:** `node test/run_all.js` → **32 suites, 352 pruebas, 0 fallos**; T-025 → 8/8; `t020_acceso.test.js` (18/18) y `t023_superficie.test.js` (8/8) en verde. Salida completa en `logs/T-025/tests.txt`.
4. **Aceptación:** los 8 puntos del ticket verificados; detalle en `logs/T-025/aceptacion.md`. No se ha tocado nada de interfaz, `MovementService`, `Libro`, `InventoryEngine`, `Reproceso`, catálogo ni importación.
5. **Dudas:** se listan abajo todos los cambios y decisiones que no están descritos literalmente en el ticket.

## git status

```text
 M docs/API_PUBLICA.md
 M "src/Código.js"
 M src/Seguridad.js
?? logs/T-025/
?? src/OperacionesService.js
?? test/t025_operaciones.test.js
```

## git log --oneline -5

```text
a89b4b3 docs(T-025): anadir ticket de servidor de operaciones
bb816bc docs(T-011): completar informe de entrega
288a6bc feat(T-011): instalacion, stock inicial y puesta en marcha
36fd197 docs(tickets): anadir T-011 puesta en marcha
c99e7d4 docs(T-008): actualizar informe con seccion de correccion
```

## Dudas

- **`apiEvaluarCambio` como API pública:** el ticket la describe como interna «o una API ligera». Se ha implementado la función interna `evaluarCambio_` y además se ha expuesto `apiEvaluarCambio` (LECTURA/CONSULTA) para que la pantalla pueda llamarla sin acceder a un método interno.
- **Semántica de `esperado` y `real`:** se interpretan como **proporciones** (cajas de destino por caja de origen), no como cajas absolutas. Por eso 60 → 86 devuelve `real = 1,43`. `desviacion_pct` se redondea a un decimal y el umbral estricto es «supera el 10 %».
- **Forma del historial:** el ticket no fija el objeto de retorno. Se devuelve `{ grupos: [{ fecha, elementos }], total, limite, cursor, siguiente_cursor }`. Cada elemento incluye además `variedades`, `fecha_negocio` y `anula_id` sobre los campos pedidos.
- **Identificadores del historial:** las entradas y ajustes usan el `id_movimiento`; las salidas se agrupan por `id_documento_ref` (una transacción por albarán, aunque tenga varias líneas); los cambios usan `id_reproceso`.
- **`cajas` de las anulaciones:** el elemento de tipo `anulación` devuelve `cajas = 0`. La transacción original queda marcada `anulado = true` y se excluye de la suma; así se cumple «no se cuenta dos veces» y la suma de no anulados coincide con el stock.
- **Valores de `tipo`:** se devuelven sin tilde (`destrio`, `anulacion`), como valores de máquina. Los filtros aceptan tanto `destrio`/`destrío` como `anulacion`/`anulación`, y también `stock inicial`/`stock_inicial`.
- **Vista previa de anulación:** se implementa ejecutando los métodos reales `anularEntrada`, `anularSalida` y `anularReproceso` sobre una copia completa en memoria del entorno. No se copia ni se modifica ninguna comprobación de `MovementService`. Esa es la garantía del invariante `posible`.
- **Nombres de los efectos de la vista previa:** se devuelven `partidas_vuelven`, `partidas_bajan`, `partidas_desaparecen` y `efecto_variedades`; el ticket no fija los nombres. «Desaparece» significa que la capa queda a cero o `ANULADA`; «baja» significa que pierde cajas pero sigue viva.
- **Identificadores aceptados por la vista previa:** se aceptan `id_capa`, `id_movimiento`, `id_documento` y `serie/numero` para que la pantalla pueda usar el `id` del historial sin conocer el origen exacto.
- **Sugerencias:** `veces` cuenta solo reprocesos no anulados (el ticket dice que un anulado no cuenta); `ultima_vez` usa `REPROCESOS.fecha` y cae a `fecha_hora` si falta. Si un reproceso repite varias líneas del mismo destino, sus cajas se suman antes de calcular la proporción.
- **Búsqueda:** el límite de 20 se reparte en 5 variedades, 8 partidas, 4 albaranes y 3 cambios para que ninguna categoría ahogue a las demás. Se añade `total` al resultado. Los albaranes se buscan también por `serie/numero` juntos, además de por número suelto.
- **Flexibilidad adicional de `apiSugerenciasCambio`:** acepta `{ articulo, envase }` o `ARTICULO|ENVASE` además de la firma `(articulo, envase)`, y acepta un objeto de opciones al final para inyectar dependencias en pruebas.
- **Archivos auxiliares:** se añade `logs/T-025/aceptacion.md` para cumplir el punto 1 de AGENTS; no estaba listado literalmente en la entrega del ticket.
- **Plumbing de `src/Código.js`:** además de las API se añade el `require`/`global.OperacionesService` y el resolutor interno `_resolveOperacionesService_` (termina en `_`, no se expone). No cambia ninguna función existente.
- **Sin escrituras:** `OperacionesService` no llama a ningún método de escritura del repositorio real. La única escritura de la vista previa ocurre en el repositorio clonado en memoria.
