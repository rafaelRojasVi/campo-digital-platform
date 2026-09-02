"""Dev-only authentication HTTP adapter.

Every route here is gated by ``assert_dev_auth_allowed`` and must never be
reachable when ``APP_ENV == "production"``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import Connection

from app.access_repository import (
    AppUser,
    grant_product_role,
    list_grants_for_user,
    resolve_or_create_app_user,
)
from app.audit import record_audit_event
from app.config import Settings, get_settings
from app.deps import (
    SESSION_COOKIE_NAME,
    get_current_app_user,
    get_current_identity_key,
    get_db_connection,
    get_platform_session_store,
    get_session_store,
)
from app.dev_auth import (
    DEFAULT_SEED_GRANTS,
    DEV_IDENTITY_KIND,
    SEEDED_DEV_IDENTITIES,
    DevSessionStore,
    assert_dev_auth_allowed,
)
from app.session_store import PlatformSessionStore

router = APIRouter(prefix="/auth", tags=["auth"])


class DevLoginRequest(BaseModel):
    identity_key: str


class ProductGrantView(BaseModel):
    product_key: str
    role: str


class MeResponse(BaseModel):
    identity_key: str
    display_name: str
    product_grants: list[ProductGrantView]


def _me_response(user: AppUser, connection: Connection) -> MeResponse:
    grants = list_grants_for_user(connection, app_user_id=user.id)
    return MeResponse(
        identity_key=user.identity_key,
        display_name=user.display_name,
        product_grants=[
            ProductGrantView(product_key=grant.product_key, role=grant.role.value)
            for grant in grants
        ],
    )


@router.post("/dev-login", response_model=MeResponse)
def dev_login(
    payload: DevLoginRequest,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    session_store: Annotated[DevSessionStore, Depends(get_session_store)],
    connection: Annotated[Connection, Depends(get_db_connection)],
) -> MeResponse:
    """Issue a local dev session for one seeded identity."""

    assert_dev_auth_allowed(settings)

    identity = next(
        (
            candidate
            for candidate in SEEDED_DEV_IDENTITIES
            if candidate.identity_key == payload.identity_key
        ),
        None,
    )
    if identity is None:
        raise HTTPException(status_code=422, detail="Unknown dev identity_key.")

    user = resolve_or_create_app_user(
        connection,
        identity_kind=DEV_IDENTITY_KIND,
        identity_key=identity.identity_key,
        display_name=identity.display_name,
    )

    if not list_grants_for_user(connection, app_user_id=user.id):
        for product_key, role in DEFAULT_SEED_GRANTS.get(identity.identity_key, ()):
            grant_product_role(connection, app_user_id=user.id, product_key=product_key, role=role)

    token = session_store.create_session(identity.identity_key)
    response.set_cookie(SESSION_COOKIE_NAME, token, httponly=True, samesite="lax")

    record_audit_event(connection, actor_app_user_id=user.id, event_type="session.created")

    return _me_response(user, connection)


@router.get("/me", response_model=MeResponse)
def me(
    user: Annotated[AppUser, Depends(get_current_app_user)],
    connection: Annotated[Connection, Depends(get_db_connection)],
) -> MeResponse:
    """Return the current session's identity and product grants."""

    return _me_response(user, connection)


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    session_store: Annotated[DevSessionStore, Depends(get_session_store)],
    platform_sessions: Annotated[PlatformSessionStore, Depends(get_platform_session_store)],
    connection: Annotated[Connection, Depends(get_db_connection)],
    identity_key: Annotated[str, Depends(get_current_identity_key)],
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> None:
    """Clear the current session, both server-side and via the cookie.

    ``get_current_identity_key`` (via ``get_current_app_user``) already
    proved a session resolved, from either PlatformSessionStore or
    DevSessionStore — but not which one. Clearing on both stores is safe:
    each ``clear_session`` call is a no-op delete against a hash that won't
    match rows it doesn't own.
    """

    del identity_key  # authenticates the call; the token itself is read via the cookie
    if session_token is not None:
        platform_sessions.clear_session(connection, session_token)
        session_store.clear_session(session_token)
    response.delete_cookie(SESSION_COOKIE_NAME)
