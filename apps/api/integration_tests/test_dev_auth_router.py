"""Dev-auth router: session lifecycle and default grant seeding.

The dev-auth router (app.routers.dev_auth) is now mounted only when
APP_ENV == "development" (see app.main and
apps/api/tests/test_main_dev_auth_gate.py). The integration test suite runs
with APP_ENV=test in the whole process, so that
app.db_safety.require_test_database can prove the target database is
disposable before any test touches it — and app.main decides whether to
mount the router from that same process-level APP_ENV, once, at import
time. There is no way for a single process to satisfy both "APP_ENV=test so
the DB-safety check passes" and "APP_ENV=development so the router is
mounted", so these tests can no longer drive the router's behavior through
real HTTP calls (that would 404 under APP_ENV=test).

Instead, each test exercises the same underlying code the router's handlers
call internally — either by calling those handler functions directly with a
locally constructed, non-ambient ``Settings(app_env="development", ...)``
(which legitimately satisfies ``assert_dev_auth_allowed`` without touching
process ``os.environ``), or, for the default-grant-seeding behavior, by
mirroring the handler's own repository calls per the reviewer's ruling in
task-4-report.md. Test intent is preserved; only the transport is not HTTP.
"""

from __future__ import annotations

import pytest
from app.access_repository import (
    grant_product_role,
    list_grants_for_user,
    resolve_or_create_app_user,
)
from app.config import Settings
from app.deps import get_current_app_user
from app.dev_auth import DEFAULT_SEED_GRANTS, DEV_IDENTITY_KIND, DevSessionStore
from app.routers.dev_auth import DevLoginRequest, dev_login
from app.session_store import PlatformSessionStore
from fastapi import HTTPException, Response
from sqlalchemy import Connection


def _development_settings() -> Settings:
    # Constructed directly (not read from os.environ), the same way
    # apps/api/tests/test_dev_auth.py's _settings() helper does — this
    # exercises "the router's handler would behave this way if reached in a
    # development process" without needing APP_ENV=development for the
    # whole test process.
    return Settings(app_env="development", postgres_password="x")


def test_me_without_session_returns_401(integration_connection: Connection) -> None:
    """get_current_app_user (what GET /auth/me depends on) rejects a request
    with no session cookie, regardless of which session store would apply."""

    with pytest.raises(HTTPException) as exc_info:
        get_current_app_user(
            _development_settings(),
            integration_connection,
            PlatformSessionStore(),
            DevSessionStore(),
            None,
        )
    assert exc_info.value.status_code == 401


def test_dev_login_unknown_identity_returns_422(integration_connection: Connection) -> None:
    """POST /auth/dev-login's handler rejects an identity_key outside
    SEEDED_DEV_IDENTITIES."""

    with pytest.raises(HTTPException) as exc_info:
        dev_login(
            DevLoginRequest(identity_key="not-a-real-identity"),
            Response(),
            _development_settings(),
            DevSessionStore(),
            integration_connection,
        )
    assert exc_info.value.status_code == 422


def test_dev_login_seeds_default_grants_for_new_user(integration_connection: Connection) -> None:
    """A first-time dev-admin login seeds DEFAULT_SEED_GRANTS, mirroring
    exactly what routers/dev_auth.py's dev_login handler does internally
    (resolve_or_create_app_user, then grant_product_role per default grant,
    since list_grants_for_user is empty for a brand-new user)."""

    identity_key = "dev-admin"
    user = resolve_or_create_app_user(
        integration_connection,
        identity_kind=DEV_IDENTITY_KIND,
        identity_key=identity_key,
        display_name="Dev Admin",
    )
    assert not list_grants_for_user(integration_connection, app_user_id=user.id)

    for product_key, role in DEFAULT_SEED_GRANTS[identity_key]:
        grant_product_role(
            integration_connection, app_user_id=user.id, product_key=product_key, role=role
        )

    grants = list_grants_for_user(integration_connection, app_user_id=user.id)
    product_keys = {grant.product_key for grant in grants}
    assert product_keys == {"lidar", "forestry", "transelect"}


def test_session_lifecycle_create_resolve_and_logout_clear(
    integration_connection: Connection,
) -> None:
    """DevSessionStore's create_session/resolve_session/clear_session round
    trip (as dev-login/me/logout use it), confirmed against a real
    platform.app_user row rather than the bare string apps/api/tests's
    in-memory DevSessionStore unit tests use."""

    identity_key = "dev-viewer"
    user = resolve_or_create_app_user(
        integration_connection,
        identity_kind=DEV_IDENTITY_KIND,
        identity_key=identity_key,
        display_name="Dev Viewer",
    )

    session_store = DevSessionStore()
    token = session_store.create_session(identity_key)

    resolved_identity_key = session_store.resolve_session(token)
    assert resolved_identity_key == identity_key

    resolved_user = resolve_or_create_app_user(
        integration_connection,
        identity_kind=DEV_IDENTITY_KIND,
        identity_key=resolved_identity_key,
        display_name="Dev Viewer",
    )
    assert resolved_user.id == user.id

    session_store.clear_session(token)
    assert session_store.resolve_session(token) is None
