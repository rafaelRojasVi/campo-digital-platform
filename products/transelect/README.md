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
- evidence and PMF/predio read models;
- React operating dashboard with search, filters, KPIs, and PMF detail;
- PostgreSQL-backed immutable workbook snapshots;
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

## Next deployment boundary

The code now supports the manual-upload pilot. Production exposure still
requires deployment configuration for:

- managed PostgreSQL/PostGIS;
- the API runtime;
- the static React build;
- authenticated viewer access at the hosting edge;
- secret injection for `CAMPO_TRANSELEC_ADMIN_TOKEN`;
- backup/retention policy for the managed database.

Automatic OneDrive synchronization remains intentionally outside this pilot.
