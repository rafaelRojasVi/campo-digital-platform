from __future__ import annotations

import pytest

from lidar_core.measurement_run import derive_measurement_readiness
from lidar_core.models import (
    MeasurementReadinessStage,
    MeasurementRunStatus,
    MeasurementWarning,
    MeasurementWarningSeverity,
)


def blocker(code: str) -> MeasurementWarning:
    return MeasurementWarning(
        code=code,
        severity=MeasurementWarningSeverity.BLOCKER,
        message=code,
    )


def test_observable_geometry_can_exist_without_physical_units() -> None:
    readiness = derive_measurement_readiness(
        status=MeasurementRunStatus.COMPLETED,
        observable_geometry_available=True,
        physical_units_confirmed=False,
        geometric_volume_available=False,
        warnings=[
            blocker("crs_unconfirmed"),
            blocker("linear_units_unconfirmed"),
            blocker("pile_depth_not_supplied"),
        ],
    )

    assert readiness.stage == MeasurementReadinessStage.OBSERVABLE_GEOMETRY
    assert readiness.pipeline_completed is True
    assert readiness.observable_geometry_ready is True
    assert readiness.physical_face_area_ready is False
    assert readiness.geometric_volume_ready is False
    assert readiness.reference_validated is False

    assert readiness.blocker_codes == [
        "crs_unconfirmed",
        "linear_units_unconfirmed",
        "pile_depth_not_supplied",
    ]


def test_confirmed_units_make_physical_face_area_ready() -> None:
    readiness = derive_measurement_readiness(
        status=MeasurementRunStatus.COMPLETED,
        observable_geometry_available=True,
        physical_units_confirmed=True,
        geometric_volume_available=False,
        warnings=[
            blocker("pile_depth_not_supplied"),
        ],
    )

    assert readiness.stage == MeasurementReadinessStage.PHYSICAL_FACE_AREA
    assert readiness.observable_geometry_ready is True
    assert readiness.physical_face_area_ready is True
    assert readiness.geometric_volume_ready is False
    assert readiness.reference_validated is False


def test_source_unit_volume_does_not_imply_physical_volume_readiness() -> None:
    readiness = derive_measurement_readiness(
        status=MeasurementRunStatus.COMPLETED,
        observable_geometry_available=True,
        physical_units_confirmed=False,
        geometric_volume_available=True,
        warnings=[
            blocker("crs_unconfirmed"),
            blocker("linear_units_unconfirmed"),
        ],
    )

    assert readiness.stage == MeasurementReadinessStage.OBSERVABLE_GEOMETRY
    assert readiness.observable_geometry_ready is True
    assert readiness.physical_face_area_ready is False
    assert readiness.geometric_volume_ready is False
    assert readiness.reference_validated is False


def test_confirmed_units_and_volume_make_geometric_volume_ready() -> None:
    readiness = derive_measurement_readiness(
        status=MeasurementRunStatus.COMPLETED,
        observable_geometry_available=True,
        physical_units_confirmed=True,
        geometric_volume_available=True,
        warnings=[],
    )

    assert readiness.stage == MeasurementReadinessStage.GEOMETRIC_VOLUME
    assert readiness.observable_geometry_ready is True
    assert readiness.physical_face_area_ready is True
    assert readiness.geometric_volume_ready is True
    assert readiness.reference_validated is False


def test_failed_pipeline_is_not_measurement_ready() -> None:
    readiness = derive_measurement_readiness(
        status=MeasurementRunStatus.FAILED,
        observable_geometry_available=True,
        physical_units_confirmed=True,
        geometric_volume_available=True,
        warnings=[],
    )

    assert readiness.stage == MeasurementReadinessStage.NOT_READY
    assert readiness.pipeline_completed is False
    assert readiness.observable_geometry_ready is False
    assert readiness.physical_face_area_ready is False
    assert readiness.geometric_volume_ready is False
    assert readiness.reference_validated is False


def test_reference_validation_requires_geometric_volume() -> None:
    with pytest.raises(
        ValueError,
        match="reference validation requires geometric volume",
    ):
        derive_measurement_readiness(
            status=MeasurementRunStatus.COMPLETED,
            observable_geometry_available=True,
            physical_units_confirmed=True,
            geometric_volume_available=False,
            reference_validated=True,
            warnings=[],
        )


def test_reference_validation_requires_confirmed_physical_units() -> None:
    with pytest.raises(
        ValueError,
        match="reference validation requires confirmed physical units",
    ):
        derive_measurement_readiness(
            status=MeasurementRunStatus.COMPLETED,
            observable_geometry_available=True,
            physical_units_confirmed=False,
            geometric_volume_available=True,
            reference_validated=True,
            warnings=[],
        )


def test_reference_validated_is_explicit_highest_stage() -> None:
    readiness = derive_measurement_readiness(
        status=MeasurementRunStatus.COMPLETED,
        observable_geometry_available=True,
        physical_units_confirmed=True,
        geometric_volume_available=True,
        reference_validated=True,
        warnings=[],
    )

    assert readiness.stage == MeasurementReadinessStage.REFERENCE_VALIDATED
    assert readiness.physical_face_area_ready is True
    assert readiness.geometric_volume_ready is True
    assert readiness.reference_validated is True
