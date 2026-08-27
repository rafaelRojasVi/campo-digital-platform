from __future__ import annotations

from app.database import get_database_engine
from app.main import app
from fastapi.testclient import TestClient


def test_readiness_uses_real_postgresql_database() -> None:
    get_database_engine.cache_clear()

    try:
        client = TestClient(app)

        response = client.get("/ready")

        assert response.status_code == 200
        assert response.json() == {"status": "ready"}
    finally:
        engine = get_database_engine()
        engine.dispose()
        get_database_engine.cache_clear()


def test_real_readiness_is_repeatable() -> None:
    get_database_engine.cache_clear()

    try:
        client = TestClient(app)

        for _ in range(5):
            response = client.get("/ready")

            assert response.status_code == 200
            assert response.json() == {"status": "ready"}
    finally:
        engine = get_database_engine()
        engine.dispose()
        get_database_engine.cache_clear()
