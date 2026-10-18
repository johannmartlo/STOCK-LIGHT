-- C.1 validation schema. Not a final production schema.
-- The migration runner records this version in schema_migrations.

CREATE TABLE documents (
    id uuid PRIMARY KEY,
    doc_type text NOT NULL CHECK (doc_type IN ('COMPRA', 'SALIDA')),
    series text NOT NULL,
    number text NOT NULL,
    document_date date NOT NULL,
    sha256_hash text UNIQUE,
    status text NOT NULL DEFAULT 'CONFIRMADO'
        CHECK (status IN ('CONFIRMADO', 'PENDIENTE_REVISION', 'ANULADO')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (doc_type, series, number, document_date)
);

CREATE TABLE idempotency_keys (
    key text PRIMARY KEY,
    operation text NOT NULL CHECK (operation IN ('ENTRADA', 'SALIDA')),
    request_hash text NOT NULL,
    response_document_id uuid REFERENCES documents (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE movements (
    id uuid PRIMARY KEY,
    document_id uuid NOT NULL REFERENCES documents (id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK (line_no > 0),
    movement_type text NOT NULL CHECK (movement_type IN ('ENTRADA', 'SALIDA')),
    article_code text NOT NULL,
    packaging_code text NOT NULL,
    boxes integer NOT NULL CHECK (boxes > 0),
    sign smallint NOT NULL CHECK (
        (movement_type = 'ENTRADA' AND sign = 1)
        OR (movement_type = 'SALIDA' AND sign = -1)
    ),
    status text NOT NULL DEFAULT 'CONFIRMADO'
        CHECK (status IN ('CONFIRMADO', 'ANULADO')),
    idempotency_key text NOT NULL REFERENCES idempotency_keys (key),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (document_id, line_no),
    UNIQUE (idempotency_key, line_no)
);

CREATE TABLE fifo_layers (
    id uuid PRIMARY KEY,
    movement_id uuid NOT NULL REFERENCES movements (id) ON DELETE RESTRICT,
    article_code text NOT NULL,
    packaging_code text NOT NULL,
    layer_date date NOT NULL,
    initial_boxes integer NOT NULL CHECK (initial_boxes > 0),
    consumed_boxes integer NOT NULL DEFAULT 0 CHECK (consumed_boxes >= 0),
    remaining_boxes integer NOT NULL CHECK (remaining_boxes >= 0),
    status text NOT NULL DEFAULT 'ACTIVA'
        CHECK (status IN ('ACTIVA', 'AGOTADA', 'ANULADA')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (remaining_boxes = initial_boxes - consumed_boxes),
    CHECK (
        (status = 'ACTIVA' AND remaining_boxes > 0)
        OR (status = 'AGOTADA' AND remaining_boxes = 0)
        OR status = 'ANULADA'
    )
);

CREATE TABLE stock_balances (
    article_code text NOT NULL,
    packaging_code text NOT NULL,
    boxes integer NOT NULL DEFAULT 0 CHECK (boxes >= 0),
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (article_code, packaging_code)
);
