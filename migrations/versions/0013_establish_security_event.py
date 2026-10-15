"""Establish platform security events for the operator's Consola.

Revision ID: 0013
Revises: 0012

Expand-only. Spec:
docs/superpowers/specs/2026-10-15-platform-consola-design.md.

``platform.security_event`` holds what the audit ledger does not: rejected
sign-ins, CSRF rejections, permission denials and ``401`` answers (one row
per client IP, path and minute, with ``count``). Rows carry a URL path but
never a query string, and a reason code but never free text. The app
deletes rows older than 90 days.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EVENT_TYPES: tuple[str, ...] = (
    "sign_in.rejected",
    "csrf.rejected",
    "access.denied",
    "auth.required",
)


def upgrade() -> None:
    """Create the security event table and its two lookup indexes."""

    known = ", ".join(f"'{event_type}'" for event_type in EVENT_TYPES)
    op.create_table(
        "security_event",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("product_key", sa.Text(), nullable=True),
        sa.Column("actor_app_user_id", sa.BigInteger(), nullable=True),
        sa.Column("client_ip", postgresql.INET(), nullable=True),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("http_status", sa.SmallInteger(), nullable=False),
        sa.Column("count", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_security_event"),
        sa.ForeignKeyConstraint(
            ["actor_app_user_id"],
            ["platform.app_user.id"],
            name="fk_security_event_actor_app_user_id",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(f"event_type IN ({known})", name="ck_security_event_type_known"),
        sa.CheckConstraint("count >= 1", name="ck_security_event_count_positive"),
        sa.CheckConstraint("strpos(path, '?') = 0", name="ck_security_event_path_has_no_query"),
        schema="platform",
    )
    op.create_index(
        "ix_security_event_occurred_at", "security_event", ["occurred_at"], schema="platform"
    )
    op.create_index(
        "ix_security_event_client_ip_occurred_at",
        "security_event",
        ["client_ip", "occurred_at"],
        schema="platform",
    )


def downgrade() -> None:
    """Drop the table; nothing else references it."""

    op.drop_index(
        "ix_security_event_client_ip_occurred_at", table_name="security_event", schema="platform"
    )
    op.drop_index("ix_security_event_occurred_at", table_name="security_event", schema="platform")
    op.drop_table("security_event", schema="platform")
