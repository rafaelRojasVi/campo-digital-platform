"""Google Workspace sign-in router end to end, against real PostgreSQL.

The provider client is faked here because what this file is about is the
router's own behaviour -- the flow cookie, the identity it persists, the
session it mints, the configurable bootstrap, and the fact that a session is
not an authorization. The
cryptographic half of Google sign-in is covered without a fake, and without
a network, in apps/api/tests/test_google_id_token.py.
"""

from __future__ import annotations

import json
from collections.abc import Generator, Mapping
from dataclasses import dataclass

import pytest
from app.access import Role
from app.access_repository import grant_product_role
from app.config import Settings, get_settings
from app.deps import SESSION_COOKIE_NAME, get_google_oidc_client
from app.google_auth import AuthorizationRequest, GoogleSignIn, GoogleSignInError
from app.main import app
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import Engine, text

_ENCRYPTION_KEY = Fernet.generate_key().decode("utf-8")
_FLOW_COOKIE_NAME = "google_login_flow"
_BOOTSTRAP_EMAIL = "admin@campodigital.cl"


def _configured_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "postgres_password": "x",
        "google_client_id": "1234567890-abcdef.apps.googleusercontent.com",
        "google_client_secret": "fake-google-secret",
        "google_redirect_base_url": "https://testserver",
        "google_workspace_domain": "campodigital.cl",
        "platform_token_encryption_key": _ENCRYPTION_KEY,
    }
    values.update(overrides)
    return Settings(**values)


@dataclass
class FakeGoogleOidcClient:
    """A deterministic stand-in for GoogleOidcSignInClient: no network."""

    sign_in: GoogleSignIn | None = None
    error: GoogleSignInError | None = None
    completed_with: dict[str, str] | None = None
    initiated_with: str | None = None

    def initiate(self, redirect_uri: str) -> AuthorizationRequest:
        self.initiated_with = redirect_uri
        return AuthorizationRequest(
            auth_uri="https://accounts.google.com/o/oauth2/v2/auth?fake=1",
            flow_state=json.dumps(
                {"state": "fixed-state", "nonce": "fixed-nonce", "code_verifier": "fixed-verifier"}
            ),
        )

    def complete(
        self, flow_state: str, callback_params: Mapping[str, str], redirect_uri: str
    ) -> GoogleSignIn:
        del flow_state, redirect_uri
        self.completed_with = dict(callback_params)
        if self.error is not None:
            raise self.error
        assert self.sign_in is not None
        return self.sign_in


def _sign_in(**overrides: object) -> GoogleSignIn:
    values: dict[str, object] = {
        "subject": "104728391027364518293",
        "email": _BOOTSTRAP_EMAIL,
        "display_name": "Admin Campo",
        "hosted_domain": "campodigital.cl",
    }
    values.update(overrides)
    return GoogleSignIn(**values)


@pytest.fixture
def client(integration_engine: Engine) -> Generator[TestClient, None, None]:
    # https, not http: outside development the session cookie is issued with
    # `Secure`, and a test that then calls an authenticated route over plain
    # http would silently never send it -- proving nothing about RBAC.
    with TestClient(app, base_url="https://testserver", follow_redirects=False) as test_client:
        test_client.engine = integration_engine
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _isolated_platform_tables(integration_engine: Engine) -> Generator[None, None, None]:
    yield
    with integration_engine.connect() as conn:
        for table in ("ms_graph_grant", "session", "audit_event", "product_grant", "app_user"):
            conn.execute(text(f"DELETE FROM platform.{table}"))
        conn.commit()


def _use(provider: FakeGoogleOidcClient, **settings_overrides: object) -> FakeGoogleOidcClient:
    app.dependency_overrides[get_settings] = lambda: _configured_settings(**settings_overrides)
    app.dependency_overrides[get_google_oidc_client] = lambda: provider
    return provider


def _login_and_get_flow_cookie(client: TestClient) -> str:
    response = client.get("/auth/google/login")
    assert response.status_code == 302, response.text
    cookie = response.cookies.get(_FLOW_COOKIE_NAME)
    assert cookie is not None
    return cookie


def _complete_sign_in(client: TestClient, provider: FakeGoogleOidcClient) -> Response:
    flow_cookie = _login_and_get_flow_cookie(client)
    client.cookies.set(_FLOW_COOKIE_NAME, flow_cookie)
    del provider
    return client.get("/auth/google/callback", params={"state": "fixed-state", "code": "abc"})


# ---------------------------------------------------------------------------
# /auth/google/login
# ---------------------------------------------------------------------------


def test_login_redirects_the_browser_to_google(client: TestClient) -> None:
    _use(FakeGoogleOidcClient())

    response = client.get("/auth/google/login")

    assert response.status_code == 302
    assert response.headers["location"].startswith("https://accounts.google.com/o/oauth2/v2/auth")


@pytest.mark.parametrize(
    "base_url", ["https://portal.example.test/api", "https://portal.example.test/api/"]
)
def test_login_sends_google_the_configured_callback_uri(client: TestClient, base_url: str) -> None:
    provider = _use(FakeGoogleOidcClient(), google_redirect_base_url=base_url)

    client.get("/auth/google/login")

    assert provider.initiated_with == "https://portal.example.test/api/auth/google/callback"


def test_login_keeps_the_flow_state_in_an_httponly_cookie_the_browser_cannot_read(
    client: TestClient,
) -> None:
    _use(FakeGoogleOidcClient())

    response = client.get("/auth/google/login")

    set_cookie = response.headers.get("set-cookie", "")
    assert _FLOW_COOKIE_NAME in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie.replace("samesite", "SameSite")
    # The state, nonce and verifier are encrypted at rest in the cookie.
    assert "fixed-verifier" not in set_cookie
    assert "fixed-nonce" not in set_cookie


def test_login_returns_503_when_google_credentials_are_not_configured(
    client: TestClient,
) -> None:
    # No overrides: the real get_google_oidc_client runs against the process's
    # actual Settings, which carry no GOOGLE_CLIENT_ID/SECRET in this test env.
    response = client.get("/auth/google/login")

    assert response.status_code == 503


def test_login_returns_503_when_the_token_encryption_key_is_missing(client: TestClient) -> None:
    _use(FakeGoogleOidcClient(), platform_token_encryption_key=None)

    response = client.get("/auth/google/login")

    assert response.status_code == 503


def test_login_cookie_is_not_secure_under_development(client: TestClient) -> None:
    _use(FakeGoogleOidcClient(), app_env="development")

    response = client.get("/auth/google/login")

    assert "Secure" not in response.headers.get("set-cookie", "")


def test_login_cookie_is_secure_outside_development(client: TestClient) -> None:
    _use(FakeGoogleOidcClient(), app_env="staging")

    response = client.get("/auth/google/login")

    assert "Secure" in response.headers.get("set-cookie", "")


# ---------------------------------------------------------------------------
# /auth/google/callback -- the flow cookie
# ---------------------------------------------------------------------------


def test_callback_without_a_flow_cookie_is_rejected(client: TestClient) -> None:
    _use(FakeGoogleOidcClient(sign_in=_sign_in()))

    response = client.get("/auth/google/callback", params={"state": "fixed-state", "code": "abc"})

    assert response.status_code == 400


def test_callback_with_a_tampered_flow_cookie_is_rejected(client: TestClient) -> None:
    _use(FakeGoogleOidcClient(sign_in=_sign_in()))
    client.cookies.set(_FLOW_COOKIE_NAME, "not-a-real-encrypted-cookie")

    response = client.get("/auth/google/callback", params={"state": "fixed-state", "code": "abc"})

    assert response.status_code == 400


def test_a_rejected_flow_cookie_never_reaches_the_provider(client: TestClient) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in()))
    client.cookies.set(_FLOW_COOKIE_NAME, "not-a-real-encrypted-cookie")

    client.get("/auth/google/callback", params={"state": "fixed-state", "code": "abc"})

    assert provider.completed_with is None


def test_callback_hands_the_provider_the_state_google_returned(client: TestClient) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in()))

    _complete_sign_in(client, provider)

    assert provider.completed_with == {"state": "fixed-state", "code": "abc"}


def test_callback_returns_401_and_no_session_when_the_sign_in_is_not_trusted(
    client: TestClient,
) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in()))
    flow_cookie = _login_and_get_flow_cookie(client)
    _use(FakeGoogleOidcClient(error=GoogleSignInError("hd claim missing")))
    client.cookies.set(_FLOW_COOKIE_NAME, flow_cookie)
    del provider

    response = client.get("/auth/google/callback", params={"state": "fixed-state", "code": "abc"})

    assert response.status_code == 401
    assert response.cookies.get(SESSION_COOKIE_NAME) is None


# ---------------------------------------------------------------------------
# /auth/google/callback -- the identity and the session
# ---------------------------------------------------------------------------


def test_callback_starts_a_real_session_and_lands_on_the_dashboard(
    client: TestClient,
) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in()))

    response = _complete_sign_in(client, provider)

    assert response.status_code == 302, response.text
    assert response.headers["location"] == "/"
    assert response.cookies.get(SESSION_COOKIE_NAME) is not None


def test_callback_records_the_user_under_googles_subject_not_their_email(
    client: TestClient, integration_engine: Engine
) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in()))

    _complete_sign_in(client, provider)

    with integration_engine.connect() as connection:
        row = connection.execute(
            text("SELECT identity_kind, identity_key, display_name, email FROM platform.app_user")
        ).one()
    assert row.identity_kind == "google"
    assert row.identity_key == "104728391027364518293"
    assert row.display_name == "Admin Campo"
    assert row.email == _BOOTSTRAP_EMAIL


def test_a_second_sign_in_reuses_the_same_user(
    client: TestClient, integration_engine: Engine
) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in()))

    _complete_sign_in(client, provider)
    _complete_sign_in(client, provider)

    with integration_engine.connect() as connection:
        count = connection.execute(text("SELECT count(*) FROM platform.app_user")).scalar_one()
    assert count == 1


def test_the_session_cookie_is_httponly_and_the_flow_cookie_is_cleared(
    client: TestClient,
) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in()))

    response = _complete_sign_in(client, provider)

    session_cookies = [
        value
        for value in response.headers.get_list("set-cookie")
        if value.startswith(SESSION_COOKIE_NAME)
    ]
    assert session_cookies and all("HttpOnly" in value for value in session_cookies)
    assert response.cookies.get(_FLOW_COOKIE_NAME) in (None, "")


def test_sign_in_stores_no_google_token_anywhere(
    client: TestClient, integration_engine: Engine
) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in()))

    _complete_sign_in(client, provider)

    with integration_engine.connect() as connection:
        grants = connection.execute(
            text("SELECT count(*) FROM platform.ms_graph_grant")
        ).scalar_one()
    assert grants == 0


# ---------------------------------------------------------------------------
# Authentication is not authorization
# ---------------------------------------------------------------------------


def _bootstrap(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "platform_bootstrap_admin_email": _BOOTSTRAP_EMAIL,
        "platform_bootstrap_admin_products": "transelect",
    }
    values.update(overrides)
    return values


def test_a_valid_workspace_account_without_a_grant_is_authenticated_but_forbidden(
    client: TestClient,
) -> None:
    provider = _use(
        FakeGoogleOidcClient(
            sign_in=_sign_in(subject="sub-sin-permisos", email="otro@campodigital.cl")
        ),
        **_bootstrap(),
    )

    sign_in_response = _complete_sign_in(client, provider)
    assert sign_in_response.status_code == 302

    # Authenticated -- the session resolves, /auth/me answers...
    me = client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["product_grants"] == []
    # ...and still not authorized for any product route.
    assert client.get("/runs").status_code == 403
    assert client.get("/ingesta/audit").status_code == 403


def test_a_granted_account_is_authorized_through_the_existing_product_grants(
    client: TestClient, integration_engine: Engine
) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in(subject="sub-lidar-viewer")))
    _complete_sign_in(client, provider)
    assert client.get("/runs").status_code == 403

    with integration_engine.connect() as connection:
        app_user_id = connection.execute(
            text("SELECT id FROM platform.app_user WHERE identity_key = 'sub-lidar-viewer'")
        ).scalar_one()
        grant_product_role(
            connection, app_user_id=app_user_id, product_key="lidar", role=Role.VIEWER
        )
        connection.commit()

    assert client.get("/runs").status_code == 200


def test_logout_ends_a_google_session(client: TestClient) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in()))
    _complete_sign_in(client, provider)
    assert client.get("/auth/me").status_code == 200

    assert client.post("/auth/logout").status_code == 204

    assert client.get("/auth/me").status_code == 401


# ---------------------------------------------------------------------------
# The configurable bootstrap
# ---------------------------------------------------------------------------


def test_the_configured_address_receives_admin_on_the_configured_products_only(
    client: TestClient, integration_engine: Engine
) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in()), **_bootstrap())

    _complete_sign_in(client, provider)

    assert client.get("/auth/me").json()["product_grants"] == [
        {"product_key": "transelect", "role": "admin"}
    ]
    with integration_engine.connect() as connection:
        events = (
            connection.execute(
                text(
                    "SELECT product_key FROM platform.audit_event "
                    "WHERE event_type = 'access.bootstrap_admin_granted'"
                )
            )
            .scalars()
            .all()
        )
    assert events == ["transelect"]


def test_the_bootstrap_grants_every_configured_product(client: TestClient) -> None:
    provider = _use(
        FakeGoogleOidcClient(sign_in=_sign_in()),
        **_bootstrap(platform_bootstrap_admin_products="lidar,forestry,transelect"),
    )

    _complete_sign_in(client, provider)

    assert client.get("/auth/me").json()["product_grants"] == [
        {"product_key": "forestry", "role": "admin"},
        {"product_key": "lidar", "role": "admin"},
        {"product_key": "transelect", "role": "admin"},
    ]


def test_the_bootstrap_address_matches_case_insensitively(client: TestClient) -> None:
    provider = _use(
        FakeGoogleOidcClient(sign_in=_sign_in(email="Admin@CampoDigital.cl")), **_bootstrap()
    )

    _complete_sign_in(client, provider)

    assert client.get("/auth/me").json()["product_grants"] == [
        {"product_key": "transelect", "role": "admin"}
    ]


def test_the_bootstrap_address_is_never_matched_by_suffix(client: TestClient) -> None:
    provider = _use(
        FakeGoogleOidcClient(
            sign_in=_sign_in(subject="sub-otro", email="otro.admin@campodigital.cl")
        ),
        **_bootstrap(platform_bootstrap_admin_email="admin@campodigital.cl"),
    )

    _complete_sign_in(client, provider)

    assert client.get("/auth/me").json()["product_grants"] == []


def test_no_bootstrap_at_all_when_nothing_is_configured(client: TestClient) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in()))

    _complete_sign_in(client, provider)

    assert client.get("/auth/me").json()["product_grants"] == []


def test_no_bootstrap_when_the_address_is_set_but_no_products_are(client: TestClient) -> None:
    provider = _use(
        FakeGoogleOidcClient(sign_in=_sign_in()),
        platform_bootstrap_admin_email=_BOOTSTRAP_EMAIL,
    )

    _complete_sign_in(client, provider)

    assert client.get("/auth/me").json()["product_grants"] == []


def test_a_demoted_bootstrap_account_is_not_re_promoted_by_the_next_sign_in(
    client: TestClient, integration_engine: Engine
) -> None:
    provider = _use(FakeGoogleOidcClient(sign_in=_sign_in()), **_bootstrap())
    _complete_sign_in(client, provider)

    with integration_engine.connect() as connection:
        connection.execute(
            text(
                "UPDATE platform.product_grant SET role = 'viewer' WHERE product_key = 'transelect'"
            )
        )
        connection.commit()

    _complete_sign_in(client, provider)

    assert client.get("/auth/me").json()["product_grants"] == [
        {"product_key": "transelect", "role": "viewer"}
    ]
