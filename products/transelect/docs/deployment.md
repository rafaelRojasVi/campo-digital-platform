# Transelec hosted pilot — deployment runbook

## Status

Pilot deployment packaging. **No managed infrastructure has been provisioned
by this document** — it describes how to build, run locally, and deploy the
service; it does not itself provision or expose anything.

This runbook implements the smallest architecture consistent with the
canonical platform direction. Read first, and treat as authoritative over
this document if they disagree:

- [`docs/platform/production-platform-v1.md`](../../../docs/platform/production-platform-v1.md)
- [`docs/platform/environments-and-costs.md`](../../../docs/platform/environments-and-costs.md)
- [`docs/platform/security-model.md`](../../../docs/platform/security-model.md)

## Architecture

One Cloud Run service runs the whole hosted pilot:

```text
Browser (Javier's team)
  |
  v
Cloud Run IAP  ---------------------------------- viewer access gate
  |
  v
FastAPI (apps/api/app/main.py)
  |-- GET /, /assets/*        -> React production build (same origin)
  |-- GET/POST /transelec/*   -> legacy-compatible JSON API
  |-- GET/POST /api/transelec/* -> same JSON API, canonical prefix
  |
  +-- Cloud SQL (PostgreSQL/PostGIS) -- platform.transelec_workbook_snapshot,
  |                                     platform.transelec_dashboard_state,
  |                                     platform.source_* provenance tables
  |
  +-- Cloud Storage (private bucket) -- content-addressed workbook bytes
                                         (apps/api/app/object_storage.py)
```

There is no separate frontend service, no Kubernetes, no microservice split,
and no Redis/Kafka/Celery — consistent with
[`production-platform-v1.md`](../../../docs/platform/production-platform-v1.md)'s
V1 non-goals.

Both the LiDAR and Transelec routers are mounted in the same FastAPI process
(modular monolith), so this image currently ships with the full platform
dependency stack (numpy/scipy/pandas/laspy for LiDAR) even though this pilot
only exercises Transelec. Splitting the composition root by product is a
reasonable future optimization, not required for this pilot.

## Container image

`Dockerfile` (repo root) is a two-stage build:

1. `node:24.19.0-slim` builds `products/transelect/dashboard` into static
   assets (`npm ci && npm run build`).
2. `python:3.12-slim` installs locked dependencies with `uv sync --frozen
   --no-dev --extra api --extra transelec` (pinned by `uv.lock`; matches
   `[tool.uv].required-version` in `pyproject.toml`), copies the built
   dashboard assets into `products/transelect/dashboard/dist`, and runs as a
   non-root `campo` user.

The optional Cloud Storage object-store backend
(`apps/api/app/object_storage.py`) is installed via a separate pinned `uv pip
install google-cloud-storage==2.18.2` layer rather than added to
`pyproject.toml`/`uv.lock` — this keeps local development and CI free of any
Google Cloud dependency. Re-verify that pinned version is still current
before rebuilding for a real deployment.

The container listens on `0.0.0.0:$PORT` (Cloud Run sets `$PORT`; it
defaults to `8080` for local runs).

Build and smoke-test locally:

```bash
docker build -t campo-digital-transelec-pilot .

docker run --rm -p 8080:8080 \
  -e POSTGRES_PASSWORD=local-only \
  -e CAMPO_TRANSELEC_WORKBOOK_PATH=/path/that/does/not/exist.xlsx \
  campo-digital-transelec-pilot

curl -s http://127.0.0.1:8080/health
curl -s http://127.0.0.1:8080/            # dashboard shell (200)
curl -s http://127.0.0.1:8080/api/transelec/summary  # 503 (no source configured)
```

This was built and run during implementation of this pilot; `/health`
returned `200`, `/` served the dashboard shell, `/api/transelec/summary`
correctly returned a structured `503` with no source configured, and the
process ran as the non-root `campo` (uid 999) user — see the verification
evidence in the delivery PR for the exact commands and output.

## Local demo (unchanged)

The pre-existing local-workbook demo mode still works without any database:

```bash
export CAMPO_TRANSELEC_WORKBOOK_PATH=/absolute/path/to/PlanillaMaestra.xlsx
uv run uvicorn app.main:app --app-dir apps/api --host 127.0.0.1 --port 8000 --reload
cd products/transelect/dashboard && npm ci && npm run dev
```

See [`products/transelect/dashboard/README.md`](../dashboard/README.md).

## Database: Cloud SQL

- Provision a PostgreSQL/PostGIS Cloud SQL instance (Santiago region, per
  [`production-platform-v1.md`](../../../docs/platform/production-platform-v1.md)).
  Do not create a Transelec-specific database server; use the shared
  platform instance and the `platform` schema, as already established by
  migrations `0001`–`0003`. This is a deliberate interim pilot placement,
  not a dedicated `transelec` schema — see
  [production-platform-v1.md § Interim placement: Transelec hosted-pilot tables](../../../docs/platform/production-platform-v1.md#interim-placement-transelec-hosted-pilot-tables).
- Connect Cloud Run to Cloud SQL using the
  [Cloud SQL Unix-socket connection](https://cloud.google.com/sql/docs/postgres/connect-run),
  not a public IP. `apps/api/app/config.py` supports this natively: set
  `POSTGRES_UNIX_SOCKET_PATH=/cloudsql/<PROJECT>:<REGION>:<INSTANCE>` and
  attach the Cloud SQL instance to the Cloud Run service (`--add-cloudsql-instances`
  below); `POSTGRES_HOST`/`POSTGRES_PORT` are then ignored.
- Apply migrations before (or as part of) each release, from a machine/job
  with Cloud SQL access — this pilot has no auto-migrate-on-startup by
  design (`production-platform-v1.md`: "no implicit destructive migration on
  app startup"):

  ```bash
  # from Cloud SQL Auth Proxy or a Cloud Run Job with the same env
  APP_ENV=production uv run alembic upgrade head
  ```

- `scripts/migration_check.py` is the safety-checked lifecycle validator
  used in CI (`make migration-check`); it refuses to run against anything
  that isn't an explicitly named test database
  (`apps/api/app/db_safety.py`), so it is not itself a production migration
  tool — use plain `alembic upgrade head` in production, against a database
  whose credentials are scoped to migrations.

## Object storage: Cloud Storage

- Create a **private** Cloud Storage bucket (no public access, uniform
  bucket-level access). Workbook bytes are content-addressed by SHA-256
  under `transelec/workbooks/sha256/<aa>/<hash>.<ext>`
  (`apps/api/app/object_storage.py`) — PostgreSQL stores only the key and
  business metadata, never the bytes, per
  [`production-platform-v1.md`](../../../docs/platform/production-platform-v1.md)'s
  object-storage strategy.
- Grant the Cloud Run service's runtime service account
  `roles/storage.objectAdmin` scoped to that one bucket (not project-wide).
- Configure:

  ```bash
  CAMPO_OBJECT_STORE_BACKEND=gcs
  CAMPO_OBJECT_STORE_GCS_BUCKET=campo-digital-transelec-pilot-objects
  ```

- Local development and CI use `CAMPO_OBJECT_STORE_BACKEND=local` (the
  default), which writes to a gitignored directory and needs no Google Cloud
  credentials.

## Access: Cloud Run IAP

For the pilot, gate the whole Cloud Run service with
[Identity-Aware Proxy](https://cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run),
restricted to Javier's team's Google identities:

```bash
gcloud run services add-iam-policy-binding campo-digital-transelec-pilot \
  --region=southamerica-west1 \
  --member="group:transelec-pilot@example.com" \
  --role="roles/run.invoker"

gcloud beta iap web enable --resource-type=backend-services \
  --service=campo-digital-transelec-pilot
```

This is a pilot-scoped access decision, not the platform's final identity
provider — that remains an open decision in
[`security-model.md`](../../../docs/platform/security-model.md).
`CAMPO_TRANSELEC_ADMIN_TOKEN` (below) protects only the upload/restore
*mutations* underneath IAP; it is not a substitute for IAP.

## Secrets

Store `POSTGRES_PASSWORD` and `CAMPO_TRANSELEC_ADMIN_TOKEN` in Secret
Manager and inject them as Cloud Run environment variables backed by secret
versions (`--set-secrets`), never baked into the image or committed. See
[`security-model.md`](../../../docs/platform/security-model.md) for the
platform secrets policy.

## Cloud Run deployment example

```bash
gcloud run deploy campo-digital-transelec-pilot \
  --image=REGION-docker.pkg.dev/PROJECT/campo-digital/transelec-pilot:TAG \
  --region=southamerica-west1 \
  --no-allow-unauthenticated \
  --add-cloudsql-instances=PROJECT:REGION:INSTANCE \
  --set-env-vars=APP_ENV=production,POSTGRES_DB=campo_digital,POSTGRES_USER=campo_digital,POSTGRES_UNIX_SOCKET_PATH=/cloudsql/PROJECT:REGION:INSTANCE,CAMPO_OBJECT_STORE_BACKEND=gcs,CAMPO_OBJECT_STORE_GCS_BUCKET=campo-digital-transelec-pilot-objects \
  --set-secrets=POSTGRES_PASSWORD=transelec-pilot-postgres-password:latest,CAMPO_TRANSELEC_ADMIN_TOKEN=transelec-pilot-admin-token:latest \
  --min-instances=0 \
  --max-instances=3 \
  --memory=1Gi
```

`--no-allow-unauthenticated` plus the IAP binding above is the access gate;
`gcloud run services add-iam-policy-binding` restricts `run.invoker` to the
pilot group. `southamerica-west1` (Santiago) matches the region named in
[`production-platform-v1.md`](../../../docs/platform/production-platform-v1.md);
confirm it against wherever the Cloud SQL instance and bucket are actually
provisioned before deploying.

`REGION`/`PROJECT`/`INSTANCE`/`TAG` are placeholders for the actual
deployment values — this command has not been run against real
infrastructure as part of this pilot (see "Do not provision paid
infrastructure" in the task that produced this runbook).

## Rollback

Cloud Run keeps prior revisions; rolling back the application is a traffic
shift, not a rebuild:

```bash
gcloud run services update-traffic campo-digital-transelec-pilot \
  --region=southamerica-west1 \
  --to-revisions=PREVIOUS_REVISION=100
```

Database rollback is a separate, more careful action:

```bash
APP_ENV=production uv run alembic downgrade -1
```

Only run a migration downgrade after confirming the previous application
revision is compatible with the resulting schema — Alembic downgrades here
are destructive DDL (see each migration's `downgrade()` for exactly what it
removes) and are not automatically covered by the workbook-snapshot
immutability guarantees. Restoring a previous *workbook* version (not a
schema) needs no downgrade at all — use the dashboard's "Historial de
versiones" restore action, or `POST
/api/transelec/snapshots/{id}/activate`.

## Maintenance and cost drivers

No infrastructure has been provisioned or priced for this specific pilot.
The relevant planning figures are the platform-wide ones already recorded in
[`environments-and-costs.md`](../../../docs/platform/environments-and-costs.md)
(pricing snapshot 2026-08-27; re-verify before provisioning):

- Cloud Run (this service): usage-based, **$0–10/month** initially at pilot
  traffic levels.
- Cloud SQL PostgreSQL/PostGIS (shared with other products, not
  Transelec-specific): the main fixed cost, **$50–65/month** compute plus
  **$5–15/month** storage/backups for a small instance.
- Cloud Storage (workbook snapshots — small binary files, low volume for a
  pilot): a few dollars/month at most; see the per-GiB table in
  `environments-and-costs.md`.
- Secret Manager / Artifact Registry: within the documented free
  allowances at this scale.

Adding this pilot does not by itself require a new database server or a new
environment tier — it is additional load on the same lean-production-V1
envelope (**$57–125/month** platform-wide) already planned in
`environments-and-costs.md`, not an additional budget line.

Operational maintenance implications specific to this pilot:

- Someone must own uploading replacement workbooks (or automating that
  later) — this pilot has no automatic OneDrive synchronization by design.
- Someone must own the Cloud SQL backup/restore procedure and its testing;
  workbook snapshots being immutable does not substitute for database
  backups (schema, other products' data, and the *pointer* to which
  snapshot is active all still need database-level backup/restore).
- `CAMPO_TRANSELEC_ADMIN_TOKEN` rotation is a manual Secret Manager
  operation until this pilot has real per-user authentication.

## Related documentation

[Transelec product overview](../README.md) ·
[Transelec dashboard](../dashboard/README.md) ·
[Source Contract V1](source-contract-v1.md) ·
[Platform documentation](../../../docs/platform/README.md)
