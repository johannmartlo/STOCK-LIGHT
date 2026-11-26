# T-032 — Entradas desde el informe de RECEPCIONES de Hispatec

Rama: `ticket/T-032-lector-recepciones`, creada desde `main` = `81dc81c` (T-027, T-031 y T-028 fusionados). Sensible: **MUCHO** (pasa a ser la única fuente de entradas).
Especificación: 2026-11-26. Decisión del responsable (D-040), tras la prueba con datos reales del 23 al 26/11:
- **Las entradas salen del informe de recepciones** (todo lo que llega físicamente al almacén: recepciones normales, recepciones de medianero RNT y lo que aún no tiene albarán de compra).
- El informe de entradas (compras) **deja de importarse**, porque contaría lo mismo dos veces.

Se usa el informe **tal como sale de Hispatec**.

## Formato real (estructura; los datos de abajo son inventados)
```
FechaCreacion;;;Almacen;FechaRecepcion;CodigoProveedor;Referencia;Recepción;Asociación;DescripcionArticulo;Envase;NroEnvases;ENVDescripcion;NroPalets;Numero;PALDescCorta;UnidadesEnvase;Cantidad;Partida;CodigoFinca;Finca;DescFinca;Cultivo;Palet
 - ;Empresa: EMPRESA FICTICIA SL;;;;;;;;;;;;;;;;;;;;;;
; - ;NombreProveedor: PROVEEDOR FICTICIO UNO SL;;;;;;;;;;;;;;;;;;;;;
;;23/11/2026;ALMACEN UNO;23/11/2026;400000001;;/11737 (1);;TOMATE FICTICIO I G;CAJA 40x30 FICTICIA;71,000;CAJA 40x30 FICTICIA;1,000;11737;PALET;4,720;335,000;900001;1;FINCA UNO;;TOMATE;PALET
;;23/11/2026;ALMACEN UNO;23/11/2026;400000001;;/11739 (1);;TOMATE FICTICIO I  KG;CAJA 40x30 FICTICIA;315,000;CAJA 40x30 FICTICIA;5,000;11739;PALET;7,230;2276,000;900002;;;;;PALET
;;;;;;;;;;;;;;;;;;;;;;;
; - ;NombreProveedor: PROVEEDOR FICTICIO DOS SL;;;;;;;;;;;;;;;;;;;;;
;;23/11/2026;ALMACEN UNO;23/11/2026;400000002;;RNT27/26 (2);REPARTO FICTICIO 50%;TOMATE FICTICIO II S/C KG;CAJA 40x30 FICTICIA;394,000;CAJA 40x30 FICTICIA;4,000;26;PALET;2,990;1178,000;900003;2;FINCAS DOS;;TOMATE;PALET
```
Particularidades:
- la cabecera tiene **dos columnas sin nombre**, y en las filas de datos el valor de `FechaCreacion` aparece desplazado; usa siempre `FechaRecepcion`;
- el **proveedor no es una columna**: viene en una fila de grupo `NombreProveedor: …` que precede a sus filas;
- hay filas de empresa (`Empresa: …`), filas vacías (`;;;;`) y filas finales vacías;
- `Recepción` vale `/11737 (1)` (sin serie) o `RNT27/26 (2)` (con serie): número de recepción y número de línea entre paréntesis;
- el artículo viene como **descripción** (`DescripcionArticulo`), que puede llevar sufijos (`KG`, `UNID`) o diferir del nombre que usa el informe de ventas;
- CRLF y UTF-8 (con Ñ y tildes); decimales con coma.

## Reglas
1. **Detección:** es **RECEPCIONES** si la cabecera contiene `Almacen`, `FechaRecepcion`, `Recepción`, `DescripcionArticulo`, `Envase` y `NroEnvases`. Las columnas se leen por nombre (T-030).
2. **Lectura:**
   - una fila es de datos si tiene `FechaRecepcion`, `Recepción` y `DescripcionArticulo`;
   - el proveedor es el de la última fila `NombreProveedor:` leída; una fila de datos sin proveedor previo es `ERROR_DATOS`;
   - las demás filas se saltan sin error.
3. **Documento y línea:**
   - tipo `ENTRADA`;
   - serie = lo que va antes de la `/`, o `REC` si está vacío;
   - número = lo que va entre la `/` y el espacio;
   - línea = el número entre paréntesis;
   - fecha = `FechaRecepcion`, entidad = proveedor, cajas = `NroEnvases`, kg = `Cantidad`, envase = `Envase`;
   - **partida = `Partida`** (se guarda en la capa, en `partida`).
4. **Series que cuentan:** en recepciones cuentan `REC`, `NT` y `RNT`. Ponlo en `PREFIJOS_SERIES_IMPORTACION` como lista propia de recepciones, sin cambiar la de ventas.
5. **Una sola fuente de entradas:**
   - propiedad `FUENTE_ENTRADAS` con valor `RECEPCIONES` por defecto en instalaciones nuevas;
   - con ese valor, **importar un CSV de COMPRAS se rechaza** en la previsualización con el mensaje «Las entradas se importan con el informe de recepciones», sin escribir nada;
   - `adminConfigurarFuenteEntradas('COMPRAS' | 'RECEPCIONES')` lo cambia (propietario).
6. **Nombre del artículo** (descripción → nombre de venta):
   1. normalizar: mayúsculas, espacios colapsados, sin sufijo final ` KG`, ` UNID` o ` UND`;
   2. si hay **equivalencia** en la hoja nueva `EQUIVALENCIAS_ARTICULO` (`descripcion, nombre_articulo, activo, nota`), se usa `nombre_articulo`;
   3. si no, se usa la descripción normalizada.

   `adminConfigurarEquivalencias([[descripcion, nombre], …])` añade o actualiza (propietario; idempotente). **No pongas equivalencias reales en el código ni en la semilla.**
7. **Aviso de nombre sin pareja:** en la previsualización, una línea seguida cuyo artículo nunca ha aparecido en una venta importada (combinaciones de CATALOGO o MOVIMIENTOS de salida) lleva el aviso `SIN_PAREJA_EN_VENTAS`. No bloquea: sirve para detectar equivalencias que faltan.
8. **API** de solo lectura `apiListarEquivalencias()` (CONSULTA), para la futura pantalla.
9. La firma de líneas (`firma_lineas`, T-007) y el resto del flujo (MODIFICADO_EN_ERP, versiones de T-027, pendientes y exclusiones de T-031) funcionan igual con recepciones.

## Precisiones del 26/11 (tarde, tras fusionar T-027, T-031 y T-028)
- **Partida:** ya está conectada de punta a punta. `ImportacionService` pasa `linea.partida` como `partida_origen` y `Libro.js` la guarda en la capa. El lector solo tiene que rellenar `partida` en cada línea.
- **Versiones (T-027 + T-031):** las versiones guardan **todas** las líneas con su estado de clasificación (`_lineasVersionDocumento_`). Las líneas de recepciones deben pasar por la misma clasificación. Una recepción corregida debe funcionar con `aplicarVersion` igual que una compra (añádelo a la prueba 5).
- **Pantalla Importar (T-028):** coloca primero los archivos cuya previsualización devuelve `tipoCsv === 'RECEPCIONES'`. Devuelve exactamente ese valor.
- **Rechazo de COMPRAS (regla 5):** devuélvelo con la misma forma de error que usa hoy la previsualización con un CSV no reconocido, para que la pantalla Importar enseñe el mensaje sin tocar `src/ui/`. Explica en «Dudas» qué forma has usado.
- **Exclusiones (T-031):** solo afectan a las ventas. Las recepciones no se excluyen por proveedor.
- **Equivalencias solo de nombre de artículo.** Decisión del responsable: los cambios de confección que dan las mismas cajas (por ejemplo, rama granel en cartón → rama 500) se registran con el conversor (T-033), no con una equivalencia. **No añadas equivalencias de envase.**

## Aceptación
1. **Fixture nuevo ficticio** `test/fixtures/csv/recepciones_formato_real.csv` con la estructura exacta de arriba:
   - 3 proveedores en grupos, recepciones sin serie y RNT;
   - sufijos KG/UNID, una fila sin proveedor previo;
   - filas vacías, CRLF, UTF-8 con Ñ.

   **Nada de datos reales.**
2. **Prueba nueva:**
   - se detecta como RECEPCIONES;
   - cada línea crea su capa con proveedor, fecha de recepción, cajas y **partida**;
   - la fila sin proveedor da `ERROR_DATOS`;
   - las demás filas se saltan.
3. **Prueba nueva:** con `FUENTE_ENTRADAS = RECEPCIONES`, un CSV de compras se rechaza sin escribir; con `COMPRAS`, funciona como hoy.
4. **Prueba nueva (nombres):**
   - «TOMATE X I KG» y «TOMATE X I UNID» se convierten en «TOMATE X I»;
   - con la equivalencia «TOMATE X II» → «TOMATE X II S/C», una venta de «TOMATE X II S/C» consume la partida recibida como «TOMATE X II KG»;
   - sin la equivalencia, la línea lleva el aviso `SIN_PAREJA_EN_VENTAS`.
5. **Prueba nueva:** reimportar el mismo informe da `YA_IMPORTADO`. Cambiar las cajas de una línea da `MODIFICADO_EN_ERP` con su versión (T-027), y `aplicarVersion` la aplica con el stock correcto y `comprobarConsistencia().consistente === true`.
6. **Prueba nueva (invariante, 30 semillas):** recepciones y ventas aleatorias en formato real, importadas por días en cualquier orden. El stock = cajas recibidas (seguidas) − ventas aplicadas, y `comprobarConsistencia().consistente === true`.
7. Las API nuevas se rechazan sin sesión; las `admin*` exigen al propietario; la cobertura de `t020_acceso.test.js` sigue en verde.
8. `node test/run_all.js` con 0 fallos, salida en `logs/T-032/tests.txt`.

## Archivos previstos
- `src/importacion/CsvHispatecParser.js` (formato RECEPCIONES)
- `src/importacion/ImportacionService.js` (fuente de entradas, normalización y equivalencias, aviso)
- `src/Config.js` (series de recepciones), `src/Repository.js` (hoja `EQUIVALENCIAS_ARTICULO`)
- `src/Equivalencias.js` (nuevo: funciones `admin*` y lectura)
- `src/Código.js`, `src/Seguridad.js`, `docs/API_PUBLICA.md`, `IMPORT_SPECS.md`, `DATA_MODEL.md`, `docs/PUESTA_EN_MARCHA.md` (paso: fuente de entradas y equivalencias)
- `test/t032_recepciones.test.js`, `test/fixtures/csv/recepciones_formato_real.csv` (nuevos, ficticios)
- `docs/tickets/T-032-lector-recepciones.md` (este ticket, primer commit, sin editar)
- `logs/T-032/*`

**No toques** `src/ui/`, `MovementService.js`, `Libro.js`, `InventoryEngine.js` ni `CorreccionService.js`. Si necesitas otro archivo, para y pregunta.

## Entrega
Escribe en `logs/T-032/informe.md`:
- un resumen de 5 líneas;
- la salida de `git status` y de `git log --oneline -5`;
- **«Dudas»** con TODO cambio no pedido.
