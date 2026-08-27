# Contributing

## Setup

    make setup

## Before committing

Run:

    make check

This is the canonical local quality gate.

## Product boundaries

Product-specific work belongs under the corresponding product root:

- `products/lidar`
- `products/forestry`
- `products/transelect`

Do not place product-specific business logic in generic shared directories.

Executable product dependency rules are checked with:

    make architecture-check

The canonical `make check` gate includes this architecture check.

Full Git history can be scanned for accidentally committed credentials with:

    make secret-check

Secret scanning is intentionally separate from `make check` because obtaining
the pinned Gitleaks binary requires network access.

## External data

Campo Digital source/client data remains outside Git.

Never commit private LAS/LAZ, GIS datasets, client spreadsheets, imagery,
credentials, or machine-specific OneDrive paths.

## LiDAR scientific discipline

LiDAR changes must preserve the existing evidence rules:

- do not infer CRS or physical units;
- do not treat estimator output as reference truth;
- distinguish geometric volume from commercial cubicación;
- keep real/private point clouds out of CI;
- preserve experiment provenance and reproducibility.

## Architecture changes

Architecturally significant changes must update `ARCHITECTURE.md` and, where
appropriate, add an ADR under `docs/adr/`.

## Git

Use focused feature branches and conventional-style commit prefixes where
practical:

- `feat:`
- `fix:`
- `refactor:`
- `docs:`
- `test:`
- `chore:`
