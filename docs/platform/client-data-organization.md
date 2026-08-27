# Campo Digital Client Data Organization

## Status

Proposed operational migration strategy.

## Problem

Campo Digital source material currently exists across shared OneDrive content
and potentially multiple computers and working copies.

The immediate objective is not merely to move files onto a server.

The objective is to establish:

- known ownership;
- known project classification;
- known source history;
- reliable current-state identification;
- reproducible ingestion;
- recoverability.

## Authority model

A developer or stakeholder laptop must not become the application source of
truth.

Target responsibilities:

| Layer | Responsibility |
|---|---|
| OneDrive | Human collaboration and external source material |
| Object storage | Durable source snapshots and large private assets |
| PostgreSQL/PostGIS | Canonical structured/geospatial application state |
| GitHub | Source code, schemas, documentation, migrations |
| Product applications | Controlled user interaction with canonical state |

## Migration discipline

Do not begin by deleting, renaming, or reorganizing source files.

First perform a read-only inventory.

For each discovered file record where practical:

- machine/source location;
- relative path;
- filename;
- file type;
- size;
- modification timestamp;
- owning project;
- suspected role;
- checksum where useful.

## Consolidation process

```text
1. Discover
2. Inventory
3. Classify
4. Identify duplicates
5. Identify candidate current versions
6. Confirm uncertain ownership/versioning
7. Preserve originals
8. Consolidate collaboration sources
9. Introduce immutable platform snapshots
10. Ingest into canonical application state
```

Moving or deleting originals should happen only after the inventory and
ownership/version decisions are reviewed.

## Project classification

Current primary product contexts include:

- `01_Gestion_Predial_Forestal`
- `03_Proyecto_Transelec`
- LiDAR / Cubicación source material once its exact source path is classified.

Other shared folders must not be assigned to a product merely from their name.

## Source history

Filename suffixes such as dates or `v0`, `v1`, `final`, or `final2` are useful
human hints but are not sufficient provenance.

Platform ingestion should ultimately identify source versions using content
fingerprints and source metadata.

## Desired end state

Stakeholders continue to work through a familiar collaboration mechanism while
Campo Digital applications provide the controlled operational view.

A user should not need to know:

- which computer holds the newest file;
- which generated HTML is current;
- which local spreadsheet copy is authoritative;
- which developer database contains the latest state.

Those concerns become platform responsibilities.
