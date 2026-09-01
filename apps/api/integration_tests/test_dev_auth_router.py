"""Dev-auth router: session lifecycle and default grant seeding."""

from __future__ import annotations

from collections.abc import Generator

import pytest
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text


@pytest.fixture
def client(integration_engine: Engine) -> Generator[TestClient, None, None]:
    del integration_engine  # ensures the schema/migration fixtures ran first
    with TestClient(app) as test_client:
        yield test_client


def _cleanup_identity(engine: Engine, identity_key: str) -> None:
    with engine.connect() as conn:
        user_id = conn.execute(
            text(
                "SELECT id FROM platform.app_user "
                "WHERE identity_kind = 'dev-local' AND identity_key = :key"
            ),
            {"key": identity_key},
        ).scalar_one_or_none()
        if user_id is not None:
            conn.execute(
                text("DELETE FROM platform.audit_event WHERE actor_app_user_id = :id"),
                {"id": user_id},
            )
            conn.execute(
                text("DELETE FROM platform.product_grant WHERE app_user_id = :id"), {"id": user_id}
            )
            conn.execute(text("DELETE FROM platform.app_user WHERE id = :id"), {"id": user_id})
        conn.commit()


def test_me_without_session_returns_401(client: TestClient) -> None:
    response = client.get("/auth/me")
    assert response.status_code == 401


def test_dev_login_unknown_identity_returns_422(client: TestClient) -> None:
    response = client.post("/auth/dev-login", json={"identity_key": "not-a-real-identity"})
    assert response.status_code == 422


def test_dev_login_seeds_default_grants_and_sets_session(
    client: TestClient, integration_engine: Engine
) -> None:
    try:
        response = client.post("/auth/dev-login", json={"identity_key": "dev-admin"})
        assert response.status_code == 200
        body = response.json()
        assert body["identity_key"] == "dev-admin"
        product_keys = {grant["product_key"] for grant in body["product_grants"]}
        assert product_keys == {"lidar", "forestry", "transelect"}

        me_response = client.get("/auth/me")
        assert me_response.status_code == 200
        assert me_response.json()["identity_key"] == "dev-admin"
    finally:
        _cleanup_identity(integration_engine, "dev-admin")


def test_logout_clears_session(client: TestClient, integration_engine: Engine) -> None:
    try:
        client.post("/auth/dev-login", json={"identity_key": "dev-viewer"})
        logout_response = client.post("/auth/logout")
        assert logout_response.status_code == 204

        me_response = client.get("/auth/me")
        assert me_response.status_code == 401
    finally:
        _cleanup_identity(integration_engine, "dev-viewer")
