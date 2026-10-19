"""Excel de cosecha (formato Campo Digital) for Rodales management reports.

Writes an ``.xlsx`` workbook with a «Resumen» sheet and one detail sheet per
(species group, predio) combination, matching the layout of the client's
harvest identification table.

Column mapping decisions (FACT, Javier Campo Digital 2026-10-19 unless noted):

- ``predio``           = ``nom_predio``
- ``actividad``        = report type in lower case (cosecha/manejo/reforestación)
- ``rodal``            = ``n_rodal`` of the managed polygon (e.g. "766-1")
- ``superficie (ha)``  = sum of ``sup_ha`` over ALL report rows that share the
                         same source polygon (objectid); this is the area of the
                         whole source rodal.  FACT (Javier 2026-10-19):
                         «superficie» = área del rodal completo.
- ``superficie corta (ha)`` = the managed polygon's own ``sup_ha``.
                         FACT (Javier 2026-10-19): «superficie corta» = área
                         que efectivamente se corta/manejará.
- ``especie``          = parsed from ``cod_uso_2026`` (see forestry_species.py)
- ``año plantación``   = parsed from ``cod_uso_2026`` (see forestry_species.py)
- ``año corta``        = year of ``report_date``; falls back to the year in
                         ``report_month`` for legacy month-only reports.
- ``plan de manejo``   = «sí» if the report has a CONAF solicitud number, else «no»
- ``sector``           = blank (FACT, Javier 2026-10-19: sector is general,
                         approximate knowledge, not recorded in the base)
- ``pendiente (%)``    = blank (not in the base)
- ``densidad actual``  = blank (not in the base)
- ``especie a reforestar`` = blank in this version (FACT, Javier 2026-10-19:
                         the reforestation species changes per rodal and can be
                         several; capturing it needs per-polygon fields in the
                         report editor — NEXT STEP, not built here)
- ``densidad reforestación`` = blank in this version (same reason as above)

Sheets are ordered by species (SPECIES_ORDER from forestry_species) then predio.
Sheet names are ≤31 chars, unique, and contain no ``[]:*?/\\`` characters.
Polygons without a recognised species go to a «Sin especie» sheet.

Numbers: hectares with 2 decimal places.  Header rows frozen below row 5.
"""

from __future__ import annotations

import io
import re
from collections import defaultdict
from collections.abc import Sequence
from typing import Any

import xlsxwriter
import xlsxwriter.worksheet

from app.forestry_report_export import TYPE_LABELS, ExportReport, ExportRow
from app.forestry_species import (
    ENSAYO_KEY,
    ENSAYO_LABEL,
    NO_SPECIES_KEY,
    SPECIES_ORDER,
    plantation_year,
    species_group_key,
    species_label,
)

# ---------------------------------------------------------------------------
# Column layout (0-indexed; column A = 0 is left empty like the reference)
# ---------------------------------------------------------------------------

_COL_PREDIO = 1  # B
_COL_SECTOR = 2  # C
_COL_ACTIVIDAD = 3  # D
_COL_RODAL = 4  # E
_COL_SUP = 5  # F  superficie (ha)
_COL_ESPECIE = 6  # G
_COL_ANO_PLANT = 7  # H  año plantación
_COL_PENDIENTE = 8  # I  pendiente (%)
_COL_DENSIDAD = 9  # J  densidad actual
_COL_SUP_CORTA = 10  # K  superficie corta (ha)
_COL_ANO_CORTA = 11  # L  año corta
_COL_ESP_REFOR = 12  # M  especie a reforestar
_COL_DENS_REFOR = 13  # N  densidad reforestación
_COL_PLAN = 14  # O  plan de manejo
_N_DATA_COLS = 14  # columns B–O


def _report_year(report: ExportReport) -> int:
    """Year of the report: from report_date if set, else from report_month."""
    if report.report_date is not None:
        return report.report_date.year
    # report_month is "YYYY-MM"
    return int(report.report_month.split("-")[0])


def _safe_sheet_name(raw: str, used: set[str]) -> str:
    """Strip forbidden chars, truncate to 31, ensure unique."""
    cleaned = re.sub(r"[\\\[\]:*?/]", "", raw)
    # Normalise to ASCII for safety (accents stay if xlsxwriter handles them)
    base = cleaned[:31]
    if base not in used:
        return base
    for i in range(2, 100):
        suffix = f" {i}"
        candidate = cleaned[: 31 - len(suffix)] + suffix
        if candidate not in used:
            return candidate
    return base  # last resort


def _actividad_label(report_type: str) -> str:
    """Lower-case actividad label for the row."""
    return TYPE_LABELS.get(report_type, report_type).lower()


def _species_sort_key(group_key: str) -> tuple[int, ...]:
    """Sort key for a species group key (SPECIES_ORDER index of first token)."""
    if group_key in (ENSAYO_KEY, NO_SPECIES_KEY):
        return (len(SPECIES_ORDER) + 1,)
    tokens = group_key.split("+")
    indices = []
    for t in tokens:
        try:
            indices.append(SPECIES_ORDER.index(t))
        except ValueError:
            indices.append(len(SPECIES_ORDER))
    return tuple(sorted(indices))


# ---------------------------------------------------------------------------
# Public writer
# ---------------------------------------------------------------------------


def write_harvest_xlsx(report: ExportReport, rows: Sequence[ExportRow]) -> bytes:
    """Build the harvest Excel workbook and return its bytes."""

    year = _report_year(report)
    plan_de_manejo = "sí" if getattr(report, "conaf_solicitud", None) else "no"
    actividad = _actividad_label(report.report_type)

    # --- pre-compute source-rodal total superficie by objectid ---------------
    # Uses ALL rows (both in_report and not) so that split-rodal pieces are
    # correctly summed into the whole-rodal area.
    sup_by_source: dict[object, float] = defaultdict(float)
    for row in rows:
        oid = row.attributes.get("objectid")
        sup_ha = row.attributes.get("sup_ha") or 0.0
        sup_by_source[oid] += float(sup_ha)

    # --- only managed (in_report) rows go into the harvest table -------------
    managed = [r for r in rows if r.in_report]

    # --- group by (species_group_key, predio) --------------------------------
    # Use a dict to preserve insertion order; sort afterwards.
    groups: dict[tuple[str, str], list[ExportRow]] = defaultdict(list)
    for row in managed:
        code = row.attributes.get("cod_uso_2026")
        predio = str(row.attributes.get("nom_predio") or "")
        key = (species_group_key(code), predio)
        groups[key].append(row)

    # Sort: by species order first, then predio alphabetically.
    sorted_groups = sorted(
        groups.items(),
        key=lambda item: (_species_sort_key(item[0][0]), item[0][1].lower()),
    )

    # --- build workbook -------------------------------------------------------
    buffer = io.BytesIO()
    workbook = xlsxwriter.Workbook(buffer, {"in_memory": True})

    bold = workbook.add_format({"bold": True})
    title_fmt = workbook.add_format({"bold": True, "font_size": 11})
    header_fmt = workbook.add_format(
        {"bold": True, "align": "center", "valign": "vcenter", "text_wrap": True, "border": 1}
    )
    total_fmt = workbook.add_format({"bold": True, "border": 1})
    num_fmt = workbook.add_format({"num_format": "0.00", "border": 1})
    num_total_fmt = workbook.add_format({"bold": True, "num_format": "0.00", "border": 1})
    cell_fmt = workbook.add_format({"border": 1})

    # --- Resumen sheet --------------------------------------------------------
    _write_resumen(
        workbook,
        sorted_groups,
        year,
        title_fmt,
        bold,
        header_fmt,
        total_fmt,
        num_fmt,
        num_total_fmt,
        cell_fmt,
        sup_by_source,
    )

    # --- Detail sheets --------------------------------------------------------
    used_names: set[str] = {"Resumen"}
    for (sp_key, predio), group_rows in sorted_groups:
        sp_lbl = _group_key_to_label(sp_key)
        sp_lbl_title = _group_key_to_title_label(sp_key)
        sheet_name = _safe_sheet_name(f"{sp_lbl} - {predio}", used_names)
        used_names.add(sheet_name)
        ws = workbook.add_worksheet(sheet_name)

        title = (
            f"TABLA DE IDENTIFICACIÓN DE RODALES {sp_lbl_title.upper()} "
            f"QUE ESTAN CONSIDERADOS EN COSECHA FORESTAL "
            f"DURANTE LA TEMPORADA {year} - PREDIO {predio.upper()}"
        )

        _write_detail_sheet(
            ws=ws,
            title=title,
            group_rows=group_rows,
            report=report,
            year=year,
            actividad=actividad,
            plan_de_manejo=plan_de_manejo,
            sup_by_source=sup_by_source,
            sp_key=sp_key,
            title_fmt=title_fmt,
            header_fmt=header_fmt,
            total_fmt=total_fmt,
            num_fmt=num_fmt,
            num_total_fmt=num_total_fmt,
            cell_fmt=cell_fmt,
        )

    workbook.close()
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _group_key_to_label(key: str) -> str:
    """Human-readable label for the sheet name (short form)."""
    if key == ENSAYO_KEY:
        return ENSAYO_LABEL
    if key == NO_SPECIES_KEY:
        return "Sin especie"
    tokens = key.split("+")
    from app.forestry_species import SPECIES

    if len(tokens) == 1:
        name = SPECIES.get(tokens[0], tokens[0])
        return name[0].upper() + name[1:]
    names = [SPECIES.get(t, t) for t in tokens]
    return "Mixta: " + " + ".join(names)


def _group_key_to_title_label(key: str) -> str:
    """Species label for the sheet title row (full form for display)."""
    return _group_key_to_label(key)


def _write_resumen(
    workbook: xlsxwriter.Workbook,
    sorted_groups: list[tuple[tuple[str, str], list[ExportRow]]],
    year: int,
    title_fmt: Any,
    bold: Any,
    header_fmt: Any,
    total_fmt: Any,
    num_fmt: Any,
    num_total_fmt: Any,
    cell_fmt: Any,
    sup_by_source: dict[Any, float],
) -> None:
    ws = workbook.add_worksheet("Resumen")

    # Row 2, col B: title
    ws.write(1, 1, f"COSECHA TEMPORADA {year}-{year + 1}", title_fmt)

    # Row 3: headers
    ws.write(2, 1, "predio", header_fmt)
    ws.write(2, 2, "especie cosechar", header_fmt)
    ws.write(2, 3, "superficie cosecha", header_fmt)

    # Compute per-group sums (superficie corta = managed area per row)
    data_row = 3  # 0-indexed row 3 = excel row 4
    total_sup = 0.0
    for (sp_key, predio), group_rows in sorted_groups:
        sp_lbl = _group_key_to_label(sp_key)
        group_sup_corta = sum(float(r.attributes.get("sup_ha") or 0.0) for r in group_rows)
        ws.write(data_row, 1, predio, cell_fmt)
        ws.write(data_row, 2, sp_lbl, cell_fmt)
        ws.write_number(data_row, 3, group_sup_corta, num_fmt)
        total_sup += group_sup_corta
        data_row += 1

    # Total row
    ws.write(data_row, 1, "Total", total_fmt)
    ws.write(data_row, 2, None, total_fmt)
    ws.write_number(data_row, 3, total_sup, num_total_fmt)

    # Sensible column widths
    ws.set_column(1, 1, 25)  # predio
    ws.set_column(2, 2, 30)  # especie cosechar
    ws.set_column(3, 3, 20)  # superficie cosecha


def _write_detail_sheet(
    ws: Any,
    title: str,
    group_rows: list[ExportRow],
    report: ExportReport,
    year: int,
    actividad: str,
    plan_de_manejo: str,
    sup_by_source: dict[Any, float],
    sp_key: str,
    title_fmt: Any,
    header_fmt: Any,
    total_fmt: Any,
    num_fmt: Any,
    num_total_fmt: Any,
    cell_fmt: Any,
) -> None:
    # Row 2: title (column B)
    ws.write(1, 1, title, title_fmt)

    # Row 4: label headers (0-indexed row 3)
    ws.write(3, _COL_PREDIO, "predio", header_fmt)
    ws.write(3, _COL_SECTOR, "sector", header_fmt)
    ws.write(3, _COL_ACTIVIDAD, "actividad", header_fmt)
    ws.write(3, _COL_RODAL, "rodal", header_fmt)
    ws.write(3, _COL_SUP, "superficie", header_fmt)
    ws.write(3, _COL_ESPECIE, "especie", header_fmt)
    ws.write(3, _COL_ANO_PLANT, "año plantación", header_fmt)
    ws.write(3, _COL_PENDIENTE, "pendiente", header_fmt)
    ws.write(3, _COL_DENSIDAD, "densidad", header_fmt)
    ws.write(3, _COL_SUP_CORTA, "superficie corta", header_fmt)
    ws.write(3, _COL_ANO_CORTA, "año corta", header_fmt)
    ws.write(3, _COL_ESP_REFOR, "especie a", header_fmt)
    ws.write(3, _COL_DENS_REFOR, "densidad", header_fmt)
    ws.write(3, _COL_PLAN, "plan de", header_fmt)

    # Row 5: units row (0-indexed row 4)
    ws.write(4, _COL_SUP, "(ha)", header_fmt)
    ws.write(4, _COL_ESPECIE, "cosechar", header_fmt)
    ws.write(4, _COL_PENDIENTE, "(%)", header_fmt)
    ws.write(4, _COL_DENSIDAD, "actual", header_fmt)
    ws.write(4, _COL_SUP_CORTA, "(ha)", header_fmt)
    ws.write(4, _COL_ESP_REFOR, "reforestar", header_fmt)
    ws.write(4, _COL_DENS_REFOR, "reforestación", header_fmt)
    ws.write(4, _COL_PLAN, "manejo", header_fmt)
    # Fill remaining header cells to maintain borders
    for col in (
        _COL_PREDIO,
        _COL_SECTOR,
        _COL_ACTIVIDAD,
        _COL_RODAL,
        _COL_ANO_PLANT,
        _COL_ANO_CORTA,
    ):
        ws.write(4, col, None, header_fmt)

    # Freeze panes below the two header rows (below row 5 = row index 5)
    ws.freeze_panes(5, 0)

    # Data rows
    data_start = 5  # 0-indexed row 5 = excel row 6
    total_sup = 0.0
    total_sup_corta = 0.0

    for i, row in enumerate(group_rows):
        r = data_start + i
        attrs = row.attributes
        code = attrs.get("cod_uso_2026")
        predio = str(attrs.get("nom_predio") or "")
        rodal = str(attrs.get("n_rodal") or "")
        sup_corta = float(attrs.get("sup_ha") or 0.0)
        oid = attrs.get("objectid")
        sup = sup_by_source.get(oid, sup_corta)
        sp_lbl = species_label(code)
        ano_plant = plantation_year(code)

        ws.write(r, _COL_PREDIO, predio, cell_fmt)
        ws.write(r, _COL_SECTOR, None, cell_fmt)  # blank
        ws.write(r, _COL_ACTIVIDAD, actividad, cell_fmt)
        ws.write(r, _COL_RODAL, rodal, cell_fmt)
        ws.write_number(r, _COL_SUP, sup, num_fmt)
        ws.write(r, _COL_ESPECIE, sp_lbl, cell_fmt)
        if ano_plant is not None:
            ws.write_number(r, _COL_ANO_PLANT, ano_plant, cell_fmt)
        else:
            ws.write(r, _COL_ANO_PLANT, None, cell_fmt)
        ws.write(r, _COL_PENDIENTE, None, cell_fmt)  # blank
        ws.write(r, _COL_DENSIDAD, None, cell_fmt)  # blank
        ws.write_number(r, _COL_SUP_CORTA, sup_corta, num_fmt)
        ws.write_number(r, _COL_ANO_CORTA, year, cell_fmt)
        ws.write(r, _COL_ESP_REFOR, None, cell_fmt)  # blank
        ws.write(r, _COL_DENS_REFOR, None, cell_fmt)  # blank
        ws.write(r, _COL_PLAN, plan_de_manejo, cell_fmt)

        total_sup += sup
        total_sup_corta += sup_corta

    # TOTAL row
    total_row = data_start + len(group_rows)
    ws.write(total_row, _COL_PREDIO, "TOTAL", total_fmt)
    for col in (
        _COL_SECTOR,
        _COL_ACTIVIDAD,
        _COL_RODAL,
        _COL_ESPECIE,
        _COL_ANO_PLANT,
        _COL_PENDIENTE,
        _COL_DENSIDAD,
        _COL_ANO_CORTA,
        _COL_ESP_REFOR,
        _COL_DENS_REFOR,
        _COL_PLAN,
    ):
        ws.write(total_row, col, None, total_fmt)
    ws.write_number(total_row, _COL_SUP, total_sup, num_total_fmt)
    ws.write_number(total_row, _COL_SUP_CORTA, total_sup_corta, num_total_fmt)

    # Column widths
    ws.set_column(0, 0, 2)  # A: empty margin
    ws.set_column(_COL_PREDIO, _COL_PREDIO, 20)
    ws.set_column(_COL_SECTOR, _COL_SECTOR, 15)
    ws.set_column(_COL_ACTIVIDAD, _COL_ACTIVIDAD, 14)
    ws.set_column(_COL_RODAL, _COL_RODAL, 10)
    ws.set_column(_COL_SUP, _COL_SUP, 14)
    ws.set_column(_COL_ESPECIE, _COL_ESPECIE, 22)
    ws.set_column(_COL_ANO_PLANT, _COL_ANO_PLANT, 14)
    ws.set_column(_COL_PENDIENTE, _COL_PENDIENTE, 12)
    ws.set_column(_COL_DENSIDAD, _COL_DENSIDAD, 14)
    ws.set_column(_COL_SUP_CORTA, _COL_SUP_CORTA, 16)
    ws.set_column(_COL_ANO_CORTA, _COL_ANO_CORTA, 10)
    ws.set_column(_COL_ESP_REFOR, _COL_ESP_REFOR, 18)
    ws.set_column(_COL_DENS_REFOR, _COL_DENS_REFOR, 16)
    ws.set_column(_COL_PLAN, _COL_PLAN, 12)
