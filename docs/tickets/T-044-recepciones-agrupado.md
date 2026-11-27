# T-044 — Lector: informe de recepciones agrupado por almacén

**Agente:** DeepSeek (carpeta B, `STOCK LIGHT NUEVO-B`) · **Rama:** `ticket/T-044-recepciones-agrupado` · **Base:** `main` actual
**Prioridad:** alta (bloquea la importación diaria sin retoques a mano)

## Por qué
En la primera importación real (27/11), el informe de recepciones exportado de Hispatec **agrupado por almacén y proveedor** no se pudo importar:

> Cabecera CSV de Hispatec incompleta: faltan columnas obligatorias de RECEPCIONES: Almacen.

En el informe agrupado, Hispatec deja vacía la columna del almacén en la cabecera y en las líneas, y pone el almacén en una fila de grupo. Para importar hubo que añadir la columna a mano. El administrativo no debe tocar el CSV.

## Forma real del fichero (anonimizada)
```
FechaCreacion;;;;Usuario;FechaRecepcion;CodigoProveedor;Referencia;Recepción;Asociación;DescripcionArticulo;Envase;NroEnvases;...;Partida;...
 - ;Empresa: EMPRESA X;;;;...
; - ;Almacen: ALMACEN A;;;;...
;; - ;NombreProveedor: PROVEEDOR 1;;;...
;;ALMACEN A;27/11/2026;USUARIO;27/11/2026;400000001;;/100 (1);;TOMATE X;CARTON 40x30x14;25,000;...;341547;...
;;;;;;;;;;;;;...            ← filas vacías de separación
```
- La cabecera tiene el nombre de columna vacío donde iría `Almacen` (posición 3).
- En las líneas, el almacén suele venir en esa misma posición (sin nombre de columna).
- Las filas de grupo `Empresa:`, `Almacen:` y `NombreProveedor:` preceden a sus líneas. `NombreProveedor:` ya se trata desde T-032/T-035.

## Qué hay que hacer
1. `detectarTipo`: si la cabecera no tiene `Almacen` pero el fichero tiene alguna fila de grupo `Almacen: <nombre>`, contar `Almacen` como presente y detectar RECEPCIONES.
2. `parsear`: guardar el almacén de la última fila de grupo `Almacen:` (igual que `proveedorActual`) y ponerlo en cada línea como `almacen`. Si la línea trae el almacén en la columna, manda la columna.
3. Si no hay ni columna ni filas de grupo, mantener el error actual (no relajar la detección para otros ficheros).
4. El informe **sin** agrupar (con columna `Almacen`) debe seguir dando exactamente el mismo resultado que hoy.

## Fuera de alcance
- Filtrar por almacén (el 27/11 solo había NATURFRESH). Se anota en «Dudas» si se ve necesario.
- Ventas: su informe no trae almacén.

## Archivos previstos
- `src/importacion/CsvHispatecParser.js`
- `test/t044_recepciones_agrupado.test.js` (nuevo)
- `test/fixtures/` (fixture nuevo y **anonimizado**: nunca nombres reales de proveedores, clientes ni fincas)

## Criterios de aceptación
- El fixture agrupado se detecta como RECEPCIONES y da las mismas líneas (artículo, envase, cajas, partida, proveedor, fecha) que el mismo contenido con columna `Almacen`.
- Proveedor correcto en todas las líneas cuando hay varios grupos `NombreProveedor:` seguidos.
- Las filas vacías y las de grupo no generan líneas.
- Un fichero sin `Almacen` ni filas de grupo sigue fallando con el mensaje actual.
- Todas las pruebas anteriores pasan; el total = anteriores + nuevas.

## Entrega
Sube la rama y escribe `logs/T-044/informe.md` con resumen, `git status`, `git log --oneline -5` y **«Dudas»** (todo lo que hayas cambiado fuera de lo pedido).
