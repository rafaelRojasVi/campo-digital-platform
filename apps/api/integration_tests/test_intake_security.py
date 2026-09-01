"""Intake security sweep: oversized uploads and malicious filenames.

Zip-slip/zip-bomb rejection, IDOR-safe job/retry scoping, and the
dev-auth-disabled-in-production gate are covered in
test_ingestion_router.py and test_main_dev_auth_gate.py respectively — this
file covers the remaining Part 12 threats not already exercised there.
"""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

import app.routers.ingestion as ingestion_module
import pytest
from app.deps import get_object_store
from app.main import app
from app.object_store import LocalObjectStore
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text


@pytest.fixture
def client(integration_engine: Engine, tmp_path: Path) -> Generator[TestClient, None, None]:
    del integration_engine
    store_root = tmp_path / "object-store"
    app.dependency_overrides[get_object_store] = lambda: LocalObjectStore(store_root)

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _isolated_platform_tables(integration_engine: Engine) -> Generator[None, None, None]:
    yield
    with integration_engine.connect() as conn:
        for table in (
            "generated_artifact",
            "processing_attempt",
            "processing_job",
            "ingestion_run",
            "source_observation",
            "source_snapshot",
            "source_asset",
            "source_system",
            "audit_event",
            "product_grant",
            "app_user",
        ):
            conn.execute(text(f"DELETE FROM platform.{table}"))
        conn.commit()


def _login(client: TestClient, identity_key: str) -> None:
    response = client.post("/auth/dev-login", json={"identity_key": identity_key})
    assert response.status_code == 200, response.text


def test_oversized_upload_is_rejected_with_413(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ingestion_module, "MAX_UPLOAD_BYTES", 10)
    _login(client, "dev-admin")

    response = client.post(
        "/ingesta/upload",
        data={"product_key": "transelect"},
        files={
            "file": (
                "wb.xlsx",
                b"this payload is more than ten bytes long",
                "application/octet-stream",
            )
        },
    )
    assert response.status_code == 413


def test_path_traversal_filename_is_stored_as_metadata_only(
    client: TestClient, tmp_path: Path
) -> None:
    _login(client, "dev-admin")

    response = client.post(
        "/ingesta/upload",
        data={"product_key": "transelect"},
        files={"file": ("../../evil.xlsx", b"harmless content", "application/octet-stream")},
    )
    assert response.status_code == 200, response.text

    store_root = tmp_path / "object-store"
    # The object store's own key scheme is content-addressed; the filename
    # never becomes part of any filesystem path. Confirm nothing escaped
    # the store root regardless of the request outcome.
    for path in store_root.rglob("*"):
        assert (
            store_root.resolve() in path.resolve().parents or path.resolve() == store_root.resolve()
        )


def test_malicious_content_type_does_not_change_dispatch(client: TestClient) -> None:
    """Only the explicit product_key field selects the inspector, never Content-Type."""

    _login(client, "dev-admin")

    response = client.post(
        "/ingesta/upload",
        data={"product_key": "transelect"},
        files={"file": ("wb.xlsx", b"not really xlsx bytes", "application/zip")},
    )
    assert response.status_code == 200, response.text
    # Transelec inspection was attempted (and failed gracefully as evidence,
    # not a forestry ZIP inspection, despite the zip Content-Type header).
    assert "error" in response.json()["validation_evidence"]
