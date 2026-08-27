# Campo Digital Platform System Overview

## Status

Proposed platform architecture.

## Purpose

Campo Digital is evolving from separate project files, local tools, generated HTML dashboards, and product-specific code into one maintainable company platform.

The goal is not to merge LiDAR, Forestry, and Transelec into one domain. The goal is to give the company one controlled system for authenticated access, product navigation, canonical application state, source ingestion, provenance/history, generated artifacts, operational visibility, and product-specific dashboards.

## Product model

```text
Campo Digital Platform
|
+-- Company portal / shared shell
|   +-- authentication
|   +-- navigation
|   +-- project/product entry points
|   +-- platform operational status
|
+-- LiDAR / Cubicación
|   +-- scientific processing
|   +-- measurement runs
|   +-- results and artifacts
|
+-- Gestión Predial Forestal / QGIS
|   +-- geospatial source ingestion
|   +-- canonical polygon state
|   +-- maps and exports
|
+-- Transelec
    +-- spreadsheet source ingestion
    +-- operational state/history
    +-- dashboard projections
```

## Repository ownership

```text
products/
  lidar/
  forestry/
  transelect/

apps/
  api/
  portal/        # proposed future company shell

packages/
  contracts/
  ui/
```

`apps/portal/` is a proposed future company-level frontend shell. It should own company/platform concerns such as authentication, navigation, and cross-product operational views. Product dashboards remain product-owned. Shared UI components move into `packages/ui/` only after genuine reuse exists.

## Backend shape

One FastAPI application remains the HTTP composition layer. Product domain code must not depend on FastAPI. Do not create microservices solely because there are three products.

## Data authority

```text
Human collaboration
      |
      v
   OneDrive
      | read-only ingestion
      v
source discovery / fingerprint / snapshot
      |
      +--------------------+
      |                    |
      v                    v
object storage        product validation
immutable files             |
                             v
                    PostgreSQL/PostGIS
                    canonical state + history
                             |
                             v
                          FastAPI
                             |
                             v
                         dashboards
```

OneDrive is an external source/collaboration system. Generated HTML, Excel, GIS exports, and reports are artifacts. PostgreSQL/PostGIS is the target canonical structured/geospatial store. Large binaries stay outside PostgreSQL.

## Local-first infrastructure

```text
Windows / OneDrive sync
       |
       v
CAMPO_DIGITAL_SOURCE_ROOT
       |
       v
WSL development environment
       |
       +-- FastAPI
       +-- product code
       +-- PostgreSQL/PostGIS container
       +-- local artifact storage
       +-- local job execution
       +-- React/Vite frontends
```

## Production mapping

```text
LOCAL                         PRODUCTION CANDIDATE

FastAPI local         ----->  Cloud Run
Postgres/PostGIS      ----->  Cloud SQL PostgreSQL/PostGIS
local artifact store  ----->  Cloud Storage
local CLI/job         ----->  Cloud Run Job
OneDrive filesystem   ----->  Microsoft Graph adapter
React/Vite local      ----->  static/CDN hosting
```

The application must not place provider-specific business logic inside product domains.

## AI-assisted engineering

Claude support is an engineering workflow capability, not a runtime dependency. Production users, APIs, databases, and domain correctness must not depend on an AI model being available. Root AI instructions define platform-wide constraints; product-specific AI knowledge should be added only when real repeated workflows and evidence justify it.

## Non-goals

The current foundation does not require Kubernetes, Redis, Celery, Kafka/RabbitMQ, independent databases per product, direct browser access to PostgreSQL, automatic destructive OneDrive synchronization, or rewriting the existing LiDAR scientific engine.
