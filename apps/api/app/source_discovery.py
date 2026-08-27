"""Read-only filesystem discovery and SHA-256 fingerprinting."""

from __future__ import annotations

import hashlib
import mimetypes
import os
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath


class SourceDiscoveryError(RuntimeError):
    """Base error for source filesystem discovery."""


class SourceRootError(SourceDiscoveryError):
    """Raised when the configured source root is unusable."""


class UnsafeSourcePathError(SourceDiscoveryError):
    """Raised when a source path escapes or uses unsafe indirection."""


class SourceFileChangedError(SourceDiscoveryError):
    """Raised when a source file changes while it is being fingerprinted."""


@dataclass(frozen=True, slots=True)
class SourceFileObservation:
    """Read-only metadata observed for one source file."""

    relative_path: str
    filename: str
    byte_size: int
    observed_at: datetime
    source_modified_at: datetime
    media_type: str | None


@dataclass(frozen=True, slots=True)
class SourceFileFingerprint:
    """Immutable SHA-256 identity for observed source content."""

    relative_path: str
    content_sha256: str
    byte_size: int


def source_root_from_environment(
    env: Mapping[str, str] | None = None,
) -> Path:
    """Resolve CAMPO_DIGITAL_SOURCE_ROOT without modifying it."""

    values = os.environ if env is None else env
    raw_root = values.get("CAMPO_DIGITAL_SOURCE_ROOT", "").strip()

    if not raw_root:
        raise SourceRootError(
            "CAMPO_DIGITAL_SOURCE_ROOT is not configured",
        )

    return _validated_root(Path(raw_root))


def observe_source_file(
    root: Path,
    relative_path: str,
) -> SourceFileObservation:
    """Observe metadata for one regular source file."""

    root_path = _validated_root(root)
    source_path = _resolve_source_file(root_path, relative_path)

    try:
        stat_result = source_path.stat()
    except OSError as exc:
        raise SourceDiscoveryError(
            "Unable to stat source file",
        ) from exc

    media_type, _ = mimetypes.guess_type(
        relative_path,
        strict=False,
    )

    return SourceFileObservation(
        relative_path=relative_path,
        filename=source_path.name,
        byte_size=stat_result.st_size,
        observed_at=datetime.now(UTC),
        source_modified_at=datetime.fromtimestamp(
            stat_result.st_mtime,
            tz=UTC,
        ),
        media_type=media_type,
    )


def discover_source_files(
    root: Path,
) -> tuple[SourceFileObservation, ...]:
    """Recursively discover regular files beneath the source root."""

    root_path = _validated_root(root)
    observations: list[SourceFileObservation] = []

    def raise_walk_error(error: OSError) -> None:
        raise error

    try:
        for directory, directory_names, filenames in os.walk(
            root_path,
            topdown=True,
            onerror=raise_walk_error,
            followlinks=False,
        ):
            current = Path(directory)

            for directory_name in directory_names:
                candidate = current / directory_name

                if candidate.is_symlink():
                    raise UnsafeSourcePathError(
                        "Source tree contains a symbolic-link directory",
                    )

            for filename in sorted(filenames):
                candidate = current / filename

                if candidate.is_symlink():
                    raise UnsafeSourcePathError(
                        "Source tree contains a symbolic-link file",
                    )

                if not candidate.is_file():
                    continue

                relative_path = candidate.relative_to(
                    root_path,
                ).as_posix()

                observations.append(
                    observe_source_file(
                        root_path,
                        relative_path,
                    )
                )
    except SourceDiscoveryError:
        raise
    except OSError as exc:
        raise SourceDiscoveryError(
            "Unable to discover source tree",
        ) from exc

    return tuple(
        sorted(
            observations,
            key=lambda observation: observation.relative_path,
        )
    )


def fingerprint_source_file(
    root: Path,
    relative_path: str,
    *,
    chunk_size: int = 1024 * 1024,
) -> SourceFileFingerprint:
    """Compute SHA-256 while detecting concurrent file changes."""

    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")

    root_path = _validated_root(root)
    source_path = _resolve_source_file(
        root_path,
        relative_path,
    )

    digest = hashlib.sha256()
    bytes_read = 0

    try:
        with source_path.open("rb") as handle:
            before = os.fstat(handle.fileno())

            while chunk := handle.read(chunk_size):
                digest.update(chunk)
                bytes_read += len(chunk)

            after_handle = os.fstat(handle.fileno())

        after_path = source_path.stat()
    except OSError as exc:
        raise SourceDiscoveryError(
            "Unable to fingerprint source file",
        ) from exc

    identity_before = (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
    )
    identity_after_handle = (
        after_handle.st_dev,
        after_handle.st_ino,
        after_handle.st_size,
        after_handle.st_mtime_ns,
    )
    identity_after_path = (
        after_path.st_dev,
        after_path.st_ino,
        after_path.st_size,
        after_path.st_mtime_ns,
    )

    if (
        identity_before != identity_after_handle
        or identity_after_handle != identity_after_path
        or bytes_read != after_handle.st_size
    ):
        raise SourceFileChangedError(
            "Source file changed while being fingerprinted",
        )

    return SourceFileFingerprint(
        relative_path=relative_path,
        content_sha256=digest.hexdigest(),
        byte_size=bytes_read,
    )


def _validated_root(root: Path) -> Path:
    try:
        resolved = root.expanduser().resolve(strict=True)
    except OSError as exc:
        raise SourceRootError(
            "Source root does not exist or cannot be resolved",
        ) from exc

    if not resolved.is_dir():
        raise SourceRootError(
            "Source root must be a directory",
        )

    return resolved


def _resolve_source_file(
    root: Path,
    relative_path: str,
) -> Path:
    if not relative_path or "\\" in relative_path:
        raise UnsafeSourcePathError(
            "Source path must be a normalized relative POSIX path",
        )

    parsed = PurePosixPath(relative_path)

    if parsed.is_absolute() or ".." in parsed.parts or parsed.as_posix() != relative_path:
        raise UnsafeSourcePathError(
            "Source path must remain beneath the source root",
        )

    candidate = root
    for part in parsed.parts:
        candidate = candidate / part

        if candidate.is_symlink():
            raise UnsafeSourcePathError(
                "Symbolic links are not accepted as source paths",
            )

    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError) as exc:
        raise UnsafeSourcePathError(
            "Source path cannot be resolved safely beneath the root",
        ) from exc

    if not resolved.is_file():
        raise UnsafeSourcePathError(
            "Source path must resolve to a regular file",
        )

    return resolved
