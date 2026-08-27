"""Reference comparison for projected timber-stack face area.

This module contains no point-cloud algorithms, filesystem persistence, CRS
inference, or readiness promotion.

Its responsibility is deliberately narrow:

    automatic face-area estimate
            +
    explicit client/reference face area
            ↓
    compatibility checks
            ↓
    error metrics, when comparison is valid

A reference may be retained even when comparison is blocked.
"""

from __future__ import annotations

from lidar_core.models import (
    FaceAreaComparison,
    FaceAreaReference,
    FaceAreaUnit,
)


def compare_face_area(
    *,
    estimate_method: str,
    estimate_value: float,
    estimate_unit: FaceAreaUnit,
    reference: FaceAreaReference,
) -> FaceAreaComparison:
    """Compare one projected face-area estimate against one reference.

    Comparison is blocked unless:

    - the reference is explicitly confirmed to describe the same pile; and
    - estimate/reference units are identical.

    No implicit conversion from source units to square metres is performed.
    """

    if estimate_value < 0:
        raise ValueError("estimate_value must be non-negative")

    if not estimate_method.strip():
        raise ValueError("estimate_method must be non-empty")

    blocker_codes: list[str] = []

    if not reference.same_pile_confirmed:
        blocker_codes.append("same_pile_unconfirmed")

    if estimate_unit != reference.unit:
        blocker_codes.append("area_units_incompatible")

    if blocker_codes:
        return FaceAreaComparison(
            estimate_method=estimate_method,
            estimate_value=estimate_value,
            estimate_unit=estimate_unit,
            reference=reference,
            comparison_ready=False,
            blocker_codes=blocker_codes,
        )

    signed_error = estimate_value - reference.value
    absolute_error = abs(signed_error)

    relative_error = signed_error / reference.value
    absolute_relative_error = abs(relative_error)

    return FaceAreaComparison(
        estimate_method=estimate_method,
        estimate_value=estimate_value,
        estimate_unit=estimate_unit,
        reference=reference,
        comparison_ready=True,
        blocker_codes=[],
        signed_error=signed_error,
        absolute_error=absolute_error,
        relative_error=relative_error,
        absolute_relative_error=absolute_relative_error,
        percent_error=relative_error * 100.0,
        absolute_percent_error=absolute_relative_error * 100.0,
    )


_METRE_HORIZONTAL_UNIT_NAMES = frozenset(
    {
        "metre",
        "meter",
    }
)


def face_area_unit_from_horizontal_units(
    horizontal_units: str | None,
) -> FaceAreaUnit:
    """Resolve the automatic face-area unit from explicit CRS metadata.

    Only explicit metre/meter axis units are promoted to square metres.

    Missing, unknown, imperial, or otherwise unsupported units remain generic
    source-coordinate units. No conversion or inference is performed.
    """

    if horizontal_units is None:
        return FaceAreaUnit.SOURCE_UNITS_SQUARED

    normalized = horizontal_units.strip().casefold()

    if normalized in _METRE_HORIZONTAL_UNIT_NAMES:
        return FaceAreaUnit.SQUARE_METRES

    return FaceAreaUnit.SOURCE_UNITS_SQUARED
