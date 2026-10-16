"""Geometry and attribute rules for Rodales management reports (pure, no database)."""

from __future__ import annotations

from typing import Any

import pytest
import shapely
from app.forestry_report_geometry import (
    EDITADA_WEB,
    MAX_FEATURES,
    FeatureInput,
    ReportValidationError,
    SourcePolygon,
    resolve_features,
)
from shapely.geometry import LineString, MultiPolygon, Polygon, box, mapping

SQUARE = box(0.0, 0.0, 100.0, 100.0)  # 1 ha
BOWTIE = Polygon([(0.0, 0.0), (100.0, 100.0), (0.0, 100.0), (100.0, 0.0), (0.0, 0.0)])


def source(ordinal: int = 1, geometry: Polygon = SQUARE, *, is_valid: bool = True) -> SourcePolygon:
    attributes: dict[str, Any] = {
        "objectid": 10 + ordinal,
        "n_rodal": "17",
        "n_rodal_te": None,
        "sup_ha": 1.0,
        "editada": None,
        "cod_uso": "Pi06",
        "shape_area": 10_000.0,
        "shape_leng": 400.0,
    }
    return SourcePolygon(ordinal, attributes, MultiPolygon([geometry]), is_valid)


def feature(
    ordinal: int, geometry: Polygon | None, *, in_report: bool = False, **attributes: Any
) -> FeatureInput:
    return FeatureInput(
        ordinal, in_report, attributes, None if geometry is None else mapping(geometry)
    )


def code_of(inputs: list[FeatureInput], sources: dict[int, SourcePolygon]) -> str:
    with pytest.raises(ReportValidationError) as raised:
        resolve_features(inputs, sources)
    return raised.value.code


def test_empty_report_is_valid() -> None:
    assert resolve_features([], {}).features == []


def test_pasted_polygon_without_geometry_is_an_untouched_copy() -> None:
    result = resolve_features([feature(1, None, in_report=True)], {1: source()})
    [only] = result.features
    assert only.geometry_changed is False
    assert only.attributes["sup_ha"] == 1.0
    assert only.attributes["editada"] is None
    assert only.in_report is True
    assert shapely.equals(only.geometry, SQUARE)


def test_float_noise_keeps_a_polygon_untouched() -> None:
    noisy = Polygon([(x + 1e-9, y - 1e-9) for x, y in SQUARE.exterior.coords])
    [only] = resolve_features([feature(1, noisy)], {1: source()}).features
    assert only.geometry_changed is False
    assert only.attributes["sup_ha"] == 1.0


def test_split_in_two_recomputes_area_and_marks_editada() -> None:
    left, right = box(0, 0, 60, 100), box(60, 0, 100, 100)
    result = resolve_features(
        [feature(1, left, in_report=True, n_rodal="17-1"), feature(1, right)], {1: source()}
    )
    first, second = result.features
    assert (first.geometry_changed, second.geometry_changed) == (True, True)
    assert first.attributes["sup_ha"] == pytest.approx(0.6)
    assert second.attributes["sup_ha"] == pytest.approx(0.4)
    assert first.attributes["shape_area"] == pytest.approx(6_000.0)
    assert first.attributes["shape_leng"] == pytest.approx(320.0)
    assert first.attributes["n_rodal"] == "17-1"
    assert second.attributes["n_rodal"] == "17"
    assert first.attributes["editada"] == EDITADA_WEB == second.attributes["editada"]
    assert [f.position for f in result.features] == [1, 2]


def test_nested_split_is_checked_against_the_root() -> None:
    pieces = [box(0, 0, 50, 100), box(50, 0, 100, 50), box(50, 50, 100, 100)]
    result = resolve_features([feature(1, piece) for piece in pieces], {1: source()})
    assert len(result.features) == 3


def test_missing_piece_is_refused() -> None:
    assert code_of([feature(1, box(0, 0, 60, 100))], {1: source()}) == "split_coverage"


def test_pasted_twice_is_an_overlap() -> None:
    assert code_of([feature(1, None), feature(1, None)], {1: source()}) == "overlap"


def test_overlapping_pieces_are_refused() -> None:
    pieces = [box(0, 0, 60, 100), box(40, 0, 100, 100)]
    assert code_of([feature(1, piece) for piece in pieces], {1: source()}) == "overlap"


def test_two_sources_touching_along_an_edge_do_not_overlap() -> None:
    sources = {1: source(1), 2: source(2, box(100, 0, 200, 100))}
    assert len(resolve_features([feature(1, None), feature(2, None)], sources).features) == 2


def test_piece_under_one_square_metre_is_refused() -> None:
    sliver = box(0, 0, 0.5, 1)
    rest = SQUARE.difference(sliver)
    assert code_of([feature(1, sliver), feature(1, rest)], {1: source()}) == "piece_too_small"


def test_split_of_a_polygon_with_a_hole() -> None:
    holed = Polygon(SQUARE.exterior.coords, [box(40, 40, 60, 60).exterior.coords])
    left = holed.intersection(box(0, 0, 50, 100))
    right = holed.intersection(box(50, 0, 100, 100))
    result = resolve_features([feature(1, left), feature(1, right)], {1: source(1, holed)})
    assert sum(f.attributes["sup_ha"] for f in result.features) == pytest.approx(0.96)


def test_invalid_source_may_be_carried_untouched_with_a_warning() -> None:
    result = resolve_features([feature(1, None)], {1: source(1, BOWTIE, is_valid=False)})
    assert result.features[0].geometry_changed is False
    assert [w.code for w in result.warnings] == ["invalid_source_carried"]
    assert result.warnings[0].source_feature_ordinal == 1


def test_invalid_source_cannot_be_split() -> None:
    halves = [box(0, 0, 50, 100), box(50, 0, 100, 100)]
    sources = {1: source(1, BOWTIE, is_valid=False)}
    assert code_of([feature(1, half) for half in halves], sources) == "source_invalid_split"


def test_unknown_source_is_refused() -> None:
    with pytest.raises(ReportValidationError) as raised:
        resolve_features([feature(7, None)], {1: source()})
    assert raised.value.code == "unknown_source"
    assert raised.value.source_feature_ordinal == 7


def test_non_editable_attribute_is_refused() -> None:
    assert code_of([feature(1, None, sup_ha="9")], {1: source()}) == "attribute_not_editable"


def test_attribute_must_be_text() -> None:
    assert code_of([feature(1, None, n_rodal=17)], {1: source()}) == "attribute_not_text"


def test_attribute_longer_than_its_field_is_refused() -> None:
    assert code_of([feature(1, None, n_rodal="12345678901")], {1: source()}) == "attribute_too_long"


def test_width_counts_utf8_bytes() -> None:
    # n_rodal_te is 3 bytes wide: "ñ" is 2 bytes, "ññ" is 4.
    resolve_features([feature(1, None, n_rodal_te="ñ")], {1: source()})
    assert code_of([feature(1, None, n_rodal_te="ññ")], {1: source()}) == "attribute_too_long"


def test_blank_attribute_becomes_none() -> None:
    [only] = resolve_features([feature(1, None, cod_uso="  ")], {1: source()}).features
    assert only.attributes["cod_uso"] is None


def test_attribute_only_change_marks_editada_without_changing_area() -> None:
    [only] = resolve_features([feature(1, None, cod_uso="Eg03")], {1: source()}).features
    assert only.geometry_changed is False
    assert only.attributes["cod_uso"] == "Eg03"
    assert only.attributes["editada"] == EDITADA_WEB
    assert only.attributes["sup_ha"] == 1.0


def test_unchanged_attribute_value_does_not_mark_editada() -> None:
    [only] = resolve_features([feature(1, None, cod_uso="Pi06")], {1: source()}).features
    assert only.attributes["editada"] is None


def test_line_geometry_is_unreadable() -> None:
    line = FeatureInput(1, False, {}, mapping(LineString([(0, 0), (1, 1)])))
    assert code_of([line], {1: source()}) == "geometry_unreadable"


def test_garbage_geometry_is_unreadable() -> None:
    garbage = FeatureInput(1, False, {}, {"type": "Polygon", "coordinates": "nope"})
    assert code_of([garbage], {1: source()}) == "geometry_unreadable"


def test_too_many_features_is_refused_first() -> None:
    inputs = [feature(999, None) for _ in range(MAX_FEATURES + 1)]
    assert code_of(inputs, {}) == "too_many_features"


def test_messages_are_spanish() -> None:
    with pytest.raises(ReportValidationError) as raised:
        resolve_features([feature(1, box(0, 0, 60, 100))], {1: source()})
    assert "rodal" in raised.value.message


def test_noise_on_one_vertex_where_lowest_x_vertices_tie_keeps_it_untouched() -> None:
    # Two vertices share the lowest x; noise on one changes which one a
    # normalized ring starts at, which must not matter.
    rectangle = box(0.0, 0.0, 100.0, 50.0)
    coords = list(rectangle.exterior.coords)
    noisy = Polygon([(x - 1e-9, y) if (x, y) == (0.0, 50.0) else (x, y) for x, y in coords])
    [only] = resolve_features([feature(1, noisy)], {1: source(1, rectangle)}).features
    assert only.geometry_changed is False
    assert only.attributes["sup_ha"] == 1.0
    assert only.attributes["editada"] is None


def test_noise_on_an_invalid_source_keeps_it_carried_untouched() -> None:
    coords = list(BOWTIE.exterior.coords)
    noisy = Polygon([(x - 1e-9, y) if (x, y) == (0.0, 100.0) else (x, y) for x, y in coords])
    result = resolve_features([feature(1, noisy)], {1: source(1, BOWTIE, is_valid=False)})
    assert result.features[0].geometry_changed is False
    assert [w.code for w in result.warnings] == ["invalid_source_carried"]


def test_neighbours_that_already_overlap_in_the_base_can_both_be_included() -> None:
    # ArcMap masters without topology rules can carry slivers between rodales.
    sources = {1: source(1, box(0, 0, 100, 100)), 2: source(2, box(99, 0, 200, 100))}
    result = resolve_features([feature(1, None), feature(2, None)], sources)
    assert len(result.features) == 2


def test_a_split_next_to_an_overlapping_neighbour_is_accepted() -> None:
    sources = {1: source(1, box(0, 0, 100, 100)), 2: source(2, box(99, 0, 200, 100))}
    pieces = [box(0, 0, 50, 100), box(50, 0, 100, 100)]
    inputs = [feature(1, piece) for piece in pieces] + [feature(2, None)]
    assert len(resolve_features(inputs, sources).features) == 3
