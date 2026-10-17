"""Migration 0015: CONAF status tables and the Rodales report column."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import Connection, text
from sqlalchemy.exc import IntegrityError

NOW = datetime(2026, 10, 16, 12, 0, tzinfo=UTC)


def test_conaf_tables_exist(integration_connection: Connection) -> None:
    tables = set(
        integration_connection.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'platform'")
        ).scalars()
    )
    assert {"conaf_solicitud", "conaf_cambio", "conaf_run"} <= tables


@pytest.mark.parametrize("numero", ["12345", "abc123", "1234567890"])
def test_numero_must_be_six_to_nine_digits(integration_connection: Connection, numero: str) -> None:
    with pytest.raises(IntegrityError), integration_connection.begin_nested():
        integration_connection.execute(
            text(
                "INSERT INTO platform.conaf_solicitud (numero, lookup_status, checked_at) "
                "VALUES (:numero, 'found', :now)"
            ),
            {"numero": numero, "now": NOW},
        )


def test_lookup_status_is_checked(integration_connection: Connection) -> None:
    with pytest.raises(IntegrityError), integration_connection.begin_nested():
        integration_connection.execute(
            text(
                "INSERT INTO platform.conaf_solicitud (numero, lookup_status, checked_at) "
                "VALUES ('090663', 'maybe', :now)"
            ),
            {"now": NOW},
        )


def test_report_conaf_number_is_checked(integration_connection: Connection) -> None:
    columns = integration_connection.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'forestry' AND table_name = 'report'"
        )
    ).scalars()
    assert "conaf_solicitud" in set(columns)
    check = integration_connection.execute(
        text(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conname = 'ck_report_conaf_solicitud'"
        )
    ).scalar_one()
    assert "0-9" in check
