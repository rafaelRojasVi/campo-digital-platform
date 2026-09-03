from __future__ import annotations

import pytest
from app.config import Settings
from app.identity_safety import (
    ProductionIdentityNotConfiguredError,
    require_production_identity_configuration,
)


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "_env_file": None,
        "app_env": "production",
        "postgres_password": "x",
    }
    values.update(overrides)
    return Settings(**values)


def test_rejects_production_with_no_identity_configuration_at_all() -> None:
    with pytest.raises(ProductionIdentityNotConfiguredError):
        require_production_identity_configuration(_settings())


def test_rejects_production_missing_only_the_token_encryption_key() -> None:
    settings = _settings(
        entra_client_id="11111111-1111-1111-1111-111111111111",
        entra_client_secret="fake-secret",
    )

    with pytest.raises(ProductionIdentityNotConfiguredError):
        require_production_identity_configuration(settings)


def test_allows_production_with_full_identity_configuration() -> None:
    settings = _settings(
        entra_client_id="11111111-1111-1111-1111-111111111111",
        entra_client_secret="fake-secret",
        platform_token_encryption_key="fake-key",
    )

    require_production_identity_configuration(settings)  # must not raise


@pytest.mark.parametrize("app_env", ["development", "test", "staging"])
def test_allows_incomplete_identity_configuration_outside_production(app_env: str) -> None:
    require_production_identity_configuration(_settings(app_env=app_env))  # must not raise
