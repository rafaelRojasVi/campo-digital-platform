"""Add per-rodal planning fields to forestry.report_feature.

Revision ID: 0018
Revises: 0017

DECISION (2026-10-19): Javier (Campo Digital) confirmed that sector,
reforest_species, and reforest_density are per-rodal values needed in the
harvest Excel.  They cannot be derived from the base snapshot (sector is
approximate, general knowledge; species/density are planning decisions).
Three nullable columns are added to ``forestry.report_feature``; existing
rows keep NULL values.

- ``sector`` TEXT: free-text location label, trimmed whitespace, ≤60 chars.
  CHECK: ``sector IS NULL OR (trim(sector) = sector AND length(sector) <= 60)``.

- ``reforest_species`` JSONB: ordered list of species name strings (NOT the
  CodUso_2026 prefix codes — human-readable names chosen by the user).
  At most 6 items, each a 1–40 character string, no duplicates (one CHECK
  through the IMMUTABLE function ``forestry.reforest_species_ok``).

- ``reforest_density`` INTEGER: total planting density in pl/ha for the
  rodal (a single value for all species combined).  Range 1–20 000.

DECISION (2026-10-19): planning fields are kept when a polygon is unmarked
(in_report toggled to False).  The export and review only show them for
managed (in_report = True) polygons, but we do not discard them on unmark
because the user may re-mark later.

DECISION (2026-10-19): split pieces both inherit the planning fields of the
original polygon.  A split is a geometric operation within the same plan; the
sector, species and density apply to all pieces.  If the user wants them to
differ on the two pieces, they can edit each piece separately.

DECISION (2026-10-19): when a report is duplicated, the INSERT INTO SELECT
copies the planning fields unchanged, preserving the planner's intent.

Downgrade drops the three columns and their CHECK constraints.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SECTOR_CHECK = "sector IS NULL OR (trim(sector) = sector AND length(sector) <= 60)"
# PostgreSQL forbids subqueries in a CHECK, so the per-item rules live in an
# IMMUTABLE function (pure: it reads nothing but its argument). The CASE keeps
# jsonb_array_length away from a non-array, which would raise instead of
# failing the check.
_SPECIES_FUNCTION = """
CREATE FUNCTION forestry.reforest_species_ok(species jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE
        WHEN jsonb_typeof(species) <> 'array' THEN false
        ELSE jsonb_array_length(species) <= 6
            AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(species) AS e
                WHERE jsonb_typeof(e) <> 'string'
                   OR length(e #>> '{}') NOT BETWEEN 1 AND 40
            )
            AND (SELECT count(DISTINCT e) FROM jsonb_array_elements(species) AS e)
                = jsonb_array_length(species)
    END
$$
"""
_SPECIES_CHECK = "reforest_species IS NULL OR forestry.reforest_species_ok(reforest_species)"
_DENSITY_CHECK = "reforest_density IS NULL OR (reforest_density >= 1 AND reforest_density <= 20000)"


def upgrade() -> None:
    """Add sector, reforest_species, reforest_density and their checks."""

    op.add_column(
        "report_feature",
        sa.Column("sector", sa.Text(), nullable=True),
        schema="forestry",
    )
    op.create_check_constraint(
        "ck_rf_sector",
        "report_feature",
        _SECTOR_CHECK,
        schema="forestry",
    )

    op.add_column(
        "report_feature",
        sa.Column("reforest_species", sa.dialects.postgresql.JSONB(), nullable=True),
        schema="forestry",
    )
    op.execute(_SPECIES_FUNCTION)
    op.create_check_constraint(
        "ck_rf_reforest_species",
        "report_feature",
        _SPECIES_CHECK,
        schema="forestry",
    )

    op.add_column(
        "report_feature",
        sa.Column("reforest_density", sa.Integer(), nullable=True),
        schema="forestry",
    )
    op.create_check_constraint(
        "ck_rf_reforest_density",
        "report_feature",
        _DENSITY_CHECK,
        schema="forestry",
    )


def downgrade() -> None:
    """Remove the three columns and their constraints."""

    op.drop_constraint("ck_rf_reforest_density", "report_feature", schema="forestry", type_="check")
    op.drop_column("report_feature", "reforest_density", schema="forestry")

    op.drop_constraint("ck_rf_reforest_species", "report_feature", schema="forestry", type_="check")
    op.drop_column("report_feature", "reforest_species", schema="forestry")
    op.execute("DROP FUNCTION forestry.reforest_species_ok(jsonb)")

    op.drop_constraint("ck_rf_sector", "report_feature", schema="forestry", type_="check")
    op.drop_column("report_feature", "sector", schema="forestry")
