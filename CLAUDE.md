# Campo Digital Platform — Claude project instructions

This repository is the Campo Digital multi-product platform monorepo. It contains LiDAR / Cubicación, Gestión Predial Forestal / QGIS, and Transelect as separate bounded product contexts.

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
3. Transelect

Do not mix product-specific domain models merely because they coexist in the
same monorepo.

Canonical product boundaries are documented in:

`docs/platform/product-boundaries.md`

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
