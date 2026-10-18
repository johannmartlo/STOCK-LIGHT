# C.1 — PostgreSQL CI & Concurrency Validation

## Contexto y alcance

`main` no contiene todavía backend Python ni esquema PostgreSQL. C.1 no es una
migración completa del producto: es un arnés mínimo de validación de las
propiedades que necesitará la futura arquitectura.

El esquema de este directorio **no es el esquema definitivo de producción**.
Modela únicamente los contratos imprescindibles para validar:

- documento de entrada/salida con identidad única;
- movimientos con signo;
- capas FIFO por artículo + envase;
- saldo materializado por artículo + envase;
- claves de idempotencia;
- versión de esquema y checksum de migración.

## Contratos de negocio preservados

1. La unidad de stock es `(article_code, packaging_code)`.
2. Una entrada crea una capa FIFO con `initial_boxes = remaining_boxes`.
3. Una salida consume capas activas en orden `layer_date, id`.
4. No se permite saldo negativo.
5. La misma clave de idempotencia no puede duplicar documentos, movimientos ni
   capas.
6. Una operación fallida no deja escrituras parciales.
7. Dos operaciones concurrentes sobre la misma clave de stock se serializan
   mediante bloqueo de fila y una de ellas falla si no hay existencias.

## Esquema mínimo

- `documents`: identidad documental, hash, estado.
- `movements`: línea de movimiento, tipo, artículo, envase, cajas, signo.
- `fifo_layers`: capa de entrada, fecha, cajas iniciales/consumidas/restantes.
- `stock_balances`: saldo materializado y versión optimista.
- `idempotency_keys`: clave única, operación, hash de petición y documento
  respuesta.
- `schema_migrations`: versión aplicada, checksum y fecha.

Las migraciones están en `db/migrations/` y se aplican en orden lexicográfico.
El runner falla si una migración ya aplicada cambia de checksum.

## Las cuatro pruebas PostgreSQL

1. **Migraciones desde base vacía**
   - Reinicia el esquema `public` de la base de test.
   - Aplica todas las migraciones.
   - Comprueba tablas, columnas, índices y `schema_migrations`.
   - Fallo real que detecta: migración no aplicada, esquema incompleto o versión
     final incorrecta.

2. **Atomicidad**
   - Ejecuta una entrada con una segunda línea inválida (`boxes = 0`).
   - PostgreSQL debe rechazar la restricción.
   - Comprueba que no quedan documentos, movimientos, capas, saldos ni claves de
     idempotencia.
   - Fallo real que detecta: escritura parcial entre tablas.

3. **Idempotencia**
   - Ejecuta dos veces la misma entrada con la misma clave.
   - Comprueba que solo existe un documento, un movimiento, una capa y un saldo.
   - Reutilizar la clave con otra petición debe fallar.
   - Fallo real que detecta: duplicación de movimientos o capas por reintento.

4. **Concurrencia**
   - Crea un saldo de 10 cajas.
   - Lanza dos salidas simultáneas de 8 cajas con conexiones independientes.
   - Solo una debe completar; la otra debe recibir `InsufficientStock`.
   - Comprueba saldo final 2, capas restantes 2 y ausencia de saldo negativo.
   - Fallo real que detecta: sobreventa o corrupción de capas por carrera.

## Ejecución local

Requiere PostgreSQL real y Python 3.12:

```bash
python -m pip install -r requirements.txt
export APP_ENV=test
export TEST_DATABASE_URL=postgresql://stocklight_ci:stocklight_ci@127.0.0.1:5432/stocklight_ci
python -m db.migrate
python -m db.migrate --status
python -m pytest -q
```

Las pruebas reinician el esquema `public` de la base indicada por
`TEST_DATABASE_URL`. **No deben apuntar nunca a producción.**

## GitHub Actions

`.github/workflows/ci-postgres-validation.yml` levanta PostgreSQL 16 como
servicio, espera el healthcheck, aplica migraciones y ejecuta las cuatro
pruebas. El workflow falla si una migración o una prueba falla.

## Riesgos y límites

- No hay API, autenticación ni frontend en C.1.
- El esquema es de validación, no el modelo definitivo.
- No se migran datos reales.
- No se ejecuta `clasp push` ni se toca Apps Script.
- Las credenciales del workflow son exclusivas de test y no se reutilizan en
  producción.
