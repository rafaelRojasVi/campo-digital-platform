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

from sqlalchemy import Connection, Engine, text

from app.conaf import ConafBusyError, ConafLookup
from app.conaf_store import (
    collect_known_numbers,
    due_numbers,
    finish_run,
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


def already_ran_today(connection: Connection, now: datetime) -> bool:
    """A run that *finished* and started today in Chile (a killed run does not count)."""

    started = connection.execute(
        text(
            "SELECT started_at FROM platform.conaf_run WHERE finished_at IS NOT NULL "
            "ORDER BY started_at DESC, id DESC LIMIT 1"
        )
    ).scalar_one_or_none()
    return started is not None and not should_run_now(now, started)


def refresh_due(
    engine: Engine,
    client: Lookup,
    *,
    now: datetime,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    collect: Callable[[Connection], list[str]] = collect_known_numbers,
    limit: int = MAX_PER_RUN,
    should_stop: Callable[[], bool] = lambda: False,
) -> RunSummary:
    summary = RunSummary()
    with engine.begin() as connection:
        due = due_numbers(connection, collect(connection), now=now)
        run_id = start_run(connection, now=now, due=len(due))

    streak = 0
    try:
        for numero in due[:limit]:
            if should_stop():
                summary.stopped_reason = "shutdown"
                break
            summary.counts["checked"] += 1
            try:
                lookup = client.lookup(numero)
                with engine.begin() as connection:
                    _, changed = save_lookup(connection, lookup, now=clock())
            except ConafBusyError:
                # An interactive lookup is running; this number waits for tomorrow.
                summary.counts["unavailable"] += 1
                continue
            except Exception as exc:  # noqa: BLE001 - one bad row must not end the night
                logger.warning("CONAF refresh skipped a number (%s)", type(exc).__name__)
                summary.counts["unavailable"] += 1
                continue
            summary.counts[lookup.status] += 1
            summary.counts["changed"] += int(changed)
            streak = streak + 1 if lookup.status == "unavailable" else 0
            if streak >= STOP_AFTER_UNAVAILABLE:
                summary.stopped_reason = "conaf_unavailable"
                break
        if summary.stopped_reason is None and len(due) > limit:
            summary.stopped_reason = "limit"
    finally:
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


def _run_if_due(
    engine: Engine, client: Lookup, now: datetime, should_stop: Callable[[], bool]
) -> None:
    if now.astimezone(CHILE).hour < RUN_AFTER_HOUR:
        return
    with engine.connect() as connection:
        if already_ran_today(connection, now):
            return
    refresh_due(engine, client, now=now, should_stop=should_stop)


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
            await asyncio.to_thread(_run_if_due, engine_factory(), client, clock(), stop.is_set)
        except Exception as exc:  # noqa: BLE001 - logged; the app keeps serving
            logger.warning("CONAF refresh failed (%s)", type(exc).__name__)
