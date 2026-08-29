# Gestión Predial Forestal

Gestión Predial Forestal is a Campo Digital bounded product context covering
the Degenfeld estate ("patrimonio Degenfeld") land-use base.

## Current status

Source Evidence V1 and Source Contract V1 are established from the first real
source snapshot supplied by the stakeholder (reviewed 2026-08-29).

The contract is intentionally limited to source structure and safe parsing.
No canonical entities, workflow states, or dashboard functionality have been
implemented; those wait for stakeholder confirmation of the open questions.

## Source boundary

Expected external source location:

`01_Gestion_Predial_Forestal/02_Datos_Entrada/`

Source files remain outside Git. The observed snapshot is a ZIP containing a
single ESRI shapefile family (`Gdb_Degenfeld2026_mv`: 1,568 land-use
polygons, 13 predios), plus a previously generated standalone dashboard HTML
and a written stakeholder brief.

## Current implementation

`forestry_ingestion.shapefile_contract`:

- resolves and validates the shapefile family (`.shp/.shx/.dbf/.prj/.cpg`
  required; sidecars preserved);
- requires the declared UTF-8 encoding and the established CRS declaration
  (WGS_1984_UTM_Zone_18S) — a change fails validation for review;
- validates the 14-field DBF schema by name, type, width, and decimals;
- checks `.shp`/`.shx` header integrity, polygon shape type, and
  attribute/geometry record-count agreement;
- rejects soft-deleted records, unparseable numerics, and empty families;
- projects blank-normalized attribute rows with per-snapshot record numbers;
- fingerprints every member and derives a deterministic family fingerprint
  (SHA-256), aligned with the platform provenance model.

Geometry decoding, PostGIS persistence, and any dashboard remain future
slices.

## Documentation

- [Source Evidence V1](docs/source-evidence-v1.md) — forensic record of the
  observed snapshot (inventory, lineage, schema, profiling, dashboard).
- [Source Contract V1](docs/source-contract-v1.md) — the implemented
  structural contract.
- [Product Projection V1](docs/product-projection-v1.md) — what a first
  read-only dashboard could safely show vs what needs confirmation.
- [Preguntas para Javier](docs/es/preguntas-campo-digital.md) — Spanish
  stakeholder questionnaire.
