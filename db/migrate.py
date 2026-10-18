"""Versioned SQL migration runner for the C.1 validation harness."""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from .config import get_test_database_url

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"), key=lambda path: path.name)


def _checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def apply_migrations() -> list[str]:
    """Apply every pending migration in lexical order.

    The runner creates ``schema_migrations`` first. Each migration and its
    version/checksum row are committed in one transaction. A failure rolls back
    only that migration and exits with an exception, so callers cannot continue
    silently.
    """

    url = get_test_database_url()
    files = migration_files()
    if not files:
        raise RuntimeError(f"No migration files found in {MIGRATIONS_DIR}")

    with psycopg.connect(url, row_factory=dict_row) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version text PRIMARY KEY,
                checksum text NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        conn.commit()

        applied = {
            row["version"]: row
            for row in conn.execute(
                "SELECT version, checksum FROM schema_migrations"
            ).fetchall()
        }

        for path in files:
            version = path.stem
            checksum = _checksum(path)
            existing = applied.get(version)

            if existing is not None:
                if existing["checksum"] != checksum:
                    raise RuntimeError(
                        f"Migration {version} changed after being applied: "
                        "checksum mismatch"
                    )
                continue

            sql = path.read_text(encoding="utf-8")
            with conn.transaction():
                # The C.1 migrations contain no functions/dollar-quoted bodies;
                # splitting on semicolons is deterministic and works with the
                # simple statements used here.
                for statement in (part.strip() for part in sql.split(";")):
                    if statement:
                        conn.execute(statement)
                conn.execute(
                    """
                    INSERT INTO schema_migrations (version, checksum)
                    VALUES (%s, %s)
                    """,
                    (version, checksum),
                )

        versions = [
            row["version"]
            for row in conn.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ).fetchall()
        ]

    return versions


def print_status() -> None:
    url = get_test_database_url()
    with psycopg.connect(url, row_factory=dict_row) as conn:
        rows = conn.execute(
            """
            SELECT version, checksum, applied_at
            FROM schema_migrations
            ORDER BY version
            """
        ).fetchall()

    if not rows:
        print("schema_version: EMPTY")
        return

    for row in rows:
        print(
            f"schema_version: {row['version']} "
            f"checksum={row['checksum'][:12]} "
            f"applied_at={row['applied_at'].isoformat()}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="C.1 migration runner")
    parser.add_argument(
        "--status",
        action="store_true",
        help="Print applied migration versions without applying anything",
    )
    args = parser.parse_args(argv)

    try:
        if args.status:
            print_status()
        else:
            versions = apply_migrations()
            print("Applied migrations: " + ", ".join(versions))
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI must fail loudly
        print(f"MIGRATION FAILURE: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
