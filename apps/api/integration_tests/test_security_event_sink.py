"""DatabaseSecurityEventSink writes rows; purge keeps 90 days."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.security_events import (
    DatabaseSecurityEventSink,
    SecurityEventRow,
    purge_expired_security_events,
)
from sqlalchemy import Engine, text

_MARK = "/itest/security-sink"


def _cleanup(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text("DELETE FROM platform.security_event WHERE path LIKE :p"), {"p": _MARK + "%"}
        )


def test_sink_writes_and_purge_removes_only_old_rows(integration_engine: Engine) -> None:
    now = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)
    rows = [
        SecurityEventRow(
            now - timedelta(days=91), "auth.required", _MARK + "/old", 401, "200.1.2.3", count=7
        ),
        SecurityEventRow(
            now - timedelta(days=1),
            "sign_in.rejected",
            _MARK + "/new",
            400,
            None,
            reason="flow_cookie_missing",
        ),
    ]
    _cleanup(integration_engine)
    try:
        DatabaseSecurityEventSink(lambda: integration_engine).write(rows)
        purge_expired_security_events(integration_engine, now=now)
        with integration_engine.connect() as connection:
            remaining = connection.execute(
                text(
                    "SELECT path, reason, host(client_ip) AS ip"
                    " FROM platform.security_event WHERE path LIKE :p"
                ),
                {"p": _MARK + "%"},
            ).all()
        assert [(r.path, r.reason, r.ip) for r in remaining] == [
            (_MARK + "/new", "flow_cookie_missing", None)
        ]
    finally:
        _cleanup(integration_engine)
