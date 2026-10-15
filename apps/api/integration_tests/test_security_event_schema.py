"""Constraints on platform.security_event."""

from __future__ import annotations

import pytest
from sqlalchemy import Connection, text
from sqlalchemy.exc import IntegrityError

_INSERT = text(
    """
    INSERT INTO platform.security_event (event_type, path, http_status, client_ip, count)
    VALUES (:event_type, :path, :status, CAST(:ip AS inet), :count)
    RETURNING id
    """
)


def test_accepts_a_known_event(integration_connection: Connection) -> None:
    row_id = integration_connection.execute(
        _INSERT,
        {
            "event_type": "auth.required",
            "path": "/api/x",
            "status": 401,
            "ip": "200.1.2.3",
            "count": 5,
        },
    ).scalar_one()
    assert row_id > 0


@pytest.mark.parametrize(
    ("event_type", "path", "count"),
    [("made.up", "/api/x", 1), ("auth.required", "/api/x?q=1", 1), ("auth.required", "/api/x", 0)],
)
def test_rejects_unknown_type_query_string_and_zero_count(
    integration_connection: Connection, event_type: str, path: str, count: int
) -> None:
    with pytest.raises(IntegrityError), integration_connection.begin_nested():
        integration_connection.execute(
            _INSERT,
            {"event_type": event_type, "path": path, "status": 401, "ip": None, "count": count},
        )
