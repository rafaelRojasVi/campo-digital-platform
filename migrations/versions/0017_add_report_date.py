"""Add exact date to Rodales management reports (informes de manejo).

Revision ID: 0017
Revises: 0016

DECISION (2026-10-19): Javier (Campo Digital) confirmed that reports need the
exact day, not just the month. ``report_date DATE`` is added alongside the
existing ``report_month TEXT``. Existing rows keep ``report_date`` NULL; new
reports supply it and the server derives ``report_month`` from it.

The consistency constraint ensures the two columns never diverge:
``report_date IS NULL OR report_month = to_char(report_date, 'YYYY-MM')``.

Downgrade drops the constraint and the column. Nothing else is touched.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CHECK = "report_date IS NULL OR report_month = to_char(report_date, 'YYYY-MM')"


def upgrade() -> None:
    """Add report_date and the consistency constraint."""

    op.add_column(
        "report",
        sa.Column("report_date", sa.Date(), nullable=True),
        schema="forestry",
    )
    op.create_check_constraint(
        "ck_report_date_consistent",
        "report",
        _CHECK,
        schema="forestry",
    )


def downgrade() -> None:
    """Remove the constraint and the column."""

    op.drop_constraint("ck_report_date_consistent", "report", schema="forestry", type_="check")
    op.drop_column("report", "report_date", schema="forestry")
