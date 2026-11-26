# T-036 — Guía de uso diario (solo documentación)

Rama: `ticket/T-036-guia-uso-diario`, creada desde `main` = `e0cd99f`. Sensible: **no** (solo documentación; ningún archivo de `src/`).
Especificación: 2026-11-26 (noche). Arranque real en DEV el 27/11. Usuarios en `UX_MAPA_USUARIOS.md` (en el proyecto): el **administrativo** (ordenador) y los **comerciales** (móvil).

## Objetivo
Una guía corta, en español llano, para quien usa la app cada día. Sin tecnicismos (nada de «capa», «FIFO», «API»): se dice «partida», «sale primero la más antigua», etc.

## Contenido (`docs/GUIA_USO.md`)
1. **Entrar:** el enlace personal y el PIN; guardarlo en la pantalla de inicio del móvil; qué hacer si se olvida el PIN (pedir enlace nuevo al responsable).
2. **Cada mañana (administrativo, ordenador):**
   1. exportar de Hispatec el informe de **recepciones** y el de **ventas** del día anterior, tal cual, sin tocarlos;
   2. Importar → soltar los dos archivos a la vez (el orden lo pone la app) → revisar la vista previa → Confirmar;
   3. qué significa cada fila de la vista previa: nuevos, ya importados, cambiados en Hispatec, sin stock, no se lleva, cliente excluido, artículo sin decidir.
3. **Cambios de confección (Cambiar):** cuándo registrarlos (el mismo día, sobre todo granel → 500); elegir partida, sugerencia habitual, destrío (0 con «Sin destrío»), Deshacer.
4. **Destrío y ajustes:** desde la partida (descuenta de esa partida) o desde la barra (descuenta la más antigua).
5. **Pendientes:** ventas sin stock (se aplican solas al registrar el cambio o la entrada que falta), artículos nuevos («Seguir» o «Ignorar») y albaranes cambiados en Hispatec («Aplicar la versión nueva» con vista previa y motivo).
6. **Corregir un error:** siempre se corrige en Hispatec y se vuelve a importar; la app aplica la versión nueva. Anular desde Movimientos solo para operaciones hechas en la app (cambios, destríos, ajustes).
7. **Parte de la noche:** pantalla Parte → «Copiar texto» → pegar en el canal de WhatsApp; el correo de las 21:00.
8. **Comerciales (móvil):** buscar una variedad, ver calibres, partidas y antigüedad, compartir por WhatsApp.
9. **Preguntas frecuentes:** «la venta no descuenta» (mira Pendientes), «sale un artículo raro» (Seguir o Ignorar), «el stock no cuadra con la cámara» (ajuste con motivo Recuento).

Usa capturas de `tools/vista-previa/` (datos ficticios) en `docs/guia/` (PNG ≤ 200 KB, 390 px para móvil y 1440 px para ordenador). **Nada de datos reales.**

## Aceptación
1. `docs/GUIA_USO.md` cubre los 9 apartados, con una captura por apartado como mínimo.
2. Cada pantalla y botón citado existe en `main` con ese nombre (compruébalo en `src/ui/`); lista en el informe cualquier diferencia que encuentres.
3. Ningún archivo de `src/` ni de `test/` cambia. `node test/run_all.js` sigue con 0 fallos (salida en `logs/T-036/tests.txt`).

## Archivos previstos
- `docs/GUIA_USO.md`, `docs/guia/*.png` (nuevos)
- `docs/tickets/T-036-guia-uso-diario.md` (este ticket, primer commit, sin editar)
- `logs/T-036/*`

## Entrega
`logs/T-036/informe.md`: resumen, `git status`, `git log --oneline -5` y «Dudas».
