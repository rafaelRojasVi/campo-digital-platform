from typing import Any

from transelec_ingestion.pmf_view import (
    build_summary,
    get_pmf_detail,
    list_filter_options,
    list_pmfs,
)
from transelec_ingestion.xlsx_contract import RESUMEN_COLUMNS, ResumenSourceRow


def _row(
    source_row_number: int,
    *,
    pmf: str,
    predio: str | None,
    area: str | None = None,
    superficie: Any = None,
    estado: str | None = None,
    resumen: str | None = None,
    sector: str | None = None,
    empresa: str | None = None,
    rol: str | None = "ROL",
    **overrides: Any,
) -> ResumenSourceRow:
    values: dict[str, Any] = {field: None for _, field in RESUMEN_COLUMNS}

    values.update(
        {
            "pmf": pmf,
            "id_predio_unico": predio,
            "numero_area_corta": area,
            "superficie_corta": superficie,
            "estado": estado,
            "estado_resumido": resumen,
            "sector": sector,
            "empresa": empresa,
            "rol": rol,
            "numero_predio": "1",
        }
    )
    values.update(overrides)

    return ResumenSourceRow(source_row_number=source_row_number, values=values)


def _rows() -> tuple[ResumenSourceRow, ...]:
    return (
        _row(
            2,
            pmf="PMF1",
            predio="P1",
            area="A1",
            superficie=1.5,
            estado="Rechazado",
            resumen="En tramite",
            sector="Sur",
            empresa="Empresa A",
        ),
        _row(
            3,
            pmf="PMF1",
            predio="P1",
            area="A2",
            superficie=2.5,
            estado="Aprobado",
            resumen="Aprobado",
            sector="Sur",
            empresa="Empresa A",
        ),
        _row(
            4,
            pmf="PMF1",
            predio=None,
            area="A3",
            superficie=None,
            estado="Aprobado",
            resumen="Aprobado",
            sector="Sur",
            empresa="Empresa A",
        ),
        _row(
            5,
            pmf="PMF2",
            predio="P2",
            area="A1",
            superficie=3.0,
            estado="Aprobado",
            resumen="Aprobado",
            sector="Norte",
            empresa="Empresa B",
        ),
    )


def test_list_filter_options_returns_distinct_sorted_present_values() -> None:
    options = list_filter_options(_rows())

    assert options.statuses == ("Aprobado", "En tramite")
    assert options.sectors == ("Norte", "Sur")
    assert options.empresas == ("Empresa A", "Empresa B")


def test_list_pmfs_groups_rows_by_pmf_sorted_ascending() -> None:
    items = list_pmfs(_rows())

    assert [item.pmf for item in items] == ["PMF1", "PMF2"]

    pmf1 = items[0]
    assert pmf1.row_count == 3
    assert pmf1.predio_count == 1
    assert pmf1.sectors == ("Sur",)
    assert pmf1.empresas == ("Empresa A",)
    assert pmf1.surface_total == 4.0


def test_list_pmfs_preserves_multiple_statuses_without_collapsing() -> None:
    items = list_pmfs(_rows())

    pmf1 = next(item for item in items if item.pmf == "PMF1")
    assert pmf1.statuses == ("Aprobado", "En tramite")


def test_list_pmfs_surface_total_is_none_when_no_numeric_surface_present() -> None:
    rows = (
        _row(2, pmf="PMF3", predio="P9", superficie=None),
        _row(3, pmf="PMF3", predio="P9", superficie="n/a"),
    )

    items = list_pmfs(rows)

    assert items[0].surface_total is None


def test_list_pmfs_filters_by_status() -> None:
    items = list_pmfs(_rows(), status="Aprobado")

    assert {item.pmf for item in items} == {"PMF1", "PMF2"}
    pmf1 = next(item for item in items if item.pmf == "PMF1")
    assert pmf1.row_count == 2


def test_list_pmfs_filters_by_sector() -> None:
    items = list_pmfs(_rows(), sector="Norte")

    assert [item.pmf for item in items] == ["PMF2"]


def test_list_pmfs_filters_by_empresa() -> None:
    items = list_pmfs(_rows(), empresa="Empresa A")

    assert [item.pmf for item in items] == ["PMF1"]


def test_list_pmfs_filters_by_search_across_pmf_predio_and_rol() -> None:
    assert [item.pmf for item in list_pmfs(_rows(), search="pmf2")] == ["PMF2"]
    assert [item.pmf for item in list_pmfs(_rows(), search="P2")] == ["PMF2"]


def test_list_pmfs_combines_filters() -> None:
    items = list_pmfs(_rows(), status="Aprobado", sector="Sur")

    assert [item.pmf for item in items] == ["PMF1"]


def test_list_pmfs_returns_empty_tuple_when_nothing_matches() -> None:
    assert list_pmfs(_rows(), sector="No Existe") == ()


def test_get_pmf_detail_groups_by_provisional_predio_with_none_bucket_last() -> None:
    detail = get_pmf_detail(_rows(), "PMF1")

    assert detail is not None
    assert detail.pmf == "PMF1"
    assert detail.row_count == 3
    assert detail.statuses == ("Aprobado", "En tramite")

    predio_ids = [group.provisional_predio_id for group in detail.predios]
    assert predio_ids == ["P1", None]

    p1_group = detail.predios[0]
    assert [row.numero_area_corta for row in p1_group.rows] == ["A1", "A2"]

    none_group = detail.predios[1]
    assert len(none_group.rows) == 1
    assert none_group.rows[0].numero_area_corta == "A3"


def test_get_pmf_detail_is_unaffected_by_list_filters_and_shows_raw_rows() -> None:
    detail = get_pmf_detail(_rows(), "PMF1")

    assert detail is not None
    assert detail.row_count == 3


def test_get_pmf_detail_returns_none_for_unknown_pmf() -> None:
    assert get_pmf_detail(_rows(), "DOES-NOT-EXIST") is None


def test_build_summary_projects_domain_evidence_fields() -> None:
    summary = build_summary(_rows())

    assert summary.business_rows == 4
    assert summary.distinct_pmf == 2
    assert summary.distinct_provisional_predio_ids == 2
    assert summary.surface_total == 7.0
    assert summary.status_breakdown == (("Aprobado", 3), ("En tramite", 1))
