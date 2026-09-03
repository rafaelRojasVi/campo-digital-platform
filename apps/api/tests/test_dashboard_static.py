"""Tests for app.dashboard_static, exercised against a standalone FastAPI
app rather than the real app.main:app, so these tests can freely control
CAMPO_TRANSELEC_DASHBOARD_DIST without needing a database or a session.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from app.dashboard_static import mount_dashboard
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_dist(tmp_path: Path) -> Path:
    dist_dir = tmp_path / "dist"
    (dist_dir / "assets").mkdir(parents=True)
    (dist_dir / "index.html").write_text("<html><body>dashboard shell</body></html>")
    (dist_dir / "assets" / "index-abc123.js").write_text("console.log('app')")
    return dist_dir


def test_mount_dashboard_is_a_no_op_when_no_dist_directory_exists(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("CAMPO_TRANSELEC_DASHBOARD_DIST", str(tmp_path / "does-not-exist"))

    app = FastAPI()
    mount_dashboard(app, reserved_root_segments=frozenset())

    client = TestClient(app)
    response = client.get("/")

    # No catch-all was registered, so FastAPI's own default 404 applies.
    assert response.status_code == 404


def test_mount_dashboard_serves_index_html_at_the_root(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    dist_dir = _build_dist(tmp_path)
    monkeypatch.setenv("CAMPO_TRANSELEC_DASHBOARD_DIST", str(dist_dir))

    app = FastAPI()
    mount_dashboard(app, reserved_root_segments=frozenset())

    response = TestClient(app).get("/")

    assert response.status_code == 200
    assert "dashboard shell" in response.text


def test_mount_dashboard_falls_back_to_index_html_for_an_spa_route(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    dist_dir = _build_dist(tmp_path)
    monkeypatch.setenv("CAMPO_TRANSELEC_DASHBOARD_DIST", str(dist_dir))

    app = FastAPI()
    mount_dashboard(app, reserved_root_segments=frozenset({"health", "transelec"}))

    # /transelec/importar is a client-side route, not a build file — the SPA
    # fallback must still serve index.html for it (not one of the reserved
    # backend segments below).
    response = TestClient(app).get("/transelec-ui/importar")

    assert response.status_code == 200
    assert "dashboard shell" in response.text


def test_mount_dashboard_serves_a_real_build_asset_verbatim(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    dist_dir = _build_dist(tmp_path)
    monkeypatch.setenv("CAMPO_TRANSELEC_DASHBOARD_DIST", str(dist_dir))

    app = FastAPI()
    mount_dashboard(app, reserved_root_segments=frozenset())

    response = TestClient(app).get("/assets/index-abc123.js")

    assert response.status_code == 200
    assert "console.log" in response.text


def test_mount_dashboard_returns_404_for_a_reserved_backend_segment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A path whose first segment belongs to a real router (e.g. an
    unmatched /transelec/... call) must 404, never silently serve the SPA
    shell — that would hide a real backend error behind a 200."""

    dist_dir = _build_dist(tmp_path)
    monkeypatch.setenv("CAMPO_TRANSELEC_DASHBOARD_DIST", str(dist_dir))

    app = FastAPI()
    mount_dashboard(app, reserved_root_segments=frozenset({"transelec"}))

    response = TestClient(app).get("/transelec/does-not-exist")

    assert response.status_code == 404
    assert "dashboard shell" not in response.text


def test_mount_dashboard_rejects_a_path_traversal_attempt(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    dist_dir = _build_dist(tmp_path)
    (tmp_path / "secret.txt").write_text("outside the dist directory")
    monkeypatch.setenv("CAMPO_TRANSELEC_DASHBOARD_DIST", str(dist_dir))

    app = FastAPI()
    mount_dashboard(app, reserved_root_segments=frozenset())

    response = TestClient(app).get("/../secret.txt")

    assert "outside the dist directory" not in response.text
