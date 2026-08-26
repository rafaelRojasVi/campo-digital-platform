# Development roadmap: geometry and architecture experiment plan

## Purpose and scope

This document is the canonical technical roadmap for the experiment sequence
that decides how the Campo Digital timber-stack face measurement is
ultimately produced: by deterministic geometry alone, by geometry combined
with machine learning, or by some other architecture.

It is a **detailed, phase-by-phase expansion of one part of the top-level
project roadmap** in [`README.md`](../../../README.md#roadmap): specifically the
"compare compatible geometric methods against the accepted reference" item
of **Phase E — Cubicación and reference validation**. It does not replace
that roadmap, and it does not change Phase F ("Field pilot and
productization").

This document does not itself validate anything. It sequences work and
states, for each phase, what would have to be true for the project to move
to the next one.

## Evidence discipline

Per [`DOCUMENTATION_POLICY.md`](../../../docs/DOCUMENTATION_POLICY.md), every phase below
is written as a plan, not a result. Where a phase references work that has
already happened, it links the experiment record that established it.
Nothing in this document should be read as a new FACT or RESULT — those
belong in `docs/experiments/`, `docs/findings/`, and `docs/decisions/`.

## Central open question this roadmap exists to answer

> Does adding machine learning (2D image segmentation, 3D point
> segmentation, or both) to the existing deterministic geometry pipeline
> measurably improve face-area accuracy or robustness over geometry alone,
> once both are compared under the same benchmark?

**The hybrid geometry+ML architecture is the current leading hypothesis
motivating Phases 1–4 below. It is not a validated conclusion.** Phases 1–4
exist specifically to falsify or confirm it. If geometry alone, once its
contour/boundary method is properly chosen, is not measurably beaten by any
ML variant on the shared benchmark, the correct outcome is to keep the
geometry-only pipeline and stop — not to add ML for its own sake. This
mirrors the existing project principle that raw geometric output must not be
silently promoted into a stronger claim than the evidence supports.

## Phase 0 — Current foundation

**Status: substantially in place; still pre-reference-validation.**

What already exists, deterministically, with no ML component:

- pile localization / prelocalized-input contract
  ([EXP-003](experiments/EXP-003-timber-stack-roi-and-observability.md),
  [EXP-008](experiments/EXP-008-reference-validation-prelocalized-measurement.md));
- a local `(u, v, z)` face frame and robust-quantile scanline front-cross-section
  estimator ([EXP-005](experiments/EXP-005-front-cross-section-and-depth-sensitivity.md));
- a projected `(u, z)` occupancy raster estimator with connected-component
  denoising and hole filling
  ([EXP-006](experiments/EXP-006-projected-face-raster-area.md));
- a front/rear visibility classification step that preserves transverse depth
  `v` before collapsing to `(u, z)`, plus a recessed-region diagnostic
  ([EXP-007 §18](experiments/EXP-007-gs100g-boundary-estimator-comparison.md));
- an initial geometry-tournament pass across boundary/contour families —
  scanline, raw raster, sub-cell marching-squares contour, a density-supported
  envelope, and the concave-hull family — already run and decided on one
  frozen dataset (see [EXP-007 §§7–11](experiments/EXP-007-gs100g-boundary-estimator-comparison.md)
  and the summary in [Phase 1](#phase-1--geometry-tournament) below);
- a measurement-readiness contract
  (`not_ready → observable_geometry → physical_face_area → geometric_volume →
  reference_validated`) and a face-area reference/comparison contract that
  blocks error metrics unless same-pile confirmation and compatible units are
  explicit (`products/lidar/src/lidar_core/face_area_reference.py`,
  [EXP-008](experiments/EXP-008-reference-validation-prelocalized-measurement.md));
- a read-only, bilingual measurement console (viewer) presenting the above;
- the shared benchmark architecture from
  [ADR-004](decisions/ADR-004-hybrid-measurement-experiment-architecture.md)
  (common projected evidence, mask/contour estimator interfaces, one shared
  polygon-measurement path), implemented and confirmed on real data to
  reproduce the scanline/raster figures above exactly
  ([EXP-009](experiments/EXP-009-shared-estimator-benchmark-infrastructure.md)).

What does not exist yet: any 2D or 3D machine-learning component, any
labeled training data, and any same-pile Campo Digital reference measurement
(see [`findings/cubicacion_accuracy_problem.md`](findings/cubicacion_accuracy_problem.md)
and [`es/preguntas-campo-digital.md`](es/preguntas-campo-digital.md)).

## Phase 1 — Geometry tournament

**Objective:** decide the external face-boundary/contour method using
deterministic geometry only, before considering ML.

**This phase is partially complete.** EXP-007 already ran a first
geometry-tournament pass and recorded explicit decisions:

| Candidate | EXP-007 decision |
|---|---|
| Robust-quantile scanline | Keep as strongest baseline/QC |
| Binary raster occupancy | Keep for QA/topology, not authoritative area |
| Sub-cell marching-squares contour | No demonstrated measurement benefit over raw raster; do not promote |
| Density-supported vertical envelope | Reject as primary estimator (replaces one calibration parameter with two) |
| Concave-hull family (low ratio) | Keep as experimental candidate; strong cross-resolution stability, but ratio still materially changes area |
| Exact alpha-shape | Defer until a client reference justifies its own calibration |
| Convex hull | Reject (bridges true concavities) |

This directly informs the Aug-26 external research note's geometry-candidate
list (see
[`research/2026-08-26-hybrid-face-measurement.md`](research/2026-08-26-hybrid-face-measurement.md)):
several of its suggested methods have already been tried on real Campo
Digital data with a different outcome than the research note's own
illustrative comparison table, most notably that marching-squares
contouring did **not** meaningfully reduce the raster's area relative to the
scanline baseline in this repository's own data.

**Remaining work in this phase:**

- extend the EXP-007 comparison to more than one frozen pile once additional
  isolated candidates exist;
- decide whether the concave-hull family or the scanline estimator becomes
  the production default once a same-pile reference is available (EXP-007
  §17 already defines this as the next decision gate);
- do not introduce any new contour family without first checking whether it
  changes the conclusion above.

**Exit criterion:** a documented experiment comparing the shortlisted
geometry candidates against a confirmed same-pile reference area (not
against another estimator), using the shared benchmark described in
[ADR-004](decisions/ADR-004-hybrid-measurement-experiment-architecture.md).

## Phase 2 — 2D / 2.5D tournament

**Status: not started. No labeled data exists.**

**Objective:** evaluate whether a 2D image-segmentation model, applied to a
multi-channel raster of the projected face (occupancy, point density,
front/back depth), can refine the boundary produced by Phase 1 — handling
vegetation, sensor noise, or irregular tips that a fixed geometric rule
handles poorly.

Candidate models carried over from the Aug-26 research note (unverified
external claims; see that document's provenance note): U-Net as the
lightweight baseline, U-Net++, FPN, DeepLabV3+, SegFormer for a
higher-capacity option.

**Preconditions before this phase can start:**

- a 2D annotation workflow and a first batch of labeled face masks
  (`COUNTED-LOG` / `GROUND` / `VOID` / `OTHER`, with an `UNCERTAIN` flag);
- the multi-channel raster export from the existing projected-face pipeline
  (occupancy and density channels already exist in
  `products/lidar/src/lidar_volume/projected_face_raster.py`; depth channels already exist
  in `products/lidar/src/lidar_volume/front_depth.py` — both would be reused as the shared
  input, not reimplemented — see [ADR-004](decisions/ADR-004-hybrid-measurement-experiment-architecture.md)).

**Exit criterion:** a 2D-only pipeline (geometry for localization/framing,
2D model for the mask, Phase 1's winning contour method for the final
polygon) evaluated against the Phase 1 geometry-only baseline on the same
frozen dataset(s). If it does not measurably beat Phase 1, that is a valid
and useful result, not a failure to be hidden.

## Phase 3 — 3D tournament

**Status: not started. No labeled 3D point data exists.**

**Objective:** evaluate whether a 3D point-level segmentation model
(pile vs. ground/vegetation/other) improves noise rejection before
projection, compared to the current deterministic localization/ROI step.

Candidate models carried over from the Aug-26 research note (unverified
external claims): RandLA-Net as the lighter, faster first choice; Point
Transformer V3 / Utonia (Pointcept) as the higher-capacity option if
fine-tuning data becomes available; SparseConvNet/MinkowskiEngine and
KPConv as general-purpose alternatives.

**Preconditions before this phase can start:**

- 3D point-level labels (pile / ground / vegetation / other) for at least a
  handful of piles;
- a decision on annotation tooling (the research note suggests CloudCompare
  or an Open3D-based labeler; not yet chosen).

**Exit criterion:** a 3D-preprocessing pipeline evaluated against the
Phase 0/1 deterministic localization step on the same benchmark. Same
falsifiability requirement as Phase 2.

## Phase 4 — Architecture ablation

**Status: not started; depends on Phases 1–3 producing at least one working
candidate.**

**Objective:** compare architecture combinations under one shared benchmark
(defined in [ADR-004](decisions/ADR-004-hybrid-measurement-experiment-architecture.md))
rather than assuming the hybrid is correct:

- **A** — geometry only (Phase 1's winning method);
- **B** — 3D ML only, end-to-end;
- **C** — 2D ML only;
- **D1/D2/D3** — hybrid variants (geometry + 2D; geometry + 3D + 2D; full
  pipeline), per the Aug-26 research note's experiment matrix.

**This is the phase that actually tests the hybrid hypothesis.** Its output
is not assumed in advance. A plausible and acceptable outcome of this phase
is that Architecture A (geometry only, with the Phase 1 contour decision)
remains the production choice.

**Exit criterion:** a ranked comparison of A/B/C/D on relative area error,
boundary similarity, and runtime, against the same same-pile reference(s)
used in Phase 1.

## Phase 5 — Validated hybrid (or validated geometry)

**Status: not started; depends on Phase 4.**

**Objective:** once Phase 4 identifies a winning architecture — of whatever
kind — validate it against Campo Digital reference measurements across
multiple piles, not just the single frozen dataset used through Phases 1–4.

Only after this phase can the project make a defensible accuracy claim, per
[`findings/cubicacion_accuracy_problem.md`](findings/cubicacion_accuracy_problem.md).
This phase completes README's Phase E.

## Phase 6 — Productionization

**Status: not started.** This phase corresponds to README's
[Phase F — Field pilot and productization](../../../README.md#phase-f--field-pilot-and-productization):
field capture workflow, operator UX, offline-first operation, the FastAPI
service, spatial storage, project/client history, QC reports and audit
trail, and integration with Campo Digital's commercial workflow. It is out
of scope for this document beyond that cross-reference.

## Explicit non-goals (carried over from the Aug-26 research note)

These are deliberately deferred, independent of which architecture wins:

- end-to-end volume regression directly from raw data (not explainable, not
  auditable);
- individual log counting / per-log diameter measurement (out of the current
  gross-face-area scope; [`findings/cubicacion_accuracy_problem.md`](findings/cubicacion_accuracy_problem.md)
  §17 keeps this as a possible *future* capability, not a current one);
- full backface reconstruction (the metric is visible face area × known
  length, per [ADR-003](decisions/ADR-003-do-not-infer-unobserved-pile-depth.md));
- additional semantic classes beyond wood/not-wood (e.g. bark vs. wood).

## Related documents

- [`research/2026-08-26-hybrid-face-measurement.md`](research/2026-08-26-hybrid-face-measurement.md) — the external research note this roadmap operationalizes.
- [ADR-004 — shared experiment architecture](decisions/ADR-004-hybrid-measurement-experiment-architecture.md).
- [EXP-006](experiments/EXP-006-projected-face-raster-area.md), [EXP-007](experiments/EXP-007-gs100g-boundary-estimator-comparison.md), [EXP-008](experiments/EXP-008-reference-validation-prelocalized-measurement.md) — the geometry-tournament work Phase 1 builds on.
- [EXP-009](experiments/EXP-009-shared-estimator-benchmark-infrastructure.md) — the shared benchmark architecture's first real-data reproducibility check.
- [`findings/cubicacion_accuracy_problem.md`](findings/cubicacion_accuracy_problem.md) — why accuracy claims remain blocked until reference validation.
- [`es/preguntas-campo-digital.md`](es/preguntas-campo-digital.md) — the open questions for Campo Digital that gate several exit criteria above.

<!-- DOC_NAV_START -->

---

### Documentation navigation

[LiDAR README](../README.md) · [Docs index](README.md) · [Findings](findings/cubicacion_accuracy_problem.md) · [Experiments](experiments) · [Decisions](decisions) · [Spanish docs](es/README.md) · [Estado técnico](es/estado-proyecto.md) · [Preguntas Campo Digital](es/preguntas-campo-digital.md)

<!-- DOC_NAV_END -->
