# Campo Digital Platform Roadmap

## Status

Planning roadmap.

This document orders platform work by dependency and evidence. It is not a
calendar commitment and does not replace product-specific roadmaps.

**Priority update (2026-08-27)** — Transelec source/domain integration is being
advanced ahead of the previously listed product order because the stakeholder
identified it as the current operational priority and supplied a refined
workbook/dashboard source pair. The existing LiDAR and Forestry roadmap scopes
remain valid; this changes implementation priority, not product boundaries.

## Guiding principle

Campo Digital is one company platform with three bounded products:

1. LiDAR / Cubicación
2. Gestión Predial Forestal / QGIS
3. Transelec

The platform should provide common infrastructure, access, provenance,
operational visibility, and navigation without merging the three product
domains.


### Repository naming note

The stakeholder/project spelling used in this roadmap is **Transelec**.

The repository boundary currently remains:

`products/transelect/`

Do not rename that product path as part of this documentation/foundation work.
Naming alignment is a separate explicit decision.

## Phase 0 — Architecture evidence

**Status: completed foundation.**

Establish the durable platform contracts before introducing persistence or
production infrastructure.

Scope:

- provider research;
- source-system boundaries;
- product boundaries;
- client-data organization;
- local/production topology;
- infrastructure cost model;
- security foundation;
- documentation navigation.

Exit condition:

The repository has a coherent platform contract and clearly identifies what is
established, proposed, and still unknown.

## Phase 1 — Local platform foundation

**Current phase.**

Build the provider-neutral foundation locally.

Scope:

- PostgreSQL/PostGIS local development service;
- database configuration;
- migration framework;
- persistence infrastructure;
- source-snapshot/provenance foundation;
- artifact-storage boundary;
- job/use-case execution boundary;
- architecture checks;
- reproducible local developer workflow.

Current implementation status (2026-08-27):

- **FACT** — local PostgreSQL 17 / PostGIS 3.5 development and disposable test services are implemented;
- **FACT** — typed database configuration, SQLAlchemy infrastructure, and Alembic migrations are implemented;
- **FACT** — migration `0001` ensures PostGIS and establishes the empty `platform` schema;
- **FACT** — `/health` is dependency-free liveness and `/ready` checks PostgreSQL readiness;
- **FACT** — destructive migration validation is restricted to a dedicated `_test` database;
- **FACT** — real PostGIS integration tests and dedicated persistence CI are implemented;
- **FACT** — provider-neutral source provenance now distinguishes source systems, assets, immutable SHA-256 snapshots, and observations;
- **FACT** — migration `0002` persists that provenance model with database-level identity, integrity, and deletion-safety constraints;
- **FACT** — V1 read-only filesystem discovery and SHA-256 fingerprinting are implemented using normalized root-relative source paths with path-escape and symbolic-link rejection;
- **FACT** — discovered filesystem provenance can be persisted transactionally while reusing source-system, source-asset, and content-snapshot identities and appending observation history;
- **LIMITATION** — product persistence, artifact storage, ingestion runs, schema contracts, classification, and job execution boundaries are not yet implemented.

Exit condition:

A clean checkout can start the local platform and apply the database schema
reproducibly without requiring paid cloud services.

## Phase 2 — LiDAR platform integration

Do **not** rebuild the LiDAR scientific engine.

LiDAR is the first mature product used to prove the shared platform
foundation.

Scope:

- preserve existing scientific behavior and evidence;
- preserve existing API behavior unless an explicit change is approved;
- connect measurement/run metadata to platform persistence where justified;
- route large/private artifacts through the storage boundary;
- separate long-running processing from normal HTTP request handling;
- keep LAS/LAZ and other private client data outside Git;
- preserve readiness and scientific-evidence rules;
- run the full existing LiDAR regression suite.

Exit condition:

A real mature product uses the platform foundation without contaminating its
scientific/domain boundary.

## Phase 3 — Forestry source/domain contract

Derive the Forestry model from real source evidence and stakeholder
confirmation.

Scope:

- Shapefile/source ingestion;
- immutable source snapshots;
- schema validation;
- canonical polygon state;
- PostGIS persistence;
- geometry/history semantics;
- API projection;
- product tests;
- initial Forestry dashboard contract.

Do not invent workflow states, approval semantics, or business entities that
have not been established.

Current implementation status (2026-08-29):

- **FACT** — the first real Forestry source snapshot (Degenfeld estate
  shapefile family) has a forensic evidence record in
  `products/forestry/docs/source-evidence-v1.md`;
- **FACT** — a structural Source Contract V1 (family completeness, declared
  CRS/encoding, DBF schema, record-count integrity, fingerprinting) is
  implemented in `forestry_ingestion.shapefile_contract` with synthetic-fixture
  tests;
- **LIMITATION** — canonical entities, PostGIS persistence, geometry-level
  validation, API projection, and the dashboard remain open pending
  stakeholder answers (`products/forestry/docs/es/preguntas-campo-digital.md`).

Exit condition:

Forestry source data can be ingested reproducibly into an evidence-backed
canonical model.

## Phase 4 — Transelec source/domain contract

Derive the Transelec model from workbook, dashboard, and stakeholder evidence.

Scope:

- XLSX schema contract;
- source snapshots;
- data-change vs schema-change detection;
- current state and history;
- status/workflow semantics;
- API projection;
- dashboard projection;
- product tests.

A renamed, replaced, or deleted OneDrive workbook must not silently destroy
canonical history.

Exit condition:

Daily-changing source data can be ingested safely while preserving provenance
and history.

## Phase 5 — Company platform UI/API

Create one coherent Campo Digital user experience.

Target shape:

```text
                 CAMPO DIGITAL
                       |
                    Sign in
                       |
                       v
                Company portal
                       |
          +------------+------------+
          |            |            |
          v            v            v
        LiDAR       Forestry     Transelec
      Dashboard     Dashboard     Dashboard
          |            |            |
          +------------+------------+
                       |
                       v
                  Shared FastAPI
                       |
            +----------+----------+
            |                     |
            v                     v
     PostgreSQL/PostGIS     artifact storage
```

Potential company-level responsibilities:

- authentication/session entry point;
- company branding;
- navigation;
- product/project entry points;
- platform health;
- ingestion status/review;
- artifact access;
- user/account context.

Product-specific dashboards remain product-owned.

Shared UI components move to `packages/ui/` only after real reuse exists.

Exit condition:

Users can enter one Campo Digital platform and navigate to the products they
are authorized to use.

## Phase 6 — Production deployment

Finalize the production provider using then-current evidence and pricing.

Current leading candidate:

- GCP Santiago.

Production concerns:

- managed PostgreSQL/PostGIS;
- private object storage;
- API hosting;
- jobs/workers;
- authentication;
- secrets;
- migrations;
- backups and restore testing;
- monitoring;
- billing alerts;
- CI/CD;
- domain/TLS;
- staging decision.

The provider remains revisitable until production is actually required.

Exit condition:

The shared platform is available to authorized users without depending on a
developer laptop.

## Phase 7 — Operational maturity

Add complexity only when evidence justifies it.

Possible later capabilities:

- database high availability;
- Microsoft Graph delta ingestion;
- stronger job orchestration;
- structured audit/admin cockpit;
- disaster-recovery exercises;
- read replicas;
- dedicated high-memory/CPU processing;
- cost optimization;
- more advanced observability.

Do not introduce Kubernetes, Redis, Celery, Kafka, RabbitMQ, multiple database
servers, or other infrastructure merely for hypothetical scale.

## Related documentation

- [Platform documentation](README.md)
- [System overview](system-overview.md)
- [Production platform V1](production-platform-v1.md)
- [Source ingestion](source-ingestion.md)
- [Security model](security-model.md)
- [Environments and costs](environments-and-costs.md)
