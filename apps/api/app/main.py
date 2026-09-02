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
from app.routers.csrf import router as csrf_router
from app.routers.ingestion import router as ingestion_router
from app.routers.lidar import router as lidar_router

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

# Always mounted, in every APP_ENV: any environment that can authenticate a
# session must also be able to obtain the CSRF token app.csrf.require_csrf
# demands on every mutation route.
app.include_router(csrf_router)

# Router mounting must not require full DB configuration to resolve (unlike
# app.config.get_settings(), which requires POSTGRES_PASSWORD) — this decision
# is made from APP_ENV alone, straight from the process environment, so that
# importing this module never depends on unrelated database credentials being
# configured. app.dev_auth.assert_dev_auth_allowed still runs per-request
# inside the /auth/dev-login handler as defense in depth.
if APP_ENV == "development":
    from app.routers.dev_auth import router as dev_auth_router

    app.include_router(dev_auth_router)
