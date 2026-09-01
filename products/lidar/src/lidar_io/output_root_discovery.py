"""Automatic local discovery of the LiDAR measurement report store.

``products/lidar/reports/out`` is gitignored, per-worktree local state (see
``.gitignore``): it is populated by whatever local pipeline runs happened to
write there, and a fresh worktree checkout starts with none of it. Local
Campo Digital demos should not require a developer to know and export an
absolute filesystem path by hand, so this module looks across the developer's
own local git worktrees for one that already holds API-visible measurement
runs.

This module never copies, moves, symlinks, or modifies report data. It only
reads directory listings to decide which existing directory to point the API
at.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from lidar_io.run_store import discover_measurement_paths

REPORTS_RELATIVE_PATH = Path("products/lidar/reports/out")

SOURCE_ENV = "env"
SOURCE_CURRENT_WORKTREE = "current-worktree"
SOURCE_DISCOVERED_WORKTREE = "discovered-worktree"
SOURCE_NONE = "none"


@dataclass(frozen=True, slots=True)
class ReportRootResolution:
    path: Path
    source: str  # one of the SOURCE_* constants above


def parse_worktree_paths(porcelain_text: str) -> list[Path]:
    """Parses ``git worktree list --porcelain`` output into worktree paths.

    Pure function: takes text, returns data, so it is directly testable
    without invoking git.
    """

    paths: list[Path] = []

    for line in porcelain_text.splitlines():
        if line.startswith("worktree "):
            paths.append(Path(line[len("worktree ") :].strip()))

    return paths


def discover_worktree_paths(repo_root: Path) -> list[Path]:
    """Lists local git worktree roots. Read-only: never modifies any of them."""

    result = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        return [repo_root]

    return parse_worktree_paths(result.stdout)


def has_visible_measurements(candidate: Path) -> bool:
    """True if ``candidate`` contains at least one API-visible measurement run."""

    return len(discover_measurement_paths(candidate)) > 0


def resolve_report_root(
    repo_root: Path,
    *,
    env_value: str | None,
    worktree_paths: list[Path] | None = None,
) -> ReportRootResolution:
    """Resolves the LiDAR report-output root to use for this local demo.

    Precedence:

    1. An explicit ``env_value`` (``CAMPO_LIDAR_OUTPUT_ROOT``) always wins,
       even if it turns out to be empty or missing.
    2. The current worktree's own ``products/lidar/reports/out``, if it
       already contains at least one API-visible run.
    3. The first other local git worktree whose ``products/lidar/reports/out``
       contains at least one API-visible run.
    4. Otherwise, the current worktree's (possibly empty/missing)
       ``products/lidar/reports/out``, so the API keeps its legitimate empty
       state instead of erroring.
    """

    if env_value:
        return ReportRootResolution(Path(env_value), SOURCE_ENV)

    current_candidate = repo_root / REPORTS_RELATIVE_PATH

    if has_visible_measurements(current_candidate):
        return ReportRootResolution(current_candidate, SOURCE_CURRENT_WORKTREE)

    if worktree_paths is None:
        worktree_paths = discover_worktree_paths(repo_root)

    for worktree_path in worktree_paths:
        candidate = worktree_path / REPORTS_RELATIVE_PATH

        if candidate == current_candidate:
            continue

        if has_visible_measurements(candidate):
            return ReportRootResolution(candidate, SOURCE_DISCOVERED_WORKTREE)

    return ReportRootResolution(current_candidate, SOURCE_NONE)
