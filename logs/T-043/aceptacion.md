# T-043 — Comprobación de aceptación

Fecha: 2026-11-27. Rama `ticket/T-043-cierre-guiado`, rebasada sobre `origin/main` (`76a9eb8`, con T-042).
Comando único: `node test/run_all.js` → **51 suites, 499 pruebas, 0 fallos**
(`logs/T-043/tests.txt`, UTF-8 sin BOM).

## Criterios de aceptación del ticket

### 1. Día vacío → 0 de 6 y siguiente = 1
**Cómo se comprueba:** `test/t043_cierre.test.js`, caso 1.

Con la base recién provisionada y sin importaciones, pendientes, cuadres ni movimientos del
día, `obtenerCierre('2026-11-27')` devuelve:

- `hechos = 0`, `siguiente = 1`;
- los seis pasos en `PENDIENTE`;
- `tareas_dia.destrios` y `tareas_dia.cambios` a cero.

### 2. Importación de recepciones y «Hoy no hubo entradas»
**Cómo se comprueba:** caso 2.

- Con una fila de `IMPORTACIONES` `tipo_csv = RECEPCIONES`, `estado = CONFIRMADA` y
  `fecha_hora` del día, el paso 1 queda `HECHO` con la hora y el usuario de la importación.
- El paso 2 sigue `PENDIENTE`.
- En un entorno nuevo, `marcarPaso(fecha, 'recepciones', 'SALTADO')` deja el paso 1 `SALTADO`
  con el detalle «Hoy no hubo entradas» y el siguiente pasa a 2.

### 3. Pendientes: abierto, resuelto y nuevo
**Cómo se comprueba:** caso 3.

1. Un pendiente `PENDIENTE` deja el paso 4 `PENDIENTE`.
2. Al guardar la tabla con ese pendiente en `RESUELTA` (el flujo real de
   `PendientesService.marcarPendienteResuelto` actualiza la fila), el paso 4 pasa a `HECHO`.
3. Un segundo pendiente abierto lo vuelve a dejar `PENDIENTE`.

### 4. Cuadre de todas las familias
**Cómo se comprueba:** caso 4.

Se crean dos familias (`SOLAR` y `LUNAR`) con stock ficticio y se añaden filas de `CUADRES`
con `fecha_hora` del día. El paso 5 queda `HECHO` con «Cuadre completo · 2 familias». En un
entorno equivalente con solo la fila de `SOLAR`, queda `PENDIENTE` y el detalle nombra
`LUNAR` como familia que falta.

### 5. Aviso de orden antes de cuadrar
**Cómo se comprueba:** caso 5.

Con el paso 3 pendiente (sin marca manual) y un pendiente abierto en el 4, el paso 5 lleva:

```text
Antes de cuadrar faltan pasos: 3 y 4. Si cuadras ahora, las diferencias saldrán falsas.
```

El texto también está en `cierre.avisos`. Es un aviso, no un bloqueo: el paso 5 sigue
`PENDIENTE` y la API no impide abrir el cuadre.

### 6. Marcas manuales y acceso
**Cómo se comprueba:** caso 6.

- `marcarPaso` rechaza `ventas`, `pendientes` y `cuadre` con un error que dice que son
  automáticos.
- Acepta `recepciones` → `SALTADO`, `cambios` → `HECHO` y `parte` → `HECHO`; la última fila
  de cada paso y día manda.
- `apiObtenerCierre` y `apiMarcarPasoCierre` sin contexto lanzan «Acceso no autorizado».
- `PERMISOS_API` fija rol `ENCARGADO` para las dos; con `conContextoDePrueba_` de ENCARGADO
  responden con normalidad.

### 7. Parte con «Cierre incompleto»
**Cómo se comprueba:** caso 7.

- Con los pasos 3 pendiente y 6 pendiente, `ParteService.generarParte()` incluye en texto y
  HTML exactamente `Cierre incompleto: falta el paso 3.` (el paso 6 no se cuenta porque es el
  propio envío).
- Con los pasos 1 a 5 hechos, la línea no aparece.

### 8. Albaranes en espera y sello de hora
**Cómo se comprueba:** casos 8 y 9.

- Un albarán ficticio con dos líneas (una con stock y otra sin él) aparece como un único
  documento en `pasos[3].espera`, con `espera_entera = true`, las dos líneas y un solo
  `faltante` para el artículo sin stock, con 60 cajas que faltan.
- `InicioService.obtenerInicio()` devuelve `ultimo_movimiento_hora` con la `fecha_hora` del
  último movimiento confirmado, no la hora de carga.
- `SLCierre.textoSello` devuelve «Actualizado a las HH:MM» para el mismo día y «Actualizado el
  dd/mm a las HH:MM» para otro día; el CSS aplica el color ámbar en el segundo caso.

### 9. Envío del parte y pantalla
**Cómo se comprueba:** caso 10.

Con `enviarParteDiario_` y un `MailApp` simulado, el envío correcto añade una fila a
`CIERRE_DIA` con `paso = parte`, `estado = HECHO` y la fecha del día. Además se comprueba que
`Index.html` incluye `ui/cierre` y `navCierre`, que `app.html` tiene `SLCierre`/`abrirCierre`,
que `parte.html` llama a `apiMarcarPasoCierre('parte', 'HECHO')`, que la pantalla nueva no
usa atributos `style=""` y que sus clases `.sl-cierre-*` viven en `estilos.html`.

## Comprobaciones adicionales

- **Esquema:** caso 0. `CIERRE_DIA` está en `SCHEMA_DEFINITIONS`, se crea al aprovisionar y
  `USUARIOS` sigue siendo la última hoja.
- **Capturas** con datos ficticios: [01-cierre-1280.png](01-cierre-1280.png),
  [02-cierre-360.png](02-cierre-360.png), [03-inicio-cierre-1280.png](03-inicio-cierre-1280.png)
  y [04-inicio-cierre-360.png](04-inicio-cierre-360.png).
- **Sin desplazamiento horizontal:** medido con Chrome/CDP; a 360 px y a 1280 px
  `innerWidth = document.documentElement.scrollWidth = document.body.scrollWidth`.
- **Guía:** `docs/GUIA_USO.md` sección 2 actualizada con la rutina de recepciones del día y
  ventas de hoy a mañana, y sección 10 con el cierre guiado.
- **Alcance:** no se tocaron `MovementService.js`, `Libro.js`, `InventoryEngine.js`,
  `importacion/`, `NombresLegibles.js` ni las funciones reservadas de T-042
  (`fecha_inicio_datos`, gráfico, acceso y textos «compras/recepciones»).
