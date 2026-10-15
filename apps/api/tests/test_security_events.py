"""Security event notes, client IP resolution, aggregation and failure safety."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from app.security_events import (
    SecurityEventNote,
    SecurityEventRecorder,
    SecurityEventRow,
    SecurityHTTPException,
    client_ip,
    is_ignored_path,
    run_maintenance,
)


class _ListSink:
    def __init__(self) -> None:
        self.rows: list[SecurityEventRow] = []

    def write(self, rows: list[SecurityEventRow]) -> None:
        self.rows.extend(rows)


class _FailingSink:
    def write(self, rows: list[SecurityEventRow]) -> None:
        raise RuntimeError("database is down")


def _clock(second: int = 10) -> datetime:
    return datetime(2026, 10, 15, 12, 30, second, tzinfo=UTC)


def _scope(peer: str, forwarded: str | None = None) -> dict[str, object]:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return {"type": "http", "client": (peer, 1234), "headers": headers}


def test_security_http_exception_carries_its_note() -> None:
    note = SecurityEventNote("csrf.rejected", reason="token_invalid")
    exc = SecurityHTTPException(403, "CSRF", note)
    assert exc.status_code == 403
    assert exc.note is note


def test_client_ip_trusts_the_last_forwarded_entry_from_railway() -> None:
    assert client_ip(_scope("100.64.0.7", "9.9.9.9, 200.1.2.3")) == "200.1.2.3"


def test_client_ip_ignores_forwarded_header_from_outside_railway() -> None:
    assert client_ip(_scope("200.1.2.3", "9.9.9.9")) == "200.1.2.3"


def test_client_ip_rejects_garbage() -> None:
    assert client_ip(_scope("100.64.0.7", "not-an-ip")) == "100.64.0.7"
    assert client_ip(_scope("testclient")) is None


def test_ignored_paths() -> None:
    assert is_ignored_path("/ready")
    assert is_ignored_path("/rodales/assets/index.js")
    assert is_ignored_path("/favicon.ico")
    assert not is_ignored_path("/api/transelec/summary")


def test_notes_become_one_row_each() -> None:
    sink = _ListSink()
    recorder = SecurityEventRecorder(sink, clock=_clock)
    note = SecurityEventNote(
        "access.denied", reason="no_grant", product_key="forestry", actor_app_user_id=4
    )

    recorder.observe(path="/api/forestry/versions", status=403, client_ip="200.1.2.3", note=note)
    assert recorder.flush() == 1

    (row,) = sink.rows
    assert (row.event_type, row.reason, row.product_key, row.actor_app_user_id) == (
        "access.denied",
        "no_grant",
        "forestry",
        4,
    )
    assert (row.path, row.http_status, row.client_ip, row.count) == (
        "/api/forestry/versions",
        403,
        "200.1.2.3",
        1,
    )


def test_401s_aggregate_per_ip_path_and_minute() -> None:
    sink = _ListSink()
    seconds = iter([1, 20, 59])
    recorder = SecurityEventRecorder(sink, clock=lambda: _clock(next(seconds)))
    for _ in range(3):
        recorder.observe(path="/api/x", status=401, client_ip="200.1.2.3", note=None)

    recorder.flush()
    (row,) = sink.rows
    assert row.event_type == "auth.required"
    assert row.count == 3
    assert row.occurred_at == datetime(2026, 10, 15, 12, 30, tzinfo=UTC)


def test_other_statuses_without_note_are_not_recorded() -> None:
    sink = _ListSink()
    recorder = SecurityEventRecorder(sink, clock=_clock)
    for status in (200, 302, 404, 500):
        recorder.observe(path="/api/x", status=status, client_ip="200.1.2.3", note=None)
    assert recorder.flush() == 0
    assert sink.rows == []


def test_recorder_caps_buffers() -> None:
    sink = _ListSink()
    recorder = SecurityEventRecorder(sink, clock=_clock, max_buffered=5)
    for index in range(50):
        recorder.observe(path=f"/scan/{index}", status=401, client_ip="200.1.2.3", note=None)
        recorder.observe(
            path="/x", status=403, client_ip="200.1.2.3", note=SecurityEventNote("csrf.rejected")
        )
    assert len(recorder.drain()) == 10  # 5 aggregated keys + 5 noted rows


def test_flush_survives_sink_failure() -> None:
    recorder = SecurityEventRecorder(_FailingSink(), clock=_clock)
    recorder.observe(path="/api/x", status=401, client_ip=None, note=None)
    assert recorder.flush() == 0
    recorder.observe(path="/api/x", status=401, client_ip=None, note=None)
    assert recorder.flush() == 0


def test_path_is_truncated() -> None:
    sink = _ListSink()
    recorder = SecurityEventRecorder(sink, clock=_clock)
    recorder.observe(path="/" + "a" * 2000, status=401, client_ip=None, note=None)
    recorder.flush()
    assert len(sink.rows[0].path) == 512


def test_maintenance_flushes_and_stops() -> None:
    sink = _ListSink()
    recorder = SecurityEventRecorder(sink, clock=_clock)
    recorder.observe(path="/api/x", status=401, client_ip=None, note=None)
    purged: list[int] = []

    def purge() -> int:
        purged.append(1)
        return 0

    async def scenario() -> None:
        stop = asyncio.Event()
        task = asyncio.create_task(
            run_maintenance(
                recorder,
                purge=purge,
                stop=stop,
                flush_every=0.01,
                purge_every=0.01,
            )
        )
        await asyncio.sleep(0.05)
        stop.set()
        await task

    asyncio.run(scenario())
    assert len(sink.rows) == 1
    assert purged
