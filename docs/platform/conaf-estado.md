# Estado CONAF

## Status

Implemented 2026-10-16 on branch `feat/conaf-estado` (migration `0015`):
server, nightly refresh, API, Consola block, and screens in Transelec (Estado
column, PMF drawer card) and Rodales (report field and card, Informes list
column). Verified in a local browser against one real public lookup
(`090663`); the Transelec screens were verified by component tests only.
Merged (PR #105, `87338cb`) and deployed 2026-10-17 (Railway `f6baf244`). Design:
[spec](../superpowers/specs/2026-10-16-conaf-estado-design.md); plans:
[server](../superpowers/plans/2026-10-16-conaf-estado-server.md),
[screens](../superpowers/plans/2026-10-16-conaf-estado-screens.md). User
notes (Spanish):
[Transelec](../../products/transelect/docs/es/2026-10-16-estado-conaf.md),
[Rodales](../../products/forestry/docs/es/informes-de-manejo.md#estado-conaf).

## What is read

- **FACT (2026-10-16):** CONAF's public consulta page
  `https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=<n>`
  answers one HTML row (ISO-8859-1): Solicitud, Tipo de Solicitud,
  Superficie, Fecha de Ingreso, Estado, Fecha de Resolución; an unknown
  number says «La solicitud indicada no existe.»; `robots.txt` is empty.
- **FACT:** the number must be sent with six digits; without the leading
  zero CONAF answers another solicitud.
- **DECISION:** status only. Documents are behind the titular's ClaveÚnica
  and are never accessed.

## Server

- `app/conaf.py`: `normalize_solicitud` (1–9 ASCII digits, padded to six),
  one request per second, 10 s socket timeout and 15 s for the whole read,
  at most 1 MiB, parse with the standard library. An interactive lookup
  waits at most 2 s for another one; when CONAF is busy the API answers
  with the stored result, or `503` «CONAF está ocupado…» for a number never
  read. Superficie must be finite, non-negative and below 10^10 ha. Results: `found` (the returned Solicitud equals the
  requested one), `not_found`, `mismatch`, `unavailable`.
- `app/conaf_store.py`: `platform.conaf_solicitud` (last result),
  `platform.conaf_cambio` (each change of `estado`), `platform.conaf_run`
  (nightly runs).
  - **DECISION:** `unavailable`, `not_found` and `mismatch` keep the last
    found data.
- `app/conaf_refresh.py`: after 03:00 America/Santiago, once a day, inside
  the app (one replica, no queue). Numbers come from the active Transelec
  import (`numero_ingreso`, `numero_ingreso_2`) and non-archived Rodales
  reports (`conaf_solicitud`). It refreshes those unchecked for 20 h, at
  most 2,000, and stops after 5 consecutive `unavailable`. A number whose
  save fails is skipped and the run continues; the run row is always
  closed. On shutdown the run stops between numbers (`shutdown`), and a run
  that never finished is retried the same day. Enabled when
  `APP_ENV=production` or `CONAF_REFRESH_ENABLED=1`.
- `GET /api/conaf/solicitudes/{numero}`: refreshes when never read, older
  than 12 h, or `unavailable` for 15 min.
- `POST /api/conaf/solicitudes/{numero}/refresh`: CSRF; not within 60 s of
  the last check.
- `GET /api/conaf/solicitudes?numeros=…`: stored data only, up to 500.
- All routes need VIEW on `transelect` or `forestry`.
- Rodales reports gain `conaf_solicitud` (PATCH; `null` clears it).
  **DECISION (2026-10-16, Rafael):** a PATCH that carries only
  `conaf_solicitud` is accepted in every status except `archivado`, because
  the solicitud number exists only after internal approval and it never
  changes the polygons. Other header fields stay limited to `borrador` and
  `cambios_solicitados`.
- The Consola export gains a `conaf` block, plus alerts `conaf_down` and
  `conaf_no_run`.

## Limitations

- **LIMITATION:** CONAF's page is not an API. A markup change makes reads
  `unavailable`; the Consola alerts and the last good data stays.
- **LIMITATION:** superficie is read with `.` or `,` as the decimal mark;
  a page with thousands separators (`1.234,5`) has not been seen and would
  be misread or dropped.
- **LIMITATION:** one request per second; the first nightly run over
  hundreds of numbers takes minutes.

## First production run (2026-10-17)

- **RESULT (2026-10-17 15:10 UTC, Consola export):** the first nightly run
  started minutes after deploy `f6baf244` (the rule is "after 03:00 Chile,
  once a day", so a daytime deploy runs the same day). It checked 10 numbers:
  0 found, 10 `not_found`, 0 `unavailable`; no Rodales report had a number yet.
- **FACT (2026-10-17, read-only, shapes only; no values recorded):** the
  active Transelec import has 729 rows. Their `N Ingreso` shapes: about 620
  use slashes and a dash (`999/999-9/99` and variants), which the
  normalization skips; 101 are 8 digits, all starting with `10`, holding 10
  distinct values; none parse as dates. Those 10 are the `not_found` numbers.
  `N Ingreso2` is empty in 705 rows and slash-shaped in the rest.
- **INFERENCE (withdrawn 2026-10-18, see Correction):** the planilla's `N Ingreso` is not the solicitud number that
  CONAF's public consulta takes (six digits, such as `090663`). The
  slash shape resembles a regional office ingreso number; this is unconfirmed.
- **DECISION (2026-10-17, Rafael):** the Transelec column and drawer card
  are hidden (`CONAF_ESTADO_ENABLED = false` in
  `products/transelect/dashboard/src/lib/conafColumn.tsx`) until Campo
  Digital says which number is CONAF's solicitud, so users do not see
  101 «No existe en CONAF» warnings for numbers that were never solicitud
  numbers. Rodales is unchanged. The nightly run still collects the
  Transelec numbers (10 lookups a night), so the data is ready if the flag
  is turned back on.

## Correction: the slashed `N Ingreso` is CONAF's number (2026-10-18)

- **FACT (2026-10-18, reported by Rafael from CONAF's page, then reproduced
  by GET and POST):** CONAF's public consulta answers the planilla's slashed
  `N Ingreso` as written. `12/345-6/24` returns its row (Ley 20.283 obras
  civiles, the PMF's total area, APROBADA). Sent as a link the
  slashes are URL-encoded (`nsolicitud=12%2F345-6%2F24`).
- **FACT:** the 2026-10-17 INFERENCE above was wrong. It came from querying
  only the numbers the normalization let through (the 8-digit `10…` ones,
  which do answer «no existe»); the slashed numbers were never sent. The
  2026-10-05 note in `OficinaVirtualLink.tsx` that slashed numbers failed was
  also wrong.
- **DECISION (2026-10-18):**
  - `normalize_solicitud` accepts 1–9 digits (padded to six, as before) and
    `correlativo/oficina-código/año` numbers kept as written; a typo such as
    `16/345-10-25` is not corrected and stays unqueryable.
  - `solicitudes_in_cell` returns every number of a planilla cell: some
    cells hold the ingreso and the reingreso together; the nightly run
    collects both, and the Transelec column reads the most recent (last of
    `N Ingreso2`, else of `N Ingreso`).
  - Migration 0016 widens both CHECK constraints to that shape.
  - The `/api/conaf/solicitudes/{numero:path}` routes accept the slashes.
  - `CONAF_ESTADO_ENABLED` is on again (`src/lib/conafFlag.ts`), and the
    «Abrir Oficina Virtual» link opens the result with the number entered.
- **RESULT (2026-10-18, live, three lookups one second apart):**
  `12/345-6/24` found (APROBADA, resolution 2024-08-26); a two-number cell's
  most recent number found APROBADA with a resolution three days old, while
  the planilla still shows the PMF «En evaluación»; `10099991` not found.

## Open questions

- **OPEN QUESTION:** what the 8-digit `N Ingreso` values starting with `10`
  are (10 distinct, in 101 rows): CONAF's consulta does not know them.
  They may be numbers from another CONAF system; Campo Digital can say.

## Related documentation

[Platform documentation](README.md) ·
[Security model](security-model.md) ·
[Rodales management reports](../../products/forestry/docs/management-reports-v1.md)
