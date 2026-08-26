from __future__ import annotations

import numpy as np
import pytest

from lidar_volume.projected_face_raster import (
    ProjectedFaceRasterConfig,
    estimate_projected_face_raster,
)


def _rectangular_wall_xyz(
    u_span: float = 10.0,
    z_span: float = 2.0,
    n_u: int = 201,
    n_z: int = 81,
) -> np.ndarray:
    u_values = np.linspace(0.0, u_span, n_u)
    z_values = np.linspace(0.0, z_span, n_z)
    uu, zz = np.meshgrid(u_values, z_values)
    return np.column_stack(
        (
            uu.ravel(),
            np.zeros(uu.size),
            zz.ravel(),
        )
    )


IDENTITY_CENTER = np.array([0.0, 0.0])
IDENTITY_LONGITUDINAL_AXIS = np.array([1.0, 0.0])


def test_rectangular_wall_has_known_exact_area() -> None:
    xyz = _rectangular_wall_xyz()

    result = estimate_projected_face_raster(
        xyz,
        IDENTITY_CENTER,
        IDENTITY_LONGITUDINAL_AXIS,
        ProjectedFaceRasterConfig(
            cell_size_u=0.5,
            cell_size_z=0.5,
            min_points_per_cell=1,
            min_component_cells=1,
            closing_iterations=0,
        ),
    )

    assert result.raster_cols == 20
    assert result.raster_rows == 4
    assert result.area_source_units_squared == pytest.approx(20.0, rel=1e-9)
    assert result.filled_cell_count == result.raster_rows * result.raster_cols
    assert result.projected_point_count == len(xyz)


def test_sloped_bottom_boundary_follows_the_slope() -> None:
    u_values = np.linspace(0.0, 10.0, 401)
    top = 5.0
    slope_bottom = 0.05 * u_values  # rises from 0.0 to 0.5

    rows = []
    for u_value, bottom_value in zip(u_values, slope_bottom, strict=True):
        z_values = np.linspace(bottom_value, top, 121)
        rows.append(
            np.column_stack(
                (
                    np.full_like(z_values, u_value),
                    np.zeros_like(z_values),
                    z_values,
                )
            )
        )
    xyz = np.concatenate(rows, axis=0)

    expected_area = float(np.trapezoid(top - slope_bottom, u_values))

    result = estimate_projected_face_raster(
        xyz,
        IDENTITY_CENTER,
        IDENTITY_LONGITUDINAL_AXIS,
        ProjectedFaceRasterConfig(
            cell_size_u=0.1,
            cell_size_z=0.1,
            min_points_per_cell=1,
            min_component_cells=1,
            closing_iterations=0,
        ),
    )

    assert result.area_source_units_squared == pytest.approx(expected_area, rel=0.03)

    # A flat-floor assumption at the lowest observed bottom would overstate
    # area; confirm the raster is not simply using the global minimum.
    flat_floor_area = float((top - 0.0) * 10.0)
    assert result.area_source_units_squared < flat_floor_area * 0.97


def test_irregular_step_top_boundary_follows_the_step_not_the_maximum() -> None:
    bottom = 0.0
    left_top = 3.0
    right_top = 4.0

    left_u = np.linspace(0.0, 5.0, 201)
    right_u = np.linspace(5.0, 10.0, 201)

    left_z = np.linspace(bottom, left_top, 121)
    right_z = np.linspace(bottom, right_top, 161)

    left_uu, left_zz = np.meshgrid(left_u, left_z)
    right_uu, right_zz = np.meshgrid(right_u, right_z)

    xyz = np.concatenate(
        [
            np.column_stack((left_uu.ravel(), np.zeros(left_uu.size), left_zz.ravel())),
            np.column_stack((right_uu.ravel(), np.zeros(right_uu.size), right_zz.ravel())),
        ],
        axis=0,
    )

    expected_area = 5.0 * left_top + 5.0 * right_top  # 35.0
    max_height_area = 10.0 * right_top  # 40.0, the wrong answer if top==max everywhere

    result = estimate_projected_face_raster(
        xyz,
        IDENTITY_CENTER,
        IDENTITY_LONGITUDINAL_AXIS,
        ProjectedFaceRasterConfig(
            cell_size_u=0.1,
            cell_size_z=0.1,
            min_points_per_cell=1,
            min_component_cells=1,
            closing_iterations=0,
        ),
    )

    assert result.area_source_units_squared == pytest.approx(expected_area, rel=0.03)
    assert result.area_source_units_squared < max_height_area * 0.97


def test_pure_transverse_depth_protrusion_does_not_change_area() -> None:
    xyz = _rectangular_wall_xyz()

    config = ProjectedFaceRasterConfig(
        cell_size_u=0.5,
        cell_size_z=0.5,
        min_points_per_cell=1,
        min_component_cells=1,
        closing_iterations=0,
    )

    baseline = estimate_projected_face_raster(
        xyz,
        IDENTITY_CENTER,
        IDENTITY_LONGITUDINAL_AXIS,
        config,
    )

    protruded = xyz.copy()
    # Shift the transverse (y) coordinate of a subset of points far toward
    # the scanner. u (x) and z are untouched.
    protruded[::7, 1] += 8.0

    with_protrusion = estimate_projected_face_raster(
        protruded,
        IDENTITY_CENTER,
        IDENTITY_LONGITUDINAL_AXIS,
        config,
    )

    assert with_protrusion.area_source_units_squared == pytest.approx(
        baseline.area_source_units_squared,
        rel=1e-9,
    )
    assert np.array_equal(with_protrusion.filled_mask, baseline.filled_mask)


def test_rotated_face_is_invariant_to_true_transverse_protrusion() -> None:
    longitudinal_axis = np.array(
        [1.0, 1.0],
        dtype=np.float64,
    )
    longitudinal_axis /= np.linalg.norm(longitudinal_axis)

    transverse_axis = np.array(
        [
            -longitudinal_axis[1],
            longitudinal_axis[0],
        ],
        dtype=np.float64,
    )

    u_values = np.linspace(
        0.0,
        10.0,
        201,
    )
    z_values = np.linspace(
        0.0,
        2.0,
        81,
    )

    uu, zz = np.meshgrid(
        u_values,
        z_values,
    )

    xy = uu.ravel()[:, np.newaxis] * longitudinal_axis[np.newaxis, :]

    xyz = np.column_stack(
        (
            xy[:, 0],
            xy[:, 1],
            zz.ravel(),
        )
    )

    config = ProjectedFaceRasterConfig(
        cell_size_u=0.5,
        cell_size_z=0.5,
        min_points_per_cell=1,
        min_component_cells=1,
        closing_iterations=0,
    )

    baseline = estimate_projected_face_raster(
        xyz,
        IDENTITY_CENTER,
        longitudinal_axis,
        config,
    )

    protruded = xyz.copy()

    # Move a deterministic subset exclusively along the true transverse
    # direction. Because this direction is orthogonal to the longitudinal
    # axis, projected u and z coordinates remain unchanged.
    protruded[::7, :2] += 8.0 * transverse_axis

    result = estimate_projected_face_raster(
        protruded,
        IDENTITY_CENTER,
        longitudinal_axis,
        config,
    )

    assert result.area_source_units_squared == pytest.approx(
        baseline.area_source_units_squared,
        rel=1e-12,
    )

    assert np.array_equal(
        result.filled_mask,
        baseline.filled_mask,
    )


def test_sparse_isolated_outliers_do_not_expand_retained_area() -> None:
    # u_span/z_span deliberately avoid exact multiples of cell_size_u/z: an
    # exact-multiple edge point's bin index depends on the *total* raster
    # extent (via the cols-1/rows-1 clip), so a distant outlier that grows
    # the raster could otherwise nudge that single boundary point into a
    # newly-created adjacent column -- a discretization artifact of the
    # synthetic grid, not of real (non-exact) point coordinates.
    xyz = _rectangular_wall_xyz(u_span=9.9, z_span=1.9)

    baseline_config = ProjectedFaceRasterConfig(
        cell_size_u=0.2,
        cell_size_z=0.2,
        min_points_per_cell=1,
        min_component_cells=3,
        closing_iterations=0,
    )

    baseline = estimate_projected_face_raster(
        xyz,
        IDENTITY_CENTER,
        IDENTITY_LONGITUDINAL_AXIS,
        baseline_config,
    )

    outliers = np.array(
        [
            [20.0, 0.0, 10.0],
            [20.02, 0.0, 10.01],
            [20.01, 0.0, 10.02],
        ]
    )
    with_outliers_xyz = np.concatenate([xyz, outliers], axis=0)

    with_outliers = estimate_projected_face_raster(
        with_outliers_xyz,
        IDENTITY_CENTER,
        IDENTITY_LONGITUDINAL_AXIS,
        baseline_config,
    )

    assert with_outliers.area_source_units_squared == pytest.approx(
        baseline.area_source_units_squared,
        rel=1e-9,
    )
    assert with_outliers.raster_cols > baseline.raster_cols  # bounds did grow
    assert with_outliers.retained_component_cell_count == (baseline.retained_component_cell_count)


def test_internal_holes_are_filled_for_gross_face_area() -> None:
    xyz = _rectangular_wall_xyz(u_span=10.0, z_span=2.0)

    hole_mask = (xyz[:, 0] >= 4.0) & (xyz[:, 0] <= 6.0) & (xyz[:, 2] >= 0.5) & (xyz[:, 2] <= 1.5)
    xyz_with_hole = xyz[~hole_mask]

    result = estimate_projected_face_raster(
        xyz_with_hole,
        IDENTITY_CENTER,
        IDENTITY_LONGITUDINAL_AXIS,
        ProjectedFaceRasterConfig(
            cell_size_u=0.2,
            cell_size_z=0.2,
            min_points_per_cell=1,
            min_component_cells=1,
            closing_iterations=0,
        ),
    )

    assert result.filled_cell_count > result.retained_component_cell_count
    assert result.area_source_units_squared == pytest.approx(20.0, rel=1e-6)


def test_second_disconnected_component_is_excluded_even_if_not_noise() -> None:
    # u_span/z_span avoid exact multiples of cell_size_u/z for the same
    # boundary-discretization reason documented in the outliers test above.
    main_wall = _rectangular_wall_xyz(u_span=9.9, z_span=1.9)

    second_u = np.linspace(15.0, 17.0, 41)
    second_z = np.linspace(0.0, 1.0, 21)
    second_uu, second_zz = np.meshgrid(second_u, second_z)
    second_component = np.column_stack(
        (
            second_uu.ravel(),
            np.zeros(second_uu.size),
            second_zz.ravel(),
        )
    )

    xyz = np.concatenate([main_wall, second_component], axis=0)

    config = ProjectedFaceRasterConfig(
        cell_size_u=0.2,
        cell_size_z=0.2,
        min_points_per_cell=1,
        min_component_cells=3,
        closing_iterations=0,
    )

    main_wall_alone = estimate_projected_face_raster(
        main_wall,
        IDENTITY_CENTER,
        IDENTITY_LONGITUDINAL_AXIS,
        config,
    )

    result = estimate_projected_face_raster(
        xyz,
        IDENTITY_CENTER,
        IDENTITY_LONGITUDINAL_AXIS,
        config,
    )

    # The second component is well above the noise threshold (10x5 cells)
    # but must still be excluded because only the largest component is kept.
    assert result.area_source_units_squared == pytest.approx(
        main_wall_alone.area_source_units_squared,
        rel=1e-9,
    )


def test_output_is_deterministic() -> None:
    xyz = _rectangular_wall_xyz()
    config = ProjectedFaceRasterConfig(
        cell_size_u=0.3,
        cell_size_z=0.3,
        min_points_per_cell=1,
        min_component_cells=1,
        closing_iterations=1,
    )

    first = estimate_projected_face_raster(xyz, IDENTITY_CENTER, IDENTITY_LONGITUDINAL_AXIS, config)
    second = estimate_projected_face_raster(
        xyz, IDENTITY_CENTER, IDENTITY_LONGITUDINAL_AXIS, config
    )

    assert first.area_source_units_squared == second.area_source_units_squared
    assert np.array_equal(first.occupancy_mask, second.occupancy_mask)
    assert np.array_equal(first.component_mask, second.component_mask)
    assert np.array_equal(first.filled_mask, second.filled_mask)


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"cell_size_u": 0.0}, "cell_size_u must be > 0"),
        ({"cell_size_z": -0.1}, "cell_size_z must be > 0"),
        ({"min_points_per_cell": 0}, "min_points_per_cell must be >= 1"),
        ({"connectivity": 6}, "connectivity must be 4 or 8"),
        ({"min_component_cells": 0}, "min_component_cells must be >= 1"),
        ({"closing_iterations": -1}, "closing_iterations must be >= 0"),
        ({"u_quantile_low": 0.5, "u_quantile_high": 0.5}, "invalid u quantile interval"),
        ({"z_quantile_low": 0.9, "z_quantile_high": 0.1}, "invalid z quantile interval"),
    ],
)
def test_invalid_config_raises_value_error(kwargs: dict, match: str) -> None:
    xyz = _rectangular_wall_xyz()

    with pytest.raises(ValueError, match=match):
        estimate_projected_face_raster(
            xyz,
            IDENTITY_CENTER,
            IDENTITY_LONGITUDINAL_AXIS,
            ProjectedFaceRasterConfig(**kwargs),
        )


def test_rejects_malformed_xyz_shape() -> None:
    with pytest.raises(ValueError, match="xyz must have shape"):
        estimate_projected_face_raster(
            np.zeros((10, 2)),
            IDENTITY_CENTER,
            IDENTITY_LONGITUDINAL_AXIS,
        )
