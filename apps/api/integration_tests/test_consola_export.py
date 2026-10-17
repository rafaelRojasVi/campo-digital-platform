"""The Consola export: shape, alert rules, privacy, read-only transaction."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from app.access_repository import resolve_or_create_app_user
from app.audit import record_audit_event
from app.consola_export import build_report, export_json
from sqlalchemy import Connection, Engine, text

NOW = datetime(2026, 10, 15, 15, 0, tzinfo=UTC)


def _event(connection: Connection, **values: object) -> None:
    row = {
        "product_key": None,
        "actor_app_user_id": None,
        "client_ip": None,
        "count": 1,
        "reason": None,
        **values,
    }
    connection.execute(
        text(
            """
            INSERT INTO platform.security_event
                (occurred_at, event_type, product_key, actor_app_user_id, client_ip,
                 path, http_status, count, reason)
            VALUES (:occurred_at, :event_type, :product_key, :actor_app_user_id,
                    CAST(:client_ip AS inet), :path, :http_status, :count, :reason)
            """
        ),
        row,
    )


def test_report_alerts_activity_ips_and_usage(integration_connection: Connection) -> None:
    c = integration_connection
    user = resolve_or_create_app_user(
        c,
        identity_kind="dev-local",
        identity_key="ana",
        display_name="Ana Prueba",
        email="ana@example.cl",
    )
    recent = NOW - timedelta(hours=2)
    for _ in range(3):
        _event(
            c,
            occurred_at=recent,
            event_type="sign_in.rejected",
            path="/api/auth/google/callback",
            http_status=400,
            reason="flow_cookie_missing",
        )
    _event(
        c,
        occurred_at=recent,
        event_type="sign_in.rejected",
        path="/api/auth/google/callback",
        http_status=401,
        reason="domain_not_allowed",
    )
    _event(
        c,
        occurred_at=recent,
        event_type="auth.required",
        path="/api/transelec/summary",
        http_status=401,
        client_ip="200.1.2.3",
        count=120,
    )
    _event(
        c,
        occurred_at=NOW - timedelta(days=30),
        event_type="csrf.rejected",
        path="/old",
        http_status=403,
        reason="token_invalid",
    )
    c.execute(
        text("UPDATE platform.audit_event SET occurred_at = :at WHERE id = :id"),
        {
            "at": recent,
            "id": record_audit_event(c, actor_app_user_id=user.id, event_type="session.created"),
        },
    )
    c.execute(
        text("UPDATE platform.audit_event SET occurred_at = :at WHERE id = :id"),
        {
            "at": recent,
            "id": record_audit_event(
                c,
                actor_app_user_id=user.id,
                event_type="import.published",
                product_key="transelect",
                subject_id="5",
            ),
        },
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
    assert set(report) == {
        "generated_at",
        "read_only",
        "alerts",
        "activity",
        "suspicious_ips",
        "usage",
        "conaf",
    }


def test_burst_alert_sums_paths_and_split_flushes_per_ip_minute(
    integration_connection: Connection,
) -> None:
    c = integration_connection
    minute = NOW - timedelta(hours=1)
    # One scanner: 40 + 30 on two paths in the same minute (two flush rows).
    for path, count in (("/runs/a", 40), ("/runs/b", 30)):
        _event(
            c,
            occurred_at=minute,
            event_type="auth.required",
            path=path,
            http_status=401,
            client_ip="203.0.113.9",
            count=count,
        )
    # Below the threshold: another IP with 50 in one minute.
    _event(
        c,
        occurred_at=minute,
        event_type="auth.required",
        path="/x",
        http_status=401,
        client_ip="203.0.113.10",
        count=50,
    )

    codes = {alert["code"]: alert for alert in build_report(c, now=NOW)["alerts"]}
    assert codes["auth_burst"]["count"] == 1


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
            "INSERT INTO platform.conaf_solicitud "
            "(numero, lookup_status, estado, checked_at, found_at) "
            "VALUES ('090663', 'found', 'APROBADA', :old, :old)"
        ),
        {"old": NOW - timedelta(days=4)},
    )
    report = build_report(integration_connection, now=NOW)
    assert report["conaf"]["last_run"]["stopped_reason"] == "conaf_unavailable"
    assert report["conaf"]["stale_numbers"] == 1
    assert "conaf_down" in [alert["code"] for alert in report["alerts"]]
