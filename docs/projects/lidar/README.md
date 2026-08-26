# LiDAR / Cubicación

This directory is the product-level entry point for the Campo Digital LiDAR
and timber-stack measurement bounded context.

## Scope

The LiDAR product owns:

- LAS/LAZ point-cloud inspection and processing
- timber-stack localization
- local face geometry
- projected face-area estimation
- estimator benchmarking
- reference validation
- geometric stack-volume analysis

## Current implementation

The validated implementation currently remains in the historical package
layout:

- `products/lidar/src/lidar_core`
- `products/lidar/src/lidar_io`
- `products/lidar/src/lidar_volume`
- `products/lidar/src/lidar_cli`
- `apps/api`
- `products/lidar/dashboard`

These paths will be migrated incrementally as part of the monorepo transition.

## Scientific status

The existing LiDAR methodology, experiments, findings, decisions, and
measurement-readiness rules remain authoritative.

See:

- [Documentation index](../../README.md)
- [Roadmap](../../roadmap.md)
- [Methodology](../../methodology.md)
- [Accuracy](../../accuracy.md)
- [Experiments](../../experiments/)
- [Engineering decisions](../../decisions/)
- [Findings](../../findings/)

## Historical repository state

Before the platform transition, the repository was named
`campo-digital-lidar` and the root README described only this LiDAR product.

That historical state remains available in Git history at commit:

`423932c862c1a46bcc7b197c7529fe3b8635ad95`

The monorepo transition does not invalidate or rewrite the established LiDAR
experimental evidence.
