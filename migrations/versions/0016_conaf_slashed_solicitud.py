"""Allow CONAF's slashed solicitud numbers (12/345-6/24).

Revision ID: 0016
Revises: 0015

FACT (2026-10-18): CONAF's public consulta answers the Transelec planilla's
«N Ingreso» (`correlativo/oficina-código/año`, for example 12/345-6/24). The
0015 checks allowed only 6–9 digits, so those numbers could not be stored.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DIGITS = "^[0-9]{6,9}$"
NUMERO = "^([0-9]{6,9}|[0-9]{1,6}/[0-9]{1,4}-[0-9]{1,4}/[0-9]{2})$"


def upgrade() -> None:
    """Widen the two number checks."""

    op.drop_constraint(
        "ck_conaf_solicitud_numero", "conaf_solicitud", schema="platform", type_="check"
    )
    op.create_check_constraint(
        "ck_conaf_solicitud_numero", "conaf_solicitud", f"numero ~ '{NUMERO}'", schema="platform"
    )
    op.drop_constraint("ck_report_conaf_solicitud", "report", schema="forestry", type_="check")
    op.create_check_constraint(
        "ck_report_conaf_solicitud",
        "report",
        f"conaf_solicitud IS NULL OR conaf_solicitud ~ '{NUMERO}'",
        schema="forestry",
    )


def downgrade() -> None:
    """Back to digits only; slashed rows must be removed first."""

    op.execute("DELETE FROM platform.conaf_cambio WHERE numero !~ '^[0-9]{6,9}$'")
    op.execute("DELETE FROM platform.conaf_solicitud WHERE numero !~ '^[0-9]{6,9}$'")
    op.execute(
        "UPDATE forestry.report SET conaf_solicitud = NULL "
        "WHERE conaf_solicitud IS NOT NULL AND conaf_solicitud !~ '^[0-9]{6,9}$'"
    )
    op.drop_constraint("ck_report_conaf_solicitud", "report", schema="forestry", type_="check")
    op.create_check_constraint(
        "ck_report_conaf_solicitud",
        "report",
        f"conaf_solicitud IS NULL OR conaf_solicitud ~ '{DIGITS}'",
        schema="forestry",
    )
    op.drop_constraint(
        "ck_conaf_solicitud_numero", "conaf_solicitud", schema="platform", type_="check"
    )
    op.create_check_constraint(
        "ck_conaf_solicitud_numero", "conaf_solicitud", f"numero ~ '{DIGITS}'", schema="platform"
    )
