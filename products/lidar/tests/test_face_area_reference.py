import pytest
from pydantic import ValidationError

from lidar_core.face_area_reference import compare_face_area
from lidar_core.models import (
    FaceAreaReference,
    FaceAreaUnit,
)


def test_compare_face_area_computes_error_for_compatible_same_pile_reference() -> None:
    reference = FaceAreaReference(
        label="LiDAR360 manual face",
        value=250.0,
        unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
        method="manual polygon",
        source="client_reference",
        same_pile_confirmed=True,
    )

    comparison = compare_face_area(
        estimate_method="projected_face_raster",
        estimate_value=255.0,
        estimate_unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
        reference=reference,
    )

    assert comparison.comparison_ready is True
    assert comparison.blocker_codes == []

    assert comparison.signed_error == pytest.approx(5.0)
    assert comparison.absolute_error == pytest.approx(5.0)

    assert comparison.relative_error == pytest.approx(0.02)
    assert comparison.absolute_relative_error == pytest.approx(0.02)

    assert comparison.percent_error == pytest.approx(2.0)
    assert comparison.absolute_percent_error == pytest.approx(2.0)


def test_compare_face_area_blocks_incompatible_units() -> None:
    reference = FaceAreaReference(
        label="client LiDAR360 area",
        value=250.0,
        unit=FaceAreaUnit.SQUARE_METRES,
        method="manual polygon",
        source="client_organization",
        same_pile_confirmed=True,
    )

    comparison = compare_face_area(
        estimate_method="projected_face_raster",
        estimate_value=255.0,
        estimate_unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
        reference=reference,
    )

    assert comparison.comparison_ready is False

    assert comparison.blocker_codes == [
        "area_units_incompatible",
    ]

    assert comparison.signed_error is None
    assert comparison.absolute_error is None
    assert comparison.relative_error is None
    assert comparison.absolute_relative_error is None
    assert comparison.percent_error is None
    assert comparison.absolute_percent_error is None


def test_compare_face_area_blocks_unconfirmed_same_pile_reference() -> None:
    reference = FaceAreaReference(
        label="external reference",
        value=250.0,
        unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
        method="manual polygon",
        same_pile_confirmed=False,
    )

    comparison = compare_face_area(
        estimate_method="projected_face_raster",
        estimate_value=255.0,
        estimate_unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
        reference=reference,
    )

    assert comparison.comparison_ready is False

    assert comparison.blocker_codes == [
        "same_pile_unconfirmed",
    ]

    assert comparison.percent_error is None


def test_compare_face_area_reports_all_compatibility_blockers() -> None:
    reference = FaceAreaReference(
        label="unknown external reference",
        value=250.0,
        unit=FaceAreaUnit.SQUARE_METRES,
        method="manual polygon",
        same_pile_confirmed=False,
    )

    comparison = compare_face_area(
        estimate_method="projected_face_raster",
        estimate_value=255.0,
        estimate_unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
        reference=reference,
    )

    assert comparison.comparison_ready is False

    assert comparison.blocker_codes == [
        "same_pile_unconfirmed",
        "area_units_incompatible",
    ]


def test_compare_face_area_preserves_reference_when_comparison_is_blocked() -> None:
    reference = FaceAreaReference(
        label="client LiDAR360 area",
        value=250.0,
        unit=FaceAreaUnit.SQUARE_METRES,
        method="LiDAR360 manual face polygon",
        source="client",
        same_pile_confirmed=True,
        notes="Example reference only.",
    )

    comparison = compare_face_area(
        estimate_method="projected_face_raster",
        estimate_value=254.2,
        estimate_unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
        reference=reference,
    )

    assert comparison.reference == reference
    assert comparison.reference.value == pytest.approx(250.0)
    assert comparison.comparison_ready is False


def test_face_area_reference_requires_positive_area() -> None:
    with pytest.raises(ValidationError):
        FaceAreaReference(
            label="invalid",
            value=0.0,
            unit=FaceAreaUnit.SQUARE_METRES,
            method="manual polygon",
            same_pile_confirmed=True,
        )


@pytest.mark.parametrize(
    "estimate_value",
    [
        -0.001,
        -1.0,
    ],
)
def test_compare_face_area_rejects_negative_estimate(
    estimate_value: float,
) -> None:
    reference = FaceAreaReference(
        label="reference",
        value=10.0,
        unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
        method="manual polygon",
        same_pile_confirmed=True,
    )

    with pytest.raises(
        ValueError,
        match="estimate_value must be non-negative",
    ):
        compare_face_area(
            estimate_method="projected_face_raster",
            estimate_value=estimate_value,
            estimate_unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
            reference=reference,
        )


def test_compare_face_area_rejects_empty_method() -> None:
    reference = FaceAreaReference(
        label="reference",
        value=10.0,
        unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
        method="manual polygon",
        same_pile_confirmed=True,
    )

    with pytest.raises(
        ValueError,
        match="estimate_method must be non-empty",
    ):
        compare_face_area(
            estimate_method="   ",
            estimate_value=10.0,
            estimate_unit=FaceAreaUnit.SOURCE_UNITS_SQUARED,
            reference=reference,
        )


@pytest.mark.parametrize(
    "horizontal_units",
    [
        "metre",
        "meter",
        "Metre",
        "METER",
        " metre ",
    ],
)
def test_face_area_unit_from_horizontal_units_promotes_explicit_metres(
    horizontal_units: str,
) -> None:
    from lidar_core.face_area_reference import (
        face_area_unit_from_horizontal_units,
    )

    assert face_area_unit_from_horizontal_units(horizontal_units) == FaceAreaUnit.SQUARE_METRES


@pytest.mark.parametrize(
    "horizontal_units",
    [
        None,
        "",
        "foot",
        "US survey foot",
        "centimetre",
        "unknown",
    ],
)
def test_face_area_unit_from_horizontal_units_does_not_infer_other_units(
    horizontal_units: str | None,
) -> None:
    from lidar_core.face_area_reference import (
        face_area_unit_from_horizontal_units,
    )

    assert (
        face_area_unit_from_horizontal_units(horizontal_units) == FaceAreaUnit.SOURCE_UNITS_SQUARED
    )
