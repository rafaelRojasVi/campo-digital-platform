# Forestry Dashboard V1

## Status

Implemented 2026-08-30 on top of [Read API V1](read-api-v1.md), following the
projection boundaries of [Product Projection V1](product-projection-v1.md).

This is the first visual Forestry application: a read-only, map-centric web
dashboard over the persisted Degenfeld snapshot, in Spanish, aimed at the
stakeholder (Javier / a forestry project manager). It preserves the evidence
discipline of the backend: every label is a source fact, a literal field
comparison, or quality evidence — never workflow status, progress, approval,
or canonical identity.

Code: `products/forestry/dashboard/` (Vite + React 19 + TypeScript, Leaflet
1.9, proj4). Launcher: `scripts/forestry_dev.py` via `make forestry-dev` /
`forestry-status` / `forestry-stop`.

## Information architecture

```text
Header      brand · "Patrimonio Degenfeld" · Mapa · Informes · Versiones ·
            the version on the map (N.º, upload date)
Sidebar     search · filters (predio, uso 2026, especie, rodal; progressive
            disclosure: uso 2024, descripción, códigos, comparaciones,
            validez, evidencia de calidad) · «Agregar … a un informe» once
            a filter is set · color dimension + legend
Map         dominant surface (Leaflet, canvas renderer), satellite by
            default, predio names over the overview
Bottom      closed on arrival; tabs synchronized with the filtered set:
            Tabla (paginated) · Cambios 2024 → 2026 (literal comparison) ·
            Revisión de la base (provenance: layer, EPSG, fingerprint;
            KPI strip; quality evidence classes)
Inspector   right panel (desktop) / bottom sheet (mobile) per selected
            polygon: «Agregar a un informe», especie, uso, código,
            descripción, superficie; source evidence behind «Detalle técnico»
```

**DECISION** (2026-10-18) — The map is for looking and choosing; splitting
and reporting happen in a named report (Informes). A design review of all
Rodales screens found the V1 review-first layout in the way of everyday
use: six technical KPIs and the layer/EPSG/fingerprint provenance above
the map, the bottom panel and inspector leaving the map under half the
screen, a second editing tool on the map («Simular ajuste») that saved
nothing, and «Cargar versión» twice. Changes: the provenance and KPI strip
moved into «Revisión de la base»; the bottom panel starts closed; the
inspector leads with plain facts; «Cargar versión» is only the button on
Versiones; the simulation was removed (see below); the map links to the
report editor through «Agregar a un informe».

**DECISION** (2026-10-18) — «Agregar a un informe» (inspector: the selected
polygon; sidebar: the filtered set, up to 300 polygons) lists the editable
reports (borrador, cambios solicitados) built on the same base version, or
creates one. It writes the editor's clipboard (`lib/reportClipboard.ts`)
and opens the editor with `?pegar=1`; the editor pastes once on load,
drops the parameter, and the draft starts unsaved. Viewers and a preview of
a non-published version get no «Agregar».

**DECISION** (2026-10-18) — Satellite imagery (Esri) is the default
background on the map, as in the report editor: Campo Digital asked for the
imagery («Google Earth o Esri»). The estate spans about 45 × 70 km, so the
fit-to-estate view shows the smaller predios as specks; below zoom 13 each
predio's name sits on its largest polygon, biggest predios first, dropping
names that would overlap another name or the map controls. Each name is a button
(click or Enter): it fits the map to that predio's visible polygons.

**DECISION** (2026-10-18) — Ctrl/Cmd + «+» and Ctrl/Cmd + «−» zoom the map
(the Mapa and the report editor) while the pointer is over it or focus is
inside it (`src/lib/keyboardZoom.ts`). Elsewhere on the page the browser's
own page zoom is untouched.

## Map tools (2026-10-18)

Taken from what QGIS, ArcMap and Google Earth users expect, sized for people
without GIS training:

- **DECISION** — Rodal labels: from zoom 14, every visible polygon at least
  44 px across shows its rodal number in bold and its 2026 code under it,
  biggest polygons first, up to 300, dropping labels that would overlap
  another or the map controls. The anchor is an interior point
  (`src/lib/labelPoint.ts`: a 12×12 grid over the largest part, the point
  farthest from every edge), because a C-shaped or holed rodal's bbox
  centre can fall outside it.
- **DECISION** — Multi-selection: Mayús/Ctrl + clic adds or removes a
  polygon; Mayús + drag selects every visible polygon whose interior point
  lies in the box (Leaflet's own box zoom is off). Two or more selected open
  «N polígonos seleccionados»: total Sup_ha, hectares per species, the list,
  «Agregar a un informe». Esc clears.
- **DECISION** — «Medir»: one click per point; length along the points and,
  from three points, the enclosed area, both planar in EPSG:32718 (as
  Sup_ha), shown in m/km and ha (`src/lib/measure.ts`). Clicks while
  measuring never select. Esc ends.
- **DECISION** — «Mi ubicación»: the browser's geolocation (asks first),
  drawn with its accuracy circle; the rodal under it opens in the inspector
  and a status line names it. Needs `geolocation=(self)` on `/rodales`
  (hosted-release-v1.md). The position is never sent or stored.
- **DECISION** — Cursor coordinates in UTM 18S at the bottom left (desktop
  only).
- **RESULT** (2026-10-18, local dev, snapshot 1) — Mayús + drag over
  Hacienda Trinidad selected 31 polygons, 53.78 ha, 20.56 ha of P. radiata;
  a simulated position inside rodal 766 named it and opened it; a 4-point
  measurement gave 546 m and 3.31 ha.

**FACT** — The thin rectangular lines visible over the satellite view are
seams of Esri's imagery mosaic, not source geometry: no polygon in snapshot
1 spans more than 8 km.

**DECISION** — The full feature collection (~9.15 MB, 1,568 features) is
loaded once from `/api/forestry/.../feature-collection`; all filtering,
search, aggregation, and pagination run client-side over that set, so map,
table, legend, and export stay synchronized instantly without re-downloading
geometry. Server endpoints provide provenance-grade numbers (summary,
comparison, per-feature detail on selection). Measured behavior at pilot
scale justified the simple architecture (see Performance).

## Map stack and projection handling

**DECISION** — Leaflet 1.9 with the canvas renderer, chosen as the simplest
appropriate option for 1,568 polygons (the prior standalone dashboard was
also Leaflet). No vector tiles, tile server, or GIS frontend framework.

**DECISION** — Stored geometry is served in EPSG:32718 exactly as persisted;
the browser reprojects for display only via proj4
(`+proj=utm +zone=18 +south +datum=WGS84`). The transformation is explicit
(`src/lib/proj.ts`) and unit-tested against pyproj-derived fixtures over the
observed snapshot envelope (agreement within 1e-6°, ≈0.1 m). The persisted
source geometry object is never mutated (guarded by test).

- Basemap: OpenStreetMap raster tiles (key-free, attributed), toggleable;
  the application is fully functional without tiles — the forestry polygons
  remain the authoritative visual evidence.
- Fractional zoom (`zoomSnap 0.25`) so fitting the sparse estate envelope
  (≈45 × 70 km for 104 km² of polygons) does not snap a full zoom level out.
- Interactions: hover tooltip (predio, rodal, uso, ha), click to select,
  zoom-to-selection, "Ajustar a resultados", scale control.
- Cartographic readability rules established during browser QA:
  - the white boundary stroke appears from zoom 12 up, or whenever the
    filtered subset is ≤ 200 polygons (1,568 white strokes at estate scale
    washed the fills out);
  - **representative point markers**: in a filtered subset (≤ 200), any
    polygon smaller than ~8 px at the current resolution gets a centroid
    dot in its dimension color — the 72 changed polygons total ≈ 154 painted
    pixels at estate zoom and were effectively invisible without this.

## Visual encoding

Color dimensions (selector + legend): `Uso 2026` (default), `Uso 2024`,
`Especie`, `Predio`, `Comparación 2024 → 2026`, `Evidencia de calidad`.

**DECISION** — Categorical dimensions assign the 8 validated hues of the
dataviz reference palette in descending `Sup_ha` order; vocabularies beyond
8 values fold into a neutral "Otros" gray, blank source values into their own
gray. Colors are assigned over the full collection so they stay stable while
filters change. The palette order passes the CVD validator's adjacent-pair
gates (worst adjacent ΔE 9.1 protan; normal-vision floor 19.6); as documented
in the palette reference, no 8-hue set passes all-pairs, so identity is never
color-alone: hover tooltips, the legend (click-to-filter), and the table
carry it. The legend doubles as the factual area distribution (swatch, value,
Sup_ha sum, proportional bar, polygon count).

**DECISION** — No semantic color mapping (no green = forest, no red = bad):
hues follow area rank only, because land-class meanings are unconfirmed and
colors must not imply business semantics. The comparison dimension uses one
neutral blue for "campos distintos" vs light gray; quality evidence uses one
orange for "con evidencia" — explicitly labeled as literal field differences
and *evidencia de calidad de datos* respectively.

## Species (2026-10-18)

Campo Digital's first daily question is "¿cuál es la superficie de rodales
por especie?" (Javier's answers, 2026-10-15). The `Especie` color dimension
and the `Especie` filter answer it from `CodUso_2026`
(`products/forestry/dashboard/src/lib/species.ts`).

- **FACT** — Javier confirmed on 2026-10-15 that codes such as `Pi06`,
  `En11`, `Eg03`, `Po99` are species + plantation year, that `Rn` is
  renoval, `Rzg` rezagado, `??` an unknown year, and that compound codes
  (`Po99Eg97`) are mixed plantations.
- **FACT** — In `Gdb_Degenfeld2026_mv`, `DescUso` names the species for the
  prefixes `Pi` (Plantacion de P. radiata), `Po` (P. oregon), `En`
  (E. nitens), `Eg` (E. globulus), `Ar` («Regeneracion de Aromo» on `Ar Rn`,
  «AROMO» on `Ar`) and `Ro` («AROMO ROBLE» on `Ar Ro`; «Renovales de
  Nothofagus» on `Ro`).
- **INFERENCE** — `Co` coigüe, `Ra` raulí, `Ul` ulmo and `Te` tepa: their
  rows only say «Plantacion de nativas»; the names are the usual Chilean
  abbreviations, sent to Javier for correction.
- **OPEN QUESTION** — `Al`, `Se`, `Ci`, `Ss` (3.66 ha of 10,422.61 ha).
  They are shown as «<code> (especie por confirmar)».

**DECISION** — Reading rule: only the code's first word is read (later words
such as `Pi Rn` or `Rzg` describe regeneration around the stand); an all-caps
prefix before the species is skipped (`CPLCo06` → coigüe); codes starting
with `ES` are species trials («Ensayo (varias especies)»); codes without a
known prefix (`BN`, `VN`, `Ve`, `Prot`, `Mx`, `Ali`, `CCV En`…) fall into
«Sin especie en el código». The year is not used.

**DECISION** — A mixed plantation is its own group, with its species in a
fixed order so `CoRa03` and `RaCo07` count together. Its area is not split
between species: the proportions are unknown.

**DECISION** — Unlike the other dimensions, the species legend sums the
**filtered** polygons (filter by predio → that predio's species) and never
folds into «Otros»: the hectares per species are the point of this view.
Colors are still ranked over the whole base, so they stay stable while
filters change; species beyond the 8 hues share the neutral gray and keep
their own legend row. Long mixture names wrap instead of being cut.

**RESULT** — On the local stack with `Gdb_Degenfeld2026_mv` (2026-10-18):
pino radiata 1,292.57 ha (436 polygons), E. nitens 346.12 ha (145),
pino oregón 235.45 ha (110), E. globulus 142.99 ha (77), roble 47.32 ha (21),
coigüe 30.38 ha (40); «Sin especie en el código» 8,230.97 ha (646). Filtered
to San Sebastian, the legend sums 300.24 ha, the filter total.

## 2024 → 2026 treatment

The comparison tab shows the API's literal source-field comparison:
`Uso2024 → Uso2026` (1 difference: OBJECTID 508, ENSAYO → PLANTACION) and
`Cod_Uso → CodUso_2026` (72 differences), each row joined client-side with
its predio/rodal context, plus the most frequent before→after value pairs
(e.g. `Pi01 → Pi25 ×8`). A single action filters the map to the differing
polygons. The panel states in the UI that these are literal field
differences within one snapshot, not workflow transitions or completed
management — mirroring the API's semantics string.

## Data-quality treatment

The quality tab lists the six established evidence classes with
server-computed counts (7 invalid geometries, 2 duplicate geometries, 143
blank rodales, 32 repeated predio/rodal keys, 2 code/name anomalies, 8
truncated codes), each with a Spanish description and a "Ver en el mapa"
filter action. Framing in the UI: observed evidence recorded at ingestion,
not errors the system corrects nor prioritized tasks. Invalid geometries are
drawn exactly as stored; the inspector shows the GEOS invalidity reason.

## Polygon detail (inspector)

Selected via map click, centroid marker, table row, or comparison row (rows
also zoom). Sections: land use (both year-stamped classes and codes, with a
"difieren" note when literal fields differ), surface (`Sup_ha` vs
geometry-derived hectares), geometry validity (+ reason), quality-evidence
chips, source evidence (OBJECTID labeled as source evidence, shapefile
record number, snapshot id), and the full 14-field raw attribute row behind
a disclosure. Detail data comes from the per-feature endpoint with its own
loading/error states.

## Table, export, states

- 25 rows per page; sortable by predio, rodal (numeric-aware), uso, código,
  `Sup_ha`; row click selects + zooms; external selections jump to the
  containing page and scroll into view; pagination resets on filter change.
- CSV export of the filtered, sorted set (client-side, UTF-8 BOM for Excel;
  column set = source projection fields + validity/quality evidence).
  Exports are browser downloads only and are never committed.
- Handled states: initial loading, no persisted snapshot (points to
  `make forestry-dev`), API unavailable (retry), empty filter results (map
  overlay + table message), detail-fetch failure. No stack traces or
  internal paths are exposed.

## Responsive behavior

Desktop-first (QA at 1440×900 and 1920×1080). At ≤720 px (QA at 390×844):
map-first, sidebar becomes a slide-in drawer, inspector becomes a bottom
sheet, KPI strip scrolls horizontally, wide tables scroll inside their own
container. Reduced motion is respected for the spinner and drawer
transition.

## Local launcher

`make forestry-dev` (`scripts/forestry_dev.py up`):

1. creates `.env` from `.env.example` with a generated password if missing;
2. refuses to run unless `APP_ENV=development` and the DB host is local;
3. validates the external source ZIP read-only (via `app.source_discovery`,
   which rejects symlinks/traversal and never writes);
4. `docker compose up -d --wait postgres` (the shared dev service);
5. `alembic upgrade head`;
6. ingests `001_DEGENFELD_2026.zip` idempotently (family-fingerprint
   identity; re-runs log `already persisted`);
7. starts uvicorn and the Vite dev server on free ports (preferred 8000 /
   5173; falls back to OS-assigned — verified when 8000 was occupied),
   wiring the frontend proxy via `FORESTRY_API_PORT`;
8. prints URLs and opens a browser best-effort (wslview/xdg-open/powershell).

`make forestry-status` reports recorded PIDs, ports, and HTTP health;
`make forestry-stop` terminates only the recorded processes after
re-verifying their `/proc` cmdline against the recorded marker, and
deliberately leaves the shared dev database running. State lives in
`.forestry-dev/` (gitignored).

## Verification against the real source (RESULT)

Browser QA on 2026-08-30 ran against the real snapshot ingested by the
launcher (1,568 features, fingerprint `19beaed5…60bd1`, id 1):

- KPI/legend/comparison/quality numbers matched Source Evidence V1 exactly
  (10,422.61 ha; 15 code/name pairs over 13 names and 13 codes; 28 classes;
  1 class change = OBJECTID 508 ENSAYO → PLANTACION; 72 code changes;
  7/2/143/32/2/8 evidence counts);
- filter/fit/hover/select/inspector flows verified at 1440×900, 1920×1080,
  390×844, including an invalid geometry (HT rodal 677, ring
  self-intersection reason shown) and keyboard row activation;
- CSV export produced 1,568 rows with faithful source values.

## Performance (RESULT)

### 2026-10-18 pass

Measured the same way (Chromium, 1440×900, local stack, snapshot 1), long
tasks counted with a `PerformanceObserver`:

| Step | Before | After |
|---|---|---|
| Feature collection transferred | 9,372,348 B (no compression) | 2,650,275 B (gzip level 6) |
| Zoom in ×4 into rodal-label zoom | 2 long tasks, max 534 ms | none |
| Mapa → Informes → Mapa | full re-download; max 354 ms | no download; max 151 ms |
| Pan, cursor moves, selection, recolor | no long tasks | no long tasks |

**DECISION** — What changed:
- the API gzips only the large geometry reads (`app.compression`: GET
  `/api/forestry/snapshots/{id}/feature-collection` and
  `/api/forestry/reports/{id}`), level 6 (about 2 % larger than level 9 for
  less than half the server time on a synthetic 12 MB GeoJSON); session,
  CSRF and form responses stay uncompressed, so compression cannot be used
  to guess a token (BREACH needs a secret and reflected input together);
- the dashboard keeps the downloaded collection in memory for the page
  session, two versions at most (`fetchFeatureCollection`), and reprojects
  each geometry once (`multiPolygonToLatLngs`, a `WeakMap` by geometry).
  Nothing goes to browser storage; the API keeps `Cache-Control: no-store`;
- rodal labels skip off-screen and too-small polygons using a bbox stored
  per polygon before computing an interior point;
- zooming restyles all polygons only when it crosses zoom 12, where the
  outline changes.

**INFERENCE** — Over the hosted network the transfer saving dominates: at
20 Mbit/s, about 3.7 s for 9.4 MB against about 1.1 s for 2.65 MB, plus
roughly 0.3 s of server compression. Not measured in production (it is
down while the Railway plan is inactive).

Earlier measurement (V1):

Measured in Chromium at 1440×900 against the real snapshot, dev server:

- feature collection: 9.15 MB decoded, fetched in ≈0.4 s locally;
- initial layer build (reprojection + 1,568 canvas polygons) leaves a JS
  heap of ≈128 MB; steady-state frame time ≈16.3 ms (60 fps);
- filter changes restyle/re-add layers without visible lag.

**DECISION** — No vector tiles, server clustering, or caching infrastructure
at this scale; revisit only with measured evidence of degradation.
**DECISION** (2026-10-15) — An `Opacidad` slider (0–100 %, default 78 %)
sets the fill opacity of source polygons so the basemap/satellite shows
through. Below 50 % the outline switches from white to the polygon's own
category color at 1.5 px, so the boundaries between uses stay readable
without the fill (requested by Campo Digital, 2026-10-14).

**DECISION** (2026-10-15) — Labels that need context carry a quiet `?`
(component `Hint`) that explains them on hover, keyboard focus, or tap:
KPI strip, table `Evidencia` column, map `Opacidad`, the boundary simulator
(draft badge, areas, tools, visible handles), and the Revisión/Versiones
pages (CRS, content fingerprint, GEOS reason, version status). The tooltip
is portalled with fixed positioning so scrolling containers never clip it.

## Local boundary simulation ("Simular ajuste") — removed 2026-10-18

**DECISION** (2026-10-18) — Removed from the map. It duplicated the report
editor's «Dividir con línea» and saved nothing, which confused users about
where a cut lives. The record below stays as history; the code
(`straightCutCandidates`, vertex moving, point reduction, `draftHistory`) was
deleted, and only `multiPolygonAreaSquareMeters` remains in
`src/lib/draftGeometry.ts`.

A local-only draft editor for one selected, OGC-valid polygon: move
vertices, reduce points (Douglas–Peucker at 2 / 10 / 30 m), or cut with a
straight line, with live area in EPSG:32718 metres. Nothing is persisted;
the source snapshot never changes.

**DECISION** (2026-10-15) — "Cortar con línea" works on multipart polygons,
polygons with holes, and concave outlines the line enters and leaves several
times (previously only single-ring polygons crossed exactly twice). Every
part the drawn segment crosses is split; each resulting piece lies left or
right of the line, and the user keeps one side. Parts the line misses stay
with whichever side is kept; holes it misses go to the piece that contains
them; holes it crosses become notches in the adjoining pieces. Method:
exterior wound counter-clockwise and holes clockwise, crossings paired along
the line into interior chords, then each piece traced ring → chord → ring
until it closes; the direction a piece walks its chords gives its side.
Implemented in `straightCutCandidates` (`src/lib/draftGeometry.ts`).

**FACT** — In snapshot 1 (1,568 features, 1,561 OGC-valid), 164 valid
polygons are multipart and 56 have at least one hole; all of them had the
cut tool disabled before this change.

**RESULT** (2026-10-15, local dev, snapshot 1) — Purretrun rodal 17
(8.09 ha, 3 holes): one vertical line through two holes and a concave
bottom edge (4 exterior crossings) gave 4.05 + 4.04 ha, matching the
original; the untouched hole stayed whole in its piece. Hacienda Trinidad
rodal 1 (2 parts, 3.95 ha): only the crossed part was split, 2.70 + 1.24 ha.

**LIMITATION** — The cut refuses, with a message, a line that starts or
ends inside the polygon or a hole, passes exactly through a vertex, or
wraps around part of the polygon so one piece would lie on both sides.
Invalid source geometries (7) cannot enter the simulator at all.

## Limitations and open items

- **LIMITATION** — The client-side search/filters operate on the loaded
  snapshot only; they are not a general query interface.
- **LIMITATION** — Raster basemap at fractional zoom can show transient
  tile-sharpness seams while tiles load.
- **LIMITATION** — At estate zoom, sub-pixel polygons are clickable only via
  their centroid markers (small subsets) or after zooming; hit-testing tiny
  canvas polygons is inherently imprecise.
- Read-only by design: no persisted editing (the boundary simulation is
  local-only), management-plan requests, print
  layouts, Excel (XLSX) export, or German-language views — pending the
  stakeholder answers in
  [preguntas-campo-digital.md](es/preguntas-campo-digital.md).

## Related documentation

[Forestry product](../README.md) ·
[Read API V1](read-api-v1.md) ·
[Ingestion Substrate V1](ingestion-substrate-v1.md) ·
[Source Evidence V1](source-evidence-v1.md) ·
[Product projection V1](product-projection-v1.md) ·
[Resumen para Campo Digital](es/dashboard-v1.md)
