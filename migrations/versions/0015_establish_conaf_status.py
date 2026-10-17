"""Establish CONAF solicitud status (Estado CONAF).

Revision ID: 0015
Revises: 0014

The platform reads CONAF's public consulta page for the solicitudes that
Transelec and Rodales know (spec
``docs/superpowers/specs/2026-10-16-conaf-estado-design.md``).

Expand-only:

- ``platform.conaf_solicitud``: the last result per number. ``found`` data
  is kept when a later read is ``unavailable``, ``not_found`` or
  ``mismatch``.
- ``platform.conaf_cambio``: one row per observed change of ``estado``.
- ``platform.conaf_run``: one row per nightly refresh, for the Consola.
- ``forestry.report.conaf_solicitud``: a report's CONAF number.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NUMERO = "^[0-9]{6,9}$"


def upgrade() -> None:
    """Create the CONAF tables and the report column."""

    op.create_table(
        "conaf_solicitud",
        sa.Column("numero", sa.Text(), nullable=False),
        sa.Column("lookup_status", sa.Text(), nullable=False),
        sa.Column("tipo", sa.Text(), nullable=True),
        sa.Column("estado", sa.Text(), nullable=True),
        sa.Column("superficie_ha", sa.Numeric(14, 4), nullable=True),
        sa.Column("fecha_ingreso", sa.Date(), nullable=True),
        sa.Column("fecha_resolucion", sa.Date(), nullable=True),
        sa.Column("returned_solicitud", sa.Text(), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("found_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("estado_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(f"numero ~ '{NUMERO}'", name="ck_conaf_solicitud_numero"),
        sa.CheckConstraint(
            "lookup_status IN ('found', 'not_found', 'mismatch', 'unavailable')",
            name="ck_conaf_solicitud_lookup_status",
        ),
        sa.PrimaryKeyConstraint("numero", name="pk_conaf_solicitud"),
        schema="platform",
    )
    op.create_table(
        "conaf_cambio",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("numero", sa.Text(), nullable=False),
        sa.Column("estado_anterior", sa.Text(), nullable=True),
        sa.Column("estado_nuevo", sa.Text(), nullable=False),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["numero"],
            ["platform.conaf_solicitud.numero"],
            name="fk_conaf_cambio_numero",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_conaf_cambio"),
        schema="platform",
    )
    op.create_index(
        "ix_conaf_cambio_observed_at", "conaf_cambio", ["observed_at"], schema="platform"
    )
    op.create_table(
        "conaf_run",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("checked", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("found", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("not_found", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("mismatch", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("unavailable", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("changed", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("stopped_reason", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "stopped_reason IS NULL "
            "OR stopped_reason IN ('conaf_unavailable', 'limit', 'shutdown')",
            name="ck_conaf_run_stopped_reason",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_conaf_run"),
        schema="platform",
    )
    op.add_column(
        "report", sa.Column("conaf_solicitud", sa.Text(), nullable=True), schema="forestry"
    )
    op.create_check_constraint(
        "ck_report_conaf_solicitud",
        "report",
        f"conaf_solicitud IS NULL OR conaf_solicitud ~ '{NUMERO}'",
        schema="forestry",
    )


def downgrade() -> None:
    """Drop the CONAF tables and the report column."""

    op.drop_constraint("ck_report_conaf_solicitud", "report", schema="forestry", type_="check")
    op.drop_column("report", "conaf_solicitud", schema="forestry")
    op.drop_table("conaf_run", schema="platform")
    op.drop_table("conaf_cambio", schema="platform")
    op.drop_table("conaf_solicitud", schema="platform")
