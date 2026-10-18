-- C.1 validation indexes.
-- This migration is intentionally separate so the runner applies more than one
-- version and the schema-version test proves ordered application.

CREATE INDEX idx_fifo_layers_fifo
    ON fifo_layers (article_code, packaging_code, layer_date, id)
    WHERE status = 'ACTIVA';

CREATE INDEX idx_movements_stock
    ON movements (article_code, packaging_code, created_at);
