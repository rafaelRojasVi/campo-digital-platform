"""Physical schema tests for the platform source-provenance foundation."""

from __future__ import annotations

from sqlalchemy import Engine, inspect

EXPECTED_TABLES = {
    "source_system",
    "source_asset",
    "source_snapshot",
    "source_observation",
}


def test_source_provenance_tables_and_timestamp_types(
    integration_engine: Engine,
) -> None:
    """Provenance tables exist and temporal columns are timezone-aware."""

    inspector = inspect(integration_engine)

    tables = set(inspector.get_table_names(schema="platform"))

    assert tables >= EXPECTED_TABLES

    expected_temporal_columns = {
        "source_system": {"created_at"},
        "source_asset": {"created_at"},
        "source_snapshot": {"created_at"},
        "source_observation": {
            "observed_at",
            "source_modified_at",
        },
    }

    for table, expected_columns in expected_temporal_columns.items():
        columns = {
            column["name"]: column
            for column in inspector.get_columns(
                table,
                schema="platform",
            )
        }

        for column_name in expected_columns:
            column_type = columns[column_name]["type"]
            assert getattr(column_type, "timezone", None) is True


def test_source_provenance_foreign_keys_are_restrictive(
    integration_engine: Engine,
) -> None:
    """Parent provenance records cannot cascade-delete their history."""

    inspector = inspect(integration_engine)

    expected = {
        "source_asset": (
            "source_system_id",
            "source_system",
        ),
        "source_snapshot": (
            "source_asset_id",
            "source_asset",
        ),
        "source_observation": (
            "source_snapshot_id",
            "source_snapshot",
        ),
    }

    for table, (column_name, referred_table) in expected.items():
        foreign_keys = inspector.get_foreign_keys(
            table,
            schema="platform",
        )

        matching = [
            foreign_key
            for foreign_key in foreign_keys
            if foreign_key["constrained_columns"] == [column_name]
        ]

        assert len(matching) == 1

        foreign_key = matching[0]

        assert foreign_key["referred_schema"] == "platform"
        assert foreign_key["referred_table"] == referred_table
        assert foreign_key["options"].get("ondelete") == "RESTRICT"
