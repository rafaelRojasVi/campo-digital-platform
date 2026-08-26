# OneDrive Source System

## Purpose

The shared Campo Digital OneDrive is an external collaboration and source-data
system.

It is not the production application database.

Known source hub:

`00 Hub Digital CampoDigital`

Known top-level structure:

- `01_Gestion_Predial_Forestal`
- `02_Clientes_Mapeo_y_Geomatica`
- `03_Proyecto_Transelect`
- `04_Desarrollo_de_Aplicaciones`
- `05_Recursos_Compartidos`
- `99_Archivo_Historico`
- shared platform/context documents

## Development access

Local development should access a synchronized copy through:

`CAMPO_DIGITAL_SOURCE_ROOT`

Example only:

`/mnt/c/Users/<user>/OneDrive/.../00 Hub Digital CampoDigital`

The exact machine-specific path must never be committed.

## Safety contract

The external source tree is read-only by default.

Never automatically:

- modify source files
- rename source files
- move source files
- delete source files
- commit source/client files to Git
- write generated artifacts back into the OneDrive source tree

Possible source material includes:

- LAS/LAZ
- QGIS projects
- Shapefiles
- GeoPackages
- GeoTIFF
- Excel/CSV
- PDFs
- photographs
- client documents

## Intended lifecycle

OneDrive source material
→ discovery
→ classification
→ validation
→ explicit ingestion
→ PostgreSQL/PostGIS and object storage
→ application APIs

A file appearing in OneDrive must never automatically mutate canonical
production data.

## Classification

Canonical source-path classification is defined in:

`config/source-catalog.yaml`

## Future synchronization

V1 should use a locally synchronized read-only filesystem mirror.

A future Microsoft Graph integration may provide stable file identifiers and
incremental change tracking, but Graph synchronization is not required for the
initial platform foundation.
