"""Validate Campo Digital's migration lifecycle against a dedicated test DB."""

from __future__ import annotations

import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, inspect, text

ROOT = Path(__file__).resolve().parents[1]
API_ROOT = ROOT / "apps" / "api"

if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.config import get_settings  # noqa: E402
from app.database import build_engine  # noqa: E402
from app.db_safety import require_test_database  # noqa: E402
from app.migration_graph import inspect_migration_graph  # noqa: E402


def current_revision(engine: Engine) -> str | None:
    """Return the currently applied Alembic revision."""

    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def platform_schema_exists(engine: Engine) -> bool:
    """Return whether the platform schema exists."""

    with engine.connect() as connection:
        return inspect(connection).has_schema("platform")


def postgis_exists(engine: Engine) -> bool:
    """Return whether PostGIS is enabled."""

    with engine.connect() as connection:
        return bool(
            connection.execute(
                text(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM pg_extension
                        WHERE extname = 'postgis'
                    )
                    """
                )
            ).scalar_one()
        )


def require_head_state(engine: Engine, head: str) -> None:
    """Assert the minimum database invariants expected at migration head."""

    revision = current_revision(engine)

    if revision != head:
        raise RuntimeError(f"Expected Alembic head {head!r}, found {revision!r}.")

    if not platform_schema_exists(engine):
        raise RuntimeError("Expected platform schema at migration head.")

    if not postgis_exists(engine):
        raise RuntimeError("Expected PostGIS extension at migration head.")


def main() -> None:
    """Run destructive migration validation against a dedicated test DB."""

    settings = get_settings()

    # Fail closed before any destructive Alembic command.
    require_test_database(settings)

    config = Config(str(ROOT / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    graph = inspect_migration_graph(script)

    print("=== migration graph ===")
    print("bases:", list(graph.bases))
    print("heads:", list(graph.heads))

    if not graph.has_single_base_and_head:
        raise RuntimeError("Migration graph must have exactly one base and one head.")

    head = graph.heads[0]
    engine = build_engine(settings)

    try:
        print("\n=== normalize to base ===")
        command.downgrade(config, "base")

        if current_revision(engine) is not None:
            raise RuntimeError("Expected no applied revision at base.")

        if platform_schema_exists(engine):
            raise RuntimeError("platform schema survived downgrade to base.")

        if not postgis_exists(engine):
            raise RuntimeError("PostGIS should survive application rollback.")

        print("base state: OK")

        print("\n=== forward chain: base -> head ===")
        command.upgrade(config, "head")
        require_head_state(engine, head)
        print("head state: OK")

        print("\n=== latest migration downgrade ===")
        command.downgrade(config, "-1")

        if current_revision(engine) == head:
            raise RuntimeError("Latest migration downgrade did not move off head.")

        print("latest downgrade: OK")

        print("\n=== re-upgrade to head ===")
        command.upgrade(config, "head")
        require_head_state(engine, head)
        print("re-upgrade: OK")

    finally:
        engine.dispose()

    print("\nmigration-check: all checks passed")


if __name__ == "__main__":
    main()
