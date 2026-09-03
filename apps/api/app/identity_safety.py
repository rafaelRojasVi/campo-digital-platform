"""Safety guard for production startup with an incomplete identity provider.

Mirrors app.db_safety's shape: a small, explicit precondition checked once
at startup rather than discovered later as a confusing runtime 503 on the
first real sign-in attempt.
"""

from __future__ import annotations

from app.config import Settings


class ProductionIdentityNotConfiguredError(RuntimeError):
    """Production is missing configuration required to authenticate anyone."""


def require_production_identity_configuration(settings: Settings) -> None:
    """Require Entra credentials and a token-encryption key in production.

    Every other APP_ENV may run with these unset: development and test never
    reach app.routers.entra_auth in practice, and staging is documented
    (ADR-006) as having no working sign-in yet until this same configuration
    is supplied there too -- this guard only fails closed for production,
    where "no way to authenticate anyone" must block startup, not surface
    later as an unexplained 503 on first sign-in.
    """

    if settings.app_env != "production":
        return

    missing = [
        name
        for name, value in (
            ("ENTRA_CLIENT_ID", settings.entra_client_id),
            ("ENTRA_CLIENT_SECRET", settings.entra_client_secret),
            ("PLATFORM_TOKEN_ENCRYPTION_KEY", settings.platform_token_encryption_key),
        )
        if not value
    ]
    if missing:
        raise ProductionIdentityNotConfiguredError(
            "APP_ENV=production requires identity configuration that is missing: "
            + ", ".join(missing)
        )
