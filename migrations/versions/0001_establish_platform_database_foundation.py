"""Establish platform database foundation.

Revision ID: 0001
Revises:
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Establish required platform-level database capabilities."""

    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE SCHEMA IF NOT EXISTS platform")


def downgrade() -> None:
    """Remove the empty platform schema while preserving PostGIS."""

    op.execute("DROP SCHEMA IF EXISTS platform")
