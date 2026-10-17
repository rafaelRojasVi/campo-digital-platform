# Estado CONAF — Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read CONAF's public consulta page on the server, store each solicitud's status with a change history, refresh every known number nightly, and serve it to Transelec and Rodales through `/api/conaf`.

**Architecture:** A pure module (`app/conaf.py`) normalizes numbers, fetches with an injectable fetcher under a one-per-second limit, and parses the page. A storage module (`app/conaf_store.py`) applies the keep-the-last-good-data rules and collects the numbers both products know. A refresh module (`app/conaf_refresh.py`) runs the nightly pass inside the app lifespan. A router serves single, bulk and refresh routes. Rodales reports gain `conaf_solicitud`; the Consola gains a CONAF block.

**Tech Stack:** Python 3.12 standard library (`urllib`, `html.parser`), FastAPI, SQLAlchemy Core, Alembic, PostgreSQL, pytest.

**Spec:** `docs/superpowers/specs/2026-10-16-conaf-estado-design.md`

## Global Constraints

- Only `https://oficinavirtual.conaf.cl/consultas/action.php` is ever requested; only the `nsolicitud` value varies, and it is a normalized number.
- Numbers: 1–9 ASCII digits, left-padded to 6 (`normalize_solicitud`); anything else is not queryable.
- At most one CONAF request per second per process; 10 s timeout; at most 1 MiB read; ISO-8859-1 decoding.
- `found` requires the returned Solicitud to equal the requested number; otherwise `mismatch`.
- `unavailable`, `not_found` and `mismatch` never erase the last found data.
- No real CONAF pages in the repository: tests use synthetic HTML with CONAF's markup.
- Nightly: after 03:00 America/Santiago, once a day; numbers unchecked for 20 h; at most 2,000; stop after 5 consecutive `unavailable`. Enabled only when `APP_ENV=production` or `CONAF_REFRESH_ENABLED=1`.
- Detail refresh: when never read, older than 12 h, or `unavailable` and older than 15 min. Manual refresh: not within 60 s of the last check. Bulk route: stored data only, up to 500 numbers.
- Spanish client messages; commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A CONAF page whose row is for another number must never be stored as `found` — Task 2 `test_returned_number_must_match`.
- CONAF down during the nightly run must keep yesterday's data and stop early — Task 4 `test_refresh_stops_after_five_unavailable_and_keeps_data`.
- Planilla values like `12/34-5/26` or `MP002-202-5` must be skipped, not sent — Task 3 `test_collect_known_numbers_normalizes_and_skips_planilla_style`.
- A user without Transelec or Rodales access must not reach CONAF through the platform — Task 5 `test_routes_need_a_transelec_or_forestry_grant`.
- Clearing a report's CONAF number must work (PATCH with `null`) — Task 6 `test_report_conaf_number_can_be_set_and_cleared`.

## File Structure

| File | Responsibility |
|---|---|
| Create `migrations/versions/0015_establish_conaf_status.py` | `platform.conaf_solicitud`, `conaf_cambio`, `conaf_run`; `forestry.report.conaf_solicitud` |
| Create `apps/api/app/conaf.py` | normalize, fetch, parse, rate limit |
| Create `apps/api/app/conaf_store.py` | storage rules, known numbers, runs |
| Create `apps/api/app/conaf_refresh.py` | nightly pass and lifespan loop |
| Create `apps/api/app/routers/conaf.py` | `/api/conaf` |
| Modify `apps/api/app/main.py` | router, lifespan task |
| Modify `apps/api/app/forestry_reports.py`, `apps/api/app/routers/forestry_reports.py` | `conaf_solicitud` on reports |
| Modify `apps/api/app/consola_export.py`, `scripts/consola/index.html` | CONAF block and alerts |
| Tests | `apps/api/tests/test_conaf.py`, `test_conaf_refresh_schedule.py`; `apps/api/integration_tests/test_conaf_schema.py`, `test_conaf_store.py`, `test_conaf_router.py`; additions to `test_forestry_reports_router.py`, `test_consola_export.py`, `test_migration_graph.py`, route-pinning tests |

## Commands

- Unit: `uv run --extra api --extra transelec pytest -q apps/api/tests/<file>`
- Integration (test DB on 5433): `APP_ENV=test POSTGRES_DB=campo_digital_test POSTGRES_USER=campo_digital_test POSTGRES_PASSWORD=campo_digital_test POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 PYTHONPATH=apps/api uv run --extra api --extra transelec pytest -q apps/api/integration_tests/<file>` (run `POSTGRES_PASSWORD=x make migration-check` first after a migration change)

---

### Task 1: Migration 0015

**Files:** Create `migrations/versions/0015_establish_conaf_status.py`, `apps/api/integration_tests/test_conaf_schema.py`; Modify `apps/api/tests/test_migration_graph.py`.

- [ ] **Step 1: Graph test (failing)** — in `test_migration_graph.py`, rename `test_migration_0014_extends_0013_as_the_single_head` to `test_migration_0014_extends_0013` (drop its heads assertion) and add:

```python
def test_migration_0015_extends_0014_as_the_single_head() -> None:
    """0015 (CONAF status) extends 0014 directly."""

    root = Path(__file__).resolve().parents[3]
    revisions = _load_all_migrations(root)

    assert "0015" in revisions, "Expected migration 0015 to be present."
    down_revision, _ = revisions["0015"]
    assert down_revision == "0014"

    down_revisions = {down for down, _ in revisions.values() if down is not None}
    heads = set(revisions) - down_revisions
    assert heads == {"0015"}
```

Run the unit test; expected FAIL («Expected migration 0015 to be present.»).

- [ ] **Step 2: Schema test**

Create `apps/api/integration_tests/test_conaf_schema.py`:

```python
"""Migration 0015: CONAF status tables and the Rodales report column."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import Connection, text
from sqlalchemy.exc import IntegrityError

NOW = datetime(2026, 10, 16, 12, 0, tzinfo=UTC)


def test_conaf_tables_exist(integration_connection: Connection) -> None:
    tables = set(
        integration_connection.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'platform'")
        ).scalars()
    )
    assert {"conaf_solicitud", "conaf_cambio", "conaf_run"} <= tables


@pytest.mark.parametrize("numero", ["12345", "abc123", "1234567890"])
def test_numero_must_be_six_to_nine_digits(integration_connection: Connection, numero: str) -> None:
    with pytest.raises(IntegrityError), integration_connection.begin_nested():
        integration_connection.execute(
            text(
                "INSERT INTO platform.conaf_solicitud (numero, lookup_status, checked_at) "
                "VALUES (:numero, 'found', :now)"
            ),
            {"numero": numero, "now": NOW},
        )


def test_lookup_status_is_checked(integration_connection: Connection) -> None:
    with pytest.raises(IntegrityError), integration_connection.begin_nested():
        integration_connection.execute(
            text(
                "INSERT INTO platform.conaf_solicitud (numero, lookup_status, checked_at) "
                "VALUES ('090663', 'maybe', :now)"
            ),
            {"now": NOW},
        )


def test_report_conaf_number_is_checked(integration_connection: Connection) -> None:
    columns = integration_connection.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'forestry' AND table_name = 'report'"
        )
    ).scalars()
    assert "conaf_solicitud" in set(columns)
    check = integration_connection.execute(
        text(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conname = 'ck_report_conaf_solicitud'"
        )
    ).scalar_one()
    assert "0-9" in check
```

- [ ] **Step 3: Migration**

Create `migrations/versions/0015_establish_conaf_status.py`:

```python
"""Establish CONAF solicitud status (Estado CONAF).

Revision ID: 0015
Revises: 0014

The platform reads CONAF's public consulta page for the solicitudes that
Transelec and Rodales know (spec
``docs/superpowers/specs/2026-10-16-conaf-estado-design.md``).

Expand-only:

- ``platform.conaf_solicitud``: the last result per number. ``found`` data
  is kept when a later read is ``unavailable``, ``not_found`` or
  ``mismatch``.
- ``platform.conaf_cambio``: one row per observed change of ``estado``.
- ``platform.conaf_run``: one row per nightly refresh, for the Consola.
- ``forestry.report.conaf_solicitud``: a report's CONAF number.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NUMERO = "^[0-9]{6,9}$"


def upgrade() -> None:
    """Create the CONAF tables and the report column."""

    op.create_table(
        "conaf_solicitud",
        sa.Column("numero", sa.Text(), nullable=False),
        sa.Column("lookup_status", sa.Text(), nullable=False),
        sa.Column("tipo", sa.Text(), nullable=True),
        sa.Column("estado", sa.Text(), nullable=True),
        sa.Column("superficie_ha", sa.Numeric(14, 4), nullable=True),
        sa.Column("fecha_ingreso", sa.Date(), nullable=True),
        sa.Column("fecha_resolucion", sa.Date(), nullable=True),
        sa.Column("returned_solicitud", sa.Text(), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("found_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("estado_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(f"numero ~ '{NUMERO}'", name="ck_conaf_solicitud_numero"),
        sa.CheckConstraint(
            "lookup_status IN ('found', 'not_found', 'mismatch', 'unavailable')",
            name="ck_conaf_solicitud_lookup_status",
        ),
        sa.PrimaryKeyConstraint("numero", name="pk_conaf_solicitud"),
        schema="platform",
    )
    op.create_table(
        "conaf_cambio",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("numero", sa.Text(), nullable=False),
        sa.Column("estado_anterior", sa.Text(), nullable=True),
        sa.Column("estado_nuevo", sa.Text(), nullable=False),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["numero"],
            ["platform.conaf_solicitud.numero"],
            name="fk_conaf_cambio_numero",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_conaf_cambio"),
        schema="platform",
    )
    op.create_index(
        "ix_conaf_cambio_observed_at", "conaf_cambio", ["observed_at"], schema="platform"
    )
    op.create_table(
        "conaf_run",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("checked", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("found", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("not_found", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("mismatch", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("unavailable", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("changed", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("stopped_reason", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "stopped_reason IS NULL OR stopped_reason IN ('conaf_unavailable', 'limit')",
            name="ck_conaf_run_stopped_reason",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_conaf_run"),
        schema="platform",
    )
    op.add_column(
        "report", sa.Column("conaf_solicitud", sa.Text(), nullable=True), schema="forestry"
    )
    op.create_check_constraint(
        "ck_report_conaf_solicitud",
        "report",
        f"conaf_solicitud IS NULL OR conaf_solicitud ~ '{NUMERO}'",
        schema="forestry",
    )


def downgrade() -> None:
    """Drop the CONAF tables and the report column."""

    op.drop_constraint("ck_report_conaf_solicitud", "report", schema="forestry", type_="check")
    op.drop_column("report", "conaf_solicitud", schema="forestry")
    op.drop_table("conaf_run", schema="platform")
    op.drop_table("conaf_cambio", schema="platform")
    op.drop_table("conaf_solicitud", schema="platform")
```

- [ ] **Step 4: Run** — graph test PASS; `POSTGRES_PASSWORD=x make migration-check` passes; schema tests: 6 passed.

- [ ] **Step 5: Commit** — `feat(conaf): tables for CONAF solicitud status (migration 0015)`.

---

### Task 2: Fetch and parse (`app/conaf.py`)

**Files:** Create `apps/api/app/conaf.py`, `apps/api/tests/test_conaf.py`.

**Produces:** `normalize_solicitud(raw: str | None) -> str | None`; `public_url(numero) -> str`; `LookupStatus`; `@dataclass ConafLookup(numero, status, tipo, superficie_ha: Decimal | None, fecha_ingreso: date | None, estado, fecha_resolucion: date | None, returned_solicitud)`; `parse_conaf_page(numero, body: bytes) -> ConafLookup`; `Fetcher = Callable[[str], tuple[int, bytes]]`; `urllib_fetch(url)`; `class ConafClient(fetch=urllib_fetch, *, min_interval=1.0, clock=time.monotonic, sleep=time.sleep)` with `lookup(numero) -> ConafLookup`.

- [ ] **Step 1: Failing tests**

Create `apps/api/tests/test_conaf.py`:

```python
"""Reading CONAF's public consulta page (synthetic pages; no network)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from urllib.error import URLError

import pytest
from app.conaf import (
    MAX_BYTES,
    ConafClient,
    normalize_solicitud,
    parse_conaf_page,
    public_url,
)

HEADER = (
    "<tr><th>Solicitud</th><th>Tipo de Solicitud</th><th>Superficie</th>"
    "<th>Fecha de Ingreso</th><th>Estado</th><th>Fecha de Resoluci&oacute;n</th></tr>"
)


def page(*rows: tuple[str, ...]) -> bytes:
    body = "".join("<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "\n</tr>" for row in rows)
    html = (
        "<html><body><h3>Consulta estado de solicitudes</h3>"
        f"<table class='tabla'>{HEADER}{body}</table>"
        "<button>Volver</button></body></html>"
    )
    return html.encode("iso-8859-1")


FOUND = page(
    (
        "090663",
        "PLAN DE MANEJO  PLAN DE MANEJO",
        "3",
        "16/04/1996",
        "P.M. APROBADA NO VIGENTE",
        "11/06/1996",
    )
)
NOT_FOUND = (
    "<html><body><p>ATENCI\xd3N</p><p>La solicitud indicada no existe.</p></body></html>"
).encode("iso-8859-1")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("090663", "090663"),
        (" 90663 ", "090663"),
        ("123456789", "123456789"),
        ("1", "000001"),
        ("12/34-5/26", None),
        ("MP002-202-5", None),
        ("1234567890", None),
        ("", None),
        (None, None),
        ("１２３", None),  # full-width digits are not ASCII
    ],
)
def test_normalize_solicitud(raw: str | None, expected: str | None) -> None:
    assert normalize_solicitud(raw) == expected


def test_public_url_sends_the_padded_number() -> None:
    assert public_url("090663") == (
        "https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=090663"
    )


def test_found_page_is_parsed() -> None:
    result = parse_conaf_page("090663", FOUND)
    assert result.status == "found"
    assert result.tipo == "PLAN DE MANEJO PLAN DE MANEJO"
    assert result.superficie_ha == Decimal("3")
    assert result.fecha_ingreso == date(1996, 4, 16)
    assert result.estado == "P.M. APROBADA NO VIGENTE"
    assert result.fecha_resolucion == date(1996, 6, 11)


def test_leading_dot_superficie_and_accents() -> None:
    body = page(("000001", "BONIFICACI\xd3N FORESTACI\xd3N", ".3", "17/07/1998", "APROBADA", ""))
    result = parse_conaf_page("000001", body)
    assert result.tipo == "BONIFICACIÓN FORESTACIÓN"
    assert result.superficie_ha == Decimal("0.3")
    assert result.fecha_resolucion is None


def test_not_found_page() -> None:
    assert parse_conaf_page("999999", NOT_FOUND).status == "not_found"


def test_returned_number_must_match() -> None:
    body = page(("069025", "CTAPF APF PRE LEY 19561", "2", "26/07/1985", "APROBADA", "07/08/1985"))
    result = parse_conaf_page("090663", body)
    assert result.status == "mismatch"
    assert result.returned_solicitud == "069025"
    assert result.estado is None


def test_unknown_page_shape_is_unavailable() -> None:
    assert parse_conaf_page("090663", b"<html><body>Mantenimiento</body></html>").status == (
        "unavailable"
    )


class FakeFetch:
    def __init__(self, *responses: tuple[int, bytes] | Exception) -> None:
        self.responses = list(responses)
        self.urls: list[str] = []

    def __call__(self, url: str) -> tuple[int, bytes]:
        self.urls.append(url)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def test_client_returns_the_parsed_page() -> None:
    fetch = FakeFetch((200, FOUND))
    client = ConafClient(fetch, min_interval=0)
    assert client.lookup("090663").status == "found"
    assert fetch.urls == [public_url("090663")]


@pytest.mark.parametrize(
    "response",
    [URLError("down"), TimeoutError(), (500, b"error"), (200, b"x" * (MAX_BYTES + 1))],
)
def test_client_failures_are_unavailable(response: tuple[int, bytes] | Exception) -> None:
    client = ConafClient(FakeFetch(response), min_interval=0)
    assert client.lookup("090663").status == "unavailable"


def test_client_waits_between_requests() -> None:
    now = [100.0]
    waits: list[float] = []

    def sleep(seconds: float) -> None:
        waits.append(seconds)
        now[0] += seconds

    client = ConafClient(
        FakeFetch((200, FOUND), (200, FOUND)), min_interval=1.0, clock=lambda: now[0], sleep=sleep
    )
    client.lookup("090663")
    now[0] += 0.25
    client.lookup("090663")
    assert waits == [pytest.approx(0.75)]
```

Run; expected FAIL (`ModuleNotFoundError: app.conaf`).

- [ ] **Step 2: Implement**

Create `apps/api/app/conaf.py`:

```python
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
```

- [ ] **Step 3: Run** — `test_conaf.py`: all pass (10 + 9 + others). Ruff, format, mypy clean.

- [ ] **Step 4: Commit** — `feat(conaf): read CONAF's public consulta page`.

---

### Task 3: Storage rules and known numbers (`app/conaf_store.py`)

**Files:** Create `apps/api/app/conaf_store.py`, `apps/api/integration_tests/test_conaf_store.py`.

**Produces:** `@dataclass ConafRecord(numero, lookup_status, tipo, estado, superficie_ha: float | None, fecha_ingreso, fecha_resolucion, returned_solicitud, checked_at, found_at, estado_changed_at)`; `read_record(conn, numero)`, `read_records(conn, numeros) -> dict[str, ConafRecord]`; `save_lookup(conn, lookup, *, now) -> tuple[ConafRecord, bool]` (record, changed); `needs_refresh(record, now) -> bool`; `is_stale(record, now) -> bool`; `recently_changed(record, now) -> bool`; `collect_known_numbers(conn) -> list[str]`; `due_numbers(conn, numeros, *, now) -> list[str]`; `start_run(conn, *, now, due) -> int`; `finish_run(conn, run_id, *, now, counts, stopped_reason)`; `read_last_run(conn) -> Row | None`.

- [ ] **Step 1: Failing tests**

Create `apps/api/integration_tests/test_conaf_store.py`:

```python
"""Storage rules for CONAF results and the numbers both products know."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from app.conaf import ConafLookup
from app.conaf_store import (
    collect_known_numbers,
    due_numbers,
    is_stale,
    needs_refresh,
    read_record,
    recently_changed,
    save_lookup,
)
from sqlalchemy import Connection, text

from forestry_report_fixtures import seed_published_base, seed_user

NOW = datetime(2026, 10, 16, 12, 0, tzinfo=UTC)


def found(estado: str = "EN EVALUACION") -> ConafLookup:
    return ConafLookup(
        "090663",
        "found",
        tipo="PLAN DE MANEJO",
        superficie_ha=Decimal("3"),
        fecha_ingreso=date(2026, 9, 1),
        estado=estado,
    )


def changes(connection: Connection) -> list[tuple[str | None, str]]:
    return [
        (row.estado_anterior, row.estado_nuevo)
        for row in connection.execute(
            text("SELECT estado_anterior, estado_nuevo FROM platform.conaf_cambio ORDER BY id")
        )
    ]


def test_first_found_read_records_no_change(integration_connection: Connection) -> None:
    record, changed = save_lookup(integration_connection, found(), now=NOW)
    assert (record.lookup_status, record.estado, changed) == ("found", "EN EVALUACION", False)
    assert record.found_at == NOW and record.estado_changed_at is None
    assert changes(integration_connection) == []


def test_new_estado_records_a_change(integration_connection: Connection) -> None:
    save_lookup(integration_connection, found(), now=NOW)
    later = NOW + timedelta(days=1)
    record, changed = save_lookup(integration_connection, found("APROBADA"), now=later)
    assert changed is True
    assert (record.estado, record.estado_changed_at) == ("APROBADA", later)
    assert changes(integration_connection) == [("EN EVALUACION", "APROBADA")]


def test_unavailable_keeps_the_last_found_data(integration_connection: Connection) -> None:
    save_lookup(integration_connection, found(), now=NOW)
    later = NOW + timedelta(days=1)
    record, changed = save_lookup(
        integration_connection, ConafLookup("090663", "unavailable"), now=later
    )
    assert changed is False
    assert (record.lookup_status, record.estado, record.checked_at) == (
        "unavailable",
        "EN EVALUACION",
        later,
    )
    assert record.found_at == NOW
    assert is_stale(record, later) is True


def test_mismatch_keeps_data_and_names_the_returned_number(
    integration_connection: Connection,
) -> None:
    save_lookup(integration_connection, found(), now=NOW)
    record, _ = save_lookup(
        integration_connection,
        ConafLookup("090663", "mismatch", returned_solicitud="069025"),
        now=NOW + timedelta(hours=1),
    )
    assert (record.lookup_status, record.returned_solicitud, record.estado) == (
        "mismatch",
        "069025",
        "EN EVALUACION",
    )


def test_refresh_and_badge_windows(integration_connection: Connection) -> None:
    record, _ = save_lookup(integration_connection, found(), now=NOW)
    assert needs_refresh(None, NOW) is True
    assert needs_refresh(record, NOW + timedelta(hours=11)) is False
    assert needs_refresh(record, NOW + timedelta(hours=13)) is True
    down, _ = save_lookup(integration_connection, ConafLookup("090663", "unavailable"), now=NOW)
    assert needs_refresh(down, NOW + timedelta(minutes=16)) is True
    changed, _ = save_lookup(integration_connection, found("APROBADA"), now=NOW)
    assert recently_changed(changed, NOW + timedelta(days=6)) is True
    assert recently_changed(changed, NOW + timedelta(days=8)) is False


def test_collect_known_numbers_normalizes_and_skips_planilla_style(
    integration_connection: Connection, tmp_path: Path
) -> None:
    integration_connection.execute(
        text("UPDATE platform.transelec_dashboard_state SET active_import_id = NULL")
    )
    snapshot_id = seed_published_base(integration_connection, tmp_path)
    user_id = seed_user(integration_connection, "marco")
    for name, numero, status in (
        ("Cosecha", "123456", "borrador"),
        ("Vieja", "654321", "archivado"),
        ("Sin número", None, "borrador"),
    ):
        integration_connection.execute(
            text(
                "INSERT INTO forestry.report (name, report_type, report_month, status, "
                "base_snapshot_id, created_by_app_user_id, conaf_solicitud) "
                "VALUES (:name, 'cosecha', '2027-01', :status, :snapshot, :user, :numero)"
            ),
            {
                "name": name,
                "status": status,
                "snapshot": snapshot_id,
                "user": user_id,
                "numero": numero,
            },
        )
    assert collect_known_numbers(integration_connection) == ["123456"]


def test_due_numbers_skips_recently_checked(integration_connection: Connection) -> None:
    save_lookup(integration_connection, found(), now=NOW - timedelta(hours=2))
    assert due_numbers(integration_connection, ["090663", "111111"], now=NOW) == ["111111"]
    assert due_numbers(integration_connection, ["090663"], now=NOW + timedelta(hours=19)) == [
        "090663"
    ]
    assert read_record(integration_connection, "111111") is None
```

Note: the Transelec side of `collect_known_numbers` (numbers from the active import) is exercised in Task 4's integration test through a stubbed collector, because seeding a Transelec import needs the workbook pipeline; `collect_known_numbers` reads `platform.transelec_effective_row` only when an import is active.

- [ ] **Step 2: Implement**

Create `apps/api/app/conaf_store.py`:

```python
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

from app.conaf import ConafLookup, normalize_solicitud
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
                INSERT INTO platform.conaf_solicitud (numero, lookup_status, returned_solicitud, checked_at)
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
                "INSERT INTO platform.conaf_cambio (numero, estado_anterior, estado_nuevo, observed_at) "
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

    raw: list[str | None] = []
    import_id = read_active_import_id(connection)
    if import_id is not None:
        for row in connection.execute(
            text(
                "SELECT numero_ingreso, numero_ingreso_2 FROM platform.transelec_effective_row "
                "WHERE import_id = :import_id"
            ),
            {"import_id": import_id},
        ):
            raw.extend([row.numero_ingreso, row.numero_ingreso_2])
    raw.extend(
        connection.execute(
            text(
                "SELECT conaf_solicitud FROM forestry.report "
                "WHERE status <> 'archivado' AND conaf_solicitud IS NOT NULL"
            )
        ).scalars()
    )
    return sorted({numero for value in raw if (numero := normalize_solicitud(value)) is not None})


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
```

- [ ] **Step 3: Run** — `test_conaf_store.py`: 7 passed. Lint, format, mypy clean.

- [ ] **Step 4: Commit** — `feat(conaf): store CONAF results with change history`.

---

### Task 4: Nightly refresh (`app/conaf_refresh.py`) and lifespan wiring

**Files:** Create `apps/api/app/conaf_refresh.py`, `apps/api/tests/test_conaf_refresh_schedule.py`, `apps/api/integration_tests/test_conaf_refresh.py`; Modify `apps/api/app/main.py`.

**Produces:** `COUNT_KEYS`; `@dataclass RunSummary(counts: dict[str, int], stopped_reason: str | None)`; `should_run_now(now, last_started: datetime | None) -> bool`; `refresh_due(engine, client, *, now, clock=..., collect=collect_known_numbers, limit=MAX_PER_RUN) -> RunSummary`; `async run_conaf_refresh(engine_factory, client, *, stop, every=600.0, clock=...)`; `refresh_enabled(app_env, environ) -> bool`.

- [ ] **Step 1: Failing tests**

`apps/api/tests/test_conaf_refresh_schedule.py`:

```python
"""When the nightly CONAF refresh runs."""

from __future__ import annotations

from datetime import UTC, datetime

from app.conaf_refresh import refresh_enabled, should_run_now

# 03:30 in Chile on 2026-10-16 is 06:30 UTC (UTC-3).
NIGHT = datetime(2026, 10, 16, 6, 30, tzinfo=UTC)


def test_runs_after_three_in_chile_once_a_day() -> None:
    assert should_run_now(NIGHT, None) is True
    assert should_run_now(datetime(2026, 10, 16, 5, 30, tzinfo=UTC), None) is False  # 02:30
    assert should_run_now(NIGHT, datetime(2026, 10, 16, 6, 5, tzinfo=UTC)) is False
    assert should_run_now(NIGHT, datetime(2026, 10, 15, 6, 5, tzinfo=UTC)) is True


def test_enabled_in_production_or_by_flag() -> None:
    assert refresh_enabled("production", {}) is True
    assert refresh_enabled("development", {}) is False
    assert refresh_enabled("development", {"CONAF_REFRESH_ENABLED": "1"}) is True
    assert refresh_enabled("test", {"CONAF_REFRESH_ENABLED": "1"}) is False
```

`apps/api/integration_tests/test_conaf_refresh.py`:

```python
"""The nightly CONAF pass over PostgreSQL with a fake CONAF."""

from __future__ import annotations

from collections.abc import Generator
from datetime import UTC, date, datetime, timedelta

import pytest
from app.conaf import ConafLookup
from app.conaf_refresh import refresh_due
from app.conaf_store import read_last_run, read_record, save_lookup
from sqlalchemy import Engine, text

NOW = datetime(2026, 10, 16, 6, 30, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _clean(integration_engine: Engine) -> Generator[None, None, None]:
    yield
    with integration_engine.begin() as connection:
        for table in ("platform.conaf_cambio", "platform.conaf_run", "platform.conaf_solicitud"):
            connection.execute(text(f"DELETE FROM {table}"))


class FakeConaf:
    def __init__(self, answers: dict[str, ConafLookup]) -> None:
        self.answers = answers
        self.asked: list[str] = []

    def lookup(self, numero: str) -> ConafLookup:
        self.asked.append(numero)
        return self.answers.get(numero, ConafLookup(numero, "unavailable"))


def found(numero: str, estado: str) -> ConafLookup:
    return ConafLookup(numero, "found", estado=estado, fecha_ingreso=date(2026, 9, 1))


def test_refresh_checks_due_numbers_and_records_a_run(integration_engine: Engine) -> None:
    with integration_engine.begin() as connection:
        save_lookup(connection, found("111111", "EN EVALUACION"), now=NOW - timedelta(days=2))
        save_lookup(connection, found("222222", "EN EVALUACION"), now=NOW - timedelta(hours=1))
    conaf = FakeConaf(
        {"111111": found("111111", "APROBADA"), "333333": found("333333", "APROBADA")}
    )
    summary = refresh_due(
        integration_engine,
        conaf,
        now=NOW,
        clock=lambda: NOW,
        collect=lambda _connection: ["111111", "222222", "333333"],
    )
    assert conaf.asked == ["111111", "333333"]  # 222222 was checked an hour ago
    assert summary.counts["found"] == 2 and summary.counts["changed"] == 1
    assert summary.stopped_reason is None
    with integration_engine.connect() as connection:
        run = read_last_run(connection)
        assert run is not None and run.finished_at == NOW and run.changed == 1 and run.due == 2


def test_refresh_stops_after_five_unavailable_and_keeps_data(integration_engine: Engine) -> None:
    numbers = [f"{n:06d}" for n in range(1, 11)]
    with integration_engine.begin() as connection:
        save_lookup(connection, found("000001", "APROBADA"), now=NOW - timedelta(days=2))
    conaf = FakeConaf({})
    summary = refresh_due(
        integration_engine, conaf, now=NOW, clock=lambda: NOW, collect=lambda _c: numbers
    )
    assert len(conaf.asked) == 5
    assert summary.stopped_reason == "conaf_unavailable"
    with integration_engine.connect() as connection:
        kept = read_record(connection, "000001")
        assert (
            kept is not None and kept.estado == "APROBADA" and kept.lookup_status == "unavailable"
        )


def test_refresh_respects_the_limit(integration_engine: Engine) -> None:
    numbers = [f"{n:06d}" for n in range(1, 6)]
    conaf = FakeConaf({n: found(n, "APROBADA") for n in numbers})
    summary = refresh_due(
        integration_engine, conaf, now=NOW, clock=lambda: NOW, collect=lambda _c: numbers, limit=3
    )
    assert len(conaf.asked) == 3
    assert summary.stopped_reason == "limit"
```

- [ ] **Step 2: Implement**

Create `apps/api/app/conaf_refresh.py`:

```python
"""Nightly CONAF refresh, run inside the app (one replica; no queue).

After 03:00 in Chile, once a day, every number Transelec or Rodales knows
that was not checked in the last 20 hours is looked up again, one per
second. Five consecutive ``unavailable`` answers end the run (CONAF is
down); the stored data stays as it was. Each run leaves a
``platform.conaf_run`` row for the Consola.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, Engine

from app.conaf import ConafLookup
from app.conaf_store import (
    collect_known_numbers,
    due_numbers,
    finish_run,
    read_last_run,
    save_lookup,
    start_run,
)

logger = logging.getLogger(__name__)

CHILE = ZoneInfo("America/Santiago")
RUN_AFTER_HOUR = 3
MAX_PER_RUN = 2000
STOP_AFTER_UNAVAILABLE = 5
COUNT_KEYS = ("checked", "found", "not_found", "mismatch", "unavailable", "changed")


class Lookup(Protocol):
    def lookup(self, numero: str) -> ConafLookup: ...


@dataclass(slots=True)
class RunSummary:
    counts: dict[str, int] = field(default_factory=lambda: dict.fromkeys(COUNT_KEYS, 0))
    stopped_reason: str | None = None


def refresh_enabled(app_env: str, environ: Mapping[str, str]) -> bool:
    if app_env == "test":
        return False
    return app_env == "production" or environ.get("CONAF_REFRESH_ENABLED") == "1"


def should_run_now(now: datetime, last_started: datetime | None) -> bool:
    local = now.astimezone(CHILE)
    if local.hour < RUN_AFTER_HOUR:
        return False
    return last_started is None or last_started.astimezone(CHILE).date() < local.date()


def refresh_due(
    engine: Engine,
    client: Lookup,
    *,
    now: datetime,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    collect: Callable[[Connection], list[str]] = collect_known_numbers,
    limit: int = MAX_PER_RUN,
) -> RunSummary:
    summary = RunSummary()
    with engine.begin() as connection:
        due = due_numbers(connection, collect(connection), now=now)
        run_id = start_run(connection, now=now, due=len(due))

    streak = 0
    for numero in due[:limit]:
        lookup = client.lookup(numero)
        with engine.begin() as connection:
            _, changed = save_lookup(connection, lookup, now=clock())
        summary.counts["checked"] += 1
        summary.counts[lookup.status] += 1
        summary.counts["changed"] += int(changed)
        streak = streak + 1 if lookup.status == "unavailable" else 0
        if streak >= STOP_AFTER_UNAVAILABLE:
            summary.stopped_reason = "conaf_unavailable"
            break
    if summary.stopped_reason is None and len(due) > limit:
        summary.stopped_reason = "limit"

    with engine.begin() as connection:
        finish_run(
            connection,
            run_id,
            now=clock(),
            counts=summary.counts,
            stopped_reason=summary.stopped_reason,
        )
    logger.info("CONAF refresh: %s (stopped: %s)", summary.counts, summary.stopped_reason)
    return summary


def _run_if_due(engine: Engine, client: Lookup, now: datetime) -> None:
    with engine.connect() as connection:
        last = read_last_run(connection)
    if should_run_now(now, None if last is None else last.started_at):
        refresh_due(engine, client, now=now)


async def run_conaf_refresh(
    engine_factory: Callable[[], Engine],
    client: Lookup,
    *,
    stop: asyncio.Event,
    every: float = 600.0,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> None:
    """Wake every ``every`` seconds; run the nightly pass when due; never crash the app."""

    while True:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=every)
        if stop.is_set():
            return
        try:
            await asyncio.to_thread(_run_if_due, engine_factory(), client, clock())
        except Exception as exc:  # noqa: BLE001 - logged; the app keeps serving
            logger.warning("CONAF refresh failed (%s)", type(exc).__name__)
```

In `apps/api/app/main.py`: import `import os` (if absent), `from app.conaf import ConafClient`, `from app.conaf_refresh import refresh_enabled, run_conaf_refresh`; add a module-level `conaf_client = ConafClient()`; inside `_lifespan` after the `maintenance` task:

```python
conaf_refresh = (
    asyncio.create_task(run_conaf_refresh(get_database_engine, conaf_client, stop=stop_maintenance))
    if refresh_enabled(APP_ENV, os.environ)
    else None
)
```

and in `finally`, after `await maintenance`: `if conaf_refresh is not None: await conaf_refresh`.

- [ ] **Step 3: Run** — schedule tests 2 passed; refresh integration 3 passed; `test_main*` unit tests still pass.

- [ ] **Step 4: Commit** — `feat(conaf): nightly refresh inside the app`.

---

### Task 5: `/api/conaf` routes

**Files:** Create `apps/api/app/routers/conaf.py`, `apps/api/integration_tests/test_conaf_router.py`; Modify `apps/api/app/main.py` (include router), route-pinning tests if they list `/api` routes.

**Produces:** `router` (prefix `/api/conaf`); `get_conaf_client()` dependency (returns `app.main.conaf_client`-compatible singleton from `app.routers.conaf`); `ConafSolicitudModel`.

- [ ] **Step 1: Failing tests**

`apps/api/integration_tests/test_conaf_router.py`:

```python
"""/api/conaf over HTTP with a fake CONAF."""

from __future__ import annotations

from collections.abc import Generator
from datetime import timedelta

import pytest
from app.access import Role
from app.access_repository import grant_product_role, resolve_or_create_app_user
from app.conaf import ConafLookup
from app.csrf import CSRF_HEADER_NAME
from app.deps import SESSION_COOKIE_NAME
from app.main import app
from app.routers.conaf import get_conaf_client
from app.session_store import PlatformSessionStore
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

_sessions = PlatformSessionStore()
_ORIGIN = {"Origin": "http://testserver"}


class FakeConaf:
    def __init__(self) -> None:
        self.asked: list[str] = []
        self.answer: dict[str, ConafLookup] = {}

    def lookup(self, numero: str) -> ConafLookup:
        self.asked.append(numero)
        return self.answer.get(numero, ConafLookup(numero, "found", estado="EN EVALUACION"))


@pytest.fixture
def conaf() -> FakeConaf:
    return FakeConaf()


@pytest.fixture
def client(integration_engine: Engine, conaf: FakeConaf) -> Generator[TestClient, None, None]:
    app.dependency_overrides[get_conaf_client] = lambda: conaf
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _clean(integration_engine: Engine) -> Generator[None, None, None]:
    yield
    with integration_engine.begin() as connection:
        for table in (
            "platform.conaf_cambio",
            "platform.conaf_run",
            "platform.conaf_solicitud",
            "platform.security_event",
            "platform.session",
            "platform.product_grant",
            "platform.app_user",
        ):
            connection.execute(text(f"DELETE FROM {table}"))


def sign_in(
    client: TestClient, engine: Engine, name: str, grants: tuple[tuple[str, Role], ...]
) -> None:
    with engine.begin() as connection:
        user = resolve_or_create_app_user(
            connection,
            identity_kind="google",
            identity_key=f"sub-{name}",
            display_name=name,
            email=f"{name}@campodigital.cl",
        )
        for product, role in grants:
            grant_product_role(connection, app_user_id=user.id, product_key=product, role=role)
        secret = _sessions.create_session(connection, app_user_id=user.id, ttl=timedelta(hours=1))
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, secret)
    token = client.get("/api/auth/csrf")
    client.headers[CSRF_HEADER_NAME] = token.json()["csrf_token"]


def test_routes_need_a_transelec_or_forestry_grant(
    client: TestClient, integration_engine: Engine, conaf: FakeConaf
) -> None:
    client.cookies.clear()
    assert client.get("/api/conaf/solicitudes/090663").status_code == 401
    sign_in(client, integration_engine, "nadie", ())
    assert client.get("/api/conaf/solicitudes/090663").status_code == 403
    assert conaf.asked == []
    sign_in(client, integration_engine, "t", (("transelect", Role.VIEWER),))
    assert client.get("/api/conaf/solicitudes/090663").status_code == 200
    sign_in(client, integration_engine, "f", (("forestry", Role.VIEWER),))
    assert client.get("/api/conaf/solicitudes/090663").status_code == 200


def test_detail_reads_conaf_once_then_serves_the_stored_result(
    client: TestClient, integration_engine: Engine, conaf: FakeConaf
) -> None:
    sign_in(client, integration_engine, "t", (("transelect", Role.VIEWER),))
    first = client.get("/api/conaf/solicitudes/90663").json()
    second = client.get("/api/conaf/solicitudes/090663").json()
    assert conaf.asked == ["090663"]
    assert first["numero"] == second["numero"] == "090663"
    assert first["estado"] == "EN EVALUACION"
    assert first["lookup_status"] == "found"
    assert first["stale"] is False and first["recently_changed"] is False
    assert first["conaf_url"].endswith("nsolicitud=090663")


def test_bad_number_is_422_and_never_reaches_conaf(
    client: TestClient, integration_engine: Engine, conaf: FakeConaf
) -> None:
    sign_in(client, integration_engine, "t", (("transelect", Role.VIEWER),))
    response = client.get("/api/conaf/solicitudes/12%2F34-5%2F26")
    assert response.status_code in (404, 422)
    response = client.get("/api/conaf/solicitudes/MP002")
    assert response.status_code == 422
    assert response.json()["detail"] == "Ese número no se puede consultar en CONAF (solo dígitos)."
    assert conaf.asked == []


def test_refresh_needs_csrf_and_waits_a_minute(
    client: TestClient, integration_engine: Engine, conaf: FakeConaf
) -> None:
    sign_in(client, integration_engine, "t", (("transelect", Role.VIEWER),))
    client.get("/api/conaf/solicitudes/090663")
    assert client.post("/api/conaf/solicitudes/090663/refresh", headers=_ORIGIN).status_code == 200
    assert conaf.asked == ["090663"]  # checked seconds ago: no second call
    client.headers.pop(CSRF_HEADER_NAME)
    assert client.post("/api/conaf/solicitudes/090663/refresh", headers=_ORIGIN).status_code == 403


def test_bulk_reads_only_stored_results(
    client: TestClient, integration_engine: Engine, conaf: FakeConaf
) -> None:
    sign_in(client, integration_engine, "t", (("transelect", Role.VIEWER),))
    client.get("/api/conaf/solicitudes/090663")
    response = client.get("/api/conaf/solicitudes?numeros=90663,111111,12/34")
    assert response.status_code == 200
    body = response.json()
    assert [item["numero"] for item in body["solicitudes"]] == ["090663"]
    assert conaf.asked == ["090663"]
    too_many = ",".join(f"{n:06d}" for n in range(501))
    assert client.get(f"/api/conaf/solicitudes?numeros={too_many}").status_code == 422


def test_mismatch_and_unavailable_reach_the_client(
    client: TestClient, integration_engine: Engine, conaf: FakeConaf
) -> None:
    sign_in(client, integration_engine, "t", (("transelect", Role.VIEWER),))
    conaf.answer["111111"] = ConafLookup("111111", "mismatch", returned_solicitud="069025")
    conaf.answer["222222"] = ConafLookup("222222", "unavailable")
    mismatch = client.get("/api/conaf/solicitudes/111111").json()
    assert (mismatch["lookup_status"], mismatch["returned_solicitud"]) == ("mismatch", "069025")
    unavailable = client.get("/api/conaf/solicitudes/222222").json()
    assert unavailable["lookup_status"] == "unavailable" and unavailable["stale"] is True
```

- [ ] **Step 2: Implement**

Create `apps/api/app/routers/conaf.py`:

```python
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
from app.conaf import ConafClient, normalize_solicitud, public_url
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


def _lookup_and_save(engine: Engine, client: Lookup, numero: str) -> ConafRecord:
    lookup = client.lookup(numero)
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
        record = _lookup_and_save(engine, client, normalized)
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
        record = _lookup_and_save(engine, client, normalized)
    return _model(record, datetime.now(UTC))
```

In `apps/api/app/main.py`, change the Task 4 lifespan wiring to use the router's client (`from app.routers.conaf import get_conaf_client, router as conaf_router` and pass `get_conaf_client()` instead of a separate `ConafClient()`; drop the module-level `conaf_client`), and add `app.include_router(conaf_router)` next to the forestry routers.

- [ ] **Step 3: Run** — router tests 6 passed; existing route-pinning tests: if any enumerate every `/api` path, add the three CONAF routes; full unit and integration suites green.

- [ ] **Step 4: Commit** — `feat(conaf): /api/conaf routes for Transelec and Rodales`.

---

### Task 6: `conaf_solicitud` on Rodales reports

**Files:** Modify `apps/api/app/forestry_reports.py` (Report, `_REPORT_SELECT`, `_report`, `update_report_header`, `duplicate_report`, `REPORT_ERROR_MESSAGES`), `apps/api/app/routers/forestry_reports.py` (`ReportModel`, `_report_model`, `UpdateReportRequest`, `patch_report`, `_STATUS_FOR_CODE`); Test: append to `apps/api/integration_tests/test_forestry_reports_router.py`.

- [ ] **Step 1: Failing test** (append):

```python
def test_report_conaf_number_can_be_set_and_cleared(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    set_number = client.patch(
        f"/api/forestry/reports/{report_id}",
        json={"revision": 1, "conaf_solicitud": " 90663 "},
        headers=_ORIGIN,
    )
    assert set_number.status_code == 200, set_number.text
    detail = client.get(f"/api/forestry/reports/{report_id}").json()["report"]
    assert detail["conaf_solicitud"] == "090663"
    bad = client.patch(
        f"/api/forestry/reports/{report_id}",
        json={"revision": 2, "conaf_solicitud": "12/34-5/26"},
        headers=_ORIGIN,
    )
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "invalid_conaf"
    cleared = client.patch(
        f"/api/forestry/reports/{report_id}",
        json={"revision": 2, "conaf_solicitud": None},
        headers=_ORIGIN,
    )
    assert cleared.status_code == 200
    assert (
        client.get(f"/api/forestry/reports/{report_id}").json()["report"]["conaf_solicitud"] is None
    )
    renamed = client.patch(
        f"/api/forestry/reports/{report_id}", json={"revision": 3, "name": "Otro"}, headers=_ORIGIN
    )
    assert renamed.status_code == 200
    assert (
        client.get(f"/api/forestry/reports/{report_id}").json()["report"]["conaf_solicitud"] is None
    )
```

- [ ] **Step 2: Implement**

`forestry_reports.py`:
- `Report` gains `conaf_solicitud: str | None` (last field); `_REPORT_SELECT` selects `r.conaf_solicitud`; `_report` maps it.
- `REPORT_ERROR_MESSAGES["invalid_conaf"] = "El N.º de solicitud CONAF debe tener solo dígitos (hasta 9)."`
- module constant `_UNSET = object()`; `update_report_header(..., conaf_solicitud: object = _UNSET)`; when not `_UNSET`: `None` or blank → `NULL`; otherwise `normalize_solicitud(str(value))` (import from `app.conaf`), `None` → `ReportError("invalid_conaf")`. SQL: add `conaf_solicitud = CASE WHEN :set_conaf THEN :conaf ELSE conaf_solicitud END` with `set_conaf` boolean.
- `duplicate_report` copies `conaf_solicitud` (`SELECT :name, report_type, report_month, base_snapshot_id, :actor, conaf_solicitud` with the column added to the INSERT list).

`routers/forestry_reports.py`:
- `ReportModel.conaf_solicitud: str | None`; `_report_model` maps it.
- `UpdateReportRequest.conaf_solicitud: str | None = Field(default=None, max_length=50)`.
- `patch_report` passes `conaf_solicitud=request.conaf_solicitud` only when `"conaf_solicitud" in request.model_fields_set`.
- `_STATUS_FOR_CODE["invalid_conaf"] = 422`.

- [ ] **Step 3: Run** — the new test passes; `test_forestry_reports.py` and `test_forestry_reports_router.py` all pass.

- [ ] **Step 4: Commit** — `feat(rodales): CONAF solicitud number on management reports`.

---

### Task 7: Consola

**Files:** Modify `apps/api/app/consola_export.py`, `scripts/consola/index.html`, `scripts/consola/demo-report.json`; Test: append to `apps/api/integration_tests/test_consola_export.py`; `tests/scripts/test_consola.py` stays green.

- [ ] **Step 1: Failing test** (append):

```python
def test_conaf_block_and_alerts(integration_connection: Connection) -> None:
    integration_connection.execute(
        text(
            "INSERT INTO platform.conaf_run (started_at, finished_at, due, checked, found, "
            "unavailable, changed, stopped_reason) VALUES (:start, :end, 9, 5, 0, 5, 0, "
            "'conaf_unavailable')"
        ),
        {"start": NOW - timedelta(hours=8), "end": NOW - timedelta(hours=8)},
    )
    integration_connection.execute(
        text(
            "INSERT INTO platform.conaf_solicitud (numero, lookup_status, estado, checked_at, found_at) "
            "VALUES ('090663', 'found', 'APROBADA', :old, :old)"
        ),
        {"old": NOW - timedelta(days=4)},
    )
    report = build_report(integration_connection, now=NOW)
    assert report["conaf"]["last_run"]["stopped_reason"] == "conaf_unavailable"
    assert report["conaf"]["stale_numbers"] == 1
    assert "conaf_down" in [alert["code"] for alert in report["alerts"]]
```

- [ ] **Step 2: Implement** — in `consola_export.py` add:

```python
def _conaf(connection: Connection, now: datetime) -> dict[str, Any]:
    last = (
        connection.execute(
            text(
                "SELECT started_at, finished_at, due, checked, found, not_found, mismatch, "
                "unavailable, changed, stopped_reason FROM platform.conaf_run "
                "ORDER BY started_at DESC, id DESC LIMIT 1"
            )
        )
        .mappings()
        .one_or_none()
    )
    changes = connection.execute(
        text("SELECT count(*) FROM platform.conaf_cambio WHERE observed_at >= :since"),
        {"since": now - timedelta(hours=24)},
    ).scalar_one()
    stale = connection.execute(
        text(
            "SELECT count(*) FROM platform.conaf_solicitud "
            "WHERE checked_at < :since OR lookup_status = 'unavailable'"
        ),
        {"since": now - timedelta(days=3)},
    ).scalar_one()
    known = connection.execute(text("SELECT count(*) FROM platform.conaf_solicitud")).scalar_one()
    return {
        "last_run": None if last is None else {k: _iso(v) for k, v in last.items()},
        "changes_24h": int(changes),
        "stale_numbers": int(stale),
        "known_numbers": int(known),
    }
```

In `build_report`: `conaf = _conaf(connection, now)`; append to the alerts list (after `_alerts(...)`):

```python
alerts = _alerts(connection, day_ago)
last_run = conaf["last_run"]
if last_run is not None and last_run["stopped_reason"] == "conaf_unavailable":
    alerts.append(
        {
            "code": "conaf_down",
            "severity": "warning",
            "count": 1,
            "message": "La consulta nocturna a CONAF se detuvo: CONAF no respondía",
        }
    )
finished = None if last_run is None else last_run["finished_at"]
if conaf["known_numbers"] and (
    finished is None or finished < (now - timedelta(hours=48)).isoformat()
):
    alerts.append(
        {
            "code": "conaf_no_run",
            "severity": "warning",
            "count": 1,
            "message": "No hay consulta nocturna a CONAF terminada en 48 h",
        }
    )
```

and return `"alerts": alerts, "conaf": conaf`. (Import `timedelta` if absent.)

In `scripts/consola/index.html`, `renderHealth` gains a `conaf` argument and, when present, appends a line: «CONAF: última consulta {when(finished_at)} · {checked} revisadas · {changed} cambios» or «CONAF: sin consultas todavía»; the caller passes `r ? r.conaf : null`. Add a `conaf` block to `scripts/consola/demo-report.json` (`{"last_run": {"finished_at": "2026-10-16T06:35:00+00:00", "checked": 120, "changed": 2, "stopped_reason": null, …}, "changes_24h": 2, "stale_numbers": 0, "known_numbers": 120}`).

- [ ] **Step 3: Run** — Consola integration tests pass; `uv run pytest -q tests/scripts/test_consola.py` passes; `make consola-demo` shows the CONAF line (look once in a browser).

- [ ] **Step 4: Commit** — `feat(consola): CONAF refresh status and alerts`.

---

### Task 8: Docs and full checks

**Files:** Create `docs/platform/conaf-estado.md` (English: what is read, rules, routes, nightly run, limitations, open questions); link it from `docs/platform/README.md`; Spanish summary `products/transelect/docs/es/` or `products/forestry/docs/es/informes-de-manejo.md` gets a short «Estado CONAF» section.

- [ ] Run `uv run python scripts/update_doc_nav.py && uv run python scripts/check_doc_links.py`, `make check`, `POSTGRES_PASSWORD=x make persistence-check`. All green.
- [ ] Commit — `docs(conaf): Estado CONAF technical record`.
