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
