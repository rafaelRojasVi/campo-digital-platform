"""Export writers for Rodales management reports: write, then read back."""

from __future__ import annotations

import csv
import io
import sqlite3
import struct
import tempfile
import warnings
import zipfile
from pathlib import Path

import pytest
import shapefile
import shapely
from app.forestry_report_export import (
    EXPORT_FIELDS,
    ExportReport,
    ExportRow,
    export_report,
    report_slug,
    write_csv,
    write_geopackage,
    write_shapefile_zip,
)
from shapely.geometry import MultiPolygon, Polygon, box, shape

from forestry_ingestion.shapefile_contract import EXPECTED_PRJ_WKT

REPORT = ExportReport("Cosecha pino enero 2027", "cosecha", "2027-01", "aprobado")
HOLED = Polygon(box(0, 0, 100, 100).exterior.coords, [box(40, 40, 60, 60).exterior.coords])
TWO_PARTS = MultiPolygon([box(200, 0, 260, 100), box(300, 0, 340, 100)])
LONG_CODE = "RaCoRo01Pi Rn Eg97 Pi99xy"  # 25 characters, cut to 10 in the base


def attrs(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "objectid": 11,
        "nom_predio": "Ñuble Alto",
        "n_rodal": "17",
        "sup_ha": 1.0,
        "cod_uso": "Pi06",
        "editada": None,
        "uso_2024": "PLANTACION",
        "desc_uso": "Descripción",
        "cod_predial": "PU1",
        "n_rodal_te": None,
        "uso_2026": "PLANTACION",
        "cod_uso_2026": LONG_CODE,
        "shape_leng": 400.0,
        "shape_area": 10_000.0,
    }
    values.update(overrides)
    return values


ROWS = [
    ExportRow(attrs(n_rodal="17-1", editada="wb", sup_ha=0.96), MultiPolygon([HOLED]), True, True),
    ExportRow(attrs(objectid=12, n_rodal="18"), TWO_PARTS, False, False),
]


def read_zip(content: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        return {Path(name).suffix: archive.read(name) for name in archive.namelist()}


def test_slug_is_ascii_and_never_empty() -> None:
    assert report_slug("Cosecha pino enero 2027") == "Cosecha_pino_enero_2027"
    assert report_slug("Reforestación Ñuble") == "Reforestacion_Nuble"
    assert report_slug("¡¡!!") == "informe"


def test_shapefile_zip_members_projection_and_encoding() -> None:
    members = read_zip(write_shapefile_zip(REPORT, ROWS))
    assert set(members) == {".shp", ".shx", ".dbf", ".prj", ".cpg"}
    assert members[".prj"].decode("utf-8") == EXPECTED_PRJ_WKT
    assert members[".cpg"] == b"UTF-8"
    with zipfile.ZipFile(io.BytesIO(write_shapefile_zip(REPORT, ROWS))) as archive:
        assert {Path(n).stem for n in archive.namelist()} == {"Cosecha_pino_enero_2027"}


def test_shapefile_fields_values_and_geometry_round_trip() -> None:
    members = read_zip(write_shapefile_zip(REPORT, ROWS))
    reader = shapefile.Reader(
        shp=io.BytesIO(members[".shp"]),
        shx=io.BytesIO(members[".shx"]),
        dbf=io.BytesIO(members[".dbf"]),
        encoding="utf-8",
    )
    fields = [(f.name, str(f.field_type), f.size, f.decimal) for f in reader.fields[1:]]
    assert fields == [(f.name, f.dbf_type, f.size, f.decimals) for f in EXPORT_FIELDS]

    first, second = (record.as_dict() for record in reader.records())
    assert first["OBJECTID"] == 0  # a new piece has no OBJECTID of its own
    assert first["OID_ORIGEN"] == 11
    assert second["OBJECTID"] == 12
    assert first["N_Rodal"] == "17-1"
    assert first["Nom_Predio"] == "Ñuble Alto"
    assert first["CodUso_202"] == LONG_CODE
    assert first["Editada"] == "wb"
    assert (first["EN_INFORME"], second["EN_INFORME"]) == ("si", "no")
    assert first["INFORME"] == "Cosecha pino enero 2027"
    assert (first["TIPO"], first["FECHA"], first["ESTADO"]) == ("Cosecha", "2027-01", "Aprobado")
    assert first["Sup_ha"] == pytest.approx(0.96)

    assert shapely.equals(shape(reader.shape(0).__geo_interface__), HOLED)
    assert shapely.equals(shape(reader.shape(1).__geo_interface__), TWO_PARTS)


def test_export_never_truncates() -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        write_shapefile_zip(REPORT, ROWS)


def test_empty_report_exports_in_every_format() -> None:
    for fmt in ("shp", "gpkg", "csv"):
        content, _, _ = export_report(fmt, REPORT, [])
        assert content


def test_geopackage_layer_srs_and_geometry() -> None:
    content = write_geopackage(REPORT, ROWS)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "x.gpkg"
        path.write_bytes(content)
        connection = sqlite3.connect(path)
        try:
            assert connection.execute("PRAGMA application_id").fetchone()[0] == 0x47504B47
            column = connection.execute(
                "SELECT table_name, column_name, geometry_type_name, srs_id "
                "FROM gpkg_geometry_columns"
            ).fetchone()
            assert column == ("Cosecha_pino_enero_2027", "geom", "MULTIPOLYGON", 32718)
            organization = connection.execute(
                "SELECT organization, organization_coordsys_id FROM gpkg_spatial_ref_sys "
                "WHERE srs_id = 32718"
            ).fetchone()
            assert organization == ("EPSG", 32718)
            blob, rodal, code = connection.execute(
                'SELECT geom, "N_Rodal", "CodUso_202" FROM "Cosecha_pino_enero_2027" ORDER BY fid'
            ).fetchone()
        finally:
            connection.close()
    assert blob[:2] == b"GP"
    assert struct.unpack("<i", blob[4:8])[0] == 32718
    assert shapely.equals(shapely.from_wkb(blob[40:]), MultiPolygon([HOLED]))
    assert (rodal, code) == ("17-1", LONG_CODE)


def test_csv_has_bom_header_and_blank_nulls() -> None:
    content = write_csv(REPORT, ROWS)
    assert content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))
    assert rows[0] == [f.name for f in EXPORT_FIELDS]
    assert len(rows) == 3
    header = rows[0]
    assert rows[1][header.index("N_Rodal_te")] == ""
    assert rows[1][header.index("EN_INFORME")] == "si"
    assert content.count(b"\r\n") == 3


def test_export_report_names_files_and_media_types() -> None:
    assert export_report("shp", REPORT, ROWS)[1:] == (
        "application/zip",
        "Cosecha_pino_enero_2027.zip",
    )
    assert export_report("gpkg", REPORT, ROWS)[1:] == (
        "application/geopackage+sqlite3",
        "Cosecha_pino_enero_2027.gpkg",
    )
    assert export_report("csv", REPORT, ROWS)[1:] == (
        "text/csv; charset=utf-8",
        "Cosecha_pino_enero_2027.csv",
    )


def test_no_email_addresses_in_any_export() -> None:
    # Geometry bytes may contain 0x40 ("@"), so look for the domain instead.
    for fmt in ("shp", "gpkg", "csv"):
        assert b"campodigital.cl" not in export_report(fmt, REPORT, ROWS)[0]


def test_csv_neutralizes_text_that_a_spreadsheet_would_run_as_a_formula() -> None:
    report = ExportReport("=HYPERLINK(1)", "cosecha", "2027-01", "borrador")
    rows = [
        ExportRow(
            attrs(n_rodal="+17", desc_uso="@SUM(A1)", cod_uso="-Pi06", uso_2024="\tx"),
            MultiPolygon([HOLED]),
            True,
            False,
        )
    ]
    [header, row] = list(csv.reader(io.StringIO(write_csv(report, rows).decode("utf-8-sig"))))
    cell = dict(zip(header, row, strict=True))
    assert cell["INFORME"] == "'=HYPERLINK(1)"
    assert cell["N_Rodal"] == "'+17"
    assert cell["DescUso"] == "'@SUM(A1)"
    assert cell["Cod_Uso"] == "'-Pi06"
    assert cell["Uso2024"] == "'\tx"
    # Numbers stay numbers.
    assert cell["Sup_ha"] == "1.0"
    assert cell["OBJECTID"] == "11"
