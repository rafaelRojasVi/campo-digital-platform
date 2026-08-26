from __future__ import annotations

import json

import pytest
from typer.testing import CliRunner

from lidar_cli.main import app

runner = CliRunner()


def test_generate_synthetic_and_inspect(tmp_path):
    out = tmp_path / "synth.las"
    result = runner.invoke(
        app, ["generate-synthetic", "cube", str(out), "--n-points", "500", "--seed", "1"]
    )
    assert result.exit_code == 0, result.output
    assert out.exists()

    result2 = runner.invoke(app, ["inspect", str(out), "--json"])
    assert result2.exit_code == 0, result2.output
    assert "point_count" in result2.output


def test_inspect_missing_file():
    result = runner.invoke(app, ["inspect", "/nonexistent/path.las"])
    assert result.exit_code == 1


def test_sections_not_implemented(tmp_path):
    dummy = tmp_path / "x.las"
    dummy.write_bytes(b"")
    result = runner.invoke(app, ["sections", str(dummy)])
    assert result.exit_code == 2


def test_crop_command(tmp_path):
    out = tmp_path / "synth.las"
    runner.invoke(
        app, ["generate-synthetic", "cube", str(out), "--n-points", "1000", "--seed", "2"]
    )
    cropped = tmp_path / "cropped.las"
    result = runner.invoke(
        app,
        [
            "crop",
            str(out),
            str(cropped),
            "--min-x",
            "0.0",
            "--min-y",
            "0.0",
            "--max-x",
            "0.5",
            "--max-y",
            "0.5",
        ],
    )
    assert result.exit_code == 0, result.output
    assert cropped.exists()


def test_analyze_command(tmp_path):
    out = tmp_path / "synth.las"
    generated = runner.invoke(
        app,
        [
            "generate-synthetic",
            "cube",
            str(out),
            "--n-points",
            "100",
            "--seed",
            "4",
        ],
    )
    assert generated.exit_code == 0, generated.output

    result = runner.invoke(app, ["analyze", str(out), "--json"])
    assert result.exit_code == 0, result.output
    assert '"point_count": 100' in result.output
    assert '"gps_time_present": true' in result.output


def _write_synthetic_front_wall(path) -> None:
    import laspy
    import numpy as np

    x_values = np.linspace(
        0.0,
        10.0,
        220,
    )
    z_values = np.linspace(
        0.0,
        2.0,
        300,
    )

    xx, zz = np.meshgrid(
        x_values,
        z_values,
    )

    header = laspy.LasHeader(
        point_format=3,
        version="1.2",
    )

    las = laspy.LasData(header)
    las.x = xx.ravel()
    las.y = np.zeros(xx.size)
    las.z = zz.ravel()

    las.write(path)


def test_volume_without_depth_reports_area_only(tmp_path):
    source = tmp_path / "front_wall.las"
    _write_synthetic_front_wall(source)

    result = runner.invoke(
        app,
        [
            "volume",
            str(source),
        ],
    )

    assert result.exit_code == 0, result.output
    assert "Rectangle area" in result.output
    assert "Trapezoid area" in result.output
    assert "not computed" in result.output

    # No cubic result may be invented when depth is absent.
    assert "source-units³" not in result.output


def test_volume_with_explicit_depth_reports_extrusion(tmp_path):
    source = tmp_path / "front_wall.las"
    _write_synthetic_front_wall(source)

    result = runner.invoke(
        app,
        [
            "volume",
            str(source),
            "--depth",
            "2.0",
        ],
    )

    assert result.exit_code == 0, result.output
    assert "Assumed depth" in result.output
    assert "Extruded volume" in result.output
    assert "source-units³" in result.output
    assert "not inferred or validated" in result.output


def test_volume_rejects_negative_depth(tmp_path):
    source = tmp_path / "front_wall.las"
    _write_synthetic_front_wall(source)

    result = runner.invoke(
        app,
        [
            "volume",
            str(source),
            "--depth",
            "-1",
        ],
    )

    assert result.exit_code == 1
    assert "--depth must be non-negative" in result.output


def test_volume_missing_file():
    result = runner.invoke(
        app,
        [
            "volume",
            "/nonexistent/front-wall.las",
        ],
    )

    assert result.exit_code == 1
    assert "file not found" in result.output.lower()


def test_measure_command_persists_structured_run(tmp_path):
    source = tmp_path / "candidate.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    result = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(output_root),
            "--run-id",
            "cli-test-run",
            "--code-version",
            "test",
        ],
    )

    assert result.exit_code == 0, result.output
    assert "Measurement Run: cli-test-run" in result.output
    assert "Readiness" in result.output
    assert "observable_geometry" in result.output
    assert "Observable geometry" in result.output
    assert "Geometric volume" in result.output
    assert "Physical face area" in result.output
    assert "Reference validation" in result.output
    assert "not validated" in result.output
    assert "Selected timber points" in result.output
    assert "Rectangle area" in result.output
    assert "Projected raster area" in result.output
    assert "Raster vs scanline" in result.output
    assert "front_profile" in result.output
    assert "front_profile_plot" in result.output
    assert "front_height_profile_plot" in result.output
    assert "pile_depth_not_supplied" in result.output

    run_directory = output_root / "cli-test-run"

    assert (run_directory / "measurement.json").exists()

    assert (run_directory / "front_profile.json").exists()

    assert (run_directory / "front_profile.png").exists()

    assert (run_directory / "front_height_profile.png").exists()


def test_measure_command_missing_file():
    result = runner.invoke(
        app,
        [
            "measure",
            "/nonexistent/candidate.las",
        ],
    )

    assert result.exit_code == 1
    assert "file not found" in result.output.lower()


def test_measure_command_with_explicit_depth_reports_geometric_volume(
    tmp_path,
):
    source = tmp_path / "candidate-depth.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    result = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(output_root),
            "--run-id",
            "cli-depth-run",
            "--code-version",
            "test",
            "--depth",
            "2.5",
            "--depth-source",
            "test_fixture",
        ],
    )

    assert result.exit_code == 0, result.output
    assert "Readiness" in result.output
    assert "observable_geometry" in result.output
    assert "Observable geometry" in result.output
    assert "Physical face area" in result.output
    assert "Geometric volume" in result.output
    assert "not ready" in result.output
    assert "Reference validation" in result.output
    assert "not validated" in result.output

    # The explicit depth produces a raw source-unit extrusion, but the
    # readiness stage remains observable_geometry because physical
    # coordinate units are not confirmed in this synthetic fixture.
    assert "cubic_units_unspecified" in result.output
    assert "Explicit pile depth" in result.output
    assert "2.500000 source units" in result.output
    assert "test_fixture" in result.output
    assert "pile_depth_not_supplied" not in result.output

    measurement_path = output_root / "cli-depth-run" / "measurement.json"

    assert measurement_path.exists()


def test_measure_command_requires_depth_source(
    tmp_path,
):
    source = tmp_path / "candidate-depth-missing-source.las"
    _write_synthetic_front_wall(source)

    result = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(tmp_path / "reports"),
            "--depth",
            "2.5",
        ],
    )

    assert result.exit_code == 1
    assert "depth_source is required" in result.output


def test_compare_command_persists_reference_comparison(
    tmp_path,
):
    source = tmp_path / "compare-candidate.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    measured = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(output_root),
            "--run-id",
            "compare-run",
            "--code-version",
            "test",
            "--depth",
            "2.5",
            "--depth-source",
            "synthetic_test_depth",
        ],
    )

    assert measured.exit_code == 0, measured.output

    measurement_path = output_root / "compare-run" / "measurement.json"

    compared = runner.invoke(
        app,
        [
            "compare",
            str(measurement_path),
            "--reference-value",
            "5.0",
            "--reference-unit",
            "cubic_units_unspecified",
            "--reference-method",
            "synthetic_reference",
            "--reference-label",
            "fixture_reference",
            "--comparison-id",
            "comparison-001",
        ],
    )

    assert compared.exit_code == 0, compared.output
    assert "Volume Comparison: comparison-001" in compared.output
    assert "Signed error" in compared.output
    assert "Absolute error" in compared.output
    assert "Percent error" in compared.output
    assert "synthetic_reference" in compared.output

    comparison_path = output_root / "compare-run" / "comparisons" / "comparison-001.json"

    assert comparison_path.exists()


def test_compare_command_rejects_incompatible_units(
    tmp_path,
):
    source = tmp_path / "compare-unit-candidate.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    measured = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(output_root),
            "--run-id",
            "compare-unit-run",
            "--depth",
            "2.5",
            "--depth-source",
            "synthetic_test_depth",
        ],
    )

    assert measured.exit_code == 0, measured.output

    measurement_path = output_root / "compare-unit-run" / "measurement.json"

    compared = runner.invoke(
        app,
        [
            "compare",
            str(measurement_path),
            "--reference-value",
            "5.0",
            "--reference-unit",
            "m3",
            "--reference-method",
            "synthetic_reference",
            "--comparison-id",
            "comparison-unit-mismatch",
        ],
    )

    assert compared.exit_code == 1
    assert "units must match exactly" in compared.output

    comparison_path = (
        output_root / "compare-unit-run" / "comparisons" / "comparison-unit-mismatch.json"
    )

    assert not comparison_path.exists()


def test_robustness_command_persists_successful_matrix(
    tmp_path,
):
    source = tmp_path / "valid.las"
    _write_synthetic_front_wall(source)

    output = tmp_path / "robustness" / "matrix.json"

    result = runner.invoke(
        app,
        [
            "robustness",
            str(source),
            "--output",
            str(output),
        ],
    )

    assert result.exit_code == 0, result.output
    assert output.exists()

    from lidar_io.dataset_robustness_store import (
        read_dataset_robustness_matrix,
    )

    matrix = read_dataset_robustness_matrix(output)

    assert matrix.total_datasets == 1
    assert matrix.successful_datasets == 1
    assert matrix.failed_datasets == 0
    assert matrix.deep is False


def test_robustness_command_writes_matrix_before_partial_failure_exit(
    tmp_path,
):
    valid = tmp_path / "valid.las"
    corrupt = tmp_path / "corrupt.las"
    missing = tmp_path / "missing.las"

    _write_synthetic_front_wall(valid)

    corrupt.write_bytes(b"this is not a LAS file")

    output = tmp_path / "robustness" / "matrix.json"

    result = runner.invoke(
        app,
        [
            "robustness",
            str(valid),
            str(corrupt),
            str(missing),
            "--output",
            str(output),
        ],
    )

    assert result.exit_code == 3, result.output
    assert output.exists()

    from lidar_io.dataset_robustness_store import (
        read_dataset_robustness_matrix,
    )

    matrix = read_dataset_robustness_matrix(output)

    assert matrix.total_datasets == 3
    assert matrix.successful_datasets == 1
    assert matrix.failed_datasets == 2

    assert {failure.error_type for failure in matrix.failures} == {
        "FileNotFoundError",
        "LaspyException",
    }


def test_robustness_command_refuses_existing_output(
    tmp_path,
):
    source = tmp_path / "valid.las"
    _write_synthetic_front_wall(source)

    output = tmp_path / "matrix.json"

    first = runner.invoke(
        app,
        [
            "robustness",
            str(source),
            "--output",
            str(output),
        ],
    )

    assert first.exit_code == 0, first.output

    second = runner.invoke(
        app,
        [
            "robustness",
            str(source),
            "--output",
            str(output),
        ],
    )

    assert second.exit_code == 1
    assert "already exists" in second.output


def test_robustness_command_deep_checksum_and_overwrite(
    tmp_path,
):
    source = tmp_path / "valid.las"
    _write_synthetic_front_wall(source)

    output = tmp_path / "matrix.json"

    result = runner.invoke(
        app,
        [
            "robustness",
            str(source),
            "--output",
            str(output),
            "--deep",
            "--checksum",
            "--overwrite",
        ],
    )

    assert result.exit_code == 0, result.output

    from lidar_io.dataset_robustness_store import (
        read_dataset_robustness_matrix,
    )

    matrix = read_dataset_robustness_matrix(output)

    assert matrix.deep is True
    assert matrix.compute_checksum is True
    assert matrix.successful_datasets == 1

    report = matrix.reports[0]

    assert report.acquisition is not None
    assert report.metadata.sha256 is not None
    assert len(report.metadata.sha256) == 64


def test_measure_command_reports_ready_face_area_reference(
    tmp_path,
):
    from lidar_io.run_store import read_measurement_run

    source = tmp_path / "candidate-face-reference.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    result = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(output_root),
            "--run-id",
            "cli-face-reference-ready",
            "--code-version",
            "test",
            "--reference-face-area",
            "30.0",
            "--reference-face-area-unit",
            "source_units_squared",
            "--reference-face-area-method",
            "lidar360_manual_polygon",
            "--reference-face-area-label",
            "operator reference",
            "--reference-face-area-source",
            "client_organization",
            "--same-pile-reference",
        ],
    )

    assert result.exit_code == 0, result.output

    assert "Face Area Reference" in result.output
    assert "projected_face_raster" in result.output
    assert "operator reference" in result.output
    assert "lidar360_manual_polygon" in result.output
    assert "client_organization" in result.output
    assert "source-units²" in result.output
    assert "Same pile confirmed" in result.output
    assert "ready" in result.output
    assert "Percent error" in result.output
    assert "Absolute percent error" in result.output

    measurement_path = output_root / "cli-face-reference-ready" / "measurement.json"

    run = read_measurement_run(measurement_path)

    assert run.face_area_comparison is not None
    assert run.face_area_comparison.comparison_ready is True

    # Face comparison remains independent from volume-level readiness.
    assert run.readiness is not None
    assert run.readiness.reference_validated is False


def test_measure_command_blocks_square_metre_reference_without_metric_crs(
    tmp_path,
):
    from lidar_io.run_store import read_measurement_run

    source = tmp_path / "candidate-face-reference-metres.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    result = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(output_root),
            "--run-id",
            "cli-face-reference-metres-blocked",
            "--reference-face-area",
            "30.0",
            "--reference-face-area-unit",
            "square_metres",
            "--reference-face-area-method",
            "lidar360_manual_polygon",
            "--reference-face-area-label",
            "operator reference",
            "--same-pile-reference",
        ],
    )

    assert result.exit_code == 0, result.output

    assert "Face Area Reference" in result.output
    assert "m²" in result.output
    assert "blocked" in result.output
    assert "area_units_incompatible" in result.output

    # Existing readiness terminology must remain distinct.
    assert "Reference validation" in result.output
    assert "not validated" in result.output

    measurement_path = output_root / "cli-face-reference-metres-blocked" / "measurement.json"

    run = read_measurement_run(measurement_path)

    comparison = run.face_area_comparison

    assert comparison is not None
    assert comparison.comparison_ready is False
    assert comparison.blocker_codes == [
        "area_units_incompatible",
    ]

    assert run.readiness is not None
    assert run.readiness.reference_validated is False


def test_measure_command_requires_face_reference_unit(
    tmp_path,
):
    source = tmp_path / "candidate-face-reference-missing-unit.las"
    _write_synthetic_front_wall(source)

    result = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(tmp_path / "reports"),
            "--reference-face-area",
            "30.0",
            "--reference-face-area-method",
            "manual_polygon",
        ],
    )

    assert result.exit_code == 1

    assert "--reference-face-area-unit is required" in result.output


def test_measure_command_requires_face_reference_method(
    tmp_path,
):
    source = tmp_path / "candidate-face-reference-missing-method.las"
    _write_synthetic_front_wall(source)

    result = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(tmp_path / "reports"),
            "--reference-face-area",
            "30.0",
            "--reference-face-area-unit",
            "source_units_squared",
        ],
    )

    assert result.exit_code == 1

    assert "--reference-face-area-method is required" in result.output


def test_measure_command_rejects_invalid_face_reference_unit(
    tmp_path,
):
    source = tmp_path / "candidate-face-reference-invalid-unit.las"
    _write_synthetic_front_wall(source)

    result = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(tmp_path / "reports"),
            "--reference-face-area",
            "30.0",
            "--reference-face-area-unit",
            "yards_squared",
            "--reference-face-area-method",
            "manual_polygon",
        ],
    )

    assert result.exit_code == 1
    assert "invalid --reference-face-area-unit" in result.output
    assert "source_units_squared" in result.output
    assert "square_metres" in result.output


def test_measure_command_rejects_reference_metadata_without_area(
    tmp_path,
):
    source = tmp_path / "candidate-face-reference-no-area.las"
    _write_synthetic_front_wall(source)

    result = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(tmp_path / "reports"),
            "--reference-face-area-unit",
            "square_metres",
            "--reference-face-area-method",
            "manual_polygon",
        ],
    )

    assert result.exit_code == 1

    assert ("face-area reference options require --reference-face-area") in result.output


def test_measure_command_supports_prelocalized_input(
    tmp_path,
):
    from lidar_io.run_store import read_measurement_run

    source = tmp_path / "already-isolated-wall.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    result = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(output_root),
            "--run-id",
            "cli-prelocalized",
            "--code-version",
            "test",
            "--input-already-isolated",
        ],
    )

    assert result.exit_code == 0, result.output

    assert "Localization mode" in result.output
    assert "prelocalized_input" in result.output
    assert "100.000%" in result.output

    measurement_path = output_root / "cli-prelocalized" / "measurement.json"

    run = read_measurement_run(measurement_path)

    assert run.timber_stack is not None

    assert run.timber_stack.localization_mode == "prelocalized_input"

    assert run.timber_stack.point_count_selected == run.timber_stack.point_count_input

    assert run.timber_stack.selected_fraction == 1.0

    assert run.provenance["localization_mode"] == "prelocalized_input"


def test_measure_command_supports_front_depth_diagnostic(
    tmp_path,
):
    from lidar_io.run_store import read_measurement_run

    source = tmp_path / "front-depth-wall.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    result = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(output_root),
            "--run-id",
            "cli-front-depth",
            "--input-already-isolated",
            "--front-side",
            "low_v",
        ],
    )

    assert result.exit_code == 0, result.output

    assert "Front side" in result.output
    assert "low_v" in result.output
    assert "Recession candidates" in result.output
    assert "Front-depth runtime" in result.output
    assert "Recession runtime" in result.output

    run = read_measurement_run(output_root / "cli-front-depth" / "measurement.json")

    assert run.front_depth is not None
    assert run.front_depth.front_side == "low_v"


def test_measure_command_rejects_invalid_front_side(
    tmp_path,
):
    source = tmp_path / "invalid-front-side.las"
    _write_synthetic_front_wall(source)

    result = runner.invoke(
        app,
        [
            "measure",
            str(source),
            "--output-root",
            str(tmp_path / "reports"),
            "--input-already-isolated",
            "--front-side",
            "left",
        ],
    )

    assert result.exit_code == 1
    assert "invalid --front-side" in result.output
    assert "low_v" in result.output
    assert "high_v" in result.output


def test_benchmark_face_estimators_list_methods():
    result = runner.invoke(
        app,
        [
            "benchmark-face-estimators",
            "--list-methods",
        ],
    )

    assert result.exit_code == 0, result.output
    assert "scanline_envelope" in result.output
    assert "raster_filled" in result.output
    assert "concave_hull" in result.output
    assert "marching_squares" in result.output
    assert "historical" in result.output


def test_benchmark_face_estimators_missing_file():
    result = runner.invoke(
        app,
        [
            "benchmark-face-estimators",
            "/nonexistent/candidate.las",
        ],
    )

    assert result.exit_code == 1
    assert "file not found" in result.output.lower()


def test_benchmark_face_estimators_requires_path_without_list_methods():
    result = runner.invoke(
        app,
        [
            "benchmark-face-estimators",
        ],
    )

    assert result.exit_code == 1
    assert "input" in result.output.lower()


def test_benchmark_face_estimators_persists_artifacts(tmp_path):
    source = tmp_path / "candidate.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    result = runner.invoke(
        app,
        [
            "benchmark-face-estimators",
            str(source),
            "--output-root",
            str(output_root),
            "--run-id",
            "cli-benchmark-run",
            "--input-already-isolated",
        ],
    )

    assert result.exit_code == 0, result.output
    assert "scanline_envelope" in result.output
    assert "raster_filled" in result.output
    assert "concave_hull" in result.output
    assert "Pairwise Disagreement" in result.output
    assert "not accuracy claims" in result.output

    run_directory = output_root / "estimator-benchmark" / "cli-benchmark-run"

    assert (run_directory / "benchmark.json").exists()
    assert (run_directory / "summary.csv").exists()


def test_benchmark_face_estimators_rejects_historical_method(tmp_path):
    source = tmp_path / "candidate.las"
    _write_synthetic_front_wall(source)

    result = runner.invoke(
        app,
        [
            "benchmark-face-estimators",
            str(source),
            "--output-root",
            str(tmp_path / "reports"),
            "--input-already-isolated",
            "--method",
            "marching_squares",
        ],
    )

    assert result.exit_code == 1
    assert "EXP-007" in result.output


def test_benchmark_face_estimators_with_reference_reports_comparison(tmp_path):
    source = tmp_path / "candidate.las"
    _write_synthetic_front_wall(source)

    result = runner.invoke(
        app,
        [
            "benchmark-face-estimators",
            str(source),
            "--output-root",
            str(tmp_path / "reports"),
            "--input-already-isolated",
            "--method",
            "scanline_envelope",
            "--reference-face-area",
            "40.0",
            "--reference-face-area-unit",
            "source_units_squared",
            "--reference-face-area-method",
            "manual_polygon",
            "--same-pile-reference",
        ],
    )

    assert result.exit_code == 0, result.output
    assert "Reference Comparison" in result.output
    assert "compared" in result.output


def test_benchmark_face_estimators_concave_hull_ratio_reaches_the_run(tmp_path):
    # Regression test for a bug where the CLI built a custom estimator
    # registry (to apply --concave-hull-ratio) but never passed it to the
    # underlying pipeline, so the option silently had no effect.
    source = tmp_path / "candidate.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    result = runner.invoke(
        app,
        [
            "benchmark-face-estimators",
            str(source),
            "--output-root",
            str(output_root),
            "--run-id",
            "cli-ratio-run",
            "--input-already-isolated",
            "--method",
            "concave_hull",
            "--concave-hull-ratio",
            "0.37",
        ],
    )

    assert result.exit_code == 0, result.output

    payload = json.loads(
        (output_root / "estimator-benchmark" / "cli-ratio-run" / "benchmark.json").read_text(
            encoding="utf-8"
        )
    )

    assert payload["outcomes"][0]["parameters"]["ratio"] == pytest.approx(0.37)


def test_benchmark_face_estimators_raster_config_options_reach_the_run(tmp_path):
    source = tmp_path / "candidate.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    result = runner.invoke(
        app,
        [
            "benchmark-face-estimators",
            str(source),
            "--output-root",
            str(output_root),
            "--run-id",
            "cli-raster-config-run",
            "--input-already-isolated",
            "--method",
            "raster_filled",
            "--raster-cell-size-u",
            "0.02",
            "--raster-cell-size-z",
            "0.02",
            "--raster-min-points-per-cell",
            "2",
            "--raster-u-quantile-low",
            "0.01",
            "--raster-u-quantile-high",
            "0.99",
        ],
    )

    assert result.exit_code == 0, result.output
    assert "Raster config" in result.output
    assert "cell_size=(0.02, 0.02)" in result.output

    payload = json.loads(
        (
            output_root / "estimator-benchmark" / "cli-raster-config-run" / "benchmark.json"
        ).read_text(encoding="utf-8")
    )

    raster_config = payload["input_identity"]["raster_config"]
    assert raster_config["cell_size_u"] == pytest.approx(0.02)
    assert raster_config["cell_size_z"] == pytest.approx(0.02)
    assert raster_config["min_points_per_cell"] == 2
    assert raster_config["u_quantile_low"] == pytest.approx(0.01)
    assert raster_config["u_quantile_high"] == pytest.approx(0.99)


def test_benchmark_face_estimators_rejects_invalid_raster_config(tmp_path):
    source = tmp_path / "candidate.las"
    _write_synthetic_front_wall(source)

    result = runner.invoke(
        app,
        [
            "benchmark-face-estimators",
            str(source),
            "--output-root",
            str(tmp_path / "reports"),
            "--input-already-isolated",
            "--raster-cell-size-u",
            "-1.0",
        ],
    )

    assert result.exit_code == 1
    assert "cell_size_u" in result.output
