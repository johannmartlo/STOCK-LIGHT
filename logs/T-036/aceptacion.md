# T-036 — Aceptación

Rama: `ticket/T-036-guia-uso-diario`, creada desde `main` = `2f96585` por indicación del responsable. El ticket dice `e0cd99f`; se ha respetado la indicación y no se ha editado el ticket.

## 1. La guía cubre los 9 apartados

`docs/GUIA_USO.md` contiene los nueve apartados y cada uno tiene al menos una captura:

| Apartado | Captura |
| :--- | :--- |
| 1. Entrar | `docs/guia/01-entrar-390.png` |
| 2. Cada mañana | `docs/guia/02-importar-1440.png` y `docs/guia/02b-ventas-sin-stock-1440.png` |
| 3. Cambios de confección | `docs/guia/03-cambiar-1440.png` |
| 4. Destrío y ajustes | `docs/guia/04-destrio-390.png` |
| 5. Pendientes | `docs/guia/05-pendientes-1440.png` |
| 6. Corregir un error | `docs/guia/06-movimientos-1440.png` |
| 7. Parte de la noche | `docs/guia/07-parte-390.png` |
| 8. Comerciales | `docs/guia/08-comerciales-390.png` |
| 9. Preguntas frecuentes | `docs/guia/09-ajuste-390.png` |

Las diez imágenes son PNG, de 390 px (móvil) o 1440 px (ordenador), con datos ficticios de `tools/vista-previa/`. La mayor ocupa 190.636 bytes (< 200 KB). No hay datos reales.

## 2. Nombres de pantallas y botones

Comprobados en `src/ui/` de `main`:

- **Entrar:** `Hola de nuevo`, `Entrar`, `PIN de 4 a 6 cifras`.
- **Importar:** `Importar de Hispatec`, `CSV de Hispatec`, `Elegir archivos CSV`, `Confirmar importación`, `Limpiar`; filas `albaranes nuevos`, `ya importados`, `modificados en Hispatec`, `sin stock`, `serie ignorada`, `cliente excluido`, `artículo sin decidir`.
- **Cambiar:** barra lateral `Cambios`; pantalla `Cambiar confección`; `1. Origen`, `2. Destino`, `3. Destrío y fecha`, `Sin destrío (0)`, `Confirmar cambio`, `Deshacer`.
- **Destrío y ajustes:** `Destrío`, `Registrar destrío`, `Ajuste`, `Ajuste de stock`, `Recuento`, `Revisar`, `Confirmar destrío`, `Confirmar ajuste`.
- **Pendientes:** `Ventas sin stock`, `Reintentar ahora`, `Artículos nuevos sin decidir`, `Seguir este artículo`, `Ignorarlo`, `Albaranes cambiados en Hispatec`, `Marcar revisado`, `Aplicar la versión nueva`.
- **Movimientos:** `Movimientos`, `Anular el cambio`, `Anular el destrío`, `Anular el ajuste`, `Motivo de la anulación (obligatorio)`.
- **Parte:** `Parte`, `Parte de la noche`, `Copiar texto`, `Copiado`.
- **Comerciales:** `Existencias`, `Sacar`, `Desglose por artículo y envase`, `Sale primero la de arriba`, `Compartir`, `Copiar`, `Buscar variedad o artículo`.

### Diferencias encontradas

- El ticket llama «Cambiar» al apartado; en la barra lateral el botón se llama **Cambios** y la pantalla **Cambiar confección**. La guía usa los nombres reales.
- El botón **Ajuste** de la partida y del panel de variedad lo añade T-033 en tiempo de ejecución (no está escrito en `partida.html`), pero existe en `main` y se cita con ese nombre.
- El botón **Parte de la noche** de la cabecera de Existencias lo añade T-034 en tiempo de ejecución; existe en `main` y se cita.
- La fila **Cliente excluido** existe en la vista previa de Importar, pero los datos ficticios no tienen patrones de exclusión configurados; la guía la explica, aunque no hay captura con esa fila.
- La fila **Modificado en Hispatec** existe; en la captura de Importar salen dos albaranes «ya importados», no uno modificado. La guía explica el caso y remite a Pendientes.
- El correo del parte sale a las **21:00 por defecto**; la hora es configurable. La guía lo dice así.

## 3. Sin cambios en `src/` ni en `test/` y pruebas en verde

- `git status` no muestra ningún archivo de `src/` ni de `test/`.
- `node test/run_all.js` → **43 suites, 429 pruebas, 0 fallos**. Salida completa en `logs/T-036/tests.txt`.
