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
              coalesce(sum(count) FILTER (WHERE event_type = 'sign_in.rejected'), 0)
                AS sign_in_rejected,
              coalesce(sum(count) FILTER (WHERE reason = 'domain_not_allowed'), 0)
                AS domain_not_allowed,
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
        (
            "sign_in_rejected",
            "warning",
            counts.sign_in_rejected,
            "{n} inicios de sesión rechazados en 24 h",
        ),
        (
            "domain_not_allowed",
            "critical",
            counts.domain_not_allowed,
            "{n} intentos con cuentas fuera de Campo Digital",
        ),
        (
            "auth_burst",
            "critical",
            burst_ips,
            "{n} IP con más de 60 solicitudes sin sesión en un minuto",
        ),
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

    activity = (
        connection.execute(
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
        )
        .mappings()
        .all()
    )

    suspicious = (
        connection.execute(
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
        )
        .mappings()
        .all()
    )

    usage = (
        connection.execute(
            text(
                """
            SELECT day, product, category, count(*) AS count FROM (
              SELECT (occurred_at AT TIME ZONE 'America/Santiago')::date AS day,
                     coalesce(product_key, 'platform') AS product,
                     CASE
                       WHEN event_type = 'session.created' THEN 'sign_in'
                       WHEN event_type IN ('upload.completed', 'forestry.snapshot.uploaded')
                         THEN 'upload'
                       WHEN event_type = 'import.validated' THEN 'validation'
                       WHEN event_type IN ('import.published', 'import.restored',
                                           'forestry.snapshot.published',
                                           'forestry.snapshot.restored')
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
        )
        .mappings()
        .all()
    )

    def rows(result: Any) -> list[dict[str, Any]]:
        return [{key: _iso(value) for key, value in row.items()} for row in result]

    return {
        "generated_at": now.isoformat(),
        "read_only": read_only,
        "alerts": _alerts(connection, day_ago),
        "activity": rows(activity),
        "suspicious_ips": [
            {
                **row,
                "total": int(row["total"]),
                "unauthorized": int(row["unauthorized"]),
                "forbidden": int(row["forbidden"]),
            }
            for row in rows(suspicious)
        ],
        "usage": [{**row, "count": int(row["count"])} for row in rows(usage)],
    }


def export_json(engine: Engine, *, now: datetime) -> str:
    with engine.connect() as connection, connection.begin():
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
