from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from app.migration_graph import inspect_migration_graph


def test_repository_has_one_migration_base_and_one_head() -> None:
    root = Path(__file__).resolve().parents[3]
    config = Config(str(root / "alembic.ini"))
    script = ScriptDirectory.from_config(config)

    graph = inspect_migration_graph(script)

    assert len(graph.bases) == 1
    assert len(graph.heads) == 1
    assert graph.has_single_base_and_head
