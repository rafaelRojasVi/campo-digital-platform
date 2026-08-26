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
