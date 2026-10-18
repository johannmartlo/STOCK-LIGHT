from __future__ import annotations

import os

import psycopg
import pytest

from db.migrate import apply_migrations

TABLES = (
    "documents",
    "movements",
    "fifo_layers",
    "stock_balances",
    "idempotency_keys",
)


@pytest.fixture(scope="session")
def migrated_database() -> list[str]:
    """Reset the test database and apply all migrations from an empty schema."""

    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        if os.environ.get("CI"):
            raise RuntimeError(
                "TEST_DATABASE_URL is required in CI; refusing to skip PostgreSQL tests."
            )
        pytest.skip("TEST_DATABASE_URL is not configured for local execution")

    if os.environ.get("APP_ENV") != "test":
        raise RuntimeError("APP_ENV must be 'test' for PostgreSQL integration tests")

    with psycopg.connect(url) as conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")
        conn.commit()

    return apply_migrations()


@pytest.fixture(autouse=True)
def clean_database(migrated_database: list[str]) -> None:
    """Truncate inventory tables before each test; schema_migrations remains."""

    url = os.environ["TEST_DATABASE_URL"]
    with psycopg.connect(url) as conn:
        conn.execute(
            "TRUNCATE TABLE documents, movements, fifo_layers, "
            "stock_balances, idempotency_keys RESTART IDENTITY CASCADE"
        )
        conn.commit()
    yield
