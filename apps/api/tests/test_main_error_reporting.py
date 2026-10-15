"""``app.main`` starts Sentry only when ``SENTRY_DSN`` is set.

Runs ``app.main`` in a subprocess because it reads its environment at import
time. A placeholder DSN is enough: nothing is sent unless an error is captured.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]

_CHECK_SCRIPT = """
import json, sys
sys.path.insert(0, {api_root!r})
import sentry_sdk
import app.main
client = sentry_sdk.get_client()
print(json.dumps({{
    "active": client.is_active(),
    "environment": client.options.get("environment"),
    "release": client.options.get("release"),
}}))
"""


def _client_state(extra_env: dict[str, str]) -> dict[str, object]:
    result = subprocess.run(
        [sys.executable, "-c", _CHECK_SCRIPT.format(api_root=str(API_ROOT))],
        capture_output=True,
        text=True,
        env={"PATH": "/usr/bin:/bin", "APP_ENV": "test", **extra_env},
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


def test_error_reporting_stays_off_without_dsn() -> None:
    assert _client_state({})["active"] is False


def test_error_reporting_starts_with_dsn_and_tags_the_release() -> None:
    state = _client_state(
        {
            "SENTRY_DSN": "https://publickey@o1.ingest.sentry.io/1",
            "RAILWAY_GIT_COMMIT_SHA": "e21cdb6",
        }
    )

    assert state == {"active": True, "environment": "test", "release": "e21cdb6"}
