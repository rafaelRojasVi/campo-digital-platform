# Campo Digital Platform — Claude project instructions

This repository is the Campo Digital multi-product platform monorepo. It contains LiDAR / Cubicación, Gestión Predial Forestal / QGIS, and Transelec as separate bounded product contexts.

For all documentation work, follow:

@docs/DOCUMENTATION_POLICY.md

Important project rules:

- Never commit real client LAS/LAZ/ZIP datasets.
- Never infer CRS, coordinate units, sensor precision, or final m³ accuracy without evidence.
- Distinguish confirmed facts from inference and hypothesis.
- Raw geometric volume is not automatically commercial cubicación.
- CloudCompare is a visual inspection/debugging tool; reproducible geometry must live in code/configuration.
- Durable experimental findings, engineering decisions, limitations, failures, and open questions must be documented.

## Campo Digital platform boundaries

This repository now contains three bounded product contexts:

1. LiDAR / Cubicación
2. Gestión Predial Forestal / QGIS
3. Transelec

Do not mix product-specific domain models merely because they coexist in the
same monorepo.

Canonical product boundaries are documented in:

`docs/platform/product-boundaries.md`

## Task-to-context routing

Read only what the task actually needs. Load the full platform document set
below only for a genuinely cross-product decision — shared architecture,
persistence, source ingestion, security, environments, or product
integration sequencing that spans more than one bounded product.

| Task | Read first |
|---|---|
| Transelec frontend/dashboard | `products/transelect/README.md`, `products/transelect/dashboard/README.md` |
| Transelec source contract / domain evidence | `products/transelect/docs/source-contract-v1.md` |
| Transelec hosted-pilot persistence/migrations | `docs/platform/production-platform-v1.md` § Database strategy, `products/transelect/docs/deployment.md` |
| Transelec deployment/hosting | `products/transelect/docs/deployment.md` |
| Transelec documentation work | `docs/DOCUMENTATION_POLICY.md`, `products/transelect/README.md` |
| LiDAR work | `products/lidar/README.md`, `products/lidar/docs/roadmap.md` |
| Cross-product / shared-architecture decision | `docs/platform/README.md`, `docs/platform/system-overview.md`, `docs/platform/roadmap.md`, `docs/platform/production-platform-v1.md`, `docs/platform/source-ingestion.md`, `docs/platform/client-data-organization.md`, `docs/platform/security-model.md`, `docs/platform/environments-and-costs.md` |

Treat `docs/research/` as dated supporting evidence, not canonical
architecture. Provider capabilities, regions, limits, and pricing may become
stale and must be re-verified before provisioning.

The stakeholder/project spelling is `Transelec`. The repository product path
currently remains `products/transelect/`; do not rename that path implicitly.

## External Campo Digital source data

External source material may be available through:

`CAMPO_DIGITAL_SOURCE_ROOT`

Treat that location as read-only unless the user explicitly authorizes a
modification.

Never:

- git-add files from the external source root
- move, rename, or delete external source material
- write generated artifacts into the source root by default
- treat OneDrive as the production application database
- infer that similarly named files belong to the same product context

Canonical source classification is defined in:

`config/source-catalog.yaml`
