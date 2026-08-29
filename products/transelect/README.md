# Transelec

Transelec is a Campo Digital bounded product context.

The repository path retains the historical technical spelling
`products/transelect/`. The stakeholder/project name is **Transelec**.

## Current status

Source Contract V1 is established for the real operational workbook's
`Resumen` worksheet. The hosted pilot builds on that contract without changing
the workbook's business semantics.

Current capabilities:

- positional validation of the `Resumen` A:AD source table and blank AE
  separator;
- safe handling of both source columns named `Carpeta`;
- preservation of original workbook row numbers;
- evidence and PMF/predio read models with multi-select filtering (estado
  resumido, sector, empresa, PAS, tipo de propietario) plus search;
- React operating dashboard with KPIs, PMF detail, CSV export, and a print
  view, served same-origin by FastAPI at `/` alongside `/api/transelec`;
- immutable workbook snapshots with bytes in content-addressed object
  storage (never PostgreSQL — see `apps/api/app/object_storage.py`) and
  metadata/provenance in PostgreSQL;
- SHA-256 duplicate detection;
- atomic publication and explicit rollback to a previous validated snapshot;
- local-workbook fallback for development.

No PMF-level status aggregation precedence has been inferred. Mixed statuses
remain visible as mixed statuses.

## Source boundary

Expected external source location for local evidence and development:

`03_Proyecto_Transelec/02_Datos_Entrada/`

Source files remain outside Git.

In the hosted pilot, a validated workbook copy is persisted in the platform
database as an immutable source snapshot. The active snapshot is selected by a
single explicit pointer; overwriting a filename therefore does not erase
history.

These tables live under the shared `platform` schema as an interim pilot
placement, not a dedicated `transelec` schema — see
[production-platform-v1.md § Interim placement: Transelec hosted-pilot tables](../../docs/platform/production-platform-v1.md#interim-placement-transelec-hosted-pilot-tables).

## One-command local demo

From the repository root:

```bash
make transelec-dev
```

The launcher prefers an explicit `CAMPO_TRANSELEC_WORKBOOK_PATH`. If that is
not set, it discovers local Campo Digital source roots, searches
`03_Proyecto_Transelec/02_Datos_Entrada/`, and selects the most recently
modified `.xlsx`/`.xlsm` file that actually passes Source Contract V1. Source
files are only read; the launcher never writes into OneDrive or copies client
data into Git.

It starts FastAPI and the Vite dashboard on free localhost ports, waits for
both to become ready, and opens the dashboard in the local browser. Existing
manual development processes are left alone rather than killed or reused.

Useful companion commands:

```bash
make transelec-status
make transelec-stop
```

`transelec-stop` terminates only processes recorded by this worktree's
launcher. Runtime state and logs live under the system temporary directory,
not in the repository.

## Deployment

Container packaging, Cloud SQL/Cloud Storage configuration, Cloud Run IAP,
secrets, rollback, and cost drivers are documented in
[`docs/deployment.md`](docs/deployment.md). No managed infrastructure has
been provisioned as part of this pilot's implementation — that document
describes how to, not a record that it happened.

Automatic OneDrive synchronization remains intentionally outside this pilot.
