# Campo Digital Transelec Dashboard

Read-only client view of Transelec's current PMF/predio/status pipeline,
read directly from the validated `Resumen` source contract.

There is no mutation, no authentication, and no persistence — the workbook
is parsed fresh on every request. "Actualizar" simply re-fetches from the
API, which re-reads the source file.

## Development

Terminal 1 — API:

    export CAMPO_TRANSELEC_WORKBOOK_PATH=/path/to/PlanillaMaestra.xlsx
    uv run uvicorn app.main:app --app-dir apps/api --host 127.0.0.1 --port 8000 --reload

Terminal 2 — dashboard:

    cd products/transelect/dashboard
    npm run dev

Open the Vite URL printed in the terminal.

During development, Vite proxies `/api/*` to the local FastAPI server at
`127.0.0.1:8000`.

## Current UI

- PMF/predio/status KPI summary
- search plus estado/sector/empresa filters
- PMF list
- PMF detail: predios grouped (including an explicit "sin ID_Predo_Unico"
  bucket, since that identifier is documented as provisional only), with
  their raw current source rows

A PMF whose rows disagree on `Estado resumido` is shown with all of its
distinct statuses rather than one invented value — see
`products/transelect/docs/source-contract-v1.md` for why no PMF-level
status aggregation rule exists yet.
