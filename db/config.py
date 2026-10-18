"""Database configuration for the C.1 validation harness.

Only TEST_DATABASE_URL is accepted. The harness must never point at production.
"""

from __future__ import annotations

import os


def get_test_database_url() -> str:
    """Return the explicit test database URL.

    Failing closed is intentional: the migration runner and integration tests must
    not silently fall back to a default database.
    """

    if os.environ.get("APP_ENV") != "test":
        raise RuntimeError(
            "APP_ENV must be 'test' for the C.1 validation harness."
        )

    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        raise RuntimeError(
            "TEST_DATABASE_URL is required for the C.1 validation harness."
        )

    return url
