# Verificación de Aceptación — T-005 (`ticket/T-005-catalogo-clasificacion`)

## Comprobación de los 12 puntos de aceptación

1. **Prueba nueva (Rosa Sabor), en la agrupación `COMERCIAL`:**
   - Comprobado en `test/t005_catalogo.test.js` (Prueba 1):
     - `TOMATE ROSA SABOR I G` + `MADERA 40X30X8 TOMATES DE AUTOR` → `JAPI_JAPONES` (sin subgrupo).
     - `TOMATE ROSA SABOR I G` + `CARTON 40X30X9,5 ROYAL PINK` → `CARTON / ROSA`.
     - `TOMATE ROSA SABOR I G` + `CARTON 40X30X9,5 MADERA` → `CARTON / ROSA`.

2. **Prueba nueva (motor de reglas):**
   - Comprobado en `test/t005_catalogo.test.js` (Prueba 2):
     - Entre dos reglas activas del mismo atributo, gana la de menor `prioridad` numérica.
     - En `*_contiene` y `*_excluye`, `;` actúa como disyunción (`O`) y `+` como conjunción (`Y`).
     - `*_excluye` anula la coincidencia de la regla.
     - Una regla con `activo: false` se ignora.
     - Dos atributos distintos (`FAMILIA`, `MATERIAL`, etc.) se resuelven de forma independiente sin pisarse.

3. **Prueba nueva (catálogo / excepciones exactas):**
   - Comprobado en `test/t005_catalogo.test.js` (Prueba 3):
     - Una fila activa en `CATALOGO` para `(articulo, envase, atributo)` gana sobre `REGLAS_CLASIFICACION` únicamente para ese atributo, manteniendo los demás atributos calculados por reglas.
     - La coincidencia es por igualdad exacta normalizada (`normalizarNombre`, D-003): `TOMATE ROSA I` + `EPS 104` **no** hereda la excepción de `TOMATE ROSA I M` + `EPS 104`.

4. **Prueba nueva (seguimiento e integración con `ClasificadorLineas.clasificar` de T-006B):**
   - Comprobado en `test/t005_catalogo.test.js` (Prueba 4):
     - `TOMATE COCKTAIL I M` → `SEGUIDA`.
     - `TOMATE JAPI UNID` → `NO_SEGUIDA` (excluido por `+UNID` en `REGLA_SEG_TOMATE` y capturado por `REGLA_NO_SEG_RESTO`).
     - `PIMIENTO CALIFORNIA ROJO` → `NO_SEGUIDA`.
     - Tomate inventado sin familia ni material reconocible (`TOMATE EXPERIMENTAL MARCIANO I G` + `CESTA MIMBRE ARTESANAL`) → `SEGUIDA`, y en la vista `COMERCIAL` cae en `SIN CLASIFICAR`.
     - Al pasar `catalogoService.esCombinacionSeguida` a `clasificar(lineas, config, esCombinacionSeguida)` de `src/ClasificadorLineas.js`, las líneas seguidas devuelven `OK` y las no seguidas `NO_SEGUIDA`.
     - Con una configuración sin reglas de `SEGUIMIENTO`, `esCombinacionSeguida` devuelve `PENDIENTE`.

5. **Prueba nueva (agrupaciones):**
   - Comprobado en `test/t005_catalogo.test.js` (Prueba 5):
     - Una combinación de programa Carrefour en envase EPS (`TOMATE PERA RAMA I M` + `EPS 60X40X11 CARREFOUR`) se asigna únicamente al primer cajón cuyo filtro se cumple (`CARREFOUR`, orden 1) y no se duplica en `EPS` (orden 2).
     - Añadiendo en `AGRUPACIONES` una vista nueva `POR_MATERIAL` (`EPS`, `CARTON`, `MADERA`, `RESTO`) sin tocar código, `clasificarCombinacion` devuelve el cajón de `POR_MATERIAL` para cada combinación.

6. **Prueba nueva (no se pierde nada respecto a `docs/reference/MATRIZ_COMERCIAL_BASE.csv`):**
   - Comprobado en `test/t005_catalogo.test.js` (Prueba 6):
     - Sobre las **300 filas** con `GRUPO_COMERCIAL` relleno en `MATRIZ_COMERCIAL_BASE.csv`, **299 coinciden exactamente** en grupo y subgrupo usando solo la semilla (`src/SemillaCatalogo.js`).
     - **Única diferencia (1 de 300, aceptada por dirección técnica):**
       - **Fila 218:** `TOMATE PERA RAMA I MM` + `CARTON 40X30X14 PURA RAZA`. En el CSV figuraba como `TOMATES EN CAJA DE CARTÓN / OTROS`; con la semilla resuelve a `CARREFOUR` porque `TOMATE PERA RAMA I MM` contiene la subcadena `TOMATE PERA RAMA I M` (artículo de la lista Carrefour) y el envase `CARTON 40X30X14 PURA RAZA` es homologado de Carrefour (previsto en Regla 4 del ticket; el código anterior con `startsWith` daba el mismo resultado).
     - Las **2 filas de Volley con formato excluido** (`CARTON 40X30X11 VOLLEY HD Q5`) tienen `REVISAR = SI` (`REGLA_VOLLEY_FORMATO_EXCL`) y quedan en `SIN CLASIFICAR` (`status: 'REVISAR'`).
     - Sobre las **57 filas sin `GRUPO_COMERCIAL` y con envase**:
       - **57 de 57** tienen `SEGUIMIENTO = SEGUIDA`.
       - **7 filas** son `TOMATE ROSA SABOR` en `MADERA` y ahora clasifican en `JAPI_JAPONES` (Aceptación 1).
       - **50 filas** quedan en `SIN CLASIFICAR` (2 con `REVISAR = SI` de Volley formato excluido + 48 tomates fuera de catálogo en madera).

7. **Cero nombres de negocio en motor, servicio y fachada:**
   - Comprobado en `test/t005_catalogo.test.js` (Prueba 7):
     - La búsqueda insensible a mayúsculas de `CARREFOUR|ROSA|JAPI|JAPONES|EPS|CARTON|VOLLEY|HUEVO|MORESCO|AZUL|MADERA|TOMATE` sobre `src/Catalogo.js`, `src/CatalogoService.js` y `src/CommercialGroupResolver.js` devuelve **0 coincidencias**.

8. **Prueba nueva (siembra idempotente y preservación de cambios manuales):**
   - Comprobado en `test/t005_catalogo.test.js` (Prueba 8):
     - Ejecutar `sembrarCatalogoEnRepositorio_(repo)` dos veces seguidas deja exactamente el mismo número y contenido de filas en `ATRIBUTOS` (5), `REGLAS_CLASIFICACION` (16) y `AGRUPACIONES` (11).
     - Si el usuario modifica manualmente una regla o una fila de agrupación y vuelve a ejecutar la siembra, las hojas no vacías no se sobrescriben y el cambio manual se conserva intacto.

9. **Adaptación de pruebas existentes (Aceptación 9):**
   - Todas las suites indicadas se han adaptado cargando la semilla (`SEMILLA_CATALOGO` / `sembrarCatalogoEnRepositorio_`).
   - **Listado exhaustivo de aserciones existentes adaptadas y su motivo:**
     1. `test/commercial_group_resolver.test.js`:
        - **Prueba 1 (Grupos oficiales):** Se inicializa `CommercialGroupResolver` con `config: SEMILLA_CATALOGO` (carga de semilla).
        - **Prueba 2 (Rosa de Sabor):** En `MADERA 50X30X8` se actualiza la aserción de `CARTON / ROSA` a `groupId: 'JAPI_JAPONES'`, `subgroupId: null` (*motivo: Aceptación 1 y 9, el Rosa Sabor en madera pasa a JAPI_JAPONES*). En `EPS 104` se prueba como excepción explícita en `CATALOGO` o regla de catálogo.
        - **Prueba 15 (Excepción de catálogo / precedencia):** Se sustituye la llamada obsoleta `resolver.addAssociation(...)` por `repo.upsertExcepcionCatalogo(...)` (*motivo: Aceptación 9, sustituir métodos obsoletos en memoria por operaciones sobre el catálogo*).
        - **Prueba 16 (Extensibilidad de grupos):** Se sustituye `resolver.registerGroup(...)` + `resolver.addAssociation(...)` por `repo.upsertAgrupacion(...)` + `repo.upsertExcepcionCatalogo(...)` (*motivo: Aceptación 9, métodos obsoletos reemplazados por equivalentes del catálogo*).
        - **Prueba 17 (Auditoría de matriz de referencia):** Para las 7 filas de `TOMATE ROSA SABOR` en `MADERA` sin grupo en el CSV, ahora se verifica que resuelven a `JAPI_JAPONES` (305 clasificadas + 7 Rosa Sabor en madera = 307 clasificadas, 48 pendientes en madera, 2 revisar de Volley, 12 sin envase; *motivo: Aceptación 1 y 9*).
        - **Prueba 22 (Persistencia en Google Sheets):** Se sustituyen `saveGruposComerciales`/`saveMatrizArticuloEnvase` en el resolvedor por `sembrarCatalogoEnRepositorio_(repo)` + `repo.upsertAgrupacion(...)` + `repo.upsertExcepcionCatalogo(...)` (*motivo: D-029 y Aceptación 9*).
     2. `test/fase5_configuracion_persistencia.test.js`:
        - **Pruebas 3 y 4:** Se añade `sembrarCatalogoEnRepositorio_(repo)` y `repo.upsertAgrupacion` para verificar la carga desde repositorio en `CommercialGroupResolver` manteniendo intacta la prueba de persistencia de `GRUPOS_COMERCIALES` y `MATRIZ_ARTICULO_ENVASE` (*motivo: Aceptación 9*).
        - **Pruebas 5, 8, 9, 10, 11, 12, 13:** Se usa `createSeededResolver()` y se actualiza el formato de `ruleId` y `auditTrace` al formato de `explicarCombinacion` (`REGLA_ROSA_SABOR`, `REGLA_CARREFOUR`, `REGLA_HUEVO_DE_TORO`, `REGLA_JAPONES`, `Agrupación COMERCIAL orden N -> ...`) y en la Prueba 8 se sustituye `resolver.addAssociation` por `repo.upsertExcepcionCatalogo` (*motivo: Aceptación 9*).
        - **Prueba 6 (`TOMATE ROSA DE SABOR G` + `EPS 104`):** Se actualiza la aserción a `groupId: 'EPS'`, `subgroupId: null` (*motivo: D-029: el material del envase decide EPS frente a cartón; la regla fija del Rosa Sabor se elimina*).
        - **Prueba 7 (`TOMATE ROSA DE SABOR EXTRA` + `MADERA 40X30X14`):** Se actualiza la aserción a `groupId: 'JAPI_JAPONES'`, `subgroupId: null` (*motivo: Aceptación 1 y 9, Rosa Sabor en madera clasifica en JAPI_JAPONES*).
        - **Prueba 14 (Dinamismo de grupo nuevo en `StockQueryService`):** Se sustituyen `resolver.registerGroup` y `resolver.addAssociation` por `repo.upsertAgrupacion` y `repo.upsertExcepcionCatalogo` (*motivo: Aceptación 9*).
        - **Prueba 15:** Se inicializa el resolvedor con `createSeededResolver()` (*motivo: Aceptación 9*).
     3. `test/fase6_seguridad_operativa.test.js`:
        - `createTestEnvironment()`: Ejecuta `sembrarCatalogoEnRepositorio_(repo)` al crear el entorno (*motivo: Aceptación 9*).
        - **Prueba 17 (`TOMATE ROSA DE SABOR`):** En `MADERA 40X30X14` se actualiza a `groupId: 'JAPI_JAPONES'`, `subgroupId: null` (*motivo: Aceptación 1 y 9*). En `EPS 104` (3.ª aserción) se actualiza a `groupId: 'EPS'`, `subgroupId: null` (*motivo: D-029: el material del envase decide EPS frente a cartón; la regla fija del Rosa Sabor se elimina*).
        - **Prueba 18 (Nueva asociación dinámica):** Se sustituyen `resolver.registerGroup` y `resolver.addAssociation` por `repo.upsertAgrupacion` y `repo.upsertExcepcionCatalogo`, verificando `grupoComercial === 'GOURMET'` (*motivo: Aceptación 9*).
     4. `test/fase6_1_correcciones_historicas.test.js`:
        - `createTestEnvironment()`: Ejecuta `sembrarCatalogoEnRepositorio_(repo)` al crear el entorno (*motivo: Aceptación 9*).
        - **Prueba 11 (Cambio automático de grupo al corregir el artículo):** Con envase `CARTON 40X30X14 GENERICA`, se corrige de `TOMATE HUEVO DE TORO` (`HUEVO_TORO`) a `TOMATE ROSA DE SABOR` (`CARTON / ROSA`) (*motivo: D-029: el material del envase decide EPS frente a cartón; la regla fija del Rosa Sabor se elimina*).
     5. `test/fase8_auditoria_maestros_inicializacion.test.js`:
        - **Pruebas 3, 5, 6, 7 y 9:** Se actualizan para verificar que `MasterInitializationService.initializeSystem()` aprovisiona y siembra de forma idempotente las 4 hojas del catálogo (`ATRIBUTOS` = 5, `REGLAS_CLASIFICACION` = 16, `AGRUPACIONES` = 11, `CATALOGO` = 0) en lugar de poblar `MATRIZ_ARTICULO_ENVASE` desde el CSV (*motivo: Regla 5 y Aceptación 9*).
     6. `test/fase8_1_prueba_real_aislada.test.js`:
        - **Pruebas 2 y 3:** Se verifica la presencia de las hojas del catálogo (`ATRIBUTOS`, `REGLAS_CLASIFICACION`, `CATALOGO`, `AGRUPACIONES`) y su conteo tras la inicialización (*motivo: Regla 5 y Aceptación 9*).
     7. `test/t004_clave_nombre.test.js`:
        - **Prueba 6 (línea 438):** Autorizado por el director técnico, se retiró únicamente `src/Código.js` de la lista del `git diff main -- src/InventoryEngine.js src/Normalizacion.js`, ya que T-005 modifica legítimamente `src/Código.js`.

10. **Clasificación en `docs/API_PUBLICA.md`:**
    - Comprobado con `node test/t023_superficie.test.js` (8/8 en verde).
    - Añadidas las funciones de `src/Catalogo.js`, `src/CatalogoService.js`, `src/SemillaCatalogo.js`, `src/CalibreCategoria.js` y `src/Código.js` (`sembrarCatalogo`, `apiGetConfiguracionCatalogo`, `apiClasificarCombinacion`, `apiUpsertReglaClasificacion`, `apiUpsertExcepcionCatalogo`), y reclasificadas como `OBSOLETA` `apiGetGruposComerciales`, `apiUpsertGrupoComercial`, `apiGetMatrizArticuloEnvase` y `apiUpsertMatrizArticuloEnvase`.

11. **Documentación actualizada (`BUSINESS_RULES.md` §1.4 y `DATA_MODEL.md` §3.9):**
    - Actualizados ambos documentos con la especificación de las 4 hojas (`ATRIBUTOS`, `REGLAS_CLASIFICACION`, `CATALOGO`, `AGRUPACIONES`), el orden de resolución, la sintaxis de patrones/filtros y la semilla (`src/SemillaCatalogo.js`).

12. **Ejecución completa de pruebas (`node test/run_all.js`):**
    - Resultado: **26 suites ejecutadas, 26 superadas, 0 fallos (281 pruebas superadas)**.
    - Salida completa guardada en `logs/T-005/tests.txt` (UTF-8).
