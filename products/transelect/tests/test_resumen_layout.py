"""Layout variations the ``Resumen`` resolver must reconcile or refuse.

Every workbook here is synthetic and built in ``tmp_path``. The real
09-Sept-2026 workbook is exercised only by the opt-in private test at the
bottom, which reads it from a local path and commits nothing from it.
"""

from __future__ import annotations

import datetime as dt
import os
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
import xlsxwriter

from transelec_ingestion.import_projection import read_validated_workbook
from transelec_ingestion.resumen_layout import (
    ALIAS_INDEX,
    FIELD_SPECS,
    chronology_flags,
    column_letter,
    normalize_header,
)
from transelec_ingestion.xlsx_contract import (
    CURRENT_RESUMEN_COLUMNS,
    EXPECTED_RESUMEN_HEADERS,
    TranselecWorkbook,
    TranselecWorkbookError,
    load_transelec_workbook,
)

CURRENT_HEADERS = tuple(header for header, _ in CURRENT_RESUMEN_COLUMNS)


@dataclass(frozen=True)
class Formula:
    expression: str
    cached: Any = None
    strip_cache: bool = False


def _base_values(**overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "pmf": "MP001",
        "carpeta_source": "001 TRAMO MP001",
        "estado": "En Evaluacion",
        "estado_resumido": "En tramite",
        "tipo_propietario": "Particular",
        "rol": "100-1",
        "numero_predio": "1",
        "superficie_corta": 1.5,
        "numero_ingreso": "ING-1",
        "empresa": "Forestal Sur",
        "id_predio_unico": "MP001-100-1",
        "tramite": "PAS 148",
        "carpeta_normalizada": "Maullin",
        "sector": "Norte",
    }
    values.update(overrides)
    return values


def _row(headers: tuple[str, ...], fields: tuple[str | None, ...], values: dict[str, Any]) -> list:
    return [values.get(field) if field else None for field in fields]


def _write(
    path: Path,
    headers: list[Any],
    rows: list[list[Any]],
    *,
    sheet_name: str = "Resumen",
    header_row: int = 0,
    preamble: list[list[Any]] | None = None,
    extra_sheets: tuple[str, ...] = (),
) -> Path:
    workbook = xlsxwriter.Workbook(path)
    date_format = workbook.add_format({"num_format": "dd-mm-yyyy"})
    worksheet = workbook.add_worksheet(sheet_name)
    for name in extra_sheets:
        workbook.add_worksheet(name)

    for row_index, preamble_row in enumerate(preamble or []):
        for column, value in enumerate(preamble_row):
            if value is not None:
                worksheet.write(row_index, column, value)

    for column, header in enumerate(headers):
        if header is not None:
            worksheet.write(header_row, column, header)

    strip: list[str] = []
    for offset, values in enumerate(rows, start=1):
        row_index = header_row + offset
        for column, value in enumerate(values):
            if value is None:
                continue
            if isinstance(value, Formula):
                cached = value.cached
                if isinstance(cached, dt.date):
                    cached = (cached - dt.date(1899, 12, 30)).days
                worksheet.write_formula(row_index, column, value.expression, date_format, cached)
                if value.strip_cache:
                    strip.append(f"{column_letter(column)}{row_index + 1}")
            elif isinstance(value, dt.date):
                worksheet.write_datetime(
                    row_index, column, dt.datetime.combine(value, dt.time()), date_format
                )
            else:
                worksheet.write(row_index, column, value)
    workbook.close()

    if strip:
        _strip_cached_values(path, strip)
    return path


def _strip_cached_values(path: Path, refs: list[str]) -> None:
    """Remove the cached ``<v>`` of the given formula cells, as a file saved
    by a script (rather than by Excel) would have."""

    with zipfile.ZipFile(path) as source:
        parts = {info.filename: source.read(info.filename) for info in source.infolist()}
    xml = parts["xl/worksheets/sheet1.xml"].decode()
    for ref in refs:
        xml = re.sub(rf'(<c r="{ref}"[^>]*>)(<f>[^<]*</f>)<v>[^<]*</v>', r"\1\2", xml)
    parts["xl/worksheets/sheet1.xml"] = xml.encode()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as target:
        for name, data in parts.items():
            target.writestr(name, data)


def _values(fields: list[str | None], values: dict[str, Any]) -> list[Any]:
    return [values.get(field) if field else None for field in fields]


def _current_layout(path: Path, rows: list[dict[str, Any]], **kwargs: Any) -> Path:
    fields = tuple(field for _, field in CURRENT_RESUMEN_COLUMNS)
    return _write(
        path, list(CURRENT_HEADERS), [_row(CURRENT_HEADERS, fields, r) for r in rows], **kwargs
    )


def _issues(workbook: TranselecWorkbook, severity: str | None = None) -> list[tuple[str, ...]]:
    return [
        (issue.code, *issue.columns)
        for issue in workbook.layout.issues
        if severity is None or issue.severity == severity
    ]


def _mapped(workbook: TranselecWorkbook) -> dict[str, str]:
    return {
        decision.field: decision.column
        for decision in workbook.layout.columns
        if decision.status == "mapped" and decision.field
    }


# ---------------------------------------------------------------------------
# Normalization and alias registry
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [
        ("N° Area de Ref", "n area de ref"),
        ("Nº Área de Ref", "n area de ref"),
        ("  ID_Predo_Unico ", "id predo unico"),
        ("Fecha Término", "fecha termino"),
        ("QUIEN  SOLICITA", "quien solicita"),
        (None, ""),
    ],
)
def test_normalize_header(raw: Any, normalized: str) -> None:
    assert normalize_header(raw) == normalized


def test_alias_index_is_unambiguous_and_distinguishes_near_identical_ids() -> None:
    assert ALIAS_INDEX["id predo unico"] == "id_predio_unico"
    assert ALIAS_INDEX["id predio unicoii"] == "id_predio_unico_ii"
    # The bare "Carpeta" header is never resolved by alias: only by position.
    assert "carpeta" not in ALIAS_INDEX
    assert len({spec.name for spec in FIELD_SPECS}) == len(FIELD_SPECS)


# ---------------------------------------------------------------------------
# The two observed layouts
# ---------------------------------------------------------------------------


def test_current_layout_maps_aef_block_and_both_carpeta_columns(tmp_path: Path) -> None:
    path = _current_layout(
        tmp_path / "current.xlsx",
        [
            _base_values(
                aef="Presentado",
                quien_solicita="Persona A",
                fecha_solicitud=dt.date(2026, 7, 3),
                fecha_corta=dt.date(2026, 7, 9),
                fecha_termino=dt.date(2026, 9, 1),
            ),
            _base_values(pmf="MP002", id_predio_unico="MP002-1"),
        ],
    )

    workbook = load_transelec_workbook(path)

    mapped = _mapped(workbook)
    assert mapped["aef"] == "A"
    assert mapped["fecha_termino"] == "E"
    assert mapped["pmf"] == "I"
    assert mapped["carpeta_source"] == "J"
    assert mapped["carpeta_normalizada"] == "AH"
    assert mapped["sector"] == "AI"

    first, second = workbook.resumen_rows
    assert first.values["aef"] == "Presentado"
    assert first.values["fecha_corta"] == dt.date(2026, 7, 9)
    assert first.values["carpeta_source"] == "001 TRAMO MP001"
    assert first.values["carpeta_normalizada"] == "Maullin"
    # A blank AEF cell stays blank on its own row: nothing is filled down.
    assert second.values["aef"] is None
    assert second.values["quien_solicita"] is None
    assert _issues(workbook, "warning") == []
    assert _issues(workbook, "error") == []


def test_legacy_thirty_column_layout_still_imports(tmp_path: Path) -> None:
    fields = tuple(field for _, field in CURRENT_RESUMEN_COLUMNS[5:])
    path = _write(
        tmp_path / "legacy.xlsx",
        list(EXPECTED_RESUMEN_HEADERS),
        [_row(EXPECTED_RESUMEN_HEADERS, fields, _base_values())],
    )

    workbook = load_transelec_workbook(path)

    assert _mapped(workbook)["pmf"] == "D"
    assert _mapped(workbook)["carpeta_source"] == "E"
    assert _mapped(workbook)["carpeta_normalizada"] == "AC"
    assert workbook.resumen_rows[0].values["aef"] is None
    assert {code for code, *_ in _issues(workbook, "info")} == {"columna_opcional_ausente"}
    assert _issues(workbook, "warning") == []


# ---------------------------------------------------------------------------
# Tolerated variations
# ---------------------------------------------------------------------------


def test_inserted_unknown_column_is_ignored_and_reported(tmp_path: Path) -> None:
    headers = list(CURRENT_HEADERS)
    # Between "PAS" (K) and "Estado", which moves from L to M.
    headers.insert(11, "Observaciones internas")
    fields: list[str | None] = [field for _, field in CURRENT_RESUMEN_COLUMNS]
    fields.insert(11, None)
    values = _base_values()
    row = [values.get(field) if field else "nota libre" for field in fields]
    path = _write(tmp_path / "inserted.xlsx", headers, [row])

    workbook = load_transelec_workbook(path)

    assert ("columna_no_reconocida", "L") in _issues(workbook, "info")
    assert _mapped(workbook)["estado"] == "M"
    assert workbook.resumen_rows[0].values["estado"] == "En Evaluacion"
    assert "nota libre" not in workbook.resumen_rows[0].values.values()


def test_reordered_block_and_aliases_are_mapped_by_name(tmp_path: Path) -> None:
    """The AEF block moved to the end, headers spelled with accents and
    documented aliases; the Carpeta pair keeps its neighbours."""

    legacy_fields = [field for _, field in CURRENT_RESUMEN_COLUMNS[5:]]
    headers = [
        *EXPECTED_RESUMEN_HEADERS,
        "Estado AEF",
        "Solicitante",
        "Fecha de solicitud",
        "Fecha de corta",
        "Fecha Término",
    ]
    fields = [
        *legacy_fields,
        "aef",
        "quien_solicita",
        "fecha_solicitud",
        "fecha_corta",
        "fecha_termino",
    ]
    values = _base_values(aef="Presentado", fecha_termino=dt.date(2026, 10, 1))
    path = _write(tmp_path / "reordered.xlsx", headers, [[values.get(f) for f in fields]])

    workbook = load_transelec_workbook(path)

    mapped = _mapped(workbook)
    assert mapped["aef"] == "AE"
    assert mapped["fecha_termino"] == "AI"
    assert workbook.resumen_rows[0].values["fecha_termino"] == dt.date(2026, 10, 1)
    notes = {d.field: d.note for d in workbook.layout.columns if d.status == "mapped"}
    assert notes["quien_solicita"] == "Alias documentado de «Quien solicita»."


def test_header_below_title_rows_keeps_absolute_row_numbers(tmp_path: Path) -> None:
    fields = tuple(field for _, field in CURRENT_RESUMEN_COLUMNS)
    path = _write(
        tmp_path / "title.xlsx",
        list(CURRENT_HEADERS),
        [_row(CURRENT_HEADERS, fields, _base_values())],
        header_row=2,
        preamble=[["Planilla maestra"], []],
    )

    workbook = load_transelec_workbook(path)

    assert workbook.layout.header_row == 3
    assert workbook.resumen_rows[0].source_row_number == 4


def test_moved_separator_and_pivot_region_are_ignored(tmp_path: Path) -> None:
    """A blank column after the table, then worksheet-local summaries — even
    one whose label repeats a business header — are never parsed."""

    fields = [field for _, field in CURRENT_RESUMEN_COLUMNS]
    headers = [*CURRENT_HEADERS, None, None, None, "Estado"]
    row = [*_row(CURRENT_HEADERS, tuple(fields), _base_values()), None, "Etiquetas", 12, "otro"]
    path = _write(tmp_path / "pivot.xlsx", headers, [row])

    workbook = load_transelec_workbook(path)

    separators = [d.column for d in workbook.layout.columns if d.status == "separator"]
    assert separators == ["AJ"]
    assert [(r.first_column, r.last_column) for r in workbook.layout.auxiliary_regions] == [
        ("AK", "AM")
    ]
    assert workbook.resumen_rows[0].values["estado"] == "En Evaluacion"
    assert _issues(workbook, "error") == []


def test_blank_column_inside_the_table_is_joined_with_a_warning(tmp_path: Path) -> None:
    headers: list[Any] = list(CURRENT_HEADERS)
    fields: list[str | None] = [field for _, field in CURRENT_RESUMEN_COLUMNS]
    headers.insert(20, None)
    fields.insert(20, None)
    path = _write(tmp_path / "gap.xlsx", headers, [_values(fields, _base_values())])

    workbook = load_transelec_workbook(path)

    assert ("columna_vacia_intermedia", "U") in _issues(workbook, "warning")
    assert workbook.resumen_rows[0].values["sector"] == "Norte"


def test_blank_rows_are_skipped_and_rows_without_pmf_are_reported(tmp_path: Path) -> None:
    fields = tuple(field for _, field in CURRENT_RESUMEN_COLUMNS)
    rows = [
        _row(CURRENT_HEADERS, fields, _base_values()),
        [None] * len(fields),
        _row(CURRENT_HEADERS, fields, _base_values(pmf=None, aef="Presentado")),
        _row(CURRENT_HEADERS, fields, _base_values(pmf="MP003")),
    ]
    path = _write(tmp_path / "blanks.xlsx", list(CURRENT_HEADERS), rows)

    workbook = load_transelec_workbook(path)

    assert [row.source_row_number for row in workbook.resumen_rows] == [2, 5]
    issue = next(i for i in workbook.layout.issues if i.code == "fila_sin_pmf")
    assert (issue.severity, issue.rows, issue.columns) == ("warning", (4,), ("I",))


def test_identical_duplicate_header_is_ignored_with_a_warning(tmp_path: Path) -> None:
    headers = [*CURRENT_HEADERS[:30], "Empresa", *CURRENT_HEADERS[30:]]
    fields: list[str | None] = [field for _, field in CURRENT_RESUMEN_COLUMNS]
    fields = [*fields[:30], "empresa", *fields[30:]]
    path = _write(tmp_path / "dup.xlsx", headers, [_values(fields, _base_values())])

    workbook = load_transelec_workbook(path)

    assert ("encabezado_duplicado_identico", "AC", "AE") in _issues(workbook, "warning")
    assert _mapped(workbook)["empresa"] == "AC"


def test_formula_cells_use_cached_values_and_flag_missing_ones(tmp_path: Path) -> None:
    fields = tuple(field for _, field in CURRENT_RESUMEN_COLUMNS)
    cached = _row(
        CURRENT_HEADERS,
        fields,
        _base_values(fecha_termino=Formula("=D2+30", dt.date(2026, 9, 1))),
    )
    uncached = _row(
        CURRENT_HEADERS,
        fields,
        _base_values(pmf="MP002", fecha_termino=Formula("=D3+30", strip_cache=True)),
    )
    path = _write(tmp_path / "formulas.xlsx", list(CURRENT_HEADERS), [cached, uncached])

    workbook = load_transelec_workbook(path)

    first, second = workbook.resumen_rows
    assert first.values["fecha_termino"] == dt.date(2026, 9, 1)
    assert second.values["fecha_termino"] is None
    formula_issue = next(i for i in workbook.layout.issues if i.code == "formula_sin_valor")
    assert (formula_issue.severity, formula_issue.rows, formula_issue.columns) == (
        "warning",
        (3,),
        ("E",),
    )
    assert ("columna_con_formulas", "E") in _issues(workbook, "info")


def test_excel_error_value_is_reported_not_read_as_blank(tmp_path: Path) -> None:
    fields = tuple(field for _, field in CURRENT_RESUMEN_COLUMNS)
    row = _row(CURRENT_HEADERS, fields, _base_values(aef=Formula("=NA()", "#N/A")))
    path = _write(tmp_path / "error.xlsx", list(CURRENT_HEADERS), [row])

    workbook = load_transelec_workbook(path)

    assert workbook.resumen_rows[0].values["aef"] is None
    assert ("error_de_formula", "A") in _issues(workbook, "warning")


def test_text_in_a_date_column_is_reported_and_never_guessed(tmp_path: Path) -> None:
    fields = tuple(field for _, field in CURRENT_RESUMEN_COLUMNS)
    row = _row(CURRENT_HEADERS, fields, _base_values(fecha_corta="09-08-2026"))
    path = _write(tmp_path / "text-date.xlsx", list(CURRENT_HEADERS), [row])

    validated = read_validated_workbook(path)

    assert validated.rows[0].columns["fecha_corta"] is None
    issue = next(
        i for i in validated.mapping_report["issues"] if i["code"] == "fecha_no_reconocida"
    )
    assert (issue["severity"], issue["columns"], issue["rows"]) == ("warning", ["D"], [2])


def test_chronology_inconsistencies_are_warnings_and_dates_are_kept(tmp_path: Path) -> None:
    fields = tuple(field for _, field in CURRENT_RESUMEN_COLUMNS)
    rows = [
        _row(
            CURRENT_HEADERS,
            fields,
            _base_values(
                aef="Solicitado, se puede cortar",
                fecha_solicitud=dt.date(2026, 8, 20),
                fecha_corta=dt.date(2026, 8, 19),
                fecha_termino=dt.date(2026, 9, 1),
            ),
        ),
        _row(
            CURRENT_HEADERS,
            fields,
            _base_values(
                pmf="MP002",
                aef="Presentado",
                fecha_solicitud=dt.date(2026, 8, 5),
                fecha_corta=dt.date(2026, 9, 8),
                fecha_termino=dt.date(2026, 9, 1),
            ),
        ),
    ]
    path = _write(tmp_path / "chronology.xlsx", list(CURRENT_HEADERS), rows)

    validated = read_validated_workbook(path)

    warnings = [
        (issue["code"], issue["rows"], issue["columns"])
        for issue in validated.mapping_report["issues"]
        if issue["severity"] == "warning"
    ]
    assert warnings == [
        ("cronologia_corta_antes_de_solicitud", [2], ["C", "D"]),
        ("cronologia_termino_antes_de_corta", [3], ["D", "E"]),
    ]
    assert validated.rows[0].columns["fecha_corta"] == dt.date(2026, 8, 19)
    assert validated.rows[1].columns["fecha_termino"] == dt.date(2026, 9, 1)
    assert validated.warning_count == 2


@pytest.mark.parametrize(
    ("values", "flags"),
    [
        ({}, ()),
        ({"fecha_solicitud": dt.date(2026, 1, 2), "fecha_corta": dt.date(2026, 1, 2)}, ()),
        (
            {"fecha_solicitud": dt.date(2026, 1, 2), "fecha_termino": dt.date(2026, 1, 1)},
            ("cronologia_termino_antes_de_solicitud",),
        ),
        (
            {
                "fecha_solicitud": dt.date(2026, 1, 5),
                "fecha_corta": dt.date(2026, 1, 4),
                "fecha_termino": dt.date(2026, 1, 3),
            },
            (
                "cronologia_corta_antes_de_solicitud",
                "cronologia_termino_antes_de_corta",
                "cronologia_termino_antes_de_solicitud",
            ),
        ),
        (
            # termino < solicitud < corta: both orderings involving termino
            # are wrong and both are reported.
            {
                "fecha_solicitud": dt.date(2026, 1, 5),
                "fecha_corta": dt.date(2026, 1, 9),
                "fecha_termino": dt.date(2026, 1, 3),
            },
            ("cronologia_termino_antes_de_corta", "cronologia_termino_antes_de_solicitud"),
        ),
        (
            # An unreadable corta never hides termino < solicitud.
            {
                "fecha_solicitud": dt.date(2026, 1, 5),
                "fecha_corta": "pendiente",
                "fecha_termino": dt.date(2026, 1, 3),
            },
            ("cronologia_termino_antes_de_solicitud",),
        ),
    ],
)
def test_chronology_flags(values: dict[str, Any], flags: tuple[str, ...]) -> None:
    assert chronology_flags(values) == flags


def test_sheet_name_tolerates_case_and_ignores_historical_snapshots(tmp_path: Path) -> None:
    fields = tuple(field for _, field in CURRENT_RESUMEN_COLUMNS)
    path = _write(
        tmp_path / "sheet.xlsx",
        list(CURRENT_HEADERS),
        [_row(CURRENT_HEADERS, fields, _base_values())],
        sheet_name="RESUMEN ",
        extra_sheets=("Resumen 16Feb26",),
    )

    assert len(load_transelec_workbook(path).resumen_rows) == 1


# ---------------------------------------------------------------------------
# Refused: ambiguous or conflicting
# ---------------------------------------------------------------------------


def _refused(path: Path) -> list[tuple[str, ...]]:
    with pytest.raises(TranselecWorkbookError) as caught:
        load_transelec_workbook(path)
    assert caught.value.report is not None
    assert caught.value.report.business_rows == 0
    return [
        (issue.code, *issue.columns)
        for issue in caught.value.report.issues
        if issue.severity == "error"
    ]


def test_carpeta_without_a_recognizable_neighbour_is_ambiguous(tmp_path: Path) -> None:
    """Moving the PMF folder away from PMF makes the two Carpeta columns
    indistinguishable by position; the importer refuses rather than pick."""

    fields: list[str | None] = [field for _, field in CURRENT_RESUMEN_COLUMNS]
    headers = list(CURRENT_HEADERS)
    # Move J (carpeta_source) to just after "Estado" (L).
    moved_header, moved_field = headers.pop(9), fields.pop(9)
    headers.insert(11, moved_header)
    fields.insert(11, moved_field)
    path = _write(tmp_path / "ambiguous.xlsx", headers, [_values(fields, _base_values())])

    assert _refused(path) == [("carpeta_ambigua", "L")]


def test_explicit_carpeta_headers_resolve_the_ambiguity(tmp_path: Path) -> None:
    fields: list[str | None] = [field for _, field in CURRENT_RESUMEN_COLUMNS]
    headers = list(CURRENT_HEADERS)
    headers[9] = "Carpeta origen"
    moved_header, moved_field = headers.pop(9), fields.pop(9)
    headers.insert(11, moved_header)
    fields.insert(11, moved_field)
    path = _write(tmp_path / "explicit.xlsx", headers, [_values(fields, _base_values())])

    workbook = load_transelec_workbook(path)

    assert _mapped(workbook)["carpeta_source"] == "L"
    assert workbook.resumen_rows[0].values["carpeta_source"] == "001 TRAMO MP001"


def test_duplicate_header_with_conflicting_values_is_refused(tmp_path: Path) -> None:
    headers = [*CURRENT_HEADERS, "Estado resumido"]
    fields = [field for _, field in CURRENT_RESUMEN_COLUMNS]
    rows = [
        [*[_base_values().get(f) for f in fields], "En tramite"],
        [*[_base_values(pmf="MP002").get(f) for f in fields], "Aprobado"],
    ]
    path = _write(tmp_path / "conflict.xlsx", headers, rows)

    with pytest.raises(TranselecWorkbookError) as caught:
        load_transelec_workbook(path)

    report = caught.value.report
    assert report is not None
    issue = next(i for i in report.issues if i.code == "encabezado_duplicado_conflictivo")
    assert (issue.columns, issue.rows, issue.row_count) == (("M", "AJ"), (3,), 1)
    # Structural only: never a business value in the message.
    assert "Aprobado" not in issue.message


def test_missing_identity_column_is_refused(tmp_path: Path) -> None:
    headers = [h if h != "ID_Predo_Unico" else "Identificador" for h in CURRENT_HEADERS]
    fields = tuple(field for _, field in CURRENT_RESUMEN_COLUMNS)
    path = _write(tmp_path / "no-id.xlsx", headers, [_row(CURRENT_HEADERS, fields, _base_values())])

    assert ("columna_esencial_ausente",) in _refused(path)


def test_two_equally_plausible_header_rows_are_refused(tmp_path: Path) -> None:
    fields = tuple(field for _, field in CURRENT_RESUMEN_COLUMNS)
    path = _write(
        tmp_path / "two-headers.xlsx",
        list(CURRENT_HEADERS),
        [list(CURRENT_HEADERS), _row(CURRENT_HEADERS, fields, _base_values())],
    )

    with pytest.raises(TranselecWorkbookError, match="encabezado_ambiguo"):
        load_transelec_workbook(path)


def test_expected_column_missing_imports_with_a_warning(tmp_path: Path) -> None:
    headers = [h for h in CURRENT_HEADERS if h != "Sector"]
    fields = tuple(field for _, field in CURRENT_RESUMEN_COLUMNS if field != "sector")
    path = _write(
        tmp_path / "no-sector.xlsx", headers, [_row(tuple(headers), fields, _base_values())]
    )

    workbook = load_transelec_workbook(path)

    issue = next(i for i in workbook.layout.issues if i.code == "columna_esperada_ausente")
    assert (issue.severity, issue.field) == ("warning", "sector")
    assert workbook.resumen_rows[0].values["sector"] is None


# ---------------------------------------------------------------------------
# Private: the real 09-Sept-2026 workbook (opt-in, never committed)
# ---------------------------------------------------------------------------

_PRIVATE_WORKBOOK = os.environ.get("TRANSELEC_PRIVATE_WORKBOOK_0909")


@pytest.mark.skipif(
    not _PRIVATE_WORKBOOK, reason="TRANSELEC_PRIVATE_WORKBOOK_0909 not set (private data)"
)
def test_private_09_sept_2026_workbook() -> None:
    """Structural facts about the real workbook; asserts counts and cell
    references only, never a business value."""

    from python_calamine import CalamineWorkbook

    from transelec_ingestion.xlsx_contract import RESUMEN_COLUMNS

    assert _PRIVATE_WORKBOOK is not None
    workbook = load_transelec_workbook(_PRIVATE_WORKBOOK)
    rows = workbook.resumen_rows

    assert len(rows) == 729
    assert len({row.pmf for row in rows}) == 159
    assert sum(1 for row in rows if row.values["aef"]) == 23
    assert sum(1 for row in rows if row.values["quien_solicita"]) == 19
    assert sum(1 for row in rows if row.values["fecha_solicitud"]) == 19
    assert sum(1 for row in rows if row.values["fecha_corta"]) == 23
    assert sum(1 for row in rows if row.values["fecha_termino"]) == 23

    mapped = _mapped(workbook)
    assert (mapped["aef"], mapped["pmf"], mapped["sector"]) == ("A", "I", "AI")
    assert (mapped["carpeta_source"], mapped["carpeta_normalizada"]) == ("J", "AH")
    assert [d.column for d in workbook.layout.columns if d.status == "separator"] == ["AJ"]
    assert workbook.layout.auxiliary_regions[0].first_column == "AK"
    assert _issues(workbook, "error") == []

    chronology = {
        issue.code: issue.rows
        for issue in workbook.layout.issues
        if issue.code.startswith("cronologia_")
    }
    assert chronology == {
        "cronologia_corta_antes_de_solicitud": (315,),
        "cronologia_termino_antes_de_corta": (375,),
    }

    # Regression against contract V1: every legacy field equals a positional
    # read of the same row shifted right by the five inserted columns.
    with CalamineWorkbook.from_path(_PRIVATE_WORKBOOK) as raw_workbook:
        grid = raw_workbook.get_sheet_by_name("Resumen").to_python(skip_empty_area=False)
    for row in rows:
        raw = grid[row.source_row_number - 1]
        for offset, (_, field_name) in enumerate(RESUMEN_COLUMNS):
            cell: Any = raw[5 + offset]
            expected = None if isinstance(cell, str) and not cell.strip() else cell
            assert row.values[field_name] == expected or (
                row.values[field_name] is None
                and isinstance(expected, str)
                and expected.strip() in {"#N/A", "#REF!", "#VALUE!"}
            ), (row.source_row_number, field_name)
