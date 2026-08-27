# Campo Digital Platform — Monorepo Architecture

## Architectural shape

Campo Digital is a product-first monorepo with three bounded product contexts:

1. LiDAR / Cubicación
2. Gestión Predial Forestal / QGIS
3. Transelec

The repository uses a modular-monolith backend and separate product-owned
frontends.

## Target structure

    products/
      lidar/
        src/
        tests/
        dashboard/
        docs/
        configs/
        data/
        pipelines/
        notebooks/
        reports/

      forestry/
        src/
        tests/
        dashboard/
        docs/

      transelect/
        src/
        tests/
        dashboard/
        docs/

    apps/
      api/
        src/app/
          platform/
          lidar/
          forestry/
          transelect/
          integrations/

    packages/
      contracts/
      ui/

    config/
      source-catalog.yaml

    scripts/
      tests/

    docs/
      platform/
      adr/
      source-systems/

## Product ownership

Anything specific to one product belongs under that product root.

Examples:

- LiDAR geometry belongs under `products/lidar/`.
- Forestry rodal logic belongs under `products/forestry/`.
- Transelec business logic belongs under `products/transelect/`.

Platform-level directories contain only genuinely cross-product concerns.

## LiDAR migration

The existing LiDAR project will move into:

`products/lidar/`

This includes its Python source, tests, dashboard, research documentation,
sensor/measurement configuration, notebooks, PDAL pipelines, data layout,
and generated-report layout.

The migration must preserve the established scientific behavior and test
baseline.

## Backend

`apps/api` is the shared HTTP composition layer.

Product-specific API adapters live under:

- `apps/api/src/app/lidar/`
- `apps/api/src/app/forestry/`
- `apps/api/src/app/transelect/`

Core product logic must not depend on FastAPI.

## Shared packages

Shared packages are created only when multiple real consumers require them.

Initial shared packages:

- `packages/contracts`
- `packages/ui`

Avoid generic `common`, `helpers`, `shared-domain`, or `services` dumping
grounds.

## External integrations

External systems are accessed through platform adapters.

Examples:

- OneDrive / Microsoft Graph
- object storage

Product domains must not depend directly on vendor URLs, OAuth details,
filesystem-specific paths, or SDK-specific payloads.

## Dependency direction

Allowed:

    dashboard
       ↓
    contracts
       ↓
    API adapter
       ↓
    product domain

Forbidden:

    product A → product B frontend
    packages → apps
    pure product domain → FastAPI
    pure product domain → OneDrive SDK
    pure product domain → HTTP router

## Persistence

Canonical structured/geospatial data:

- PostgreSQL
- PostGIS

Large private/source assets:

- object storage

OneDrive remains a collaboration/source system, not the production database.

## Migration discipline

1. Define architecture and safety rules.
2. Move LiDAR as one bounded product.
3. Re-establish the full LiDAR quality baseline.
4. Introduce workspace tooling and executable architecture checks.
5. Add Forestry foundations.
6. Add Transelec after its real workflow is understood.
7. Add production persistence and ingestion infrastructure.
