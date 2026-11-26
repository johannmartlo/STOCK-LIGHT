# Puesta en marcha de STOCK-LIGHT

Guía para dejar una instalación de STOCK-LIGHT funcionando y cargar el stock inicial.
Está pensada para el responsable del almacén: no hace falta saber programar, pero las
funciones se ejecutan desde el editor de Apps Script.

> **Datos ficticios:** los ejemplos usan `<...>` como marcador. Nunca escribas en el
> repositorio IDs reales, correos reales ni nombres de clientes o proveedores reales.

## 1. Dos entornos: DEV y PROD

Se trabaja siempre con dos instalaciones separadas:

| Entorno | Para qué | Hoja de cálculo | Proyecto de Apps Script |
| :--- | :--- | :--- | :--- |
| **DEV** | Probar cambios y ensayos | Una hoja de prueba | Un proyecto de prueba |
| **PROD** | Uso real del almacén | La hoja real | El proyecto real |

- **PROD pertenece a la cuenta Gmail dedicada (P-5).** Esa cuenta es la propietaria del
  proyecto y de la hoja. No se comparte la hoja con nadie: la web app se ejecuta como el
  propietario y nadie debe editar el libro a mano saltándose las reglas.
- DEV y PROD no comparten hoja ni proyecto. Un cambio se prueba primero en DEV y solo
  después se despliega en PROD.

## 2. clasp: trabajar con dos cuentas

`clasp` es la herramienta de línea de comandos de Apps Script. Se instala una vez:

```text
npm install -g @google/clasp
clasp login
```

`clasp login` abre el navegador con la cuenta que se elija. Para cambiar de entorno:

1. `clasp logout` y `clasp login` con la otra cuenta, o usa perfiles de navegador
   distintos para no mezclar sesiones.
2. Comprueba con `clasp status` que estás en el proyecto correcto.

Cada proyecto tiene su propio `.clasp.json` (contiene el `scriptId`). Ese archivo **no se
sube al repositorio**. Guarda una copia por entorno fuera del repositorio, por ejemplo:

```text
Documentos\clasp\stocklight-dev.json
Documentos\clasp\stocklight-prod.json
```

Antes de trabajar, copia el archivo del entorno que toque a `.clasp.json` en la raíz del
repositorio. `.clasp.json`, `.clasp.dev.json` y `.clasp.prod.json` están en `.gitignore`.
Nunca commitees ninguno de ellos.

## 3. Primera instalación

Hazlo primero en DEV y repite después en PROD.

1. **Crear la hoja y el proyecto.** Crea una hoja de cálculo nueva y un proyecto de Apps
   Script asociado (o clónalo con `clasp clone <scriptId>`).
2. **Configurar la hoja de datos.** En el editor de Apps Script, ejecuta:

   ```text
   configurarSpreadsheetId('<ID_DE_LA_HOJA>')
   ```

3. **Configurar la carpeta de Drive** donde se guardarán los PDFs y los CSV originales:

   ```text
   configurarDriveFolderId('<ID_DE_LA_CARPETA_DE_DRIVE>')
   ```

4. **Configurar la carpeta de copias de seguridad** (puede ser otra carpeta):

   ```text
   adminConfigurarCarpetaCopias('<ID_DE_LA_CARPETA_DE_COPIAS>')
   ```

5. **Ejecutar la instalación completa** con el nombre del responsable:

   ```text
   adminInstalarStockLight('Nombre del responsable')
   ```

   La función es idempotente. Hace, en este orden:
   - provisiona todas las hojas, incluida `STOCK_INICIAL_ENTRADA` con su cabecera;
   - siembra el catálogo **solo si** `ATRIBUTOS` y `REGLAS_CLASIFICACION` están vacías;
   - instala la copia diaria si hay carpeta de copias;
   - si no existe ningún ADMIN, crea el primero y devuelve su **enlace personal**.

   Devuelve un informe `{ hecho, yaEstaba, falta, enlace }`. Si `falta` menciona una
   función (por ejemplo `configurarSpreadsheetId`), ejecútala y vuelve a lanzar
   `adminInstalarStockLight`. Si se vuelve a ejecutar sin cambios, `hecho` queda vacío y
   `yaEstaba` indica lo que ya estaba listo.

6. **Fuente de entradas y equivalencias.** En una instalación nueva, las entradas se
   importan del **informe de RECEPCIONES** de Hispatec:

   ```text
   adminConfigurarFuenteEntradas('RECEPCIONES')
   adminConfigurarEquivalencias([
     ['TOMATE FICTICIO II KG', 'TOMATE FICTICIO II S/C'],
     ['TOMATE FICTICIO III UNID', 'TOMATE FICTICIO III']
   ])
   ```

   - `adminInstalarStockLight` fija `FUENTE_ENTRADAS = RECEPCIONES` si la propiedad está
     vacía y no cambia un valor ya existente. Usa `adminConfigurarFuenteEntradas` para
     cambiarla después; exige ser propietario. Con `RECEPCIONES`, el informe de compras se
     rechaza para no contar dos veces la entrada. Con `COMPRAS` se mantiene el
     comportamiento anterior.
   - `adminConfigurarEquivalencias` añade o actualiza la traducción de la descripción de
     recepción al nombre que usa el informe de ventas. Es idempotente. Los ejemplos son
     ficticios: los nombres reales se configuran en cada instalación y nunca se suben al
     repositorio.
   - `apiListarEquivalencias()` permite consultar la configuración (rol CONSULTA).

7. **Crear el resto de usuarios** desde el editor, uno a uno:

   ```text
   crearUsuario('Nombre de la persona', 'CONSULTA')
   crearUsuario('Nombre de la persona', 'ENCARGADO')
   crearUsuario('Nombre de la persona', 'ADMIN')
   ```

   Roles: `CONSULTA` solo lectura; `ENCARGADO` lectura y operaciones; `ADMIN` además
   configuración y usuarios. El enlace personal se muestra una sola vez: guárdalo en la
   pantalla de inicio del móvil de esa persona. El PIN se fija la primera vez que se abre
   el enlace.

8. **Publicar la web app.** En el editor: *Implementar → Nueva implementación → Aplicación
   web*. Ejecutar como **el propietario** y acceso **cualquier persona con cuenta de
   Google** (la identidad real la da el enlace con PIN). Copia la URL de la implementación.
   El archivo `appsscript.json` ya lleva esa configuración.

9. **Parte de la noche.** El parte se manda por correo como respaldo del texto que se copia
   al canal. En el editor:

   ```text
   adminConfigurarParte('responsable@ejemplo.test,encargado@ejemplo.test', 21)
   adminInstalarParteDiario()
   adminEnviarParteAhora()
   ```

   - `adminConfigurarParte` guarda los destinatarios (separados por comas) y la hora local
     (por defecto, 21). Usa direcciones ficticias de ejemplo; las reales se configuran en
     cada instalación y nunca se suben al repositorio.
   - `adminInstalarParteDiario` instala el disparador diario a esa hora en Europe/Madrid.
     Es idempotente: ejecutarlo dos veces deja un solo disparador.
   - `adminEnviarParteAhora` envía una prueba inmediata. Comprueba el asunto
     `Stock DD/MM · N cajas`, el texto copiable y la tabla del correo en el móvil.
   - Si no hay destinatarios configurados, no se envía nada y queda registrado en
     `LOG_OPERACIONES`; un fallo de correo tampoco interrumpe la aplicación.

## 4. Cargar el stock inicial

El stock inicial es una foto del almacén en un momento dado. Se carga **una sola vez** al
empezar, o se añade conscientemente con `anadir: true`.

1. **Rellenar `STOCK_INICIAL_ENTRADA`.** La hoja se crea con la cabecera:

   ```text
   Fecha;Proveedor;Articulo;Envase;Cajas;Kg
   ```

   - `Fecha`: la fecha de la partida (`dd/mm/yyyy` o `YYYY-MM-DD`). No puede ser futura.
   - `Proveedor`: el proveedor de la partida.
   - `Articulo` y `Envase`: los **nombres exactos de Hispatec**, no los del Excel.
   - `Cajas`: entero mayor que 0.
   - `Kg`: opcional.
   - Una fila por partida (proveedor + fecha + artículo + envase). No se agrupan partidas
     distintas en una sola fila.

2. **Previsualizar sin escribir:**

   ```text
   adminPrevisualizarStockInicialDesdeHoja()
   ```

   Revisa cada fila:
   - `OK`: se cargará.
   - `NO_SEGUIDA`: el catálogo dice que no se lleva stock; se salta y se avisa.
   - `DESCONOCIDA`: el catálogo no sabe si se sigue; **bloquea**. Añade la regla o la
     excepción en el catálogo y vuelve a previsualizar.
   - `ERROR_DATOS`: fecha inválida o futura, cajas que no son un entero mayor que 0, o un
     campo obligatorio vacío; **bloquea**.
   - Aviso `NO_VISTA`: la combinación no está en `CATALOGO`; no bloquea, pero conviene
     revisar que el nombre no esté mal escrito respecto a Hispatec.

   La previsualización devuelve un `hash` y unos totales de cajas por artículo + envase,
   por proveedor y general. Cuadra esos totales con el Excel o con el conteo físico.

3. **Confirmar:**

   ```text
   adminConfirmarStockInicialDesdeHoja('<hash>', false)
   ```

   Antes de escribir, crea una copia `PRE_STOCK_INICIAL`. Si la copia falla, **no carga
   nada**. Después aplica todas las filas `OK` en un solo bloqueo y una sola escritura, y
   registra la operación en `LOG_OPERACIONES`. Al terminar reintenta los pendientes por
   stock insuficiente.

   Si ya hay movimientos confirmados, la confirmación se rechaza. La segunda carga solo se
   permite con `anadir: true`:

   ```text
   adminConfirmarStockInicialDesdeHoja('<hash>', true)
   ```

4. **Si la carga está mal, no hay anulación.** Restaura la copia `PRE_STOCK_INICIAL`
   siguiendo `docs/RESTAURAR_COPIA.md`.

### Regla de corte

El stock inicial es el del cierre del día **D**. Desde **D+1** se importan solo los CSV
cuyas fechas sean posteriores a **D**. Así no se cuenta dos veces lo que ya está en la
foto inicial.

5. **Fijar la fecha de corte.** Después de confirmar el stock inicial, ejecuta:

   ```text
   adminConfigurarFechaCorte('<D>')
   ```

   `<D>` es la fecha del cierre del stock inicial en formato `yyyy-MM-dd`, por ejemplo
   `2026-11-26`. Los documentos con fecha igual o anterior a esa fecha quedan
   `ANTERIOR_AL_CORTE` y no entran en el stock. Para quitar el corte:

   ```text
   adminConfigurarFechaCorte('')
   ```

   El corte solo afecta a la importación de CSV; no cambia el stock inicial, los reprocesos
   ni los ajustes manuales.

## 5. Desplegar versiones sin cambiar la URL

La URL de la web app no cambia si se actualiza la implementación existente:

1. Haz los cambios y pruébalos en DEV.
2. `clasp push` para subir el código al proyecto.
3. `clasp deployments` para ver el ID de la implementación de PROD.
4. `clasp deploy -i <ID_DE_LA_IMPLEMENTACION>` para actualizar esa implementación. La URL
   se mantiene.
5. Prueba rápida en el móvil: entrar con PIN, consultar el stock y hacer una operación de
   prueba en DEV (no en PROD).
6. Si algo falla, vuelve a la versión anterior. `clasp versions` lista las versiones y
   `clasp deploy -i <ID_DE_LA_IMPLEMENTACION> -V <NUMERO_DE_VERSION>` vuelve a desplegar
   una versión anterior en la misma implementación.

No se crea una implementación nueva para cada cambio: se actualiza la existente para no
cambiar la URL que ya tienen los móviles.

## 6. Comprobaciones de seguridad

- [ ] PROD usa la cuenta Gmail dedicada (P-5) y la hoja no se comparte.
- [ ] `.clasp.json`, `.clasp.dev.json` y `.clasp.prod.json` no están en el repositorio.
- [ ] La carpeta de copias está configurada y la copia diaria instalada.
- [ ] Cada persona tiene su enlace personal; no se comparten enlaces entre personas.
- [ ] Los enlaces se guardan en la pantalla de inicio del móvil y no se envían por canales
      públicos.
- [ ] Se ha probado la restauración de una copia en DEV.
- [ ] No hay IDs, correos ni nombres reales en el repositorio.
