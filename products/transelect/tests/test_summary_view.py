"""Unit tests for the pure KPI/chart aggregation behind GET /transelec/summary.

Every numeric formula from TR-FUNC-001-016 is exercised here against a
hand-built synthetic fixture, independent of the database. Row/PMF/predio
counts deliberately differ from the reviewed 14-Aug snapshot's 729/159/272,
so nothing here could pass by accident if a code path assumed those numbers.
"""

from __future__ import annotations

from transelec_ingestion.summary_view import SummaryInputRow, build_summary


def _row(
    *,
    source_row_number: int,
    pmf: str,
    predio_group_key: str,
    estado: str | None = None,
    estado_resumido: str | None = None,
    numero_ingreso: str | None = "OK-1",
    tipo_propietario: str | None = None,
    predio_ref: str | None = None,
    id_predio_unico: str | None = "id",
    superficie_corta: float | None = 1.0,
    rol: str | None = "R1",
) -> SummaryInputRow:
    return SummaryInputRow(
        source_row_number=source_row_number,
        pmf=pmf,
        predio_group_key=predio_group_key,
        estado=estado,
        estado_resumido=estado_resumido,
        numero_ingreso=numero_ingreso,
        tipo_propietario=tipo_propietario,
        predio_ref=predio_ref,
        id_predio_unico=id_predio_unico,
        superficie_corta=superficie_corta,
        rol=rol,
    )


def test_pmf_predio_rol_counts_are_distinct_counts_over_the_filtered_view() -> None:
    rows = [
        _row(source_row_number=1, pmf="MP001", predio_group_key="A", rol="R1"),
        _row(source_row_number=2, pmf="MP001", predio_group_key="A", rol="R1"),
        _row(source_row_number=3, pmf="MP002", predio_group_key="B", rol="R2"),
    ]

    summary = build_summary(rows)

    assert summary.pmf_count == 2  # TR-FUNC-001
    assert summary.predio_count == 2  # TR-FUNC-002
    assert summary.rol_count == 2  # TR-FUNC-003
    assert summary.row_count == 3


def test_predio_count_uses_predio_group_key_which_already_implements_the_fallback() -> None:
    """TR-FUNC-002: dedup by ID_Predo_Unico, composite fallback if blank.
    predio_group_key already IS that fallback (computed at projection time),
    so predio_count is simply COUNT(DISTINCT predio_group_key)."""

    rows = [
        _row(source_row_number=1, pmf="MP001", predio_group_key="MP001-1-1", id_predio_unico=None),
        _row(source_row_number=2, pmf="MP001", predio_group_key="MP001-1-1", id_predio_unico=None),
        _row(
            source_row_number=3,
            pmf="MP002",
            predio_group_key="real-id",
            id_predio_unico="real-id",
        ),
    ]

    summary = build_summary(rows)

    assert summary.predio_count == 2


def test_surface_total_sums_superficie_corta_excluding_blanks() -> None:
    rows = [
        _row(source_row_number=1, pmf="MP001", predio_group_key="A", superficie_corta=1.5),
        _row(source_row_number=2, pmf="MP002", predio_group_key="B", superficie_corta=None),
        _row(source_row_number=3, pmf="MP003", predio_group_key="C", superficie_corta=2.25),
    ]

    summary = build_summary(rows)

    assert summary.surface_total == 3.75  # TR-FUNC-004


def test_aprobados_and_en_tramite_use_estado_resumido_first_row_pmf_grain() -> None:
    rows = [
        # MP001: first row (lowest source_row_number) is Aprobado.
        _row(source_row_number=1, pmf="MP001", predio_group_key="A", estado_resumido="Aprobado"),
        _row(source_row_number=2, pmf="MP001", predio_group_key="A", estado_resumido="Tachado"),
        # MP002: single row, En tramite.
        _row(source_row_number=1, pmf="MP002", predio_group_key="B", estado_resumido="En tramite"),
    ]

    summary = build_summary(rows)

    assert summary.aprobados_pmf_count == 1  # TR-FUNC-005
    assert summary.en_tramite_pmf_count == 1  # TR-FUNC-006
    assert summary.basis_estado_resumido == "estado_resumido_first_row"


def test_pendientes_prioritarios_uses_pending_priority_legacy_and_can_diverge() -> None:
    """The audit's documented divergence: a PMF whose first row is
    'En tramite' under estado_resumido_first_row is nonetheless
    pending-priority because that same row's raw Estado contains 'rechaz'."""

    rows = [
        _row(
            source_row_number=1,
            pmf="MP001",
            predio_group_key="A",
            estado="Rechazado por CONAF",
            estado_resumido="En tramite",
            numero_ingreso="778",
        ),
        _row(
            source_row_number=1,
            pmf="MP002",
            predio_group_key="B",
            estado="Aprobado",
            estado_resumido="Aprobado",
            numero_ingreso="900",
        ),
    ]

    summary = build_summary(rows)

    assert summary.pendientes_prioritarios_pmf_count == 1  # TR-FUNC-007
    assert summary.aprobados_pmf_count == 1  # MP002 only
    assert summary.en_tramite_pmf_count == 1  # MP001, per estado_resumido_first_row
    assert summary.basis_pending_priority == "pending_priority_legacy"


def test_con_servidumbre_counts_distinct_predios_with_a_case_insensitive_match() -> None:
    rows = [
        _row(
            source_row_number=1,
            pmf="MP001",
            predio_group_key="A",
            tipo_propietario="Con SERVIDUMBRE firmada",
        ),
        _row(
            source_row_number=2,
            pmf="MP001",
            predio_group_key="A",  # same predio, second row: must not double count
            tipo_propietario="servidumbre",
        ),
        _row(
            source_row_number=1,
            pmf="MP002",
            predio_group_key="B",
            tipo_propietario="Propietario",
        ),
    ]

    summary = build_summary(rows)

    assert summary.con_servidumbre_predio_count == 1  # TR-FUNC-008


def test_charts_009_010_sum_to_the_matching_kpi_totals() -> None:
    rows = [
        _row(source_row_number=1, pmf="MP001", predio_group_key="A", estado_resumido="Aprobado"),
        _row(source_row_number=1, pmf="MP002", predio_group_key="B", estado_resumido="En tramite"),
        _row(source_row_number=1, pmf="MP003", predio_group_key="C", estado_resumido="Pendiente"),
        _row(source_row_number=1, pmf="MP004", predio_group_key="D", estado_resumido="Tachado"),
    ]

    summary = build_summary(rows)

    by_predio = summary.avance_por_predio
    assert by_predio.aprobado + by_predio.en_tramite + by_predio.pendiente_o_tachado == (
        summary.predio_count
    )
    by_pmf = summary.avance_por_pmf
    assert by_pmf.aprobado + by_pmf.en_tramite + by_pmf.pendiente_o_tachado == summary.pmf_count
    assert by_predio.aprobado == 1
    assert by_predio.en_tramite == 1
    assert by_predio.pendiente_o_tachado == 2


def test_hero_011_four_state_predio_grain_sums_to_predio_count() -> None:
    rows = [
        _row(source_row_number=1, pmf="MP001", predio_group_key="A", estado_resumido="Aprobado"),
        _row(source_row_number=1, pmf="MP002", predio_group_key="B", estado_resumido="En tramite"),
        _row(source_row_number=1, pmf="MP003", predio_group_key="C", estado_resumido="Pendiente"),
        _row(source_row_number=1, pmf="MP004", predio_group_key="D", estado_resumido="Tachado"),
        _row(source_row_number=1, pmf="MP005", predio_group_key="E", estado_resumido=None),
    ]

    summary = build_summary(rows)
    hero = summary.estado_resumido_hero_predio

    assert (
        hero.aprobado + hero.en_tramite + hero.pendiente + hero.tachado + hero.sin_estado
        == summary.predio_count
    )
    assert hero.sin_estado == 1


def test_predios_reforestacion_chips_are_distinct_non_blank_predio_ref_values() -> None:
    rows = [
        _row(source_row_number=1, pmf="MP001", predio_group_key="A", predio_ref="Fundo Norte"),
        _row(source_row_number=2, pmf="MP001", predio_group_key="A", predio_ref="Fundo Norte"),
        _row(source_row_number=3, pmf="MP002", predio_group_key="B", predio_ref=None),
        _row(source_row_number=4, pmf="MP003", predio_group_key="C", predio_ref="  "),
        _row(source_row_number=5, pmf="MP004", predio_group_key="D", predio_ref="Fundo Sur"),
    ]

    summary = build_summary(rows)

    assert sorted(summary.predios_reforestacion) == ["Fundo Norte", "Fundo Sur"]  # TR-FUNC-012


def test_calidad_filas_sin_id_predial_unico_is_a_row_grain_count() -> None:
    rows = [
        _row(source_row_number=1, pmf="MP001", predio_group_key="A", id_predio_unico=None),
        _row(source_row_number=2, pmf="MP001", predio_group_key="A", id_predio_unico="   "),
        _row(source_row_number=3, pmf="MP002", predio_group_key="B", id_predio_unico="real"),
    ]

    summary = build_summary(rows)

    assert summary.calidad_filas_sin_id_predial_unico == 2  # TR-FUNC-014, row-grain not deduped


def test_calidad_pmf_sin_numero_ingreso_uses_the_same_pmf_dedup_tie_break() -> None:
    """TR-FUNC-015: PMF-deduped (first-row-wins) count of blank N Ingreso —
    inherits the exact same tie-break as TR-FUNC-001."""

    rows = [
        _row(source_row_number=1, pmf="MP001", predio_group_key="A", numero_ingreso=None),
        _row(source_row_number=2, pmf="MP001", predio_group_key="A", numero_ingreso="999"),
        _row(source_row_number=1, pmf="MP002", predio_group_key="B", numero_ingreso="1"),
    ]

    summary = build_summary(rows)

    assert summary.calidad_pmf_sin_numero_ingreso == 1  # MP001's first row has no N Ingreso


def test_calidad_numero_resolucion_is_a_static_literal() -> None:
    summary = build_summary([_row(source_row_number=1, pmf="MP001", predio_group_key="A")])

    assert summary.calidad_numero_resolucion == "No disponible"  # TR-FUNC-016


def test_empty_filtered_view_produces_all_zero_counts_not_an_error() -> None:
    summary = build_summary([])

    assert summary.pmf_count == 0
    assert summary.predio_count == 0
    assert summary.surface_total == 0.0
    assert summary.predios_reforestacion == []
