"""LAS-to-benchmark I/O orchestration for competing face-boundary estimators.

This is a separate entry point from ``lidar_io.measurement_pipeline`` -- it
does not fork it and it does not replace it. It reuses the same pile-
localization contract (``lidar_core.timber_stack.detect_timber_stack`` /
prelocalized bypass) so a benchmark run's shared evidence is built exactly
the way a real measurement run's evidence would be, but it produces its own
``FaceEstimatorBenchmarkResult`` artifact rather than a persisted
``MeasurementRun``. See
products/lidar/docs/decisions/ADR-004-hybrid-measurement-experiment-architecture.md.

Runtime is reported in three independent buckets so a slow benchmark run can
be attributed correctly: LAS reading, pile localization, and shared
evidence construction (raster/cross-section) are measured once, upstream of
any estimator; each estimator's own ``runtime_seconds`` (from
``FaceContourEstimator.estimate``) is separate and never includes any of
that upstream cost.
"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from time import perf_counter

import laspy
import numpy as np

from lidar_core.face_area_reference import face_area_unit_from_horizontal_units
from lidar_core.models import FaceAreaReference, new_run_id
from lidar_core.timber_stack import TimberStackDetectionConfig, detect_timber_stack
from lidar_io.benchmark_artifacts import write_benchmark_artifacts
from lidar_io.inspect import inspect_las
from lidar_volume.face_estimator_benchmark import (
    FaceEstimatorBenchmarkResult,
    run_face_estimator_benchmark,
)
from lidar_volume.face_estimators import FaceContourEstimator
from lidar_volume.front_cross_section import FrontCrossSectionConfig
from lidar_volume.front_depth import FrontSide
from lidar_volume.projected_face_raster import ProjectedFaceRasterConfig


def run_face_estimator_benchmark_from_las(
    input_path: Path,
    output_root: Path,
    *,
    run_id: str | None = None,
    input_already_isolated: bool = False,
    timber_config: TimberStackDetectionConfig | None = None,
    method_names: list[str] | None = None,
    estimators: dict[str, FaceContourEstimator] | None = None,
    cross_section_config: FrontCrossSectionConfig | None = None,
    raster_config: ProjectedFaceRasterConfig | None = None,
    front_side: FrontSide | None = None,
    face_area_reference: FaceAreaReference | None = None,
    code_version: str | None = None,
) -> tuple[FaceEstimatorBenchmarkResult, Path, Path]:
    """Run the shared face-estimator benchmark on one LAS/LAZ file.

    By default the input is treated as a candidate region and localized
    automatically, exactly like ``run_timber_measurement``. When
    ``input_already_isolated`` is set, the complete input cloud is used
    directly for controlled reference validation, and this must not be
    interpreted as successful automatic localization.

    Returns ``(result, benchmark_json_path, summary_csv_path)``.
    """

    resolved_run_id = run_id or new_run_id()

    metadata = inspect_las(
        input_path,
        compute_checksum=True,
    )

    las_read_started = perf_counter()

    las = laspy.read(str(input_path))

    xyz = np.column_stack(
        [
            np.asarray(las.x),
            np.asarray(las.y),
            np.asarray(las.z),
        ]
    ).astype(
        np.float64,
        copy=False,
    )

    las_read_runtime_seconds = perf_counter() - las_read_started

    localization_started = perf_counter()

    if input_already_isolated:
        timber_xyz = xyz
        point_count_selected = len(xyz)
    else:
        resolved_timber_config = (
            timber_config if timber_config is not None else TimberStackDetectionConfig()
        )

        timber_result = detect_timber_stack(
            xyz,
            config=resolved_timber_config,
        )

        timber_xyz = xyz[timber_result.mask]
        point_count_selected = int(timber_result.mask.sum())

    localization_runtime_seconds = perf_counter() - localization_started

    if len(timber_xyz) < 3:
        raise ValueError("selected measurement input contains fewer than 3 points")

    # Resolve the raster config here (rather than leaving it None) so the
    # exact config actually used -- including every default -- can be
    # persisted below for later reproduction, not just whatever the caller
    # happened to override.
    resolved_raster_config = (
        raster_config if raster_config is not None else ProjectedFaceRasterConfig()
    )

    result = run_face_estimator_benchmark(
        timber_xyz,
        method_names=method_names,
        estimators=estimators,
        cross_section_config=cross_section_config,
        raster_config=resolved_raster_config,
        front_side=front_side,
        face_area_reference=face_area_reference,
        estimate_unit=face_area_unit_from_horizontal_units(
            metadata.coordinate_metadata.horizontal_units
        ),
    )

    input_identity = {
        "source_path": str(input_path),
        "source_sha256": metadata.sha256,
        "code_version": code_version,
        "localization_mode": ("prelocalized_input" if input_already_isolated else "automatic"),
        "point_count_input": len(xyz),
        "point_count_selected": point_count_selected,
        "las_read_runtime_seconds": las_read_runtime_seconds,
        "localization_runtime_seconds": localization_runtime_seconds,
        "coordinate_metadata": {
            "is_explicit": metadata.coordinate_metadata.is_explicit,
            "horizontal_units": metadata.coordinate_metadata.horizontal_units,
        },
        "raster_config": asdict(resolved_raster_config),
    }

    benchmark_path, summary_path = write_benchmark_artifacts(
        result,
        resolved_run_id,
        output_root,
        input_identity=input_identity,
    )

    return result, benchmark_path, summary_path
