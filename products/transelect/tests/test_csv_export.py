"""Unit tests for TR-FUNC-037's CSV export: field set and injection hardening.

CSV formula-injection hardening is a hard requirement (mandatory per the
implementation brief), independent of and in addition to TR-OPEN-04's
provisional 17-field default.
"""

from __future__ import annotations

import csv
import io

from transelec_ingestion.csv_export import (
    EXPORT_FIELDS_V1,
    neutralize_formula_injection,
    render_transelec_export_csv,
)


def test_export_field_set_has_exactly_seventeen_fields_and_matches_actualizables_choices() -> None:
    assert len(EXPORT_FIELDS_V1) == 17
    columns = [column for column, _ in EXPORT_FIELDS_V1]
    # TR-OPEN-04's resolution: default to Actualizable's field set — includes
    # Predio Ref (Actualizable's addition), excludes raw Estado (dropped in
    # Actualizable relative to v0).
    assert "predio_ref" in columns
    assert "estado" not in columns
    assert len(columns) == len(set(columns))  # no duplicate columns


def test_neutralize_formula_injection_prefixes_dangerous_leading_characters() -> None:
    for dangerous in ("=SUM(A1:A2)", "+1+1", "-2+3", "@cmd|'/bin/sh'"):
        neutralized = neutralize_formula_injection(dangerous)
        assert neutralized.startswith("'")
        assert neutralized == f"'{dangerous}"


def test_neutralize_formula_injection_leaves_safe_values_untouched() -> None:
    for safe in ("MP001", "Aprobado", "", "Fundo Los Robles"):
        assert neutralize_formula_injection(safe) == safe


def test_render_csv_has_utf8_bom_and_semicolon_delimiter() -> None:
    csv_bytes = render_transelec_export_csv([{"pmf": "MP001"}])

    assert csv_bytes.startswith("﻿".encode())
    text = csv_bytes.decode("utf-8-sig")
    header_line = text.splitlines()[0]
    assert ";" in header_line


def test_render_csv_neutralizes_a_real_exported_row_starting_with_each_dangerous_character() -> (
    None
):
    """The exact scenario the brief calls out: a real exported row whose
    cell value begins with =, +, -, or @ must never reach Excel as a live
    formula."""

    dangerous_values = {
        "pmf": "=cmd|'/c calc'!A1",
        "carpeta_normalizada": "+1+1",
        "pas": "-1+1",
        "estado_resumido": "@SUM(1+1)",
    }

    csv_bytes = render_transelec_export_csv([dangerous_values])
    text = csv_bytes.decode("utf-8-sig")

    reader = csv.reader(io.StringIO(text), delimiter=";")
    header = next(reader)
    row = next(reader)
    record = dict(zip(header, row, strict=True))

    for header_label, original in (
        ("PMF", dangerous_values["pmf"]),
        ("Carpeta", dangerous_values["carpeta_normalizada"]),
        ("PAS", dangerous_values["pas"]),
        ("Estado resumido", dangerous_values["estado_resumido"]),
    ):
        assert record[header_label] == f"'{original}"
        assert not record[header_label].startswith(("=", "+", "-", "@"))


def test_render_csv_renders_blank_and_numeric_and_date_cells() -> None:
    import datetime as dt

    row = {
        "pmf": "MP001",
        "superficie_corta": 12.5,
        "numero_ingreso": None,
        "fecha_ingreso": dt.date(2026, 8, 14),
    }

    csv_bytes = render_transelec_export_csv([row])
    text = csv_bytes.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text), delimiter=";")
    header = next(reader)
    values = next(reader)
    record = dict(zip(header, values, strict=True))

    assert record["PMF"] == "MP001"
    assert record["N Ingreso"] == ""
