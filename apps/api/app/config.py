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

    entra_tenant_id: str | None = Field(default=None, validation_alias="ENTRA_TENANT_ID")
    entra_client_id: str | None = Field(default=None, validation_alias="ENTRA_CLIENT_ID")
    entra_client_secret: SecretStr | None = Field(
        default=None, validation_alias="ENTRA_CLIENT_SECRET"
    )
    entra_redirect_base_url: str = Field(
        default="http://localhost:8000",
        validation_alias="ENTRA_REDIRECT_BASE_URL",
    )

    platform_token_encryption_key: SecretStr | None = Field(
        default=None, validation_alias="PLATFORM_TOKEN_ENCRYPTION_KEY"
    )

    platform_bootstrap_admin_tenant_id: str | None = Field(
        default=None, validation_alias="PLATFORM_BOOTSTRAP_ADMIN_TENANT_ID"
    )
    platform_bootstrap_admin_object_id: str | None = Field(
        default=None, validation_alias="PLATFORM_BOOTSTRAP_ADMIN_OBJECT_ID"
    )

    enable_onedrive_import: bool = Field(default=False, validation_alias="ENABLE_ONEDRIVE_IMPORT")
    staging_execution_max_bytes: int = Field(
        default=25 * 1024 * 1024,
        validation_alias="STAGING_EXECUTION_MAX_BYTES",
        gt=0,
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
