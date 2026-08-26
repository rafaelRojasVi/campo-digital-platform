"""Shared benchmark orchestration for competing face-boundary estimators.

This is layer 5 of the shared experiment architecture in
products/lidar/docs/decisions/ADR-004-hybrid-measurement-experiment-architecture.md: one
place that builds the common projected evidence once, runs every configured
``FaceContourEstimator`` against it, and reports comparable outcomes.

Until a confirmed same-pile reference is supplied, this module deliberately
reports estimator disagreement and diagnostics only -- never "accuracy",
"percent error", or a declared "winner". See ``compare_against_reference``
for the one place an error metric can be produced, and note that it is
gated by the existing ``lidar_core.face_area_reference`` contract exactly as
for any other estimator in this project.

Historical/rejected candidates
-------------------------------
products/lidar/docs/experiments/EXP-007-gs100g-boundary-estimator-comparison.md also
evaluated sub-cell marching-squares contouring and a density-supported
vertical envelope. Both are recorded here as non-runnable entries in
``HISTORICAL_METHODS`` -- listed for transparency, but not backed by
executable code in this module -- because EXP-007 already reached a
negative/rejected conclusion for both and no reusable implementation exists
in this repository (marching squares would additionally require adding
scikit-image as a new dependency). Selecting one of these names raises
``EstimatorNotAvailableError`` with a pointer to the EXP-007 finding.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from lidar_core.face_area_reference import compare_face_area
from lidar_core.models import FaceAreaComparison, FaceAreaReference, FaceAreaUnit
from lidar_volume.face_estimators import (
    ConcaveHullContourEstimator,
    ContourEstimate,
    FaceContourEstimator,
    ProjectedFaceEvidence,
    RasterContourEstimator,
    ScanlineContourEstimator,
)
from lidar_volume.front_cross_section import (
    FrontCrossSectionConfig,
    estimate_front_cross_section,
)
from lidar_volume.front_depth import (
    FrontDepthImageConfig,
    FrontSide,
    RecessionDetectionConfig,
    detect_recessed_regions,
    estimate_front_depth_image,
)
from lidar_volume.projected_face_raster import (
    ProjectedFaceRasterConfig,
    estimate_projected_face_raster,
)

HISTORICAL_METHODS: dict[str, str] = {
    "marching_squares": (
        "EXP-007 section 8: sub-cell marching-squares contouring changed area "
        "by <=0.033% relative to the filled raster; no demonstrated measurement "
        "benefit. Not implemented here (would require adding scikit-image)."
    ),
    "density_supported_envelope": (
        "EXP-007 section 9: parameter-sensitive (grid size and density "
        "threshold); rejected as a primary V1 estimator. Not implemented here."
    ),
    "exact_alpha_shape": (
        "Deferred per docs/roadmap.md Phase 1 until a same-pile client "
        "reference justifies calibrating its own alpha parameter. Not "
        "implemented here."
    ),
}


class EstimatorNotAvailableError(ValueError):
    """Raised when a requested method name is historical/not implemented."""


def default_estimator_registry() -> dict[str, FaceContourEstimator]:
    """Return the Phase-1 runnable estimator registry, keyed by method name."""

    return {
        ScanlineContourEstimator.method_name: ScanlineContourEstimator(),
        RasterContourEstimator.method_name: RasterContourEstimator(),
        ConcaveHullContourEstimator.method_name: ConcaveHullContourEstimator(),
    }


def build_projected_face_evidence(
    xyz: np.ndarray,
    *,
    cross_section_config: FrontCrossSectionConfig | None = None,
    raster_config: ProjectedFaceRasterConfig | None = None,
    front_side: FrontSide | None = None,
    front_depth_config: FrontDepthImageConfig | None = None,
    recession_config: RecessionDetectionConfig | None = None,
) -> ProjectedFaceEvidence:
    """Build the common projected evidence once, from raw (already-selected) points.

    Mirrors the localization-independent portion of
    ``lidar_io.measurement_pipeline.run_timber_measurement``: the raster (and,
    when requested, the front-depth image) is always derived from the same
    ``cross_section`` face frame, never its own.
    """

    cross_section = estimate_front_cross_section(
        xyz,
        config=cross_section_config,
    )

    raster = estimate_projected_face_raster(
        xyz,
        cross_section.center_xy,
        cross_section.longitudinal_axis,
        config=raster_config,
    )

    front_depth = None
    recession = None

    if front_side is not None:
        front_depth = estimate_front_depth_image(
            xyz,
            cross_section.center_xy,
            cross_section.longitudinal_axis,
            front_side=front_side,
            config=front_depth_config,
        )

        recession = detect_recessed_regions(
            front_depth,
            recession_config,
        )

    return ProjectedFaceEvidence(
        cross_section=cross_section,
        raster=raster,
        front_depth=front_depth,
        recession=recession,
    )


@dataclass(frozen=True)
class FaceEstimatorOutcome:
    """One estimator's outcome within a benchmark run."""

    contour: ContourEstimate
    reference_comparison: FaceAreaComparison | None = None


@dataclass(frozen=True)
class FaceEstimatorBenchmarkResult:
    """Full comparable result set for one benchmark run over one evidence bundle.

    ``pairwise_disagreement`` uses the same symmetric relative-difference
    formula already used for the scanline/raster comparison in
    ``lidar_io.measurement_pipeline``:
    ``|a - b| / (0.5 * (a + b))``. It is a disagreement metric between two
    estimators, not an error metric against any ground truth.
    """

    evidence: ProjectedFaceEvidence
    outcomes: tuple[FaceEstimatorOutcome, ...]
    pairwise_disagreement: dict[tuple[str, str], float]
    warnings: tuple[str, ...] = field(default_factory=tuple)


def _symmetric_relative_difference(a: float, b: float) -> float | None:
    denominator = 0.5 * (a + b)

    if denominator <= 0:
        return None

    return abs(a - b) / denominator


def _pairwise_disagreement(
    outcomes: tuple[FaceEstimatorOutcome, ...],
) -> dict[tuple[str, str], float]:
    disagreement: dict[tuple[str, str], float] = {}

    for i in range(len(outcomes)):
        for j in range(i + 1, len(outcomes)):
            left = outcomes[i].contour
            right = outcomes[j].contour

            value = _symmetric_relative_difference(
                left.polygon.area_source_units_squared,
                right.polygon.area_source_units_squared,
            )

            if value is not None:
                disagreement[(left.method_name, right.method_name)] = value

    return disagreement


def run_face_estimator_benchmark(
    xyz: np.ndarray,
    *,
    method_names: list[str] | None = None,
    estimators: dict[str, FaceContourEstimator] | None = None,
    cross_section_config: FrontCrossSectionConfig | None = None,
    raster_config: ProjectedFaceRasterConfig | None = None,
    front_side: FrontSide | None = None,
    face_area_reference: FaceAreaReference | None = None,
    estimate_unit: FaceAreaUnit = FaceAreaUnit.SOURCE_UNITS_SQUARED,
) -> FaceEstimatorBenchmarkResult:
    """Build shared evidence once and run every requested estimator against it.

    ``face_area_reference`` is passed straight through the existing
    ``compare_face_area`` gate: error metrics remain unavailable whenever the
    reference is not confirmed to describe the same pile or its unit does not
    match ``estimate_unit`` -- this function does not weaken that contract.
    """

    registry = estimators if estimators is not None else default_estimator_registry()

    resolved_names = method_names if method_names is not None else sorted(registry)

    unknown = [name for name in resolved_names if name not in registry]

    historical = [name for name in unknown if name in HISTORICAL_METHODS]

    if historical:
        raise EstimatorNotAvailableError(
            "; ".join(f"{name}: {HISTORICAL_METHODS[name]}" for name in historical)
        )

    truly_unknown = [name for name in unknown if name not in HISTORICAL_METHODS]

    if truly_unknown:
        raise ValueError(f"unknown estimator method name(s): {truly_unknown}")

    evidence = build_projected_face_evidence(
        xyz,
        cross_section_config=cross_section_config,
        raster_config=raster_config,
        front_side=front_side,
    )

    outcomes: list[FaceEstimatorOutcome] = []

    for name in resolved_names:
        contour = registry[name].estimate(evidence)

        reference_comparison = None

        if face_area_reference is not None:
            reference_comparison = compare_face_area(
                estimate_method=contour.method_name,
                estimate_value=contour.polygon.area_source_units_squared,
                estimate_unit=estimate_unit,
                reference=face_area_reference,
            )

        outcomes.append(
            FaceEstimatorOutcome(
                contour=contour,
                reference_comparison=reference_comparison,
            )
        )

    outcomes_tuple = tuple(outcomes)

    return FaceEstimatorBenchmarkResult(
        evidence=evidence,
        outcomes=outcomes_tuple,
        pairwise_disagreement=_pairwise_disagreement(outcomes_tuple),
    )
