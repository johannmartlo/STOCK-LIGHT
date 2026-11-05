# Decisiones de STOCK-LIGHT

Registro de decisiones cerradas. Un ticket cita las decisiones que aplica por su número. Si una situación no está cubierta aquí, el agente para y pregunta.

Fecha de apertura del registro: 2026-10-23. Última actualización: 2026-11-04 (D-001 y D-011 sustituidas; D-022 a D-025 nuevas).

## D-001 — Fuente de datos: CSV del ERP
**Sustituida por D-023 (2026-11-04).** Se conserva el texto original como referencia.

Las entradas y salidas se importan de dos informes CSV de Hispatec: «Albaranes de compra por línea» y «Albaranes de venta por línea». Los lectores de PDF (`src/parsers/`) salen del flujo activo. No se borran, pero ninguna pantalla nueva los usa.
Motivo: el CSV trae columnas fijas, permite importar un día entero en un archivo y elimina el riesgo de cambios de plantilla (TECHNICAL_RISKS R-04) y de OCR.

## D-002 — Series que cuentan
- Entradas: series que empiezan por `ACT` o `NT` (p. ej. `ACT27`, `NT27`).
- Salidas: series que empiezan por `AVT`.
- Cualquier otra serie (p. ej. `ACA27`, compras internas) se ignora y se muestra como «serie ignorada» en el resumen.

Las listas de prefijos viven en configuración (`Config.js`), con estos valores por defecto.
Motivo: la serie `ACA` duplica compras ya registradas por `ACT` (verificado: ACT27/95 y ACA27/2354 con las mismas cajas).

## D-003 — Clave de stock: nombre normalizado de artículo + nombre normalizado de envase
La unidad de stock sigue siendo artículo + envase (BUSINESS_RULES §1), pero se identifica por **nombre**, no por código de Hispatec.
- Normalización: `normalizarNombre(texto)` convierte a mayúsculas, quita espacios al principio y al final, y colapsa los espacios internos en uno. **Nada más**: no se quitan tildes, puntos, comas ni signos.
- Las columnas existentes `codigo_articulo` y `codigo_envase` de MOVIMIENTOS, CAPAS_FIFO y STOCK_ACTUAL guardan esos nombres normalizados. Esto se documenta en DATA_MODEL.md. Los códigos de Hispatec, cuando existan, se guardan solo como dato informativo.

Motivo: el CSV de ventas no trae código de artículo ni de envase, solo nombres. Ejemplo del CSV: «EPS 106 9x500» en compras se normaliza a «EPS 106 9X500».

## D-004 — Cajas, nunca kilos
- Compras: cajas = columna `CantidadEnvasesAC`.
- Ventas: cajas = columna `NroEnvases`.

Los números vienen con coma decimal («80,000»). Si el valor no es un entero exacto, la línea va a error y no se aplica. Los kilos no computan nunca (BUSINESS_RULES §1.2).

## D-005 — Grupos comerciales configurables, sin reglas de negocio en el código
El grupo comercial es solo una capa de consulta y filtro (BUSINESS_RULES §1.4). Se resuelve únicamente a partir de configuración, por este orden:
1. Coincidencia exacta de artículo + envase normalizados en MATRIZ_ARTICULO_ENVASE.
2. Reglas configurables de la hoja REGLAS_GRUPO, por prioridad.
3. Si nada coincide: «PENDIENTE DE ASOCIACIÓN».

Ningún nombre de producto ni de cliente queda escrito en el código. Cada grupo tiene una marca `seguido` (SÍ/NO).

## D-006 — Género no seguido y combinaciones desconocidas
- Una línea cuya combinación tiene grupo con `seguido = NO` se ignora: no crea movimientos y se cuenta en el resumen.
- Una línea cuya combinación no tiene grupo (pendiente de asociación) va a **cuarentena**. Queda guardada, sin crear movimientos, en la hoja PENDIENTES.
  - Al asociar la combinación a un grupo seguido, sus líneas en cuarentena se aplican.
  - Si se asocia a un grupo no seguido, sus líneas pasan a estado IGNORADA.

Motivo: un artículo nuevo (como el Rosa Sabor) no debe perderse en silencio.

## D-007 — Orden de aplicación al importar
Primero por fecha de albarán. El mismo día, todas las entradas antes que las salidas. Dentro de cada grupo, por serie, número y línea.

## D-008 — Fecha de negocio y zona horaria
- El FIFO, las capas y la reconstrucción usan la **fecha del albarán** (`fecha_negocio`), no la fecha de registro.
- La fecha de registro se guarda aparte (`fecha_hora`).
- Zona horaria: Europe/Madrid.
- Las fechas de negocio se guardan como texto `YYYY-MM-DD` y se normalizan siempre al leer de Sheets, porque Sheets convierte los textos de fecha en objetos Date.

## D-009 — Salida sin stock suficiente
Se mantiene la regla actual: el documento entero queda en PENDIENTE_REVISION y no aplica ningún movimiento (BUSINESS_RULES §5). Los documentos pendientes se reintentan, en orden de fecha:
- tras cada importación con entradas nuevas;
- tras cada asociación de combinaciones;
- a petición del usuario.

## D-010 — Documentos repetidos y modificados
- La identidad de un documento es tipo + serie + número. Si ya existe con las mismas líneas (artículo, envase, cajas, número de línea), se salta.
- Si reaparece con líneas distintas, no se aplica nada: se marca «MODIFICADO EN ERP» para revisión manual.

## D-011 — Reproceso (reglas de CCO V1, ampliadas el 2026-11-04)
Sustituye a la versión del 2026-10-23. Confirmado por el usuario el 2026-11-04 tras revisar `internos.js` de CCO V1 (`registrarReprocesoMultiDestino`).
- **Origen**: una partida (capa) o **varias**.
  - Con una partida, las cajas retiradas no pueden superar las restantes de esa capa.
  - Con varias, el usuario elige las partidas y las cajas de cada una, o indica un total que se reparte por FIFO entre las partidas elegidas, de la más antigua a la más nueva.
- **Destinos**: de 1 a N, cada uno con su artículo, envase y número de cajas. El número de cajas no tiene por qué coincidir con el de origen.
- **Herencia**:
  - Con un solo origen, los destinos heredan la fecha de negocio y el proveedor de esa capa.
  - Con varios orígenes, la fecha es la de la **capa más antigua** y el proveedor es «VARIOS». La relación con cada capa de origen se guarda aparte, para mantener la trazabilidad.
- **Destrío**:
  - La pantalla lo rellena con la diferencia (cajas retiradas − cajas de los destinos, mínimo 0) y el usuario puede corregirlo antes de confirmar; por ejemplo, a 0 si la diferencia es solo un cambio de formato.
  - Es un **dato del reproceso** (para las estadísticas de calidad por proveedor), **no un movimiento de stock**: las cajas retiradas ya salieron del stock y no se descuentan dos veces.
  - El destrío directo de una partida, sin reproceso, sigue siendo un ajuste negativo con motivo `DESTRIO`.
- La operación es atómica. Su anulación devuelve las cajas a cada capa de origen y se bloquea si alguna capa destino ya tiene consumos.
- El reproceso sustituye en la interfaz a la reclasificación, a la división de entrada y al movimiento de partida.
- **No se copia de CCO** la búsqueda de artículos y envases por coincidencia parcial de texto; se aplica D-003.

## D-012 — Anulaciones
Anular una salida devuelve las cajas exactamente a las capas que consumió, según la hoja CONSUMOS_FIFO. Para movimientos nuevos no hay reserva LIFO. La lectura del JSON antiguo en `observaciones` se conserva solo para filas anteriores a T-003.

## D-013 — Maestro de Hispatec
El maestro de artículos y envases se importa periódicamente:
- Añade lo nuevo y actualiza lo existente; nunca borra.
- Lo que deja de venir pasa a inactivo.
- Las combinaciones nuevas quedan pendientes de asociar.

## D-014 — Interfaz
- Web app de Apps Script (HtmlService), pensada **primero para el móvil** y válida también en el ordenador.
- El viewport se añade con `HtmlOutput.addMetaTag('viewport', 'width=device-width, initial-scale=1')`, porque la etiqueta escrita dentro del HTML se ignora.
- Sin desplazamiento horizontal a 360 px de ancho. Áreas de pulsación de al menos 44 px. Nada depende de pasar el ratón por encima.

## D-015 — Datos reales fuera del repositorio
Los CSV, maestros, PDFs y fotos reales nunca entran en el repositorio. Las pruebas usan archivos inventados con la estructura exacta del real (mismas columnas, separador `;`, coma decimal, fechas `dd/mm/yyyy`).

## D-016 — Proveedor de la partida = emisor del albarán
El agricultor o proveedor de cada partida es el `NombreEmisor` del CSV de compras. Confirmado por el usuario el 2026-10-27: coincide con el agricultor que el almacén usa en sus hojas. Habrá más proveedores con el tiempo.

Para mostrar un nombre corto («BLANES» en lugar de «AGRICOLA BLANES PEREZ…»), una hoja de configuración `PROVEEDORES` (`nombre_erp`, `alias`) traduce el nombre en pantalla. El dato guardado siempre es el nombre del ERP normalizado.

## D-017 — Un solo almacén
No hay ubicaciones. Las hojas LOGISTICA G y STOCK TOBARRA del Excel quedan fuera de Stock Light, igual que los conceptos de palet y lote. Tobarra sigue activo, pero no se gestiona aquí.

## D-018 — Sin reservas por cliente
No se modela stock reservado. La hoja HORTIPOR, organizada por cliente, se sustituye por las vistas de cartón y EPS: el almacén pasará a usar ese formato.

## D-019 — Vistas configurables
La pantalla de stock no se limita a grupos comerciales. Cada **vista** combina un filtro con un formato:
- **filtro:** cualquier combinación de grupo comercial, proveedor, artículo o envase (por texto contenido);
- **formato:** `LISTA` (bloques por artículo + envase con sus partidas, como NT CARTON) o `MATRIZ` (fecha × proveedor × artículo, con subtotales de categoría I/II, como JAPONES).

Las vistas viven en la hoja de configuración `VISTAS`. Reproducen las hojas del Excel actual, calculadas a partir de las partidas vivas.

## D-020 — Unidades por caja: solo para mostrar
El stock se cuenta siempre en cajas (D-004). En la matriz comercial, cada combinación artículo + envase puede tener `unidades_por_caja`; por ejemplo, 6 en el JAPI 650 g. Si lo tiene, las pantallas pueden mostrar las unidades (cajas × factor) junto a las cajas.

## D-021 — Artículos que se venden por unidades
El usuario confirmó el 2026-10-27 que el JAPI 650 g se vende **por unidades de 650 g**, no por cajas completas. Las cajas son de 6 × 650 g.

Regla: cada combinación artículo + envase de la matriz tiene `unidad_stock` = `CAJA` (por defecto) o `UNIDAD`. Para las combinaciones en `UNIDAD`, **todo su stock se lleva en unidades**: capas, movimientos, consumos FIFO, ajustes, reprocesos y stock inicial.
- **Ventas:** cantidad = columna `Piezas`. Si vale 0 o no es un entero, la línea va a `ERROR_DATOS`.
- **Compras:** cantidad = columna `CantidadLineaAlbaran`. Si la combinación tiene `unidades_por_caja` y la cantidad no coincide con `CantidadEnvasesAC × unidades_por_caja`, se avisa sin bloquear.
- **En pantalla:** unidades y su equivalente en cajas, por ejemplo «70 ud (11 cj + 4 ud)». Los totales de una vista nunca suman cajas y unidades en la misma cifra: cada unidad tiene su total.

Verificado con los CSV de muestra en artículos que se cuentan por unidades (Rama 9x500: 44 envases, 396 piezas; compra con `CantidadLineaAlbaran` 396). **Falta verificarlo con líneas reales del JAPI 650 g** (T-017).

Mientras T-017 no esté hecho, las combinaciones del JAPI 650 g quedan en un grupo **no seguido**. No se cuentan mal: simplemente no se cuentan.

## D-022 — Libro de movimientos de solo añadir
Confirmado por el usuario el 2026-11-04. Motivo: la revisión de deuda técnica del 2026-11-04 demostró que la reconstrucción no coincidía con el stock vivo tras una anulación (50 → 150) y tras una corrección de salida (70 → 80).
- MOVIMIENTOS es la **única fuente de verdad**. Ninguna fila se modifica ni se borra, salvo el cambio de estado de anulación definido por T-022.
- CAPAS_FIFO, STOCK_ACTUAL y CONSUMOS_FIFO son **derivados**: se pueden reconstruir siempre a partir de MOVIMIENTOS.
- **Anular** es añadir un movimiento compensatorio que la reconstrucción entiende.
- **Corregir** es añadir un ajuste visible en el historial. Nunca se reescribe el albarán ni el movimiento original.
- Persistencia: primero MOVIMIENTOS (y sus consumos), después lo derivado, siempre en el mismo orden y desde una única función.
- La reconstrucción reproduce los movimientos **en el orden en que se registraron** (columna `secuencia`, T-002). La fecha de negocio decide la fecha de cada capa, y con ella el orden FIFO, pero no el orden de reproducción. Motivo: una venta consumió las partidas que existían cuando se registró. Reproducir por fecha de albarán daría otro reparto entre partidas.
- La operación en vivo y la reconstrucción usan la **misma función pura** (`aplicarMovimiento`, T-022). Así coinciden por construcción.
- Regla de prueba: después de cualquier operación, **la reconstrucción da exactamente el mismo estado que el vivo**.

## D-023 — Una sola tubería de entrada, con todas las fuentes válidas
Sustituye a D-001. Confirmado por el usuario el 2026-11-04: «todos deben ser válidos».
- Fuentes de entrada y salida de stock, **todas válidas para mover stock**:
  - CSV de Hispatec (fuente principal, la que se importa a diario);
  - albarán en PDF;
  - foto de albarán o plantilla escrita a mano (F-1);
  - entrada manual.
- Todas producen las mismas **líneas canónicas** y pasan por la misma previsualización, los mismos pendientes (D-006, D-009) y la misma confirmación. Solo el servicio de importación escribe documentos.
- Cada movimiento y cada capa guarda `origen_dato`: `CSV`, `PDF`, `FOTO` o `MANUAL`.
- **Un mismo albarán nunca cuenta dos veces**, venga por la fuente que venga. La identidad es tipo + serie + número (D-010), sea cual sea el origen. Si un albarán ya entró por PDF y luego llega en el CSV con las mismas líneas, se salta. Si llega con líneas distintas, se marca «MODIFICADO EN ERP».
- Los documentos sin serie ni número (foto de plantilla, entrada manual) entran como **provisionales**. Cuando llega el albarán ACT/NT correspondiente, se concilian con él actualizando la misma capa (mismo `id_capa`), sin sumar los dos. Las reglas exactas de conciliación se fijan en el ticket de F-1.

## D-024 — Identificadores únicos
Los IDs de documentos, movimientos, capas, consumos y reprocesos se generan con `Utilities.getUuid()` en Apps Script y con `crypto.randomUUID()` en Node, con un prefijo legible (`MOV-`, `CAPA-`…). Nunca con `Date.now()` ni con aleatorios cortos.
Motivo: en una importación en lote se crean cientos de IDs en el mismo milisegundo; con el esquema actual, las colisiones serían casi seguras.

## D-025 — Kilos informativos para estadísticas y previsiones
Confirmado por el usuario el 2026-11-04 (mejoras futuras: kilos vendidos, previsión de entradas y ventas).
- Cada movimiento guarda `kg_informativo`, cuando la fuente lo trae:
  - compras: `PesoNetoLACCA`;
  - ventas: `PesoNetoEnviado`;
  - foto y manual: opcional.
- **Nunca interviene en el stock**, que se cuenta en cajas (D-004) o en unidades (D-021). Ninguna regla de stock lo lee.
- Se guarda desde el primer día para que las estadísticas y previsiones futuras tengan historial. Se guardan los datos ahora; las funciones vendrán después.

## Pendientes de decidir (no los resuelve un agente)
- **P-1 — Identidad y acceso a la web app.** Opciones:
  - Ejecutar como el usuario que accede: el email real queda en la auditoría, pero hay que compartir la hoja con cada usuario.
  - Ejecutar como propietario, con una lista blanca y un PIN: en cuentas Gmail personales no se obtiene el email del usuario.

  Bloquea T-011 y T-020.
- **P-2 — Visibilidad del repositorio.** El repositorio es público y contiene la matriz comercial con nombres de clientes y el ID del script. Recomendado: hacerlo privado.
