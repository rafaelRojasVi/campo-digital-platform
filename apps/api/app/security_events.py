"""Security events for the operator's Consola: notes, rows, aggregation.

Producers raise ``SecurityHTTPException`` with a typed note; an exception
handler copies the note to ``request.state`` and ``SecurityEventMiddleware``
hands it, with the response status, to ``SecurityEventRecorder``. ``401``
answers without a note are counted per client IP, path and minute. Rows are
written by the maintenance loop once a minute, never on the request path,
and a failed write is logged and dropped.

Spec: docs/superpowers/specs/2026-10-15-platform-consola-design.md.
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol

from fastapi import HTTPException
from sqlalchemy import Engine, text
from sqlalchemy.exc import DataError, IntegrityError
from starlette.datastructures import Headers
from starlette.types import Scope

logger = logging.getLogger(__name__)

SecurityEventType = Literal["sign_in.rejected", "csrf.rejected", "access.denied", "auth.required"]

STATE_KEY = "security_event_note"
RETENTION = timedelta(days=90)
MAX_PATH_LENGTH = 512

# Railway's edge reaches the container from the shared address space; only a
# peer there may tell us the client's address.
_TRUSTED_PROXY_NETWORK = ipaddress.ip_network("100.64.0.0/10")
_IGNORED_PATHS = frozenset({"/ready", "/health"})
_IGNORED_PREFIXES = ("/assets/", "/transelec/assets/", "/rodales/assets/", "/favicon")


@dataclass(frozen=True, slots=True)
class SecurityEventNote:
    """What a producer knows about why it refused a request."""

    event_type: SecurityEventType
    reason: str | None = None
    product_key: str | None = None
    actor_app_user_id: int | None = None


class SecurityHTTPException(HTTPException):
    """An ``HTTPException`` that also records a security event."""

    def __init__(self, status_code: int, detail: str, note: SecurityEventNote) -> None:
        super().__init__(status_code=status_code, detail=detail)
        self.note = note


@dataclass(frozen=True, slots=True)
class SecurityEventRow:
    occurred_at: datetime
    event_type: SecurityEventType
    path: str
    http_status: int
    client_ip: str | None
    reason: str | None = None
    product_key: str | None = None
    actor_app_user_id: int | None = None
    count: int = 1


class SecurityEventSink(Protocol):
    def write(self, rows: list[SecurityEventRow]) -> None: ...


def _valid_ip(value: str) -> str | None:
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def client_ip(scope: Scope) -> str | None:
    """The caller's address as Railway's edge reports it, else the peer.

    The edge overwrites ``X-Real-IP`` and ``X-Forwarded-For`` (callers'
    copies do not survive) and puts the client first; later forwarded
    entries are the edge's own hops.
    """

    client = scope.get("client")
    peer = _valid_ip(client[0]) if client else None
    if peer is not None and ipaddress.ip_address(peer) in _TRUSTED_PROXY_NETWORK:
        headers = Headers(scope=scope)
        real_ip = _valid_ip(headers.get("x-real-ip", ""))
        if real_ip is not None:
            return real_ip
        forwarded = headers.get("x-forwarded-for")
        if forwarded:
            first = _valid_ip(forwarded.split(",")[0])
            if first is not None:
                return first
    return peer


def _clean_path(path: str) -> str:
    """Re-escape what ASGI percent-decoded: ``?`` and control characters.

    ``scope["path"]`` is decoded, so ``/runs/%3Fx`` arrives as ``/runs/?x``
    and ``%00`` as NUL; both would make the database reject the row.
    """

    cleaned = "".join(
        f"%{ord(char):02X}" if char == "?" or ord(char) < 0x20 or ord(char) == 0x7F else char
        for char in path
    )
    return cleaned[:MAX_PATH_LENGTH]


def is_ignored_path(path: str) -> bool:
    return path in _IGNORED_PATHS or path.startswith(_IGNORED_PREFIXES)


_ROW_ERRORS = (IntegrityError, DataError, ValueError)


class SecurityEventRecorder:
    """Buffers rows in memory between flushes; bounded so a flood cannot grow it."""

    def __init__(
        self,
        sink: SecurityEventSink,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        max_buffered: int = 10_000,
    ) -> None:
        self._sink = sink
        self._clock = clock
        self._max = max_buffered
        self._noted: list[SecurityEventRow] = []
        self._auth_required: dict[tuple[str | None, str, datetime], int] = {}
        self._dropped = 0

    def observe(
        self, *, path: str, status: int, client_ip: str | None, note: SecurityEventNote | None
    ) -> None:
        path = _clean_path(path)
        now = self._clock()
        if note is not None:
            if len(self._noted) >= self._max:
                self._dropped += 1
                return
            self._noted.append(
                SecurityEventRow(
                    occurred_at=now,
                    event_type=note.event_type,
                    path=path,
                    http_status=status,
                    client_ip=client_ip,
                    reason=note.reason,
                    product_key=note.product_key,
                    actor_app_user_id=note.actor_app_user_id,
                )
            )
        elif status == 401:
            key = (client_ip, path, now.replace(second=0, microsecond=0))
            if key not in self._auth_required and len(self._auth_required) >= self._max:
                self._dropped += 1
                return
            self._auth_required[key] = self._auth_required.get(key, 0) + 1

    def drain(self) -> list[SecurityEventRow]:
        rows = self._noted + [
            SecurityEventRow(
                occurred_at=minute,
                event_type="auth.required",
                path=path,
                http_status=401,
                client_ip=ip,
                count=count,
            )
            for (ip, path, minute), count in self._auth_required.items()
        ]
        self._noted = []
        self._auth_required = {}
        if self._dropped:
            logger.warning("Security events dropped (buffer full): %d", self._dropped)
            self._dropped = 0
        return rows

    def write(self, rows: list[SecurityEventRow]) -> int:
        if not rows:
            return 0
        try:
            self._sink.write(rows)
        except Exception as exc:  # noqa: BLE001 - recording must never break the app
            # A row the database rejects must not drop the whole batch, so a
            # data error is retried row by row. Anything else (an unreachable
            # database) drops the batch in one attempt instead of thousands.
            if len(rows) > 1 and isinstance(exc, _ROW_ERRORS):
                return sum(self.write([row]) for row in rows)
            logger.warning(
                "Security events not written (%s): %d rows dropped", type(exc).__name__, len(rows)
            )
            return 0
        return len(rows)

    def flush(self) -> int:
        return self.write(self.drain())


class NullSecurityEventSink:
    """Used under ``APP_ENV=test``, where there is no database."""

    def write(self, rows: list[SecurityEventRow]) -> None:
        del rows


_INSERT = text(
    """
    INSERT INTO platform.security_event (
        occurred_at, event_type, product_key, actor_app_user_id,
        client_ip, path, http_status, count, reason
    )
    VALUES (
        :occurred_at, :event_type, :product_key, :actor_app_user_id,
        CAST(:client_ip AS inet), :path, :http_status, :count, :reason
    )
    """
)


class DatabaseSecurityEventSink:
    def __init__(self, engine_factory: Callable[[], Engine]) -> None:
        self._engine_factory = engine_factory

    def write(self, rows: list[SecurityEventRow]) -> None:
        with self._engine_factory().begin() as connection:
            connection.execute(
                _INSERT,
                [
                    {
                        "occurred_at": row.occurred_at,
                        "event_type": row.event_type,
                        "product_key": row.product_key,
                        "actor_app_user_id": row.actor_app_user_id,
                        "client_ip": row.client_ip,
                        "path": row.path,
                        "http_status": row.http_status,
                        "count": row.count,
                        "reason": row.reason,
                    }
                    for row in rows
                ],
            )


def purge_expired_security_events(engine: Engine, *, now: datetime) -> int:
    """Delete rows older than the retention window; return how many."""

    with engine.begin() as connection:
        result = connection.execute(
            text("DELETE FROM platform.security_event WHERE occurred_at < :cutoff"),
            {"cutoff": now - RETENTION},
        )
    return result.rowcount


async def run_maintenance(
    recorder: SecurityEventRecorder,
    *,
    purge: Callable[[], int] | None,
    stop: asyncio.Event,
    flush_every: float = 60.0,
    purge_every: float = 86_400.0,
) -> None:
    """Flush every ``flush_every`` s and purge every ``purge_every`` s until stopped."""

    loop = asyncio.get_running_loop()
    next_purge = loop.time()
    while True:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=flush_every)
        rows = recorder.drain()
        await asyncio.to_thread(recorder.write, rows)
        if purge is not None and loop.time() >= next_purge:
            try:
                await asyncio.to_thread(purge)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Security event purge failed (%s)", type(exc).__name__)
            next_purge = loop.time() + purge_every
        if stop.is_set():
            return
