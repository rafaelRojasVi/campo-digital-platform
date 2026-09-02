# Transelec dashboard

Private, authenticated, database-backed rebuild of Javier's two HTML
dashboards, implementing the 46 `TR-FUNC-*` rows of the
[functional parity matrix](../docs/audit/2026-09-02-functional-parity-matrix-v1.md)
against the platform's real Transelec APIs.

## Routes

| Route | Audience | Purpose |
|---|---|---|
| `/transelec` | `VIEWER`+ | Main dashboard: KPIs, charts, status hero, owner-status table, pending zone, executive report, filtered detail table, quality panel, real provenance footer |
| `/transelec/importar` | `OPERATOR`/`ADMIN` | Upload → validate/project → publish. Replaces the source file's client-side XLSX refresh (TR-FUNC-040) end to end |
| `/transelec/versiones` | `OPERATOR`/`ADMIN` | Version history and restore, with an explicit confirmation before the mutation fires |

## Data

Every rendered value comes from the real API. There is no fixture module, no
demo data, and no client-side workbook parsing in this application — the
ADR-008 synthetic Transelec demo is a separate app on a separate branch.

Reads are `GET /api/transelec/{summary,pmfs,pending,owner-status,report,
export.csv,imports,imports/active,uploads/recent}`; mutations are
`POST /api/transelec/{uploads,imports/…/validate-and-project,
imports/…/publish,imports/…/restore}`.

The CSRF token required by every mutation is fetched at runtime from
`GET /api/auth/csrf` and kept only in memory — it is never compiled into the
bundle and never stored in a cookie.

## Local development

```bash
# 1. platform API (repository root)
make platform-local

# 2. this app
cd products/transelect/dashboard
npm install
npm run dev            # http://127.0.0.1:5200/transelec
```

`/api/*` is proxied to `127.0.0.1:8000` (override with
`CAMPO_PLATFORM_API_PORT`); the app itself listens on `TRANSELEC_DASHBOARD_PORT`
(default `5200`). Sign in through the portal's dev login, or `POST
/api/auth/dev-login` with `dev-admin` (Transelec `ADMIN`) or `dev-viewer`
(Transelec `VIEWER`) while `APP_ENV=development`.

## Tests

```bash
npm test          # vitest component/unit tests
npm run test:e2e  # Playwright acceptance tests (stubbed API routes)
npm run lint
npx tsc -b
```

## Brand assets

Both brand marks are generic placeholders (TR-FUNC-041 / TR-OPEN-06). The
base64 logo payloads embedded in the source HTML files are deliberately not
reused; Javier / Campo Digital must authorize those specific assets before
any real logo ships here.
