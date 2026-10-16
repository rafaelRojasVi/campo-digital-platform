"""A synthetic Rodales base for management-report tests.

Three 100 m squares (ordinals 1-3, rodales 17, 18, 19) and one invalid
bowtie (ordinal 4, rodal 20), ingested and published. No client data.
"""

from __future__ import annotations

from pathlib import Path

from app.access_repository import resolve_or_create_app_user
from app.forestry_publication import publish_initial_if_unpublished
from sqlalchemy import Connection
from test_forestry_ingestion import build_zip, ingest

from forestry_family_fixtures import source_row, square_ring

BOWTIE_100 = [(600.0, 0.0), (700.0, 100.0), (600.0, 100.0), (700.0, 0.0), (600.0, 0.0)]

BASE_ROWS = [
    source_row(objectid=11, n_rodal="17", sup_ha=1.0, cod_uso="Pi06"),
    source_row(objectid=12, n_rodal="18", sup_ha=1.0),
    source_row(objectid=13, n_rodal="19", sup_ha=1.0),
    source_row(objectid=14, n_rodal="20", sup_ha=1.0),
]
BASE_GEOMETRIES = [
    [square_ring(0.0, 0.0, 100.0)],
    [square_ring(200.0, 0.0, 100.0)],
    [square_ring(400.0, 0.0, 100.0)],
    [BOWTIE_100],
]


def seed_published_base(
    connection: Connection, source_root: Path, *, zip_name: str = "base.zip"
) -> int:
    """Ingest the synthetic base; publish it if nothing is published. Returns its snapshot id."""

    relative = build_zip(source_root, BASE_ROWS, geometries=BASE_GEOMETRIES, zip_name=zip_name)
    snapshot_id = ingest(connection, source_root, relative).shapefile_snapshot_id
    publish_initial_if_unpublished(connection, shapefile_snapshot_id=snapshot_id)
    return snapshot_id


def seed_user(connection: Connection, name: str) -> int:
    """A platform user without grants (grants are added by the caller when needed)."""

    return resolve_or_create_app_user(
        connection,
        identity_kind="google",
        identity_key=f"sub-{name}",
        display_name=name,
        email=f"{name}@campodigital.cl",
    ).id


def square_geojson(x0: float, y0: float, width: float, height: float) -> dict[str, object]:
    """A GeoJSON Polygon rectangle in EPSG:32718 metres."""

    return {
        "type": "Polygon",
        "coordinates": [
            [[x0, y0], [x0, y0 + height], [x0 + width, y0 + height], [x0 + width, y0], [x0, y0]]
        ],
    }
