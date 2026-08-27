# ADR-002 — Source provenance identity

## Status

Accepted.

## Context

Campo Digital must preserve auditable provenance for external source material
without treating OneDrive paths, filenames, or product-specific source formats
as canonical business identity.

The current V1 source access is a read-only synchronized filesystem mirror.
Provider-stable OneDrive item identifiers are not currently available through
that access mechanism.

## Decision

The platform distinguishes four concepts:

1. source system;
2. source asset;
3. source snapshot;
4. source observation.

A source asset represents a logical external item.

A source snapshot represents one immutable content version of a source asset.

V1 snapshot content identity uses SHA-256 encoded as exactly 64 lowercase
hexadecimal characters.

A source observation records where and when that snapshot was observed.

Current filesystem discovery may use a root-relative path as a provisional
source-asset identity. That identity is explicitly not assumed to survive
renames or moves.

Future provider integrations may use stable provider item identifiers without
changing snapshot content identity.

Product-specific interpretation does not belong in these platform provenance
entities.

## Consequences

Identical content for the same resolved source asset can be idempotent at the
snapshot layer.

When a stable source-asset identity exists, path or filename changes can be
represented through new observations without changing immutable content
identity.

The current filesystem-mirror implementation cannot prove that two different
paths represent the same logical source asset. Under the provisional
root-relative-path identity, a rename or move therefore resolves to a different
provisional source asset unless stronger provider evidence exists.

Rename/move reconciliation must therefore not be inferred automatically until
stronger provider identity evidence exists.

Product classification, validation state, ingestion runs, schema contracts,
artifact storage, and product-domain persistence remain outside this decision.
