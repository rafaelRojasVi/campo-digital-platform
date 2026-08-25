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
    LogDetectionSummary,
    MeasurementReadiness,
    MeasurementReadinessStage,
    MeasurementRunStatus,
    MeasurementWarning,
    MeasurementWarningSeverity,
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
        TimberStackDetectionConfig | FrontCrossSectionConfig | RadialLogEndDetectionConfig | None
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
