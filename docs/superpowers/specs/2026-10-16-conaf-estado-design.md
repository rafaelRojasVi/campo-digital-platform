# Estado CONAF: live status of CONAF solicitudes in Transelec and Rodales

Date: 2026-10-16. Status: **design approved in conversation, spec awaiting
review.**

## Purpose

Both products track CONAF solicitudes. Transelec follows the PMF of each
servidumbre (it already computes CONAF's 90 business days from the
planilla); Rodales needs each management plan's number and status (Javier's
query 3, 2026-10-15). Today the platform only links to CONAF's public
consulta page. This feature reads that page on the server and shows the
real CONAF status inside both products, in lists and details, with a
history of changes.

## Findings (read-only checks, 2026-10-16)

- **FACT:** `https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=<n>`
  answers a GET with an HTML page (`Content-Type: text/html;
  charset=ISO-8859-1`) holding one `<table class='tabla'>` row: Solicitud,
  Tipo de Solicitud, Superficie, Fecha de Ingreso, Estado, Fecha de
  Resolución (dates `dd/mm/yyyy`; superficie like `.3`, `102.4`).
- **FACT:** an unknown number answers «La solicitud indicada no existe.».
- **FACT:** `robots.txt` exists and is empty (no disallow rules).
- **FACT:** `X-Frame-Options: SAMEORIGIN`: the page cannot be embedded.
- **FACT:** the number must be sent with its six digits. `090663` answered
  solicitud 090663; `90663` answered 069025 and `200000` answered 090663
  (without the leading zero CONAF matches another key).
- **FACT:** the public page shows only that status row; documents
  (resoluciones, informes) are behind the titular's ClaveÚnica in the
  Oficina Virtual.
- **DECISION:** never automate a ClaveÚnica login: it is a personal
  credential. Documents stay out of scope.
- **OPEN QUESTION:** whether the planilla's `N Ingreso` is CONAF's «N.º de
  solicitud» (already open in the Transelec docs). The mismatch check below
  keeps a wrong number from showing another solicitud's data.

## Decisions (from the conversation)

- **DECISION:** one server module used by both products.
- **DECISION:** stored results in PostgreSQL, refreshed by a nightly task
  inside the app (the service runs one replica and already runs an
  in-process maintenance task); no queue or second service.
- **DECISION:** a detail view refreshes a result older than 12 hours when
  opened; lists only read stored results.
- **DECISION:** no email; changes are shown in the platform and counted in
  the Consola.

## Server

### Number normalization

`normalize_solicitud(raw) -> str | None`: trim; accept only 1–9 ASCII
digits (anything else, such as the planilla's `n/n-n/n`, is not queryable
and returns None); left-pad with zeros to six digits.

### Lookup (`app/conaf.py`)

- GET `action.php?nsolicitud=<normalized>` with a 10 s timeout, a
  User-Agent naming the platform, at most 1 MiB read, decoded as
  ISO-8859-1. The URL is a constant; only the number varies.
- Parse with the standard library HTML parser: the first data row of
  `table.tabla`. Results:
  - `found`: the row's Solicitud, normalized, equals the requested number;
    fields parsed (superficie as decimal hectares, dates as ISO dates,
    texts trimmed and space-collapsed);
  - `not_found`: the page says «no existe»;
  - `mismatch`: a row came back for another number (stored as
    `returned_solicitud`);
  - `unavailable`: timeout, connection error, non-200, or a page whose
    shape is not recognized (also logged at warning level).
- At most one request per second across the process (a lock and a
  monotonic clock).

### Storage (migration 0015)

`platform.conaf_solicitud`

| Column | Notes |
|---|---|
| `numero` | text PK, `^[0-9]{6,9}$` |
| `lookup_status` | `found` / `not_found` / `mismatch` / `unavailable` |
| `tipo`, `estado` | text, last found values |
| `superficie_ha` | numeric, last found |
| `fecha_ingreso`, `fecha_resolucion` | date, last found |
| `returned_solicitud` | text, set on `mismatch` |
| `checked_at` | last attempt |
| `found_at` | last successful read |
| `estado_changed_at` | when `estado` last changed |

`platform.conaf_cambio`: `id`, `numero` FK, `estado_anterior`,
`estado_nuevo`, `observed_at` — one row per observed change of `estado`
(not for the first read).

Rules: `unavailable` updates only `lookup_status` and `checked_at` and
keeps the last found data (shown as «sin actualizar»); `found` replaces
the fields and records a change row when `estado` differs from the stored
one; `not_found` and `mismatch` clear nothing, so an earlier good read is
not lost to a typo or a CONAF hiccup.

`forestry.report` gains `conaf_solicitud` (text, nullable, `^[0-9]{6,9}$`),
editable with the report header.

### Nightly refresh

A task in the app lifespan wakes every 10 minutes and runs once a day after
03:00 America/Santiago:

- collects the numbers: `numero_ingreso` and `numero_ingreso_2` of the
  active Transelec import (`platform.transelec_effective_row`), and
  `conaf_solicitud` of non-archived Rodales reports; normalizes and
  de-duplicates them;
- refreshes those not checked in the last 20 hours, one per second, at most
  2,000 per run;
- stops the run after 5 consecutive `unavailable` (CONAF down) and tries
  again the next night;
- logs a summary (counts per result, changes) and records it in
  `platform.conaf_run` (`started_at`, `finished_at`, counts) for the
  Consola.
- Failure-safe like the Consola tasks: an error is logged and the app keeps
  running.

### API

| Route | Access | Effect |
|---|---|---|
| `GET /api/conaf/solicitudes/{numero}` | session + VIEW on `transelect` or `forestry` | stored result; refreshed first when older than 12 h (or never read) |
| `POST /api/conaf/solicitudes/{numero}/refresh` | same + CSRF | refresh now, unless checked in the last 60 s |
| `GET /api/conaf/solicitudes?numeros=a,b,…` | same | stored results only (no CONAF calls), up to 500 numbers |

A number that does not normalize answers `422` «Ese número no se puede
consultar en CONAF (solo dígitos).». Responses carry the stored fields,
`lookup_status`, `checked_at`, `found_at`, `estado_changed_at`,
`stale` (`unavailable` or older than 36 h) and the public link to CONAF's
page for the number.

## Screens

- **Shared look:** an «Estado CONAF» chip coloured by meaning (aprobada →
  green, en evaluación/en trámite → blue, rechazada/denegada → red, other →
  grey), the raw CONAF text as its label, «consultado hace 3 h», «Cambió»
  when `estado_changed_at` is within 7 days, and «sin actualizar» when
  stale.
- **Transelec:**
  - Estado page: an «Estado CONAF» column next to the existing CONAF link,
    from the bulk route.
  - PMF drawer: a CONAF card (estado, tipo, superficie, fechas, «Actualizar
    desde CONAF», «Ver en CONAF»).
- **Rodales:**
  - editor panel: «N.º solicitud CONAF» field (editable in borrador and
    cambios solicitados) and the same CONAF card;
  - Informes list: a «CONAF» column.
- Messages: «CONAF no encuentra esa solicitud.», «CONAF respondió otra
  solicitud (069025); revise el número.», «No se pudo consultar CONAF
  ahora; se muestra el último dato.».

## Consola

`consola_export` adds a `conaf` block (last run time and counts, changes in
24 h, numbers stale more than 3 days) and an alert when the last run
stopped because CONAF was down or no run finished in 48 h.

## Testing

- Normalization: digits, padding, rejects `12/34-5/26`, letters, more than
  9 digits.
- Parser on synthetic HTML fixtures mirroring CONAF's markup (found, not
  found, mismatch, accents in ISO-8859-1, empty superficie, unknown shape).
  No real CONAF pages are committed.
- Lookup with a mocked HTTP transport: timeout, 500, 1 MiB cap, rate limit.
- Storage rules: found replaces and records a change; unavailable keeps the
  last data; first read records no change.
- Nightly task: collects from both products, skips fresh numbers, stops
  after 5 unavailable, writes a run row.
- Routes: access per product grant, CSRF on refresh, 60 s refresh guard,
  bulk cap, 422 on bad numbers.
- Screens: chip states, stale and changed badges, the Rodales field, the
  Transelec column.

## Risks and limitations

- **LIMITATION:** CONAF's page is not an API; a change in its markup stops
  the reads. They then show «sin actualizar» and the Consola alerts; nothing
  wrong is displayed.
- **LIMITATION:** status only; no documents.
- **RISK:** the `N Ingreso` / solicitud question above; the mismatch check
  limits the damage.
- **LIMITATION:** the 1-per-second pace makes the first full run take
  minutes for hundreds of numbers; it happens at night.

## Delivery

Two plans: (1) server: migration 0015, module, storage, nightly task, API,
Consola; (2) screens in Transelec and Rodales.
