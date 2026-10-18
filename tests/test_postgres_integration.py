from __future__ import annotations

import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest
from psycopg.rows import dict_row

from db.config import get_test_database_url
from db.inventory import (
    IdempotencyConflict,
    InsufficientStock,
    apply_entry,
    apply_exit,
    count_rows,
    get_layers,
    get_stock,
)

ARTICLE = "2112000"
PACKAGING = "EPS104"


def _document(number: str, doc_type: str = "COMPRA") -> dict:
    return {
        "doc_type": doc_type,
        "series": "CI",
        "number": number,
        "document_date": "2026-01-15",
        "sha256_hash": f"sha256-{doc_type}-{number}",
    }


def _line(boxes: int) -> dict:
    return {
        "article_code": ARTICLE,
        "packaging_code": PACKAGING,
        "boxes": boxes,
    }


def _connection():
    return psycopg.connect(get_test_database_url(), row_factory=dict_row)


# ---------------------------------------------------------------------------
# 1. Migrations from an empty database and final schema verification.
# ---------------------------------------------------------------------------
def test_migrations_from_empty_database_and_schema_version(
    migrated_database: list[str],
) -> None:
    assert migrated_database == ["001_initial_schema", "002_indexes"]

    with _connection() as conn:
        tables = {
            row["table_name"]
            for row in conn.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                """
            ).fetchall()
        }
        assert {
            "documents",
            "movements",
            "fifo_layers",
            "stock_balances",
            "idempotency_keys",
            "schema_migrations",
        } <= tables

        columns: dict[str, set[str]] = defaultdict(set)
        for row in conn.execute(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
            """
        ).fetchall():
            columns[row["table_name"]].add(row["column_name"])

        assert {
            "id",
            "doc_type",
            "series",
            "number",
            "document_date",
            "sha256_hash",
            "status",
        } <= columns["documents"]
        assert {
            "id",
            "document_id",
            "line_no",
            "movement_type",
            "article_code",
            "packaging_code",
            "boxes",
            "sign",
            "status",
            "idempotency_key",
        } <= columns["movements"]
        assert {
            "initial_boxes",
            "consumed_boxes",
            "remaining_boxes",
            "status",
        } <= columns["fifo_layers"]
        assert {"boxes", "version"} <= columns["stock_balances"]
        assert {
            "key",
            "operation",
            "request_hash",
            "response_document_id",
        } <= columns["idempotency_keys"]

        indexes = {
            row["indexname"]
            for row in conn.execute(
                """
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = 'public'
                """
            ).fetchall()
        }
        assert {"idx_fifo_layers_fifo", "idx_movements_stock"} <= indexes

        versions = conn.execute(
            "SELECT version, checksum FROM schema_migrations ORDER BY version"
        ).fetchall()
        assert len(versions) == 2
        assert all(len(row["checksum"]) == 64 for row in versions)


# ---------------------------------------------------------------------------
# 2. Atomicity: a failed entry must not leave any partial persistence.
# ---------------------------------------------------------------------------
def test_failed_entry_rolls_back_all_tables(clean_database: None) -> None:
    document = _document("ATOMIC-1")
    lines = [_line(5), _line(0)]

    with pytest.raises(psycopg.errors.CheckViolation):
        apply_entry(document, lines, "atomic-key-1")

    assert count_rows("documents") == 0
    assert count_rows("movements") == 0
    assert count_rows("fifo_layers") == 0
    assert count_rows("stock_balances") == 0
    assert count_rows("idempotency_keys") == 0
    assert get_stock(ARTICLE, PACKAGING) == 0
    assert get_layers(ARTICLE, PACKAGING) == []


# ---------------------------------------------------------------------------
# 3. Idempotency: repeating the same operation must not duplicate effects.
# ---------------------------------------------------------------------------
def test_repeated_entry_is_idempotent(clean_database: None) -> None:
    document = _document("IDEMPOTENT-1")
    lines = [_line(10)]

    first_id, first_replay = apply_entry(document, lines, "idem-key-1")
    assert first_replay is False

    second_id, second_replay = apply_entry(document, lines, "idem-key-1")
    assert second_replay is True
    assert second_id == first_id

    assert count_rows("documents") == 1
    assert count_rows("movements") == 1
    assert count_rows("fifo_layers") == 1
    assert count_rows("idempotency_keys") == 1
    assert get_stock(ARTICLE, PACKAGING) == 10

    layers = get_layers(ARTICLE, PACKAGING)
    assert len(layers) == 1
    assert layers[0]["remaining_boxes"] == 10

    with pytest.raises(IdempotencyConflict):
        apply_entry(_document("IDEMPOTENT-2"), lines, "idem-key-1")

    assert count_rows("documents") == 1
    assert count_rows("movements") == 1
    assert count_rows("idempotency_keys") == 1


# ---------------------------------------------------------------------------
# 4. Concurrency: two exits of 8 against stock 10 must not oversell.
# ---------------------------------------------------------------------------
def test_concurrent_exits_do_not_oversell(clean_database: None) -> None:
    apply_entry(_document("SEED-1"), [_line(10)], "seed-key-1")
    assert get_stock(ARTICLE, PACKAGING) == 10

    barrier = threading.Barrier(2)

    def run_exit(number: str, key: str) -> str:
        with _connection() as conn:
            barrier.wait(timeout=10)
            try:
                apply_exit(
                    _document(number, "SALIDA"),
                    [_line(8)],
                    key,
                    conn=conn,
                )
                return "ok"
            except InsufficientStock:
                return "insufficient"

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(run_exit, "EXIT-A", "exit-key-a"),
            pool.submit(run_exit, "EXIT-B", "exit-key-b"),
        ]
        results = [future.result(timeout=20) for future in futures]

    assert sorted(results) == ["insufficient", "ok"]
    assert get_stock(ARTICLE, PACKAGING) == 2

    layers = get_layers(ARTICLE, PACKAGING)
    assert len(layers) == 1
    assert layers[0]["initial_boxes"] == 10
    assert layers[0]["consumed_boxes"] == 8
    assert layers[0]["remaining_boxes"] == 2
    assert layers[0]["status"] == "ACTIVA"

    assert count_rows("documents") == 2  # seed + the one successful exit
    assert count_rows("movements") == 2
    assert count_rows("idempotency_keys") == 2  # seed + the one successful exit
