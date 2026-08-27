from __future__ import annotations

from unittest.mock import Mock

from app.database import get_database_engine
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.exc import SQLAlchemyError


def test_readiness_returns_ready_when_database_probe_succeeds() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    app.dependency_overrides[get_database_engine] = lambda: engine

    try:
        response = TestClient(app).get("/ready")
    finally:
        app.dependency_overrides.pop(get_database_engine, None)
        engine.dispose()

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_readiness_is_repeatable_without_connection_leak() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    app.dependency_overrides[get_database_engine] = lambda: engine

    try:
        client = TestClient(app)

        for _ in range(3):
            response = client.get("/ready")
            assert response.status_code == 200
            assert response.json() == {"status": "ready"}
    finally:
        app.dependency_overrides.pop(get_database_engine, None)
        engine.dispose()


def test_readiness_returns_503_without_leaking_backend_error() -> None:
    engine = Mock(spec=Engine)
    engine.connect.side_effect = SQLAlchemyError("password=should-never-appear")
    app.dependency_overrides[get_database_engine] = lambda: engine

    try:
        response = TestClient(app).get("/ready")
    finally:
        app.dependency_overrides.pop(get_database_engine, None)

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}
    assert "should-never-appear" not in response.text


def test_health_remains_available_when_database_is_unavailable() -> None:
    engine = Mock(spec=Engine)
    engine.connect.side_effect = SQLAlchemyError("database unavailable")
    app.dependency_overrides[get_database_engine] = lambda: engine

    try:
        response = TestClient(app).get("/health")
    finally:
        app.dependency_overrides.pop(get_database_engine, None)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
