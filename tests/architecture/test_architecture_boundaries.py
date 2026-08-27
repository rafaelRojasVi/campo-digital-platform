"""Tests for executable repository architecture rules."""

from __future__ import annotations

from pathlib import Path

from scripts.check_architecture_boundaries import (
    check_product_source_file,
    discover_product_packages,
)


def write_source(
    tmp_path: Path,
    relative_path: str,
    content: str,
) -> Path:
    path = tmp_path / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def test_repository_product_packages_are_discovered() -> None:
    products = discover_product_packages()

    assert "lidar" in products
    assert "lidar_core" in products["lidar"]
    assert "lidar_io" in products["lidar"]
    assert "lidar_volume" in products["lidar"]


def test_product_source_rejects_fastapi(
    tmp_path: Path,
) -> None:
    path = write_source(
        tmp_path,
        "module.py",
        "from fastapi import APIRouter\n",
    )

    violations = check_product_source_file(
        path,
        product_name="lidar",
        product_packages={
            "lidar": {"lidar_core"},
        },
    )

    assert len(violations) == 1
    assert "FastAPI" in violations[0].message


def test_product_source_rejects_api_application_import(
    tmp_path: Path,
) -> None:
    path = write_source(
        tmp_path,
        "module.py",
        "from app.database import build_engine\n",
    )

    violations = check_product_source_file(
        path,
        product_name="lidar",
        product_packages={
            "lidar": {"lidar_core"},
        },
    )

    assert len(violations) == 1
    assert "API application" in violations[0].message


def test_product_source_rejects_other_product_package(
    tmp_path: Path,
) -> None:
    path = write_source(
        tmp_path,
        "module.py",
        "from forestry_core.models import Parcel\n",
    )

    violations = check_product_source_file(
        path,
        product_name="lidar",
        product_packages={
            "lidar": {"lidar_core"},
            "forestry": {"forestry_core"},
        },
    )

    assert len(violations) == 1
    assert "forestry_core" in violations[0].message


def test_same_product_packages_are_allowed(
    tmp_path: Path,
) -> None:
    path = write_source(
        tmp_path,
        "module.py",
        (
            "from lidar_core.models import MeasurementRun\n"
            "from lidar_volume.base import VolumeEstimator\n"
        ),
    )

    violations = check_product_source_file(
        path,
        product_name="lidar",
        product_packages={
            "lidar": {
                "lidar_core",
                "lidar_volume",
            },
        },
    )

    assert violations == []


def test_repository_has_no_architecture_violations() -> None:
    from scripts.check_architecture_boundaries import collect_violations

    assert collect_violations() == []
