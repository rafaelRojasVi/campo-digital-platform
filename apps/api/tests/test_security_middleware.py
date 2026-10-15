"""The middleware records notes and 401s and never changes the response."""

from __future__ import annotations

from app.security_events import (
    STATE_KEY,
    SecurityEventNote,
    SecurityEventRecorder,
    SecurityEventRow,
    SecurityHTTPException,
)
from app.security_middleware import SecurityEventMiddleware
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.testclient import TestClient


class _ListSink:
    def __init__(self) -> None:
        self.rows: list[SecurityEventRow] = []

    def write(self, rows: list[SecurityEventRow]) -> None:
        self.rows.extend(rows)


def _app(recorder: SecurityEventRecorder) -> FastAPI:
    app = FastAPI()

    async def _security(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, SecurityHTTPException)
        setattr(request.state, STATE_KEY, exc.note)
        return await http_exception_handler(request, exc)

    app.add_exception_handler(SecurityHTTPException, _security)

    @app.get("/denied")
    def denied() -> None:
        note = SecurityEventNote("access.denied", reason="no_grant")
        raise SecurityHTTPException(403, "no", note)

    @app.get("/anon")
    def anon() -> None:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    @app.get("/ready")
    def ready() -> dict[str, str]:
        raise HTTPException(status_code=401)

    @app.get("/ok")
    def ok() -> dict[str, str]:
        return {"ok": "yes"}

    app.add_middleware(SecurityEventMiddleware, recorder=recorder)
    return app


def test_middleware_records_note_and_401_but_not_ignored_or_ok() -> None:
    sink = _ListSink()
    recorder = SecurityEventRecorder(sink)
    with TestClient(_app(recorder)) as client:
        assert client.get("/denied?token=SECRET").status_code == 403
        assert client.get("/anon").status_code == 401
        assert client.get("/anon").status_code == 401
        assert client.get("/ready").status_code == 401
        assert client.get("/ok").status_code == 200
    recorder.flush()

    by_type = {row.event_type: row for row in sink.rows}
    assert set(by_type) == {"access.denied", "auth.required"}
    assert by_type["access.denied"].path == "/denied"
    assert by_type["auth.required"].count == 2
    assert "SECRET" not in repr(sink.rows)


def test_middleware_never_changes_response_when_recording_fails() -> None:
    class _Boom(SecurityEventRecorder):
        def observe(self, **kwargs: object) -> None:
            raise RuntimeError("boom")

    with TestClient(_app(_Boom(_ListSink()))) as client:
        assert client.get("/ok").json() == {"ok": "yes"}
        assert client.get("/anon").status_code == 401
