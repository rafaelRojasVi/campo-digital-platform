# Campo Digital Platform Documentation

[Project README](../README.md) · [Architecture](../ARCHITECTURE.md)

This directory is the documentation entry point for the Campo Digital platform.

Canonical engineering documentation is written in English. Spanish documents
are stakeholder-facing summaries and collaboration material; they do not form
a second independent technical source of truth.

## Platform

Start with:

- [Platform documentation](platform/README.md)
- [System overview](platform/system-overview.md)
- [Platform roadmap](platform/roadmap.md)

Core platform contracts:

- [Monorepo architecture](platform/monorepo.md)
- [Product boundaries](platform/product-boundaries.md)
- [Production platform V1](platform/production-platform-v1.md)
- [Environments and infrastructure costs](platform/environments-and-costs.md)
- [Security model](platform/security-model.md)
- [Source ingestion](platform/source-ingestion.md)
- [Client data organization](platform/client-data-organization.md)
- [OneDrive source-system boundary](source-systems/onedrive.md)

## Products

### LiDAR / Cubicación

LiDAR is currently the most mature product.

- [LiDAR product README](../products/lidar/README.md)
- [LiDAR engineering documentation](../products/lidar/docs/README.md)
- [LiDAR roadmap](../products/lidar/docs/roadmap.md)
- [LiDAR experiments](../products/lidar/docs/experiments/)
- [LiDAR engineering decisions](../products/lidar/docs/decisions/)

Existing LiDAR scientific methodology, evidence, readiness rules, and
measurement constraints remain authoritative for that product.

### Gestión Predial Forestal / QGIS

The Forestry bounded context is still being established from source evidence.

Product documentation belongs under:

`products/forestry/`

Do not treat preliminary source interpretation as final domain truth.

### Transelec

The Transelec bounded context is still being established from workbook,
dashboard, and stakeholder evidence.

Product documentation belongs under:

`products/transelect/`

Do not infer the final domain model from filenames or presentation artifacts.

## Architecture decisions

- [ADR-001 — Managed production platform](adr/ADR-001-managed-production-platform.md)

## Research

Research is dated supporting evidence, not canonical architecture.

- [Infrastructure provider study — 2026-08-27](research/2026-08-27-infrastructure-provider-study.md)

Provider capabilities, prices, regions, and limits must be re-checked before
production provisioning.

## Spanish stakeholder documentation

- [Plataforma Campo Digital — documentación para colaboración](es/plataforma/README.md)
- [Estado actual de la plataforma](es/plataforma/estado-plataforma.md)

## Documentation templates

Reusable engineering-document templates remain platform-level:

- [ADR template](templates/adr.md)
- [Experiment template](templates/experiment.md)
- [Journal-entry template](templates/journal-entry.md)

## Documentation policy

- [Documentation policy](DOCUMENTATION_POLICY.md)

The repository documentation must preserve the distinction between:

- FACT
- INFERENCE
- HYPOTHESIS
- DECISION
- OPEN QUESTION
- LIMITATION
- RESULT

When documentation files or navigation targets are added, moved, renamed, or
removed, update navigation and run the repository documentation link checks
before committing.
