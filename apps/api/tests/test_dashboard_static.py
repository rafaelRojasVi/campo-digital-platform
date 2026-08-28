from __future__ import annotations

from pathlib import Path

import pytest
from app.dashboard_static import _resolve_within, mount_dashboard
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_dist(tmp_path: Path) -> Path:
    dist_dir = tmp_path / "dist"
    assets_dir = dist_dir / "assets"
    assets_dir.mkdir(parents=True)

    (dist_dir / "index.html").write_text("<html>spa-shell</html>", encoding="utf-8")
    (assets_dir / "app.js").write_text("console.log('hi')", encoding="utf-8")

    return dist_dir


def _client_with_mounted_dashboard(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> TestClient:
    dist_dir = _build_dist(tmp_path)
    monkeypatch.setenv("CAMPO_TRANSELEC_DASHBOARD_DIST", str(dist_dir))

    app = FastAPI()

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    mount_dashboard(app)

    return TestClient(app)


def test_mount_dashboard_is_a_noop_when_no_dist_directory_exists(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CAMPO_TRANSELEC_DASHBOARD_DIST", str(tmp_path / "does-not-exist"))

    app = FastAPI()
    mount_dashboard(app)

    client = TestClient(app)
    response = client.get("/")

    assert response.status_code == 404


def test_root_serves_the_spa_shell(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client_with_mounted_dashboard(tmp_path, monkeypatch)

    response = client.get("/")

    assert response.status_code == 200
    assert "spa-shell" in response.text


def test_unknown_client_route_falls_back_to_the_spa_shell(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client_with_mounted_dashboard(tmp_path, monkeypatch)

    response = client.get("/some/deep/client/route")

    assert response.status_code == 200
    assert "spa-shell" in response.text


def test_static_asset_is_served_directly(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client_with_mounted_dashboard(tmp_path, monkeypatch)

    response = client.get("/assets/app.js")

    assert response.status_code == 200
    assert "console.log" in response.text


def test_existing_api_route_takes_precedence_over_the_spa_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client_with_mounted_dashboard(tmp_path, monkeypatch)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unmatched_api_prefixed_path_returns_404_not_the_spa_shell(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client_with_mounted_dashboard(tmp_path, monkeypatch)

    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert "spa-shell" not in response.text


def test_resolve_within_rejects_paths_that_escape_the_dist_directory(
    tmp_path: Path,
) -> None:
    dist_dir = _build_dist(tmp_path)
    (tmp_path / "secret.txt").write_text("do-not-serve", encoding="utf-8")

    assert _resolve_within(dist_dir, "../secret.txt") is None


def test_resolve_within_accepts_paths_inside_the_dist_directory(
    tmp_path: Path,
) -> None:
    dist_dir = _build_dist(tmp_path)

    resolved = _resolve_within(dist_dir, "assets/app.js")

    assert resolved == (dist_dir / "assets" / "app.js").resolve()
