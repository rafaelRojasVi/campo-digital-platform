"""Fixtures for real PostgreSQL/PostGIS integration tests."""

from __future__ import annotations

import sys
from collections.abc import Generator
from pathlib import Path

import pytest
from sqlalchemy import Engine

API_ROOT = Path(__file__).resolve().parents[1]

if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.config import Settings  # noqa: E402
from app.database import build_engine  # noqa: E402
from app.db_safety import require_test_database  # noqa: E402


@pytest.fixture(scope="session")
def integration_settings() -> Settings:
    """Return configuration only after proving the DB is disposable."""

    settings = Settings()
    require_test_database(settings)
    return settings


@pytest.fixture(scope="session")
def integration_engine(
    integration_settings: Settings,
) -> Generator[Engine, None, None]:
    """Provide a real SQLAlchemy engine for the disposable test DB."""

    engine = build_engine(integration_settings)

    try:
        yield engine
    finally:
        engine.dispose()
