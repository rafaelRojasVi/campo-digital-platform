# Transelec Source Contract V2 — recognized `Resumen` layout

## Status

Implemented (`transelec_ingestion.resumen_layout`, parser
`transelec_ingestion.resumen_layout@2`, schema contract `transelec-resumen-v2`).
Supersedes the positional A:AD gate of [Source Contract V1](source-contract-v1.md);
V1's observations about identity, status and auxiliary worksheets still stand.

## Why V1 had to change

The workbook `PlanillaMaestra-CD_09Sept26.xlsx` (SHA-256 `50253143defb…`,
received 2026-09-26) inserted five columns at A:E of `Resumen`:

| Column | Header            |
| ------ | ----------------- |
| A      | `AEF`             |
| B      | `Quien solicita`  |
| C      | `Fecha solicitud` |
| D      | `Fecha corta`     |
| E      | `Fecha termino`   |

The 30 V1 business fields moved from A:AD to F:AI unchanged, the blank
separator moved from AE to AJ, and worksheet-local summary/pivot tables occupy
AK onward. V1 bound fields to fixed positions and rejected any change, so it
could only reject this benign insertion.

## Evidence from the 09-Sept-2026 workbook

FACT (reproducible with the opt-in private test
`test_private_09_sept_2026_workbook`, run with
`TRANSELEC_PRIVATE_WORKBOOK_0909=<path>`):

- 729 rows with PMF, 159 distinct PMF, 272 distinct `ID_Predo_Unico`,
  164.6288 total `Superficie de corta` — the same shape V1 observed.
- `AEF`, `Fecha corta` and `Fecha termino` are filled on 23 rows;
  `Quien solicita` and `Fecha solicitud` on 19.
- The 23 AEF rows belong to 23 different PMF, and in every case the AEF row is
  the PMF's first source row (each PMF's rows are contiguous). 19 of those 23
  PMF have other rows without AEF.
- All 23 `Fecha termino` values fall on day 1 of a month.
- Row 315: `Fecha corta` precedes `Fecha solicitud`. Row 375: `Fecha termino`
  precedes `Fecha corta`.
- `Fecha de ingreso` (Y) holds 124 and `90 dias` (AA) 63 cells that are text,
  not Excel dates (Spanish long-form dates, or two dates in one cell).
- `ID_Predo_Unico` (AF) is a formula on all 729 rows and `Hoy` (AB) on 115;
  every formula has a cached value.
- Regression: for every row, each of the 30 legacy fields read by V2 equals a
  V1-style positional read shifted right by five columns.

## Layout recognition

1. **Worksheet.** Exactly one sheet whose name normalizes to `resumen`.
   Historical snapshots (`Resumen 16Feb26`, …) never match.
2. **Header row.** The first 15 rows are scored by how many distinct fields
   they recognize. The row must contain `PMF` and at least 5 recognized
   fields; the highest score wins; a tie is an error.
3. **Normalization.** Case, accents, `°`/`º`, dots, underscores, hyphens,
   slashes and repeated whitespace are insignificant. Any other difference is
   a different header.
4. **Blocks.** Columns are split into blocks by *fully blank* columns (blank
   header and blank below it). The block holding `PMF` is the table. Another
   block is joined to it only if it contributes fields the table lacks
   (warning `columna_vacia_intermedia`); otherwise it is an ignored auxiliary
   region (`region_auxiliar_ignorada`). This is what lets the separator move
   and keeps pivot tables — even ones whose labels repeat a business header —
   out of the projection.
5. **The two `Carpeta` columns.** A bare `Carpeta` header is never resolved
   by name. It is bound by its nearest recognized neighbours:
   - left neighbour `PMF` → `carpeta_source` (the PMF's own folder);
   - left neighbour `Tramite` or right neighbour `Sector` →
     `carpeta_normalizada` (the coarser grouping).

   Both or neither rule holding, or two columns resolving to the same field,
   is `carpeta_ambigua` (error). The explicit headers `Carpeta origen` and
   `Carpeta normalizada` bind directly and are the documented way to resolve
   the ambiguity.
6. **Duplicates.** A field recognized in several columns is accepted only if
   the columns are identical on every data row (leftmost used, warning
   `encabezado_duplicado_identico`). Any differing row is
   `encabezado_duplicado_conflictivo` (error) listing the rows.

### Field registry, tiers and documented aliases

| Tier       | Missing column means            | Fields |
| ---------- | ------------------------------- | ------ |
| identity   | error `columna_esencial_ausente` | `PMF`, `ID_Predo_Unico`, `Rol`, `N Predio` |
| required   | error `columna_esencial_ausente` | `Estado`, `Estado resumido`, `Tipo de propietario`, `Superficie de corta`, `N Ingreso`, `Empresa` |
| expected   | warning `columna_esperada_ausente` | every other V1 field |
| optional   | info `columna_opcional_ausente` | the five AEF tracking fields |

DECISION: identity fields feed `predio_group_key`; required fields feed the
published status/summary computations. Losing either would make published
numbers wrong rather than merely blank, so it blocks. The AEF fields are
optional so the earlier 30-column layout still imports.

Documented aliases (besides the canonical header):

| Field                    | Aliases |
| ------------------------ | ------- |
| `aef`                    | `Estado AEF` |
| `quien_solicita`         | `Solicitante`, `Solicitado por` |
| `fecha_solicitud`        | `Fecha de solicitud` |
| `fecha_corta`            | `Fecha de corta` |
| `fecha_termino`          | `Fecha de termino` (accents are insignificant) |
| `carpeta_source`         | `Carpeta origen` |
| `carpeta_normalizada`    | `Carpeta normalizada` |
| `superficie_total_corta` | `Superficie total de corta` |
| `id_predio_unico`        | `ID_Predio_Unico` (the source spells `ID_Predo_Unico`) |

The aliases are platform-defined, not observed in a source; adding one is a
code change reviewed like any other.

## Rows and cells

- A row blank in every mapped column is skipped.
- A row with mapped data but no PMF is not imported (warning `fila_sin_pmf`,
  with rows). DECISION: V1 skipped such rows silently; V2 keeps the
  documented V1 behaviour but reports it.
- Date fields accept only Excel dates. Text in a date column is left empty
  and reported (`fecha_no_reconocida`); it is never parsed, because day/month
  order and two-dates-per-cell are not established.
- Non-numeric text in a number column is left empty (`numero_no_reconocido`)
  and excluded from totals, as in V1.
- Excel error cells (`#N/A`, `#REF!`, …) are left empty
  (`error_de_formula`). calamine reads them as blank, so they are detected
  from the sheet XML.
- Formula cells use their cached value (info `columna_con_formulas`); a
  formula saved without one reads as blank and is reported
  (`formula_sin_valor`).
- Chronology: `Fecha corta < Fecha solicitud`
  (`cronologia_corta_antes_de_solicitud`), `Fecha termino < Fecha corta`
  (`cronologia_termino_antes_de_corta`) and `Fecha termino < Fecha solicitud`
  (`cronologia_termino_antes_de_solicitud`). Every violated pair is reported;
  one issue per violated pair and row. The dates are stored as the source has
  them.
- Nothing is filled down, forward or across rows.

## Severity and the import lifecycle

- `error` — validate-and-project answers **422** with the full layout report
  (every issue with column letters and worksheet row numbers) and persists
  nothing; the failure is audited with issue codes and references only.
- `warning` — the import is created, not activated. The dashboard requires
  the operator to acknowledge the warnings before the explicit publish step,
  and the API enforces it: `POST /imports/{id}/publish` answers **409** for
  an import with warnings unless `acknowledge_warnings=true` is sent, and the
  acknowledgement is recorded in the `import.published` audit event.
- `info` — recorded evidence.

Messages are Spanish and structural: headers, column letters, row numbers and
counts, never a business cell value (asserted by integration tests).

## Persistence

Migration `0009` (expand-only):

- `transelec_resumen_row` gains `aef`, `quien_solicita`, `fecha_solicitud`,
  `fecha_corta`, `fecha_termino` (nullable; indexed with `import_id` for
  `aef` and `quien_solicita`).
- `transelec_import` gains `mapping_report` (JSONB, NULL for V1 imports) and
  `warning_count`.

The original upload stays content-addressed in the object store
(`source_snapshot`), and every row keeps its `source_row_number`. Imports made
under V1 report the 30 legacy fields as their source fields.

## API additions

- `ValidateAndProjectResponse`: `warning_count`, `mapping_report`.
- `GET /transelec/imports/{id}/report` (operator/admin).
- `GET /transelec/imports/active`: `warning_count`, `source_fields`.
- `GET /transelec/aef` (viewer+): row-level AEF counts, per-PMF coverage,
  value/requester breakdowns and the tracked rows, under the shared filters.
- Shared filters gain `aef` and `quien_solicita` multi-selects.
- Every row view gains the five fields and `chronology_flags`.

## Interpretation

INFERENCE: the AEF row being each PMF's first row suggests AEF may be entered
once per PMF on a representative row rather than per área de corta. It is not
established, so the platform treats AEF strictly as a row value and shows
per-PMF coverage explicitly.

HYPOTHESIS: `Fecha termino` may have month precision (all values on day 1).
If so, row 375 (`Fecha corta` 8 Sept, `Fecha termino` 1 Sept) may not be an
error.

## Limitations

- The meaning of AEF values (`Presentado`, `Solicitado, se puede cortar`) is
  not defined by the source; values are grouped by literal text only.
- Text dates in `Fecha de ingreso` / `90 dias` remain empty in the
  projection, as they were in V1.
- The CSV export still labels the two folder columns `Carpeta (col. E)` and
  `Carpeta (col. AC)` (the ratified TR-FUNC-037 header set); in the 09-Sept
  layout they are J and AH. The dashboard now labels them by meaning.

## Open questions for Campo Digital

- What does AEF stand for, and what does each value mean?
- Is AEF recorded per área de corta, or once per PMF on its first row?
- Does `Fecha termino` carry a day, or only a month?
- Are rows 315 and 375 data-entry errors?
- Should text dates in `Fecha de ingreso` / `90 dias` be converted at source?
