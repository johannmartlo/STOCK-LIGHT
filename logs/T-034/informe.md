# T-034 — Informe de entrega

1. **Rama:** `ticket/T-034-movimientos-buscar-parte`, creada desde `main` = `81dc81c`; primer commit `e6658ce` solo con el ticket sin editar, entrega en `0509ee0`.
2. **Entrega:** pantallas nuevas `src/ui/movimientos.html`, `src/ui/buscar.html` y `src/ui/parte.html`; flujo «Aplicar la versión nueva» en `src/ui/pendientes.html`; cableado mínimo en `app.html` e `Index.html`; vista previa ampliada en `tools/vista-previa/`; suite `test/t034_movimientos.test.js`.
3. **Pruebas:** `node test/run_all.js` → **40 suites, 406 pruebas, 0 fallos**; T-034 → **10/10**. Salida completa en `logs/T-034/tests.txt`.
4. **Aceptación:** los 3 puntos comprobados (detalle en `logs/T-034/aceptacion.md`), con capturas en `logs/T-034/` y sin desplazamiento horizontal a 390, 768 y 1024 px.
5. **Dudas:** se listan abajo todos los cambios y decisiones no pedidos literalmente en el ticket.

## git status

```text
On branch ticket/T-034-movimientos-buscar-parte
Your branch is ahead of 'origin/main' by 2 commits.
  (use "git push" to publish your local commits)

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	logs/T-025/fusion.md
	logs/T-025/tests-rebase.txt

nothing added to commit but untracked files present (use "git add" to track)
```

`logs/T-025/fusion.md` y `logs/T-025/tests-rebase.txt` son restos sin seguimiento de una tarea anterior; no se han tocado ni incluido en esta entrega.

## git log --oneline -5

```text
0509ee0 feat(T-034): movimientos, busqueda, parte y aplicar version
e6658ce docs(T-034): anadir ticket de movimientos, buscar y parte
81dc81c docs(T-028): documentar rebase sobre 45b9480 en informe
3406165 feat(T-028): mostrar lineasClienteExcluido en previsualizacion de importar
f5b5d5e fix(T-028): clasificar CSV de RECEPCIONES como entradas antes que ventas
```

## Diferencias con la referencia `samples/diseno/03-movimientos.png`

- **Buscar:** la referencia enseña una barra de búsqueda visible en la cabecera; aquí se abre con ⌘K / Ctrl+K y con la lupa del topbar móvil, como pide el ticket. No se añadió barra visible en escritorio.
- **Anular:** la referencia pone un botón «Anular» en cada fila y abre la confirmación en línea; aquí cada fila abre un panel lateral (hoja inferior en móvil) con el detalle y la vista previa, y el botón de confirmar está dentro del panel.
- **Motivo:** la referencia confirma sin motivo; aquí el motivo es obligatorio y el botón nace deshabilitado.
- **Filtros:** la referencia solo tiene chips de tipo; aquí hay además variedad, fechas y texto, como pide el ticket.
- **Agrupación:** la referencia mezcla operaciones agregadas de una importación («Compras del 18/11 importadas»); la API de T-025 devuelve una transacción por documento/movimiento, así que se muestra cada albarán o cambio por separado.
- **Total del día:** la referencia solo tiene la cabecera del día; aquí se añade el total del día (sin anulados) porque el ticket lo pide.
- **Paginado:** la referencia es estática; aquí hay carga al llegar al final y un botón «Cargar más movimientos» como respaldo.
- **Responsive:** la referencia es solo escritorio; aquí hay diseño a 390 px con panel inferior y filtros apilados.
- **Estados:** la referencia no tiene vacío, cargando ni error; aquí sí.
- **Cabecera:** la referencia usa «Historial» a 34 px; aquí se usa el `sl-page-title` existente (20 px) para no romper la base visual común.
- **Enlaces de anulación:** se mantiene el tachado y el enlace «Ver la anulación» / «Ver el movimiento original» de la referencia.
- **Paleta e iconos:** se reutilizan los tokens y los símbolos de la referencia (entrada +, salida −, cambio ⇄, destrío − rojo, ajuste ±, anulación ↺).

## Dudas

- **«Aplicar la versión nueva» se cambia en `app.html`, no en `pendientes.html`:** el botón se genera dinámicamente en `renderPendientes` dentro de `app.html`; `pendientes.html` no contenía la lista. El botón y todo su flujo (modal, vista previa, motivo, confirmación) viven en `pendientes.html`; en `app.html` solo se sustituyó el botón deshabilitado por el botón real.
- **Acceso a Parte desde Existencias:** para no tocar `src/ui/existencias.html` (fuera de los archivos previstos), el script de `parte.html` inyecta en tiempo de ejecución un botón «Parte de la noche» junto a «Importar CSV» en la cabecera de escritorio de Existencias. En móvil se añadió un icono de luna en el topbar (`Index.html`), porque la barra lateral no se muestra.
- **Icono de Parte en el topbar móvil:** el ticket solo pedía la lupa móvil; se añade también el icono de Parte para que la pantalla sea accesible en móvil sin depender de Existencias.
- **Mínimo de 5 caracteres en el motivo:** el ticket solo dice «motivo obligatorio»; se exige longitud ≥ 5 para ser coherente con `apiAplicarVersion` / `apiAnularAjuste` de T-027 y evitar motivos vacíos o de una letra.
- **Motivo en anulaciones de cambios:** `apiAnularReproceso` solo acepta el identificador; no recibe ni guarda el motivo. La interfaz lo pide igualmente (regla 2), pero en un cambio el motivo no queda persistido por limitación de la API existente. No se tocó el servidor.
- **Detalle con líneas y partidas:** `apiListarMovimientos` devuelve transacciones agregadas (texto, detalle, documento, usuario, hora, variedades y cajas), no el array de líneas ni las capas afectadas. El panel muestra todos esos campos y, para la anulación, las partidas de la vista previa. No se pudo enseñar el desglose de líneas de una venta sin cambiar el servidor.
- **Motivos en lenguaje llano más allá de los códigos listados:** además de `DOCUMENTO_SIN_VERSION_ACTIVA`, `PENDIENTE_NO_PENDIENTE`, `VERSION_NO_PENDIENTE`, falta de stock y `AJUSTE_CON_CONSUMOS`, se traducen mensajes largos del servidor del tipo «la capa destino … tiene N cajas consumidas» a una frase llana, y se añadieron códigos como `VERSION_NO_ENCONTRADA`, `VERSION_SIN_LINEAS`, `PENDIENTE_NO_ENCONTRADO`, `DOCUMENTO_NO_ENCONTRADO`, `TIPO_NO_SOPORTADO` e `ID_REQUERIDO`.
- **Estados vacío/cargando/error y `aria-label`s:** se añadieron estados y etiquetas de accesibilidad no pedidos explícitamente, para que las pantallas no queden en blanco ni sin contexto.
- **Botón «Cargar más movimientos»:** además de la carga automática al llegar al final, se deja un botón visible como respaldo cuando el navegador no dispara el `IntersectionObserver`.
- **Navegación desde la búsqueda:** para abrir una variedad se expone `mostrarVista` en `window.SLApp`; también se exponen `abrirMovimientos`, `abrirParte` y `abrirBuscar`. Es cableado mínimo, pero no estaba en la superficie pública anterior.
- **Intercepción de «Ver todos» y «Movimientos»:** para no tocar `existencias.html`, `app.html` reconoce esos botones por su texto dentro del manejador existente de `[data-proxima-version]` y los redirige a Movimientos.
- **Datos ficticios nuevos:** se añadió una venta de 5 cajas del destino de un cambio para que ese cambio sea no anulable, una entrada ficticia anulada para ver el tachado y el enlace, y una versión ficticia de AVT27/701 con 999 cajas para que la vista previa muestre una venta entera en pendientes. Todo son datos inventados de `tools/vista-previa/`, no datos reales.
- **Parámetro `accion` en la vista previa:** `tools/vista-previa/server.js` acepta `accion=detalle`, `accion=imposible` y `accion=version` para automatizar las capturas. No es una función de producto; solo afecta al servidor local de vista previa.
- **`formatearFechaHora`:** se añadió un formateo `dd/mm · hh:mm` para el panel de detalle en lugar de mostrar el ISO completo; es una mejora no pedida.
- **Copiar con respaldo:** si `navigator.clipboard` no está disponible, se copia con un `textarea` temporal. El ticket solo pedía «Copiar texto» con confirmación «Copiado».
- **`estilos.html` sin cambios:** todo el CSS nuevo va en `movimientos.html`, `buscar.html`, `parte.html` y en el bloque del flujo de `pendientes.html`, para no chocar con T-033.
- **No se tocaron archivos de servidor:** `src/*.js` y `src/importacion/*` permanecen intactos.
