from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from transelec_ingestion.domain_evidence import analyze_domain_evidence
from transelec_ingestion.xlsx_contract import ResumenSourceRow


def _norm(value: Any) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def _numeric(value: Any) -> float | None:
    if value is None:
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@dataclass(frozen=True, slots=True)
class PredioAreaRow:
    source_row_number: int
    numero_area_corta: str | None
    estado: str | None
    estado_resumido: str | None
    superficie_corta: float | None
    numero_ingreso: str | None
    fecha_ingreso: Any
    rol: str | None
    empresa: str | None
    sector: str | None
    tramite: str | None
    tipo_propietario: str | None
    pas: str | None
    tipo_rechazo: str | None


@dataclass(frozen=True, slots=True)
class PredioGroup:
    provisional_predio_id: str | None
    rows: tuple[PredioAreaRow, ...]


@dataclass(frozen=True, slots=True)
class PmfListItem:
    pmf: str
    row_count: int
    predio_count: int
    sectors: tuple[str, ...]
    empresas: tuple[str, ...]
    statuses: tuple[str, ...]
    surface_total: float | None


@dataclass(frozen=True, slots=True)
class PmfDetail:
    pmf: str
    row_count: int
    statuses: tuple[str, ...]
    predios: tuple[PredioGroup, ...]


@dataclass(frozen=True, slots=True)
class TranselecFilterOptions:
    statuses: tuple[str, ...]
    sectors: tuple[str, ...]
    empresas: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class TranselecSummary:
    business_rows: int
    distinct_pmf: int
    distinct_provisional_predio_ids: int
    surface_total: float
    status_breakdown: tuple[tuple[str, int], ...]


def list_filter_options(rows: Iterable[ResumenSourceRow]) -> TranselecFilterOptions:
    statuses: set[str] = set()
    sectors: set[str] = set()
    empresas: set[str] = set()

    for row in rows:
        status = _norm(row.values["estado_resumido"])
        sector = _norm(row.values["sector"])
        empresa = _norm(row.values["empresa"])

        if status is not None:
            statuses.add(status)
        if sector is not None:
            sectors.add(sector)
        if empresa is not None:
            empresas.add(empresa)

    return TranselecFilterOptions(
        statuses=tuple(sorted(statuses)),
        sectors=tuple(sorted(sectors)),
        empresas=tuple(sorted(empresas)),
    )


def _row_matches(
    row: ResumenSourceRow,
    *,
    search: str | None,
    status: str | None,
    sector: str | None,
    empresa: str | None,
) -> bool:
    if status is not None:
        row_status = _norm(row.values["estado_resumido"])
        if row_status is None or row_status.lower() != status.lower():
            return False

    if sector is not None:
        row_sector = _norm(row.values["sector"])
        if row_sector is None or row_sector.lower() != sector.lower():
            return False

    if empresa is not None:
        row_empresa = _norm(row.values["empresa"])
        if row_empresa is None or row_empresa.lower() != empresa.lower():
            return False

    if search is not None:
        needle = search.strip().lower()

        if needle:
            haystacks = (
                row.pmf,
                row.provisional_predio_id or "",
                _norm(row.values["rol"]) or "",
                _norm(row.values["numero_predio"]) or "",
            )

            if not any(needle in haystack.lower() for haystack in haystacks):
                return False

    return True


def list_pmfs(
    rows: Iterable[ResumenSourceRow],
    *,
    search: str | None = None,
    status: str | None = None,
    sector: str | None = None,
    empresa: str | None = None,
) -> tuple[PmfListItem, ...]:
    matched = [
        row
        for row in rows
        if _row_matches(row, search=search, status=status, sector=sector, empresa=empresa)
    ]

    grouped: dict[str, list[ResumenSourceRow]] = defaultdict(list)

    for row in matched:
        grouped[row.pmf].append(row)

    items: list[PmfListItem] = []

    for pmf in sorted(grouped):
        pmf_rows = grouped[pmf]

        predios = {
            row.provisional_predio_id for row in pmf_rows if row.provisional_predio_id is not None
        }
        sectors = {
            sector_value
            for row in pmf_rows
            if (sector_value := _norm(row.values["sector"])) is not None
        }
        empresas = {
            empresa_value
            for row in pmf_rows
            if (empresa_value := _norm(row.values["empresa"])) is not None
        }
        statuses = {
            status_value
            for row in pmf_rows
            if (status_value := _norm(row.values["estado_resumido"])) is not None
        }
        numeric_surfaces = [
            surface_value
            for row in pmf_rows
            if (surface_value := _numeric(row.values["superficie_corta"])) is not None
        ]

        items.append(
            PmfListItem(
                pmf=pmf,
                row_count=len(pmf_rows),
                predio_count=len(predios),
                sectors=tuple(sorted(sectors)),
                empresas=tuple(sorted(empresas)),
                statuses=tuple(sorted(statuses)),
                surface_total=sum(numeric_surfaces) if numeric_surfaces else None,
            )
        )

    return tuple(items)


def get_pmf_detail(rows: Iterable[ResumenSourceRow], pmf: str) -> PmfDetail | None:
    pmf_rows = [row for row in rows if row.pmf == pmf]

    if not pmf_rows:
        return None

    statuses = {
        value for row in pmf_rows if (value := _norm(row.values["estado_resumido"])) is not None
    }

    rows_by_predio: dict[str | None, list[ResumenSourceRow]] = defaultdict(list)

    for row in pmf_rows:
        rows_by_predio[row.provisional_predio_id].append(row)

    def _row_sort_key(row: ResumenSourceRow) -> tuple[str, int]:
        return (_norm(row.values["numero_area_corta"]) or "", row.source_row_number)

    ordered_predio_ids: list[str | None] = []
    ordered_predio_ids.extend(
        sorted(predio_id for predio_id in rows_by_predio if predio_id is not None)
    )

    if None in rows_by_predio:
        ordered_predio_ids.append(None)

    predios = tuple(
        PredioGroup(
            provisional_predio_id=predio_id,
            rows=tuple(
                PredioAreaRow(
                    source_row_number=row.source_row_number,
                    numero_area_corta=_norm(row.values["numero_area_corta"]),
                    estado=_norm(row.values["estado"]),
                    estado_resumido=_norm(row.values["estado_resumido"]),
                    superficie_corta=_numeric(row.values["superficie_corta"]),
                    numero_ingreso=_norm(row.values["numero_ingreso"]),
                    fecha_ingreso=row.values["fecha_ingreso"],
                    rol=_norm(row.values["rol"]),
                    empresa=_norm(row.values["empresa"]),
                    sector=_norm(row.values["sector"]),
                    tramite=_norm(row.values["tramite"]),
                    tipo_propietario=_norm(row.values["tipo_propietario"]),
                    pas=_norm(row.values["pas"]),
                    tipo_rechazo=_norm(row.values["tipo_rechazo"]),
                )
                for row in sorted(rows_by_predio[predio_id], key=_row_sort_key)
            ),
        )
        for predio_id in ordered_predio_ids
    )

    return PmfDetail(
        pmf=pmf,
        row_count=len(pmf_rows),
        statuses=tuple(sorted(statuses)),
        predios=predios,
    )


def build_summary(rows: Iterable[ResumenSourceRow]) -> TranselecSummary:
    evidence = analyze_domain_evidence(rows)

    return TranselecSummary(
        business_rows=evidence.business_rows,
        distinct_pmf=evidence.distinct_pmf,
        distinct_provisional_predio_ids=evidence.distinct_provisional_predio_ids,
        surface_total=evidence.surface_sum,
        status_breakdown=evidence.summarized_status_counts,
    )
