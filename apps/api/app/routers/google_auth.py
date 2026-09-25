"""Google Workspace sign-in: the platform's identity provider (ADR-008).

``GET /auth/google/login`` redirects the browser to Google;
``GET /auth/google/callback`` completes the authorization-code flow and mints
a real ``platform.session`` row -- the same session ``app.deps`` already
resolves for every authenticated route.

- The callback is a ``GET``: Google returns the code as a query string. Only
  the code and ``state`` travel there, never a token, and the code is
  single-use and bound to the PKCE verifier that never left this server.
- The flow's ``state``, ``nonce`` and PKCE verifier round-trip in a
  short-lived, Fernet-encrypted, HttpOnly cookie rather than server memory,
  so the flow survives more than one API replica.
- No Google token is persisted. This flow is sign-in only: Google's tokens
  are dropped as soon as the id_token is verified, and nothing Google-issued
  is ever handed to the browser.

Signing in proves who the caller is and nothing else. Every product route
still requires a ``platform.product_grant`` through ``app.deps.ensure_can``,
so a valid ``campodigital.cl`` account with no grant gets a session and a 403.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import Connection

from app.access_repository import (
    maybe_grant_google_bootstrap_admin,
    resolve_or_create_app_user,
)
from app.audit import record_audit_event
from app.config import Settings, get_settings
from app.deps import (
    SESSION_COOKIE_NAME,
    get_db_connection,
    get_google_oidc_client,
    get_platform_session_store,
)
from app.google_auth import GoogleOidcClient, GoogleSignInError
from app.session_store import PlatformSessionStore
from app.token_crypto import TokenDecryptionError, decrypt_token, encrypt_token

router = APIRouter(prefix="/auth/google", tags=["auth"])

GOOGLE_IDENTITY_KIND = "google"

_FLOW_COOKIE_NAME = "google_login_flow"
# Enough for one interactive sign-in round trip. The cookie carries the
# state, nonce and PKCE verifier -- no identity -- so a short TTL bounds a
# stolen or replayed flow cookie without needing revocation.
_FLOW_COOKIE_MAX_AGE_SECONDS = 600
_SESSION_TTL = timedelta(hours=8)
_POST_LOGIN_REDIRECT_PATH = "/"


def _redirect_uri(settings: Settings) -> str:
    return f"{settings.google_redirect_base_url.rstrip('/')}/auth/google/callback"


def _require_encryption_key(settings: Settings) -> str:
    if settings.platform_token_encryption_key is None:
        raise HTTPException(status_code=503, detail="Google sign-in is not fully configured.")
    return settings.platform_token_encryption_key.get_secret_value()


def _cookie_is_secure(settings: Settings) -> bool:
    # Every non-development environment is HTTPS-only; development runs
    # plain HTTP on localhost, where a Secure cookie would never be sent.
    return settings.app_env != "development"


@router.get("/login")
def google_login(
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[GoogleOidcClient, Depends(get_google_oidc_client)],
) -> RedirectResponse:
    """Redirect the browser to Google's sign-in page."""

    encryption_key = _require_encryption_key(settings)
    authorization_request = client.initiate(_redirect_uri(settings))

    response = RedirectResponse(authorization_request.auth_uri, status_code=302)
    response.set_cookie(
        _FLOW_COOKIE_NAME,
        encrypt_token(authorization_request.flow_state, key=encryption_key).decode("utf-8"),
        httponly=True,
        samesite="lax",
        secure=_cookie_is_secure(settings),
        max_age=_FLOW_COOKIE_MAX_AGE_SECONDS,
    )
    return response


@router.get("/callback")
def google_callback(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    client: Annotated[GoogleOidcClient, Depends(get_google_oidc_client)],
    connection: Annotated[Connection, Depends(get_db_connection)],
    platform_sessions: Annotated[PlatformSessionStore, Depends(get_platform_session_store)],
    flow_cookie: Annotated[str | None, Cookie(alias=_FLOW_COOKIE_NAME)] = None,
) -> RedirectResponse:
    """Complete the sign-in Google redirected back, and start a real session."""

    encryption_key = _require_encryption_key(settings)
    if flow_cookie is None:
        raise HTTPException(status_code=400, detail="Missing or expired sign-in state.")

    try:
        flow_state = decrypt_token(flow_cookie.encode("utf-8"), key=encryption_key)
    except TokenDecryptionError as exc:
        raise HTTPException(status_code=400, detail="Sign-in state could not be verified.") from exc

    callback_params = {key: str(value) for key, value in request.query_params.items()}

    try:
        sign_in = client.complete(flow_state, callback_params, _redirect_uri(settings))
    except GoogleSignInError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    user = resolve_or_create_app_user(
        connection,
        identity_kind=GOOGLE_IDENTITY_KIND,
        identity_key=sign_in.subject,
        display_name=sign_in.display_name,
        email=sign_in.email,
    )
    for product_key in maybe_grant_google_bootstrap_admin(
        connection,
        settings=settings,
        email=sign_in.email,
        app_user_id=user.id,
    ):
        record_audit_event(
            connection,
            actor_app_user_id=user.id,
            event_type="access.bootstrap_admin_granted",
            product_key=product_key,
        )

    raw_secret = platform_sessions.create_session(connection, app_user_id=user.id, ttl=_SESSION_TTL)
    record_audit_event(connection, actor_app_user_id=user.id, event_type="session.created")

    response = RedirectResponse(_POST_LOGIN_REDIRECT_PATH, status_code=302)
    response.delete_cookie(_FLOW_COOKIE_NAME)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        raw_secret,
        httponly=True,
        samesite="lax",
        secure=_cookie_is_secure(settings),
    )
    return response
