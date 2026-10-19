"""Stored CONAF results (Estado CONAF): rules, known numbers, nightly runs.

``found`` replaces the stored fields and records a change when ``estado``
differs; ``unavailable``, ``not_found`` and ``mismatch`` keep the last found
data, so a CONAF hiccup or a mistyped number never erases a good read.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import Connection, Row, text

from app.conaf import ConafLookup, normalize_solicitud, solicitudes_in_cell
from app.transelec_publication import read_active_import_id

REFRESH_AFTER = timedelta(hours=12)
RETRY_UNAVAILABLE_AFTER = timedelta(minutes=15)
STALE_AFTER = timedelta(hours=36)
CHANGED_BADGE_FOR = timedelta(days=7)
NIGHTLY_SKIP_IF_CHECKED_WITHIN = timedelta(hours=20)


@dataclass(frozen=True, slots=True)
class ConafRecord:
    numero: str
    lookup_status: str
    tipo: str | None
    estado: str | None
    superficie_ha: float | None
    fecha_ingreso: date | None
    fecha_resolucion: date | None
    returned_solicitud: str | None
    checked_at: datetime
    found_at: datetime | None
    estado_changed_at: datetime | None


_SELECT = """
SELECT numero, lookup_status, tipo, estado, superficie_ha, fecha_ingreso, fecha_resolucion,
       returned_solicitud, checked_at, found_at, estado_changed_at
FROM platform.conaf_solicitud
"""


def _record(row: Any) -> ConafRecord:
    return ConafRecord(
        numero=row.numero,
        lookup_status=row.lookup_status,
        tipo=row.tipo,
        estado=row.estado,
        superficie_ha=None if row.superficie_ha is None else float(row.superficie_ha),
        fecha_ingreso=row.fecha_ingreso,
        fecha_resolucion=row.fecha_resolucion,
        returned_solicitud=row.returned_solicitud,
        checked_at=row.checked_at,
        found_at=row.found_at,
        estado_changed_at=row.estado_changed_at,
    )


def read_record(connection: Connection, numero: str) -> ConafRecord | None:
    row = connection.execute(text(_SELECT + " WHERE numero = :numero"), {"numero": numero})
    found = row.one_or_none()
    return None if found is None else _record(found)


def read_records(connection: Connection, numeros: Collection[str]) -> dict[str, ConafRecord]:
    if not numeros:
        return {}
    rows = connection.execute(
        text(_SELECT + " WHERE numero = ANY(:numeros)"), {"numeros": sorted(set(numeros))}
    )
    return {row.numero: _record(row) for row in rows}


def save_lookup(
    connection: Connection, lookup: ConafLookup, *, now: datetime
) -> tuple[ConafRecord, bool]:
    """Apply one lookup; return the stored record and whether ``estado`` changed."""

    existing = connection.execute(
        text(_SELECT + " WHERE numero = :numero FOR UPDATE"), {"numero": lookup.numero}
    ).one_or_none()
    returned = lookup.returned_solicitud if lookup.status == "mismatch" else None

    if lookup.status != "found":
        connection.execute(
            text(
                """
                INSERT INTO platform.conaf_solicitud
                    (numero, lookup_status, returned_solicitud, checked_at)
                VALUES (:numero, :status, :returned, :now)
                ON CONFLICT (numero) DO UPDATE
                SET lookup_status = EXCLUDED.lookup_status,
                    returned_solicitud = EXCLUDED.returned_solicitud,
                    checked_at = EXCLUDED.checked_at
                """
            ),
            {"numero": lookup.numero, "status": lookup.status, "returned": returned, "now": now},
        )
        record = read_record(connection, lookup.numero)
        assert record is not None
        return record, False

    changed = (
        existing is not None
        and existing.found_at is not None
        and existing.estado != lookup.estado
        and lookup.estado is not None
    )
    changed_at = now if changed else (existing.estado_changed_at if existing is not None else None)
    connection.execute(
        text(
            """
            INSERT INTO platform.conaf_solicitud (
                numero, lookup_status, tipo, estado, superficie_ha, fecha_ingreso,
                fecha_resolucion, returned_solicitud, checked_at, found_at, estado_changed_at
            )
            VALUES (
                :numero, 'found', :tipo, :estado, :superficie, :ingreso,
                :resolucion, NULL, :now, :now, :changed_at
            )
            ON CONFLICT (numero) DO UPDATE
            SET lookup_status = 'found',
                tipo = EXCLUDED.tipo,
                estado = EXCLUDED.estado,
                superficie_ha = EXCLUDED.superficie_ha,
                fecha_ingreso = EXCLUDED.fecha_ingreso,
                fecha_resolucion = EXCLUDED.fecha_resolucion,
                returned_solicitud = NULL,
                checked_at = EXCLUDED.checked_at,
                found_at = EXCLUDED.found_at,
                estado_changed_at = EXCLUDED.estado_changed_at
            """
        ),
        {
            "numero": lookup.numero,
            "tipo": lookup.tipo,
            "estado": lookup.estado,
            "superficie": lookup.superficie_ha,
            "ingreso": lookup.fecha_ingreso,
            "resolucion": lookup.fecha_resolucion,
            "now": now,
            "changed_at": changed_at,
        },
    )
    if changed:
        connection.execute(
            text(
                "INSERT INTO platform.conaf_cambio "
                "(numero, estado_anterior, estado_nuevo, observed_at) "
                "VALUES (:numero, :before, :after, :now)"
            ),
            {
                "numero": lookup.numero,
                "before": existing.estado if existing is not None else None,
                "after": lookup.estado,
                "now": now,
            },
        )
    record = read_record(connection, lookup.numero)
    assert record is not None
    return record, changed


def needs_refresh(record: ConafRecord | None, now: datetime) -> bool:
    if record is None:
        return True
    age = now - record.checked_at
    if record.lookup_status == "unavailable":
        return age > RETRY_UNAVAILABLE_AFTER
    return age > REFRESH_AFTER


def is_stale(record: ConafRecord, now: datetime) -> bool:
    return record.lookup_status == "unavailable" or now - record.checked_at > STALE_AFTER


def recently_changed(record: ConafRecord, now: datetime) -> bool:
    return (
        record.estado_changed_at is not None and now - record.estado_changed_at <= CHANGED_BADGE_FOR
    )


def collect_known_numbers(connection: Connection) -> list[str]:
    """Normalized numbers from the active Transelec import and active Rodales reports."""

    numeros: set[str] = set()
    import_id = read_active_import_id(connection)
    if import_id is not None:
        for row in connection.execute(
            text(
                "SELECT numero_ingreso, numero_ingreso_2 FROM platform.transelec_effective_row "
                "WHERE import_id = :import_id"
            ),
            {"import_id": import_id},
        ):
            # A cell may hold the ingreso and the reingreso: both are queried.
            for cell in (row.numero_ingreso, row.numero_ingreso_2):
                numeros.update(solicitudes_in_cell(cell))
    for value in connection.execute(
        text(
            "SELECT conaf_solicitud FROM forestry.report "
            "WHERE status <> 'archivado' AND conaf_solicitud IS NOT NULL"
        )
    ).scalars():
        if (numero := normalize_solicitud(value)) is not None:
            numeros.add(numero)
    return sorted(numeros)


def due_numbers(connection: Connection, numeros: Collection[str], *, now: datetime) -> list[str]:
    records = read_records(connection, numeros)
    cutoff = now - NIGHTLY_SKIP_IF_CHECKED_WITHIN
    return [
        numero
        for numero in sorted(set(numeros))
        if (record := records.get(numero)) is None or record.checked_at < cutoff
    ]


def start_run(connection: Connection, *, now: datetime, due: int) -> int:
    return int(
        connection.execute(
            text(
                "INSERT INTO platform.conaf_run (started_at, due) VALUES (:now, :due) RETURNING id"
            ),
            {"now": now, "due": due},
        ).scalar_one()
    )


def finish_run(
    connection: Connection,
    run_id: int,
    *,
    now: datetime,
    counts: Mapping[str, int],
    stopped_reason: str | None,
) -> None:
    connection.execute(
        text(
            """
            UPDATE platform.conaf_run
            SET finished_at = :now, checked = :checked, found = :found, not_found = :not_found,
                mismatch = :mismatch, unavailable = :unavailable, changed = :changed,
                stopped_reason = :stopped
            WHERE id = :id
            """
        ),
        {
            "now": now,
            "id": run_id,
            "stopped": stopped_reason,
            **{k: int(v) for k, v in counts.items()},
        },
    )


def read_last_run(connection: Connection) -> Row[Any] | None:
    return connection.execute(
        text("SELECT * FROM platform.conaf_run ORDER BY started_at DESC, id DESC LIMIT 1")
    ).one_or_none()
