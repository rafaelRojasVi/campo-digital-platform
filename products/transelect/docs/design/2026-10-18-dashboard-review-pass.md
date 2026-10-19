# Transelec dashboard review pass — 2026-10-18

## Status

Branch `feat/transelec-ux-pass`. Presentation and request handling only: no
calculation, reading rule or workbook contract changed. Not deployed
(production is down while the Railway plan is inactive).

## Observations (local stack, published import #5, 1440×900 and 390×844)

- **FACT** — «Abrir Oficina Virtual CONAF» (Estado table, PMF drawer) passed
  the planilla's `N Ingreso` to CONAF's public consulta. That consulta takes
  the 6-digit SAFF number from the comprobante de ingreso; the 8-digit
  `N Ingreso` values answer «no existe» and the slash-shaped ones open an
  empty form. The «Estado CONAF» column had already been hidden for the same
  reason (`CONAF_ESTADO_ENABLED`, 2026-10-17).
- **FACT** — Estado rendered 159 PMF rows in a 12,069 px page with no search
  or way to narrow the table to a group or step.
- **FACT** — On arrival the Explorador walked every PMF page twice (filter
  options and web-edit suggestions, each through `collectAllRows`), about
  1.4 MB uncompressed; three times in the dev server under StrictMode.
- **FACT** — Resumen placed «Requiere atención» and «Cola de trabajo» after
  three breakdown tables; «Estado resumido por predio» showed two
  near-identical bars; the reforestation caveats were a long paragraph;
  company links used the browser's default blue; disabled buttons were
  faded to 45 % opacity.

## Decisions

- **DECISION (superseded the same day, see docs/platform/conaf-estado.md
  «Correction»)** — The «Abrir» link follows `CONAF_ESTADO_ENABLED`
  (`src/lib/conafFlag.ts`): while it is off only «Copiar N.º» shows, and the
  Estado column is headed «N.º para copiar». Turning the switch on restores
  the link, the column and the drawer card together. Since 2026-10-19 the
  link no longer follows the switch: it is always shown, while the switch
  (off again) governs only the column and the drawer card.
- **DECISION** — Estado: each legend entry of «PMF por grupo» and «En
  trámite, por paso» is a button that narrows the table to that group or
  step (choosing it again shows all); a search by PMF or N.º de ingreso;
  «Ver todos» clears both. These are local to the page and do not change the
  shared filters. The table scrolls inside itself (max 72 vh) with its
  sticky header, so the page is about 1,400 px tall; printing shows every
  row.
- **DECISION** — `collectAllRows` shares a walk already in progress for the
  same filters; once it settles the next call walks again, so a web edit is
  never hidden behind a stale copy. Measured: 12 page requests on arrival
  became 4. The API compresses `pmfs`, `lifecycle`, `plazos`, `aef` and
  `pending` (`app.compression`, PR #110).
- **DECISION** — Resumen order: headline, «Requiere atención», «Cola de
  trabajo», then the breakdowns (estado detallado, por empresa), alcance,
  estado por predio (one bar) and reforestación (caveats inside «Cómo se
  calcula»). Company links use the platform green; disabled buttons use
  solid colours.

## Related documentation

[Usability pass 2026-09-26](2026-09-26-dashboard-usability-pass.md) ·
[Estado CONAF (es)](../es/2026-10-16-estado-conaf.md)
