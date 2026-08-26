"""Shared polygonal-geometry representation and measurement for face estimators.

Every competing face-boundary estimator (geometric today, potentially
ML-derived later) must express its output as a closed *polygonal geometry* --
a single ``Polygon`` or a ``MultiPolygon`` -- in the local ``(u, z)`` face
frame, and every geometry must be measured through the single function in
this module.

No estimator computes its own area or perimeter formula. This is the
"common polygon measurement" layer of the shared experiment architecture
(see docs/decisions/ADR-004-hybrid-measurement-experiment-architecture.md).

Polygon vs. polygonal geometry
-------------------------------
The common representation deliberately accepts *polygonal geometry*
(``Polygon`` or ``MultiPolygon``), not only a single simple ``Polygon``.
Real raster evidence made this necessary: ``estimate_projected_face_raster``
labels connected components using 8-connectivity (two cells touching only at
a corner count as one raster component), but two unit squares that touch
only at a corner do not share a union boundary and cannot be represented as
one simple ``Polygon``. Converting that evidence into a boundary must
therefore either (a) silently drop the diagonally-attached part, (b) bridge
it with an arbitrary buffer/morphological operation that changes area, or
(c) represent it honestly as a ``MultiPolygon``. This module always chooses
(c): see ``PolygonalMeasurement.part_count``.

An estimator whose method is mathematically guaranteed to produce one simple
ring (the scanline envelope; ``concave_hull``, which shapely defines to
always return a single ``Polygon``) will always measure with
``part_count == 1``. Only ``mask_to_polygon`` can legitimately return more
than one part, and only when the underlying mask actually has diagonal-only
connectivity. An estimator that must promise a single external contour can
call ``PolygonalMeasurement.require_single_part()`` to turn a surprise
multi-part result into an explicit error instead of silently accepting it.

Self-intersecting rings are rejected rather than repaired: none of the
current estimators can produce one by construction, and silently repairing
one would hide a bug in whichever estimator produced it. Likewise, a
multi-part result is never bridged, buffered, or reduced to its largest part
to force a single ``Polygon`` -- that would change the measured area for no
geometric reason.

This module expresses geometry only. It does not infer coordinate units,
CRS, or physical accuracy.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import shapely
from shapely.geometry import MultiPoint, MultiPolygon, Polygon


@dataclass(frozen=True)
class PolygonalMeasurement:
    """Area/perimeter measurement of one closed (u, z) polygonal geometry.

    "Polygonal geometry" means a single ``Polygon`` or a ``MultiPolygon``;
    see the module docstring for why more than one part can be legitimate.

    ``area_source_units_squared`` and ``perimeter_source_units`` are always
    summed across every part -- this matches the raster kernel's own
    cell-counting semantics, which does not distinguish edge- from
    corner-adjacency, and it means area is never lost by discarding a part.

    Perimeter semantics: perimeter is the sum of each part's *exterior*
    boundary length (interior holes, if any survive upstream hole-filling,
    are removed before measurement, since the gross-face observable is a
    filled silhouette -- see ``mask_to_polygon``). When ``part_count > 1``,
    this is the combined boundary length of every separate part, which is
    intentionally larger than the perimeter of any single merged shape would
    be -- there is no single merged shape, so there is no smaller perimeter
    to report.

    ``part_count`` is normally 1. ``vertices``/``vertex_count`` always
    describe only the single largest part, for diagnostic display -- they
    are never used to derive ``area_source_units_squared`` or
    ``perimeter_source_units``, and must not be used to reconstruct total
    area/perimeter when ``part_count > 1``.
    """

    method_name: str

    area_source_units_squared: float
    perimeter_source_units: float
    vertex_count: int
    part_count: int

    vertices: np.ndarray

    def require_single_part(self) -> PolygonalMeasurement:
        """Return ``self`` unchanged, or raise if this measurement has more than one part.

        For estimators that must promise a single external contour (rather
        than QA/support geometry, for which more than one part can be
        legitimate -- see the module docstring).
        """

        if self.part_count != 1:
            raise ValueError(
                f"{self.method_name}: expected a single-part polygon but got "
                f"{self.part_count} parts; this estimator promises one external "
                "contour and does not silently reduce a multi-part result"
            )

        return self


def _measure_shapely_geometry(
    geometry: Polygon | MultiPolygon,
    *,
    method_name: str,
) -> PolygonalMeasurement:
    parts = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]

    for part in parts:
        if not part.is_valid:
            raise ValueError(
                f"{method_name}: self-intersecting or otherwise invalid polygon "
                "is not supported; the shared polygon-measurement policy rejects "
                "it rather than repairing it"
            )

    if geometry.is_empty or geometry.area <= 0:
        raise ValueError(f"{method_name}: polygon has zero or negative area")

    # Deterministic tie-break: shapely does not guarantee geoms ordering is
    # stable across equal-area parts, so break ties by (area, then the part's
    # own bounds) rather than relying on max()'s first-seen behaviour alone.
    largest = max(parts, key=lambda part: (part.area, part.bounds))

    exterior_coords = np.asarray(
        largest.exterior.coords,
        dtype=np.float64,
    )

    # shapely repeats the first vertex at the end of the ring; drop it so
    # vertex_count reflects the number of distinct polygon corners.
    vertices = exterior_coords[:-1]

    return PolygonalMeasurement(
        method_name=method_name,
        area_source_units_squared=float(sum(part.area for part in parts)),
        perimeter_source_units=float(sum(part.length for part in parts)),
        vertex_count=int(len(vertices)),
        part_count=len(parts),
        vertices=vertices,
    )


def measure_polygon(
    vertices: np.ndarray,
    *,
    method_name: str,
) -> PolygonalMeasurement:
    """Validate and measure a closed polygon from raw (u, z) vertices.

    ``vertices`` may or may not repeat the first point as the last point; both
    forms are accepted. Vertex order (clockwise/counterclockwise) does not
    change the resulting area.
    """

    points = np.asarray(vertices, dtype=np.float64)

    if points.ndim != 2 or points.shape[1] != 2:
        raise ValueError(f"{method_name}: vertices must have shape (N, 2)")

    if not np.isfinite(points).all():
        raise ValueError(f"{method_name}: vertices must contain only finite values")

    if len(points) > 1 and np.array_equal(points[0], points[-1]):
        points = points[:-1]

    if len(points) < 3:
        raise ValueError(f"{method_name}: at least 3 distinct vertices are required")

    polygon = Polygon(points)

    return _measure_shapely_geometry(
        polygon,
        method_name=method_name,
    )


def mask_to_polygon(
    mask: np.ndarray,
    *,
    u_min: float,
    cell_size_u: float,
    z_min: float,
    cell_size_z: float,
    method_name: str,
) -> PolygonalMeasurement:
    """Measure the polygon covered by the True cells of a boolean (row=z, col=u) grid.

    Each True cell contributes an axis-aligned ``cell_size_u`` x
    ``cell_size_z`` square in the (u, z) frame; contiguous runs of True cells
    within a row are merged into one rectangle before unioning, so this scales
    with the number of row-runs rather than the number of occupied cells.

    Total area/perimeter sum every resulting polygon part (see
    ``PolygonalMeasurement.part_count``); interior holes are removed from each
    part, since the gross-face observable is a filled silhouette.
    """

    mask = np.asarray(mask, dtype=bool)

    if mask.ndim != 2:
        raise ValueError(f"{method_name}: mask must be 2D")

    if cell_size_u <= 0 or cell_size_z <= 0:
        raise ValueError(f"{method_name}: cell sizes must be positive")

    if not mask.any():
        raise ValueError(f"{method_name}: mask contains no True cells")

    boxes = []

    for row in range(mask.shape[0]):
        row_mask = mask[row]

        # Run-length encode contiguous True runs within this row.
        padded = np.concatenate(([False], row_mask, [False]))
        edges = np.diff(padded.astype(np.int8))

        run_starts = np.flatnonzero(edges == 1)
        run_ends = np.flatnonzero(edges == -1)

        for start, end in zip(run_starts, run_ends, strict=True):
            z_lo = z_min + row * cell_size_z
            z_hi = z_lo + cell_size_z

            u_lo = u_min + start * cell_size_u
            u_hi = u_min + end * cell_size_u

            boxes.append(shapely.box(u_lo, z_lo, u_hi, z_hi))

    # Unioning many exactly-abutting axis-aligned boxes is a known GEOS edge
    # case: without an explicit snapping precision, floating-point noise at
    # shared row/column edges can fragment a single connected region into a
    # MultiPolygon of many small pieces that still sum to the correct total
    # area. An explicit grid_size far finer than one cell -- but coarser than
    # float noise -- forces exact snapping and avoids that fragmentation.
    grid_size = min(cell_size_u, cell_size_z) * 1e-6

    unioned = shapely.unary_union(boxes, grid_size=grid_size)

    # A raster region can be a single *raster* connected component (commonly
    # 8-connectivity, i.e. corner touches count) without being a single
    # *geometric* polygon: two cells touching only at a corner do not share a
    # union boundary. Rather than reject that case, remove interior holes
    # from every part and let _measure_shapely_geometry sum area/perimeter
    # across parts -- see PolygonalMeasurement.part_count.
    parts = list(unioned.geoms) if unioned.geom_type == "MultiPolygon" else [unioned]

    parts = [Polygon(part.exterior) if part.interiors else part for part in parts]

    polygon = parts[0] if len(parts) == 1 else shapely.geometry.MultiPolygon(parts)

    return _measure_shapely_geometry(
        polygon,
        method_name=method_name,
    )


def boundary_cell_points(
    mask: np.ndarray,
    *,
    u_min: float,
    cell_size_u: float,
    z_min: float,
    cell_size_z: float,
) -> np.ndarray:
    """Return the (u, z) centres of cells on the boundary of a True mask.

    A True cell is a boundary cell when at least one of its 4-connected
    neighbours (including out-of-bounds) is False. This mirrors EXP-007's use
    of boundary evidence (rather than every interior point) as the input to a
    concave-hull estimator.
    """

    mask = np.asarray(mask, dtype=bool)

    if not mask.any():
        raise ValueError("mask contains no True cells")

    padded = np.pad(mask, 1, mode="constant", constant_values=False)

    interior = (
        padded[1:-1, 1:-1]
        & padded[:-2, 1:-1]
        & padded[2:, 1:-1]
        & padded[1:-1, :-2]
        & padded[1:-1, 2:]
    )

    boundary = mask & ~interior

    rows, cols = np.nonzero(boundary)

    u = u_min + (cols.astype(np.float64) + 0.5) * cell_size_u
    z = z_min + (rows.astype(np.float64) + 0.5) * cell_size_z

    return np.column_stack([u, z])


def concave_hull_polygon(
    points: np.ndarray,
    *,
    ratio: float,
    method_name: str,
) -> PolygonalMeasurement:
    """Measure the shapely ``concave_hull`` of a boundary point set.

    ``ratio`` mirrors EXP-007 section 10's hull-tightness parameter: 0.0
    approaches the raw point set (unstable), 1.0 approaches the convex hull.
    EXP-007 found a low-ratio regime (~0.002-0.010) cross-resolution stable
    but still not authoritative -- this function makes no claim about which
    ratio is correct, it only measures the polygon for whichever ratio is
    supplied.
    """

    points = np.asarray(points, dtype=np.float64)

    if points.ndim != 2 or points.shape[1] != 2:
        raise ValueError(f"{method_name}: points must have shape (N, 2)")

    if len(points) < 3:
        raise ValueError(f"{method_name}: at least 3 points are required")

    if not 0.0 <= ratio <= 1.0:
        raise ValueError(f"{method_name}: ratio must be in [0, 1]")

    hull = shapely.concave_hull(
        MultiPoint(points),
        ratio=ratio,
    )

    if not isinstance(hull, Polygon):
        raise ValueError(f"{method_name}: concave_hull did not return a single polygon")

    return _measure_shapely_geometry(
        hull,
        method_name=method_name,
    )
