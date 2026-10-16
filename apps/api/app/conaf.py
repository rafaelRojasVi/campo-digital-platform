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
from typing import Literal
from urllib.parse import urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

CONAF_CONSULTA_URL = "https://oficinavirtual.conaf.cl/consultas/action.php"
USER_AGENT = "CampoDigital-Plataforma/1.0 (consulta de estado de solicitudes)"
TIMEOUT_SECONDS = 10.0
MAX_BYTES = 1024 * 1024
MIN_INTERVAL_SECONDS = 1.0
NOT_FOUND_TEXT = "la solicitud indicada no existe"

LookupStatus = Literal["found", "not_found", "mismatch", "unavailable"]
Fetcher = Callable[[str], tuple[int, bytes]]

_NUMBER = re.compile(r"[0-9]{1,9}")


def normalize_solicitud(raw: str | None) -> str | None:
    """1–9 ASCII digits, left-padded to six; anything else is not queryable."""

    if raw is None:
        return None
    value = raw.strip()
    if not value.isascii() or not _NUMBER.fullmatch(value):
        return None
    return value.zfill(6)


def public_url(numero: str) -> str:
    return f"{CONAF_CONSULTA_URL}?{urlencode({'nsolicitud': numero})}"


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
        return Decimal(cleaned)
    except InvalidOperation:
        return None


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


def urllib_fetch(url: str) -> tuple[int, bytes]:
    """GET ``url`` with the platform's User-Agent; read at most ``MAX_BYTES + 1``."""

    request = Request(url, headers={"User-Agent": USER_AGENT})  # noqa: S310 - fixed https URL
    with urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
        return int(response.status), response.read(MAX_BYTES + 1)


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

    def lookup(self, numero: str) -> ConafLookup:
        with self._lock:
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
        if status != 200 or len(body) > MAX_BYTES:
            logger.warning("CONAF lookup answered status %s (%s bytes)", status, len(body))
            return ConafLookup(numero, "unavailable")
        return parse_conaf_page(numero, body)
