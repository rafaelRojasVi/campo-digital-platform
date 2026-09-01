# Secure File Access Slice — Design

## Status

Proposed. Approved in principle by the user on 2026-09-01, pending this
written spec's review.

## Purpose

The Render staging demo (ADR-005) proved the API/portal/Postgres stack
deploys, but exposed a real product gap: dev-auth identities are not
acceptable for real client files, `/ingesta` is an undiscoverable
engineering screen, and there is no path from "a file lives in Campo
Digital's OneDrive" to "it's in the ingestion pipeline" other than a manual
browser file picker.

This slice turns the platform from an engineering demo into a usable
private platform: real sign-in, a discoverable `Archivos` area, real
OneDrive browsing feeding the existing ingestion pipeline, and role-scoped
visibility — without provisioning paid infrastructure and without importing
real client binaries into Render's ephemeral storage.

## Non-goals (explicit)

- No Google Drive connector.
- No Microsoft Graph delta sync (roadmap Phase 7).
- No completion of product-module hosting.
- No production compute/provider decision (ADR-001/ADR-004 remain open).
- No paid Render resources.
- No import of real client OneDrive file *bodies* into Render's ephemeral
  object store (see "Ephemeral storage" below) — browsing and selecting
  real files is in scope; fetching their bytes into ingestion is
  feature-flagged off until durable object storage exists.

## 1. Identity and session model

### Entra ID app registration

- **Single-tenant** Azure AD app registration in Campo Digital's own
  Microsoft 365 tenant (not multi-tenant/"any organization"). This must be
  created manually by someone with tenant admin rights — out of band, not
  something this repo can do. The implementer produces exact
  step-by-step instructions for that person as part of this slice.
- Confidential client (server-side authorization-code flow), so a client
  secret (or certificate) is required — stored the same way other
  production-candidate secrets are (local: ignored env file; Render:
  Render's environment variable store).

### Stable identity, never email

`platform.app_user` already generalizes identity via
(`identity_kind`, `identity_key`) — see `app.access_repository`. Entra
identities use:

```
identity_kind = "entra"
identity_key  = f"{tenant_id}:{oid}"   # both from the validated ID token
```

`oid` (object ID) is the stable, non-reassignable per-user identifier
Microsoft documents for this purpose; email/UPN can change (rename,
domain change) and must never be used as the identity key. `email` /
`display_name` are still stored on `app_user` as denormalized display
data, refreshed on each login, exactly as today.

### Two-step consent: sign-in vs. file access

A user who only needs to *view* Campo Digital must not be forced through
a OneDrive permission prompt. Two separate token acquisitions:

1. **Sign-in** — `openid profile` only (no Graph resource scopes). This is
   what every login does. It proves identity and nothing else.
2. **Graph file consent** — requested only when a user who holds an
   `UPLOAD`-capable grant (admin/operator on at least one product) opens
   the "Desde OneDrive" panel for the first time. This is a second,
   incremental authorization-code round trip (Microsoft identity platform
   supports incremental consent) requesting exactly the Graph scope
   decided in section 2. A viewer-only user never triggers this.

### Session storage: hash, not token

`platform.session` (new table, migration `0007`):

| column | notes |
|---|---|
| `id` | bigint identity PK |
| `session_secret_hash` | `sha256(raw_secret)`, unique, indexed |
| `app_user_id` | FK → `app_user.id` |
| `created_at`, `last_seen_at`, `expires_at` | timestamptz |

The cookie carries the raw, unguessable secret (`secrets.token_urlsafe`,
same generation as today's `DevSessionStore`). The server hashes the
incoming cookie value and looks up by hash — the raw secret is never
persisted, mirroring how the codebase would want an API key stored, and
meaning a DB read alone (e.g. a backup leak) cannot mint sessions. This
replaces `DevSessionStore`'s in-process dict for real identities; it also
happens to fix ADR-005's "session dies on every free-tier spin-down"
problem, since Postgres (unlike the local filesystem) survives Render's
ephemeral-instance cycling.

Dev-auth (`app.dev_auth`) keeps its existing in-process store — it is
**further restricted** to `APP_ENV == "development"` only (today it also
runs in `staging`; that is exactly the exposure this slice closes). Test
env keeps whatever `app.dev_auth` already allows for `pytest`.

### Microsoft tokens stored separately from sessions

`platform.ms_graph_grant` (new table, migration `0007`):

| column | notes |
|---|---|
| `id` | bigint identity PK |
| `app_user_id` | FK → `app_user.id`, unique |
| `access_token_encrypted`, `refresh_token_encrypted` | Fernet-encrypted bytes |
| `scope` | text, granted scope string |
| `expires_at` | timestamptz |
| `granted_at` | timestamptz |

Encrypted at rest with a symmetric key from `PLATFORM_TOKEN_ENCRYPTION_KEY`
(new env var; local: ignored env file, Render: environment variable —
no Secret Manager needed at this scale, consistent with "no paid
infrastructure unless necessary"). Never sent to the browser. Used only
server-side to make Graph calls on the user's behalf. New dependencies:
`msal` (Microsoft's own library — correctly implements PKCE, token
refresh, and cache; hand-rolling OAuth token refresh is exactly the kind
of place not to save a dependency) and `cryptography` (Fernet).

### First-admin bootstrap — explicit, not implicit

A fresh Entra login gets **zero product grants** by default — this is
the RBAC invariant `app.access.can()` already enforces (`None` role always
denies) and must not be quietly weakened.

Bootstrap is one explicit, reviewable config pair:

```
PLATFORM_BOOTSTRAP_ADMIN_TENANT_ID
PLATFORM_BOOTSTRAP_ADMIN_OBJECT_ID
```

On login, if (and only if) the resolved identity's `(tid, oid)` exactly
matches this configured pair, and that identity currently holds **no**
grants at all, grant ADMIN on all three products once. This is a
narrow, one-time, config-driven seam — never "first login ever" and never
domain/email-based, both of which were explicitly rejected because they
create an implicit, unreviewable privilege-escalation path.

## 2. Source type discovery (must run before choosing a Graph scope)

`config/source-catalog.yaml` and `docs/source-systems/onedrive.md` both
flag the exact source location as unconfirmed ("Exact OneDrive path still
to be confirmed"). Whether `00 Hub Digital CampoDigital` is (a) a folder
inside a personal/business OneDrive drive, (b) a OneDrive location shared
by another user, or (c) a synced SharePoint/Teams document library
materially changes the least-privileged permission choice. Do not guess.

**Step 0 of implementation** is a short, throwaway discovery script run
against a real Campo Digital sign-in (not client data, just Graph
metadata calls): `GET /me/drives`, `GET /sites?search=`, and walking
`children` from the known top-level folder names in
`docs/source-systems/onedrive.md`, to answer: which drive/site actually
holds this content, and what are its stable `driveId` and root
`itemId` (or `siteId`)?

Decision tree from that result:

- **Personal/business OneDrive drive the signing-in user owns or is a
  direct member of** → delegated `Files.Read` (not `.All`) — narrowest
  option, typically user-consentable without tenant admin approval.
- **OneDrive content shared by a different user** → delegated
  `Files.Read.All` is required for Graph to resolve items the caller
  doesn't own, even though it is still bounded to what that caller can
  already see — this is Graph's naming, not a broader grant in practice.
- **SharePoint/Teams-backed document library** → prefer **`Sites.Selected`**
  over `Sites.Read.All`. `Sites.Selected` requires an admin to explicitly
  grant the app permission to exactly one site (`PUT
  /sites/{site-id}/permissions`, a one-time admin action documented for
  the tenant-admin handoff), rather than every site in the tenant. This
  is the single most important least-privilege decision in this section
  and should be preferred whenever the discovery step confirms a
  SharePoint-backed library.

Record the outcome (drive/site type, chosen scope, and the stable IDs) as
a short **RESULT** entry in `docs/source-systems/onedrive.md` once known
— this is exactly the kind of durable finding the documentation policy
asks to capture.

## 3. Server-side Graph authorization

Every OneDrive-sourced action must satisfy, server-side, the intersection
of:

```
Microsoft-accessible ∩ configured product source root ∩ Campo product grant
```

Concretely:

- **Microsoft-accessible**: every Graph call uses the signing-in user's
  own delegated token (never an app-only/client-credentials token), so
  Graph itself enforces what that person can see. No "act as the app"
  fallback.
- **Configured product source root**: `config/source-catalog.yaml` gains,
  once Step 0 resolves them, stable `drive_id`/`site_id` + root `item_id`
  per project (replacing the current `source_paths` human path strings for
  the Graph-backed lookup — paths remain for the local filesystem-mirror
  discovery, which is unaffected). The backend resolves a browsed/selected
  item's `parentReference` chain and rejects anything whose ancestry does
  not include the configured root `item_id` for that product. A client
  never gets to assert "this item belongs under product X" — the server
  proves it via Graph's own parent chain, the same trust posture
  `source_discovery._resolve_source_file` already applies to local
  filesystem paths (reject anything that doesn't verifiably resolve
  beneath the configured root).
- **Campo product grant**: the existing `Action.UPLOAD` check
  (`ensure_can`) for anything that would enter the ingestion pipeline;
  `Action.VIEW` for browsing.

Stable Graph IDs (`driveId`+`itemId`, or `siteId`+`itemId`) are used
throughout — never a human path string — because paths can be renamed
out from under a reference; IDs are what Graph itself treats as stable.

## 4. Portal: `Archivos`

`/ingesta` is renamed in the navigation to `/archivos` ("Archivos"),
linked from the Home header/nav — not a hidden route. The engineering
framing ("Ingesta local (dev)") is replaced with product-facing copy.
`/ingesta` may 301-redirect to `/archivos` for continuity; no separate
engineering screen remains linked from anywhere in normal navigation.

The page keeps its existing shape (login gate → session → per-product
scoped view) but reorganizes into:

- **Mis archivos** — today's job list, extended with the source
  filename (already captured in `source_observation.filename`) so it
  reads as a file list with status, not a bare job-ID table.
- **Subir archivo** — today's manual upload panel, unchanged.
- **Desde OneDrive** — new. Visible only to users with an `UPLOAD`-capable
  grant on at least one product. Triggers the incremental Graph consent
  (section 1) on first use, then shows a folder/file browser scoped to
  *only* the product(s) the user is granted on, backed by the
  intersection rule in section 3. Selecting a file requires the same
  explicit product selection the upload panel already requires — never
  inferred.
- **Audit** — unchanged (admin-only).

A minimal **grants** panel (admin-only, gated by `Action.MANAGE_ACCESS`)
lists real Entra identities that have ever logged in and lets an admin
set/change their per-product role. Without this, a bootstrap admin has no
way to onboard a second real user — see section 1.

## 5. Ingestion wiring: browse/select is metadata-only for now

`Desde OneDrive` lets a user authenticate, browse, and *select* a real
file — all metadata-only Graph calls (`children`, `search`, item
properties). The step that would fetch bytes
(`GET /drives/{id}/items/{id}/content`) and hand them to the existing
`object_store.put` → `persist_uploaded_source_provenance` →
`enqueue_processing_job` pipeline is implemented but sits behind a
feature flag, **off by default**:

```
ENABLE_ONEDRIVE_IMPORT=false
```

Rationale (section "Ephemeral storage" explains the mechanism): Render's
free-tier object store is ephemeral, and this slice must not be the thing
that first pipes real client binaries into a store that can silently
lose them. Manual upload already carries this exact risk today and is
already documented as accepted in ADR-005 — this slice does not make that
worse, but it also must not extend the same unresolved risk to a second,
larger, real-external-data source. When durable object storage exists
(a later, separate decision — GCS/Azure Blob/S3-compatible, whichever
production provider is accepted), flip the flag; no pipeline code
changes, since it's the same `object_store.put` call regardless of byte
source.

A new source-system row (`campo_digital_graph`, analogous to today's
`campo_digital_upload` in `app.source_provenance`) distinguishes
Graph-sourced snapshots from browser uploads in provenance, once the flag
is on.

## 6. Execution: staging-only in-process adapter, not a production model

ADR-005 deploys no worker, so queued jobs never complete on Render
staging today. Fix this cheaply, but do not blur it into a production
decision:

- Introduce an explicit `ExecutionBackend` interface (`app/execution.py`)
  with one method roughly like `submit(job) -> None`. `app.worker.run_one_job`
  becomes the shared implementation logic called by any backend.
- `InProcessStagingExecutionBackend`: a FastAPI startup task that polls
  `run_one_job` on an interval. Guarded explicitly by
  `APP_ENV == "staging"` (a distinct check from dev-auth's — staging
  chose this specifically to keep the free deployment demoable, not
  because it's an acceptable production pattern). It:
  - runs blocking DB + inspection work via `asyncio.to_thread` /
    `run_in_executor`, never directly on the event loop;
  - enforces a staging-specific size cap well below
    `MAX_UPLOAD_BYTES` (2 GiB): default **25 MB**, configurable via a new
    `STAGING_EXECUTION_MAX_BYTES` env var, suitable for metadata/small-file
    demonstration, not real workloads — a job over the cap stays queued
    with `error_summary = "exceeds staging execution size limit"` rather
    than being attempted;
  - explicitly refuses `lidar` product jobs (real LiDAR inputs are
    hundreds of MB and the point of this guard is that full LiDAR
    processing must never run this way) — jobs for that product stay
    queued with a clear "not processed in staging" status rather than
    being attempted and failing confusingly.
- The production execution model remains the open question it already
  is (Cloud Run Jobs / Container Apps Jobs per ADR-001/ADR-004) — this
  slice adds the interface seam, not the production implementation.

## 7. Ephemeral storage: visible, not silent

A `processing_job` row can now outlive the local object it references —
Render's free web service gets a fresh ephemeral filesystem on every
redeploy or idle spin-down/wake, but Postgres rows persist. When the
in-process adapter (or a future worker) goes to claim a job whose
`object_storage_key` no longer resolves in `LocalObjectStore`, it must
fail that job with a distinct, visible status/error summary (e.g.
`error_summary = "source object unavailable (ephemeral storage cycled)"`)
rather than crashing or silently retrying forever. This state must be
what the "Mis archivos" list actually shows for such a job — this
slice must not claim source preservation it cannot back up. This is a
genuine, expected outcome on the free tier, not a bug to be hidden.

## Sequencing (implementation order)

1. **Discovery spike** (section 2) — determine drive/site type and the
   least-privileged Graph scope against a real Campo Digital sign-in.
   Record the RESULT in `docs/source-systems/onedrive.md`. No app code.
2. **Entra app registration handoff doc** — write the exact steps for
   Campo Digital's tenant admin (single-tenant app, redirect URIs for
   local + Render staging, the scope chosen in step 1, `Sites.Selected`
   grant if applicable). Blocks nothing else in parallel, but real
   end-to-end testing needs it done.
3. **Session hardening** — migration `0007` (`platform.session`,
   `platform.ms_graph_grant`), swap dev-auth's in-process session for the
   hashed-cookie Postgres-backed store; restrict `assert_dev_auth_allowed`
   to `development` only. (Independently valuable and low-risk — do this
   before Entra lands.)
4. **Entra sign-in** — `msal`-backed authorization-code + PKCE login
   flow, `identity_kind="entra"` resolution, bootstrap-admin check,
   two-step consent scaffolding (Graph consent request wired but unused
   until step 6).
5. **Grants management** — minimal admin endpoint/UI using
   `Action.MANAGE_ACCESS`.
6. **Archivos navigation** — rename/move `/ingesta` → `/archivos`,
   reorganize into Mis archivos / Subir archivo / Audit (OneDrive panel
   deferred to step 7).
7. **OneDrive browse/select** — Graph client, source-catalog stable-ID
   config, the intersection authorization check (section 3), "Desde
   OneDrive" panel wired to metadata-only calls. `ENABLE_ONEDRIVE_IMPORT`
   stays `false`.
8. **Staging execution adapter** — `ExecutionBackend` interface,
   `InProcessStagingExecutionBackend`, ephemeral-object-missing handling
   (section 7).
9. **Deploy + verify on Render staging**, dev-auth confirmed unreachable
   there, real Entra login exercised end-to-end, OneDrive browse
   exercised end-to-end (import flag still off).

Flipping `ENABLE_ONEDRIVE_IMPORT` to `true` is explicitly **not** part of
this slice — it's gated on a separate durable-object-storage decision.

## Related documents

- `docs/adr/ADR-005-render-staging-experiment.md`
- `docs/platform/security-model.md`
- `docs/platform/source-ingestion.md`
- `docs/source-systems/onedrive.md`
- `config/source-catalog.yaml`
