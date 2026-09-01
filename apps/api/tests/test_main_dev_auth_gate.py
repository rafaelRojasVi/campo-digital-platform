"""app.main must only mount dev-only auth routes under APP_ENV=development.

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
from app.main import app
paths = app.openapi()["paths"]
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


def test_dev_auth_routes_mounted_without_app_env() -> None:
    output = _run_with_env(None)
    assert "AUTH_MOUNTED=True" in output


def test_dev_auth_routes_mounted_in_development() -> None:
    output = _run_with_env("development")
    assert "AUTH_MOUNTED=True" in output


def test_dev_auth_routes_not_mounted_in_staging() -> None:
    output = _run_with_env("staging")
    assert "AUTH_MOUNTED=False" in output


def test_dev_auth_routes_not_mounted_in_test() -> None:
    output = _run_with_env("test")
    assert "AUTH_MOUNTED=False" in output


def test_dev_auth_routes_not_mounted_in_production() -> None:
    output = _run_with_env("production")
    assert "AUTH_MOUNTED=False" in output
