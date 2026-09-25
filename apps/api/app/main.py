"""FastAPI composition root for Campo Digital platform services."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import Engine

from app.config import get_settings
from app.database import (
    DatabaseUnavailableError,
    check_database_connection,
    get_database_engine,
)
from app.deps import get_object_store
from app.execution import ExecutionBackend, InProcessStagingExecutionBackend
from app.google_auth import GoogleNotConfiguredError
from app.identity_safety import require_production_identity_configuration
from app.routers.google_auth import router as google_auth_router
from app.routers.ingestion import router as ingestion_router
from app.routers.lidar import router as lidar_router
from app.routers.session import router as session_router

_execution_backend: ExecutionBackend | None = None

_SUPPORTED_APP_ENVS = ("development", "test", "staging", "production")


def _resolve_app_env() -> str:
    """Read and strictly validate APP_ENV from the raw process environment.

    Mirrors ``Settings.app_env``'s allowed values without requiring the full
    ``Settings`` model (and its database credentials) to resolve, so this
    module can decide dev-auth mounting and lifespan behavior at import time.
    Security-sensitive environment selection must fail closed: an unset or
    unrecognized value is rejected rather than silently defaulting to
    development, which would otherwise mount dev-only authentication.
    """

    value = os.environ.get("APP_ENV")
    if value not in _SUPPORTED_APP_ENVS:
        raise RuntimeError(
            f"APP_ENV must be explicitly set to one of {_SUPPORTED_APP_ENVS}; got {value!r}."
        )
    return value


APP_ENV = _resolve_app_env()


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start the staging-only in-process execution backend, if applicable."""

    # Gated on APP_ENV alone: get_settings() needs full DB credentials to
    # resolve, and every other environment's lifespan must stay startable
    # without them (see test_lidar_api.py's DB-free TestClient fixture).
    if APP_ENV == "production":
        require_production_identity_configuration(get_settings())

    global _execution_backend
    if APP_ENV == "staging":
        _execution_backend = InProcessStagingExecutionBackend(
            get_database_engine(), get_object_store(), get_settings()
        )
        await _execution_backend.start()

    try:
        yield
    finally:
        if _execution_backend is not None:
            await _execution_backend.stop()


app = FastAPI(
    title="Campo Digital LiDAR API",
    version="0.2.0",
    lifespan=_lifespan,
)


@app.exception_handler(GoogleNotConfiguredError)
async def _google_not_configured(request: object, exc: GoogleNotConfiguredError) -> JSONResponse:
    """An unconfigured Google sign-in is an intentionally unavailable state
    (missing GOOGLE_CLIENT_ID/SECRET), not a server error."""

    del request, exc
    return JSONResponse(status_code=503, content={"detail": "Google sign-in is not configured."})


@app.get("/health")
def health() -> dict[str, str]:
    """Process liveness probe with no external dependencies."""

    return {"status": "ok"}


@app.get("/ready")
def readiness(
    engine: Annotated[Engine, Depends(get_database_engine)],
) -> JSONResponse:
    """Dependency readiness probe for the platform database."""

    try:
        check_database_connection(engine)
    except DatabaseUnavailableError:
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready"},
        )

    return JSONResponse(
        status_code=200,
        content={"status": "ready"},
    )


app.include_router(lidar_router)
app.include_router(ingestion_router)

# Always mounted, in every APP_ENV: Google Workspace is the platform's real
# identity provider (ADR-008), and each route 503s rather than 404ing when
# GOOGLE_CLIENT_ID/SECRET are unset. Inspecting (`/me`) or ending
# (`/logout`) a session applies uniformly regardless of which provider
# created it, so the session router is mounted everywhere too.
app.include_router(google_auth_router)
app.include_router(session_router)

# Router mounting must not require full DB configuration to resolve (unlike
# app.config.get_settings(), which requires POSTGRES_PASSWORD) — this decision
# is made from APP_ENV alone, straight from the process environment, so that
# importing this module never depends on unrelated database credentials being
# configured. app.dev_auth.assert_dev_auth_allowed still runs per-request
# inside the /auth/dev-login handler as defense in depth.
if APP_ENV == "development":
    from app.routers.dev_auth import router as dev_auth_router

    app.include_router(dev_auth_router)
