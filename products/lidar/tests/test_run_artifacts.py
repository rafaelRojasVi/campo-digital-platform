from __future__ import annotations

import json

import numpy as np

from lidar_io.run_artifacts import write_front_profile_artifact
from lidar_volume.front_cross_section import (
    FrontCrossSectionConfig,
    FrontCrossSectionEstimate,
    estimate_front_cross_section,
)
from lidar_volume.projected_face_raster import (
    ProjectedFaceRasterConfig,
    estimate_projected_face_raster,
)


def _estimate() -> FrontCrossSectionEstimate:
    return FrontCrossSectionEstimate(
        center_xy=np.array([0.0, 0.0]),
        longitudinal_axis=np.array([1.0, 0.0]),
        longitudinal_min=-1.0,
        longitudinal_max=1.0,
        longitudinal_span=2.0,
        bin_edges=np.array([-1.0, 0.0, 1.0]),
        bin_centres=np.array([-0.5, 0.5]),
        point_counts=np.array([300, 280]),
        base_raw=np.array([1.0, np.nan]),
        top_raw=np.array([3.0, np.nan]),
        base=np.array([1.0, 1.0]),
        top=np.array([3.0, 3.5]),
        height=np.array([2.0, 2.5]),
        valid_bin_fraction=0.5,
        rectangle_area=4.5,
        trapezoid_area=2.25,
    )


def test_write_front_profile_artifact_persists_plot_ready_data(
    tmp_path,
) -> None:
    artifact = write_front_profile_artifact(
        _estimate(),
        tmp_path,
    )

    assert artifact.kind == "front_profile"
    assert artifact.path == "front_profile.json"
    assert artifact.media_type == "application/json"

    path = tmp_path / artifact.path
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert payload["schema_version"] == "1"
    assert payload["coordinate_units"] == "source_units"
    assert payload["longitudinal_span"] == 2.0
    assert payload["rectangle_area"] == 4.5

    assert len(payload["bins"]) == 2

    first = payload["bins"][0]
    assert first["station"] == -0.5
    assert first["point_count"] == 300
    assert first["base_raw"] == 1.0
    assert first["top_raw"] == 3.0
    assert first["height"] == 2.0

    second = payload["bins"][1]
    assert second["base_raw"] is None
    assert second["top_raw"] is None
    assert second["base"] == 1.0
    assert second["top"] == 3.5
    assert second["height"] == 2.5


def test_front_profile_json_contains_no_nonstandard_nan(
    tmp_path,
) -> None:
    artifact = write_front_profile_artifact(
        _estimate(),
        tmp_path,
    )

    text = (tmp_path / artifact.path).read_text(encoding="utf-8")

    assert "NaN" not in text


def test_write_front_profile_plot_artifact_creates_png(
    tmp_path,
) -> None:
    from lidar_io.run_artifacts import (
        write_front_profile_plot_artifact,
    )

    artifact = write_front_profile_plot_artifact(
        _estimate(),
        tmp_path,
    )

    assert artifact.kind == "front_profile_plot"
    assert artifact.path == "front_profile.png"
    assert artifact.media_type == "image/png"

    path = tmp_path / artifact.path

    assert path.exists()
    assert path.stat().st_size > 1_000
    assert path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


def _wall_xyz() -> np.ndarray:
    u_values = np.linspace(0.0, 4.0, 41)
    z_values = np.linspace(0.0, 2.0, 21)
    uu, zz = np.meshgrid(u_values, z_values)
    return np.column_stack((uu.ravel(), np.zeros(uu.size), zz.ravel()))


def test_write_front_depth_artifacts_are_diagnostic_only(
    tmp_path,
) -> None:
    from lidar_io.run_artifacts import (
        write_front_depth_artifact,
        write_front_depth_plot_artifact,
    )
    from lidar_volume.front_depth import (
        FrontDepthImageConfig,
        RecessionDetectionConfig,
        detect_recessed_regions,
        estimate_front_depth_image,
    )

    points: list[
        tuple[
            float,
            float,
            float,
        ]
    ] = []

    for u in np.arange(
        0.05,
        6.0,
        0.10,
    ):
        for z in np.arange(
            0.05,
            3.0,
            0.10,
        ):
            cavity = 2.0 <= u <= 4.0 and 0.8 <= z <= 2.0

            v = 0.8 if cavity else 0.0

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
                        float(v + offset),
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

    artifact = write_front_depth_artifact(
        image,
        recession,
        tmp_path,
        image_config=image_config,
        recession_config=recession_config,
        front_depth_runtime_seconds=0.12,
        recession_runtime_seconds=0.03,
    )

    assert artifact.kind == "front_depth_recession"
    assert artifact.path == "front_depth_recession.json"

    payload = json.loads(
        (tmp_path / artifact.path).read_text(
            encoding="utf-8",
        )
    )

    assert payload["estimator_status"] == ("experimental_candidate")
    assert payload["authoritative_measurement"] is False
    assert payload["reference_validated"] is False
    assert payload["coordinate_units"] == "source_units"

    assert payload["semantics"]["confirmed_physical_voids"] is False

    assert payload["semantics"]["subtracted_from_face_area"] is False

    assert payload["semantics"]["affects_volume"] is False

    assert payload["semantics"]["affects_readiness"] is False

    assert payload["recession"]["candidate_count"] >= 1

    assert payload["runtime_seconds"]["combined"] == 0.15

    serialized = json.dumps(payload)

    assert "front_depth_normalized" not in serialized
    assert "candidate_mask" not in serialized
    assert "candidate_labels" not in serialized

    plot_artifact = write_front_depth_plot_artifact(
        image,
        recession,
        tmp_path,
    )

    assert plot_artifact.kind == "front_depth_recession_plot"

    plot_path = tmp_path / plot_artifact.path

    assert plot_path.exists()
    assert plot_path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


def test_write_projected_face_raster_artifact_persists_scalars_only(tmp_path) -> None:
    from lidar_io.run_artifacts import write_projected_face_raster_artifact

    xyz = _wall_xyz()

    cross_section = estimate_front_cross_section(
        xyz,
        FrontCrossSectionConfig(n_bins=10, min_points_per_bin=5),
    )

    raster_config = ProjectedFaceRasterConfig(
        cell_size_u=0.5,
        cell_size_z=0.5,
        min_points_per_cell=1,
        min_component_cells=1,
        closing_iterations=0,
    )

    raster_result = estimate_projected_face_raster(
        xyz,
        cross_section.center_xy,
        cross_section.longitudinal_axis,
        raster_config,
    )

    artifact = write_projected_face_raster_artifact(
        raster_result,
        tmp_path,
        config=raster_config,
        runtime_seconds=0.01,
        scanline_trapezoid_area=cross_section.trapezoid_area,
        scanline_disagreement_fraction=0.02,
    )

    assert artifact.kind == "projected_face_raster"
    assert artifact.path == "projected_face_raster.json"

    payload = json.loads((tmp_path / artifact.path).read_text(encoding="utf-8"))

    assert payload["coordinate_units"] == "source_units"
    assert payload["quantity"]["value"] == raster_result.area_source_units_squared
    assert payload["semantics"]["commercial_cubicacion"] is False
    assert payload["comparison"]["disagreement_fraction"] == 0.02
    assert "occupancy_mask" not in json.dumps(payload)


def test_write_projected_face_raster_plot_artifact_writes_a_png(tmp_path) -> None:
    from lidar_io.run_artifacts import write_projected_face_raster_plot_artifact

    xyz = _wall_xyz()

    cross_section = estimate_front_cross_section(
        xyz,
        FrontCrossSectionConfig(n_bins=10, min_points_per_bin=5),
    )

    raster_result = estimate_projected_face_raster(
        xyz,
        cross_section.center_xy,
        cross_section.longitudinal_axis,
        ProjectedFaceRasterConfig(
            cell_size_u=0.5,
            cell_size_z=0.5,
            min_points_per_cell=1,
            min_component_cells=1,
            closing_iterations=0,
        ),
    )

    artifact = write_projected_face_raster_plot_artifact(
        raster_result,
        tmp_path,
        front_cross_section=cross_section,
    )

    assert artifact.kind == "projected_face_raster_plot"
    assert artifact.path == "projected_face_raster.png"

    plot_path = tmp_path / artifact.path
    assert plot_path.exists()
    assert plot_path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


def test_write_front_height_profile_plot_artifact_creates_png(
    tmp_path,
) -> None:
    from lidar_io.run_artifacts import (
        write_front_height_profile_plot_artifact,
    )

    artifact = write_front_height_profile_plot_artifact(
        _estimate(),
        tmp_path,
    )

    assert artifact.kind == "front_height_profile_plot"
    assert artifact.path == "front_height_profile.png"
    assert artifact.media_type == "image/png"

    path = tmp_path / artifact.path

    assert path.exists()
    assert path.stat().st_size > 1_000
    assert path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
