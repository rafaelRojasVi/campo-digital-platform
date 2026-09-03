"""app.main must expose the Transelec dashboard's real read/write routes and
the CSRF token route under both their bare path and a `/api`-prefixed alias
of the exact same router objects — the same-origin convention the built
dashboard bundle already compiles against (see
products/transelect/dashboard/src/api.ts) and the one a single production
container must provide itself once it also serves that dashboard's static
build (see app.dashboard_static, mounted at the end of app.main).

This intentionally checks route *presence*, not behavior: RBAC/session
behavior for these routes is already covered by
apps/api/integration_tests/test_transelec_reads_router.py and
apps/api/tests/test_csrf.py. Mounting the same router object twice must not
duplicate or alter that behavior — only make it reachable at a second path.
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
print("SUMMARY_BARE=" + str("/transelec/summary" in paths))
print("SUMMARY_API=" + str("/api/transelec/summary" in paths))
print("CSRF_BARE=" + str("/auth/csrf" in paths))
print("CSRF_API=" + str("/api/auth/csrf" in paths))
print("ME_API=" + str("/api/auth/me" in paths))
"""


def _run_with_env(app_env: str) -> str:
    result = subprocess.run(
        [sys.executable, "-c", _CHECK_SCRIPT.format(api_root=str(API_ROOT))],
        cwd=API_ROOT.parent.parent,
        env={"PATH": "/usr/bin:/bin", "APP_ENV": app_env},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_transelec_and_csrf_routes_are_mounted_at_both_prefixes_in_every_env() -> None:
    for app_env in ("development", "test", "staging", "production"):
        output = _run_with_env(app_env)
        assert "SUMMARY_BARE=True" in output, app_env
        assert "SUMMARY_API=True" in output, app_env
        assert "CSRF_BARE=True" in output, app_env
        assert "CSRF_API=True" in output, app_env


def test_dev_only_me_route_is_aliased_under_api_only_in_development() -> None:
    output = _run_with_env("development")
    assert "ME_API=True" in output

    for app_env in ("test", "staging", "production"):
        output = _run_with_env(app_env)
        assert "ME_API=False" in output, app_env
