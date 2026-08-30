"""Establish the Forestry immutable source substrate.

Revision ID: 0003
Revises: 0002

Creates the `forestry` schema with the product-specific persistence for
contract-valid shapefile snapshots:

- `forestry.shapefile_snapshot`: one row per immutable shapefile family,
  identified by the deterministic family fingerprint and anchored to the
  platform provenance foundation (`platform.source_snapshot` of the observed
  archive).
- `forestry.source_feature`: one row per source feature, identified only
  within its snapshot by `(shapefile_snapshot_id, feature_ordinal)`. No
  cross-snapshot feature identity exists; `source_objectid` is preserved as
  evidence, never as a durable global identity.

Geometry is stored as `geometry(MultiPolygon, 32718)`. SRID 32718 is the
EPSG mapping ("WGS 84 / UTM zone 18S") of the contract's pinned ESRI WKT
declaration `WGS_1984_UTM_Zone_18S`, established via pyproj's EPSG registry
and guarded by a Forestry unit test. Invalid source geometries are stored
faithfully; validity is recorded as evidence columns, never repaired.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the Forestry product schema and snapshot/feature tables."""

    op.execute("CREATE SCHEMA forestry")

    op.create_table(
        "shapefile_snapshot",
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
            "family_fingerprint",
            sa.String(length=64),
            nullable=False,
        ),
        sa.Column(
            "layer_name",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "member_sha256",
            postgresql.JSONB(),
            nullable=False,
        ),
        sa.Column(
            "prj_wkt",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "storage_srid",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "encoding",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "shape_type",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "bbox_x_min",
            sa.Float(precision=53),
            nullable=False,
        ),
        sa.Column(
            "bbox_y_min",
            sa.Float(precision=53),
            nullable=False,
        ),
        sa.Column(
            "bbox_x_max",
            sa.Float(precision=53),
            nullable=False,
        ),
        sa.Column(
            "bbox_y_max",
            sa.Float(precision=53),
            nullable=False,
        ),
        sa.Column(
            "feature_count",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "family_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_shapefile_snapshot_family_fingerprint",
        ),
        sa.CheckConstraint(
            "btrim(layer_name) <> ''",
            name="ck_shapefile_snapshot_layer_name_nonempty",
        ),
        sa.CheckConstraint(
            "btrim(prj_wkt) <> ''",
            name="ck_shapefile_snapshot_prj_wkt_nonempty",
        ),
        sa.CheckConstraint(
            "storage_srid > 0",
            name="ck_shapefile_snapshot_storage_srid_positive",
        ),
        sa.CheckConstraint(
            "btrim(encoding) <> ''",
            name="ck_shapefile_snapshot_encoding_nonempty",
        ),
        sa.CheckConstraint(
            "feature_count >= 1",
            name="ck_shapefile_snapshot_feature_count_positive",
        ),
        sa.ForeignKeyConstraint(
            ["source_snapshot_id"],
            ["platform.source_snapshot.id"],
            name="fk_shapefile_snapshot_source_snapshot_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_shapefile_snapshot",
        ),
        sa.UniqueConstraint(
            "family_fingerprint",
            name="uq_shapefile_snapshot_family_fingerprint",
        ),
        schema="forestry",
    )

    op.create_table(
        "source_feature",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.Identity(),
            nullable=False,
        ),
        sa.Column(
            "shapefile_snapshot_id",
            sa.BigInteger(),
            nullable=False,
        ),
        sa.Column(
            "feature_ordinal",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "source_objectid",
            sa.BigInteger(),
            nullable=True,
        ),
        sa.Column(
            "geometry_is_valid",
            sa.Boolean(),
            nullable=False,
        ),
        sa.Column(
            "geometry_invalid_reason",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "geometry_area_source_units",
            sa.Float(precision=53),
            nullable=False,
        ),
        sa.Column(
            "source_attributes",
            postgresql.JSONB(),
            nullable=False,
        ),
        sa.Column(
            "nom_predio",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "cod_predial",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "n_rodal",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "cod_uso",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "uso_2024",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "desc_uso",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "uso_2026",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "cod_uso_2026",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "sup_ha",
            sa.Float(precision=53),
            nullable=True,
        ),
        sa.Column(
            "shape_area",
            sa.Float(precision=53),
            nullable=True,
        ),
        sa.Column(
            "quality_flags",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "feature_ordinal >= 1",
            name="ck_source_feature_feature_ordinal_positive",
        ),
        sa.CheckConstraint(
            "(geometry_is_valid AND geometry_invalid_reason IS NULL)"
            " OR ((NOT geometry_is_valid) AND geometry_invalid_reason IS NOT NULL)",
            name="ck_source_feature_validity_reason_consistent",
        ),
        sa.CheckConstraint(
            "geometry_area_source_units >= 0",
            name="ck_source_feature_geometry_area_nonnegative",
        ),
        sa.ForeignKeyConstraint(
            ["shapefile_snapshot_id"],
            ["forestry.shapefile_snapshot.id"],
            name="fk_source_feature_shapefile_snapshot_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_source_feature",
        ),
        sa.UniqueConstraint(
            "shapefile_snapshot_id",
            "feature_ordinal",
            name="uq_source_feature_snapshot_ordinal",
        ),
        schema="forestry",
    )

    # The geometry column and its spatial index use PostGIS DDL directly; the
    # table is empty at this point, so NOT NULL is safe. SRID 32718 is the
    # documented EPSG mapping of the contract's pinned CRS declaration.
    op.execute(
        """
        ALTER TABLE forestry.source_feature
        ADD COLUMN geometry geometry(MultiPolygon, 32718) NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX ix_source_feature_geometry
        ON forestry.source_feature
        USING GIST (geometry)
        """
    )


def downgrade() -> None:
    """Remove the Forestry product schema in dependency order."""

    op.drop_table(
        "source_feature",
        schema="forestry",
    )
    op.drop_table(
        "shapefile_snapshot",
        schema="forestry",
    )
    op.execute("DROP SCHEMA forestry")
