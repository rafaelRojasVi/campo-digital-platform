# Campo Digital Environments and Infrastructure Costs

## Status

Planning baseline.

Pricing snapshot date: **2026-08-27**. Provider prices change; re-check official pricing before provisioning.

CLP examples use a planning exchange rate of **1 USD = 920.57 CLP**, observed on 2026-08-27.

## Cost philosophy

Campo Digital should not pay for production infrastructure before shared production access is required. The architecture should first run locally with the same conceptual boundaries that later map to managed cloud services.

## Environment 0 — local development

| Capability | Local implementation | Incremental cloud cost |
|---|---|---:|
| FastAPI API | local Python process/container | $0 |
| PostgreSQL/PostGIS | local Docker container | $0 |
| product frontends | local React/Vite servers | $0 |
| source access | synchronized OneDrive read-only filesystem | $0 infrastructure* |
| artifact storage | local gitignored filesystem | $0 |
| ingestion/jobs | CLI/local process | $0 |
| secrets | ignored local environment file | $0 |
| logs | terminal/local files | $0 |

`*` Existing Microsoft/OneDrive licensing is excluded because the current licensing contract is not established in platform evidence.

**Expected incremental cloud infrastructure: $0/month.**

Local development is not production: a laptop failure, local disk failure, or sync problem is not an acceptable production backup strategy.

## Environment 1 — optional shared development/staging

Do not create staging merely because mature companies have staging. Introduce it when shared deployment/integration testing becomes valuable.

Google currently lists shared Cloud SQL types at approximately:

- `db-f1-micro`: $0.0105/hour (~$7.67/month);
- `db-g1-small`: $0.035/hour (~$25.55/month).

Google states these shared-core types are not covered by the Cloud SQL SLA, so they are development/testing candidates rather than the final production reliability posture.

**Planning range: $10–35/month** (about CLP 9k–32k) before unusual transfer or heavy processing.

## Environment 2 — lean production V1

| Capability | Proposed service | Cost behavior |
|---|---|---|
| FastAPI | Cloud Run | usage based |
| PostgreSQL/PostGIS | Cloud SQL | primary fixed cost |
| binary/source storage | Cloud Storage | GiB + operations/egress |
| background/batch work | Cloud Run Jobs | usage based |
| scheduling | Cloud Scheduler | first 3 jobs free/account |
| secrets | Secret Manager | small free allowance |
| container images | Artifact Registry | first 0.5 GiB-month free |
| monitoring/logging | Google Cloud operations | usage dependent |
| frontend | static/CDN or Cloud Run later | usage dependent |

### Cloud Run

Current request-based free allowances include 180,000 vCPU-seconds, 360,000 GiB-seconds, and 2 million requests per month. Initial normal API traffic should therefore be a small part of the bill unless requests are compute-heavy or minimum instances are configured.

Planning allowance: **$0–10/month** initially.

### Cloud SQL PostgreSQL/PostGIS

This is expected to be the main fixed service. Published general-purpose rates vary by machine series; current pricing includes rates around **$0.0413–$0.054 per vCPU-hour** and **$0.007–$0.009 per GiB-hour**.

An example small dedicated configuration around 1 vCPU / 3.75 GiB therefore lands roughly in the **$50–65/month compute range**, before DB storage/backups. This is a planning example, not a final sizing decision.

### Database storage/backups

Allocate approximately **$5–15/month** initially until real DB size, backup retention, and storage type are selected.

### Cloud Storage

Santiago Standard object storage is approximately **$0.02/GiB-month**.

| Stored data | Approx. at-rest monthly cost |
|---:|---:|
| 50 GiB | $1 |
| 100 GiB | $2 |
| 250 GiB | $5 |
| 500 GiB | $10 |
| 1 TiB | ~$20 |

Internet egress can become more important than at-rest storage if large LAS/LAZ packages are repeatedly downloaded.

### Cloud Run Jobs

Current job rates include approximately $0.000018 per vCPU-second and $0.000002 per GiB-second, with free monthly allowances. Occasional ingestion/report work should be low-cost. LiDAR must be benchmarked from real CPU, RAM, runtime, disk, and I/O before accepting a production compute budget.

### Scheduler / secrets / registry

Current official allowances include:

- Cloud Scheduler: 3 jobs free, then $0.10/job/month;
- Secret Manager: first 6 active secret versions and 10,000 access operations/month free;
- Artifact Registry: first 0.5 GiB-month storage free.

## Lean production planning envelope

| Component | Planning range |
|---|---:|
| Cloud SQL compute | $50–65 |
| DB storage/backups | $5–15 |
| Cloud Run API | $0–10 |
| Cloud Run Jobs | $0–10 |
| Cloud Storage | $2–10 |
| scheduler/secrets/registry | $0–5 |
| logging/other variable usage | $0–10 |
| **Estimated initial total** | **$57–125/month** |

A practical operating target is **$75–100/month** (~CLP 69k–92k at the planning rate). This is a budget, not a contractual quote.

## High availability

Do not enable DB HA only to look enterprise-ready. Start with managed DB, backups/PITR where configured, a tested restore procedure, and monitoring. Add HA when business downtime requirements justify roughly duplicating database compute capacity.

## Suggested budget alerts

```text
$75/month   informational
$100/month  warning
$150/month  engineering review
$200/month  investigate before accepting continued spend
```

## Costs deliberately excluded

Microsoft 365/OneDrive licensing, domain registration, paid authentication, third-party observability, Claude/AI subscriptions, developer labor, unusual egress, GPU work, and high-frequency LiDAR processing.

## Official pricing sources

- https://cloud.google.com/run/pricing
- https://cloud.google.com/sql/pricing
- https://cloud.google.com/storage/pricing
- https://cloud.google.com/scheduler/pricing
- https://cloud.google.com/secret-manager/pricing
- https://cloud.google.com/artifact-registry/pricing
