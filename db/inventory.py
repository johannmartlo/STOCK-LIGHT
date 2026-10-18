"""Minimal transactional inventory operations for C.1 validation.

This module deliberately models only the contracts needed by the four C.1
PostgreSQL tests. It is not the final FastAPI/PostgreSQL application.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections import defaultdict
from datetime import date
from typing import Any, Iterable

import psycopg
from psycopg.rows import dict_row

from .config import get_test_database_url


class InventoryError(Exception):
    """Base class for C.1 inventory errors."""


class InsufficientStock(InventoryError):
    """Raised when an exit cannot be covered by active FIFO layers."""


class IdempotencyConflict(InventoryError):
    """Raised when one idempotency key is reused with a different request."""


def connect() -> psycopg.Connection:
    """Open a connection to the explicit test database."""

    return psycopg.connect(get_test_database_url(), row_factory=dict_row)


def _as_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _request_hash(document: dict[str, Any], lines: Iterable[dict[str, Any]]) -> str:
    payload = {
        "document": {
            "doc_type": document.get("doc_type"),
            "series": document.get("series"),
            "number": document.get("number"),
            "document_date": str(document.get("document_date")),
            "sha256_hash": document.get("sha256_hash"),
        },
        "lines": [
            {
                "article_code": line["article_code"],
                "packaging_code": line["packaging_code"],
                "boxes": int(line["boxes"]),
            }
            for line in lines
        ],
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _claim_idempotency(
    conn: psycopg.Connection,
    key: str,
    operation: str,
    request_hash: str,
) -> dict[str, Any] | None:
    """Claim a key or return the existing response.

    Returns None for a newly claimed key. If the key already exists, the row is
    locked and its request hash is checked. A different payload is a conflict.
    """

    inserted = conn.execute(
        """
        INSERT INTO idempotency_keys (key, operation, request_hash)
        VALUES (%s, %s, %s)
        ON CONFLICT (key) DO NOTHING
        RETURNING key
        """,
        (key, operation, request_hash),
    ).fetchone()

    if inserted is not None:
        return None

    existing = conn.execute(
        """
        SELECT request_hash, response_document_id
        FROM idempotency_keys
        WHERE key = %s
        FOR UPDATE
        """,
        (key,),
    ).fetchone()

    if existing is None:
        raise RuntimeError(f"Idempotency key {key!r} disappeared during claim")

    if existing["request_hash"] != request_hash:
        raise IdempotencyConflict(
            f"Idempotency key {key!r} was reused with a different request"
        )

    return existing


def _next_balance(
    conn: psycopg.Connection,
    article_code: str,
    packaging_code: str,
    delta: int,
) -> None:
    conn.execute(
        """
        INSERT INTO stock_balances (article_code, packaging_code, boxes, version)
        VALUES (%s, %s, %s, 1)
        ON CONFLICT (article_code, packaging_code)
        DO UPDATE SET
            boxes = stock_balances.boxes + EXCLUDED.boxes,
            version = stock_balances.version + 1,
            updated_at = now()
        """,
        (article_code, packaging_code, delta),
    )


def _validate_lines(lines: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, line in enumerate(lines, start=1):
        article = str(line.get("article_code", "")).strip()
        packaging = str(line.get("packaging_code", "")).strip()
        boxes = line.get("boxes")
        if not article or not packaging:
            raise InventoryError("article_code and packaging_code are required")
        if not isinstance(boxes, int):
            raise InventoryError("boxes must be an integer")
        normalized.append(
            {
                "line_no": index,
                "article_code": article,
                "packaging_code": packaging,
                "boxes": boxes,
            }
        )

    if not normalized:
        raise InventoryError("at least one line is required")

    return normalized


def apply_entry(
    document: dict[str, Any],
    lines: Iterable[dict[str, Any]],
    idempotency_key: str,
    *,
    conn: psycopg.Connection | None = None,
) -> tuple[uuid.UUID, bool]:
    """Apply a purchase entry atomically.

    Returns ``(document_id, was_replay)``. The whole operation is one database
    transaction; any failure rolls back all document, movement, layer, balance and
    idempotency writes.
    """

    normalized = _validate_lines(lines)
    request_hash = _request_hash(document, normalized)

    if conn is None:
        with connect() as own_conn:
            return _apply_entry(own_conn, document, normalized, idempotency_key, request_hash)

    return _apply_entry(conn, document, normalized, idempotency_key, request_hash)


def _apply_entry(
    conn: psycopg.Connection,
    document: dict[str, Any],
    lines: list[dict[str, Any]],
    idempotency_key: str,
    request_hash: str,
) -> tuple[uuid.UUID, bool]:
    with conn.transaction():
        existing = _claim_idempotency(conn, idempotency_key, "ENTRADA", request_hash)
        if existing is not None:
            response_id = existing["response_document_id"]
            if response_id is None:
                raise RuntimeError(
                    "Idempotency key exists without a response document; "
                    "the previous operation did not complete."
                )
            return response_id, True

        document_id = uuid.uuid4()
        document_date = _as_date(document["document_date"])

        conn.execute(
            """
            INSERT INTO documents
                (id, doc_type, series, number, document_date, sha256_hash, status)
            VALUES (%s, %s, %s, %s, %s, %s, 'CONFIRMADO')
            """,
            (
                document_id,
                document["doc_type"],
                document["series"],
                document["number"],
                document_date,
                document.get("sha256_hash"),
            ),
        )

        for line in lines:
            movement_id = uuid.uuid4()
            conn.execute(
                """
                INSERT INTO movements
                    (id, document_id, line_no, movement_type, article_code,
                     packaging_code, boxes, sign, status, idempotency_key)
                VALUES (%s, %s, %s, 'ENTRADA', %s, %s, %s, 1, 'CONFIRMADO', %s)
                """,
                (
                    movement_id,
                    document_id,
                    line["line_no"],
                    line["article_code"],
                    line["packaging_code"],
                    line["boxes"],
                    idempotency_key,
                ),
            )
            conn.execute(
                """
                INSERT INTO fifo_layers
                    (id, movement_id, article_code, packaging_code, layer_date,
                     initial_boxes, consumed_boxes, remaining_boxes, status)
                VALUES (%s, %s, %s, %s, %s, %s, 0, %s, 'ACTIVA')
                """,
                (
                    uuid.uuid4(),
                    movement_id,
                    line["article_code"],
                    line["packaging_code"],
                    document_date,
                    line["boxes"],
                    line["boxes"],
                ),
            )
            _next_balance(
                conn,
                line["article_code"],
                line["packaging_code"],
                line["boxes"],
            )

        conn.execute(
            "UPDATE idempotency_keys SET response_document_id = %s WHERE key = %s",
            (document_id, idempotency_key),
        )

        return document_id, False


def apply_exit(
    document: dict[str, Any],
    lines: Iterable[dict[str, Any]],
    idempotency_key: str,
    *,
    conn: psycopg.Connection | None = None,
) -> tuple[uuid.UUID, bool]:
    """Apply a sale exit atomically with FIFO consumption.

    The stock balance rows are locked in deterministic order before checking
    availability. Two concurrent exits for the same key therefore serialize; the
    second sees the committed balance and fails if it is insufficient.
    """

    normalized = _validate_lines(lines)
    request_hash = _request_hash(document, normalized)

    if conn is None:
        with connect() as own_conn:
            return _apply_exit(own_conn, document, normalized, idempotency_key, request_hash)

    return _apply_exit(conn, document, normalized, idempotency_key, request_hash)


def _apply_exit(
    conn: psycopg.Connection,
    document: dict[str, Any],
    lines: list[dict[str, Any]],
    idempotency_key: str,
    request_hash: str,
) -> tuple[uuid.UUID, bool]:
    with conn.transaction():
        existing = _claim_idempotency(conn, idempotency_key, "SALIDA", request_hash)
        if existing is not None:
            response_id = existing["response_document_id"]
            if response_id is None:
                raise RuntimeError(
                    "Idempotency key exists without a response document; "
                    "the previous operation did not complete."
                )
            return response_id, True

        needed: dict[tuple[str, str], int] = defaultdict(int)
        for line in lines:
            needed[(line["article_code"], line["packaging_code"])] += line["boxes"]

        for article_code, packaging_code in sorted(needed):
            balance = conn.execute(
                """
                SELECT boxes
                FROM stock_balances
                WHERE article_code = %s AND packaging_code = %s
                FOR UPDATE
                """,
                (article_code, packaging_code),
            ).fetchone()
            available = int(balance["boxes"]) if balance else 0
            if available < needed[(article_code, packaging_code)]:
                raise InsufficientStock(
                    f"Insufficient stock for {article_code}|{packaging_code}: "
                    f"available={available}, requested={needed[(article_code, packaging_code)]}"
                )

        document_id = uuid.uuid4()
        document_date = _as_date(document["document_date"])
        conn.execute(
            """
            INSERT INTO documents
                (id, doc_type, series, number, document_date, sha256_hash, status)
            VALUES (%s, %s, %s, %s, %s, %s, 'CONFIRMADO')
            """,
            (
                document_id,
                document["doc_type"],
                document["series"],
                document["number"],
                document_date,
                document.get("sha256_hash"),
            ),
        )

        for line in lines:
            movement_id = uuid.uuid4()
            conn.execute(
                """
                INSERT INTO movements
                    (id, document_id, line_no, movement_type, article_code,
                     packaging_code, boxes, sign, status, idempotency_key)
                VALUES (%s, %s, %s, 'SALIDA', %s, %s, %s, -1, 'CONFIRMADO', %s)
                """,
                (
                    movement_id,
                    document_id,
                    line["line_no"],
                    line["article_code"],
                    line["packaging_code"],
                    line["boxes"],
                    idempotency_key,
                ),
            )

            remaining = line["boxes"]
            layers = conn.execute(
                """
                SELECT id, remaining_boxes
                FROM fifo_layers
                WHERE article_code = %s
                  AND packaging_code = %s
                  AND status = 'ACTIVA'
                ORDER BY layer_date ASC, id ASC
                FOR UPDATE
                """,
                (line["article_code"], line["packaging_code"]),
            ).fetchall()

            for layer in layers:
                if remaining <= 0:
                    break
                take = min(remaining, int(layer["remaining_boxes"]))
                new_remaining = int(layer["remaining_boxes"]) - take
                conn.execute(
                    """
                    UPDATE fifo_layers
                    SET consumed_boxes = consumed_boxes + %s,
                        remaining_boxes = %s,
                        status = %s
                    WHERE id = %s
                    """,
                    (
                        take,
                        new_remaining,
                        "AGOTADA" if new_remaining == 0 else "ACTIVA",
                        layer["id"],
                    ),
                )
                remaining -= take

            if remaining > 0:
                raise InsufficientStock(
                    f"FIFO layers did not cover {remaining} boxes for "
                    f"{line['article_code']}|{line['packaging_code']}"
                )

            _next_balance(
                conn,
                line["article_code"],
                line["packaging_code"],
                -line["boxes"],
            )

        conn.execute(
            "UPDATE idempotency_keys SET response_document_id = %s WHERE key = %s",
            (document_id, idempotency_key),
        )

        return document_id, False


def get_stock(article_code: str, packaging_code: str) -> int:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT boxes
            FROM stock_balances
            WHERE article_code = %s AND packaging_code = %s
            """,
            (article_code, packaging_code),
        ).fetchone()
        return int(row["boxes"]) if row else 0


def get_layers(article_code: str, packaging_code: str) -> list[dict[str, Any]]:
    with connect() as conn:
        return conn.execute(
            """
            SELECT initial_boxes, consumed_boxes, remaining_boxes, status
            FROM fifo_layers
            WHERE article_code = %s AND packaging_code = %s
            ORDER BY layer_date ASC, id ASC
            """,
            (article_code, packaging_code),
        ).fetchall()


def count_rows(table: str) -> int:
    allowed = {
        "documents",
        "movements",
        "fifo_layers",
        "stock_balances",
        "idempotency_keys",
    }
    if table not in allowed:
        raise ValueError(f"Unsupported table: {table}")
    with connect() as conn:
        row = conn.execute(f"SELECT count(*) AS count FROM {table}").fetchone()
        return int(row["count"])
