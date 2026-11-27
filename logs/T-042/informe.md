# Informe T-042 — Acceso sin fricción, errores claros y gráfico desde el stock inicial

## Resumen (5 líneas)
1. **Rama:** `ticket/T-042-acceso-sin-friccion` (desde `main` = `9c24973`).
2. **Commits:** `2b88915` (ticket sin editar) + `d267714` (implementación, docs, pruebas y logs) + este informe.
3. **Pruebas:** `node test/run_all.js` → 50 suites, **488 pruebas superadas, 0 fallos** (`logs/T-042/tests.txt`).
4. **Aceptación:** cumplidos los 8 puntos del ticket (`logs/T-042/aceptacion.md`).
5. **Dudas:** ver listado completo en la sección «Dudas» (2 ajustes en pruebas antiguas por los nuevos valores esperados y 2 detalles técnicos de compatibilidad).

## `git status` (antes de añadir este informe)
```text
On branch ticket/T-042-acceso-sin-friccion
Changes not staged for commit:
	modified:   logs/T-038/informe.md

Untracked files:
	logs/T-008/fusion.md
	logs/T-009/fusion.md
	logs/T-024/fusion.md
```
*(Ninguno de esos archivos preexistentes de otros tickets se ha tocado ni incluido en los commits de T-042.)*

## `git log --oneline -5` (antes de commitear este informe)
```text
d267714 feat(T-042): sesion recordada, errores claros, URL_APP y fecha_inicio_datos
2b88915 docs(tickets): anadir T-042 acceso sin friccion
9c24973 docs(T-044): aceptacion e informe
e57f678 feat(T-044): recepciones agrupadas por almacen
69cbfd3 docs(tickets): anadir T-044 recepciones agrupado
```

## Dudas
Se listan todos los cambios o decisiones de detalle que no están literalmente descritos en las reglas del ticket:

1. **`test/t020_acceso.test.js` (prueba 7.1, líneas 612-614):** cambiados los valores esperados `CREDENCIALES_INVALIDAS` por `PIN_INCORRECTO` (comprobando `intentos_restantes === 4`) y `ENLACE_NO_VALIDO`, y retirada la aserción `Object.keys(pinMalo) === Object.keys(tokenMalo)` porque `PIN_INCORRECTO` ahora incluye `intentos_restantes` (permitido por Aceptación 8 del ticket).
2. **`test/t028_importar_pendientes.test.js` (líneas 429 y 441):** actualizado el texto literal esperado `'Se comprueba al aplicar las compras de esta importación'` → `'Se comprueba al aplicar las recepciones de esta importación'` tras el cambio de textos de la pantalla Importar (Regla 6).
3. **`docs/API_PUBLICA.md` y `src/Seguridad.js` (`apiComprobarSesion`):** registrada como `ENTRADA` en `docs/API_PUBLICA.md` (igual que `apiSalir`) y con rol `'CONSULTA'` en `PERMISOS_API` (igual que `apiSalir`), para que pueda llamarse directamente desde `Index.html` sin `exigirSesionApi_()` y al mismo tiempo pase la cobertura de T-020 (`analizarCobertura` y prueba 4.1) y T-023.
4. **`src/Seguridad.js` (`_errorAcceso_`):** los errores lanzados internamente por `ServicioAcceso.entrar` y `establecerPin` conservan el mensaje `'Credenciales no válidas'` y adjuntan `.errorCode` (`ENLACE_NO_VALIDO`, `PIN_INCORRECTO`, `BLOQUEADO`) y metadatos (`intentos_restantes`, `hasta`), para no romper las aserciones `assert.throws(..., /Credenciales no válidas/)` de `test/t020_acceso.test.js`. En `establecerPin`, un PIN ya establecido o con formato inválido mantiene `errorCode: 'CREDENCIALES_INVALIDAS'` para conservar la prueba 7.2 de T-020.
5. **5º intento fallido de PIN:** en el intento que alcanza el límite (`intentos >= intentosMaximos`), `apiEntrar` devuelve directamente `BLOQUEADO` con `hasta` (ISO) en lugar de `PIN_INCORRECTO` con `intentos_restantes: 0`, para mostrar de inmediato la hora de desbloqueo al usuario.
