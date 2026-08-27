# Campo Digital Platform Security Model

## Status

Foundation-level security contract.

This document defines security principles that should hold locally and in a future managed environment. It does not yet select the final identity provider or final business roles.

## Security objectives

The platform may contain private client files, geospatial data, spreadsheets, project status, generated reports, source history, and measurement results. The system must prevent accidental public exposure and preserve traceability of important changes.

## Trust boundary

```text
Internet / users
      |
      v
authenticated application
      |
      v
FastAPI authorization boundary
      |
      +-- PostgreSQL/PostGIS
      +-- private object storage
      +-- ingestion/jobs
      |
      v
external source adapters
      |
      v
OneDrive / Microsoft Graph
```

Users must not connect directly to PostgreSQL. Private objects must not use permanent public bucket URLs.

## Local development

- no public DB port forwarding;
- local credentials stay in ignored environment files;
- private source files and generated private artifacts stay outside Git;
- OneDrive access is read-only by default;
- local admin tools never become public production services.

## Authentication

Do not build a custom password system unless a real requirement forces it. Prefer a managed identity provider. Microsoft Entra ID is worth evaluating because the company already uses Microsoft/OneDrive collaboration, but it is not yet an accepted decision.

## Authorization

Authentication answers who the user is; authorization answers what they may do. Product authorization must be explicit and enforced server-side. Final roles must come from actual company workflows, not infrastructure assumptions.

## Database security

- no anonymous/public DB access;
- least-privilege application DB identity;
- controlled migration path;
- no implicit destructive migration on app startup;
- backups and restores tested;
- DB credentials never shipped to frontend code.

## Object security

Source snapshots and private generated artifacts are private by default. Browser delivery should use application authorization and time-limited signed access where appropriate.

## Secrets

Local: ignored environment/configuration files. Production candidate: managed
secret storage such as Secret Manager. Secrets never belong in Git,
documentation, browser bundles, or normal logs.

Repository history is scanned with Gitleaks using its maintained default rule
set. The scanner version and downloaded release checksum are pinned by
`scripts/check_secrets.sh`. Findings are redacted so detected credential values
are not copied into CI logs.

A real secret finding must be treated as a credential incident: rotate or
revoke the credential and assess whether repository-history remediation is
required. A false positive may be allowlisted only after inspection, and the
allowlist must be scoped as narrowly as practical.

**RESULT (2026-08-27)** — the initial full-history baseline scanned 61 commits
(approximately 2.09 MB) with Gitleaks 8.30.1 and found no leaks. Therefore the
repository begins automated secret scanning without an allowlist.

Live dependency-advisory checks are intentionally separate from this repository
quality gate because they depend on external vulnerability databases.

## Dependency vulnerability scanning

Supported runtime dependency graphs are checked separately from deterministic
repository quality gates.

The current blocking audit surface is:

- the locked Python base runtime plus API and Transelec extras;
- the locked optional geometry stack;
- production dependencies of the LiDAR dashboard.

Python dependency versions come from `uv.lock`; `pip-audit` inspects an exported
locked graph rather than resolving an independent application dependency graph.
The audit tool version is pinned by
`scripts/check_dependency_vulnerabilities.sh`.

Dashboard production dependencies are audited from the committed npm lockfile.

These checks depend on live vulnerability advisory services, so their results
may change without a repository change. They therefore run in dedicated
Security CI, including a scheduled weekly scan, and are intentionally excluded
from the deterministic `make check` gate.

Notebook tooling is an explicit `analysis` extra rather than part of the normal
application runtime dependency surface.

**RESULT (2026-08-27)** — the initial Python runtime/API, optional geometry, and
LiDAR dashboard production dependency baselines reported no known
vulnerabilities.

## Auditability

The platform should be able to answer which source snapshot produced a state, which ingestion run processed it, which user made an important operational change, when it happened, and which artifacts were generated from it.

## Environment isolation

LOCAL, STAGING, and PRODUCTION must not share credentials. Staging uses synthetic, sanitized, or explicitly approved data.

## AI-assisted engineering

Claude/AI tooling is not a runtime security component. It must respect private-data, architecture, permission, and evidence rules exactly like human engineering work.

## Open decisions

- production identity provider;
- final user/role model;
- session/token strategy;
- production network topology;
- signed-object delivery implementation;
- audit retention;
- backup retention and recovery objectives.
