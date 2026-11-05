# STATE — Estado de STOCK-LIGHT

Actualizado: 2026-11-04 (noche). Sustituye al STATE del 2026-10-23.

## 0. Situación
- **Código:** `main` (5815de2) y `prep/public-baseline` (773fc40, 18/10). La segunda contiene la interfaz web (fases 7 y 8) y se fusionará en `main` al verificar T-001; es un avance rápido. GitHub y el PC de trabajo están iguales; no hay trabajo sin subir.
- **Revisión de deuda técnica** (2026-11-04): `analisis/REVISION_DEUDA_TECNICA_2026-11-04.md`, en el proyecto. Tres problemas graves:
  - la reconstrucción no coincide con el stock vivo (demostrado);
  - las escrituras no son atómicas;
  - hay funciones de administración expuestas al navegador.

  Se resuelven con T-022 y T-023.
- **Decisiones nuevas:** D-011 actualizada (reproceso), D-022 (libro de solo añadir), D-023 (una sola tubería; todas las fuentes válidas), D-024 (identificadores) y D-025 (kilos informativos).

## 1. Objetivo: versión mínima que sustituya al Excel puente (MVP)
**Entra en el MVP:**
- base fiable: T-001, T-002, T-022, T-003, T-004;
- seguridad mínima: T-023;
- copias diarias: T-018;
- importación CSV: T-005, T-006, T-006B, T-007, T-008;
- puesta en marcha: T-011, T-012 y T-013, adaptando las pantallas existentes;
- ensayo con un mes real: T-015.

**Se aplaza, sin perder nada:**

| Aplazado | Mientras tanto |
| :--- | :--- |
| T-009, reproceso completo | Un reproceso se registra como dos ajustes manuales: − en la partida origen y + en el destino, con la misma fecha y proveedor |
| T-010, maestro de Hispatec | Las combinaciones nuevas se asocian desde pendientes |
| T-014, pantalla de operaciones nueva | Se usan las pantallas de ajuste existentes |
| T-016, formato MATRIZ | Se usa el formato LISTA |
| T-017, JAPI por unidades | El JAPI 650 g queda en un grupo no seguido (D-021) |
| T-020, acceso por PIN | T-023 deja el usuario del servidor; P-1 pendiente |
| T-021, panel de salud | — |
| T-024, maestros únicos | — |
| PDF y fotos (F-1) | Entrarán por la tubería común (D-023) sin rehacer nada |

## 2. Carriles y archivos de cada uno
Cada carril trabaja en paralelo, con **un ticket a la vez**, y solo toca sus archivos (AGENTS.md).

| Carril | Agente | Archivos propios | Tickets, en orden |
| :--- | :--- | :--- | :--- |
| **A — Núcleo** | Gemini Antigravity | `src/InventoryEngine.js`, `src/MovementService.js`, `src/Repository.js`, `src/OperationalSafetyService.js`, `src/Fechas.js`, `src/Libro.js`, `src/Ids.js`, `DATA_MODEL.md`, `BUSINESS_RULES.md`, `test/run_all.js`, `test/helpers/` | T-001 → T-002 → T-022 → T-003 → T-004 → T-005 |
| **B — Operación y seguridad** | DeepSeek | `src/Código.js`, `src/Seguridad.js`, `src/BackupService.js`, `src/appsscript.json`, `docs/API_PUBLICA.md`, `docs/RESTAURAR_COPIA.md` | T-023 → T-018 → (T-011 tras P-1) |
| **C — Importación** | Codex | `src/Normalizacion.js`, `src/importacion/*`, `test/fixtures/csv/*` | T-006 → T-006B → T-007 → T-008 |
| **D — Pantallas** (más adelante) | OpenCode, opcional | `src/Index.html` (y sus parciales) | T-012 → T-013, cuando T-007 esté fusionado |

**Archivos compartidos** (un cambio pequeño cada vez; el ticket dice cuál): `src/Config.js` (T-023 y T-006B) y `src/CommercialGroupResolver.js` (T-004 y T-005).

**Dependencias entre carriles:**
- T-001 va primero y solo. Todos los demás empiezan desde `main` cuando T-001 está fusionado.
- T-004 reutiliza `normalizarNombre` de `src/Normalizacion.js` (T-006), así que espera al merge de T-006.
- T-007 escribe stock, así que espera a T-022, T-003, T-004 y T-005 (carril A) y a T-006B. Toca `Repository.js` y `Código.js` con permiso explícito del ticket.

## 3. Tickets

| Ticket | Título | Carril | Depende de | Estado |
| :--- | :--- | :--- | :--- | :--- |
| T-001 | Ejecutor único de pruebas y helper de mocks | A | — | **Listo para lanzar** |
| T-002 | Fecha de negocio, secuencia, origen y kilos | A | T-001 | **Listo** (revisado el 04/11) |
| T-022 | Libro de solo añadir; reconstrucción = vivo | A | T-002 | **Listo** (nuevo) |
| T-003 | Hoja CONSUMOS_FIFO | A | T-022 | Por revisar: simplificar sobre `Libro.js` |
| T-004 | Clave de stock por nombre normalizado | A | T-003, T-006 | Por revisar: reutilizar `Normalizacion.js` |
| T-005 | Grupos configurables y grupos seguidos | A | T-004 | Por revisar |
| T-023 | Superficie del servidor | B | T-001 | **Listo** (nuevo) |
| T-018 | Copias de seguridad | B | T-023 | **Listo** (nuevo) |
| T-006 | Lector de CSV a líneas canónicas | C | T-001 | **Listo** (dividido el 04/11) |
| T-006B | Clasificador de líneas y documentos | C | T-006 | **Listo** (nuevo) |
| T-007 | Aplicar importación en lote | C | T-005, T-006B, T-022 | Por revisar: usar `Libro.js`, `nuevoId` y `origen_dato` |
| T-008 | Pendientes y reintentos | C | T-007 | Por revisar |
| T-011 | Puesta en marcha | B | T-018 | **Bloqueado: P-1** |
| T-012 | Pantalla de importación | D | T-007 | Por revisar: adaptar `Index.html` |
| T-013 | Pantalla de stock por vistas (LISTA) | D | T-012 | Por revisar |
| T-015 | Ensayo con un mes real | — | Todo el MVP | Pendiente |
| T-009, T-010, T-014, T-016, T-017, T-020, T-021, T-024 | Después del MVP | — | — | Aplazados |

«Por revisar» significa que el director técnico re-basa el ticket sobre el código ya fusionado antes de lanzarlo. Los tickets se lanzan de uno en uno por carril, nunca a ciegas. **En `docs/tickets/` solo están los tickets listos.** Si un ticket no está ahí, no se ejecuta.

## 4. Decisiones pendientes
- **P-1:** identidad y acceso a la web app. Bloquea T-011 y T-020.
- **P-2:** hacer privado el repositorio. Antes de hacerlo, dar acceso al director técnico (Claude) por GitHub o mediante la carpeta del PC, para que pueda verificar.

## 5. Después del MVP (por orden de valor)
1. T-009 reproceso completo (D-011 actualizada) y T-021 panel de salud.
2. Resumen diario automático (Telegram o correo), reutilizando CCO.
3. Kilos vendidos por grupo, cliente y semana (D-025).
4. Previsión de entradas por agricultor y temporada; previsión de ventas y días de cobertura.
5. F-1: plantillas preimpresas y lectura por foto. Agentes: asistente de consultas en lenguaje natural y skills de redactar y verificar tickets.

## 6. CCO V1 como referencia
CCO V1 (`proyecto-live-almacen`, en el PC de trabajo en `C:\dev\ALMACEN-INTELIGENTE`) no se usa como base. Se toman de él:
- las **reglas** de reproceso (D-011): un origen y varios destinos, con herencia de fecha y agricultor, ampliadas a varias partidas;
- la **referencia visual** táctil.

No se copia su búsqueda de artículos por coincidencia parcial.
