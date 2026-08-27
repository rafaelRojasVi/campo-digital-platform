from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from python_calamine import CalamineWorkbook


class TranselecWorkbookError(ValueError):
    """Raised when a workbook does not satisfy the established source contract."""


# The workbook contains two columns both labelled "Carpeta".
# Identity is therefore positional, not header-name based.
RESUMEN_COLUMNS: tuple[tuple[str, str], ...] = (
    ("Predio Ref", "predio_ref"),
    ("Rol Ref", "rol_ref"),
    ("N° Area de Ref", "area_ref"),
    ("PMF", "pmf"),
    ("Carpeta", "carpeta_source"),
    ("PAS", "pas"),
    ("Estado", "estado"),
    ("Estado resumido", "estado_resumido"),
    ("Tipo de rechazo", "tipo_rechazo"),
    ("Reingreso_Tec", "reingreso_tec"),
    ("Reingreso_Legal", "reingreso_legal"),
    ("Reingreso_RecRep", "reingreso_recrep"),
    ("Tipo de propietario", "tipo_propietario"),
    ("ID TRANSELEC", "id_transelec"),
    ("Rol", "rol"),
    ("N Predio", "numero_predio"),
    ("N Area de Corta", "numero_area_corta"),
    ("Superficie de corta", "superficie_corta"),
    ("Superficie de total de corta", "superficie_total_corta"),
    ("Fecha de ingreso", "fecha_ingreso"),
    ("N Ingreso", "numero_ingreso"),
    ("90 dias", "fecha_90_dias"),
    ("Hoy", "hoy"),
    ("Empresa", "empresa"),
    ("ID_Predio_UnicoII", "id_predio_unico_ii"),
    ("ID_PMF", "id_pmf"),
    ("ID_Predo_Unico", "id_predio_unico"),
    ("Tramite", "tramite"),
    ("Carpeta", "carpeta_normalizada"),
    ("Sector", "sector"),
)

EXPECTED_RESUMEN_HEADERS = tuple(header for header, _ in RESUMEN_COLUMNS)


@dataclass(frozen=True, slots=True)
class ResumenSourceRow:
    source_row_number: int
    values: dict[str, Any]

    @property
    def pmf(self) -> str:
        value = self.values["pmf"]
        return str(value).strip()

    @property
    def provisional_predio_id(self) -> str | None:
        value = self.values["id_predio_unico"]
        if value is None:
            return None

        normalized = str(value).strip()
        return normalized or None


@dataclass(frozen=True, slots=True)
class TranselecWorkbook:
    source_path: Path
    sheet_names: tuple[str, ...]
    resumen_rows: tuple[ResumenSourceRow, ...]


def _normalize_header(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    return isinstance(value, str) and not value.strip()


def _validate_resumen_headers(header_row: list[Any]) -> None:
    expected_count = len(EXPECTED_RESUMEN_HEADERS)

    positional_headers = tuple(
        _normalize_header(header_row[index] if index < len(header_row) else None)
        for index in range(expected_count)
    )

    mismatches = [
        (index + 1, expected, actual)
        for index, (expected, actual) in enumerate(
            zip(
                EXPECTED_RESUMEN_HEADERS,
                positional_headers,
                strict=True,
            )
        )
        if expected != actual
    ]

    separator = header_row[expected_count] if len(header_row) > expected_count else None

    if mismatches or not _is_blank(separator):
        raise TranselecWorkbookError(
            "Resumen schema mismatch: "
            f"positional={mismatches}; "
            f"separator_column={expected_count + 1}"
        )


def load_transelec_workbook(path: str | Path) -> TranselecWorkbook:
    source_path = Path(path)

    if not source_path.is_file():
        raise TranselecWorkbookError(f"Workbook does not exist: {source_path}")

    with CalamineWorkbook.from_path(str(source_path)) as workbook:
        sheet_names = tuple(workbook.sheet_names)

        if "Resumen" not in sheet_names:
            raise TranselecWorkbookError('Required worksheet "Resumen" is missing')

        raw_rows = workbook.get_sheet_by_name("Resumen").to_python()

    if not raw_rows:
        raise TranselecWorkbookError('Worksheet "Resumen" is empty')

    header_row = raw_rows[0]
    _validate_resumen_headers(header_row)

    parsed_rows: list[ResumenSourceRow] = []

    for source_row_number, raw_row in enumerate(raw_rows[1:], start=2):
        separator = raw_row[len(RESUMEN_COLUMNS)] if len(raw_row) > len(RESUMEN_COLUMNS) else None

        if not _is_blank(separator):
            raise TranselecWorkbookError(
                "Resumen row contains data in the contract separator: "
                f"row={source_row_number}; "
                f"column={len(RESUMEN_COLUMNS) + 1}"
            )

        values = {
            field_name: (raw_row[index] if index < len(raw_row) else None)
            for index, (_, field_name) in enumerate(RESUMEN_COLUMNS)
        }

        pmf = values["pmf"]

        if pmf is None or not str(pmf).strip():
            continue

        parsed_rows.append(
            ResumenSourceRow(
                source_row_number=source_row_number,
                values=values,
            )
        )

    if not parsed_rows:
        raise TranselecWorkbookError('Worksheet "Resumen" contains no business rows with PMF')

    return TranselecWorkbook(
        source_path=source_path,
        sheet_names=sheet_names,
        resumen_rows=tuple(parsed_rows),
    )
