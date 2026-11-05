# STATE — Estado de STOCK-LIGHT

Actualizado: 2026-11-05 (noche). Sustituye al STATE del 2026-11-04. Decisiones en `docs/decisions.md` (D-001 a D-032).

## 0. Situación
- **`main` = T-005 fusionado (`8a89dad`).** Todo verificado por el director técnico en clon limpio, con comprobaciones independientes (propiedades con invariantes propios y casos de negocio).
- **Hecho, en el orden en que se fusionó:**
  - T-001 (ejecutor de pruebas);
  - T-006 (lector CSV);
  - T-002 (fecha de negocio, secuencia, origen y kilos);
  - T-023 (superficie del servidor);
  - T-022 (libro de solo añadir);
  - T-006B (clasificador);
  - T-018 (copias);
  - T-003 (CONSUMOS_FIFO);
  - T-004 (clave por nombre normalizado);
  - T-005 (catálogo y clasificación, D-029).
- **Cambios de planteamiento del 2026-11-05:**
  - el **catálogo con atributos** sustituye a los grupos comerciales fijos (D-029); un tomate sin clasificar cuenta en el stock;
  - el **reproceso entra en el MVP** (D-030): es diario y Hispatec no lo registra;
  - **acceso por enlace personal y PIN** (D-032);
  - abonos sin movimiento de stock (D-031);
  - volumen de hasta unas 100 líneas al día (D-027).

## 1. MVP: lo que falta
| Orden | Ticket | Carril | Agente | Estado |
| :--- | :--- | :--- | :--- | :--- |
| 1 | T-009 Reproceso | A | Gemini Antigravity | **Listo para lanzar** (re-basado el 05/11) |
| 1 | T-020 Acceso: enlace, PIN, roles y despachador | B | DeepSeek | **Listo para lanzar** (nuevo, D-032) |
| 1 | T-007 Importación CSV en lote | C | OpenCode con DeepSeek | **Listo para lanzar** (re-basado el 05/11) |
| 2 | T-008 Pendientes y equivalencias | C | OpenCode | Por revisar (D-028, D-029, D-030) |
| 3 | Pantallas: importación, stock por vistas, reproceso rápido, usuarios | D | por decidir | Por revisar (T-012, T-013, T-014; D-029, D-030) |
| 3 | T-011 Instalación y stock inicial | B | DeepSeek | Por revisar (siembra del catálogo, T-020) |
| 4 | T-015 Ensayo con un mes real | — | responsable + director técnico | Pendiente (añadir los criterios de D-027) |

Los tres tickets marcados con 1 van **en paralelo**. Tocan `MovementService.js`, `Repository.js` y `Código.js` en **puntos de inserción distintos**, indicados en cada ticket, y llevan una nota de coordinación sobre la guarda `exigirSesionApi_` de T-020. Se fusionan en fila, como siempre.

**Después del MVP:**
- «Recuento rápido» (D-027);
- T-016 formato MATRIZ;
- T-017 JAPI por unidades;
- T-010 maestro de Hispatec;
- T-021 panel de salud;
- estadísticas de kilos y previsiones (D-025).

## 2. Carriles y archivos
| Carril | Agente | Carpeta (portátil `juanalberto`) | Archivos propios |
| :--- | :--- | :--- | :--- |
| A — Núcleo | Gemini Antigravity | `Desktop\ALMACEN\STOCK LIGHT NUEVO` (worktree principal) | `Libro.js`, `MovementService.js`, `Repository.js`, `Catalogo*.js`, `SemillaCatalogo.js`, `CommercialGroupResolver.js`, `OperationalSafetyService.js`, `Ids.js`, `Fechas.js`, `DATA_MODEL.md`, `BUSINESS_RULES.md`, `test/run_all.js`, `test/helpers/` |
| B — Operación y seguridad | DeepSeek | `…\STOCK LIGHT NUEVO-B` | `Código.js`, `Seguridad.js`, `BackupService.js`, `appsscript.json`, `docs/API_PUBLICA.md`, `docs/RESTAURAR_COPIA.md` |
| C — Importación | OpenCode con DeepSeek | `…\STOCK LIGHT NUEVO-C` | `src/importacion/*`, `Normalizacion.js`, `test/fixtures/csv/*` |
| D — Pantallas | por decidir | — | `Index.html` y sus parciales |

- Cada ticket dice qué archivos de otros carriles puede tocar, y dónde.
- **En otro PC:** las carpetas `-B` y `-C` son worktrees de este portátil. En el otro PC hay que crear sus propios clones o worktrees desde GitHub.
- No ejecutar `git worktree prune` desde fuera de Windows.

## 3. Procedimiento (resumen)
1. El director técnico re-basa el ticket y lo deja **sin seguimiento** en `docs/tickets/` de la carpeta del agente. El primer commit del agente es ese archivo, sin editar.
2. El agente trabaja en su rama, sube la rama y da un resumen de 5 líneas. **En «Dudas», todo lo no pedido** (AGENTS.md, punto 6).
3. El director técnico verifica: alcance, pruebas en clon limpio, pruebas de propiedades con invariantes propios y casos de negocio independientes.
4. Fusión en fila, siempre en avance rápido (`git push origin <rama>:main`; nunca `--force` contra `main`). La ejecuta el agente por orden expresa del responsable.

## 4. Decisiones pendientes
- **P-2:** repositorio público por decisión del responsable. Nunca se suben datos reales ni claves.
- P-1 y P-3 están resueltas; P-4, descartada (ver `docs/decisions.md`).

## 5. Deuda técnica conocida (menor)
- `Libro.aplicarMovimiento` normaliza el objeto que recibe (T-004).
- `MasterInitializationService` usa `LOG-INIT` como identificador de reserva si no existe `nuevoId` (T-005; solo en entornos sin generador).
- Rendimiento: `_persistir` reescribe CAPAS_FIFO y CONSUMOS_FIFO completas. Se medirá en T-015 (D-027).
