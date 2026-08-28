"""FastAPI composition root for Campo Digital platform services."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import Engine

from app.database import (
    DatabaseUnavailableError,
    check_database_connection,
    get_database_engine,
)
from app.routers.lidar import router as lidar_router
from app.routers.transelec import router as transelec_router

app = FastAPI(
    title="Campo Digital API",
    version="0.2.0",
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
app.include_router(transelec_router)
