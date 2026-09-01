"""Shared FastAPI dependencies for platform access and object storage.

Kept separate from ``app.main`` so routers can depend on these without a
circular import, and so tests can override them cleanly via
``app.dependency_overrides``.
"""

from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy import Connection, Engine

from app.access import Action, Role, can
from app.access_repository import AppUser, get_product_role, resolve_or_create_app_user
from app.database import get_database_engine
from app.dev_auth import DEV_IDENTITY_KIND, SEEDED_DEV_IDENTITIES, DevSessionStore
from app.object_store import LocalObjectStore, ObjectStore

SESSION_COOKIE_NAME = "campo_session"

_session_store = DevSessionStore()
_object_store: LocalObjectStore | None = None


def get_session_store() -> DevSessionStore:
    """Return the process-level dev session store."""

    return _session_store


def get_object_store() -> ObjectStore:
    """Return the process-level local object store."""

    global _object_store
    if _object_store is None:
        root = Path(os.environ.get("CAMPO_OBJECT_STORE_ROOT", ".local/object-store"))
        _object_store = LocalObjectStore(root)
    return _object_store


def get_db_connection(
    engine: Annotated[Engine, Depends(get_database_engine)],
) -> Generator[Connection, None, None]:
    """Yield a request-scoped connection, committing on success."""

    with engine.connect() as connection:
        yield connection
        connection.commit()


def get_current_identity_key(
    session_store: Annotated[DevSessionStore, Depends(get_session_store)],
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> str:
    """Resolve the caller's dev identity key from their session cookie."""

    if session_token is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    identity_key = session_store.resolve_session(session_token)
    if identity_key is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    return identity_key


def get_current_app_user(
    identity_key: Annotated[str, Depends(get_current_identity_key)],
    connection: Annotated[Connection, Depends(get_db_connection)],
) -> AppUser:
    """Resolve (or lazily create) the caller's app_user row for their session."""

    display_name = next(
        (
            identity.display_name
            for identity in SEEDED_DEV_IDENTITIES
            if identity.identity_key == identity_key
        ),
        identity_key,
    )
    return resolve_or_create_app_user(
        connection,
        identity_kind=DEV_IDENTITY_KIND,
        identity_key=identity_key,
        display_name=display_name,
    )


def ensure_can(
    connection: Connection, *, app_user_id: int, product_key: str, action: Action
) -> Role:
    """Raise 403 unless the caller's grant for ``product_key`` permits ``action``."""

    role = get_product_role(connection, app_user_id=app_user_id, product_key=product_key)
    if not can(role, action):
        raise HTTPException(status_code=403, detail="Not permitted for this product.")
    assert role is not None  # can() returning True implies a grant exists
    return role
