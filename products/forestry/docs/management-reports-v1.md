# Rodales management reports V1 (API)

## Status

- Stage 1 (data, API, export): merged 2026-10-16 as PR #103 (`997270e`);
  migration `0014`. Not deployed yet.
- Stage 2 (screens): implemented 2026-10-16 on branch
  `feat/rodales-informes-ui`; not merged or deployed.

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

## Data (migration 0014)

| Table | Content |
|---|---|
| `forestry.report` | name (1–120 characters, unique among non-archived reports ignoring case), type, month `YYYY-MM`, status, base snapshot, `revision`, creator, decision time and decider |
| `forestry.report_note` | append-only review notes; a change request always has text (≤ 2,000 characters) |
| `forestry.report_feature` | position, `source_feature_ordinal`, `in_report` (the EN_INFORME mark), `geometry_changed`, `attributes` (JSONB, source-contract lineage keys), `geometry` (`MultiPolygon`, EPSG:32718) |

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
| `GET …/{report_id}/export?format=shp\|gpkg\|csv&scope=all\|marked` | download |

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

Columns: `OBJECTID` (0 for split pieces), `Nom_Predio`, `N_Rodal`, `Sup_ha`,
`Cod_Uso`, `Editada`, `Uso2024`, `DescUso`, `Cod_Predia`, `N_Rodal_te`,
`Uso2026`, `CodUso_202` (widened from 10 to 25 so codes are not cut),
`Shape_Leng`, `Shape_Area`, then `EN_INFORME` (`si`/`no`), `INFORME`,
`TIPO`, `FECHA` (`YYYY-MM`), `ESTADO`, `OID_ORIGEN` (the master polygon's
OBJECTID). File name: the report name in ASCII, for example
`Cosecha_pino_enero_2027.zip`. `scope=marked` exports only marked rows.
Exports are not stored; each one writes the audit event
`forestry.report.exported`.

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
