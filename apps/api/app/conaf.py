"""Read CONAF's public consulta page (Estado CONAF).

CONAF publishes each solicitud's status at
``action.php?nsolicitud=<n>`` as one HTML table row. This module asks for
a normalized number, at most once per second, and turns the page into a
``ConafLookup``. It never follows another URL and never logs in: documents
behind the titular's ClaveÚnica are out of scope (spec
``docs/superpowers/specs/2026-10-16-conaf-estado-design.md``).

FACT (2026-10-16): the number must be sent with six digits; without the
leading zero CONAF matches another key. ``found`` therefore requires the
returned Solicitud to be the requested one.
"""

from __future__ import annotations

import http.client
import logging
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from typing import Literal, Protocol
from urllib.parse import urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

CONAF_CONSULTA_URL = "https://oficinavirtual.conaf.cl/consultas/action.php"
USER_AGENT = "CampoDigital-Plataforma/1.0 (consulta de estado de solicitudes)"
TIMEOUT_SECONDS = 10.0
MAX_BYTES = 1024 * 1024
MIN_INTERVAL_SECONDS = 1.0
# An interactive lookup waits at most this long for another one to finish,
# so a hanging CONAF never piles up the API's worker threads.
INTERACTIVE_WAIT_SECONDS = 2.0
# The whole read of one page, not just each socket operation.
TOTAL_DEADLINE_SECONDS = 15.0
# Numeric(14, 4) holds values below 10^10.
MAX_SUPERFICIE_HA = Decimal(10) ** 10
NOT_FOUND_TEXT = "la solicitud indicada no existe"

LookupStatus = Literal["found", "not_found", "mismatch", "unavailable"]
Fetcher = Callable[[str], tuple[int, bytes]]

_NUMBER = re.compile(r"[0-9]{1,9}")
# CONAF's «correlativo/oficina-código/año» solicitud numbers, which is what
# the Transelec planilla's «N Ingreso» holds. FACT (2026-10-18): the public
# consulta answers `12/345-6/24` with its row (APROBADA), by link
# (slashes URL-encoded) and by form alike. The 2026-10-17 conclusion that
# «N Ingreso» was not CONAF's number came from querying only digit numbers.
_SLASHED = re.compile(r"[0-9]{1,6}/[0-9]{1,4}-[0-9]{1,4}/[0-9]{2}")


def normalize_solicitud(raw: str | None) -> str | None:
    """A CONAF solicitud number, or None when it is not queryable.

    1–9 ASCII digits are left-padded to six (`90663` → `090663`, as CONAF
    answers another solicitud for the unpadded one). A slashed number
    (`12/345-6/24`) is kept as written. A typo such as `16/345-10-25` is
    not corrected: it stays unqueryable.
    """

    if raw is None:
        return None
    value = raw.strip()
    if not value.isascii():
        return None
    if _NUMBER.fullmatch(value):
        return value.zfill(6)
    if _SLASHED.fullmatch(value):
        return value
    return None


def solicitudes_in_cell(raw: str | None) -> list[str]:
    """Every queryable number in one planilla cell, in order.

    About 58 «N Ingreso» cells of the 30-Sept workbook hold two numbers (the
    ingreso and the reingreso of the same plan, source-contract-v2.md); both
    are returned. A cell that is entirely something else yields nothing.
    """

    if raw is None or not raw.isascii():
        return []
    if "/" in raw:
        # Only whole CONAF numbers; the digits of a typo do not count.
        found = _SLASHED.findall(raw)
    else:
        numero = normalize_solicitud(raw)
        found = [] if numero is None else [numero]
    return list(dict.fromkeys(found))


def public_url(numero: str) -> str:
    return f"{CONAF_CONSULTA_URL}?{urlencode({'nsolicitud': numero})}"


class ConafBusyError(RuntimeError):
    """Another CONAF lookup is still running; try again in a moment."""


@dataclass(frozen=True, slots=True)
class ConafLookup:
    numero: str
    status: LookupStatus
    tipo: str | None = None
    superficie_ha: Decimal | None = None
    fecha_ingreso: date | None = None
    estado: str | None = None
    fecha_resolucion: date | None = None
    returned_solicitud: str | None = None


class _TablaParser(HTMLParser):
    """Rows of the first ``<table class='tabla'>``, as lists of cell texts."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._in_table = False
        self._done = False
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._done:
            return
        if tag == "table" and "tabla" in (dict(attrs).get("class") or "").split():
            self._in_table = True
        elif self._in_table and tag == "tr":
            self._row = []
        elif self._in_table and tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        if not self._in_table:
            return
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None
        elif tag == "table":
            self._in_table = False
            self._done = True

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def _text(value: str) -> str | None:
    return value or None


def _decimal(value: str) -> Decimal | None:
    cleaned = value.replace(",", ".").strip()
    if not cleaned:
        return None
    try:
        number = Decimal(cleaned)
    except InvalidOperation:
        return None
    if not number.is_finite() or number < 0 or number >= MAX_SUPERFICIE_HA:
        return None
    return number


def _date(value: str) -> date | None:
    try:
        return datetime.strptime(value.strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


def parse_conaf_page(numero: str, body: bytes) -> ConafLookup:
    """Turn CONAF's answer for ``numero`` into a ``ConafLookup``."""

    text = body.decode("iso-8859-1", errors="replace")
    if NOT_FOUND_TEXT in " ".join(text.lower().split()):
        return ConafLookup(numero, "not_found")

    parser = _TablaParser()
    parser.feed(text)
    data = [row for row in parser.rows if row and row[0].lower() != "solicitud"]
    if not data or len(data[0]) < 6:
        logger.warning("CONAF page for a solicitud has an unrecognized shape")
        return ConafLookup(numero, "unavailable")

    solicitud, tipo, superficie, ingreso, estado, resolucion = data[0][:6]
    if normalize_solicitud(solicitud) != numero:
        return ConafLookup(numero, "mismatch", returned_solicitud=solicitud or None)
    return ConafLookup(
        numero,
        "found",
        tipo=_text(tipo),
        superficie_ha=_decimal(superficie),
        fecha_ingreso=_date(ingreso),
        estado=_text(estado),
        fecha_resolucion=_date(resolucion),
    )


class _Readable(Protocol):
    def read(self, size: int) -> bytes: ...


def read_with_deadline(
    response: _Readable,
    *,
    limit: int,
    deadline: float,
    clock: Callable[[], float] = time.monotonic,
) -> bytes:
    """Read until EOF or past ``limit`` bytes; raise TimeoutError after ``deadline``."""

    chunks: list[bytes] = []
    size = 0
    while True:
        if clock() > deadline:
            raise TimeoutError("CONAF page read exceeded its deadline")
        chunk = response.read(64 * 1024)
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
        if size > limit:
            break
    return b"".join(chunks)


def urllib_fetch(url: str) -> tuple[int, bytes]:
    """GET ``url`` with the platform's User-Agent; read at most ``MAX_BYTES + 1``."""

    request = Request(url, headers={"User-Agent": USER_AGENT})  # noqa: S310 - fixed https URL
    deadline = time.monotonic() + TOTAL_DEADLINE_SECONDS
    with urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
        return int(response.status), read_with_deadline(
            response, limit=MAX_BYTES, deadline=deadline
        )


class ConafClient:
    """One CONAF request at a time, at most one per ``min_interval`` seconds."""

    def __init__(
        self,
        fetch: Fetcher = urllib_fetch,
        *,
        min_interval: float = MIN_INTERVAL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._fetch = fetch
        self._min_interval = min_interval
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._last: float | None = None

    def lookup(self, numero: str, *, wait: float | None = INTERACTIVE_WAIT_SECONDS) -> ConafLookup:
        """Ask CONAF; raise ``ConafBusyError`` if another lookup holds it past ``wait``."""

        acquired = self._lock.acquire() if wait is None else self._lock.acquire(timeout=wait)
        if not acquired:
            raise ConafBusyError
        try:
            if self._last is not None:
                wait = self._last + self._min_interval - self._clock()
                if wait > 0:
                    self._sleep(wait)
            self._last = self._clock()
            try:
                status, body = self._fetch(public_url(numero))
            except (OSError, ValueError, http.client.HTTPException) as error:
                logger.warning("CONAF lookup failed (%s)", type(error).__name__)
                return ConafLookup(numero, "unavailable")
        finally:
            self._lock.release()
        if status != 200 or len(body) > MAX_BYTES:
            logger.warning("CONAF lookup answered status %s (%s bytes)", status, len(body))
            return ConafLookup(numero, "unavailable")
        return parse_conaf_page(numero, body)
