"""Rodales management reports over HTTP: roles, CSRF, the review flow and exports."""

from __future__ import annotations

import io
import zipfile
from collections.abc import Generator
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
import shapefile
from app.access import Role
from app.access_repository import grant_product_role, resolve_or_create_app_user
from app.csrf import CSRF_HEADER_NAME
from app.deps import SESSION_COOKIE_NAME
from app.forestry_report_geometry import MESSAGES
from app.main import app
from app.session_store import PlatformSessionStore
from fastapi.testclient import TestClient
from forestry_report_fixtures import seed_published_base, square_geojson
from httpx import Response
from sqlalchemy import Engine, text

_sessions = PlatformSessionStore()
_ORIGIN = {"Origin": "http://testserver"}


@pytest.fixture
def client(integration_engine: Engine) -> Generator[TestClient, None, None]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _isolated_tables(integration_engine: Engine) -> Generator[None, None, None]:
    yield
    with integration_engine.begin() as connection:
        connection.execute(
            text("UPDATE forestry.publication_state SET published_snapshot_id = NULL")
        )
        for table in (
            "forestry.report_note",
            "forestry.report_feature",
            "forestry.report",
            "forestry.publication_event",
            "forestry.snapshot_upload",
            "forestry.source_feature",
            "forestry.shapefile_snapshot",
            "platform.source_observation",
            "platform.source_snapshot",
            "platform.source_asset",
            "platform.source_system",
            "platform.audit_event",
            "platform.security_event",
            "platform.session",
            "platform.product_grant",
            "platform.app_user",
        ):
            connection.execute(text(f"DELETE FROM {table}"))


@pytest.fixture
def base(integration_engine: Engine, tmp_path: Path) -> int:
    with integration_engine.begin() as connection:
        return seed_published_base(connection, tmp_path)


def sign_in(client: TestClient, engine: Engine, name: str, role: Role | None) -> None:
    with engine.begin() as connection:
        user = resolve_or_create_app_user(
            connection,
            identity_kind="google",
            identity_key=f"sub-{name}",
            display_name=name,
            email=f"{name}@campodigital.cl",
        )
        if role is not None:
            grant_product_role(connection, app_user_id=user.id, product_key="forestry", role=role)
        secret = _sessions.create_session(connection, app_user_id=user.id, ttl=timedelta(hours=1))
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, secret)
    client.headers.pop(CSRF_HEADER_NAME, None)
    token = client.get("/api/auth/csrf")
    assert token.status_code == 200, token.text
    client.headers[CSRF_HEADER_NAME] = token.json()["csrf_token"]


def create(client: TestClient, name: str = "Cosecha pino enero 2027") -> int:
    response = client.post(
        "/api/forestry/reports",
        json={"name": name, "report_type": "cosecha", "report_date": "2027-01-15"},
        headers=_ORIGIN,
    )
    assert response.status_code == 201, response.text
    return int(response.json()["report_id"])


SPLIT: list[dict[str, Any]] = [
    {
        "source_feature_ordinal": 1,
        "in_report": True,
        "attributes": {"n_rodal": "17-1"},
        "geometry": square_geojson(0, 0, 60, 100),
    },
    {"source_feature_ordinal": 1, "in_report": False, "geometry": square_geojson(60, 0, 40, 100)},
    {"source_feature_ordinal": 2, "in_report": False, "geometry": None},
]


def save(
    client: TestClient, report_id: int, revision: int, features: list[dict[str, Any]]
) -> Response:
    return client.put(
        "/api/forestry/reports/features",
        json={"report_id": report_id, "revision": revision, "features": features},
        headers=_ORIGIN,
    )


def act(
    client: TestClient, report_id: int, action: str, revision: int, note: str | None = None
) -> Response:
    return client.post(
        f"/api/forestry/reports/{report_id}/{action}",
        json={"revision": revision, "note": note},
        headers=_ORIGIN,
    )


def audit_types(engine: Engine) -> list[str]:
    # Other test modules may leave their own audit rows; look at report events only.
    with engine.connect() as connection:
        return list(
            connection.execute(
                text(
                    "SELECT event_type FROM platform.audit_event "
                    "WHERE event_type LIKE 'forestry.report.%' ORDER BY id"
                )
            ).scalars()
        )


def test_full_flow_from_draft_to_approved_export(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    saved = save(client, report_id, 1, SPLIT)
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 2
    assert act(client, report_id, "submit", 2).status_code == 200

    sign_in(client, integration_engine, "javier", Role.ADMIN)
    listing = client.get("/api/forestry/reports").json()
    assert listing["pending_review_count"] == 1
    detail = client.get(f"/api/forestry/reports/{report_id}").json()
    assert detail["report"]["status"] == "enviado"
    assert detail["srid"] == 32718
    assert [f["attributes"]["n_rodal"] for f in detail["features"]] == ["17-1", "17", "18"]
    assert sorted(s["source_feature_ordinal"] for s in detail["sources"]) == [1, 2]
    changes = act(client, report_id, "request-changes", 3, "Saca el rodal 18.")
    assert changes.status_code == 200, changes.text

    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    assert save(client, report_id, 4, SPLIT[:2]).status_code == 200
    assert act(client, report_id, "submit", 5).status_code == 200

    sign_in(client, integration_engine, "javier", Role.ADMIN)
    approved = act(client, report_id, "approve", 6)
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "aprobado"

    sign_in(client, integration_engine, "dueno", Role.VIEWER)
    assert [r["report_id"] for r in client.get("/api/forestry/reports").json()["reports"]] == [
        report_id
    ]
    exported = client.get(f"/api/forestry/reports/{report_id}/export?format=shp")
    assert exported.status_code == 200
    assert exported.headers["content-type"] == "application/zip"
    assert 'filename="Cosecha_pino_enero_2027.zip"' in exported.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        reader = shapefile.Reader(
            shp=io.BytesIO(archive.read("Cosecha_pino_enero_2027.shp")),
            shx=io.BytesIO(archive.read("Cosecha_pino_enero_2027.shx")),
            dbf=io.BytesIO(archive.read("Cosecha_pino_enero_2027.dbf")),
            encoding="utf-8",
        )
        records = [record.as_dict() for record in reader.records()]
    assert [(r["N_Rodal"], r["EN_INFORME"], r["ESTADO"]) for r in records] == [
        ("17-1", "si", "Aprobado"),
        ("17", "no", "Aprobado"),
    ]

    assert audit_types(integration_engine) == [
        "forestry.report.created",
        "forestry.report.saved",
        "forestry.report.submitted",
        "forestry.report.changes_requested",
        "forestry.report.saved",
        "forestry.report.submitted",
        "forestry.report.approved",
        "forestry.report.exported",
    ]


def test_viewer_cannot_see_or_export_a_draft(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    sign_in(client, integration_engine, "dueno", Role.VIEWER)
    assert client.get("/api/forestry/reports").json()["reports"] == []
    assert client.get(f"/api/forestry/reports/{report_id}").status_code == 404
    assert client.get(f"/api/forestry/reports/{report_id}/export?format=csv").status_code == 404


def test_viewer_cannot_create_and_operator_cannot_approve(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "dueno", Role.VIEWER)
    refused = client.post(
        "/api/forestry/reports",
        json={"name": "X", "report_type": "cosecha", "report_date": "2027-01-15"},
        headers=_ORIGIN,
    )
    assert refused.status_code == 403
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    save(client, report_id, 1, SPLIT)
    act(client, report_id, "submit", 2)
    assert act(client, report_id, "approve", 3).status_code == 403
    assert act(client, report_id, "archive", 3).status_code == 403


def test_no_grant_and_no_session(client: TestClient, integration_engine: Engine, base: int) -> None:
    client.cookies.clear()
    assert client.get("/api/forestry/reports").status_code == 401
    sign_in(client, integration_engine, "otro", None)
    assert client.get("/api/forestry/reports").status_code == 403


def test_writes_need_csrf(client: TestClient, integration_engine: Engine, base: int) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    client.headers.pop(CSRF_HEADER_NAME)
    response = client.post(
        "/api/forestry/reports",
        json={"name": "X", "report_type": "cosecha", "report_date": "2027-01-15"},
        headers=_ORIGIN,
    )
    assert response.status_code == 403


def test_validation_errors_carry_a_code_and_the_polygon(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    response = save(client, report_id, 1, SPLIT[:1])
    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "split_coverage",
        "message": MESSAGES["split_coverage"],
        "source_feature_ordinal": 1,
    }


def test_stale_revision_is_a_conflict(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    assert save(client, report_id, 1, []).status_code == 200
    stale = save(client, report_id, 1, [])
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "stale_revision"


def test_warnings_are_returned_on_save(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    response = save(
        client, report_id, 1, [{"source_feature_ordinal": 4, "in_report": True, "geometry": None}]
    )
    assert response.status_code == 200
    assert [w["code"] for w in response.json()["warnings"]] == ["invalid_source_carried"]


def test_source_polygons_in_utm_for_the_editor(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    response = client.get(f"/api/forestry/reports/{report_id}/source-polygons?ordinals=1,3")
    assert response.status_code == 200
    polygons = response.json()["sources"]
    assert [p["source_feature_ordinal"] for p in polygons] == [1, 3]
    exterior = polygons[0]["geometry"]["coordinates"][0][0]  # MultiPolygon -> polygon -> ring
    assert max(point[0] for point in exterior) == 100.0  # metres, not degrees


def test_patch_duplicate_archive_and_delete(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    patched = client.patch(
        f"/api/forestry/reports/{report_id}", json={"revision": 1, "name": "Raleo"}, headers=_ORIGIN
    )
    assert patched.status_code == 200 and patched.json()["revision"] == 2
    copy = client.post(f"/api/forestry/reports/{report_id}/duplicate", headers=_ORIGIN)
    assert copy.status_code == 201
    copy_id = copy.json()["report_id"]
    assert client.delete(f"/api/forestry/reports/{copy_id}", headers=_ORIGIN).status_code == 204
    save(client, report_id, 2, SPLIT)
    act(client, report_id, "submit", 3)
    refused = client.delete(f"/api/forestry/reports/{report_id}", headers=_ORIGIN)
    assert refused.status_code == 409
    sign_in(client, integration_engine, "javier", Role.ADMIN)
    assert act(client, report_id, "archive", 4).json()["status"] == "archivado"


def test_gpkg_and_csv_exports_and_marked_scope(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    save(client, report_id, 1, SPLIT)
    gpkg = client.get(f"/api/forestry/reports/{report_id}/export?format=gpkg")
    assert gpkg.status_code == 200 and gpkg.content[:16] == b"SQLite format 3\x00"
    marked = client.get(f"/api/forestry/reports/{report_id}/export?format=csv&scope=marked")
    lines = marked.content.decode("utf-8-sig").strip().split("\r\n")
    assert len(lines) == 2  # header + the one marked piece


def test_audit_and_exports_carry_no_email(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    save(client, report_id, 1, SPLIT)
    for fmt in ("shp", "gpkg", "csv"):
        content = client.get(f"/api/forestry/reports/{report_id}/export?format={fmt}").content
        assert b"campodigital.cl" not in content  # geometry bytes may contain 0x40
    with integration_engine.connect() as connection:
        metadata = (
            connection.execute(text("SELECT metadata::text FROM platform.audit_event"))
            .scalars()
            .all()
        )
    assert all("@" not in value for value in metadata)


def test_save_body_over_the_limit_is_refused(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    response = client.put(
        "/api/forestry/reports/features",
        content=b"{" + b" " * (8 * 1024 * 1024 + 1) + b"}",
        headers={**_ORIGIN, "Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_save_route_accepts_bodies_over_the_default_limit(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    # Every other JSON route stops at 1 MiB; the save route raises its own bound.
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    padding = " " * (2 * 1024 * 1024)
    body = f'{{"report_id": {report_id}, "revision": 1, "features": []{padding}}}'
    response = client.put(
        "/api/forestry/reports/features",
        content=body.encode(),
        headers={**_ORIGIN, "Content-Type": "application/json"},
    )
    assert response.status_code == 200, response.text


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
        json={"revision": 2, "conaf_solicitud": "12/34-5-26"},  # a typo, not a number
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
    # CONAF's own slashed numbers are accepted as written (2026-10-18).
    slashed = client.patch(
        f"/api/forestry/reports/{report_id}",
        json={"revision": 4, "conaf_solicitud": "12/345-6/24"},
        headers=_ORIGIN,
    )
    assert slashed.status_code == 200, slashed.text
    assert (
        client.get(f"/api/forestry/reports/{report_id}").json()["report"]["conaf_solicitud"]
        == "12/345-6/24"
    )


def test_conaf_number_can_be_added_after_approval_but_not_when_archived(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    # The solicitud number exists only once the plan is filed, after approval.
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    save(client, report_id, 1, SPLIT)
    act(client, report_id, "submit", 2)
    sign_in(client, integration_engine, "javier", Role.ADMIN)
    assert act(client, report_id, "approve", 3).status_code == 200

    def revision() -> int:
        return int(client.get(f"/api/forestry/reports/{report_id}").json()["report"]["revision"])

    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    numbered = client.patch(
        f"/api/forestry/reports/{report_id}",
        json={"revision": revision(), "conaf_solicitud": "90663"},
        headers=_ORIGIN,
    )
    assert numbered.status_code == 200, numbered.text
    detail = client.get(f"/api/forestry/reports/{report_id}").json()["report"]
    assert detail["conaf_solicitud"] == "090663"
    assert detail["status"] == "aprobado"
    renamed = client.patch(
        f"/api/forestry/reports/{report_id}",
        json={"revision": revision(), "name": "Otro"},
        headers=_ORIGIN,
    )
    assert renamed.json()["detail"]["code"] == "not_editable"

    sign_in(client, integration_engine, "javier", Role.ADMIN)
    assert act(client, report_id, "archive", revision()).status_code == 200
    archived = client.patch(
        f"/api/forestry/reports/{report_id}",
        json={"revision": revision(), "conaf_solicitud": None},
        headers=_ORIGIN,
    )
    assert archived.json()["detail"]["code"] == "not_editable"


def test_report_date_is_stored_derived_and_returned(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    # Create with an exact date; month is derived server-side.
    response = client.post(
        "/api/forestry/reports",
        json={"name": "Fecha test", "report_type": "cosecha", "report_date": "2027-03-04"},
        headers=_ORIGIN,
    )
    assert response.status_code == 201, response.text
    report_id = response.json()["report_id"]
    detail = client.get(f"/api/forestry/reports/{report_id}").json()["report"]
    assert detail["report_date"] == "2027-03-04"
    assert detail["report_month"] == "2027-03"


def test_invalid_date_is_rejected(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    bad = client.post(
        "/api/forestry/reports",
        json={"name": "X", "report_type": "cosecha", "report_date": "2027-02-30"},
        headers=_ORIGIN,
    )
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "invalid_date"


def test_patch_report_date_updates_month(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    report_id = create(client)
    patched = client.patch(
        f"/api/forestry/reports/{report_id}",
        json={"revision": 1, "report_date": "2026-11-30"},
        headers=_ORIGIN,
    )
    assert patched.status_code == 200, patched.text
    detail = client.get(f"/api/forestry/reports/{report_id}").json()["report"]
    assert detail["report_date"] == "2026-11-30"
    assert detail["report_month"] == "2026-11"


def test_export_fecha_contains_iso_date(
    client: TestClient, integration_engine: Engine, base: int
) -> None:
    import io
    import zipfile as _zipfile

    import shapefile as _shp

    sign_in(client, integration_engine, "marco", Role.OPERATOR)
    # Create with exact date 2027-01-15.
    report_id = create(client)
    save(client, report_id, 1, SPLIT[:2])
    exported = client.get(f"/api/forestry/reports/{report_id}/export?format=shp")
    assert exported.status_code == 200
    slug = "Cosecha_pino_enero_2027"
    with _zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        reader = _shp.Reader(
            shp=io.BytesIO(archive.read(f"{slug}.shp")),
            shx=io.BytesIO(archive.read(f"{slug}.shx")),
            dbf=io.BytesIO(archive.read(f"{slug}.dbf")),
            encoding="utf-8",
        )
        records = [record.as_dict() for record in reader.records()]
    assert all(r["FECHA"] == "2027-01-15" for r in records)
