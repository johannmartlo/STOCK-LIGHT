# T-028 — Pantallas de Importar y Pendientes (P-2 del plan de cierre)

Rama: `ticket/T-028-importar-pendientes`, creada desde `main` = `1581b23` (T-024 fusionado: base visual, `include_`, nombres legibles y rol en cliente). Sensible: **sí** (desde aquí se importa stock real).
Especificación: 2026-11-26. Usuarios: `UX_MAPA_USUARIOS.md` (el **administrativo**, ENCARGADO, importa cada mañana **desde el ordenador**). Diseño: DISENO.md v3 y referencia `samples/diseno/07-importar-movil.html/.png`.

## Lo que ya existe (verificado en main; no lo rehagas)
- `apiPrevisualizarImportacionCsv(texto)` (CONSULTA) y `apiConfirmarImportacionCsv(texto, hash)` (ENCARGADO), con sus estados (NUEVO, YA_IMPORTADO, MODIFICADO_EN_ERP, STOCK_INSUFICIENTE), los tramos y el reintento automático de pendientes (T-007, T-008).
- `apiListarPendientes` (CONSULTA), `apiReintentarPendientes` y `apiMarcarPendienteResuelto` (ENCARGADO, solo `MODIFICADO_EN_ERP`) (T-008).
- `apiPrevisualizarStockInicial` / `apiConfirmarStockInicial` (ADMIN) (T-011).
- `apiUpsertExcepcionCatalogo` (**ADMIN**) y `CatalogoService.esCombinacionSeguida`.
- Base visual de T-024: tokens, `include_`, barra lateral, `nombreLegible`, `fmtDias`, estados, rol en cliente, vista previa en `tools/vista-previa/`.

## Reglas

### Servidor (pequeño, en un archivo nuevo)
1. **`src/SeguimientoService.js`** (nuevo) con `decidirSeguimiento(articulo, envase, decision, usuario)`, donde `decision` es `SEGUIR` o `IGNORAR`:
   - crea o actualiza la **excepción de catálogo** de esa combinación (SEGUIMIENTO = SI o NO), con la misma función que usa `apiUpsertExcepcionCatalogo`, sin duplicarla;
   - lanza `reintentarPendientes` (con SEGUIR se aplican sus líneas; con IGNORAR pasan a IGNORADA);
   - registra en LOG_OPERACIONES quién y cuándo;
   - devuelve el resultado del reintento.

   API `apiDecidirSeguimiento(articulo, envase, decision)` como ESCRITURA, rol **ENCARGADO**.

### Pantalla Importar (ordenador primero; móvil según la referencia 07)
2. **Zona para soltar o elegir varios CSV a la vez** (compras y ventas del día).
   - Se leen en el cliente con `FileReader`. **Comprueba la codificación con los CSV de `test/fixtures/csv/`**: si UTF-8 da caracteres de reemplazo («�»), vuelve a leer en `windows-1252`. Documenta lo que hagas.
   - **Orden automático:** compras antes que ventas (D-007), aunque se suelten al revés.
3. **Previsualización por archivo**, con `apiPrevisualizarImportacionCsv`:
   - tipo detectado y fechas que cubre;
   - documentos nuevos, ya importados, **modificados en Hispatec**, sin stock;
   - líneas no seguidas, abonos y **artículos sin decidir**.

   Lista desplegable por estado, con nombres legibles. Si un archivo ya está importado entero, se dice claramente («Ya importado el 25/11») y no se importa otra vez.
4. **Confirmar** (solo ENCARGADO o ADMIN; CONSULTA no ve el botón):
   - con `apiConfirmarImportacionCsv`, archivo a archivo en el orden de la regla 2;
   - si el servidor trabaja por tramos, la pantalla llama las veces que haga falta, con barra de progreso, y no se puede cerrar a medias sin aviso;
   - **resultado:** documentos aplicados, cajas que entran y salen, ventas que han quedado sin stock y las **pendientes que se han resuelto solas** con el reintento;
   - al terminar, Existencias se refresca: «importado hasta» y KPIs.
5. **Stock inicial** (solo ADMIN): una pestaña dentro de Importar para pegar o soltar el CSV del stock inicial (`Fecha;Proveedor;Articulo;Envase;Cajas[;Kg]`):
   - previsualización con los estados de T-011 y totales por artículo + envase, por proveedor y general, para cuadrarlos con el conteo;
   - confirmar, con aviso de que se hace una copia antes;
   - la opción «añadir al stock existente» solo aparece si ya hay movimientos.

### Pantalla Pendientes
6. Agrupada en tres bloques, cada uno con su número; el número total va en la insignia de la barra lateral («Importar 2»).
   1. **Ventas sin stock** (`STOCK_INSUFICIENTE`):
      - por albarán: fecha, cliente, líneas con nombre legible y cajas que faltan;
      - texto de ayuda: «Suele faltar una compra o un cambio por registrar. Se aplican solas cuando entra el stock»;
      - botón «Reintentar ahora».
   2. **Artículos nuevos sin decidir** (`SEGUIMIENTO_DESCONOCIDO`):
      - agrupados por artículo + envase, con cuántas líneas y cajas esperan;
      - dos botones: **«Seguir este artículo»** e **«Ignorarlo»** (`apiDecidirSeguimiento`), con confirmación breve;
      - tras decidir, el bloque se actualiza con lo que se ha aplicado.
   3. **Albaranes cambiados en Hispatec** (`MODIFICADO_EN_ERP`):
      - albarán, fecha y diferencia de cajas;
      - botón «Marcar revisado» con motivo (`apiMarcarPendienteResuelto`);
      - botón **«Aplicar la versión nueva»** visible pero desactivado, con la nota «Disponible pronto» (llega con T-027; no lo implementes).
7. Un usuario CONSULTA ve Pendientes en solo lectura, sin botones de acción.

### Vista previa local
8. Amplía `tools/vista-previa/`:
   - la pantalla Importar con los CSV de `test/fixtures/csv/` (ficticios), que se pueden soltar de verdad en el navegador;
   - Pendientes con los tres bloques poblados.

## Aceptación
1. **Prueba nueva (servidor):**
   - `decidirSeguimiento(SEGUIR)` aplica las líneas pendientes de esa combinación y el documento pasa a `CONFIRMADO`;
   - `IGNORAR` las deja en `IGNORADA` sin movimientos;
   - decidir dos veces no duplica nada;
   - CONSULTA no puede llamarla y ENCARGADO sí.
2. **Prueba nueva (cliente):**
   - el orden automático pone compras antes que ventas;
   - la detección de codificación funciona con un texto en `windows-1252`;
   - CONSULTA no tiene botones de confirmar, reintentar, decidir ni marcar.
3. **Recorrido completo en la vista previa con tu navegador**, contado en el informe paso a paso con capturas:
   - soltar ventas y compras a la vez, previsualizar y confirmar;
   - ver una venta sin stock en Pendientes, importar su compra y comprobar que desaparece sola;
   - «Seguir este artículo» y ver que se aplica.
4. **Capturas en `logs/T-028/`:**
   - Importar a 1440 px (vacío, con archivos previsualizados y con el resultado);
   - Importar a 390 px;
   - Pendientes a 1440 y 390 px;
   - stock inicial (ADMIN);
   - vista CONSULTA de Pendientes.

   Sin desplazamiento horizontal a 390, 768 y 1024 px. Compara la de móvil con `samples/diseno/07-importar-movil.png` y enumera las diferencias.
5. Las API nuevas se rechazan sin sesión y la cobertura de `t020_acceso.test.js` sigue en verde.
6. `node test/run_all.js` con 0 fallos, salida en `logs/T-028/tests.txt`.

## Archivos previstos
- `src/SeguimientoService.js` (nuevo)
- `src/Código.js` (solo la API nueva), `src/Seguridad.js` (solo `PERMISOS_API`), `docs/API_PUBLICA.md`
- `src/ui/importar.html`, `src/ui/pendientes.html` (nuevos), `src/ui/app.html`, `src/ui/estilos.html`, `src/Index.html` (solo navegación e `include_`)
- `tools/vista-previa/*`
- `test/t028_importar_pendientes.test.js` (nuevo)
- `docs/tickets/T-028-importar-pendientes.md` (este ticket, primer commit, sin editar)
- `logs/T-028/*`

**No toques** `src/MovementService.js`, `src/Libro.js`, `src/InventoryEngine.js`, `src/Reproceso.js`, `src/Catalogo*.js` (solo llamarlos), `src/importacion/*` ni `src/CorreccionService.js` (T-027 los está tocando otro agente). Si necesitas otro archivo, para y pregunta. **Nada de `samples/` a git.**

## Fuera de alcance
- «Aplicar la versión nueva» (T-027 + ticket siguiente).
- Cambiar, destrío, movimientos y parte de la noche (P-3).
- Pantalla de usuarios.

## Entrega
Escribe en `logs/T-028/informe.md`:
- un resumen de 5 líneas;
- el recorrido de la aceptación 3;
- la salida de `git status` y de `git log --oneline -5`;
- las diferencias con la referencia visual;
- **«Dudas»** con TODO cambio no pedido.
