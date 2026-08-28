from __future__ import annotations

from pathlib import Path

from app.config import Settings
from pytest import MonkeyPatch


def test_settings_use_local_platform_defaults() -> None:
    settings = Settings(
        _env_file=None,
        postgres_password="local-test-secret",
    )

    assert settings.app_env == "development"
    assert settings.postgres_db == "campo_digital"
    assert settings.postgres_user == "campo_digital"
    assert settings.postgres_host == "127.0.0.1"
    assert settings.postgres_port == 5432


def test_settings_build_psycopg_sqlalchemy_url() -> None:
    settings = Settings(
        _env_file=None,
        postgres_db="test_database",
        postgres_user="test_user",
        postgres_password="p@ss:/?#[]",
        postgres_host="db.internal",
        postgres_port=6543,
    )

    url = settings.database_url

    assert url.drivername == "postgresql+psycopg"
    assert url.username == "test_user"
    assert url.password == "p@ss:/?#[]"
    assert url.host == "db.internal"
    assert url.port == 6543
    assert url.database == "test_database"
    assert "p@ss:/?#[]" not in str(url)


def test_settings_load_postgres_values_from_env_file(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    for key in (
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_HOST",
        "POSTGRES_PORT",
    ):
        monkeypatch.delenv(key, raising=False)

    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "POSTGRES_DB=fixture_database",
                "POSTGRES_USER=fixture_user",
                "POSTGRES_PASSWORD=fixture_secret",
                "POSTGRES_HOST=fixture-db",
                "POSTGRES_PORT=5544",
                "",
            ]
        ),
        encoding="utf-8",
    )

    settings = Settings(_env_file=env_file)

    assert settings.postgres_db == "fixture_database"
    assert settings.postgres_user == "fixture_user"
    assert settings.postgres_password.get_secret_value() == "fixture_secret"
    assert settings.postgres_host == "fixture-db"
    assert settings.postgres_port == 5544


def test_settings_build_unix_socket_url_when_configured() -> None:
    settings = Settings(
        _env_file=None,
        postgres_db="test_database",
        postgres_user="test_user",
        postgres_password="p@ss:/?#[]",
        postgres_unix_socket_path="/cloudsql/project:region:instance",
    )

    url = settings.database_url

    assert url.drivername == "postgresql+psycopg"
    assert url.host is None
    assert url.database == "test_database"
    assert url.query["host"] == "/cloudsql/project:region:instance"


def test_settings_repr_does_not_expose_password() -> None:
    secret = "must-not-appear"

    settings = Settings(
        _env_file=None,
        postgres_password=secret,
    )

    assert secret not in repr(settings)
