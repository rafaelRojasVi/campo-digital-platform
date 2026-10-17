"""Estado CONAF over HTTP, for Transelec and Rodales.

Every route needs a session and VIEW on ``transelect`` or ``forestry``.
``GET /solicitudes/{numero}`` refreshes from CONAF when the stored result is
old; the bulk route never calls CONAF; ``POST …/refresh`` asks CONAF again
unless it was asked within the last minute.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Engine

from app.access import Action, can
from app.access_repository import AppUser, get_product_role
from app.conaf import ConafBusyError, ConafClient, normalize_solicitud, public_url
from app.conaf_refresh import Lookup
from app.conaf_store import (
    ConafRecord,
    is_stale,
    needs_refresh,
    read_record,
    read_records,
    recently_changed,
    save_lookup,
)
from app.csrf import require_csrf
from app.database import get_database_engine
from app.deps import get_current_app_user
from app.security_events import SecurityEventNote, SecurityHTTPException

MAX_BULK = 500
MANUAL_REFRESH_EVERY = timedelta(seconds=60)
_BAD_NUMBER = "Ese número no se puede consultar en CONAF (solo dígitos)."
_TOO_MANY = f"Se pueden consultar hasta {MAX_BULK} números a la vez."
_BUSY = "CONAF está ocupado; intente de nuevo en un momento."

_client = ConafClient()


def get_conaf_client() -> Lookup:
    return _client


def require_conaf_viewer(
    user: Annotated[AppUser, Depends(get_current_app_user)],
    engine: Annotated[Engine, Depends(get_database_engine)],
) -> AppUser:
    with engine.connect() as connection:
        roles = [
            get_product_role(connection, app_user_id=user.id, product_key=product)
            for product in ("transelect", "forestry")
        ]
    if not any(can(role, Action.VIEW) for role in roles):
        raise SecurityHTTPException(
            403,
            "Not permitted for this product.",
            SecurityEventNote("access.denied", reason="no_grant", actor_app_user_id=user.id),
        )
    return user


router = APIRouter(
    prefix="/api/conaf", tags=["conaf"], dependencies=[Depends(require_conaf_viewer)]
)

DatabaseEngine = Annotated[Engine, Depends(get_database_engine)]
Client = Annotated[Lookup, Depends(get_conaf_client)]


class ConafSolicitudModel(BaseModel):
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
    stale: bool
    recently_changed: bool
    conaf_url: str


class ConafBulkResponse(BaseModel):
    solicitudes: list[ConafSolicitudModel]


def _model(record: ConafRecord, now: datetime) -> ConafSolicitudModel:
    return ConafSolicitudModel(
        numero=record.numero,
        lookup_status=record.lookup_status,
        tipo=record.tipo,
        estado=record.estado,
        superficie_ha=record.superficie_ha,
        fecha_ingreso=record.fecha_ingreso,
        fecha_resolucion=record.fecha_resolucion,
        returned_solicitud=record.returned_solicitud,
        checked_at=record.checked_at,
        found_at=record.found_at,
        estado_changed_at=record.estado_changed_at,
        stale=is_stale(record, now),
        recently_changed=recently_changed(record, now),
        conaf_url=public_url(record.numero),
    )


def _normalized(raw: str) -> str:
    numero = normalize_solicitud(raw)
    if numero is None:
        raise HTTPException(status_code=422, detail=_BAD_NUMBER)
    return numero


def _lookup_and_save(
    engine: Engine, client: Lookup, numero: str, stored: ConafRecord | None
) -> ConafRecord:
    """Ask CONAF; when another lookup is running, answer with what is stored (or 503)."""

    try:
        lookup = client.lookup(numero)
    except ConafBusyError as error:
        if stored is not None:
            return stored
        raise HTTPException(status_code=503, detail=_BUSY) from error
    with engine.begin() as connection:
        record, _ = save_lookup(connection, lookup, now=datetime.now(UTC))
    return record


@router.get("/solicitudes", response_model=ConafBulkResponse)
def get_solicitudes(
    engine: DatabaseEngine,
    numeros: Annotated[str, Query(max_length=10_000)] = "",
) -> ConafBulkResponse:
    """Stored results for a list (never calls CONAF)."""

    raw = [value for value in numeros.split(",") if value.strip()]
    if len(raw) > MAX_BULK:
        raise HTTPException(status_code=422, detail=_TOO_MANY)
    wanted = {numero for value in raw if (numero := normalize_solicitud(value)) is not None}
    now = datetime.now(UTC)
    with engine.connect() as connection:
        records = read_records(connection, wanted)
    return ConafBulkResponse(solicitudes=[_model(records[n], now) for n in sorted(records)])


@router.get("/solicitudes/{numero}", response_model=ConafSolicitudModel)
def get_solicitud(numero: str, engine: DatabaseEngine, client: Client) -> ConafSolicitudModel:
    """One solicitud; refreshed from CONAF when the stored result is old."""

    normalized = _normalized(numero)
    now = datetime.now(UTC)
    with engine.connect() as connection:
        record = read_record(connection, normalized)
    if needs_refresh(record, now):
        record = _lookup_and_save(engine, client, normalized, record)
    assert record is not None
    return _model(record, datetime.now(UTC))


@router.post(
    "/solicitudes/{numero}/refresh",
    response_model=ConafSolicitudModel,
    dependencies=[Depends(require_csrf)],
)
def refresh_solicitud(numero: str, engine: DatabaseEngine, client: Client) -> ConafSolicitudModel:
    """«Actualizar desde CONAF» (not within a minute of the last check)."""

    normalized = _normalized(numero)
    now = datetime.now(UTC)
    with engine.connect() as connection:
        record = read_record(connection, normalized)
    if record is None or now - record.checked_at >= MANUAL_REFRESH_EVERY:
        record = _lookup_and_save(engine, client, normalized, record)
    return _model(record, datetime.now(UTC))
