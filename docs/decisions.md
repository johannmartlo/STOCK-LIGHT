# Decisiones de STOCK-LIGHT

Registro de decisiones cerradas. Un ticket cita las decisiones que aplica por su número. Si una situación no está cubierta aquí, el agente para y pregunta.

Fecha de apertura del registro: 2026-10-23. Última actualización: 2026-11-05 (D-026 a D-032 nuevas: FIFO teórico, volumen y rendimiento, equivalencias de nombres, catálogo con atributos, reproceso en el MVP, abonos, acceso por enlace y PIN; D-005 sustituida y D-006 actualizada por D-029; D-011 ampliada por D-030). Anterior: 2026-11-04 (D-001 y D-011 sustituidas; D-022 a D-025 nuevas).

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
**Sustituida por D-029 (2026-11-05).** Se conserva el texto original como referencia.

El grupo comercial es solo una capa de consulta y filtro (BUSINESS_RULES §1.4). Se resuelve únicamente a partir de configuración, por este orden:
1. Coincidencia exacta de artículo + envase normalizados en MATRIZ_ARTICULO_ENVASE.
2. Reglas configurables de la hoja REGLAS_GRUPO, por prioridad.
3. Si nada coincide: «PENDIENTE DE ASOCIACIÓN».

Ningún nombre de producto ni de cliente queda escrito en el código. Cada grupo tiene una marca `seguido` (SÍ/NO).

## D-006 — Género no seguido y combinaciones desconocidas
**Actualizada por D-029 (2026-11-05):** el seguimiento ya no depende del grupo comercial. Lo que cambia: una combinación **seguida** cuenta en el stock aunque no tenga clasificación comercial (cae en «SIN CLASIFICAR»). La cuarentena queda solo para las combinaciones cuyo **seguimiento** es desconocido. El resto de la regla se mantiene.

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
**Ampliada por D-030 (2026-11-05):** el reproceso entra en el MVP; prorrateo del destrío y proveedor común. El resto se mantiene.

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

## D-026 — FIFO teórico por partida
Confirmado por el usuario el 2026-11-05: en la cámara **siempre se respeta el FIFO**, salvo excepciones contadas.
- El CSV de ventas no dice de qué partida sale cada caja. El sistema la deduce: la partida más antigua primero (por fecha de negocio).
- **El total por artículo + envase es exacto** respecto a los albaranes. **El reparto entre partidas es teórico**: coincide con la realidad mientras se respete el FIFO físico.
- Las excepciones se corrigen con ajustes o reprocesos sobre la partida concreta, cuando importe (por ejemplo, para las estadísticas de calidad por proveedor).
- La pantalla de stock marca la partida más antigua como «sale primero», para reforzar el FIFO físico (T-013).

## D-027 — Volumen esperado y criterio de rendimiento
Dato del usuario (2026-11-05): **como mucho 80-100 líneas de albarán al día**, compras y ventas juntas.
- Estimación: unos 30.000 movimientos al año. MOVIMIENTOS (23 columnas) ≈ 700.000 celdas/año, frente al límite de 10 millones de celdas de Google Sheets: margen para varias temporadas.
- **T-015 mide el rendimiento** en una copia de la hoja de Google (no en los mocks de Node) con **un año de movimientos sintéticos** (30.000) y **un día fuerte de 100 líneas**. Umbrales:
  - importar y confirmar un día completo: **< 60 s**;
  - una operación suelta (ajuste, anulación, corrección): **< 15 s**.
- Si no se cumplen, por este orden: (1) escribir solo lo que cambia en vez de reescribir CAPAS_FIFO y CONSUMOS_FIFO completas; (2) cierre de temporada con saldo inicial que archive lo anterior; (3) migrar a una base de datos (proyecto aparte). No se optimiza antes de medir.
- T-015 compara además el stock calculado con un **recuento físico** al final del periodo. Esa diferencia es el indicador de salud del sistema. Después del MVP, el primer ticket nuevo es **«Recuento rápido»** (por vista: cajas contadas por artículo + envase → ajustes con motivo `RECUENTO`); a qué partida va una diferencia positiva se decide en ese ticket.

## D-028 — Equivalencias de nombres y antigüedad de los datos
Decidido el 2026-11-05 para cubrir dos riesgos de la clave por nombre (D-003) y de la importación diaria.
- **Equivalencias (al re-basar T-008):** desde un pendiente `SIN_ASOCIAR`, el usuario puede indicar que un nombre de artículo o de envase es **el mismo** que otro ya existente. Se guarda en una hoja de configuración de equivalencias (`tipo` ARTICULO|ENVASE, `nombre_origen`, `nombre_destino`, normalizados) y la tubería de importación la aplica **antes** de clasificar, de modo que un artículo renombrado en Hispatec suma al stock existente en lugar de abrir una clave nueva. Las equivalencias no se encadenan (el destino no puede ser origen de otra).
- **Antigüedad (al re-basar T-013):** la cabecera de la pantalla de stock muestra la fecha y hora de la **última importación confirmada** («Albaranes importados hasta: 05/11 08:30»), además de la hora de la consulta.
- Pendiente de preguntar a Hispatec si el informe puede enviarse programado a una carpeta de Drive (permitiría importar automáticamente; después del MVP).

## D-029 — Catálogo con atributos, seguimiento independiente y agrupaciones
Confirmado por el usuario el 2026-11-05 («todo lo que sea mejoras lo aplicamos»). Sustituye a D-005 y actualiza D-006.

**Motivo.** El «grupo comercial» mezclaba cuatro cosas distintas: el material del envase (EPS), la variedad o familia (Japi, Huevo de Toro), el cliente o programa (Carrefour) y si se lleva stock (`seguido`). Eso obligaba a reglas forzadas («Rosa Sabor, pero solo en madera, a Japonés») y a crear un grupo nuevo para cada pregunta nueva. Además, la clasificación comercial bloqueaba el stock: un tomate nuevo sin grupo no contaba hasta que alguien lo asociaba.

**Confirmado por el usuario (2026-11-05, noche):** cualquier artículo puede ir en cualquier caja, así que **el grupo lo decide la combinación** artículo + envase (familia por el artículo, material por el envase), nunca el artículo solo. El Rosa Sabor en madera, TDA o genérica, va con el japonés.

**Tres piezas separadas:**
1. **Seguimiento: ¿se lleva stock de esto?** Es un atributo especial, `SEGUIMIENTO` (SI/NO), calculado con reglas. Si ninguna regla decide, el resultado es PENDIENTE (cuarentena, D-006). Configuración inicial confirmada por el usuario: **solo se lleva stock de tomate**; el JAPI por unidades no se sigue hasta T-017 (D-021).
2. **Catálogo: qué es cada artículo + envase.** Cada combinación tiene **atributos** (FAMILIA, MATERIAL, PROGRAMA… y los que se añadan), que se obtienen así:
   - **excepción exacta** en la hoja CATALOGO (artículo + envase normalizados), si existe para ese atributo;
   - si no, la **regla** activa de menor prioridad de REGLAS_CLASIFICACION para ese atributo, con condiciones «artículo/envase contiene o excluye». En cada campo, `;` es O y `+` es Y;
   - si no, el atributo queda vacío.

   Los atributos se configuran en hojas, nunca en el código. El catálogo es también el sitio de los datos por combinación: unidades por caja (D-020), unidad de stock (D-021) y, más adelante, otros.
3. **Agrupaciones y vistas: cómo se quiere ver.**
   - Una **agrupación** es una lista ordenada de cajones, cada uno con un filtro sobre atributos. Cada combinación cae en el **primer** cajón que cumple, así que los totales nunca cuentan dos veces. El último cajón, sin filtro, es «SIN CLASIFICAR».
   - La agrupación `COMERCIAL` reproduce los grupos de siempre (Carrefour, EPS, Huevo de Toro, Volley, Japi y Japonés, Cartón con sus subgrupos). Se pueden crear otras (por material, por familia…) sin código.
   - Las **vistas** (D-019, T-013) usan el mismo lenguaje de filtro sobre atributos, más el proveedor.
   - Sintaxis común del filtro: `ATRIBUTO=v1|v2; OTRO!=v3`. `;` es Y entre condiciones, `|` es O entre valores y `!=` es negación. Un filtro vacío lo acepta todo.

**Modularidad.** El catálogo es un módulo propio. Tiene una función pura, `clasificarCombinacion(articulo, envase, config)`, que devuelve `{ seguimiento, atributos, cajones }`, y un servicio que lee la configuración. El núcleo de stock no lo conoce. La importación, los pendientes, las vistas y las pantallas le preguntan a él y no leen sus hojas directamente.

**Consecuencias en otros tickets** (se aplican al re-basarlos):
- **T-007 (importación):** usa `esCombinacionSeguida` del catálogo. Una línea seguida sin clasificación comercial **se aplica**.
- **T-008 (pendientes):** se simplifica. Los pendientes son solo `SEGUIMIENTO_DESCONOCIDO` y `STOCK_INSUFICIENTE`. «Clasificar» una combinación (añadir excepciones o reglas) no reaplica líneas, porque ya contaban. Incluye las equivalencias de D-028.
- **T-013 (vistas):** los filtros de VISTAS pasan a la sintaxis de atributos, más el proveedor. `unidades_por_caja` es un atributo del catálogo, no una columna nueva de la matriz.
- **T-012 (pantallas):** la configuración muestra reglas, excepciones y agrupaciones. Las hojas GRUPOS_COMERCIALES y MATRIZ_ARTICULO_ENVASE y sus API quedan **obsoletas** desde T-005 y se retiran en T-012.

## D-030 — El reproceso entra en el MVP
Confirmado por el usuario el 2026-11-05.
- **Hechos:**
  - los cambios de envase y los reprocesos ocurren **a diario** (por ejemplo: Rosa de Sabor I M → tarrinas 500 en EPS 106 9X500; Rosa de Sabor I G + I GG → Rosa de Sabor I sin calibre en cartón);
  - **Hispatec no los registra**: es uno de los motivos de esta app;
  - hoy no se registran en ningún sitio.
- **Consecuencia:** sin reproceso, las ventas de los productos reprocesados quedan sin stock y el origen sigue figurando como existente. El reproceso pasa del bloque «después del MVP» al MVP:
  - el ticket del núcleo (T-009) va en el carril A justo después de T-005;
  - su pantalla rápida para el móvil también entra en el MVP.
- **Reglas añadidas a D-011:**
  - **Proveedor del destino:** si todas las partidas de origen son del mismo proveedor, el destino hereda ese proveedor. Si son de varios, el destino lleva «VARIOS», porque el género **se mezcla** en la misma caja (confirmado). La relación con cada partida de origen se guarda aparte.
  - **Destrío prorrateado:** el destrío del reproceso (dato, no movimiento) se reparte entre las partidas de origen en proporción a las cajas retiradas de cada una, para las estadísticas de calidad por proveedor.
  - **Reintento automático:** tras cada reproceso se reintentan los documentos pendientes por stock insuficiente (amplía D-009). Lo implementa T-008.
  - **Rapidez:** la pantalla propone los destinos usados antes desde el mismo origen. El objetivo es registrar un reproceso en menos de un minuto, en el momento de hacerlo.
  - **Pendientes inteligentes (T-008):** si una venta queda sin stock en una combinación que suele salir de reprocesos, el pendiente sugiere «¿falta registrar el reproceso de …?».

## D-031 — Abonos y devoluciones de clientes
Dato del usuario (2026-11-05): en principio no hay devoluciones, pero puede haber **abonos**. Suelen ser **abonos por precio**, sin devolución de mercancía.
- Una línea de venta que sea un abono (cajas negativas o cero, o un documento identificado como abono) **no mueve stock**. Se cuenta en el resumen de la importación como «abono, sin mercancía» y **no va a error de datos**. Se aplica al re-basar T-007; si hace falta, se ajusta la regla de cajas de T-006B.
- Si alguna vez se devuelve mercancía de verdad, se registra a mano como entrada con motivo `DEVOLUCION_CLIENTE` (pantalla de operaciones). Es un caso raro y no se automatiza.
- Cuando aparezca el primer abono real en un CSV, se revisa con él cómo viene exactamente (serie, signo, columnas).

## D-032 — Acceso: enlace personal, PIN y roles (resuelve P-1)
Decidido con el usuario el 2026-11-05. **No hay Google Workspace**; unas 5 personas, aunque en la práctica el usuario lo hará todo o casi todo.
- La web app **se ejecuta como el propietario**. La hoja de cálculo **no se comparte con nadie**, así que nadie puede editar el libro a mano saltándose las reglas.
- **Identidad:**
  - cada persona tiene un **enlace personal** con un código secreto. Solo se guarda su hash. El enlace se genera al dar de alta a la persona y se puede regenerar;
  - la primera vez, la persona fija un **PIN** (4 a 6 cifras). El móvil recuerda el código y, al entrar, solo pide el PIN;
  - 5 intentos fallidos bloquean 15 minutos;
  - la sesión dura unas horas.
- **Todo se comprueba en el servidor:** cada llamada de la interfaz lleva la sesión y pasa por un único despachador, que comprueba la sesión y el rol. Ninguna `api*` se puede llamar directamente desde el navegador.
- **Roles:**
  - `CONSULTA`: solo lectura;
  - `ENCARGADO`: lectura y operaciones;
  - `ADMIN`: además, configuración y usuarios.

  Las funciones de administración del editor siguen protegidas por `exigirPropietario_` (T-023).
- **Auditoría:** cada movimiento queda firmado con el nombre del usuario de la sesión.
- Desactivar a una persona invalida su enlace y sus sesiones al momento.
- Lo implementa T-020, que **entra en el MVP** (carril B). T-011 (instalación y stock inicial) va después.

## Pendientes de decidir (no los resuelve un agente)
- **P-1 — Identidad y acceso a la web app. RESUELTA (2026-11-05) por D-032.**
- **P-3 — Documentos internos que simulan reprocesos. RESUELTA (2026-11-05):** en Hispatec **no** se hacen documentos internos para los reprocesos, así que el importador no puede contarlos dos veces. Lo que se hace es un **ticket de palet**: se captura la línea de pedido del producto final y se le asignan varias partidas de la misma familia. El reproceso solo se registra en la app (T-009).
- **P-4 — Informe de tickets de palet. DESCARTADA (2026-11-05):** según el usuario, ese proceso de Hispatec es erróneo y no descuenta bien las cantidades; no se usa como fuente.
- **P-2 — Visibilidad del repositorio.** El repositorio es público y contiene la matriz comercial con nombres de clientes y el ID del script. Recomendado: hacerlo privado. El 2026-11-05 el usuario decide **mantenerlo público de momento**. Mientras tanto: nunca subir datos reales (D-015) ni claves de API. Antes de hacerlo privado, el director técnico debe pasar a verificar clonando desde la carpeta del PC.
