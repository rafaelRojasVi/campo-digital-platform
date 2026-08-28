from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from statistics import median
from typing import Any

from transelec_ingestion.xlsx_contract import (
    RESUMEN_COLUMNS,
    ResumenSourceRow,
)

IDENTIFIER_FIELDS = (
    "id_transelec",
    "id_predio_unico",
    "id_predio_unico_ii",
    "id_pmf",
    "rol",
    "numero_predio",
    "numero_area_corta",
    "numero_ingreso",
)


@dataclass(frozen=True, slots=True)
class DomainEvidence:
    business_rows: int
    distinct_pmf: int
    distinct_provisional_predio_ids: int
    distinct_roles: int

    missing_identifiers: tuple[tuple[str, int], ...]

    pmf_with_predio_id: int
    pmf_with_multiple_predios: int
    median_predios_per_pmf: float
    max_predios_per_pmf: int

    predios_with_area_number: int
    predios_with_multiple_area_numbers: int
    median_area_numbers_per_predio: float
    max_area_numbers_per_predio: int

    detailed_status_count: int
    summarized_status_counts: tuple[tuple[str, int], ...]
    conflicting_detailed_status_mappings: tuple[tuple[str, tuple[str, ...]], ...]

    pmf_with_multiple_detailed_statuses: int
    pmf_with_multiple_summarized_statuses: int
    predios_with_multiple_summarized_statuses: int

    pmf_mapping_to_multiple_id_transelec: int
    id_transelec_mapping_to_multiple_pmf: int
    provisional_predio_ids_mapping_to_multiple_pmf: int

    complete_candidate_area_keys: int
    duplicate_candidate_area_key_groups: int
    max_rows_per_candidate_area_key: int

    exact_duplicate_business_row_groups: int
    extra_rows_due_to_exact_duplicates: int

    numeric_surface_rows: int
    missing_or_non_numeric_surface_rows: int
    zero_surface_rows: int
    negative_surface_rows: int
    surface_sum: float

    pmf_with_multiple_numero_ingreso: int
    numero_ingreso_mapping_to_multiple_pmf: int


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


def _median(values: list[int]) -> float:
    if not values:
        return 0.0
    return float(median(values))


def analyze_domain_evidence(
    rows: Iterable[ResumenSourceRow],
) -> DomainEvidence:
    source_rows = tuple(rows)

    if not source_rows:
        raise ValueError("Domain evidence requires at least one source row")

    pmfs = {row.pmf for row in source_rows}
    predio_ids = {
        row.provisional_predio_id for row in source_rows if row.provisional_predio_id is not None
    }
    roles = {value for row in source_rows if (value := _norm(row.values["rol"])) is not None}

    missing_identifiers = tuple(
        (
            field,
            sum(_norm(row.values[field]) is None for row in source_rows),
        )
        for field in IDENTIFIER_FIELDS
    )

    pmf_predios: dict[str, set[str]] = defaultdict(set)
    predio_areas: dict[str, set[str]] = defaultdict(set)

    for row in source_rows:
        predio = row.provisional_predio_id
        area = _norm(row.values["numero_area_corta"])

        if predio is not None:
            pmf_predios[row.pmf].add(predio)

            if area is not None:
                predio_areas[predio].add(area)

    pmf_predio_counts = [len(values) for values in pmf_predios.values()]
    predio_area_counts = [len(values) for values in predio_areas.values()]

    detailed_to_summary: dict[str, set[str]] = defaultdict(set)
    detailed_statuses: set[str] = set()
    summary_counter: Counter[str] = Counter()

    pmf_detailed: dict[str, set[str]] = defaultdict(set)
    pmf_summary: dict[str, set[str]] = defaultdict(set)
    predio_summary: dict[str, set[str]] = defaultdict(set)

    for row in source_rows:
        detailed = _norm(row.values["estado"])
        summary = _norm(row.values["estado_resumido"])
        predio = row.provisional_predio_id

        if detailed is not None:
            detailed_statuses.add(detailed)
            pmf_detailed[row.pmf].add(detailed)

        if summary is not None:
            summary_counter[summary] += 1
            pmf_summary[row.pmf].add(summary)

            if predio is not None:
                predio_summary[predio].add(summary)

        if detailed is not None and summary is not None:
            detailed_to_summary[detailed].add(summary)

    status_conflicts = tuple(
        (detailed, tuple(sorted(summaries)))
        for detailed, summaries in sorted(detailed_to_summary.items())
        if len(summaries) > 1
    )

    pmf_to_transelec: dict[str, set[str]] = defaultdict(set)
    transelec_to_pmf: dict[str, set[str]] = defaultdict(set)
    predio_to_pmf: dict[str, set[str]] = defaultdict(set)

    pmf_to_ingreso: dict[str, set[str]] = defaultdict(set)
    ingreso_to_pmf: dict[str, set[str]] = defaultdict(set)

    for row in source_rows:
        identifier = _norm(row.values["id_transelec"])
        predio = row.provisional_predio_id
        ingreso = _norm(row.values["numero_ingreso"])

        if identifier is not None:
            pmf_to_transelec[row.pmf].add(identifier)
            transelec_to_pmf[identifier].add(row.pmf)

        if predio is not None:
            predio_to_pmf[predio].add(row.pmf)

        if ingreso is not None:
            pmf_to_ingreso[row.pmf].add(ingreso)
            ingreso_to_pmf[ingreso].add(row.pmf)

    area_keys: Counter[tuple[str, str, str]] = Counter()

    for row in source_rows:
        predio = row.provisional_predio_id
        area = _norm(row.values["numero_area_corta"])

        if predio is not None and area is not None:
            area_keys[(row.pmf, predio, area)] += 1

    duplicate_area_counts = [count for count in area_keys.values() if count > 1]

    field_names = tuple(field_name for _, field_name in RESUMEN_COLUMNS)

    row_signatures = Counter(
        tuple(_norm(row.values[field]) for field in field_names) for row in source_rows
    )

    surface_values = [_numeric(row.values["superficie_corta"]) for row in source_rows]
    numeric_surfaces = [value for value in surface_values if value is not None]

    return DomainEvidence(
        business_rows=len(source_rows),
        distinct_pmf=len(pmfs),
        distinct_provisional_predio_ids=len(predio_ids),
        distinct_roles=len(roles),
        missing_identifiers=missing_identifiers,
        pmf_with_predio_id=len(pmf_predios),
        pmf_with_multiple_predios=sum(len(values) > 1 for values in pmf_predios.values()),
        median_predios_per_pmf=_median(pmf_predio_counts),
        max_predios_per_pmf=max(pmf_predio_counts, default=0),
        predios_with_area_number=len(predio_areas),
        predios_with_multiple_area_numbers=sum(len(values) > 1 for values in predio_areas.values()),
        median_area_numbers_per_predio=_median(predio_area_counts),
        max_area_numbers_per_predio=max(
            predio_area_counts,
            default=0,
        ),
        detailed_status_count=len(detailed_statuses),
        summarized_status_counts=tuple(sorted(summary_counter.items())),
        conflicting_detailed_status_mappings=status_conflicts,
        pmf_with_multiple_detailed_statuses=sum(
            len(values) > 1 for values in pmf_detailed.values()
        ),
        pmf_with_multiple_summarized_statuses=sum(
            len(values) > 1 for values in pmf_summary.values()
        ),
        predios_with_multiple_summarized_statuses=sum(
            len(values) > 1 for values in predio_summary.values()
        ),
        pmf_mapping_to_multiple_id_transelec=sum(
            len(values) > 1 for values in pmf_to_transelec.values()
        ),
        id_transelec_mapping_to_multiple_pmf=sum(
            len(values) > 1 for values in transelec_to_pmf.values()
        ),
        provisional_predio_ids_mapping_to_multiple_pmf=sum(
            len(values) > 1 for values in predio_to_pmf.values()
        ),
        complete_candidate_area_keys=len(area_keys),
        duplicate_candidate_area_key_groups=len(duplicate_area_counts),
        max_rows_per_candidate_area_key=max(
            duplicate_area_counts,
            default=1,
        ),
        exact_duplicate_business_row_groups=sum(count > 1 for count in row_signatures.values()),
        extra_rows_due_to_exact_duplicates=sum(
            count - 1 for count in row_signatures.values() if count > 1
        ),
        numeric_surface_rows=len(numeric_surfaces),
        missing_or_non_numeric_surface_rows=(len(source_rows) - len(numeric_surfaces)),
        zero_surface_rows=sum(value == 0 for value in numeric_surfaces),
        negative_surface_rows=sum(value < 0 for value in numeric_surfaces),
        surface_sum=sum(numeric_surfaces),
        pmf_with_multiple_numero_ingreso=sum(len(values) > 1 for values in pmf_to_ingreso.values()),
        numero_ingreso_mapping_to_multiple_pmf=sum(
            len(values) > 1 for values in ingreso_to_pmf.values()
        ),
    )
