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
from app.routers.ingestion import router as ingestion_router
from app.routers.lidar import router as lidar_router

_execution_backend: ExecutionBackend | None = None


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start the staging-only in-process execution backend, if applicable.

    Gated on the raw process environment, exactly like the dev-auth router
    mount below, so importing this module — and running it in any
    non-staging environment — never requires database credentials to
    resolve just to decide this.
    """

    global _execution_backend
    if os.environ.get("APP_ENV", "development") == "staging":
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

# Router mounting must not require full DB configuration to resolve (unlike
# app.config.get_settings(), which requires POSTGRES_PASSWORD) — this decision
# is made from APP_ENV alone, straight from the process environment, so that
# importing this module never depends on unrelated database credentials being
# configured. app.dev_auth.assert_dev_auth_allowed still runs per-request
# inside the /auth/dev-login handler as defense in depth.
if os.environ.get("APP_ENV", "development") == "development":
    from app.routers.dev_auth import router as dev_auth_router

    app.include_router(dev_auth_router)
