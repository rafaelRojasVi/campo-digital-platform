"""Source Contract V1 tests using fully synthetic shapefile families.

No real Forestry client data is used or reproduced here.
"""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from forestry_ingestion.shapefile_contract import (
    DBF_FIELDS,
    EXPECTED_PRJ_WKT,
    ForestryShapefileError,
    load_forestry_shapefile,
)

FieldSpec = tuple[str, str, int, int]

DEFAULT_FIELD_SPECS: tuple[FieldSpec, ...] = tuple(
    (name, dbf_type, length, decimals) for name, dbf_type, length, decimals, _ in DBF_FIELDS
)

SQUARE = [(0.0, 0.0), (0.0, 10.0), (10.0, 10.0), (10.0, 0.0), (0.0, 0.0)]


def _source_row(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {key: None for _, _, _, _, key in DBF_FIELDS}

    values.update(
        {
            "objectid": 1,
            "nom_predio": "Predio Sintético",
            "n_rodal": "12",
            "sup_ha": 1.5,
            "cod_uso": "Xx01",
            "uso_2024": "CLASE A",
            "desc_uso": "Descripción sintética",
            "cod_predial": "PS",
            "uso_2026": "CLASE A",
            "cod_uso_2026": "Xx01",
            "shape_leng": 40.0,
            "shape_area": 15000.0,
        }
    )

    values.update(overrides)
    return values


def _write_dbf(
    path: Path,
    rows: list[dict[str, object]],
    *,
    field_specs: tuple[FieldSpec, ...] = DEFAULT_FIELD_SPECS,
    deleted_records: frozenset[int] = frozenset(),
) -> None:
    header_size = 32 + 32 * len(field_specs) + 1
    record_size = 1 + sum(length for _, _, length, _ in field_specs)

    buffer = bytearray()
    buffer += bytes([0x03, 26, 8, 29])
    buffer += struct.pack("<I", len(rows))
    buffer += struct.pack("<HH", header_size, record_size)
    buffer += bytes(20)

    for name, dbf_type, length, decimals in field_specs:
        buffer += name.encode("ascii").ljust(11, b"\x00")
        buffer += dbf_type.encode("ascii")
        buffer += bytes(4)
        buffer += bytes([length, decimals])
        buffer += bytes(14)

    buffer += b"\x0d"

    keys = [key for _, _, _, _, key in DBF_FIELDS]

    for index, row in enumerate(rows):
        buffer += b"*" if index in deleted_records else b" "

        for (name, dbf_type, length, decimals), key in zip(field_specs, keys, strict=True):
            value = row.get(key)

            if value is None:
                text = ""
            elif dbf_type == "C" or isinstance(value, str):
                text = str(value)
            else:
                assert isinstance(value, int | float)
                text = str(value) if dbf_type == "N" and decimals == 0 else f"{value:.{decimals}f}"

            raw = text.encode("utf-8")

            if len(raw) > length:
                raise AssertionError(f"synthetic value too wide for {name}: {text!r}")

            buffer += raw.ljust(length, b" ") if dbf_type == "C" else raw.rjust(length, b" ")

    buffer += b"\x1a"
    path.write_bytes(bytes(buffer))


def _main_header(*, total_bytes: int, shape_type: int) -> bytes:
    header = struct.pack(">i", 9994) + bytes(20) + struct.pack(">i", total_bytes // 2)
    header += struct.pack("<2i", 1000, shape_type)
    header += struct.pack("<4d", 0.0, 0.0, 10.0, 10.0)
    header += struct.pack("<4d", 0.0, 0.0, 0.0, 0.0)
    return header


def _write_shp_and_shx(
    shp_path: Path,
    shx_path: Path,
    polygon_count: int,
    *,
    shape_type: int = 5,
    shx_extra_records: int = 0,
) -> None:
    records = b""
    index_entries = b""
    offset_words = 50

    for record_number in range(1, polygon_count + 1):
        xs = [point[0] for point in SQUARE]
        ys = [point[1] for point in SQUARE]

        content = struct.pack("<i", shape_type)
        content += struct.pack("<4d", min(xs), min(ys), max(xs), max(ys))
        content += struct.pack("<2i", 1, len(SQUARE))
        content += struct.pack("<i", 0)

        for x, y in SQUARE:
            content += struct.pack("<2d", x, y)

        content_words = len(content) // 2
        records += struct.pack(">2i", record_number, content_words) + content
        index_entries += struct.pack(">2i", offset_words, content_words)
        offset_words += 4 + content_words

    for _ in range(shx_extra_records):
        index_entries += struct.pack(">2i", offset_words, 0)

    shp_path.write_bytes(
        _main_header(total_bytes=100 + len(records), shape_type=shape_type) + records
    )
    shx_path.write_bytes(
        _main_header(total_bytes=100 + len(index_entries), shape_type=shape_type) + index_entries
    )


def _write_family(
    directory: Path,
    rows: list[dict[str, object]],
    *,
    base_name: str = "synthetic",
    field_specs: tuple[FieldSpec, ...] = DEFAULT_FIELD_SPECS,
    shape_type: int = 5,
    prj_text: str = EXPECTED_PRJ_WKT,
    cpg_text: str = "UTF-8",
    omit_suffixes: frozenset[str] = frozenset(),
    shx_extra_records: int = 0,
    deleted_records: frozenset[int] = frozenset(),
) -> Path:
    base = directory / base_name

    _write_shp_and_shx(
        base.with_suffix(".shp"),
        base.with_suffix(".shx"),
        len(rows),
        shape_type=shape_type,
        shx_extra_records=shx_extra_records,
    )
    _write_dbf(
        base.with_suffix(".dbf"),
        rows,
        field_specs=field_specs,
        deleted_records=deleted_records,
    )
    base.with_suffix(".prj").write_text(prj_text, encoding="utf-8")
    base.with_suffix(".cpg").write_text(cpg_text, encoding="ascii")

    for suffix in omit_suffixes:
        base.with_suffix(suffix).unlink()

    return base.with_suffix(".shp")


def test_loads_valid_family_and_projects_rows(tmp_path: Path) -> None:
    shp_path = _write_family(
        tmp_path,
        [
            _source_row(),
            _source_row(
                objectid=2,
                n_rodal=None,
                editada="mv",
                cod_uso="Xx01",
                cod_uso_2026="Yy26",
                sup_ha=0.25,
            ),
        ],
    )

    table = load_forestry_shapefile(shp_path)

    assert table.shape_type == 5
    assert table.encoding == "UTF-8"
    assert table.prj_wkt == EXPECTED_PRJ_WKT
    assert table.bbox == (0.0, 0.0, 10.0, 10.0)
    assert len(table.rows) == 2

    first, second = table.rows

    assert first.record_number == 1
    assert first.objectid == 1
    assert first.nom_predio == "Predio Sintético"
    assert first.cod_predial == "PS"
    assert first.n_rodal == "12"
    assert first.sup_ha == pytest.approx(1.5)

    assert second.record_number == 2
    assert second.n_rodal is None
    assert second.values["editada"] == "mv"
    assert second.values["cod_uso_2026"] == "Yy26"


def test_fingerprints_are_deterministic_and_content_sensitive(tmp_path: Path) -> None:
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()

    shp_path = _write_family(tmp_path / "a", [_source_row()])
    other_path = _write_family(tmp_path / "b", [_source_row()])
    changed_path = _write_family(
        tmp_path / "b",
        [_source_row(desc_uso="Otra descripción")],
        base_name="changed",
    )

    table = load_forestry_shapefile(shp_path)
    same_content = load_forestry_shapefile(other_path)
    changed = load_forestry_shapefile(changed_path)

    assert set(table.member_sha256) == {".shp", ".shx", ".dbf", ".prj", ".cpg"}
    assert all(len(digest) == 64 for digest in table.member_sha256.values())
    assert table.family_fingerprint == same_content.family_fingerprint
    assert table.family_fingerprint != changed.family_fingerprint


def test_rejects_missing_required_member(tmp_path: Path) -> None:
    shp_path = _write_family(tmp_path, [_source_row()], omit_suffixes=frozenset({".prj"}))

    with pytest.raises(ForestryShapefileError, match="incomplete.*prj"):
        load_forestry_shapefile(shp_path)


def test_rejects_missing_encoding_declaration(tmp_path: Path) -> None:
    shp_path = _write_family(tmp_path, [_source_row()], omit_suffixes=frozenset({".cpg"}))

    with pytest.raises(ForestryShapefileError, match="incomplete.*cpg"):
        load_forestry_shapefile(shp_path)


def test_rejects_unsupported_encoding_declaration(tmp_path: Path) -> None:
    shp_path = _write_family(tmp_path, [_source_row()], cpg_text="ISO-8859-1")

    with pytest.raises(ForestryShapefileError, match="Unsupported source encoding"):
        load_forestry_shapefile(shp_path)


def test_rejects_changed_crs_declaration(tmp_path: Path) -> None:
    shp_path = _write_family(
        tmp_path,
        [_source_row()],
        prj_text=EXPECTED_PRJ_WKT.replace("18S", "19S"),
    )

    with pytest.raises(ForestryShapefileError, match="Declared CRS does not match"):
        load_forestry_shapefile(shp_path)


def test_rejects_renamed_dbf_field(tmp_path: Path) -> None:
    field_specs = list(DEFAULT_FIELD_SPECS)
    field_specs[6] = ("Uso2025", "C", 50, 0)

    shp_path = _write_family(tmp_path, [_source_row()], field_specs=tuple(field_specs))

    with pytest.raises(ForestryShapefileError, match="DBF schema mismatch.*Uso2025"):
        load_forestry_shapefile(shp_path)


def test_rejects_changed_field_width(tmp_path: Path) -> None:
    field_specs = list(DEFAULT_FIELD_SPECS)
    field_specs[1] = ("Nom_Predio", "C", 60, 0)

    shp_path = _write_family(tmp_path, [_source_row()], field_specs=tuple(field_specs))

    with pytest.raises(ForestryShapefileError, match="DBF schema mismatch"):
        load_forestry_shapefile(shp_path)


def test_rejects_non_polygon_shape_type(tmp_path: Path) -> None:
    shp_path = _write_family(tmp_path, [_source_row()], shape_type=3)

    with pytest.raises(ForestryShapefileError, match="Unsupported shape type 3"):
        load_forestry_shapefile(shp_path)


def test_rejects_record_count_disagreement(tmp_path: Path) -> None:
    shp_path = _write_family(tmp_path, [_source_row()], shx_extra_records=1)

    with pytest.raises(ForestryShapefileError, match="record counts disagree"):
        load_forestry_shapefile(shp_path)


def test_rejects_soft_deleted_records(tmp_path: Path) -> None:
    shp_path = _write_family(
        tmp_path,
        [_source_row(), _source_row(objectid=2)],
        deleted_records=frozenset({1}),
    )

    with pytest.raises(ForestryShapefileError, match="soft-deleted"):
        load_forestry_shapefile(shp_path)


def test_rejects_empty_family(tmp_path: Path) -> None:
    shp_path = _write_family(tmp_path, [])

    with pytest.raises(ForestryShapefileError, match="no features"):
        load_forestry_shapefile(shp_path)


def test_rejects_missing_shapefile(tmp_path: Path) -> None:
    with pytest.raises(ForestryShapefileError, match="does not exist"):
        load_forestry_shapefile(tmp_path / "missing.shp")


def test_rejects_unparseable_numeric_value(tmp_path: Path) -> None:
    shp_path = _write_family(tmp_path, [_source_row(objectid="**")])

    with pytest.raises(ForestryShapefileError, match="Unparseable numeric value"):
        load_forestry_shapefile(shp_path)
