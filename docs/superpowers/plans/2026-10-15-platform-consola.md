# Platform Consola Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record security events in the platform and give the operator a local, good-looking Consola (`consola` command / app-menu icon) that shows alerts, activity, suspicious IPs, usage and health from production.

**Architecture:** The API gains a `platform.security_event` table (migration 0013), a `SecurityHTTPException` that producers raise to attach a typed note, and an outer ASGI middleware that turns notes and `401`s into rows (401s aggregated per IP, path and minute in memory, flushed every minute; 90-day purge daily). A read-only export module shipped in the image prints one JSON report. A stdlib-only local runner fetches it with `railway ssh`, serves a single designed page on `127.0.0.1:8787`, and installs a launcher plus `.desktop` entry.

**Tech Stack:** FastAPI/Starlette (pure ASGI middleware), SQLAlchemy Core + Alembic, PostgreSQL/PostGIS, Python stdlib (`http.server`, `subprocess`, `urllib`), one static HTML file with inline CSS/JS, pytest.

**Spec:** `docs/superpowers/specs/2026-10-15-platform-consola-design.md`

## Global Constraints

- Retention of security events: **90 days**.
- Consola binds **only to `127.0.0.1`**, port **8787**; data kept in memory, never written to disk.
- The export runs in **one read-only transaction**; no SQL string interpolation.
- Never stored or shown: tokens, cookies, OAuth codes, query strings, request/response bodies, full email addresses. Activity shows the display name, never the email.
- `reason` is always a code from a fixed list, never free text.
- Writes from the middleware happen **after** the response status is known and are **failure-safe** (log a warning, drop, never change the response).
- `401`s aggregate per `(client_ip, path, minute)`; in-memory buffers are capped (10,000 rows / keys).
- Requests to `/ready`, `/health`, `/favicon*` and `/assets/`, `/transelec/assets/`, `/rodales/assets/` are ignored.
- Errors: the Consola links to Sentry; it never calls the Sentry API. No notifications.
- UI copy in Spanish; platform forest palette; light and dark; keyboard focus visible.
- Local runner is **stdlib-only** (runs with the system `python3`, no `uv`).
- Production image installs `--extra api --extra transelec`; run API tests with `uv run --all-extras`.

## Review Focus

- **A burst of anonymous requests with random paths** (scanner): buffers must stay capped and the app must keep answering; pinned in Task 2 (`test_recorder_caps_buffers`).
- **The database is unreachable when the minute flush runs**: the request path must be unaffected and the next flush must not crash; pinned in Task 2 (`test_flush_survives_sink_failure`) and Task 3 (`test_middleware_never_changes_response_when_recording_fails`).
- **A spoofed `X-Forwarded-For` sent directly by a client**: only trusted from Railway's private range, and only the last (proxy-appended) entry; pinned in Task 2 (`test_client_ip_*`).
- **`railway` missing, logged out, or `ssh` failing** when opening the Consola: a plain Spanish message on the page, not a crash; pinned in Task 6 (`test_run_json_*`).
- **Opening the Consola twice** from the icon: the second launch must reuse the running server and just open the browser; pinned in Task 7 (`test_main_reuses_running_consola`).

---

## File Structure

| File | Responsibility |
|---|---|
| `migrations/versions/0013_establish_security_event.py` | Create `platform.security_event` |
| `apps/api/app/security_events.py` | Note/row types, `SecurityHTTPException`, `client_ip`, `SecurityEventRecorder`, sinks, purge, maintenance loop |
| `apps/api/app/security_middleware.py` | `SecurityEventMiddleware` (pure ASGI) |
| `apps/api/app/main.py` | Wire recorder, middleware, exception handler, lifespan maintenance |
| `apps/api/app/google_auth.py`, `routers/google_auth.py`, `csrf.py`, `deps.py` | Producers raise `SecurityHTTPException` |
| `apps/api/app/consola_export.py` | Read-only report → JSON (`python -m app.consola_export`) |
| `scripts/consola.py` | Local runner: fetch, serve, open browser, install/uninstall, demo |
| `scripts/consola/index.html` | The page (inline CSS/JS) |
| `scripts/consola/icon.svg` | App icon |
| `scripts/consola/demo-report.json` | Fictional data for `--demo` and the visual review |
| `Makefile` | `consola`, `consola-install`, `consola-uninstall` |
| `products/transelect/docs/deployment.md` | Runbook section |

Commands used throughout (run from the worktree root
`/home/rafael/dev/freelance/campo-digital/worktrees/campo-digital-consola`):

- Unit tests: `NO_COLOR=1 uv run --all-extras pytest <path> -q`
- Integration tests need the disposable DB: `make db-test-up`, then prefix with
  `APP_ENV=test POSTGRES_DB=campo_digital_test POSTGRES_USER=campo_digital_test POSTGRES_PASSWORD=campo_digital_test POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 PYTHONPATH=apps/api`
  (abbreviated below as `$ITEST`). Port 5433 may be shared by other sessions; if `make db-test-up` reports a conflict, stop and ask rather than resetting it.

---

### Task 1: Migration 0013 — `platform.security_event`

**Files:**
- Create: `migrations/versions/0013_establish_security_event.py`
- Modify: `apps/api/tests/test_migration_graph.py` (append a 0013 test; change the 0012 test so it no longer asserts 0012 is the head)
- Test: `apps/api/integration_tests/test_security_event_schema.py`

**Interfaces:**
- Produces: table `platform.security_event(id, occurred_at, event_type, product_key, actor_app_user_id, client_ip inet, path, http_status, count, reason)`; event types `sign_in.rejected`, `csrf.rejected`, `access.denied`, `auth.required`.

- [ ] **Step 1: Write the failing graph test**

In `apps/api/tests/test_migration_graph.py`, rename `test_migration_0012_extends_0011_as_the_single_head` to `test_migration_0012_extends_0011` and delete its last three lines (the `down_revisions`/`heads` assertion). Append:

```python
def test_migration_0013_extends_0012_as_the_single_head() -> None:
    """0013 (platform security events) extends 0012 directly."""

    root = Path(__file__).resolve().parents[3]
    revisions = _load_all_migrations(root)

    assert "0013" in revisions, "Expected migration 0013 to be present."
    down_revision, _ = revisions["0013"]
    assert down_revision == "0012"

    down_revisions = {down for down, _ in revisions.values() if down is not None}
    heads = set(revisions) - down_revisions
    assert heads == {"0013"}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 uv run --all-extras pytest apps/api/tests/test_migration_graph.py -q`
Expected: FAIL — "Expected migration 0013 to be present."

- [ ] **Step 3: Write the migration**

```python
"""Establish platform security events for the operator's Consola.

Revision ID: 0013
Revises: 0012

Expand-only. Spec:
docs/superpowers/specs/2026-10-15-platform-consola-design.md.

``platform.security_event`` holds what the audit ledger does not: rejected
sign-ins, CSRF rejections, permission denials and ``401`` answers (one row
per client IP, path and minute, with ``count``). Rows carry a URL path but
never a query string, and a reason code but never free text. The app
deletes rows older than 90 days.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EVENT_TYPES: tuple[str, ...] = (
    "sign_in.rejected",
    "csrf.rejected",
    "access.denied",
    "auth.required",
)


def upgrade() -> None:
    """Create the security event table and its two lookup indexes."""

    known = ", ".join(f"'{event_type}'" for event_type in EVENT_TYPES)
    op.create_table(
        "security_event",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("product_key", sa.Text(), nullable=True),
        sa.Column("actor_app_user_id", sa.BigInteger(), nullable=True),
        sa.Column("client_ip", postgresql.INET(), nullable=True),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("http_status", sa.SmallInteger(), nullable=False),
        sa.Column("count", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_security_event"),
        sa.ForeignKeyConstraint(
            ["actor_app_user_id"],
            ["platform.app_user.id"],
            name="fk_security_event_actor_app_user_id",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(f"event_type IN ({known})", name="ck_security_event_type_known"),
        sa.CheckConstraint("count >= 1", name="ck_security_event_count_positive"),
        sa.CheckConstraint("strpos(path, '?') = 0", name="ck_security_event_path_has_no_query"),
        schema="platform",
    )
    op.create_index(
        "ix_security_event_occurred_at", "security_event", ["occurred_at"], schema="platform"
    )
    op.create_index(
        "ix_security_event_client_ip_occurred_at",
        "security_event",
        ["client_ip", "occurred_at"],
        schema="platform",
    )


def downgrade() -> None:
    """Drop the table; nothing else references it."""

    op.drop_index(
        "ix_security_event_client_ip_occurred_at", table_name="security_event", schema="platform"
    )
    op.drop_index("ix_security_event_occurred_at", table_name="security_event", schema="platform")
    op.drop_table("security_event", schema="platform")
```

- [ ] **Step 4: Write the schema integration test**

`apps/api/integration_tests/test_security_event_schema.py`:

```python
"""Constraints on platform.security_event."""

from __future__ import annotations

import pytest
from sqlalchemy import Connection, text
from sqlalchemy.exc import IntegrityError

_INSERT = text(
    """
    INSERT INTO platform.security_event (event_type, path, http_status, client_ip, count)
    VALUES (:event_type, :path, :status, CAST(:ip AS inet), :count)
    RETURNING id
    """
)


def test_accepts_a_known_event(integration_connection: Connection) -> None:
    row_id = integration_connection.execute(
        _INSERT,
        {"event_type": "auth.required", "path": "/api/x", "status": 401, "ip": "200.1.2.3", "count": 5},
    ).scalar_one()
    assert row_id > 0


@pytest.mark.parametrize(
    ("event_type", "path", "count"),
    [("made.up", "/api/x", 1), ("auth.required", "/api/x?q=1", 1), ("auth.required", "/api/x", 0)],
)
def test_rejects_unknown_type_query_string_and_zero_count(
    integration_connection: Connection, event_type: str, path: str, count: int
) -> None:
    with pytest.raises(IntegrityError):
        with integration_connection.begin_nested():
            integration_connection.execute(
                _INSERT,
                {"event_type": event_type, "path": path, "status": 401, "ip": None, "count": count},
            )
```

- [ ] **Step 5: Run the tests**

Run: `NO_COLOR=1 uv run --all-extras pytest apps/api/tests/test_migration_graph.py -q` → PASS.
Run: `make migration-check` → succeeds (upgrade to 0013 and back).
Run: `$ITEST uv run --all-extras pytest apps/api/integration_tests/test_security_event_schema.py -q` → PASS (after `make db-test-up` and `alembic upgrade head` as `migration-check` leaves it, or run `persistence-check`).

- [ ] **Step 6: Commit**

```bash
git add migrations/versions/0013_establish_security_event.py apps/api/tests/test_migration_graph.py apps/api/integration_tests/test_security_event_schema.py
git commit -m "feat(platform): add security_event table (migration 0013)"
```

---

### Task 2: Security event core (`app/security_events.py`)

**Files:**
- Create: `apps/api/app/security_events.py`
- Test: `apps/api/tests/test_security_events.py`
- Test: `apps/api/integration_tests/test_security_event_sink.py`

**Interfaces:**
- Produces:
  - `SecurityEventNote(event_type: SecurityEventType, reason: str | None = None, product_key: str | None = None, actor_app_user_id: int | None = None)` (frozen dataclass)
  - `SecurityHTTPException(status_code: int, detail: str, note: SecurityEventNote)` — subclass of `fastapi.HTTPException`, attribute `.note`
  - `STATE_KEY = "security_event_note"`
  - `client_ip(scope: Scope) -> str | None`
  - `is_ignored_path(path: str) -> bool`
  - `SecurityEventRow` (frozen dataclass: `occurred_at, event_type, path, http_status, client_ip, reason, product_key, actor_app_user_id, count`)
  - `SecurityEventRecorder(sink: SecurityEventSink, *, clock: Callable[[], datetime] = ..., max_buffered: int = 10_000)` with `observe(*, path: str, status: int, client_ip: str | None, note: SecurityEventNote | None) -> None`, `drain() -> list[SecurityEventRow]`, `write(rows: list[SecurityEventRow]) -> int`, `flush() -> int`
  - `NullSecurityEventSink`, `DatabaseSecurityEventSink(engine_factory: Callable[[], Engine])`
  - `purge_expired_security_events(engine: Engine, *, now: datetime) -> int`
  - `run_maintenance(recorder, *, purge: Callable[[], int] | None, stop: asyncio.Event, flush_every: float = 60.0, purge_every: float = 86_400.0) -> Awaitable[None]`

- [ ] **Step 1: Write the failing unit tests**

`apps/api/tests/test_security_events.py`:

```python
"""Security event notes, client IP resolution, aggregation and failure safety."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest

from app.security_events import (
    SecurityEventNote,
    SecurityEventRecorder,
    SecurityEventRow,
    SecurityHTTPException,
    client_ip,
    is_ignored_path,
    run_maintenance,
)


class _ListSink:
    def __init__(self) -> None:
        self.rows: list[SecurityEventRow] = []

    def write(self, rows: list[SecurityEventRow]) -> None:
        self.rows.extend(rows)


class _FailingSink:
    def write(self, rows: list[SecurityEventRow]) -> None:
        raise RuntimeError("database is down")


def _clock(second: int = 10) -> datetime:
    return datetime(2026, 10, 15, 12, 30, second, tzinfo=UTC)


def _scope(peer: str, forwarded: str | None = None) -> dict[str, object]:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return {"type": "http", "client": (peer, 1234), "headers": headers}


def test_security_http_exception_carries_its_note() -> None:
    note = SecurityEventNote("csrf.rejected", reason="token_invalid")
    exc = SecurityHTTPException(403, "CSRF", note)
    assert exc.status_code == 403
    assert exc.note is note


def test_client_ip_trusts_the_last_forwarded_entry_from_railway() -> None:
    assert client_ip(_scope("100.64.0.7", "9.9.9.9, 200.1.2.3")) == "200.1.2.3"


def test_client_ip_ignores_forwarded_header_from_outside_railway() -> None:
    assert client_ip(_scope("200.1.2.3", "9.9.9.9")) == "200.1.2.3"


def test_client_ip_rejects_garbage() -> None:
    assert client_ip(_scope("100.64.0.7", "not-an-ip")) == "100.64.0.7"
    assert client_ip(_scope("testclient")) is None


def test_ignored_paths() -> None:
    assert is_ignored_path("/ready")
    assert is_ignored_path("/rodales/assets/index.js")
    assert is_ignored_path("/favicon.ico")
    assert not is_ignored_path("/api/transelec/summary")


def test_notes_become_one_row_each() -> None:
    sink = _ListSink()
    recorder = SecurityEventRecorder(sink, clock=_clock)
    note = SecurityEventNote("access.denied", reason="no_grant", product_key="forestry", actor_app_user_id=4)

    recorder.observe(path="/api/forestry/versions", status=403, client_ip="200.1.2.3", note=note)
    assert recorder.flush() == 1

    (row,) = sink.rows
    assert (row.event_type, row.reason, row.product_key, row.actor_app_user_id) == (
        "access.denied", "no_grant", "forestry", 4,
    )
    assert (row.path, row.http_status, row.client_ip, row.count) == ("/api/forestry/versions", 403, "200.1.2.3", 1)


def test_401s_aggregate_per_ip_path_and_minute() -> None:
    sink = _ListSink()
    seconds = iter([1, 20, 59])
    recorder = SecurityEventRecorder(sink, clock=lambda: _clock(next(seconds)))
    for _ in range(3):
        recorder.observe(path="/api/x", status=401, client_ip="200.1.2.3", note=None)

    recorder.flush()
    (row,) = sink.rows
    assert row.event_type == "auth.required"
    assert row.count == 3
    assert row.occurred_at == datetime(2026, 10, 15, 12, 30, tzinfo=UTC)


def test_other_statuses_without_note_are_not_recorded() -> None:
    sink = _ListSink()
    recorder = SecurityEventRecorder(sink, clock=_clock)
    for status in (200, 302, 404, 500):
        recorder.observe(path="/api/x", status=status, client_ip="200.1.2.3", note=None)
    assert recorder.flush() == 0
    assert sink.rows == []


def test_recorder_caps_buffers() -> None:
    sink = _ListSink()
    recorder = SecurityEventRecorder(sink, clock=_clock, max_buffered=5)
    for index in range(50):
        recorder.observe(path=f"/scan/{index}", status=401, client_ip="200.1.2.3", note=None)
        recorder.observe(path="/x", status=403, client_ip="200.1.2.3", note=SecurityEventNote("csrf.rejected"))
    assert len(recorder.drain()) == 10  # 5 aggregated keys + 5 noted rows


def test_flush_survives_sink_failure() -> None:
    recorder = SecurityEventRecorder(_FailingSink(), clock=_clock)
    recorder.observe(path="/api/x", status=401, client_ip=None, note=None)
    assert recorder.flush() == 0
    recorder.observe(path="/api/x", status=401, client_ip=None, note=None)
    assert recorder.flush() == 0


def test_path_is_truncated() -> None:
    sink = _ListSink()
    recorder = SecurityEventRecorder(sink, clock=_clock)
    recorder.observe(path="/" + "a" * 2000, status=401, client_ip=None, note=None)
    recorder.flush()
    assert len(sink.rows[0].path) == 512


def test_maintenance_flushes_and_stops() -> None:
    sink = _ListSink()
    recorder = SecurityEventRecorder(sink, clock=_clock)
    recorder.observe(path="/api/x", status=401, client_ip=None, note=None)
    purged: list[int] = []

    async def scenario() -> None:
        stop = asyncio.Event()
        task = asyncio.create_task(
            run_maintenance(recorder, purge=lambda: purged.append(1) or 0, stop=stop,
                            flush_every=0.01, purge_every=0.01)
        )
        await asyncio.sleep(0.05)
        stop.set()
        await task

    asyncio.run(scenario())
    assert len(sink.rows) == 1
    assert purged
```

- [ ] **Step 2: Run them to verify they fail**

Run: `NO_COLOR=1 uv run --all-extras pytest apps/api/tests/test_security_events.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.security_events'`

- [ ] **Step 3: Write `apps/api/app/security_events.py`**

```python
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
import ipaddress
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol

from fastapi import HTTPException
from sqlalchemy import Engine, text
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
    """The caller's address: the proxy-appended forwarded entry, else the peer."""

    client = scope.get("client")
    peer = _valid_ip(client[0]) if client else None
    if peer is not None and ipaddress.ip_address(peer) in _TRUSTED_PROXY_NETWORK:
        forwarded = Headers(scope=scope).get("x-forwarded-for")
        if forwarded:
            appended = _valid_ip(forwarded.split(",")[-1])
            if appended is not None:
                return appended
    return peer


def is_ignored_path(path: str) -> bool:
    return path in _IGNORED_PATHS or path.startswith(_IGNORED_PREFIXES)


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
        path = path[:MAX_PATH_LENGTH]
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
            logger.warning("Security events not written (%s): %d rows dropped", type(exc).__name__, len(rows))
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
        try:
            await asyncio.wait_for(stop.wait(), timeout=flush_every)
        except TimeoutError:
            pass
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
```

- [ ] **Step 4: Run the unit tests**

Run: `NO_COLOR=1 uv run --all-extras pytest apps/api/tests/test_security_events.py -q`
Expected: PASS (12 tests).

- [ ] **Step 5: Write the sink and purge integration test**

`apps/api/integration_tests/test_security_event_sink.py`:

```python
"""DatabaseSecurityEventSink writes rows; purge keeps 90 days."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import Engine, text

from app.security_events import (
    DatabaseSecurityEventSink,
    SecurityEventRow,
    purge_expired_security_events,
)

_MARK = "/itest/security-sink"


def _cleanup(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text("DELETE FROM platform.security_event WHERE path LIKE :p"), {"p": _MARK + "%"}
        )


def test_sink_writes_and_purge_removes_only_old_rows(integration_engine: Engine) -> None:
    now = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)
    rows = [
        SecurityEventRow(now - timedelta(days=91), "auth.required", _MARK + "/old", 401, "200.1.2.3", count=7),
        SecurityEventRow(now - timedelta(days=1), "sign_in.rejected", _MARK + "/new", 400, None, reason="flow_cookie_missing"),
    ]
    _cleanup(integration_engine)
    try:
        DatabaseSecurityEventSink(lambda: integration_engine).write(rows)
        purge_expired_security_events(integration_engine, now=now)
        with integration_engine.connect() as connection:
            remaining = connection.execute(
                text("SELECT path, reason, host(client_ip) AS ip FROM platform.security_event WHERE path LIKE :p"),
                {"p": _MARK + "%"},
            ).all()
        assert [(r.path, r.reason, r.ip) for r in remaining] == [(_MARK + "/new", "flow_cookie_missing", None)]
    finally:
        _cleanup(integration_engine)
```

- [ ] **Step 6: Run it**

Run: `$ITEST uv run --all-extras pytest apps/api/integration_tests/test_security_event_sink.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/security_events.py apps/api/tests/test_security_events.py apps/api/integration_tests/test_security_event_sink.py
git commit -m "feat(platform): security event recorder, sinks, client IP and purge"
```

---

### Task 3: Middleware, exception handler and lifespan wiring

**Files:**
- Create: `apps/api/app/security_middleware.py`
- Modify: `apps/api/app/main.py` (imports; recorder; `app.add_middleware` between `RequestBodyLimitMiddleware` and `SecurityHeadersMiddleware`; exception handler; lifespan)
- Test: `apps/api/tests/test_security_middleware.py`

**Interfaces:**
- Consumes: everything Task 2 produces.
- Produces: `SecurityEventMiddleware(app: ASGIApp, *, recorder: SecurityEventRecorder)`; in `app.main`: `security_recorder: SecurityEventRecorder`.

- [ ] **Step 1: Write the failing test**

`apps/api/tests/test_security_middleware.py`:

```python
"""The middleware records notes and 401s and never changes the response."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.testclient import TestClient

from app.security_events import (
    STATE_KEY,
    SecurityEventNote,
    SecurityEventRecorder,
    SecurityEventRow,
    SecurityHTTPException,
)
from app.security_middleware import SecurityEventMiddleware


class _ListSink:
    def __init__(self) -> None:
        self.rows: list[SecurityEventRow] = []

    def write(self, rows: list[SecurityEventRow]) -> None:
        self.rows.extend(rows)


def _app(recorder: SecurityEventRecorder) -> FastAPI:
    app = FastAPI()

    async def _security(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, SecurityHTTPException)
        setattr(request.state, STATE_KEY, exc.note)
        return await http_exception_handler(request, exc)

    app.add_exception_handler(SecurityHTTPException, _security)

    @app.get("/denied")
    def denied() -> None:
        raise SecurityHTTPException(403, "no", SecurityEventNote("access.denied", reason="no_grant"))

    @app.get("/anon")
    def anon() -> None:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    @app.get("/ready")
    def ready() -> dict[str, str]:
        raise HTTPException(status_code=401)

    @app.get("/ok")
    def ok() -> dict[str, str]:
        return {"ok": "yes"}

    app.add_middleware(SecurityEventMiddleware, recorder=recorder)
    return app


def test_middleware_records_note_and_401_but_not_ignored_or_ok() -> None:
    sink = _ListSink()
    recorder = SecurityEventRecorder(sink)
    with TestClient(_app(recorder)) as client:
        assert client.get("/denied?token=SECRET").status_code == 403
        assert client.get("/anon").status_code == 401
        assert client.get("/anon").status_code == 401
        assert client.get("/ready").status_code == 401
        assert client.get("/ok").status_code == 200
    recorder.flush()

    by_type = {row.event_type: row for row in sink.rows}
    assert set(by_type) == {"access.denied", "auth.required"}
    assert by_type["access.denied"].path == "/denied"
    assert by_type["auth.required"].count == 2
    assert "SECRET" not in repr(sink.rows)


def test_middleware_never_changes_response_when_recording_fails() -> None:
    class _Boom(SecurityEventRecorder):
        def observe(self, **kwargs: object) -> None:  # type: ignore[override]
            raise RuntimeError("boom")

    with TestClient(_app(_Boom(_ListSink()))) as client:
        assert client.get("/ok").json() == {"ok": "yes"}
        assert client.get("/anon").status_code == 401
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 uv run --all-extras pytest apps/api/tests/test_security_middleware.py -q`
Expected: FAIL — `No module named 'app.security_middleware'`.

- [ ] **Step 3: Write `apps/api/app/security_middleware.py`**

```python
"""Turn security notes and 401 answers into security events (pure ASGI)."""

from __future__ import annotations

import logging

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.security_events import STATE_KEY, SecurityEventRecorder, client_ip, is_ignored_path

logger = logging.getLogger(__name__)


class SecurityEventMiddleware:
    """Observe the final status of each request; record after the response.

    Sits outside ``RequestBodyLimitMiddleware`` so the ``401`` it answers for
    sessionless uploads is counted too. Recording failures are logged and
    swallowed: they must never change what the client receives.
    """

    def __init__(self, app: ASGIApp, *, recorder: SecurityEventRecorder) -> None:
        self.app = app
        self.recorder = recorder

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or is_ignored_path(scope["path"]):
            await self.app(scope, receive, send)
            return

        state = scope.setdefault("state", {})
        status: dict[str, int] = {}

        async def send_and_watch(message: Message) -> None:
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_and_watch)
        finally:
            if "code" in status:
                try:
                    self.recorder.observe(
                        path=scope["path"],
                        status=status["code"],
                        client_ip=client_ip(scope),
                        note=state.get(STATE_KEY),
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Security event not observed (%s)", type(exc).__name__)
```

- [ ] **Step 4: Run the middleware tests**

Run: `NO_COLOR=1 uv run --all-extras pytest apps/api/tests/test_security_middleware.py -q`
Expected: PASS.

- [ ] **Step 5: Wire it into `apps/api/app/main.py`**

Add imports next to the other `app.` imports:

```python
import asyncio
from datetime import UTC, datetime

from fastapi import Request, Response
from fastapi.exception_handlers import http_exception_handler

from app.security_events import (
    STATE_KEY,
    DatabaseSecurityEventSink,
    NullSecurityEventSink,
    SecurityEventRecorder,
    SecurityHTTPException,
    purge_expired_security_events,
    run_maintenance,
)
from app.security_middleware import SecurityEventMiddleware
```

After `init_error_reporting(...)` (which follows `APP_ENV = _resolve_app_env()`), add:

```python
# Security events for the operator's Consola. Under APP_ENV=test there is no
# database, so nothing is written.
security_recorder = SecurityEventRecorder(
    NullSecurityEventSink() if APP_ENV == "test" else DatabaseSecurityEventSink(get_database_engine)
)
```

In `_lifespan`, around the existing `try: yield`:

```python
    stop_maintenance = asyncio.Event()
    purge = (
        None
        if APP_ENV == "test"
        else lambda: purge_expired_security_events(get_database_engine(), now=datetime.now(UTC))
    )
    maintenance = asyncio.create_task(
        run_maintenance(security_recorder, purge=purge, stop=stop_maintenance)
    )
    try:
        yield
    finally:
        stop_maintenance.set()
        await maintenance
        if _execution_backend is not None:
            await _execution_backend.stop()
```

(Keep the existing `_execution_backend` start before the `try`.) Replace the middleware block so the order is body limit (inner), security events, security headers (outer):

```python
app.add_middleware(
    RequestBodyLimitMiddleware,
    ...unchanged arguments...
)
# Outside the body limit so its 401s are counted; inside the headers so the
# answers keep their security headers.
app.add_middleware(SecurityEventMiddleware, recorder=security_recorder)
app.add_middleware(SecurityHeadersMiddleware, app_env=APP_ENV)
```

Add the exception handler next to the others:

```python
@app.exception_handler(SecurityHTTPException)
async def _security_http_exception(request: Request, exc: SecurityHTTPException) -> Response:
    """Answer exactly like an HTTPException, and leave the note for the middleware."""

    setattr(request.state, STATE_KEY, exc.note)
    return await http_exception_handler(request, exc)
```

- [ ] **Step 6: Run the whole API suite**

Run: `NO_COLOR=1 uv run --all-extras pytest apps/api/tests -q`
Expected: PASS (everything that passed before, plus the new tests). Lifespan tests start and stop the maintenance task cleanly.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/security_middleware.py apps/api/app/main.py apps/api/tests/test_security_middleware.py
git commit -m "feat(platform): record security events from responses (middleware + lifespan)"
```

---

### Task 4: Producers — sign-in, CSRF, permissions

**Files:**
- Modify: `apps/api/app/google_auth.py` (add `GoogleDomainNotAllowedError`, raise it at the hosted-domain check, currently around line 144-147)
- Modify: `apps/api/app/routers/google_auth.py:123-140` (three rejection branches)
- Modify: `apps/api/app/csrf.py:216-226` (two 403 branches)
- Modify: `apps/api/app/deps.py` (`ensure_can`)
- Test: `apps/api/tests/test_security_producers.py`

**Interfaces:**
- Consumes: `SecurityHTTPException`, `SecurityEventNote` (Task 2).
- Produces: `GoogleDomainNotAllowedError(GoogleSignInError)` in `app.google_auth`. Reason codes: sign-in `flow_cookie_missing`, `flow_cookie_invalid`, `domain_not_allowed`, `token_invalid`; CSRF `origin_untrusted`, `token_invalid`; access `no_grant`, `action_not_allowed`.

- [ ] **Step 1: Write the failing tests**

`apps/api/tests/test_security_producers.py`:

```python
"""Each refusal raises SecurityHTTPException with the right note."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app import deps
from app.access import Action, Role
from app.google_auth import GoogleDomainNotAllowedError, GoogleSignInError
from app.security_events import SecurityHTTPException


def test_domain_error_is_a_sign_in_error() -> None:
    assert issubclass(GoogleDomainNotAllowedError, GoogleSignInError)


@pytest.mark.parametrize(
    ("role", "reason"),
    [(None, "no_grant"), (Role.VIEWER, "action_not_allowed")],
)
def test_ensure_can_raises_with_note(monkeypatch: pytest.MonkeyPatch, role: Role | None, reason: str) -> None:
    monkeypatch.setattr(deps, "get_product_role", lambda *a, **k: role)
    with pytest.raises(SecurityHTTPException) as caught:
        deps.ensure_can(MagicMock(), app_user_id=7, product_key="forestry", action=Action.PUBLISH)
    exc = caught.value
    assert exc.status_code == 403
    assert exc.detail == "Not permitted for this product."
    assert (exc.note.event_type, exc.note.reason, exc.note.product_key, exc.note.actor_app_user_id) == (
        "access.denied", reason, "forestry", 7,
    )
```

Also extend the existing router tests (unit level, they use TestClient against `app.main` with dependency overrides):
- In `apps/api/integration_tests/test_google_auth_router.py`, for the existing "missing flow cookie", "undecryptable flow cookie" and "sign-in error" cases, assert the response status and detail are **unchanged** (they are already asserted there; leave those assertions as they are).
- In `apps/api/integration_tests/test_csrf_router.py`, keep the existing 403 assertions.

(The status codes and `detail` texts must not change; the note is invisible to clients.)

(`Role.VIEWER` exists in `app.access` and cannot `PUBLISH`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `NO_COLOR=1 uv run --all-extras pytest apps/api/tests/test_security_producers.py -q`
Expected: FAIL — `ImportError: cannot import name 'GoogleDomainNotAllowedError'`.

- [ ] **Step 3: Implement the producers**

`apps/api/app/google_auth.py` — after `class GoogleSignInError`:

```python
class GoogleDomainNotAllowedError(GoogleSignInError):
    """The account is not in the Google Workspace domain allowed to sign in."""
```

and change the hosted-domain branch (`raise GoogleSignInError("This account does not belong to the Google Workspace domain allowed to sign in.")`) to raise `GoogleDomainNotAllowedError(` with the same message.

`apps/api/app/routers/google_auth.py` — import
`from app.google_auth import GoogleDomainNotAllowedError` (add to the existing import from `app.google_auth`) and
`from app.security_events import SecurityEventNote, SecurityHTTPException`, then replace the three raises:

```python
    if flow_cookie is None:
        logger.warning("Google sign-in rejected: flow cookie missing or expired")
        raise SecurityHTTPException(
            400,
            "Missing or expired sign-in state.",
            SecurityEventNote("sign_in.rejected", reason="flow_cookie_missing"),
        )

    try:
        flow_state = decrypt_token(flow_cookie.encode("utf-8"), key=encryption_key)
    except TokenDecryptionError as exc:
        logger.warning("Google sign-in rejected: flow cookie could not be decrypted")
        raise SecurityHTTPException(
            400,
            "Sign-in state could not be verified.",
            SecurityEventNote("sign_in.rejected", reason="flow_cookie_invalid"),
        ) from exc
```

```python
    except GoogleSignInError as exc:
        logger.warning("Google sign-in rejected: %r", str(exc))
        reason = "domain_not_allowed" if isinstance(exc, GoogleDomainNotAllowedError) else "token_invalid"
        raise SecurityHTTPException(
            401, str(exc), SecurityEventNote("sign_in.rejected", reason=reason)
        ) from exc
```

`apps/api/app/csrf.py` — import `from app.security_events import SecurityEventNote, SecurityHTTPException` and replace the two 403 raises:

```python
        raise SecurityHTTPException(
            403, _CSRF_REJECTED_DETAIL, SecurityEventNote("csrf.rejected", reason="origin_untrusted")
        )
```

```python
        raise SecurityHTTPException(
            403, _CSRF_REJECTED_DETAIL, SecurityEventNote("csrf.rejected", reason="token_invalid")
        )
```

`apps/api/app/deps.py` — import the same two names and change `ensure_can`:

```python
    role = get_product_role(connection, app_user_id=app_user_id, product_key=product_key)
    if not can(role, action):
        raise SecurityHTTPException(
            403,
            "Not permitted for this product.",
            SecurityEventNote(
                "access.denied",
                reason="no_grant" if role is None else "action_not_allowed",
                product_key=product_key,
                actor_app_user_id=app_user_id,
            ),
        )
```

If importing `app.security_events` from `app.csrf` or `app.deps` creates an import cycle (run the tests to find out), move nothing; `security_events` imports only FastAPI, SQLAlchemy and Starlette, so a cycle would point to a new import elsewhere.

- [ ] **Step 4: Run tests**

Run: `NO_COLOR=1 uv run --all-extras pytest apps/api/tests -q` → PASS.
Run (DB up): `$ITEST uv run --all-extras pytest apps/api/integration_tests/test_google_auth_router.py apps/api/integration_tests/test_csrf_router.py apps/api/integration_tests/test_forestry_route_access.py -q` → PASS, with unchanged statuses and details.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/google_auth.py apps/api/app/routers/google_auth.py apps/api/app/csrf.py apps/api/app/deps.py apps/api/tests/test_security_producers.py
git commit -m "feat(platform): note rejected sign-ins, CSRF failures and permission denials"
```

---

### Task 5: Read-only export (`app/consola_export.py`)

**Files:**
- Create: `apps/api/app/consola_export.py`
- Test: `apps/api/integration_tests/test_consola_export.py`

**Interfaces:**
- Produces: `build_report(connection: Connection, *, now: datetime) -> dict[str, Any]`; `export_json(engine: Engine, *, now: datetime) -> str`; `main() -> int`. Report keys: `generated_at`, `read_only`, `alerts`, `activity`, `suspicious_ips`, `usage`.

Report shape (the page and the runner depend on it):

```json
{
  "generated_at": "2026-10-15T15:00:00+00:00",
  "read_only": true,
  "alerts": [{"code": "sign_in_rejected", "severity": "warning", "count": 3, "message": "3 inicios de sesión rechazados en 24 h"}],
  "activity": [{"at": "...", "actor": "Javier Guerra", "event_type": "import.published", "product": "transelect", "subject": "5"}],
  "suspicious_ips": [{"ip": "200.1.2.3", "total": 140, "unauthorized": 138, "forbidden": 2, "first_seen": "...", "last_seen": "..."}],
  "usage": [{"day": "2026-10-14", "product": "transelect", "category": "publish", "count": 1}]
}
```

- [ ] **Step 1: Write the failing integration test**

`apps/api/integration_tests/test_consola_export.py`:

```python
"""The Consola export: shape, alert rules, privacy, read-only transaction."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import Connection, Engine, text

from app.access_repository import resolve_or_create_app_user
from app.audit import record_audit_event
from app.consola_export import build_report, export_json

NOW = datetime(2026, 10, 15, 15, 0, tzinfo=UTC)


def _event(connection: Connection, **values: object) -> None:
    row = {"product_key": None, "actor_app_user_id": None, "client_ip": None, "count": 1, "reason": None, **values}
    connection.execute(
        text(
            """
            INSERT INTO platform.security_event
                (occurred_at, event_type, product_key, actor_app_user_id, client_ip, path, http_status, count, reason)
            VALUES (:occurred_at, :event_type, :product_key, :actor_app_user_id,
                    CAST(:client_ip AS inet), :path, :http_status, :count, :reason)
            """
        ),
        row,
    )


def test_report_alerts_activity_ips_and_usage(integration_connection: Connection) -> None:
    c = integration_connection
    user = resolve_or_create_app_user(
        c, identity_kind="dev-local", identity_key="ana", display_name="Ana Prueba", email="ana@example.cl"
    )
    recent = NOW - timedelta(hours=2)
    for _ in range(3):
        _event(c, occurred_at=recent, event_type="sign_in.rejected", path="/api/auth/google/callback",
               http_status=400, reason="flow_cookie_missing")
    _event(c, occurred_at=recent, event_type="sign_in.rejected", path="/api/auth/google/callback",
           http_status=401, reason="domain_not_allowed")
    _event(c, occurred_at=recent, event_type="auth.required", path="/api/transelec/summary",
           http_status=401, client_ip="200.1.2.3", count=120)
    _event(c, occurred_at=NOW - timedelta(days=30), event_type="csrf.rejected", path="/old",
           http_status=403, reason="token_invalid")
    c.execute(
        text("UPDATE platform.audit_event SET occurred_at = :at WHERE id = :id"),
        {"at": recent, "id": record_audit_event(c, actor_app_user_id=user.id, event_type="session.created")},
    )
    c.execute(
        text("UPDATE platform.audit_event SET occurred_at = :at WHERE id = :id"),
        {"at": recent, "id": record_audit_event(c, actor_app_user_id=user.id, event_type="import.published",
                                                product_key="transelect", subject_id="5")},
    )

    report = build_report(c, now=NOW)

    codes = {alert["code"]: alert for alert in report["alerts"]}
    assert codes["sign_in_rejected"]["count"] == 4
    assert codes["domain_not_allowed"]["severity"] == "critical"
    assert codes["auth_burst"]["count"] == 1
    assert "csrf_rejected" not in codes  # older than 24 h

    actors = {row["actor"] for row in report["activity"]}
    assert "Ana Prueba" in actors
    assert "ana@example.cl" not in json.dumps(report, default=str)

    ips = report["suspicious_ips"]
    assert ips[0]["ip"] == "200.1.2.3" and ips[0]["unauthorized"] == 120

    usage = {(u["product"], u["category"]): u["count"] for u in report["usage"]}
    assert usage[("platform", "sign_in")] >= 1
    assert usage[("transelect", "publish")] >= 1


def test_export_runs_in_a_read_only_transaction(integration_engine: Engine) -> None:
    report = json.loads(export_json(integration_engine, now=NOW))
    assert report["read_only"] is True
    assert set(report) == {"generated_at", "read_only", "alerts", "activity", "suspicious_ips", "usage"}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `$ITEST uv run --all-extras pytest apps/api/integration_tests/test_consola_export.py -q`
Expected: FAIL — `No module named 'app.consola_export'`.

- [ ] **Step 3: Write `apps/api/app/consola_export.py`**

```python
"""Read-only report for the operator's Consola, printed as one JSON document.

Run inside the production container:
``cd /app/apps/api && /app/.venv/bin/python -m app.consola_export``.
One read-only transaction, fixed queries, no interpolated values. Activity
names people by display name, never by email.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import Connection, Engine, text

AUTH_BURST_PER_MINUTE = 60

def _iso(value: object) -> object:
    if isinstance(value, datetime | date):
        return value.isoformat()
    return value


def _alerts(connection: Connection, since: datetime) -> list[dict[str, Any]]:
    counts = connection.execute(
        text(
            """
            SELECT
              coalesce(sum(count) FILTER (WHERE event_type = 'sign_in.rejected'), 0) AS sign_in_rejected,
              coalesce(sum(count) FILTER (WHERE reason = 'domain_not_allowed'), 0) AS domain_not_allowed,
              coalesce(sum(count) FILTER (WHERE event_type = 'csrf.rejected'), 0) AS csrf_rejected,
              coalesce(sum(count) FILTER (WHERE event_type = 'access.denied'), 0) AS access_denied
            FROM platform.security_event
            WHERE occurred_at >= :since
            """
        ),
        {"since": since},
    ).one()
    burst_ips = connection.execute(
        text(
            """
            SELECT count(DISTINCT client_ip) FROM platform.security_event
            WHERE event_type = 'auth.required' AND occurred_at >= :since AND count > :limit
            """
        ),
        {"since": since, "limit": AUTH_BURST_PER_MINUTE},
    ).scalar_one()

    rules = [
        ("sign_in_rejected", "warning", counts.sign_in_rejected, "{n} inicios de sesión rechazados en 24 h"),
        ("domain_not_allowed", "critical", counts.domain_not_allowed, "{n} intentos con cuentas fuera de Campo Digital"),
        ("auth_burst", "critical", burst_ips, "{n} IP con más de 60 solicitudes sin sesión en un minuto"),
        ("csrf_rejected", "critical", counts.csrf_rejected, "{n} solicitudes rechazadas por CSRF"),
        ("access_denied", "warning", counts.access_denied, "{n} accesos denegados por permisos"),
    ]
    return [
        {"code": code, "severity": severity, "count": int(n), "message": message.format(n=int(n))}
        for code, severity, n, message in rules
        if n
    ]


def build_report(connection: Connection, *, now: datetime) -> dict[str, Any]:
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)
    read_only = connection.execute(text("SHOW transaction_read_only")).scalar_one() == "on"

    activity = connection.execute(
        text(
            """
            SELECT e.occurred_at AS at, coalesce(u.display_name, 'Sistema') AS actor,
                   e.event_type, e.product_key AS product, e.subject_id AS subject
            FROM platform.audit_event e
            LEFT JOIN platform.app_user u ON u.id = e.actor_app_user_id
            WHERE e.occurred_at >= :since
            ORDER BY e.occurred_at DESC
            LIMIT 200
            """
        ),
        {"since": week_ago},
    ).mappings().all()

    suspicious = connection.execute(
        text(
            """
            SELECT host(client_ip) AS ip, sum(count) AS total,
                   coalesce(sum(count) FILTER (WHERE http_status = 401), 0) AS unauthorized,
                   coalesce(sum(count) FILTER (WHERE http_status = 403), 0) AS forbidden,
                   min(occurred_at) AS first_seen, max(occurred_at) AS last_seen
            FROM platform.security_event
            WHERE client_ip IS NOT NULL AND http_status IN (401, 403) AND occurred_at >= :since
            GROUP BY client_ip
            ORDER BY total DESC
            LIMIT 20
            """
        ),
        {"since": week_ago},
    ).mappings().all()

    usage = connection.execute(
        text(
            """
            SELECT day, product, category, count(*) AS count FROM (
              SELECT (occurred_at AT TIME ZONE 'America/Santiago')::date AS day,
                     coalesce(product_key, 'platform') AS product,
                     CASE
                       WHEN event_type = 'session.created' THEN 'sign_in'
                       WHEN event_type IN ('upload.completed', 'forestry.snapshot.uploaded') THEN 'upload'
                       WHEN event_type = 'import.validated' THEN 'validation'
                       WHEN event_type IN ('import.published', 'import.restored',
                                           'forestry.snapshot.published', 'forestry.snapshot.restored')
                         THEN 'publish'
                       WHEN event_type = 'transelec.override.saved' THEN 'edit'
                     END AS category
              FROM platform.audit_event
              WHERE occurred_at >= :since
            ) categorized
            WHERE category IS NOT NULL
            GROUP BY day, product, category
            ORDER BY day, product, category
            """
        ),
        {"since": week_ago},
    ).mappings().all()

    def rows(result: Any) -> list[dict[str, Any]]:
        return [{key: _iso(value) for key, value in row.items()} for row in result]

    return {
        "generated_at": now.isoformat(),
        "read_only": read_only,
        "alerts": _alerts(connection, day_ago),
        "activity": rows(activity),
        "suspicious_ips": [
            {**row, "total": int(row["total"]), "unauthorized": int(row["unauthorized"]),
             "forbidden": int(row["forbidden"])}
            for row in rows(suspicious)
        ],
        "usage": [{**row, "count": int(row["count"])} for row in rows(usage)],
    }


def export_json(engine: Engine, *, now: datetime) -> str:
    with engine.connect() as connection:
        with connection.begin():
            connection.execute(text("SET TRANSACTION READ ONLY"))
            report = build_report(connection, now=now)
    return json.dumps(report, ensure_ascii=False)


def main() -> int:
    from app.database import get_database_engine

    try:
        print(export_json(get_database_engine(), now=datetime.now(UTC)))
    except Exception as exc:  # noqa: BLE001 - say what failed, never dump data
        print(f"consola export failed: {type(exc).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the tests**

Run: `$ITEST uv run --all-extras pytest apps/api/integration_tests/test_consola_export.py -q` → PASS.
Run: `NO_COLOR=1 uv run --all-extras ruff check apps/api && uv run --all-extras mypy .` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/consola_export.py apps/api/integration_tests/test_consola_export.py
git commit -m "feat(platform): read-only Consola export (alerts, activity, IPs, usage)"
```

---

### Task 6: Local runner core (`scripts/consola.py`)

**Files:**
- Create: `scripts/consola.py`
- Create: `scripts/consola/demo-report.json`
- Test: `tests/scripts/test_consola.py`

**Interfaces:**
- Produces (module `scripts.consola`, stdlib only):
  - `HOST = "127.0.0.1"`, `PORT = 8787`, `SERVICE = "campo-digital-platform"`
  - `EXPORT_COMMAND: list[str]`, `DEPLOYMENTS_COMMAND: list[str]`
  - `class ConsolaError(Exception)` (message is user-facing Spanish)
  - `run_json(command: list[str], runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run) -> object`
  - `fetch_snapshot(runner=subprocess.run, now: Callable[[], datetime] = ...) -> dict[str, object]` → `{"report": dict | None, "deployments": list, "fetched_at": str, "error": str | None}`
  - `summarize_deployments(raw: object) -> list[dict[str, str]]`
  - `class ConsolaState(fetch: Callable[[], dict[str, object]])` with `snapshot(refresh: bool) -> dict[str, object]`, `last_request: float`
  - `make_server(state: ConsolaState, page: bytes, host: str = HOST, port: int = PORT) -> ThreadingHTTPServer`

- [ ] **Step 1: Write the failing tests**

`tests/scripts/test_consola.py`:

```python
"""Local Consola runner: fetching, errors, local-only server."""

from __future__ import annotations

import json
import subprocess
import threading
import urllib.request
from datetime import UTC, datetime

import pytest

from scripts import consola


def _completed(stdout: str = "", stderr: str = "", code: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=[], returncode=code, stdout=stdout, stderr=stderr)


def test_run_json_reads_the_last_json_line() -> None:
    out = "Using SSH key from file ...\n{\"alerts\": []}\n"
    assert consola.run_json(["x"], runner=lambda *a, **k: _completed(out)) == {"alerts": []}


def test_run_json_missing_cli() -> None:
    def runner(*a: object, **k: object) -> subprocess.CompletedProcess[str]:
        raise FileNotFoundError("railway")

    with pytest.raises(consola.ConsolaError, match="railway"):
        consola.run_json(["railway"], runner=runner)


def test_run_json_logged_out() -> None:
    with pytest.raises(consola.ConsolaError, match="railway login"):
        consola.run_json(["x"], runner=lambda *a, **k: _completed(stderr="Unauthorized. Please login", code=1))


def test_run_json_other_failure_shows_exit_code_only() -> None:
    with pytest.raises(consola.ConsolaError, match="código 2") as caught:
        consola.run_json(["x"], runner=lambda *a, **k: _completed(stderr="secret row data", code=2))
    assert "secret" not in str(caught.value)


def test_run_json_timeout() -> None:
    def runner(*a: object, **k: object) -> subprocess.CompletedProcess[str]:
        raise subprocess.TimeoutExpired(cmd="x", timeout=1)

    with pytest.raises(consola.ConsolaError, match="tardó"):
        consola.run_json(["x"], runner=runner)


def test_summarize_deployments() -> None:
    raw = [{"id": "94172cf4-aaaa", "status": "SUCCESS", "createdAt": "2026-10-15T18:00:00Z",
            "meta": {"commitHash": "25b4014abc", "commitMessage": "Merge pull request #98\n\nbody"}}]
    assert consola.summarize_deployments(raw) == [
        {"id": "94172cf4", "status": "SUCCESS", "created_at": "2026-10-15T18:00:00Z",
         "commit": "25b4014", "message": "Merge pull request #98"}
    ]


def test_fetch_snapshot_reports_error_instead_of_raising() -> None:
    def runner(*a: object, **k: object) -> subprocess.CompletedProcess[str]:
        raise FileNotFoundError("railway")

    snap = consola.fetch_snapshot(runner=runner, now=lambda: datetime(2026, 10, 15, tzinfo=UTC))
    assert snap["report"] is None
    assert "railway" in str(snap["error"])


def test_server_serves_page_and_report_on_localhost_only() -> None:
    calls: list[int] = []

    def fetch() -> dict[str, object]:
        calls.append(1)
        return {"report": {"alerts": []}, "deployments": [], "fetched_at": "t", "error": None}

    server = consola.make_server(consola.ConsolaState(fetch), b"<html>ok</html>", port=0)
    host, port = server.server_address[:2]
    assert host == "127.0.0.1"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{port}"
        assert urllib.request.urlopen(base + "/").read() == b"<html>ok</html>"
        assert json.loads(urllib.request.urlopen(base + "/api/report").read())["report"] == {"alerts": []}
        urllib.request.urlopen(base + "/api/report")  # cached
        urllib.request.urlopen(base + "/api/report?refresh=1")  # refetch
        assert len(calls) == 2
        assert json.loads(urllib.request.urlopen(base + "/api/ping").read()) == {"app": "campo-consola"}
    finally:
        server.shutdown()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `NO_COLOR=1 uv run --all-extras pytest tests/scripts/test_consola.py -q`
Expected: FAIL — `cannot import name 'consola'`.

- [ ] **Step 3: Write `scripts/consola.py` (core part)**

```python
#!/usr/bin/env python3
"""Consola Campo Digital: local security and usage view for the operator.

Fetches a read-only report from production with the Railway CLI
(`railway ssh` running `python -m app.consola_export`), serves one page on
http://127.0.0.1:8787 and opens the browser. Standard library only, so it
runs with the system python3. Data stays in memory.

Spec: docs/superpowers/specs/2026-10-15-platform-consola-design.md.
"""

from __future__ import annotations

import json
import subprocess
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = 8787
SERVICE = "campo-digital-platform"
ASSETS = Path(__file__).resolve().parent / "consola"
EXPORT_COMMAND = [
    "railway", "ssh", "--service", SERVICE, "--",
    "sh", "-c", "cd /app/apps/api && /app/.venv/bin/python -m app.consola_export",
]
DEPLOYMENTS_COMMAND = ["railway", "deployment", "list", "--service", SERVICE, "--json"]
TIMEOUT_SECONDS = 120


class ConsolaError(Exception):
    """A problem the operator can act on; the message is shown on the page."""


Runner = Callable[..., "subprocess.CompletedProcess[str]"]


def run_json(command: list[str], runner: Runner = subprocess.run) -> object:
    try:
        result = runner(command, capture_output=True, text=True, timeout=TIMEOUT_SECONDS, check=False)
    except FileNotFoundError as exc:
        raise ConsolaError(
            "No encuentro el comando railway. Instálalo con: npm install -g @railway/cli"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ConsolaError("Railway tardó demasiado en responder. Intenta de nuevo.") from exc
    if result.returncode != 0:
        stderr = (result.stderr or "").lower()
        if "unauthorized" in stderr or "login" in stderr:
            raise ConsolaError("Railway no tiene sesión iniciada. Corre: railway login")
        raise ConsolaError(f"El comando de Railway falló (código {result.returncode}).")
    for line in reversed((result.stdout or "").splitlines()):
        line = line.strip()
        if line.startswith(("{", "[")):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                break
    raise ConsolaError("Railway respondió, pero sin un reporte válido.")


def summarize_deployments(raw: object) -> list[dict[str, str]]:
    summary: list[dict[str, str]] = []
    for item in raw[:3] if isinstance(raw, list) else []:
        meta = item.get("meta") or {}
        message = (meta.get("commitMessage") or "").splitlines()
        summary.append(
            {
                "id": str(item.get("id", ""))[:8],
                "status": str(item.get("status", "")),
                "created_at": str(item.get("createdAt", "")),
                "commit": str(meta.get("commitHash") or "")[:7],
                "message": message[0] if message else "",
            }
        )
    return summary


def fetch_snapshot(
    runner: Runner = subprocess.run, now: Callable[[], datetime] = lambda: datetime.now(UTC)
) -> dict[str, object]:
    snapshot: dict[str, object] = {"report": None, "deployments": [], "fetched_at": now().isoformat(), "error": None}
    try:
        snapshot["report"] = run_json(EXPORT_COMMAND, runner)
        snapshot["deployments"] = summarize_deployments(run_json(DEPLOYMENTS_COMMAND, runner))
    except ConsolaError as exc:
        snapshot["error"] = str(exc)
    return snapshot


class ConsolaState:
    def __init__(self, fetch: Callable[[], dict[str, object]]) -> None:
        self._fetch = fetch
        self._lock = threading.Lock()
        self._data: dict[str, object] | None = None
        self.last_request = time.monotonic()

    def snapshot(self, refresh: bool) -> dict[str, object]:
        with self._lock:
            if refresh or self._data is None:
                self._data = self._fetch()
            return self._data


def make_server(state: ConsolaState, page: bytes, host: str = HOST, port: int = PORT) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 - http.server API
            state.last_request = time.monotonic()
            url = urlparse(self.path)
            if url.path == "/":
                self._send(200, page, "text/html; charset=utf-8")
            elif url.path == "/api/report":
                refresh = parse_qs(url.query).get("refresh") == ["1"]
                body = json.dumps(state.snapshot(refresh), ensure_ascii=False).encode()
                self._send(200, body, "application/json; charset=utf-8")
            elif url.path == "/api/ping":
                self._send(200, b'{"app": "campo-consola"}', "application/json")
            elif url.path == "/icon.svg":
                self._send(200, (ASSETS / "icon.svg").read_bytes(), "image/svg+xml")
            else:
                self._send(404, b"Not found", "text/plain")

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            del format, args  # keep the terminal quiet

    return ThreadingHTTPServer((host, port), Handler)
```

`scripts/consola/demo-report.json` — fictional data, clearly marked:

```json
{
  "report": {
    "generated_at": "2026-10-15T15:00:00+00:00",
    "read_only": true,
    "alerts": [
      {"code": "sign_in_rejected", "severity": "warning", "count": 3, "message": "3 inicios de sesión rechazados en 24 h"},
      {"code": "auth_burst", "severity": "critical", "count": 1, "message": "1 IP con más de 60 solicitudes sin sesión en un minuto"}
    ],
    "activity": [
      {"at": "2026-10-15T14:20:00+00:00", "actor": "Persona Demo", "event_type": "import.published", "product": "transelect", "subject": "5"},
      {"at": "2026-10-15T14:05:00+00:00", "actor": "Persona Demo", "event_type": "forestry.snapshot.uploaded", "product": "forestry", "subject": "1"},
      {"at": "2026-10-15T13:50:00+00:00", "actor": "Persona Demo", "event_type": "session.created", "product": null, "subject": null}
    ],
    "suspicious_ips": [
      {"ip": "203.0.113.7", "total": 140, "unauthorized": 138, "forbidden": 2, "first_seen": "2026-10-15T09:00:00+00:00", "last_seen": "2026-10-15T09:04:00+00:00"}
    ],
    "usage": [
      {"day": "2026-10-13", "product": "platform", "category": "sign_in", "count": 1},
      {"day": "2026-10-14", "product": "platform", "category": "sign_in", "count": 2},
      {"day": "2026-10-14", "product": "transelect", "category": "upload", "count": 1},
      {"day": "2026-10-14", "product": "transelect", "category": "publish", "count": 1},
      {"day": "2026-10-14", "product": "forestry", "category": "upload", "count": 1},
      {"day": "2026-10-15", "product": "platform", "category": "sign_in", "count": 1}
    ]
  },
  "deployments": [
    {"id": "94172cf4", "status": "SUCCESS", "created_at": "2026-10-15T18:00:00Z", "commit": "25b4014", "message": "Merge pull request #98 (demo)"}
  ],
  "fetched_at": "2026-10-15T15:00:05+00:00",
  "error": null,
  "demo": true
}
```

(`203.0.113.7` is a documentation address, RFC 5737.)

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 uv run --all-extras pytest tests/scripts/test_consola.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/consola.py scripts/consola/demo-report.json tests/scripts/test_consola.py
git commit -m "feat(consola): local runner core (fetch via railway, local-only server)"
```

---

### Task 7: Opening it — browser, reuse, idle exit, install, Makefile

**Files:**
- Modify: `scripts/consola.py` (add opener, reuse check, idle watchdog, `install`/`uninstall`, `main`)
- Create: `scripts/consola/icon.svg`
- Modify: `Makefile` (three targets)
- Test: `tests/scripts/test_consola.py` (append)

**Interfaces:**
- Consumes: Task 6 names.
- Produces: `is_wsl(environ: Mapping[str, str], proc_version: str) -> bool`; `browser_command(url: str, *, wsl: bool, which: Callable[[str], str | None]) -> list[str] | None`; `already_running(url: str) -> bool`; `install(repo_root: Path, home: Path) -> list[Path]`; `uninstall(home: Path) -> list[Path]`; `IDLE_EXIT_SECONDS = 3600`; `main(argv: list[str] | None = None) -> int`.

- [ ] **Step 1: Append the failing tests**

```python
from pathlib import Path


def test_is_wsl() -> None:
    assert consola.is_wsl({"WSL_DISTRO_NAME": "Ubuntu"}, "")
    assert consola.is_wsl({}, "Linux version 6.18 microsoft-standard-WSL2")
    assert not consola.is_wsl({}, "Linux version 6.8.0-generic")


@pytest.mark.parametrize(
    ("wsl", "available", "expected"),
    [
        (True, {"wslview", "explorer.exe"}, ["wslview", "http://u"]),
        (True, {"explorer.exe"}, ["explorer.exe", "http://u"]),
        (False, {"xdg-open"}, ["xdg-open", "http://u"]),
        (False, set(), None),
    ],
)
def test_browser_command(wsl: bool, available: set[str], expected: list[str] | None) -> None:
    which = lambda name: f"/usr/bin/{name}" if name in available else None  # noqa: E731
    assert consola.browser_command("http://u", wsl=wsl, which=which) == expected


def test_install_and_uninstall(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    (repo / "scripts" / "consola").mkdir(parents=True)
    home = tmp_path / "home"

    written = consola.install(repo, home)
    launcher = home / ".local/bin/consola"
    desktop = home / ".local/share/applications/campo-consola.desktop"
    assert set(written) == {launcher, desktop}
    assert str(repo / "scripts" / "consola.py") in launcher.read_text()
    assert launcher.stat().st_mode & 0o111
    assert "Name=Consola Campo Digital" in desktop.read_text()
    assert f"Exec={launcher}" in desktop.read_text()

    assert set(consola.uninstall(home)) == {launcher, desktop}
    assert not launcher.exists() and not desktop.exists()


def test_main_reuses_running_consola(monkeypatch: pytest.MonkeyPatch) -> None:
    opened: list[str] = []
    monkeypatch.setattr(consola, "already_running", lambda url: True)
    monkeypatch.setattr(consola, "open_browser", lambda url: opened.append(url))
    monkeypatch.setattr(consola, "make_server", lambda *a, **k: pytest.fail("must not start a server"))
    assert consola.main([]) == 0
    assert opened == ["http://127.0.0.1:8787/"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `NO_COLOR=1 uv run --all-extras pytest tests/scripts/test_consola.py -q`
Expected: FAIL — `module 'scripts.consola' has no attribute 'is_wsl'`.

- [ ] **Step 3: Append to `scripts/consola.py`**

Add `import os`, `import shutil`, `import sys`, `import urllib.request` and `from collections.abc import Mapping` to the imports, then:

```python
IDLE_EXIT_SECONDS = 3600
URL = f"http://{HOST}:{PORT}/"


def is_wsl(environ: Mapping[str, str], proc_version: str) -> bool:
    return "WSL_DISTRO_NAME" in environ or "microsoft" in proc_version.lower()


def browser_command(url: str, *, wsl: bool, which: Callable[[str], str | None]) -> list[str] | None:
    candidates = ["wslview", "explorer.exe"] if wsl else ["xdg-open"]
    for name in candidates:
        if which(name):
            return [name, url]
    return None


def open_browser(url: str) -> None:
    try:
        proc_version = Path("/proc/version").read_text(encoding="utf-8")
    except OSError:
        proc_version = ""
    command = browser_command(url, wsl=is_wsl(os.environ, proc_version), which=shutil.which)
    if command is None:
        print(f"Abre en tu navegador: {url}")
        return
    subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # noqa: S603


def already_running(url: str) -> bool:
    try:
        with urllib.request.urlopen(url + "api/ping", timeout=1) as response:  # noqa: S310 - localhost
            return json.loads(response.read()).get("app") == "campo-consola"
    except (OSError, ValueError):
        return False


_LAUNCHER = """#!/bin/sh
# Consola Campo Digital (installed by `make consola-install`).
exec python3 "{script}" "$@"
"""

_DESKTOP = """[Desktop Entry]
Type=Application
Name=Consola Campo Digital
Comment=Seguridad y uso de la plataforma Campo Digital
Exec={launcher}
Icon={icon}
Terminal=false
Categories=Development;Monitor;
"""


def install(repo_root: Path, home: Path) -> list[Path]:
    launcher = home / ".local/bin/consola"
    desktop = home / ".local/share/applications/campo-consola.desktop"
    launcher.parent.mkdir(parents=True, exist_ok=True)
    desktop.parent.mkdir(parents=True, exist_ok=True)
    launcher.write_text(_LAUNCHER.format(script=repo_root / "scripts" / "consola.py"), encoding="utf-8")
    launcher.chmod(0o755)
    desktop.write_text(
        _DESKTOP.format(launcher=launcher, icon=repo_root / "scripts" / "consola" / "icon.svg"),
        encoding="utf-8",
    )
    return [launcher, desktop]


def uninstall(home: Path) -> list[Path]:
    removed = []
    for path in (home / ".local/bin/consola", home / ".local/share/applications/campo-consola.desktop"):
        if path.exists():
            path.unlink()
            removed.append(path)
    return removed


def _demo_snapshot() -> dict[str, object]:
    return json.loads((ASSETS / "demo-report.json").read_text(encoding="utf-8"))


def _watch_idle(server: ThreadingHTTPServer, state: ConsolaState) -> None:
    while True:
        time.sleep(60)
        if time.monotonic() - state.last_request > IDLE_EXIT_SECONDS:
            server.shutdown()
            return


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    repo_root = Path(__file__).resolve().parents[1]
    if args[:1] == ["install"]:
        for path in install(repo_root, Path.home()):
            print(f"Instalado: {path}")
        print("Ábrela con el comando `consola` o desde el menú de aplicaciones.")
        return 0
    if args[:1] == ["uninstall"]:
        for path in uninstall(Path.home()):
            print(f"Eliminado: {path}")
        return 0

    if already_running(URL):
        open_browser(URL)
        return 0

    fetch = _demo_snapshot if "--demo" in args else fetch_snapshot
    state = ConsolaState(fetch)
    page = (ASSETS / "index.html").read_bytes()
    try:
        server = make_server(state, page)
    except OSError as exc:
        print(f"No pude abrir el puerto {PORT}: {exc}")
        return 1
    threading.Thread(target=_watch_idle, args=(server, state), daemon=True).start()
    print(f"Consola Campo Digital en {URL} (se cierra sola tras 1 h sin uso; Ctrl+C para salir)")
    open_browser(URL)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

`scripts/consola/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0f3b2b"/>
  <path d="M32 12 l16 6 v12 c0 11-7 18-16 22 c-9-4-16-11-16-22 V18 z" fill="#1e8055"/>
  <path d="M24 33 l6 6 l11-13" fill="none" stroke="#e7f1eb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

`Makefile` — add after the forestry targets:

```make
consola:
	python3 scripts/consola.py

consola-demo:
	python3 scripts/consola.py --demo

consola-install:
	python3 scripts/consola.py install

consola-uninstall:
	python3 scripts/consola.py uninstall
```

(and add the four names to `.PHONY` if the Makefile declares one).

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 uv run --all-extras pytest tests/scripts/test_consola.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/consola.py scripts/consola/icon.svg Makefile tests/scripts/test_consola.py
git commit -m "feat(consola): open on Ubuntu/WSL (launcher, app-menu entry, browser, reuse)"
```

---

### Task 8: The page (`scripts/consola/index.html`) — designed, then reviewed

**Files:**
- Create: `scripts/consola/index.html`
- Test: `tests/scripts/test_consola.py` (append a static check)

**Interfaces:**
- Consumes: `GET /api/report` (snapshot shape from Task 6), `GET /api/report?refresh=1`, `/icon.svg`.

- [ ] **Step 1: Append the failing static test**

```python
def test_page_has_every_section_and_no_external_resources() -> None:
    html = (consola.ASSETS / "index.html").read_text(encoding="utf-8")
    for section in ("Alertas", "Actividad", "IPs sospechosas", "Uso por producto", "Salud"):
        assert section in html
    assert "http://" not in html.replace("http://127.0.0.1", "")
    assert "<script src=" not in html and "<link rel=\"stylesheet\"" not in html
```

- [ ] **Step 2: Run to verify it fails**

Run: `NO_COLOR=1 uv run --all-extras pytest tests/scripts/test_consola.py -q -k page`
Expected: FAIL — `FileNotFoundError` for `index.html`.

- [ ] **Step 3: Load the UI skills, then write the page**

Before writing, invoke the `ui-ux-pro-max` skill and run
`python3 ~/.claude/skills/ui-ux-pro-max/scripts/search.py "operations dashboard alerts severity" --domain ux -n 3`
and `... "status chip color not only" --domain ux -n 3`. Apply what fits.

Write `scripts/consola/index.html` with this structure and behaviour (complete file, inline CSS and JS, no external resources):

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Consola Campo Digital</title>
<link rel="icon" href="/icon.svg">
<style>
:root {
  --bg: #f4f5f2; --surface: #ffffff; --surface-2: #eef0ec; --ink: #16211d; --ink-2: #47564f;
  --line: #d9ded8; --accent: #1e7a51; --accent-deep: #0f3b2b; --accent-tint: #e5f1ea;
  --ok: #1e7a51; --ok-tint: #e5f1ea; --warn: #9a6a06; --warn-tint: #fbf0d8;
  --crit: #b23a2b; --crit-tint: #f8e4df; --info: #2f5f8a; --info-tint: #e3edf6;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1714; --surface: #16211c; --surface-2: #1d2a24; --ink: #e6efea; --ink-2: #a5b7ae;
    --line: #2d3c35; --accent: #5fc596; --accent-deep: #b9e6cf; --accent-tint: #1b3229;
    --ok: #5fc596; --ok-tint: #1b3229; --warn: #f1b443; --warn-tint: #3a2d12;
    --crit: #f08473; --crit-tint: #3c201b; --info: #8cb8e0; --info-tint: #1a2836;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--font); }
.wrap { max-width: 1180px; margin: 0 auto; padding: 24px 20px 48px; display: grid; gap: 20px; }
header.top { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; justify-content: space-between;
  background: var(--accent-deep); color: #f2f6f3; border-radius: 14px; padding: 16px 20px; }
@media (prefers-color-scheme: dark) { header.top { background: var(--surface-2); color: var(--ink); } }
.brand { display: flex; align-items: center; gap: 12px; }
.brand img { width: 36px; height: 36px; }
.brand h1 { margin: 0; font-size: 19px; }
.brand p { margin: 0; font-size: 13px; opacity: .8; }
.status { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px;
  font-weight: 700; font-size: 14px; }
.status::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: currentColor; }
.status.ok { background: var(--ok-tint); color: var(--ok); }
.status.warning { background: var(--warn-tint); color: var(--warn); }
.status.critical { background: var(--crit-tint); color: var(--crit); }
.actions { display: flex; align-items: center; gap: 12px; font-size: 13px; }
button.refresh { font: 700 14px var(--font); border: 0; border-radius: 8px; padding: 10px 16px; min-height: 40px;
  background: var(--accent); color: #fff; cursor: pointer; }
button.refresh[disabled] { opacity: .6; cursor: progress; }
button:focus-visible, a:focus-visible { outline: 3px solid var(--warn); outline-offset: 2px; }
.grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 20px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px; min-width: 0; }
.card h2 { margin: 0 0 12px; font-size: 16px; display: flex; justify-content: space-between; align-items: baseline; }
.card h2 small { font-weight: 400; color: var(--ink-2); font-size: 12.5px; }
.span-12 { grid-column: span 12; } .span-7 { grid-column: span 7; } .span-5 { grid-column: span 5; }
@media (max-width: 900px) { .span-7, .span-5 { grid-column: span 12; } }
.alerts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.alert { border-left: 4px solid var(--info); background: var(--info-tint); border-radius: 8px; padding: 12px 14px; }
.alert.warning { border-color: var(--warn); background: var(--warn-tint); }
.alert.critical { border-color: var(--crit); background: var(--crit-tint); }
.alert b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }
.alert .sev { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
.empty { color: var(--ink-2); padding: 14px; border: 1px dashed var(--line); border-radius: 8px; text-align: center; }
.empty.good { color: var(--ok); border-color: var(--ok); background: var(--ok-tint); }
.timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 420px; overflow: auto; }
.timeline li { display: grid; grid-template-columns: 112px 1fr auto; gap: 10px; padding: 8px 6px; border-bottom: 1px solid var(--line); }
.timeline time { font: 12.5px var(--mono); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.chip { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--surface-2); color: var(--ink-2); white-space: nowrap; }
.chip.transelect { background: var(--info-tint); color: var(--info); }
.chip.forestry { background: var(--ok-tint); color: var(--ok); }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); }
th { font-size: 12px; color: var(--ink-2); font-weight: 700; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.ip { font-family: var(--mono); }
.usage { display: grid; gap: 14px; }
.usage-row h3 { margin: 0 0 6px; font-size: 14px; }
.bars { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; align-items: end; height: 84px; }
.bar { display: grid; align-content: end; gap: 3px; text-align: center; font-size: 11px; color: var(--ink-2); }
.bar span.fill { display: block; background: var(--accent); border-radius: 4px 4px 0 0; min-height: 2px; }
.bar b { font-size: 12px; color: var(--ink); font-variant-numeric: tabular-nums; }
.health { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.health a { color: var(--accent); font-weight: 700; text-decoration: none; border: 1px solid var(--line);
  border-radius: 8px; padding: 8px 12px; min-height: 40px; display: inline-flex; align-items: center; }
.banner { border-radius: 10px; padding: 12px 16px; font-weight: 600; }
.banner.error { background: var(--crit-tint); color: var(--crit); }
.banner.demo { background: var(--warn-tint); color: var(--warn); }
.loading { display: inline-block; width: 14px; height: 14px; border: 2px solid currentColor; border-right-color: transparent;
  border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .loading { animation: none; } }
footer { color: var(--ink-2); font-size: 12.5px; text-align: center; }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <img src="/icon.svg" alt="">
      <div><h1>Consola Campo Digital</h1><p>Seguridad y uso · producción</p></div>
    </div>
    <span id="status" class="status ok">Cargando…</span>
    <div class="actions">
      <span id="updated">—</span>
      <button id="refresh" class="refresh" type="button">Actualizar</button>
    </div>
  </header>
  <div id="banner" hidden></div>
  <main class="grid">
    <section class="card span-12" aria-labelledby="h-alerts"><h2 id="h-alerts">Alertas <small>últimas 24 h</small></h2><div id="alerts" class="alerts"></div></section>
    <section class="card span-7" aria-labelledby="h-activity"><h2 id="h-activity">Actividad <small>últimos 7 días</small></h2><ul id="activity" class="timeline"></ul></section>
    <section class="card span-5" aria-labelledby="h-ips"><h2 id="h-ips">IPs sospechosas <small>401 / 403 · 7 días</small></h2><div id="ips"></div></section>
    <section class="card span-7" aria-labelledby="h-usage"><h2 id="h-usage">Uso por producto <small>por día · 7 días</small></h2><div id="usage" class="usage"></div></section>
    <section class="card span-5" aria-labelledby="h-health"><h2 id="h-health">Salud</h2><div id="health" class="health"></div></section>
  </main>
  <footer>Datos de solo lectura, en memoria en este equipo. Se cierra sola tras 1 h sin uso.</footer>
</div>
<script>
const ACTIONS = {
  "session.created": "inició sesión", "upload.completed": "subió una planilla", "import.validated": "validó una importación",
  "import.published": "publicó una versión", "import.restored": "restauró una versión", "import.validation.failed": "validación fallida",
  "forestry.snapshot.uploaded": "subió una versión de Rodales", "forestry.snapshot.published": "publicó Rodales",
  "forestry.snapshot.restored": "restauró Rodales", "transelec.override.saved": "editó un dato",
  "transelec.export.xlsx_downloaded": "descargó el Excel", "product_grant.changed": "cambió permisos"
};
const PRODUCTS = { transelect: "Transelec", forestry: "Rodales", platform: "Plataforma" };
const CATEGORIES = { sign_in: "Inicios de sesión", upload: "Cargas", validation: "Validaciones", publish: "Publicaciones", edit: "Ediciones" };
const SEVERITY = { critical: "Crítica", warning: "Atención", info: "Info" };
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === "class" ? (node.className = v) : node.setAttribute(k, v);
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c ?? "")));
  return node;
};
const when = (iso) => iso ? new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function renderAlerts(alerts) {
  const box = $("alerts"); box.replaceChildren();
  if (!alerts.length) { box.append(el("div", { class: "empty good" }, "Sin alertas en las últimas 24 h")); return; }
  for (const a of alerts) box.append(el("article", { class: `alert ${a.severity}` },
    el("span", { class: "sev" }, SEVERITY[a.severity] || a.severity), el("b", {}, a.count), a.message));
}
function renderActivity(rows) {
  const list = $("activity"); list.replaceChildren();
  if (!rows.length) { list.append(el("li", { class: "empty" }, "Sin actividad en 7 días")); return; }
  for (const r of rows) list.append(el("li", {},
    el("time", { datetime: r.at }, when(r.at)),
    el("span", {}, el("b", {}, r.actor), " ", ACTIONS[r.event_type] || r.event_type),
    el("span", { class: `chip ${r.product || "platform"}` }, PRODUCTS[r.product || "platform"] || r.product)));
}
function renderIps(rows) {
  const box = $("ips"); box.replaceChildren();
  if (!rows.length) { box.append(el("div", { class: "empty good" }, "Ninguna IP con rechazos en 7 días")); return; }
  const body = el("tbody");
  for (const r of rows) body.append(el("tr", {}, el("td", { class: "ip" }, r.ip), el("td", { class: "num" }, r.unauthorized),
    el("td", { class: "num" }, r.forbidden), el("td", {}, when(r.last_seen))));
  box.append(el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "IP"), el("th", {}, "401"), el("th", {}, "403"), el("th", {}, "Última vez"))), body));
}
function renderUsage(rows) {
  const box = $("usage"); box.replaceChildren();
  if (!rows.length) { box.append(el("div", { class: "empty" }, "Sin uso registrado en 7 días")); return; }
  const days = [...new Set(rows.map((r) => r.day))].sort().slice(-7);
  const products = [...new Set(rows.map((r) => r.product))];
  for (const product of products) {
    const totals = days.map((d) => rows.filter((r) => r.product === product && r.day === d).reduce((s, r) => s + r.count, 0));
    const max = Math.max(1, ...totals);
    const cats = [...new Set(rows.filter((r) => r.product === product).map((r) => CATEGORIES[r.category] || r.category))].join(" · ");
    const bars = el("div", { class: "bars", role: "img", "aria-label": `${PRODUCTS[product] || product}: ${totals.join(", ")} por día` });
    days.forEach((d, i) => bars.append(el("div", { class: "bar" }, el("b", {}, totals[i]),
      Object.assign(el("span", { class: "fill" }), { style: `height:${Math.round((totals[i] / max) * 56)}px` }), d.slice(5))));
    box.append(el("div", { class: "usage-row" }, el("h3", {}, `${PRODUCTS[product] || product} `, el("span", { class: "chip" }, cats)), bars));
  }
}
function renderHealth(deployments) {
  const box = $("health"); box.replaceChildren();
  const d = deployments[0];
  if (d) {
    const tone = d.status === "SUCCESS" ? "ok" : (d.status === "FAILED" || d.status === "CRASHED") ? "critical" : "warning";
    box.append(el("span", { class: `status ${tone}` }, d.status), el("span", {}, `Deploy ${d.id} · commit ${d.commit} · ${when(d.created_at)}`));
  } else box.append(el("span", { class: "empty" }, "Sin datos de Railway"));
  box.append(el("a", { href: "https://origenlab.sentry.io/issues/", target: "_blank", rel: "noreferrer" }, "Errores en Sentry"),
             el("a", { href: "https://railway.com/dashboard", target: "_blank", rel: "noreferrer" }, "Railway"));
}
function setStatus(alerts, error) {
  const s = $("status");
  if (error) { s.className = "status critical"; s.textContent = "Sin datos"; return; }
  const crit = alerts.some((a) => a.severity === "critical"), warn = alerts.length > 0;
  s.className = `status ${crit ? "critical" : warn ? "warning" : "ok"}`;
  s.textContent = warn ? `${alerts.length} alerta${alerts.length > 1 ? "s" : ""}` : "Todo normal";
}
async function load(refresh) {
  const btn = $("refresh"); btn.disabled = true; btn.replaceChildren(el("span", { class: "loading", "aria-hidden": "true" }), " Consultando producción…");
  try {
    const res = await fetch(`/api/report${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
    const snap = await res.json();
    const banner = $("banner");
    if (snap.error) { banner.hidden = false; banner.className = "banner error"; banner.textContent = snap.error; }
    else if (snap.demo) { banner.hidden = false; banner.className = "banner demo"; banner.textContent = "Datos de demostración, no son de producción."; }
    else banner.hidden = true;
    const r = snap.report || { alerts: [], activity: [], suspicious_ips: [], usage: [] };
    renderAlerts(r.alerts); renderActivity(r.activity); renderIps(r.suspicious_ips); renderUsage(r.usage);
    renderHealth(snap.deployments || []); setStatus(r.alerts, snap.error);
    $("updated").textContent = `Actualizado ${when(snap.fetched_at)}`;
  } catch (e) {
    $("banner").hidden = false; $("banner").className = "banner error"; $("banner").textContent = "La Consola local no respondió. ¿Sigue abierta la terminal?";
  } finally { btn.disabled = false; btn.textContent = "Actualizar"; }
}
$("refresh").addEventListener("click", () => load(true));
load(false);
</script>
</body>
</html>
```

If the Sentry project URL differs, use the project's issues URL (`https://origenlab.sentry.io/issues/?project=<id>`); the org slug is `origenlab`.

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 uv run --all-extras pytest tests/scripts/test_consola.py -q` → PASS.

- [ ] **Step 5: Visual review in a browser**

Run `python3 scripts/consola.py --demo` (or `make consola-demo`), then with the `playwright-cli` skill open `http://127.0.0.1:8787/`, take screenshots at 1440×900 and 420×900, and once with dark mode emulated. Check: status chip, alert cards with severity stripe, timeline, IP table, per-product bars to scale with numbers, health chip, demo banner, focus outline on "Actualizar" (Tab), no horizontal scroll at 420 px. Fix what looks wrong once; then temporarily make the demo fetch return `{"report": null, "deployments": [], "fetched_at": "...", "error": "Railway no tiene sesión iniciada. Corre: railway login"}` and confirm the error banner and "Sin datos" chip. Run the `web-design-guidelines` skill on `index.html` and apply its findings. Stop the server (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add scripts/consola/index.html tests/scripts/test_consola.py
git commit -m "feat(consola): designed page (alerts, activity, IPs, usage, health)"
```

---

### Task 9: Docs, full checks, PR, deploy, live verification

**Files:**
- Modify: `products/transelect/docs/deployment.md` (new section after "Server-error reporting (Sentry)")

- [ ] **Step 1: Write the runbook section**

Add `### Security events and the Consola` covering: what `platform.security_event` records and never records; the 4 event types and reason codes; 401 aggregation and buffer cap; 90-day purge; how the client IP is resolved (and that it was verified live, Step 5); how to run `make consola`, `make consola-demo`, `make consola-install` / `consola-uninstall`, the `consola` command and the app-menu entry; that the Consola needs `railway login` and binds to `127.0.0.1:8787`; LIMITATION lines from the spec (railway ssh dependency, IPs are personal data, single-replica assumption).

- [ ] **Step 2: Run every check**

```bash
export NO_COLOR=1
uv sync --all-extras
uv run ruff format --check . && uv run ruff check . && uv run mypy .
uv run pytest -q
make architecture-check docs-check
./scripts/check_secrets.sh
./scripts/check_dependency_vulnerabilities.sh
make persistence-check   # only if port 5433 is free; it resets the shared test DB
```

Expected: all clean. Fix and re-run if not.

- [ ] **Step 3: Commit, push, open the PR**

```bash
git add products/transelect/docs/deployment.md
git commit -m "docs: security events and the Consola runbook"
git push -u origin feat/platform-consola
gh pr create --base main --title "feat(platform): security events + local Consola" --body "<summary of tasks 1-8, tests, privacy guarantees; ends with the Claude Code line>"
```

Wait for CI (`gh pr checks <n> --watch`). Merge only when the operator says so.

- [ ] **Step 4: Deploy (after merge, operator's go)**

`railway redeploy --from-source --service campo-digital-platform -y`, wait for `SUCCESS`. The pre-deploy runs `alembic upgrade head` (0012 → 0013). Verify: `/ready` 200, `/transelec/` and `/rodales/` 200, API 401 signed out; `railway logs -d` shows no errors.

- [ ] **Step 5: Verify the client IP live (resolves the spec's OPEN QUESTION)**

From this machine: `curl -s -o /dev/null https://campo-digital-platform-production.up.railway.app/api/transelec/summary` three times. Wait just over a minute for the flush. Then read the newest `auth.required` row through `railway ssh` (`cd /app/apps/api && /app/.venv/bin/python -c ...` selecting `host(client_ip), count, path`) and compare with this machine's public IP (`curl -s https://ifconfig.me`) and with `railway logs --http --json -n 5` (`srcIp`). If `client_ip` is a `100.64.x.x` address or does not match, check Railway's documentation for the forwarding header its edge sets (for example `X-Real-IP` or `X-Forwarded-For`) and its order, adjust `client_ip` with a unit test for that header, and redeploy. Do not add temporary header logging to production. Record the result as a FACT in the runbook section.

- [ ] **Step 6: First real run of the Consola**

`make consola-install`, then run `consola`. Confirm the page loads production data, the status chip, the health section shows the new deployment, and the alert you just caused appears under "IPs sospechosas" only if it exceeds the rules (3 requests will show in the table, not as an alert). Check the "Consola Campo Digital" entry in the Ubuntu applications menu / Windows Start menu (WSLg); if WSLg does not list user-level entries, record that as a LIMITATION and keep the `consola` command as the primary path.
