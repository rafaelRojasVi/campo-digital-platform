from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from app.config import Settings
from sqlalchemy import Engine, inspect, text


def test_real_postgis_database_is_at_migration_head(
    integration_settings: Settings,
    integration_engine: Engine,
) -> None:
    root = Path(__file__).resolve().parents[3]
    config = Config(str(root / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    expected_head = script.get_current_head()

    assert expected_head is not None

    with integration_engine.connect() as connection:
        assert connection.execute(text("SELECT current_database()")).scalar_one() == (
            integration_settings.postgres_db
        )

        postgis_version = connection.execute(text("SELECT PostGIS_Version()")).scalar_one()

        revision = MigrationContext.configure(connection).get_current_revision()

        schema_exists = inspect(connection).has_schema("platform")

    assert postgis_version
    assert revision == expected_head
    assert schema_exists


def test_real_database_executes_postgis_geometry_operation(
    integration_engine: Engine,
) -> None:
    with integration_engine.connect() as connection:
        srid = connection.execute(
            text(
                """
                SELECT ST_SRID(
                    ST_SetSRID(
                        ST_MakePoint(-73.2459, -39.8142),
                        4326
                    )
                )
                """
            )
        ).scalar_one()

    assert srid == 4326
