"""Tests for the harvest Excel export (Excel de cosecha, formato Campo Digital).

Uses synthetic data only — no client values.  Reads the produced bytes back
with python-calamine.

Column index note: calamine's ``to_python()`` strips the leading empty row
(ws row 0, Excel row 1) and the leading empty column A.  The indices used
below reference the *output* rows and columns, not the Excel cells:

  Detail sheet output structure:
    row 0: title (one cell at col 0 = col B in xlsx)
    row 1: empty (between title and headers)
    row 2: header labels (14 columns: predio … plan de)
    row 3: units row (ha, cosechar, %, etc.)
    row 4: first data row
    …
    last: TOTAL row

  Column mapping (output col = xlsx col - 1 because col A is stripped):
    0=predio  1=sector  2=actividad  3=rodal  4=superficie(ha)
    5=especie  6=año_plant  7=pendiente  8=densidad  9=sup_corta(ha)
    10=año_corta  11=esp_refor  12=dens_refor  13=plan_de_manejo

  Resumen output structure:
    row 0: "COSECHA TEMPORADA YYYY-YYYY+1" at col 0
    row 1: headers [predio, especie cosechar, superficie cosecha]
    row 2+: data rows  (col 0=predio, col 1=especie, col 2=superficie)
    last: Total row
"""

from __future__ import annotations

import datetime
import io

import pytest
from app.forestry_report_export import ExportFormat, ExportReport, ExportRow, export_report
from app.forestry_report_harvest_xlsx import write_harvest_xlsx
from python_calamine import CalamineWorkbook
from shapely.geometry import MultiPolygon, box


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _wb(content: bytes) -> CalamineWorkbook:
    return CalamineWorkbook.from_filelike(io.BytesIO(content))


def _sheet(content: bytes, name: str) -> list[list[object]]:
    return _wb(content).get_sheet_by_name(name).to_python()  # type: ignore[return-value]


def _attrs(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "objectid": 1,
        "nom_predio": "Fundo Norte",
        "n_rodal": "101",
        "sup_ha": 5.0,
        "cod_uso_2026": "Pi06",
    }
    base.update(overrides)
    return base


GEOM = MultiPolygon([box(0, 0, 100, 100)])
REPORT_DATE = ExportReport(
    "Cosecha pino 2027",
    "cosecha",
    "2027-01",
    "aprobado",
    datetime.date(2027, 1, 15),
    conaf_solicitud="1234/567-8/27",
)
REPORT_MONTH_ONLY = ExportReport(
    "Cosecha enero 2026",
    "cosecha",
    "2026-01",
    "aprobado",
    None,  # legacy: no exact date
    conaf_solicitud=None,
)


# ---------------------------------------------------------------------------
# Sheet names
# ---------------------------------------------------------------------------


def test_resumen_sheet_exists() -> None:
    rows = [ExportRow(_attrs(), GEOM, True, False)]
    wb = _wb(write_harvest_xlsx(REPORT_DATE, rows))
    assert "Resumen" in wb.sheet_names


def test_detail_sheet_name_contains_species_and_predio() -> None:
    rows = [ExportRow(_attrs(), GEOM, True, False)]
    wb = _wb(write_harvest_xlsx(REPORT_DATE, rows))
    names = wb.sheet_names
    assert any("Pino radiata" in n and "Fundo Norte" in n for n in names), names


def test_sheet_name_max_31_chars() -> None:
    rows = [ExportRow(_attrs(nom_predio="Predio con Nombre Muy Largo SA"), GEOM, True, False)]
    wb = _wb(write_harvest_xlsx(REPORT_DATE, rows))
    for name in wb.sheet_names:
        assert len(name) <= 31, f"Sheet name too long: {name!r}"


def test_sheet_names_are_unique() -> None:
    rows = [
        ExportRow(_attrs(objectid=1, nom_predio="P"), GEOM, True, False),
        ExportRow(_attrs(objectid=2, nom_predio="P"), GEOM, True, False),
    ]
    wb = _wb(write_harvest_xlsx(REPORT_DATE, rows))
    assert len(wb.sheet_names) == len(set(wb.sheet_names))


def test_no_species_sheet_named_sin_especie() -> None:
    rows = [ExportRow(_attrs(cod_uso_2026="BN"), GEOM, True, False)]
    wb = _wb(write_harvest_xlsx(REPORT_DATE, rows))
    names = wb.sheet_names
    assert any("Sin especie" in n for n in names), names


# ---------------------------------------------------------------------------
# Title row
# ---------------------------------------------------------------------------


def test_title_contains_species_predio_and_year() -> None:
    rows = [ExportRow(_attrs(), GEOM, True, False)]
    content = write_harvest_xlsx(REPORT_DATE, rows)
    wb = _wb(content)
    detail_name = [n for n in wb.sheet_names if n != "Resumen"][0]
    sheet = _sheet(content, detail_name)
    # calamine strips leading empty row and col A → title is at output row 0, col 0
    title = sheet[0][0]
    assert isinstance(title, str)
    assert "PINO RADIATA" in title.upper()
    assert "FUNDO NORTE" in title.upper()
    assert "2027" in title


def test_title_temporada_year_from_report_month() -> None:
    """Legacy report with no exact date uses the month's year."""
    rows = [ExportRow(_attrs(), GEOM, True, False)]
    content = write_harvest_xlsx(REPORT_MONTH_ONLY, rows)
    wb = _wb(content)
    detail_name = [n for n in wb.sheet_names if n != "Resumen"][0]
    # title at output row 0, col 0
    title = _sheet(content, detail_name)[0][0]
    assert "2026" in str(title)


# ---------------------------------------------------------------------------
# Header rows
# ---------------------------------------------------------------------------


def test_header_row_labels() -> None:
    rows = [ExportRow(_attrs(), GEOM, True, False)]
    content = write_harvest_xlsx(REPORT_DATE, rows)
    wb = _wb(content)
    detail = [n for n in wb.sheet_names if n != "Resumen"][0]
    sheet = _sheet(content, detail)
    # Headers are at output row 2 (row 0=title, row 1=empty, row 2=headers)
    # Column indices: 0=predio, 3=rodal, 4=superficie, 9=sup_corta, 13=plan_de
    header_labels = sheet[2]
    assert header_labels[0] == "predio"
    assert header_labels[3] == "rodal"
    assert header_labels[4] == "superficie"
    assert header_labels[9] == "superficie corta"
    assert header_labels[13] == "plan de"


def test_units_row() -> None:
    rows = [ExportRow(_attrs(), GEOM, True, False)]
    content = write_harvest_xlsx(REPORT_DATE, rows)
    wb = _wb(content)
    detail = [n for n in wb.sheet_names if n != "Resumen"][0]
    sheet = _sheet(content, detail)
    # Units are at output row 3
    units = sheet[3]
    assert units[4] == "(ha)"    # superficie col
    assert units[9] == "(ha)"    # superficie corta col
    assert units[7] == "(%)"     # pendiente col


# ---------------------------------------------------------------------------
# Split rodal: superficie vs superficie corta
# ---------------------------------------------------------------------------


def test_split_rodal_superficie_includes_both_pieces() -> None:
    """
    Rodal 200 is split: piece A (in_report, 3.0 ha) + piece B (not, 2.0 ha).
    Expected: superficie = 5.0 ha, superficie_corta = 3.0 ha.
    """
    piece_a = ExportRow(_attrs(objectid=200, n_rodal="200-1", sup_ha=3.0), GEOM, True, True)
    piece_b = ExportRow(_attrs(objectid=200, n_rodal="200", sup_ha=2.0), GEOM, False, True)
    rows = [piece_a, piece_b]
    content = write_harvest_xlsx(REPORT_DATE, rows)
    wb = _wb(content)
    detail = [n for n in wb.sheet_names if n != "Resumen"][0]
    sheet = _sheet(content, detail)
    # First data row is at output row 4 (rows 0-3 are title/empty/headers/units)
    data_row = sheet[4]
    sup = data_row[4]       # col F (index 5 in xlsx, 4 in output) = superficie
    sup_corta = data_row[9]  # col K (index 10 in xlsx, 9 in output) = superficie corta
    assert sup == pytest.approx(5.0)
    assert sup_corta == pytest.approx(3.0)


def test_unsplit_rodal_superficie_equals_sup_corta() -> None:
    rows = [ExportRow(_attrs(sup_ha=7.5), GEOM, True, False)]
    content = write_harvest_xlsx(REPORT_DATE, rows)
    wb = _wb(content)
    detail = [n for n in wb.sheet_names if n != "Resumen"][0]
    sheet = _sheet(content, detail)
    data_row = sheet[4]
    assert data_row[4] == pytest.approx(7.5)  # superficie
    assert data_row[9] == pytest.approx(7.5)  # superficie corta


# ---------------------------------------------------------------------------
# TOTAL row
# ---------------------------------------------------------------------------


def test_total_row_sums_superficie_corta() -> None:
    rows = [
        ExportRow(_attrs(objectid=1, sup_ha=3.0), GEOM, True, False),
        ExportRow(_attrs(objectid=2, sup_ha=4.5), GEOM, True, False),
    ]
    content = write_harvest_xlsx(REPORT_DATE, rows)
    wb = _wb(content)
    detail = [n for n in wb.sheet_names if n != "Resumen"][0]
    sheet = _sheet(content, detail)
    total_row = sheet[-1]  # last row
    # col 0 (after stripping col A) = predio col = "TOTAL"
    assert total_row[0] == "TOTAL"
    # col 9 (index 10 in xlsx - 1) = superficie corta
    assert total_row[9] == pytest.approx(7.5)  # 3.0 + 4.5


# ---------------------------------------------------------------------------
# Resumen sheet
# ---------------------------------------------------------------------------


def test_resumen_title_and_headers() -> None:
    rows = [ExportRow(_attrs(), GEOM, True, False)]
    content = write_harvest_xlsx(REPORT_DATE, rows)
    sheet = _sheet(content, "Resumen")
    # Title at row 0, col 0 (leading empty row stripped; col A stripped)
    assert sheet[0][0] == "COSECHA TEMPORADA 2027-2028"
    # Headers at row 1
    headers = sheet[1]
    assert headers[0] == "predio"
    assert headers[1] == "especie cosechar"
    assert headers[2] == "superficie cosecha"


def test_resumen_sums_per_predio_and_species() -> None:
    """Resumen rows: one per (predio, species), surface = sum of sup_ha."""
    rows = [
        ExportRow(
            _attrs(objectid=1, nom_predio="A", cod_uso_2026="Pi06", sup_ha=2.0), GEOM, True, False
        ),
        ExportRow(
            _attrs(objectid=2, nom_predio="A", cod_uso_2026="Pi06", sup_ha=3.0), GEOM, True, False
        ),
        ExportRow(
            _attrs(objectid=3, nom_predio="B", cod_uso_2026="Eg98", sup_ha=4.0), GEOM, True, False
        ),
    ]
    content = write_harvest_xlsx(REPORT_DATE, rows)
    sheet = _sheet(content, "Resumen")
    # Data rows start at row 2 (row 0=title, row 1=headers); exclude Total
    data = [r for r in sheet[2:] if r[0] not in ("", "Total")]
    assert len(data) == 2, data
    sup_by_key = {(r[0], r[1]): r[2] for r in data}
    assert sup_by_key[("A", "Pino radiata")] == pytest.approx(5.0)
    assert sup_by_key[("B", "Eucalyptus globulus")] == pytest.approx(4.0)


def test_resumen_total_row() -> None:
    rows = [
        ExportRow(_attrs(objectid=1, sup_ha=2.0), GEOM, True, False),
        ExportRow(_attrs(objectid=2, sup_ha=3.0), GEOM, True, False),
    ]
    content = write_harvest_xlsx(REPORT_DATE, rows)
    sheet = _sheet(content, "Resumen")
    total_row = sheet[-1]
    assert total_row[0] == "Total"
    assert total_row[2] == pytest.approx(5.0)


# ---------------------------------------------------------------------------
# Plan de manejo (sí / no)
# ---------------------------------------------------------------------------


def test_plan_de_manejo_si_when_conaf_solicitud_set() -> None:
    rows = [ExportRow(_attrs(), GEOM, True, False)]
    content = write_harvest_xlsx(REPORT_DATE, rows)  # REPORT_DATE has conaf_solicitud
    wb = _wb(content)
    detail = [n for n in wb.sheet_names if n != "Resumen"][0]
    sheet = _sheet(content, detail)
    # Data row at output row 4, plan de manejo at output col 13
    assert sheet[4][13] == "sí"


def test_plan_de_manejo_no_when_no_conaf_solicitud() -> None:
    rows = [ExportRow(_attrs(), GEOM, True, False)]
    content = write_harvest_xlsx(REPORT_MONTH_ONLY, rows)  # no conaf_solicitud
    wb = _wb(content)
    detail = [n for n in wb.sheet_names if n != "Resumen"][0]
    sheet = _sheet(content, detail)
    assert sheet[4][13] == "no"


# ---------------------------------------------------------------------------
# Legacy month-only report
# ---------------------------------------------------------------------------


def test_legacy_month_report_uses_month_year() -> None:
    rows = [ExportRow(_attrs(), GEOM, True, False)]
    content = write_harvest_xlsx(REPORT_MONTH_ONLY, rows)
    wb = _wb(content)
    detail = [n for n in wb.sheet_names if n != "Resumen"][0]
    sheet = _sheet(content, detail)
    # Title at output row 0, col 0
    title = sheet[0][0]
    assert "2026" in str(title)
    # año corta at output row 4, col 10 (index 11 in xlsx - 1)
    assert sheet[4][10] == pytest.approx(2026.0)


# ---------------------------------------------------------------------------
# Empty report
# ---------------------------------------------------------------------------


def test_empty_report_produces_valid_workbook() -> None:
    content = write_harvest_xlsx(REPORT_DATE, [])
    wb = _wb(content)
    assert "Resumen" in wb.sheet_names
    assert len(wb.sheet_names) == 1


# ---------------------------------------------------------------------------
# export_report integration
# ---------------------------------------------------------------------------


def test_export_report_xlsx_media_type_and_filename() -> None:
    rows = [ExportRow(_attrs(), GEOM, True, False)]
    content, media_type, filename = export_report("xlsx", REPORT_DATE, rows)
    assert media_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert filename == "Cosecha_pino_2027_cosecha.xlsx"
    assert len(content) > 0


def test_export_report_xlsx_is_valid_workbook() -> None:
    rows = [ExportRow(_attrs(), GEOM, True, False)]
    content, _, _ = export_report("xlsx", REPORT_DATE, rows)
    wb = _wb(content)
    assert "Resumen" in wb.sheet_names


# ---------------------------------------------------------------------------
# Sheets ordered by SPECIES_ORDER then predio
# ---------------------------------------------------------------------------


def test_sheets_ordered_by_species_then_predio() -> None:
    rows = [
        ExportRow(_attrs(objectid=1, cod_uso_2026="Eg98", nom_predio="Z"), GEOM, True, False),
        ExportRow(_attrs(objectid=2, cod_uso_2026="Pi06", nom_predio="A"), GEOM, True, False),
        ExportRow(_attrs(objectid=3, cod_uso_2026="Pi06", nom_predio="Z"), GEOM, True, False),
    ]
    wb = _wb(write_harvest_xlsx(REPORT_DATE, rows))
    # Resumen first, then Pi (index 0 in SPECIES_ORDER) before Eg (index 3),
    # and within Pi: A before Z.
    names = wb.sheet_names
    assert names[0] == "Resumen"
    pi_indices = [i for i, n in enumerate(names) if "Pino radiata" in n]
    eg_indices = [i for i, n in enumerate(names) if "Eucalyptus globulus" in n]
    assert max(pi_indices) < min(eg_indices), "Pi should come before Eg"
    pi_a = next(i for i, n in enumerate(names) if "Pino radiata" in n and "A" in n)
    pi_z = next(i for i, n in enumerate(names) if "Pino radiata" in n and " Z" in n)
    assert pi_a < pi_z
