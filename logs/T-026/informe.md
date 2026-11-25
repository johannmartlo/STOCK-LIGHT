# T-026 — Informe de entrega

## Resumen (5 líneas)

1. Rama `ticket/T-026-deuda-menor`, creada desde `origin/main` `bb816bc`; el primer commit
   contiene solo el ticket, sin editar.
2. Corregido `PendientesService.reintentarPendientes`: cuando una línea
   `SEGUIMIENTO_DESCONOCIDO` pasa a SEGUIDA, sus cajas se suman a `total_cajas` una sola vez
   en ese momento, tanto si se aplica como si queda en `STOCK_INSUFICIENTE`; al aplicarse
   después ya no se vuelven a sumar.
3. La prueba 1 cubre el caso desconocida → SEGUIDA sin stock → aplicación posterior; la
   prueba 2 cubre la aplicación en el mismo reintento sin doble suma.
4. La prueba 3 ejecuta 30 semillas con 5 documentos cada una (150 documentos), fechas
   desordenadas, ventas antes que compras, reglas añadidas al final y una compra grande que
   desbloquea todo: todos los documentos quedan `CONFIRMADO` con `total_cajas` igual a la
   suma de sus movimientos, y reimportar los CSV no crea `MODIFICADO_EN_ERP`.
5. `node test/run_all.js`: **32 suites, 347 pruebas, 0 fallos**. Documentación actualizada en
   `DATA_MODEL.md` y `docs/RESTAURAR_COPIA.md`. Sin merge.

## git status

```text
@@GIT_STATUS@@
```

## git log --oneline -5

```text
@@GIT_LOG@@
```

## Dudas (cambios no pedidos por el ticket)

1. **Nueva sección 3.12 en `DATA_MODEL.md`.** El ticket pedía añadir `PRE_STOCK_INICIAL` a
   «los motivos de copia», pero no había ninguna sección de copias en el modelo. Creé una
   sección con los cuatro motivos (`DIARIA`, `MANUAL`, `PRE_DESPLIEGUE`,
   `PRE_STOCK_INICIAL`), cuándo se crean y su retención. Incluye más de lo pedido, pero deja
   el motivo nuevo en contexto.
2. **Pasos concretos en `docs/RESTAURAR_COPIA.md`.** Además de mencionar el motivo, añadí una
   sección con cuatro pasos para restaurar tras una carga de stock inicial fallida y un
   ejemplo de nombre de copia con fecha ficticia. El ticket pedía «cómo restaurarla»; el
   nivel de detalle es mío.
3. **Interpretación de «30 semillas».** Implementé 30 escenarios independientes, cada uno con
   5 documentos (150 documentos). El ticket no fija cuántos documentos tiene cada semilla ni
   el generador de fechas; usé fechas deterministas por semilla.
4. **La prueba 3 comprueba también el estado intermedio.** Antes de la compra grande, verifica
   que las dos ventas del artículo desconocido ya tienen `total_cajas` correcto aunque sigan
   pendientes. El ticket solo exige la comprobación final; el estado intermedio es la
   regresión concreta que cubre el fallo.
5. **No se tocó ningún archivo de T-024/T-025.** Solo se modificaron
   `src/importacion/PendientesService.js`, `DATA_MODEL.md`, `docs/RESTAURAR_COPIA.md` y el
   test nuevo, además de los logs de este ticket.
