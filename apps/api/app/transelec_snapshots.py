"""Hosted Transelec workbook validation, persistence, and activation."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.object_storage import (
    ObjectStorageError,
    ObjectStore,
    content_addressed_key,
    get_object_store,
)
from app.source_discovery import SourceFileFingerprint, SourceFileObservation
from app.source_provenance import (
    SourceProvenanceError,
    persist_filesystem_source_provenance,
)
from transelec_ingestion import pmf_view
from transelec_ingestion.xlsx_contract import (
    TranselecWorkbook,
    TranselecWorkbookError,
    load_transelec_workbook,
)

SYSTEM_KEY = "transelec-manual-upload"
LOGICAL_SOURCE_PATH = "transelec/manual-upload/current-workbook.xlsx"
ALLOWED_WORKBOOK_SUFFIXES = frozenset({".xlsx", ".xlsm"})
OBJECT_STORE_NAMESPACE = "transelec/workbooks"
DEFAULT_MAX_WORKBOOK_BYTES = 64 * 1024 * 1024


class TranselecSnapshotStoreError(RuntimeError):
    """Raised when hosted Transelec snapshot persistence cannot complete."""


def get_max_workbook_bytes() -> int:
    """Return the configurable maximum accepted workbook upload size."""

    configured = os.environ.get("CAMPO_TRANSELEC_MAX_UPLOAD_BYTES", "").strip()

    if not configured:
        return DEFAULT_MAX_WORKBOOK_BYTES

    try:
        value = int(configured)
    except ValueError as exc:
        raise TranselecSnapshotStoreError(
            "CAMPO_TRANSELEC_MAX_UPLOAD_BYTES must be a positive integer"
        ) from exc

    if value <= 0:
        raise TranselecSnapshotStoreError(
            "CAMPO_TRANSELEC_MAX_UPLOAD_BYTES must be a positive integer"
        )

    return value


@dataclass(frozen=True, slots=True)
class ValidatedWorkbookUpload:
    """A workbook that has passed the established Transelec source contract."""

    filename: str
    media_type: str | None
    content: bytes
    content_sha256: str
    workbook: TranselecWorkbook
    summary: pmf_view.TranselecSummary


@dataclass(frozen=True, slots=True)
class TranselecSnapshotRecord:
    """Public metadata for one immutable hosted workbook snapshot."""

    source_snapshot_id: int
    filename: str
    media_type: str | None
    content_sha256: str
    byte_size: int
    business_rows: int
    distinct_pmf: int
    distinct_provisional_predio_ids: int
    surface_total: float
    created_at: datetime
    active: bool


@dataclass(frozen=True, slots=True)
class PersistedWorkbookSnapshot:
    """Result of publishing a validated workbook."""

    snapshot: TranselecSnapshotRecord
    duplicate: bool


@dataclass(frozen=True, slots=True)
class ActiveWorkbookSnapshot:
    """The active hosted workbook and its metadata."""

    snapshot: TranselecSnapshotRecord
    content: bytes


def sanitize_upload_filename(filename: str) -> str:
    """Return a safe basename for a user-supplied workbook filename."""

    normalized = Path(filename.strip()).name

    if not normalized or normalized in {".", ".."}:
        raise TranselecWorkbookError("Workbook filename is required")

    if Path(normalized).suffix.lower() not in ALLOWED_WORKBOOK_SUFFIXES:
        raise TranselecWorkbookError("Workbook must use an .xlsx or .xlsm filename")

    return normalized


def load_workbook_from_bytes(
    content: bytes,
    *,
    filename: str,
) -> TranselecWorkbook:
    """Parse workbook bytes through the path-based source contract."""

    safe_filename = sanitize_upload_filename(filename)

    if not content:
        raise TranselecWorkbookError("Workbook is empty")

    max_bytes = get_max_workbook_bytes()

    if len(content) > max_bytes:
        raise TranselecWorkbookError(
            f"Workbook exceeds the {max_bytes // (1024 * 1024)} MiB pilot limit"
        )

    with TemporaryDirectory(prefix="campo-transelec-") as temporary_directory:
        workbook_path = Path(temporary_directory) / safe_filename
        workbook_path.write_bytes(content)
        return load_transelec_workbook(workbook_path)


def validate_workbook_upload(
    content: bytes,
    *,
    filename: str,
    media_type: str | None = None,
) -> ValidatedWorkbookUpload:
    """Validate upload bytes before any persistent state changes occur."""

    safe_filename = sanitize_upload_filename(filename)
    workbook = load_workbook_from_bytes(content, filename=safe_filename)
    summary = pmf_view.build_summary(workbook.resumen_rows)

    normalized_media_type = media_type.strip() if media_type else None

    return ValidatedWorkbookUpload(
        filename=safe_filename,
        media_type=normalized_media_type or None,
        content=content,
        content_sha256=hashlib.sha256(content).hexdigest(),
        workbook=workbook,
        summary=summary,
    )


def _snapshot_from_row(row: Any) -> TranselecSnapshotRecord:
    mapping = row._mapping

    return TranselecSnapshotRecord(
        source_snapshot_id=int(mapping["source_snapshot_id"]),
        filename=str(mapping["filename"]),
        media_type=(str(mapping["media_type"]) if mapping["media_type"] is not None else None),
        content_sha256=str(mapping["content_sha256"]),
        byte_size=int(mapping["byte_size"]),
        business_rows=int(mapping["business_rows"]),
        distinct_pmf=int(mapping["distinct_pmf"]),
        distinct_provisional_predio_ids=int(mapping["distinct_provisional_predio_ids"]),
        surface_total=float(mapping["surface_total"]),
        created_at=mapping["created_at"],
        active=bool(mapping["active"]),
    )


def _snapshot_select_sql(*, include_storage_key: bool = False) -> str:
    storage_key_column = ", tws.object_storage_key" if include_storage_key else ""

    return f"""
        SELECT
            tws.source_snapshot_id,
            tws.filename,
            tws.media_type,
            ss.content_sha256,
            ss.byte_size,
            tws.business_rows,
            tws.distinct_pmf,
            tws.distinct_provisional_predio_ids,
            tws.surface_total,
            tws.created_at,
            (
                state.active_source_snapshot_id = tws.source_snapshot_id
            ) AS active
            {storage_key_column}
        FROM platform.transelec_workbook_snapshot AS tws
        JOIN platform.source_snapshot AS ss
          ON ss.id = tws.source_snapshot_id
        CROSS JOIN platform.transelec_dashboard_state AS state
        WHERE state.id = 1
    """


def _find_snapshot_by_hash(
    connection: Any,
    content_sha256: str,
) -> TranselecSnapshotRecord | None:
    row = connection.execute(
        text(
            _snapshot_select_sql()
            + """
              AND ss.content_sha256 = :content_sha256
              LIMIT 1
            """
        ),
        {"content_sha256": content_sha256},
    ).first()

    return None if row is None else _snapshot_from_row(row)


def _activate_snapshot(connection: Any, source_snapshot_id: int) -> None:
    connection.execute(
        text(
            """
            UPDATE platform.transelec_dashboard_state
            SET
                active_source_snapshot_id = :source_snapshot_id,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
            """
        ),
        {"source_snapshot_id": source_snapshot_id},
    )


def persist_validated_workbook(
    engine: Engine,
    upload: ValidatedWorkbookUpload,
    *,
    object_store: ObjectStore | None = None,
) -> PersistedWorkbookSnapshot:
    """Persist and atomically activate a new validated workbook snapshot.

    Identical content is a no-op: the existing snapshot is returned and the
    active pointer is left unchanged. Bytes are written to the private object
    store (content-addressed) before any database row references them, so a
    database row never points at a missing object.
    """

    observed_at = datetime.now(UTC)
    resolved_object_store = object_store if object_store is not None else get_object_store()

    storage_key = content_addressed_key(
        namespace=OBJECT_STORE_NAMESPACE,
        content_sha256=upload.content_sha256,
        suffix=Path(upload.filename).suffix.lower(),
    )

    try:
        resolved_object_store.put(storage_key, upload.content)
    except ObjectStorageError as exc:
        raise TranselecSnapshotStoreError("Unable to store Transelec workbook bytes") from exc

    try:
        with engine.begin() as connection:
            existing = _find_snapshot_by_hash(
                connection,
                upload.content_sha256,
            )

            if existing is not None:
                return PersistedWorkbookSnapshot(
                    snapshot=existing,
                    duplicate=True,
                )

            observation = SourceFileObservation(
                relative_path=LOGICAL_SOURCE_PATH,
                filename=upload.filename,
                byte_size=len(upload.content),
                observed_at=observed_at,
                source_modified_at=observed_at,
                media_type=upload.media_type,
            )
            fingerprint = SourceFileFingerprint(
                relative_path=LOGICAL_SOURCE_PATH,
                content_sha256=upload.content_sha256,
                byte_size=len(upload.content),
            )
            provenance = persist_filesystem_source_provenance(
                connection,
                system_key=SYSTEM_KEY,
                observation=observation,
                fingerprint=fingerprint,
            )

            connection.execute(
                text(
                    """
                    INSERT INTO platform.transelec_workbook_snapshot (
                        source_snapshot_id,
                        filename,
                        media_type,
                        object_storage_key,
                        business_rows,
                        distinct_pmf,
                        distinct_provisional_predio_ids,
                        surface_total
                    )
                    VALUES (
                        :source_snapshot_id,
                        :filename,
                        :media_type,
                        :object_storage_key,
                        :business_rows,
                        :distinct_pmf,
                        :distinct_provisional_predio_ids,
                        :surface_total
                    )
                    """
                ),
                {
                    "source_snapshot_id": provenance.source_snapshot_id,
                    "filename": upload.filename,
                    "media_type": upload.media_type,
                    "object_storage_key": storage_key,
                    "business_rows": upload.summary.business_rows,
                    "distinct_pmf": upload.summary.distinct_pmf,
                    "distinct_provisional_predio_ids": (
                        upload.summary.distinct_provisional_predio_ids
                    ),
                    "surface_total": upload.summary.surface_total,
                },
            )
            _activate_snapshot(
                connection,
                provenance.source_snapshot_id,
            )

            persisted = _find_snapshot_by_hash(
                connection,
                upload.content_sha256,
            )

            if persisted is None:
                raise TranselecSnapshotStoreError(
                    "Persisted Transelec snapshot could not be reloaded"
                )

            return PersistedWorkbookSnapshot(
                snapshot=persisted,
                duplicate=False,
            )
    except (SQLAlchemyError, SourceProvenanceError) as exc:
        raise TranselecSnapshotStoreError("Unable to persist Transelec workbook snapshot") from exc


def list_workbook_snapshots(
    engine: Engine,
) -> tuple[TranselecSnapshotRecord, ...]:
    """Return immutable Transelec workbook snapshots, newest first."""

    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    _snapshot_select_sql()
                    + """
                    ORDER BY tws.created_at DESC, tws.source_snapshot_id DESC
                    """
                )
            ).all()
    except SQLAlchemyError as exc:
        raise TranselecSnapshotStoreError("Unable to list Transelec workbook snapshots") from exc

    return tuple(_snapshot_from_row(row) for row in rows)


def get_active_workbook_snapshot(
    engine: Engine,
    *,
    object_store: ObjectStore | None = None,
) -> ActiveWorkbookSnapshot | None:
    """Return the currently published workbook bytes, if one exists."""

    try:
        with engine.connect() as connection:
            row = connection.execute(
                text(
                    _snapshot_select_sql(include_storage_key=True)
                    + """
                      AND state.active_source_snapshot_id = tws.source_snapshot_id
                      LIMIT 1
                    """
                )
            ).first()
    except SQLAlchemyError as exc:
        raise TranselecSnapshotStoreError(
            "Unable to load the active Transelec workbook snapshot"
        ) from exc

    if row is None:
        return None

    resolved_object_store = object_store if object_store is not None else get_object_store()
    storage_key = str(row._mapping["object_storage_key"])

    try:
        content = resolved_object_store.get(storage_key)
    except ObjectStorageError as exc:
        raise TranselecSnapshotStoreError(
            "Unable to load Transelec workbook bytes from object storage"
        ) from exc

    return ActiveWorkbookSnapshot(
        snapshot=_snapshot_from_row(row),
        content=content,
    )


def activate_workbook_snapshot(
    engine: Engine,
    source_snapshot_id: int,
) -> TranselecSnapshotRecord | None:
    """Activate a previously validated workbook snapshot."""

    try:
        with engine.begin() as connection:
            row = connection.execute(
                text(
                    _snapshot_select_sql()
                    + """
                      AND tws.source_snapshot_id = :source_snapshot_id
                      LIMIT 1
                    """
                ),
                {"source_snapshot_id": source_snapshot_id},
            ).first()

            if row is None:
                return None

            _activate_snapshot(connection, source_snapshot_id)

            refreshed = connection.execute(
                text(
                    _snapshot_select_sql()
                    + """
                      AND tws.source_snapshot_id = :source_snapshot_id
                      LIMIT 1
                    """
                ),
                {"source_snapshot_id": source_snapshot_id},
            ).one()

            return _snapshot_from_row(refreshed)
    except SQLAlchemyError as exc:
        raise TranselecSnapshotStoreError("Unable to activate Transelec workbook snapshot") from exc
