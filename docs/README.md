# Campo Digital Platform Documentation

[Project README](../README.md) · [Architecture](../ARCHITECTURE.md)

This directory contains documentation that applies to the Campo Digital
platform as a whole rather than to one product implementation.

## Platform architecture

- [Monorepo architecture](platform/monorepo.md)
- [Product boundaries](platform/product-boundaries.md)
- [OneDrive source-system boundary](source-systems/onedrive.md)

## Engineering policy

- [Documentation policy](DOCUMENTATION_POLICY.md)

## Product documentation

### LiDAR / Cubicación

- [LiDAR product](../products/lidar/README.md)
- [LiDAR engineering documentation](../products/lidar/docs/README.md)

### Gestión Predial Forestal / QGIS

Product documentation will live under `products/forestry/` when that bounded
context is implemented.

### Transelect

Product documentation will live under `products/transelect/` after its source
material and operating workflow have been reviewed.

## Documentation templates

Reusable engineering-document templates remain platform-level:

- [ADR template](templates/adr.md)
- [Experiment template](templates/experiment.md)
- [Journal-entry template](templates/journal-entry.md)
