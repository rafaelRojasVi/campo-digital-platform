"""Unit tests for the local filesystem-backed object store."""

from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path

import pytest
from app.object_store import (
    LocalObjectStore,
    ObjectStoreError,
)


@pytest.fixture
def store(tmp_path: Path) -> LocalObjectStore:
    return LocalObjectStore(tmp_path / "object-store")


def test_put_returns_sha256_identity_and_size(store: LocalObjectStore) -> None:
    content = b"hello campo digital"
    result = store.put(io.BytesIO(content), media_type="text/plain")

    assert result.sha256 == hashlib.sha256(content).hexdigest()
    assert result.byte_size == len(content)
    assert result.media_type == "text/plain"


def test_put_is_idempotent_for_identical_content(store: LocalObjectStore) -> None:
    content = b"same bytes"
    first = store.put(io.BytesIO(content), media_type="text/plain")
    second = store.put(io.BytesIO(content), media_type="text/plain")

    assert first.key == second.key


def test_open_returns_original_bytes(store: LocalObjectStore) -> None:
    content = b"round trip content"
    stored = store.put(io.BytesIO(content), media_type=None)

    with store.open(stored.key) as handle:
        assert handle.read() == content


def test_stat_matches_put_result(store: LocalObjectStore) -> None:
    content = b"stat me"
    stored = store.put(io.BytesIO(content), media_type="application/zip")

    stat_result = store.stat(stored.key)
    assert stat_result == stored


def test_exists_false_for_unknown_key(store: LocalObjectStore) -> None:
    assert store.exists("sha256/aa/" + "0" * 62) is False


def test_exists_true_after_put(store: LocalObjectStore) -> None:
    stored = store.put(io.BytesIO(b"exists me"), media_type=None)
    assert store.exists(stored.key) is True


def test_write_is_atomic_no_partial_file_on_crash(
    store: LocalObjectStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failure mid-write must never leave a corrupt object at the final key."""

    original_replace = os.replace

    def failing_replace(*args: object, **kwargs: object) -> None:
        raise OSError("simulated crash before atomic rename")

    monkeypatch.setattr(os, "replace", failing_replace)

    with pytest.raises(OSError):
        store.put(io.BytesIO(b"partial content that must not land"), media_type=None)

    monkeypatch.setattr(os, "replace", original_replace)
    stored = store.put(io.BytesIO(b"partial content that must not land"), media_type=None)
    assert store.exists(stored.key)


def test_key_rejects_path_traversal(store: LocalObjectStore) -> None:
    with pytest.raises(ObjectStoreError):
        store.open("../../etc/passwd")


def test_key_rejects_absolute_path(store: LocalObjectStore) -> None:
    with pytest.raises(ObjectStoreError):
        store.open("/etc/passwd")


def test_key_rejects_malformed_scheme(store: LocalObjectStore) -> None:
    with pytest.raises(ObjectStoreError):
        store.open("not-a-valid-key")


def test_symlink_escape_is_rejected(store: LocalObjectStore, tmp_path: Path) -> None:
    outside = tmp_path / "outside.txt"
    outside.write_text("secret")

    stored = store.put(io.BytesIO(b"placeholder"), media_type=None)
    real_path = store._key_to_path(stored.key)
    real_path.unlink()
    real_path.symlink_to(outside)

    with pytest.raises(ObjectStoreError):
        store.open(stored.key)


def test_different_content_produces_different_keys(store: LocalObjectStore) -> None:
    first = store.put(io.BytesIO(b"content one"), media_type=None)
    second = store.put(io.BytesIO(b"content two"), media_type=None)
    assert first.key != second.key
