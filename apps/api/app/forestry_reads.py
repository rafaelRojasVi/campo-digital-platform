"""Read projections over the persisted Forestry source substrate.

Every projection is snapshot-scoped arithmetic over persisted source values.
None of these results is a business conclusion: use-field differences are
literal comparisons of the source columns (`Uso2024` vs `Uso2026`,
`Cod_Uso` vs `CodUso_2026`), never "progress", "approved change", or any
workflow semantics, and quality-flag counts are data-quality evidence, not
status.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import Connection, text

from app.forestry_persistence import ForestryIngestionError

UseField = Literal["uso_2024", "uso_2026"]

_USE_FIELD_COLUMNS: dict[str, str] = {
    "uso_2024": "uso_2024",
    "uso_2026": "uso_2026",
}


@dataclass(frozen=True, slots=True)
class ForestrySnapshotRecord:
    """One persisted Forestry snapshot, as listed."""

    shapefile_snapshot_id: int
    layer_name: str
    family_fingerprint: str
    feature_count: int
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ForestrySnapshotSummary:
    """Factual per-snapshot aggregates over persisted source evidence."""

    shapefile_snapshot_id: int
    layer_name: str
    family_fingerprint: str
    storage_srid: int
    bbox: tuple[float, float, float, float]
    feature_count: int
    total_geometry_area_source_units: float
    total_sup_ha: float
    geometry_valid_count: int
    geometry_invalid_count: int
    quality_flag_counts: dict[str, int]
    n_rodal_te_non_blank_count: int
    created_at: datetime


@dataclass(frozen=True, slots=True)
class PredioDistributionEntry:
    """Feature count and area sums for one source predio code/name pair."""

    cod_predial: str | None
    nom_predio: str | None
    feature_count: int
    sup_ha_total: float
    geometry_area_total: float


@dataclass(frozen=True, slots=True)
class UseDistributionEntry:
    """Feature count and area sums for one source use-class value."""

    value: str | None
    feature_count: int
    sup_ha_total: float
    geometry_area_total: float


@dataclass(frozen=True, slots=True)
class UseFieldChange:
    """One literal source-field difference within a snapshot."""

    feature_ordinal: int
    source_objectid: int | None
    before: str | None
    after: str | None


@dataclass(frozen=True, slots=True)
class UseFieldComparison:
    """Literal differences between year-stamped source columns."""

    uso_2024_vs_uso_2026: tuple[UseFieldChange, ...]
    cod_uso_vs_cod_uso_2026: tuple[UseFieldChange, ...]


def list_shapefile_snapshots(
    connection: Connection,
) -> tuple[ForestrySnapshotRecord, ...]:
    """List persisted Forestry snapshots in ingestion order."""

    rows = connection.execute(
        text(
            """
            SELECT id, layer_name, family_fingerprint, feature_count, created_at
            FROM forestry.shapefile_snapshot
            ORDER BY id
            """
        )
    ).all()

    return tuple(
        ForestrySnapshotRecord(
            shapefile_snapshot_id=int(row.id),
            layer_name=row.layer_name,
            family_fingerprint=row.family_fingerprint,
            feature_count=int(row.feature_count),
            created_at=row.created_at,
        )
        for row in rows
    )


def snapshot_summary(
    connection: Connection,
    shapefile_snapshot_id: int,
) -> ForestrySnapshotSummary:
    """Aggregate persisted evidence for one snapshot."""

    snapshot = connection.execute(
        text(
            """
            SELECT
                id,
                layer_name,
                family_fingerprint,
                storage_srid,
                bbox_x_min,
                bbox_y_min,
                bbox_x_max,
                bbox_y_max,
                created_at
            FROM forestry.shapefile_snapshot
            WHERE id = :snapshot_id
            """
        ),
        {"snapshot_id": shapefile_snapshot_id},
    ).one_or_none()

    if snapshot is None:
        raise ForestryIngestionError(f"Forestry snapshot {shapefile_snapshot_id} does not exist")

    aggregates = connection.execute(
        text(
            """
            SELECT
                count(*) AS feature_count,
                COALESCE(SUM(geometry_area_source_units), 0) AS total_geometry_area,
                COALESCE(SUM(sup_ha), 0) AS total_sup_ha,
                count(*) FILTER (WHERE geometry_is_valid) AS valid_count,
                count(*) FILTER (WHERE NOT geometry_is_valid) AS invalid_count,
                count(*) FILTER (
                    WHERE source_attributes ->> 'n_rodal_te' IS NOT NULL
                ) AS n_rodal_te_non_blank_count
            FROM forestry.source_feature
            WHERE shapefile_snapshot_id = :snapshot_id
            """
        ),
        {"snapshot_id": shapefile_snapshot_id},
    ).one()

    flag_rows = connection.execute(
        text(
            """
            SELECT flag, count(*) AS flag_count
            FROM forestry.source_feature,
                 unnest(quality_flags) AS flag
            WHERE shapefile_snapshot_id = :snapshot_id
            GROUP BY flag
            ORDER BY flag
            """
        ),
        {"snapshot_id": shapefile_snapshot_id},
    ).all()

    return ForestrySnapshotSummary(
        shapefile_snapshot_id=int(snapshot.id),
        layer_name=snapshot.layer_name,
        family_fingerprint=snapshot.family_fingerprint,
        storage_srid=int(snapshot.storage_srid),
        bbox=(
            float(snapshot.bbox_x_min),
            float(snapshot.bbox_y_min),
            float(snapshot.bbox_x_max),
            float(snapshot.bbox_y_max),
        ),
        feature_count=int(aggregates.feature_count),
        total_geometry_area_source_units=float(aggregates.total_geometry_area),
        total_sup_ha=float(aggregates.total_sup_ha),
        geometry_valid_count=int(aggregates.valid_count),
        geometry_invalid_count=int(aggregates.invalid_count),
        quality_flag_counts={row.flag: int(row.flag_count) for row in flag_rows},
        n_rodal_te_non_blank_count=int(aggregates.n_rodal_te_non_blank_count),
        created_at=snapshot.created_at,
    )


def predio_distribution(
    connection: Connection,
    shapefile_snapshot_id: int,
) -> tuple[PredioDistributionEntry, ...]:
    """Source predio code/name values with feature counts and area sums."""

    rows = connection.execute(
        text(
            """
            SELECT
                cod_predial,
                nom_predio,
                count(*) AS feature_count,
                COALESCE(SUM(sup_ha), 0) AS sup_ha_total,
                COALESCE(SUM(geometry_area_source_units), 0) AS geometry_area_total
            FROM forestry.source_feature
            WHERE shapefile_snapshot_id = :snapshot_id
            GROUP BY cod_predial, nom_predio
            ORDER BY cod_predial NULLS LAST, nom_predio NULLS LAST
            """
        ),
        {"snapshot_id": shapefile_snapshot_id},
    ).all()

    return tuple(
        PredioDistributionEntry(
            cod_predial=row.cod_predial,
            nom_predio=row.nom_predio,
            feature_count=int(row.feature_count),
            sup_ha_total=float(row.sup_ha_total),
            geometry_area_total=float(row.geometry_area_total),
        )
        for row in rows
    )


def use_distribution(
    connection: Connection,
    shapefile_snapshot_id: int,
    *,
    field: UseField,
) -> tuple[UseDistributionEntry, ...]:
    """Distribution of one year-stamped source use-class column."""

    column = _USE_FIELD_COLUMNS.get(field)

    if column is None:
        raise ForestryIngestionError(f"Unsupported use field: {field!r}")

    rows = connection.execute(
        text(
            f"""
            SELECT
                {column} AS value,
                count(*) AS feature_count,
                COALESCE(SUM(sup_ha), 0) AS sup_ha_total,
                COALESCE(SUM(geometry_area_source_units), 0) AS geometry_area_total
            FROM forestry.source_feature
            WHERE shapefile_snapshot_id = :snapshot_id
            GROUP BY {column}
            ORDER BY feature_count DESC, value NULLS LAST
            """
        ),
        {"snapshot_id": shapefile_snapshot_id},
    ).all()

    return tuple(
        UseDistributionEntry(
            value=row.value,
            feature_count=int(row.feature_count),
            sup_ha_total=float(row.sup_ha_total),
            geometry_area_total=float(row.geometry_area_total),
        )
        for row in rows
    )


def use_field_comparison(
    connection: Connection,
    shapefile_snapshot_id: int,
) -> UseFieldComparison:
    """Literal snapshot-internal differences between year-stamped source columns.

    The result compares source fields only (`Uso2024` vs `Uso2026`,
    `Cod_Uso` vs `CodUso_2026`). The semantics of individual code values are
    partially unconfirmed; these differences carry no workflow meaning.
    """

    return UseFieldComparison(
        uso_2024_vs_uso_2026=_field_differences(
            connection,
            shapefile_snapshot_id,
            before_column="uso_2024",
            after_column="uso_2026",
        ),
        cod_uso_vs_cod_uso_2026=_field_differences(
            connection,
            shapefile_snapshot_id,
            before_column="cod_uso",
            after_column="cod_uso_2026",
        ),
    )


def _field_differences(
    connection: Connection,
    shapefile_snapshot_id: int,
    *,
    before_column: str,
    after_column: str,
) -> tuple[UseFieldChange, ...]:
    if {before_column, after_column} - {"uso_2024", "uso_2026", "cod_uso", "cod_uso_2026"}:
        raise ForestryIngestionError("Unsupported comparison columns")

    rows = connection.execute(
        text(
            f"""
            SELECT
                feature_ordinal,
                source_objectid,
                {before_column} AS before_value,
                {after_column} AS after_value
            FROM forestry.source_feature
            WHERE shapefile_snapshot_id = :snapshot_id
              AND {before_column} IS DISTINCT FROM {after_column}
            ORDER BY feature_ordinal
            """
        ),
        {"snapshot_id": shapefile_snapshot_id},
    ).all()

    return tuple(
        UseFieldChange(
            feature_ordinal=int(row.feature_ordinal),
            source_objectid=(None if row.source_objectid is None else int(row.source_objectid)),
            before=row.before_value,
            after=row.after_value,
        )
        for row in rows
    )
