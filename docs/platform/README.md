# Campo Digital Platform Documentation

[Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md) · [Documentation policy](../DOCUMENTATION_POLICY.md)

This directory is the canonical entry point for engineering documentation that applies to Campo Digital as a platform rather than to one product.

Campo Digital is a product-first monorepo with three bounded product contexts:

1. LiDAR / Cubicación
2. Gestión Predial Forestal / QGIS
3. Transelec

Product-specific implementation truth remains inside each product boundary. Platform documentation defines the shared contracts that allow those products to operate as one company platform without merging their domain models.

## Start here

- [System overview](system-overview.md)
- [Company portal V1](company-portal-v1.md)
- [Production platform V1](production-platform-v1.md)
- [Environments and infrastructure costs](environments-and-costs.md)
- [Source ingestion](source-ingestion.md)
- [Client data organization](client-data-organization.md)
- [Security model](security-model.md)
- [Platform roadmap](roadmap.md)

## Architecture contracts

- [Monorepo architecture](monorepo.md)
- [Product boundaries](product-boundaries.md)
- [Root architecture contract](../../ARCHITECTURE.md)

## Source systems

- [OneDrive source-system boundary](../source-systems/onedrive.md)
- [Source catalog](../../config/source-catalog.yaml)

## Architecture decisions

- [ADR-001 — Managed production platform](../adr/ADR-001-managed-production-platform.md)
- [ADR-002 — Source provenance identity](../adr/ADR-002-source-provenance-identity.md)

## Research

Research documents preserve dated evidence and comparisons but are not canonical architecture.

- [Infrastructure provider study — 2026-08-27](../research/2026-08-27-infrastructure-provider-study.md)

## Product documentation

### LiDAR / Cubicación

- [LiDAR product README](../../products/lidar/README.md)
- [LiDAR engineering documentation](../../products/lidar/docs/README.md)

LiDAR is the most mature product and its existing scientific evidence, methodology, experiments, decisions, and readiness rules remain authoritative.

### Gestión Predial Forestal / QGIS

Canonical product documentation will live under `products/forestry/`. The platform documentation must not invent workflow semantics that have not yet been established from source evidence or stakeholder confirmation.

### Transelec

Canonical product documentation will live under `products/transelect/`. The platform documentation must not infer the final domain model from filenames, dashboard presentation, or preliminary spreadsheet inspection.

## Spanish stakeholder documentation

Canonical engineering documentation is written in English. Spanish collaboration and stakeholder summaries live under:

- [Documentación de plataforma en español](../es/plataforma/README.md)

Spanish documents summarize the technical truth rather than creating an independent second source of engineering truth.
