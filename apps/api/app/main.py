"""FastAPI composition root for Campo Digital platform services."""

from __future__ import annotations

from fastapi import FastAPI

from app.routers.lidar import router as lidar_router

app = FastAPI(
    title="Campo Digital LiDAR API",
    version="0.2.0",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(lidar_router)
