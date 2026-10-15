"""Error reporting must stay off without a DSN and never ship client data."""

from __future__ import annotations

from typing import Any

import pytest
import sentry_sdk
from app import observability
from app.observability import init_error_reporting, scrub_event


def _event_with_request() -> dict[str, Any]:
    return {
        "level": "error",
        "request": {
            "method": "GET",
            "url": "https://campo.example/api/auth/google/callback?code=SECRET&state=abc",
            "query_string": "code=SECRET&state=abc",
            "cookies": {"campo_session": "token"},
            "headers": {"Cookie": "campo_session=token", "Authorization": "Bearer x"},
            "data": {"rows": ["planilla value"]},
            "env": {"REMOTE_ADDR": "200.1.2.3"},
        },
        "user": {"email": "persona@campodigital.cl", "ip_address": "200.1.2.3"},
    }


def test_scrub_event_keeps_only_method_and_path() -> None:
    scrubbed = scrub_event(_event_with_request(), {})

    assert scrubbed is not None
    assert scrubbed["request"] == {
        "method": "GET",
        "url": "https://campo.example/api/auth/google/callback",
    }
    assert "user" not in scrubbed


def test_scrub_event_handles_events_without_request() -> None:
    event: dict[str, Any] = {"level": "error", "message": "boom"}

    assert scrub_event(event, {}) == {"level": "error", "message": "boom"}


def test_scrub_event_drops_url_fragment() -> None:
    event: dict[str, Any] = {"request": {"method": "GET", "url": "https://x/a?q=r#frag"}}

    scrubbed = scrub_event(event, {})

    assert scrubbed is not None
    assert scrubbed["request"]["url"] == "https://x/a"


def test_init_is_a_no_op_without_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(observability.sentry_sdk, "init", lambda **kw: calls.append(kw))

    assert init_error_reporting(dsn=None, environment="production", release=None) is False
    assert init_error_reporting(dsn="  ", environment="production", release=None) is False
    assert calls == []


def test_init_configures_a_privacy_first_client(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(observability.sentry_sdk, "init", lambda **kw: calls.append(kw))

    started = init_error_reporting(
        dsn="https://key@o1.ingest.sentry.io/1",
        environment="production",
        release="e21cdb6",
    )

    assert started is True
    (options,) = calls
    assert options["dsn"] == "https://key@o1.ingest.sentry.io/1"
    assert options["environment"] == "production"
    assert options["release"] == "e21cdb6"
    assert options["data_collection"] == {
        "user_info": False,
        "cookies": {"mode": "off"},
        "http_headers": {"request": {"mode": "off"}},
        "http_bodies": [],
        "url_query_params": {"mode": "off"},
        "database_query_data": False,
        "queues": False,
        "stack_frame_variables": False,
    }
    assert options["max_request_body_size"] == "never"
    assert options["max_breadcrumbs"] == 0
    assert options["traces_sample_rate"] == 0
    assert options["before_send"] is scrub_event
    # Only server failures are reported; expected 4xx answers are not.
    fastapi = next(i for i in options["integrations"] if i.identifier == "fastapi")
    assert set(fastapi.failed_request_status_codes) == set(range(500, 600))


class _CaptureTransport(sentry_sdk.transport.Transport):
    def __init__(self, options: dict[str, Any] | None = None) -> None:
        super().__init__(options)
        self.events: list[dict[str, Any]] = []

    def capture_envelope(self, envelope: Any) -> None:
        event = envelope.get_event()
        if event is not None:
            self.events.append(event)


def test_real_client_reports_server_errors_without_client_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient

    transport = _CaptureTransport()
    real_init = sentry_sdk.init
    monkeypatch.setattr(
        observability.sentry_sdk,
        "init",
        lambda **options: real_init(**options, transport=transport),
    )
    init_error_reporting(
        dsn="https://key@o1.ingest.sentry.io/1", environment="test", release="abc123"
    )

    app = FastAPI()

    @app.post("/boom")
    def boom() -> None:
        raise RuntimeError("projection failed")

    @app.get("/missing")
    def missing() -> None:
        raise HTTPException(status_code=404)

    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            client.cookies.set("campo_session", "token")
            assert client.get("/missing?q=rechazada").status_code == 404
            response = client.post(
                "/boom?code=SECRET",
                content=b"planilla bytes",
                headers={"Authorization": "Bearer x"},
            )
            assert response.status_code == 500
        sentry_sdk.flush()
    finally:
        sentry_sdk.get_client().close()

    assert len(transport.events) == 1
    (event,) = transport.events
    assert event["exception"]["values"][-1]["value"] == "projection failed"
    assert event["release"] == "abc123"
    assert event["request"] == {"method": "POST", "url": "http://testserver/boom"}
    assert "user" not in event
    serialized = repr(event)
    for leaked in ("SECRET", "planilla bytes", "Bearer", "campo_session", "rechazada"):
        assert leaked not in serialized
