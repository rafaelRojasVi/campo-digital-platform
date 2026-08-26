from __future__ import annotations

import numpy as np

from lidar_core.log_ends_radial import (
    RadialLogEndCandidate,
    RadialLogEndDetectionConfig,
    RadialLogEndDetectionResult,
)
from lidar_core.measurement_run import (
    summarize_front_cross_section,
    summarize_projected_face_raster,
    summarize_radial_log_detection,
    summarize_timber_stack,
)
from lidar_core.timber_stack import (
    TimberStackDetectionConfig,
    TimberStackDetectionResult,
)
from lidar_volume.front_cross_section import (
    FrontCrossSectionConfig,
    FrontCrossSectionEstimate,
)
from lidar_volume.projected_face_raster import (
    ProjectedFaceRasterConfig,
    estimate_projected_face_raster,
)


def test_summarize_timber_stack_preserves_result_and_config() -> None:
    result = TimberStackDetectionResult(
        mask=np.array([True, True, False, False, False]),
        center_xy=np.array([10.0, 20.0]),
        longitudinal_axis=np.array([1.0, 0.0]),
        transverse_axis=np.array([0.0, 1.0]),
        selected_point_count=2,
        selected_point_fraction=0.4,
        longitudinal_coverage=0.82,
        vertical_extent_fraction=0.77,
        transverse_extent_fraction=0.21,
        score=0.084,
        component_count=3,
    )

    config = TimberStackDetectionConfig(
        longitudinal_bins=80,
        transverse_bins=32,
        vertical_bins=40,
    )

    summary = summarize_timber_stack(
        result,
        point_count_input=5,
        config=config,
    )

    assert summary.point_count_input == 5
    assert summary.point_count_selected == 2
    assert summary.selected_fraction == 0.4
    assert summary.detected_components == 3
    assert summary.longitudinal_coverage == 0.82
    assert summary.vertical_extent_fraction == 0.77
    assert summary.transverse_extent_fraction == 0.21

    assert summary.parameters["longitudinal_bins"] == 80
    assert summary.parameters["transverse_bins"] == 32
    assert summary.parameters["vertical_bins"] == 40


def test_summarize_front_cross_section_uses_finite_height_statistics() -> None:
    result = FrontCrossSectionEstimate(
        center_xy=np.array([0.0, 0.0]),
        longitudinal_axis=np.array([1.0, 0.0]),
        longitudinal_min=-2.0,
        longitudinal_max=2.0,
        longitudinal_span=4.0,
        bin_edges=np.array([-2.0, -1.0, 0.0, 1.0, 2.0]),
        bin_centres=np.array([-1.5, -0.5, 0.5, 1.5]),
        point_counts=np.array([300, 320, 310, 305]),
        base_raw=np.array([0.0, 0.1, np.nan, 0.0]),
        top_raw=np.array([2.0, 2.5, np.nan, 3.0]),
        base=np.array([0.0, 0.1, 0.1, 0.0]),
        top=np.array([2.0, 2.5, 2.5, 3.0]),
        height=np.array([2.0, 2.4, np.nan, 3.0]),
        valid_bin_fraction=0.75,
        rectangle_area=9.2,
        trapezoid_area=8.9,
    )

    config = FrontCrossSectionConfig(
        n_bins=4,
        vertical_quantile_low=0.05,
        vertical_quantile_high=0.95,
        min_points_per_bin=250,
    )

    summary = summarize_front_cross_section(
        result,
        config=config,
    )

    assert summary.longitudinal_span == 4.0
    assert summary.median_height == 2.4
    assert summary.maximum_height == 3.0
    assert summary.rectangle_area == 9.2
    assert summary.trapezoid_area == 8.9
    assert summary.valid_bin_fraction == 0.75

    assert summary.parameters["n_bins"] == 4
    assert summary.parameters["vertical_quantile_low"] == 0.05
    assert summary.parameters["vertical_quantile_high"] == 0.95


def test_summarize_front_depth_preserves_ranked_candidates() -> None:
    from lidar_core.measurement_run import summarize_front_depth
    from lidar_volume.front_depth import (
        FrontDepthImageConfig,
        RecessionDetectionConfig,
        detect_recessed_regions,
        estimate_front_depth_image,
    )

    points: list[tuple[float, float, float]] = []

    for u in np.arange(0.05, 6.0, 0.10):
        for z in np.arange(0.05, 3.0, 0.10):
            cavity = 2.0 <= u <= 4.0 and 0.8 <= z <= 2.0

            front_v = 0.8 if cavity else 0.0

            for offset in (
                0.000,
                0.005,
                0.010,
                0.015,
                0.020,
            ):
                points.append(
                    (
                        float(u),
                        float(front_v + offset),
                        float(z),
                    )
                )

    xyz = np.asarray(
        points,
        dtype=np.float64,
    )

    image_config = FrontDepthImageConfig(
        cell_size_u=0.10,
        cell_size_z=0.10,
        min_points_per_cell=3,
        front_quantile=0.05,
        u_quantile_low=0.0,
        u_quantile_high=1.0,
        z_quantile_low=0.0,
        z_quantile_high=1.0,
    )

    recession_config = RecessionDetectionConfig(
        surface_scale_u=2.5,
        surface_scale_z=2.5,
        recession_threshold=0.30,
        min_candidate_cells=10,
        connectivity=8,
    )

    image = estimate_front_depth_image(
        xyz,
        np.array(
            [0.0, 0.0],
            dtype=np.float64,
        ),
        np.array(
            [1.0, 0.0],
            dtype=np.float64,
        ),
        front_side="low_v",
        config=image_config,
    )

    recession = detect_recessed_regions(
        image,
        recession_config,
    )

    summary = summarize_front_depth(
        image,
        recession,
        image_config=image_config,
        recession_config=recession_config,
        front_depth_runtime_seconds=0.12,
        recession_runtime_seconds=0.03,
    )

    assert summary.front_side == "low_v"
    assert summary.projected_point_count > 0
    assert summary.valid_cell_count > 0

    assert summary.candidate_count >= 1
    assert len(summary.regions) == summary.candidate_count

    strongest = summary.regions[0]

    assert strongest.rank == 1
    assert strongest.median_recession_source_units > 0.70
    assert strongest.u_min < 3.0 < strongest.u_max
    assert strongest.z_min < 1.4 < strongest.z_max

    assert summary.front_depth_runtime_seconds == 0.12
    assert summary.recession_runtime_seconds == 0.03

    assert summary.parameters["front_depth"]["cell_size_u"] == 0.10

    assert summary.parameters["recession"]["recession_threshold"] == 0.30


def test_summarize_radial_log_detection_records_runtime_counts() -> None:
    candidates = (
        RadialLogEndCandidate(
            x_px=10.0,
            y_px=20.0,
            radius_px=7.0,
            score=0.9,
            observed_fraction=0.8,
        ),
        RadialLogEndCandidate(
            x_px=30.0,
            y_px=40.0,
            radius_px=8.0,
            score=0.85,
            observed_fraction=0.75,
        ),
    )

    result = RadialLogEndDetectionResult(
        candidates=candidates,
        response=np.zeros((8, 8), dtype=np.float64),
        gradient_magnitude=np.zeros((8, 8), dtype=np.float64),
        observed_mask=np.ones((8, 8), dtype=bool),
        support_mask=np.ones((8, 8), dtype=bool),
        raw_candidate_count=7,
    )

    config = RadialLogEndDetectionConfig(
        min_radius_px=5,
        max_radius_px=10,
        max_candidates=200,
    )

    summary = summarize_radial_log_detection(
        result,
        config=config,
        method="radial-v5",
    )

    assert summary.method == "radial-v5"
    assert summary.candidate_count == 2
    assert summary.parameters["raw_candidate_count"] == 7
    assert summary.parameters["min_radius_px"] == 5
    assert summary.parameters["max_radius_px"] == 10
    assert summary.parameters["max_candidates"] == 200


def _simple_raster_result():
    u_values = np.linspace(0.0, 4.0, 41)
    z_values = np.linspace(0.0, 2.0, 21)
    uu, zz = np.meshgrid(u_values, z_values)
    xyz = np.column_stack((uu.ravel(), np.zeros(uu.size), zz.ravel()))

    config = ProjectedFaceRasterConfig(
        cell_size_u=0.5,
        cell_size_z=0.5,
        min_points_per_cell=1,
        min_component_cells=1,
        closing_iterations=0,
    )

    result = estimate_projected_face_raster(
        xyz,
        np.array([0.0, 0.0]),
        np.array([1.0, 0.0]),
        config,
    )

    return result, config


def test_summarize_projected_face_raster_carries_scalars_only() -> None:
    result, config = _simple_raster_result()

    summary = summarize_projected_face_raster(
        result,
        config=config,
        scanline_disagreement_fraction=0.05,
    )

    assert summary.area_source_units_squared == result.area_source_units_squared
    assert summary.cell_size_u == config.cell_size_u
    assert summary.cell_size_z == config.cell_size_z
    assert summary.raster_rows == result.raster_rows
    assert summary.raster_cols == result.raster_cols
    assert summary.filled_cell_count == result.filled_cell_count
    assert summary.scanline_disagreement_fraction == 0.05
    assert summary.parameters["cell_size_u"] == config.cell_size_u


def test_summarize_projected_face_raster_defaults_disagreement_to_none() -> None:
    result, config = _simple_raster_result()

    summary = summarize_projected_face_raster(result, config=config)

    assert summary.scanline_disagreement_fraction is None
