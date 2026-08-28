from __future__ import annotations

from pathlib import Path

import pytest
from app.object_storage import (
    GcsObjectStore,
    LocalFilesystemObjectStore,
    ObjectStorageError,
    content_addressed_key,
)


def test_gcs_store_requires_a_bucket_name() -> None:
    with pytest.raises(ObjectStorageError):
        GcsObjectStore("")


def test_gcs_store_raises_clear_error_when_sdk_missing() -> None:
    store = GcsObjectStore("some-bucket")

    with pytest.raises(ObjectStorageError, match="google-cloud-storage"):
        store.put("k", b"v")


def test_content_addressed_key_is_stable_and_shard_prefixed() -> None:
    key = content_addressed_key(
        namespace="transelec/workbooks",
        content_sha256="abcd" * 16,
        suffix=".xlsx",
    )

    assert key == f"transelec/workbooks/sha256/ab/{'abcd' * 16}.xlsx"


def test_content_addressed_key_requires_a_hash() -> None:
    with pytest.raises(ValueError):
        content_addressed_key(namespace="ns", content_sha256="", suffix=".xlsx")


def test_local_store_put_then_get_round_trips(tmp_path: Path) -> None:
    store = LocalFilesystemObjectStore(tmp_path / "objects")
    key = content_addressed_key(
        namespace="transelec/workbooks",
        content_sha256="ff" * 32,
        suffix=".xlsx",
    )

    store.put(key, b"hello workbook")

    assert store.get(key) == b"hello workbook"


def test_local_store_put_is_idempotent_and_does_not_overwrite(tmp_path: Path) -> None:
    store = LocalFilesystemObjectStore(tmp_path / "objects")
    key = "transelec/workbooks/sha256/aa/aaaa.xlsx"

    store.put(key, b"first")
    store.put(key, b"second")

    assert store.get(key) == b"first"


def test_local_store_get_missing_key_raises(tmp_path: Path) -> None:
    store = LocalFilesystemObjectStore(tmp_path / "objects")

    with pytest.raises(ObjectStorageError):
        store.get("transelec/workbooks/sha256/00/missing.xlsx")


def test_local_store_rejects_path_traversal(tmp_path: Path) -> None:
    store = LocalFilesystemObjectStore(tmp_path / "objects")

    with pytest.raises(ObjectStorageError):
        store.put("../escape.xlsx", b"nope")

    with pytest.raises(ObjectStorageError):
        store.get("../escape.xlsx")
