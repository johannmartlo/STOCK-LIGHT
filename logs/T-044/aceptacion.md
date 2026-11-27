# T-044 — Comprobación de aceptación

Fecha: 2026-11-27. Rama `ticket/T-044-recepciones-agrupado`, creada desde `main` = `8ab70b2`.
Comando único: `node test/run_all.js` → **49 suites, 481 pruebas, 0 fallos**
(`logs/T-044/tests.txt`, UTF-8 sin BOM; verificado también en un worktree limpio).

## Criterios de aceptación del ticket

### 1. El fixture agrupado se detecta como RECEPCIONES y da las mismas líneas que con columna Almacen
**Cómo se comprueba:** `test/t044_recepciones_agrupado.test.js`, casos 1 y 2.

- `recepciones_agrupado_almacen.csv` tiene la cabecera `FechaCreacion;;;;Usuario;...`
  (sin nombre en la columna del almacén) y filas de grupo `Empresa:`, `Almacen:` y
  `NombreProveedor:`.
- `detectarTipo` devuelve `RECEPCIONES`; `parsear` devuelve `tipo = RECEPCIONES`, 4 líneas y
  cero errores.
- `recepciones_agrupado_almacen_columna.csv` contiene el mismo contenido con la columna
  `Almacen` nombrada y sin filas de grupo de almacén.
- Las líneas de ambos ficheros coinciden en artículo, envase, cajas, partida, proveedor,
  fecha y almacén (`assert.deepStrictEqual`).

### 2. Proveedor correcto con varios grupos `NombreProveedor:` seguidos
**Cómo se comprueba:** caso 2.

El fixture agrupado encadena `NombreProveedor: PROVEEDOR FICTICIO UNO SL`,
`NombreProveedor: PROVEEDOR FICTICIO DOS SL` y `NombreProveedor: PROVEEDOR FICTICIO TRES SL`
con líneas entre medias. El resultado es:

```text
línea 1 → PROVEEDOR FICTICIO UNO SL
línea 2 → PROVEEDOR FICTICIO UNO SL
línea 3 → PROVEEDOR FICTICIO DOS SL
línea 4 → PROVEEDOR FICTICIO TRES SL
```

También se comprueba que la columna del almacén manda sobre el último grupo: la línea 2
lleva `ALMACEN FICTICIO DOS` aunque el último grupo fuera `ALMACEN FICTICIO UNO`; la línea 3
hereda `ALMACEN FICTICIO UNO` porque su celda de almacén está vacía.

### 3. Las filas vacías y las de grupo no generan líneas
**Cómo se comprueba:** caso 3.

El fixture tiene filas vacías, una fila `Empresa:`, dos de `Almacen:` y tres de
`NombreProveedor:`. El parser devuelve exactamente las 4 líneas de datos, todas con fecha,
recepción, artículo, envase, proveedor y almacén; las filas de grupo no aparecen como líneas.
Se comprueban además las filas CSV de origen (`filaCsv = [5, 6, 8, 11]`).

### 4. Un fichero sin Almacen ni filas de grupo sigue fallando con el mensaje actual
**Cómo se comprueba:** caso 4.

Se toma el fixture agrupado y se eliminan sus filas `Almacen:`. Tanto `detectarTipo` como
`parsear` lanzan exactamente:

```text
Cabecera CSV de Hispatec incompleta: faltan columnas obligatorias de RECEPCIONES: Almacen.
```

La detección no se relaja si falta otra columna obligatoria: solo se acepta la ausencia de
`Almacen` cuando es la única que falta y hay una fila de grupo.

### 5. Todas las pruebas anteriores pasan; total = anteriores + nuevas
**Cómo se comprueba:** caso 5 (fixture de siempre) y ejecutor completo.

- `recepciones_formato_real.csv` sigue dando 5 líneas, los mismos proveedores y las mismas
  cajas que antes; todas sus líneas llevan `ALMACEN UNO`.
- `node test/run_all.js`: **49 suites, 481 pruebas, 0 fallos**. Antes había 48 suites y 475
  pruebas; T-044 añade 1 suite y 6 pruebas. Salida completa en `logs/T-044/tests.txt`.
- La misma suite completa se ejecutó en un worktree limpio (`git worktree add --detach` sobre
  `e57f678`) con el mismo resultado: 49/481, 0 fallos. Así se comprueba que los fixtures
  conservan CRLF en un clon limpio.

## Reglas adicionales

- **Anonimización:** los dos fixtures usan solo nombres inventados (`EMPRESA FICTICIA SL`,
  `ALMACEN FICTICIO UNO/DOS`, `PROVEEDOR FICTICIO UNO/DOS/TRES SL`, `FINCA FICTICIA ...`,
  `TOMATE FICTICIO A/B`, `CAJA FICTICIA 10X500`). No hay nombres reales de proveedores,
  clientes o fincas.
- **Informe sin agrupar:** además de las líneas, el caso 6 importa de punta a punta los dos
  fixtures con `ImportacionService` y comprueba que dejan las mismas capas (partida,
  artículo, envase, cajas, proveedor y fecha), el mismo stock total (25 cajas) y el libro
  consistente.
- **Alcance:** no se añadió filtro por almacén (fuera de alcance); todas las líneas de todos
  los almacenes se importan como hasta ahora. Queda anotado en «Dudas» del informe.
