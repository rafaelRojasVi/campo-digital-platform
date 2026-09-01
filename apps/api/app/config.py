"""Typed application configuration for Campo Digital platform services."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    app_env: Literal["development", "test", "staging", "production"] = Field(
        default="development",
        validation_alias="APP_ENV",
    )

    postgres_db: str = Field(
        default="campo_digital",
        validation_alias="POSTGRES_DB",
    )
    postgres_user: str = Field(
        default="campo_digital",
        validation_alias="POSTGRES_USER",
    )
    postgres_password: SecretStr = Field(
        validation_alias="POSTGRES_PASSWORD",
    )
    postgres_host: str = Field(
        default="127.0.0.1",
        validation_alias="POSTGRES_HOST",
    )
    postgres_port: int = Field(
        default=5432,
        validation_alias="POSTGRES_PORT",
        ge=1,
        le=65535,
    )

    @property
    def database_url(self) -> URL:
        """Build the SQLAlchemy PostgreSQL URL without manual string assembly."""

        return URL.create(
            drivername="postgresql+psycopg",
            username=self.postgres_user,
            password=self.postgres_password.get_secret_value(),
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        )


@lru_cache
def get_settings() -> Settings:
    """Return process-level application settings."""

    # BaseSettings resolves required values from runtime sources that mypy
    # cannot infer from the generated constructor signature.
    return Settings()  # type: ignore[call-arg]
