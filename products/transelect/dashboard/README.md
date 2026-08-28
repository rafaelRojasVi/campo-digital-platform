# Campo Digital Transelec Dashboard

Spanish-first operating view for Transelec PMF, predio, area-of-cut, status,
sector, company, and source-version data.

The dashboard can run in two source modes:

1. **Hosted pilot** — reads the workbook snapshot currently published in
   PostgreSQL.
2. **Local development** — when `CAMPO_TRANSELEC_WORKBOOK_PATH` is set, reads
   that workbook directly without changing hosted state.

## Hosted snapshot contract

The pilot intentionally keeps the Excel workbook as the operational source of
truth while making publication safe:

- uploads are validated against `transelec_ingestion.xlsx_contract` before any
  database state changes;
- accepted content is fingerprinted with SHA-256;
- identical content is a no-op and does not create a duplicate version;
- each accepted workbook is stored as an immutable snapshot;
- the active snapshot changes atomically only after validation and persistence;
- an administrator can explicitly restore any previously validated snapshot;
- the dashboard never invents a PMF-level status precedence rule.

The upload API accepts `.xlsx` and `.xlsm` content up to 32 MiB as the raw
request body. `X-Filename` carries the original filename. Upload and restore
mutations require `X-Transelec-Admin-Token`, matched against
`CAMPO_TRANSELEC_ADMIN_TOKEN`.

The pilot token protects administrative mutations only. Before exposing the
viewer on the public internet, the deployment must also place the application
behind an authenticated access layer.

## Development

Copy `.env.example` to `.env` and configure PostgreSQL/PostGIS.

Apply migrations:

    uv run alembic upgrade head

For hosted-snapshot mode, configure:

    export CAMPO_TRANSELEC_ADMIN_TOKEN='<long-random-value>'

Then run the API:

    uv run uvicorn app.main:app --app-dir apps/api --host 127.0.0.1 --port 8000 --reload

Run the dashboard separately:

    cd products/transelect/dashboard
    npm ci
    npm run dev

During development, Vite proxies `/api/*` to `127.0.0.1:8000`.

To bypass hosted snapshots and inspect a workbook directly:

    export CAMPO_TRANSELEC_WORKBOOK_PATH=/path/to/PlanillaMaestra.xlsx

## Current UI

- PMF, provisional-predio, surface, and source-row KPIs;
- status distribution without status-precedence assumptions;
- PMF/predio/rol search plus estado/sector/empresa filters;
- PMF detail drawer with predios and source rows;
- active workbook/version context;
- validated workbook publication;
- immutable version history;
- explicit restore flow;
- responsive desktop and mobile layouts.
