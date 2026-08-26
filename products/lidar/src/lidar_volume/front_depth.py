"""Reusable front-depth geometry for projected point-cloud faces.

The final timber-face measurement is a 2D projected quantity in ``(u, z)``,
but points must not necessarily be collapsed across transverse depth before
visibility is resolved.

This module therefore preserves the transverse coordinate ``v`` long enough
to build a robust front-depth image:

    (u, v, z) points
            ↓
    robust front-most v per (u, z) cell
            ↓
    local expected front surface
            ↓
    positive depth recession
            ↓
    coherent recessed-region candidates

A recessed region can represent background/rear geometry observed through an
opening in the front-facing surface.

The implementation is sensor-independent. It does not infer a scanner model,
physical units, CRS, product length, or commercial volume semantics.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from scipy import ndimage

FrontSide = Literal["low_v", "high_v"]


_GRID_INDEX_EPSILON = 1e-10


def _stable_grid_indices(
    values: np.ndarray,
    *,
    minimum: float,
    cell_size: float,
    size: int,
) -> np.ndarray:
    """Map coordinates to raster cells robustly at exact boundaries.

    Rigid coordinate transforms can perturb a mathematically exact grid
    coordinate by a few floating-point ULPs. The tolerance is applied after
    normalization by cell size, so it is dimensionless and affects only
    values numerically indistinguishable from a cell boundary.
    """

    scaled = (values - minimum) / cell_size

    indices = np.floor(scaled + _GRID_INDEX_EPSILON).astype(np.int64)

    return np.clip(
        indices,
        0,
        size - 1,
    )


@dataclass(frozen=True)
class FrontDepthImageConfig:
    """Configuration for a front-depth image in source-coordinate units."""

    cell_size_u: float = 0.05
    cell_size_z: float = 0.05

    min_points_per_cell: int = 3

    # Robust order statistic used for the front-most return inside a cell.
    # The geometry is internally normalized so that the front is always
    # represented by lower transverse values.
    front_quantile: float = 0.05

    u_quantile_low: float = 0.01
    u_quantile_high: float = 0.99

    z_quantile_low: float = 0.005
    z_quantile_high: float = 0.995


@dataclass(frozen=True)
class FrontDepthImage:
    """Robust front-most transverse depth on a regular ``(u, z)`` grid.

    ``front_depth_normalized`` is represented in a normalized transverse
    orientation where lower values always mean closer to the selected front
    side:

    - ``front_side="low_v"``: normalized depth equals local ``v``;
    - ``front_side="high_v"``: normalized depth equals ``-v``.

    This lets downstream recession logic remain independent of which sign of
    the transverse axis faces the scanner/road.
    """

    front_side: FrontSide

    cell_size_u: float
    cell_size_z: float

    u_min: float
    u_max: float
    z_min: float
    z_max: float

    raster_rows: int
    raster_cols: int

    projected_point_count: int
    valid_cell_count: int

    point_count: np.ndarray
    valid_mask: np.ndarray
    front_depth_normalized: np.ndarray


@dataclass(frozen=True)
class RecessionDetectionConfig:
    """Configuration for local front-surface recession detection."""

    surface_scale_u: float = 2.0
    surface_scale_z: float = 2.0

    # If provided, this absolute source-unit threshold is used.
    # Otherwise it is derived from ``candidate_percentile``.
    recession_threshold: float | None = None
    candidate_percentile: float = 97.0

    min_candidate_cells: int = 8
    connectivity: int = 8


@dataclass(frozen=True)
class RecessedRegion:
    """One coherent positive-depth anomaly in the front-depth image."""

    label: int
    cell_count: int

    area_source_units_squared: float

    median_recession_source_units: float
    max_recession_source_units: float

    # Recession × projected cell area. This is only a ranking score.
    # It is not a commercial or geometric timber volume.
    recession_score_source_units_cubed: float

    u_min: float
    u_max: float
    z_min: float
    z_max: float

    u_centroid: float
    z_centroid: float


@dataclass(frozen=True)
class FrontRecessionEstimate:
    """Expected front surface, recession field, and coherent candidates."""

    surface_scale_u: float
    surface_scale_z: float

    threshold_source_units: float

    expected_front_depth_normalized: np.ndarray
    recession_source_units: np.ndarray

    candidate_mask: np.ndarray
    candidate_labels: np.ndarray

    regions: tuple[RecessedRegion, ...]


def _validate_front_depth_config(
    config: FrontDepthImageConfig,
) -> None:
    if config.cell_size_u <= 0:
        raise ValueError("cell_size_u must be positive")

    if config.cell_size_z <= 0:
        raise ValueError("cell_size_z must be positive")

    if config.min_points_per_cell < 1:
        raise ValueError("min_points_per_cell must be >= 1")

    if not 0.0 <= config.front_quantile <= 1.0:
        raise ValueError("front_quantile must be in [0, 1]")

    if not (0.0 <= config.u_quantile_low < config.u_quantile_high <= 1.0):
        raise ValueError("u quantiles must satisfy 0 <= low < high <= 1")

    if not (0.0 <= config.z_quantile_low < config.z_quantile_high <= 1.0):
        raise ValueError("z quantiles must satisfy 0 <= low < high <= 1")


def _validate_recession_config(
    config: RecessionDetectionConfig,
) -> None:
    if config.surface_scale_u <= 0:
        raise ValueError("surface_scale_u must be positive")

    if config.surface_scale_z <= 0:
        raise ValueError("surface_scale_z must be positive")

    if config.recession_threshold is not None and config.recession_threshold < 0:
        raise ValueError("recession_threshold must be non-negative")

    if not 0.0 <= config.candidate_percentile <= 100.0:
        raise ValueError("candidate_percentile must be in [0, 100]")

    if config.min_candidate_cells < 1:
        raise ValueError("min_candidate_cells must be >= 1")

    if config.connectivity not in (4, 8):
        raise ValueError("connectivity must be 4 or 8")


def _normalize_face_frame(
    center_xy: np.ndarray,
    longitudinal_axis: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    center_xy = np.asarray(
        center_xy,
        dtype=np.float64,
    ).reshape(2)

    longitudinal_axis = np.asarray(
        longitudinal_axis,
        dtype=np.float64,
    ).reshape(2)

    if not np.isfinite(center_xy).all():
        raise ValueError("center_xy must contain only finite values")

    axis_norm = float(np.linalg.norm(longitudinal_axis))

    if not np.isfinite(axis_norm) or axis_norm <= 0:
        raise ValueError("longitudinal_axis must be a non-zero finite vector")

    longitudinal_axis = longitudinal_axis / axis_norm

    transverse_axis = np.array(
        [
            -longitudinal_axis[1],
            longitudinal_axis[0],
        ],
        dtype=np.float64,
    )

    return (
        center_xy,
        longitudinal_axis,
        transverse_axis,
    )


def estimate_front_depth_image(
    xyz: np.ndarray,
    center_xy: np.ndarray,
    longitudinal_axis: np.ndarray,
    *,
    front_side: FrontSide,
    config: FrontDepthImageConfig | None = None,
) -> FrontDepthImage:
    """Build a robust front-most transverse-depth image.

    Parameters
    ----------
    xyz:
        Already localized candidate-face points with shape ``(N, 3)``.
    center_xy:
        Horizontal origin of the supplied face frame.
    longitudinal_axis:
        Horizontal direction along the face. It need not be unit-normalized.
    front_side:
        Which transverse sign corresponds to the visible/front side.

        This is intentionally explicit. Sensor trajectory/acquisition geometry
        belongs in an upstream layer and should eventually resolve this value.
    config:
        Source-unit/grid parameters.

    Returns
    -------
    FrontDepthImage
        A regular ``(u, z)`` grid whose valid cells contain a robust front-most
        transverse depth.
    """

    if front_side not in ("low_v", "high_v"):
        raise ValueError("front_side must be 'low_v' or 'high_v'")

    if config is None:
        config = FrontDepthImageConfig()

    _validate_front_depth_config(config)

    xyz = np.asarray(
        xyz,
        dtype=np.float64,
    )

    if xyz.ndim != 2 or xyz.shape[1] != 3:
        raise ValueError("xyz must have shape (N, 3)")

    if len(xyz) < 3:
        raise ValueError("xyz must contain at least 3 points")

    if not np.isfinite(xyz).all():
        raise ValueError("xyz must contain only finite values")

    (
        center_xy,
        longitudinal_axis,
        transverse_axis,
    ) = _normalize_face_frame(
        center_xy,
        longitudinal_axis,
    )

    centered_xy = xyz[:, :2] - center_xy

    u = centered_xy @ longitudinal_axis

    v = centered_xy @ transverse_axis

    z = xyz[:, 2]

    # Normalize orientation so that "front" is always the lower-depth side.
    normalized_v = v if front_side == "low_v" else -v

    u_min, u_max = np.quantile(
        u,
        [
            config.u_quantile_low,
            config.u_quantile_high,
        ],
    )

    z_min, z_max = np.quantile(
        z,
        [
            config.z_quantile_low,
            config.z_quantile_high,
        ],
    )

    if (
        not np.isfinite(
            [
                u_min,
                u_max,
                z_min,
                z_max,
            ]
        ).all()
        or u_max <= u_min
        or z_max <= z_min
    ):
        raise ValueError("projected face bounds are degenerate")

    retained = (u >= u_min) & (u <= u_max) & (z >= z_min) & (z <= z_max)

    u_work = u[retained]
    v_work = normalized_v[retained]
    z_work = z[retained]

    if len(u_work) < 3:
        raise ValueError("too few points remain after quantile trimming")

    raster_cols = max(
        1,
        int(np.ceil((u_max - u_min) / config.cell_size_u)),
    )

    raster_rows = max(
        1,
        int(np.ceil((z_max - z_min) / config.cell_size_z)),
    )

    grid_u_max = float(u_min) + raster_cols * config.cell_size_u

    grid_z_max = float(z_min) + raster_rows * config.cell_size_z

    col_idx = _stable_grid_indices(
        u_work,
        minimum=float(u_min),
        cell_size=config.cell_size_u,
        size=raster_cols,
    )

    row_idx = _stable_grid_indices(
        z_work,
        minimum=float(z_min),
        cell_size=config.cell_size_z,
        size=raster_rows,
    )

    cell_id = row_idx * raster_cols + col_idx

    # Sort first by cell, then by normalized transverse depth.
    # The selected order statistic therefore gives a deterministic robust
    # front-most value without Python loops over every point.
    order = np.lexsort(
        (
            v_work,
            cell_id,
        )
    )

    sorted_cells = cell_id[order]

    sorted_v = v_work[order]

    (
        unique_cells,
        starts,
        counts,
    ) = np.unique(
        sorted_cells,
        return_index=True,
        return_counts=True,
    )

    enough = counts >= config.min_points_per_cell

    valid_cells = unique_cells[enough]

    valid_starts = starts[enough]

    valid_counts = counts[enough]

    quantile_rank = np.floor(config.front_quantile * (valid_counts - 1)).astype(np.int64)

    sample_indices = valid_starts + quantile_rank

    front_values = sorted_v[sample_indices]

    flat_size = raster_rows * raster_cols

    point_count_flat = np.zeros(
        flat_size,
        dtype=np.int64,
    )

    point_count_flat[unique_cells] = counts

    front_depth_flat = np.full(
        flat_size,
        np.nan,
        dtype=np.float64,
    )

    front_depth_flat[valid_cells] = front_values

    point_count = point_count_flat.reshape(
        raster_rows,
        raster_cols,
    )

    front_depth = front_depth_flat.reshape(
        raster_rows,
        raster_cols,
    )

    valid_mask = np.isfinite(front_depth)

    return FrontDepthImage(
        front_side=front_side,
        cell_size_u=config.cell_size_u,
        cell_size_z=config.cell_size_z,
        u_min=float(u_min),
        u_max=grid_u_max,
        z_min=float(z_min),
        z_max=grid_z_max,
        raster_rows=raster_rows,
        raster_cols=raster_cols,
        projected_point_count=int(len(u_work)),
        valid_cell_count=int(valid_mask.sum()),
        point_count=point_count,
        valid_mask=valid_mask,
        front_depth_normalized=front_depth,
    )


def _odd_kernel_size(
    scale: float,
    cell_size: float,
) -> int:
    size = max(
        3,
        int(round(scale / cell_size)),
    )

    if size % 2 == 0:
        size += 1

    return size


def _connectivity_structure(
    connectivity: int,
) -> np.ndarray:
    if connectivity == 4:
        return np.array(
            [
                [0, 1, 0],
                [1, 1, 1],
                [0, 1, 0],
            ],
            dtype=np.int8,
        )

    return np.ones(
        (3, 3),
        dtype=np.int8,
    )


def detect_recessed_regions(
    image: FrontDepthImage,
    config: RecessionDetectionConfig | None = None,
) -> FrontRecessionEstimate:
    """Detect coherent regions recessed behind the nearby front surface.

    The normalized front-depth image is filled only for estimating the local
    expected surface. Candidate regions are always restricted to cells that
    actually contain observed front-depth evidence.

    A grayscale morphological opening removes coherent positive-depth bumps
    smaller than the configured support scale. The remaining positive
    difference is interpreted as depth recession.
    """

    if config is None:
        config = RecessionDetectionConfig()

    _validate_recession_config(config)

    valid = image.valid_mask

    if not valid.any():
        raise ValueError("front-depth image contains no valid cells")

    front_depth = image.front_depth_normalized

    nearest_indices = ndimage.distance_transform_edt(
        ~valid,
        return_distances=False,
        return_indices=True,
    )

    filled_front_depth = front_depth[tuple(nearest_indices)]

    kernel_rows = _odd_kernel_size(
        config.surface_scale_z,
        image.cell_size_z,
    )

    kernel_cols = _odd_kernel_size(
        config.surface_scale_u,
        image.cell_size_u,
    )

    expected_front = ndimage.grey_opening(
        filled_front_depth,
        size=(
            kernel_rows,
            kernel_cols,
        ),
        mode="nearest",
    )

    recession = np.full_like(
        front_depth,
        np.nan,
        dtype=np.float64,
    )

    recession[valid] = np.maximum(
        front_depth[valid] - expected_front[valid],
        0.0,
    )

    valid_recession = recession[valid]

    if config.recession_threshold is None:
        threshold = float(
            np.percentile(
                valid_recession,
                config.candidate_percentile,
            )
        )
    else:
        threshold = float(config.recession_threshold)

    # A completely flat front has zero recession everywhere. Avoid turning
    # every valid cell into a candidate simply because the percentile is zero.
    if threshold <= np.finfo(np.float64).eps:
        candidate_mask = np.zeros_like(
            valid,
            dtype=bool,
        )
    else:
        candidate_mask = valid & (recession >= threshold)

    labels, component_count = ndimage.label(
        candidate_mask,
        structure=_connectivity_structure(config.connectivity),
    )

    regions: list[RecessedRegion] = []

    for label_id in range(
        1,
        component_count + 1,
    ):
        component = labels == label_id

        cell_count = int(component.sum())

        if cell_count < config.min_candidate_cells:
            continue

        rows, cols = np.nonzero(component)

        values = recession[component]

        area = cell_count * image.cell_size_u * image.cell_size_z

        score = float(values.sum() * image.cell_size_u * image.cell_size_z)

        u_min = image.u_min + cols.min() * image.cell_size_u

        u_max = image.u_min + (cols.max() + 1) * image.cell_size_u

        z_min = image.z_min + rows.min() * image.cell_size_z

        z_max = image.z_min + (rows.max() + 1) * image.cell_size_z

        u_centroid = float(
            np.mean(image.u_min + (cols.astype(np.float64) + 0.5) * image.cell_size_u)
        )

        z_centroid = float(
            np.mean(image.z_min + (rows.astype(np.float64) + 0.5) * image.cell_size_z)
        )

        regions.append(
            RecessedRegion(
                label=label_id,
                cell_count=cell_count,
                area_source_units_squared=float(area),
                median_recession_source_units=float(np.median(values)),
                max_recession_source_units=float(np.max(values)),
                recession_score_source_units_cubed=score,
                u_min=float(u_min),
                u_max=float(u_max),
                z_min=float(z_min),
                z_max=float(z_max),
                u_centroid=u_centroid,
                z_centroid=z_centroid,
            )
        )

    regions.sort(
        key=lambda region: region.recession_score_source_units_cubed,
        reverse=True,
    )

    retained_labels = {region.label for region in regions}

    if retained_labels:
        final_candidate_mask = np.isin(
            labels,
            list(retained_labels),
        )
    else:
        final_candidate_mask = np.zeros_like(candidate_mask)

    final_labels = np.where(
        final_candidate_mask,
        labels,
        0,
    )

    return FrontRecessionEstimate(
        surface_scale_u=config.surface_scale_u,
        surface_scale_z=config.surface_scale_z,
        threshold_source_units=threshold,
        expected_front_depth_normalized=expected_front,
        recession_source_units=recession,
        candidate_mask=final_candidate_mask,
        candidate_labels=final_labels,
        regions=tuple(regions),
    )
