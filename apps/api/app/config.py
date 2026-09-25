"""Typed application configuration for Campo Digital platform services."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

# The bounded product contexts a product_grant can name
# (docs/platform/product-boundaries.md). `transelect` is the repository path
# spelling, kept as the product key.
PLATFORM_PRODUCT_KEYS = ("lidar", "forestry", "transelect")


def _split_product_keys(value: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(key.strip() for key in value.split(",") if key.strip()))


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

    # Google Workspace sign-in, the platform's identity provider (see
    # app.google_auth and ADR-008).
    google_client_id: str | None = Field(default=None, validation_alias="GOOGLE_CLIENT_ID")
    google_client_secret: SecretStr | None = Field(
        default=None, validation_alias="GOOGLE_CLIENT_SECRET"
    )
    # The origin (plus any path prefix) the browser reaches this API on. The
    # OAuth redirect URI is this value + /auth/google/callback, and must equal
    # what is registered on the Google OAuth client, byte for byte.
    google_redirect_base_url: str = Field(
        default="http://localhost:8000",
        validation_alias="GOOGLE_REDIRECT_BASE_URL",
    )
    # The `hd` claim an id_token must carry, exactly, to be accepted. It is
    # the Workspace membership control -- not the email's suffix.
    google_workspace_domain: str = Field(
        default="campodigital.cl",
        validation_alias="GOOGLE_WORKSPACE_DOMAIN",
    )

    # One-time bootstrap for Google sign-in: the single Workspace address that
    # receives ADMIN on the listed products at its first sign-in (see
    # app.access_repository.maybe_grant_google_bootstrap_admin). Both unset
    # (the default) grants nothing automatically.
    platform_bootstrap_admin_email: str | None = Field(
        default=None, validation_alias="PLATFORM_BOOTSTRAP_ADMIN_EMAIL"
    )
    platform_bootstrap_admin_products: str | None = Field(
        default=None, validation_alias="PLATFORM_BOOTSTRAP_ADMIN_PRODUCTS"
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

    @field_validator("platform_bootstrap_admin_products")
    @classmethod
    def _known_bootstrap_products(cls, value: str | None) -> str | None:
        if value is None:
            return None
        unknown = [key for key in _split_product_keys(value) if key not in PLATFORM_PRODUCT_KEYS]
        if unknown:
            raise ValueError(
                f"PLATFORM_BOOTSTRAP_ADMIN_PRODUCTS names unknown products {unknown}; "
                f"expected a comma-separated subset of {list(PLATFORM_PRODUCT_KEYS)}."
            )
        return value

    @property
    def bootstrap_admin_product_keys(self) -> tuple[str, ...]:
        """The validated product keys the Google bootstrap admin receives ADMIN on."""

        if self.platform_bootstrap_admin_products is None:
            return ()
        return _split_product_keys(self.platform_bootstrap_admin_products)

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
