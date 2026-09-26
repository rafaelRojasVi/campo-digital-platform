"""The AEF tracking view over one filtered row set.

The 09-Sept-2026 workbook records five AEF tracking fields (``AEF``,
``Quien solicita``, ``Fecha solicitud``, ``Fecha corta``, ``Fecha termino``)
per *row* of ``Resumen`` — per área de corta, not per PMF. In that workbook
only 23 of 729 rows carry an AEF value and only 19 a requester; most PMFs
with an AEF row also have rows without one.

So every number here is a row count or an explicit coverage ratio. Nothing
promotes a row's value to its PMF, fills it down to sibling rows, or treats
a blank as "not applicable": a blank is reported as a blank. The source does
not establish what AEF stands for or what its values mean beyond their text,
so values are grouped by their literal spelling only.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from transelec_ingestion.resumen_layout import AEF_TRACKING_FIELDS, chronology_flags


@dataclass(frozen=True, slots=True)
class AefInputRow:
    source_row_number: int
    pmf: str
    aef: str | None
    quien_solicita: str | None
    fecha_solicitud: dt.date | None
    fecha_corta: dt.date | None
    fecha_termino: dt.date | None


@dataclass(frozen=True, slots=True)
class LabelCount:
    """Row count under one literal value; ``label`` None means blank."""

    label: str | None
    count: int


@dataclass(frozen=True, slots=True)
class PmfCoverage:
    pmf: str
    total_rows: int
    rows_with_aef: int
    rows_with_any_tracking: int


@dataclass(frozen=True, slots=True)
class AefSummary:
    row_count: int
    pmf_count: int
    rows_with_any_tracking: int
    rows_with_aef: int
    rows_with_quien_solicita: int
    rows_with_fecha_solicitud: int
    rows_with_fecha_corta: int
    rows_with_fecha_termino: int
    pmf_with_aef: int
    pmf_with_partial_aef: int
    rows_with_chronology_warning: int
    por_aef: tuple[LabelCount, ...]
    por_solicitante: tuple[LabelCount, ...]
    pmf_coverage: tuple[PmfCoverage, ...]
    tracked_row_numbers: tuple[int, ...]


def _present(value: object) -> bool:
    if value is None:
        return False
    return not (isinstance(value, str) and not value.strip())


def has_tracking(row: AefInputRow) -> bool:
    return any(_present(getattr(row, name)) for name in AEF_TRACKING_FIELDS)


def row_chronology_flags(row: AefInputRow) -> tuple[str, ...]:
    return chronology_flags(
        {
            "fecha_solicitud": row.fecha_solicitud,
            "fecha_corta": row.fecha_corta,
            "fecha_termino": row.fecha_termino,
        }
    )


def _label_counts(values: Sequence[str | None]) -> tuple[LabelCount, ...]:
    counts = Counter(value.strip() if _present(value) else None for value in values)  # type: ignore[union-attr]
    # Most frequent first; blank last; ties by Spanish-insensitive label.
    return tuple(
        LabelCount(label=label, count=count)
        for label, count in sorted(
            counts.items(),
            key=lambda item: (item[0] is None, -item[1], (item[0] or "").casefold()),
        )
    )


def build_aef_summary(rows: Sequence[AefInputRow]) -> AefSummary:
    """Summarize AEF tracking over ``rows`` (already filtered, source order)."""

    tracked = [row for row in rows if has_tracking(row)]

    by_pmf: dict[str, list[AefInputRow]] = {}
    for row in rows:
        by_pmf.setdefault(row.pmf, []).append(row)

    coverage: list[PmfCoverage] = []
    pmf_with_aef = 0
    pmf_with_partial_aef = 0
    for pmf, pmf_rows in by_pmf.items():
        with_aef = sum(1 for row in pmf_rows if _present(row.aef))
        with_any = sum(1 for row in pmf_rows if has_tracking(row))
        if with_aef:
            pmf_with_aef += 1
            if with_aef < len(pmf_rows):
                pmf_with_partial_aef += 1
        if with_any:
            coverage.append(
                PmfCoverage(
                    pmf=pmf,
                    total_rows=len(pmf_rows),
                    rows_with_aef=with_aef,
                    rows_with_any_tracking=with_any,
                )
            )

    return AefSummary(
        row_count=len(rows),
        pmf_count=len(by_pmf),
        rows_with_any_tracking=len(tracked),
        rows_with_aef=sum(1 for row in rows if _present(row.aef)),
        rows_with_quien_solicita=sum(1 for row in rows if _present(row.quien_solicita)),
        rows_with_fecha_solicitud=sum(1 for row in rows if row.fecha_solicitud is not None),
        rows_with_fecha_corta=sum(1 for row in rows if row.fecha_corta is not None),
        rows_with_fecha_termino=sum(1 for row in rows if row.fecha_termino is not None),
        pmf_with_aef=pmf_with_aef,
        pmf_with_partial_aef=pmf_with_partial_aef,
        rows_with_chronology_warning=sum(1 for row in tracked if row_chronology_flags(row)),
        por_aef=_label_counts([row.aef for row in tracked]),
        por_solicitante=_label_counts([row.quien_solicita for row in tracked]),
        pmf_coverage=tuple(coverage),
        tracked_row_numbers=tuple(row.source_row_number for row in tracked),
    )
