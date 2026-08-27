# Campo Digital Source Ingestion

## Status

Proposed platform contract.

## Purpose

Campo Digital receives operational source material from external systems such
as OneDrive.

The ingestion system must convert changing files into validated, auditable
application state without treating the external file tree as the production
database.

## Core concepts

### Source system

The external provider or repository from which material is observed.

Initial source system:

- Campo Digital OneDrive.

### Source asset

The logical external file or asset.

Identity should eventually use provider-stable identifiers where available,
not filename alone.

### Source snapshot

An immutable observation of source content at a point in time.

A snapshot should preserve metadata such as:

- source asset identity;
- source path;
- filename;
- observed timestamp;
- source-modified timestamp;
- size;
- media/file type;
- SHA-256 or equivalent content fingerprint;
- product classification;
- validation/ingestion state.

### Schema contract

The expected structural shape of a source.

Schema change is distinct from data change.

Example:

```text
same Transelec columns + changed PM values
    = normal new data snapshot

renamed/removed/unexpected columns
    = schema-contract change requiring review
```

### Ingestion run

A reproducible attempt to validate and project one source snapshot into a
product domain.

### Generated artifact

An output produced from canonical or validated source state.

Examples:

- HTML dashboards;
- Excel exports;
- GIS exports;
- PDFs;
- LiDAR reports.

Generated artifacts are not canonical source data.

## Lifecycle

```text
DISCOVERED
    |
    v
FINGERPRINTED
    |
    v
SNAPSHOTTED
    |
    v
CLASSIFIED
    |
    v
VALIDATED
    |
    v
READY_FOR_IMPORT
    |
    v
INGESTED
```

Failure and supersession states must remain auditable.

## Safety rules

- Source access is read-only by default.
- Ingestion never overwrites the original source automatically.
- A deleted source file does not delete canonical or historical production
  data.
- A renamed source file must not automatically become a new logical business
  entity.
- Re-ingesting identical content must be idempotent.
- Malformed or unexpected data must fail validation rather than partially
  mutate canonical state.
- Product-specific parsing belongs to the owning bounded context.

## V1 source access

Development uses:

```text
CAMPO_DIGITAL_SOURCE_ROOT
```

pointing to the synchronized OneDrive filesystem mirror.

This is sufficient for initial discovery and ingestion development.

## Future source access

Microsoft Graph may later replace filesystem discovery in production.

Expected advantages include:

- stable provider item identifiers;
- incremental change discovery;
- rename/move awareness;
- deletion events;
- delta synchronization.

Graph integration is not required to establish the V1 domain and ingestion
contracts.

## Product adapters

Shared ingestion infrastructure discovers, fingerprints, snapshots, and
records provenance.

Business interpretation remains product-specific:

```text
source snapshot
      |
      +---- LiDAR adapter
      +---- Forestry adapter
      +---- Transelec adapter
```

Do not create a generic shared domain model for product-specific source
semantics.
