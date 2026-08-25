"""Experimental projected timber-stack face raster kernel.

This module computes a candidate projected face region for an already-isolated
timber-stack pile, expressed only in source-coordinate units squared.

The current V1 fills enclosed raster holes as a provisional gross-face
assumption. That behavior is diagnostic rather than authoritative: real pile
voids may need to remain excluded from the measured face region.

The result is an orthographic projection onto a local
``(u, z)`` face plane, where ``u`` is the longitudinal station along the
stack and ``z`` is the vertical coordinate.

The transverse/depth coordinate is never computed: ``u`` is a 1D dot-product
projection of the horizontal position onto the (already unit-normalized)
longitudinal axis, which is mathematically blind to any component
orthogonal to that axis. A log tip that only protrudes toward/away from the
scanner therefore cannot change the projected area -- this is a structural
property of the projection, not a behavior that has to be separately
enforced.

This is explicitly NOT raw 3D surface area, NOT a convex-hull area, NOT
width x max height, NOT per-log-circle summation, NOT solid-wood area, and
NOT commercial cubicacion. No CRS or physical unit is inferred here.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage


@dataclass(frozen=True)
class ProjectedFaceRasterConfig:
    """Configuration for the projected face-area raster kernel.

    Every parameter is a dimensionless/source-unit value. None of them
    implies metres, centimetres, or any other physical interpretation.
    """

    cell_size_u: float = 0.05
    cell_size_z: float = 0.05

    min_points_per_cell: int = 1

    connectivity: int = 8

    min_component_cells: int = 4

    closing_iterations: int = 0

    u_quantile_low: float = 0.0
    u_quantile_high: float = 1.0

    z_quantile_low: float = 0.0
    z_quantile_high: float = 1.0


@dataclass(frozen=True)
class ProjectedFaceRasterEstimate:
    """Result of the projected gross face-area raster kernel.

    ``occupancy_mask``/``component_mask``/``filled_mask`` are diagnostic
    evidence for artifacts and parameter-sensitivity analysis. They are not
    meant to be embedded in the persisted Pydantic measurement schema.
    """

    area_source_units_squared: float

    cell_size_u: float
    cell_size_z: float

    raster_rows: int
    raster_cols: int

    u_min: float
    u_max: float
    z_min: float
    z_max: float

    projected_point_count: int

    raw_occupied_cell_count: int
    denoised_occupied_cell_count: int
    retained_component_cell_count: int
    filled_cell_count: int
    component_count: int

    occupancy_mask: np.ndarray
    component_mask: np.ndarray
    filled_mask: np.ndarray


def _validate_config(config: ProjectedFaceRasterConfig) -> None:
    if config.cell_size_u <= 0:
        raise ValueError("cell_size_u must be > 0")

    if config.cell_size_z <= 0:
        raise ValueError("cell_size_z must be > 0")

    if config.min_points_per_cell < 1:
        raise ValueError("min_points_per_cell must be >= 1")

    if config.connectivity not in (4, 8):
        raise ValueError("connectivity must be 4 or 8")

    if config.min_component_cells < 1:
        raise ValueError("min_component_cells must be >= 1")

    if config.closing_iterations < 0:
        raise ValueError("closing_iterations must be >= 0")

    if not (0.0 <= config.u_quantile_low < config.u_quantile_high <= 1.0):
        raise ValueError("invalid u quantile interval")

    if not (0.0 <= config.z_quantile_low < config.z_quantile_high <= 1.0):
        raise ValueError("invalid z quantile interval")


def _connectivity_structure(connectivity: int) -> np.ndarray:
    if connectivity == 8:
        return np.ones((3, 3), dtype=np.int8)

    return ndimage.generate_binary_structure(2, 1)


def _largest_component_mask(
    mask: np.ndarray,
    structure: np.ndarray,
) -> tuple[np.ndarray, int]:
    labels, component_count = ndimage.label(mask, structure=structure)

    if component_count == 0:
        return np.zeros_like(mask), 0

    sizes = ndimage.sum(
        mask,
        labels,
        index=np.arange(1, component_count + 1),
    )

    principal_label = int(np.argmax(sizes)) + 1

    return labels == principal_label, component_count


def estimate_projected_face_raster(
    xyz: np.ndarray,
    center_xy: np.ndarray,
    longitudinal_axis: np.ndarray,
    config: ProjectedFaceRasterConfig | None = None,
) -> ProjectedFaceRasterEstimate:
    """Estimate the gross projected external silhouette area of a face.

    ``center_xy``/``longitudinal_axis`` are consumed from an already
    computed face frame (for example
    ``FrontCrossSectionEstimate.center_xy``/``longitudinal_axis``) so this
    kernel never re-derives its own, subtly different, orientation.
    """

    if config is None:
        config = ProjectedFaceRasterConfig()

    _validate_config(config)

    xyz = np.asarray(xyz, dtype=np.float64)

    if xyz.ndim != 2 or xyz.shape[1] != 3:
        raise ValueError("xyz must have shape (N, 3)")

    if len(xyz) < 3:
        raise ValueError("xyz must contain at least 3 points")

    if not np.isfinite(xyz).all():
        raise ValueError("xyz must contain only finite values")

    center_xy = np.asarray(center_xy, dtype=np.float64).reshape(2)
    longitudinal_axis = np.asarray(longitudinal_axis, dtype=np.float64).reshape(2)

    axis_norm = np.linalg.norm(longitudinal_axis)

    if not np.isfinite(axis_norm) or axis_norm <= 0:
        raise ValueError("longitudinal_axis must be a non-zero finite vector")

    longitudinal_axis = longitudinal_axis / axis_norm

    xy_centered = xyz[:, :2] - center_xy

    u = xy_centered @ longitudinal_axis
    z = xyz[:, 2]

    u_min, u_max = np.quantile(
        u,
        [config.u_quantile_low, config.u_quantile_high],
    )
    z_min, z_max = np.quantile(
        z,
        [config.z_quantile_low, config.z_quantile_high],
    )

    if u_max <= u_min:
        raise ValueError("u span must be positive")

    if z_max <= z_min:
        raise ValueError("z span must be positive")

    keep = (u >= u_min) & (u <= u_max) & (z >= z_min) & (z <= z_max)

    u_kept = u[keep]
    z_kept = z[keep]

    projected_point_count = int(keep.sum())

    cols = max(1, int(np.ceil((u_max - u_min) / config.cell_size_u)))
    rows = max(1, int(np.ceil((z_max - z_min) / config.cell_size_z)))

    col_idx = np.clip(
        ((u_kept - u_min) / config.cell_size_u).astype(np.int64),
        0,
        cols - 1,
    )
    row_idx = np.clip(
        ((z_kept - z_min) / config.cell_size_z).astype(np.int64),
        0,
        rows - 1,
    )

    counts = np.zeros((rows, cols), dtype=np.int64)
    np.add.at(counts, (row_idx, col_idx), 1)

    occupancy_mask = counts >= config.min_points_per_cell
    raw_occupied_cell_count = int(occupancy_mask.sum())

    if raw_occupied_cell_count == 0:
        raise ValueError("no raster cells meet the min_points_per_cell evidence threshold")

    structure = _connectivity_structure(config.connectivity)

    labels, raw_component_count = ndimage.label(occupancy_mask, structure=structure)

    denoised_mask = np.zeros_like(occupancy_mask)

    if raw_component_count > 0:
        sizes = ndimage.sum(
            occupancy_mask,
            labels,
            index=np.arange(1, raw_component_count + 1),
        )

        for label_index, size in enumerate(sizes, start=1):
            if size >= config.min_component_cells:
                denoised_mask |= labels == label_index

    denoised_occupied_cell_count = int(denoised_mask.sum())

    if denoised_occupied_cell_count == 0:
        raise RuntimeError(
            "no connected component satisfies min_component_cells after noise rejection"
        )

    if config.closing_iterations > 0:
        closed_mask = ndimage.binary_closing(
            denoised_mask,
            structure=structure,
            iterations=config.closing_iterations,
        )
    else:
        closed_mask = denoised_mask

    component_mask, component_count = _largest_component_mask(closed_mask, structure)

    retained_component_cell_count = int(component_mask.sum())

    filled_mask = ndimage.binary_fill_holes(component_mask)
    filled_cell_count = int(filled_mask.sum())

    area = float(filled_cell_count) * config.cell_size_u * config.cell_size_z

    return ProjectedFaceRasterEstimate(
        area_source_units_squared=area,
        cell_size_u=config.cell_size_u,
        cell_size_z=config.cell_size_z,
        raster_rows=rows,
        raster_cols=cols,
        u_min=float(u_min),
        u_max=float(u_max),
        z_min=float(z_min),
        z_max=float(z_max),
        projected_point_count=projected_point_count,
        raw_occupied_cell_count=raw_occupied_cell_count,
        denoised_occupied_cell_count=denoised_occupied_cell_count,
        retained_component_cell_count=retained_component_cell_count,
        filled_cell_count=filled_cell_count,
        component_count=component_count,
        occupancy_mask=occupancy_mask,
        component_mask=component_mask,
        filled_mask=filled_mask,
    )
