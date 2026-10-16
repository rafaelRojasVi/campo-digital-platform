"""Establish Rodales management reports (informes de manejo).

Revision ID: 0014
Revises: 0013

A management report is a named, reviewable set of polygon copies taken from
one published Forestry base snapshot (spec
``docs/superpowers/specs/2026-10-16-rodales-informes-de-manejo-design.md``).
It never changes what the dashboard serves.

Expand-only:

- ``forestry.report``: header, status, the base snapshot it started from,
  and an optimistic-lock ``revision`` bumped on every change.
- ``forestry.report_note``: append-only review notes; a change request
  always has text.
- ``forestry.report_feature``: the report's own copies. ``attributes`` uses
  the source contract's lineage keys (as ``source_feature.source_attributes``);
  ``source_feature_ordinal`` names the polygon in the report's base.

Nothing existing is altered, so the previous application revision keeps
working against this schema.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REPORT_TYPES = ("cosecha", "manejo", "reforestacion", "plantacion", "otro")
REPORT_STATUSES = ("borrador", "enviado", "aprobado", "cambios_solicitados", "archivado")
NOTE_KINDS = ("cambios_solicitados", "aprobado")


def _one_of(column: str, values: Sequence[str]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _timestamp(name: str, *, nullable: bool = False) -> sa.Column[object]:
    if nullable:
        return sa.Column(name, sa.DateTime(timezone=True), nullable=True)
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=sa.text("CURRENT_TIMESTAMP"),
        nullable=False,
    )


def upgrade() -> None:
    """Create the report, note and feature tables."""

    op.create_table(
        "report",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("report_type", sa.Text(), nullable=False),
        sa.Column("report_month", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'borrador'"), nullable=False),
        sa.Column("base_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_by_app_user_id", sa.BigInteger(), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        _timestamp("submitted_at", nullable=True),
        _timestamp("decided_at", nullable=True),
        sa.Column("decided_by_app_user_id", sa.BigInteger(), nullable=True),
        sa.CheckConstraint("btrim(name) <> '' AND char_length(name) <= 120", name="ck_report_name"),
        sa.CheckConstraint(_one_of("report_type", REPORT_TYPES), name="ck_report_type"),
        sa.CheckConstraint("report_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'", name="ck_report_month"),
        sa.CheckConstraint(_one_of("status", REPORT_STATUSES), name="ck_report_status"),
        sa.CheckConstraint("revision >= 1", name="ck_report_revision_positive"),
        sa.ForeignKeyConstraint(
            ["base_snapshot_id"],
            ["forestry.shapefile_snapshot.id"],
            name="fk_report_base_snapshot_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_app_user_id"],
            ["platform.app_user.id"],
            name="fk_report_created_by_app_user_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["decided_by_app_user_id"],
            ["platform.app_user.id"],
            name="fk_report_decided_by_app_user_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_report"),
        schema="forestry",
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_report_active_name ON forestry.report (lower(name)) "
        "WHERE status <> 'archivado'"
    )
    op.create_index("ix_report_status", "report", ["status"], schema="forestry")

    op.create_table(
        "report_note",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("report_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("author_app_user_id", sa.BigInteger(), nullable=False),
        _timestamp("created_at"),
        sa.CheckConstraint(_one_of("kind", NOTE_KINDS), name="ck_report_note_kind"),
        sa.CheckConstraint("char_length(body) <= 2000", name="ck_report_note_body_length"),
        sa.CheckConstraint(
            "kind <> 'cambios_solicitados' OR btrim(body) <> ''",
            name="ck_report_note_change_request_has_text",
        ),
        sa.ForeignKeyConstraint(
            ["report_id"],
            ["forestry.report.id"],
            name="fk_report_note_report_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["author_app_user_id"],
            ["platform.app_user.id"],
            name="fk_report_note_author_app_user_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_report_note"),
        schema="forestry",
    )
    op.create_index("ix_report_note_report_id", "report_note", ["report_id"], schema="forestry")

    op.create_table(
        "report_feature",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("report_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("source_feature_ordinal", sa.Integer(), nullable=False),
        sa.Column("in_report", sa.Boolean(), nullable=False),
        sa.Column("geometry_changed", sa.Boolean(), nullable=False),
        sa.Column("attributes", postgresql.JSONB(), nullable=False),
        sa.CheckConstraint("position >= 1", name="ck_report_feature_position_positive"),
        sa.CheckConstraint(
            "source_feature_ordinal >= 1", name="ck_report_feature_source_ordinal_positive"
        ),
        sa.ForeignKeyConstraint(
            ["report_id"],
            ["forestry.report.id"],
            name="fk_report_feature_report_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_report_feature"),
        sa.UniqueConstraint("report_id", "position", name="uq_report_feature_report_position"),
        schema="forestry",
    )
    op.execute(
        "ALTER TABLE forestry.report_feature "
        "ADD COLUMN geometry geometry(MultiPolygon, 32718) NOT NULL"
    )


def downgrade() -> None:
    """Drop the report tables (the base snapshots are untouched)."""

    op.drop_table("report_feature", schema="forestry")
    op.drop_table("report_note", schema="forestry")
    op.drop_table("report", schema="forestry")
