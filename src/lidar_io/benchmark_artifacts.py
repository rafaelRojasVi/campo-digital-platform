"""Persistence for face-estimator benchmark runs.

Mirrors the JSON-writing convention already used in
``lidar_io.run_artifacts`` (build a plain dict, ``json.dumps(..., indent=2,
allow_nan=False)``), but this module persists a
``FaceEstimatorBenchmarkResult`` rather than an artifact of a
``MeasurementRun``. Benchmark runs are written under a distinct
``estimator-benchmark/`` subdirectory precisely so they are never picked up
by the existing ``output_root.glob("*/measurement.json")`` run listing used
by the API/viewer.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

from lidar_volume.face_estimator_benchmark import FaceEstimatorBenchmarkResult

BENCHMARK_FILENAME = "benchmark.json"
SUMMARY_FILENAME = "summary.csv"


def _validate_run_id(run_id: str) -> None:
    if not run_id:
        raise ValueError("run_id must not be empty")

    if Path(run_id).name != run_id or run_id in {".", ".."}:
        raise ValueError("run_id must be a single safe path component")


def benchmark_run_directory(
    run_id: str,
    output_root: Path,
) -> Path:
    """Return the canonical directory for one benchmark run."""

    _validate_run_id(run_id)

    return output_root / "estimator-benchmark" / run_id


def _outcome_payload(outcome: Any) -> dict[str, Any]:
    contour = outcome.contour
    polygon = contour.polygon

    payload: dict[str, Any] = {
        "method_name": contour.method_name,
        "source": contour.source,
        "parameters": contour.parameters,
        "provenance": contour.provenance,
        "runtime_seconds": contour.runtime_seconds,
        "area_source_units_squared": polygon.area_source_units_squared,
        "perimeter_source_units": polygon.perimeter_source_units,
        "vertex_count": polygon.vertex_count,
        "part_count": polygon.part_count,
    }

    if outcome.reference_comparison is not None:
        comparison = outcome.reference_comparison
        payload["reference_comparison"] = {
            "comparison_ready": comparison.comparison_ready,
            "blocker_codes": comparison.blocker_codes,
            "estimate_unit": comparison.estimate_unit.value,
            "reference_unit": comparison.reference.unit.value,
            "reference_value": comparison.reference.value,
            "reference_same_pile_confirmed": comparison.reference.same_pile_confirmed,
            "signed_error": comparison.signed_error,
            "absolute_error": comparison.absolute_error,
            "relative_error": comparison.relative_error,
            "absolute_percent_error": comparison.absolute_percent_error,
        }
    else:
        payload["reference_comparison"] = None

    return payload


def write_benchmark_artifacts(
    result: FaceEstimatorBenchmarkResult,
    run_id: str,
    output_root: Path,
    *,
    input_identity: dict[str, Any],
) -> tuple[Path, Path]:
    """Persist ``benchmark.json`` and ``summary.csv`` for one benchmark run.

    Returns ``(benchmark_json_path, summary_csv_path)``. Never receives or
    writes raw point-cloud data -- only scalar outcomes and evidence
    provenance.
    """

    run_directory = benchmark_run_directory(run_id, output_root)

    run_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    cross_section = result.evidence.cross_section
    raster = result.evidence.raster

    payload = {
        "schema_version": "1",
        "kind": "face_estimator_benchmark",
        "estimator_status": "experimental_candidate",
        "coordinate_units": "source_units",
        "run_id": run_id,
        "input_identity": input_identity,
        "evidence_provenance": {
            "center_xy_source": cross_section.center_xy.tolist(),
            "longitudinal_axis_xy": cross_section.longitudinal_axis.tolist(),
            "longitudinal_span": cross_section.longitudinal_span,
            "raster_cell_size_u": raster.cell_size_u,
            "raster_cell_size_z": raster.cell_size_z,
            "raster_rows": raster.raster_rows,
            "raster_cols": raster.raster_cols,
            "raster_u_min": raster.u_min,
            "raster_u_max": raster.u_max,
            "raster_z_min": raster.z_min,
            "raster_z_max": raster.z_max,
        },
        "outcomes": [_outcome_payload(outcome) for outcome in result.outcomes],
        "pairwise_disagreement": [
            {
                "method_a": pair[0],
                "method_b": pair[1],
                "symmetric_relative_difference": value,
            }
            for pair, value in result.pairwise_disagreement.items()
        ],
        "warnings": list(result.warnings),
    }

    benchmark_path = run_directory / BENCHMARK_FILENAME

    benchmark_path.write_text(
        json.dumps(
            payload,
            indent=2,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )

    summary_path = run_directory / SUMMARY_FILENAME

    with summary_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)

        writer.writerow(
            [
                "method",
                "area_source_units_squared",
                "perimeter_source_units",
                "vertex_count",
                "part_count",
                "runtime_ms",
                "reference_status",
                "reference_absolute_percent_error",
            ]
        )

        for outcome in result.outcomes:
            contour = outcome.contour
            polygon = contour.polygon
            comparison = outcome.reference_comparison

            reference_error: float | str

            if comparison is None:
                reference_status = "no_reference_supplied"
                reference_error = ""
            elif comparison.comparison_ready:
                reference_status = "compared"
                reference_error = (
                    comparison.absolute_percent_error
                    if comparison.absolute_percent_error is not None
                    else ""
                )
            else:
                reference_status = ",".join(comparison.blocker_codes)
                reference_error = ""

            writer.writerow(
                [
                    contour.method_name,
                    polygon.area_source_units_squared,
                    polygon.perimeter_source_units,
                    polygon.vertex_count,
                    polygon.part_count,
                    round(contour.runtime_seconds * 1000.0, 3),
                    reference_status,
                    reference_error,
                ]
            )

    return benchmark_path, summary_path
