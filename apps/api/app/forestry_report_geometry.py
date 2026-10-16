"""Geometry and attribute rules for a Rodales management report (pure).

The editor sends the features of a report; this module decides whether they
may be stored and fills in what the server owns (areas, ``editada``). It
never touches the database: the caller loads the report's source polygons
from its base snapshot (``app.forestry_reports``).

Rules (spec ``docs/superpowers/specs/2026-10-16-rodales-informes-de-manejo-design.md``):

- every feature names a polygon of the report's base snapshot by ordinal;
- the features naming one source polygon, together, cover exactly that
  polygon: one untouched copy, or the pieces of a split, however nested;
- a source polygon invalid in the base may be carried untouched (with a
  warning) but not split;
- changed pieces are valid and at least 1 m²; no two features overlap;
- only the editable attributes may change, as text within their DBF width
  (counted in UTF-8 bytes, as the DBF stores them).

Shapely runs GEOS, the same engine as PostGIS, in EPSG:32718 metres.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import shapely
import shapely.errors
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

MAX_FEATURES = 500
MIN_PIECE_AREA_M2 = 1.0
COVERAGE_TOLERANCE_M2 = 0.01
OVERLAP_TOLERANCE_M2 = 0.01
# Coordinates come back from the browser as JSON numbers; a polygon within
# this distance of its source, vertex by vertex, is the untouched source.
UNTOUCHED_TOLERANCE_M = 1e-6
EDITADA_WEB = "wb"

# What the editor may change, with each field's DBF width in bytes.
# ``cod_uso_2026`` is 10 wide in the base; the export widens it to 25 so
# codes are no longer cut (``RaCoRo01P*``).
EDITABLE_ATTRIBUTE_WIDTHS: dict[str, int] = {
    "n_rodal": 10,
    "n_rodal_te": 3,
    "cod_uso": 25,
    "uso_2024": 50,
    "desc_uso": 50,
    "uso_2026": 50,
    "cod_uso_2026": 25,
}

MESSAGES: dict[str, str] = {
    "too_many_features": f"Un informe puede tener hasta {MAX_FEATURES} polígonos.",
    "unknown_source": "Un polígono no corresponde a la base del informe. Recargue el informe.",
    "attribute_not_editable": "Ese dato no se puede cambiar desde la web.",
    "attribute_not_text": "Los datos de un polígono deben ser texto.",
    "attribute_too_long": "Un dato es demasiado largo para su campo del shapefile.",
    "geometry_unreadable": "No se pudo leer la forma de un polígono.",
    "geometry_invalid": "Una de las partes quedó con una forma inválida. Ajuste la línea de corte.",
    "source_invalid_split": (
        "Esta geometría tiene un error en la base original; corríjanla en ArcMap."
    ),
    "piece_too_small": "Una de las partes es demasiado pequeña (menos de 1 m²). Ajuste la línea.",
    "split_coverage": (
        "Las partes de un rodal dividido no cubren el rodal original. Deshaga el último corte."
    ),
    "overlap": "Dos polígonos del informe se superponen.",
}
WARNING_MESSAGES: dict[str, str] = {
    "invalid_source_carried": (
        "Este polígono tiene un error de geometría en la base original: se puede incluir, "
        "pero no dividir."
    ),
}

_READ_ERRORS = (AttributeError, KeyError, TypeError, ValueError, shapely.errors.ShapelyError)


class ReportValidationError(ValueError):
    """The features cannot be stored; ``code`` is stable, ``message`` is Spanish."""

    def __init__(self, code: str, *, source_feature_ordinal: int | None = None) -> None:
        super().__init__(MESSAGES[code])
        self.code = code
        self.message = MESSAGES[code]
        self.source_feature_ordinal = source_feature_ordinal


@dataclass(frozen=True, slots=True)
class ReportWarning:
    """Stored anyway, but worth telling the user."""

    code: str
    message: str
    source_feature_ordinal: int | None = None


@dataclass(frozen=True, slots=True)
class SourcePolygon:
    """One polygon of the report's base snapshot."""

    feature_ordinal: int
    attributes: Mapping[str, Any]
    geometry: BaseGeometry
    is_valid: bool


@dataclass(frozen=True, slots=True)
class FeatureInput:
    """One feature as the editor sends it. ``geometry`` None: untouched copy."""

    source_feature_ordinal: int
    in_report: bool
    attributes: Mapping[str, Any]
    geometry: Mapping[str, Any] | None


@dataclass(frozen=True, slots=True)
class ResolvedFeature:
    """One feature ready to store."""

    position: int
    source_feature_ordinal: int
    in_report: bool
    geometry_changed: bool
    attributes: dict[str, Any]
    geometry: MultiPolygon


@dataclass(frozen=True, slots=True)
class Resolution:
    features: list[ResolvedFeature]
    warnings: list[ReportWarning]


def resolve_features(
    inputs: Sequence[FeatureInput], sources: Mapping[int, SourcePolygon]
) -> Resolution:
    """Check ``inputs`` against their ``sources``; raise ``ReportValidationError`` or resolve."""

    if len(inputs) > MAX_FEATURES:
        raise ReportValidationError("too_many_features")

    parsed: list[tuple[FeatureInput, MultiPolygon, dict[str, str | None]]] = []
    for item in inputs:
        ordinal = item.source_feature_ordinal
        source = sources.get(ordinal)
        if source is None:
            raise ReportValidationError("unknown_source", source_feature_ordinal=ordinal)
        overrides = _clean_attributes(item.attributes, ordinal)
        if item.geometry is None:
            geometry = _to_multipolygon(source.geometry)
        else:
            geometry = _read_geometry(item.geometry, ordinal)
        parsed.append((item, geometry, overrides))

    pieces_by_source: dict[int, list[MultiPolygon]] = defaultdict(list)
    for item, geometry, _ in parsed:
        pieces_by_source[item.source_feature_ordinal].append(geometry)

    changed_sources: set[int] = set()
    warnings: list[ReportWarning] = []
    for ordinal, pieces in pieces_by_source.items():
        source = sources[ordinal]
        if len(pieces) == 1 and _same_shape(pieces[0], source.geometry):
            if not source.is_valid:
                warnings.append(
                    ReportWarning(
                        "invalid_source_carried",
                        WARNING_MESSAGES["invalid_source_carried"],
                        ordinal,
                    )
                )
            continue
        if all(_same_shape(piece, source.geometry) for piece in pieces):
            # The same polygon pasted more than once: the overlap check says so.
            continue
        if not source.is_valid:
            raise ReportValidationError("source_invalid_split", source_feature_ordinal=ordinal)
        for piece in pieces:
            if not piece.is_valid:
                raise ReportValidationError("geometry_invalid", source_feature_ordinal=ordinal)
            if piece.area < MIN_PIECE_AREA_M2:
                raise ReportValidationError("piece_too_small", source_feature_ordinal=ordinal)
        union = shapely.union_all(pieces)
        if shapely.symmetric_difference(union, source.geometry).area > COVERAGE_TOLERANCE_M2:
            raise ReportValidationError("split_coverage", source_feature_ordinal=ordinal)
        changed_sources.add(ordinal)

    resolved: list[ResolvedFeature] = []
    for position, (item, geometry, overrides) in enumerate(parsed, start=1):
        ordinal = item.source_feature_ordinal
        source = sources[ordinal]
        changed = ordinal in changed_sources
        stored = geometry if changed else _to_multipolygon(source.geometry)
        attributes = dict(source.attributes)
        attributes.update(overrides)
        attributes_changed = any(
            attributes.get(key) != source.attributes.get(key) for key in overrides
        )
        if changed:
            area = float(stored.area)
            attributes["sup_ha"] = area / 10_000
            attributes["shape_area"] = area
            attributes["shape_leng"] = float(stored.length)
        if changed or attributes_changed:
            attributes["editada"] = EDITADA_WEB
        resolved.append(
            ResolvedFeature(position, ordinal, item.in_report, changed, attributes, stored)
        )

    _reject_overlaps(resolved)
    return Resolution(resolved, warnings)


def _clean_attributes(raw: Mapping[str, Any], ordinal: int) -> dict[str, str | None]:
    cleaned: dict[str, str | None] = {}
    for key, value in raw.items():
        width = EDITABLE_ATTRIBUTE_WIDTHS.get(key)
        if width is None:
            raise ReportValidationError("attribute_not_editable", source_feature_ordinal=ordinal)
        if value is not None and not isinstance(value, str):
            raise ReportValidationError("attribute_not_text", source_feature_ordinal=ordinal)
        text = (value or "").strip()
        if len(text.encode("utf-8")) > width:
            raise ReportValidationError("attribute_too_long", source_feature_ordinal=ordinal)
        cleaned[key] = text or None
    return cleaned


def _read_geometry(raw: Mapping[str, Any], ordinal: int) -> MultiPolygon:
    try:
        geometry = shape(raw)
    except _READ_ERRORS as error:
        raise ReportValidationError(
            "geometry_unreadable", source_feature_ordinal=ordinal
        ) from error
    if isinstance(geometry, Polygon):
        geometry = MultiPolygon([geometry])
    if (
        not isinstance(geometry, MultiPolygon)
        or geometry.is_empty
        or not all(math.isfinite(value) for value in geometry.bounds)
    ):
        raise ReportValidationError("geometry_unreadable", source_feature_ordinal=ordinal)
    return geometry


def _to_multipolygon(geometry: BaseGeometry) -> MultiPolygon:
    if isinstance(geometry, MultiPolygon):
        return geometry
    if isinstance(geometry, Polygon):
        return MultiPolygon([geometry])
    raise TypeError(f"Source geometry is {geometry.geom_type}, not a polygon.")


def _same_shape(candidate: BaseGeometry, source: BaseGeometry) -> bool:
    """Same polygon up to float noise, whatever vertex a ring starts at.

    ``normalize`` + ``equals_exact`` is order-sensitive: noise on one of two
    vertices tied for the lowest x changes where a normalized ring starts.
    Comparing vertex counts and the Hausdorff distance is not.
    """

    target = _to_multipolygon(source)
    if shapely.get_num_geometries(candidate) != shapely.get_num_geometries(target):
        return False
    if shapely.get_num_coordinates(candidate) != shapely.get_num_coordinates(target):
        return False
    return bool(shapely.hausdorff_distance(candidate, target) <= UNTOUCHED_TOLERANCE_M)


def _reject_overlaps(features: Sequence[ResolvedFeature]) -> None:
    """Refuse overlapping features that come from the same source polygon.

    Features from different source polygons overlap only where their sources
    already overlap in the base (the coverage rule keeps every piece inside
    its source); masters edited without topology rules carry such slivers,
    and the user cannot fix them here, so they are not refused.
    """

    if len(features) < 2:
        return
    # An untouched source may be invalid (a bowtie); measure overlaps on
    # repaired copies so GEOS does not refuse the intersection.
    geometries = [shapely.make_valid(feature.geometry) for feature in features]
    tree = STRtree(geometries)
    left, right = tree.query(geometries, predicate="intersects")
    for i, j in zip(left.tolist(), right.tolist(), strict=True):
        if i >= j:
            continue
        if features[i].source_feature_ordinal != features[j].source_feature_ordinal:
            continue
        if shapely.intersection(geometries[i], geometries[j]).area > OVERLAP_TOLERANCE_M2:
            raise ReportValidationError(
                "overlap", source_feature_ordinal=features[j].source_feature_ordinal
            )
