# T-036 — Informe de entrega

1. **Rama:** `ticket/T-036-guia-uso-diario`, creada desde `main` = `2f96585` por indicación del responsable; primer commit `719ade6` solo con el ticket sin editar, entrega en `745f97f`.
2. **Entrega:** `docs/GUIA_USO.md` con los 9 apartados y 10 capturas ficticias en `docs/guia/` (390 px para móvil y 1440 px para ordenador).
3. **Pruebas:** `node test/run_all.js` → **43 suites, 429 pruebas, 0 fallos**; salida en `logs/T-036/tests.txt`. No se ha tocado ningún archivo de `src/` ni de `test/`.
4. **Aceptación:** los 3 puntos comprobados (detalle en `logs/T-036/aceptacion.md`). Todas las capturas son PNG de menos de 200 KB y usan datos ficticios de `tools/vista-previa/`.
5. **Dudas:** se listan abajo las diferencias encontradas y los detalles no pedidos literalmente.

## git status

```text
On branch ticket/T-036-guia-uso-diario
Your branch is ahead of 'origin/main' by 2 commits.
  (use "git push" to publish your local commits)

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	logs/T-025/fusion.md
	logs/T-025/tests-rebase.txt

nothing added to commit but untracked files present (use "git add" to track)
```

`logs/T-025/*` son restos sin seguimiento de una tarea anterior y no se incluyen.

## git log --oneline -5

```text
745f97f docs(T-036): guia de uso diario con capturas ficticias
719ade6 docs(T-036): anadir ticket de guia de uso diario
2f96585 docs(T-035): completar informe de entrega
488fc06 fix(T-035): proveedor en columna y pareja con ventas pendientes
7245877 docs(tickets): anadir T-035 recepciones con proveedor en columna
```

## Comprobación de nombres y diferencias

Se revisaron las pantallas y botones citados en `src/ui/` de `main`:

- La barra lateral llama **Cambios** al apartado; la pantalla se llama **Cambiar confección**. El ticket usa «Cambiar» como nombre del apartado, pero la guía usa los nombres reales.
- El botón **Ajuste** de la partida y del panel de variedad lo añade T-033 en tiempo de ejecución; existe en `main` y se cita con ese nombre.
- El botón **Parte de la noche** de la cabecera de Existencias lo añade T-034 en tiempo de ejecución; existe en `main` y se cita.
- La fila **Cliente excluido** existe en la vista previa de Importar, pero los datos ficticios no tienen patrones de exclusión configurados; se explica en la guía, aunque no hay captura de esa fila.
- La fila **Modificado en Hispatec** existe; la captura de Importar muestra dos albaranes «ya importados», no uno modificado. La guía explica el caso y remite a Pendientes.
- El correo del parte es a las **21:00 por defecto** y la hora es configurable. La guía lo dice así.

## Dudas

- **Base de la rama:** el ticket dice «creada desde `main` = `e0cd99f`», pero la instrucción del responsable indica `main` = `2f96585`. Se ha creado desde `2f96585` y el ticket se ha subido sin editar, tal como pedía el ticket. No se ha cambiado esa línea del ticket.
- **Rama remota anterior:** ya existía `origin/ticket/T-036-guia-uso-diario` con la entrega anterior basada en `e0cd99f`. Esta entrega se ha rehecho desde `2f96585`; si el push normal es rechazado por no ser descendiente, habrá que actualizar solo esa rama con `--force-with-lease`.
- **Captura extra:** además de las 9 capturas mínimas, se añadió `docs/guia/02b-ventas-sin-stock-1440.png` para enseñar una venta que queda pendiente por falta de stock. No era obligatoria, pero el ticket pide explicar esa fila.
- **Captura de Ajuste:** no hay una vista de Ajuste en `tools/vista-previa/`; la captura se obtuvo abriendo el modal real con el botón de Ajuste sobre datos ficticios. No se modificó `tools/vista-previa/`.
- **Enlace y PIN:** se explica «Añadir a pantalla de inicio» como opción del menú del navegador, porque no es un botón de la app. El PIN se describe como «de 4 a 6 cifras», que es lo que permite la pantalla de creación.
- **Cliente excluido y modificados:** se explican en el texto, pero no se pudieron capturar con los datos ficticios actuales (no hay patrones de exclusión ni un albarán modificado en la vista previa). Si se quiere una captura real de esos dos estados, haría falta ampliar los datos ficticios en otro ticket.
- **`logs/T-036/aceptacion.md`:** se añadió como evidencia de los puntos de aceptación; el ticket solo pedía `logs/T-036/tests.txt` y `logs/T-036/informe.md`, pero `logs/T-036/*` está en los archivos previstos.
- **Sin cambios de código:** no se tocó `src/`, `test/` ni `tools/`; los únicos archivos nuevos son la guía, las capturas y los logs.

## Corrección recepciones

Se corrigió `docs/GUIA_USO.md` (commit `efb7aeb`) para que hable de **recepciones** y no de compras, porque desde T-032 las entradas se importan con el informe de recepciones de Hispatec y la app rechaza el de compras.

- En el apartado 2.1 se indica ahora: «exporta el informe de **RECEPCIONES** (no el de entradas o compras) y el de **ventas**».
- Se sustituyeron las menciones de compras por recepciones en el orden de importación, la venta sin stock, Pendientes, la corrección de errores y los recordatorios.
- Bajo la captura 02 se añadió: «La pantalla todavía dice “compras”: es el informe de recepciones de Hispatec.»
- No se tocó ningún otro archivo.
