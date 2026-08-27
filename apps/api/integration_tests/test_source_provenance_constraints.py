"""Database invariant tests for platform source provenance."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import Connection, text
from sqlalchemy.exc import IntegrityError


def insert_system(
    connection: Connection,
    *,
    system_key: str = "integration_source",
) -> int:
    return connection.execute(
        text(
            """
            INSERT INTO platform.source_system (system_key)
            VALUES (:system_key)
            RETURNING id
            """
        ),
        {"system_key": system_key},
    ).scalar_one()


def insert_asset(
    connection: Connection,
    source_system_id: int,
    *,
    identity_kind: str = "relative_path",
    identity_key: str = "example/source.xlsx",
) -> int:
    return connection.execute(
        text(
            """
            INSERT INTO platform.source_asset (
                source_system_id,
                identity_kind,
                identity_key
            )
            VALUES (
                :source_system_id,
                :identity_kind,
                :identity_key
            )
            RETURNING id
            """
        ),
        {
            "source_system_id": source_system_id,
            "identity_kind": identity_kind,
            "identity_key": identity_key,
        },
    ).scalar_one()


def insert_snapshot(
    connection: Connection,
    source_asset_id: int,
    *,
    content_sha256: str = "a" * 64,
    byte_size: int = 123,
) -> int:
    return connection.execute(
        text(
            """
            INSERT INTO platform.source_snapshot (
                source_asset_id,
                content_sha256,
                byte_size
            )
            VALUES (
                :source_asset_id,
                :content_sha256,
                :byte_size
            )
            RETURNING id
            """
        ),
        {
            "source_asset_id": source_asset_id,
            "content_sha256": content_sha256,
            "byte_size": byte_size,
        },
    ).scalar_one()


def expect_integrity_error(
    connection: Connection,
    sql: str,
    parameters: dict[str, Any],
) -> None:
    """Prove a DB invariant without aborting the outer test transaction."""

    with pytest.raises(IntegrityError), connection.begin_nested():
        connection.execute(
            text(sql),
            parameters,
        )


def test_source_and_asset_identity_are_unique(
    integration_connection: Connection,
) -> None:
    system_id = insert_system(integration_connection)

    expect_integrity_error(
        integration_connection,
        """
        INSERT INTO platform.source_system (system_key)
        VALUES (:system_key)
        """,
        {"system_key": "integration_source"},
    )

    insert_asset(integration_connection, system_id)

    expect_integrity_error(
        integration_connection,
        """
        INSERT INTO platform.source_asset (
            source_system_id,
            identity_kind,
            identity_key
        )
        VALUES (
            :source_system_id,
            :identity_kind,
            :identity_key
        )
        """,
        {
            "source_system_id": system_id,
            "identity_kind": "relative_path",
            "identity_key": "example/source.xlsx",
        },
    )


def test_snapshot_content_identity_is_scoped_to_asset(
    integration_connection: Connection,
) -> None:
    system_id = insert_system(integration_connection)

    first_asset_id = insert_asset(
        integration_connection,
        system_id,
        identity_key="first.xlsx",
    )
    second_asset_id = insert_asset(
        integration_connection,
        system_id,
        identity_key="second.xlsx",
    )

    insert_snapshot(
        integration_connection,
        first_asset_id,
        content_sha256="b" * 64,
    )

    expect_integrity_error(
        integration_connection,
        """
        INSERT INTO platform.source_snapshot (
            source_asset_id,
            content_sha256,
            byte_size
        )
        VALUES (
            :source_asset_id,
            :content_sha256,
            :byte_size
        )
        """,
        {
            "source_asset_id": first_asset_id,
            "content_sha256": "b" * 64,
            "byte_size": 123,
        },
    )

    second_snapshot_id = insert_snapshot(
        integration_connection,
        second_asset_id,
        content_sha256="b" * 64,
    )

    assert second_snapshot_id > 0


def test_snapshot_rejects_invalid_hash_and_negative_size(
    integration_connection: Connection,
) -> None:
    system_id = insert_system(integration_connection)
    asset_id = insert_asset(integration_connection, system_id)

    expect_integrity_error(
        integration_connection,
        """
        INSERT INTO platform.source_snapshot (
            source_asset_id,
            content_sha256,
            byte_size
        )
        VALUES (
            :source_asset_id,
            :content_sha256,
            :byte_size
        )
        """,
        {
            "source_asset_id": asset_id,
            "content_sha256": "A" * 64,
            "byte_size": 10,
        },
    )

    expect_integrity_error(
        integration_connection,
        """
        INSERT INTO platform.source_snapshot (
            source_asset_id,
            content_sha256,
            byte_size
        )
        VALUES (
            :source_asset_id,
            :content_sha256,
            :byte_size
        )
        """,
        {
            "source_asset_id": asset_id,
            "content_sha256": "c" * 64,
            "byte_size": -1,
        },
    )


def test_identity_fields_reject_whitespace_only_values(
    integration_connection: Connection,
) -> None:
    expect_integrity_error(
        integration_connection,
        """
        INSERT INTO platform.source_system (system_key)
        VALUES (:system_key)
        """,
        {"system_key": "   "},
    )

    system_id = insert_system(integration_connection)

    expect_integrity_error(
        integration_connection,
        """
        INSERT INTO platform.source_asset (
            source_system_id,
            identity_kind,
            identity_key
        )
        VALUES (
            :source_system_id,
            :identity_kind,
            :identity_key
        )
        """,
        {
            "source_system_id": system_id,
            "identity_kind": "   ",
            "identity_key": "example.xlsx",
        },
    )


def test_multiple_observations_can_reference_one_snapshot(
    integration_connection: Connection,
) -> None:
    system_id = insert_system(integration_connection)
    asset_id = insert_asset(integration_connection, system_id)
    snapshot_id = insert_snapshot(integration_connection, asset_id)

    first_observed_at = datetime(
        2026,
        8,
        27,
        12,
        0,
        tzinfo=UTC,
    )

    for observed_at in (
        first_observed_at,
        first_observed_at + timedelta(minutes=5),
    ):
        integration_connection.execute(
            text(
                """
                INSERT INTO platform.source_observation (
                    source_snapshot_id,
                    source_path,
                    filename,
                    observed_at,
                    media_type
                )
                VALUES (
                    :source_snapshot_id,
                    :source_path,
                    :filename,
                    :observed_at,
                    :media_type
                )
                """
            ),
            {
                "source_snapshot_id": snapshot_id,
                "source_path": "example/source.xlsx",
                "filename": "source.xlsx",
                "observed_at": observed_at,
                "media_type": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            },
        )

    count = integration_connection.execute(
        text(
            """
            SELECT count(*)
            FROM platform.source_observation
            WHERE source_snapshot_id = :source_snapshot_id
            """
        ),
        {"source_snapshot_id": snapshot_id},
    ).scalar_one()

    assert count == 2


def test_provenance_parent_deletes_are_restricted(
    integration_connection: Connection,
) -> None:
    system_id = insert_system(integration_connection)
    asset_id = insert_asset(integration_connection, system_id)
    snapshot_id = insert_snapshot(integration_connection, asset_id)

    integration_connection.execute(
        text(
            """
            INSERT INTO platform.source_observation (
                source_snapshot_id,
                source_path,
                filename,
                observed_at
            )
            VALUES (
                :source_snapshot_id,
                :source_path,
                :filename,
                CURRENT_TIMESTAMP
            )
            """
        ),
        {
            "source_snapshot_id": snapshot_id,
            "source_path": "example/source.xlsx",
            "filename": "source.xlsx",
        },
    )

    expect_integrity_error(
        integration_connection,
        "DELETE FROM platform.source_system WHERE id = :id",
        {"id": system_id},
    )

    expect_integrity_error(
        integration_connection,
        "DELETE FROM platform.source_asset WHERE id = :id",
        {"id": asset_id},
    )

    expect_integrity_error(
        integration_connection,
        "DELETE FROM platform.source_snapshot WHERE id = :id",
        {"id": snapshot_id},
    )
