"""`lidar` CLI entry point.

Functional commands include inspect, analyze, info, crop, generate-synthetic,
volume, measure, compare, and robustness. Explicit experimental/stub commands
are documented at their individual entry points.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, cast

import laspy
import numpy as np
import typer
from rich.console import Console
from rich.table import Table

from lidar_core.models import (
    FaceAreaReference,
    FaceAreaUnit,
    ReferenceMeasurement,
    VolumeComparisonRecord,
    VolumeUnit,
)
from lidar_core.testing import cube, cylinder, rectangular_prism
from lidar_core.volume_comparison import compare_volume_result
from lidar_io.analyze import analyze_las
from lidar_io.comparison_store import write_comparison_record
from lidar_io.dataset_robustness import build_dataset_robustness_matrix
from lidar_io.dataset_robustness_store import write_dataset_robustness_matrix
from lidar_io.face_estimator_benchmark_pipeline import (
    run_face_estimator_benchmark_from_las,
)
from lidar_io.inspect import inspect_las
from lidar_io.measurement_pipeline import run_timber_measurement
from lidar_io.run_store import read_measurement_run
from lidar_volume.face_estimator_benchmark import (
    HISTORICAL_METHODS,
    EstimatorNotAvailableError,
    default_estimator_registry,
)
from lidar_volume.face_estimators import ConcaveHullConfig, ConcaveHullContourEstimator
from lidar_volume.front_cross_section import (
    FrontCrossSectionConfig,
    estimate_front_cross_section,
    extruded_volume,
)
from lidar_volume.front_depth import FrontSide
from lidar_volume.projected_face_raster import ProjectedFaceRasterConfig

app = typer.Typer(add_completion=False, help="Campo Digital LiDAR engineering CLI.")
console = Console()


def _face_area_unit_label(unit: FaceAreaUnit) -> str:
    if unit == FaceAreaUnit.SQUARE_METRES:
        return "m²"

    return "source-units²"


@app.command()
def inspect(
    path: Annotated[Path, typer.Argument(help="Path to a LAS/LAZ file.")],
    json_output: Annotated[
        bool, typer.Option("--json", help="Emit JSON instead of a table.")
    ] = False,
    no_checksum: Annotated[
        bool, typer.Option("--no-checksum", help="Skip sha256 computation.")
    ] = False,
) -> None:
    """Forensic inspection of a LAS/LAZ file's header/metadata."""
    try:
        meta = inspect_las(path, compute_checksum=not no_checksum)
    except FileNotFoundError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(code=1) from exc

    if json_output:
        print(meta.model_dump_json(indent=2))
        return

    table = Table(title=f"LAS Inspection: {meta.path}")
    table.add_column("Field")
    table.add_column("Value")
    table.add_row("File size", f"{meta.file_size_bytes:,} bytes")
    table.add_row("SHA256", meta.sha256 or "(skipped)")
    table.add_row("LAS version", f"{meta.las_version_major}.{meta.las_version_minor}")
    table.add_row("Point format", str(meta.point_format_id))
    table.add_row("Point count", f"{meta.point_count:,}")
    table.add_row("Scales", str(meta.scales))
    table.add_row("Offsets", str(meta.offsets))
    b = meta.bounds
    table.add_row(
        "Observed bounds",
        f"X[{b.min_x:.3f},{b.max_x:.3f}] Y[{b.min_y:.3f},{b.max_y:.3f}] "
        f"Z[{b.min_z:.3f},{b.max_z:.3f}]",
    )

    hb = meta.header_bounds
    table.add_row(
        "Header bounds",
        f"X[{hb.min_x:.3f},{hb.max_x:.3f}] Y[{hb.min_y:.3f},{hb.max_y:.3f}] "
        f"Z[{hb.min_z:.3f},{hb.max_z:.3f}]",
    )
    table.add_row("Header bounds match", str(meta.header_bounds_match))
    table.add_row(
        "Observed spans",
        f"dx={b.span_x:.3f} dy={b.span_y:.3f} dz={b.span_z:.3f}",
    )
    crs = meta.coordinate_metadata
    table.add_row(
        "CRS",
        f"EPSG:{crs.crs_epsg}" if crs.is_explicit and crs.crs_epsg else "MISSING/AMBIGUOUS",
    )
    table.add_row("Standard dims", ", ".join(meta.dimensions.standard_dims))
    table.add_row("Extra dims", ", ".join(meta.dimensions.extra_dims) or "(none)")
    table.add_row("RGB", str(meta.dimensions.has_rgb))
    table.add_row("Intensity", str(meta.dimensions.has_intensity))
    table.add_row("GPS time", str(meta.dimensions.has_gps_time))
    table.add_row("VLRs", str(meta.vlr_count))
    table.add_row("EVLRs", str(meta.evlr_count))
    table.add_row("Classification histogram", str(meta.classification_histogram) or "(none)")
    table.add_row("Return-number histogram", str(meta.return_number_histogram) or "(none)")
    if meta.warnings:
        table.add_row("[yellow]Warnings[/yellow]", "\n".join(meta.warnings))
    console.print(table)


@app.command()
def analyze(
    path: Annotated[Path, typer.Argument(help="Path to a LAS/LAZ file.")],
    json_output: Annotated[
        bool, typer.Option("--json", help="Emit JSON instead of a table.")
    ] = False,
) -> None:
    """Stream acquisition/export diagnostics from a LAS/LAZ file."""
    try:
        result = analyze_las(path)
    except FileNotFoundError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(code=1) from exc

    if json_output:
        print(result.model_dump_json(indent=2))
        return

    def fmt(value: float | None) -> str:
        return "(n/a)" if value is None else f"{value:.9g}"

    table = Table(title=f"LAS Acquisition Analysis: {result.path}")
    table.add_column("Field")
    table.add_column("Value")

    table.add_row("Point count", f"{result.point_count:,}")

    if result.observed_bounds is not None:
        b = result.observed_bounds
        table.add_row(
            "Observed bounds",
            f"X[{b.min_x:.3f},{b.max_x:.3f}] "
            f"Y[{b.min_y:.3f},{b.max_y:.3f}] "
            f"Z[{b.min_z:.3f},{b.max_z:.3f}]",
        )

    table.add_row("GPS time present", str(result.gps_time_present))
    table.add_row(
        "GPS time range",
        f"{fmt(result.gps_time_min)} -> {fmt(result.gps_time_max)} "
        f"(span={fmt(result.gps_time_span)})",
    )
    table.add_row(
        "GPS file-order endpoints",
        f"first={fmt(result.gps_time_first)} last={fmt(result.gps_time_last)}",
    )
    table.add_row(
        "GPS non-decreasing",
        str(result.gps_time_non_decreasing),
    )
    table.add_row(
        "GPS order steps",
        f"backward={result.gps_time_backward_steps} equal={result.gps_time_equal_steps}",
    )
    table.add_row(
        "GPS positive step",
        f"min={fmt(result.gps_time_min_positive_step)} "
        f"max={fmt(result.gps_time_max_positive_step)}",
    )

    table.add_row(
        "Equal-time same-return",
        str(result.equal_time_adjacent_same_return_pairs),
    )
    table.add_row(
        "Equal-time cross-return",
        str(result.equal_time_adjacent_cross_return_pairs),
    )
    table.add_row(
        "Equal-time R1/R2",
        (
            f"{result.equal_time_adjacent_r1_r2_pairs} "
            f"(fraction={fmt(result.equal_time_adjacent_r1_r2_fraction)})"
        ),
    )

    if result.paired_return_distance is not None:
        s = result.paired_return_distance
        table.add_row(
            "R1/R2 3D separation",
            f"min={fmt(s.minimum)} mean={fmt(s.mean)} max={fmt(s.maximum)}",
        )

    for axis, summary in (
        ("X", result.paired_return_abs_delta_x),
        ("Y", result.paired_return_abs_delta_y),
        ("Z", result.paired_return_abs_delta_z),
    ):
        if summary is not None:
            table.add_row(
                f"R1/R2 |delta {axis}|",
                (f"min={fmt(summary.minimum)} mean={fmt(summary.mean)} max={fmt(summary.maximum)}"),
            )

    if result.paired_return_abs_intensity_delta is not None:
        s = result.paired_return_abs_intensity_delta
        table.add_row(
            "R1/R2 |intensity delta|",
            f"min={fmt(s.minimum)} mean={fmt(s.mean)} max={fmt(s.maximum)}",
        )

    if result.timestamp_groups is not None:
        groups = result.timestamp_groups

        table.add_row(
            "Timestamp groups",
            (
                f"count={groups.group_count:,} "
                f"max-size={groups.max_group_size} "
                f"sizes={groups.size_counts}"
            ),
        )

        table.add_row(
            "2-record patterns",
            str(groups.two_record_return_pattern_counts),
        )

        table.add_row(
            "Exact 2-record R1/R2",
            (
                f"{groups.two_record_r1_r2_groups:,}/"
                f"{groups.two_record_groups:,} "
                f"(fraction={fmt(groups.two_record_r1_r2_fraction)})"
            ),
        )

        if groups.exact_pair_distance is not None:
            summary = groups.exact_pair_distance
            table.add_row(
                "Exact-pair 3D separation",
                (f"min={fmt(summary.minimum)} mean={fmt(summary.mean)} max={fmt(summary.maximum)}"),
            )

        for axis, summary in (
            ("X", groups.exact_pair_abs_delta_x),
            ("Y", groups.exact_pair_abs_delta_y),
            ("Z", groups.exact_pair_abs_delta_z),
        ):
            if summary is not None:
                table.add_row(
                    f"Exact-pair |delta {axis}|",
                    (
                        f"min={fmt(summary.minimum)} "
                        f"mean={fmt(summary.mean)} "
                        f"max={fmt(summary.maximum)}"
                    ),
                )

        if groups.exact_pair_abs_intensity_delta is not None:
            summary = groups.exact_pair_abs_intensity_delta
            table.add_row(
                "Exact-pair |intensity delta|",
                (f"min={fmt(summary.minimum)} mean={fmt(summary.mean)} max={fmt(summary.maximum)}"),
            )

    if result.intensity is not None:
        s = result.intensity
        table.add_row(
            "Intensity",
            f"min={fmt(s.minimum)} mean={fmt(s.mean)} max={fmt(s.maximum)}",
        )

    for channel in ("red", "green", "blue"):
        if channel in result.rgb:
            s = result.rgb[channel]
            table.add_row(
                f"RGB {channel}",
                f"min={fmt(s.minimum)} mean={fmt(s.mean)} max={fmt(s.maximum)}",
            )

    if result.scan_angle_degrees is not None:
        s = result.scan_angle_degrees
        table.add_row(
            "Scan angle (degrees)",
            f"min={fmt(s.minimum)} mean={fmt(s.mean)} max={fmt(s.maximum)}",
        )

    table.add_row("Return-number counts", str(result.return_number_counts))
    table.add_row("Number-of-returns counts", str(result.number_of_returns_counts))
    table.add_row("Point-source IDs", str(result.point_source_id_counts))
    table.add_row("Scan-direction flags", str(result.scan_direction_flag_counts))
    table.add_row("Edge-of-flight-line flags", str(result.edge_of_flight_line_counts))

    table.add_row(
        "Global XY density",
        (
            "(n/a)"
            if result.xy_density_points_per_square_source_unit is None
            else (f"{result.xy_density_points_per_square_source_unit:.6f} points/source-unit²")
        ),
    )

    for return_summary in result.return_summaries:
        b = return_summary.bounds
        intensity_mean = (
            "(n/a)" if return_summary.intensity is None else fmt(return_summary.intensity.mean)
        )
        table.add_row(
            f"Return {return_summary.return_number}",
            f"{return_summary.point_count:,} points; "
            f"X[{b.min_x:.3f},{b.max_x:.3f}] "
            f"Y[{b.min_y:.3f},{b.max_y:.3f}] "
            f"Z[{b.min_z:.3f},{b.max_z:.3f}]; "
            f"intensity mean={intensity_mean}",
        )

    if result.warnings:
        table.add_row(
            "[yellow]Warnings[/yellow]",
            "\n".join(result.warnings),
        )

    console.print(table)


@app.command()
def robustness(
    paths: Annotated[
        list[Path],
        typer.Argument(help="One or more LAS/LAZ datasets to characterize."),
    ],
    output: Annotated[
        Path,
        typer.Option(
            "--output",
            help="Path for the persisted robustness-matrix JSON artifact.",
        ),
    ],
    deep: Annotated[
        bool,
        typer.Option(
            "--deep",
            help=("Also run streaming acquisition diagnostics. Inspection-only is the default."),
        ),
    ] = False,
    checksum: Annotated[
        bool,
        typer.Option(
            "--checksum",
            help="Compute SHA256 where supported by the inspection layer.",
        ),
    ] = False,
    overwrite: Annotated[
        bool,
        typer.Option(
            "--overwrite",
            help="Explicitly replace an existing output artifact.",
        ),
    ] = False,
) -> None:
    """Build and persist a multi-dataset LAS/LAZ robustness matrix."""

    matrix = build_dataset_robustness_matrix(
        paths,
        deep=deep,
        compute_checksum=checksum,
    )

    try:
        output_path = write_dataset_robustness_matrix(
            matrix,
            output,
            overwrite=overwrite,
        )
    except OSError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(code=1) from exc

    table = Table(title="Dataset Robustness Matrix")
    table.add_column("Field")
    table.add_column("Value")

    table.add_row(
        "Profile",
        "deep" if matrix.deep else "inspection-only",
    )
    table.add_row(
        "Datasets",
        str(matrix.total_datasets),
    )
    table.add_row(
        "Successful",
        str(matrix.successful_datasets),
    )
    table.add_row(
        "Failed",
        str(matrix.failed_datasets),
    )
    table.add_row(
        "Runtime",
        f"{matrix.total_runtime_seconds:.3f} s",
    )
    table.add_row(
        "Output",
        str(output_path),
    )

    if matrix.failures:
        table.add_row(
            "[yellow]Failures[/yellow]",
            "\n".join(
                (f"{failure.path}: {failure.error_type}: {failure.message}")
                for failure in matrix.failures
            ),
        )

    console.print(table)

    if matrix.failed_datasets:
        raise typer.Exit(code=3)


@app.command()
def info(path: Annotated[Path, typer.Argument(help="Path to a LAS/LAZ file.")]) -> None:
    """Alias for a concise `inspect` summary (JSON)."""
    try:
        meta = inspect_las(path)
    except FileNotFoundError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(code=1) from exc
    print(
        json.dumps(
            {
                "path": meta.path,
                "point_count": meta.point_count,
                "las_version": f"{meta.las_version_major}.{meta.las_version_minor}",
                "point_format": meta.point_format_id,
                "crs_explicit": meta.coordinate_metadata.is_explicit,
                "warnings": meta.warnings,
            },
            indent=2,
        )
    )


@app.command()
def crop(
    input_path: Annotated[Path, typer.Argument(help="Input LAS/LAZ file.")],
    output_path: Annotated[Path, typer.Argument(help="Output LAS file.")],
    min_x: Annotated[float, typer.Option()],
    min_y: Annotated[float, typer.Option()],
    max_x: Annotated[float, typer.Option()],
    max_y: Annotated[float, typer.Option()],
    min_z: Annotated[float | None, typer.Option()] = None,
    max_z: Annotated[float | None, typer.Option()] = None,
) -> None:
    """Deterministic axis-aligned crop of a LAS file (laspy-based, no PDAL required)."""
    if not input_path.exists():
        console.print(f"[red]Error:[/red] input file not found: {input_path}")
        raise typer.Exit(code=1)

    las = laspy.read(str(input_path))
    points = np.column_stack([las.x, las.y, las.z])
    mask = (
        (points[:, 0] >= min_x)
        & (points[:, 0] <= max_x)
        & (points[:, 1] >= min_y)
        & (points[:, 1] <= max_y)
    )
    if min_z is not None:
        mask &= points[:, 2] >= min_z
    if max_z is not None:
        mask &= points[:, 2] <= max_z

    cropped = las.points[mask]
    out = laspy.LasData(header=las.header)
    out.points = cropped
    out.write(str(output_path))
    console.print(f"Cropped {mask.sum():,}/{len(points):,} points -> [green]{output_path}[/green]")


_SYNTHETIC_GENERATORS: dict[str, Callable[..., tuple[np.ndarray, float]]] = {
    "cube": cube,
    "prism": rectangular_prism,
    "cylinder": cylinder,
}


@app.command("generate-synthetic")
def generate_synthetic(
    shape: Annotated[str, typer.Argument(help="One of: cube, prism, cylinder.")],
    output_path: Annotated[Path, typer.Argument(help="Output LAS file.")],
    n_points: Annotated[int, typer.Option(help="Number of points to sample.")] = 2000,
    seed: Annotated[int, typer.Option(help="RNG seed for reproducibility.")] = 0,
) -> None:
    """Generate a synthetic LAS file for testing/demo purposes (no real data)."""
    if shape not in _SYNTHETIC_GENERATORS:
        console.print(
            f"[red]Error:[/red] unknown shape '{shape}'. Choose from {list(_SYNTHETIC_GENERATORS)}."
        )
        raise typer.Exit(code=1)

    points, volume = _SYNTHETIC_GENERATORS[shape](n_points=n_points, seed=seed)

    header = laspy.LasHeader(point_format=3, version="1.4")
    header.scales = [0.001, 0.001, 0.001]
    header.offsets = [0.0, 0.0, 0.0]
    las = laspy.LasData(header)
    las.x = points[:, 0]
    las.y = points[:, 1]
    las.z = points[:, 2]
    las.write(str(output_path))
    console.print(
        f"Wrote {len(points):,} synthetic '{shape}' points to [green]{output_path}[/green] "
        f"(analytic volume = {volume:.6f} cubic source-units; CRS intentionally unset)."
    )


@app.command()
def sections(input_path: Annotated[Path, typer.Argument()]) -> None:
    """NOT YET IMPLEMENTED: sectional decomposition CLI."""
    console.print(
        "[yellow]Not yet implemented.[/yellow] "
        "Use lidar_volume.cross_section.compute_sections directly."
    )
    raise typer.Exit(code=2)


@app.command()
def volume(
    input_path: Annotated[
        Path,
        typer.Argument(
            help="Path to a LAS/LAZ timber-front ROI.",
        ),
    ],
    depth: Annotated[
        float | None,
        typer.Option(
            "--depth",
            help=(
                "Explicit extrusion depth in source-coordinate units. "
                "If omitted, no cubic volume is computed."
            ),
        ),
    ] = None,
    bins: Annotated[
        int,
        typer.Option(
            "--bins",
            help="Number of longitudinal bins for the front-wall profile.",
        ),
    ] = 160,
) -> None:
    """Measure observable timber-front area and optional extrusion volume."""

    if not input_path.is_file():
        console.print(f"[red]Error:[/red] LAS/LAZ file not found: {input_path}")
        raise typer.Exit(code=1)

    if bins < 2:
        console.print("[red]Error:[/red] --bins must be >= 2.")
        raise typer.Exit(code=1)

    if depth is not None and depth < 0:
        console.print("[red]Error:[/red] --depth must be non-negative.")
        raise typer.Exit(code=1)

    las = laspy.read(input_path)

    xyz = np.column_stack(
        (
            np.asarray(las.x),
            np.asarray(las.y),
            np.asarray(las.z),
        )
    )

    try:
        estimate = estimate_front_cross_section(
            xyz,
            FrontCrossSectionConfig(
                n_bins=bins,
            ),
        )
    except ValueError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(code=1) from exc

    table = Table(title=f"Timber Front Measurement: {input_path}")

    table.add_column("Field")
    table.add_column("Value")

    table.add_row(
        "Point count",
        f"{len(xyz):,}",
    )

    table.add_row(
        "Longitudinal span",
        f"{estimate.longitudinal_span:.6f} source units",
    )

    table.add_row(
        "Valid bins",
        f"{estimate.valid_bin_fraction:.3%}",
    )

    table.add_row(
        "Median height",
        f"{np.median(estimate.height):.6f} source units",
    )

    table.add_row(
        "Maximum height",
        f"{np.max(estimate.height):.6f} source units",
    )

    table.add_row(
        "Rectangle area",
        f"{estimate.rectangle_area:.6f} source-units²",
    )

    table.add_row(
        "Trapezoid area",
        f"{estimate.trapezoid_area:.6f} source-units²",
    )

    if depth is None:
        table.add_row(
            "Extruded volume",
            "(not computed; provide --depth)",
        )
    else:
        volume_value = extruded_volume(
            estimate.rectangle_area,
            depth,
        )

        table.add_row(
            "Assumed depth",
            f"{depth:.6f} source units",
        )

        table.add_row(
            "Extruded volume",
            f"{volume_value:.6f} source-units³",
        )

    console.print(table)

    console.print()
    console.print(
        "[yellow]Units:[/yellow] Results remain in source-coordinate "
        "units. This command does not infer metres from LAS scale, "
        "offsets, or missing/ambiguous CRS metadata."
    )

    if depth is not None:
        console.print(
            "[yellow]Model:[/yellow] Cubic volume is the geometric "
            "extrusion A_front × depth. The supplied depth is not "
            "inferred or validated from the current LAS."
        )


@app.command()
def measure(
    input_path: Annotated[
        Path,
        typer.Argument(
            help="Path to a LAS/LAZ candidate region containing the timber stack.",
        ),
    ],
    output_root: Annotated[
        Path,
        typer.Option(
            "--output-root",
            help="Root directory for persisted measurement-run artifacts.",
        ),
    ] = Path("products/lidar/reports/out"),
    run_id: Annotated[
        str | None,
        typer.Option(
            "--run-id",
            help="Optional explicit run identifier.",
        ),
    ] = None,
    code_version: Annotated[
        str | None,
        typer.Option(
            "--code-version",
            help="Optional code/version identifier recorded in run provenance.",
        ),
    ] = None,
    depth: Annotated[
        float | None,
        typer.Option(
            "--depth",
            help=("Explicit pile depth in source-coordinate units. Never inferred from the LAS."),
        ),
    ] = None,
    depth_source: Annotated[
        str | None,
        typer.Option(
            "--depth-source",
            help=("Provenance for the explicit pile depth, for example client_measurement."),
        ),
    ] = None,
    input_already_isolated: Annotated[
        bool,
        typer.Option(
            "--input-already-isolated",
            help=(
                "Treat the complete input cloud as an already-isolated timber "
                "measurement region and bypass automatic pile localization."
            ),
        ),
    ] = False,
    front_side: Annotated[
        str | None,
        typer.Option(
            "--front-side",
            help=("Enable front-depth/recession diagnostics. Expected value: low_v or high_v."),
        ),
    ] = None,
    reference_face_area: Annotated[
        float | None,
        typer.Option(
            "--reference-face-area",
            help="Optional explicit reference area for the same timber-stack face.",
        ),
    ] = None,
    reference_face_area_unit: Annotated[
        str | None,
        typer.Option(
            "--reference-face-area-unit",
            help=("Reference face-area unit: source_units_squared or square_metres."),
        ),
    ] = None,
    reference_face_area_method: Annotated[
        str | None,
        typer.Option(
            "--reference-face-area-method",
            help=(
                "Method/provenance for the reference face area, for example "
                "lidar360_manual_polygon."
            ),
        ),
    ] = None,
    reference_face_area_label: Annotated[
        str,
        typer.Option(
            "--reference-face-area-label",
            help="Human-readable label for the face-area reference.",
        ),
    ] = "reference",
    reference_face_area_source: Annotated[
        str | None,
        typer.Option(
            "--reference-face-area-source",
            help="Optional organization/person/source for the reference.",
        ),
    ] = None,
    reference_face_area_notes: Annotated[
        str | None,
        typer.Option(
            "--reference-face-area-notes",
            help="Optional notes about the face-area reference.",
        ),
    ] = None,
    same_pile_reference: Annotated[
        bool,
        typer.Option(
            "--same-pile-reference",
            help=("Explicitly confirm that the supplied reference describes the same timber pile."),
        ),
    ] = False,
) -> None:
    """Run the observable timber-stack measurement pipeline."""

    if not input_path.is_file():
        console.print(f"[red]Error:[/red] LAS/LAZ file not found: {input_path}")
        raise typer.Exit(code=1)

    reference_metadata_supplied = (
        any(
            value is not None
            for value in (
                reference_face_area_unit,
                reference_face_area_method,
                reference_face_area_source,
                reference_face_area_notes,
            )
        )
        or same_pile_reference
    )

    if reference_face_area is None and reference_metadata_supplied:
        console.print("[red]Error:[/red] face-area reference options require --reference-face-area")
        raise typer.Exit(code=1)

    resolved_front_side: FrontSide | None = None

    if front_side is not None:
        if front_side not in {"low_v", "high_v"}:
            console.print(
                "[red]Error:[/red] invalid --front-side "
                f"'{front_side}'. Expected one of: low_v, high_v"
            )
            raise typer.Exit(code=1)

        resolved_front_side = cast(
            FrontSide,
            front_side,
        )

    face_area_reference = None

    if reference_face_area is not None:
        if reference_face_area_unit is None:
            console.print(
                "[red]Error:[/red] --reference-face-area-unit is required "
                "when --reference-face-area is supplied"
            )
            raise typer.Exit(code=1)

        if reference_face_area_method is None or not reference_face_area_method.strip():
            console.print(
                "[red]Error:[/red] --reference-face-area-method is required "
                "when --reference-face-area is supplied"
            )
            raise typer.Exit(code=1)

        try:
            face_area_unit = FaceAreaUnit(reference_face_area_unit)
        except ValueError as exc:
            allowed = ", ".join(unit.value for unit in FaceAreaUnit)
            console.print(
                "[red]Error:[/red] invalid --reference-face-area-unit "
                f"'{reference_face_area_unit}'. Expected one of: {allowed}"
            )
            raise typer.Exit(code=1) from exc

        try:
            face_area_reference = FaceAreaReference(
                label=reference_face_area_label,
                value=reference_face_area,
                unit=face_area_unit,
                method=reference_face_area_method.strip(),
                source=reference_face_area_source,
                same_pile_confirmed=same_pile_reference,
                notes=reference_face_area_notes,
            )
        except ValueError as exc:
            console.print(f"[red]Error:[/red] {exc}")
            raise typer.Exit(code=1) from exc

    try:
        run, measurement_path = run_timber_measurement(
            input_path,
            output_root,
            run_id=run_id,
            code_version=code_version,
            pile_depth=depth,
            depth_source=depth_source,
            input_already_isolated=input_already_isolated,
            front_side=resolved_front_side,
            face_area_reference=face_area_reference,
        )
    except (ValueError, FileExistsError) as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(code=1) from exc

    table = Table(title=f"Measurement Run: {run.run_id}")
    table.add_column("Field")
    table.add_column("Value")

    table.add_row(
        "Status",
        run.status.value,
    )

    if run.readiness is not None:
        table.add_row(
            "Readiness",
            run.readiness.stage.value,
        )
        table.add_row(
            "Observable geometry",
            ("ready" if run.readiness.observable_geometry_ready else "not ready"),
        )
        table.add_row(
            "Geometric volume",
            ("ready" if run.readiness.geometric_volume_ready else "not ready"),
        )
        table.add_row(
            "Physical face area",
            ("ready" if run.readiness.physical_face_area_ready else "not ready"),
        )
        table.add_row(
            "Reference validation",
            ("validated" if run.readiness.reference_validated else "not validated"),
        )

    table.add_row(
        "Source",
        run.source_path,
    )
    table.add_row(
        "Measurement JSON",
        str(measurement_path),
    )

    if run.timber_stack is not None:
        table.add_row(
            "Localization mode",
            run.timber_stack.localization_mode,
        )
        table.add_row(
            "Input points",
            f"{run.timber_stack.point_count_input:,}",
        )
        table.add_row(
            "Selected timber points",
            f"{run.timber_stack.point_count_selected:,}",
        )
        table.add_row(
            "Selected fraction",
            f"{run.timber_stack.selected_fraction:.3%}",
        )

    if run.front_cross_section is not None:
        table.add_row(
            "Longitudinal span",
            (f"{run.front_cross_section.longitudinal_span:.6f} source units"),
        )
        table.add_row(
            "Median height",
            (f"{run.front_cross_section.median_height:.6f} source units"),
        )
        table.add_row(
            "Rectangle area",
            (f"{run.front_cross_section.rectangle_area:.6f} source-units²"),
        )
        table.add_row(
            "Trapezoid area",
            (f"{run.front_cross_section.trapezoid_area:.6f} source-units²"),
        )

    if run.front_depth is not None:
        table.add_row(
            "Front side",
            run.front_depth.front_side,
        )
        table.add_row(
            "Recession candidates",
            str(run.front_depth.candidate_count),
        )

        if run.front_depth.front_depth_runtime_seconds is not None:
            table.add_row(
                "Front-depth runtime",
                (f"{run.front_depth.front_depth_runtime_seconds:.3f} s"),
            )

        if run.front_depth.recession_runtime_seconds is not None:
            table.add_row(
                "Recession runtime",
                (f"{run.front_depth.recession_runtime_seconds:.3f} s"),
            )

    if run.projected_face_raster is not None:
        table.add_row(
            "Projected raster area",
            (f"{run.projected_face_raster.area_source_units_squared:.6f} source-units²"),
        )

        disagreement = run.projected_face_raster.scanline_disagreement_fraction

        if disagreement is not None:
            table.add_row(
                "Raster vs scanline",
                f"{disagreement:.3%}",
            )

    if run.results:
        result = run.results[0]

        table.add_row(
            "Geometric volume",
            f"{result.volume:.6f} {result.volume_unit.value}",
        )
        table.add_row(
            "Volume method",
            result.method,
        )

        pile_depth = result.parameters.get("pile_depth")
        if pile_depth is not None:
            table.add_row(
                "Explicit pile depth",
                f"{float(pile_depth):.6f} source units",
            )

        depth_provenance = result.parameters.get("depth_source")
        if depth_provenance is not None:
            table.add_row(
                "Depth source",
                str(depth_provenance),
            )

    console.print(table)

    if run.face_area_comparison is not None:
        comparison = run.face_area_comparison

        console.print()

        reference_table = Table(title="Face Area Reference")
        reference_table.add_column("Field")
        reference_table.add_column("Value")

        estimate_unit_label = _face_area_unit_label(comparison.estimate_unit)
        reference_unit_label = _face_area_unit_label(comparison.reference.unit)

        reference_table.add_row(
            "Automatic estimator",
            comparison.estimate_method,
        )
        reference_table.add_row(
            "Automatic area",
            (f"{comparison.estimate_value:.6f} {estimate_unit_label}"),
        )
        reference_table.add_row(
            "Reference area",
            (f"{comparison.reference.value:.6f} {reference_unit_label}"),
        )
        reference_table.add_row(
            "Reference label",
            comparison.reference.label,
        )
        reference_table.add_row(
            "Reference method",
            comparison.reference.method,
        )

        if comparison.reference.source is not None:
            reference_table.add_row(
                "Reference source",
                comparison.reference.source,
            )

        reference_table.add_row(
            "Same pile confirmed",
            ("yes" if comparison.reference.same_pile_confirmed else "no"),
        )

        reference_table.add_row(
            "Comparison",
            ("ready" if comparison.comparison_ready else "blocked"),
        )

        if comparison.comparison_ready:
            if comparison.signed_error is not None:
                reference_table.add_row(
                    "Signed difference",
                    (f"{comparison.signed_error:+.6f} {estimate_unit_label}"),
                )

            if comparison.absolute_error is not None:
                reference_table.add_row(
                    "Absolute difference",
                    (f"{comparison.absolute_error:.6f} {estimate_unit_label}"),
                )

            if comparison.percent_error is not None:
                reference_table.add_row(
                    "Percent error",
                    f"{comparison.percent_error:+.3f}%",
                )

            if comparison.absolute_percent_error is not None:
                reference_table.add_row(
                    "Absolute percent error",
                    (f"{comparison.absolute_percent_error:.3f}%"),
                )
        else:
            reference_table.add_row(
                "Comparison blockers",
                ", ".join(comparison.blocker_codes),
            )

        console.print(reference_table)

        console.print()
        console.print(
            "[yellow]Reference semantics:[/yellow] This face-area comparison "
            "does not by itself promote the measurement run to the "
            "volume-level reference_validated readiness stage."
        )

    if run.artifacts:
        console.print()
        artifact_table = Table(title="Artifacts")
        artifact_table.add_column("Kind")
        artifact_table.add_column("Path")

        for artifact in run.artifacts:
            artifact_table.add_row(
                artifact.kind,
                str(measurement_path.parent / artifact.path),
            )

        console.print(artifact_table)

    blockers = [warning for warning in run.warnings if warning.severity.value == "blocker"]

    if blockers:
        console.print()
        console.print("[yellow]Blockers:[/yellow]")
        for warning in blockers:
            console.print(f"- {warning.code}: {warning.message}")


@app.command()
def compare(
    measurement_path: Annotated[
        Path,
        typer.Argument(
            help="Path to an existing measurement.json.",
        ),
    ],
    reference_value: Annotated[
        float,
        typer.Option(
            "--reference-value",
            help="Explicit reference volume value.",
        ),
    ],
    reference_unit: Annotated[
        str,
        typer.Option(
            "--reference-unit",
            help=(
                "Reference volume unit. Must exactly match the estimate: "
                "m3 or cubic_units_unspecified."
            ),
        ),
    ],
    reference_method: Annotated[
        str,
        typer.Option(
            "--reference-method",
            help=("Provenance/method for the reference, for example lidar360_client_report."),
        ),
    ],
    comparison_id: Annotated[
        str,
        typer.Option(
            "--comparison-id",
            help="Stable identifier for the persisted comparison.",
        ),
    ],
    reference_label: Annotated[
        str,
        typer.Option(
            "--reference-label",
            help="Human-readable reference label.",
        ),
    ] = "reference",
    result_index: Annotated[
        int,
        typer.Option(
            "--result-index",
            help="VolumeResult index from the measurement run.",
        ),
    ] = 0,
    reference_notes: Annotated[
        str | None,
        typer.Option(
            "--reference-notes",
            help="Optional notes about the reference measurement.",
        ),
    ] = None,
) -> None:
    """Compare one persisted volume estimate against an explicit reference."""

    if not measurement_path.is_file():
        console.print(f"[red]Error:[/red] measurement file not found: {measurement_path}")
        raise typer.Exit(code=1)

    try:
        run = read_measurement_run(measurement_path)
    except (OSError, ValueError) as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(code=1) from exc

    if result_index < 0 or result_index >= len(run.results):
        console.print(
            "[red]Error:[/red] "
            f"--result-index {result_index} is out of range; "
            f"run contains {len(run.results)} volume result(s)."
        )
        raise typer.Exit(code=1)

    try:
        unit = VolumeUnit(reference_unit)
    except ValueError as exc:
        allowed = ", ".join(unit.value for unit in VolumeUnit)
        console.print(
            "[red]Error:[/red] invalid --reference-unit "
            f"'{reference_unit}'. Expected one of: {allowed}"
        )
        raise typer.Exit(code=1) from exc

    reference = ReferenceMeasurement(
        label=reference_label,
        value=reference_value,
        unit=unit,
        method=reference_method,
        notes=reference_notes,
    )

    estimate = run.results[result_index]

    try:
        comparison = compare_volume_result(
            estimate,
            reference,
        )

        record = VolumeComparisonRecord(
            comparison_id=comparison_id,
            run_id=run.run_id,
            estimate_result_index=result_index,
            comparison=comparison,
        )

        output_root = measurement_path.parent.parent

        comparison_path = write_comparison_record(
            record,
            output_root,
        )
    except (ValueError, FileExistsError) as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(code=1) from exc

    table = Table(title=f"Volume Comparison: {comparison_id}")
    table.add_column("Field")
    table.add_column("Value")

    table.add_row("Run", run.run_id)
    table.add_row("Estimate method", comparison.estimate_method)
    table.add_row(
        "Estimate",
        f"{comparison.estimate_value:.6f} {comparison.unit.value}",
    )
    table.add_row(
        "Reference",
        f"{comparison.reference.value:.6f} {comparison.unit.value}",
    )
    table.add_row(
        "Reference method",
        comparison.reference.method,
    )
    table.add_row(
        "Signed error",
        f"{comparison.signed_error:.6f} {comparison.unit.value}",
    )
    table.add_row(
        "Absolute error",
        f"{comparison.absolute_error:.6f} {comparison.unit.value}",
    )

    if comparison.percent_error is not None:
        table.add_row(
            "Percent error",
            f"{comparison.percent_error:.6f}%",
        )
        table.add_row(
            "Absolute percent error",
            f"{comparison.absolute_percent_error:.6f}%",
        )
    else:
        table.add_row(
            "Relative error",
            "(undefined for zero-valued reference)",
        )

    table.add_row(
        "Comparison JSON",
        str(comparison_path),
    )

    console.print(table)


@app.command("benchmark-face-estimators")
def benchmark_face_estimators(
    input_path: Annotated[
        Path | None,
        typer.Argument(
            help=(
                "Path to a LAS/LAZ candidate region containing the timber "
                "stack. Not required with --list-methods."
            ),
        ),
    ] = None,
    output_root: Annotated[
        Path,
        typer.Option(
            "--output-root",
            help="Root directory for persisted benchmark artifacts.",
        ),
    ] = Path("products/lidar/reports/out"),
    run_id: Annotated[
        str | None,
        typer.Option(
            "--run-id",
            help="Optional explicit run identifier.",
        ),
    ] = None,
    code_version: Annotated[
        str | None,
        typer.Option(
            "--code-version",
            help="Optional code/version identifier recorded in run provenance.",
        ),
    ] = None,
    input_already_isolated: Annotated[
        bool,
        typer.Option(
            "--input-already-isolated",
            help=(
                "Treat the complete input cloud as an already-isolated timber "
                "measurement region and bypass automatic pile localization."
            ),
        ),
    ] = False,
    method: Annotated[
        list[str] | None,
        typer.Option(
            "--method",
            help=(
                "Restrict the benchmark to one or more estimator method "
                "names (repeatable). Defaults to every Phase-1 runnable "
                "method. See --list-methods for available names."
            ),
        ),
    ] = None,
    front_side: Annotated[
        str | None,
        typer.Option(
            "--front-side",
            help="Also build front-depth/recession evidence. Expected value: low_v or high_v.",
        ),
    ] = None,
    concave_hull_ratio: Annotated[
        float,
        typer.Option(
            "--concave-hull-ratio",
            help=(
                "Hull-tightness ratio for the concave_hull estimator. "
                "Default follows EXP-007's low-ratio stability sweep; it is "
                "not claimed to be correct for any given pile."
            ),
        ),
    ] = 0.01,
    raster_cell_size_u: Annotated[
        float | None,
        typer.Option(
            "--raster-cell-size-u",
            help=(
                "Raster cell size along u (source units) for raster_filled/"
                "concave_hull. Defaults to ProjectedFaceRasterConfig's own "
                "default (0.05) when not supplied. EXP-007's sensitivity "
                "sweep used 0.020/0.050/0.075/0.100/0.150."
            ),
        ),
    ] = None,
    raster_cell_size_z: Annotated[
        float | None,
        typer.Option(
            "--raster-cell-size-z",
            help="Raster cell size along z (source units). See --raster-cell-size-u.",
        ),
    ] = None,
    raster_min_points_per_cell: Annotated[
        int | None,
        typer.Option(
            "--raster-min-points-per-cell",
            help=(
                "Minimum points for a raster cell to count as occupied. "
                "EXP-007's sensitivity sweep used 1, 2, and 3."
            ),
        ),
    ] = None,
    raster_connectivity: Annotated[
        int | None,
        typer.Option(
            "--raster-connectivity",
            help="Raster connected-component connectivity: 4 or 8.",
        ),
    ] = None,
    raster_min_component_cells: Annotated[
        int | None,
        typer.Option(
            "--raster-min-component-cells",
            help="Minimum cell count for a raster connected component to be retained.",
        ),
    ] = None,
    raster_closing_iterations: Annotated[
        int | None,
        typer.Option(
            "--raster-closing-iterations",
            help="Binary-closing iterations applied to the raster before hole filling.",
        ),
    ] = None,
    raster_u_quantile_low: Annotated[
        float | None,
        typer.Option(
            "--raster-u-quantile-low",
            help=(
                "Lower u quantile trim for the raster (0.0-1.0). EXP-008's "
                "default is untrimmed (0.0); EXP-007's matching-u-trim sweep "
                "used 0.01."
            ),
        ),
    ] = None,
    raster_u_quantile_high: Annotated[
        float | None,
        typer.Option(
            "--raster-u-quantile-high",
            help="Upper u quantile trim for the raster (0.0-1.0). See --raster-u-quantile-low.",
        ),
    ] = None,
    raster_z_quantile_low: Annotated[
        float | None,
        typer.Option(
            "--raster-z-quantile-low",
            help="Lower z quantile trim for the raster (0.0-1.0).",
        ),
    ] = None,
    raster_z_quantile_high: Annotated[
        float | None,
        typer.Option(
            "--raster-z-quantile-high",
            help="Upper z quantile trim for the raster (0.0-1.0).",
        ),
    ] = None,
    reference_face_area: Annotated[
        float | None,
        typer.Option(
            "--reference-face-area",
            help="Optional explicit reference area for the same timber-stack face.",
        ),
    ] = None,
    reference_face_area_unit: Annotated[
        str | None,
        typer.Option(
            "--reference-face-area-unit",
            help=("Reference face-area unit: source_units_squared or square_metres."),
        ),
    ] = None,
    reference_face_area_method: Annotated[
        str | None,
        typer.Option(
            "--reference-face-area-method",
            help=(
                "Method/provenance for the reference face area, for example "
                "lidar360_manual_polygon."
            ),
        ),
    ] = None,
    reference_face_area_label: Annotated[
        str,
        typer.Option(
            "--reference-face-area-label",
            help="Human-readable label for the face-area reference.",
        ),
    ] = "reference",
    reference_face_area_source: Annotated[
        str | None,
        typer.Option(
            "--reference-face-area-source",
            help="Optional organization/person/source for the reference.",
        ),
    ] = None,
    reference_face_area_notes: Annotated[
        str | None,
        typer.Option(
            "--reference-face-area-notes",
            help="Optional notes about the face-area reference.",
        ),
    ] = None,
    same_pile_reference: Annotated[
        bool,
        typer.Option(
            "--same-pile-reference",
            help=("Explicitly confirm that the supplied reference describes the same timber pile."),
        ),
    ] = False,
    list_methods: Annotated[
        bool,
        typer.Option(
            "--list-methods",
            help="List available and historical estimator method names, then exit.",
        ),
    ] = False,
) -> None:
    """Run the shared face-boundary estimator benchmark on one LAS/LAZ file.

    Builds the common projected evidence (local face frame, projected
    raster) once and runs every requested estimator against it, reporting
    estimator disagreement, parameter sensitivity, and runtime -- not
    "accuracy" or a declared winner, unless a confirmed same-pile reference
    is supplied via --reference-face-area.
    """

    if list_methods:
        table = Table(title="Face Estimator Methods")
        table.add_column("Method")
        table.add_column("Status")
        table.add_column("Notes")

        for name in sorted(default_estimator_registry()):
            table.add_row(name, "runnable", "")

        for name, note in HISTORICAL_METHODS.items():
            table.add_row(name, "historical (not implemented)", note)

        console.print(table)
        return

    if input_path is None:
        console.print(
            "[red]Error:[/red] an input LAS/LAZ path is required (or pass --list-methods)"
        )
        raise typer.Exit(code=1)

    if not input_path.is_file():
        console.print(f"[red]Error:[/red] LAS/LAZ file not found: {input_path}")
        raise typer.Exit(code=1)

    resolved_front_side: FrontSide | None = None

    if front_side is not None:
        if front_side not in {"low_v", "high_v"}:
            console.print(
                "[red]Error:[/red] invalid --front-side "
                f"'{front_side}'. Expected one of: low_v, high_v"
            )
            raise typer.Exit(code=1)

        resolved_front_side = cast(
            FrontSide,
            front_side,
        )

    reference_metadata_supplied = (
        any(
            value is not None
            for value in (
                reference_face_area_unit,
                reference_face_area_method,
                reference_face_area_source,
                reference_face_area_notes,
            )
        )
        or same_pile_reference
    )

    if reference_face_area is None and reference_metadata_supplied:
        console.print("[red]Error:[/red] face-area reference options require --reference-face-area")
        raise typer.Exit(code=1)

    face_area_reference = None

    if reference_face_area is not None:
        if reference_face_area_unit is None:
            console.print(
                "[red]Error:[/red] --reference-face-area-unit is required "
                "when --reference-face-area is supplied"
            )
            raise typer.Exit(code=1)

        if reference_face_area_method is None or not reference_face_area_method.strip():
            console.print(
                "[red]Error:[/red] --reference-face-area-method is required "
                "when --reference-face-area is supplied"
            )
            raise typer.Exit(code=1)

        try:
            face_area_unit = FaceAreaUnit(reference_face_area_unit)
        except ValueError as exc:
            allowed = ", ".join(unit.value for unit in FaceAreaUnit)
            console.print(
                "[red]Error:[/red] invalid --reference-face-area-unit "
                f"'{reference_face_area_unit}'. Expected one of: {allowed}"
            )
            raise typer.Exit(code=1) from exc

        try:
            face_area_reference = FaceAreaReference(
                label=reference_face_area_label,
                value=reference_face_area,
                unit=face_area_unit,
                method=reference_face_area_method.strip(),
                source=reference_face_area_source,
                same_pile_confirmed=same_pile_reference,
                notes=reference_face_area_notes,
            )
        except ValueError as exc:
            console.print(f"[red]Error:[/red] {exc}")
            raise typer.Exit(code=1) from exc

    estimators = default_estimator_registry()
    estimators[ConcaveHullContourEstimator.method_name] = ConcaveHullContourEstimator(
        ConcaveHullConfig(ratio=concave_hull_ratio)
    )

    # Only override the fields the caller actually supplied; everything else
    # keeps ProjectedFaceRasterConfig's own defaults, and any invalid
    # combination fails through that dataclass's existing validation inside
    # estimate_projected_face_raster -- not a second, separate CLI check.
    default_raster_config = ProjectedFaceRasterConfig()

    raster_config = ProjectedFaceRasterConfig(
        cell_size_u=(
            raster_cell_size_u
            if raster_cell_size_u is not None
            else default_raster_config.cell_size_u
        ),
        cell_size_z=(
            raster_cell_size_z
            if raster_cell_size_z is not None
            else default_raster_config.cell_size_z
        ),
        min_points_per_cell=(
            raster_min_points_per_cell
            if raster_min_points_per_cell is not None
            else default_raster_config.min_points_per_cell
        ),
        connectivity=(
            raster_connectivity
            if raster_connectivity is not None
            else default_raster_config.connectivity
        ),
        min_component_cells=(
            raster_min_component_cells
            if raster_min_component_cells is not None
            else default_raster_config.min_component_cells
        ),
        closing_iterations=(
            raster_closing_iterations
            if raster_closing_iterations is not None
            else default_raster_config.closing_iterations
        ),
        u_quantile_low=(
            raster_u_quantile_low
            if raster_u_quantile_low is not None
            else default_raster_config.u_quantile_low
        ),
        u_quantile_high=(
            raster_u_quantile_high
            if raster_u_quantile_high is not None
            else default_raster_config.u_quantile_high
        ),
        z_quantile_low=(
            raster_z_quantile_low
            if raster_z_quantile_low is not None
            else default_raster_config.z_quantile_low
        ),
        z_quantile_high=(
            raster_z_quantile_high
            if raster_z_quantile_high is not None
            else default_raster_config.z_quantile_high
        ),
    )

    try:
        result, benchmark_path, summary_path = run_face_estimator_benchmark_from_las(
            input_path,
            output_root,
            run_id=run_id,
            code_version=code_version,
            input_already_isolated=input_already_isolated,
            method_names=method,
            estimators=estimators,
            raster_config=raster_config,
            front_side=resolved_front_side,
            face_area_reference=face_area_reference,
        )
    except (ValueError, EstimatorNotAvailableError) as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(code=1) from exc

    console.print(
        "Raster config: "
        f"cell_size=({raster_config.cell_size_u}, {raster_config.cell_size_z}) "
        f"min_points_per_cell={raster_config.min_points_per_cell} "
        f"connectivity={raster_config.connectivity} "
        f"u_quantile=({raster_config.u_quantile_low}, {raster_config.u_quantile_high}) "
        f"z_quantile=({raster_config.z_quantile_low}, {raster_config.z_quantile_high})"
    )
    console.print()

    table = Table(title=f"Face Estimator Benchmark: {benchmark_path.parent.name}")
    table.add_column("Method")
    table.add_column("Area (source-units²)")
    table.add_column("Perimeter")
    table.add_column("Vertices")
    table.add_column("Parts")
    table.add_column("Runtime (ms)")

    for outcome in result.outcomes:
        contour = outcome.contour
        polygon = contour.polygon

        table.add_row(
            contour.method_name,
            f"{polygon.area_source_units_squared:.6f}",
            f"{polygon.perimeter_source_units:.6f}",
            str(polygon.vertex_count),
            str(polygon.part_count),
            f"{contour.runtime_seconds * 1000.0:.3f}",
        )

    console.print(table)

    if result.pairwise_disagreement:
        console.print()
        disagreement_table = Table(title="Pairwise Disagreement")
        disagreement_table.add_column("Method A")
        disagreement_table.add_column("Method B")
        disagreement_table.add_column("Symmetric relative difference")

        for (method_a, method_b), value in result.pairwise_disagreement.items():
            disagreement_table.add_row(
                method_a,
                method_b,
                f"{value:.3%}",
            )

        console.print(disagreement_table)

    reference_outcomes = [
        outcome for outcome in result.outcomes if outcome.reference_comparison is not None
    ]

    if reference_outcomes:
        console.print()
        reference_table = Table(title="Reference Comparison")
        reference_table.add_column("Method")
        reference_table.add_column("Status")
        reference_table.add_column("Absolute % error")

        for outcome in reference_outcomes:
            comparison = outcome.reference_comparison
            assert comparison is not None

            if comparison.comparison_ready:
                status = "compared"
                error = f"{comparison.absolute_percent_error:.3f}%"
            else:
                status = ", ".join(comparison.blocker_codes)
                error = "—"

            reference_table.add_row(
                outcome.contour.method_name,
                status,
                error,
            )

        console.print(reference_table)

    console.print()
    console.print(f"Benchmark JSON: {benchmark_path}")
    console.print(f"Summary CSV: {summary_path}")
    console.print(
        "[yellow]Note:[/yellow] these are estimator outcomes and disagreement, "
        "not accuracy claims, unless a confirmed same-pile reference made a "
        "comparison ready above."
    )


if __name__ == "__main__":
    app()
