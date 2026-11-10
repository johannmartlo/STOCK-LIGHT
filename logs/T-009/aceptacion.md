# Comprobación de Aceptación — Ticket T-009 (Reproceso)

Fecha: 2026-11-10  
Rama: `ticket/T-009-reproceso`  
Resultado: 0 fallos en `node test/run_all.js` (27 suites, 291 pruebas).

---

### Punto 1: Un origen, cambio de envase
* **Condición:**
  * Capa A «TOMATE ROSA SABOR I M | CARTON 40X30X14 GENERICA», 100 cajas, proveedor «PROV A», fecha 2026-10-15.
  * Se reprocesan 60 cajas a «TOMATE ROSA SABOR I | EPS 106 9X500» con 90 cajas.
  * Sin `destrio_cajas`: error con mensaje de la regla 1 (`Indica el destrío en cajas: al cambiar de envase no se puede calcular`), sin mutar stock.
  * Con `destrio_cajas: 3` y `destrio_kg: 18`: A queda en 40 cajas; el destino tiene 90 cajas, fecha 2026-10-15, proveedor PROV A e `id_capa_origen` = A. REPROCESOS guarda 3, 18 y `cambio_envase = SI`.
  * CONSUMOS_FIFO tiene la fila del AJUSTE − sobre A.
* **Verificación:** Comprobado en `test/t009_reproceso.test.js` (Prueba 1). Pasa en verde.

---

### Punto 2: Varios orígenes, mismo envase, género mezclado
* **Condición:**
  * Capas: «TOMATE ROSA SABOR I G | CARTON 40X30X14» (PROV A, 2026-10-10, 30 cajas) y «TOMATE ROSA SABOR I GG | CARTON 40X30X14» (PROV B, 2026-10-12, 20 cajas).
  * Se reprocesan enteras a «TOMATE ROSA SABOR I S/C | CARTON 40X30X14» con 45 cajas, sin `destrio_cajas`.
  * Resultado: destino con fecha 2026-10-10 y proveedor `VARIOS`. Destrío deducido como 5, `cambio_envase = NO`, y REPROCESO_LINEAS lo prorratea en 3 y 2.
* **Verificación:** Comprobado en `test/t009_reproceso.test.js` (Prueba 2). Pasa en verde.

---

### Punto 3: Calibrado por tandas (D-036)
* **Condición:**
  * Capa C «TOMATE SIN CALIBRE | CARTON 40X30X14», 1.000 cajas, PROV C, 2026-11-02.
  * Tanda 1: 400 cajas → «… G | EPS 106» 180, «… GG | CARTON 40X30X14» 150, «… M | TARRINA 500» 50, con `destrio_cajas: 20`.
  * Resultado: C queda en 600; los tres destinos tienen fecha 2026-11-02 y PROV C; REPROCESOS guarda 400 retiradas, 380 destinos y 20 de destrío.
  * Tanda 2 sobre las 600 restantes: C queda en 0 y la suma de ambas tandas cuadra (1.000 retiradas).
* **Verificación:** Comprobado en `test/t009_reproceso.test.js` (Prueba 3). Pasa en verde.

---

### Punto 4: Total repartido por FIFO
* **Condición:** Con capas de 50 (más antigua) y 40 de la misma combinación, retirar 70 consume 50 + 20 (primera queda en 0 y segunda en 20).
* **Verificación:** Comprobado en `test/t009_reproceso.test.js` (Prueba 4). Pasa en verde.

---

### Punto 5: FIFO después
* **Condición:** Con la capa de 90 cajas (fecha 15/10) y una compra posterior de 50 cajas (fecha 20/10), una venta de 100 consume primero la capa reprocesada (90 cajas de la capa de 15/10 y 10 de la compra).
* **Verificación:** Comprobado en `test/t009_reproceso.test.js` (Prueba 5). Pasa en verde.

---

### Punto 6: Errores y validaciones
* **Condición:** Pedir más cajas de las que tiene una capa («La partida X solo tiene N cajas»), usar una capa inactiva, enviar un destino vacío o un destrío negativo devuelve error, y MOVIMIENTOS, capas y REPROCESOS quedan inalterados.
* **Verificación:** Comprobado en `test/t009_reproceso.test.js` (Prueba 6). Pasa en verde.

---

### Punto 7: Anular reproceso
* **Condición:**
  * Sin consumos en destino, todo vuelve exactamente al estado anterior: capas, stock y CONSUMOS_FIFO.
  * Con consumos en destino, devuelve `REVISION_NECESARIA` y no muta nada.
  * Una segunda anulación devuelve error (`REPROCESO_YA_ANULADO`).
* **Verificación:** Comprobado en `test/t009_reproceso.test.js` (Prueba 7). Pasa en verde.

---

### Punto 8: Sugerencias de reproceso
* **Condición:** Después de dos reprocesos de X a {Y} y uno de X a {Z1, Z2, Z3} (el último), `sugerenciasReproceso(X)` devuelve primero el conjunto {Z1, Z2, Z3} con sus cajas y luego {Y} deduplicado.
* **Verificación:** Comprobado en `test/t009_reproceso.test.js` (Prueba 8). Pasa en verde.

---

### Punto 9: Prueba de propiedades
* **Condición:** Operaciones REPROCESO (1-2 orígenes, 1-3 destinos; con `destrio_cajas` si hay cambio de envase) y ANULAR_REPROCESO añadidas a `test/t022_propiedades.test.js` sin cambiar la semilla (20261104), el total de operaciones (200) ni las aserciones existentes. Tras cada operación: `comprobarConsistencia() = 0` y el invariante T-003 de consumos por capa.
* **Verificación:** Ejecutado `node test/t022_propiedades.test.js`. 200 operaciones completadas con éxito, 0 diferencias, todas las familias de operaciones ejecutadas > 0 veces. Pasa en verde.

---

### Punto 10: Compatibilidad de operaciones previas
* **Condición:** Las pruebas de `registrarReclasificacion`, `registrarMovimientoPartida` y `dividirCapaEntrada` siguen en verde sin cambios.
* **Verificación:** Comprobado en `test/t009_reproceso.test.js` (Prueba 10), `test/fase6_1_correcciones_historicas.test.js` y `test/movement_service.test.js`. Pasan en verde.

---

### Punto 11: Documentación y suite global
* **Condición:**
  * `docs/API_PUBLICA.md` actualizado y validado con prueba 7 de `test/t023_superficie.test.js` en verde.
  * `BUSINESS_RULES.md` actualizado en §6 con motivos (`REPROCESO_ORIGEN`, `REPROCESO_DESTINO`, `DESTRIO`) y especificación de reprocesos y destrío (D-036).
  * `DATA_MODEL.md` actualizado con diagrama ER y tablas `REPROCESOS` y `REPROCESO_LINEAS`.
  * `node test/run_all.js` con 0 fallos, salida guardada en `logs/T-009/tests.txt`.
* **Verificación:** Ejecutado y verificado con 27 suites superadas (291 pruebas, 0 fallos).
