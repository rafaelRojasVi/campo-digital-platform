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
