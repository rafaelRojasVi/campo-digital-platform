from __future__ import annotations

import numpy as np
import pytest

from lidar_volume.face_boundary import (
    boundary_cell_points,
    concave_hull_polygon,
    mask_to_polygon,
    measure_polygon,
)

RECTANGLE = np.array(
    [
        [0.0, 0.0],
        [10.0, 0.0],
        [10.0, 4.0],
        [0.0, 4.0],
    ]
)

TRIANGLE = np.array(
    [
        [0.0, 0.0],
        [6.0, 0.0],
        [3.0, 4.0],
    ]
)


def test_rectangle_has_exact_area_and_perimeter() -> None:
    result = measure_polygon(RECTANGLE, method_name="test")

    assert result.area_source_units_squared == pytest.approx(40.0)
    assert result.perimeter_source_units == pytest.approx(28.0)
    assert result.vertex_count == 4


def test_triangle_has_exact_area() -> None:
    result = measure_polygon(TRIANGLE, method_name="test")

    assert result.area_source_units_squared == pytest.approx(12.0)
    assert result.vertex_count == 3


def test_irregular_polygon_has_expected_area() -> None:
    # An L-shaped polygon: a 4x4 square with a 2x2 notch removed from a corner.
    vertices = np.array(
        [
            [0.0, 0.0],
            [4.0, 0.0],
            [4.0, 2.0],
            [2.0, 2.0],
            [2.0, 4.0],
            [0.0, 4.0],
        ]
    )

    result = measure_polygon(vertices, method_name="test")

    assert result.area_source_units_squared == pytest.approx(12.0)


def test_reversed_orientation_does_not_change_area() -> None:
    forward = measure_polygon(RECTANGLE, method_name="test")
    reversed_result = measure_polygon(RECTANGLE[::-1], method_name="test")

    assert forward.area_source_units_squared == pytest.approx(
        reversed_result.area_source_units_squared
    )


def test_duplicate_closing_vertex_is_normalized() -> None:
    closed = np.vstack([RECTANGLE, RECTANGLE[0]])

    without_dupe = measure_polygon(RECTANGLE, method_name="test")
    with_dupe = measure_polygon(closed, method_name="test")

    assert without_dupe.area_source_units_squared == pytest.approx(
        with_dupe.area_source_units_squared
    )
    assert without_dupe.vertex_count == with_dupe.vertex_count == 4


def test_coordinate_translation_does_not_change_area() -> None:
    translated = RECTANGLE + np.array([1000.0, -500.0])

    base = measure_polygon(RECTANGLE, method_name="test")
    shifted = measure_polygon(translated, method_name="test")

    assert base.area_source_units_squared == pytest.approx(shifted.area_source_units_squared)


def test_repeated_calls_are_deterministic() -> None:
    first = measure_polygon(RECTANGLE, method_name="test")
    second = measure_polygon(RECTANGLE, method_name="test")

    assert first.area_source_units_squared == second.area_source_units_squared
    assert first.perimeter_source_units == second.perimeter_source_units
    assert np.array_equal(first.vertices, second.vertices)


@pytest.mark.parametrize(
    "vertices",
    [
        np.array([[0.0, 0.0], [1.0, 0.0]]),
        np.array([[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]]),
        np.array([[0.0, 0.0], [1.0, np.nan], [0.0, 1.0]]),
    ],
)
def test_degenerate_polygons_are_rejected(vertices: np.ndarray) -> None:
    with pytest.raises(ValueError):
        measure_polygon(vertices, method_name="test")


def test_self_intersecting_polygon_is_rejected() -> None:
    bowtie = np.array(
        [
            [0.0, 0.0],
            [1.0, 1.0],
            [1.0, 0.0],
            [0.0, 1.0],
        ]
    )

    with pytest.raises(ValueError, match="self-intersecting"):
        measure_polygon(bowtie, method_name="test")


def test_area_is_never_negative() -> None:
    for vertices in (RECTANGLE, RECTANGLE[::-1], TRIANGLE):
        result = measure_polygon(vertices, method_name="test")
        assert result.area_source_units_squared >= 0.0


def test_mask_to_polygon_rectangle_has_exact_area() -> None:
    mask = np.ones((4, 10), dtype=bool)

    result = mask_to_polygon(
        mask,
        u_min=0.0,
        cell_size_u=1.0,
        z_min=0.0,
        cell_size_z=1.0,
        method_name="test",
    )

    assert result.area_source_units_squared == pytest.approx(40.0)


def test_mask_to_polygon_l_shape_has_exact_area() -> None:
    mask = np.zeros((4, 4), dtype=bool)
    mask[0:2, :] = True
    mask[:, 0:2] = True

    result = mask_to_polygon(
        mask,
        u_min=0.0,
        cell_size_u=1.0,
        z_min=0.0,
        cell_size_z=1.0,
        method_name="test",
    )

    expected_cells = int(mask.sum())
    assert result.area_source_units_squared == pytest.approx(float(expected_cells))


def test_mask_to_polygon_large_solid_mask_stays_one_connected_polygon() -> None:
    # Regression test: unioning many exactly-abutting per-row boxes without
    # explicit grid-size snapping can fragment a fully solid mask into a
    # MultiPolygon of many small pieces that still sum to the right total
    # area, silently discarding most of it if only the largest piece were
    # kept. A mask this large (80 rows) reproduced that GEOS edge case.
    mask = np.ones((80, 201), dtype=bool)

    result = mask_to_polygon(
        mask,
        u_min=0.0,
        cell_size_u=0.05,
        z_min=0.0,
        cell_size_z=0.05,
        method_name="test",
    )

    expected = float(mask.sum()) * 0.05 * 0.05
    assert result.area_source_units_squared == pytest.approx(expected, rel=1e-9)
    assert result.part_count == 1


def test_mask_to_polygon_sums_area_across_disconnected_parts() -> None:
    # Two isolated single cells: not one connected region on the raster grid,
    # let alone one simple polygon. Total area must still equal the sum of
    # both cells, matching how the raster kernel counts cells regardless of
    # adjacency, and part_count must make the multi-part nature explicit.
    mask = np.zeros((5, 5), dtype=bool)
    mask[0, 0] = True
    mask[4, 4] = True

    result = mask_to_polygon(
        mask,
        u_min=0.0,
        cell_size_u=1.0,
        z_min=0.0,
        cell_size_z=1.0,
        method_name="test",
    )

    assert result.area_source_units_squared == pytest.approx(2.0)
    assert result.part_count == 2
    # vertices describe only one (arbitrary, tied) part.
    assert result.vertex_count == 4


def _diagonal_touch_mask() -> np.ndarray:
    mask = np.zeros((2, 2), dtype=bool)
    mask[0, 0] = True
    mask[1, 1] = True
    return mask


def test_mask_to_polygon_diagonal_touch_is_two_parts_summed() -> None:
    # A raster labeled with 8-connectivity treats a diagonal touch as one
    # connected component, but two unit squares sharing only a corner do not
    # form a single simple polygon when unioned.
    result = mask_to_polygon(
        _diagonal_touch_mask(),
        u_min=0.0,
        cell_size_u=1.0,
        z_min=0.0,
        cell_size_z=1.0,
        method_name="test",
    )

    assert result.area_source_units_squared == pytest.approx(2.0)
    assert result.part_count == 2
    # Perimeter semantics: each 1x1 square has perimeter 4; two separate
    # parts contribute their full, separate boundaries (8), not the smaller
    # perimeter a single (nonexistent) merged shape would have.
    assert result.perimeter_source_units == pytest.approx(8.0)


def test_mask_to_polygon_part_count_is_deterministic() -> None:
    first = mask_to_polygon(
        _diagonal_touch_mask(),
        u_min=0.0,
        cell_size_u=1.0,
        z_min=0.0,
        cell_size_z=1.0,
        method_name="test",
    )
    second = mask_to_polygon(
        _diagonal_touch_mask(),
        u_min=0.0,
        cell_size_u=1.0,
        z_min=0.0,
        cell_size_z=1.0,
        method_name="test",
    )

    assert first.part_count == second.part_count == 2
    assert first.area_source_units_squared == second.area_source_units_squared
    assert first.perimeter_source_units == second.perimeter_source_units
    assert np.array_equal(first.vertices, second.vertices)


def test_mask_to_polygon_multipart_area_is_translation_invariant() -> None:
    base = mask_to_polygon(
        _diagonal_touch_mask(),
        u_min=0.0,
        cell_size_u=1.0,
        z_min=0.0,
        cell_size_z=1.0,
        method_name="test",
    )
    shifted = mask_to_polygon(
        _diagonal_touch_mask(),
        u_min=1000.0,
        cell_size_u=1.0,
        z_min=-500.0,
        cell_size_z=1.0,
        method_name="test",
    )

    assert base.area_source_units_squared == pytest.approx(shifted.area_source_units_squared)
    assert base.perimeter_source_units == pytest.approx(shifted.perimeter_source_units)
    assert base.part_count == shifted.part_count


def test_require_single_part_passes_through_single_part_result() -> None:
    result = measure_polygon(RECTANGLE, method_name="test")

    assert result.require_single_part() is result


def test_require_single_part_raises_on_multipart_result() -> None:
    result = mask_to_polygon(
        _diagonal_touch_mask(),
        u_min=0.0,
        cell_size_u=1.0,
        z_min=0.0,
        cell_size_z=1.0,
        method_name="test",
    )

    with pytest.raises(ValueError, match="expected a single-part polygon"):
        result.require_single_part()


def test_mask_to_polygon_rejects_empty_mask() -> None:
    with pytest.raises(ValueError, match="no True cells"):
        mask_to_polygon(
            np.zeros((3, 3), dtype=bool),
            u_min=0.0,
            cell_size_u=1.0,
            z_min=0.0,
            cell_size_z=1.0,
            method_name="test",
        )


def test_boundary_cell_points_excludes_interior_cell() -> None:
    mask = np.ones((3, 3), dtype=bool)

    points = boundary_cell_points(
        mask,
        u_min=0.0,
        cell_size_u=1.0,
        z_min=0.0,
        cell_size_z=1.0,
    )

    # The single interior cell (row 1, col 1) must not be included.
    assert len(points) == mask.sum() - 1


def test_boundary_cell_points_single_cell_is_its_own_boundary() -> None:
    mask = np.ones((1, 1), dtype=bool)

    points = boundary_cell_points(
        mask,
        u_min=0.0,
        cell_size_u=1.0,
        z_min=0.0,
        cell_size_z=1.0,
    )

    assert len(points) == 1


def test_concave_hull_of_l_shape_is_smaller_at_low_ratio() -> None:
    rng = np.random.default_rng(0)

    square_a = rng.uniform(0.0, 4.0, size=(400, 2))
    square_b = rng.uniform(0.0, 4.0, size=(400, 2)) + np.array([4.0, 0.0])

    boundary = np.array(
        [
            [0.0, 0.0],
            [8.0, 0.0],
            [8.0, 4.0],
            [4.0, 4.0],
            [4.0, 8.0],
            [0.0, 8.0],
        ]
    )

    points = np.vstack([boundary, square_a, square_b])

    low_ratio = concave_hull_polygon(points, ratio=0.0, method_name="test")
    high_ratio = concave_hull_polygon(points, ratio=1.0, method_name="test")

    # ratio=1.0 approaches the convex hull, which must bridge the notch and
    # therefore be at least as large as the tighter low-ratio hull.
    assert high_ratio.area_source_units_squared >= low_ratio.area_source_units_squared


def test_concave_hull_rejects_out_of_range_ratio() -> None:
    points = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])

    with pytest.raises(ValueError, match="ratio must be in"):
        concave_hull_polygon(points, ratio=1.5, method_name="test")
