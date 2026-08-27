"""Integration tests for source provenance persistence."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from app.source_discovery import (
    SourceFileFingerprint,
    SourceFileObservation,
)
from app.source_provenance import (
    SourceProvenanceConflictError,
    persist_filesystem_source_provenance,
)
from sqlalchemy import Connection, text


def make_observation(
    *,
    relative_path: str = "folder/source.xlsx",
    byte_size: int = 123,
    observed_at: datetime | None = None,
) -> SourceFileObservation:
    return SourceFileObservation(
        relative_path=relative_path,
        filename=relative_path.rsplit("/", 1)[-1],
        byte_size=byte_size,
        observed_at=observed_at
        or datetime(
            2026,
            8,
            27,
            17,
            0,
            tzinfo=UTC,
        ),
        source_modified_at=datetime(
            2026,
            8,
            27,
            16,
            30,
            tzinfo=UTC,
        ),
        media_type=("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    )


def make_fingerprint(
    *,
    relative_path: str = "folder/source.xlsx",
    content_sha256: str = "a" * 64,
    byte_size: int = 123,
) -> SourceFileFingerprint:
    return SourceFileFingerprint(
        relative_path=relative_path,
        content_sha256=content_sha256,
        byte_size=byte_size,
    )


def count_rows(
    connection: Connection,
    table: str,
) -> int:
    allowed = {
        "source_system",
        "source_asset",
        "source_snapshot",
        "source_observation",
    }

    if table not in allowed:
        raise ValueError("Unexpected provenance table")

    return connection.execute(
        text(
            f"""
            SELECT count(*)
            FROM platform.{table}
            """
        )
    ).scalar_one()


def test_repeated_content_reuses_identity_and_appends_observation(
    integration_connection: Connection,
) -> None:
    first_observation = make_observation()
    fingerprint = make_fingerprint()

    first = persist_filesystem_source_provenance(
        integration_connection,
        system_key="integration_source",
        observation=first_observation,
        fingerprint=fingerprint,
    )

    second = persist_filesystem_source_provenance(
        integration_connection,
        system_key="integration_source",
        observation=make_observation(
            observed_at=first_observation.observed_at + timedelta(minutes=5),
        ),
        fingerprint=fingerprint,
    )

    assert second.source_system_id == first.source_system_id
    assert second.source_asset_id == first.source_asset_id
    assert second.source_snapshot_id == first.source_snapshot_id
    assert second.source_observation_id != first.source_observation_id

    assert count_rows(integration_connection, "source_system") == 1
    assert count_rows(integration_connection, "source_asset") == 1
    assert count_rows(integration_connection, "source_snapshot") == 1
    assert count_rows(integration_connection, "source_observation") == 2


def test_changed_content_creates_new_snapshot_for_same_asset(
    integration_connection: Connection,
) -> None:
    first = persist_filesystem_source_provenance(
        integration_connection,
        system_key="integration_source",
        observation=make_observation(),
        fingerprint=make_fingerprint(
            content_sha256="a" * 64,
        ),
    )

    second = persist_filesystem_source_provenance(
        integration_connection,
        system_key="integration_source",
        observation=make_observation(),
        fingerprint=make_fingerprint(
            content_sha256="b" * 64,
        ),
    )

    assert second.source_system_id == first.source_system_id
    assert second.source_asset_id == first.source_asset_id
    assert second.source_snapshot_id != first.source_snapshot_id

    assert count_rows(integration_connection, "source_asset") == 1
    assert count_rows(integration_connection, "source_snapshot") == 2
    assert count_rows(integration_connection, "source_observation") == 2


def test_relative_path_identity_does_not_infer_rename_equivalence(
    integration_connection: Connection,
) -> None:
    first = persist_filesystem_source_provenance(
        integration_connection,
        system_key="integration_source",
        observation=make_observation(
            relative_path="folder/first.xlsx",
        ),
        fingerprint=make_fingerprint(
            relative_path="folder/first.xlsx",
        ),
    )

    second = persist_filesystem_source_provenance(
        integration_connection,
        system_key="integration_source",
        observation=make_observation(
            relative_path="folder/renamed.xlsx",
        ),
        fingerprint=make_fingerprint(
            relative_path="folder/renamed.xlsx",
        ),
    )

    assert second.source_system_id == first.source_system_id
    assert second.source_asset_id != first.source_asset_id
    assert second.source_snapshot_id != first.source_snapshot_id

    assert count_rows(integration_connection, "source_system") == 1
    assert count_rows(integration_connection, "source_asset") == 2
    assert count_rows(integration_connection, "source_snapshot") == 2


@pytest.mark.parametrize(
    ("observation", "fingerprint"),
    [
        (
            make_observation(
                relative_path="first.xlsx",
            ),
            make_fingerprint(
                relative_path="second.xlsx",
            ),
        ),
        (
            make_observation(
                byte_size=123,
            ),
            make_fingerprint(
                byte_size=124,
            ),
        ),
    ],
)
def test_mismatched_discovery_values_fail_before_persistence(
    integration_connection: Connection,
    observation: SourceFileObservation,
    fingerprint: SourceFileFingerprint,
) -> None:
    with pytest.raises(SourceProvenanceConflictError):
        persist_filesystem_source_provenance(
            integration_connection,
            system_key="integration_source",
            observation=observation,
            fingerprint=fingerprint,
        )

    assert count_rows(integration_connection, "source_system") == 0
    assert count_rows(integration_connection, "source_asset") == 0
    assert count_rows(integration_connection, "source_snapshot") == 0
    assert count_rows(integration_connection, "source_observation") == 0


def test_existing_snapshot_with_conflicting_size_is_rejected(
    integration_connection: Connection,
) -> None:
    initial = persist_filesystem_source_provenance(
        integration_connection,
        system_key="integration_source",
        observation=make_observation(
            byte_size=123,
        ),
        fingerprint=make_fingerprint(
            content_sha256="c" * 64,
            byte_size=123,
        ),
    )

    integration_connection.execute(
        text(
            """
            UPDATE platform.source_snapshot
            SET byte_size = :byte_size
            WHERE id = :snapshot_id
            """
        ),
        {
            "snapshot_id": initial.source_snapshot_id,
            "byte_size": 124,
        },
    )

    with pytest.raises(SourceProvenanceConflictError):
        persist_filesystem_source_provenance(
            integration_connection,
            system_key="integration_source",
            observation=make_observation(
                byte_size=123,
            ),
            fingerprint=make_fingerprint(
                content_sha256="c" * 64,
                byte_size=123,
            ),
        )

    assert count_rows(integration_connection, "source_snapshot") == 1
    assert count_rows(integration_connection, "source_observation") == 1


def test_persisted_provenance_preserves_source_metadata(
    integration_connection: Connection,
) -> None:
    observation = make_observation(
        relative_path="folder/source.xlsx",
        byte_size=123,
    )
    fingerprint = make_fingerprint(
        relative_path="folder/source.xlsx",
        content_sha256="d" * 64,
        byte_size=123,
    )

    persisted = persist_filesystem_source_provenance(
        integration_connection,
        system_key="integration_source",
        observation=observation,
        fingerprint=fingerprint,
    )

    row = integration_connection.execute(
        text(
            """
            SELECT
                system.system_key,
                asset.identity_kind,
                asset.identity_key,
                snapshot.content_sha256,
                snapshot.byte_size,
                observation.source_path,
                observation.filename,
                observation.observed_at,
                observation.source_modified_at,
                observation.media_type
            FROM platform.source_observation AS observation
            JOIN platform.source_snapshot AS snapshot
              ON snapshot.id = observation.source_snapshot_id
            JOIN platform.source_asset AS asset
              ON asset.id = snapshot.source_asset_id
            JOIN platform.source_system AS system
              ON system.id = asset.source_system_id
            WHERE observation.id = :observation_id
            """
        ),
        {
            "observation_id": persisted.source_observation_id,
        },
    ).one()

    assert row.system_key == "integration_source"
    assert row.identity_kind == "relative_path"
    assert row.identity_key == observation.relative_path
    assert row.content_sha256 == fingerprint.content_sha256
    assert row.byte_size == fingerprint.byte_size
    assert row.source_path == observation.relative_path
    assert row.filename == observation.filename
    assert row.observed_at == observation.observed_at
    assert row.source_modified_at == observation.source_modified_at
    assert row.media_type == observation.media_type
