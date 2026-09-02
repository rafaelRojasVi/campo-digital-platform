"""Pure KPI/chart/status-hero aggregation behind ``GET /transelec/summary``.

Implements TR-FUNC-001-012 and TR-FUNC-014-016 from one already-filtered set
of ``transelec_resumen_row`` rows, so a single filter state can never make
the KPI row, the two donut charts, and the status hero disagree (TR-FUNC-017's
acceptance test) — every number here is derived from the exact same input
list, mirroring the source HTML's single shared in-memory ``view``.

TR-FUNC-013 (owner-status table) is deliberately NOT computed here: it is
predio-grain but keyed by ``Tipo de propietario`` too, and lives in its own
module (``owner_status_view``) behind its own endpoint, per the design doc.

No canonical PMF/predio status rollup is invented anywhere in this module —
every status-dependent number is computed via one of the three explicitly
named, evidenced legacy bases in ``status_rollups``.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from transelec_ingestion.status_rollups import (
    RolledRow,
    bucket_3way,
    estado_resumido_first_row,
    first_row_wins,
    hero_state,
    pending_priority_legacy,
)

_STATIC_NUMERO_RESOLUCION = "No disponible"  # TR-FUNC-016: the field does not exist in the source.


@dataclass(frozen=True, slots=True)
class SummaryInputRow:
    """One filtered ``transelec_resumen_row``, projected for summary math."""

    source_row_number: int
    pmf: str
    predio_group_key: str
    estado: str | None
    estado_resumido: str | None
    numero_ingreso: str | None
    tipo_propietario: str | None
    predio_ref: str | None
    id_predio_unico: str | None
    superficie_corta: float | None
    rol: str | None

    def _as_rolled_row(self) -> RolledRow:
        return RolledRow(
            source_row_number=self.source_row_number,
            pmf=self.pmf,
            predio_group_key=self.predio_group_key,
            estado=self.estado,
            estado_resumido=self.estado_resumido,
            numero_ingreso=self.numero_ingreso,
            tipo_propietario=self.tipo_propietario,
        )


@dataclass(frozen=True, slots=True)
class Bucket3WayCounts:
    aprobado: int
    en_tramite: int
    pendiente_o_tachado: int


@dataclass(frozen=True, slots=True)
class HeroStateCounts:
    aprobado: int
    en_tramite: int
    pendiente: int
    tachado: int
    sin_estado: int


@dataclass(frozen=True, slots=True)
class SummaryResult:
    row_count: int

    # KPIs — TR-FUNC-001-008
    pmf_count: int
    predio_count: int
    rol_count: int
    surface_total: float
    basis_estado_resumido: str
    aprobados_pmf_count: int
    en_tramite_pmf_count: int
    basis_pending_priority: str
    pendientes_prioritarios_pmf_count: int
    con_servidumbre_predio_count: int

    # Charts — TR-FUNC-009/010
    avance_por_predio: Bucket3WayCounts
    avance_por_pmf: Bucket3WayCounts

    # Status hero — TR-FUNC-011
    estado_resumido_hero_predio: HeroStateCounts

    # Reforestación chips — TR-FUNC-012
    predios_reforestacion: list[str] = field(default_factory=list)

    # Data-quality indicators — TR-FUNC-014-016
    calidad_filas_sin_id_predial_unico: int = 0
    calidad_pmf_sin_numero_ingreso: int = 0
    calidad_numero_resolucion: str = _STATIC_NUMERO_RESOLUCION


def _is_blank(value: str | None) -> bool:
    return value is None or not value.strip()


def build_summary(rows: Sequence[SummaryInputRow]) -> SummaryResult:
    """Compute every summary number from one already-filtered row set."""

    rolled = [row._as_rolled_row() for row in rows]

    pmf_count = len({row.pmf for row in rows})
    predio_count = len({row.predio_group_key for row in rows})
    rol_count = len({row.rol for row in rows if row.rol is not None})
    surface_total = sum(row.superficie_corta for row in rows if row.superficie_corta is not None)

    pmf_status = estado_resumido_first_row(rolled, key="pmf")
    aprobados_pmf_count = sum(
        1 for value in pmf_status.values() if (value or "").strip().lower() == "aprobado"
    )
    en_tramite_pmf_count = sum(
        1
        for value in pmf_status.values()
        if (value or "").strip().lower() in {"en tramite", "en trámite"}
    )

    pending_by_pmf = pending_priority_legacy(rolled, key="pmf")
    pendientes_prioritarios_pmf_count = sum(1 for pending in pending_by_pmf.values() if pending)

    servidumbre_predios = {
        row.predio_group_key
        for row in rows
        if row.tipo_propietario is not None and "servidumbre" in row.tipo_propietario.lower()
    }

    predio_status = estado_resumido_first_row(rolled, key="predio_group_key")
    avance_por_predio = _bucket_counts(predio_status.values())
    avance_por_pmf = _bucket_counts(pmf_status.values())
    hero_predio = _hero_counts(predio_status.values())

    predios_reforestacion = sorted(
        {
            row.predio_ref.strip()
            for row in rows
            if row.predio_ref is not None and row.predio_ref.strip()
        }
    )

    calidad_filas_sin_id_predial_unico = sum(1 for row in rows if _is_blank(row.id_predio_unico))

    pmf_representative = first_row_wins(rolled, key="pmf")
    calidad_pmf_sin_numero_ingreso = sum(
        1 for row in pmf_representative.values() if _is_blank(row.numero_ingreso)
    )

    return SummaryResult(
        row_count=len(rows),
        pmf_count=pmf_count,
        predio_count=predio_count,
        rol_count=rol_count,
        surface_total=surface_total,
        basis_estado_resumido="estado_resumido_first_row",
        aprobados_pmf_count=aprobados_pmf_count,
        en_tramite_pmf_count=en_tramite_pmf_count,
        basis_pending_priority="pending_priority_legacy",
        pendientes_prioritarios_pmf_count=pendientes_prioritarios_pmf_count,
        con_servidumbre_predio_count=len(servidumbre_predios),
        avance_por_predio=avance_por_predio,
        avance_por_pmf=avance_por_pmf,
        estado_resumido_hero_predio=hero_predio,
        predios_reforestacion=predios_reforestacion,
        calidad_filas_sin_id_predial_unico=calidad_filas_sin_id_predial_unico,
        calidad_pmf_sin_numero_ingreso=calidad_pmf_sin_numero_ingreso,
    )


def _bucket_counts(values: Iterable[str | None]) -> Bucket3WayCounts:
    aprobado = en_tramite = pendiente_o_tachado = 0
    for value in values:
        bucket = bucket_3way(value)
        if bucket == "aprobado":
            aprobado += 1
        elif bucket == "en_tramite":
            en_tramite += 1
        else:
            pendiente_o_tachado += 1
    return Bucket3WayCounts(
        aprobado=aprobado, en_tramite=en_tramite, pendiente_o_tachado=pendiente_o_tachado
    )


def _hero_counts(values: Iterable[str | None]) -> HeroStateCounts:
    counts = {"aprobado": 0, "en_tramite": 0, "pendiente": 0, "tachado": 0, "sin_estado": 0}
    for value in values:
        counts[hero_state(value)] += 1
    return HeroStateCounts(**counts)
