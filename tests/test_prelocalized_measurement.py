from __future__ import annotations

import laspy
import numpy as np

from lidar_core.models import (
    MeasurementReadinessStage,
)
from lidar_core.timber_stack import (
    TimberStackDetectionConfig,
)
from lidar_io.measurement_pipeline import (
    run_timber_measurement,
)
from lidar_io.run_store import read_measurement_run
from lidar_volume.front_cross_section import (
    FrontCrossSectionConfig,
)
from lidar_volume.projected_face_raster import (
    ProjectedFaceRasterConfig,
)


def _write_wall(
    path,
    *,
    point_count: int = 8_000,
) -> None:
    rng = np.random.default_rng(20260825)

    header = laspy.LasHeader(
        point_format=3,
        version="1.2",
    )

    header.scales = np.array(
        [
            0.001,
            0.001,
            0.001,
        ]
    )

    las = laspy.LasData(header)

    las.x = rng.uniform(
        0.0,
        12.0,
        point_count,
    )

    las.y = rng.normal(
        0.0,
        0.08,
        point_count,
    )

    las.z = rng.uniform(
        0.5,
        3.5,
        point_count,
    )

    las.write(path)


def test_prelocalized_mode_uses_complete_input_cloud(
    tmp_path,
) -> None:
    source = tmp_path / "isolated-wall.las"

    _write_wall(
        source,
        point_count=8_000,
    )

    run, output_path = run_timber_measurement(
        source,
        tmp_path / "reports",
        run_id="prelocalized-wall",
        input_already_isolated=True,
        code_version="test",
        cross_section_config=FrontCrossSectionConfig(
            n_bins=24,
            min_points_per_bin=20,
        ),
        projected_face_raster_config=ProjectedFaceRasterConfig(
            cell_size_u=0.5,
            cell_size_z=0.25,
            min_points_per_cell=1,
            min_component_cells=1,
            closing_iterations=0,
        ),
    )

    assert run.timber_stack is not None

    assert run.timber_stack.localization_mode == "prelocalized_input"

    assert run.timber_stack.point_count_input == 8_000

    assert run.timber_stack.point_count_selected == 8_000

    assert run.timber_stack.selected_fraction == 1.0

    assert run.timber_stack.detected_components is None

    assert run.timber_stack.longitudinal_coverage is None

    assert run.front_cross_section is not None
    assert run.projected_face_raster is not None

    assert run.provenance["localization_mode"] == "prelocalized_input"

    assert run.readiness is not None

    assert run.readiness.stage == MeasurementReadinessStage.OBSERVABLE_GEOMETRY

    persisted = read_measurement_run(output_path)

    assert persisted == run


def test_default_mode_remains_automatic(
    tmp_path,
) -> None:
    source = tmp_path / "automatic-wall.las"

    _write_wall(
        source,
        point_count=8_000,
    )

    run, _ = run_timber_measurement(
        source,
        tmp_path / "reports",
        run_id="automatic-wall",
        code_version="test",
        timber_config=TimberStackDetectionConfig(
            longitudinal_bins=24,
            transverse_bins=12,
            vertical_bins=12,
            min_longitudinal_coverage=0.10,
            min_vertical_extent_fraction=0.10,
            ignore_lowest_vertical_fraction=0.0,
            pca_sample_size=10_000,
            seed=42,
        ),
        cross_section_config=FrontCrossSectionConfig(
            n_bins=24,
            min_points_per_bin=20,
        ),
        projected_face_raster_config=ProjectedFaceRasterConfig(
            cell_size_u=0.5,
            cell_size_z=0.25,
            min_points_per_cell=1,
            min_component_cells=1,
            closing_iterations=0,
        ),
    )

    assert run.timber_stack is not None

    assert run.timber_stack.localization_mode == "automatic"

    assert run.provenance["localization_mode"] == "automatic"

    assert run.timber_stack.point_count_selected <= run.timber_stack.point_count_input
