"""Storage rules for CONAF results and the numbers both products know."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from app.conaf import ConafLookup
from app.conaf_store import (
    collect_known_numbers,
    due_numbers,
    is_stale,
    needs_refresh,
    read_record,
    recently_changed,
    save_lookup,
)
from forestry_report_fixtures import seed_published_base, seed_user
from sqlalchemy import Connection, text

NOW = datetime(2026, 10, 16, 12, 0, tzinfo=UTC)


def found(estado: str = "EN EVALUACION") -> ConafLookup:
    return ConafLookup(
        "090663",
        "found",
        tipo="PLAN DE MANEJO",
        superficie_ha=Decimal("3"),
        fecha_ingreso=date(2026, 9, 1),
        estado=estado,
    )


def changes(connection: Connection) -> list[tuple[str | None, str]]:
    return [
        (row.estado_anterior, row.estado_nuevo)
        for row in connection.execute(
            text("SELECT estado_anterior, estado_nuevo FROM platform.conaf_cambio ORDER BY id")
        )
    ]


def test_first_found_read_records_no_change(integration_connection: Connection) -> None:
    record, changed = save_lookup(integration_connection, found(), now=NOW)
    assert (record.lookup_status, record.estado, changed) == ("found", "EN EVALUACION", False)
    assert record.found_at == NOW and record.estado_changed_at is None
    assert changes(integration_connection) == []


def test_new_estado_records_a_change(integration_connection: Connection) -> None:
    save_lookup(integration_connection, found(), now=NOW)
    later = NOW + timedelta(days=1)
    record, changed = save_lookup(integration_connection, found("APROBADA"), now=later)
    assert changed is True
    assert (record.estado, record.estado_changed_at) == ("APROBADA", later)
    assert changes(integration_connection) == [("EN EVALUACION", "APROBADA")]


def test_unavailable_keeps_the_last_found_data(integration_connection: Connection) -> None:
    save_lookup(integration_connection, found(), now=NOW)
    later = NOW + timedelta(days=1)
    record, changed = save_lookup(
        integration_connection, ConafLookup("090663", "unavailable"), now=later
    )
    assert changed is False
    assert (record.lookup_status, record.estado, record.checked_at) == (
        "unavailable",
        "EN EVALUACION",
        later,
    )
    assert record.found_at == NOW
    assert is_stale(record, later) is True


def test_mismatch_keeps_data_and_names_the_returned_number(
    integration_connection: Connection,
) -> None:
    save_lookup(integration_connection, found(), now=NOW)
    record, _ = save_lookup(
        integration_connection,
        ConafLookup("090663", "mismatch", returned_solicitud="069025"),
        now=NOW + timedelta(hours=1),
    )
    assert (record.lookup_status, record.returned_solicitud, record.estado) == (
        "mismatch",
        "069025",
        "EN EVALUACION",
    )


def test_refresh_and_badge_windows(integration_connection: Connection) -> None:
    record, _ = save_lookup(integration_connection, found(), now=NOW)
    assert needs_refresh(None, NOW) is True
    assert needs_refresh(record, NOW + timedelta(hours=11)) is False
    assert needs_refresh(record, NOW + timedelta(hours=13)) is True
    down, _ = save_lookup(integration_connection, ConafLookup("090663", "unavailable"), now=NOW)
    assert needs_refresh(down, NOW + timedelta(minutes=16)) is True
    changed, _ = save_lookup(integration_connection, found("APROBADA"), now=NOW)
    assert recently_changed(changed, NOW + timedelta(days=6)) is True
    assert recently_changed(changed, NOW + timedelta(days=8)) is False


def test_collect_known_numbers_normalizes_and_skips_planilla_style(
    integration_connection: Connection, tmp_path: Path
) -> None:
    integration_connection.execute(
        text("UPDATE platform.transelec_dashboard_state SET active_import_id = NULL")
    )
    snapshot_id = seed_published_base(integration_connection, tmp_path)
    user_id = seed_user(integration_connection, "marco")
    for name, numero, status in (
        ("Cosecha", "123456", "borrador"),
        ("Vieja", "654321", "archivado"),
        ("Sin número", None, "borrador"),
    ):
        integration_connection.execute(
            text(
                "INSERT INTO forestry.report (name, report_type, report_month, status, "
                "base_snapshot_id, created_by_app_user_id, conaf_solicitud) "
                "VALUES (:name, 'cosecha', '2027-01', :status, :snapshot, :user, :numero)"
            ),
            {
                "name": name,
                "status": status,
                "snapshot": snapshot_id,
                "user": user_id,
                "numero": numero,
            },
        )
    assert collect_known_numbers(integration_connection) == ["123456"]


def test_due_numbers_skips_recently_checked(integration_connection: Connection) -> None:
    save_lookup(integration_connection, found(), now=NOW - timedelta(hours=2))
    assert due_numbers(integration_connection, ["090663", "111111"], now=NOW) == ["111111"]
    assert due_numbers(integration_connection, ["090663"], now=NOW + timedelta(hours=19)) == [
        "090663"
    ]
    assert read_record(integration_connection, "111111") is None
