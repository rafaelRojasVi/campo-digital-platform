# Campo Digital Platform — Product Boundaries

## Status

Architecture foundation.

The platform currently contains three product bounded contexts. Requirements
inside each context may still evolve as Javier provides additional source
material.

## 1. LiDAR / Cubicación

Owns:

- LAS/LAZ point-cloud processing
- timber-stack localization
- local face geometry
- projected face-area estimation
- estimator benchmarking
- reference validation
- geometric stack-volume calculation

The existing LiDAR methodology, experiments, scientific evidence, and safety
guardrails remain authoritative for this context.

It does not own forestry stand management or Transelec business logic.

## 2. Gestión Predial Forestal / QGIS

Owns:

- predios / properties
- rodales / forestry stands
- polygon geometry
- polygon version history
- partial harvest polygons
- harvested and remaining areas
- QGIS-compatible import and export
- map/dashboard visualization
- forestry reports
- Excel and GIS exports

A harvest must not be modeled only as a boolean state for an entire rodal.

Partial operations must preserve the original rodal geometry and record their
own operation geometry so original, harvested, and remaining areas remain
auditable.

## 3. Transelec

Transelec is a separate bounded context.

Its current source material is expected under:

`03_Proyecto_Transelec`

Its entities and workflow must not be inferred from either the LiDAR or
Forestry domains.

Its domain model will be derived from the actual Transelec source material.

## Shared platform capabilities

The following may be shared across products:

- clients
- users and authorization
- projects
- source assets
- documents
- reports
- audit and provenance
- object storage
- source ingestion
- OneDrive integration
- API infrastructure
- reusable UI components

Shared infrastructure does not imply shared business-domain models.

## Boundary rule

Product-specific concepts remain inside their own bounded context.

Examples:

- `Rodal` belongs to Forestry.
- `HarvestArea` belongs to Forestry.
- `PointCloud` belongs to LiDAR.
- `FaceMeasurement` belongs to LiDAR.
- Transelec entities belong to Transelec.

Do not create a generic shared business-domain package merely because this is
a monorepo.
