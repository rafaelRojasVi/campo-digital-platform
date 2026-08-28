"""Serve the built Transelec dashboard from the same-origin FastAPI service.

The hosted pilot is one Cloud Run service: FastAPI serves both the JSON API
(under `/api/transelec` and `/transelec`) and the React production build, so
there is no separate frontend origin or CORS surface to secure. Local
development is unaffected: the dashboard normally runs via its own Vite dev
server (see `products/transelect/dashboard/README.md`), and this module is a
no-op whenever no built `dist/` directory is present.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

DEFAULT_DIST_DIR = (
    Path(__file__).resolve().parents[3] / "products" / "transelect" / "dashboard" / "dist"
)

_RESERVED_PREFIXES = ("api/", "transelec/")
_RESERVED_PATHS = frozenset({"health", "ready"})


def _dist_dir_from_environment() -> Path | None:
    configured = os.environ.get("CAMPO_TRANSELEC_DASHBOARD_DIST", "").strip()
    candidate = Path(configured) if configured else DEFAULT_DIST_DIR
    return candidate if (candidate / "index.html").is_file() else None


def _resolve_within(dist_dir: Path, relative_path: str) -> Path | None:
    candidate = (dist_dir / relative_path).resolve()

    if candidate != dist_dir and dist_dir not in candidate.parents:
        return None

    return candidate


def mount_dashboard(app: FastAPI) -> None:
    """Mount the built React dashboard, if present, as the same-origin UI."""

    dist_dir = _dist_dir_from_environment()

    if dist_dir is None:
        return

    assets_dir = dist_dir / "assets"

    if assets_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=assets_dir),
            name="transelec-dashboard-assets",
        )

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_dashboard(full_path: str) -> FileResponse:
        """SPA fallback: serve a build file if it exists, else index.html."""

        if full_path in _RESERVED_PATHS or full_path.startswith(_RESERVED_PREFIXES):
            raise HTTPException(status_code=404)

        if not full_path:
            return FileResponse(dist_dir / "index.html")

        candidate = _resolve_within(dist_dir, full_path)

        if candidate is None:
            raise HTTPException(status_code=404)

        if candidate.is_file():
            return FileResponse(candidate)

        return FileResponse(dist_dir / "index.html")
