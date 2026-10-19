# Rodales management reports V1 (API)

## Status

- Stage 1 (data, API, export): merged 2026-10-16 as PR #103 (`997270e`);
  migration `0014`.
- Stage 2 (screens): merged 2026-10-17 as PR #104 (`c9fb98a`).
- Both deployed 2026-10-17 (Railway `f6baf244`, `main` at `87338cb`);
  migration `0014` ran in production.

Design:
[spec](../../../docs/superpowers/specs/2026-10-16-rodales-informes-de-manejo-design.md);
plans:
[stage 1](../../../docs/superpowers/plans/2026-10-16-rodales-informes-stage1-api.md),
[stage 2](../../../docs/superpowers/plans/2026-10-16-rodales-informes-stage2-ui.md).
Spanish guide: [Informes de manejo](es/informes-de-manejo.md).

## What a report is

- **DECISION:** a management report (informe de manejo) is a named,
  reviewable set of polygon copies taken from one published base snapshot.
  It never changes what the dashboard serves; the MASTER stays in ArcMap
  (Javier, 2026-10-15). A report is exported and sent to Campo Digital with
  the Plan de Manejo spreadsheet.
- **DECISION:** a report keeps its own copies. A base published later does
  not change it; a save on a report whose base is no longer the published
  one returns the `base_outdated` warning.
- **DECISION:** a copied polygon is identified by its `feature_ordinal` in
  the report's base snapshot, not by OBJECTID, which may repeat within a
  snapshot. OBJECTID is still exported from the copied attributes.

## Data (migrations 0014, 0017, 0018)

**DECISION (2026-10-19):** Javier (Campo Digital) confirmed that reports need
the exact day, not just the month. `report_date DATE` was added alongside
`report_month TEXT` in migration `0017`. Existing rows keep `report_date`
NULL and retain their month. New reports supply `report_date`; the server
derives `report_month` from it. A CHECK constraint keeps them consistent:
`report_date IS NULL OR report_month = to_char(report_date, 'YYYY-MM')`.

| Table | Content |
|---|---|
| `forestry.report` | name (1–120 characters, unique among non-archived reports ignoring case), type, month `YYYY-MM`, exact date `YYYY-MM-DD` (nullable; legacy rows NULL), status, base snapshot, `revision`, creator, decision time and decider |
| `forestry.report_note` | append-only review notes; a change request always has text (≤ 2,000 characters) |
| `forestry.report_feature` | position, `source_feature_ordinal`, `in_report` (the EN_INFORME mark), `geometry_changed`, `attributes` (JSONB, source-contract lineage keys), `geometry` (`MultiPolygon`, EPSG:32718), planning fields `sector`, `reforest_species`, `reforest_density` (0018, see «Planificación») |

## Lifecycle and roles

`borrador` → `enviado` → `aprobado` or `cambios_solicitados` → (edit) →
`enviado`; any non-archived report → `archivado`. Only `borrador` and
`cambios_solicitados` are editable. Every change bumps `revision`, and every
change states the revision it expects, so nobody overwrites or approves a
version they did not see. An approved report is frozen; «Duplicar como
borrador» copies it into a new draft named `… (copia)`.

| Action | Who |
|---|---|
| list, open, export approved reports | any `forestry` role |
| create, save, rename, submit, duplicate, delete a never-submitted draft; read source polygons | `Action.EDIT` (operator, admin) |
| approve, request changes, archive | `Action.APPROVE` (admin only; new in this change) |

Viewers get `404` for any report that is not approved, so a draft's
existence is not disclosed.

## API

All under `/api/forestry/reports`; writes need CSRF. Geometry travels as
GeoJSON in EPSG:32718 metres. Errors answer
`{"detail": {"code", "message", "source_feature_ordinal"?}}` with a Spanish
message.

| Method and path | Effect |
|---|---|
| `GET /api/forestry/reports` | list (submitted first); `pending_review_count` for admins; filters `status`, `report_type` |
| `POST /api/forestry/reports` | create against the published base (`201`) |
| `GET /api/forestry/reports/{report_id}` | report, features, the base polygons it refers to (`sources`), notes |
| `GET /api/forestry/reports/{report_id}/source-polygons?ordinals=1,2` | base polygons in UTM for the editor to split |
| `PUT /api/forestry/reports/features` | replace the feature set (`report_id` and `revision` in the body; 8 MiB body bound, refused without a live session before reading) |
| `PATCH /api/forestry/reports/{report_id}` | rename, change type or month |
| `POST …/{report_id}/submit`, `/approve`, `/request-changes`, `/archive` | transitions (body: `revision`, optional `note`) |
| `POST …/{report_id}/duplicate` | new draft (`201`) |
| `DELETE /api/forestry/reports/{report_id}` | never-submitted draft only (`204`) |
| `GET …/{report_id}/export?format=shp\|gpkg\|csv\|xlsx&scope=all\|marked` | download |

A feature sent without `geometry` is an untouched copy of its source polygon
(how «Pegar» works); the server copies the base geometry exactly.

## Screens (stage 2)

- **«Informes»** (`/rodales/informes`): the list; submitted reports first;
  «Pendientes de revisión: N» for admins; «Nuevo informe» (name, type,
  month) for editors. Viewers see approved reports only.
- **Editor** (`/rodales/informes/editar?informe=<id>`), layout A of the
  design: toolbar («Seleccionar», «Copiar», «Pegar al informe», «Dividir con
  línea», «Quitar del informe», «Deshacer», «Rehacer»), map of the report's
  own base snapshot, and the report panel (rows with the «Área de manejo»
  mark and editable fields, totals, «Guardar», «Enviar a revisión»,
  export links).
- **Split:** JSTS (`lib/splitGeometry.ts`) nodes the polyline with the
  polygon boundary and polygonizes in EPSG:32718; pieces are labelled with a
  letter and hectares at an interior point; the chosen pieces become one
  managed feature with the next free code (`766` → `766-1`) and the rest
  keeps the code. One line splits every report polygon it crosses.
- **Review** (admin, `enviado`): the same layout read-only, a plain-Spanish
  change list (`lib/reportChanges.ts`), «Mostrar base original», «Pedir
  cambios» (note required) and «Aprobar».
- **DECISION:** viewers never see review notes (the user's question is
  open; the API still returns them).
- **DECISION:** «Copiar» keeps the selection in the browser session, keyed
  by base snapshot, so polygons can be pasted into another report on the
  same base; paste skips polygons already in the report.
- **RESULT (2026-10-16, local stack, real Degenfeld base):** create → paste
  rodal 766 → polyline split → 766-1 (132,21 ha) and 766 (295,35 ha) →
  save accepted by the server → submit → request changes → resubmit →
  approve → Shapefile export; also checked at 800 px width.
- **LIMITATION:** no snapping, vertex editing or new polygons (out of
  scope); editing is not optimized for touch.
- **DECISION (2026-10-19, «simple editor»):** a walkthrough found the editor
  confusing. Copy and paste were needed inside one report, added rodales landed
  outside the management area, a selection stayed stuck, and the panel jumped.
  Javier asked for «Simple». Four clickable alternatives were compared on a
  design canvas, and Rafael chose «one click = in» plus a card:
  - The editor is one screen: the report's table on the left
    (`PlanificacionTable`, one row per managed rodal with sector, species and
    density; a «Todos» row applies a value to all; a cell is written only when
    its text changed) and the map on the right. There are no steps and no
    selection state.
  - **A click on a base rodal adds it** to the management area
    (`pasteSources` sets `in_report = true`), with a «Deshacer» toast.
  - **A click on a report rodal opens its card** (`RodalCard`: «Dividir»,
    «Sacar del informe», «Editar datos», or «Incluir» for a «Resto»), so a
    planned rodal is never removed by a stray click. A second click or a click
    outside closes the card.
  - «Buscar rodal» flies to a rodal and opens its card, with «Agregar al
    informe» when it is outside the report.
  - Hovering a row highlights its polygon, and the rodal number in a row
    shows it on the map.
  - A progress guide at the top, taken from option A, shows three cards with
    icons: Rodales (count and hectares), Planificación (a «planned of
    managed» bar) and Exportar. Each gets a check once done. The cards are not
    tabs: one only scrolls to its part.
  - The harvest Excel is the main download at the top. Other formats, CONAF
    and duplicate/archive/delete sit under «Otros formatos, CONAF y más».
    Save and send live in a sticky bar.
  - Icons sit on the actions, and «?» hints explain the parts.
  - **Motion:** the card and toast ease in, a row's highlight fades, and all
    of it stops under prefers-reduced-motion.
  - **Map:** half-level wheel zoom, imagery capped at native zoom 18, and a
    redraw on resize. View controls borrowed from the main Map page:
    - «Números» labels every report rodal and, from zoom 15, base rodals at
      least 44 px across, up to 200, with overlaps dropped and report labels
      first;
    - «Opacidad» sets the report fill (10–100 %), and below 35 % the outline
      takes the fill color;
    - «Ver todo el informe» refits the view.
    Opacity and numbers are a per-viewer convenience kept in localStorage,
    guarded by try/catch.
  - **Phones:** the map sits above and the table below, and the panel scrolls
    as a whole.

## Rules on save

Geometry runs in Shapely (GEOS, as PostGIS) in EPSG:32718 metres, before
anything is stored; a refusal stores nothing.

| Code | HTTP | Message |
|---|---|---|
| `too_many_features` | 422 | Un informe puede tener hasta 500 polígonos. |
| `unknown_source` | 422 | Un polígono no corresponde a la base del informe. Recargue el informe. |
| `attribute_not_editable` | 422 | Ese dato no se puede cambiar desde la web. |
| `attribute_not_text` | 422 | Los datos de un polígono deben ser texto. |
| `attribute_too_long` | 422 | Un dato es demasiado largo para su campo del shapefile. |
| `geometry_unreadable` | 422 | No se pudo leer la forma de un polígono. |
| `geometry_invalid` | 422 | Una de las partes quedó con una forma inválida. Ajuste la línea de corte. |
| `source_invalid_split` | 422 | Esta geometría tiene un error en la base original; corríjanla en ArcMap. |
| `piece_too_small` | 422 | Una de las partes es demasiado pequeña (menos de 1 m²). Ajuste la línea. |
| `split_coverage` | 422 | Las partes de un rodal dividido no cubren el rodal original. Deshaga el último corte. |
| `overlap` | 422 | Dos polígonos del informe se superponen. |
| `not_found` | 404 | No se encontró el informe. |
| `no_published_base` | 409 | Aún no hay una versión publicada de Rodales; publíquela antes de crear informes. |
| `name_taken` | 409 | Ya existe un informe con ese nombre. |
| `invalid_name` | 422 | El nombre debe tener entre 1 y 120 caracteres. |
| `invalid_month` | 422 | El mes debe tener la forma AAAA-MM, por ejemplo 2027-01. |
| `not_editable` | 409 | Este informe ya no se puede editar. Duplíquelo para hacer cambios. |
| `stale_revision` | 409 | Otra persona guardó cambios en este informe; recárguelo. |
| `invalid_transition` | 409 | Esta acción no aplica al estado actual del informe. |
| `nothing_marked` | 422 | Marque al menos un polígono como área de manejo antes de enviar. |
| `note_required` | 422 | Escriba qué hay que cambiar. |
| `note_too_long` | 422 | La nota no puede superar 2.000 caracteres. |
| `cannot_delete` | 409 | Sólo se puede borrar un borrador que nunca se envió; archívelo. |

- The features naming one source polygon must together cover it: one
  untouched copy, or the pieces of a split, however nested (symmetric
  difference ≤ 0.01 m²). Overlaps between features: ≤ 0.01 m².
- A polygon with the same parts and vertex count as its source and within
  1e-6 m of it (Hausdorff distance) is the untouched source, whatever vertex
  a ring starts at (coordinates come back from the browser as JSON numbers).
- Overlaps are refused only between features of the same source polygon.
  Neighbouring rodales overlap only where the base already overlaps (masters
  edited without topology rules carry slivers), which the user cannot fix
  here.
- A source polygon invalid in the base may be carried untouched (warning
  `invalid_source_carried`) but not split.
- Editable attributes: `n_rodal` (10), `n_rodal_te` (3), `cod_uso` (25),
  `uso_2024` (50), `desc_uso` (50), `uso_2026` (50), `cod_uso_2026` (25);
  widths are UTF-8 bytes, as the DBF stores them.
- Warnings returned with a successful save: `invalid_source_carried`,
  `base_outdated`, `also_in_other_report` (the polygon is in another
  non-archived report on the same base).

## Areas and `Editada`

- `sup_ha` = area / 10,000, `shape_area` and `shape_leng` are recomputed
  only for split pieces; untouched polygons keep the base values.
- **DECISION:** changed rows (geometry or editable attributes) get
  `editada = wb`: two characters, the width of the master field, beside
  Marco's `mv` (user decision 2026-10-16).

## Export

| Format | Content |
|---|---|
| `shp` | ZIP of `.shp/.shx/.dbf/.prj/.cpg`, written with pyshp; `.prj` is the base's exact ESRI WKT for UTM 18S; `.cpg` is `UTF-8` |
| `gpkg` | GeoPackage 1.3 written with sqlite3: one `MULTIPOLYGON` layer in EPSG:32718 named after the report |
| `csv` | attributes only; UTF-8 with BOM, comma, CRLF (as the dashboard's CSV); text starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'` so a spreadsheet does not run it as a formula |
| `xlsx` | harvest table (Excel de cosecha, formato Campo Digital); see §«Harvest Excel» below |

Columns: `OBJECTID` (0 for split pieces), `Nom_Predio`, `N_Rodal`, `Sup_ha`,
`Cod_Uso`, `Editada`, `Uso2024`, `DescUso`, `Cod_Predia`, `N_Rodal_te`,
`Uso2026`, `CodUso_202` (widened from 10 to 25 so codes are not cut),
`Shape_Leng`, `Shape_Area`, then `EN_INFORME` (`si`/`no`), `INFORME`,
`TIPO`, `FECHA` (`YYYY-MM`), `ESTADO`, `OID_ORIGEN` (the master polygon's
OBJECTID). File name: the report name in ASCII, for example
`Cosecha_pino_enero_2027.zip`. `scope=marked` exports only marked rows.
Exports are not stored; each one writes the audit event
`forestry.report.exported`.

### Harvest Excel (`xlsx`, 2026-10-19)

Written with xlsxwriter.  Filename: `<slug>_cosecha.xlsx`.  Media type:
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
The `scope` query parameter is accepted but ignored: the xlsx writer always
uses the `in_report=True` rows.

**Sheet layout** — «Resumen»:
- Title cell: «COSECHA TEMPORADA `<year>`-`<year+1>`» where `year` is the
  `report_date` year, falling back to the `report_month` year for legacy
  month-only reports.
- Headers: `predio | especie cosechar | superficie cosecha`.
- One row per (predio, species group), totalling the managed `sup_ha`.
- TOTAL row.

**Sheet layout** — one per (species group, predio):
- Title: «TABLA DE IDENTIFICACIÓN DE RODALES `<SPECIES>` QUE ESTAN
  CONSIDERADOS EN COSECHA FORESTAL DURANTE LA TEMPORADA `<year>` - PREDIO
  `<NOMBRE>`».
- Two header rows (labels + units).  Freeze panes below row 5.
- One data row per managed polygon (`in_report = True`).
- TOTAL row with sums of `superficie` and `superficie corta`.

**Column mapping** (14 data columns, B–O):

| Column | Content |
|---|---|
| `predio` | `nom_predio` |
| `sector` | the polygon's «Planificación» sector; blank when not entered — FACT (Javier 2026-10-19): sector is approximate general knowledge, recorded nowhere else |
| `actividad` | report type in lower case (cosecha / manejo / reforestación) |
| `rodal` | `n_rodal` of the managed polygon |
| `superficie (ha)` | sum of `sup_ha` over **all** rows sharing the same source `objectid` — FACT (Javier 2026-10-19): «superficie» is the area of the whole source rodal |
| `especie` | parsed from `cod_uso_2026`; see `forestry_species.py` |
| `año plantación` | two-digit year in `cod_uso_2026`, converted to 4-digit; `??` → blank; see `forestry_species.py` |
| `pendiente (%)` | blank — not in the base |
| `densidad actual` | blank — not in the base |
| `superficie corta (ha)` | the managed polygon's own `sup_ha` — FACT (Javier 2026-10-19): «superficie corta» is the area that will actually be harvested |
| `año corta` | year of `report_date`; falls back to year in `report_month` for legacy reports |
| `especie a reforestar` | the polygon's «Planificación» species joined with « + »; blank when not entered — FACT (Javier 2026-10-19): it changes per rodal and can be several |
| `densidad reforestación` | the polygon's total density in pl/ha (one value for all its species — DECISION 2026-10-19); blank when not entered |
| `plan de manejo` | «sí» if the report has a CONAF solicitud number, else «no» |

Sheets are ordered by species (`SPECIES_ORDER` in `forestry_species.py`) then
predio.  Sheet names ≤ 31 chars, unique, stripped of `[]:*?/\`.  Polygons
with no recognised species go to a «Sin especie» sheet.

Species parsing is shared with the dashboard:
`apps/api/app/forestry_species.py` mirrors
`products/forestry/dashboard/src/lib/species.ts`; both files must change
together (stated in each file's header comment).

«Resumen» also carries «PLANTACIÓN TEMPORADA `<year>`-`<year+1>`»:
`predio | especie a reforestar | superficie plantación | %`, one row per
predio and species combination (joined with « + »), summing the managed
polygons' `superficie corta`; polygons with no species entered are left out,
and % is over that table's total.

### Planificación per rodal (migration 0018, 2026-10-19)

- **FACT (Javier, 2026-10-19):** «sector» is approximate general knowledge,
  written nowhere; the species to reforest changes from rodal to rodal and can
  be one or more.
- **DECISION (2026-10-19):** three nullable fields on `forestry.report_feature`:
  `sector` (text ≤ 60), `reforest_species` (JSONB array of 1–6 distinct
  strings of 1–40 characters, checked through the IMMUTABLE function
  `forestry.reforest_species_ok`, since a CHECK cannot hold a subquery) and
  `reforest_density` (integer 1–20,000 pl/ha). **One total density per
  rodal**, not per species.
- **Editor:** the «Planificación» section appears above the polygon list when
  one or more managed polygons are selected. A value typed there applies to
  every selected managed polygon in one undoable step. A field whose values
  differ shows «Varios valores» and is written only when the user types a new
  value: focusing and leaving it never overwrites the polygons' own values.
  Read-only once the report is not editable.
- **DECISION:** a split copies the fields to both pieces; unmarking keeps them
  (exports and review only show them on managed polygons); duplicating a
  report copies them.
- **Exports:** the harvest Excel fills its three columns; Shapefile,
  GeoPackage and CSV add `SECTOR`, `ESP_REFOR` and `DENS_REFOR`.
- **LIMITATION:** «pendiente» and «densidad actual» stay blank; they are not
  in the base.

### «Imprimir / PDF» (2026-10-18)

**DECISION** — The editor's export section links to
`/rodales/informes/imprimir?informe=<id>`: one page with the report name,
type, month, status and CONAF number; a still satellite map framed on the
managed areas (orange) with the rest of the report (green), rodal numbers,
scale and north; a legend with hectares; and the table of polygons (rodal,
código, predio, uso 2026, especie, Sup_ha, área de manejo) with totals. The
browser prints it or saves it as PDF (A4 landscape). It shows the last saved
version, so the link is disabled while the draft has unsaved changes. Campo
Digital builds each Plan de Manejo «junto con las imágenes de los rodales a
manejar» (Javier, 2026-10-15).

**RESULT** (2026-10-18, local dev) — «Prueba cosecha» (766-1 managed,
132.21 ha; 766, 295.35 ha) printed on one A4 landscape page.

## Audit

`forestry.report.created`, `.saved`, `.submitted`, `.approved`,
`.changes_requested`, `.duplicated`, `.archived`, `.deleted`, `.exported`,
with the report id as subject and counts or codes as metadata (never note
text or email addresses). The Consola shows them in Spanish.

## Limitations

- **LIMITATION:** displayed piece areas are rounded to two decimals and may
  not add up exactly to the original polygon.
- **LIMITATION:** Shapely and PostGIS share GEOS but are separate builds; a
  geometry accepted here is stored without a second PostGIS check.
- **LIMITATION:** the GeoPackage writer is tested by reading it back with
  sqlite3 and Shapely; it has not been opened in ArcMap or QGIS yet.

## Open questions

- **OPEN QUESTION:** the meaning of `N_Rodal_te`; pieces copy the root's
  value until Javier explains it.
- **OPEN QUESTION:** the Plan de Manejo request format Marco will send; it
  may add report fields (request number, CONAF link).
- **OPEN QUESTION:** whether gerencia needs its own approver role.

## Related documentation

[Forestry product](../README.md) ·
[Upload, review and publish V1](upload-review-publish-v1.md) ·
[Source Contract V1](source-contract-v1.md) ·
[Read API V1](read-api-v1.md)
