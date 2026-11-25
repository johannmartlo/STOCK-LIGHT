# Verificación de aceptación — T-024

1. **Invariantes de `apiObtenerInicio` con datos aleatorios (entradas, ventas, reprocesos, anulaciones):**
   - Comprobado en `test/t024_inicio.test.js` (prueba 1, semilla determinista): `ultimo punto de la serie === total`, suma de `variedades[].cajas === total`, suma de `partidas[].cajas === variedad.cajas`, `sale_primero ===` fecha de la capa viva más antigua y un reproceso `ANULADO` no aparece en `viene_de`.
2. **Trazabilidad tras reproceso (`viene_de` y `se_convirtio_en`):**
   - Comprobado en `test/t024_inicio.test.js` (prueba 2): la partida destino incluye `viene_de` con sus orígenes y `apiObtenerPartida(idCapaOrigen)` incluye los consumos de reproceso y `se_convirtio_en` con las partidas destino.
3. **Rendimiento con 5.000 movimientos:**
   - Comprobado en `test/t024_inicio.test.js` (prueba 3): con 5.000 movimientos simulados, `apiObtenerInicio` responde en menos de 2 s (con margen muy amplio en Node) y un envoltorio contador sobre el repositorio confirma `<= 1` lectura por hoja (`MOVIMIENTOS`, `CAPAS_FIFO`, `REPROCESOS`, `REPROCESO_LINEAS`, `DOCUMENTOS`, `PENDIENTES`, catálogo).
4. **Estado vacío sin stock:**
   - Comprobado en `test/t024_inicio.test.js` (prueba 4): sin movimientos ni capas devuelve `{ total: 0, serie: [...30 ceros], variedades: [], pendientes, destrio7: 0, importado_hasta: { compras: null, ventas: null }, ultimos: [] }`.
5. **Seguridad y T-020 (`7.5` incluida y sin modificar):**
   - Comprobado en `test/t024_inicio.test.js` (prueba 5) y `test/t020_acceso.test.js` (18/18 pruebas OK sin tocar `test/t020_acceso.test.js`): `apiObtenerInicio` y `apiObtenerPartida` rechazan llamadas sin sesión, están registradas en `PERMISOS_API` (`CONSULTA`) y en `docs/API_PUBLICA.md`.
6. **Sustitución de `test/fase7_frontend_ux_integration.test.js` por `test/t024_interfaz.test.js`:**
   - Eliminado `test/fase7_frontend_ux_integration.test.js` y creada `test/t024_interfaz.test.js` (7 pruebas) que verifica `include`, tokens `:root`, `prefers-reduced-motion`, ausencia de librerías externas salvo Google Fonts, IDs de pantallas nuevas, avisos «Llega en la próxima versión» y ausencia de lógica FIFO en cliente / `InventoryEngine.js`. Cada prueba antigua retirada queda enumerada en la sección «Dudas» de `logs/T-024/informe.md`.
7. **Capturas con navegador sobre `tools/vista-previa` en `logs/T-024/`:**
   - Capturadas en Chromium headless sobre `http://127.0.0.1:3099` tras el último ajuste visual:
     - Existencias desktop `1440x900` (`01-existencias-1440.png`) y panel lateral abierto (`01b-panel-partidas-1440.png`).
     - Anchos intermedios sin desplazamiento horizontal: `1024x900` (`02-existencias-1024.png`), `768x900` (`03-existencias-768.png`), `390x844` (`04-existencias-390.png`).
     - Hoja inferior abierta (`04b-hoja-inferior-390.png`), partida con procedencia (`05-partida-procedencia-390.png`) y PIN (`08-pin-390.png`).
     - Los 4 estados (`cargando`, `vacio`, `sin_conexion`, `error`) en `390x844` (`09a`–`09d`) y `1440x900` (`09e`–`09h`).
8. **Suite completa `node test/run_all.js`:**
   - Ejecutada tras la última edición: **32 suites, 337 pruebas, 0 fallos**, guardada en UTF-8 en `logs/T-024/tests.txt`.
