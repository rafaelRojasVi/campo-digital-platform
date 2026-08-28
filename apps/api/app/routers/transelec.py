"""Transelec HTTP adapter for the read-only client demo."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from transelec_ingestion import pmf_view
from transelec_ingestion.xlsx_contract import (
    ResumenSourceRow,
    TranselecWorkbookError,
    load_transelec_workbook,
)

router = APIRouter(prefix="/transelec")


def get_workbook_path() -> Path:
    """Return the configured Transelec source workbook path."""

    configured = os.environ.get("CAMPO_TRANSELEC_WORKBOOK_PATH")

    if not configured:
        raise HTTPException(
            status_code=503,
            detail="Transelec source is not configured",
        )

    return Path(configured)


def get_resumen_rows(
    workbook_path: Annotated[Path, Depends(get_workbook_path)],
) -> tuple[ResumenSourceRow, ...]:
    """Load and parse the current Resumen business rows."""

    try:
        workbook = load_transelec_workbook(workbook_path)
    except (TranselecWorkbookError, OSError) as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Transelec source is unavailable: {exc}",
        ) from exc

    return workbook.resumen_rows


ResumenRows = Annotated[tuple[ResumenSourceRow, ...], Depends(get_resumen_rows)]


@router.get(
    "/summary",
    response_model=pmf_view.TranselecSummary,
)
def get_summary(rows: ResumenRows) -> pmf_view.TranselecSummary:
    """Return current PMF/predio/status KPI numbers."""

    return pmf_view.build_summary(rows)


@router.get(
    "/filters",
    response_model=pmf_view.TranselecFilterOptions,
)
def get_filters(rows: ResumenRows) -> pmf_view.TranselecFilterOptions:
    """Return the distinct status/sector/empresa values present in the source."""

    return pmf_view.list_filter_options(rows)


@router.get(
    "/pmfs",
    response_model=list[pmf_view.PmfListItem],
)
def list_pmfs(
    rows: ResumenRows,
    search: str | None = None,
    status: str | None = None,
    sector: str | None = None,
    empresa: str | None = None,
) -> list[pmf_view.PmfListItem]:
    """List current PMFs, optionally filtered by search/status/sector/empresa."""

    return list(
        pmf_view.list_pmfs(
            rows,
            search=search,
            status=status,
            sector=sector,
            empresa=empresa,
        )
    )


@router.get(
    "/pmfs/{pmf}",
    response_model=pmf_view.PmfDetail,
)
def get_pmf(
    pmf: str,
    rows: ResumenRows,
) -> pmf_view.PmfDetail:
    """Return one PMF's predios/areas and current source rows."""

    detail = pmf_view.get_pmf_detail(rows, pmf)

    if detail is None:
        raise HTTPException(
            status_code=404,
            detail="PMF not found in current source",
        )

    return detail
