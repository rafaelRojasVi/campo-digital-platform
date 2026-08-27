"""Safety guard for destructive database test operations."""

from __future__ import annotations

from app.config import Settings


class UnsafeTestDatabaseError(RuntimeError):
    """Configured database is not clearly a dedicated test database."""


def require_test_database(settings: Settings) -> None:
    """Require both test mode and an explicitly test-named database."""

    if settings.app_env != "test":
        raise UnsafeTestDatabaseError(
            f"APP_ENV is {settings.app_env!r}; destructive tests require 'test'."
        )

    database_name = settings.database_url.database

    if not database_name or not database_name.endswith("_test"):
        raise UnsafeTestDatabaseError(
            f"Database {database_name!r} is not a dedicated test database; "
            "expected a name ending in '_test'."
        )
