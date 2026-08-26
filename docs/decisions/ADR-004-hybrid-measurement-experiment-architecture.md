# ADR-004 — Shared experiment architecture for competing face-measurement estimators

## Status

Accepted (architectural contract for future work; does not itself implement
any new estimator).

## Context

[`roadmap.md`](../roadmap.md) and
[`research/2026-08-26-hybrid-face-measurement.md`](../research/2026-08-26-hybrid-face-measurement.md)
lay out a multi-phase plan to compare several ways of producing the
timber-stack face boundary/area: the existing deterministic geometry
methods, and — as an unproven hypothesis to be tested, not a decided
direction — 2D and 3D machine-learning refinements.

This repository already has one working precedent for comparing competing
algorithms without coupling them together: `VolumeEstimator`
(`src/lidar_volume/base.py`), an abstract base class that every volume
method implements, with a shared `estimate()` wrapper handling timing,
bounds, and provenance bookkeeping. It also already has a shared,
gated reference-comparison contract for face area
(`src/lidar_core/face_area_reference.py`,
[EXP-008](../experiments/EXP-008-reference-validation-prelocalized-measurement.md))
that blocks error metrics unless same-pile confirmation and compatible units
are explicit.

What does not yet exist is the equivalent pattern **one layer up**: a
contract that lets a geometry-only contour method, a future 2D
mask-refinement method, and a future 3D pre-filtering method all be
compared on the geometry-tournament and architecture-ablation phases of the
roadmap without hard-wiring each new method into the others or into
`measurement_pipeline.py` directly. Without this contract, adding a 2D or
3D model later would likely mean branching or duplicating the existing
pipeline rather than plugging into it, and comparisons between methods would
not be apples-to-apples.

## Decision

Before any competing geometry, 2D, or 3D face-measurement estimator is
implemented under the roadmap's Phases 1–4, it must be built against a
shared architecture with the following five layers. Each layer is a
contract (an interface / a well-defined intermediate representation), not a
specific algorithm:

1. **Common projected evidence.** Every estimator consumes the same
   deterministic upstream evidence: pile-localized points in the local
   `(u, v, z)` face frame, and the same multi-channel projected raster
   (occupancy, point density, front/back depth) already produced by
   `src/lidar_volume/projected_face_raster.py` and
   `src/lidar_volume/front_depth.py`. No estimator recomputes localization,
   framing, or projection itself.

2. **Common mask-estimator interface.** Any method that produces a
   face-vs-not-face classification (whether a fixed geometric rule, a 2D
   CNN, or a 3D-model-filtered projection) implements one interface that
   takes the common projected evidence and returns a boolean/probability
   mask over the same raster grid. This is the plug point for Phase 2/3 ML
   work; a geometry-only method (e.g. today's raster occupancy) is a valid,
   trivial implementation of this interface.

3. **Common contour-estimator interface.** Any method that turns a mask (or,
   for a purely geometric method, the raw evidence) into an external
   boundary — today's scanline estimator, raster+connected-components,
   marching squares, or a concave-hull family — implements one interface
   that returns a closed polygon in the local `(u, z)` frame. This is
   separate from the mask interface so that, for example, a geometry-only
   contour method can be evaluated against an ML-refined mask, and vice
   versa, without a combinatorial rewrite.

4. **Common polygon measurement.** Exactly one function computes area (and
   any boundary-similarity metric) from a closed `(u, z)` polygon, shared by
   every estimator combination. Area is never computed ad hoc inside a mask
   or contour implementation.

5. **Common reference-comparison / benchmark framework.** Every estimator
   combination's polygon is scored through the existing
   `face_area_reference.py` contract (same-pile confirmation and unit
   compatibility required before any error metric is produced), extended
   only as needed to accept multiple named estimator submissions per run
   for tournament-style comparison, and to add boundary-similarity metrics
   (IoU, Hausdorff) alongside the existing relative-area-error metric. It is
   not replaced or duplicated per estimator.

Mirroring the existing `VolumeEstimator` precedent: each concrete estimator
declares a `method_name`, and a shared wrapper handles timing and
provenance, so every tournament/ablation row in
[`roadmap.md`](../roadmap.md) Phases 1 and 4 is directly comparable.

## Rationale

- **Falsifiability requires comparability.** The roadmap's central question
  — does ML measurably beat geometry — can only be answered if every
  candidate is scored by the same function on the same evidence. Coupling a
  new method's evidence-gathering or scoring logic to its own algorithm
  would make "Architecture D beat Architecture A" an artifact of
  implementation differences rather than a real result.
- **The precedent already exists and works.** `VolumeEstimator` and
  `face_area_reference.py` already demonstrate this project's preferred
  pattern: shared interface, per-method implementation, shared scoring.
  Extending that pattern is lower-risk than inventing a new one.
- **Keeps ML strictly additive and removable.** Because 2D/3D methods only
  ever produce a mask or a contour through the same interfaces geometry
  already uses, none of Phases 2–4 can silently change what "projected
  evidence," "area," or "reference comparison" mean. If ML is rejected after
  Phase 4, removing it does not touch the geometry path.
- **Matches the project's anti-overclaiming discipline.** A shared,
  gated reference-comparison layer prevents any new estimator from
  reporting an error metric before same-pile/units evidence exists, exactly
  as already enforced for today's geometry estimators.

## Alternatives considered

### Let each new estimator (2D, 3D) own its full pipeline end-to-end

Rejected. This is close to the research note's "Architecture B/C" pure
end-to-end options. It would prevent apples-to-apples comparison against
geometry and against other ML variants, and would duplicate localization,
framing, and reference-comparison logic that already exists and is already
validated for correctness independent of any specific estimator.

### Wait until a 2D or 3D model actually exists before defining shared interfaces

Rejected. The geometry tournament ([EXP-007](../experiments/EXP-007-gs100g-boundary-estimator-comparison.md))
already shows what happens without a shared benchmark contract up front:
several boundary methods were compared informally before the reference-
comparison contract existed, and conclusions had to be revisited (e.g. the
front-depth/visibility refinement in EXP-007 §18) once evidence handling
changed. Fixing the shared layers first avoids repeating that.

### Build one monolithic "hybrid estimator" class instead of composable interfaces

Rejected. This would make Phase 4's architecture ablation (A/B/C/D1/D2/D3)
impossible to run cleanly, since the whole point of that phase is to swap
individual layers (mask source, contour method) independently.

## Consequences

### Positive

- Geometry, 2D, and 3D methods can be developed and tested independently
  and in any order without blocking each other.
- The roadmap's architecture-ablation phase (Phase 4) becomes a
  configuration exercise (which mask estimator, which contour estimator)
  rather than a rewrite.
- A negative result (ML does not beat geometry) is just as easy to produce
  and trust as a positive one, because the scoring path is identical.
- No change to the existing, already-validated geometry pipeline is required
  to add this contract — it wraps around it.

### Negative / trade-offs

- Adds an interface layer before any ML work has proven it is needed; if the
  project ultimately determines geometry alone is sufficient (a fully valid
  outcome per the roadmap), some of this contract's generality goes unused.
- Requires the existing `projected_face_raster.py` / `front_depth.py`
  outputs to be treated as a stable shared contract going forward; changes
  to their shapes/semantics now have more downstream consumers to consider.

## Related evidence

- `src/lidar_volume/base.py` — the existing `VolumeEstimator` precedent this
  ADR extends.
- `src/lidar_core/face_area_reference.py` — the existing gated
  reference-comparison contract.
- [EXP-006](../experiments/EXP-006-projected-face-raster-area.md),
  [EXP-007](../experiments/EXP-007-gs100g-boundary-estimator-comparison.md),
  [EXP-008](../experiments/EXP-008-reference-validation-prelocalized-measurement.md)
  — the existing geometry-tournament and reference-validation work this
  contract must not duplicate.
- [`research/2026-08-26-hybrid-face-measurement.md`](../research/2026-08-26-hybrid-face-measurement.md)
  — the external research note motivating the future ML layers.
- [`roadmap.md`](../roadmap.md) — the phase sequence this contract supports.

## Future reconsideration

This decision may be revisited if:

- Phase 1 concludes with a single geometry method so much better than the
  alternatives that a mask/contour split adds no value; or
- Phase 4's ablation shows no ML variant approaches geometry-only
  performance, in which case the mask-estimator interface may be kept
  dormant rather than actively developed further; or
- Campo Digital's confirmed cubicación definition turns out to require
  information (e.g. individual log counts) that this layered contract does
  not naturally accommodate.

<!-- DOC_NAV_START -->

---

### Documentation navigation

[Project README](../../README.md) · [Docs index](../README.md) · [Findings](../findings/cubicacion_accuracy_problem.md) · [Experiments](../experiments) · [Decisions](.) · [Spanish docs](../es/README.md) · [Estado técnico](../es/estado-proyecto.md) · [Preguntas Campo Digital](../es/preguntas-campo-digital.md)

<!-- DOC_NAV_END -->
