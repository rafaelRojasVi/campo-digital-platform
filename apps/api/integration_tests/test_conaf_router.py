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


def test_busy_conaf_answers_with_stored_data_or_a_clear_503(
    client: TestClient, integration_engine: Engine, conaf: FakeConaf
) -> None:
    from app.conaf import ConafBusyError

    sign_in(client, integration_engine, "t", (("transelect", Role.VIEWER),))
    client.get("/api/conaf/solicitudes/090663")

    def busy(numero: str) -> ConafLookup:
        raise ConafBusyError

    conaf.lookup = busy  # type: ignore[method-assign]
    stored = client.post("/api/conaf/solicitudes/090663/refresh", headers=_ORIGIN)
    assert stored.status_code == 200  # within a minute: served from storage anyway
    never_seen = client.get("/api/conaf/solicitudes/111111")
    assert never_seen.status_code == 503
    assert never_seen.json()["detail"] == "CONAF está ocupado; intente de nuevo en un momento."
