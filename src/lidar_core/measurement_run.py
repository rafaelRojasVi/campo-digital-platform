"""Adapters from algorithm outputs to persistent measurement-run summaries.

This module contains no filesystem persistence and runs no measurement
algorithms itself. It only converts already-computed algorithm results into
the stable Pydantic reporting schema.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict

import numpy as np

from lidar_core.log_ends_radial import (
    RadialLogEndDetectionConfig,
    RadialLogEndDetectionResult,
)
from lidar_core.models import (
    FrontCrossSectionSummary,
    FrontDepthSummary,
    LogDetectionSummary,
    MeasurementReadiness,
    MeasurementReadinessStage,
    MeasurementRunStatus,
    MeasurementWarning,
    MeasurementWarningSeverity,
    ProjectedFaceRasterSummary,
    RecessedRegionSummary,
    TimberStackSummary,
)
from lidar_core.timber_stack import (
    TimberStackDetectionConfig,
    TimberStackDetectionResult,
)
from lidar_volume.front_cross_section import (
    FrontCrossSectionConfig,
    FrontCrossSectionEstimate,
)
from lidar_volume.front_depth import (
    FrontDepthImage,
    FrontDepthImageConfig,
    FrontRecessionEstimate,
    RecessionDetectionConfig,
)
from lidar_volume.projected_face_raster import (
    ProjectedFaceRasterConfig,
    ProjectedFaceRasterEstimate,
)


def derive_measurement_readiness(
    *,
    status: MeasurementRunStatus,
    observable_geometry_available: bool,
    physical_units_confirmed: bool,
    geometric_volume_available: bool,
    warnings: Sequence[MeasurementWarning],
    reference_validated: bool = False,
) -> MeasurementReadiness:
    """Derive measurement maturity from explicit run facts.

    Observable geometry may exist in source-coordinate units without
    confirmed physical units. Physical face area requires confirmed units.
    Volume readiness additionally requires an explicit geometric volume.
    Reference validation is never inferred from execution success.
    """

    if geometric_volume_available and not observable_geometry_available:
        raise ValueError("geometric volume availability requires observable geometry")

    if reference_validated and not geometric_volume_available:
        raise ValueError("reference validation requires geometric volume")

    if reference_validated and not physical_units_confirmed:
        raise ValueError("reference validation requires confirmed physical units")

    pipeline_completed = status == MeasurementRunStatus.COMPLETED

    observable_geometry_ready = pipeline_completed and observable_geometry_available

    physical_face_area_ready = observable_geometry_ready and physical_units_confirmed

    geometric_volume_ready = physical_face_area_ready and geometric_volume_available

    validated = geometric_volume_ready and reference_validated

    if validated:
        stage = MeasurementReadinessStage.REFERENCE_VALIDATED
    elif geometric_volume_ready:
        stage = MeasurementReadinessStage.GEOMETRIC_VOLUME
    elif physical_face_area_ready:
        stage = MeasurementReadinessStage.PHYSICAL_FACE_AREA
    elif observable_geometry_ready:
        stage = MeasurementReadinessStage.OBSERVABLE_GEOMETRY
    else:
        stage = MeasurementReadinessStage.NOT_READY

    blocker_codes = list(
        dict.fromkeys(
            warning.code
            for warning in warnings
            if warning.severity == MeasurementWarningSeverity.BLOCKER
        )
    )

    return MeasurementReadiness(
        stage=stage,
        pipeline_completed=pipeline_completed,
        observable_geometry_ready=observable_geometry_ready,
        physical_face_area_ready=physical_face_area_ready,
        geometric_volume_ready=geometric_volume_ready,
        reference_validated=validated,
        blocker_codes=blocker_codes,
    )


def _config_parameters(
    config: (
        TimberStackDetectionConfig
        | FrontCrossSectionConfig
        | RadialLogEndDetectionConfig
        | ProjectedFaceRasterConfig
        | FrontDepthImageConfig
        | RecessionDetectionConfig
        | None
    ),
) -> dict[str, object]:
    """Serialize an explicitly supplied dataclass configuration.

    An omitted configuration is recorded as unknown rather than silently
    replaced with current library defaults.
    """

    if config is None:
        return {}

    return asdict(config)


def summarize_timber_stack(
    result: TimberStackDetectionResult,
    *,
    point_count_input: int,
    config: TimberStackDetectionConfig | None = None,
) -> TimberStackSummary:
    """Convert timber-stack localization diagnostics to run schema."""

    if point_count_input < 0:
        raise ValueError("point_count_input must be non-negative")

    return TimberStackSummary(
        point_count_input=point_count_input,
        point_count_selected=result.selected_point_count,
        selected_fraction=result.selected_point_fraction,
        detected_components=result.component_count,
        longitudinal_coverage=result.longitudinal_coverage,
        vertical_extent_fraction=result.vertical_extent_fraction,
        transverse_extent_fraction=result.transverse_extent_fraction,
        parameters=_config_parameters(config),
    )


def summarize_front_cross_section(
    result: FrontCrossSectionEstimate,
    *,
    config: FrontCrossSectionConfig | None = None,
) -> FrontCrossSectionSummary:
    """Convert observable front-wall geometry to run schema."""

    height = np.asarray(result.height, dtype=np.float64)
    finite_height = height[np.isfinite(height)]

    if finite_height.size == 0:
        raise ValueError("front cross-section contains no finite height values")

    return FrontCrossSectionSummary(
        longitudinal_span=result.longitudinal_span,
        median_height=float(np.median(finite_height)),
        maximum_height=float(np.max(finite_height)),
        rectangle_area=result.rectangle_area,
        trapezoid_area=result.trapezoid_area,
        valid_bin_fraction=result.valid_bin_fraction,
        parameters=_config_parameters(config),
    )


def summarize_projected_face_raster(
    result: ProjectedFaceRasterEstimate,
    *,
    config: ProjectedFaceRasterConfig | None = None,
    scanline_disagreement_fraction: float | None = None,
) -> ProjectedFaceRasterSummary:
    """Convert projected face-area raster diagnostics to run schema."""

    return ProjectedFaceRasterSummary(
        area_source_units_squared=result.area_source_units_squared,
        cell_size_u=result.cell_size_u,
        cell_size_z=result.cell_size_z,
        raster_rows=result.raster_rows,
        raster_cols=result.raster_cols,
        u_min=result.u_min,
        u_max=result.u_max,
        z_min=result.z_min,
        z_max=result.z_max,
        projected_point_count=result.projected_point_count,
        raw_occupied_cell_count=result.raw_occupied_cell_count,
        denoised_occupied_cell_count=result.denoised_occupied_cell_count,
        retained_component_cell_count=result.retained_component_cell_count,
        filled_cell_count=result.filled_cell_count,
        component_count=result.component_count,
        scanline_disagreement_fraction=scanline_disagreement_fraction,
        parameters=_config_parameters(config),
    )


def summarize_front_depth(
    image: FrontDepthImage,
    recession: FrontRecessionEstimate,
    *,
    image_config: FrontDepthImageConfig | None = None,
    recession_config: RecessionDetectionConfig | None = None,
    front_depth_runtime_seconds: float | None = None,
    recession_runtime_seconds: float | None = None,
) -> FrontDepthSummary:
    """Convert experimental front-depth diagnostics to run schema.

    Candidate recessed regions remain diagnostic only. They are not
    interpreted here as confirmed physical voids or subtracted from area.
    """

    regions = [
        RecessedRegionSummary(
            rank=rank,
            cell_count=region.cell_count,
            area_source_units_squared=(region.area_source_units_squared),
            median_recession_source_units=(region.median_recession_source_units),
            max_recession_source_units=(region.max_recession_source_units),
            recession_score_source_units_cubed=(region.recession_score_source_units_cubed),
            u_min=region.u_min,
            u_max=region.u_max,
            z_min=region.z_min,
            z_max=region.z_max,
            u_centroid=region.u_centroid,
            z_centroid=region.z_centroid,
        )
        for rank, region in enumerate(
            recession.regions,
            start=1,
        )
    ]

    return FrontDepthSummary(
        front_side=image.front_side,
        cell_size_u=image.cell_size_u,
        cell_size_z=image.cell_size_z,
        raster_rows=image.raster_rows,
        raster_cols=image.raster_cols,
        u_min=image.u_min,
        u_max=image.u_max,
        z_min=image.z_min,
        z_max=image.z_max,
        projected_point_count=image.projected_point_count,
        valid_cell_count=image.valid_cell_count,
        surface_scale_u=recession.surface_scale_u,
        surface_scale_z=recession.surface_scale_z,
        recession_threshold_source_units=(recession.threshold_source_units),
        candidate_count=len(recession.regions),
        front_depth_runtime_seconds=(front_depth_runtime_seconds),
        recession_runtime_seconds=(recession_runtime_seconds),
        regions=regions,
        parameters={
            "front_depth": _config_parameters(image_config),
            "recession": _config_parameters(recession_config),
        },
    )


def summarize_radial_log_detection(
    result: RadialLogEndDetectionResult,
    *,
    config: RadialLogEndDetectionConfig | None = None,
    method: str = "radial",
) -> LogDetectionSummary:
    """Convert visible-log detector output to run schema."""

    parameters = _config_parameters(config)

    # This is a runtime diagnostic, not detector benchmark precision/recall.
    parameters["raw_candidate_count"] = result.raw_candidate_count

    return LogDetectionSummary(
        method=method,
        candidate_count=len(result.candidates),
        parameters=parameters,
    )
