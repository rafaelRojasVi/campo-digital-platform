# Transelec production container packaging

## Status

Container packaging: **built and locally verified** (this document).
No managed infrastructure has been provisioned. This document describes how
to build and run the image locally; it does not itself provision or expose
anything.

Read first, and treat as authoritative over this document if they disagree:

- [`docs/platform/production-platform-v1.md`](../../../docs/platform/production-platform-v1.md)
- [`docs/platform/environments-and-costs.md`](../../../docs/platform/environments-and-costs.md)
- [`docs/platform/security-model.md`](../../../docs/platform/security-model.md)

## Architecture

One container runs the shared platform API together with the Transelec
dashboard's static build:

```text
Browser
  |
  v
FastAPI (apps/api/app/main.py)
  |-- GET  /                    -> React production build (same origin)
  |-- GET/POST /transelec/*     -> real Transelec read/write API
  |-- GET/POST /api/transelec/* -> same API, the prefix the dashboard's
  |                                own bundle calls (see api.ts)
  |-- GET/POST /auth/*, /api/auth/* -> session, CSRF, and (dev-only) dev-auth
  |-- GET /health, GET /ready
  |
  +-- PostgreSQL/PostGIS -- platform.transelec_import, transelec_pmf_row,
                             transelec_publish_event, transelec_dashboard_state
```

`app.dashboard_static.mount_dashboard` mounts the built dashboard as a
same-origin SPA fallback (no CORS surface) — see that module's docstring.
The `/api/*` alias duplicates ROUTING ONLY for the CSRF, dev-auth, and
Transelec routers: same router objects, same dependencies, same RBAC. It
exists because every frontend on this platform is compiled once against a
same-origin `/api/*` convention and normally reaches the API through an
external rewrite (the Vite dev proxy locally, Render's static-site rewrite
in staging — see `render.yaml`); a bare container has no such external layer
in front of it, so `app.main` provides that alias itself.

Both LiDAR and Transelec routers are mounted in the same FastAPI process
(the platform's modular monolith), so this image ships the full platform
dependency stack (numpy/scipy/pandas/laspy/matplotlib for LiDAR) even though
it only serves Transelec's frontend. **LIMITATION**: this makes the image
large (~1.06 GB at the time of writing) and rebuilds on any LiDAR dependency
bump. Splitting the composition root by product is a reasonable future
optimization, not attempted here.

## Auth

This container runs the platform's real session/CSRF/RBAC stack — the same
one Tasks 2–4 built and tested — not a bespoke Transelec credential. There
is no `CAMPO_TRANSELEC_ADMIN_TOKEN` or equivalent product-specific auth.

**OPEN QUESTION / LIMITATION**: outside `APP_ENV=development`, the only
session-creation route currently mounted is dev-auth's `/auth/dev-login`,
and `app.main` gates that route to development only (see
`apps/api/tests/test_main_dev_auth_gate.py`). A real identity provider
(Entra ID; `msal` is already a dependency) is Task 7's scope, not this
task's. **This means a container run with `APP_ENV=production` or
`APP_ENV=staging` today has no way for anyone to create a session at all** —
`platform.PlatformSessionStore`-backed sessions exist and are checked first
by `get_current_app_user`, but nothing in this codebase yet issues one
outside dev-auth. This is expected and is exactly the gap Task 7 closes; it
is not a defect in this packaging work.

## Container image

`Dockerfile` (repo root) is a two-stage build, adapted from the *shape* of
the superseded `feat/transelec-hosted-pilot-v1` branch's Dockerfile (see
`docs/superpowers/specs/2026-09-02-transelec-hosted-pilot-v2-design.md`,
where that branch is referenced as prior art, "PR #47") — not copied: that
draft predates this branch's real session/CSRF/RBAC work, used a
`CAMPO_TRANSELEC_ADMIN_TOKEN` this branch does not have, and installed a
Cloud Storage SDK layer this branch's `app.object_store` has no backend for
yet (omitted here as speculative runtime weight).

1. `node:24.19.0-slim` builds `products/transelect/dashboard` into static
   assets (`npm ci && npm run build`).
2. `python:3.12-slim` installs locked dependencies with `uv sync --frozen
   --no-dev --extra api --extra transelec` (matches `render.yaml`'s own
   buildCommand for the shared platform API service), copies the built
   dashboard assets into `products/transelect/dashboard/dist`, and runs as
   a non-root `campo` user (uid/gid 999).

The container listens on `0.0.0.0:$PORT` (defaults to `8080`).

### Build and run locally

```bash
docker build -t campo-digital-transelec:local .

# Without a reachable database — /health is still up, /ready fails closed:
docker run --rm -d --name transelec-smoke -p 18080:8080 \
  -e APP_ENV=development -e POSTGRES_PASSWORD=local-only \
  campo-digital-transelec:local

docker exec transelec-smoke whoami   # -> campo
docker exec transelec-smoke id       # -> uid=999(campo) gid=999(campo)
curl -s http://127.0.0.1:18080/health   # -> {"status":"ok"}       (200)
curl -s http://127.0.0.1:18080/ready    # -> {"status":"not_ready"} (503)
docker stop transelec-smoke
```

**RESULT** (recorded during Task 6, 2026-09-02): built and run exactly as
above, then re-run with `--network host` and `POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5433` (this repo's disposable `postgres-test` compose service,
migrated to head) to exercise the full path: `/ready` returned `200`; `/`
served the dashboard shell; `/transelec/summary` and `/api/transelec/summary`
both returned `401 {"detail":"Not authenticated."}` without a session;
`POST /api/auth/dev-login {"identity_key":"dev-admin"}` set a session cookie
and returned the seeded `transelect: admin` grant; the same cookie against
`/api/transelec/summary` reached real business logic and returned
`404 {"detail":"No hay una versión publicada de Transelec."}` — the correct
response for a fresh database with nothing imported yet, not an error.
`whoami`/`id` confirmed the process runs as the non-root `campo` user.

## Database

Use the shared platform PostgreSQL/PostGIS instance and the `platform`
schema already established by earlier migrations — do not provision a
Transelec-specific database server (see
[`production-platform-v1.md`](../../../docs/platform/production-platform-v1.md)).
This container does not run migrations on startup, by design (see that same
document, "no implicit destructive migration on app startup"); apply
`alembic upgrade head` as a separate release step against this image before
routing traffic to it.

## Object storage

`app.object_store` currently ships only `LocalObjectStore`
(`CAMPO_OBJECT_STORE_ROOT`, default `.local/object-store` under the
container's writable `/app`, owned by the `campo` user). There is no managed
object-storage backend wired in yet — provisioning one (Cloud Storage or
otherwise) is future work, not attempted here, and is not required for the
local verification this document records.

## Deployment classification

Per the design doc's required classification (local operational use /
synthetic staging / private real-data deployment), and per this task's own
scope (does not provision infrastructure, does not deploy anywhere, does not
put real Transelec data anywhere):

- **Ready for local operational use**: yes — build, run, health/readiness,
  non-root, and the full authenticated read path were all verified locally
  against a real (disposable, synthetic-schema-only) database, per the
  RESULT above.
- **Ready for synthetic staging**: not attempted here. `render.yaml`
  deliberately does not add a hosted deployment for this app (see Task 5's
  report §8.4 and ADR-007's classification of Transelec as blocked for
  public staging) — nothing in this task changes that.
- **Ready for a private real-data deployment**: no. This container has no
  way to authenticate anyone outside `APP_ENV=development` (see "Auth"
  above) — real per-user sign-in (Entra ID) is Task 7's scope. No cloud
  infrastructure was provisioned or priced by this task.

## Related documentation

[Transelec product overview](../README.md) ·
[Transelec dashboard](../dashboard/README.md) ·
[Source Contract V1](source-contract-v1.md) ·
[Platform documentation](../../../docs/platform/README.md)
