# EXP-007 — GS100G projected-face boundary estimator comparison

**Date:** 2026-08-25
**Status:** Experimental — not reference-validated
**Dataset:** Campo Digital GS100G roadside timber stack
**Primary question:** How should the external roadside-facing gross stack boundary be defined automatically?

---

## 1. Objective

Campo Digital clarified the operational requirement as follows:

> The quantity to automate is the area of the visible vertical timber-stack face facing the road — the same face that an operator can currently draw manually in software.

The target workflow is therefore:

```text
registered GS100G LAS
        ↓
isolate the relevant timber stack / face
        ↓
construct a local face coordinate system
        ↓
orthographically project the face
        ↓
automatically infer the external gross boundary
        ↓
calculate projected face area
        ↓
after physical units are confirmed: m²
        ↓
multiply by known product length
        ↓
gross geometric stack volume
```

This experiment compares several candidate definitions of that **external gross projected boundary**.

It does **not** attempt to prove which estimator is physically correct because no trusted same-pile reference polygon or reference area has yet been supplied by Campo Digital.

---

## 2. Frozen real-data input

The experiments use the same manually isolated Campo Digital pile:

`data/interim/v01_MG_23jun2026/timber_roi/timber_stack_manual_reference_v1.las`

Point count:

`1,577,128`

This file is a useful frozen segmentation reference, but it is **not** treated as geometric ground truth.

---

## 3. Measurement semantics

### 3.1 Local face coordinates

Let:

- \( \mathbf{p}_i \) be a 3D point;
- \( \mathbf{c} \) be the local horizontal face centre;
- \( \mathbf{e}_u \) be the unit vector along the timber stack;
- \( \mathbf{e}_v \) be the transverse/depth unit vector;
- \( z_i \) be vertical elevation.

The projected longitudinal coordinate is:

```math
u_i =
\left(
\mathbf{p}_{i,xy} - \mathbf{c}
\right)
\cdot
\mathbf{e}_u
```

The projected face point is then represented as:

```math
(u_i, z_i)
```

The transverse/depth coordinate \(v_i\) is deliberately excluded from the final area calculation.

### 3.2 Why depth protrusion should not change projected area

If a log tip moves only along the transverse direction,

```math
\mathbf{p}'_i
=
\mathbf{p}_i
+
\delta \mathbf{e}_v
```

and the longitudinal and transverse axes are orthogonal,

```math
\mathbf{e}_u \cdot \mathbf{e}_v = 0
```

then:

```math
u'_i = u_i
```

and:

```math
z'_i = z_i
```

Therefore a timber end that protrudes only toward or away from the scanner does not change its orthographic `(u,z)` position.

**FACT:** this depth invariance is structural in the current projection mathematics.

**LIMITATION:** a crooked log whose visible tip also moves in \(u\) or \(z\) can still affect the projected external boundary.

---

## 4. Target geometric quantity

For an external lower boundary \(b(u)\) and upper boundary \(t(u)\), the projected gross stack face is:

```math
S =
\left\{
(u,z)
\;:\;
u_{\min} \le u \le u_{\max},
\;
b(u) \le z \le t(u)
\right\}
```

Its projected area is:

```math
A_{\text{face}}
=
\int_{u_{\min}}^{u_{\max}}
\left[
t(u)-b(u)
\right]\,du
```

Plain-language interpretation:

> At each position along the pile, measure the local vertical stack height and integrate those local heights along the entire pile.

This quantity represents the **gross external face**. Internal spaces between logs are not individually subtracted.

It is not:

- raw 3D surface area;
- convex-hull area;
- width × maximum height;
- individual-log circle area;
- solid-wood cross-sectional area;
- validated commercial cubicación.

---

## 5. Future volume relation

Campo Digital supplied a product length of 6 m for this example.

Once the projected area is validated in square metres, the requested geometric volume relation is:

```math
V_{\text{gross}}
=
A_{\text{face}}\,L
```

with:

```math
L = 6\ \mathrm{m}
```

Therefore:

```math
V_{\text{gross}}
=
6\,A_{\text{face}}
```

when \(A_{\text{face}}\) is expressed in m².

**IMPORTANT:** the current LAS physical coordinate units are still unconfirmed, so none of the experimental areas below are labelled m².

All current values remain:

`source-units²`

---

## 6. Candidate A — robust local quantile envelope

### 6.1 Definition

The existing estimator divides the stack longitudinally into bins.

Within bin \(j\), it estimates:

```math
b_j =
Q_{q_b}
\left(
z_i \mid u_i \in B_j
\right)
```

and:

```math
t_j =
Q_{q_t}
\left(
z_i \mid u_i \in B_j
\right)
```

where:

- \(Q_q\) is a quantile operator;
- \(q_b\) is the lower boundary quantile;
- \(q_t\) is the upper boundary quantile;
- \(B_j\) is longitudinal bin \(j\).

The local height is:

```math
h_j = \max(0,t_j-b_j)
```

and the area is approximated numerically from the height profile.

Baseline configuration:

- longitudinal bins: `160`
- longitudinal quantiles: `0.01–0.99`
- vertical quantiles: `0.02–0.98`
- minimum points per longitudinal bin: `250`

Baseline result:

```text
254.19972064748094 source-units²
```

This number is an estimator output, **not ground truth**.

---

### 6.2 Longitudinal-bin sensitivity

With vertical quantiles held at `0.02–0.98`:

| Bins | Area (source-units²) | Delta vs 160 bins |
|---:|---:|---:|
| 80 | 253.963710 | -0.093% |
| 120 | 254.112289 | -0.034% |
| 160 | 254.199721 | 0.000% |
| 240 | 253.772470 | -0.168% |
| 320 | 253.715561 | -0.190% |

The relative bin-resolution deviation can be written as:

```math
\Delta_{\text{bins}}
=
\frac{
A_{\text{bins}}-A_{160}
}{
A_{160}
}
\times 100
```

**FACT:** changing the number of longitudinal bins from 80 to 320 — a 4× resolution change — changes the q02–q98 area by less than approximately 0.2%.

**INFERENCE:** numerical longitudinal discretization is not a major uncertainty source on this frozen pile.

---

### 6.3 Vertical-quantile sensitivity

At 160 longitudinal bins:

| Vertical quantiles | Area (source-units²) | Delta vs q02–q98 |
|---|---:|---:|
| 0.01–0.99 | 260.514665 | +2.484% |
| 0.02–0.98 | 254.199721 | 0.000% |
| 0.03–0.97 | 248.653060 | -2.182% |
| 0.05–0.95 | 237.823799 | -6.442% |

Across all tested quantile configurations:

```math
A_{\max}-A_{\min}
=
260.6393467
-
237.0978624
=
23.5414843
```

Relative to the q02–q98 baseline:

```math
\frac{
23.5414843
}{
254.1997206
}
\times 100
\approx
9.261\%
```

**FACT:** the scanline family is highly stable to longitudinal bin count but materially sensitive to the chosen top/bottom quantiles.

**LIMITATION:** no tested quantile pair can be declared physically correct without a reference contour or area.

**CURRENT ROLE:** strongest numerical baseline and independent QC estimator.

---

## 7. Candidate B — binary projected raster

### 7.1 Definition

Projected points are discretized into a 2D grid:

```math
R_{jk}
=
\begin{cases}
1, & \text{if cell }(j,k)\text{ contains sufficient evidence} \\
0, & \text{otherwise}
\end{cases}
```

The implemented V1 then:

1. removes small disconnected components;
2. optionally performs morphological closing;
3. retains the principal connected component;
4. fills enclosed internal holes;
5. calculates gross raster area.

The filled-cell estimator is:

```math
A_{\text{raster}}
=
N_{\text{filled}}\,
\Delta u\,
\Delta z
```

where:

- \(N_{\text{filled}}\) is the number of filled cells;
- \(\Delta u\) is longitudinal cell size;
- \(\Delta z\) is vertical cell size.

---

### 7.2 Initial cell-size sensitivity

Initial real-data results:

| Cell size | Raster area (source-units²) |
|---:|---:|
| 0.020 | 274.084 |
| 0.050 | 284.250 |
| 0.075 | 288.332 |
| 0.100 | 290.920 |
| 0.150 | 297.427 |

After matching the scanline longitudinal trim (`u = 0.01–0.99`):

| Configuration | Final area |
|---|---:|
| 0.020 / min points 1 | 263.2972 |
| 0.050 / min points 1 | 270.2100 |
| 0.050 / min points 2 | 268.0750 |
| 0.050 / min points 3 | 266.4100 |

---

### 7.3 Raster-stage attribution

At:

```text
cell size = 0.020
u trim = 0.01–0.99
min points = 1
```

the area contributions were:

| Stage | Area (source-units²) |
|---|---:|
| Raw occupancy | 212.3044 |
| Denoised occupancy | 211.7980 |
| Principal component | 211.5084 |
| Hole filling added | 51.7888 |
| Final filled area | 263.2972 |

At:

```text
cell size = 0.050
u trim = 0.01–0.99
min points = 1
```

the corresponding values were:

| Stage | Area (source-units²) |
|---|---:|
| Raw occupancy | 267.4650 |
| Denoised occupancy | 267.4400 |
| Principal component | 267.4400 |
| Hole filling added | 2.7700 |
| Final filled area | 270.2100 |

**FACT:** at very fine raster resolution, projected evidence fragments strongly and hole filling becomes a major part of the final area.

**FACT:** at 0.05 source-unit cells, topology becomes substantially more stable and hole filling contributes only 2.77 source-units².

**INFERENCE:** raster resolution changes the topology of the projected evidence and therefore materially changes the measured area.

---

## 8. Sub-cell marching-squares contour experiment

A 0.5-level contour was extracted from the filled binary raster.

The purpose was to test whether counting complete boundary cells was causing most of the raster-area inflation.

Results:

| Cell size | Filled-cell area | Sub-cell contour area | Relative difference |
|---:|---:|---:|---:|
| 0.020 | 263.2972 | 263.2104 | 0.033% |
| 0.050 | 270.2100 | 270.1912 | 0.007% |
| 0.075 | 273.3750 | 273.3666 | 0.003% |
| 0.100 | 275.5000 | 275.4900 | 0.004% |
| 0.150 | 280.9350 | 280.9237 | 0.004% |

The relative disagreement was calculated as:

```math
D_{\text{raster-contour}}
=
\frac{
\left|
A_{\text{raster}}-A_{\text{contour}}
\right|
}{
\frac{1}{2}
\left(
A_{\text{raster}}+A_{\text{contour}}
\right)
}
\times 100
```

**FACT:** marching-squares sub-cell contouring changes the area negligibly.

**CONCLUSION:** complete boundary-cell counting is not the dominant source of raster resolution sensitivity.

The relevant information loss occurs earlier, when projected point evidence is converted into binary occupied support.

**DECISION:** do not promote marching-squares contour area as an authoritative estimator.

---

## 9. Candidate C — density-supported vertical envelope

### 9.1 Definition

Instead of choosing fixed vertical quantiles, each longitudinal slice is divided into vertical cells.

Let:

```math
d_j(z)
```

be a smoothed vertical point-density profile in longitudinal bin \(j\).

Supported vertical evidence is defined by:

```math
d_j(z)
\ge
\tau
\max_z d_j(z)
```

where:

- \(\tau\) is a relative density threshold;
- the first retained supported vertical region defines the lower extent;
- the last retained supported vertical region defines the upper extent.

This attempts to infer the boundary from persistent point support rather than fixed percentiles.

---

### 9.2 Tested parameter space

Vertical cell sizes:

- `0.020`
- `0.050`
- `0.075`
- `0.100`

Relative density thresholds:

- `0.01`
- `0.02`
- `0.05`
- `0.10`

---

### 9.3 Results

| dz | Density threshold | Area (source-units²) |
|---:|---:|---:|
| 0.020 | 0.010 | 276.2203 |
| 0.020 | 0.020 | 274.7554 |
| 0.020 | 0.050 | 272.7822 |
| 0.020 | 0.100 | 270.2574 |
| 0.050 | 0.010 | 283.0449 |
| 0.050 | 0.020 | 281.0307 |
| 0.050 | 0.050 | 277.3470 |
| 0.050 | 0.100 | 274.1049 |
| 0.075 | 0.010 | 289.2868 |
| 0.075 | 0.020 | 286.6210 |
| 0.075 | 0.050 | 282.0163 |
| 0.075 | 0.100 | 277.8155 |
| 0.100 | 0.010 | 295.6257 |
| 0.100 | 0.020 | 292.4159 |
| 0.100 | 0.050 | 286.1901 |
| 0.100 | 0.100 | 281.5585 |

Global tested range:

```math
295.6257-270.2574
=
25.3683
```

Relative to the q02–q98 scanline baseline:

```math
\frac{
25.3683
}{
254.1997
}
\times 100
\approx
9.98\%
```

**FACT:** the density-supported estimator is sensitive to both vertical resolution and the density threshold.

**CONCLUSION:** it does not remove calibration ambiguity; it replaces one boundary parameter with at least two.

**DECISION:** reject as the primary V1 estimator.

---

## 10. Candidate D — concave-hull family

### 10.1 Definition

Shapely 2.1.2 `concave_hull()` was applied to the external raster-boundary evidence.

Let:

- \(B_\Delta\) be projected boundary points extracted at raster scale \(\Delta\);
- \(H_r(B_\Delta)\) be the concave hull at ratio \(r\).

The hull area is:

```math
A_{\text{hull}}(r,\Delta)
=
\operatorname{Area}
\left(
H_r(B_\Delta)
\right)
```

This is not identical to the classical alpha-shape formulation used in some forestry literature, but it evaluates the same broad family of concave external-boundary estimators.

---

### 10.2 Broad ratio sweep

Across raster sizes:

- `0.020`
- `0.050`
- `0.075`
- `0.100`

the fixed-ratio area ranges were:

| Hull ratio | Area range across raster sizes | Range relative to q02 scanline |
|---:|---:|---:|
| 0.05 | 279.0518–282.3947 | 1.315% |
| 0.10 | 282.9724–286.6528 | 1.448% |
| 0.20 | 286.9162–290.6016 | 1.450% |
| 0.30 | 289.7680–295.0875 | 2.093% |
| 0.50 | 294.4837–299.6550 | 2.034% |
| 0.80 | 309.7168–313.7653 | 1.593% |
| 1.00 | 316.8928–321.0412 | 1.632% |

**FACT:** for a fixed hull ratio, the concave-hull family is substantially more stable across raster resolutions than the raw raster estimator.

**FACT:** changing the hull ratio itself materially changes the inferred external area.

---

### 10.3 Low-ratio sweep

A more detailed low-ratio sweep was run at raster sizes `0.050` and `0.075`.

| Ratio | Area @ 0.050 | Area @ 0.075 | Cross-resolution delta |
|---:|---:|---:|---:|
| 0.000 | 100.8138 | 221.3775 | 120.5637 |
| 0.002 | 268.5425 | 269.2659 | 0.7234 |
| 0.005 | 270.9450 | 271.8337 | 0.8888 |
| 0.010 | 273.4000 | 274.3144 | 0.9144 |
| 0.020 | 276.2537 | 277.5319 | 1.2781 |
| 0.030 | 278.3262 | 279.8831 | 1.5569 |
| 0.040 | 279.5312 | 281.2444 | 1.7131 |
| 0.050 | 280.8100 | 282.3947 | 1.5847 |
| 0.075 | 283.2062 | 285.0159 | 1.8097 |
| 0.100 | 284.4237 | 286.6528 | 2.2291 |

For a fixed hull ratio, define cross-resolution sensitivity as:

```math
S_r
=
\frac{
\max_\Delta A_{\text{hull}}(r,\Delta)
-
\min_\Delta A_{\text{hull}}(r,\Delta)
}{
A_{\text{scan},02-98}
}
\times 100
```

Measured low-ratio sensitivity:

| Ratio | Cross-resolution sensitivity |
|---:|---:|
| 0.002 | 0.285% |
| 0.005 | 0.350% |
| 0.010 | 0.360% |
| 0.020 | 0.503% |
| 0.030 | 0.612% |
| 0.040 | 0.674% |
| 0.050 | 0.623% |
| 0.075 | 0.712% |
| 0.100 | 0.877% |

The `ratio=0` result is extremely unstable:

```text
100.8138 vs 221.3775 source-units²
```

and should not be interpreted as a useful physical limiting case.

**FACT:** ratios approximately `0.002–0.010` show strong cross-resolution stability.

**FACT:** within that apparently stable regime, changing the ratio still shifts the area from approximately `268.5` to `274.3 source-units²`.

**INFERENCE:** the concave-hull family has useful geometric stability with respect to raster scale, but the hull-tightness parameter still determines the physical boundary materially.

**LIMITATION:** there is no defensible basis to choose one hull ratio without an external reference boundary.

**CURRENT ROLE:** promising validation/candidate estimator, not authoritative.

---

## 11. Comparison of estimator families

| Estimator | Main strength | Main weakness | Current decision |
|---|---|---|---|
| Robust quantile scanline | Excellent bin-resolution stability; fast; interpretable | Boundary quantiles require validation | **Keep as strongest baseline/QC** |
| Binary raster area | Useful topology and visual evidence | Strong raster-scale dependence | **Keep for QA, not authoritative area** |
| Sub-cell raster contour | Explicit polygonal contour | Almost identical to raster-cell area | **No demonstrated measurement benefit** |
| Density-supported envelope | Boundary based on point support | Sensitive to grid and density threshold | **Reject as primary V1** |
| Concave hull | Strong cross-resolution stability at fixed low ratio | Hull ratio materially changes area | **Keep as experimental candidate** |
| Exact alpha shape | Direct forestry precedent | Requires its own calibration | **Defer until client reference justifies it** |
| Convex hull | Simple | Bridges true concavities and over-expands boundary | **Reject** |
| Raw 3D surface | Uses full geometry | Measures the wrong observable for protruding logs | **Reject** |
| Individual-log circles | Relevant for solid wood | Solves a different problem | **Out of current scope** |

---

## 12. What the experiments have ruled out

The dominant uncertainty is **not**:

- rectangle-rule versus trapezoidal quadrature;
- number of longitudinal bins;
- pure transverse/depth protrusion;
- full-cell versus sub-cell raster boundary counting;
- raw computation time.

The dominant remaining uncertainty is:

> **How should sparse outer evidence be interpreted when defining the physical external gross stack boundary?**

This is the central scientific problem remaining in the current PoC.

---

## 13. Reference-validation model

Once Campo Digital supplies a trusted same-pile reference area:

```math
A_{\text{ref}}
```

the absolute area error is:

```math
E_{\text{abs}}
=
\left|
A_{\text{candidate}}
-
A_{\text{ref}}
\right|
```

The relative area error is:

```math
E_{\text{rel}}
=
\frac{
\left|
A_{\text{candidate}}
-
A_{\text{ref}}
\right|
}{
A_{\text{ref}}
}
\times 100
```

If the product length \(L\) is known exactly, then:

```math
V = A L
```

and therefore:

```math
\frac{\Delta V}{V}
=
\frac{\Delta A}{A}
```

In plain language:

> If the 6 m product length is exact, a 2% face-area error produces a 2% geometric-volume error.

---

## 14. Required data from Campo Digital

The next validation step requires, for this exact GS100G pile:

1. the manually measured / LiDAR360 roadside-face area;
2. preferably the actual polygon or contour used to calculate that area;
3. confirmation that the requested quantity is gross external face area;
4. confirmation that internal spaces between logs are included;
5. confirmation of LAS coordinate units and CRS;
6. confirmation that the product length is exactly 6 m for this pile;
7. confirmation that the desired volume is exactly face area × product length;
8. acceptable commercial error tolerance;
9. current manual processing time.

A reference polygon is more informative than a scalar area because it allows both area error and boundary-location error to be evaluated.

---

## 15. Current engineering decision

Do **not** declare any experimental estimator authoritative yet.

Keep:

- the robust scanline estimator as the most numerically stable independent baseline;
- the projected raster as topological and visual evidence;
- the low-ratio concave-hull family as an experimental candidate.

Do not promote:

- the density-supported envelope;
- the marching-squares contour;
- an arbitrary concave-hull ratio.

Do not tune any method merely to reproduce:

```text
254.199721 source-units²
```

That value is a stable estimator output.

It is **not ground truth**.

---

## 16. Scientific status

### 16.1 Established from the current experiments

- The requested observable is a projected roadside-facing stack face.
- The problem can be represented in a local 2D `(u,z)` frame after pile localization.
- Pure depth displacement does not alter projected area by construction.
- The robust scanline estimator is highly stable to longitudinal discretization.
- Vertical boundary definition materially affects scanline area.
- Binary-raster area is sensitive to raster resolution.
- Marching-squares contouring does not remove raster-area sensitivity.
- Density-supported boundaries remain parameter-sensitive.
- Concave hulls show strong cross-resolution stability in a low-ratio regime.
- Hull tightness still materially controls the resulting area.

### 16.2 Not yet established

- Physical LAS units.
- Correct external gross-face boundary.
- Correct quantile values.
- Correct hull ratio.
- Accuracy relative to Campo Digital's manual workflow.
- Generalization to other piles.
- Full-scene automatic pile localization.
- Final validated volume.
- Commercial acceptance threshold.

---

## 17. Next decision gate

The next meaningful scientific step is **reference validation**, not another arbitrary estimator.

The comparison should eventually become:

```text
Campo Digital reference polygon / area
                │
        ┌───────┼─────────┐
        ▼       ▼         ▼
   scanline   raster   concave hull
        │       │         │
        └───────┼─────────┘
                ▼
       error + stability + runtime
                ▼
       choose production estimator
```

Until that reference exists, estimator differences must remain labelled as methodological uncertainty rather than accuracy.


---

## 18. Front-depth visibility refinement

### 18.1 Why immediate 2D projection is insufficient

The original projected-face formulation treated the transverse/depth
coordinate \(v\) as irrelevant to the final face area and therefore discarded
it before constructing the `(u,z)` representation.

The final **area coordinate system is still two-dimensional**, but the real
GS100G diagnostics showed that dropping \(v\) immediately can destroy
visibility information.

A structural opening in the visible timber face may contain returns from
ground, timber, or other geometry farther behind the roadside-facing surface.

If all points are collapsed directly:

```math
(u_i,v_i,z_i)
\longrightarrow
(u_i,z_i)
```

then a rear or background return may occupy a projected cell that is visually
an opening in the actual front-facing timber surface.

The refined formulation is:

```math
(u_i,v_i,z_i)
\longrightarrow
\text{front/rear visibility classification}
\longrightarrow
(u_i,z_i)
\longrightarrow
A_{\text{face}}
```

**FACT:** transverse depth is not part of the final 2D face-area integral.

**FACT:** transverse depth is useful before projection because it contains
front/rear visibility information.

**DECISION:** preserve \(v\) until front-facing evidence has been classified.

---

### 18.2 Front-depth image

For each occupied projected `(u,z)` cell, define a robust front-most
transverse depth:

```math
v_{\text{front}}(u,z)
=
Q_{q_f}
\left(
v_i
\mid
(u_i,z_i) \in C_{u,z}
\right)
```

where:

- \(C_{u,z}\) is one projected raster cell;
- \(Q_{q_f}\) is a robust front-side order statistic;
- transverse orientation is normalized so that lower values represent the
  selected visible/front side.

The reusable implementation accepts the front orientation explicitly:

```text
front_side = "low_v"
```

or:

```text
front_side = "high_v"
```

It does not infer scanner orientation from Campo-specific assumptions.

Future acquisition or trajectory logic should resolve this value upstream.

---

### 18.3 Positive-depth recession

Let:

```math
\hat{v}_{\text{front}}(u,z)
```

be the locally expected visible front surface.

Define positive recession as:

```math
r(u,z)
=
\max
\left(
v_{\text{front}}(u,z)
-
\hat{v}_{\text{front}}(u,z),
0
\right)
```

A continuous front-facing timber surface should generally have relatively
small recession.

When the visible timber surface disappears and the nearest return lies farther
behind, recession becomes larger.

Such a region can represent:

- a structural opening;
- geometry visible through a gap;
- a locally recessed part of the pile;
- or another front-visibility discontinuity.

These regions are currently **candidates only**.

They are not automatically treated as confirmed physical voids.

---

### 18.4 Fixed front-depth band experiment

A preliminary model estimated only a longitudinal front-depth function:

```math
v_f(u)
```

and retained points inside a fixed transverse band.

On the selected real cavity region, projected occupancy changed monotonically:

| Selection | Probe occupancy |
|---|---:|
| All depths | 0.984 |
| Front band ≤ 0.40 | 0.727 |
| Front band ≤ 0.25 | 0.502 |
| Front band ≤ 0.15 | 0.318 |
| Front band ≤ 0.10 | 0.239 |
| Front band ≤ 0.05 | 0.142 |

**FACT:** transverse depth strongly separates front and rear evidence.

**FACT:** the sweep did not show a stable fixed-band plateau.

**CONCLUSION:** a global or longitudinal-only depth band is too crude for the
irregular face.

**DECISION:** do not encode a magic GS100G depth-band threshold.

---

### 18.5 Local depth-continuity experiment

A second experiment connected neighbouring `(u,z)` cells only when their
front-depth values were sufficiently similar.

The local condition was:

```math
\left|
v_i - v_j
\right|
\le
\tau_{\text{step}}
```

Results:

| Maximum local depth step | Principal fraction of valid cells | Known-region fraction in principal |
|---:|---:|---:|
| 0.05 | 0.9096 | 0.7171 |
| 0.10 | 0.9833 | 0.9285 |
| 0.15 | 0.9916 | 0.9697 |
| 0.20 | 0.9967 | 0.9903 |
| 0.30 | 0.9988 | 0.9979 |

**FACT:** a strict depth-step threshold begins separating the cavity but also
fragments legitimate front-surface evidence.

**FACT:** modestly larger thresholds reconnect almost the complete surface.

**CONCLUSION:** pairwise depth continuity alone is not sufficient.

The stronger reusable signal is coherent **positive recession relative to a
local front surface**.

---

### 18.6 Full-wall automatic recession detection

The positive-recession detector was run across the complete frozen manually
isolated GS100G wall.

The known cavity position supplied from visual inspection was used **only
after detection for evaluation**.

It was not used to:

- construct the front-depth image;
- estimate the expected front surface;
- choose the recession threshold;
- form candidate regions;
- or rank the candidates.

The known cavity was automatically detected at all three tested spatial
scales:

| Surface scale | Rank of known cavity | Total candidates |
|---:|---:|---:|
| 1.0 | 2 | 43 |
| 2.0 | 3 | 35 |
| 3.0 | 5 | 23 |

#### Scale 1.0

```text
candidate area       0.8925 source-units²
median recession     0.8249 source units
maximum recession    1.9038 source units
recession score      0.7678 source-units³
u range              -25.55 to -23.40
z range              280.34 to 281.84
```

#### Scale 2.0

```text
candidate area       0.8375 source-units²
median recession     1.0503 source units
maximum recession    1.9038 source units
recession score      0.9086 source-units³
u range              -25.55 to -23.40
z range              280.54 to 281.84
```

#### Scale 3.0

```text
candidate area       0.5625 source-units²
median recession     1.1677 source units
maximum recession    1.9038 source units
recession score      0.6722 source-units³
u range              -25.55 to -23.55
z range              280.74 to 281.84
```

**FACT:** the same real structural opening remains a high-ranking automatic
candidate across multiple spatial scales.

**INFERENCE:** positive-depth recession contains useful repeatable information
for detecting front-face visibility discontinuities.

**LIMITATION:** the other automatically detected regions have not yet been
classified by Campo Digital, so detector precision is not established.

---

### 18.7 Reusable implementation

The experimental method was converted into:

`src/lidar_volume/front_depth.py`

The reusable API exposes:

```text
estimate_front_depth_image(...)
detect_recessed_regions(...)
```

The implementation contains no:

- Campo Digital coordinates;
- known-cavity coordinates;
- GS100G-specific calibration constant;
- 6 m timber length;
- LiDAR360 assumption;
- physical-unit inference;
- commercial cubicación rule.

Synthetic tests verify:

- a planar wall produces no false cavity;
- rear returns visible through a synthetic cavity are detected;
- a gradual depth slope is not treated as a cavity;
- XY translation invariance;
- XY rotation invariance;
- non-unit longitudinal-axis normalization;
- point-order invariance;
- symmetric `low_v` and `high_v` behavior;
- invalid front-side values are rejected.

The rotation-invariance test exposed a floating-point raster-boundary defect.

A mathematically identical coordinate could become:

```text
2.9999999999999996
```

instead of:

```text
3.0000000000000000
```

after rigid rotation, causing equivalent points to fall into adjacent raster
cells.

Stable normalized grid indexing was added to prevent that coordinate-frame
artifact.

Focused front-depth tests:

```text
10 passed
```

---

### 18.8 Real-data validation of the reusable implementation

The reusable implementation was then run directly on the frozen GS100G pile.

Observed input:

```text
input points              1,577,128
projected working points  1,535,717
valid front-depth cells     100,444
front-depth grid            163 × 1379
```

The known real cavity again ranked:

```text
surface scale 1.0 → rank #2
surface scale 2.0 → rank #3
surface scale 3.0 → rank #5
```

This reproduces the earlier scratch experiment using the reusable module.

Measured development-machine runtimes were:

```text
face-frame estimation        0.174 s
front-depth image             0.330 s
three recession scales        0.088 s
------------------------------------
combined geometry chain       0.592 s
```

These are observed development-machine timings, not performance guarantees.

**FACT:** the reusable implementation reproduces the real-data cavity signal.

**FACT:** the known cavity coordinate is not required by the detector.

**LIMITATION:** front-side orientation is currently supplied explicitly.

---

### 18.9 Pipeline integration semantics

Front-depth/recession analysis is integrated as an **opt-in diagnostic layer**.

With:

```text
front_side = None
```

the existing measurement path remains unchanged.

With an explicit front orientation:

```text
front_side = "low_v"
```

or:

```text
front_side = "high_v"
```

the pipeline additionally produces:

```text
FrontDepthImage
        ↓
FrontRecessionEstimate
        ↓
MeasurementRun.front_depth
        ↓
front_depth_recession.json
front_depth_recession.png
```

Persisted semantics explicitly state:

```text
estimator_status = experimental_candidate
authoritative_measurement = false
reference_validated = false
confirmed_physical_voids = false
subtracted_from_face_area = false
affects_volume = false
affects_readiness = false
commercial_cubicacion = false
```

Therefore front-depth analysis currently provides visibility evidence and QA.

It does **not** yet modify the measured face area.

---

### 18.10 Updated measurement architecture

The refined architecture is:

```text
registered point cloud
        ↓
PileLocator
        ↓
FaceFrameEstimator
        ↓
local coordinates (u,v,z)
        ↓
FrontDepthImage
        ↓
FrontRecessionDetector
        ↓
candidate visibility / structural-gap regions
        ↓
ProjectedFaceRegionEstimator
        ↓
candidate projected face area
        ↓
reference validation
        ↓
physical interpretation
        ↓
known product length
        ↓
geometric volume
```

The central separation is:

```text
3D / transverse depth
        ↓
visibility classification

2D projected face
        ↓
area calculation
```

This keeps the measurement geometry independent of the original scanner model.

---

### 18.11 Remaining validation gates

The front-depth result does not remove the main unresolved validation
requirements.

Still required:

1. Campo Digital's reference area for this exact pile.
2. Preferably the actual manually drawn reference polygon.
3. Confirmation of which detected recessed regions should be excluded.
4. Physical LAS units and CRS.
5. Reliable automatic localization from the full scan.
6. Automatic determination of which transverse direction is the visible side.
7. Validation on additional timber piles and acquisition conditions.

The strongest next external datum is therefore not another arbitrary algorithm
parameter.

It is Campo Digital's reference contour plus human classification of the
automatically detected recessed regions.

<!-- DOC_NAV_START -->

---

### Documentation navigation

[Project README](../../README.md) · [Docs index](../README.md) · [Findings](../findings/cubicacion_accuracy_problem.md) · [Experiments](.) · [Decisions](../decisions) · [Spanish docs](../es/README.md) · [Estado técnico](../es/estado-proyecto.md) · [Preguntas Campo Digital](../es/preguntas-campo-digital.md)

<!-- DOC_NAV_END -->
