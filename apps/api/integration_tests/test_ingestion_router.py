"""Ingestion router: upload, RBAC, product isolation, IDOR-safe retry, audit gating."""

from __future__ import annotations

import zipfile
from collections.abc import Generator
from io import BytesIO
from pathlib import Path

import pytest
from app.deps import get_object_store
from app.main import app
from app.object_store import LocalObjectStore
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text


@pytest.fixture
def client(integration_engine: Engine, tmp_path: Path) -> Generator[TestClient, None, None]:
    del integration_engine  # ensures the schema/migration fixtures ran first
    app.dependency_overrides[get_object_store] = lambda: LocalObjectStore(tmp_path / "object-store")

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


def _login(client: TestClient, identity_key: str) -> None:
    response = client.post("/auth/dev-login", json={"identity_key": identity_key})
    assert response.status_code == 200, response.text


def _forestry_zip_bytes() -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("predio.shp", b"x")
        archive.writestr("predio.shx", b"y")
        archive.writestr("predio.dbf", b"z")
        archive.writestr("predio.prj", b"w")
    return buffer.getvalue()


def _cleanup_all_test_data(engine: Engine) -> None:
    """Wipe everything this test file's requests may have created."""

    with engine.connect() as conn:
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


@pytest.fixture(autouse=True)
def _isolated_platform_tables(integration_engine: Engine) -> Generator[None, None, None]:
    yield
    _cleanup_all_test_data(integration_engine)


def test_upload_requires_session(client: TestClient) -> None:
    response = client.post(
        "/ingesta/upload",
        data={"product_key": "forestry"},
        files={"file": ("predio.zip", _forestry_zip_bytes(), "application/zip")},
    )
    assert response.status_code == 401


def test_upload_rejects_unknown_product_key(client: TestClient) -> None:
    _login(client, "dev-operator")
    response = client.post(
        "/ingesta/upload",
        data={"product_key": "not_a_real_product"},
        files={"file": ("predio.zip", _forestry_zip_bytes(), "application/zip")},
    )
    assert response.status_code == 422


def test_viewer_cannot_upload(client: TestClient) -> None:
    _login(client, "dev-viewer")  # default grant: transelect VIEWER only
    response = client.post(
        "/ingesta/upload",
        data={"product_key": "transelect"},
        files={"file": ("wb.xlsx", b"not a real workbook", "application/octet-stream")},
    )
    assert response.status_code == 403


def test_operator_upload_happy_path_forestry(client: TestClient) -> None:
    _login(client, "dev-operator")  # default grant: forestry OPERATOR only
    response = client.post(
        "/ingesta/upload",
        data={"product_key": "forestry"},
        files={"file": ("predio.zip", _forestry_zip_bytes(), "application/zip")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["job_id"] is not None
    assert len(body["sha256"]) == 64
    assert body["validation_evidence"]["has_shp"] is True


def test_forestry_zip_slip_is_rejected_and_not_persisted(client: TestClient) -> None:
    _login(client, "dev-operator")
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(zipfile.ZipInfo("../../etc/passwd"), b"pwned")

    response = client.post(
        "/ingesta/upload",
        data={"product_key": "forestry"},
        files={"file": ("evil.zip", buffer.getvalue(), "application/zip")},
    )
    assert response.status_code == 422

    jobs_response = client.get("/ingesta/jobs")
    assert jobs_response.json() == []


def test_jobs_list_is_scoped_to_granted_products(client: TestClient) -> None:
    _login(client, "dev-operator")  # forestry only
    client.post(
        "/ingesta/upload",
        data={"product_key": "forestry"},
        files={"file": ("predio.zip", _forestry_zip_bytes(), "application/zip")},
    )
    jobs = client.get("/ingesta/jobs").json()
    assert all(job["product_key"] == "forestry" for job in jobs)
    assert len(jobs) == 1

    _login(client, "dev-viewer")  # transelect only — must not see the forestry job
    other_jobs = client.get("/ingesta/jobs").json()
    assert other_jobs == []


def test_retry_on_ungranted_product_returns_404_not_403(client: TestClient) -> None:
    _login(client, "dev-operator")  # forestry only
    upload_response = client.post(
        "/ingesta/upload",
        data={"product_key": "forestry"},
        files={"file": ("predio.zip", _forestry_zip_bytes(), "application/zip")},
    )
    job_id = upload_response.json()["job_id"]

    _login(client, "dev-viewer")  # transelect only — no grant on forestry at all
    retry_response = client.post(f"/ingesta/jobs/{job_id}/retry")
    assert retry_response.status_code == 404


def test_retry_requires_failed_status(client: TestClient) -> None:
    _login(client, "dev-operator")
    upload_response = client.post(
        "/ingesta/upload",
        data={"product_key": "forestry"},
        files={"file": ("predio.zip", _forestry_zip_bytes(), "application/zip")},
    )
    job_id = upload_response.json()["job_id"]  # freshly queued, not failed

    retry_response = client.post(f"/ingesta/jobs/{job_id}/retry")
    assert retry_response.status_code == 409


def test_audit_requires_admin_role(client: TestClient) -> None:
    _login(client, "dev-operator")  # OPERATOR, not ADMIN
    response = client.get("/ingesta/audit")
    assert response.status_code == 403


def test_audit_visible_to_admin(client: TestClient) -> None:
    _login(client, "dev-admin")
    client.post(
        "/ingesta/upload",
        data={"product_key": "forestry"},
        files={"file": ("predio.zip", _forestry_zip_bytes(), "application/zip")},
    )
    response = client.get("/ingesta/audit")
    assert response.status_code == 200
    event_types = {event["event_type"] for event in response.json()}
    assert "upload.completed" in event_types
    assert "processing.requested" in event_types
