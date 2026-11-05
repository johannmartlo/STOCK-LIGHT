# T-005 — Catálogo y clasificación: seguimiento, atributos y agrupaciones configurables

Carril: A (núcleo), con permiso expreso para los archivos indicados de otros carriles. Rama: `ticket/T-005-catalogo-clasificacion`, creada desde `main` **después del merge de T-004** (5d8328a o posterior). Sensible: **sí**, porque decide qué líneas cuentan en el stock (seguimiento).
Especificación: **reescrita el 2026-11-05** con la decisión D-029, que sustituye a la versión «grupos configurables». Decisiones D-003, D-006 (actualizada), D-021, D-023 y D-029. Analizado por el director técnico sobre `main` 5d8328a, con la matriz de referencia y el código de CCO V1.

## Por qué cambia el planteamiento (D-029)
El «grupo comercial» mezclaba material del envase, familia, programa de cliente y si se lleva stock. Se separa en tres piezas, todas configurables en hojas:
1. **Seguimiento.** Atributo especial `SEGUIMIENTO` (SI/NO). Decide si una línea cuenta en el stock. Si ninguna regla decide, es PENDIENTE (cuarentena).
2. **Catálogo.** Atributos de cada artículo + envase (FAMILIA, MATERIAL, PROGRAMA…), calculados con reglas y con excepciones exactas.
3. **Agrupaciones.** Listas ordenadas de cajones con filtros sobre atributos. La agrupación `COMERCIAL` reproduce los grupos de siempre.

**Una combinación seguida cuenta en el stock aunque no tenga clasificación comercial**: cae en el cajón «SIN CLASIFICAR».

## Lo que ya existe (verificado; no lo rehagas)
- `normalizarNombre` (T-006) y la clave normalizada (T-004).
- El clasificador de T-006B, `clasificar(lineas, config, esCombinacionSeguida)`, espera una función `(articulo, envase) => 'SEGUIDA' | 'NO_SEGUIDA' | 'PENDIENTE'`.
- T-023: toda función global nueva se clasifica en `docs/API_PUBLICA.md`. Las de editor son `ADMIN` y empiezan con `exigirPropietario_()`.
- CCO V1 usaba un motor de reglas equivalente (`saas_reglas_bloques`: prioridad, incluye/excluye por variedad y envase).

## Problema (verificado en 5d8328a)
- `src/CommercialGroupResolver.js` tiene escritos en el código:
  - los grupos (`COMMERCIAL_GROUPS`);
  - la lista Carrefour (`CARREFOUR_OFFICIAL_ARTICLES`, comparada con `startsWith`);
  - las reglas de `_initBaseRules`, incluida `REGLA_ROSA_DE_SABOR` (todo el Rosa Sabor a Cartón/Rosa, en contra de la decisión del responsable);
  - `parseRawGroupName`;
  - la carga automática de `docs/reference/MATRIZ_COMERCIAL_BASE.csv` en el constructor.
- `src/MasterInitializationService.js` usa `COMMERCIAL_GROUPS` y `parseRawGroupName`, más una copia de las reglas como alternativa, para crear la matriz desde ese CSV.
- No hay forma de decir qué se sigue.
- **Datos de la matriz de referencia** (438 combinaciones; 38.153 líneas históricas):
  - todos los artículos llevan «TOMATE»; todos los envases EPS llevan «EPS»;
  - las reglas actuales clasifican 300 combinaciones; 138 quedan sin grupo (81 sin envase, 55 tomates «fuera de catálogo», 2 de Volley con formato excluido);
  - el JAPI 650 g es «TOMATE JAPI UNID» con «CARTON 60X40X11 TDA 6X650 JAPI».
- Reglas actuales con lógica especial:
  - **Carrefour:** el artículo empieza por uno de 6 nombres **y** el envase contiene uno de: IFCO, PURA RAZA, MADERA 8X300, MADERA 10X300, MADERA 10X500, 10X225, 8X225, CARREFOUR, CARTON 40X30X14 GENERICA. Prioridad 25, antes que EPS (45);
  - **Volley:** si el envase contiene «40X30X11 VOLLEY HD Q5», o «40X30X11» y «VOLLEY» a la vez, la combinación queda sin clasificar («VOLLEY_FORMATO_EXCLUIDO»).

## Reglas

### 1. Hojas nuevas (en `SCHEMA_DEFINITIONS`)
- **`ATRIBUTOS`**: `nombre, descripcion, activo`.
  - Los nombres van en mayúsculas.
  - `SEGUIMIENTO` es obligatorio y especial: sus valores son SI o NO.
  - Una regla o excepción con un atributo inexistente o inactivo se ignora y se informa en `explicar`.
- **`REGLAS_CLASIFICACION`**: `id, atributo, valor, prioridad, articulo_contiene, articulo_excluye, envase_contiene, envase_excluye, activo, observaciones`.
  - En cada campo de condición, `;` separa alternativas (O) y `+` une términos que deben aparecer **todos** (Y). Ejemplo: `40X30X11+VOLLEY;40X30X11 VOLLEY HD Q5`.
  - `*_contiene`: basta una alternativa. `*_excluye`: la regla no aplica si se cumple cualquier alternativa. Un campo vacío no filtra.
  - Comparación «contiene» sobre texto normalizado (D-003); los términos también se normalizan.
  - **Por atributo**, gana la regla activa de menor `prioridad`. Con empate, la primera de la hoja. Cada atributo se resuelve de forma independiente.
- **`CATALOGO`**: `articulo, envase, atributo, valor, activo, observaciones`.
  - Son excepciones **exactas**: artículo + envase normalizados, por atributo.
  - Una excepción activa gana a las reglas, **solo para ese atributo**.
  - Nunca hay coincidencia parcial.
- **`AGRUPACIONES`**: `agrupacion, orden, grupo, subgrupo, filtro, activo`.
  - Dentro de cada `agrupacion`, las filas activas se evalúan por `orden`, y la combinación cae en la **primera** cuyo `filtro` se cumple.
  - Varias filas pueden tener el mismo `grupo` y `subgrupo`: es una forma de expresar O.
  - Sintaxis del filtro: `ATRIBUTO=v1|v2; OTRO!=v3`.
    - `;` es Y entre condiciones; `|` es O entre valores; `!=` es negación.
    - Un atributo vacío no es igual a ningún valor.
    - Un filtro vacío lo acepta todo.
  - Si una combinación no cumple ninguna fila, su resultado es el cajón `SIN CLASIFICAR`.

### 2. Módulo de catálogo (nuevo)
- **`src/Catalogo.js`**, puro: ni Sheets ni `require` de servicios.
  - `clasificarCombinacion(articulo, envase, config)` → `{ seguimiento: 'SEGUIDA'|'NO_SEGUIDA'|'PENDIENTE', atributos: {NOMBRE: valor}, cajones: {AGRUPACION: {grupo, subgrupo}} }`.
  - `explicarCombinacion(...)`: igual, más qué excepción o regla decidió cada atributo y qué fila de agrupación ganó.
  - `cumpleFiltro(atributos, filtro)`: se exporta para reutilizarla en las vistas (T-013).
- **`src/CatalogoService.js`**:
  - lee las cuatro hojas mediante `Repository`, con una caché por ejecución;
  - expone `clasificar`, `explicar` y **`esCombinacionSeguida(articulo, envase)`**, con la firma exacta que espera `clasificar` de T-006B.

### 3. `CommercialGroupResolver` pasa a ser una fachada
- Mantiene sus métodos públicos actuales (`resolve`, `classify`, `explain`, `getGroups`, `getCombinacionesPendientes` y los que usen `StockQueryService`, `OperationalSafetyService` y `Código.js`) y la **misma forma de salida** (grupo, subgrupo y estado).
- Internamente delega en el catálogo usando la agrupación `COMERCIAL`.
- Pierde `COMMERCIAL_GROUPS`, `CARREFOUR_OFFICIAL_ARTICLES`, `parseRawGroupName`, `_initBaseRules`, la carga automática del CSV y cualquier nombre de producto.
- `extraerCalibreYCategoria` se **mueve sin cambios** a `src/CalibreCategoria.js`, y se actualiza quien la use. Su rediseño es de T-016.
- **Los métodos de la fachada que escriben grupos o matriz** (`addAssociation`, `registerRule`, `registerGroup`, `loadMatrix`…) **no se reimplementan**:
  - si alguna prueba o llamada los necesita, lanzan `Error('Obsoleto: usar el catálogo (D-029)')`;
  - la prueba afectada se adapta (aceptación 9).

### 4. Semilla
**`src/SemillaCatalogo.js`**, solo datos, es el **único** archivo de `src/` con nombres de productos, envases o clientes.
- **Atributos:** SEGUIMIENTO, FAMILIA, MATERIAL, PROGRAMA, REVISAR.
- **Reglas de SEGUIMIENTO**, en este orden de prioridad:
  1. `articulo_contiene` = `JAPI UNID` → NO (D-021, hasta T-017);
  2. `articulo_excluye` = `TOMATE` → NO («solo se lleva stock de tomate»);
  3. `articulo_contiene` = `TOMATE` → SI.
- **Reglas de MATERIAL:**
  - `envase_contiene` = `EPS` → EPS;
  - `envase_contiene` = `MADERA` con `envase_excluye` = `CARTON` → MADERA;
  - Cartón: traduce la condición actual (contiene CARTON, contiene CART o empieza por CT) a la forma más ajustada que dé el mismo resultado en la aceptación 6. Si «contiene CT» clasifica algo de más, usa términos más precisos.
- **Regla de PROGRAMA:** Carrefour → CARREFOUR, con los 6 artículos en `articulo_contiene` y los 9 envases en `envase_contiene`. Pasa de «empieza por» a «contiene»; si eso cambia algo, se ve en la aceptación 6.
- **Reglas de FAMILIA**, con este orden relativo:
  - HUEVO DE TORO (`HUEVO DE TORO;HUEVO TORO`);
  - VOLLEY (`VOLLEY;CORAZON DE BUEY;CORAZON BUEY`);
  - JAPI;
  - JAPONES;
  - ROSA SABOR (`ROSA SABOR;ROSA DE SABOR`), **antes** que ROSA;
  - AZUL;
  - ROSA;
  - MORESCO.
- **Regla de REVISAR:** artículo de Volley y envase `40X30X11 VOLLEY HD Q5;40X30X11+VOLLEY` → SI.
- **Agrupación `COMERCIAL`**, en este orden. Reproduce las prioridades actuales:
  1. CARREFOUR: `PROGRAMA=CARREFOUR`.
  2. EPS: `MATERIAL=EPS`.
  3. HUEVO_TORO: `FAMILIA=HUEVO DE TORO`.
  4. VOLLEY: `FAMILIA=VOLLEY; REVISAR!=SI`.
  5. JAPI_JAPONES: `FAMILIA=JAPI|JAPONES`.
  6. JAPI_JAPONES: `FAMILIA=ROSA SABOR; MATERIAL=MADERA` (decisión del responsable).
  7. CARTON / AZUL: `MATERIAL=CARTON; FAMILIA=AZUL`.
  8. CARTON / ROSA: `MATERIAL=CARTON; FAMILIA=ROSA|ROSA SABOR`.
  9. CARTON / MORESCO: `MATERIAL=CARTON; FAMILIA=MORESCO`.
  10. CARTON / OTROS: `MATERIAL=CARTON`.
  11. SIN CLASIFICAR: filtro vacío.

  Usa los mismos `id` de grupo que hoy (EPS, HUEVO_TORO, VOLLEY, JAPI_JAPONES, CARTON, CARREFOUR) para que la fachada y las pantallas sigan funcionando. Si el orden actual de reglas no se corresponde con esta lista, manda la aceptación 6: ajusta el orden y anótalo.
- Si una regla actual no se puede expresar así, **para y pregunta**. No añadas lógica al motor para encajarla.

### 5. Siembra, API e inicialización
- **`sembrarCatalogo()`** en `src/Código.js`, de tipo `ADMIN`. Es idempotente:
  - añade las filas de la semilla que no existan (por `nombre` en ATRIBUTOS, por `id` en REGLAS_CLASIFICACION y por `agrupacion` + `orden` en AGRUPACIONES);
  - **nunca modifica ni borra** filas existentes;
  - devuelve un resumen.
- **API** en `src/Código.js`:
  - `apiGetConfiguracionCatalogo()`: LECTURA;
  - `apiClasificarCombinacion(articulo, envase)`: LECTURA, devuelve la explicación;
  - `apiUpsertReglaClasificacion(regla)`: ESCRITURA;
  - `apiUpsertExcepcionCatalogo(excepcion)`: ESCRITURA.

  Validan el atributo contra ATRIBUTOS, y SEGUIMIENTO solo admite SI/NO. La auditoría usa `usuarioActual_()`.
- **`docs/API_PUBLICA.md`:** clasifica las funciones nuevas. Marca como **OBSOLETA** (nota «se retira en T-012, D-029») `apiUpsertGrupoComercial`, `apiUpsertMatrizArticuloEnvase`, `apiGetGruposComerciales` y `apiGetMatrizArticuloEnvase`:
  - las dos de escritura devuelven un error claro «Obsoleto: usar el catálogo (D-029)» sin escribir;
  - las de lectura siguen leyendo sus hojas.
- **`MasterInitializationService`:**
  - deja de usar `COMMERCIAL_GROUPS` y `parseRawGroupName`, y se elimina su copia de reglas;
  - ya no crea filas de matriz desde el CSV de referencia;
  - sigue cargando los catálogos de artículos y envases;
  - para la configuración, llama a la lógica de siembra.

## Aceptación
1. **Prueba nueva (Rosa Sabor), en la agrupación COMERCIAL:**
   - «TOMATE ROSA SABOR I G» con «MADERA 40X30X8 TOMATES DE AUTOR» → JAPI_JAPONES;
   - con «CARTON 40X30X9,5 ROYAL PINK» → CARTON/ROSA;
   - con «CARTON 40X30X9,5 MADERA» → CARTON/ROSA.
2. **Prueba nueva (motor de reglas):**
   - menor prioridad gana;
   - `;` funciona como O y `+` como Y;
   - `*_excluye` anula la regla;
   - una regla inactiva no cuenta;
   - dos atributos se resuelven de forma independiente.
3. **Prueba nueva (catálogo):** una excepción exacta gana a las reglas solo para su atributo. «TOMATE ROSA I» con «EPS 104» **no** toma la excepción de «TOMATE ROSA I M» con «EPS 104».
4. **Prueba nueva (seguimiento):**
   - «TOMATE COCKTAIL I M» → SEGUIDA;
   - «TOMATE JAPI UNID» → NO_SEGUIDA;
   - «PIMIENTO CALIFORNIA ROJO» → NO_SEGUIDA;
   - un tomate inventado sin familia ni material reconocible → **SEGUIDA**, y en COMERCIAL cae en SIN CLASIFICAR;
   - pasando `esCombinacionSeguida` a `clasificar` de T-006B, las líneas salen OK y NO_SEGUIDA según corresponda;
   - con una configuración sin reglas de SEGUIMIENTO, la línea sale PENDIENTE.
5. **Prueba nueva (agrupaciones):**
   - una combinación Carrefour en envase EPS cae solo en CARREFOUR, no cuenta dos veces;
   - añadiendo en la hoja una agrupación `POR_MATERIAL` (EPS / CARTON / MADERA / resto), sin tocar código, `clasificarCombinacion` devuelve su cajón.
6. **Prueba nueva (no se pierde nada):**
   - carga `docs/reference/MATRIZ_COMERCIAL_BASE.csv` como dato de comprobación y usa la fachada con solo la semilla;
   - cada fila con `GRUPO_COMERCIAL` relleno resuelve **al mismo grupo y subgrupo**;
   - excepciones admitidas: solo las del Rosa Sabor (aceptación 1). Cualquier otra se lista en `logs/T-005/aceptacion.md` con su causa; **si hay más de 5, para y pregunta**;
   - las 2 de Volley con formato excluido quedan en SIN CLASIFICAR;
   - se informa cuántas filas sin grupo y con envase quedan en SIN CLASIFICAR, y que todas son SEGUIDA.
7. `grep -niE "CARREFOUR|ROSA|JAPI|JAPONES|EPS|CARTON|VOLLEY|HUEVO|MORESCO|AZUL|MADERA|TOMATE"` sobre `src/Catalogo.js`, `src/CatalogoService.js` y `src/CommercialGroupResolver.js` no devuelve nada.
8. **Prueba nueva (siembra):**
   - sembrar dos veces deja las mismas filas;
   - un cambio hecho a mano en una regla o en una fila de agrupación se conserva al volver a sembrar.
9. Pruebas existentes que dependían de las reglas fijas, de la carga automática del CSV o de métodos obsoletos de la fachada: `commercial_group_resolver.test.js`, `stock_query.test.js` y las de fase5, fase6, fase6_1, fase8 y fase8_1.
   - Se **adaptan cargando la semilla**.
   - El resultado esperado no cambia, salvo el Rosa Sabor en madera.
   - Las que prueban métodos obsoletos se sustituyen por la prueba equivalente sobre el catálogo.
   - Cada aserción tocada se lista en `aceptacion.md` con su motivo. Si alguna no encaja en estos casos, **para y pregunta**.
10. Funciones globales nuevas y obsoletas reflejadas en `docs/API_PUBLICA.md` (prueba 7 de `t023_superficie.test.js` en verde).
11. `BUSINESS_RULES.md` (§1.4) y `DATA_MODEL.md` documentan las cuatro hojas, el orden de resolución, la sintaxis de filtros y la semilla (D-029).
12. `node test/run_all.js` con 0 fallos, salida en `logs/T-005/tests.txt`.

## Archivos previstos
- `src/Catalogo.js` (nuevo, puro)
- `src/CatalogoService.js` (nuevo)
- `src/SemillaCatalogo.js` (nuevo, solo datos)
- `src/CalibreCategoria.js` (nuevo; función movida sin cambios)
- `src/CommercialGroupResolver.js` (fachada)
- `src/Repository.js` (esquema y lectura/escritura de las cuatro hojas)
- `src/MasterInitializationService.js` (permiso expreso)
- `src/StockQueryService.js` y `src/OperationalSafetyService.js` (solo si hay que ajustar cómo obtienen el resolvedor)
- `src/Código.js` y `docs/API_PUBLICA.md` (permiso expreso; carril B en pausa)
- `test/t005_catalogo.test.js` (nuevo)
- Pruebas existentes de la aceptación 9 (solo lo que indica)
- `BUSINESS_RULES.md`, `DATA_MODEL.md`
- `docs/tickets/T-005-catalogo-clasificacion.md` (este ticket, primer commit, sin editar)
- `logs/T-005/*`

Si necesitas otro, para y pregunta. `docs/reference/MATRIZ_COMERCIAL_BASE.csv` no se modifica. Las hojas GRUPOS_COMERCIALES y MATRIZ_ARTICULO_ENVASE **no se borran** del esquema (se retiran en T-012).

## Fuera de alcance
- Pantallas de configuración (T-012).
- Vistas por atributos (T-013).
- Pendientes y equivalencias de nombres (T-008, D-028).
- Importación (T-007).
- Maestro de Hispatec (T-010).
- Unidades del JAPI (T-017).
- Formato MATRIZ y calibres (T-016).

## Parar y preguntar si
- Una regla actual no se puede expresar con la semilla.
- La aceptación 6 da más de 5 diferencias.
- Una prueba existente no se puede adaptar como dice la aceptación 9.
- Hay que decidir a qué familia o grupo va un producto concreto: lo decide el responsable.
- **Cualquier cambio no descrito en este ticket, aunque sea en un archivo previsto, se lista en «Dudas».**
