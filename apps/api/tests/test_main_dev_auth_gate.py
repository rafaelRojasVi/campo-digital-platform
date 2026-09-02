"""app.main must only mount dev-only auth routes under APP_ENV=development,
and must fail closed — never fall back to mounting dev auth — when APP_ENV
is unset or set to a value outside the supported set.

Also guards against a regression where mounting the router required full
database settings (POSTGRES_PASSWORD) to resolve just to decide routing —
that would break importing app.main in any environment without DB
credentials configured, not just gate dev auth.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]

_CHECK_SCRIPT = """
import sys
sys.path.insert(0, {api_root!r})
try:
    from app.main import app
except Exception as exc:
    print("IMPORT_FAILED=True")
    print("IMPORT_ERROR=" + str(exc))
else:
    paths = app.openapi()["paths"]
    print("IMPORT_FAILED=False")
    print("AUTH_MOUNTED=" + str(any("/auth" in p for p in paths)))
"""


def _run_with_env(app_env: str | None) -> str:
    env: dict[str, str] = {"PATH": "/usr/bin:/bin"}
    if app_env is not None:
        env["APP_ENV"] = app_env

    result = subprocess.run(
        [sys.executable, "-c", _CHECK_SCRIPT.format(api_root=str(API_ROOT))],
        cwd=API_ROOT.parent.parent,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_dev_auth_routes_mounted_in_development() -> None:
    output = _run_with_env("development")
    assert "IMPORT_FAILED=False" in output
    assert "AUTH_MOUNTED=True" in output


def test_dev_auth_routes_not_mounted_in_staging() -> None:
    output = _run_with_env("staging")
    assert "IMPORT_FAILED=False" in output
    assert "AUTH_MOUNTED=False" in output


def test_dev_auth_routes_not_mounted_in_test() -> None:
    output = _run_with_env("test")
    assert "IMPORT_FAILED=False" in output
    assert "AUTH_MOUNTED=False" in output


def test_dev_auth_routes_not_mounted_in_production() -> None:
    output = _run_with_env("production")
    assert "IMPORT_FAILED=False" in output
    assert "AUTH_MOUNTED=False" in output


def test_app_fails_closed_when_app_env_is_unset() -> None:
    """An unset APP_ENV must never fall back to mounting dev auth — the app
    must fail to start instead."""

    output = _run_with_env(None)
    assert "IMPORT_FAILED=True" in output


def test_app_rejects_invalid_app_env() -> None:
    output = _run_with_env("staging-typo")
    assert "IMPORT_FAILED=True" in output
