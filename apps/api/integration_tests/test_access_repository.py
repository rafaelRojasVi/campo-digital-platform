"""Integration tests for access repository persistence."""

from __future__ import annotations

from app.access import Role
from app.access_repository import (
    get_product_role,
    grant_product_role,
    list_grants_for_user,
    maybe_grant_bootstrap_admin,
    resolve_or_create_app_user,
)
from app.config import Settings
from sqlalchemy import Connection


def test_resolve_or_create_is_idempotent(integration_connection: Connection) -> None:
    first = resolve_or_create_app_user(
        integration_connection,
        identity_kind="dev-local",
        identity_key="alice",
        display_name="Alice",
    )
    second = resolve_or_create_app_user(
        integration_connection,
        identity_kind="dev-local",
        identity_key="alice",
        display_name="Alice",
    )
    assert first.id == second.id


def test_grant_and_get_product_role_round_trip(integration_connection: Connection) -> None:
    user = resolve_or_create_app_user(
        integration_connection, identity_kind="dev-local", identity_key="bob", display_name="Bob"
    )
    grant_product_role(
        integration_connection, app_user_id=user.id, product_key="forestry", role=Role.OPERATOR
    )

    assert (
        get_product_role(integration_connection, app_user_id=user.id, product_key="forestry")
        is Role.OPERATOR
    )
    assert (
        get_product_role(integration_connection, app_user_id=user.id, product_key="lidar") is None
    )


def test_grant_product_role_is_idempotent_and_updates_role(
    integration_connection: Connection,
) -> None:
    user = resolve_or_create_app_user(
        integration_connection, identity_kind="dev-local", identity_key="eve", display_name="Eve"
    )
    grant_product_role(
        integration_connection, app_user_id=user.id, product_key="lidar", role=Role.VIEWER
    )
    grant_product_role(
        integration_connection, app_user_id=user.id, product_key="lidar", role=Role.ADMIN
    )

    assert (
        get_product_role(integration_connection, app_user_id=user.id, product_key="lidar")
        is Role.ADMIN
    )


def test_product_isolation_grant_on_one_product_does_not_leak(
    integration_connection: Connection,
) -> None:
    user = resolve_or_create_app_user(
        integration_connection,
        identity_kind="dev-local",
        identity_key="carol",
        display_name="Carol",
    )
    grant_product_role(
        integration_connection, app_user_id=user.id, product_key="lidar", role=Role.VIEWER
    )

    assert (
        get_product_role(integration_connection, app_user_id=user.id, product_key="transelect")
        is None
    )
    grants = list_grants_for_user(integration_connection, app_user_id=user.id)
    assert {g.product_key for g in grants} == {"lidar"}


def _bootstrap_settings() -> Settings:
    return Settings(
        postgres_password="x",
        platform_bootstrap_admin_tenant_id="tenant-x",
        platform_bootstrap_admin_object_id="oid-y",
    )


def test_bootstrap_grants_admin_on_all_products_for_matching_identity(
    integration_connection: Connection,
) -> None:
    user = resolve_or_create_app_user(
        integration_connection,
        identity_kind="entra",
        identity_key="tenant-x:oid-y",
        display_name="Bootstrap Admin",
    )

    granted = maybe_grant_bootstrap_admin(
        integration_connection,
        settings=_bootstrap_settings(),
        tenant_id="tenant-x",
        object_id="oid-y",
        app_user_id=user.id,
    )

    assert granted is True
    grants = {
        g.product_key: g.role.value
        for g in list_grants_for_user(integration_connection, app_user_id=user.id)
    }
    assert grants == {"lidar": "admin", "forestry": "admin", "transelect": "admin"}


def test_bootstrap_does_not_fire_for_non_matching_identity(
    integration_connection: Connection,
) -> None:
    user = resolve_or_create_app_user(
        integration_connection,
        identity_kind="entra",
        identity_key="tenant-x:someone-else",
        display_name="Regular User",
    )

    granted = maybe_grant_bootstrap_admin(
        integration_connection,
        settings=_bootstrap_settings(),
        tenant_id="tenant-x",
        object_id="someone-else",
        app_user_id=user.id,
    )

    assert granted is False
    assert list_grants_for_user(integration_connection, app_user_id=user.id) == ()


def test_bootstrap_does_not_fire_if_user_already_has_a_grant(
    integration_connection: Connection,
) -> None:
    user = resolve_or_create_app_user(
        integration_connection,
        identity_kind="entra",
        identity_key="tenant-x:oid-y",
        display_name="Bootstrap Admin",
    )
    grant_product_role(
        integration_connection, app_user_id=user.id, product_key="forestry", role=Role.VIEWER
    )

    granted = maybe_grant_bootstrap_admin(
        integration_connection,
        settings=_bootstrap_settings(),
        tenant_id="tenant-x",
        object_id="oid-y",
        app_user_id=user.id,
    )

    assert granted is False
    grants = {
        g.product_key: g.role.value
        for g in list_grants_for_user(integration_connection, app_user_id=user.id)
    }
    assert grants == {"forestry": "viewer"}
