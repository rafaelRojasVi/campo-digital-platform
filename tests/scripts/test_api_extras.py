"""Local launchers run the API with the same extras as the production image.

``app.main`` imports every product's code (the Transelec inspector needs
``python_calamine`` from the ``transelec`` extra), so a launcher that syncs
only ``--extra api`` crashes on import. The Dockerfile is the reference.
"""

from __future__ import annotations

import re
from pathlib import Path

from scripts._local_process import API_UV_EXTRAS, uv_run_api

REPO_ROOT = Path(__file__).resolve().parents[2]
LAUNCHERS = ("forestry_dev.py", "lidar_dev.py", "transelec_dev.py")


def _dockerfile_extras() -> tuple[str, ...]:
    dockerfile = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
    sync = next(line for line in dockerfile.splitlines() if "uv sync" in line)
    return tuple(re.findall(r"--extra (\S+)", sync))


def test_api_extras_match_the_production_image() -> None:
    assert _dockerfile_extras() == API_UV_EXTRAS


def test_uv_run_api_passes_every_extra() -> None:
    assert uv_run_api("alembic", "upgrade", "head") == [
        "uv",
        "run",
        "--extra",
        "api",
        "--extra",
        "transelec",
        "alembic",
        "upgrade",
        "head",
    ]


def test_launchers_do_not_hard_code_api_extras() -> None:
    for name in LAUNCHERS:
        source = (REPO_ROOT / "scripts" / name).read_text(encoding="utf-8")
        assert '"--extra", "api"' not in source, name
