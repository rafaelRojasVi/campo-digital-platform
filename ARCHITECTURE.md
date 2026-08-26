# Campo Digital Platform Architecture

## Shape

Campo Digital is a product-first monorepo with a modular-monolith backend.

There are three bounded products:

- LiDAR / Cubicación
- Gestión Predial Forestal / QGIS
- Transelect

## Product boundary

Product-owned code, tests, documentation, configuration, and frontend code
belong under:

    products/<product>/

Current product roots:

    products/lidar/
    products/forestry/
    products/transelect/

## Shared API

One FastAPI application acts as the HTTP composition layer:

    apps/api/

Its product adapters are isolated by bounded context.

The API may depend on product-domain code.

Product-domain code must not depend on FastAPI.

## Shared frontend packages

Cross-product frontend code may live under:

    packages/contracts/
    packages/ui/

Shared packages must not depend on product applications.

Product applications must not directly import another product application.

## External systems

External providers belong behind adapters.

OneDrive is an external source/collaboration system.

Product logic must not contain:

- Microsoft Graph authentication details
- OneDrive browser URLs
- machine-specific OneDrive paths
- provider-specific retry/status semantics

## Data

PostgreSQL/PostGIS is the target canonical structured-data store.

Large binary assets belong in object storage.

Raw private client datasets never belong in Git.

## Architecture enforcement

Architecture documentation describes the intended system.

Executable architecture checks will enforce dependency rules so architectural
drift fails locally and in CI.

## Canonical details

See:

- `docs/platform/product-boundaries.md`
- `docs/platform/monorepo.md`
- `docs/source-systems/onedrive.md`
- `config/source-catalog.yaml`

## AI-assisted engineering

Repository-level AI engineering configuration belongs under:

    .claude/

Product-specific implementation knowledge may be encoded as namespaced skills
there once repeated real workflows justify them.

Skills must reinforce the repository architecture rather than bypass it.

In particular, AI tooling must respect:

- product ownership boundaries;
- external-data safety;
- canonical `make` quality gates;
- scientific evidence rules for LiDAR;
- adapter boundaries for external providers;
- generated API contracts and executable architecture checks.

Do not create generic skills merely to restate documentation. Add a skill when
it captures a recurring workflow, domain constraint, or review discipline that
materially improves engineering work.
