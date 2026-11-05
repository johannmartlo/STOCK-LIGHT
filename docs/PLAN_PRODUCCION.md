# Plan de puesta en producción de STOCK-LIGHT

Versión: 2026-11-04 (MVP, trabajo en paralelo por carriles). Sustituye a la del 2026-10-28. Estado detallado y carriles en `docs/STATE.md`.

## 0. Punto de partida
- La interfaz web está en `prep/public-baseline` (773fc40). Se fusiona en `main` al verificar T-001.
- La revisión del 2026-11-04 encontró tres problemas graves:
  - la reconstrucción no coincide con el stock vivo;
  - las escrituras no son atómicas;
  - hay funciones de administración expuestas.

  Se resuelven antes de usar datos reales, en T-022 y T-023.
- `feature/ci-postgres-validation` queda aparcada; no entra en este plan.

## 1. Arquitectura de producción

| Elemento | Desarrollo (DEV) | Producción (PROD) |
| :--- | :--- | :--- |
| Proyecto Apps Script | El actual (ID en `.clasp.json` local) | **Nuevo e independiente** |
| Hoja de datos | «STOCK-LIGHT DEV», con datos ficticios o copias | «STOCK-LIGHT PROD», solo datos reales |
| Carpeta de Drive | DEV, más una carpeta de copias | PROD, más una carpeta de copias (T-018) |
| Propietario | Cuenta de desarrollo | Cuenta de la empresa, no una personal |
| Implementación web | De prueba | Una con **URL fija**; cada versión se publica editando esa misma implementación |

Despliegue: dos archivos `.clasp.json` (dev y prod), que no se versionan. A producción solo llega una etiqueta de git ya verificada en DEV.

## 2. Cómo se trabaja con varios agentes
1. El **director técnico** (Claude) re-basa cada ticket sobre el código fusionado, lo deja en `docs/tickets/` y redacta el mensaje de arranque para el agente.
2. El **agente** de cada carril ejecuta el ticket en su rama y la sube a GitHub (AGENTS.md).
3. El director técnico **verifica** la rama contra el ticket: ejecuta las pruebas, revisa el diff y comprueba cada punto de aceptación.
4. El **responsable** (Juan Alberto) fusiona en `main` (o pide al director técnico que lo haga).
5. Los carriles se coordinan por archivos. Ningún agente toca archivos de otro carril.

Se lanza un ticket por carril y cada uno se verifica antes de lanzar el siguiente. Eso tiene un coste, pero evita que un error del núcleo se propague a los demás.

## 3. Fases

### F1 — Base fiable y lectura de CSV (a partir del jueves 5/11)
- **Día 1:** T-001 por la mañana, solo. Tras verificarlo y fusionarlo, en paralelo: T-002 (A), T-023 (B) y T-006 (C).
- **Siguientes:** T-022 (A, el más delicado, hasta un día), T-018 (B), T-006B (C). Después, T-003, T-004 y T-005 (A).

**Para pasar:** T-001 a T-006B fusionados, todas las pruebas en verde y la prueba de propiedades de T-022 con 0 diferencias.

### F2 — Importación y pantallas (MVP completo)
- T-007 y T-008 (C).
- T-011 (B, tras decidir P-1).
- T-012 y T-013 (D), adaptando las pantallas que ya existen.

**Para pasar:** importar los CSV de un día de prueba en DEV desde el móvil, ver el stock por grupo y anular una operación.

### F3 — Ensayo con un mes real en DEV (T-015)
1. Cargar como stock inicial el del Excel (STOCK_DIARIO_MASTER) en una fecha D.
2. Importar los CSV reales desde D+1 hasta hoy.
3. Comparar con el Excel del día y explicar cada diferencia.

**Para pasar:**
- 0 diferencias sin explicar;
- la importación diaria completa en menos de 2 minutos;
- `comprobarConsistencia` con 0 diferencias.

### F4 — Arranque en PROD y paralela con el Excel
- **Fecha:** se fija **cuando pase F3**, no antes. Arrancar con la base sin verificar sería peor que esperar unos días.
- **Conteo físico** al cierre del día D, por partida: proveedor, fecha, artículo, envase y cajas. Antes de cargarlo, copia de seguridad.
- **Regla de corte:** desde D+1 se importan los CSV con fecha posterior a D, nunca los de D.
- Durante dos semanas se mantienen los dos sistemas, con conteos de comprobación los viernes.
- **Corte** cuando dos conteos seguidos tengan 0 diferencias sin explicar. A partir de ahí, el Excel queda solo para consulta.

### F5 — Después del corte
Por orden de valor (STATE §5): reproceso completo, panel de salud, resumen diario, kilos vendidos, previsiones, plantillas por foto y agentes.

**Estimación honesta:** la base y la lectura de CSV (F1) llevan unos 2-3 días hábiles; el MVP completo (F2), unos 2-3 más. Puede alargarse si los CSV reales traen casos no previstos o si P-1 no se decide.

## 4. Rutina diaria en producción
1. **Mañana (encargado, unos 10 min):**
   1. exportar del ERP el CSV de compras y el de ventas del día anterior;
   2. importar **primero compras y después ventas**;
   3. revisar el resumen.
2. **Pendientes:**
   - asociar los artículos nuevos a su grupo;
   - revisar las ventas sin stock: casi siempre falta una compra o un reproceso por registrar.
3. **Durante el día:** reprocesos y destríos. Hasta T-009, como dos ajustes manuales.
4. **Viernes:** conteo de comprobación del género con más movimiento.

## 5. Despliegue de versiones nuevas
1. Ticket verificado y fusionado en `main` con una etiqueta (`vX.Y`).
2. `clasp push` a DEV, más una prueba rápida de 10 minutos en el móvil y en el PC: importar los ficheros de ejemplo, ver una vista, hacer un ajuste y anularlo.
3. Copia `PRE_DESPLIEGUE` de PROD (T-018), `clasp push` a PROD y edición de la implementación existente (la URL no cambia).
4. Repetir la prueba rápida en PROD, en modo consulta.

**Vuelta atrás:** publicar la versión anterior en la implementación. Si los datos quedaron dañados, restaurar la copia (`docs/RESTAURAR_COPIA.md`).

## 6. Riesgos y mitigación

| Riesgo | Mitigación |
| :--- | :--- |
| Stock inicial mal contado | Conteo por partida, ensayo F3 y conteos semanales en F4 |
| Reconstrucción distinta del vivo | D-022 y T-022; `comprobarConsistencia` antes de cada despliegue |
| Un día sin importar | La importación de varios días a la vez es segura; panel de salud tras el MVP |
| Venta importada antes que su compra | Pendientes y reintento automático (T-008) |
| Artículo nuevo en el ERP | Cuarentena sin pérdida y aviso (D-006) |
| Dos agentes pisándose | Carriles por archivos (STATE §2) y verificación antes de cada merge |
| Alguien edita la hoja a mano | Protección de hojas (T-019, tras el MVP) y copia diaria |
| Dependencia de una cuenta personal | Propietario de PROD: la cuenta de la empresa |

## 7. Decisiones necesarias del responsable
1. **P-1:** ¿qué cuentas usáis (Google Workspace de la empresa o Gmail personales) y cuántas personas entrarán? Bloquea T-011.
2. **P-2:** hacer privado el repositorio, dando antes acceso al director técnico.
3. **Cuenta de la empresa** que será propietaria de PROD.
4. Quién importa cada mañana y quién hace los conteos.
