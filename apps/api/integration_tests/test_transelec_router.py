"""Transelec mutations end-to-end: lifecycle, RBAC, CSRF, audit, isolation.

Exercises the full four-step path against real PostgreSQL — upload →
validate-and-project → publish → restore — plus the separations the design
depends on: Step B commits without activating, publish is never automatic,
and a failed Step B rolls back completely while leaving the active version
byte-identical.

All fixture workbooks are synthetic and built here. None reproduces the
reviewed 14-Aug snapshot's 729/159/272 counts.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from collections.abc import Generator
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
import xlsxwriter
from app.access import Role
from app.access_repository import (
    grant_product_role,
    list_grants_for_user,
    resolve_or_create_app_user,
)
from app.csrf import CSRF_HEADER_NAME
from app.deps import SESSION_COOKIE_NAME, get_object_store
from app.dev_auth import DEFAULT_SEED_GRANTS, DEV_IDENTITY_KIND, SEEDED_DEV_IDENTITIES
from app.main import app
from app.object_store import LocalObjectStore
from app.session_store import PlatformSessionStore
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import Engine, text
from sqlalchemy.exc import DataError

from transelec_ingestion import import_projection
from transelec_ingestion.xlsx_contract import EXPECTED_RESUMEN_HEADERS, RESUMEN_COLUMNS

_platform_sessions = PlatformSessionStore()

_SAME_ORIGIN = "http://testserver"
_ATTACKER_ORIGIN = "https://evil.example"

MUTATION_ROUTES = (
    ("/transelec/uploads", "upload"),
    ("/transelec/imports/1/validate-and-project", "plain"),
    ("/transelec/imports/1/publish", "plain"),
    ("/transelec/imports/1/restore", "plain"),
)


# ---------------------------------------------------------------------------
# Synthetic workbooks
# ---------------------------------------------------------------------------


def _source_row(**overrides: Any) -> list[Any]:
    values: dict[str, Any] = {field_name: None for _, field_name in RESUMEN_COLUMNS}
    values.update(
        {
            "pmf": "MP001",
            "rol": "123-45",
            "numero_predio": "7",
            "estado_resumido": "En tramite",
            "id_predio_unico": "MP001-123-45-7",
            "carpeta_source": "COLUMNA-E",
            "carpeta_normalizada": "COLUMNA-AC",
            "superficie_corta": 1.25,
        }
    )
    values.update(overrides)
    return [values[field_name] for _, field_name in RESUMEN_COLUMNS]


def _workbook_bytes(
    tmp_path: Path,
    name: str,
    rows: list[list[Any]],
    *,
    headers: tuple[str, ...] = EXPECTED_RESUMEN_HEADERS,
) -> bytes:
    path = tmp_path / name
    workbook = xlsxwriter.Workbook(path)
    worksheet = workbook.add_worksheet("Resumen")
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})

    for column, header in enumerate(headers):
        worksheet.write(0, column, header)

    for row_index, row in enumerate(rows, start=1):
        for column, value in enumerate(row):
            if value is None:
                continue
            if isinstance(value, dt.date):
                worksheet.write_datetime(
                    row_index,
                    column,
                    dt.datetime(value.year, value.month, value.day),
                    date_format,
                )
            else:
                worksheet.write(row_index, column, value)

    workbook.close()
    return path.read_bytes()


def _valid_workbook(tmp_path: Path, name: str = "resumen.xlsx", *, marker: str = "A") -> bytes:
    """Three business rows, two PMFs, two provisional predio ids.

    ``marker`` varies the content so two calls produce different SHA-256
    digests and therefore different source snapshots.
    """

    return _workbook_bytes(
        tmp_path,
        name,
        [
            _source_row(superficie_corta=1.5, numero_ingreso=marker),
            _source_row(id_predio_unico=None, superficie_corta=0.5),
            _source_row(pmf="MP002", id_predio_unico="MP002-9-1", superficie_corta=2.0),
            _source_row(pmf=None),
        ],
    )


def _contract_violating_workbook(tmp_path: Path) -> bytes:
    headers = list(EXPECTED_RESUMEN_HEADERS)
    headers[3] = "PMF renombrado"
    return _workbook_bytes(tmp_path, "violating.xlsx", [_source_row()], headers=tuple(headers))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client(integration_engine: Engine, tmp_path: Path) -> Generator[TestClient, None, None]:
    app.dependency_overrides[get_object_store] = lambda: LocalObjectStore(tmp_path / "object-store")

    with TestClient(app) as test_client:
        test_client.engine = integration_engine
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _isolated_platform_tables(integration_engine: Engine) -> Generator[None, None, None]:
    yield
    with integration_engine.begin() as conn:
        conn.execute(text("UPDATE platform.transelec_dashboard_state SET active_import_id = NULL"))
        for table in (
            "transelec_publish_event",
            "transelec_resumen_row",
            "transelec_import",
            "generated_artifact",
            "processing_attempt",
            "processing_job",
            "ingestion_run",
            "source_observation",
            "source_snapshot",
            "source_asset",
            "source_system",
            "audit_event",
            "session",
            "product_grant",
            "app_user",
        ):
            conn.execute(text(f"DELETE FROM platform.{table}"))


def _login(client: TestClient, identity_key: str) -> None:
    """Authenticate as a seeded dev identity and fetch a CSRF token."""

    engine: Engine = client.engine
    display_name = next(
        (
            identity.display_name
            for identity in SEEDED_DEV_IDENTITIES
            if identity.identity_key == identity_key
        ),
        identity_key,
    )
    with engine.connect() as connection:
        user = resolve_or_create_app_user(
            connection,
            identity_kind=DEV_IDENTITY_KIND,
            identity_key=identity_key,
            display_name=display_name,
        )
        if not list_grants_for_user(connection, app_user_id=user.id):
            for product_key, role in DEFAULT_SEED_GRANTS.get(identity_key, ()):
                grant_product_role(
                    connection, app_user_id=user.id, product_key=product_key, role=role
                )
        raw_secret = _platform_sessions.create_session(
            connection, app_user_id=user.id, ttl=timedelta(hours=8)
        )
        connection.commit()

    client.cookies.set(SESSION_COOKIE_NAME, raw_secret)
    _refresh_csrf(client)


def _login_with_grants(
    client: TestClient, identity_key: str, grants: tuple[tuple[str, Role], ...]
) -> None:
    """Authenticate a purpose-built identity with exactly ``grants``."""

    engine: Engine = client.engine
    with engine.connect() as connection:
        user = resolve_or_create_app_user(
            connection,
            identity_kind=DEV_IDENTITY_KIND,
            identity_key=identity_key,
            display_name=identity_key,
        )
        for product_key, role in grants:
            grant_product_role(connection, app_user_id=user.id, product_key=product_key, role=role)
        raw_secret = _platform_sessions.create_session(
            connection, app_user_id=user.id, ttl=timedelta(hours=8)
        )
        connection.commit()

    client.cookies.set(SESSION_COOKIE_NAME, raw_secret)
    _refresh_csrf(client)


def _refresh_csrf(client: TestClient) -> None:
    response = client.get("/auth/csrf")
    assert response.status_code == 200, response.text
    client.headers[CSRF_HEADER_NAME] = response.json()["csrf_token"]


def _upload(client: TestClient, content: bytes) -> Response:
    return client.post(
        "/transelec/uploads",
        files={
            "file": (
                "resumen.xlsx",
                content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        headers={"Origin": _SAME_ORIGIN},
    )


def _ingestion_run_id(engine: Engine, source_snapshot_id: int) -> int:
    with engine.connect() as connection:
        return connection.execute(
            text(
                "SELECT id FROM platform.ingestion_run "
                "WHERE source_snapshot_id = :id ORDER BY id DESC LIMIT 1"
            ),
            {"id": source_snapshot_id},
        ).scalar_one()


def _active_import_id(engine: Engine) -> int | None:
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT active_import_id FROM platform.transelec_dashboard_state WHERE id = 1")
        ).scalar_one()


def _audit_event_types(engine: Engine) -> list[str]:
    with engine.connect() as connection:
        return [
            row.event_type
            for row in connection.execute(
                text("SELECT event_type FROM platform.audit_event ORDER BY id")
            ).all()
        ]


def _upload_and_validate(
    client: TestClient, engine: Engine, content: bytes
) -> tuple[int, Response]:
    """Run Step A then Step B; return the ingestion run id and Step B response."""

    upload = _upload(client, content)
    assert upload.status_code == 200, upload.text
    run_id = _ingestion_run_id(engine, upload.json()["source_snapshot_id"])

    response = client.post(
        f"/transelec/imports/{run_id}/validate-and-project",
        headers={"Origin": _SAME_ORIGIN},
    )
    return run_id, response


# ---------------------------------------------------------------------------
# Full lifecycle
# ---------------------------------------------------------------------------


def test_full_lifecycle_upload_validate_publish_restore(
    client: TestClient, integration_engine: Engine, tmp_path: Path
) -> None:
    _login(client, "dev-admin")

    _, first = _upload_and_validate(client, integration_engine, _valid_workbook(tmp_path))
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["status"] == "validated"
    assert first_body["business_rows"] == 3
    assert first_body["distinct_pmf"] == 2
    assert first_body["distinct_provisional_predio_ids"] == 2
    assert first_body["surface_total"] == pytest.approx(4.0)
    assert first_body["is_active"] is False
    first_import_id = first_body["import_id"]

    # Step B committed but activated nothing.
    assert _active_import_id(integration_engine) is None

    published = client.post(
        f"/transelec/imports/{first_import_id}/publish",
        headers={"Origin": _SAME_ORIGIN},
    )
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    assert published.json()["event_type"] == "publish"
    assert published.json()["previous_import_id"] is None
    assert published.json()["active_import_id"] == first_import_id
    assert _active_import_id(integration_engine) == first_import_id

    # A second, different workbook: validated and published, superseding the first.
    _, second = _upload_and_validate(
        client, integration_engine, _valid_workbook(tmp_path, "resumen2.xlsx", marker="B")
    )
    assert second.status_code == 200, second.text
    second_import_id = second.json()["import_id"]
    assert second_import_id != first_import_id
    assert second.json()["is_active"] is False
    assert _active_import_id(integration_engine) == first_import_id

    client.post(f"/transelec/imports/{second_import_id}/publish", headers={"Origin": _SAME_ORIGIN})
    assert _active_import_id(integration_engine) == second_import_id

    restored = client.post(
        f"/transelec/imports/{first_import_id}/restore",
        headers={"Origin": _SAME_ORIGIN},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["status"] == "restored"
    assert restored.json()["event_type"] == "restore"
    assert restored.json()["previous_import_id"] == second_import_id
    assert _active_import_id(integration_engine) == first_import_id

    with integration_engine.connect() as connection:
        events = connection.execute(
            text("SELECT import_id, event_type FROM platform.transelec_publish_event ORDER BY id")
        ).all()

    assert [(row.import_id, row.event_type) for row in events] == [
        (first_import_id, "publish"),
        (second_import_id, "publish"),
        (first_import_id, "restore"),
    ]

    event_types = _audit_event_types(integration_engine)
    assert event_types.count("import.validated") == 2
    assert event_types.count("import.published") == 2
    assert event_types.count("import.restored") == 1


def test_duplicate_upload_is_idempotent_and_never_double_imports(
    client: TestClient, integration_engine: Engine, tmp_path: Path
) -> None:
    _login(client, "dev-admin")
    content = _valid_workbook(tmp_path)

    _, first = _upload_and_validate(client, integration_engine, content)
    first_import_id = first.json()["import_id"]

    _, second = _upload_and_validate(client, integration_engine, content)

    assert second.status_code == 200, second.text
    assert second.json()["status"] == "already_imported"
    assert second.json()["import_id"] == first_import_id
    assert second.json()["is_active"] is False

    with integration_engine.connect() as connection:
        imports = connection.execute(
            text("SELECT count(*) FROM platform.transelec_import")
        ).scalar_one()
        rows = connection.execute(
            text("SELECT count(*) FROM platform.transelec_resumen_row")
        ).scalar_one()

    assert (imports, rows) == (1, 3)


def test_reuploading_the_active_version_reports_already_current(
    client: TestClient, integration_engine: Engine, tmp_path: Path
) -> None:
    _login(client, "dev-admin")
    content = _valid_workbook(tmp_path)

    _, first = _upload_and_validate(client, integration_engine, content)
    import_id = first.json()["import_id"]
    client.post(f"/transelec/imports/{import_id}/publish", headers={"Origin": _SAME_ORIGIN})

    _, again = _upload_and_validate(client, integration_engine, content)

    assert again.json()["status"] == "already_current"
    assert again.json()["is_active"] is True
    assert _active_import_id(integration_engine) == import_id


# ---------------------------------------------------------------------------
# Transactional separation
# ---------------------------------------------------------------------------


def test_validated_import_does_not_become_active_until_publish_is_called(
    client: TestClient, integration_engine: Engine, tmp_path: Path
) -> None:
    _login(client, "dev-admin")

    _, response = _upload_and_validate(client, integration_engine, _valid_workbook(tmp_path))

    assert response.json()["status"] == "validated"
    assert response.json()["is_active"] is False
    assert _active_import_id(integration_engine) is None

    with integration_engine.connect() as connection:
        publish_events = connection.execute(
            text("SELECT count(*) FROM platform.transelec_publish_event")
        ).scalar_one()

    assert publish_events == 0
    assert "import.published" not in _audit_event_types(integration_engine)


def test_invariant_failure_mid_step_b_rolls_back_and_leaves_the_active_version_unchanged(
    client: TestClient,
    integration_engine: Engine,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Publish a first version, then force Step B to fail on a second upload:
    no import/row rows may persist and active_import_id must be identical
    before and after, because publish (Step C) was never invoked."""

    _login(client, "dev-admin")

    _, first = _upload_and_validate(client, integration_engine, _valid_workbook(tmp_path))
    published_import_id = first.json()["import_id"]
    client.post(
        f"/transelec/imports/{published_import_id}/publish", headers={"Origin": _SAME_ORIGIN}
    )

    active_before = _active_import_id(integration_engine)
    with integration_engine.connect() as connection:
        imports_before = connection.execute(
            text("SELECT count(*) FROM platform.transelec_import")
        ).scalar_one()
        rows_before = connection.execute(
            text("SELECT count(*) FROM platform.transelec_resumen_row")
        ).scalar_one()

    real = import_projection.read_persisted_aggregates

    def _skewed(connection: Any, *, import_id: int) -> Any:
        aggregates = real(connection, import_id=import_id)
        return type(aggregates)(
            business_rows=aggregates.business_rows,
            distinct_pmf=aggregates.distinct_pmf + 1,
            distinct_provisional_predio_ids=aggregates.distinct_provisional_predio_ids,
            surface_total=aggregates.surface_total,
            blank_predio_group_keys=aggregates.blank_predio_group_keys,
            orphaned_rows=aggregates.orphaned_rows,
        )

    monkeypatch.setattr(import_projection, "read_persisted_aggregates", _skewed)

    _, failed = _upload_and_validate(
        client, integration_engine, _valid_workbook(tmp_path, "resumen2.xlsx", marker="B")
    )

    assert failed.status_code == 500
    assert (
        failed.json()["detail"]
        == "No se pudo verificar la importación. La versión activa no cambió."
    )

    with integration_engine.connect() as connection:
        imports_after = connection.execute(
            text("SELECT count(*) FROM platform.transelec_import")
        ).scalar_one()
        rows_after = connection.execute(
            text("SELECT count(*) FROM platform.transelec_resumen_row")
        ).scalar_one()

    assert (imports_after, rows_after) == (imports_before, rows_before)
    assert _active_import_id(integration_engine) == active_before
    assert "import.validation.failed" in _audit_event_types(integration_engine)


def test_contract_violation_is_rejected_and_leaves_the_active_version_unchanged(
    client: TestClient, integration_engine: Engine, tmp_path: Path
) -> None:
    _login(client, "dev-admin")

    _, first = _upload_and_validate(client, integration_engine, _valid_workbook(tmp_path))
    import_id = first.json()["import_id"]
    client.post(f"/transelec/imports/{import_id}/publish", headers={"Origin": _SAME_ORIGIN})
    active_before = _active_import_id(integration_engine)

    _, rejected = _upload_and_validate(
        client, integration_engine, _contract_violating_workbook(tmp_path)
    )

    assert rejected.status_code == 422
    assert _active_import_id(integration_engine) == active_before

    with integration_engine.connect() as connection:
        imports = connection.execute(
            text("SELECT count(*) FROM platform.transelec_import")
        ).scalar_one()

    assert imports == 1


def test_client_facing_errors_never_leak_technical_detail(
    client: TestClient, integration_engine: Engine, tmp_path: Path
) -> None:
    _login(client, "dev-admin")

    _, rejected = _upload_and_validate(
        client, integration_engine, _contract_violating_workbook(tmp_path)
    )
    detail = rejected.json()["detail"]

    assert detail == "La planilla no cumple el contrato de origen esperado. Contacte a soporte."
    for leak in ("Traceback", "/tmp", ".xlsx", "Resumen schema mismatch", "PMF renombrado"):
        assert leak not in detail

    # The technical detail is preserved in the audit ledger instead.
    with integration_engine.connect() as connection:
        metadata = connection.execute(
            text(
                "SELECT metadata FROM platform.audit_event "
                "WHERE event_type = 'import.validation.failed' ORDER BY id DESC LIMIT 1"
            )
        ).scalar_one()

    assert metadata["reason"] == "contract_violation"
    assert "Resumen schema mismatch" in metadata["detail"]


def test_a_database_failure_never_writes_row_content_to_the_audit_ledger_or_the_log(
    client: TestClient,
    integration_engine: Engine,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """An unexpected database error must not smuggle source content out.

    SQLAlchemy's StatementError family appends the failing statement AND its
    bound parameters to str(exc) — for this projection, that is every column
    value of the failing rows. app.audit's contract forbids putting raw
    source content in metadata, and the process log is no better a place for
    it, so the router records only the sanitized form.
    """

    _login(client, "dev-admin")
    secret = "PMF-CONFIDENCIAL-001"
    content = _workbook_bytes(
        tmp_path,
        "confidencial.xlsx",
        [_source_row(pmf=secret, id_predio_unico=f"{secret}-9-9")],
    )
    leaking_parameters = [{"pmf": secret, "predio_group_key": f"{secret}-9-9"}]

    def _fail_with_bound_parameters(connection: Any, **kwargs: Any) -> None:
        raise DataError(
            "INSERT INTO platform.transelec_resumen_row (pmf, predio_group_key) VALUES (%s, %s)",
            leaking_parameters,
            Exception("value too long for type character varying"),
        )

    monkeypatch.setattr(import_projection, "_insert_rows", _fail_with_bound_parameters)

    with caplog.at_level(logging.WARNING, logger="app.routers.transelec"):
        _, failed = _upload_and_validate(client, integration_engine, content)

    assert failed.status_code == 500
    assert secret not in failed.text

    with integration_engine.connect() as connection:
        metadata = connection.execute(
            text(
                "SELECT metadata FROM platform.audit_event "
                "WHERE event_type = 'import.validation.failed' ORDER BY id DESC LIMIT 1"
            )
        ).scalar_one()

    assert metadata["reason"] == "projection_error"
    assert metadata["detail"] == "DataError"
    serialized_metadata = json.dumps(metadata)
    assert secret not in serialized_metadata
    assert "parameters" not in serialized_metadata
    assert "INSERT INTO" not in serialized_metadata

    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert "DataError" in logged
    assert secret not in logged
    assert "parameters" not in logged
    assert "INSERT INTO" not in logged


# ---------------------------------------------------------------------------
# Not-found and failure paths
# ---------------------------------------------------------------------------


def test_validate_and_project_on_an_unknown_run_is_not_found(client: TestClient) -> None:
    _login(client, "dev-admin")

    response = client.post(
        "/transelec/imports/999999/validate-and-project", headers={"Origin": _SAME_ORIGIN}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "No se encontró la carga solicitada."


def test_validate_and_project_on_another_products_run_is_not_found(
    client: TestClient, integration_engine: Engine
) -> None:
    """A Transelec-granted caller must not learn that a Forestry run exists."""

    _login(client, "dev-admin")
    with integration_engine.begin() as connection:
        snapshot_id = connection.execute(
            text(
                """
                WITH s AS (
                    INSERT INTO platform.source_system (system_key)
                    VALUES ('cross_product_probe') RETURNING id
                ), a AS (
                    INSERT INTO platform.source_asset
                        (source_system_id, identity_kind, identity_key)
                    SELECT id, 'content_sha256', repeat('a', 64) FROM s RETURNING id
                )
                INSERT INTO platform.source_snapshot
                    (source_asset_id, content_sha256, byte_size)
                SELECT id, repeat('a', 64), 10 FROM a RETURNING id
                """
            )
        ).scalar_one()
        run_id = connection.execute(
            text(
                "INSERT INTO platform.ingestion_run (source_snapshot_id, product_key) "
                "VALUES (:snapshot_id, 'forestry') RETURNING id"
            ),
            {"snapshot_id": snapshot_id},
        ).scalar_one()

    response = client.post(
        f"/transelec/imports/{run_id}/validate-and-project", headers={"Origin": _SAME_ORIGIN}
    )

    assert response.status_code == 404


def test_publishing_an_unknown_import_is_not_found_and_audited_as_failed(
    client: TestClient, integration_engine: Engine
) -> None:
    _login(client, "dev-admin")

    response = client.post("/transelec/imports/999999/publish", headers={"Origin": _SAME_ORIGIN})

    assert response.status_code == 404
    assert response.json()["detail"] == "No se encontró la versión solicitada."
    assert "import.publish.failed" in _audit_event_types(integration_engine)
    assert _active_import_id(integration_engine) is None


def test_restoring_an_unknown_import_is_not_found(
    client: TestClient, integration_engine: Engine
) -> None:
    _login(client, "dev-admin")

    response = client.post("/transelec/imports/999999/restore", headers={"Origin": _SAME_ORIGIN})

    assert response.status_code == 404
    assert "import.publish.failed" in _audit_event_types(integration_engine)


# ---------------------------------------------------------------------------
# RBAC
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("path", "kind"), MUTATION_ROUTES)
def test_viewer_is_forbidden_on_every_mutation_route(
    client: TestClient, tmp_path: Path, path: str, kind: str
) -> None:
    _login(client, "dev-viewer")  # transelect VIEWER only

    response = _post_mutation(client, path, kind, tmp_path)

    assert response.status_code == 403, response.text


@pytest.mark.parametrize(("path", "kind"), MUTATION_ROUTES)
def test_a_forestry_only_operator_is_forbidden_on_every_transelec_mutation(
    client: TestClient, tmp_path: Path, path: str, kind: str
) -> None:
    """Cross-product isolation: OPERATOR (including PUBLISH) on Forestry
    grants nothing at all on Transelec."""

    _login_with_grants(client, "forestry-only-operator", (("forestry", Role.OPERATOR),))

    response = _post_mutation(client, path, kind, tmp_path)

    assert response.status_code == 403, response.text


def test_operator_with_a_transelec_grant_can_run_the_whole_lifecycle(
    client: TestClient, integration_engine: Engine, tmp_path: Path
) -> None:
    _login_with_grants(client, "transelec-operator", (("transelect", Role.OPERATOR),))

    _, validated = _upload_and_validate(client, integration_engine, _valid_workbook(tmp_path))
    assert validated.status_code == 200, validated.text
    import_id = validated.json()["import_id"]

    published = client.post(
        f"/transelec/imports/{import_id}/publish", headers={"Origin": _SAME_ORIGIN}
    )
    restored = client.post(
        f"/transelec/imports/{import_id}/restore", headers={"Origin": _SAME_ORIGIN}
    )

    assert published.status_code == 200, published.text
    assert restored.status_code == 200, restored.text


def test_admin_can_run_the_whole_lifecycle(
    client: TestClient, integration_engine: Engine, tmp_path: Path
) -> None:
    _login_with_grants(client, "transelec-admin", (("transelect", Role.ADMIN),))

    _, validated = _upload_and_validate(client, integration_engine, _valid_workbook(tmp_path))
    assert validated.status_code == 200, validated.text

    published = client.post(
        f"/transelec/imports/{validated.json()['import_id']}/publish",
        headers={"Origin": _SAME_ORIGIN},
    )

    assert published.status_code == 200, published.text


# ---------------------------------------------------------------------------
# CSRF on every Transelec mutation route
# ---------------------------------------------------------------------------


def _post_mutation(client: TestClient, path: str, kind: str, tmp_path: Path, **kwargs: Any) -> Any:
    if kind == "upload":
        return client.post(
            path,
            files={"file": ("resumen.xlsx", _valid_workbook(tmp_path), "application/octet-stream")},
            **kwargs,
        )
    return client.post(path, **kwargs)


@pytest.mark.parametrize(("path", "kind"), MUTATION_ROUTES)
def test_mutation_without_a_csrf_token_is_forbidden(
    client: TestClient, tmp_path: Path, path: str, kind: str
) -> None:
    _login(client, "dev-admin")
    del client.headers[CSRF_HEADER_NAME]

    response = _post_mutation(client, path, kind, tmp_path)

    assert response.status_code == 403
    assert response.json()["detail"] == "CSRF verification failed."


@pytest.mark.parametrize(("path", "kind"), MUTATION_ROUTES)
def test_mutation_with_a_mismatched_csrf_token_is_forbidden(
    client: TestClient, tmp_path: Path, path: str, kind: str
) -> None:
    _login(client, "dev-admin")
    valid = client.headers[CSRF_HEADER_NAME]
    client.headers[CSRF_HEADER_NAME] = valid[:-1] + ("A" if valid[-1] != "A" else "B")

    response = _post_mutation(client, path, kind, tmp_path)

    assert response.status_code == 403


@pytest.mark.parametrize(("path", "kind"), MUTATION_ROUTES)
def test_cross_origin_mutation_is_forbidden_even_with_a_valid_token(
    client: TestClient, tmp_path: Path, path: str, kind: str
) -> None:
    _login(client, "dev-admin")

    response = _post_mutation(client, path, kind, tmp_path, headers={"Origin": _ATTACKER_ORIGIN})

    assert response.status_code == 403
    assert response.json()["detail"] == "CSRF verification failed."


@pytest.mark.parametrize(("path", "kind"), MUTATION_ROUTES)
def test_mutation_with_a_valid_token_and_same_origin_passes_csrf(
    client: TestClient, tmp_path: Path, path: str, kind: str
) -> None:
    """Not 403: the request reaches the route's own logic (200 for the
    upload boundary, 404 for the fabricated import/run ids)."""

    _login(client, "dev-admin")

    response = _post_mutation(client, path, kind, tmp_path, headers={"Origin": _SAME_ORIGIN})

    assert response.status_code != 403, response.text
    assert response.status_code in (200, 404), response.text


@pytest.mark.parametrize(("path", "kind"), MUTATION_ROUTES)
def test_mutation_without_a_session_is_unauthenticated(
    client: TestClient, tmp_path: Path, path: str, kind: str
) -> None:
    response = _post_mutation(client, path, kind, tmp_path)

    assert response.status_code == 401
