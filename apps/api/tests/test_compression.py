"""app.compression: gzip only on the large geometry reads.

The Rodales map downloads every polygon of a version (about 9.4 MB of
GeoJSON for Degenfeld); compression cuts that several times. It is limited
to those GET responses on purpose: they carry no secret and reflect no
request input, so compression cannot leak a token (BREACH-style attacks
need both).
"""

from __future__ import annotations

from app.compression import COMPRESSED_PATHS, SelectiveGZipMiddleware
from app.main import app as main_app
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

BIG = {"coordinates": [[631081.8989, 5534967.5668]] * 2000}


def _client() -> TestClient:
    app = FastAPI()

    @app.get("/api/forestry/snapshots/{snapshot_id}/feature-collection")
    def collection(snapshot_id: int) -> JSONResponse:
        return JSONResponse(BIG)

    @app.get("/api/forestry/reports/{report_id}")
    def report(report_id: int) -> JSONResponse:
        return JSONResponse(BIG)

    @app.get("/api/transelec/pmfs")
    def pmfs() -> JSONResponse:
        return JSONResponse(BIG)

    @app.get("/api/auth/session")
    def session() -> JSONResponse:
        return JSONResponse(BIG)

    app.add_middleware(SelectiveGZipMiddleware, paths=COMPRESSED_PATHS)
    return TestClient(app)


def test_geometry_reads_are_compressed() -> None:
    client = _client()
    for path in (
        "/api/forestry/snapshots/1/feature-collection",
        "/api/forestry/reports/7",
        "/api/transelec/pmfs",
    ):
        response = client.get(path, headers={"Accept-Encoding": "gzip"})
        assert response.headers.get("content-encoding") == "gzip", path
        assert response.json() == BIG


def test_everything_else_is_left_alone() -> None:
    client = _client()
    response = client.get("/api/auth/session", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in response.headers
    # A report export or a sub-path is not the report detail.
    for path in (
        "/api/forestry/reports/7/export",
        "/api/transelec/pmfs/MP001",
        "/api/transelec/export.csv",
    ):
        assert not any(pattern.fullmatch(path) for pattern in COMPRESSED_PATHS), path


def test_main_app_installs_the_selective_gzip() -> None:
    assert any(m.cls is SelectiveGZipMiddleware for m in main_app.user_middleware)
