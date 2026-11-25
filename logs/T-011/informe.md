# T-011 — Informe de entrega

## Resumen (5 líneas)

1. Rama `ticket/T-011-puesta-en-marcha`, creada desde `origin/main` `c99e7d4`; el primer
   commit contiene solo el ticket, sin editar.
2. Implementados `adminInstalarStockLight` (`src/Instalacion.js`) y
   `StockInicialService` (`src/importacion/StockInicialService.js`), con la hoja
   `STOCK_INICIAL_ENTRADA` y el motivo de copia `PRE_STOCK_INICIAL`.
3. Añadidas las funciones de editor `adminPrevisualizarStockInicialDesdeHoja` y
   `adminConfirmarStockInicialDesdeHoja`, y las API `apiPrevisualizarStockInicial` y
   `apiConfirmarStockInicial`, con guarda de sesión, rol ADMIN en `PERMISOS_API` y
   clasificación en `docs/API_PUBLICA.md`.
4. Documentada la puesta en marcha en `docs/PUESTA_EN_MARCHA.md`, con plantilla de stock
   inicial y fixture ficticio; la guía cubre DEV/PROD, clasp, primera instalación, stock
   inicial, regla de corte y despliegue sin cambiar la URL.
5. `node test/run_all.js`: **31 suites, 344 pruebas, 0 fallos**; aceptación 1 a 10 revisada
   en `logs/T-011/aceptacion.md`. Sin merge.

## git status

Salida capturada tras el commit de trabajo `288a6bc`, antes del commit que añade este informe.

```text
On branch ticket/T-011-puesta-en-marcha
Your branch is ahead of 'origin/main' by 2 commits.
  (use "git push" to publish your local commits)

nothing to commit, working tree clean
```

## git log --oneline -5

```text
288a6bc feat(T-011): instalacion, stock inicial y puesta en marcha
36fd197 docs(tickets): anadir T-011 puesta en marcha
c99e7d4 docs(T-008): actualizar informe con seccion de correccion
b6cc504 fix(T-008): punto fijo en reintento, paso a STOCK_INSUFICIENTE, guardia SOLO_MODIFICADO_EN_ERP y avisos
b4b36bc docs(T-008): anadir informe de entrega
```

## Dudas (cambios no pedidos por el ticket)

1. **`src/BackupService.js` no estaba en «Archivos previstos».** El ticket exige
   `crearCopiaSeguridad_('PRE_STOCK_INICIAL')`, pero el servicio solo admitía DIARIA,
   MANUAL y PRE_DESPLIEGUE. Añadí el motivo a `MOTIVOS_COPIA` y al mensaje de error. El
   responsable lo autorizó expresamente antes de hacerlo.
2. **`src/Repository.js`: posición de `STOCK_INICIAL_ENTRADA`.** Se añadió a
   `SCHEMA_DEFINITIONS` antes de `USUARIOS` (no después) para que `USUARIOS` siga siendo la
   última hoja, como exige la prueba 1.1 de T-020. El ticket solo dice «si hace falta crear o
   leer la hoja»; la posición no estaba pedida.
3. **Parámetros `options` adicionales.** `adminInstalarStockLight`,
   `adminPrevisualizarStockInicialDesdeHoja`, `adminConfirmarStockInicialDesdeHoja`,
   `apiPrevisualizarStockInicial` y `apiConfirmarStockInicial` aceptan un `options` final
   para inyectar repositorio, reloj, copia, etc. en las pruebas. Las firmas del ticket no lo
   muestran; es retrocompatible.
4. **Campos extra en el informe de instalación.** `adminInstalarStockLight` devuelve
   `sinCambios` y `enlace` además de `{ hecho, yaEstaba, falta }`. `enlace` solo se rellena
   cuando se crea el primer ADMIN; `sinCambios` facilita comprobar la segunda ejecución.
5. **`Kg` inválido bloquea.** El ticket enumera como `ERROR_DATOS` fecha inválida/futura,
   cajas no enteras o campo vacío. Traté también un `Kg` no numérico o negativo como
   `ERROR_DATOS` (`KG_INVALIDO`) para no guardar un kilo inventado.
6. **`NO_VISTA` solo mira filas activas de `CATALOGO`.** El ticket dice «no está en
   CATALOGO»; consideré que una fila inactiva no cuenta como catálogo. Es una interpretación
   pequeña.
7. **Copia diaria idempotente.** Si ya existe un disparador de `copiaDiariaProgramada`, la
   instalación lo da por bueno y no lo reinstala, para que la segunda ejecución no cambie
   nada. Si existiera con una hora equivocada, no se corrige automáticamente.
8. **`SIN_FILAS_OK`.** Si todas las filas son `NO_SEGUIDA`, `confirmar` devuelve
   `SIN_FILAS_OK` y no crea copia ni escribe. El ticket no define ese caso.
9. **`origen_dato = 'STOCK_INICIAL'` no está en `DATA_MODEL.md`.** El ticket lo exige, pero
   el modelo de datos enumera `CSV`, `PDF`, `FOTO` y `MANUAL`. No actualicé `DATA_MODEL.md`
   porque no está en «Archivos previstos»; queda como inconsistencia documental.
10. **`docs/RESTAURAR_COPIA.md` no menciona `PRE_STOCK_INICIAL`.** El ticket remite a ese
    documento para restaurar la copia previa, pero no lo incluye en «Archivos previstos». El
    procedimiento funciona igual; la lista de motivos del documento se queda corta.
11. **Cabecera de la hoja con `Kg` siempre.** `STOCK_INICIAL_ENTRADA` se crea con
    `Fecha;Proveedor;Articulo;Envase;Cajas;Kg`, aunque `Kg` es opcional en el CSV. La
    plantilla también incluye `Kg`; el CSV acepta 5 o 6 columnas.
12. **Hash de filas, no del texto bruto.** El `hash` se calcula sobre las filas normalizadas
    (fecha, proveedor, artículo, envase, cajas y kg), no sobre el texto CSV byte a byte. Así
    funciona igual para CSV y para la hoja, y detecta cambios de contenido.
13. **`apiPrevisualizarStockInicial` es ESCRITURA aunque no escriba.** Se siguió literalmente
    el ticket («como ESCRITURA y rol ADMIN»), no la costumbre de clasificar las
    previsualizaciones como LECTURA.
14. **Estados de error propios.** `HOJA_NO_DISPONIBLE`, `ENTRADA_INVALIDA`, `BLOQUEADA`,
    `YA_HAY_MOVIMIENTOS`, `COPIA_FALLIDA`, `ERROR_APLICACION` y `SIN_FILAS_OK` son nombres
    nuevos para devolver fallos previstos sin lanzar excepciones; el ticket no fija sus
    nombres.
