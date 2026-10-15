# Platform Consola: security and usage view for the operator

Date: 2026-10-15. Status: **design approved in conversation, spec awaiting
review.** Step 2 of the monitoring plan; step 1 (server-error reporting to
Sentry, PR #96) is live.

## Purpose

Rafael operates the Campo Digital platform (Transelec and Rodales on Railway)
but has no `@campodigital.cl` account, so he cannot sign in to production.
Railway's Hobby plan shows logs and basic metrics but sends no alerts and
understands nothing about security; HTTP logs are kept per deployment. Sentry
now reports server errors. What is still missing is one place where the
operator can see:

- **security threats**: rejected sign-ins, accounts from outside the allowed
  Workspace domain, bursts of `401`/`403` from one IP, CSRF failures,
  permission denials;
- **activity by person**: who signed in, uploaded, validated, published or
  restored, per product;
- **usage by product**: sign-ins, uploads and publishes per day;
- **health**: the current Railway deployment and a link to Sentry.

## Decisions (from the conversation)

- **DECISION: a local tool, not a page in the platform.** It runs on the
  operator's machine and reads production through the Railway CLI
  (`railway ssh`). Nothing new is exposed on the internet, no new role or
  sign-in exception is added, and no database credential is stored locally.
- **DECISION: format.** `make consola` opens a page on `127.0.0.1:8787`.
- **DECISION: retention.** Security events are kept 90 days.
- **DECISION: errors.** The Consola links to the Sentry project; it does not
  call the Sentry API.
- **DECISION: no notifications.** The Consola is looked at when opened.
  Urgent signals (crashes, downtime) already reach the operator's email from
  Sentry.

## Part 1: what the platform records

### Table `platform.security_event` (migration 0013)

| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity | |
| `occurred_at` | timestamptz | start of the minute for aggregated rows |
| `event_type` | text, checked | see below |
| `product_key` | text, nullable | `transelect` / `forestry` when known |
| `actor_app_user_id` | bigint, nullable, FK `app_user` | only when a session identified the user |
| `client_ip` | inet, nullable | see "Client IP" |
| `path` | text | URL path only, never the query string |
| `http_status` | smallint | |
| `count` | integer, default 1 | > 1 only for aggregated `auth.required` rows |
| `reason` | text, nullable | a short code from a fixed list, never free text |

Indexes on `occurred_at` and `(client_ip, occurred_at)`.

**Never stored:** tokens, cookies, OAuth codes, query strings, request or
response bodies, full email addresses. For a rejected outside account the
reason is `domain_not_allowed`; the account's domain is not stored either,
because Google does not assert one for personal accounts and the code path
should not need it.

### Event types and where they are produced

| `event_type` | Produced at | `reason` codes |
|---|---|---|
| `sign_in.rejected` | `routers/google_auth.py` callback, each rejection branch | `flow_cookie_missing`, `flow_cookie_invalid`, `domain_not_allowed`, `token_invalid` |
| `csrf.rejected` | `csrf.require_csrf`, both `403` branches | `origin_untrusted`, `token_invalid` |
| `access.denied` | `deps.ensure_can` (`403 Not permitted for this product.`), which knows the user and product | `no_grant` (no role), `action_not_allowed` (role lacks the action) |
| `auth.required` | any `401` answer | none |

Producers do not write to the database themselves. They set a small
`SecurityEventNote` (type, reason, product) on `request.state`; a single
middleware writes rows after the response status is known. That keeps
routes free of logging plumbing and puts every write behind one
failure-safe path.

`GoogleSignInError` currently carries free text. Mapping it to the fixed
codes needs a typed reason on the exception (or a mapping from the known
messages in `google_auth.py`); the free text is never stored.

### `SecurityEventMiddleware`

- Sits inside `SecurityHeadersMiddleware`, next to `RequestBodyLimitMiddleware`.
- After the response: if `request.state` carries a note, writes one row.
  Otherwise, a `401` answer is counted as `auth.required`.
- **`auth.required` is aggregated in memory** per `(client_ip, path, minute)`
  and flushed once a minute by a background task in the app's lifespan. A
  bot sending thousands of requests produces one row per IP, path and
  minute, not thousands of writes. The service runs one replica (the volume
  requires it), so an in-process counter is complete. Counters still in
  memory at shutdown are flushed in the lifespan's `finally`.
- **Failure-safe:** a write or flush that fails is logged at warning level
  and dropped. It never changes the response or crashes the app.
- Requests to `/ready`, `/health` and static assets are ignored.

### Client IP

The app runs behind Railway's edge proxy, so the socket peer is a Railway
address (the logs show `100.64.x.x`). The client IP is read from the
proxy-set forwarding header, taking the address the edge appended, and only
when the peer is in Railway's private range; otherwise the peer address is
used. **OPEN QUESTION, resolved during implementation:** which header
Railway sets and in what order. Verify with `railway logs --http --json`
(`srcIp`) against what the app sees before relying on it.

### Retention

A daily task in the lifespan deletes `security_event` rows older than 90
days. It is idempotent and failure-safe like the middleware.

## Part 2: the local Consola

### Data export inside the image: `app/consola_export.py`

A module shipped in the production image and run with
`python -m app.consola_export`. It opens one **read-only transaction**
(`SET TRANSACTION READ ONLY`), runs fixed queries and prints a single JSON
document to stdout. No arguments are interpolated into SQL. Because it ships
with the app, it is versioned, tested in CI against a real PostGIS, and
always matches the deployed schema.

The document contains:

- `generated_at`, `window` (last 24 h for alerts, 7 days for activity and
  usage);
- `alerts`: computed from fixed rules, each with a count and a severity:
  rejected sign-ins in 24 h; any `domain_not_allowed`; any IP with more than
  60 `auth.required` in one minute; any `csrf.rejected`; any
  `access.denied`;
- `activity`: `audit_event` rows from the last 7 days with the actor's
  display name (never the email), event type, product and subject;
- `suspicious_ips`: top 20 IPs by `401`/`403` count in 7 days, with first
  and last seen;
- `usage`: per day and product, the counts of sign-ins (`session.created`),
  uploads, validations and publishes from `audit_event`.

### Local runner: `scripts/consola.py` and `make consola`

- On start and on each "Actualizar", runs
  `railway ssh --service campo-digital-platform -- sh -c 'cd /app/apps/api
  && /app/.venv/bin/python -m app.consola_export'` and parses the JSON. It
  also runs `railway deployment list --json` for the health section.
- Serves the page and the JSON with the standard library on
  **`127.0.0.1:8787` only**, opens the browser, and keeps data in memory.
  Nothing is written to disk.
- The page (`scripts/consola/index.html` with inline CSS and JS, no build
  step) shows five sections: Alertas hoy, Actividad, IPs sospechosas, Uso por
  producto, Salud (deployment id, commit, status, time, plus links to Sentry
  and Railway). Spanish labels, the platform's palette, readable in light
  and dark.
- Errors are shown in plain words: Railway CLI missing, not logged in, ssh
  failure, export failure (with the exit status), never a stack trace of
  production data.

### Opening it easily on Ubuntu (WSL2 and native)

**DECISION (2026-10-15):** besides `make consola`, the Consola must open
without remembering commands or folders.

- `make consola-install` installs, for the current user only:
  - `~/.local/bin/consola`, a small launcher that runs the Consola from this
    repository's path (resolved at install time) from any folder;
  - `~/.local/share/applications/campo-consola.desktop` with an icon, so it
    appears as "Consola Campo Digital" in the Ubuntu applications menu. On
    WSL2 with WSLg the same entry appears in the Windows Start menu.
- `make consola-uninstall` removes both.
- If the Consola is already running, the launcher opens the browser on the
  existing page instead of starting a second one.
- **Browser:** under WSL (detected from `/proc/version` or `WSL_DISTRO_NAME`)
  the page opens in the Windows browser with `wslview` when available, else
  `explorer.exe`; on native Ubuntu with `xdg-open`. If none works, the URL
  is printed.

### Visual design

**DECISION (2026-10-15):** the page is designed, not a raw table dump. It is
an operations view the operator scans: state first, detail after.

- **Summary first:** a top band with the overall status ("Todo normal" /
  "N alertas") as a coloured state chip, the time of the last refresh, and
  an "Actualizar" button.
- **Alerts as cards** with a severity stripe (critical, warning, info) and a
  plain sentence ("3 inicios de sesión rechazados en 24 h"), each linking to
  the rows behind it.
- **Usage as small charts:** one sparkline or bar row per product (sign-ins,
  uploads, publishes per day over 7 days), drawn to scale, with the numbers
  shown.
- **Activity as a timeline** (time, person, action, product), and
  **suspicious IPs as a ranked table** with counts and first/last seen.
- **Health** shows the deployment as a chip (status colour), commit, time,
  and buttons to Sentry and Railway.
- The platform's forest palette and typography, semantic colours for
  severity kept separate from the accent, tabular numbers, light and dark
  themes, keyboard focus visible, works at laptop and narrow widths. Built
  with the UI skills (`ui-ux-pro-max`, web design guidelines) and reviewed
  in a browser before delivery.
- An **empty state** that reads as good news ("Sin alertas en las últimas
  24 h") and a **loading state** while `railway ssh` runs (it takes a few
  seconds).

## Part 3: testing

- **Recording:** each producer sets the right note; the middleware writes
  one row per note with path but no query string; `401`s aggregate per IP,
  path and minute; ignored paths are ignored; a failing write does not
  change the response.
- **Privacy:** a request carrying a token, a cookie, an OAuth code and a
  query string leaves none of them in `security_event`.
- **Client IP:** forwarded header trusted only from the private range.
- **Retention:** rows older than 90 days are deleted, newer ones kept.
- **Migration:** upgrade and downgrade against PostGIS in the persistence CI.
- **Export:** the JSON shape and alert rules against seeded test data; the
  transaction is read-only (a write inside it fails).
- **Runner:** the page renders from a fixture JSON; CLI failures produce
  the plain-language error; the server binds only to `127.0.0.1`.
- **Launcher:** install writes both files with the resolved repository path
  and uninstall removes them; the browser opener picks `wslview`,
  `explorer.exe` or `xdg-open` from the environment; a second launch reuses
  the running Consola.
- **Visual:** reviewed in a browser with fixture data covering alerts, no
  alerts and an export failure, in light and dark.

## Out of scope

Email or chat notifications, the Sentry API, a screen inside the platform,
access for anyone other than the operator, blocking or rate-limiting IPs
(the Consola observes; acting on it is a separate decision), and browser
errors from the dashboards.

## Risks and limitations

- **LIMITATION:** the Consola depends on `railway ssh` working from the
  operator's machine; without it, nothing is shown.
- **LIMITATION:** IP addresses are personal data. They are kept 90 days, only
  for security review, and shown only on the operator's machine.
- **LIMITATION:** the single-replica assumption makes in-memory aggregation
  complete. If the service ever scales out, aggregation must move to the
  database (an upsert on the minute bucket).
- **RISK:** a bug in the middleware could affect every response. Mitigation:
  writes happen after the response is produced, every path is wrapped, and
  tests cover the failure case.
