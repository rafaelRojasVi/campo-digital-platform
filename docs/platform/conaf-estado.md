# Estado CONAF

## Status

Server side implemented 2026-10-16 on branch `feat/conaf-estado` (migration
`0015`); screens in Transelec and Rodales are the next plan. Not merged or
deployed. Design:
[spec](../superpowers/specs/2026-10-16-conaf-estado-design.md); plan:
[server](../superpowers/plans/2026-10-16-conaf-estado-server.md).

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

## Open questions

- **OPEN QUESTION:** whether the planilla's `N Ingreso` is CONAF's «N.º de
  solicitud»; the mismatch check prevents showing another solicitud.

## Related documentation

[Platform documentation](README.md) ·
[Security model](security-model.md) ·
[Rodales management reports](../../products/forestry/docs/management-reports-v1.md)
