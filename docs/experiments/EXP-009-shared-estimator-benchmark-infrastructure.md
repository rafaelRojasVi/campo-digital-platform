# EXP-009 — Shared face-estimator benchmark infrastructure

**Date:** 2026-08-26 (extended same day with a config-reproducibility and concave-hull forensic pass)
**Status:** Completed (infrastructure + local real-data reproducibility check, including a full EXP-007 sensitivity-sweep reproduction and a resolved concave-hull discrepancy). Not reference-validated.
**Dataset:** Frozen manually isolated GS100G roadside timber-stack candidate (same file as EXP-008: `data/interim/v01_MG_23jun2026/timber_roi/timber_stack_manual_reference_v1.las`, local/gitignored, never committed)
**Primary question:** Does the shared experiment architecture defined in ADR-004 (common projected evidence, mask/contour estimator interfaces, one polygon-measurement path, the existing reference-comparison gate) reproduce the geometry-tournament evidence already established in EXP-006/EXP-007/EXP-008 exactly, without duplicating localization/framing/projection logic per estimator?

---

## 1. Objective

`docs/roadmap.md` Phase 1 and `docs/decisions/ADR-004-hybrid-measurement-experiment-architecture.md` require a shared benchmark architecture before any new geometry, 2D, or 3D estimator is added, so that future comparisons are apples-to-apples rather than each method computing its own evidence and its own area formula.

This experiment is the first real-data run of that new infrastructure (`src/lidar_volume/face_boundary.py`, `face_estimators.py`, `face_estimator_benchmark.py`, `src/lidar_io/face_estimator_benchmark_pipeline.py`, and the `lidar benchmark-face-estimators` CLI command). Its purpose is narrow: confirm the new code reproduces already-published EXP-006/007/008 numbers on the same frozen pile, and record what it revealed along the way.

It does **not** attempt to answer which geometry method is correct, and it does **not** implement or reproduce EXP-007's marching-squares or density-supported-envelope candidates (see `HISTORICAL_METHODS` in `face_estimator_benchmark.py` and the Limitations section below).

---

## 2. Hypothesis

Because the new estimators wrap the *same* existing, already-tested functions (`estimate_front_cross_section`, `estimate_projected_face_raster`) rather than re-deriving evidence, the scanline and raster outcomes from the new benchmark should match the historical EXP-008 figures for this exact pile to floating-point precision. The concave-hull estimator is new code (EXP-007's own concave-hull usage was one-off analysis code, never committed) and was not expected to reproduce EXP-007's specific numbers exactly, only to be qualitatively consistent with EXP-007's conclusions (ratio-sensitive, not authoritative).

---

## 3. Input

- Dataset: the same frozen, manually isolated pile used by EXP-008 (1,577,128 points, prelocalized).
- Never copied into the repository, tests, or committed artifacts.

## 4. Method

Reproducibility command (local only; the input path is private/gitignored):

```bash
uv run lidar benchmark-face-estimators \
  data/interim/v01_MG_23jun2026/timber_roi/timber_stack_manual_reference_v1.las \
  --output-root <local-output-dir> \
  --run-id exp009-local-check \
  --input-already-isolated
```

Default estimator registry (`docs/roadmap.md` Phase 1 candidates G00, G01, G04):

- `scanline_envelope` -- wraps `FrontCrossSectionEstimate`'s existing base/top envelope directly into a polygon (no mask stage).
- `raster_filled` -- wraps the existing `ProjectedFaceRasterEstimate.filled_mask` through the new generic `mask_to_polygon` utility.
- `concave_hull` -- new: `shapely.concave_hull()` over the raster's filled-mask boundary cell centres, ratio=0.01 (EXP-007's low-ratio stability regime; not claimed authoritative).

All three estimators consume one shared `ProjectedFaceEvidence` bundle, built once from the same local `(u, v, z)` face frame.

---

## 5. Results

| Method | Area (source-units²) | Perimeter | Vertices | Parts | Runtime (ms) |
|---|---:|---:|---:|---:|---:|
| `scanline_envelope` | 254.1997206474807 | 145.266295 | 320 | 1 | 0.238 |
| `raster_filled` | 284.2500000000008 | 255.900000 | 3014 | 24 | 85.366 |
| `concave_hull` (ratio=0.01) | 288.5687499999995 | 162.445943 | 820 | 1 | 6.743 |

Shared evidence (also reproduced exactly from EXP-008):

```text
point_count_input / selected     1,577,128 / 1,577,128
longitudinal_span                68.93552213731837 source units
```

Pairwise disagreement (symmetric relative difference, not error):

```text
raster_filled     vs scanline_envelope   11.162%
concave_hull      vs scanline_envelope   12.664%
concave_hull      vs raster_filled        1.508%
```

**FACT:** `scanline_envelope`'s area (254.1997206474807) matches EXP-008's published scanline baseline (254.19972064748094) to displayed precision -- the shared-evidence architecture introduces no numerical drift for this estimator.

**FACT:** `raster_filled`'s area (284.250000) and its disagreement against scanline (11.162%) match EXP-008's published raster figures (284.25, 11.162%) exactly.

**FACT:** the shared evidence itself (selected point count, longitudinal span) matches EXP-008's published values exactly.

**RESULT (new, not previously published):** on this real pile, `raster_filled`'s filled mask is **not** one simple connected polygon -- converting it into a closed boundary via box-union produced 24 disjoint polygon parts. See section 6.

**RESULT (initial, superseded -- see section 6b):** `concave_hull` at ratio=0.01 with the benchmark's *default, untrimmed* raster evidence gives 288.57 source-units², larger than the raster's own gross area (284.25) and outside EXP-007 section 10.3's reported low-ratio range (~268.5-274.3). Section 6b identifies and confirms the cause: a raster-evidence configuration mismatch, not a boundary-point or algorithm difference.

---

## 5b. EXP-007 matching-u-trim sensitivity sweep, fully reproduced

A follow-up pass exposed every `ProjectedFaceRasterConfig` field through the CLI (`--raster-cell-size-u`, `--raster-u-quantile-low`, etc. -- see section 6c) specifically to re-run EXP-007 section 7's raster sensitivity sweep, which used u-trimmed evidence (`u_quantile_low=0.01, u_quantile_high=0.99`, matching the scanline estimator's own default longitudinal trim) rather than the untrimmed default (`0.0-1.0`) that EXP-006/EXP-008's headline 284.25 figure uses.

Reproducibility commands (local only):

```bash
uv run lidar benchmark-face-estimators <path> --input-already-isolated \
  --method raster_filled \
  --raster-cell-size-u <U> --raster-cell-size-z <U> \
  --raster-u-quantile-low 0.01 --raster-u-quantile-high 0.99 \
  --raster-min-points-per-cell <N>
```

| Cell size | min_points_per_cell | New result | EXP-007 historical | Match |
|---:|---:|---:|---:|---|
| 0.020 | 1 | 263.297200 | 263.2972 | exact |
| 0.050 | 1 | 270.210000 | 270.2100 | exact |
| 0.050 | 2 | 268.075000 | 268.0750 | exact |
| 0.050 | 3 | 266.410000 | 266.4100 | exact |

**FACT:** all four of EXP-007's matching-u-trim raster sensitivity figures are reproduced exactly once the same trim/cell-size/min-points configuration is supplied. Together with section 5's default-config match (284.25) and the scanline match (254.199721), this confirms the shared architecture introduces no numerical drift across every raster configuration EXP-007 exercised, not just the one EXP-008 happened to persist.

---

## 6. A real bug found and fixed while building this infrastructure

`mask_to_polygon` (the shared "turn a boolean raster mask into a measured polygon" utility) initially unioned per-row boxes with plain `shapely.unary_union`. On a large, fully solid synthetic mask (80 x 201 cells) this fragmented into 18 disjoint pieces due to floating-point noise at shared row edges -- a known GEOS edge case when unioning many exactly-abutting rectangles. The total area was still correct (pieces summed to the right value), but the implementation kept only the single largest piece, silently discarding most of the area (17.59 instead of 40.2 in the synthetic test that caught it).

**DECISION:** pass an explicit `grid_size` (a small fraction of one cell) to `shapely.unary_union`, which forces exact snapping and eliminates the floating-point fragmentation for a genuinely single-connected mask.

Even after that fix, the real pile's `filled_mask` still produced 24 disjoint polygon parts. This is a *different*, real phenomenon: the upstream raster kernel labels connected components with 8-connectivity (`ProjectedFaceRasterConfig.connectivity=8` by default), so two cells touching only at a corner count as "connected" on the grid, but they do not share a union boundary as two axis-aligned squares -- they cannot form one simple polygon.

**DECISION:** `PolygonMeasurement` now carries an explicit `part_count`. `mask_to_polygon` sums area/perimeter across every resulting part (matching the raster kernel's own cell-counting semantics, which does not distinguish edge- from corner-adjacency) while `vertices`/`vertex_count` describe only the single largest part, for diagnostic display. This is why `raster_filled` shows `part_count=24` above while still reproducing the raster kernel's exact area.

This is recorded here as a RESULT because it is new, real-data-only evidence -- the fragmentation did not appear in initial small synthetic tests and only surfaced once the benchmark was run on the actual pile.

**DECISION (architecture, recorded in ADR-004):** the shared contour/measurement contract accepts *polygonal geometry* (`Polygon` or `MultiPolygon`), not only a single simple polygon, precisely because of this discrete-topology/continuous-geometry mismatch. `face_boundary.PolygonMeasurement` was renamed to `PolygonalMeasurement` to make that explicit, and gained `require_single_part()` so an estimator that must promise one external contour (the scanline envelope; `concave_hull`) fails loudly on a surprise multi-part result instead of silently accepting one -- only `raster_filled` (QA/support geometry) is allowed `part_count > 1`. See ADR-004's "Implementation note (2026-08-26)".

---

## 6b. Concave-hull discrepancy: root cause identified

Section 5's initial concave-hull result (288.57) was produced against the benchmark's *default* raster evidence, which is untrimmed in `u` (`u_quantile_low=0.0, u_quantile_high=1.0`) -- the same convention EXP-006/EXP-008 use for the raster's own headline "gross area" figure (284.25).

EXP-007 section 10's concave-hull work, however, sits inside the same section 7-10 narrative as the matching-u-trim raster sensitivity sweep (section 5b), which trims `u` to `[0.01, 0.99]` to match the scanline estimator's own default longitudinal quantile trim. Re-running the concave-hull estimator against u-trimmed evidence instead of the default:

```bash
uv run lidar benchmark-face-estimators <path> --input-already-isolated \
  --method concave_hull \
  --raster-cell-size-u <cell> --raster-cell-size-z <cell> \
  --raster-u-quantile-low 0.01 --raster-u-quantile-high 0.99 \
  --raster-min-points-per-cell 1 --concave-hull-ratio <ratio>
```

| Cell size | Ratio | New result | EXP-007 historical (section 10.3) | Match |
|---:|---:|---:|---:|---|
| 0.050 | 0.010 | 273.400000 | 273.4000 | exact |
| 0.075 | 0.010 | 274.314375 | 274.3144 | exact |
| 0.050 | 0.050 | 280.810000 | within reported 279.05-282.39 range for ratio=0.05 | consistent |

**FACT:** once the concave-hull estimator is given u-trimmed raster evidence matching EXP-007's own methodology, its output matches EXP-007 section 10.3's table to four decimal places. **The root cause of the section 5 discrepancy was a raster-evidence configuration mismatch (untrimmed vs. u-trimmed `u_quantile_low`/`u_quantile_high`), not a difference in boundary-point extraction, mask choice, cell-center-vs-corner representation, or the shapely `concave_hull` call itself.**

This was identified by systematically varying one configuration axis at a time (mask field, then raster trim) rather than by adjusting the concave-hull estimator's own code, per this experiment's rule against tuning parameters until numbers match.

**DECISION:** do not change `ConcaveHullContourEstimator`'s or `build_projected_face_evidence`'s *defaults* to the u-trimmed configuration. The benchmark's default evidence intentionally matches EXP-006/EXP-008's untrimmed "gross area" convention so that `raster_filled`'s default output keeps matching the persisted measurement pipeline's own default `ProjectedFaceRasterConfig()`. Reproducing EXP-007's specific sensitivity-sweep numbers is something the caller now does explicitly via `--raster-u-quantile-low`/`--raster-u-quantile-high` (section 5b/6c), not something the benchmark silently assumes.

---

## 6c. CLI/config reproducibility gap found and fixed

While wiring up the u-trim comparison above, two related gaps were found and fixed:

1. `run_face_estimator_benchmark_from_las` accepted a `raster_config` override but had no `estimators` parameter, so the CLI's `--concave-hull-ratio` option -- which builds a custom estimator registry with the requested ratio -- was silently discarded; every benchmark run used the default ratio (0.01) regardless of what was requested. **Fixed:** the pipeline now accepts and forwards `estimators`, matching what `run_face_estimator_benchmark` already supported.
2. `ProjectedFaceRasterConfig`'s other nine fields (`cell_size_z`, `min_points_per_cell`, `connectivity`, `min_component_cells`, `closing_iterations`, and the four quantile trims) were not reachable from the CLI at all, making it impossible to reproduce EXP-007's sensitivity sweep without editing source. **Fixed:** added `--raster-cell-size-u/z`, `--raster-min-points-per-cell`, `--raster-connectivity`, `--raster-min-component-cells`, `--raster-closing-iterations`, and `--raster-u/z-quantile-low/high`, composed directly onto the existing `ProjectedFaceRasterConfig` dataclass (only overriding fields the caller actually supplied; no second, parallel config model). Invalid combinations (e.g. a negative cell size) fail through that dataclass's own existing validation inside `estimate_projected_face_raster`, not a separate CLI-side check. The resolved config (including every default actually used) is now persisted at `benchmark.json`'s `input_identity.raster_config`, and echoed to the console, so a run's exact configuration is always reproducible later.

Both are recorded as RESULTs because they were only discovered by attempting an actual reproduction, not by code review alone.

---

## 7. Interpretation

The shared architecture reproduces every estimator it wraps -- scanline, raster (default and full EXP-007 sensitivity sweep), and now concave-hull once given matching evidence -- exactly, on real data. This confirms ADR-004's core claim that a shared evidence layer does not introduce drift, and demonstrates that the benchmark is a genuine reusable experiment platform: EXP-007's sensitivity sweep, previously only reproducible by hand-editing a one-off script, is now a CLI invocation.

**DECISION:** do not tune the concave-hull estimator's default configuration to match EXP-007's specific sweep numbers. Its default (untrimmed evidence, ratio=0.01) is deliberately consistent with the rest of this benchmark's defaults, not with one specific historical sensitivity analysis; EXP-007's own numbers remain reproducible on demand via explicit CLI options.

---

## 8. Limitations

- `marching_squares` and `density_supported_envelope` remain unimplemented in this infrastructure (see `HISTORICAL_METHODS`); EXP-007's negative/rejected findings for both stand unchanged and unreproduced by new code.
- No same-pile Campo Digital reference exists yet, so no error metric could be computed; `reference_status` for every outcome in this run is `no_reference_supplied`.
- This run used only one pile; Phase 1's exit criterion (roadmap.md) requires validating across more than one frozen candidate once available.
- `FrontCrossSectionConfig` (scanline's own quantile/bin parameters) is not yet exposed through the CLI the way `ProjectedFaceRasterConfig` now is; only `n_bins` is visible today, indirectly, via the scanline outcome's own `parameters`.

---

## 9. Decision

Keep the shared architecture as implemented: `scanline_envelope` as the strongest baseline, `raster_filled` for QA/topology (now correctly area-summing across raster-8-connectivity parts), `concave_hull` as an experimental candidate, matching EXP-007's own categorization. The infrastructure is ready to host G02/G03 (if ever implemented) and future 2D/3D mask producers without further redesign, per ADR-004. `PolygonalMeasurement`/`part_count` and the full `ProjectedFaceRasterConfig` CLI exposure are now part of that shared architecture.

## 10. Next step

- Once Campo Digital supplies a confirmed same-pile reference polygon/area, re-run this benchmark with `--reference-face-area` to produce the first gated error metrics per estimator (docs/roadmap.md Phase 1 exit criterion).
- Consider exposing `FrontCrossSectionConfig`'s own quantile/bin parameters through the CLI (currently only `ProjectedFaceRasterConfig` is fully exposed) if a scanline sensitivity sweep is ever needed the way the raster one now is.

<!-- DOC_NAV_START -->

---

### Documentation navigation

[Project README](../../README.md) · [Docs index](../README.md) · [Findings](../findings/cubicacion_accuracy_problem.md) · [Experiments](.) · [Decisions](../decisions) · [Spanish docs](../es/README.md) · [Estado técnico](../es/estado-proyecto.md) · [Preguntas Campo Digital](../es/preguntas-campo-digital.md)

<!-- DOC_NAV_END -->
