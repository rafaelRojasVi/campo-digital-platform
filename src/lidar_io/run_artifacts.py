"""Machine-readable artifacts produced by measurement runs.

Artifacts contain detailed diagnostic data that is useful for plotting,
inspection, API responses, and future UI work without bloating the primary
MeasurementRun record.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

import numpy as np

from lidar_core.models import MeasurementArtifact
from lidar_core.visible_log_end_analysis import VisibleLogEndAnalysisResult
from lidar_io.las_rgb import NormalizedLasRgb
from lidar_volume.front_cross_section import FrontCrossSectionEstimate
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

FRONT_PROFILE_FILENAME = "front_profile.json"


def write_front_profile_artifact(
    estimate: FrontCrossSectionEstimate,
    run_directory: Path,
) -> MeasurementArtifact:
    """Persist per-bin observable front-profile geometry as JSON."""

    run_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = run_directory / FRONT_PROFILE_FILENAME

    bins: list[dict[str, float | int | None]] = []

    for index in range(len(estimate.bin_centres)):
        base_raw = estimate.base_raw[index]
        top_raw = estimate.top_raw[index]

        bins.append(
            {
                "index": index,
                "station": float(estimate.bin_centres[index]),
                "point_count": int(estimate.point_counts[index]),
                "base_raw": (float(base_raw) if np.isfinite(base_raw) else None),
                "top_raw": (float(top_raw) if np.isfinite(top_raw) else None),
                "base": float(estimate.base[index]),
                "top": float(estimate.top[index]),
                "height": float(estimate.height[index]),
            }
        )

    payload = {
        "schema_version": "1",
        "kind": "front_profile",
        "coordinate_units": "source_units",
        "longitudinal_min": estimate.longitudinal_min,
        "longitudinal_max": estimate.longitudinal_max,
        "longitudinal_span": estimate.longitudinal_span,
        "valid_bin_fraction": estimate.valid_bin_fraction,
        "rectangle_area": estimate.rectangle_area,
        "trapezoid_area": estimate.trapezoid_area,
        "bins": bins,
    }

    path.write_text(
        json.dumps(
            payload,
            indent=2,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )

    return MeasurementArtifact(
        kind="front_profile",
        path=FRONT_PROFILE_FILENAME,
        media_type="application/json",
        description=("Per-bin observable timber-stack front profile in source-coordinate units."),
    )


FRONT_PROFILE_PLOT_FILENAME = "front_profile.png"


def write_front_profile_plot_artifact(
    estimate: FrontCrossSectionEstimate,
    run_directory: Path,
) -> MeasurementArtifact:
    """Persist a visual representation of the observable front envelope."""

    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    run_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = run_directory / FRONT_PROFILE_PLOT_FILENAME

    figure = Figure(
        figsize=(10, 6),
        dpi=150,
    )
    canvas = FigureCanvasAgg(figure)
    axis = figure.subplots()

    station = np.asarray(
        estimate.bin_centres,
        dtype=np.float64,
    )
    base = np.asarray(
        estimate.base,
        dtype=np.float64,
    )
    top = np.asarray(
        estimate.top,
        dtype=np.float64,
    )

    axis.fill_between(
        station,
        base,
        top,
        alpha=0.25,
        label="Observed front envelope",
    )

    axis.plot(
        station,
        top,
        linewidth=1.2,
        label="Top envelope",
    )
    axis.plot(
        station,
        base,
        linewidth=1.2,
        label="Base envelope",
    )

    axis.set_title("Observable timber-stack front profile")
    axis.set_xlabel("Longitudinal station (source units)")
    axis.set_ylabel("Elevation (source units)")

    axis.grid(
        True,
        alpha=0.2,
    )
    axis.legend()
    figure.tight_layout()

    canvas.print_png(str(path))

    return MeasurementArtifact(
        kind="front_profile_plot",
        path=FRONT_PROFILE_PLOT_FILENAME,
        media_type="image/png",
        description=(
            "Observable timber-stack base and top envelopes plotted "
            "directly from the measured front-profile bins."
        ),
    )


FRONT_HEIGHT_PROFILE_PLOT_FILENAME = "front_height_profile.png"


def write_front_height_profile_plot_artifact(
    estimate: FrontCrossSectionEstimate,
    run_directory: Path,
) -> MeasurementArtifact:
    """Persist observable front-profile height versus longitudinal station."""

    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    run_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = run_directory / FRONT_HEIGHT_PROFILE_PLOT_FILENAME

    station = np.asarray(
        estimate.bin_centres,
        dtype=np.float64,
    )
    height = np.asarray(
        estimate.height,
        dtype=np.float64,
    )

    figure = Figure(
        figsize=(10, 5),
        dpi=150,
    )
    canvas = FigureCanvasAgg(figure)
    axis = figure.subplots()

    axis.fill_between(
        station,
        0.0,
        height,
        alpha=0.25,
        label="Observed profile height",
    )

    axis.plot(
        station,
        height,
        linewidth=1.4,
        label="Height",
    )

    median_height = float(np.median(height))

    axis.axhline(
        median_height,
        linewidth=1.0,
        linestyle="--",
        label=f"Median height = {median_height:.3f}",
    )

    axis.set_title("Observable timber-stack height profile")
    axis.set_xlabel("Longitudinal station (source units)")
    axis.set_ylabel("Profile height (source units)")

    axis.set_ylim(
        bottom=0.0,
    )

    axis.grid(
        True,
        alpha=0.2,
    )
    axis.legend()

    figure.tight_layout()

    canvas.print_png(str(path))

    return MeasurementArtifact(
        kind="front_height_profile_plot",
        path=FRONT_HEIGHT_PROFILE_PLOT_FILENAME,
        media_type="image/png",
        description=(
            "Observed timber-stack profile height computed directly as "
            "top envelope minus base envelope for each longitudinal bin."
        ),
    )


VISIBLE_LOG_END_ANALYSIS_FILENAME = "visible_log_end_candidates.json"


def _visible_log_end_relative_range_quantiles(
    result: VisibleLogEndAnalysisResult,
) -> dict[str, float | None]:
    values = np.asarray(
        [
            association.relative_diameter_range
            for association in result.resolved_summary.associations
        ],
        dtype=np.float64,
    )

    if len(values) == 0:
        return {
            "q50": None,
            "q75": None,
            "q90": None,
            "q95": None,
            "q99": None,
            "max": None,
        }

    return {
        "q50": float(np.quantile(values, 0.50)),
        "q75": float(np.quantile(values, 0.75)),
        "q90": float(np.quantile(values, 0.90)),
        "q95": float(np.quantile(values, 0.95)),
        "q99": float(np.quantile(values, 0.99)),
        "max": float(values.max()),
    }


def write_visible_log_end_analysis_artifact(
    result: VisibleLogEndAnalysisResult,
    run_directory: Path,
    *,
    rgb_provenance: NormalizedLasRgb,
) -> MeasurementArtifact:
    """Persist experimental visible log-end candidate evidence as JSON.

    The artifact records projected candidate geometry and cross-window
    association evidence. It does not represent a confirmed log count,
    validated solid-wood area, timber volume, or commercial cubicacion.
    """

    run_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = run_directory / VISIBLE_LOG_END_ANALYSIS_FILENAME

    observations: list[dict[str, object]] = []

    for index, evidence in enumerate(result.observations):
        area = evidence.candidate.area

        observations.append(
            {
                "index": index,
                "window_index": (result.observation_window_indices[index]),
                "x_px": evidence.candidate.x_px,
                "y_px": evidence.candidate.y_px,
                "radius_px": area.radius_px,
                "horizontal_units_per_pixel": (area.horizontal_units_per_pixel),
                "vertical_units_per_pixel": (area.vertical_units_per_pixel),
                "horizontal_radius_source_units": (area.horizontal_radius_source_units),
                "vertical_radius_source_units": (area.vertical_radius_source_units),
                "projected_area_source_units_squared": (area.projected_area_source_units_squared),
                "equivalent_radius_source_units": (area.equivalent_radius_source_units),
                "equivalent_diameter_source_units": (area.equivalent_diameter_source_units),
                "visible_support_count": (evidence.visible_support_count),
                "visible_source_indices": list(evidence.visible_source_indices),
            }
        )

    associations: list[dict[str, object]] = []

    for index, association in enumerate(result.resolved_summary.associations):
        associations.append(
            {
                "index": index,
                "member_indices": list(association.member_indices),
                "observation_count": (association.observation_count),
                "representative_equivalent_diameter_source_units": (
                    association.representative_equivalent_diameter_source_units
                ),
                "projected_area_source_units_squared": (
                    association.projected_area_source_units_squared
                ),
                "minimum_equivalent_diameter_source_units": (
                    association.minimum_equivalent_diameter_source_units
                ),
                "maximum_equivalent_diameter_source_units": (
                    association.maximum_equivalent_diameter_source_units
                ),
                "relative_diameter_range": (association.relative_diameter_range),
                "visible_source_union_count": (association.visible_source_union_count),
            }
        )

    payload = {
        "schema_version": "1",
        "kind": "visible_log_end_candidate_analysis",
        "coordinate_units": "source_units",
        "rgb_provenance": {
            "source_dtype": rgb_provenance.source_dtype,
            "payload_min": rgb_provenance.payload_min,
            "payload_max": rgb_provenance.payload_max,
            "normalization_denominator": (rgb_provenance.normalization_denominator),
            "normalization_mode": (rgb_provenance.normalization_mode),
            "radiometrically_calibrated": False,
        },
        "quantity": {
            "name": ("association_resolved_projected_log_end_candidate_area"),
            "unit": "source_units_squared",
            "value": (result.resolved_summary.projected_area_sum_source_units_squared),
        },
        "semantics": {
            "confirmed_log_count": False,
            "validated_solid_wood_area": False,
            "timber_volume": False,
            "commercial_cubicacion": False,
            "hidden_log_length_inferred": False,
        },
        "analysis_config": asdict(result.config),
        "detector_config": asdict(result.detector_config),
        "association_config": asdict(result.association_config),
        "summary": {
            "window_count": len(result.windows),
            "observation_count": (result.resolved_summary.observation_count),
            "supported_observation_count": (result.resolved_summary.supported_observation_count),
            "unsupported_observation_count": len(
                result.resolved_summary.unsupported_observation_indices
            ),
            "unsupported_observation_indices": list(
                result.resolved_summary.unsupported_observation_indices
            ),
            "association_hypothesis_count": (result.resolved_summary.association_count),
            "multi_observation_association_count": (
                result.resolved_summary.multi_observation_association_count
            ),
            "representative_method": (result.resolved_summary.representative_method),
            "projected_candidate_area_sum_source_units_squared": (
                result.resolved_summary.projected_area_sum_source_units_squared
            ),
        },
        "qc": {
            "relative_diameter_range_quantiles": (
                _visible_log_end_relative_range_quantiles(result)
            ),
        },
        "windows": [asdict(window) for window in result.windows],
        "observations": observations,
        "associations": associations,
    }

    path.write_text(
        json.dumps(
            payload,
            indent=2,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )

    return MeasurementArtifact(
        kind="visible_log_end_candidate_analysis",
        path=VISIBLE_LOG_END_ANALYSIS_FILENAME,
        media_type="application/json",
        description=(
            "Experimental visible log-end candidate geometry, "
            "cross-window evidence association, and diameter QC "
            "in source-coordinate units."
        ),
    )


FRONT_DEPTH_FILENAME = "front_depth_recession.json"


def write_front_depth_artifact(
    image: FrontDepthImage,
    recession: FrontRecessionEstimate,
    run_directory: Path,
    *,
    image_config: FrontDepthImageConfig,
    recession_config: RecessionDetectionConfig,
    front_depth_runtime_seconds: float,
    recession_runtime_seconds: float,
) -> MeasurementArtifact:
    """Persist experimental front-depth/recession diagnostics.

    Recessed regions are visibility candidates only. They are not confirmed
    physical voids and are not subtracted from face area or volume.
    """

    run_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = run_directory / FRONT_DEPTH_FILENAME

    regions = [
        {
            "rank": rank,
            "cell_count": region.cell_count,
            "projected_candidate_area_source_units_squared": (region.area_source_units_squared),
            "median_recession_source_units": (region.median_recession_source_units),
            "max_recession_source_units": (region.max_recession_source_units),
            "recession_score_source_units_cubed": (region.recession_score_source_units_cubed),
            "u_min": region.u_min,
            "u_max": region.u_max,
            "z_min": region.z_min,
            "z_max": region.z_max,
            "u_centroid": region.u_centroid,
            "z_centroid": region.z_centroid,
        }
        for rank, region in enumerate(
            recession.regions,
            start=1,
        )
    ]

    payload = {
        "schema_version": "1",
        "kind": "front_depth_recession",
        "estimator_status": "experimental_candidate",
        "authoritative_measurement": False,
        "reference_validated": False,
        "coordinate_units": "source_units",
        "semantics": {
            "front_visibility_diagnostic": True,
            "confirmed_physical_voids": False,
            "subtracted_from_face_area": False,
            "affects_volume": False,
            "affects_readiness": False,
            "commercial_cubicacion": False,
        },
        "front_side": image.front_side,
        "front_depth": {
            "cell_size_u": image.cell_size_u,
            "cell_size_z": image.cell_size_z,
            "rows": image.raster_rows,
            "cols": image.raster_cols,
            "u_min": image.u_min,
            "u_max": image.u_max,
            "z_min": image.z_min,
            "z_max": image.z_max,
            "projected_point_count": image.projected_point_count,
            "valid_cell_count": image.valid_cell_count,
        },
        "recession": {
            "surface_scale_u": recession.surface_scale_u,
            "surface_scale_z": recession.surface_scale_z,
            "threshold_source_units": recession.threshold_source_units,
            "candidate_count": len(recession.regions),
            "regions": regions,
        },
        "config": {
            "front_depth": asdict(image_config),
            "recession": asdict(recession_config),
        },
        "runtime_seconds": {
            "front_depth": front_depth_runtime_seconds,
            "recession": recession_runtime_seconds,
            "combined": (front_depth_runtime_seconds + recession_runtime_seconds),
        },
    }

    path.write_text(
        json.dumps(
            payload,
            indent=2,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )

    return MeasurementArtifact(
        kind="front_depth_recession",
        path=FRONT_DEPTH_FILENAME,
        media_type="application/json",
        description=(
            "Experimental front-depth visibility diagnostics and ranked "
            "recessed-region candidates in source-coordinate units; "
            "not reference-validated and not subtracted from face area."
        ),
    )


FRONT_DEPTH_PLOT_FILENAME = "front_depth_recession.png"


def write_front_depth_plot_artifact(
    image: FrontDepthImage,
    recession: FrontRecessionEstimate,
    run_directory: Path,
) -> MeasurementArtifact:
    """Persist visual QA for front-depth and positive-depth recession."""

    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    run_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = run_directory / FRONT_DEPTH_PLOT_FILENAME

    extent = (
        image.u_min,
        image.u_max,
        image.z_min,
        image.z_max,
    )

    figure = Figure(
        figsize=(13, 6),
        dpi=150,
    )
    canvas = FigureCanvasAgg(figure)

    depth_axis, recession_axis = figure.subplots(
        1,
        2,
    )

    depth_plot = np.ma.masked_where(
        ~image.valid_mask,
        image.front_depth_normalized,
    )

    depth_image = depth_axis.imshow(
        depth_plot,
        origin="lower",
        extent=extent,
        aspect="auto",
        cmap="viridis",
    )

    figure.colorbar(
        depth_image,
        ax=depth_axis,
        label="normalized front depth v",
    )

    depth_axis.set_title("Robust front-depth image")
    depth_axis.set_xlabel("Longitudinal station u")
    depth_axis.set_ylabel("Elevation z")

    recession_plot = np.ma.masked_where(
        ~image.valid_mask,
        recession.recession_source_units,
    )

    finite_recession = recession.recession_source_units[image.valid_mask]

    vmax = (
        float(
            np.quantile(
                finite_recession,
                0.995,
            )
        )
        if finite_recession.size
        else 1.0
    )

    if vmax <= 0:
        vmax = 1.0

    recession_image = recession_axis.imshow(
        recession_plot,
        origin="lower",
        extent=extent,
        aspect="auto",
        cmap="magma",
        vmin=0.0,
        vmax=vmax,
    )

    figure.colorbar(
        recession_image,
        ax=recession_axis,
        label="positive depth recession",
    )

    for rank, region in enumerate(
        recession.regions[:15],
        start=1,
    ):
        recession_axis.plot(
            [
                region.u_min,
                region.u_max,
                region.u_max,
                region.u_min,
                region.u_min,
            ],
            [
                region.z_min,
                region.z_min,
                region.z_max,
                region.z_max,
                region.z_min,
            ],
            linewidth=0.8,
        )

        recession_axis.text(
            region.u_centroid,
            region.z_centroid,
            str(rank),
            fontsize=7,
            ha="center",
            va="center",
        )

    recession_axis.set_title(
        f"Positive-depth recession candidates (threshold={recession.threshold_source_units:.3f})"
    )
    recession_axis.set_xlabel("Longitudinal station u")
    recession_axis.set_ylabel("Elevation z")

    figure.tight_layout()

    canvas.print_png(
        path,
    )

    return MeasurementArtifact(
        kind="front_depth_recession_plot",
        path=FRONT_DEPTH_PLOT_FILENAME,
        media_type="image/png",
        description=(
            "QA visualization of front-depth evidence and experimental recessed-region candidates."
        ),
    )


PROJECTED_FACE_RASTER_FILENAME = "projected_face_raster.json"


def write_projected_face_raster_artifact(
    estimate: ProjectedFaceRasterEstimate,
    run_directory: Path,
    *,
    config: ProjectedFaceRasterConfig,
    runtime_seconds: float,
    scanline_trapezoid_area: float | None = None,
    scanline_disagreement_fraction: float | None = None,
) -> MeasurementArtifact:
    """Persist projected face-area raster diagnostics as JSON.

    Only scalar diagnostics are persisted here; the occupancy/component/
    filled masks are visualized in the companion PNG artifact instead of
    being serialized as large arrays.
    """

    run_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = run_directory / PROJECTED_FACE_RASTER_FILENAME

    payload = {
        "schema_version": "1",
        "kind": "projected_face_raster",
        "estimator_status": "experimental_candidate",
        "authoritative_measurement": False,
        "reference_validated": False,
        "coordinate_units": "source_units",
        "quantity": {
            "name": "candidate_gross_projected_external_silhouette_area",
            "unit": "source_units_squared",
            "value": estimate.area_source_units_squared,
        },
        "semantics": {
            "raw_3d_surface_area": False,
            "convex_hull_area": False,
            "width_times_max_height": False,
            "per_log_circle_summation": False,
            "solid_wood_area": False,
            "commercial_cubicacion": False,
        },
        "config": asdict(config),
        "raster": {
            "cell_size_u": estimate.cell_size_u,
            "cell_size_z": estimate.cell_size_z,
            "rows": estimate.raster_rows,
            "cols": estimate.raster_cols,
            "u_min": estimate.u_min,
            "u_max": estimate.u_max,
            "z_min": estimate.z_min,
            "z_max": estimate.z_max,
            "projected_point_count": estimate.projected_point_count,
            "raw_occupied_cell_count": estimate.raw_occupied_cell_count,
            "denoised_occupied_cell_count": estimate.denoised_occupied_cell_count,
            "retained_component_cell_count": estimate.retained_component_cell_count,
            "filled_cell_count": estimate.filled_cell_count,
            "component_count": estimate.component_count,
        },
        "runtime_seconds": runtime_seconds,
        "comparison": {
            "reference_status": "independent_baseline_not_ground_truth",
            "scanline_method": "trapezoidal_robust_top_bottom_envelope",
            "scanline_trapezoid_area_source_units_squared": scanline_trapezoid_area,
            "disagreement_fraction": scanline_disagreement_fraction,
        },
    }

    path.write_text(
        json.dumps(
            payload,
            indent=2,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )

    return MeasurementArtifact(
        kind="projected_face_raster",
        path=PROJECTED_FACE_RASTER_FILENAME,
        media_type="application/json",
        description=(
            "Experimental candidate gross projected silhouette area and "
            "raster diagnostics in source-coordinate units; not reference-validated."
        ),
    )


PROJECTED_FACE_RASTER_PLOT_FILENAME = "projected_face_raster.png"


def write_projected_face_raster_plot_artifact(
    estimate: ProjectedFaceRasterEstimate,
    run_directory: Path,
    *,
    front_cross_section: FrontCrossSectionEstimate | None = None,
) -> MeasurementArtifact:
    """Persist a visual QA raster of the recovered face silhouette.

    Shows raw occupancy evidence, the final filled gross silhouette, and
    (when available) the independent scanline base/top envelopes on the
    same (u, z) frame for visual disagreement inspection.
    """

    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    run_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = run_directory / PROJECTED_FACE_RASTER_PLOT_FILENAME

    extent = (estimate.u_min, estimate.u_max, estimate.z_min, estimate.z_max)

    figure = Figure(
        figsize=(10, 6),
        dpi=150,
    )
    canvas = FigureCanvasAgg(figure)
    axis = figure.subplots()

    axis.imshow(
        estimate.occupancy_mask,
        origin="lower",
        extent=extent,
        aspect="auto",
        cmap="Greys",
        alpha=0.35,
    )

    axis.imshow(
        np.ma.masked_where(~estimate.filled_mask, estimate.filled_mask),
        origin="lower",
        extent=extent,
        aspect="auto",
        cmap="Oranges",
        alpha=0.55,
    )

    axis.contour(
        estimate.filled_mask.astype(np.float64),
        levels=[0.5],
        extent=extent,
        origin="lower",
        colors="firebrick",
        linewidths=1.2,
    )

    if front_cross_section is not None:
        axis.plot(
            front_cross_section.bin_centres,
            front_cross_section.top,
            linewidth=1.0,
            linestyle="--",
            color="tab:blue",
            label="Scanline top envelope",
        )
        axis.plot(
            front_cross_section.bin_centres,
            front_cross_section.base,
            linewidth=1.0,
            linestyle="--",
            color="tab:green",
            label="Scanline base envelope",
        )
        axis.legend()

    axis.set_title("Projected gross face-area silhouette (raster)")
    axis.set_xlabel("Longitudinal station u (source units)")
    axis.set_ylabel("Elevation z (source units)")

    axis.grid(
        True,
        alpha=0.2,
    )

    figure.tight_layout()

    canvas.print_png(str(path))

    return MeasurementArtifact(
        kind="projected_face_raster_plot",
        path=PROJECTED_FACE_RASTER_PLOT_FILENAME,
        media_type="image/png",
        description=(
            "Raw occupancy evidence, retained principal component, and "
            "filled gross silhouette for the projected face-area raster, "
            "optionally overlaid with the scanline base/top envelopes."
        ),
    )
