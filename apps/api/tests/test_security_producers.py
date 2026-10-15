"""Each refusal raises SecurityHTTPException with the right note."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from app import deps
from app.access import Action, Role
from app.google_auth import GoogleDomainNotAllowedError, GoogleSignInError
from app.security_events import SecurityHTTPException


def test_domain_error_is_a_sign_in_error() -> None:
    assert issubclass(GoogleDomainNotAllowedError, GoogleSignInError)


@pytest.mark.parametrize(
    ("role", "reason"),
    [(None, "no_grant"), (Role.VIEWER, "action_not_allowed")],
)
def test_ensure_can_raises_with_note(
    monkeypatch: pytest.MonkeyPatch, role: Role | None, reason: str
) -> None:
    monkeypatch.setattr(deps, "get_product_role", lambda *a, **k: role)
    with pytest.raises(SecurityHTTPException) as caught:
        deps.ensure_can(MagicMock(), app_user_id=7, product_key="forestry", action=Action.PUBLISH)
    exc = caught.value
    assert exc.status_code == 403
    assert exc.detail == "Not permitted for this product."
    assert (
        exc.note.event_type,
        exc.note.reason,
        exc.note.product_key,
        exc.note.actor_app_user_id,
    ) == (
        "access.denied",
        reason,
        "forestry",
        7,
    )
