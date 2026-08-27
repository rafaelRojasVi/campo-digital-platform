"""Establish source provenance foundation.

Revision ID: 0002
Revises: 0001
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create provider-neutral source provenance tables."""

    op.create_table(
        "source_system",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.Identity(),
            nullable=False,
        ),
        sa.Column(
            "system_key",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "btrim(system_key) <> ''",
            name="ck_source_system_system_key_nonempty",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_source_system",
        ),
        sa.UniqueConstraint(
            "system_key",
            name="uq_source_system_system_key",
        ),
        schema="platform",
    )

    op.create_table(
        "source_asset",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.Identity(),
            nullable=False,
        ),
        sa.Column(
            "source_system_id",
            sa.BigInteger(),
            nullable=False,
        ),
        sa.Column(
            "identity_kind",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "identity_key",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "btrim(identity_kind) <> ''",
            name="ck_source_asset_identity_kind_nonempty",
        ),
        sa.CheckConstraint(
            "btrim(identity_key) <> ''",
            name="ck_source_asset_identity_key_nonempty",
        ),
        sa.ForeignKeyConstraint(
            ["source_system_id"],
            ["platform.source_system.id"],
            name="fk_source_asset_source_system_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_source_asset",
        ),
        sa.UniqueConstraint(
            "source_system_id",
            "identity_kind",
            "identity_key",
            name="uq_source_asset_identity",
        ),
        schema="platform",
    )

    op.create_table(
        "source_snapshot",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.Identity(),
            nullable=False,
        ),
        sa.Column(
            "source_asset_id",
            sa.BigInteger(),
            nullable=False,
        ),
        sa.Column(
            "content_sha256",
            sa.String(length=64),
            nullable=False,
        ),
        sa.Column(
            "byte_size",
            sa.BigInteger(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "content_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_source_snapshot_sha256",
        ),
        sa.CheckConstraint(
            "byte_size >= 0",
            name="ck_source_snapshot_byte_size_nonnegative",
        ),
        sa.ForeignKeyConstraint(
            ["source_asset_id"],
            ["platform.source_asset.id"],
            name="fk_source_snapshot_source_asset_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_source_snapshot",
        ),
        sa.UniqueConstraint(
            "source_asset_id",
            "content_sha256",
            name="uq_source_snapshot_asset_sha256",
        ),
        schema="platform",
    )

    op.create_table(
        "source_observation",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.Identity(),
            nullable=False,
        ),
        sa.Column(
            "source_snapshot_id",
            sa.BigInteger(),
            nullable=False,
        ),
        sa.Column(
            "source_path",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "filename",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "source_modified_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "media_type",
            sa.Text(),
            nullable=True,
        ),
        sa.CheckConstraint(
            "btrim(source_path) <> ''",
            name="ck_source_observation_source_path_nonempty",
        ),
        sa.CheckConstraint(
            "btrim(filename) <> ''",
            name="ck_source_observation_filename_nonempty",
        ),
        sa.CheckConstraint(
            "media_type IS NULL OR btrim(media_type) <> ''",
            name="ck_source_observation_media_type_nonempty",
        ),
        sa.ForeignKeyConstraint(
            ["source_snapshot_id"],
            ["platform.source_snapshot.id"],
            name="fk_source_observation_source_snapshot_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_source_observation",
        ),
        schema="platform",
    )

    op.create_index(
        "ix_source_observation_source_snapshot_id",
        "source_observation",
        ["source_snapshot_id"],
        unique=False,
        schema="platform",
    )


def downgrade() -> None:
    """Remove source provenance tables in dependency order."""

    op.drop_index(
        "ix_source_observation_source_snapshot_id",
        table_name="source_observation",
        schema="platform",
    )
    op.drop_table(
        "source_observation",
        schema="platform",
    )
    op.drop_table(
        "source_snapshot",
        schema="platform",
    )
    op.drop_table(
        "source_asset",
        schema="platform",
    )
    op.drop_table(
        "source_system",
        schema="platform",
    )
