"""The nightly CONAF pass over PostgreSQL with a fake CONAF."""

from __future__ import annotations

from collections.abc import Generator
from datetime import UTC, date, datetime, timedelta

import pytest
from app.conaf import ConafLookup
from app.conaf_refresh import refresh_due
from app.conaf_store import read_last_run, read_record, save_lookup
from sqlalchemy import Engine, text

NOW = datetime(2026, 10, 16, 6, 30, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _clean(integration_engine: Engine) -> Generator[None, None, None]:
    yield
    with integration_engine.begin() as connection:
        for table in ("platform.conaf_cambio", "platform.conaf_run", "platform.conaf_solicitud"):
            connection.execute(text(f"DELETE FROM {table}"))


class FakeConaf:
    def __init__(self, answers: dict[str, ConafLookup]) -> None:
        self.answers = answers
        self.asked: list[str] = []

    def lookup(self, numero: str) -> ConafLookup:
        self.asked.append(numero)
        return self.answers.get(numero, ConafLookup(numero, "unavailable"))


def found(numero: str, estado: str) -> ConafLookup:
    return ConafLookup(numero, "found", estado=estado, fecha_ingreso=date(2026, 9, 1))


def test_refresh_checks_due_numbers_and_records_a_run(integration_engine: Engine) -> None:
    with integration_engine.begin() as connection:
        save_lookup(connection, found("111111", "EN EVALUACION"), now=NOW - timedelta(days=2))
        save_lookup(connection, found("222222", "EN EVALUACION"), now=NOW - timedelta(hours=1))
    conaf = FakeConaf(
        {"111111": found("111111", "APROBADA"), "333333": found("333333", "APROBADA")}
    )
    summary = refresh_due(
        integration_engine,
        conaf,
        now=NOW,
        clock=lambda: NOW,
        collect=lambda _connection: ["111111", "222222", "333333"],
    )
    assert conaf.asked == ["111111", "333333"]  # 222222 was checked an hour ago
    assert summary.counts["found"] == 2 and summary.counts["changed"] == 1
    assert summary.stopped_reason is None
    with integration_engine.connect() as connection:
        run = read_last_run(connection)
        assert run is not None and run.finished_at == NOW and run.changed == 1 and run.due == 2


def test_refresh_stops_after_five_unavailable_and_keeps_data(integration_engine: Engine) -> None:
    numbers = [f"{n:06d}" for n in range(1, 11)]
    with integration_engine.begin() as connection:
        save_lookup(connection, found("000001", "APROBADA"), now=NOW - timedelta(days=2))
    conaf = FakeConaf({})
    summary = refresh_due(
        integration_engine, conaf, now=NOW, clock=lambda: NOW, collect=lambda _c: numbers
    )
    assert len(conaf.asked) == 5
    assert summary.stopped_reason == "conaf_unavailable"
    with integration_engine.connect() as connection:
        kept = read_record(connection, "000001")
        assert (
            kept is not None and kept.estado == "APROBADA" and kept.lookup_status == "unavailable"
        )


def test_refresh_respects_the_limit(integration_engine: Engine) -> None:
    numbers = [f"{n:06d}" for n in range(1, 6)]
    conaf = FakeConaf({n: found(n, "APROBADA") for n in numbers})
    summary = refresh_due(
        integration_engine, conaf, now=NOW, clock=lambda: NOW, collect=lambda _c: numbers, limit=3
    )
    assert len(conaf.asked) == 3
    assert summary.stopped_reason == "limit"


def test_refresh_stops_on_shutdown_and_records_it(integration_engine: Engine) -> None:
    numbers = [f"{n:06d}" for n in range(1, 6)]
    conaf = FakeConaf({n: found(n, "APROBADA") for n in numbers})
    summary = refresh_due(
        integration_engine,
        conaf,
        now=NOW,
        clock=lambda: NOW,
        collect=lambda _c: numbers,
        should_stop=lambda: len(conaf.asked) >= 2,
    )
    assert len(conaf.asked) == 2
    assert summary.stopped_reason == "shutdown"
    with integration_engine.connect() as connection:
        run = read_last_run(connection)
        assert run is not None and run.finished_at == NOW and run.stopped_reason == "shutdown"


def test_one_bad_row_does_not_abort_the_night(integration_engine: Engine) -> None:
    from decimal import Decimal

    numbers = ["000001", "000002", "000003"]
    answers = {n: found(n, "APROBADA") for n in numbers}
    # A value the column cannot hold (bypassing the parser's guard).
    answers["000002"] = ConafLookup(
        "000002", "found", estado="APROBADA", superficie_ha=Decimal("1e12")
    )
    conaf = FakeConaf(answers)
    summary = refresh_due(
        integration_engine, conaf, now=NOW, clock=lambda: NOW, collect=lambda _c: numbers
    )
    assert conaf.asked == numbers
    assert summary.counts["found"] == 2
    with integration_engine.connect() as connection:
        assert read_record(connection, "000003") is not None
        run = read_last_run(connection)
        assert run is not None and run.finished_at == NOW


def test_a_killed_run_is_retried_the_same_day(integration_engine: Engine) -> None:
    from app.conaf_refresh import already_ran_today

    with integration_engine.begin() as connection:
        connection.execute(
            text("INSERT INTO platform.conaf_run (started_at) VALUES (:start)"),
            {"start": NOW - timedelta(minutes=20)},
        )
    with integration_engine.connect() as connection:
        assert already_ran_today(connection, NOW) is False
    with integration_engine.begin() as connection:
        connection.execute(
            text("INSERT INTO platform.conaf_run (started_at, finished_at) VALUES (:s, :s)"),
            {"s": NOW - timedelta(minutes=5)},
        )
    with integration_engine.connect() as connection:
        assert already_ran_today(connection, NOW) is True
