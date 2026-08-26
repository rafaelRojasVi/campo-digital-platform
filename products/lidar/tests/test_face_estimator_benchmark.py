from __future__ import annotations

import numpy as np
import pytest

from lidar_core.models import FaceAreaReference, FaceAreaUnit
from lidar_volume.face_estimator_benchmark import (
    EstimatorNotAvailableError,
    default_estimator_registry,
    run_face_estimator_benchmark,
)
from lidar_volume.face_estimators import ScanlineContourEstimator


def _rectangular_wall_xyz(
    u_span: float = 10.0,
    z_span: float = 4.0,
    n_u: int = 500,
    n_z: int = 150,
) -> np.ndarray:
    rng = np.random.default_rng(11)

    u_values = np.linspace(0.0, u_span, n_u)
    z_values = np.linspace(0.0, z_span, n_z)
    uu, zz = np.meshgrid(u_values, z_values)

    jitter = rng.uniform(-1e-4, 1e-4, size=uu.size)

    return np.column_stack(
        [
            uu.ravel() + jitter,
            np.zeros(uu.size),
            zz.ravel(),
        ]
    )


def test_default_registry_runs_all_methods() -> None:
    xyz = _rectangular_wall_xyz()

    result = run_face_estimator_benchmark(xyz)

    method_names = {outcome.contour.method_name for outcome in result.outcomes}

    assert method_names == set(default_estimator_registry())
    assert len(result.outcomes) == 3


def test_pairwise_disagreement_is_small_for_a_flat_rectangular_wall() -> None:
    xyz = _rectangular_wall_xyz()

    result = run_face_estimator_benchmark(xyz)

    assert result.pairwise_disagreement

    for value in result.pairwise_disagreement.values():
        assert value >= 0.0
        # A flat, fully observed rectangular wall should not make simple
        # geometric estimators disagree wildly with each other.
        assert value < 0.5


def test_unknown_method_name_raises() -> None:
    xyz = _rectangular_wall_xyz()

    with pytest.raises(ValueError, match="unknown estimator"):
        run_face_estimator_benchmark(xyz, method_names=["not_a_real_method"])


def test_historical_method_name_raises_estimator_not_available() -> None:
    xyz = _rectangular_wall_xyz()

    with pytest.raises(EstimatorNotAvailableError, match="EXP-007"):
        run_face_estimator_benchmark(xyz, method_names=["marching_squares"])


def test_restricting_to_one_method_runs_only_that_method() -> None:
    xyz = _rectangular_wall_xyz()

    result = run_face_estimator_benchmark(
        xyz,
        method_names=[ScanlineContourEstimator.method_name],
    )

    assert len(result.outcomes) == 1
    assert result.outcomes[0].contour.method_name == ScanlineContourEstimator.method_name
    assert result.pairwise_disagreement == {}


def test_reference_comparison_is_blocked_without_same_pile_confirmation() -> None:
    xyz = _rectangular_wall_xyz()

    reference = FaceAreaReference(
        label="manual",
        value=40.0,
        unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
        method="manual_polygon",
        same_pile_confirmed=False,
    )

    result = run_face_estimator_benchmark(xyz, face_area_reference=reference)

    for outcome in result.outcomes:
        comparison = outcome.reference_comparison
        assert comparison is not None
        assert comparison.comparison_ready is False
        assert "same_pile_unconfirmed" in comparison.blocker_codes


def test_reference_comparison_is_blocked_on_incompatible_units() -> None:
    xyz = _rectangular_wall_xyz()

    reference = FaceAreaReference(
        label="manual",
        value=40.0,
        unit=FaceAreaUnit.SQUARE_METRES,
        method="manual_polygon",
        same_pile_confirmed=True,
    )

    result = run_face_estimator_benchmark(
        xyz,
        face_area_reference=reference,
        estimate_unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
    )

    for outcome in result.outcomes:
        comparison = outcome.reference_comparison
        assert comparison is not None
        assert comparison.comparison_ready is False
        assert "area_units_incompatible" in comparison.blocker_codes


def test_reference_comparison_succeeds_when_confirmed_and_compatible() -> None:
    xyz = _rectangular_wall_xyz()

    reference = FaceAreaReference(
        label="manual",
        value=40.0,
        unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
        method="manual_polygon",
        same_pile_confirmed=True,
    )

    result = run_face_estimator_benchmark(
        xyz,
        method_names=[ScanlineContourEstimator.method_name],
        face_area_reference=reference,
    )

    comparison = result.outcomes[0].reference_comparison
    assert comparison is not None
    assert comparison.comparison_ready is True
    assert comparison.absolute_percent_error is not None
    assert comparison.absolute_percent_error >= 0.0
