# LiDAR / Cubicación

LiDAR and timber-stack measurement bounded context for Campo Digital.

## Scope

The LiDAR product owns:

- LAS/LAZ point-cloud inspection and processing
- timber-stack localization
- local face geometry
- projected face-area estimation
- estimator benchmarking
- reference validation
- geometric stack-volume analysis
- LiDAR-specific measurement tooling and visualization

## Repository boundary

Product-owned implementation now lives under:

    products/lidar/

Current structure:

    src/
      lidar_core/
      lidar_io/
      lidar_volume/
      lidar_cli/

    tests/
    dashboard/
    configs/
    pipelines/
    notebooks/
    data/
    reports/
    scripts/
    docs/

The shared FastAPI composition layer remains under:

    apps/api/

Its current LiDAR HTTP surface consumes the LiDAR packages but the API itself
remains platform infrastructure so Forestry and Transelect can later expose
their own bounded API modules through the same application.

## Scientific documentation

See:

- [LiDAR documentation index](docs/README.md)
- [Roadmap](docs/roadmap.md)
- [Methodology](docs/methodology.md)
- [Accuracy](docs/accuracy.md)
- [Experiments](docs/experiments/)
- [Engineering decisions](docs/decisions/)
- [Findings](docs/findings/)

## Scientific discipline

The existing LiDAR methodology, experiments, findings, decisions, and
measurement-readiness rules remain authoritative.

In particular:

- source-coordinate units are not assumed to be metres;
- estimator output is not reference truth;
- geometric volume is not automatically commercial cubicación;
- private point clouds are never committed;
- readiness and execution success remain distinct concepts.

## Historical repository state

Before the platform transition, this product occupied the repository
`campo-digital-lidar`.

That pre-platform state remains preserved in Git history at commit:

`423932c862c1a46bcc7b197c7529fe3b8635ad95`

The platform migration does not invalidate or rewrite the established LiDAR
experimental evidence.
