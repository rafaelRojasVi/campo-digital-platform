"""Alembic migration graph invariants."""

from __future__ import annotations

from dataclasses import dataclass

from alembic.script import ScriptDirectory


@dataclass(frozen=True, slots=True)
class MigrationGraph:
    """Relevant structural properties of the Alembic revision graph."""

    bases: tuple[str, ...]
    heads: tuple[str, ...]

    @property
    def has_single_base_and_head(self) -> bool:
        return len(self.bases) == 1 and len(self.heads) == 1


def inspect_migration_graph(script: ScriptDirectory) -> MigrationGraph:
    """Inspect the migration roots and heads without touching a database."""

    return MigrationGraph(
        bases=tuple(script.get_bases()),
        heads=tuple(script.get_heads()),
    )
