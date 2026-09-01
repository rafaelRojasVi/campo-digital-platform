"""Persistence adapter for platform access (users and product grants)."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Connection, text

from app.access import Role
from app.config import Settings


@dataclass(frozen=True, slots=True)
class AppUser:
    """Identity-mapped platform user."""

    id: int
    identity_kind: str
    identity_key: str
    display_name: str
    email: str | None


@dataclass(frozen=True, slots=True)
class ProductGrant:
    """One user's role for one product."""

    product_key: str
    role: Role


def resolve_or_create_app_user(
    connection: Connection,
    *,
    identity_kind: str,
    identity_key: str,
    display_name: str,
) -> AppUser:
    """Resolve an existing user by identity, or create one idempotently."""

    parameters = {
        "identity_kind": identity_kind,
        "identity_key": identity_key,
        "display_name": display_name,
    }

    inserted = connection.execute(
        text(
            """
            INSERT INTO platform.app_user (identity_kind, identity_key, display_name)
            VALUES (:identity_kind, :identity_key, :display_name)
            ON CONFLICT (identity_kind, identity_key) DO NOTHING
            RETURNING id, identity_kind, identity_key, display_name, email
            """
        ),
        parameters,
    ).one_or_none()

    row = (
        inserted
        or connection.execute(
            text(
                """
            SELECT id, identity_kind, identity_key, display_name, email
            FROM platform.app_user
            WHERE identity_kind = :identity_kind
              AND identity_key = :identity_key
            """
            ),
            parameters,
        ).one()
    )

    return AppUser(
        id=row.id,
        identity_kind=row.identity_kind,
        identity_key=row.identity_key,
        display_name=row.display_name,
        email=row.email,
    )


def grant_product_role(
    connection: Connection,
    *,
    app_user_id: int,
    product_key: str,
    role: Role,
) -> None:
    """Grant (or update) one user's role for one product."""

    connection.execute(
        text(
            """
            INSERT INTO platform.product_grant (app_user_id, product_key, role)
            VALUES (:app_user_id, :product_key, :role)
            ON CONFLICT (app_user_id, product_key)
            DO UPDATE SET role = EXCLUDED.role
            """
        ),
        {
            "app_user_id": app_user_id,
            "product_key": product_key,
            "role": role.value,
        },
    )


def get_product_role(
    connection: Connection,
    *,
    app_user_id: int,
    product_key: str,
) -> Role | None:
    """Return the caller's role for one product, or None if ungranted."""

    role_value = connection.execute(
        text(
            """
            SELECT role
            FROM platform.product_grant
            WHERE app_user_id = :app_user_id
              AND product_key = :product_key
            """
        ),
        {"app_user_id": app_user_id, "product_key": product_key},
    ).scalar_one_or_none()

    return Role(role_value) if role_value is not None else None


def list_grants_for_user(
    connection: Connection,
    *,
    app_user_id: int,
) -> tuple[ProductGrant, ...]:
    """Return every product grant held by a user."""

    rows = connection.execute(
        text(
            """
            SELECT product_key, role
            FROM platform.product_grant
            WHERE app_user_id = :app_user_id
            ORDER BY product_key
            """
        ),
        {"app_user_id": app_user_id},
    ).all()

    return tuple(ProductGrant(product_key=row.product_key, role=Role(row.role)) for row in rows)


_BOOTSTRAP_PRODUCT_KEYS = ("lidar", "forestry", "transelect")


def maybe_grant_bootstrap_admin(
    connection: Connection,
    *,
    settings: Settings,
    tenant_id: str,
    object_id: str,
    app_user_id: int,
) -> bool:
    """Grant one-time bootstrap ADMIN if this identity matches config and holds no grants."""

    configured_tenant = settings.platform_bootstrap_admin_tenant_id
    configured_object = settings.platform_bootstrap_admin_object_id
    if not configured_tenant or not configured_object:
        return False
    if configured_tenant != tenant_id or configured_object != object_id:
        return False
    if list_grants_for_user(connection, app_user_id=app_user_id):
        return False

    for product_key in _BOOTSTRAP_PRODUCT_KEYS:
        grant_product_role(connection, app_user_id=app_user_id, product_key=product_key, role=Role.ADMIN)
    return True
