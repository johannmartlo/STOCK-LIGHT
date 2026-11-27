# T-043 — Cierre del día guiado

Rama: `ticket/T-043-cierre-guiado`, creada desde `main` **después de fusionar T-040 y T-041** (depende del cuadre y toca Inicio). Sensible: **POCO** (no crea movimientos; solo lee y anota pasos).
Especificación: 2026-11-27. Maqueta aprobada: artboard **5 · Cierre del día guiado** (https://claude.ai/artifact/3rc3BBKCXQF8UJ6VkFkBTD#play-Cierre). Rúbrica: A3-A5, B6, B8, D13-D14.

## Decisiones del responsable (27/11)
- Todo el cierre lo hace **una persona: el administrativo**, en el ordenador.
- Se importa **cada tarde el mismo día**: recepciones y ventas de hoy.
- El **destrío** se apunta **durante el día sobre el stock que hay** (de 100 cajas de ayer se quitan 20). Igual que los cambios de confección. No son pasos del cierre, pero el cierre comprueba que estén apuntados **antes del cuadre**.
- Se cuenta artículo por artículo dentro de su familia (T-040).

## Pasos y cómo se marcan

| # | Paso | Se marca solo cuando… | Marca manual |
|---|---|---|---|
| 1 | Importar recepciones | hay una importación **confirmada hoy** con documentos de recepciones de fecha de hoy | «Hoy no hubo entradas» |
| 2 | Importar ventas | ídem con ventas | — |
| 3 | Cambios de confección y destrío del día | — | «Está todo apuntado» (muestra los destríos y cambios de hoy con cajas y hora) |
| 4 | Revisar pendientes | no queda ningún pendiente abierto | — |
| 5 | Cuadre de la noche | todas las familias de `obtenerCuadre()` tienen fila en `CUADRES` con fecha de hoy | — |
| 6 | Enviar el parte | se pulsa «Copiar texto» en Parte, o sale el correo de las 21:00 | — |

Los cambios van **antes** de pendientes: al apuntarlos, las ventas que esperaban stock se aplican solas (así pasó la primera noche real, 27/11).

Un paso automático puede dejar de estar hecho si los datos cambian: por ejemplo, entra un pendiente nuevo después de revisarlos. Entonces vuelve a «Pendiente».

## Reglas
1. **Servicio nuevo `src/CierreService.js`**:
   - `obtenerCierre(fecha)` → `{ fecha, pasos: [{ n, clave, titulo, estado: 'HECHO'|'SALTADO'|'PENDIENTE', detalle, hora, usuario }], hechos, siguiente, tareas_dia: { destrios: {apuntes, cajas, ultima_hora}, cambios: {…} }, avisos: [...] }`.
   - Detecta los pasos 1, 2, 4, 5 y 6 con los datos existentes (IMPORTACIONES, PENDIENTES, CUADRES, MOVIMIENTOS).
   - Guarda las marcas manuales (paso 1 «saltado», paso 3 «hecho») y el paso 6 en la hoja nueva **`CIERRE_DIA`**: `fecha, paso, estado, usuario, hora, nota`. Solo añadir; la última fila de cada paso y día manda.
   - `marcarPaso(fecha, clave, estado, usuario)`: solo para pasos con marca manual o el 6. Rechaza el resto.
   - **Avisos de orden**: si se abre el cuadre (paso 5) con el 3 o el 4 sin hacer, devuelve el aviso «Antes de cuadrar faltan pasos: … Si cuadras ahora, las diferencias saldrán falsas». Es un aviso, **no un bloqueo**.
2. **API** (`Código.js`, `docs/API_PUBLICA.md`): `apiObtenerCierre()` (LECTURA), `apiMarcarPasoCierre(clave, estado)` (ESCRITURA), rol ENCARGADO, con las guardas de T-020.
3. **Pantalla `src/ui/cierre.html`** (`window.SLCierre`), como en la maqueta:
   - progreso «N de 6»;
   - tarjetas «Durante el día» (destrío y cambios de hoy con su botón);
   - lista de pasos y panel del paso seleccionado con «Qué hacer», «Por qué», aviso y botón principal que **abre la pantalla de ese paso** (Importar, Pendientes, Cuadre, Parte) o marca el paso manual.
   - Textos del «Por qué» exactamente como en la maqueta.
   - `aria-live` en el panel.
4. **Inicio**: tarjeta «Cierre del día · N de 6 · Siguiente: …» que abre la pantalla. Entrada «Cierre del día» en el menú con el contador.
5. **Parte de la noche** (`ParteService`): si a la hora del parte faltan pasos, una línea al final: «Cierre incompleto: falta …».
6. `Parte` → «Copiar texto» llama a `apiMarcarPasoCierre('parte', 'HECHO')`.

## Aceptación
1. **Prueba nueva** (`test/t043_cierre.test.js`): día vacío → 0 de 6 y siguiente = 1.
2. **Prueba nueva:** con una importación de recepciones de hoy confirmada → paso 1 HECHO; con «Hoy no hubo entradas» → SALTADO.
3. **Prueba nueva:** pendiente abierto → paso de pendientes PENDIENTE; al resolverlo → HECHO; si entra otro → PENDIENTE otra vez.
4. **Prueba nueva:** cuadre de todas las familias hoy → paso 5 HECHO; falta una → PENDIENTE.
5. **Prueba nueva:** aviso de orden al pedir el paso 5 con el de cambios y destrío sin hacer.
6. **Prueba nueva:** `marcarPaso` rechaza los pasos automáticos; sin sesión → «Acceso no autorizado».
7. **Prueba nueva:** el parte incluye «Cierre incompleto» si falta un paso y no lo incluye si están todos.
8. Ninguna prueba existente se modifica. `node test/run_all.js` con 0 fallos.

## Archivos previstos
`src/CierreService.js` (nuevo), `src/Código.js`, `src/Repository.js` (hoja `CIERRE_DIA`), `src/ui/cierre.html` (nuevo), `src/Index.html` (include y menú), `src/ui/app.html` (navegación, tarjeta de Inicio y sello de hora), `src/InicioService.js` (resumen del cierre y hora del último movimiento), `src/ParteService.js` y `src/ui/parte.html` (línea de cierre incompleto y marca al copiar), `src/ui/estilos.html` (clases `.sl-cierre-*` al final), `docs/API_PUBLICA.md`, `docs/GUIA_USO.md`, `DATA_MODEL.md`, `test/t043_cierre.test.js`, `docs/tickets/T-043-cierre-guiado.md`, `logs/T-043/*`.

**No toques** el motor (`MovementService`, `Libro`, `InventoryEngine`) ni `importacion/`. **Nada de datos reales.**

## Añadido el 27/11 por la noche (tras la primera importación real)
Asignado a **DeepSeek (carpeta B)**, rama desde `main` = `9c24973`. T-042 (Antigravity) toca también `app.html` e `InicioService.js`: **no toques** `fecha_inicio_datos`, el gráfico, el acceso ni los textos «compras/recepciones»; si al final hay conflicto, rebase sobre el main de ese momento.

7. **Albaranes en espera** (paso 4): cuando una venta queda `STOCK_INSUFICIENTE`, su albarán **entero** espera (también las líneas con stock). El panel de ese paso lo dice así: «AVT27/885 (Frutas X) espera: falta stock de HT Rojo II madera 40x30x8 (60 cj). Suele resolverse apuntando el cambio de confección». Con un botón que abre **Cambiar** con ese artículo de destino ya elegido si la API lo permite; si no, solo abre Cambiar.
8. **Sello de hora en Inicio** (rúbrica B6): junto al total, «Actualizado a las HH:MM» con la hora del **último movimiento** registrado (no la de carga de la página); si es de otro día, «Actualizado el dd/mm a las HH:MM» en ámbar.
9. **Guía:** en `docs/GUIA_USO.md`, la rutina nueva: exportar recepciones del día y **ventas de hoy a mañana** (los albaranes de Eroski llevan fecha del día siguiente; la app salta lo ya importado); el responsable deja el CSV de ventas depurado de ventas de otros almacenes.

Pruebas nuevas para 7-8 en `test/t043_cierre.test.js` (albarán en espera con detalle del artículo que falta; sello con hora del último movimiento y caso de otro día). Mismo cierre de entrega: `logs/T-043/informe.md` con «Dudas».
