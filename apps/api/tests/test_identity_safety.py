from __future__ import annotations

import pytest
from app.config import Settings
from app.identity_safety import (
    ProductionIdentityNotConfiguredError,
    require_production_identity_configuration,
)
from cryptography.fernet import Fernet

_FERNET_KEY = Fernet.generate_key().decode("utf-8")


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "_env_file": None,
        "app_env": "production",
        "postgres_password": "x",
    }
    values.update(overrides)
    return Settings(**values)


def _google(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "google_client_id": "1234567890-abcdef.apps.googleusercontent.com",
        "google_client_secret": "fake-google-secret",
        "google_redirect_base_url": "https://portal.example.test/api",
        "platform_token_encryption_key": _FERNET_KEY,
    }
    values.update(overrides)
    return _settings(**values)


def test_allows_production_with_complete_google_configuration() -> None:
    require_production_identity_configuration(_google())  # must not raise


def test_rejects_production_with_no_identity_configuration_at_all() -> None:
    with pytest.raises(ProductionIdentityNotConfiguredError, match="GOOGLE_CLIENT_ID"):
        require_production_identity_configuration(_settings())


@pytest.mark.parametrize("app_env", ["development", "test", "staging"])
def test_allows_incomplete_identity_configuration_outside_production(app_env: str) -> None:
    require_production_identity_configuration(_settings(app_env=app_env))  # must not raise


def test_rejects_a_client_id_without_a_secret() -> None:
    with pytest.raises(ProductionIdentityNotConfiguredError, match="GOOGLE_CLIENT_SECRET"):
        require_production_identity_configuration(_google(google_client_secret=None))


def test_rejects_a_secret_without_a_client_id() -> None:
    with pytest.raises(ProductionIdentityNotConfiguredError, match="GOOGLE_CLIENT_ID"):
        require_production_identity_configuration(_google(google_client_id=None))


def test_rejects_a_missing_token_encryption_key() -> None:
    with pytest.raises(ProductionIdentityNotConfiguredError, match="PLATFORM_TOKEN_ENCRYPTION_KEY"):
        require_production_identity_configuration(_google(platform_token_encryption_key=None))


def test_rejects_a_token_encryption_key_that_is_not_a_fernet_key() -> None:
    with pytest.raises(ProductionIdentityNotConfiguredError, match="not a valid Fernet key"):
        require_production_identity_configuration(
            _google(platform_token_encryption_key="not-a-fernet-key")
        )


@pytest.mark.parametrize(
    "base_url", ["http://localhost:8000", "http://portal.example.test/api", ""]
)
def test_rejects_a_redirect_base_that_is_not_https(base_url: str) -> None:
    with pytest.raises(ProductionIdentityNotConfiguredError, match="GOOGLE_REDIRECT_BASE_URL"):
        require_production_identity_configuration(_google(google_redirect_base_url=base_url))


def test_allows_a_complete_bootstrap_pair() -> None:
    require_production_identity_configuration(
        _google(
            platform_bootstrap_admin_email="admin@campodigital.cl",
            platform_bootstrap_admin_products="transelect",
        )
    )  # must not raise


@pytest.mark.parametrize(
    "overrides",
    [
        {"platform_bootstrap_admin_email": "admin@campodigital.cl"},
        {"platform_bootstrap_admin_products": "transelect"},
    ],
)
def test_rejects_half_of_the_bootstrap_pair(overrides: dict[str, object]) -> None:
    with pytest.raises(ProductionIdentityNotConfiguredError, match="set together"):
        require_production_identity_configuration(_google(**overrides))


def test_the_error_never_echoes_a_configured_secret() -> None:
    with pytest.raises(ProductionIdentityNotConfiguredError) as exc_info:
        require_production_identity_configuration(
            _google(google_client_id=None, platform_token_encryption_key="leaky-value")
        )

    assert "fake-google-secret" not in str(exc_info.value)
    assert "leaky-value" not in str(exc_info.value)
