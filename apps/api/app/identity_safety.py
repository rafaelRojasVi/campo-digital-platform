"""Safety guard for production startup with incomplete Google sign-in configuration.

Mirrors app.db_safety's shape: a small, explicit precondition checked once
at startup rather than discovered later as a confusing runtime 503 (or 500)
on the first real sign-in attempt.
"""

from __future__ import annotations

from cryptography.fernet import Fernet

from app.config import Settings


class ProductionIdentityNotConfiguredError(RuntimeError):
    """Production is missing configuration required to authenticate anyone."""


def _is_fernet_key(value: str) -> bool:
    try:
        Fernet(value.encode("utf-8"))
    except ValueError:
        return False
    return True


def require_production_identity_configuration(settings: Settings) -> None:
    """Require complete, well-formed Google Workspace sign-in configuration.

    Under ``APP_ENV=production`` this requires:

    - ``GOOGLE_CLIENT_ID`` and ``GOOGLE_CLIENT_SECRET``;
    - ``PLATFORM_TOKEN_ENCRYPTION_KEY``, a valid Fernet key (the sign-in flow
      cookie is encrypted with it; a malformed key would otherwise surface
      as a 500 on every sign-in);
    - ``GOOGLE_REDIRECT_BASE_URL`` over ``https://`` (the localhost default
      can never match a production OAuth client's redirect URI);
    - the bootstrap pair ``PLATFORM_BOOTSTRAP_ADMIN_EMAIL`` /
      ``PLATFORM_BOOTSTRAP_ADMIN_PRODUCTS`` either both set or both unset --
      one without the other silently grants nothing.

    Every other APP_ENV may run with all of this unset: development offers
    dev-login, and staging simply has no working Google sign-in until the
    same configuration is supplied there (each sign-in route answers 503).
    """

    if settings.app_env != "production":
        return

    problems: list[str] = []

    if not settings.google_client_id:
        problems.append("GOOGLE_CLIENT_ID is not set")
    if not settings.google_client_secret:
        problems.append("GOOGLE_CLIENT_SECRET is not set")

    key = settings.platform_token_encryption_key
    if key is None or not key.get_secret_value():
        problems.append("PLATFORM_TOKEN_ENCRYPTION_KEY is not set")
    elif not _is_fernet_key(key.get_secret_value()):
        problems.append("PLATFORM_TOKEN_ENCRYPTION_KEY is not a valid Fernet key")

    if not settings.google_redirect_base_url.startswith("https://"):
        problems.append("GOOGLE_REDIRECT_BASE_URL must be an https:// origin")

    has_bootstrap_email = bool(settings.platform_bootstrap_admin_email)
    has_bootstrap_products = bool(settings.bootstrap_admin_product_keys)
    if has_bootstrap_email != has_bootstrap_products:
        problems.append(
            "PLATFORM_BOOTSTRAP_ADMIN_EMAIL and PLATFORM_BOOTSTRAP_ADMIN_PRODUCTS "
            "must be set together or not at all"
        )

    if problems:
        # Names only; never echoes a configured value.
        raise ProductionIdentityNotConfiguredError(
            "APP_ENV=production requires Google sign-in configuration: " + "; ".join(problems)
        )
