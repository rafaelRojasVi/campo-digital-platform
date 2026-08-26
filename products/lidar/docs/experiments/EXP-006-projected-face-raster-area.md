# EXP-006 — Projected gross face-area raster kernel and scanline comparison


> **Later refinement:** Real GS100G cavity diagnostics showed that transverse
> depth cannot always be discarded before visibility classification. Rear or
> background returns visible through a front-face opening can occupy the same
> projected `(u,z)` cells. The final area remains a 2D projected quantity, but
> the current architecture preserves local `(u,v,z)` information through a
> front-depth/recession stage before final face-region interpretation. See
> EXP-007, section 18.

## Status

Completed (kernel + synthetic tests + pipeline integration + initial real-data sensitivity sweep). Not yet validated against a client reference measurement.

## Question

Can the visible timber-stack face be measured as a GROSS PROJECTED EXTERNAL SILHOUETTE — an orthographic `(u, z)` raster projection, density-aware occupancy, connected-component noise rejection, and internal-hole filling — reproducibly, on the already-isolated pile, using the same local face frame as the existing scanline front-cross-section estimator? And how does the resulting area compare to that independent scanline estimator on the same input?

## Hypothesis

If the visible timber wall is sufficiently coherent, a raster/silhouette method sharing the scanline estimator's face frame should recover an area broadly consistent with the scanline rectangle area, with disagreement dominated by raster cell-size discretization (staircasing of the sloped/irregular boundary) rather than by a different physical definition of "front face."

## Input

Frozen manual-reference isolated region (already ignored client data, not committed):

```text
data/interim/v01_MG_23jun2026/timber_roi/
timber_stack_manual_reference_v1.las

1,577,128 points
```

This is a different, larger manually-curated file than the `timber_stack_automatic_v1.las` (1,342,183 points) used in EXP-005 — it is not directly comparable to EXP-005's baseline area. The point cloud remains in source-coordinate units; physical linear units are still unconfirmed.

This experiment operates only on this already-isolated pile. It does not touch full-scene automatic localization (`detect_timber_stack`), which is known (per the initiating engineering brief) to currently fail semantically on the full scene.

## Method

### 1. Shared face frame

The raster kernel does not re-derive its own PCA orientation. It consumes `center_xy` and `longitudinal_axis` directly from `estimate_front_cross_section`'s output on the same input points, so both estimators share one deterministic longitudinal/center frame. Any measured disagreement between the two estimators is therefore an AREA-METHOD disagreement, not a coordinate-frame disagreement.

### 2. Orthographic `(u, z)` projection

`u` is computed as a 1D dot-product projection of the horizontal position onto the (unit-normalized) longitudinal axis; `z` is the raw vertical coordinate. The transverse/depth coordinate is never computed — it is mathematically absent from this projection, so a point that only protrudes toward/away from the scanner cannot change the projected area. This was verified directly with a synthetic invariance test (Task 1, `test_pure_transverse_depth_protrusion_does_not_change_area`).

### 3. Density-aware raster and silhouette recovery

For a configured `(cell_size_u, cell_size_z)`:

1. bin `(u, z)` into a 2D grid and mark a cell "occupied" when its point count meets `min_points_per_cell`;
2. label 4- or 8-connected components and drop any smaller than `min_component_cells` (noise rejection);
3. optionally apply `binary_closing` for `closing_iterations` iterations (small gap bridging);
4. keep only the single largest remaining connected component (the principal pile face);
5. fill fully-enclosed internal holes (`binary_fill_holes`) — internal log-to-log gaps are filled because this is a GROSS face-area definition; holes/gaps touching the raster border (e.g. a sloped bottom or irregular top boundary) are not filled, because they are not enclosed;
6. report `filled_cell_count * cell_size_u * cell_size_z` as the area.

This is explicitly not raw 3D surface area, not a convex-hull area, not width×max-height, not per-log-circle summation, not solid-wood area, and not commercial cubicación.

### 4. Synthetic validation (before touching real data)

17 synthetic NumPy-only tests in `products/lidar/tests/test_projected_face_raster.py` cover: an exact rectangular wall; a sloped bottom boundary; an irregular step top boundary; transverse/depth-protrusion invariance; sparse isolated outliers; internal holes; a second, non-noise but smaller disconnected component; deterministic output; and 8 invalid-configuration cases plus malformed input shape. All pass.

One synthetic-geometry artifact was found and fixed during this work (not a defect in the shipped kernel): when a test's rectangular point grid had its exact right/top edge land precisely on a multiple of `cell_size`, and a separate far-away point cluster was also present in the same call, the wall's own boundary-edge samples could be binned into a newly-created extra column/row rather than being absorbed into the wall's own last column/row — because the total raster extent (used only to `clip` the very last global column) grew once the far-away cluster was included. This is a floating-point boundary-coincidence artifact of constructing perfectly grid-aligned synthetic test geometry; real (non-exact) point coordinates do not hit it. The two affected tests were changed to use a wall span that is not an exact multiple of the cell size, which removes the ambiguity without weakening what the tests verify.

### 5. Pipeline integration

`run_timber_measurement` now also calls `estimate_projected_face_raster` with the shared face frame and a new, independently-configurable `projected_face_raster_config`. Both estimators are persisted side by side on `MeasurementRun` (`front_cross_section` and `projected_face_raster`); neither replaces the other, and the raster result does not participate in `results`/volume computation. Two new artifacts are written per run: `projected_face_raster.json` (scalar diagnostics only — no raw masks) and `projected_face_raster.png` (occupancy evidence, filled silhouette contour, and the scanline base/top envelopes overlaid on the same `(u, z)` frame for visual QC). A disagreement diagnostic is computed and stored on the summary:

```text
abs(A_raster - A_scanline) / (0.5 * (A_raster + A_scanline))
```

No pass/fail threshold is attached to this diagnostic.

### 6. Real-data sensitivity sweep (experimental)

An uncommitted, one-off script (`raster_sensitivity_sweep.py`, run from the scratchpad — not part of the repository) ran the raster kernel against the frozen manual-reference file at five SOURCE-UNIT cell sizes, using the library-default raster configuration otherwise (`min_points_per_cell=1`, `connectivity=8`, `min_component_cells=4`, `closing_iterations=0`, no quantile trimming), and compared each against the scanline rectangle area computed once on the same input with default `FrontCrossSectionConfig()`.

Reproduction command (from the repository root, after re-creating the script from this document if needed):

```bash
uv run python <scratch>/raster_sensitivity_sweep.py
```

## Result

FACT:

The scanline estimator, run once on `timber_stack_manual_reference_v1.las` with default configuration, produced:

```text
scanline rectangle area: 255.288370 source-units²
scanline trapezoid area: 254.199721 source-units²
```

FACT:

The raster sensitivity sweep produced:

```text
 cell_size |    raster_area |  scanline_area |  disagreement_% |    filled |  occupied |  runtime_s
     0.020 |        274.084 |        255.288 |           7.10% |    685209 |    549094 |      0.176
     0.050 |        284.250 |        255.288 |          10.74% |    113700 |    112364 |      0.062
     0.075 |        288.332 |        255.288 |          12.16% |     51259 |     51127 |      0.061
     0.100 |        290.920 |        255.288 |          13.05% |     29092 |     29068 |      0.055
     0.150 |        297.427 |        255.288 |          15.25% |     13219 |     13216 |      0.066
```

(`filled` and `occupied` are `filled_cell_count`/`raw_occupied_cell_count`; runtime is single-run wall-clock for the raster kernel call only, on this developer machine — not a formal benchmark.)

FACT:

At every tested cell size, the raster area is larger than the scanline rectangle area, and disagreement grows monotonically with cell size (7.10% at 0.02 up to 15.25% at 0.15).

FACT:

Raster runtime stayed under 0.2 s across the full 1,577,128-point input at every tested cell size — well within the existing candidate-ROI path's 0.56–0.78 s budget referenced in the initiating engineering brief.

## Interpretation

INFERENCE:

The monotonic growth of raster area with cell size is consistent with coarse-cell staircasing: a partially-covered boundary cell along the sloped/irregular envelope is still counted as fully occupied, so coarser cells systematically overstate the silhouette relative to a finer raster or the scanline's own quantile-trimmed envelope interpolation.

INFERENCE:

The visual QA overlay (`projected_face_raster.png`, saved during the sweep) shows the raster's filled-silhouette contour tracking the scanline's base/top envelopes closely along nearly the whole longitudinal extent, which supports the hypothesis that both estimators are measuring the same physical face, with the observed 7–15% gap attributable to method/discretization differences rather than a different definition of "front face."

LIMITATION:

The scanline estimator's `rectangle_area`/`trapezoid_area` already discard the outer 1%/2% of points via its own quantile trimming; the raster kernel in this sweep used no quantile trimming (`u_quantile_low/high`, `z_quantile_low/high` at defaults 0.0/1.0). Part of the observed disagreement may therefore reflect this configuration difference rather than a purely intrinsic method difference — this was not isolated in the current sweep.

LIMITATION:

This is extraction/method sensitivity on one already-isolated pile, not a validated accuracy figure. It excludes sensor uncertainty, registration/reconstruction uncertainty, upstream segmentation error, physical depth, and coordinate-unit uncertainty.

LIMITATION:

Coordinate units remain unconfirmed. No value in this document is metres or square metres.

NOT YET ESTABLISHED:

- whether the raster or scanline estimator is closer to Javier's manually-drawn reference face;
- whether restricting the raster's quantile bounds (matching the scanline's own trimming) would materially close the observed gap;
- the effect of `min_component_cells`, `closing_iterations`, and non-default `connectivity` on this real input (not swept here);
- physical units, and therefore any m² interpretation of any number in this document.

## Decision

Both `front_cross_section` (scanline) and `projected_face_raster` (raster) now coexist as independent, non-authoritative estimators on every `MeasurementRun`. Neither is promoted to the authoritative face-area result. `results`/volume computation continues to use only the scanline rectangle area, unchanged.

Do not tune raster configuration to chase the ~254.20 source-units² manual-isolation figure quoted in the initiating engineering brief — that number is not ground truth, and matching it is not a validation criterion.

## Limitations

See LIMITATION items above. In addition: this experiment did not sweep `min_component_cells`, `closing_iterations`, `connectivity`, or quantile-trim configuration on real data — only `cell_size_u`/`cell_size_z`, per the initiating scope for this slice.

## Next step

1. Obtain Javier's manually-drawn reference face-area measurement for the same pile/ROI.
2. Only then compare both estimators against that reference, without changing either estimator's definition after seeing the answer.
3. If warranted, run a follow-up sweep isolating the effect of raster quantile trimming (to match the scanline's own trimming) versus cell size, to separate those two contributions to the observed disagreement.
4. Confirm CRS and physical linear units before any m² claim.

<!-- DOC_NAV_START -->

---

### Documentation navigation

[LiDAR README](../../README.md) · [Docs index](../README.md) · [Findings](../findings/cubicacion_accuracy_problem.md) · [Experiments](.) · [Decisions](../decisions) · [Spanish docs](../es/README.md) · [Estado técnico](../es/estado-proyecto.md) · [Preguntas Campo Digital](../es/preguntas-campo-digital.md)

<!-- DOC_NAV_END -->
