"""Symmetric encryption for short-lived secrets the platform must round-trip.

Used for the Google sign-in flow cookie (``app.routers.google_auth``).

Uses Fernet (AES-128-CBC + HMAC-SHA256, authenticated) rather than a custom
scheme. The key is ``Settings.platform_token_encryption_key`` — a Fernet key
(32 url-safe base64-encoded bytes, e.g. ``Fernet.generate_key()``).
"""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken


class TokenDecryptionError(RuntimeError):
    """Raised when stored ciphertext cannot be decrypted with the configured key."""


def encrypt_token(raw_value: str, *, key: str) -> bytes:
    """Encrypt ``raw_value`` with the configured Fernet key."""

    return Fernet(key.encode("utf-8")).encrypt(raw_value.encode("utf-8"))


def decrypt_token(ciphertext: bytes, *, key: str) -> str:
    """Recover the plaintext, or raise if the key/ciphertext don't match."""

    try:
        return Fernet(key.encode("utf-8")).decrypt(ciphertext).decode("utf-8")
    except InvalidToken as exc:
        raise TokenDecryptionError(
            "Ciphertext could not be decrypted with the configured key."
        ) from exc
