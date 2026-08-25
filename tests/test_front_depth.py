from __future__ import annotations

import numpy as np
import pytest

from lidar_volume.front_depth import (
    FrontDepthImageConfig,
    RecessionDetectionConfig,
    detect_recessed_regions,
    estimate_front_depth_image,
)

CENTER = np.array(
    [0.0, 0.0],
    dtype=np.float64,
)

AXIS = np.array(
    [1.0, 0.0],
    dtype=np.float64,
)


def _wall_with_optional_rear_cavity(
    *,
    cavity: bool,
    slope_v_per_u: float = 0.0,
) -> np.ndarray:
    """Create a dense synthetic front wall.

    Normal front surface:
        v = slope * u

    Optional cavity:
        no front returns in a central rectangular region;
        only rear/background returns exist there at +0.8 transverse depth.
    """

    u_values = np.arange(
        0.05,
        10.0,
        0.10,
    )

    z_values = np.arange(
        0.05,
        4.0,
        0.10,
    )

    points: list[
        tuple[
            float,
            float,
            float,
        ]
    ] = []

    offsets = (
        0.000,
        0.005,
        0.010,
        0.015,
        0.020,
    )

    for u in u_values:
        for z in z_values:
            is_cavity = cavity and 4.0 <= u <= 6.0 and 0.8 <= z <= 2.4

            front_v = slope_v_per_u * u

            base_v = front_v + 0.8 if is_cavity else front_v

            for offset in offsets:
                points.append(
                    (
                        float(u),
                        float(base_v + offset),
                        float(z),
                    )
                )

    return np.asarray(
        points,
        dtype=np.float64,
    )


def _configs() -> tuple[
    FrontDepthImageConfig,
    RecessionDetectionConfig,
]:
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
        surface_scale_u=3.0,
        surface_scale_z=3.0,
        recession_threshold=0.30,
        min_candidate_cells=20,
        connectivity=8,
    )

    return (
        image_config,
        recession_config,
    )


def test_solid_planar_wall_has_no_recessed_region() -> None:
    xyz = _wall_with_optional_rear_cavity(
        cavity=False,
    )

    image_config, recession_config = _configs()

    image = estimate_front_depth_image(
        xyz,
        CENTER,
        AXIS,
        front_side="low_v",
        config=image_config,
    )

    result = detect_recessed_regions(
        image,
        recession_config,
    )

    assert image.valid_cell_count > 0
    assert len(result.regions) == 0
    assert not result.candidate_mask.any()


def test_rear_returns_seen_through_cavity_are_detected() -> None:
    xyz = _wall_with_optional_rear_cavity(
        cavity=True,
    )

    image_config, recession_config = _configs()

    image = estimate_front_depth_image(
        xyz,
        CENTER,
        AXIS,
        front_side="low_v",
        config=image_config,
    )

    result = detect_recessed_regions(
        image,
        recession_config,
    )

    assert len(result.regions) >= 1

    strongest = result.regions[0]

    assert strongest.median_recession_source_units > 0.70
    assert strongest.max_recession_source_units > 0.70

    assert strongest.u_min < 5.0 < strongest.u_max
    assert strongest.z_min < 1.6 < strongest.z_max


def test_gradually_sloping_front_is_not_a_cavity() -> None:
    xyz = _wall_with_optional_rear_cavity(
        cavity=False,
        slope_v_per_u=0.03,
    )

    image_config, recession_config = _configs()

    image = estimate_front_depth_image(
        xyz,
        CENTER,
        AXIS,
        front_side="low_v",
        config=image_config,
    )

    result = detect_recessed_regions(
        image,
        recession_config,
    )

    assert len(result.regions) == 0


def test_xy_translation_preserves_depth_geometry() -> None:
    xyz = _wall_with_optional_rear_cavity(
        cavity=True,
    )

    image_config, recession_config = _configs()

    baseline_image = estimate_front_depth_image(
        xyz,
        CENTER,
        AXIS,
        front_side="low_v",
        config=image_config,
    )

    baseline = detect_recessed_regions(
        baseline_image,
        recession_config,
    )

    translation = np.array(
        [1000.0, -500.0, 0.0],
        dtype=np.float64,
    )

    translated_xyz = xyz + translation

    translated_center = CENTER + translation[:2]

    translated_image = estimate_front_depth_image(
        translated_xyz,
        translated_center,
        AXIS,
        front_side="low_v",
        config=image_config,
    )

    translated = detect_recessed_regions(
        translated_image,
        recession_config,
    )

    assert np.array_equal(
        baseline_image.valid_mask,
        translated_image.valid_mask,
    )

    assert np.allclose(
        baseline_image.front_depth_normalized[baseline_image.valid_mask],
        translated_image.front_depth_normalized[translated_image.valid_mask],
    )

    assert np.array_equal(
        baseline.candidate_mask,
        translated.candidate_mask,
    )


def test_rotated_xy_frame_preserves_result() -> None:
    xyz = _wall_with_optional_rear_cavity(
        cavity=True,
    )

    image_config, recession_config = _configs()

    baseline_image = estimate_front_depth_image(
        xyz,
        CENTER,
        AXIS,
        front_side="low_v",
        config=image_config,
    )

    baseline = detect_recessed_regions(
        baseline_image,
        recession_config,
    )

    angle = np.deg2rad(37.0)

    rotation = np.array(
        [
            [
                np.cos(angle),
                -np.sin(angle),
            ],
            [
                np.sin(angle),
                np.cos(angle),
            ],
        ],
        dtype=np.float64,
    )

    rotated_xyz = xyz.copy()

    rotated_xyz[:, :2] = xyz[:, :2] @ rotation.T

    rotated_axis = rotation @ AXIS

    rotated_image = estimate_front_depth_image(
        rotated_xyz,
        CENTER,
        rotated_axis,
        front_side="low_v",
        config=image_config,
    )

    rotated = detect_recessed_regions(
        rotated_image,
        recession_config,
    )

    assert np.array_equal(
        baseline_image.valid_mask,
        rotated_image.valid_mask,
    )

    assert np.allclose(
        baseline_image.front_depth_normalized[baseline_image.valid_mask],
        rotated_image.front_depth_normalized[rotated_image.valid_mask],
        atol=1e-12,
    )

    assert np.array_equal(
        baseline.candidate_mask,
        rotated.candidate_mask,
    )


def test_non_unit_axis_is_normalized() -> None:
    xyz = _wall_with_optional_rear_cavity(
        cavity=True,
    )

    image_config, _ = _configs()

    baseline = estimate_front_depth_image(
        xyz,
        CENTER,
        AXIS,
        front_side="low_v",
        config=image_config,
    )

    scaled = estimate_front_depth_image(
        xyz,
        CENTER,
        17.0 * AXIS,
        front_side="low_v",
        config=image_config,
    )

    assert np.array_equal(
        baseline.valid_mask,
        scaled.valid_mask,
    )

    assert np.allclose(
        baseline.front_depth_normalized[baseline.valid_mask],
        scaled.front_depth_normalized[scaled.valid_mask],
    )


def test_point_order_does_not_change_result() -> None:
    xyz = _wall_with_optional_rear_cavity(
        cavity=True,
    )

    image_config, recession_config = _configs()

    baseline_image = estimate_front_depth_image(
        xyz,
        CENTER,
        AXIS,
        front_side="low_v",
        config=image_config,
    )

    baseline = detect_recessed_regions(
        baseline_image,
        recession_config,
    )

    rng = np.random.default_rng(12345)

    shuffled_xyz = xyz[rng.permutation(len(xyz))]

    shuffled_image = estimate_front_depth_image(
        shuffled_xyz,
        CENTER,
        AXIS,
        front_side="low_v",
        config=image_config,
    )

    shuffled = detect_recessed_regions(
        shuffled_image,
        recession_config,
    )

    assert np.array_equal(
        baseline_image.valid_mask,
        shuffled_image.valid_mask,
    )

    assert np.allclose(
        baseline_image.front_depth_normalized[baseline_image.valid_mask],
        shuffled_image.front_depth_normalized[shuffled_image.valid_mask],
    )

    assert np.array_equal(
        baseline.candidate_mask,
        shuffled.candidate_mask,
    )


def test_high_v_front_is_supported_symmetrically() -> None:
    xyz = _wall_with_optional_rear_cavity(
        cavity=True,
    )

    # Reflect the transverse coordinate. The visible side is now high-v.
    reflected = xyz.copy()
    reflected[:, 1] *= -1.0

    image_config, recession_config = _configs()

    low_image = estimate_front_depth_image(
        xyz,
        CENTER,
        AXIS,
        front_side="low_v",
        config=image_config,
    )

    high_image = estimate_front_depth_image(
        reflected,
        CENTER,
        AXIS,
        front_side="high_v",
        config=image_config,
    )

    low_result = detect_recessed_regions(
        low_image,
        recession_config,
    )

    high_result = detect_recessed_regions(
        high_image,
        recession_config,
    )

    assert np.array_equal(
        low_image.valid_mask,
        high_image.valid_mask,
    )

    assert np.allclose(
        low_image.front_depth_normalized[low_image.valid_mask],
        high_image.front_depth_normalized[high_image.valid_mask],
    )

    assert np.array_equal(
        low_result.candidate_mask,
        high_result.candidate_mask,
    )


@pytest.mark.parametrize(
    "front_side",
    [
        "invalid",
        "",
    ],
)
def test_invalid_front_side_is_rejected(
    front_side: str,
) -> None:
    xyz = _wall_with_optional_rear_cavity(
        cavity=False,
    )

    with pytest.raises(
        ValueError,
        match="front_side",
    ):
        estimate_front_depth_image(
            xyz,
            CENTER,
            AXIS,
            front_side=front_side,  # type: ignore[arg-type]
        )
