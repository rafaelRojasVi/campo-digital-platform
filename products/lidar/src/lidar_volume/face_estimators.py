"""Competing face-boundary/contour estimators over one shared evidence bundle.

This module implements layers 1-3 of the shared experiment architecture in
docs/decisions/ADR-004-hybrid-measurement-experiment-architecture.md:

1. ``ProjectedFaceEvidence`` -- the common projected evidence every estimator
   consumes. It is built once, upstream, from the already-established local
   ``(u, v, z)`` face frame (see ``lidar_volume.front_cross_section`` and
   ``lidar_volume.projected_face_raster``); no estimator here recomputes
   localization, framing, or projection.
2. Mask estimators (currently one: the existing raster occupancy/filled
   evidence, exposed as a ``MaskEstimate``).
3. Contour estimators, each returning a ``ContourEstimate`` -- a closed
   polygon plus provenance. Per ADR-004, a purely geometric method may
   consume the raw evidence directly (the scanline and concave-hull
   estimators below); a method may also consume a ``MaskEstimate`` (the
   raster estimator below, and any future mask-producing method, including a
   future ML model, via the same ``mask_to_polygon`` path).

Layer 4 (common polygon measurement) lives in ``lidar_volume.face_boundary``.
Layer 5 (benchmark/reference-comparison) lives in
``lidar_volume.face_estimator_benchmark``.

Two Phase-1 candidates discussed in
docs/experiments/EXP-007-gs100g-boundary-estimator-comparison.md --
sub-cell marching-squares contouring and the density-supported vertical
envelope -- are deliberately NOT implemented here. EXP-007 already found the
former gives no demonstrated measurement benefit over raw raster area, and
the latter was rejected as a primary estimator; reproducing scikit-image's
marching squares would additionally require a new, currently-unused project
dependency. Re-implementing already-rejected methods is out of scope for
this benchmark-infrastructure work; see the module docstring in
``lidar_volume.face_estimator_benchmark`` for how they remain representable.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from lidar_volume.face_boundary import (
    PolygonalMeasurement,
    boundary_cell_points,
    concave_hull_polygon,
    mask_to_polygon,
    measure_polygon,
)
from lidar_volume.front_cross_section import FrontCrossSectionEstimate
from lidar_volume.front_depth import FrontDepthImage, FrontRecessionEstimate
from lidar_volume.projected_face_raster import ProjectedFaceRasterEstimate


@dataclass(frozen=True)
class ProjectedFaceEvidence:
    """Common projected evidence shared by every face-boundary estimator.

    ``cross_section`` and ``raster`` already share the same local face frame
    (``center_xy``/``longitudinal_axis``) -- ``raster`` is always computed
    from ``cross_section``'s frame, never its own. ``front_depth``/
    ``recession`` are optional, matching the existing pipeline's optional
    ``front_side`` diagnostic.
    """

    cross_section: FrontCrossSectionEstimate
    raster: ProjectedFaceRasterEstimate

    front_depth: FrontDepthImage | None = None
    recession: FrontRecessionEstimate | None = None


@dataclass(frozen=True)
class MaskEstimate:
    """A boolean mask over the shared raster grid, plus provenance.

    This is the "mask estimator" contract of ADR-004. Today the only mask
    producer is the existing raster kernel's own filled/occupancy/component
    masks; a future 2D model would populate this same type from its own
    probability threshold.
    """

    method_name: str

    mask: np.ndarray

    u_min: float
    cell_size_u: float
    z_min: float
    cell_size_z: float

    parameters: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)
    runtime_seconds: float = 0.0


@dataclass(frozen=True)
class ContourEstimate:
    """One estimator's closed-polygon output, with provenance.

    ``source`` names the evidence/mask this contour was derived from, so a
    later reader can tell a geometry-direct contour (e.g. ``"scanline"``)
    apart from a mask-derived one (e.g. ``"raster_filled_mask"``) without
    inspecting the estimator implementation.
    """

    method_name: str

    polygon: PolygonalMeasurement

    source: str
    parameters: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)

    runtime_seconds: float = 0.0


class FaceContourEstimator(ABC):
    """Common estimator interface for face-boundary/contour methods.

    Mirrors ``lidar_volume.base.VolumeEstimator``: subclasses implement
    ``_estimate``, and ``estimate`` wraps it with timing so every estimator
    reports a comparable ``runtime_seconds``.
    """

    method_name: str = "unset"

    @abstractmethod
    def _estimate(self, evidence: ProjectedFaceEvidence) -> ContourEstimate:
        raise NotImplementedError

    def estimate(self, evidence: ProjectedFaceEvidence) -> ContourEstimate:
        start = time.perf_counter()
        result = self._estimate(evidence)
        elapsed = time.perf_counter() - start

        return ContourEstimate(
            method_name=result.method_name,
            polygon=result.polygon,
            source=result.source,
            parameters=result.parameters,
            provenance=result.provenance,
            runtime_seconds=elapsed,
        )


class ScanlineContourEstimator(FaceContourEstimator):
    """Robust-quantile scanline estimator (EXP-007's strongest baseline/QC).

    Reuses the already-computed base/top envelopes from
    ``FrontCrossSectionEstimate`` directly -- it does not re-bin or
    re-quantile anything. The closed polygon formed by the top envelope
    (forward) and the base envelope (reversed) has an area that matches
    ``FrontCrossSectionEstimate.trapezoid_area`` by construction (each
    envelope segment is one trapezoidal strip).
    """

    method_name = "scanline_envelope"

    def _estimate(self, evidence: ProjectedFaceEvidence) -> ContourEstimate:
        cross_section = evidence.cross_section

        u = cross_section.bin_centres
        top = cross_section.top
        base = cross_section.base

        vertices = np.vstack(
            [
                np.column_stack([u, top]),
                np.column_stack([u[::-1], base[::-1]]),
            ]
        )

        # The scanline envelope promises one external contour, never QA
        # support geometry, so a surprise multi-part result must fail loudly
        # rather than silently reporting only its largest part.
        polygon = measure_polygon(
            vertices,
            method_name=self.method_name,
        ).require_single_part()

        return ContourEstimate(
            method_name=self.method_name,
            polygon=polygon,
            source="front_cross_section_envelope",
            parameters={
                "n_bins": len(u),
            },
            provenance={
                "trapezoid_area_source_units_squared": cross_section.trapezoid_area,
                "rectangle_area_source_units_squared": cross_section.rectangle_area,
            },
        )


class RasterMaskEstimator:
    """Wraps the existing projected-face raster's filled mask as a MaskEstimate."""

    method_name = "raster_filled_mask"

    def estimate(self, evidence: ProjectedFaceEvidence) -> MaskEstimate:
        start = time.perf_counter()
        raster = evidence.raster
        elapsed = time.perf_counter() - start

        return MaskEstimate(
            method_name=self.method_name,
            mask=raster.filled_mask,
            u_min=raster.u_min,
            cell_size_u=raster.cell_size_u,
            z_min=raster.z_min,
            cell_size_z=raster.cell_size_z,
            parameters={
                "cell_size_u": raster.cell_size_u,
                "cell_size_z": raster.cell_size_z,
            },
            provenance={
                "filled_cell_count": raster.filled_cell_count,
                "component_count": raster.component_count,
            },
            runtime_seconds=elapsed,
        )


class RasterContourEstimator(FaceContourEstimator):
    """Filled-raster occupancy area (EXP-007's topology/QA baseline).

    Consumes a ``MaskEstimate`` through the same generic ``mask_to_polygon``
    path any future mask-producing estimator (geometric or ML) would use.
    """

    method_name = "raster_filled"

    def __init__(self, mask_estimator: RasterMaskEstimator | None = None) -> None:
        self._mask_estimator = mask_estimator or RasterMaskEstimator()

    def _estimate(self, evidence: ProjectedFaceEvidence) -> ContourEstimate:
        mask_estimate = self._mask_estimator.estimate(evidence)

        polygon = mask_to_polygon(
            mask_estimate.mask,
            u_min=mask_estimate.u_min,
            cell_size_u=mask_estimate.cell_size_u,
            z_min=mask_estimate.z_min,
            cell_size_z=mask_estimate.cell_size_z,
            method_name=self.method_name,
        )

        return ContourEstimate(
            method_name=self.method_name,
            polygon=polygon,
            source=f"mask:{mask_estimate.method_name}",
            parameters=dict(mask_estimate.parameters),
            provenance={
                **mask_estimate.provenance,
                "raster_area_source_units_squared": (evidence.raster.area_source_units_squared),
            },
        )


@dataclass(frozen=True)
class ConcaveHullConfig:
    """Configuration for the concave-hull boundary estimator (EXP-007 candidate D).

    The default ratio is drawn from EXP-007's low-ratio stability sweep
    (approximately 0.002-0.010 was cross-resolution stable there). This is
    not a claim that 0.01 is correct for any given pile -- EXP-007 explicitly
    found the ratio still materially changes the resulting area, and no
    ratio should be chosen authoritatively without a same-pile reference.
    """

    ratio: float = 0.01
    mask_field: str = "filled_mask"


_VALID_RASTER_MASK_FIELDS = frozenset(
    {
        "occupancy_mask",
        "component_mask",
        "filled_mask",
    }
)


class ConcaveHullContourEstimator(FaceContourEstimator):
    """Concave-hull family estimator (EXP-007's active experimental candidate)."""

    method_name = "concave_hull"

    def __init__(self, config: ConcaveHullConfig | None = None) -> None:
        self._config = config or ConcaveHullConfig()

        if self._config.mask_field not in _VALID_RASTER_MASK_FIELDS:
            raise ValueError(
                f"mask_field must be one of {sorted(_VALID_RASTER_MASK_FIELDS)}, "
                f"got {self._config.mask_field!r}"
            )

    def _estimate(self, evidence: ProjectedFaceEvidence) -> ContourEstimate:
        raster = evidence.raster
        mask = getattr(raster, self._config.mask_field)

        points = boundary_cell_points(
            mask,
            u_min=raster.u_min,
            cell_size_u=raster.cell_size_u,
            z_min=raster.z_min,
            cell_size_z=raster.cell_size_z,
        )

        # shapely's concave_hull always returns a single Polygon, but the
        # concave-hull candidate also promises one external contour, so make
        # that guarantee explicit rather than implicit in shapely's contract.
        polygon = concave_hull_polygon(
            points,
            ratio=self._config.ratio,
            method_name=self.method_name,
        ).require_single_part()

        return ContourEstimate(
            method_name=self.method_name,
            polygon=polygon,
            source=f"boundary_points:{self._config.mask_field}",
            parameters={
                "ratio": self._config.ratio,
                "mask_field": self._config.mask_field,
                "boundary_point_count": len(points),
            },
            provenance={
                "raster_area_source_units_squared": raster.area_source_units_squared,
            },
        )
