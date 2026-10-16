"""Migration 0014: Rodales management-report tables and their constraints."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import Connection, text
from sqlalchemy.exc import IntegrityError

from forestry_report_fixtures import seed_published_base, seed_user


def _insert_report(
    connection: Connection,
    *,
    snapshot_id: int,
    user_id: int,
    name: str,
    month: str = "2027-01",
    status: str = "borrador",
) -> int:
    return connection.execute(
        text(
            """
            INSERT INTO forestry.report
                (name, report_type, report_month, status, base_snapshot_id, created_by_app_user_id)
            VALUES (:name, 'cosecha', :month, :status, :snapshot_id, :user_id)
            RETURNING id
            """
        ),
        {
            "name": name,
            "month": month,
            "status": status,
            "snapshot_id": snapshot_id,
            "user_id": user_id,
        },
    ).scalar_one()


@pytest.fixture
def seeded(integration_connection: Connection, tmp_path: Path) -> tuple[int, int]:
    snapshot_id = seed_published_base(integration_connection, tmp_path)
    user_id = seed_user(integration_connection, "operadora")
    return snapshot_id, user_id


def test_report_tables_exist(integration_connection: Connection) -> None:
    tables = set(
        integration_connection.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'forestry'")
        ).scalars()
    )
    assert {"report", "report_note", "report_feature"} <= tables
    geometry_type = integration_connection.execute(
        text(
            "SELECT type, srid FROM geometry_columns "
            "WHERE f_table_schema = 'forestry' AND f_table_name = 'report_feature'"
        )
    ).one()
    assert (geometry_type.type, geometry_type.srid) == ("MULTIPOLYGON", 32718)


def test_new_report_starts_as_a_draft_at_revision_one(
    integration_connection: Connection, seeded: tuple[int, int]
) -> None:
    snapshot_id, user_id = seeded
    report_id = _insert_report(
        integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="A"
    )
    row = integration_connection.execute(
        text("SELECT status, revision FROM forestry.report WHERE id = :id"), {"id": report_id}
    ).one()
    assert (row.status, row.revision) == ("borrador", 1)


@pytest.mark.parametrize("month", ["2027-13", "2027-1", "27-01", "enero"])
def test_bad_month_is_rejected(
    integration_connection: Connection, seeded: tuple[int, int], month: str
) -> None:
    snapshot_id, user_id = seeded
    with pytest.raises(IntegrityError), integration_connection.begin_nested():
        _insert_report(
            integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="M", month=month
        )


def test_active_names_are_unique_ignoring_case_but_archived_ones_free_the_name(
    integration_connection: Connection, seeded: tuple[int, int]
) -> None:
    snapshot_id, user_id = seeded
    _insert_report(
        integration_connection,
        snapshot_id=snapshot_id,
        user_id=user_id,
        name="Cosecha",
        status="archivado",
    )
    _insert_report(integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="Cosecha")
    with pytest.raises(IntegrityError), integration_connection.begin_nested():
        _insert_report(
            integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="COSECHA"
        )


def test_change_request_note_needs_text(
    integration_connection: Connection, seeded: tuple[int, int]
) -> None:
    snapshot_id, user_id = seeded
    report_id = _insert_report(
        integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="N"
    )
    with pytest.raises(IntegrityError), integration_connection.begin_nested():
        integration_connection.execute(
            text(
                "INSERT INTO forestry.report_note (report_id, kind, body, author_app_user_id) "
                "VALUES (:report_id, 'cambios_solicitados', '   ', :user_id)"
            ),
            {"report_id": report_id, "user_id": user_id},
        )


def test_deleting_a_report_deletes_its_features_and_notes(
    integration_connection: Connection, seeded: tuple[int, int]
) -> None:
    snapshot_id, user_id = seeded
    report_id = _insert_report(
        integration_connection, snapshot_id=snapshot_id, user_id=user_id, name="D"
    )
    integration_connection.execute(
        text(
            """
            INSERT INTO forestry.report_feature (
                report_id, position, source_feature_ordinal, in_report, geometry_changed,
                attributes, geometry
            )
            VALUES (:report_id, 1, 1, true, false, '{}'::jsonb,
                    ST_Multi(ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 32718)))
            """
        ),
        {"report_id": report_id},
    )
    integration_connection.execute(
        text(
            "INSERT INTO forestry.report_note (report_id, kind, body, author_app_user_id) "
            "VALUES (:report_id, 'aprobado', '', :user_id)"
        ),
        {"report_id": report_id, "user_id": user_id},
    )
    integration_connection.execute(
        text("DELETE FROM forestry.report WHERE id = :id"), {"id": report_id}
    )
    remaining = integration_connection.execute(
        text(
            "SELECT (SELECT count(*) FROM forestry.report_feature WHERE report_id = :id) "
            "+ (SELECT count(*) FROM forestry.report_note WHERE report_id = :id)"
        ),
        {"id": report_id},
    ).scalar_one()
    assert remaining == 0
