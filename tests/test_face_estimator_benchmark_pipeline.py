from __future__ import annotations

import json

import laspy
import numpy as np
import pytest

from lidar_io.face_estimator_benchmark_pipeline import (
    run_face_estimator_benchmark_from_las,
)
from lidar_volume.face_estimators import (
    ConcaveHullConfig,
    ConcaveHullContourEstimator,
    FaceContourEstimator,
)
from lidar_volume.projected_face_raster import ProjectedFaceRasterConfig


def _write_synthetic_front_wall(path) -> None:
    x_values = np.linspace(0.0, 10.0, 500)
    z_values = np.linspace(0.0, 4.0, 150)

    xx, zz = np.meshgrid(x_values, z_values)

    rng = np.random.default_rng(5)
    jitter = rng.uniform(-1e-4, 1e-4, size=xx.size)

    header = laspy.LasHeader(point_format=3, version="1.2")

    las = laspy.LasData(header)
    las.x = xx.ravel() + jitter
    las.y = np.zeros(xx.size)
    las.z = zz.ravel()

    las.write(path)


def test_prelocalized_benchmark_persists_artifacts(tmp_path) -> None:
    source = tmp_path / "candidate.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    result, benchmark_path, summary_path = run_face_estimator_benchmark_from_las(
        source,
        output_root,
        run_id="pipeline-test-run",
        input_already_isolated=True,
    )

    assert len(result.outcomes) == 3
    assert benchmark_path.exists()
    assert summary_path.exists()
    assert benchmark_path.parent == output_root / "estimator-benchmark" / "pipeline-test-run"

    payload = json.loads(benchmark_path.read_text(encoding="utf-8"))

    assert payload["kind"] == "face_estimator_benchmark"
    assert payload["estimator_status"] == "experimental_candidate"
    assert payload["input_identity"]["localization_mode"] == "prelocalized_input"
    assert len(payload["outcomes"]) == 3

    summary_text = summary_path.read_text(encoding="utf-8")
    assert "method" in summary_text.splitlines()[0]


def test_benchmark_run_is_not_discoverable_as_a_measurement_run(tmp_path) -> None:
    source = tmp_path / "candidate.las"
    _write_synthetic_front_wall(source)

    output_root = tmp_path / "reports"

    _, benchmark_path, _ = run_face_estimator_benchmark_from_las(
        source,
        output_root,
        run_id="pipeline-test-run-2",
        input_already_isolated=True,
    )

    # The API/viewer only lists "<output_root>/*/measurement.json". A
    # benchmark run lives one directory deeper and must never collide.
    matches = list(output_root.glob("*/measurement.json"))
    assert matches == []
    assert benchmark_path.exists()


def test_custom_estimators_override_reaches_the_result(tmp_path) -> None:
    # Regression test: an earlier version of this pipeline accepted a
    # raster_config override but silently dropped a custom `estimators`
    # registry, so CLI options that build a custom registry (e.g.
    # --concave-hull-ratio) never actually reached the benchmark.
    source = tmp_path / "candidate.las"
    _write_synthetic_front_wall(source)

    default_result, _, _ = run_face_estimator_benchmark_from_las(
        source,
        tmp_path / "reports-default",
        run_id="default-ratio",
        input_already_isolated=True,
        method_names=[ConcaveHullContourEstimator.method_name],
    )

    custom_estimators: dict[str, FaceContourEstimator] = {
        ConcaveHullContourEstimator.method_name: ConcaveHullContourEstimator(
            ConcaveHullConfig(ratio=0.37)
        ),
    }

    custom_result, _, _ = run_face_estimator_benchmark_from_las(
        source,
        tmp_path / "reports-custom",
        run_id="custom-ratio",
        input_already_isolated=True,
        method_names=[ConcaveHullContourEstimator.method_name],
        estimators=custom_estimators,
    )

    # A flat rectangular wall's concave hull is convex regardless of ratio,
    # so area alone would not distinguish the two runs -- assert on the
    # parameter actually used by the estimator instead, which is the precise
    # thing the earlier bug silently dropped.
    assert default_result.outcomes[0].contour.parameters["ratio"] == pytest.approx(0.01)
    assert custom_result.outcomes[0].contour.parameters["ratio"] == pytest.approx(0.37)


def test_raster_config_override_changes_area_and_is_persisted(tmp_path) -> None:
    source = tmp_path / "candidate.las"
    _write_synthetic_front_wall(source)

    fine_result, fine_path, _ = run_face_estimator_benchmark_from_las(
        source,
        tmp_path / "reports-fine",
        run_id="fine-cells",
        input_already_isolated=True,
        method_names=["raster_filled"],
        raster_config=ProjectedFaceRasterConfig(cell_size_u=0.02, cell_size_z=0.02),
    )

    coarse_result, coarse_path, _ = run_face_estimator_benchmark_from_las(
        source,
        tmp_path / "reports-coarse",
        run_id="coarse-cells",
        input_already_isolated=True,
        method_names=["raster_filled"],
        raster_config=ProjectedFaceRasterConfig(cell_size_u=0.2, cell_size_z=0.2),
    )

    fine_area = fine_result.outcomes[0].contour.polygon.area_source_units_squared
    coarse_area = coarse_result.outcomes[0].contour.polygon.area_source_units_squared

    assert fine_area != pytest.approx(coarse_area)

    fine_payload = json.loads(fine_path.read_text(encoding="utf-8"))
    assert fine_payload["input_identity"]["raster_config"]["cell_size_u"] == pytest.approx(0.02)
    assert fine_payload["input_identity"]["raster_config"]["cell_size_z"] == pytest.approx(0.02)

    coarse_payload = json.loads(coarse_path.read_text(encoding="utf-8"))
    assert coarse_payload["input_identity"]["raster_config"]["cell_size_u"] == pytest.approx(0.2)


def test_raster_config_default_is_persisted_when_not_overridden(tmp_path) -> None:
    source = tmp_path / "candidate.las"
    _write_synthetic_front_wall(source)

    _, benchmark_path, _ = run_face_estimator_benchmark_from_las(
        source,
        tmp_path / "reports",
        run_id="default-raster-config",
        input_already_isolated=True,
    )

    payload = json.loads(benchmark_path.read_text(encoding="utf-8"))
    raster_config = payload["input_identity"]["raster_config"]

    default = ProjectedFaceRasterConfig()
    assert raster_config["cell_size_u"] == pytest.approx(default.cell_size_u)
    assert raster_config["min_points_per_cell"] == default.min_points_per_cell
    assert raster_config["connectivity"] == default.connectivity


def test_benchmark_rejects_missing_las(tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        run_face_estimator_benchmark_from_las(
            tmp_path / "does-not-exist.las",
            tmp_path / "reports",
            input_already_isolated=True,
        )
