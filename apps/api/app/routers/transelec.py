"""Transelec HTTP adapter: upload, validate/project, publish, restore.

Route paths here are server-side paths (``/transelec/...``). Browsers reach
them at ``/api/transelec/...``: both the portal's dev proxy
(``apps/portal/vite.config.ts``) and the hosted static-site rewrite
(``render.yaml``) strip the ``/api`` prefix before forwarding, exactly as
they already do for ``/ingesta``. Mounting this router at ``/api`` would
therefore produce ``/api/api/transelec``.

This file is organized to grow: the shared pieces (product key, RBAC
dependency factory, response models, error copy) sit above a mutations
section, so a later slice adds read routes as a normal extension rather
than a rewrite.

Every mutation is session-authenticated, product-scoped RBAC-gated, and
CSRF-protected by the shared platform mechanism in ``app.csrf`` — the same
dependency the generic ``/ingesta/upload`` boundary uses, not a
Transelec-specific reimplementation.

Client-facing failures are deliberately generic and Spanish: a stakeholder
never sees a traceback, a file path, or row content. The technical detail
goes to the platform audit ledger and the process log only.
"""

from __future__ import annotations

import logging
import tempfile
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import Connection, Engine, text
from sqlalchemy.exc import StatementError

from app.access import Action, Role
from app.access_repository import AppUser
from app.audit import record_audit_event
from app.csrf import require_csrf
from app.database import get_database_engine
from app.deps import ensure_can, get_current_app_user, get_db_connection, get_object_store
from app.object_store import ObjectStore, ObjectStoreError
from app.routers.ingestion import UploadResponse
from app.routers.ingestion import upload as generic_upload
from app.transelec_publication import (
    TRANSELEC_PRODUCT_KEY,
    ActivationEventType,
    ImportNotFoundError,
    activate_import,
    read_active_import_id,
)
from transelec_ingestion.import_projection import (
    PARSER_VERSION,
    SCHEMA_CONTRACT_VERSION,
    ImportProjectionError,
    ImportProjectionResult,
    validate_and_project,
)
from transelec_ingestion.xlsx_contract import TranselecWorkbookError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transelec", tags=["transelec"])

_DOWNLOAD_CHUNK_BYTES = 1024 * 1024

# Stakeholder-safe Spanish copy. Never interpolate exception text, file
# paths, or row content into any of these.
_RUN_NOT_FOUND = "No se encontró la carga solicitada."
_IMPORT_NOT_FOUND = "No se encontró la versión solicitada."
_SOURCE_UNAVAILABLE = "El archivo cargado ya no está disponible. Vuelva a cargarlo."
_CONTRACT_VIOLATION = "La planilla no cumple el contrato de origen esperado. Contacte a soporte."
_PROJECTION_FAILED = "No se pudo verificar la importación. La versión activa no cambió."
_PUBLISH_FAILED = "No se pudo publicar la versión. La versión activa no cambió."

# Exceptions whose str() is known to carry only structural information —
# header names, column positions, row numbers, counts, ids. Everything else
# is reduced to its type name. This is an allowlist on purpose: it must stay
# safe for exception types nobody has audited yet, not just the ones we
# expect today.
_STRUCTURAL_DETAIL_EXCEPTIONS = (
    TranselecWorkbookError,
    ImportProjectionError,
    ImportNotFoundError,
)


def _safe_failure_detail(exc: BaseException) -> str:
    """Reduce an exception to a detail safe for the audit ledger and the log.

    ``app.audit``'s contract is that callers never pass secrets or raw source
    content in ``metadata``. A SQLAlchemy ``StatementError`` violates that if
    passed through verbatim: its ``str()`` appends ``[SQL: ...]`` and
    ``[parameters: ...]``, and for this router those bound parameters are
    every projected column value of the failing rows — real Transelec
    content, written durably to the ledger and the process log.

    So only the audited, structural exception types keep their full message.
    A database error keeps its type and, when the driver exposes one, the
    violated constraint's name — enough to diagnose, nothing of the data.
    """

    if isinstance(exc, _STRUCTURAL_DETAIL_EXCEPTIONS):
        return f"{type(exc).__name__}: {exc}"

    if isinstance(exc, StatementError):
        diagnostic = getattr(getattr(exc, "orig", None), "diag", None)
        constraint = getattr(diagnostic, "constraint_name", None)
        if constraint:
            return f"{type(exc).__name__}: constraint {constraint}"
        return type(exc).__name__

    return type(exc).__name__


def require_transelec_grant(action: Action) -> Callable[..., Role]:
    """Build a dependency requiring a Transelec grant permitting ``action``.

    Mirrors the existing per-product RBAC pattern
    (``app.routers.lidar.require_lidar_view``) and reuses the same
    primitives — ``app.access.can`` via ``app.deps.ensure_can`` — rather
    than introducing a second authorization layer.
    """

    def dependency(
        user: Annotated[AppUser, Depends(get_current_app_user)],
        connection: Annotated[Connection, Depends(get_db_connection)],
    ) -> Role:
        return ensure_can(
            connection,
            app_user_id=user.id,
            product_key=TRANSELEC_PRODUCT_KEY,
            action=action,
        )

    return dependency


class ValidateAndProjectResponse(BaseModel):
    """Outcome of Step B. ``status`` never means "published".

    ``validated`` — this call created the import.
    ``already_imported`` — an import already existed for this content
    snapshot and is not the active version.
    ``already_current`` — an import already existed and is already active,
    so the upload was a no-op.
    """

    status: Literal["validated", "already_imported", "already_current"]
    import_id: int
    source_snapshot_id: int
    ingestion_run_id: int
    schema_contract_version: str
    parser_version: str
    business_rows: int
    distinct_pmf: int
    distinct_provisional_predio_ids: int
    surface_total: float
    validated_at: str
    is_active: bool


class ActivationResponse(BaseModel):
    """Outcome of Step C (publish) or Step D (restore)."""

    status: Literal["published", "restored"]
    event_type: Literal["publish", "restore"]
    import_id: int
    previous_import_id: int | None
    publish_event_id: int
    occurred_at: str
    active_import_id: int


def _projection_response(
    result: ImportProjectionResult, *, active_import_id: int | None
) -> ValidateAndProjectResponse:
    is_active = active_import_id == result.import_id

    if not result.already_existed:
        status: Literal["validated", "already_imported", "already_current"] = "validated"
    elif is_active:
        status = "already_current"
    else:
        status = "already_imported"

    return ValidateAndProjectResponse(
        status=status,
        import_id=result.import_id,
        source_snapshot_id=result.source_snapshot_id,
        ingestion_run_id=result.ingestion_run_id,
        schema_contract_version=SCHEMA_CONTRACT_VERSION,
        parser_version=PARSER_VERSION,
        business_rows=result.business_rows,
        distinct_pmf=result.distinct_pmf,
        distinct_provisional_predio_ids=result.distinct_provisional_predio_ids,
        surface_total=result.surface_total,
        validated_at=result.validated_at.isoformat(),
        is_active=is_active,
    )


def _record_failure_audit(
    engine: Engine,
    *,
    actor_app_user_id: int,
    event_type: str,
    subject_kind: str,
    subject_id: str,
    metadata: dict[str, object],
) -> None:
    """Persist a failure audit event in its own transaction.

    The work transaction has already rolled back by the time this runs, so
    the evidence has to be written separately or it would roll back with it.
    Auditing must never turn a handled failure into an unhandled one, so a
    failure here is logged rather than raised.
    """

    try:
        with engine.begin() as audit_connection:
            record_audit_event(
                audit_connection,
                actor_app_user_id=actor_app_user_id,
                event_type=event_type,
                product_key=TRANSELEC_PRODUCT_KEY,
                subject_kind=subject_kind,
                subject_id=subject_id,
                metadata=metadata,
            )
    except Exception:  # noqa: BLE001 - auditing a failure must not mask it
        logger.exception("Could not record %s audit event for %s", event_type, subject_id)


# ---------------------------------------------------------------------------
# Mutations (OPERATOR/ADMIN, session-authenticated, CSRF-protected)
# ---------------------------------------------------------------------------


@router.post(
    "/uploads",
    response_model=UploadResponse,
    dependencies=[Depends(require_csrf)],
)
async def upload_transelec_workbook(
    user: Annotated[AppUser, Depends(get_current_app_user)],
    connection: Annotated[Connection, Depends(get_db_connection)],
    store: Annotated[ObjectStore, Depends(get_object_store)],
    file: Annotated[UploadFile, File()],
) -> UploadResponse:
    """Accept one Transelec workbook through the existing generic boundary.

    Delegates to the very handler ``POST /ingesta/upload`` runs — same
    bounded streaming intake, same evidence-only inspection, same
    content-addressed storage, same provenance and job rows — with
    ``product_key`` fixed rather than taken from the caller. The shared
    upload boundary is not modified for Transelec; Transelec-specific
    behavior begins at validate-and-project, below.

    Authorization is the generic boundary's own ``UPLOAD`` check against the
    Transelec grant, so no second RBAC gate is declared here.
    """

    return await generic_upload(
        user=user,
        connection=connection,
        store=store,
        product_key=TRANSELEC_PRODUCT_KEY,
        file=file,
    )


@router.post(
    "/imports/{ingestion_run_id}/validate-and-project",
    response_model=ValidateAndProjectResponse,
    dependencies=[Depends(require_csrf), Depends(require_transelec_grant(Action.PUBLISH))],
)
def validate_and_project_import(
    ingestion_run_id: int,
    user: Annotated[AppUser, Depends(get_current_app_user)],
    connection: Annotated[Connection, Depends(get_db_connection)],
    store: Annotated[ObjectStore, Depends(get_object_store)],
    engine: Annotated[Engine, Depends(get_database_engine)],
) -> ValidateAndProjectResponse:
    """Step B: hard-gate contract validation, row projection, invariant check.

    Commits its own transaction and activates nothing. A committed result is
    a validated version the dashboard does not yet serve; publishing it is a
    separate, explicit call.

    Idempotent per content snapshot: re-running this for a snapshot that
    already has an import returns that import instead of projecting again,
    and never activates it.
    """

    run = connection.execute(
        text(
            """
            SELECT r.id, r.product_key, r.source_snapshot_id, s.object_storage_key
            FROM platform.ingestion_run AS r
            JOIN platform.source_snapshot AS s ON s.id = r.source_snapshot_id
            WHERE r.id = :ingestion_run_id
            """
        ),
        {"ingestion_run_id": ingestion_run_id},
    ).one_or_none()

    # A run belonging to another product is reported as not-found, never as
    # forbidden: this endpoint must not confirm another product's run exists
    # to a caller granted only Transelec.
    if run is None or run.product_key != TRANSELEC_PRODUCT_KEY:
        raise HTTPException(status_code=404, detail=_RUN_NOT_FOUND)

    if run.object_storage_key is None:
        raise HTTPException(status_code=409, detail=_SOURCE_UNAVAILABLE)

    temp_path = Path(tempfile.gettempdir()) / f"campo-transelec-{uuid.uuid4().hex}.xlsx"

    try:
        try:
            with store.open(run.object_storage_key) as source, temp_path.open("wb") as sink:
                while chunk := source.read(_DOWNLOAD_CHUNK_BYTES):
                    sink.write(chunk)
        except ObjectStoreError as exc:
            logger.warning(
                "Transelec source object unavailable for ingestion_run_id=%s: %s",
                ingestion_run_id,
                exc,
            )
            raise HTTPException(status_code=409, detail=_SOURCE_UNAVAILABLE) from exc

        try:
            # Step B's own transaction. It ends in COMMIT or ROLLBACK here
            # and nowhere else, and no activation is reachable inside it.
            with engine.begin() as step_b:
                result = validate_and_project(
                    step_b,
                    workbook_path=temp_path,
                    source_snapshot_id=run.source_snapshot_id,
                    ingestion_run_id=ingestion_run_id,
                    validated_by_app_user_id=user.id,
                )
                if not result.already_existed:
                    record_audit_event(
                        step_b,
                        actor_app_user_id=user.id,
                        event_type="import.validated",
                        product_key=TRANSELEC_PRODUCT_KEY,
                        subject_kind="transelec_import",
                        subject_id=str(result.import_id),
                        metadata={
                            "ingestion_run_id": ingestion_run_id,
                            "source_snapshot_id": run.source_snapshot_id,
                            "business_rows": result.business_rows,
                            "distinct_pmf": result.distinct_pmf,
                            "distinct_provisional_predio_ids": (
                                result.distinct_provisional_predio_ids
                            ),
                            "surface_total": result.surface_total,
                        },
                    )
        except Exception as exc:
            # Whatever failed, the Step B transaction rolled back: no
            # transelec_import row, no transelec_resumen_row rows, and
            # transelec_dashboard_state untouched.
            is_contract_violation = isinstance(exc, TranselecWorkbookError)
            detail = _safe_failure_detail(exc)
            logger.warning(
                "Transelec validate-and-project failed for ingestion_run_id=%s: %s",
                ingestion_run_id,
                detail,
            )
            _record_failure_audit(
                engine,
                actor_app_user_id=user.id,
                event_type="import.validation.failed",
                subject_kind="ingestion_run",
                subject_id=str(ingestion_run_id),
                metadata={
                    "source_snapshot_id": run.source_snapshot_id,
                    "reason": "contract_violation" if is_contract_violation else "projection_error",
                    "detail": detail,
                },
            )
            raise HTTPException(
                status_code=422 if is_contract_violation else 500,
                detail=_CONTRACT_VIOLATION if is_contract_violation else _PROJECTION_FAILED,
            ) from exc
    finally:
        temp_path.unlink(missing_ok=True)

    return _projection_response(result, active_import_id=read_active_import_id(connection))


def _activate(
    import_id: int,
    *,
    user: AppUser,
    engine: Engine,
    event_type: ActivationEventType,
    audit_event_type: str,
) -> ActivationResponse:
    """Run Step C/D: one short transaction that atomically flips the active version."""

    try:
        with engine.begin() as activation:
            result = activate_import(
                activation,
                import_id=import_id,
                actor_user_id=user.id,
                event_type=event_type,
            )
            record_audit_event(
                activation,
                actor_app_user_id=user.id,
                event_type=audit_event_type,
                product_key=TRANSELEC_PRODUCT_KEY,
                subject_kind="transelec_import",
                subject_id=str(import_id),
                metadata={
                    "event_type": event_type,
                    "previous_import_id": result.previous_import_id,
                    "publish_event_id": result.publish_event_id,
                },
            )
    except Exception as exc:
        not_found = isinstance(exc, ImportNotFoundError)
        detail = _safe_failure_detail(exc)
        logger.warning("Transelec %s failed for import_id=%s: %s", event_type, import_id, detail)
        _record_failure_audit(
            engine,
            actor_app_user_id=user.id,
            event_type="import.publish.failed",
            subject_kind="transelec_import",
            subject_id=str(import_id),
            metadata={
                "event_type": event_type,
                "reason": "import_not_found" if not_found else "activation_error",
                "detail": detail,
            },
        )
        raise HTTPException(
            status_code=404 if not_found else 500,
            detail=_IMPORT_NOT_FOUND if not_found else _PUBLISH_FAILED,
        ) from exc

    return ActivationResponse(
        status="published" if event_type == "publish" else "restored",
        event_type=event_type,
        import_id=result.import_id,
        previous_import_id=result.previous_import_id,
        publish_event_id=result.publish_event_id,
        occurred_at=result.occurred_at.isoformat(),
        active_import_id=result.import_id,
    )


@router.post(
    "/imports/{import_id}/publish",
    response_model=ActivationResponse,
    dependencies=[Depends(require_csrf), Depends(require_transelec_grant(Action.PUBLISH))],
)
def publish_import(
    import_id: int,
    user: Annotated[AppUser, Depends(get_current_app_user)],
    engine: Annotated[Engine, Depends(get_database_engine)],
) -> ActivationResponse:
    """Step C: make an already-validated import the version the dashboard serves.

    Never automatic. A successful validate-and-project does not reach this
    code path; an operator has to call it deliberately.
    """

    return _activate(
        import_id,
        user=user,
        engine=engine,
        event_type="publish",
        audit_event_type="import.published",
    )


@router.post(
    "/imports/{import_id}/restore",
    response_model=ActivationResponse,
    dependencies=[Depends(require_csrf), Depends(require_transelec_grant(Action.PUBLISH))],
)
def restore_import(
    import_id: int,
    user: Annotated[AppUser, Depends(get_current_app_user)],
    engine: Annotated[Engine, Depends(get_database_engine)],
) -> ActivationResponse:
    """Step D: re-activate a previously validated import.

    The same activation primitive as publish, recorded as
    ``event_type='restore'`` so the trail distinguishes "published a new
    version" from "reverted to an old one". No re-validation happens, and
    none is possible to need: Step B never commits an invalid import.
    """

    return _activate(
        import_id,
        user=user,
        engine=engine,
        event_type="restore",
        audit_event_type="import.restored",
    )
