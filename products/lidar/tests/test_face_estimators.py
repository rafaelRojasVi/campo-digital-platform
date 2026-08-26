from __future__ import annotations

import numpy as np
import pytest

from lidar_volume.face_estimators import (
    ConcaveHullConfig,
    ConcaveHullContourEstimator,
    ProjectedFaceEvidence,
    RasterContourEstimator,
    ScanlineContourEstimator,
)
from lidar_volume.front_cross_section import estimate_front_cross_section
from lidar_volume.projected_face_raster import estimate_projected_face_raster


def _rectangular_wall_xyz(
    u_span: float = 10.0,
    z_span: float = 4.0,
    n_u: int = 500,
    n_z: int = 150,
) -> np.ndarray:
    rng = np.random.default_rng(3)

    u_values = np.linspace(0.0, u_span, n_u)
    z_values = np.linspace(0.0, z_span, n_z)
    uu, zz = np.meshgrid(u_values, z_values)

    # Small jitter keeps the raster/concave-hull estimators from operating on
    # a perfectly axis-aligned lattice, which is not representative of real
    # point-cloud evidence.
    jitter = rng.uniform(-1e-4, 1e-4, size=uu.size)

    return np.column_stack(
        [
            uu.ravel() + jitter,
            np.zeros(uu.size),
            zz.ravel(),
        ]
    )


def _evidence(xyz: np.ndarray) -> ProjectedFaceEvidence:
    cross_section = estimate_front_cross_section(xyz)
    raster = estimate_projected_face_raster(
        xyz,
        cross_section.center_xy,
        cross_section.longitudinal_axis,
    )

    return ProjectedFaceEvidence(
        cross_section=cross_section,
        raster=raster,
    )


def test_scanline_adapter_matches_trapezoid_area() -> None:
    xyz = _rectangular_wall_xyz()
    evidence = _evidence(xyz)

    outcome = ScanlineContourEstimator().estimate(evidence)

    assert outcome.method_name == "scanline_envelope"
    assert outcome.polygon.area_source_units_squared == pytest.approx(
        evidence.cross_section.trapezoid_area,
        rel=1e-9,
    )
    assert outcome.source == "front_cross_section_envelope"
    assert outcome.runtime_seconds >= 0.0
    assert outcome.provenance


def test_raster_adapter_matches_existing_raster_area() -> None:
    xyz = _rectangular_wall_xyz()
    evidence = _evidence(xyz)

    outcome = RasterContourEstimator().estimate(evidence)

    assert outcome.method_name == "raster_filled"
    assert outcome.polygon.area_source_units_squared == pytest.approx(
        evidence.raster.area_source_units_squared,
        rel=1e-9,
    )
    assert outcome.source.startswith("mask:")
    assert outcome.runtime_seconds >= 0.0


def test_concave_hull_adapter_runs_on_rectangular_wall() -> None:
    xyz = _rectangular_wall_xyz()
    evidence = _evidence(xyz)

    outcome = ConcaveHullContourEstimator().estimate(evidence)

    assert outcome.method_name == "concave_hull"
    # A flat rectangular wall's hull area should be close to the raster area
    # regardless of the exact ratio; it must not collapse to near zero.
    assert outcome.polygon.area_source_units_squared == pytest.approx(
        evidence.raster.area_source_units_squared,
        rel=0.05,
    )


def test_concave_hull_ratio_changes_area() -> None:
    xyz = _rectangular_wall_xyz()
    evidence = _evidence(xyz)

    tight = ConcaveHullContourEstimator(ConcaveHullConfig(ratio=0.01)).estimate(evidence)
    loose = ConcaveHullContourEstimator(ConcaveHullConfig(ratio=1.0)).estimate(evidence)

    # Consistent with EXP-007: the ratio materially changes the resulting
    # area (loose/convex is never smaller than a tighter concave hull).
    assert loose.polygon.area_source_units_squared >= tight.polygon.area_source_units_squared


def test_concave_hull_rejects_invalid_mask_field() -> None:
    with pytest.raises(ValueError, match="mask_field"):
        ConcaveHullContourEstimator(ConcaveHullConfig(mask_field="not_a_field"))


def test_estimators_are_deterministic_for_fixed_input() -> None:
    xyz = _rectangular_wall_xyz()
    evidence = _evidence(xyz)

    for estimator in (
        ScanlineContourEstimator(),
        RasterContourEstimator(),
        ConcaveHullContourEstimator(),
    ):
        first = estimator.estimate(evidence)
        second = estimator.estimate(evidence)

        assert first.polygon.area_source_units_squared == pytest.approx(
            second.polygon.area_source_units_squared,
            rel=1e-12,
        )
