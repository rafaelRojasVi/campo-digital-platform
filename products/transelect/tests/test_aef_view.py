import datetime as dt

from transelec_ingestion.aef_view import AefInputRow, LabelCount, build_aef_summary


def _row(number: int, pmf: str, **values: object) -> AefInputRow:
    fields: dict[str, object] = {
        "aef": None,
        "quien_solicita": None,
        "fecha_solicitud": None,
        "fecha_corta": None,
        "fecha_termino": None,
    }
    fields.update(values)
    return AefInputRow(source_row_number=number, pmf=pmf, **fields)  # type: ignore[arg-type]


def test_counts_are_row_level_and_never_extended_to_the_pmf() -> None:
    rows = [
        _row(2, "BN001", aef="Presentado", fecha_corta=dt.date(2025, 12, 1)),
        _row(3, "BN001"),
        _row(4, "BN001"),
        _row(5, "MP020", aef="Presentado", quien_solicita="Persona A"),
        _row(6, "PL001"),
    ]

    summary = build_aef_summary(rows)

    assert summary.row_count == 5
    assert summary.rows_with_aef == 2
    assert summary.rows_with_quien_solicita == 1
    assert summary.pmf_count == 3
    assert summary.pmf_with_aef == 2
    # BN001 has an AEF on one of its three rows: partial, not "the PMF has AEF".
    assert summary.pmf_with_partial_aef == 1
    coverage = {
        entry.pmf: (entry.rows_with_aef, entry.total_rows) for entry in summary.pmf_coverage
    }
    assert coverage == {"BN001": (1, 3), "MP020": (1, 1)}
    assert summary.tracked_row_numbers == (2, 5)


def test_blank_requester_is_counted_as_blank_not_dropped() -> None:
    rows = [
        _row(2, "A", aef="Presentado", quien_solicita="Persona A"),
        _row(3, "B", aef="Presentado"),
        _row(4, "C", aef="Solicitado, se puede cortar", quien_solicita="Persona A"),
    ]

    summary = build_aef_summary(rows)

    assert summary.por_aef == (
        LabelCount("Presentado", 2),
        LabelCount("Solicitado, se puede cortar", 1),
    )
    assert summary.por_solicitante == (LabelCount("Persona A", 2), LabelCount(None, 1))


def test_a_row_with_only_dates_is_tracked_and_chronology_is_counted() -> None:
    rows = [
        _row(
            2,
            "A",
            fecha_solicitud=dt.date(2026, 8, 20),
            fecha_corta=dt.date(2026, 8, 19),
        ),
        _row(3, "B", aef="   "),
    ]

    summary = build_aef_summary(rows)

    assert summary.rows_with_any_tracking == 1
    assert summary.rows_with_aef == 0
    assert summary.rows_with_chronology_warning == 1
    assert summary.por_aef == (LabelCount(None, 1),)
