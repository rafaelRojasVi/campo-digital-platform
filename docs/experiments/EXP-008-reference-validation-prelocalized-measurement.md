# EXP-008 — Reference validation and prelocalized measurement contract

**Date:** 2026-08-25
**Status:** Experimental — reproducible geometry, not reference-validated
**Dataset:** Frozen manually isolated GS100G roadside timber-stack candidate
**Primary question:** How can the face-measurement kernel be validated independently from whole-scene pile localization, while preventing unsupported physical-area or accuracy claims?

---

## 1. Objective

Previous GS100G experiments established two separate problems:

1. locate the relevant timber stack in a larger point cloud;
2. measure the roadside-facing timber-stack face once the correct pile is available.

Those problems must not be conflated during validation.

A manually isolated pile is useful for evaluating the measurement kernel, but
running the automatic `PileLocator` again on that already-isolated cloud can
change the point set and therefore confound area comparisons.

This experiment introduces an explicit **prelocalized input mode** and a
separate **face-area reference comparison contract**.

~~~text
full point cloud
      ↓
PileLocator
      ↓
isolated pile
      ↓
FaceMeasurementKernel
      ↓
candidate face area
      ↓
same-pile reference comparison
      ↓
physical interpretation / validation
~~~

For controlled validation, localization can be bypassed explicitly:

~~~text
already-isolated pile
      ↓
prelocalized_input
      ↓
FaceMeasurementKernel
~~~

This bypass must not be interpreted as successful automatic pile localization.

---

## 2. Why prelocalized mode was required

The frozen manually isolated pile contains:

~~~text
1,577,128 points
~~~

Before this experiment, passing that file through the default measurement
pipeline caused timber localization to run again:

~~~text
input points             1,577,128
selected points          1,084,738
selected fraction           68.779%
projected raster area     208.172500 source-units²
~~~

That was not a clean measurement-kernel baseline because it mixed:

~~~text
localization
+
face-area estimation
~~~

Reference validation requires those stages to be separable.

---

## 3. Prelocalized measurement contract

The pipeline now accepts:

~~~text
input_already_isolated = true
~~~

The CLI exposes:

~~~text
--input-already-isolated
~~~

In this mode:

~~~text
localization_mode       = prelocalized_input
input points            = N
selected points         = N
selected fraction       = 100%
automatic localization  = not run
~~~

All input points are passed directly to the downstream face-measurement
kernels.

The persisted `TimberStackSummary` explicitly records the localization mode.

Run-level provenance also records:

~~~text
localization_mode = prelocalized_input
~~~

This prevents a controlled prelocalized validation run from being mistaken for
successful automatic pile localization.

---

## 4. Frozen real-data baseline

The controlled run used the complete frozen manually isolated pile:

~~~text
input points             1,577,128
selected points          1,577,128
selected fraction          100.000%
localization mode        prelocalized_input
~~~

Observed geometry:

~~~text
longitudinal span         68.935522 source units
median height              3.714878 source units

rectangle area           255.288370 source-units²
trapezoid area           254.199721 source-units²
projected raster area    284.250000 source-units²
~~~

The robust scanline/trapezoid value reproduces the earlier manually isolated
baseline:

~~~text
previous  254.199720647...
current   254.199721
~~~

This demonstrates reproducibility of that measurement path on the frozen input.

It does **not** demonstrate physical accuracy.

---

## 5. Independent estimator disagreement

The current scanline/trapezoid estimator and projected-raster estimator produce
different candidate areas:

~~~text
scanline / trapezoid     254.199721 source-units²
projected raster         284.250000 source-units²
symmetric disagreement        11.162%
~~~

Neither estimator is promoted as authoritative.

The disagreement is intentionally exposed rather than hidden.

The remaining scientific question is which boundary definition best matches the
intended operational roadside-face measurement.

A trusted same-pile reference polygon or reference area is required to answer
that question.

---

## 6. Face-area reference comparison contract

A face-area reference model is now separate from the existing volume-reference
contract.

Supported units are:

~~~text
source_units_squared
square_metres
~~~

A reference records:

~~~text
label
value
unit
method
source
same_pile_confirmed
notes
~~~

The comparison records:

~~~text
estimate method
estimate value
estimate unit
reference
comparison readiness
blocker codes
signed error
absolute error
relative error
absolute relative error
percent error
absolute percent error
~~~

Error metrics are generated only when both conditions are satisfied:

~~~text
same pile explicitly confirmed
AND
estimate/reference area units compatible
~~~

Otherwise the reference is retained while the comparison remains blocked.

Current blocker codes include:

~~~text
same_pile_unconfirmed
area_units_incompatible
~~~

No implicit conversion is performed.

---

## 7. Physical-unit safety

The measurement software must not infer metres from:

- LAS scale;
- LAS offsets;
- coordinate magnitude;
- sensor identity;
- expected timber dimensions.

The LAS inspection path resolves physical horizontal units only when explicit
CRS metadata provides compatible projected horizontal-axis units.

For face-area comparison:

~~~text
explicit axis unit "metre" / "meter"
        ↓
square_metres

missing / unsupported / ambiguous units
        ↓
source_units_squared
~~~

Therefore:

~~~text
automatic estimate in source-units²
+
reference in m²
        ↓
comparison blocked
~~~

No percentage error is calculated in that state.

---

## 8. Readiness remains independent

Face-area reference comparison is deliberately independent from the existing
measurement-readiness ladder.

Current stages remain:

~~~text
NOT_READY
→ OBSERVABLE_GEOMETRY
→ PHYSICAL_FACE_AREA
→ GEOMETRIC_VOLUME
→ REFERENCE_VALIDATED
~~~

The existing `REFERENCE_VALIDATED` stage remains part of the broader
volume-level maturity contract.

A successful face-area comparison does **not** by itself promote a
`MeasurementRun` to `REFERENCE_VALIDATED`.

This prevents an area-level diagnostic from being mistaken for validated
commercial cubicación.

---

## 9. Front-depth diagnostic in the controlled run

The existing front-depth/recession layer is exposed through the measurement
CLI with:

~~~text
--front-side low_v
~~~

For this specific frozen GS100G pile, the previously established visible side
is `low_v`.

This orientation is explicit for this dataset and is not a general assumption
about GS100G acquisitions.

The controlled run produced:

~~~text
front side                    low_v
recession candidates          35
front-depth runtime            0.338 s
recession runtime              0.028 s
~~~

These are observed development-machine timings, not performance guarantees.

---

## 10. Independently detected marked structural opening

The structural opening previously identified by the operator was not supplied
to the recession detector as a search location.

In the current default production diagnostic run, the corresponding automatic
candidate is:

~~~text
rank                            #3
candidate area                   0.8375 source-units²
median recession                 1.0503 source units
maximum recession                1.9038 source units
recession score                  0.9086 source-units³
u bounds                       -25.548 → -23.398
z bounds                       280.541 → 281.841
~~~

This supports the claim that the front-depth diagnostic can independently
surface the marked geometric anomaly.

It does **not** establish that the candidate is a confirmed physical void.

Persisted semantics remain:

~~~text
estimator_status          = experimental_candidate
authoritative_measurement = false
reference_validated       = false

confirmed_physical_voids  = false
subtracted_from_face_area = false
affects_volume            = false
affects_readiness         = false
commercial_cubicacion     = false
~~~

---

## 11. CLI validation workflow

A controlled measurement run can now be executed as:

~~~text
lidar measure PILE.las \
  --input-already-isolated \
  --front-side low_v
~~~

An explicit same-pile face-area reference may additionally be supplied with:

~~~text
--reference-face-area VALUE
--reference-face-area-unit UNIT
--reference-face-area-method METHOD
--reference-face-area-label LABEL
--reference-face-area-source SOURCE
--same-pile-reference
~~~

The terminal output distinguishes:

~~~text
measurement readiness
localization mode
scanline area
projected raster area
internal estimator disagreement
front-depth diagnostics
face-area reference comparison
comparison blockers / error metrics
~~~

Unsupported validation states therefore remain visible rather than implicit.

---

## 12. What has been demonstrated

**FACT:** the scanline measurement path is reproducible on the frozen
prelocalized pile.

**FACT:** prelocalized mode preserves all `1,577,128` input points rather than
running the automatic locator again.

**FACT:** the scanline and projected-raster estimators currently disagree by
approximately `11.162%` on this pile.

**FACT:** the front-depth detector produces 35 recession candidates.

**FACT:** the previously marked structural opening is independently detected
and ranks `#3` in the current default run.

**FACT:** incompatible area units block reference error calculation.

**FACT:** face-area comparison does not alter the existing volume-level
readiness stage.

---

## 13. What has not been demonstrated

The current work does **not** establish:

- that LAS source units are metres;
- an authoritative face area in m²;
- which current estimator best matches the intended operational boundary;
- that every recession candidate is an excluded physical void;
- which small inter-log gaps should count or be excluded;
- reliable full-scene automatic pile localization;
- validated geometric volume;
- commercial timber cubicación;
- billing-grade measurement accuracy.

No accuracy percentage should be claimed until a compatible same-pile reference
is supplied.

---

## 14. Remaining validation gates

The next useful external information is:

1. explicit CRS / physical-unit confirmation for the GS100G LAS;
2. the operator's LiDAR360 area for this exact pile;
3. preferably the actual manually drawn LiDAR360 polygon;
4. the operational rule for which visible spaces are excluded;
5. confirmation that the product length is the intended extrusion depth;
6. separate validation of automatic pile localization from the full scan;
7. validation on additional timber piles and acquisition conditions.

Only after those gates should the system progress from reproducible observable
geometry toward physical m², geometric m³, and eventual commercial validation.

---

## 15. Resulting architecture

~~~text
FULL GS100G SCENE
        │
        ▼
PileLocator
        │
        │ separate validation problem
        ▼
ISOLATED PILE
        │
        ├── FaceFrameEstimator
        ├── Scanline estimator
        ├── Projected raster estimator
        └── Front-depth / recession diagnostic
        │
        ▼
FACE-AREA REFERENCE COMPARISON
        │
        ├── same pile?
        └── compatible units?
                │
                ▼
          error metrics
                │
                ▼
      physical interpretation
                │
                ▼
      explicit product length
                │
                ▼
         geometric volume
                │
                ▼
     commercial validation
~~~

The central engineering result of this experiment is not a final area number.

It is a validation architecture in which localization, geometry, units,
reference accuracy, volume, and commercial semantics cannot silently substitute
for one another.

<!-- DOC_NAV_START -->

---

### Documentation navigation

[Project README](../../README.md) · [Docs index](../README.md) · [Findings](../findings/cubicacion_accuracy_problem.md) · [Experiments](.) · [Decisions](../decisions) · [Spanish docs](../es/README.md) · [Estado técnico](../es/estado-proyecto.md) · [Preguntas Campo Digital](../es/preguntas-campo-digital.md)

<!-- DOC_NAV_END -->
