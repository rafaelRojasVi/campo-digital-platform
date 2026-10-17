"""Rodales management reports (informes de manejo): storage and lifecycle.

A report is a named, reviewable set of polygon copies taken from one
published base snapshot; it never changes what the dashboard serves. The
geometry rules are ``app.forestry_report_geometry``; this module loads a
report's source polygons, applies those rules, and keeps status, revision
and review notes consistent. Every change bumps ``revision`` and every
change states the revision it expects, so nobody overwrites or approves a
version they did not see.

Authorization is the router's job (``Action.EDIT`` / ``Action.APPROVE``).
"""

from __future__ import annotations

import datetime as dt
import json
import re
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import shapely
from shapely.geometry import MultiPolygon
from sqlalchemy import Connection, text

from app.conaf import normalize_solicitud
from app.forestry_publication import read_published_snapshot_id
from app.forestry_report_geometry import (
    FeatureInput,
    ReportWarning,
    SourcePolygon,
    resolve_features,
)

ReportType = Literal["cosecha", "manejo", "reforestacion", "plantacion", "otro"]
ReportStatus = Literal["borrador", "enviado", "aprobado", "cambios_solicitados", "archivado"]
TransitionAction = Literal["submit", "approve", "request_changes", "archive"]

EDITABLE_STATUSES: frozenset[str] = frozenset({"borrador", "cambios_solicitados"})
MAX_NAME_LENGTH = 120
MAX_NOTE_LENGTH = 2000
MONTH_PATTERN = r"^[0-9]{4}-(0[1-9]|1[0-2])$"
_STORAGE_SRID = 32718
_MAX_COPY_SUFFIX = 50
# update_report_header: «not given» differs from «clear» (None).
_UNSET = object()

_TRANSITIONS: dict[str, tuple[frozenset[str], ReportStatus]] = {
    "submit": (frozenset({"borrador", "cambios_solicitados"}), "enviado"),
    "approve": (frozenset({"enviado"}), "aprobado"),
    "request_changes": (frozenset({"enviado"}), "cambios_solicitados"),
    "archive": (
        frozenset({"borrador", "enviado", "aprobado", "cambios_solicitados"}),
        "archivado",
    ),
}

REPORT_ERROR_MESSAGES: dict[str, str] = {
    "not_found": "No se encontró el informe.",
    "no_published_base": (
        "Aún no hay una versión publicada de Rodales; publíquela antes de crear informes."
    ),
    "name_taken": "Ya existe un informe con ese nombre.",
    "invalid_name": f"El nombre debe tener entre 1 y {MAX_NAME_LENGTH} caracteres.",
    "invalid_month": "El mes debe tener la forma AAAA-MM, por ejemplo 2027-01.",
    "not_editable": "Este informe ya no se puede editar. Duplíquelo para hacer cambios.",
    "stale_revision": "Otra persona guardó cambios en este informe; recárguelo.",
    "invalid_transition": "Esta acción no aplica al estado actual del informe.",
    "nothing_marked": "Marque al menos un polígono como área de manejo antes de enviar.",
    "note_required": "Escriba qué hay que cambiar.",
    "note_too_long": "La nota no puede superar 2.000 caracteres.",
    "cannot_delete": "Sólo se puede borrar un borrador que nunca se envió; archívelo.",
    "invalid_conaf": "El N.º de solicitud CONAF debe tener solo dígitos (hasta 9).",
}
WARNING_MESSAGES: dict[str, str] = {
    "base_outdated": (
        "Este informe se hizo sobre una versión anterior de la base; hay una versión más nueva."
    ),
}


class ReportError(RuntimeError):
    """A report operation that does not apply; ``code`` is stable, ``message`` Spanish."""

    def __init__(self, code: str) -> None:
        super().__init__(REPORT_ERROR_MESSAGES[code])
        self.code = code
        self.message = REPORT_ERROR_MESSAGES[code]


@dataclass(frozen=True, slots=True)
class Report:
    id: int
    name: str
    report_type: str
    report_month: str
    status: str
    base_snapshot_id: int
    revision: int
    created_by_app_user_id: int
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


@dataclass(frozen=True, slots=True)
class StoredFeature:
    position: int
    source_feature_ordinal: int
    in_report: bool
    geometry_changed: bool
    attributes: dict[str, Any]
    geometry: MultiPolygon


@dataclass(frozen=True, slots=True)
class ReportNote:
    kind: str
    body: str
    author_display_name: str
    created_at: dt.datetime


@dataclass(frozen=True, slots=True)
class SaveOutcome:
    revision: int
    feature_count: int
    warnings: list[ReportWarning]


@dataclass(frozen=True, slots=True)
class _Locked:
    status: str
    revision: int
    base_snapshot_id: int
    submitted_at: dt.datetime | None


_REPORT_SELECT = """
SELECT
    r.id, r.name, r.report_type, r.report_month, r.status, r.base_snapshot_id, r.revision,
    r.created_by_app_user_id, creator.display_name AS created_by_display_name,
    r.created_at, r.updated_at, r.submitted_at, r.decided_at,
    decider.display_name AS decided_by_display_name,
    count(f.id) AS feature_count,
    count(f.id) FILTER (WHERE f.in_report) AS managed_feature_count,
    COALESCE(sum((f.attributes ->> 'sup_ha')::float8) FILTER (WHERE f.in_report), 0)
        AS managed_area_ha,
    r.conaf_solicitud
FROM forestry.report r
JOIN platform.app_user creator ON creator.id = r.created_by_app_user_id
LEFT JOIN platform.app_user decider ON decider.id = r.decided_by_app_user_id
LEFT JOIN forestry.report_feature f ON f.report_id = r.id
"""
_REPORT_GROUP = " GROUP BY r.id, creator.display_name, decider.display_name"


def _report(row: Any) -> Report:
    return Report(
        id=row.id,
        name=row.name,
        report_type=row.report_type,
        report_month=row.report_month,
        status=row.status,
        base_snapshot_id=row.base_snapshot_id,
        revision=row.revision,
        created_by_app_user_id=row.created_by_app_user_id,
        created_by_display_name=row.created_by_display_name,
        created_at=row.created_at,
        updated_at=row.updated_at,
        submitted_at=row.submitted_at,
        decided_at=row.decided_at,
        decided_by_display_name=row.decided_by_display_name,
        feature_count=int(row.feature_count),
        managed_feature_count=int(row.managed_feature_count),
        managed_area_ha=float(row.managed_area_ha),
        conaf_solicitud=row.conaf_solicitud,
    )


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def list_reports(
    connection: Connection, *, statuses: Collection[str] | None = None
) -> list[Report]:
    """Reports, submitted ones first, then most recently changed."""

    where = " WHERE r.status = ANY(:statuses)" if statuses is not None else ""
    rows = connection.execute(
        text(
            _REPORT_SELECT
            + where
            + _REPORT_GROUP
            + " ORDER BY (r.status = 'enviado') DESC, r.updated_at DESC, r.id DESC"
        ),
        {"statuses": list(statuses)} if statuses is not None else {},
    )
    return [_report(row) for row in rows]


def get_report(connection: Connection, report_id: int) -> Report | None:
    row = connection.execute(
        text(_REPORT_SELECT + " WHERE r.id = :id" + _REPORT_GROUP), {"id": report_id}
    ).one_or_none()
    return None if row is None else _report(row)


def list_report_features(connection: Connection, report_id: int) -> list[StoredFeature]:
    rows = connection.execute(
        text(
            """
            SELECT position, source_feature_ordinal, in_report, geometry_changed, attributes,
                   ST_AsBinary(geometry) AS wkb
            FROM forestry.report_feature
            WHERE report_id = :id
            ORDER BY position
            """
        ),
        {"id": report_id},
    )
    return [
        StoredFeature(
            position=row.position,
            source_feature_ordinal=row.source_feature_ordinal,
            in_report=row.in_report,
            geometry_changed=row.geometry_changed,
            attributes=dict(row.attributes),
            geometry=shapely.from_wkb(bytes(row.wkb)),
        )
        for row in rows
    ]


def load_source_polygons(
    connection: Connection, *, snapshot_id: int, ordinals: Collection[int]
) -> dict[int, SourcePolygon]:
    """Polygons of ``snapshot_id`` by feature ordinal (missing ordinals are absent)."""

    if not ordinals:
        return {}
    rows = connection.execute(
        text(
            """
            SELECT feature_ordinal, source_attributes, geometry_is_valid,
                   ST_AsBinary(geometry) AS wkb
            FROM forestry.source_feature
            WHERE shapefile_snapshot_id = :snapshot_id AND feature_ordinal = ANY(:ordinals)
            """
        ),
        {"snapshot_id": snapshot_id, "ordinals": sorted(set(ordinals))},
    )
    return {
        row.feature_ordinal: SourcePolygon(
            feature_ordinal=row.feature_ordinal,
            attributes=dict(row.source_attributes),
            geometry=shapely.from_wkb(bytes(row.wkb)),
            is_valid=row.geometry_is_valid,
        )
        for row in rows
    }


def list_report_sources(connection: Connection, report_id: int) -> list[SourcePolygon]:
    """The base polygons a report refers to (for the review overlay)."""

    report = get_report(connection, report_id)
    if report is None:
        return []
    ordinals = connection.execute(
        text(
            "SELECT DISTINCT source_feature_ordinal FROM forestry.report_feature "
            "WHERE report_id = :id"
        ),
        {"id": report_id},
    ).scalars()
    sources = load_source_polygons(
        connection, snapshot_id=report.base_snapshot_id, ordinals=list(ordinals)
    )
    return [sources[ordinal] for ordinal in sorted(sources)]


def list_report_notes(connection: Connection, report_id: int) -> list[ReportNote]:
    rows = connection.execute(
        text(
            """
            SELECT n.kind, n.body, u.display_name AS author_display_name, n.created_at
            FROM forestry.report_note n
            JOIN platform.app_user u ON u.id = n.author_app_user_id
            WHERE n.report_id = :id
            ORDER BY n.created_at, n.id
            """
        ),
        {"id": report_id},
    )
    return [ReportNote(row.kind, row.body, row.author_display_name, row.created_at) for row in rows]


# ---------------------------------------------------------------------------
# Writes (inside the caller's transaction)
# ---------------------------------------------------------------------------


def create_report(
    connection: Connection,
    *,
    name: str,
    report_type: str,
    report_month: str,
    actor_app_user_id: int,
) -> int:
    clean = _clean_name(name)
    _check_month(report_month)
    base = read_published_snapshot_id(connection)
    if base is None:
        raise ReportError("no_published_base")
    _ensure_name_free(connection, clean)
    return int(
        connection.execute(
            text(
                """
                INSERT INTO forestry.report
                    (name, report_type, report_month, base_snapshot_id, created_by_app_user_id)
                VALUES (:name, :report_type, :report_month, :base, :actor)
                RETURNING id
                """
            ),
            {
                "name": clean,
                "report_type": report_type,
                "report_month": report_month,
                "base": base,
                "actor": actor_app_user_id,
            },
        ).scalar_one()
    )


def save_report_features(
    connection: Connection,
    *,
    report_id: int,
    expected_revision: int,
    inputs: Sequence[FeatureInput],
) -> SaveOutcome:
    """Replace the report's features; raise ``ReportError`` / ``ReportValidationError``."""

    locked = _lock(connection, report_id)
    if locked.status not in EDITABLE_STATUSES:
        raise ReportError("not_editable")
    if locked.revision != expected_revision:
        raise ReportError("stale_revision")

    sources = load_source_polygons(
        connection,
        snapshot_id=locked.base_snapshot_id,
        ordinals={item.source_feature_ordinal for item in inputs},
    )
    resolution = resolve_features(inputs, sources)

    connection.execute(
        text("DELETE FROM forestry.report_feature WHERE report_id = :id"), {"id": report_id}
    )
    if resolution.features:
        connection.execute(
            text(
                """
                INSERT INTO forestry.report_feature (
                    report_id, position, source_feature_ordinal, in_report, geometry_changed,
                    attributes, geometry
                )
                VALUES (
                    :report_id, :position, :ordinal, :in_report, :changed,
                    CAST(:attributes AS jsonb), ST_GeomFromWKB(:wkb, :srid)
                )
                """
            ),
            [
                {
                    "report_id": report_id,
                    "position": feature.position,
                    "ordinal": feature.source_feature_ordinal,
                    "in_report": feature.in_report,
                    "changed": feature.geometry_changed,
                    "attributes": json.dumps(feature.attributes, ensure_ascii=False),
                    "wkb": shapely.to_wkb(feature.geometry),
                    "srid": _STORAGE_SRID,
                }
                for feature in resolution.features
            ],
        )
    revision = _bump(connection, report_id)

    warnings = list(resolution.warnings)
    if read_published_snapshot_id(connection) != locked.base_snapshot_id:
        warnings.append(ReportWarning("base_outdated", WARNING_MESSAGES["base_outdated"]))
    warnings.extend(_shared_source_warnings(connection, report_id, locked.base_snapshot_id))
    return SaveOutcome(revision, len(resolution.features), warnings)


def update_report_header(
    connection: Connection,
    *,
    report_id: int,
    expected_revision: int,
    name: str | None = None,
    report_type: str | None = None,
    report_month: str | None = None,
    conaf_solicitud: object = _UNSET,
) -> int:
    locked = _lock(connection, report_id)
    # The CONAF number exists only once the plan is filed, after approval, and
    # it never changes the polygons: alone, it is editable until archived.
    only_conaf = name is None and report_type is None and report_month is None
    if only_conaf and conaf_solicitud is not _UNSET:
        if locked.status == "archivado":
            raise ReportError("not_editable")
    elif locked.status not in EDITABLE_STATUSES:
        raise ReportError("not_editable")
    if locked.revision != expected_revision:
        raise ReportError("stale_revision")
    clean = None if name is None else _clean_name(name)
    if clean is not None:
        _ensure_name_free(connection, clean, except_id=report_id)
    if report_month is not None:
        _check_month(report_month)
    set_conaf = conaf_solicitud is not _UNSET
    conaf: str | None = None
    if set_conaf and conaf_solicitud is not None and str(conaf_solicitud).strip():
        conaf = normalize_solicitud(str(conaf_solicitud))
        if conaf is None:
            raise ReportError("invalid_conaf")
    connection.execute(
        text(
            """
            UPDATE forestry.report
            SET name = COALESCE(:name, name),
                report_type = COALESCE(:report_type, report_type),
                report_month = COALESCE(:report_month, report_month),
                conaf_solicitud = CASE WHEN :set_conaf THEN :conaf ELSE conaf_solicitud END
            WHERE id = :id
            """
        ),
        {
            "name": clean,
            "report_type": report_type,
            "report_month": report_month,
            "set_conaf": set_conaf,
            "conaf": conaf,
            "id": report_id,
        },
    )
    return _bump(connection, report_id)


def transition_report(
    connection: Connection,
    *,
    report_id: int,
    action: TransitionAction,
    expected_revision: int,
    actor_app_user_id: int,
    note: str | None = None,
) -> ReportStatus:
    locked = _lock(connection, report_id)
    allowed_from, target = _TRANSITIONS[action]
    if locked.status not in allowed_from:
        raise ReportError("invalid_transition")
    if locked.revision != expected_revision:
        raise ReportError("stale_revision")
    body = (note or "").strip()
    if len(body) > MAX_NOTE_LENGTH:
        raise ReportError("note_too_long")
    if action == "request_changes" and not body:
        raise ReportError("note_required")
    if action == "submit":
        marked = connection.execute(
            text(
                "SELECT count(*) FROM forestry.report_feature WHERE report_id = :id AND in_report"
            ),
            {"id": report_id},
        ).scalar_one()
        if marked == 0:
            raise ReportError("nothing_marked")

    decides = action in ("approve", "request_changes")
    connection.execute(
        text(
            """
            UPDATE forestry.report
            SET status = :target,
                submitted_at = CASE WHEN :submits THEN now() ELSE submitted_at END,
                decided_at = CASE WHEN :decides THEN now() ELSE decided_at END,
                decided_by_app_user_id = CASE
                    WHEN :decides THEN CAST(:actor AS bigint) ELSE decided_by_app_user_id
                END
            WHERE id = :id
            """
        ),
        {
            "target": target,
            "submits": action == "submit",
            "decides": decides,
            "actor": actor_app_user_id,
            "id": report_id,
        },
    )
    if action == "request_changes" or (action == "approve" and body):
        connection.execute(
            text(
                "INSERT INTO forestry.report_note (report_id, kind, body, author_app_user_id) "
                "VALUES (:id, :kind, :body, :actor)"
            ),
            {
                "id": report_id,
                "kind": "cambios_solicitados" if action == "request_changes" else "aprobado",
                "body": body,
                "actor": actor_app_user_id,
            },
        )
    _bump(connection, report_id)
    return target


def duplicate_report(connection: Connection, *, report_id: int, actor_app_user_id: int) -> int:
    source = get_report(connection, report_id)
    if source is None:
        raise ReportError("not_found")
    name = _free_copy_name(connection, source.name)
    new_id = int(
        connection.execute(
            text(
                """
                INSERT INTO forestry.report
                    (name, report_type, report_month, base_snapshot_id, created_by_app_user_id,
                     conaf_solicitud)
                SELECT :name, report_type, report_month, base_snapshot_id, :actor, conaf_solicitud
                FROM forestry.report WHERE id = :id
                RETURNING id
                """
            ),
            {"name": name, "actor": actor_app_user_id, "id": report_id},
        ).scalar_one()
    )
    connection.execute(
        text(
            """
            INSERT INTO forestry.report_feature (
                report_id, position, source_feature_ordinal, in_report, geometry_changed,
                attributes, geometry
            )
            SELECT :new_id, position, source_feature_ordinal, in_report, geometry_changed,
                   attributes, geometry
            FROM forestry.report_feature WHERE report_id = :id
            """
        ),
        {"new_id": new_id, "id": report_id},
    )
    return new_id


def delete_report(connection: Connection, *, report_id: int) -> None:
    locked = _lock(connection, report_id)
    if locked.status != "borrador" or locked.submitted_at is not None:
        raise ReportError("cannot_delete")
    connection.execute(text("DELETE FROM forestry.report WHERE id = :id"), {"id": report_id})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _lock(connection: Connection, report_id: int) -> _Locked:
    row = connection.execute(
        text(
            "SELECT status, revision, base_snapshot_id, submitted_at "
            "FROM forestry.report WHERE id = :id FOR UPDATE"
        ),
        {"id": report_id},
    ).one_or_none()
    if row is None:
        raise ReportError("not_found")
    return _Locked(row.status, row.revision, row.base_snapshot_id, row.submitted_at)


def _bump(connection: Connection, report_id: int) -> int:
    return int(
        connection.execute(
            text(
                "UPDATE forestry.report SET revision = revision + 1, updated_at = now() "
                "WHERE id = :id RETURNING revision"
            ),
            {"id": report_id},
        ).scalar_one()
    )


def _clean_name(name: str) -> str:
    clean = name.strip()
    if not clean or len(clean) > MAX_NAME_LENGTH:
        raise ReportError("invalid_name")
    return clean


def _check_month(report_month: str) -> None:
    if not re.fullmatch(MONTH_PATTERN, report_month):
        raise ReportError("invalid_month")


def _name_in_use(connection: Connection, name: str, *, except_id: int | None = None) -> bool:
    return (
        connection.execute(
            text(
                """
                SELECT 1 FROM forestry.report
                WHERE lower(name) = lower(:name) AND status <> 'archivado'
                  AND (CAST(:except_id AS bigint) IS NULL OR id <> CAST(:except_id AS bigint))
                LIMIT 1
                """
            ),
            {"name": name, "except_id": except_id},
        ).scalar_one_or_none()
        is not None
    )


def _ensure_name_free(connection: Connection, name: str, *, except_id: int | None = None) -> None:
    if _name_in_use(connection, name, except_id=except_id):
        raise ReportError("name_taken")


def _free_copy_name(connection: Connection, name: str) -> str:
    for number in range(1, _MAX_COPY_SUFFIX + 1):
        suffix = " (copia)" if number == 1 else f" (copia {number})"
        candidate = name[: MAX_NAME_LENGTH - len(suffix)] + suffix
        if not _name_in_use(connection, candidate):
            return candidate
    raise ReportError("name_taken")


def _shared_source_warnings(
    connection: Connection, report_id: int, base_snapshot_id: int
) -> list[ReportWarning]:
    rows = connection.execute(
        text(
            """
            SELECT DISTINCT f.source_feature_ordinal, r.name
            FROM forestry.report_feature f
            JOIN forestry.report r ON r.id = f.report_id
            WHERE r.id <> :id
              AND r.status <> 'archivado'
              AND r.base_snapshot_id = :base
              AND f.source_feature_ordinal IN (
                  SELECT source_feature_ordinal FROM forestry.report_feature WHERE report_id = :id
              )
            ORDER BY f.source_feature_ordinal, r.name
            """
        ),
        {"id": report_id, "base": base_snapshot_id},
    )
    return [
        ReportWarning(
            "also_in_other_report",
            f"Este polígono también está en «{row.name}».",
            row.source_feature_ordinal,
        )
        for row in rows
    ]
