"""Tests that the LiDAR API's output-root dependency delegates to automatic
local report-store discovery, instead of hard-coding a path or an env
fallback inline.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.routers import lidar as lidar_router  # noqa: E402

from lidar_io.output_root_discovery import (  # noqa: E402
    SOURCE_DISCOVERED_WORKTREE,
    ReportRootResolution,
)


def test_get_output_root_delegates_to_resolve_report_root(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    captured: dict[str, object] = {}

    def fake_resolve_report_root(
        repo_root: Path,
        *,
        env_value: str | None,
        worktree_paths: list[Path] | None = None,
    ) -> ReportRootResolution:
        captured["repo_root"] = repo_root
        captured["env_value"] = env_value
        return ReportRootResolution(
            tmp_path / "resolved",
            SOURCE_DISCOVERED_WORKTREE,
        )

    monkeypatch.setattr(lidar_router, "resolve_report_root", fake_resolve_report_root)
    monkeypatch.delenv("CAMPO_LIDAR_OUTPUT_ROOT", raising=False)

    result = lidar_router.get_output_root()

    assert result == tmp_path / "resolved"
    assert captured["repo_root"] == lidar_router.REPO_ROOT
    assert captured["env_value"] is None


def test_get_output_root_passes_through_explicit_env_value(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    explicit = tmp_path / "explicit-does-not-need-to-exist"
    monkeypatch.setenv("CAMPO_LIDAR_OUTPUT_ROOT", str(explicit))

    result = lidar_router.get_output_root()

    assert result == explicit


def test_repo_root_points_at_the_actual_repository_root() -> None:
    assert (lidar_router.REPO_ROOT / "products" / "lidar").is_dir()
    assert (lidar_router.REPO_ROOT / "apps" / "api").is_dir()
