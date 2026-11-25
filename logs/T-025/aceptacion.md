# T-025 — Aceptación

Rama: `ticket/T-025-servidor-operaciones` (desde `main` = `bb816bc`).
Fecha: 2026-11-25.
Comando único: `node test/run_all.js` → **32 suites, 352 pruebas, 0 fallos** (salida completa en `logs/T-025/tests.txt`).
Suite nueva: `test/t025_operaciones.test.js` → **8 pruebas, 0 fallos**.

1. **Proporción de los conjuntos de destino** — prueba 1.
   - Se crean 7 reprocesos activos del mismo origen y conjunto (`TOMATE ROSA|MADERA` → `TOMATE ROSA|500`), con dos antiguos de 120 cajas y los cinco últimos de 86, más un octavo reproceso anulado con 999 cajas.
   - `apiSugerenciasCambio` devuelve un conjunto con `proporcion = 1,43`, `proporcion_total = 1,43`, `destrio_habitual = 0,03`, `veces = 7` y `ultima_vez = 2026-11-07`; el anulado no entra en la mediana.
   - Para un origen sin historial devuelve `[]`.

2. **Rinde distinto** — prueba 2.
   - `60 → 86` devuelve `real = 1,43` y no avisa.
   - Una desviación del 9 % devuelve `rinde_distinto = false`; una del 11 % devuelve `true`.
   - Sin sugerencia, el esperado es 1 caja → 1 caja.

3. **Previsualización de anulaciones** — prueba 3.
   - 30 escenarios deterministas con 3 entradas, una venta, un reproceso y una entrada ya anulada.
   - En cada escenario se compara `apiPrevisualizarAnulacion` con la anulación real ejecutada sobre una **copia completa del entorno** (`clonarEntorno`): `posible` coincide en los 30.
   - Cuando es posible, el mapa de partidas que vuelven/bajan/desaparecen coincide exactamente con el cambio real de `cajas_restantes`, y la suma de `efecto_variedades` coincide con la variación del stock total.
   - Se compara la instantánea de todas las hojas antes y después de la vista previa: no cambia ninguna.

4. **Historial de movimientos** — prueba 4.
   - Entradas, stock inicial, venta, reproceso, destrío y venta anulada: la suma de `cajas` de los elementos no anulados es exactamente el stock total actual (125 cajas).
   - El reproceso aparece una sola vez como `tipo = cambio`; la anulación queda enlazada (`anula_id`) y la venta anulada tiene `anulado = true` y `anulado_por`.
   - Los filtros por tipo, variedad, `desde`/`hasta` y texto (proveedor, cliente, albarán) devuelven solo lo que corresponde.
   - El paginado con `limite = 2` recorre todas las páginas sin repetir ni perder identificadores.
   - Cada elemento contiene `id, tipo, texto, detalle, cajas, variedad, documento, usuario, fecha_hora, anulable, anulado, anulado_por`.
   - Los grupos van por fecha de negocio de más reciente a más antigua.

5. **Búsqueda** — prueba 5.
   - «rosa», «ROSA» y «rosá» encuentran la variedad `ROSA` y la partida `TOMATE ROSÁ` (sin distinguir mayúsculas ni acentos).
   - El número `777` encuentra el albarán `ACT27/777`.
   - Con 40 partidas que contienen «ROSA», la respuesta nunca supera 20 resultados (5 variedades + 8 partidas + 4 albaranes + 3 cambios como máximo).

6. **Rendimiento** — prueba 6.
   - Entorno con 5.000 movimientos y 5.000 capas simuladas más 50 reprocesos.
   - Las cinco API (`apiSugerenciasCambio`, `apiEvaluarCambio`, `apiPrevisualizarAnulacion`, `apiListarMovimientos`, `apiBuscar`) responden por debajo de 2 s cada una, medido con `Date.now()` en Node.

7. **Acceso y permisos** — prueba 7 y `test/t020_acceso.test.js`.
   - Las cinco API están en `PERMISOS_API` con rol `CONSULTA` y clasificadas como `LECTURA` en `docs/API_PUBLICA.md`.
   - Llamadas directamente sin contexto lanzan exactamente `Acceso no autorizado`.
   - Con `conContextoDePrueba_` y rol `CONSULTA`, `apiListarMovimientos` funciona y devuelve la estructura esperada.
   - `test/t020_acceso.test.js` sigue en verde (18/18), incluidas las comprobaciones de cobertura y de guarda.

8. **Ejecutor y documentación** — prueba 8 y `docs/API_PUBLICA.md`.
   - `node test/run_all.js` termina con 0 fallos (32 suites, 352 pruebas).
   - Las cinco filas nuevas están en `docs/API_PUBLICA.md` y `docs/API_PUBLICA.md` sigue cubriendo todas las funciones globales (`t023_superficie.test.js`, prueba 7, en verde).

## Notas de alcance

- No se ha tocado `src/Index.html`, `src/ui/`, `src/InicioService.js`, `src/MovementService.js`, `src/Libro.js`, `src/InventoryEngine.js`, `src/Reproceso.js`, `src/Catalogo*.js`, `src/SemillaCatalogo.js` ni `src/importacion/*`.
- No hay escrituras en `OperacionesService`: la vista previa usa una copia en memoria y las anulaciones reales se ejecutan sobre esa copia, no sobre el repositorio real.
