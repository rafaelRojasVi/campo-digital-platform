# ADR-008 — Hosted demo data V1

## Status

Accepted. Extends `ADR-007-hosted-product-composition-v1.md` (hosted
composition pattern, portal iframe, closed allowlist — unaffected) and
respects `ADR-006-restrict-dev-auth-to-development.md` (dev-auth stays
development-only; not touched here).

## Context

Javier needs a public STAGING portal he can demonstrate without an Entra
login, and without exposing any real Campo Digital client data. ADR-007
already solved this for LiDAR (Category B: no DB dependency, `/runs` already
returns `[]` on a fresh checkout, no product code changed) but explicitly
deferred the other two products:

- **Forestry** was Category B on paper but deferred as "not yet hosted"
  because `feat/forestry-dashboard-v1`'s dashboard has no offline/static
  data path — `src/api.ts` always calls `/api/forestry/*` — and ADR-007
  declined to fabricate polygon geometry to work around that, calling that
  risk "the speculative-business-semantics problem this task was told to
  avoid."
- **Transelec** was Category C, architecturally blocked: its
  `/api/transelec/*` routes require a live Postgres and object store even to
  serve a degraded state, and its hosted-pilot runbook designs for
  IAP-gated, non-public access.

ADR-007 closed by saying extending either to a hosted category "requires a
follow-up task explicitly scoped to build a synthetic dataset — not implied
by this ADR." This ADR is that follow-up. Separately, the real `/runs` route
and every other RBAC-protected route must keep returning 401/403
unauthenticated for the whole platform — this work must not touch that.

## Decision

Extend the ADR-007 hosted-composition pattern (closed `hostedModuleUrls()` /
`isSafeIframeUrl()` allowlist, portal iframe) to all three products, using a
different mechanism per product depending on whether a real dashboard
codebase already existed for it.

### LiDAR: build-time demo flag on the existing dashboard

`products/lidar/dashboard/src/api.ts` gains a `DEMO_MODE = import.meta.env
.VITE_CAMPO_DEMO === 'true'` branch that resolves bundled fixtures
(`src/demoData.ts`) instead of calling `/api/runs`. This is additive to the
same dashboard codebase ADR-007 already classified Category B — no new app,
no change to the real RBAC'd `/api/runs` route, and `VITE_CAMPO_DEMO` is
unset (hence `false`) everywhere except the new demo build. A DEMO banner
renders whenever the flag is on.

### Forestry and Transelec: new, product-owned, demo-only dashboards

Rather than retrofit a static-data branch into dashboards that assume a live
backend, this ADR creates two new frontend-only apps —
`products/forestry/dashboard/` and `products/transelect/dashboard/` —
neither of which exists on `main`. Each is ported from the read-only
presentational layer already built on an unmerged sibling branch
(`feat/forestry-dashboard-v1` and `feat/transelec-ui-reference-parity-v1`
respectively), with every admin, upload, and draft/cut-editing affordance
removed during the port (`draftGeometry.ts`/`draftHistory.ts` and
`MapView`'s draft-editing paths for Forestry; `SourceManager`/
`SourceStatusCard` and any upload helper for Transelec). What remains is
pure presentation and pure logic — components, `lib/` utilities, aggregation
code — wired to a hand-authored synthetic fixture module (`demoData.ts` for
each) instead of any HTTP call. Confirmed directly: both apps' `src/api.ts`
resolve every exported function from an in-memory fixture module with no
`fetch` call anywhere in the file. Neither app introduces a new backend
route, a new database table, an Alembic migration, or object storage — they
are static sites with no server behind them, same as the portal itself.

Forestry's fixture is a wholly invented 6-predio estate (fictitious codes
and names, coordinates placed far from any real Chilean location).
Transelec's fixture is a set of invented PMF/predio rows with fake
identifiers, no real names or emails, with the pilot's `pmf_view`
aggregation logic ported to TypeScript to run against those rows client-side.

### Portal: extend the existing hosted-composition wiring

`apps/portal/src/runtime/hostedModules.ts`'s `hostedModuleUrls()` gains
`VITE_FORESTAL_HOSTED_URL` / `VITE_TRANSELEC_HOSTED_URL` alongside the
existing `VITE_LIDAR_HOSTED_URL`, still resolved once at build time into the
same closed `Partial<Record<ModuleId, string>>`. `apps/portal/src/lib/
safeUrl.ts`'s `isSafeIframeUrl` STAGING branch grows from a single allowed
hostname to a three-entry `Set` — `campo-digital-lidar-staging`,
`campo-digital-forestal-staging`, `campo-digital-transelec-staging`, all
`.onrender.com` — preserving ADR-007's "closed set, not a wildcard" property.
`ModuleHeader` gains a DEMO badge, gated on the same `demo` flag ADR-007's
`ModuleRuntimeStatus` is extended to carry, so a visitor always sees which
modules show synthetic data.

### Infrastructure

`render.yaml` adds two new `plan: free` static sites
(`campo-digital-forestal-staging`, `campo-digital-transelec-staging`)
alongside the existing `campo-digital-lidar-staging`, and sets
`VITE_CAMPO_DEMO=true` for the LiDAR staging build. No paid resources are
added; no existing service's plan changes.

## Rationale

**Why new apps instead of retrofitting the real dashboards.** Forestry's
existing dashboard hard-codes a live-API assumption throughout `api.ts`;
adding a static-data escape hatch there would have meant threading a
demo/real branch through a codebase whose whole reason for existing is to
talk to real PostGIS data, for a demo that must never accidentally reach
that data. A separate, product-owned app with no backend dependency at all
is a stronger guarantee than a flag inside an app that otherwise assumes a
backend — there is no code path in the demo apps capable of making a
same-origin or cross-origin API call to a real Forestry/Transelec backend,
because none is ever imported. Transelec's real backend cannot be hosted
publicly at all on the free tier, so a new app was the only option there
regardless.

**Why LiDAR did not get the same treatment.** Its dashboard was already
Category B under ADR-007 — no DB dependency, safe `[]` fallback already
enforced at the router level — so adding a demo-data branch to the existing
`api.ts` is strictly smaller and lower-risk than standing up a fourth app,
and keeps one dashboard codebase serving both the real RBAC'd flow and the
demo flow behind a single build-time flag.

**Why fabricated data, not a redacted export of real data.** The global
constraint carried over from planning was that Forestry and Transelec
fixtures must invent identifiers, names, and coordinates rather than
anonymize real records — redaction is reversible or incomplete in ways
fabrication is not, and this repository's documentation policy already
treats client-data leakage as a zero-tolerance class of error.

## Two real-data incidents during implementation

This work is worth documenting honestly rather than only as a clean final
state, because real Degenfeld client data was found and removed from this
branch's working tree twice before the branch reached its current state.
Neither incident was ever pushed anywhere; both were caught before review
completed or before any commit reached the branch's final content.

**Incident 1 (porting task).** The planning-phase grep for real data on
`feat/forestry-dashboard-v1` had found `src/test/fixtures.ts` (real predio
code `HT` / name `Hacienda Trinidad`, coordinates near `620000, 5490000`)
and excluded it from the port. During the port itself, the implementer found
that the same real data independently leaked into three more files the
planning grep had missed because it only searched for the exact strings
already known from `fixtures.ts`: `lib/proj.test.ts` (real UTM
estate-envelope coordinate pairs, e.g. `617298.09, 5484858.7`) and
`lib/filters.test.ts` / `lib/mapData.test.ts` (hardcoded real predio names
`Lumaco`/`LUM`, `San Sebastian`, independent of ever importing
`fixtures.ts`). All three were deleted from the working tree and never
committed. A second, independent finding in the same task: `components/
Header.tsx` hardcoded the real client's name in a UI title ("Patrimonio
Degenfeld"), rendered unconditionally; this was also caught and replaced
with a generic string before commit. The plan document itself was corrected
in place to record both findings and to add reconstruction of the three test
files (against synthetic data preserving the same test intent) as new scope
on a later task.

**Incident 2 (integration task).** A later, independent task — integrating
the ported pieces into a working `api.ts`/`App.tsx` — hit a genuine
missing-import failure: five test files could not resolve `src/test/
fixtures.ts`, which Incident 1 had correctly excluded. That task's
implementer, with no visibility into Incident 1's exclusion (the file
containing that prohibition is prose in the plan's Part B introduction, not
mechanically propagated into every task's own brief), restored the file
verbatim from the source branch to unblock the failing imports — reintroducing
the same real predio identity and coordinates a second time, this time as a
committed change. This was caught immediately, before any code review of the
task began, by re-reading the implementer's own report against the plan's
known prohibition. It was fixed forward with a new commit containing a
complete, hand-authored synthetic replacement fixture (same exported shapes,
invented codes replacing the real ones) rather than by rewriting git
history, and re-verified by grep and by re-running all dependent tests.

## Consequences

- Two new Render free static services are added; STAGING cost is unchanged
  at $0/month.
- `/runs` and every other RBAC-protected route are unaffected — none of this
  work touches real backend routes, real databases, or the real Forestry/
  Transelec API surfaces at all.
- When Entra auth eventually lands, `VITE_CAMPO_DEMO` flips off for LiDAR,
  and Forestry/Transelec each get their own future hosted-composition slice
  wired to real data — this ADR's demo apps are not meant to become the
  permanent hosted product surface for either.
- The portal's pre-existing marketing facts in `apps/portal/src/data/
  modules.ts` (e.g. "159 PMF", "1.568 polígonos") describe the real
  platform's evidence-backed scale and are intentionally left unchanged even
  though the demo datasets shown alongside them are much smaller. This is
  flagged here as a judgment call this ADR surfaces, not a business decision
  this ADR resolves.
- The pre-existing Forestry/Transelec `migrations/versions/0003_*`
  revision-id collision (both branches independently declare `revision =
  "0003"`, `down_revision = "0002"`) remains untouched and unresolved by this
  work. This slice deploys neither product's real backend or database
  migrations, so the collision does not surface here — it stays a known,
  separately documented issue for whichever future slice merges both
  products' real backends.
- **Process lesson.** Both real-data incidents above were caught by
  independent review — a second grep pass, a second reader checking a
  report against the plan's own prohibition — not by the original research
  pass or the implementer's own self-check. The planning-phase grep that
  found the first leak still missed three more files carrying the same
  class of data; the implementer who fixed that correctly still (in a later,
  separate task) reintroduced it, unaware the earlier task had ruled it out,
  because the prohibition lived only as prose in one place rather than in
  every task's own instructions. For any future task in this repository
  that ports files out of a branch known to contain real client data,
  real-data safety should never rest on a single grep pass or a single
  implementer's self-check — an independent second pass, and propagating a
  known prohibition into every downstream task's own brief rather than only
  a shared preamble, are both necessary.

## Related

- `ADR-007-hosted-product-composition-v1.md` — the hosted-composition
  pattern and product-hosting classification this ADR extends.
- `ADR-006-restrict-dev-auth-to-development.md` — why STAGING still cannot
  offer real sign-in.
- `../platform/product-boundaries.md` — why Forestry/Transelec business
  semantics require an explicitly scoped synthetic-dataset task rather than
  ad hoc fabrication.
- `docs/DOCUMENTATION_POLICY.md` — the zero-tolerance client-data rule this
  ADR's incident record and process lesson reinforce.
