"""Transelec HTTP adapter for the hosted pilot and local development."""

from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
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

router = APIRouter()
logger = logging.getLogger(__name__)


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
            detail="El almacenamiento alojado de Transelec no está configurado.",
        ) from exc


def _load_local_rows(workbook_path: Path) -> tuple[ResumenSourceRow, ...]:
    try:
        workbook = load_transelec_workbook(workbook_path)
    except (TranselecWorkbookError, OSError):
        # Never echo the exception back to the client: it may embed a
        # filesystem path (CAMPO_TRANSELEC_WORKBOOK_PATH). Log it instead.
        logger.warning(
            "Transelec local workbook source is unavailable",
            exc_info=True,
        )
        raise HTTPException(
            status_code=503,
            detail="La fuente de datos de Transelec no está disponible.",
        ) from None

    return workbook.resumen_rows


def _load_hosted_rows() -> tuple[ResumenSourceRow, ...]:
    engine = get_transelec_database_engine()

    try:
        active = get_active_workbook_snapshot(engine)
    except TranselecSnapshotStoreError as exc:
        raise HTTPException(
            status_code=503,
            detail="La fuente de datos alojada de Transelec no está disponible.",
        ) from exc

    if active is None:
        raise HTTPException(
            status_code=503,
            detail="Aún no se ha publicado ninguna planilla de Transelec.",
        )

    try:
        workbook = load_workbook_from_bytes(
            active.content,
            filename=active.snapshot.filename,
        )
    except (TranselecWorkbookError, OSError) as exc:
        raise HTTPException(
            status_code=503,
            detail="La planilla activa de Transelec no se pudo leer.",
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
            detail="La administración de Transelec no está configurada.",
        )

    if supplied_token is None or not secrets.compare_digest(
        supplied_token,
        expected_token,
    ):
        raise HTTPException(
            status_code=401,
            detail="Clave de administración de Transelec inválida.",
        )


async def _read_workbook_body(request: Request) -> bytes:
    max_bytes = get_max_workbook_bytes()
    payload = bytearray()

    async for chunk in request.stream():
        if len(payload) + len(chunk) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"La planilla supera el límite permitido de {max_bytes // (1024 * 1024)} MiB."
                ),
            )

        payload.extend(chunk)

    return bytes(payload)


@router.get(
    "/summary",
    response_model=pmf_view.TranselecSummary,
)
def get_summary(
    rows: ResumenRows,
    search: str | None = None,
    status: Annotated[list[str] | None, Query()] = None,
    sector: Annotated[list[str] | None, Query()] = None,
    empresa: Annotated[list[str] | None, Query()] = None,
    pas: Annotated[list[str] | None, Query()] = None,
    tipo_propietario: Annotated[list[str] | None, Query()] = None,
) -> pmf_view.TranselecSummary:
    """Return KPI/status-distribution numbers for the active filter set.

    Accepts the same filter query parameters as `/pmfs` so the KPIs and the
    PMF table always describe the same filtered selection.
    """

    filtered_rows = pmf_view.filter_resumen_rows(
        rows,
        search=search,
        status=status,
        sector=sector,
        empresa=empresa,
        pas=pas,
        tipo_propietario=tipo_propietario,
    )

    return pmf_view.build_summary(filtered_rows)


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
    status: Annotated[list[str] | None, Query()] = None,
    sector: Annotated[list[str] | None, Query()] = None,
    empresa: Annotated[list[str] | None, Query()] = None,
    pas: Annotated[list[str] | None, Query()] = None,
    tipo_propietario: Annotated[list[str] | None, Query()] = None,
) -> list[pmf_view.PmfListItem]:
    """List current PMFs, filtered by search plus multi-select dimensions.

    Each of `status`, `sector`, `empresa`, `pas`, and `tipo_propietario`
    accepts repeated query parameters (e.g. `?status=A&status=B`) and is
    matched with OR semantics within the dimension; dimensions combine with
    AND semantics.
    """

    return list(
        pmf_view.list_pmfs(
            rows,
            search=search,
            status=status,
            sector=sector,
            empresa=empresa,
            pas=pas,
            tipo_propietario=tipo_propietario,
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
            detail="PMF no encontrado en la fuente actual.",
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
            detail="El historial de versiones de Transelec no está disponible.",
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
            detail="Falta el encabezado X-Filename con el nombre de la planilla.",
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
            detail="No fue posible publicar la planilla de Transelec.",
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
            detail="No fue posible activar la versión de la planilla de Transelec.",
        ) from exc

    if snapshot is None:
        raise HTTPException(
            status_code=404,
            detail="Versión de planilla de Transelec no encontrada.",
        )

    return snapshot
