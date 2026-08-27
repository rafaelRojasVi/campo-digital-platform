from __future__ import annotations

import laspy
import numpy as np

from lidar_core.models import (
    FaceAreaReference,
    FaceAreaUnit,
    MeasurementReadinessStage,
)
from lidar_core.timber_stack import TimberStackDetectionConfig
from lidar_io.measurement_pipeline import run_timber_measurement
from lidar_volume.front_cross_section import FrontCrossSectionConfig
from lidar_volume.projected_face_raster import ProjectedFaceRasterConfig


def _write_synthetic_wall(path) -> None:
    rng = np.random.default_rng(20260825)

    point_count = 8_000

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


def _run_with_reference(
    input_path,
    output_root,
    *,
    run_id: str,
    reference: FaceAreaReference,
):
    return run_timber_measurement(
        input_path,
        output_root,
        run_id=run_id,
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
        face_area_reference=reference,
    )


def test_pipeline_persists_ready_source_unit_face_area_comparison(
    tmp_path,
) -> None:
    source = tmp_path / "wall.las"
    _write_synthetic_wall(source)

    reference = FaceAreaReference(
        label="same-pile manual polygon",
        value=30.0,
        unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
        method="manual polygon",
        source="test_fixture",
        same_pile_confirmed=True,
    )

    run, _ = _run_with_reference(
        source,
        tmp_path / "reports",
        run_id="reference-source-units",
        reference=reference,
    )

    comparison = run.face_area_comparison

    assert comparison is not None
    assert comparison.comparison_ready is True
    assert comparison.blocker_codes == []

    assert comparison.estimate_method == "projected_face_raster"
    assert comparison.estimate_unit == FaceAreaUnit.SOURCE_UNITS_SQUARED

    assert comparison.signed_error is not None
    assert comparison.absolute_error is not None
    assert comparison.percent_error is not None
    assert comparison.absolute_percent_error is not None

    # Face-area comparison does not promote the volume-level readiness ladder.
    assert run.readiness is not None
    assert run.readiness.stage == MeasurementReadinessStage.OBSERVABLE_GEOMETRY
    assert run.readiness.reference_validated is False


def test_pipeline_blocks_square_metre_reference_without_metric_crs(
    tmp_path,
) -> None:
    source = tmp_path / "wall-no-crs.las"
    _write_synthetic_wall(source)

    reference = FaceAreaReference(
        label="client LiDAR360 face",
        value=30.0,
        unit=FaceAreaUnit.SQUARE_METRES,
        method="LiDAR360 manual polygon",
        source="client",
        same_pile_confirmed=True,
    )

    run, _ = _run_with_reference(
        source,
        tmp_path / "reports",
        run_id="reference-square-metres-blocked",
        reference=reference,
    )

    comparison = run.face_area_comparison

    assert comparison is not None
    assert comparison.comparison_ready is False

    assert comparison.blocker_codes == [
        "area_units_incompatible",
    ]

    assert comparison.estimate_unit == FaceAreaUnit.SOURCE_UNITS_SQUARED
    assert comparison.reference.unit == FaceAreaUnit.SQUARE_METRES

    assert comparison.signed_error is None
    assert comparison.percent_error is None

    # The reference diagnostic still must not affect run readiness.
    assert run.readiness is not None
    assert run.readiness.stage == MeasurementReadinessStage.OBSERVABLE_GEOMETRY
    assert run.readiness.reference_validated is False
