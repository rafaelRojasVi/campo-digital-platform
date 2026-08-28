from typing import Any

import pytest

from transelec_ingestion.domain_evidence import (
    analyze_domain_evidence,
)
from transelec_ingestion.xlsx_contract import (
    RESUMEN_COLUMNS,
    ResumenSourceRow,
)


def _row(
    source_row_number: int,
    *,
    pmf: str,
    predio: str,
    area: str,
    superficie: Any,
    estado: str,
    resumen: str,
    id_transelec: str | None = None,
    numero_ingreso: str | None = None,
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
            "id_transelec": id_transelec,
            "numero_ingreso": numero_ingreso,
            "rol": "ROL",
            "numero_predio": "1",
        }
    )
    values.update(overrides)

    return ResumenSourceRow(
        source_row_number=source_row_number,
        values=values,
    )


def test_domain_evidence_exposes_relationships_without_inventing_keys() -> None:
    rows = (
        _row(
            2,
            pmf="PMF1",
            predio="P1",
            area="A1",
            superficie=1.0,
            estado="Rechazado",
            resumen="En tramite",
            id_transelec="T1",
            numero_ingreso="I1",
        ),
        _row(
            3,
            pmf="PMF1",
            predio="P1",
            area="A1",
            superficie=2.0,
            estado="Rechazado",
            resumen="En tramite",
            id_transelec="T2",
            numero_ingreso="I1",
        ),
        _row(
            4,
            pmf="PMF1",
            predio="P2",
            area="A2",
            superficie=0,
            estado="Rechazado",
            resumen="Tachado",
            id_transelec="T2",
            numero_ingreso="I1",
        ),
        _row(
            5,
            pmf="PMF2",
            predio="P3",
            area="A1",
            superficie=None,
            estado="Aprobado",
            resumen="Aprobado",
            id_transelec="T1",
            numero_ingreso="I1",
        ),
    )

    report = analyze_domain_evidence(rows)

    assert report.business_rows == 4
    assert report.distinct_pmf == 2
    assert report.distinct_provisional_predio_ids == 3

    assert report.pmf_with_multiple_predios == 1
    assert report.predios_with_multiple_area_numbers == 0

    assert report.pmf_with_multiple_detailed_statuses == 0
    assert report.pmf_with_multiple_summarized_statuses == 1
    assert report.predios_with_multiple_summarized_statuses == 0

    assert report.conflicting_detailed_status_mappings == (
        ("Rechazado", ("En tramite", "Tachado")),
    )

    assert report.pmf_mapping_to_multiple_id_transelec == 1
    assert report.id_transelec_mapping_to_multiple_pmf == 1
    assert report.provisional_predio_ids_mapping_to_multiple_pmf == 0

    assert report.complete_candidate_area_keys == 3
    assert report.duplicate_candidate_area_key_groups == 1
    assert report.max_rows_per_candidate_area_key == 2

    assert report.exact_duplicate_business_row_groups == 0

    assert report.numeric_surface_rows == 3
    assert report.missing_or_non_numeric_surface_rows == 1
    assert report.zero_surface_rows == 1
    assert report.negative_surface_rows == 0
    assert report.surface_sum == pytest.approx(3.0)

    assert report.pmf_with_multiple_numero_ingreso == 0
    assert report.numero_ingreso_mapping_to_multiple_pmf == 1


def test_domain_evidence_rejects_empty_input() -> None:
    with pytest.raises(
        ValueError,
        match="at least one source row",
    ):
        analyze_domain_evidence(())
