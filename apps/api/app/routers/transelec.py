"""Transelec HTTP adapter for the hosted pilot and local development."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import Engine

from app.database import get_database_engine
from app.transelec_snapshots import (
    PersistedWorkbookSnapshot,
    TranselecSnapshotRecord,
    TranselecSnapshotStoreError,
    activate_workbook_snapshot,
    get_active_workbook_snapshot,
    get_max_workbook_bytes,
    list_workbook_snapshots,
    load_workbook_from_bytes,
    persist_validated_workbook,
    validate_workbook_upload,
)
from transelec_ingestion import pmf_view
from transelec_ingestion.xlsx_contract import (
    ResumenSourceRow,
    TranselecWorkbookError,
    load_transelec_workbook,
)

router = APIRouter(prefix="/transelec")


@dataclass(frozen=True, slots=True)
class PublishWorkbookResponse:
    """API result for a validated workbook publication attempt."""

    duplicate: bool
    snapshot: TranselecSnapshotRecord


def get_workbook_path() -> Path | None:
    """Return the optional local Transelec workbook used during development."""

    configured = os.environ.get("CAMPO_TRANSELEC_WORKBOOK_PATH", "").strip()
    return Path(configured) if configured else None


def get_transelec_database_engine() -> Engine:
    """Resolve the hosted pilot database or return a service-level error."""

    try:
        return get_database_engine()
    except ValidationError as exc:
        raise HTTPException(
            status_code=503,
            detail="Transelec hosted storage is not configured",
        ) from exc


def _load_local_rows(workbook_path: Path) -> tuple[ResumenSourceRow, ...]:
    try:
        workbook = load_transelec_workbook(workbook_path)
    except (TranselecWorkbookError, OSError) as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Transelec source is unavailable: {exc}",
        ) from exc

    return workbook.resumen_rows


def _load_hosted_rows() -> tuple[ResumenSourceRow, ...]:
    engine = get_transelec_database_engine()

    try:
        active = get_active_workbook_snapshot(engine)
    except TranselecSnapshotStoreError as exc:
        raise HTTPException(
            status_code=503,
            detail="Transelec hosted source is unavailable",
        ) from exc

    if active is None:
        raise HTTPException(
            status_code=503,
            detail="No Transelec workbook snapshot has been published",
        )

    try:
        workbook = load_workbook_from_bytes(
            active.content,
            filename=active.snapshot.filename,
        )
    except (TranselecWorkbookError, OSError) as exc:
        raise HTTPException(
            status_code=503,
            detail="The active Transelec workbook snapshot is unreadable",
        ) from exc

    return workbook.resumen_rows


def get_resumen_rows(
    workbook_path: Annotated[Path | None, Depends(get_workbook_path)],
) -> tuple[ResumenSourceRow, ...]:
    """Load rows from a local development file or the active hosted snapshot."""

    if workbook_path is not None:
        return _load_local_rows(workbook_path)

    return _load_hosted_rows()


ResumenRows = Annotated[tuple[ResumenSourceRow, ...], Depends(get_resumen_rows)]


def require_admin_token(
    supplied_token: Annotated[
        str | None,
        Header(alias="X-Transelec-Admin-Token"),
    ] = None,
) -> None:
    """Protect upload and restore mutations with a pilot admin secret."""

    expected_token = os.environ.get("CAMPO_TRANSELEC_ADMIN_TOKEN", "").strip()

    if not expected_token:
        raise HTTPException(
            status_code=503,
            detail="Transelec administration is not configured",
        )

    if supplied_token is None or not secrets.compare_digest(
        supplied_token,
        expected_token,
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid Transelec administrator token",
        )


async def _read_workbook_body(request: Request) -> bytes:
    max_bytes = get_max_workbook_bytes()
    payload = bytearray()

    async for chunk in request.stream():
        if len(payload) + len(chunk) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=(f"Workbook exceeds the {max_bytes // (1024 * 1024)} MiB pilot limit"),
            )

        payload.extend(chunk)

    return bytes(payload)


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


@router.get(
    "/snapshots",
    response_model=list[TranselecSnapshotRecord],
)
def get_snapshots(
    engine: Annotated[Engine, Depends(get_transelec_database_engine)],
) -> list[TranselecSnapshotRecord]:
    """Return hosted workbook history, newest first."""

    try:
        return list(list_workbook_snapshots(engine))
    except TranselecSnapshotStoreError as exc:
        raise HTTPException(
            status_code=503,
            detail="Transelec snapshot history is unavailable",
        ) from exc


@router.post(
    "/snapshots",
    response_model=PublishWorkbookResponse,
    dependencies=[Depends(require_admin_token)],
)
async def publish_snapshot(
    request: Request,
    engine: Annotated[Engine, Depends(get_transelec_database_engine)],
    filename: Annotated[
        str | None,
        Header(alias="X-Filename"),
    ] = None,
) -> PublishWorkbookResponse:
    """Validate, persist, and atomically publish a workbook upload."""

    if filename is None or not filename.strip():
        raise HTTPException(
            status_code=400,
            detail="X-Filename header is required",
        )

    content = await _read_workbook_body(request)

    try:
        validated = validate_workbook_upload(
            content,
            filename=filename,
            media_type=request.headers.get("content-type"),
        )
        persisted: PersistedWorkbookSnapshot = persist_validated_workbook(
            engine,
            validated,
        )
    except TranselecWorkbookError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc
    except TranselecSnapshotStoreError as exc:
        raise HTTPException(
            status_code=503,
            detail="Transelec workbook could not be published",
        ) from exc

    return PublishWorkbookResponse(
        duplicate=persisted.duplicate,
        snapshot=persisted.snapshot,
    )


@router.post(
    "/snapshots/{source_snapshot_id}/activate",
    response_model=TranselecSnapshotRecord,
    dependencies=[Depends(require_admin_token)],
)
def activate_snapshot(
    source_snapshot_id: int,
    engine: Annotated[Engine, Depends(get_transelec_database_engine)],
) -> TranselecSnapshotRecord:
    """Restore a previously validated workbook version."""

    try:
        snapshot = activate_workbook_snapshot(
            engine,
            source_snapshot_id,
        )
    except TranselecSnapshotStoreError as exc:
        raise HTTPException(
            status_code=503,
            detail="Transelec workbook snapshot could not be activated",
        ) from exc

    if snapshot is None:
        raise HTTPException(
            status_code=404,
            detail="Transelec workbook snapshot not found",
        )

    return snapshot
