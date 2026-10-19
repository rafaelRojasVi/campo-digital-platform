"""Rodales management reports (informes de manejo) over HTTP.

All routes sit under ``/api/forestry/reports`` behind ``require_forestry_viewer``
(a session plus a ``forestry`` grant). Writes need CSRF and:

- ``Action.EDIT`` (operator, admin): create, save features, rename, submit,
  duplicate, delete a never-submitted draft;
- ``Action.APPROVE`` (admin): approve, request changes, archive.

Viewers see approved reports only; any other report answers ``404`` to them,
so a draft's existence is not disclosed. Errors carry a stable ``code`` and
a Spanish ``message``. Geometry travels as GeoJSON in EPSG:32718 metres.

The save route is a fixed path (``PUT /features``, report id in the body)
so the body-limit middleware can raise its bound and refuse it without a
live session before reading it (``app.main``).
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from pydantic import BaseModel, Field
from shapely.geometry import mapping
from sqlalchemy import Engine

from app.access import Action, can
from app.access_repository import AppUser
from app.audit import record_audit_event
from app.csrf import require_csrf
from app.database import get_database_engine
from app.deps import get_current_app_user
from app.forestry_publication import read_published_snapshot_id
from app.forestry_report_export import ExportFormat, ExportReport, ExportRow, export_report
from app.forestry_report_geometry import (
    MAX_FEATURES,
    FeatureInput,
    ReportValidationError,
    ReportWarning,
)
from app.forestry_reports import (
    Report,
    ReportError,
    ReportStatus,
    ReportType,
    TransitionAction,
    _check_date,
    create_report,
    delete_report,
    duplicate_report,
    get_report,
    list_report_features,
    list_report_notes,
    list_report_sources,
    list_reports,
    load_source_polygons,
    save_report_features,
    transition_report,
    update_report_header,
)
from app.routers.forestry import (
    FORESTRY_PRODUCT_KEY,
    ReadConnection,
    ViewerRole,
    require_forestry_viewer,
)
from app.routers.forestry_workflow import require_forestry_grant

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/forestry/reports",
    tags=["forestry"],
    dependencies=[Depends(require_forestry_viewer)],
)

REPORT_FEATURES_PATH = "/api/forestry/reports/features"
# A 500-polygon report with detailed outlines stays well under this.
REPORT_FEATURES_MAX_BYTES = 8 * 1024 * 1024
_SRID = 32718

ReportIdPath = Annotated[int, Path(ge=1)]
CurrentUser = Annotated[AppUser, Depends(get_current_app_user)]
DatabaseEngine = Annotated[Engine, Depends(get_database_engine)]
_EDIT = [Depends(require_csrf), Depends(require_forestry_grant(Action.EDIT))]
_APPROVE = [Depends(require_csrf), Depends(require_forestry_grant(Action.APPROVE))]

_STATUS_FOR_CODE = {
    "not_found": 404,
    "no_published_base": 409,
    "name_taken": 409,
    "invalid_name": 422,
    "invalid_month": 422,
    "invalid_date": 422,
    "not_editable": 409,
    "stale_revision": 409,
    "invalid_transition": 409,
    "nothing_marked": 422,
    "note_required": 422,
    "note_too_long": 422,
    "cannot_delete": 409,
    "invalid_conaf": 422,
}
_AUDIT_FOR_ACTION: dict[str, str] = {
    "submit": "forestry.report.submitted",
    "approve": "forestry.report.approved",
    "request_changes": "forestry.report.changes_requested",
    "archive": "forestry.report.archived",
}


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ReportModel(BaseModel):
    report_id: int
    name: str
    report_type: str
    report_month: str
    report_date: dt.date | None
    status: str
    base_snapshot_id: int
    revision: int
    created_by_display_name: str
    created_at: dt.datetime
    updated_at: dt.datetime
    submitted_at: dt.datetime | None
    decided_at: dt.datetime | None
    decided_by_display_name: str | None
    feature_count: int
    managed_feature_count: int
    managed_area_ha: float
    conaf_solicitud: str | None


class ReportListResponse(BaseModel):
    reports: list[ReportModel]
    pending_review_count: int


class FeatureModel(BaseModel):
    position: int
    source_feature_ordinal: int
    in_report: bool
    geometry_changed: bool
    attributes: dict[str, Any]
    geometry: dict[str, Any]


class SourceModel(BaseModel):
    source_feature_ordinal: int
    attributes: dict[str, Any]
    geometry: dict[str, Any]
    is_valid: bool


class NoteModel(BaseModel):
    kind: str
    body: str
    author_display_name: str
    created_at: dt.datetime


class ReportDetailResponse(BaseModel):
    report: ReportModel
    features: list[FeatureModel]
    sources: list[SourceModel]
    notes: list[NoteModel]
    srid: int
    published_snapshot_id: int | None


class SourcePolygonsResponse(BaseModel):
    sources: list[SourceModel]
    srid: int


class CreateReportRequest(BaseModel):
    name: str = Field(max_length=500)
    report_type: ReportType
    report_date: str  # ISO YYYY-MM-DD; validated in the handler via _check_date


class UpdateReportRequest(BaseModel):
    revision: int = Field(ge=1)
    name: str | None = Field(default=None, max_length=500)
    report_type: ReportType | None = None
    report_date: str | None = None  # ISO YYYY-MM-DD when provided
    conaf_solicitud: str | None = Field(default=None, max_length=50)


class FeatureInputModel(BaseModel):
    source_feature_ordinal: int = Field(ge=1)
    in_report: bool = False
    attributes: dict[str, Any] = Field(default_factory=dict)
    geometry: dict[str, Any] | None = None


class SaveFeaturesRequest(BaseModel):
    report_id: int = Field(ge=1)
    revision: int = Field(ge=1)
    features: list[FeatureInputModel]


class WarningModel(BaseModel):
    code: str
    message: str
    source_feature_ordinal: int | None


class SaveFeaturesResponse(BaseModel):
    revision: int
    feature_count: int
    warnings: list[WarningModel]


class TransitionRequest(BaseModel):
    revision: int = Field(ge=1)
    note: str | None = Field(default=None, max_length=10_000)


class StatusResponse(BaseModel):
    report_id: int
    status: str
    revision: int


class CreatedResponse(BaseModel):
    report_id: int


def _report_model(report: Report) -> ReportModel:
    return ReportModel(
        report_id=report.id,
        name=report.name,
        report_type=report.report_type,
        report_month=report.report_month,
        report_date=report.report_date,
        status=report.status,
        base_snapshot_id=report.base_snapshot_id,
        revision=report.revision,
        created_by_display_name=report.created_by_display_name,
        created_at=report.created_at,
        updated_at=report.updated_at,
        submitted_at=report.submitted_at,
        decided_at=report.decided_at,
        decided_by_display_name=report.decided_by_display_name,
        feature_count=report.feature_count,
        managed_feature_count=report.managed_feature_count,
        managed_area_ha=report.managed_area_ha,
        conaf_solicitud=report.conaf_solicitud,
    )


def _warning_model(warning: ReportWarning) -> WarningModel:
    return WarningModel(
        code=warning.code,
        message=warning.message,
        source_feature_ordinal=warning.source_feature_ordinal,
    )


def _http_error(error: ReportError | ReportValidationError) -> HTTPException:
    detail: dict[str, Any] = {"code": error.code, "message": error.message}
    if isinstance(error, ReportValidationError):
        if error.source_feature_ordinal is not None:
            detail["source_feature_ordinal"] = error.source_feature_ordinal
        return HTTPException(status_code=422, detail=detail)
    return HTTPException(status_code=_STATUS_FOR_CODE[error.code], detail=detail)


def _visible_report(connection: ReadConnection, role: ViewerRole, report_id: int) -> Report:
    report = get_report(connection, report_id)
    if report is None or (not can(role, Action.EDIT) and report.status != "aprobado"):
        raise _http_error(ReportError("not_found"))
    return report


def _audit(
    engine: Engine, user: AppUser, event_type: str, report_id: int, metadata: dict[str, object]
) -> None:
    with engine.begin() as connection:
        record_audit_event(
            connection,
            actor_app_user_id=user.id,
            event_type=event_type,
            product_key=FORESTRY_PRODUCT_KEY,
            subject_kind="forestry_report",
            subject_id=str(report_id),
            metadata=metadata,
        )


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


@router.get("", response_model=ReportListResponse)
def get_reports(
    connection: ReadConnection,
    role: ViewerRole,
    status: ReportStatus | None = None,
    report_type: ReportType | None = None,
) -> ReportListResponse:
    """«Informes»: the list; viewers get approved reports only."""

    reports = list_reports(connection, statuses=None if can(role, Action.EDIT) else ["aprobado"])
    pending = sum(1 for r in reports if r.status == "enviado") if can(role, Action.APPROVE) else 0
    if status is not None:
        reports = [r for r in reports if r.status == status]
    if report_type is not None:
        reports = [r for r in reports if r.report_type == report_type]
    return ReportListResponse(
        reports=[_report_model(r) for r in reports], pending_review_count=pending
    )


@router.get("/{report_id}", response_model=ReportDetailResponse)
def get_report_detail(
    report_id: ReportIdPath, connection: ReadConnection, role: ViewerRole
) -> ReportDetailResponse:
    report = _visible_report(connection, role, report_id)
    return ReportDetailResponse(
        report=_report_model(report),
        features=[
            FeatureModel(
                position=f.position,
                source_feature_ordinal=f.source_feature_ordinal,
                in_report=f.in_report,
                geometry_changed=f.geometry_changed,
                attributes=f.attributes,
                geometry=dict(mapping(f.geometry)),
            )
            for f in list_report_features(connection, report_id)
        ],
        sources=[
            SourceModel(
                source_feature_ordinal=s.feature_ordinal,
                attributes=dict(s.attributes),
                geometry=dict(mapping(s.geometry)),
                is_valid=s.is_valid,
            )
            for s in list_report_sources(connection, report_id)
        ],
        notes=[
            NoteModel(
                kind=n.kind,
                body=n.body,
                author_display_name=n.author_display_name,
                created_at=n.created_at,
            )
            for n in list_report_notes(connection, report_id)
        ],
        srid=_SRID,
        published_snapshot_id=read_published_snapshot_id(connection),
    )


@router.get(
    "/{report_id}/source-polygons",
    response_model=SourcePolygonsResponse,
    dependencies=[Depends(require_forestry_grant(Action.EDIT))],
)
def get_source_polygons(
    report_id: ReportIdPath,
    connection: ReadConnection,
    ordinals: Annotated[str, Query(pattern=r"^[0-9]+(,[0-9]+)*$", max_length=5000)],
) -> SourcePolygonsResponse:
    """Base polygons in UTM for the editor to split (the report's own base)."""

    report = get_report(connection, report_id)
    if report is None:
        raise _http_error(ReportError("not_found"))
    wanted = sorted({int(value) for value in ordinals.split(",")})[:MAX_FEATURES]
    sources = load_source_polygons(connection, snapshot_id=report.base_snapshot_id, ordinals=wanted)
    return SourcePolygonsResponse(
        sources=[
            SourceModel(
                source_feature_ordinal=s.feature_ordinal,
                attributes=dict(s.attributes),
                geometry=dict(mapping(s.geometry)),
                is_valid=s.is_valid,
            )
            for s in (sources[o] for o in sorted(sources))
        ],
        srid=_SRID,
    )


@router.get("/{report_id}/export")
def export_report_file(
    report_id: ReportIdPath,
    connection: ReadConnection,
    role: ViewerRole,
    user: CurrentUser,
    engine: DatabaseEngine,
    format: ExportFormat = "shp",  # noqa: A002 - the query parameter's public name
    scope: Literal["all", "marked"] = "all",
) -> Response:
    report = _visible_report(connection, role, report_id)
    rows = [
        ExportRow(f.attributes, f.geometry, f.in_report, f.geometry_changed)
        for f in list_report_features(connection, report_id)
        if scope == "all" or f.in_report
    ]
    content, media_type, filename = export_report(
        format,
        ExportReport(
            report.name,
            report.report_type,
            report.report_month,
            report.status,
            report.report_date,
            report.conaf_solicitud,
        ),
        rows,
    )
    _audit(
        engine,
        user,
        "forestry.report.exported",
        report_id,
        {"format": format, "scope": scope, "row_count": len(rows)},
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


@router.post("", response_model=CreatedResponse, status_code=201, dependencies=_EDIT)
def post_report(
    request: CreateReportRequest, user: CurrentUser, engine: DatabaseEngine
) -> CreatedResponse:
    """«Nuevo informe» against the published base."""

    try:
        report_date = _check_date(request.report_date)
        with engine.begin() as connection:
            report_id = create_report(
                connection,
                name=request.name,
                report_type=request.report_type,
                report_date=report_date,
                actor_app_user_id=user.id,
            )
            record_audit_event(
                connection,
                actor_app_user_id=user.id,
                event_type="forestry.report.created",
                product_key=FORESTRY_PRODUCT_KEY,
                subject_kind="forestry_report",
                subject_id=str(report_id),
                metadata={"report_type": request.report_type},
            )
    except ReportError as error:
        raise _http_error(error) from error
    return CreatedResponse(report_id=report_id)


@router.put("/features", response_model=SaveFeaturesResponse, dependencies=_EDIT)
def put_report_features(
    request: SaveFeaturesRequest, user: CurrentUser, engine: DatabaseEngine
) -> SaveFeaturesResponse:
    """«Guardar»: replace the report's features (checked against its base)."""

    inputs = [
        FeatureInput(f.source_feature_ordinal, f.in_report, f.attributes, f.geometry)
        for f in request.features
    ]
    try:
        with engine.begin() as connection:
            outcome = save_report_features(
                connection,
                report_id=request.report_id,
                expected_revision=request.revision,
                inputs=inputs,
            )
            record_audit_event(
                connection,
                actor_app_user_id=user.id,
                event_type="forestry.report.saved",
                product_key=FORESTRY_PRODUCT_KEY,
                subject_kind="forestry_report",
                subject_id=str(request.report_id),
                metadata={
                    "revision": outcome.revision,
                    "feature_count": outcome.feature_count,
                    "warning_codes": sorted({w.code for w in outcome.warnings}),
                },
            )
    except (ReportError, ReportValidationError) as error:
        raise _http_error(error) from error
    return SaveFeaturesResponse(
        revision=outcome.revision,
        feature_count=outcome.feature_count,
        warnings=[_warning_model(w) for w in outcome.warnings],
    )


_PATCH_DATE_UNSET = object()  # sentinel: report_date was not included in the PATCH body


@router.patch("/{report_id}", response_model=StatusResponse, dependencies=_EDIT)
def patch_report(
    report_id: ReportIdPath, request: UpdateReportRequest, user: CurrentUser, engine: DatabaseEngine
) -> StatusResponse:
    try:
        # Validate and convert the date string when provided in the body.
        parsed_date: object = _PATCH_DATE_UNSET
        if "report_date" in request.model_fields_set:
            if request.report_date is not None:
                parsed_date = _check_date(request.report_date)
            else:
                parsed_date = None  # explicit null clears the date

        with engine.begin() as connection:
            revision = update_report_header(
                connection,
                report_id=report_id,
                expected_revision=request.revision,
                name=request.name,
                report_type=request.report_type,
                # Only when sent: «null» clears the date, leaving it out keeps it.
                **({"report_date": parsed_date} if parsed_date is not _PATCH_DATE_UNSET else {}),
                # Only when sent: «null» clears the number, leaving it out keeps it.
                **(
                    {"conaf_solicitud": request.conaf_solicitud}
                    if "conaf_solicitud" in request.model_fields_set
                    else {}
                ),
            )
            record_audit_event(
                connection,
                actor_app_user_id=user.id,
                event_type="forestry.report.saved",
                product_key=FORESTRY_PRODUCT_KEY,
                subject_kind="forestry_report",
                subject_id=str(report_id),
                metadata={"revision": revision, "header": True},
            )
            current = get_report(connection, report_id)
    except ReportError as error:
        raise _http_error(error) from error
    status = current.status if current is not None else "borrador"
    return StatusResponse(report_id=report_id, status=status, revision=revision)


def _transition(
    report_id: int,
    request: TransitionRequest,
    user: AppUser,
    engine: Engine,
    action: TransitionAction,
) -> StatusResponse:
    try:
        with engine.begin() as connection:
            status = transition_report(
                connection,
                report_id=report_id,
                action=action,
                expected_revision=request.revision,
                actor_app_user_id=user.id,
                note=request.note,
            )
            record_audit_event(
                connection,
                actor_app_user_id=user.id,
                event_type=_AUDIT_FOR_ACTION[action],
                product_key=FORESTRY_PRODUCT_KEY,
                subject_kind="forestry_report",
                subject_id=str(report_id),
                metadata={"revision": request.revision + 1},
            )
    except ReportError as error:
        raise _http_error(error) from error
    return StatusResponse(report_id=report_id, status=status, revision=request.revision + 1)


@router.post("/{report_id}/submit", response_model=StatusResponse, dependencies=_EDIT)
def submit_report(
    report_id: ReportIdPath, request: TransitionRequest, user: CurrentUser, engine: DatabaseEngine
) -> StatusResponse:
    """«Enviar a revisión»."""

    return _transition(report_id, request, user, engine, "submit")


@router.post("/{report_id}/approve", response_model=StatusResponse, dependencies=_APPROVE)
def approve_report(
    report_id: ReportIdPath, request: TransitionRequest, user: CurrentUser, engine: DatabaseEngine
) -> StatusResponse:
    """«Aprobar»."""

    return _transition(report_id, request, user, engine, "approve")


@router.post("/{report_id}/request-changes", response_model=StatusResponse, dependencies=_APPROVE)
def request_report_changes(
    report_id: ReportIdPath, request: TransitionRequest, user: CurrentUser, engine: DatabaseEngine
) -> StatusResponse:
    """«Pedir cambios» (note required)."""

    return _transition(report_id, request, user, engine, "request_changes")


@router.post("/{report_id}/archive", response_model=StatusResponse, dependencies=_APPROVE)
def archive_report(
    report_id: ReportIdPath, request: TransitionRequest, user: CurrentUser, engine: DatabaseEngine
) -> StatusResponse:
    return _transition(report_id, request, user, engine, "archive")


@router.post(
    "/{report_id}/duplicate", response_model=CreatedResponse, status_code=201, dependencies=_EDIT
)
def duplicate(
    report_id: ReportIdPath, user: CurrentUser, engine: DatabaseEngine
) -> CreatedResponse:
    """«Duplicar como borrador»."""

    try:
        with engine.begin() as connection:
            new_id = duplicate_report(connection, report_id=report_id, actor_app_user_id=user.id)
            record_audit_event(
                connection,
                actor_app_user_id=user.id,
                event_type="forestry.report.duplicated",
                product_key=FORESTRY_PRODUCT_KEY,
                subject_kind="forestry_report",
                subject_id=str(new_id),
                metadata={"from_report_id": report_id},
            )
    except ReportError as error:
        raise _http_error(error) from error
    return CreatedResponse(report_id=new_id)


@router.delete("/{report_id}", status_code=204, dependencies=_EDIT)
def delete(report_id: ReportIdPath, user: CurrentUser, engine: DatabaseEngine) -> Response:
    try:
        with engine.begin() as connection:
            delete_report(connection, report_id=report_id)
            record_audit_event(
                connection,
                actor_app_user_id=user.id,
                event_type="forestry.report.deleted",
                product_key=FORESTRY_PRODUCT_KEY,
                subject_kind="forestry_report",
                subject_id=str(report_id),
                metadata={},
            )
    except ReportError as error:
        raise _http_error(error) from error
    return Response(status_code=204)
