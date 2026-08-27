"""Tests for read-only source filesystem discovery."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from app.source_discovery import (
    SourceRootError,
    UnsafeSourcePathError,
    discover_source_files,
    fingerprint_source_file,
    observe_source_file,
    source_root_from_environment,
)


def test_source_root_from_environment_requires_configuration(
    tmp_path: Path,
) -> None:
    with pytest.raises(SourceRootError):
        source_root_from_environment({})

    root = source_root_from_environment({"CAMPO_DIGITAL_SOURCE_ROOT": str(tmp_path)})

    assert root == tmp_path.resolve()


def test_source_root_rejects_regular_file(
    tmp_path: Path,
) -> None:
    source_file = tmp_path / "not-a-root.txt"
    source_file.write_text("content", encoding="utf-8")

    with pytest.raises(SourceRootError):
        source_root_from_environment({"CAMPO_DIGITAL_SOURCE_ROOT": str(source_file)})


def test_discovery_is_recursive_and_deterministic(
    tmp_path: Path,
) -> None:
    nested = tmp_path / "nested"
    nested.mkdir()

    (tmp_path / "b.txt").write_text("b", encoding="utf-8")
    (tmp_path / "a.txt").write_text("a", encoding="utf-8")
    (nested / "c.bin").write_bytes(b"ccc")

    observations = discover_source_files(tmp_path)

    assert [observation.relative_path for observation in observations] == [
        "a.txt",
        "b.txt",
        "nested/c.bin",
    ]


def test_observation_records_relative_metadata(
    tmp_path: Path,
) -> None:
    nested = tmp_path / "folder"
    nested.mkdir()

    source_file = nested / "sample.txt"
    source_file.write_bytes(b"campo")

    observation = observe_source_file(
        tmp_path,
        "folder/sample.txt",
    )

    assert observation.relative_path == "folder/sample.txt"
    assert observation.filename == "sample.txt"
    assert observation.byte_size == 5
    assert observation.media_type == "text/plain"
    assert observation.observed_at.tzinfo is not None
    assert observation.source_modified_at.tzinfo is not None


def test_fingerprint_uses_sha256(
    tmp_path: Path,
) -> None:
    content = b"campo-digital-source"
    source_file = tmp_path / "sample.bin"
    source_file.write_bytes(content)

    fingerprint = fingerprint_source_file(
        tmp_path,
        "sample.bin",
        chunk_size=3,
    )

    assert fingerprint.relative_path == "sample.bin"
    assert fingerprint.byte_size == len(content)
    assert fingerprint.content_sha256 == hashlib.sha256(content).hexdigest()


@pytest.mark.parametrize(
    "relative_path",
    [
        "../outside.txt",
        "/absolute.txt",
        "./sample.txt",
        "folder//sample.txt",
        r"folder\sample.txt",
    ],
)
def test_source_paths_must_be_normalized_and_relative(
    tmp_path: Path,
    relative_path: str,
) -> None:
    (tmp_path / "sample.txt").write_text(
        "sample",
        encoding="utf-8",
    )

    with pytest.raises(UnsafeSourcePathError):
        fingerprint_source_file(
            tmp_path,
            relative_path,
        )


def test_discovery_refuses_symbolic_links(
    tmp_path: Path,
) -> None:
    real_file = tmp_path / "real.txt"
    real_file.write_text("real", encoding="utf-8")

    symlink = tmp_path / "alias.txt"
    symlink.symlink_to(real_file)

    with pytest.raises(UnsafeSourcePathError):
        discover_source_files(tmp_path)


def test_fingerprint_refuses_symbolic_link(
    tmp_path: Path,
) -> None:
    real_file = tmp_path / "real.txt"
    real_file.write_text("real", encoding="utf-8")

    symlink = tmp_path / "alias.txt"
    symlink.symlink_to(real_file)

    with pytest.raises(UnsafeSourcePathError):
        fingerprint_source_file(
            tmp_path,
            "alias.txt",
        )


def test_fingerprint_detects_file_change_during_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_file = tmp_path / "changing.bin"
    source_file.write_bytes(b"campo-digital")

    from app import source_discovery

    real_fstat = source_discovery.os.fstat
    call_count = 0

    def changing_fstat(fd: int):
        nonlocal call_count

        result = real_fstat(fd)
        call_count += 1

        if call_count == 2:

            class ChangedStat:
                st_dev = result.st_dev
                st_ino = result.st_ino
                st_size = result.st_size + 1
                st_mtime_ns = result.st_mtime_ns

            return ChangedStat()

        return result

    monkeypatch.setattr(
        source_discovery.os,
        "fstat",
        changing_fstat,
    )

    with pytest.raises(source_discovery.SourceFileChangedError):
        fingerprint_source_file(
            tmp_path,
            "changing.bin",
            chunk_size=3,
        )

    assert call_count >= 2
