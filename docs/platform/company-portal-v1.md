# Campo Digital — Company Portal V1

## Status

**FACT** — a local company portal V1 exists at `apps/portal/` and is
implemented (Phase 5 of the [platform roadmap](roadmap.md)).

**FACT** — local module navigation/composition (portal home, per-module
shells, iframe embedding, module switcher, back navigation) is implemented.

**LIMITATION** — this is a local development demo shell. There is no
authentication, no production routing, no deployment, and no multi-tenant
access. See [Production platform V1](production-platform-v1.md) and
[Environments and infrastructure costs](environments-and-costs.md) for what
production would still require.

**OPEN QUESTION** — none of the above is scheduled; Phase 6 (production
deployment) remains unstarted.

## Purpose

Campo Digital is one company platform with three bounded products (LiDAR /
Cubicación, Gestión Predial Forestal, Transelec — see
[product boundaries](product-boundaries.md)). Before this work, there was no
single entry point that made that coherent: each product had its own
standalone dev launcher and its own standalone dashboard.

The company portal is a thin, company-branded shell around the three
existing, independently owned product dashboards. It does not merge their
domain models, their persistence, or their frontends. It only gives them a
shared front door, shared branding, and a shared local demo launcher.

## Architecture decision

- The portal is its own application at `apps/portal/` (React + TypeScript +
  Vite), not inside any single product's folder. This matches
  [`ARCHITECTURE.md`](../../ARCHITECTURE.md): "Product applications must not
  directly import another product application." The portal does not import
  any product's frontend code; it treats each product dashboard as an
  external URL.
- **Local composition strategy: iframe.** Each product dashboard keeps
  running as its own independent Vite dev server (or, later, its own
  deployed origin) on its own port. The portal embeds it inside a thin
  Campo Digital header (`← Campo Digital`, current module name, a compact
  module switcher, "Abrir en pestaña nueva") using an `<iframe>` that fills
  the remaining viewport.
- **This iframe composition is a LOCAL DEMO strategy, not a production
  routing architecture.** It was chosen because it lets three independently
  developed, independently versioned dashboards be demoed from one URL
  without rewriting any of them. Production integration (Phase 6) will need
  a real decision about routing, embedding vs. server-side composition, and
  cross-origin session/auth — none of that is decided here.
- The portal never imports, reads, or renders another product's source code.
  It only knows: a module's id, its display copy/facts, and (at runtime) the
  URL and status a launcher told it about.

## Information architecture

The home screen (`/`) is stakeholder-facing, in Spanish, and shows only
evidence-backed facts:

- Cubicación LiDAR — capability description only (point-cloud inspection,
  geometry/QC, 3D preview); LiDAR does not yet have a stakeholder-safe
  volume/cubicación number to show, and none is invented here.
- Gestión Predial Forestal — 1.568 polígonos de origen, ≈10.422,61 ha
  derivadas de geometría (from the Degenfeld source evidence already
  established elsewhere in the repository).
- Transelec — 159 PMF, 272 identificadores provisionales de predio, 164,63
  ha de superficie de corta (from the Transelec source contract already
  established elsewhere in the repository).

Branch names, commit hashes, PIDs, ports, and stack traces are deliberately
never shown on this screen. `/estado` is a separate, unlinked-from-nav
developer diagnostics view that does show per-module port/URL/ownership —
useful when demoing, not meant for Javier.

Routes:

- `/` — company home, three product panels.
- `/modulo/lidar`, `/modulo/forestal`, `/modulo/transelec` — module shells.
- `/estado` — developer/status diagnostics (ports, URLs, ownership).

## Local demo orchestrator

```
make campo-demo      # start (or adopt) all three products + the portal
make campo-status     # read-only status, refreshes the portal's runtime config
make campo-stop       # stop only what campo-demo itself started
```

`scripts/campo_demo.py` is a composition shell over three independently
owned launchers:

- **LiDAR** — `make lidar-dev` / `make lidar-status` / `make lidar-stop` in
  *this* worktree (`scripts/lidar_dev.py`, new in this change — LiDAR had no
  single-command launcher before). It starts the existing FastAPI app and
  the existing Vite viewer on free ports. It does not ingest anything and
  does not change scientific/measurement behavior. The viewer's own
  readiness is checked against `/health` (dependency-free), not `/ready`
  (which requires PostgreSQL), so the *viewer* never depends on the
  database — but the shared API it starts alongside it now also serves the
  platform ingestion/access routers, so starting it brings up the local
  `postgres` service and applies migrations first (`scripts/_platform_db.py`;
  see [source ingestion](source-ingestion.md) and
  [production platform V1](production-platform-v1.md)).
- **Forestry** — `make forestry-dev` / `-status` / `-stop`, unchanged,
  invoked in the sibling worktree checked out at
  `feat/forestry-dashboard-v1`.
- **Transelec** — `make transelec-dev` / `-status` / `-stop`, unchanged,
  invoked in the sibling worktree checked out at
  `feat/transelec-ui-reference-parity-v1`.

`campo_demo.py` does not reimplement any product's process management. It
only decides *whether* to invoke a product's own launcher, and reads that
launcher's own on-disk process record to check status.

### Worktree discovery

Sibling worktrees are discovered with `git worktree list --porcelain` and
matched by branch name (`scripts/campo_demo.py:parse_worktree_porcelain`,
`find_worktree_for_branch`). No absolute path is hard-coded. Sibling
worktrees are read-only from this script's perspective: it never clones,
resets, merges, or writes into them, beyond invoking their own `make
<product>-dev` / `make <product>-stop` targets exactly as a developer would
by hand.

If a worktree for a required branch is not present locally, the
corresponding module is reported unavailable — nothing is cloned, and the
portal still starts normally with that one module showing "Demo no
iniciada."

### Process ownership

A product is only ever stopped by `make campo-stop` if `campo-demo` itself
started it in the current session:

1. Before starting anything, `campo_demo.py` does a read-only probe of each
   product's own on-disk process state (LiDAR's `.lidar-dev/`, Forestry's
   `.forestry-dev/`, Transelec's temp-dir state file — the same files their
   own launchers already maintain).
2. If a product is already running and responding, it is **adopted**: shown
   as available in the portal, but recorded as *not* owned by this session.
3. Only modules this script actually started are recorded as owned
   (`.campo-demo/state.json`), and only owned modules are stopped by `make
   campo-stop`. The portal's own dev server is always owned (nothing else
   starts it).

This was verified against a real pre-existing Forestry dev server: `make
campo-demo` correctly adopted it without restarting it, and `make
campo-stop` left it running while stopping the LiDAR and Transelec
instances this session had started.

### Runtime config

`campo_demo.py` writes `apps/portal/public/campo-runtime.json` (git-ignored,
machine-specific) with each module's `status` (`available` /
`unavailable`), `url`, and `owned` flag, plus the portal's own port and a
generation timestamp. The portal fetches this at runtime (not build time),
so a browser refresh picks up a fresh launcher run without rebuilding the
portal. Only loopback (`127.0.0.1` / `localhost`) `http(s)` URLs are ever
used as an iframe `src` or an "open in new tab" target
(`apps/portal/src/lib/safeUrl.ts`); a malformed or hand-edited runtime file
degrades to "unavailable" rather than being trusted.

## What remains before production

- Authentication/session entry point (none exists).
- A real decision on production routing/composition — the local iframe
  strategy is explicitly not that decision.
- Deployment, TLS, and a real domain (Phase 6, still unstarted).
- A LiDAR stakeholder-safe cubicación figure, if one is ever established —
  none is shown today, and none should be invented.

## Related documentation

[Platform documentation](README.md) ·
[Platform roadmap](roadmap.md) ·
[Product boundaries](product-boundaries.md) ·
[Production platform V1](production-platform-v1.md)
