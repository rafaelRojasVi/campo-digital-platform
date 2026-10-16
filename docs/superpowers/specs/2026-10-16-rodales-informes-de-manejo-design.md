# Rodales: management reports (informes de manejo)

Date: 2026-10-16. Status: **design approved in conversation, spec awaiting
review.** Supersedes the "split saves a new base version" idea in the Rodales
redesign brainstorm of 2026-10-15.

## Purpose

Campo Digital keeps the Degenfeld forest base (`Gdb_Degenfeld2026_mv`) in
ArcMap 10.8; the web app "is not the main GIS" (Javier, 2026-10-15). What the
web must do is let a person with little or no GIS experience prepare a
**management report**: pick rodales, split them where only part is managed,
name the result (for example «Cosecha pino enero 2027»), have it approved,
and export it to send to Campo Digital with the Excel sheet used for the Plan
de Manejo. Campo Digital then edits the MASTER in ArcMap.

Source of the requirements: Javier's answers to the 27 Rodales questions
(document received 2026-10-15, kept outside the repository) and the design
conversation of 2026-10-15/16.

## Decisions

- **DECISION: reports never change the published base.** The base changes
  only when a new shapefile from ArcMap is uploaded and published, as today
  (`upload-review-publish-v1.md`).
- **DECISION: a report owns copies.** Adding a polygon copies its geometry and
  14 attributes into the report. A later published base does not change any
  report; the report records the base snapshot it started from.
- **DECISION: split keeps both pieces.** The managed piece is marked
  (`EN_INFORME = si`) and gets a new rodal code; the rest keeps the original
  code. Both can be renamed.
- **DECISION: type and month live on the report.** One type and one month per
  report; every exported row carries them.
- **DECISION: copy/paste means base → report.** «Copiar» takes the polygons
  selected on the map; «Pegar al informe» adds them to the open report (or
  another editable report). Polygons inside one report never overlap.
- **DECISION: roles reuse the platform model** (`apps/api/app/access.py`):
  operator creates, edits and submits; admin approves, requests changes and
  can edit; viewer sees approved reports only. An approver role for gerencia
  is added only if asked for.
- **DECISION: architecture A.** JSTS in the browser for instant editing;
  PostGIS re-validates on save, recomputes areas and stores the copies; the
  server writes the export files.
- **DECISION: editor layout A** (toolbar + report panel, QGIS-like), with
  guidance borrowed from a wizard: a numbered empty state and a hint box that
  follows the active tool.
- **DECISION: review layout A** (map + plain-language change list, optional
  base overlay).

## Data model (migration 0014)

### `forestry.report`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity | |
| `name` | text, 1–120 chars | unique among non-archived reports, case-insensitive |
| `report_type` | text, checked | `cosecha`, `manejo`, `reforestacion`, `plantacion`, `otro` |
| `report_month` | text `YYYY-MM`, checked | |
| `status` | text, checked | `borrador`, `enviado`, `aprobado`, `cambios_solicitados`, `archivado` |
| `base_snapshot_id` | bigint FK | the published shapefile snapshot it started from |
| `revision` | integer | bumped on every save; optimistic locking |
| `created_by_app_user_id` | bigint FK | |
| `created_at`, `updated_at` | timestamptz | |
| `submitted_at`, `decided_at` | timestamptz, nullable | |
| `decided_by_app_user_id` | bigint FK, nullable | |

### `forestry.report_note`

Review history: `id`, `report_id`, `kind` (`cambios_solicitados`,
`aprobado`), `body` (text, required for `cambios_solicitados`, max 2,000
chars), `author_app_user_id`, `created_at`. Notes are never edited.

### `forestry.report_feature`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity | |
| `report_id` | bigint FK, cascade | |
| `position` | integer | display order |
| `source_objectid` | integer | OBJECTID in `base_snapshot_id`; pieces keep their root's |
| `split_group` | integer, nullable | pieces of one split share it |
| `in_report` | boolean | the `EN_INFORME` mark |
| `geometry_changed` | boolean | true for split pieces |
| 14 attribute columns | as projected today | `nom_predio`, `n_rodal`, `sup_ha`, `cod_uso`, `editada`, … |
| `geom` | `geometry(MultiPolygon, 32718)` | |

## Lifecycle

```
borrador ──submit──▶ enviado ──approve──▶ aprobado ──archive──▶ archivado
    ▲                   │
    │            request-changes (note)
    └──── edit ◀── cambios_solicitados ──submit──▶ enviado
```

- Editable only in `borrador` and `cambios_solicitados`.
- `aprobado` is frozen. «Duplicar como borrador» copies it into a new draft
  (name suffixed « (copia)»), so an approval always refers to what was seen.
- `DELETE` only for `borrador` that was never submitted; otherwise archive.
- An admin may approve their own report; the audit shows it.
- Every transition writes an `audit_event` (`forestry.report.created`,
  `.saved`, `.submitted`, `.approved`, `.changes_requested`, `.duplicated`,
  `.archived`, `.deleted`, `.exported`) with the report id as subject, so it
  appears in the Consola activity.

## Geometry rules

### In the browser (JSTS)

- JSTS operates on the **UTM 18S coordinates sent by the server**. Leaflet
  draws reprojected copies (proj4); edits never round-trip through lat/lon.
- Split: the polyline (≥ 2 vertices, both ends outside the target) is noded
  with the polygon boundary, polygonized, and faces inside the original are
  kept. Holes and multipart polygons are supported; a line crossing several
  times yields 3+ pieces.
- One line splits every report polygon it crosses, or only the selected ones
  when there is a selection. Polygons on the map that are not in the report
  are never split («Primero pega el rodal al informe»).
- Each split, paste, mark, rename, attribute edit and removal is one undo
  step (`Ctrl+Z` / `Ctrl+Shift+Z`), kept for the page session.

### On the server (PostGIS, on every save)

Rejected with a fixed code and a Spanish message, nothing stored:

| Code | Rule |
|---|---|
| `geometry_invalid` | `ST_IsValid` false on a changed piece |
| `source_invalid_split` | a split piece whose root is invalid in the base («Esta geometría tiene un error en la base original; corríjanla en ArcMap.») |
| `split_coverage` | the pieces of a split group differ from the **root** source polygon by more than 0.01 m² (union vs root, symmetric difference area) |
| `piece_too_small` | a piece under 1 m² |
| `overlap` | two features of the report intersect with area > 0.01 m² |
| `unknown_source` | `source_objectid` not in `base_snapshot_id` |
| `split_piece_removed` | some but not all pieces of a split group present |
| `too_many_features` | more than 500 features |
| `stale_revision` | `revision` sent ≠ stored («Otra persona guardó cambios; recarga.») |
| `not_editable` | status not editable |

- An **untouched** polygon that is invalid in the base may be added (warning
  shown); only splitting it is refused.
- Non-blocking warnings returned with a successful save: a source polygon also
  present in another non-archived report; the report's base snapshot is no
  longer the published one.

### Areas and codes

- `sup_ha` is recomputed (`ST_Area(geom) / 10000`, EPSG:32718 metres) only
  for features with `geometry_changed`; untouched features keep the base
  value. **LIMITATION:** rounding to two decimals means displayed pieces may
  not add up exactly to the original; the editor shows the parent's value
  next to the sum.
- After a split, the piece chosen as managed gets the next free suffix of the
  root's rodal (`17` → `17-1`, or `17-2` if `17-1` exists in the report); the
  rest keeps `17`. With several managed pieces: `17-1`, `17-2`, … Polygons
  with a blank `n_rodal` keep it blank and are identified by polygon number.
- `editada` is set to `wb` (2 characters, the width of the master field;
  decided 2026-10-16) on features whose geometry changed or whose
  attributes differ from the source row in `base_snapshot_id` (the server
  compares on save; the client does not send `editada`).

## Export

`GET /api/forestry/reports/{id}/export?format=shp|gpkg|csv&scope=all|marked`

- **Shapefile:** ZIP of `.shp/.shx/.dbf/.prj/.cpg`, written with `pyshp`
  (pure Python, MIT). `.prj` = the exact `EXPECTED_PRJ_WKT`; `.cpg` = `UTF-8`.
- **GeoPackage:** written with `sqlite3` and Shapely WKB (GeoPackage binary
  header, `gpkg_spatial_ref_sys` with EPSG:32718, one layer named after the
  report slug).
- **CSV:** attributes without geometry, UTF-8 with BOM for Excel.
- **Columns:** the 14 base fields in base order, with `CodUso_202` widened
  from 10 to 25 characters, then `EN_INFORME` (`si`/`no`), `INFORME` (name,
  80), `TIPO`, `FECHA` (text `YYYY-MM`), `ESTADO`, `OID_ORIGEN`.
  **DECISION:** `OID_ORIGEN` (the root's OBJECTID) is added beyond the five
  agreed fields because new pieces have no OBJECTID of their own (`OBJECTID`
  is written as 0 for them); without it ArcMap cannot tell which master
  polygon a piece replaces.
- `Shape_Leng`/`Shape_Area` are recomputed for changed features.
- File name: ASCII slug of the report name, e.g. `Cosecha_pino_enero_2027.zip`.
- Anyone who can see the report can export it. Exports are not stored.

## API

All under `/api/forestry/reports`, CSRF-protected for writes, product
`forestry`.

| Method and path | Role | Effect |
|---|---|---|
| `GET /` | viewer+ | list; viewers get `aprobado` only; filters `status`, `type` |
| `POST /` | operator+ | create (name, type, month) against the published snapshot |
| `GET /{id}` | viewer+ (approved) / operator+ | report, notes, features as GeoJSON in EPSG:32718 |
| `PUT /{id}/features` | operator+ | replace the feature set; body carries `revision`; route body limit 8 MiB |
| `PATCH /{id}` | operator+ | rename, change type or month (editable states) |
| `POST /{id}/submit` | operator+ | → `enviado` (needs ≥ 1 feature with `in_report`) |
| `POST /{id}/approve` | admin | → `aprobado` |
| `POST /{id}/request-changes` | admin | → `cambios_solicitados`, note required |
| `POST /{id}/duplicate` | operator+ | new draft from any visible report |
| `POST /{id}/archive` | admin | → `archivado` |
| `DELETE /{id}` | operator+ | never-submitted drafts only |
| `GET /{id}/export` | viewer+ (approved) / operator+ | file download |

Features in requests carry only `source_objectid`, `split_group`,
`in_report`, editable attributes and geometry; the server fills `sup_ha`,
`editada`, `geometry_changed` and the Shape fields.

## Screens (Rodales dashboard)

- **Informes (bandeja):** table of reports (name, type · month, status chip,
  submitted by, managed hectares), `enviado` first; filters; «Pendientes de
  revisión (N)» counter for admins; «Nuevo informe».
- **Editor:** toolbar «Seleccionar · Copiar · Pegar al informe · Dividir con
  línea · ↶ ↷ · Exportar»; map; right panel with name, type, month, status,
  hint box, feature rows (managed rows with a harvest-orange edge), totals,
  «Guardar» and «Enviar a revisión». Empty report shows the three steps.
  Split flow: draw (click per vertex; «Terminar línea», double click or
  Enter; Backspace removes the last vertex; Esc cancels) → pieces labelled
  A/B with hectares → «Toca la parte que se cosecha» (or «Ninguna por
  ahora»). No snapping in v1.
- **Revisión:** the editor layout read-only, with «Mostrar base original»
  overlay, a change list in plain words («Rodal 17 dividido en 2», «Rodal 21
  agregado completo»), warnings, and «Pedir cambios» (note required) /
  «Aprobar».
- **Returned report:** the editor with the latest note pinned on top.

Spanish copy; the platform's forest palette; light and dark; keyboard focus
visible; works at laptop width (phone width shows the map and a collapsible
panel, editing is not optimized for touch in v1).

## Delivery

One spec, two plan stages, each shippable:

1. **Data, API, export:** migration 0014, `app/forestry_reports.py`
   (persistence + validation), router, export writers, audit events, tests.
2. **Screens:** JSTS geometry module, undo stack, bandeja, editor, review,
   browser verification.

## Testing

- **Geometry (vitest):** UTM fixtures for a simple split, a polygon with a
  hole, a multipart polygon, a line crossing three times, one line across two
  rodales, a line that does not cross, and a piece under 1 m².
- **API (integration, PostGIS):** every rejection code; every transition and
  its forbidden counterparts; the role matrix; stale revision; warnings;
  a split coverage check against the root after nested splits; an invalid
  source polygon added untouched (accepted) and split (refused).
- **Export:** write then read back: `.prj` text, `.cpg`, field names, types
  and widths, a 25-character `CodUso_202` value intact, accents intact,
  `OID_ORIGEN` and `OBJECTID = 0` for new pieces, recomputed areas; the
  GeoPackage opened with `sqlite3` and its geometry decoded with Shapely.
- **Privacy:** export and audit carry no email addresses.
- **Browser:** Playwright run of create → paste → split → mark → save →
  submit → request changes → fix → approve → export.

## Open questions

- **OPEN QUESTION:** what `N_Rodal_te` (3 characters) means; pieces copy the
  root's value until Javier explains it.
- **OPEN QUESTION:** the Plan de Manejo request format Marco will send; it
  may add report fields later (request number, CONAF link).
- **OPEN QUESTION:** whether gerencia needs its own approver role.

## Out of scope

Editing the published base, vertex editing, drawing new polygons from
scratch, merging polygons, snapping, email notifications, Google imagery
(needs the Map Tiles API key and billing), history of 2012–2024 bases, the
English viewer, and the management-state and species-area queries; each is a
later piece.

## Related documentation

[Upload, review and publish](../../../products/forestry/docs/upload-review-publish-v1.md) ·
[Source contract](../../../products/forestry/docs/source-contract-v1.md) ·
[Platform Consola](2026-10-15-platform-consola-design.md)
