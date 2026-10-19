"""Write a Rodales management report as a shapefile ZIP, a GeoPackage or a CSV.

Pure: the router passes the report header and its rows. Columns are the 14
base fields in the base's order (``CodUso_202`` widened from 10 to 25 so
codes are not cut) followed by the report fields. ``OBJECTID`` is 0 for
changed pieces, which have no OBJECTID of their own; ``OID_ORIGEN`` names the
master polygon each row comes from.

The shapefile carries the base's exact ``.prj`` and a ``UTF-8`` ``.cpg``
(ArcMap 10.8 reads it, so accents survive). The GeoPackage is written with
the standard library (GeoPackage 1.3 core tables, EPSG:32718). The CSV is
UTF-8 with BOM, comma separated, CRLF, like the dashboard's CSV.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import re
import sqlite3
import struct
import tempfile
import unicodedata
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import shapefile
import shapely
from shapely.geometry import MultiPolygon
from shapely.geometry.polygon import orient

from forestry_ingestion.shapefile_contract import EXPECTED_PRJ_WKT

ExportFormat = Literal["shp", "gpkg", "csv", "xlsx"]


@dataclass(frozen=True, slots=True)
class ExportField:
    name: str
    dbf_type: Literal["C", "N", "F"]
    size: int
    decimals: int


EXPORT_FIELDS: tuple[ExportField, ...] = (
    ExportField("OBJECTID", "N", 10, 0),
    ExportField("Nom_Predio", "C", 50, 0),
    ExportField("N_Rodal", "C", 10, 0),
    ExportField("Sup_ha", "F", 19, 11),
    ExportField("Cod_Uso", "C", 25, 0),
    ExportField("Editada", "C", 2, 0),
    ExportField("Uso2024", "C", 50, 0),
    ExportField("DescUso", "C", 50, 0),
    ExportField("Cod_Predia", "C", 10, 0),
    ExportField("N_Rodal_te", "C", 3, 0),
    ExportField("Uso2026", "C", 50, 0),
    ExportField("CodUso_202", "C", 25, 0),
    ExportField("Shape_Leng", "F", 19, 11),
    ExportField("Shape_Area", "F", 19, 11),
    ExportField("EN_INFORME", "C", 2, 0),
    ExportField("INFORME", "C", 254, 0),
    ExportField("TIPO", "C", 15, 0),
    ExportField("FECHA", "C", 10, 0),
    ExportField("ESTADO", "C", 20, 0),
    ExportField("OID_ORIGEN", "N", 10, 0),
)
# Lineage keys of the 14 base fields, in EXPORT_FIELDS order.
_BASE_KEYS = (
    "objectid",
    "nom_predio",
    "n_rodal",
    "sup_ha",
    "cod_uso",
    "editada",
    "uso_2024",
    "desc_uso",
    "cod_predial",
    "n_rodal_te",
    "uso_2026",
    "cod_uso_2026",
    "shape_leng",
    "shape_area",
)
TYPE_LABELS = {
    "cosecha": "Cosecha",
    "manejo": "Manejo",
    "reforestacion": "Reforestación",
    "plantacion": "Plantación",
    "otro": "Otro",
}
STATUS_LABELS = {
    "borrador": "Borrador",
    "enviado": "Enviado",
    "aprobado": "Aprobado",
    "cambios_solicitados": "Cambios solicitados",
    "archivado": "Archivado",
}

_SRS_ID = 32718
_GPKG_APPLICATION_ID = 0x47504B47  # "GPKG"
_GPKG_USER_VERSION = 10300  # GeoPackage 1.3
_SQL_TYPES = {"C": "TEXT", "N": "INTEGER", "F": "REAL"}
_WGS84_WKT = (
    'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,'
    'AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,'
    'AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,'
    'AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]'
)
_GPKG_CORE_TABLES = """
CREATE TABLE gpkg_spatial_ref_sys (
    srs_name TEXT NOT NULL,
    srs_id INTEGER PRIMARY KEY,
    organization TEXT NOT NULL,
    organization_coordsys_id INTEGER NOT NULL,
    definition TEXT NOT NULL,
    description TEXT
);
CREATE TABLE gpkg_contents (
    table_name TEXT NOT NULL PRIMARY KEY,
    data_type TEXT NOT NULL,
    identifier TEXT UNIQUE,
    description TEXT DEFAULT '',
    last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
    srs_id INTEGER,
    CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id)
);
CREATE TABLE gpkg_geometry_columns (
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    geometry_type_name TEXT NOT NULL,
    srs_id INTEGER NOT NULL,
    z TINYINT NOT NULL,
    m TINYINT NOT NULL,
    CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
    CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents (table_name),
    CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id)
);
"""


@dataclass(frozen=True, slots=True)
class ExportReport:
    name: str
    report_type: str
    report_month: str
    status: str
    report_date: dt.date | None = None
    conaf_solicitud: str | None = None


@dataclass(frozen=True, slots=True)
class ExportRow:
    attributes: Mapping[str, Any]
    geometry: MultiPolygon
    in_report: bool
    geometry_changed: bool


def row_values(report: ExportReport, row: ExportRow) -> list[object]:
    """One row's values in ``EXPORT_FIELDS`` order."""

    base: list[object] = [row.attributes.get(key) for key in _BASE_KEYS]
    source_objectid = row.attributes.get("objectid")
    if row.geometry_changed:
        base[0] = 0
    # FECHA: use the exact ISO date when set; fall back to the month string.
    fecha = (
        report.report_date.isoformat() if report.report_date is not None else report.report_month
    )
    return [
        *base,
        "si" if row.in_report else "no",
        report.name,
        TYPE_LABELS[report.report_type],
        fecha,
        STATUS_LABELS[report.status],
        source_objectid,
    ]


def report_slug(name: str) -> str:
    """ASCII file and layer name: letters, digits and underscores."""

    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^A-Za-z0-9]+", "_", ascii_name).strip("_")
    return slug[:80] or "informe"


def write_shapefile_zip(report: ExportReport, rows: Sequence[ExportRow]) -> bytes:
    shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
    writer = shapefile.Writer(
        shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON, encoding="utf-8"
    )
    for field in EXPORT_FIELDS:
        writer.field(field.name, field.dbf_type, field.size, field.decimals)
    for row in rows:
        writer.record(*_dbf_values(row_values(report, row)))
        writer.poly(_shapefile_parts(row.geometry))
    writer.close()

    slug = report_slug(report.name)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{slug}.shp", shp.getvalue())
        archive.writestr(f"{slug}.shx", shx.getvalue())
        archive.writestr(f"{slug}.dbf", dbf.getvalue())
        archive.writestr(f"{slug}.prj", EXPECTED_PRJ_WKT)
        archive.writestr(f"{slug}.cpg", "UTF-8")
    return buffer.getvalue()


def write_geopackage(report: ExportReport, rows: Sequence[ExportRow]) -> bytes:
    layer = report_slug(report.name)  # letters, digits, underscores: safe in SQL quotes
    columns = ", ".join(f'"{f.name}" {_SQL_TYPES[f.dbf_type]}' for f in EXPORT_FIELDS)
    names = ", ".join(f'"{f.name}"' for f in EXPORT_FIELDS)
    placeholders = ", ".join("?" for _ in range(len(EXPORT_FIELDS) + 1))
    if rows:
        bounds: tuple[float | None, ...] = tuple(
            shapely.total_bounds([row.geometry for row in rows]).tolist()
        )
    else:
        bounds = (None, None, None, None)

    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "report.gpkg"
        connection = sqlite3.connect(path)
        try:
            connection.execute(f"PRAGMA application_id = {_GPKG_APPLICATION_ID}")
            connection.execute(f"PRAGMA user_version = {_GPKG_USER_VERSION}")
            connection.executescript(_GPKG_CORE_TABLES)
            connection.executemany(
                "INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)",
                [
                    ("Undefined cartesian SRS", -1, "NONE", -1, "undefined", "undefined cartesian"),
                    ("Undefined geographic SRS", 0, "NONE", 0, "undefined", "undefined geographic"),
                    ("WGS 84 geodetic", 4326, "EPSG", 4326, _WGS84_WKT, "WGS 84"),
                    (
                        "WGS 84 / UTM zone 18S",
                        _SRS_ID,
                        "EPSG",
                        _SRS_ID,
                        EXPECTED_PRJ_WKT,
                        "Rodales",
                    ),
                ],
            )
            connection.execute(
                f'CREATE TABLE "{layer}" '
                f"(fid INTEGER PRIMARY KEY AUTOINCREMENT, geom MULTIPOLYGON, {columns})"
            )
            connection.execute(
                "INSERT INTO gpkg_contents "
                "(table_name, data_type, identifier, min_x, min_y, max_x, max_y, srs_id) "
                "VALUES (?, 'features', ?, ?, ?, ?, ?, ?)",
                (layer, report.name, *bounds, _SRS_ID),
            )
            connection.execute(
                "INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'MULTIPOLYGON', ?, 0, 0)",
                (layer, _SRS_ID),
            )
            connection.executemany(
                f'INSERT INTO "{layer}" (geom, {names}) VALUES ({placeholders})',
                [(_gpkg_blob(row.geometry), *row_values(report, row)) for row in rows],
            )
            connection.commit()
        finally:
            connection.close()
        return path.read_bytes()


def write_csv(report: ExportReport, rows: Sequence[ExportRow]) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow([field.name for field in EXPORT_FIELDS])
    for row in rows:
        writer.writerow([_csv_cell(value) for value in row_values(report, row)])
    return buffer.getvalue().encode("utf-8-sig")


# Text a spreadsheet would evaluate as a formula (CSV injection). The same
# rule as the Transelec CSV export; kept here so the products stay separate.
_FORMULA_LEADING_CHARACTERS = ("=", "+", "-", "@", "\t", "\r")


def _csv_cell(value: object) -> object:
    """Blank for None; text starting like a formula gets a leading apostrophe."""

    if value is None:
        return ""
    if isinstance(value, str) and value.startswith(_FORMULA_LEADING_CHARACTERS):
        return f"'{value}"
    return value


def export_report(
    fmt: ExportFormat, report: ExportReport, rows: Sequence[ExportRow]
) -> tuple[bytes, str, str]:
    """Content, media type and download file name for ``fmt``."""

    slug = report_slug(report.name)
    if fmt == "shp":
        return write_shapefile_zip(report, rows), "application/zip", f"{slug}.zip"
    if fmt == "gpkg":
        return write_geopackage(report, rows), "application/geopackage+sqlite3", f"{slug}.gpkg"
    if fmt == "xlsx":
        from app.forestry_report_harvest_xlsx import write_harvest_xlsx

        content = write_harvest_xlsx(report, rows)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return content, media, f"{slug}_cosecha.xlsx"
    return write_csv(report, rows), "text/csv; charset=utf-8", f"{slug}.csv"


def _dbf_values(values: Sequence[object]) -> list[object]:
    """pyshp writes None in a text field as the text "None"; write it blank."""

    return [
        "" if value is None and field.dbf_type == "C" else value
        for field, value in zip(EXPORT_FIELDS, values, strict=True)
    ]


def _shapefile_parts(geometry: MultiPolygon) -> list[list[list[float]]]:
    """Rings for pyshp: exterior clockwise, holes counter-clockwise (shapefile rule)."""

    parts: list[list[list[float]]] = []
    for polygon in geometry.geoms:
        oriented = orient(polygon, sign=-1.0)
        parts.append([[x, y] for x, y in oriented.exterior.coords])
        parts.extend([[x, y] for x, y in ring.coords] for ring in oriented.interiors)
    return parts


def _gpkg_blob(geometry: MultiPolygon) -> bytes:
    """GeoPackage binary: header (little endian, XY envelope) + WKB."""

    min_x, min_y, max_x, max_y = geometry.bounds
    header = (
        b"GP"
        + bytes([0, 0b0000_0011])
        + struct.pack("<i", _SRS_ID)
        + struct.pack("<4d", min_x, max_x, min_y, max_y)
    )
    return header + shapely.to_wkb(geometry, byte_order=1)
