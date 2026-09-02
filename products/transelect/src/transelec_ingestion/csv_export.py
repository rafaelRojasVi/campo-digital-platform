"""TR-FUNC-037's CSV export: field set (TR-OPEN-04) and formula-injection hardening.

**TR-OPEN-04 is not fully resolved by the ratified matrix/audit.** Both
documents confirm the export is 17-of-30 fields and that Actualizable's set
(the most recent file, per the implementation plan's chosen default)
includes ``Predio Ref`` and excludes raw ``Estado`` relative to v0 — but
neither document enumerates the other 15 field names verbatim (confirmed by
direct search of both ratified documents; this is a genuine documentation
gap, not something this module invents a workaround for by re-reading the
real, external HTML source files, which this task must not touch).

``EXPORT_FIELDS_V1`` below is therefore a best-effort, clearly-labeled
default: it satisfies both hard constraints the audit *does* establish
(includes ``predio_ref``, excludes ``estado``, exactly 17 of the 30 A:AD
fields) and otherwise selects the fields the audit calls out as
operationally central (business identity, status, owner, surface, dates,
sector) over ones it calls out as "dead" in the source JS or provisional in
meaning (``hoy_raw`` — never ingestion time and type-inconsistent by
design; ``fecha_90_dias`` — TR-OPEN-03; ``id_predio_unico_ii``/``id_pmf`` —
the Y/Z merged-cell columns, "not read by any TR-FUNC-* logic in V1" per the
design doc; ``tramite`` — 100% empty in the reviewed workbook). The
duplicate-``Carpeta`` column exported is ``carpeta_normalizada`` (AC, not E)
under the single header "Carpeta", following the audit's own observation
that both HTML files' embedded JSON can only keep one ``Carpeta`` value per
row and last-key-wins in a plain JS object literal built by iterating
columns A→AD — this is itself TR-OPEN-02, unresolved, and trivially
revisable (this list is the one place a future correction changes).

This whole field list is a single named constant so TR-OPEN-04's eventual
resolution is a one-place change, per the implementation plan's own
"changeable in one place later" framing — it does not require touching the
router or any test beyond this module's own.

CSV formula-injection hardening is a **separate, mandatory, security**
requirement, independent of the field-set question above: any cell value
beginning with ``=``, ``+``, ``-``, or ``@`` is prefixed with a single quote
before being written, so it can never be interpreted as a live formula by
Excel/LibreOffice/Google Sheets on open ("CSV injection" / "formula
injection"). This is a deliberate, security-motivated divergence from
Javier's raw CSV export (neither HTML file does this), applied uniformly to
every cell regardless of source type — including a legitimate negative
number, which is the accepted, documented trade-off of this class of
mitigation (see OWASP's CSV Injection guidance): a stray ``'`` prefix on a
negative surface value is a much smaller cost than a live formula executing
in a stakeholder's spreadsheet.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
from collections.abc import Mapping, Sequence
from typing import Any

# (destination column name, Spanish CSV header) — see the module docstring
# for the rationale behind each inclusion/exclusion. Order here is the order
# columns are written in the exported file.
EXPORT_FIELDS_V1: tuple[tuple[str, str], ...] = (
    ("pmf", "PMF"),
    ("carpeta_normalizada", "Carpeta"),
    ("pas", "PAS"),
    ("estado_resumido", "Estado resumido"),
    ("tipo_propietario", "Tipo de propietario"),
    ("tipo_rechazo", "Tipo de rechazo"),
    ("rol", "Rol"),
    ("numero_predio", "N Predio"),
    ("numero_area_corta", "N Area de Corta"),
    ("superficie_corta", "Superficie de corta"),
    ("fecha_ingreso", "Fecha de ingreso"),
    ("numero_ingreso", "N Ingreso"),
    ("empresa", "Empresa"),
    ("id_predio_unico", "ID_Predo_Unico"),
    ("sector", "Sector"),
    ("predio_ref", "Predio Ref"),
    ("id_transelec", "ID TRANSELEC"),
)

assert len(EXPORT_FIELDS_V1) == 17  # module-load invariant: TR-OPEN-04's 17-field default

_DANGEROUS_LEADING_CHARACTERS = ("=", "+", "-", "@")

_CSV_DELIMITER = ";"
_CSV_LINE_TERMINATOR = "\r\n"


def neutralize_formula_injection(value: str) -> str:
    """Prefix ``value`` with ``'`` if it begins with =, +, -, or @.

    A leading apostrophe forces spreadsheet software to treat the cell as
    text rather than evaluating it as a formula, without changing the
    visible/copyable content for a human reader inspecting the file in a
    text editor.
    """

    if value and value[0] in _DANGEROUS_LEADING_CHARACTERS:
        return f"'{value}"
    return value


def _render_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        rendered = str(value)
    elif isinstance(value, float):
        rendered = str(int(value)) if value.is_integer() else str(value)
    elif isinstance(value, dt.date | dt.datetime):
        rendered = value.isoformat()
    else:
        rendered = str(value)
    return neutralize_formula_injection(rendered)


def render_transelec_export_csv(rows: Sequence[Mapping[str, Any]]) -> bytes:
    """Render ``rows`` (dicts keyed by destination column name) as export CSV bytes.

    UTF-8 with a BOM and ``;`` delimiter, matching both source HTML files'
    export mechanism, per the source forensic audit. Every cell passes
    through ``neutralize_formula_injection`` — this is the one place the
    hardening is applied, so every caller gets it for free.
    """

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=_CSV_DELIMITER, lineterminator=_CSV_LINE_TERMINATOR)
    writer.writerow(header for _, header in EXPORT_FIELDS_V1)

    for row in rows:
        writer.writerow(_render_cell(row.get(column)) for column, _ in EXPORT_FIELDS_V1)

    return ("\ufeff" + buffer.getvalue()).encode("utf-8")
