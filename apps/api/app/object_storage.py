"""Private, content-addressed object storage for large binary sources.

Canonical direction: `docs/platform/production-platform-v1.md` requires that
PostgreSQL never hold workbook binaries. This module stores those bytes
outside PostgreSQL, addressed by their SHA-256 content hash, behind a small
provider-neutral interface with a local-filesystem backend (dev/tests) and a
Cloud Storage backend (hosted pilot).
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Protocol

DEFAULT_LOCAL_ROOT = "var/transelec-object-store"


class ObjectStorageError(RuntimeError):
    """Raised when an object cannot be stored or retrieved."""


class ObjectStore(Protocol):
    """Minimal content-addressed put/get contract used by product code."""

    def put(self, key: str, content: bytes) -> None:
        """Store content at `key`. Storing the same key twice is a no-op."""

    def get(self, key: str) -> bytes:
        """Return previously stored content for `key`."""


def content_addressed_key(*, namespace: str, content_sha256: str, suffix: str) -> str:
    """Build a stable, human-legible content-addressed object key."""

    if not content_sha256:
        raise ValueError("content_sha256 is required")

    return f"{namespace}/sha256/{content_sha256[:2]}/{content_sha256}{suffix}"


class LocalFilesystemObjectStore:
    """Development/test backend: content-addressed files under a root dir."""

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    def put(self, key: str, content: bytes) -> None:
        path = self._resolve(key)

        if path.exists():
            return

        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = path.with_name(f"{path.name}.tmp-{os.getpid()}")
        temporary_path.write_bytes(content)
        temporary_path.replace(path)

    def get(self, key: str) -> bytes:
        path = self._resolve(key)

        try:
            return path.read_bytes()
        except OSError as exc:
            raise ObjectStorageError(f"Object not found for key: {key}") from exc

    def _resolve(self, key: str) -> Path:
        if not key or key.startswith("/") or ".." in Path(key).parts:
            raise ObjectStorageError(f"Unsafe object key: {key!r}")

        candidate = (self._root / key).resolve()

        if candidate != self._root and self._root not in candidate.parents:
            raise ObjectStorageError(f"Object key escapes the storage root: {key!r}")

        return candidate


class GcsObjectStore:
    """Hosted-pilot backend: a private Cloud Storage bucket.

    `google-cloud-storage` is intentionally not a pinned project dependency —
    it is installed only in the production container image (see the
    deployment runbook) so that local development and CI never need Google
    Cloud credentials or network access.
    """

    def __init__(self, bucket_name: str) -> None:
        if not bucket_name:
            raise ObjectStorageError("A Cloud Storage bucket name is required")

        self._bucket_name = bucket_name
        self._bucket: object | None = None

    def _resolved_bucket(self) -> object:
        if self._bucket is None:
            try:
                from google.cloud import storage
            except ImportError as exc:
                raise ObjectStorageError(
                    "The 'gcs' object store backend requires google-cloud-storage "
                    "to be installed in this runtime; see the deployment runbook."
                ) from exc

            self._bucket = storage.Client().bucket(self._bucket_name)

        return self._bucket

    def put(self, key: str, content: bytes) -> None:
        blob = self._resolved_bucket().blob(key)  # type: ignore[attr-defined]

        if blob.exists():
            return

        blob.upload_from_string(content)

    def get(self, key: str) -> bytes:
        blob = self._resolved_bucket().blob(key)  # type: ignore[attr-defined]

        try:
            content: bytes = blob.download_as_bytes()
        except Exception as exc:  # pragma: no cover - depends on GCS client errors
            raise ObjectStorageError(f"Object not found for key: {key}") from exc

        return content


def _local_root_from_environment() -> Path:
    configured = os.environ.get("CAMPO_OBJECT_STORE_LOCAL_ROOT", "").strip()
    return Path(configured) if configured else Path(DEFAULT_LOCAL_ROOT)


@lru_cache
def get_object_store() -> ObjectStore:
    """Return the process-level object store selected by environment."""

    backend = os.environ.get("CAMPO_OBJECT_STORE_BACKEND", "local").strip().lower()

    if backend == "local":
        return LocalFilesystemObjectStore(_local_root_from_environment())

    if backend == "gcs":
        bucket_name = os.environ.get("CAMPO_OBJECT_STORE_GCS_BUCKET", "").strip()
        return GcsObjectStore(bucket_name)

    raise ObjectStorageError(f"Unknown CAMPO_OBJECT_STORE_BACKEND: {backend!r}")
