# LiDAR Implementation Architecture

## Repository architecture transition

The repository began as a single Python `src/`-layout project dedicated to
the LiDAR proof-of-concept.

It is now transitioning into the `campo-digital-platform` monorepo with three
bounded product contexts:

1. LiDAR / Cubicación
2. Gestión Predial Forestal / QGIS
3. Transelect

The current validated LiDAR implementation still uses:

- one root `pyproject.toml`;
- one `uv.lock`;
- one Python environment;
- `lidar_core`, `lidar_io`, `lidar_volume`, and `lidar_cli` under `src/`;
- `apps/api`;
- `apps/viewer`.

This is the current implementation state, not the final monorepo layout.

The target architecture and migration sequence are defined in:

- `docs/platform/monorepo.md`
- `docs/platform/product-boundaries.md`

The migration must preserve validated LiDAR behavior while workspace,
application, and service boundaries are introduced incrementally.

## Package boundaries

```
lidar_core    domain models (pydantic), geometry primitives (numpy/sklearn/
              scipy, optional open3d), synthetic test-data generators.
              No I/O, no CLI, no PDAL.
lidar_io      LAS/LAZ inspection (laspy) and PDAL subprocess pipelines.
              Depends on lidar_core for models.
lidar_volume  Volume estimator interface + implementations. Depends on
              lidar_core for models/geometry.
lidar_cli     Typer CLI wiring the above together. Depends on all three.
```

## Future stack (NOT built in this bootstrap)

`apps/api` will eventually need: PostgreSQL + PostGIS for spatial storage
of ROIs/results, SQLAlchemy + Alembic for schema/migrations, object
storage (e.g. S3-compatible) for LAS/LAZ files themselves, a job queue
(e.g. Celery/RQ/arq) for long-running volume computations, and a real web
viewer (`apps/viewer`) built on a 3D web rendering stack. None of this
exists yet -- only `/health` is wired up in `apps/api`.

## Why PDAL is a subprocess dependency, not a Python binding

See `docs/tooling.md` -- summary: PDAL CLI was not installed on the
bootstrap host, python-pdal bindings can conflict with system packages,
and a subprocess wrapper degrades gracefully (clear error / pytest skip)
when PDAL is absent, which a hard import dependency would not.

<!-- DOC_NAV_START -->

---

### Documentation navigation

[Project README](../README.md) · [Docs index](README.md) · [Findings](findings/cubicacion_accuracy_problem.md) · [Experiments](experiments) · [Decisions](decisions) · [Spanish docs](es/README.md) · [Estado técnico](es/estado-proyecto.md) · [Preguntas Campo Digital](es/preguntas-campo-digital.md)

<!-- DOC_NAV_END -->
