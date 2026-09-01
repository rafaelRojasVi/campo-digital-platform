"""Provider-neutral, content-addressed local object storage.

Domain code must depend only on this module's interface, never on a cloud
SDK. ``LocalObjectStore`` is the V1 (local-dev) implementation; a future
``GCSObjectStore``/``AzureBlobObjectStore``/``S3ObjectStore`` would implement
the same protocol without any product-domain code change.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import BinaryIO, Protocol

_KEY_PATTERN = re.compile(r"^sha256/[0-9a-f]{2}/[0-9a-f]{62}$")
_READ_CHUNK_SIZE = 1024 * 1024


class ObjectStoreError(RuntimeError):
    """Base error for object store operations."""


class ObjectAlreadyExistsWithDifferentContentError(ObjectStoreError):
    """Raised when a content-addressed key already exists with a different size."""


@dataclass(frozen=True, slots=True)
class StoredObject:
    """Identity and metadata for one immutable stored object."""

    key: str
    sha256: str
    byte_size: int
    media_type: str | None


class ObjectStore(Protocol):
    """Provider-neutral interface for immutable, content-addressed storage."""

    def put(self, data: BinaryIO, *, media_type: str | None) -> StoredObject:
        """Store content, returning its content-addressed identity."""

    def open(self, key: str) -> BinaryIO:
        """Open previously stored content for reading."""

    def stat(self, key: str) -> StoredObject:
        """Return metadata for a previously stored object."""

    def exists(self, key: str) -> bool:
        """Return whether a key is present in the store."""


def _sha256_to_key(digest_hex: str) -> str:
    return f"sha256/{digest_hex[:2]}/{digest_hex[2:]}"


class LocalObjectStore:
    """Filesystem-backed content-addressed object store for local development."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "_tmp").mkdir(parents=True, exist_ok=True)

    def put(self, data: BinaryIO, *, media_type: str | None) -> StoredObject:
        """Stream ``data`` to a temp file, hash it, then atomically publish it."""

        tmp_path = self.root / "_tmp" / uuid.uuid4().hex
        digest = sha256()
        byte_size = 0

        try:
            with tmp_path.open("wb") as handle:
                while chunk := data.read(_READ_CHUNK_SIZE):
                    digest.update(chunk)
                    byte_size += len(chunk)
                    handle.write(chunk)

            digest_hex = digest.hexdigest()
            key = _sha256_to_key(digest_hex)
            final_path = self._key_to_path(key)
            final_path.parent.mkdir(parents=True, exist_ok=True)

            if final_path.exists():
                existing_size = final_path.stat().st_size
                if existing_size != byte_size:
                    raise ObjectAlreadyExistsWithDifferentContentError(
                        f"Key {key!r} already exists with byte size "
                        f"{existing_size}, but new content has size {byte_size}."
                    )
            else:
                os.replace(tmp_path, final_path)

            meta_path = self._meta_path(final_path)
            meta_path.write_text(
                json.dumps({"media_type": media_type, "byte_size": byte_size}),
                encoding="utf-8",
            )
        finally:
            tmp_path.unlink(missing_ok=True)

        return StoredObject(
            key=key,
            sha256=digest_hex,
            byte_size=byte_size,
            media_type=media_type,
        )

    def open(self, key: str) -> BinaryIO:
        """Open the content file for a previously stored key."""

        path = self._key_to_path(key)
        if not path.is_file():
            raise ObjectStoreError(f"No object stored for key {key!r}.")
        return path.open("rb")

    def stat(self, key: str) -> StoredObject:
        """Return the stored metadata for ``key`` without reading content."""

        path = self._key_to_path(key)
        if not path.is_file():
            raise ObjectStoreError(f"No object stored for key {key!r}.")

        meta = json.loads(self._meta_path(path).read_text(encoding="utf-8"))
        digest_hex = key.split("/", 1)[1].replace("/", "")

        return StoredObject(
            key=key,
            sha256=digest_hex,
            byte_size=int(meta["byte_size"]),
            media_type=meta["media_type"],
        )

    def exists(self, key: str) -> bool:
        """Return whether ``key`` is safely resolvable and present."""

        try:
            path = self._key_to_path(key)
        except ObjectStoreError:
            return False
        return path.is_file()

    def _key_to_path(self, key: str) -> Path:
        """Resolve ``key`` to a real path strictly beneath the store root.

        Mirrors ``app.source_discovery._resolve_source_file``'s approach:
        validate shape first, walk component-by-component rejecting
        symlinks, then confirm the resolved path stays under the root.
        """

        if not _KEY_PATTERN.match(key):
            raise ObjectStoreError(f"Malformed object key: {key!r}.")

        candidate = self.root
        for part in key.split("/"):
            candidate = candidate / part
            if candidate.is_symlink():
                raise ObjectStoreError("Symbolic links are not accepted in object paths.")

        try:
            resolved = candidate.resolve(strict=False)
            resolved.relative_to(self.root)
        except (OSError, ValueError) as exc:
            raise ObjectStoreError(
                "Object key cannot be resolved safely beneath the root."
            ) from exc

        return resolved

    @staticmethod
    def _meta_path(content_path: Path) -> Path:
        return content_path.with_name(content_path.name + ".meta.json")
