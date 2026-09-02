# Hosted Demo Data V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public Render staging portal demonstrable to Javier — 2–3 LiDAR demo measurements, one Forestry demo estate with map/polygon content, one Transelec demo PMF/predio dataset — with zero real client data and zero changes to the RBAC-protected real APIs.

**Architecture:** Extend the existing ADR-007 hosted-composition pattern (portal iframes a per-product static site, closed allowlist in `hostedModuleUrls`/`safeUrl`) to all three products. LiDAR keeps its one existing dashboard codebase and gets a build-time demo-data branch in `api.ts` (`VITE_CAMPO_DEMO=true`) that short-circuits before any `fetch` call, so the real RBAC'd API is never touched. Forestry and Transelec get new, product-owned, demo-only dashboards under `products/forestry/dashboard/` and `products/transelect/dashboard/` (neither exists on `main` today) — ported from the read-only presentational layer already built on `feat/forestry-dashboard-v1` and `feat/transelec-ui-reference-parity-v1`, stripped of admin/upload/draft-editing affordances, wired to hand-authored synthetic fixtures instead of a live backend. No new database, no Alembic migration, no new backend route is introduced for any product. Two new free Render static sites are added; no paid resources.

**Tech Stack:** React 19.2.8 + TypeScript + Vite 8.2.x + Vitest (all four frontend apps); no new Python/backend code; Render Blueprint (`render.yaml`) for the two new static sites.

**Spec:** This plan implements the user's "Build Hosted Demo Data V1 for Campo Digital" request (see conversation) — no separate written spec file exists; the request text is reproduced in full in `docs/adr/ADR-008-hosted-demo-data-v1.md` (Task 20) for durable reference.

## Global Constraints

- Never commit real client data. LiDAR fixtures must not reuse actual local measurement records. Forestry fixtures must invent wholly fictitious predio codes/names/coordinates — **do not** reuse `cod_predial: 'HT'` / `nom_predio: 'Hacienda Trinidad'` or the `620000, 5490000`-area coordinates found in `products/forestry/dashboard/src/test/fixtures.ts` on `feat/forestry-dashboard-v1` (real predio identity + real estate-envelope coordinates — confirmed present on that branch, must not be ported). Transelec fixtures must use fake identifiers, no names/emails, no verbatim spreadsheet rows.
- Do NOT restore anonymous access to `/runs` or any other RBAC-protected route. Do NOT add an auth bypass. The real `apps/api/app/routers/lidar.py` `/runs` route must keep returning 401/403 unauthenticated, unchanged, for the entire plan.
- Do NOT implement or work around Microsoft Entra/OneDrive login in this slice.
- Do NOT create paid Render resources. Stay on `plan: free` for any new service.
- `scripts/check_architecture_boundaries.py` only scans `products/*/src` Python packages (forbids importing `fastapi`, `app`, or another product's `src` package). It does not scan `dashboard/` TypeScript trees, so nothing in this plan trips it directly — still run it, since it is part of `make check`.
- Every demo view must render a visible "DEMO / DATOS DE DEMOSTRACIÓN" label. This is checked in Task 21's browser QA.
- Commit only when a task's steps say to commit. Do not push, open a PR, or deploy — the final task stops short of all three and hands back to the user.

---

## Part A — LiDAR: demo-mode toggle in the existing dashboard

### Task 1: LiDAR demo fixture data + Vitest scaffold

**Files:**
- Create: `products/lidar/dashboard/src/demoData.ts`
- Create: `products/lidar/dashboard/src/demoData.test.ts`
- Create: `products/lidar/dashboard/vitest.config.ts`
- Create: `products/lidar/dashboard/src/test/setup.ts`
- Modify: `products/lidar/dashboard/package.json`

**Interfaces:**
- Consumes: `MeasurementRun`, `VolumeComparisonRecord`, `WarningSeverity`, `MeasurementReadinessStage` types already exported from `products/lidar/dashboard/src/api.ts`.
- Produces: `DEMO_RUNS: MeasurementRun[]` (3 entries, `run_id` values `demo-run-001`/`002`/`003`), `DEMO_COMPARISONS: Record<string, VolumeComparisonRecord[]>` (keyed by `run_id`), both consumed by Task 2.

- [ ] **Step 1: Add Vitest to the LiDAR dashboard (it has none today — only the portal app does)**

Edit `products/lidar/dashboard/package.json`: add a `"test": "vitest run"` script next to the existing `"preview"` script, and add these `devDependencies` (copy exact versions already used by `apps/portal/package.json` so the monorepo doesn't fragment on version): `"vitest"`, `"jsdom"`, `"@testing-library/react"`, `"@testing-library/jest-dom"`, `"@testing-library/user-event"`. Read `apps/portal/package.json` first for the exact pinned versions and mirror them.

- [ ] **Step 2: Create the Vitest config, mirroring the portal's**

Read `apps/portal/vitest.config.ts` and `apps/portal/src/test/setup.ts` first. Create `products/lidar/dashboard/vitest.config.ts` and `products/lidar/dashboard/src/test/setup.ts` with the same shape (jsdom environment, `./src/test/setup.ts` setup file, jest-dom matchers import) — no LiDAR-specific behavior needed here, this is pure scaffolding parity.

- [ ] **Step 3: Write the failing test for the fixture shape**

```ts
// products/lidar/dashboard/src/demoData.test.ts
import { describe, expect, it } from 'vitest'
import { DEMO_COMPARISONS, DEMO_RUNS } from './demoData'

describe('demoData', () => {
  it('provides exactly 3 demo runs with distinct run_ids', () => {
    expect(DEMO_RUNS).toHaveLength(3)
    const ids = DEMO_RUNS.map((run) => run.run_id)
    expect(new Set(ids).size).toBe(3)
  })

  it('marks every run as demo-fixture provenance, never a real source path', () => {
    for (const run of DEMO_RUNS) {
      expect(run.source_path.startsWith('demo/')).toBe(true)
      expect(run.provenance.source).toBe('demo-fixture')
      expect(run.notes).toContain('demostración')
    }
  })

  it('covers three distinct statuses to exercise different dashboard states', () => {
    const statuses = DEMO_RUNS.map((run) => run.status)
    expect(statuses).toEqual(['completed', 'completed', 'failed'])
    expect(DEMO_RUNS[1].readiness?.stage).toBe('physical_face_area')
  })

  it('has a comparison record only for the fully-validated run', () => {
    expect(DEMO_COMPARISONS['demo-run-001']).toHaveLength(1)
    expect(DEMO_COMPARISONS['demo-run-002'] ?? []).toHaveLength(0)
    expect(DEMO_COMPARISONS['demo-run-003'] ?? []).toHaveLength(0)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd products/lidar/dashboard && npm ci && npm test`
Expected: FAIL — `Cannot find module './demoData'`.

- [ ] **Step 5: Write `demoData.ts`**

```ts
// products/lidar/dashboard/src/demoData.ts
//
// Fully synthetic MeasurementRun/VolumeComparisonRecord fixtures for the
// public STAGING demo build (VITE_CAMPO_DEMO=true — see api.ts). Every
// numeric value, path, and identifier here is fabricated for this slice; none
// of it is derived from a real client measurement. See
// docs/adr/ADR-008-hosted-demo-data-v1.md.
import type { MeasurementRun, VolumeComparisonRecord } from './api'

const DEMO_SHA_1 = 'deadbeef'.repeat(8)
const DEMO_SHA_2 = 'c0ffee00'.repeat(8)
const DEMO_SHA_3 = '0bad0bad'.repeat(8)

const RUN_1_COMPLETED: MeasurementRun = {
  schema_version: '1',
  run_id: 'demo-run-001',
  source_path: 'demo/pila-01-madera-nativa.laz',
  source_sha256: DEMO_SHA_1,
  status: 'completed',
  readiness: {
    stage: 'reference_validated',
    pipeline_completed: true,
    observable_geometry_ready: true,
    physical_face_area_ready: true,
    geometric_volume_ready: true,
    reference_validated: true,
    blocker_codes: [],
  },
  started_at: '2026-08-10T14:05:00Z',
  completed_at: '2026-08-10T14:22:30Z',
  code_version: 'demo-fixture-v1',
  coordinate_metadata: {
    crs_wkt: null,
    crs_epsg: 32719,
    crs_source: 'demo-fixture',
    is_explicit: true,
    vertical_datum: null,
    horizontal_units: 'metre',
  },
  timber_stack: {
    localization_mode: 'demo-fixture',
    point_count_input: 482000,
    point_count_selected: 391500,
    selected_fraction: 0.8123,
    detected_components: 1,
    longitudinal_coverage: 0.94,
    vertical_extent_fraction: 0.88,
    transverse_extent_fraction: 0.91,
    parameters: {},
  },
  front_cross_section: {
    longitudinal_span: 8.4,
    median_height: 2.15,
    maximum_height: 2.6,
    rectangle_area: 18.06,
    trapezoid_area: 16.42,
    valid_bin_fraction: 0.97,
    parameters: {},
  },
  projected_face_raster: {
    area_source_units_squared: 16.42,
    cell_size_u: 0.05,
    cell_size_z: 0.05,
    raster_rows: 52,
    raster_cols: 168,
    u_min: 0,
    u_max: 8.4,
    z_min: 0,
    z_max: 2.6,
    projected_point_count: 391500,
    raw_occupied_cell_count: 6584,
    denoised_occupied_cell_count: 6420,
    retained_component_cell_count: 6420,
    filled_cell_count: 6570,
    component_count: 1,
    scanline_disagreement_fraction: 0.012,
    parameters: {},
  },
  front_depth: {
    front_side: 'near',
    cell_size_u: 0.05,
    cell_size_z: 0.05,
    raster_rows: 52,
    raster_cols: 168,
    u_min: 0,
    u_max: 8.4,
    z_min: 0,
    z_max: 2.6,
    projected_point_count: 391500,
    valid_cell_count: 6420,
    surface_scale_u: 1,
    surface_scale_z: 1,
    recession_threshold_source_units: 0.08,
    candidate_count: 3,
    front_depth_runtime_seconds: 1.24,
    recession_runtime_seconds: 0.87,
    regions: [
      {
        rank: 1,
        cell_count: 320,
        area_source_units_squared: 0.8,
        median_recession_source_units: 0.11,
        max_recession_source_units: 0.19,
        recession_score_source_units_cubed: 0.088,
        u_min: 3.1,
        u_max: 3.9,
        z_min: 0.4,
        z_max: 1.1,
        u_centroid: 3.5,
        z_centroid: 0.75,
      },
    ],
    parameters: {},
  },
  face_area_comparison: {
    estimate_method: 'projected_face_raster',
    estimate_value: 16.42,
    estimate_unit: 'square_metres',
    reference: {
      label: 'Medición de referencia (demo)',
      value: 16.0,
      unit: 'square_metres',
      method: 'cinta métrica (demo)',
      source: 'demo-fixture',
      same_pile_confirmed: true,
      notes: 'Valor de referencia sintético.',
    },
    comparison_ready: true,
    blocker_codes: [],
    signed_error: 0.42,
    absolute_error: 0.42,
    relative_error: 0.02625,
    absolute_relative_error: 0.02625,
    percent_error: 2.625,
    absolute_percent_error: 2.625,
  },
  log_detection: { method: 'demo-fixture', candidate_count: 46, parameters: {} },
  results: [
    {
      method: 'convex_hull',
      volume: 34.2,
      volume_unit: 'm3',
      point_count_input: 482000,
      point_count_used: 391500,
      parameters: {},
      warnings: [],
      runtime_seconds: 0.42,
      provenance: { source: 'demo-fixture' },
    },
    {
      method: 'alpha_shape',
      volume: 31.8,
      volume_unit: 'm3',
      point_count_input: 482000,
      point_count_used: 391500,
      parameters: { alpha: 0.15 },
      warnings: [],
      runtime_seconds: 0.91,
      provenance: { source: 'demo-fixture' },
    },
  ],
  reference: {
    label: 'Medición de referencia (demo)',
    value: 32.5,
    unit: 'm3',
    method: 'cubicación manual (demo)',
    recorded_at: '2026-08-10T09:00:00Z',
    notes: 'Valor de referencia sintético para fines de demostración.',
  },
  warnings: [],
  artifacts: [],
  provenance: { source: 'demo-fixture', generated_for: 'hosted-demo-data-v1' },
  notes: 'Registro de demostración (datos sintéticos). No corresponde a un cliente real.',
}

const RUN_2_PARTIAL: MeasurementRun = {
  schema_version: '1',
  run_id: 'demo-run-002',
  source_path: 'demo/pila-02-en-proceso.laz',
  source_sha256: DEMO_SHA_2,
  status: 'completed',
  readiness: {
    stage: 'physical_face_area',
    pipeline_completed: true,
    observable_geometry_ready: true,
    physical_face_area_ready: true,
    geometric_volume_ready: false,
    reference_validated: false,
    blocker_codes: ['insufficient_point_density'],
  },
  started_at: '2026-08-14T09:12:00Z',
  completed_at: '2026-08-14T09:19:45Z',
  code_version: 'demo-fixture-v1',
  coordinate_metadata: {
    crs_wkt: null,
    crs_epsg: 32719,
    crs_source: 'demo-fixture',
    is_explicit: true,
    vertical_datum: null,
    horizontal_units: 'metre',
  },
  timber_stack: {
    localization_mode: 'demo-fixture',
    point_count_input: 210500,
    point_count_selected: 152300,
    selected_fraction: 0.7235,
    detected_components: 2,
    longitudinal_coverage: 0.81,
    vertical_extent_fraction: 0.76,
    transverse_extent_fraction: 0.79,
    parameters: {},
  },
  front_cross_section: {
    longitudinal_span: 6.1,
    median_height: 1.85,
    maximum_height: 2.2,
    rectangle_area: 11.29,
    trapezoid_area: 10.05,
    valid_bin_fraction: 0.89,
    parameters: {},
  },
  projected_face_raster: {
    area_source_units_squared: 10.05,
    cell_size_u: 0.05,
    cell_size_z: 0.05,
    raster_rows: 44,
    raster_cols: 122,
    u_min: 0,
    u_max: 6.1,
    z_min: 0,
    z_max: 2.2,
    projected_point_count: 152300,
    raw_occupied_cell_count: 4310,
    denoised_occupied_cell_count: 4102,
    retained_component_cell_count: 3890,
    filled_cell_count: 4050,
    component_count: 2,
    scanline_disagreement_fraction: 0.031,
    parameters: {},
  },
  front_depth: null,
  face_area_comparison: null,
  log_detection: null,
  results: [],
  reference: null,
  warnings: [
    {
      code: 'insufficient_point_density',
      severity: 'blocker',
      message:
        'Densidad de puntos insuficiente para estimar el volumen geométrico de forma confiable.',
    },
    {
      code: 'partial_occlusion',
      severity: 'warning',
      message: 'Posible oclusión parcial en el extremo derecho de la pila.',
    },
  ],
  artifacts: [],
  provenance: { source: 'demo-fixture', generated_for: 'hosted-demo-data-v1' },
  notes:
    'Registro de demostración (datos sintéticos). Etapa intermedia: bloqueado antes del volumen geométrico.',
}

const RUN_3_FAILED: MeasurementRun = {
  schema_version: '1',
  run_id: 'demo-run-003',
  source_path: 'demo/pila-03-fallida.laz',
  source_sha256: DEMO_SHA_3,
  status: 'failed',
  readiness: {
    stage: 'not_ready',
    pipeline_completed: false,
    observable_geometry_ready: false,
    physical_face_area_ready: false,
    geometric_volume_ready: false,
    reference_validated: false,
    blocker_codes: ['localization_failed'],
  },
  started_at: '2026-08-18T11:00:00Z',
  completed_at: '2026-08-18T11:02:10Z',
  code_version: 'demo-fixture-v1',
  coordinate_metadata: null,
  timber_stack: null,
  front_cross_section: null,
  projected_face_raster: null,
  front_depth: null,
  face_area_comparison: null,
  log_detection: null,
  results: [],
  reference: null,
  warnings: [
    {
      code: 'localization_failed',
      severity: 'blocker',
      message: 'No fue posible localizar automáticamente la pila de madera en la nube de puntos.',
    },
  ],
  artifacts: [],
  provenance: { source: 'demo-fixture', generated_for: 'hosted-demo-data-v1' },
  notes:
    'Registro de demostración (datos sintéticos). Ejecución fallida: localización automática no logró converger.',
}

export const DEMO_RUNS: MeasurementRun[] = [RUN_1_COMPLETED, RUN_2_PARTIAL, RUN_3_FAILED]

export const DEMO_COMPARISONS: Record<string, VolumeComparisonRecord[]> = {
  'demo-run-001': [
    {
      schema_version: '1',
      comparison_id: 'demo-comparison-001',
      run_id: 'demo-run-001',
      estimate_result_index: 0,
      comparison: {
        estimate_method: 'convex_hull',
        estimate_value: 34.2,
        reference: RUN_1_COMPLETED.reference!,
        unit: 'm3',
        signed_error: 1.7,
        absolute_error: 1.7,
        relative_error: 0.0523,
        absolute_relative_error: 0.0523,
        percent_error: 5.23,
        absolute_percent_error: 5.23,
      },
      created_at: '2026-08-10T14:22:31Z',
    },
  ],
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd products/lidar/dashboard && npm test`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add products/lidar/dashboard/package.json products/lidar/dashboard/vitest.config.ts \
  products/lidar/dashboard/src/test/setup.ts products/lidar/dashboard/src/demoData.ts \
  products/lidar/dashboard/src/demoData.test.ts products/lidar/dashboard/package-lock.json
git commit -m "feat(lidar-dashboard): add synthetic demo fixture data"
```

---

### Task 2: Demo-mode branch in `api.ts`

**Files:**
- Modify: `products/lidar/dashboard/src/api.ts`
- Create: `products/lidar/dashboard/src/api.test.ts`

**Interfaces:**
- Consumes: `DEMO_RUNS`, `DEMO_COMPARISONS` from Task 1's `./demoData`.
- Produces: `listRuns`, `getRun`, `listComparisons` keep their existing exported signatures (`Promise<MeasurementRun[]>`, `Promise<MeasurementRun>`, `Promise<VolumeComparisonRecord[]>`) — App.tsx (Task 3) needs no changes to its call sites.

- [ ] **Step 1: Write the failing test — demo mode must never call `fetch`**

```ts
// products/lidar/dashboard/src/api.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('api.ts demo mode', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.stubEnv('VITE_CAMPO_DEMO', 'true')
    global.fetch = vi.fn(() => {
      throw new Error('demo mode must never call fetch')
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    global.fetch = originalFetch
  })

  it('listRuns() resolves the 3 bundled demo runs without fetching', async () => {
    const { listRuns } = await import('./api')
    const runs = await listRuns()
    expect(runs).toHaveLength(3)
  })

  it('getRun() resolves a single bundled run by id without fetching', async () => {
    const { getRun } = await import('./api')
    const run = await getRun('demo-run-001')
    expect(run.run_id).toBe('demo-run-001')
  })

  it('getRun() rejects for an unknown id without fetching', async () => {
    const { getRun } = await import('./api')
    await expect(getRun('does-not-exist')).rejects.toThrow()
  })

  it('listComparisons() resolves [] for a run with no bundled comparison', async () => {
    const { listComparisons } = await import('./api')
    expect(await listComparisons('demo-run-003')).toEqual([])
  })
})
```

Note: `vi.stubEnv` + dynamic `import('./api')` inside each test is required because `import.meta.env.VITE_CAMPO_DEMO` is read at module load time — `vi.resetModules()` in `afterEach` forces a fresh evaluation per test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/lidar/dashboard && npm test`
Expected: FAIL — real `listRuns()` still calls `fetch`, which throws.

- [ ] **Step 3: Add the demo branch to `api.ts`**

At the top of `products/lidar/dashboard/src/api.ts`, after the existing type definitions and before `async function getJson`, add:

```ts
import { DEMO_COMPARISONS, DEMO_RUNS } from './demoData'

const DEMO_MODE = import.meta.env.VITE_CAMPO_DEMO === 'true'
```

Replace the three exported functions:

```ts
export function listRuns(): Promise<MeasurementRun[]> {
  if (DEMO_MODE) {
    return Promise.resolve(DEMO_RUNS)
  }
  return getJson<MeasurementRun[]>('/runs')
}

export function getRun(runId: string): Promise<MeasurementRun> {
  if (DEMO_MODE) {
    const run = DEMO_RUNS.find((candidate) => candidate.run_id === runId)
    if (!run) {
      return Promise.reject(new Error(`demo run not found: ${runId}`))
    }
    return Promise.resolve(run)
  }
  return getJson<MeasurementRun>(`/runs/${encodeURIComponent(runId)}`)
}

export function listComparisons(runId: string): Promise<VolumeComparisonRecord[]> {
  if (DEMO_MODE) {
    return Promise.resolve(DEMO_COMPARISONS[runId] ?? [])
  }
  return getJson<VolumeComparisonRecord[]>(`/runs/${encodeURIComponent(runId)}/comparisons`)
}

export function isDemoMode(): boolean {
  return DEMO_MODE
}
```

Leave `artifactUrl` unchanged — demo runs carry `artifacts: []`, so it is never invoked in demo mode; there is no artifact binary to serve without a backend, which is an explicit scope decision (see ADR-008).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd products/lidar/dashboard && npm test`
Expected: PASS (all `api.test.ts` + `demoData.test.ts` tests).

- [ ] **Step 5: Commit**

```bash
git add products/lidar/dashboard/src/api.ts products/lidar/dashboard/src/api.test.ts
git commit -m "feat(lidar-dashboard): gate real API calls behind VITE_CAMPO_DEMO"
```

---

### Task 3: Demo banner in the LiDAR dashboard UI

**Files:**
- Modify: `products/lidar/dashboard/src/App.tsx`
- Modify: `products/lidar/dashboard/src/App.css`
- Create: `products/lidar/dashboard/src/App.test.tsx`

**Interfaces:**
- Consumes: `isDemoMode()` from Task 2's `./api`.
- Produces: nothing new consumed elsewhere — this is the leaf UI change.

- [ ] **Step 1: Write the failing test**

```tsx
// products/lidar/dashboard/src/App.test.tsx
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('App demo banner', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CAMPO_DEMO', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('renders a DEMO banner when VITE_CAMPO_DEMO=true', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    expect(await screen.findByText(/DATOS DE DEMOSTRACIÓN/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/lidar/dashboard && npm test`
Expected: FAIL — no such text rendered yet.

- [ ] **Step 3: Add the banner**

In `products/lidar/dashboard/src/App.tsx`, import `isDemoMode` from `./api` (it's already importing other names from `./api`, add to that import list), then in the top-level returned JSX of the `App` component (immediately inside the outermost wrapping element, before existing content), add:

```tsx
{isDemoMode() ? (
  <div className="demo-banner" role="status">
    DEMO — DATOS DE DEMOSTRACIÓN. Los registros mostrados son sintéticos y no corresponden a
    ningún cliente real.
  </div>
) : null}
```

In `products/lidar/dashboard/src/App.css`, add:

```css
.demo-banner {
  background: #7a1f1f;
  color: #fff;
  font-weight: 700;
  text-align: center;
  padding: 0.5rem 1rem;
  letter-spacing: 0.02em;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd products/lidar/dashboard && npm test`
Expected: PASS.

- [ ] **Step 5: Run the full build to catch any type errors**

Run: `cd products/lidar/dashboard && npm run build`
Expected: builds cleanly (`tsc -b && vite build`).

- [ ] **Step 6: Commit**

```bash
git add products/lidar/dashboard/src/App.tsx products/lidar/dashboard/src/App.css \
  products/lidar/dashboard/src/App.test.tsx
git commit -m "feat(lidar-dashboard): show a DEMO banner in demo mode"
```

---

## Part B — Forestry: new demo-only dashboard

Ported from `feat/forestry-dashboard-v1` (worktree: `/home/rafael/dev/freelance/campo-digital-forestry-dashboard-v1`). That branch's own "synthetic" test fixture (`src/test/fixtures.ts`, `cod_predial: 'HT'`, `nom_predio: 'Hacienda Trinidad'`, coordinates near `620000, 5490000`) is **not safe to reuse** — it embeds the real Degenfeld predio identity and estate-envelope location. Do not copy that file. Everything else ported below (types, non-draft `lib/`, non-`MapView` components) is pure logic/presentation with no embedded client data — confirmed by grep during planning.

### Task 4: Scaffold the Forestry dashboard project

**Files:**
- Create: `products/forestry/dashboard/package.json`
- Create: `products/forestry/dashboard/vite.config.ts`
- Create: `products/forestry/dashboard/vitest.config.ts`
- Create: `products/forestry/dashboard/tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- Create: `products/forestry/dashboard/.oxlintrc.json`
- Create: `products/forestry/dashboard/index.html`
- Create: `products/forestry/dashboard/src/main.tsx`
- Create: `products/forestry/dashboard/src/styles.css`
- Create: `products/forestry/dashboard/src/test/setup.ts`

**Interfaces:**
- Produces: a buildable, empty-shell Vite React app at `products/forestry/dashboard` that later tasks fill in. `npm run build` and `npm test` must both succeed after this task even with a placeholder `App.tsx`.

- [ ] **Step 1: Copy the generic scaffold files verbatim from the source branch**

None of these files contain client data — they are build tooling only. Run from the repo root:

```bash
BRANCH=feat/forestry-dashboard-v1
for f in package.json vite.config.ts vitest.config.ts tsconfig.json tsconfig.app.json \
         tsconfig.node.json .oxlintrc.json index.html src/main.tsx src/styles.css \
         src/test/setup.ts; do
  mkdir -p "products/forestry/dashboard/$(dirname "$f")"
  git show "$BRANCH:products/forestry/dashboard/$f" > "products/forestry/dashboard/$f"
done
```

- [ ] **Step 2: Trim `package.json` dependencies to what the demo actually needs**

Read the copied `products/forestry/dashboard/package.json`. Keep `react`, `react-dom`, `leaflet`, `@types/leaflet`, and the standard Vite/TS/vitest/testing-library/oxlint devDependencies (mirror versions from `apps/portal/package.json` and `products/lidar/dashboard/package.json` for anything shared, to avoid a third version of the same tool). Remove any dependency that only the draft-editing tools or shapefile-ingestion tooling would need (there should be none — this app has no upload feature). Add `"test": "vitest run"` to `scripts` if the copied file doesn't already have it.

- [ ] **Step 3: Write a placeholder `App.tsx` so the app builds**

```tsx
// products/forestry/dashboard/src/App.tsx (placeholder — Task 8 replaces this)
export default function App() {
  return <div>Forestry demo — under construction</div>
}
```

- [ ] **Step 4: Verify the shell builds and tests run**

Run: `cd products/forestry/dashboard && npm install && npm run build && npm test`
Expected: build succeeds; `npm test` passes (0 or trivial tests — no test files exist yet).

- [ ] **Step 5: Commit**

```bash
git add products/forestry/dashboard
git commit -m "chore(forestry-dashboard): scaffold new demo-only Vite app"
```

---

### Task 5: Port Forestry types, non-draft `lib/` utilities, and non-`MapView` components

**Files:**
- Create: `products/forestry/dashboard/src/types.ts`
- Create: `products/forestry/dashboard/src/lib/{proj,palette,filters,aggregate,format,tableSort,qualityLabels,mapData,comparison,csv}.ts` and their `*.test.ts` files
- Create: `products/forestry/dashboard/src/components/{Header,KpiStrip,FiltersPanel,LegendPanel,DataPanel,Inspector,ActiveFilterBar,StatusViews,QualityPanel,ComparisonPanel,FeatureTable}.tsx` and `FeatureTable.test.tsx`
- Create: `products/forestry/dashboard/src/App.tsx` (App.test.tsx is on `feat/forestry-dashboard-v1` too but drives against the live API — do not copy it verbatim; Task 8 writes a demo-appropriate replacement)

**Interfaces:**
- Produces: the exact same exported types/functions/components as the source branch (no renames), so `App.tsx` (Task 8) and the new `MapView.tsx` (Task 7) can import them unchanged.

- [ ] **Step 1: Copy everything except `MapView.tsx`, `draftGeometry.ts`, `draftHistory.ts`, `draft.css`, `workspace.css`, and the two API/fixture files**

```bash
BRANCH=feat/forestry-dashboard-v1
mkdir -p products/forestry/dashboard/src/lib products/forestry/dashboard/src/components

git show "$BRANCH:products/forestry/dashboard/src/types.ts" \
  > products/forestry/dashboard/src/types.ts

for f in proj palette filters aggregate format tableSort qualityLabels mapData comparison csv; do
  git show "$BRANCH:products/forestry/dashboard/src/lib/$f.ts" \
    > "products/forestry/dashboard/src/lib/$f.ts"
  # Not every lib file has a paired test — check before failing the loop.
  git show "$BRANCH:products/forestry/dashboard/src/lib/$f.test.ts" \
    > "products/forestry/dashboard/src/lib/$f.test.ts" 2>/dev/null || true
done

for c in Header KpiStrip FiltersPanel LegendPanel DataPanel Inspector ActiveFilterBar \
         StatusViews QualityPanel ComparisonPanel FeatureTable; do
  git show "$BRANCH:products/forestry/dashboard/src/components/$c.tsx" \
    > "products/forestry/dashboard/src/components/$c.tsx"
done
git show "$BRANCH:products/forestry/dashboard/src/components/FeatureTable.test.tsx" \
  > products/forestry/dashboard/src/components/FeatureTable.test.tsx
```

- [ ] **Step 2: Check for any accidental empty files (a `git show` on a path that doesn't exist on that branch writes an empty file, not an error, when redirected)**

Run: `find products/forestry/dashboard/src -size 0 -type f`
Expected: no output. If any file is empty, re-check its exact path on the source branch (`git show feat/forestry-dashboard-v1:products/forestry/dashboard/src/... | head`) and fix the copy command.

- [ ] **Step 3: Run the type checker to find what's still missing**

Run: `cd products/forestry/dashboard && npx tsc -b --noEmit`
Expected: FAILS at this point — `App.tsx` (still the Task 4 placeholder) doesn't use these new modules, and `MapView.tsx` doesn't exist yet, so anything importing it (only `App.tsx` will, once Task 8 rewrites it) isn't a problem yet. The failures you should see now are only inside the newly copied files themselves (e.g. a stray import of `draftGeometry`/`draftHistory` from a file this step didn't expect to reference them). Fix any such reference by removing it — none of the files copied in this task should import from the draft modules; if one does, that's a sign it was miscategorized and belongs in Task 7 instead.

- [ ] **Step 4: Commit**

```bash
git add products/forestry/dashboard/src/types.ts products/forestry/dashboard/src/lib \
  products/forestry/dashboard/src/components
git commit -m "feat(forestry-dashboard): port read-only types, utils, and presentational components"
```

---

### Task 6: Author the Forestry demo fixture (synthetic estate, 6 predios)

**Files:**
- Create: `products/forestry/dashboard/src/demoData.ts`
- Create: `products/forestry/dashboard/src/demoData.test.ts`

**Interfaces:**
- Consumes: `ForestrySnapshot`, `SnapshotSummary`, `FeatureCollection`, `GeoFeature`, `SourceFieldComparison`, `SourceFeatureDetail` from Task 5's `./types`.
- Produces: `DEMO_SNAPSHOT: ForestrySnapshot`, `DEMO_SUMMARY: SnapshotSummary`, `DEMO_COLLECTION: FeatureCollection`, `DEMO_COMPARISON: SourceFieldComparison`, `demoFeatureDetail(ordinal: number): SourceFeatureDetail | null` — consumed by Task 8's `api.ts`.

**Design notes (do not deviate without re-deriving from these numbers):** 6 wholly fictitious predios arranged as simple rectangles (one L-shaped) in a **synthetic local coordinate system, not a real-world CRS** — `storage_srid: 0` is a deliberate sentinel meaning "not georeferenced to any real place," chosen specifically so these coordinates can never be mistaken for (or reprojected into) the real Degenfeld estate's UTM envelope. `lib/mapData.ts`'s `multiPolygonToLatLngs` calls `utmToLonLat`, which assumes EPSG:32718/32719 semantics — reprojecting SRID-0 coordinates through it still produces *some* lon/lat, so the map will render tiles at a location derived from these numbers; that is fine (it's synthetic data, clearly labeled DEMO), but pick coordinates that do **not** numerically coincide with the real branch's `620000, 5490000` (southern Chile) — this fixture uses a small `0–1300, 0–650` local grid, which lands nowhere near that envelope once projected.

- [ ] **Step 1: Write the failing test**

```ts
// products/forestry/dashboard/src/demoData.test.ts
import { describe, expect, it } from 'vitest'
import { DEMO_COLLECTION, DEMO_COMPARISON, DEMO_SNAPSHOT, DEMO_SUMMARY, demoFeatureDetail } from './demoData'

describe('Forestry demoData', () => {
  it('has 6 wholly fictitious predios, none named Hacienda Trinidad or coded HT', () => {
    expect(DEMO_COLLECTION.features).toHaveLength(6)
    for (const feature of DEMO_COLLECTION.features) {
      expect(feature.properties.cod_predial).not.toBe('HT')
      expect(feature.properties.nom_predio).not.toMatch(/Trinidad/i)
      expect(feature.properties.cod_predial).toMatch(/^DEMO-/)
    }
  })

  it('summary aggregates match the feature collection', () => {
    expect(DEMO_SUMMARY.feature_count).toBe(6)
    expect(DEMO_SUMMARY.geometry_invalid_count).toBe(1)
    expect(DEMO_SUMMARY.storage_srid).toBe(0)
  })

  it('demoFeatureDetail resolves a known ordinal and rejects an unknown one', () => {
    expect(demoFeatureDetail(0)?.cod_predial).toBe('DEMO-01')
    expect(demoFeatureDetail(999)).toBeNull()
  })

  it('the source-field comparison shows at least one 2024->2026 use-code change', () => {
    expect(DEMO_COMPARISON.uso_2024_vs_uso_2026.changed_feature_count).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/forestry/dashboard && npm test`
Expected: FAIL — `./demoData` doesn't exist.

- [ ] **Step 3: Write `demoData.ts`**

```ts
// products/forestry/dashboard/src/demoData.ts
//
// Fully synthetic demo estate: 6 fictitious predios in a local, non-georeferenced
// coordinate grid (storage_srid: 0 — deliberately not a real CRS). No name, code,
// or coordinate here corresponds to any real Campo Digital client. See
// docs/adr/ADR-008-hosted-demo-data-v1.md.
import type {
  FeatureCollection,
  ForestrySnapshot,
  GeoFeature,
  SnapshotSummary,
  SourceFeatureDetail,
  SourceFieldComparison,
} from './types'

function rectangle(x0: number, y0: number, x1: number, y1: number): number[][][][] {
  return [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]]
}

// P5 is an L-shape: a 400x300 block with a 150x150 notch removed from its
// top-right corner (both rings share the multipolygon's single polygon here
// as one non-rectangular ring rather than two rings, since it's a single
// simple concave polygon, not a polygon-with-hole).
const P5_L_SHAPE: number[][][][] = [
  [
    [
      [350, 350],
      [750, 350],
      [750, 500],
      [600, 500],
      [600, 650],
      [350, 650],
      [350, 350],
    ],
  ],
]

interface DemoFeatureSpec {
  ordinal: number
  objectId: number
  codPredial: string
  nomPredio: string
  nRodal: string
  codUso: string
  uso2024: string
  descUso: string
  uso2026: string
  codUso2026: string
  coordinates: number[][][][]
  geometryValid: boolean
  qualityFlags: string[]
}

const USE_LABELS: Record<string, string> = {
  BN: 'Bosque nativo',
  PL: 'Plantación forestal',
  AG: 'Uso agrícola',
}

const SPECS: DemoFeatureSpec[] = [
  {
    ordinal: 0,
    objectId: 1001,
    codPredial: 'DEMO-01',
    nomPredio: 'Predio Los Aromos',
    nRodal: 'R1',
    codUso: 'BN',
    uso2024: 'BN',
    descUso: USE_LABELS.BN,
    uso2026: 'BN',
    codUso2026: 'BN',
    coordinates: rectangle(0, 0, 400, 300),
    geometryValid: true,
    qualityFlags: [],
  },
  {
    ordinal: 1,
    objectId: 1002,
    codPredial: 'DEMO-02',
    nomPredio: 'Predio El Sauce',
    nRodal: 'R1',
    codUso: 'PL',
    uso2024: 'PL',
    descUso: USE_LABELS.PL,
    uso2026: 'PL',
    codUso2026: 'PL',
    coordinates: rectangle(450, 0, 800, 300),
    geometryValid: true,
    qualityFlags: [],
  },
  {
    ordinal: 2,
    objectId: 1003,
    codPredial: 'DEMO-03',
    nomPredio: 'Predio Vista Hermosa',
    nRodal: 'R1',
    codUso: 'BN',
    uso2024: 'BN',
    descUso: USE_LABELS.PL,
    uso2026: 'PL',
    codUso2026: 'PL',
    coordinates: rectangle(850, 0, 1300, 250),
    geometryValid: true,
    qualityFlags: [],
  },
  {
    ordinal: 3,
    objectId: 1004,
    codPredial: 'DEMO-04',
    nomPredio: 'Predio Las Rosas',
    nRodal: 'R1',
    codUso: 'PL',
    uso2024: 'PL',
    descUso: USE_LABELS.PL,
    uso2026: 'PL',
    codUso2026: 'PL',
    coordinates: rectangle(0, 350, 300, 650),
    geometryValid: true,
    qualityFlags: [],
  },
  {
    ordinal: 4,
    objectId: 1005,
    codPredial: 'DEMO-05',
    nomPredio: 'Predio Alto Verde',
    nRodal: 'R2',
    codUso: 'AG',
    uso2024: 'AG',
    descUso: USE_LABELS.AG,
    uso2026: 'AG',
    codUso2026: 'AG',
    coordinates: P5_L_SHAPE,
    geometryValid: true,
    qualityFlags: [],
  },
  {
    ordinal: 5,
    objectId: 1006,
    codPredial: 'DEMO-06',
    nomPredio: 'Predio Rio Claro',
    nRodal: 'R1',
    codUso: 'BN',
    uso2024: 'BN',
    descUso: USE_LABELS.BN,
    uso2026: 'BN',
    codUso2026: 'BN',
    coordinates: rectangle(800, 300, 1300, 650),
    geometryValid: false,
    qualityFlags: ['duplicate_predio_rodal_key'],
  },
]

function shoelaceArea(ring: number[][]): number {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

function featureArea(spec: DemoFeatureSpec): number {
  return spec.coordinates[0].reduce((total, ring) => total + shoelaceArea(ring), 0)
}

function toFeature(spec: DemoFeatureSpec): GeoFeature {
  const areaSquareUnits = featureArea(spec)
  return {
    type: 'Feature',
    properties: {
      feature_ordinal: spec.ordinal,
      source_objectid: spec.objectId,
      cod_predial: spec.codPredial,
      nom_predio: spec.nomPredio,
      n_rodal: spec.nRodal,
      cod_uso: spec.codUso,
      uso_2024: spec.uso2024,
      desc_uso: spec.descUso,
      uso_2026: spec.uso2026,
      cod_uso_2026: spec.codUso2026,
      sup_ha: areaSquareUnits / 10000,
      geometry_is_valid: spec.geometryValid,
      geometry_area_source_units: areaSquareUnits,
      quality_flags: spec.qualityFlags,
    },
    geometry: { type: 'MultiPolygon', coordinates: spec.coordinates },
  }
}

const FEATURES: GeoFeature[] = SPECS.map(toFeature)

export const DEMO_SNAPSHOT: ForestrySnapshot = {
  shapefile_snapshot_id: 1,
  layer_name: 'predios_demo',
  family_fingerprint: 'demo-fixture-v1',
  storage_srid: 0,
  feature_count: FEATURES.length,
  created_at: '2026-08-15T00:00:00Z',
}

const totalArea = FEATURES.reduce((sum, f) => sum + f.properties.geometry_area_source_units, 0)
const invalidCount = FEATURES.filter((f) => !f.properties.geometry_is_valid).length

export const DEMO_SUMMARY: SnapshotSummary = {
  shapefile_snapshot_id: DEMO_SNAPSHOT.shapefile_snapshot_id,
  layer_name: DEMO_SNAPSHOT.layer_name,
  family_fingerprint: DEMO_SNAPSHOT.family_fingerprint,
  storage_srid: DEMO_SNAPSHOT.storage_srid,
  bbox: [0, 0, 1300, 650],
  feature_count: FEATURES.length,
  total_geometry_area_source_units: totalArea,
  total_sup_ha: totalArea / 10000,
  geometry_valid_count: FEATURES.length - invalidCount,
  geometry_invalid_count: invalidCount,
  quality_flag_counts: { duplicate_predio_rodal_key: 1 },
  n_rodal_te_non_blank_count: FEATURES.length,
  created_at: DEMO_SNAPSHOT.created_at,
}

export const DEMO_COLLECTION: FeatureCollection = {
  type: 'FeatureCollection',
  shapefile_snapshot_id: DEMO_SNAPSHOT.shapefile_snapshot_id,
  storage_srid: DEMO_SNAPSHOT.storage_srid,
  feature_count: FEATURES.length,
  features: FEATURES,
}

export const DEMO_COMPARISON: SourceFieldComparison = {
  shapefile_snapshot_id: DEMO_SNAPSHOT.shapefile_snapshot_id,
  semantics: 'Comparación sintética de demostración entre uso 2024 y uso 2026.',
  uso_2024_vs_uso_2026: {
    changed_feature_count: 1,
    changes: [
      { feature_ordinal: 2, source_objectid: 1003, before: 'BN', after: 'PL' },
    ],
  },
  cod_uso_vs_cod_uso_2026: {
    changed_feature_count: 1,
    changes: [
      { feature_ordinal: 2, source_objectid: 1003, before: 'BN', after: 'PL' },
    ],
  },
}

export function demoFeatureDetail(featureOrdinal: number): SourceFeatureDetail | null {
  const feature = FEATURES.find((f) => f.properties.feature_ordinal === featureOrdinal)
  if (!feature) return null

  return {
    ...feature.properties,
    shapefile_snapshot_id: DEMO_SNAPSHOT.shapefile_snapshot_id,
    storage_srid: DEMO_SNAPSHOT.storage_srid,
    shape_area: feature.properties.geometry_area_source_units,
    geometry_invalid_reason: feature.properties.geometry_is_valid
      ? null
      : 'Geometría de demostración marcada inválida para exhibir el panel de calidad.',
    source_attributes: {},
    geometry: feature.geometry,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd products/forestry/dashboard && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add products/forestry/dashboard/src/demoData.ts products/forestry/dashboard/src/demoData.test.ts
git commit -m "feat(forestry-dashboard): author synthetic 6-predio demo estate"
```

---

### Task 7: Port `MapView.tsx`, stripped of draft/cut editing

**Files:**
- Create: `products/forestry/dashboard/src/components/MapView.tsx`

**Interfaces:**
- Consumes: `ColorEncoding` from `./lib/palette` (Task 5), `FeatureCollection`/`GeoFeature` from `./types` (Task 5), `metersPerPixel`/`multiPolygonToLatLngs`/`tooltipHtml` from `./lib/mapData` (Task 5), `multiPolygonUtmBbox`/`lonLatToUtm`/`utmToLonLat` from `./lib/proj` (Task 5), `ZoomRequest` from `./App` (Task 8).
- Produces: `MapView` component with the **identical prop interface** already used by `App.tsx`'s call site (see below) — this is what lets Task 8's `App.tsx` be a near-verbatim port of the source branch's `App.tsx` instead of a rewrite.

```ts
interface MapViewProps {
  collection: FeatureCollection
  filteredFeatures: GeoFeature[]
  encoding: ColorEncoding | null
  selectedOrdinal: number | null
  onSelect: (featureOrdinal: number | null) => void
  zoomRequest: ZoomRequest | null
  fitNonce: number
  onFitToResults: () => void
  sidebarCollapsed: boolean
  mapFocus: boolean
  activeFilterCount: number
  onToggleSidebar: () => void
  onToggleMapFocus: () => void
}
```

- [ ] **Step 1: Copy the source file as a starting point (not the final artifact)**

```bash
git show feat/forestry-dashboard-v1:products/forestry/dashboard/src/components/MapView.tsx \
  > products/forestry/dashboard/src/components/MapView.tsx
```

- [ ] **Step 2: Remove every draft/cut-editing concern**

Open the copied file and delete:
- The imports from `../lib/draftGeometry.ts` and `../lib/draftHistory.ts` (the full `import { ... } from '../lib/draftGeometry.ts'` and `import { ... } from '../lib/draftHistory.ts'` blocks).
- The `DraftMode` type alias and the `CutPreview` interface.
- Every `useState`/`useRef`/`useMemo`/`useCallback` whose value depends on draft mode, draft history, or cut previews (search for identifiers matching `draft`, `Draft`, `cut`, `Cut` case-insensitively and trace each to its full declaration).
- Every JSX element that toggles or displays edit/cut/move mode (buttons like "Editar geometría", "Cortar", "Mover vértice", undo/redo controls tied to `draftHistory`).
- Any Leaflet event handler (`on('click')`, `on('dragend')`, etc.) that exists only to support vertex dragging or cutting — keep handlers that exist for feature *selection* (click-to-select) and *zoom-to-feature*.

Keep: the Leaflet map initialization, the OSM/satellite/none basemap toggle (`BasemapMode`, `OSM_TILE_URL`, `SATELLITE_TILE_URL`), rendering each feature as a `L.polygon` colored via `encoding` (from `palette.ts`), the tooltip via `tooltipHtml`, click-to-select wiring `onSelect`, the `zoomRequest`/`fitNonce`/`onFitToResults` zoom behavior, and the `sidebarCollapsed`/`mapFocus`/`onToggleSidebar`/`onToggleMapFocus` layout-toggle buttons.

- [ ] **Step 3: Type-check to find dangling references**

Run: `cd products/forestry/dashboard && npx tsc -b --noEmit`
Expected: FAILS the first time — fix each error by removing the now-dead code path it points at (a leftover reference to a deleted draft variable/handler/JSX prop). Repeat until clean.

- [ ] **Step 4: Confirm no draft/cut vocabulary remains**

Run: `grep -in "draft\|straightCut\|pickHandle" products/forestry/dashboard/src/components/MapView.tsx`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add products/forestry/dashboard/src/components/MapView.tsx
git commit -m "feat(forestry-dashboard): port read-only satellite MapView, drop draft/cut editing"
```

---

### Task 8: Forestry `api.ts` (demo-backed) + `App.tsx` + demo banner

**Files:**
- Create: `products/forestry/dashboard/src/api.ts`
- Modify: `products/forestry/dashboard/src/App.tsx` (replace Task 4's placeholder)
- Modify: `products/forestry/dashboard/src/App.css` or `styles.css` (whichever the copied scaffold uses for global layout — check Task 4's copy)
- Create: `products/forestry/dashboard/src/App.test.tsx`

**Interfaces:**
- Consumes: `DEMO_SNAPSHOT`, `DEMO_SUMMARY`, `DEMO_COLLECTION`, `DEMO_COMPARISON`, `demoFeatureDetail` from Task 6.
- Produces: `fetchLatestIngestedSnapshot`, `fetchSnapshotSummary`, `fetchFeatureCollection`, `fetchComparison`, `fetchFeatureDetail` — same names/signatures as the source branch's `api.ts`, so component prop-drilling stays identical.

- [ ] **Step 1: Write `api.ts` as a demo-only implementation**

```ts
// products/forestry/dashboard/src/api.ts
//
// Demo-only data layer: no live backend exists for this app (unlike LiDAR,
// there is no RBAC'd real Forestry API being guarded against — this app IS
// the demo). Every function below resolves the bundled synthetic fixture
// from ./demoData. See docs/adr/ADR-008-hosted-demo-data-v1.md.
import {
  DEMO_COLLECTION,
  DEMO_COMPARISON,
  DEMO_SNAPSHOT,
  DEMO_SUMMARY,
  demoFeatureDetail,
} from './demoData'
import type {
  FeatureCollection,
  ForestrySnapshot,
  SnapshotSummary,
  SourceFeatureDetail,
  SourceFieldComparison,
} from './types'

export class NoSnapshotError extends Error {
  constructor() {
    super('no forestry snapshot is persisted')
    this.name = 'NoSnapshotError'
  }
}

export function fetchLatestIngestedSnapshot(): Promise<ForestrySnapshot> {
  return Promise.resolve(DEMO_SNAPSHOT)
}

export function fetchSnapshotSummary(snapshotId: number): Promise<SnapshotSummary> {
  if (snapshotId !== DEMO_SNAPSHOT.shapefile_snapshot_id) {
    return Promise.reject(new NoSnapshotError())
  }
  return Promise.resolve(DEMO_SUMMARY)
}

export function fetchFeatureCollection(snapshotId: number): Promise<FeatureCollection> {
  if (snapshotId !== DEMO_SNAPSHOT.shapefile_snapshot_id) {
    return Promise.reject(new NoSnapshotError())
  }
  return Promise.resolve(DEMO_COLLECTION)
}

export function fetchComparison(snapshotId: number): Promise<SourceFieldComparison> {
  if (snapshotId !== DEMO_SNAPSHOT.shapefile_snapshot_id) {
    return Promise.reject(new NoSnapshotError())
  }
  return Promise.resolve(DEMO_COMPARISON)
}

export function fetchFeatureDetail(
  snapshotId: number,
  featureOrdinal: number,
): Promise<SourceFeatureDetail> {
  if (snapshotId !== DEMO_SNAPSHOT.shapefile_snapshot_id) {
    return Promise.reject(new NoSnapshotError())
  }
  const detail = demoFeatureDetail(featureOrdinal)
  if (!detail) {
    return Promise.reject(new Error(`unknown demo feature ordinal: ${featureOrdinal}`))
  }
  return Promise.resolve(detail)
}
```

- [ ] **Step 2: Port `App.tsx` from the source branch, near-verbatim**

```bash
git show feat/forestry-dashboard-v1:products/forestry/dashboard/src/App.tsx \
  > products/forestry/dashboard/src/App.tsx
```

The only required change: this file already imports everything from `./api.ts` (`fetchComparison`, `fetchFeatureCollection`, `fetchLatestIngestedSnapshot`, `fetchSnapshotSummary`, `NoSnapshotError`) — since Task 8 Step 1's `api.ts` exports the same names with the same signatures, **no import changes are needed**. Confirm this by re-reading the copied file's top-of-file imports against Step 1's exports before moving on.

Add the demo banner: import nothing new (no env flag needed here — this whole app is the demo), and add, as the first child of the outermost returned `<div className="app...">` wrapper, immediately before `<Header ... />`:

```tsx
<div className="demo-banner" role="status">
  DEMO — DATOS DE DEMOSTRACIÓN. El predio y los polígonos mostrados son sintéticos.
</div>
```

Add the matching `.demo-banner` CSS rule (same declaration as Task 3 Step 3) to whichever global stylesheet this app's `main.tsx` imports (check Task 4's copied `main.tsx`).

- [ ] **Step 3: Write a smoke test**

```tsx
// products/forestry/dashboard/src/App.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Forestry demo App', () => {
  it('renders the DEMO banner and eventually the demo predio KPI strip', async () => {
    render(<App />)
    expect(screen.getByText(/DATOS DE DEMOSTRACIÓN/i)).toBeInTheDocument()
    expect(await screen.findByText(/Predio Los Aromos|6/)).toBeInTheDocument()
  })
})
```

Adjust the second assertion once you see what `Header`/`KpiStrip` actually render for the demo summary (70 ha total, 6 predios) — the goal is just confirming the happy path reaches `phase.status === 'ready'`.

- [ ] **Step 4: Run tests and build**

Run: `cd products/forestry/dashboard && npm test && npm run build`
Expected: PASS, clean build. If `tsc -b` surfaces leftover type mismatches between `MapView.tsx` (Task 7) and `App.tsx`'s call site, fix them now — this is the first point both files coexist.

- [ ] **Step 5: Commit**

```bash
git add products/forestry/dashboard/src/api.ts products/forestry/dashboard/src/App.tsx \
  products/forestry/dashboard/src/App.test.tsx products/forestry/dashboard/src/*.css
git commit -m "feat(forestry-dashboard): wire demo API layer, port App shell, add DEMO banner"
```

---

## Part C — Transelec: new demo-only dashboard

Ported from `feat/transelec-ui-reference-parity-v1` (worktree: `/home/rafael/dev/freelance/campo-digital-transelec-ui-parity-v1`), which contains all of `feat/transelec-domain-evidence-v1` and `feat/transelec-hosted-pilot-v1`'s commits plus the UI redesign. All test fixtures found on that branch already use synthetic values (`Empresa A`/`Empresa B`, `PMF1`/`PMF2`, `P1`, `PAS Ambiental`) — confirmed via grep during planning, no real client data found in this product's branches. This plan still authors fresh, richer fixture data rather than reusing the test fixtures directly, to avoid coupling the demo dataset's lifecycle to the unit tests'.

### Task 9: Scaffold the Transelec dashboard project

**Files:**
- Create: `products/transelect/dashboard/package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `.oxlintrc.json`, `index.html`, `src/main.tsx`, `src/App.css`, `src/test/setup.ts`

**Interfaces:**
- Produces: a buildable, empty-shell Vite React app at `products/transelect/dashboard`.

- [ ] **Step 1: Copy the generic scaffold files verbatim**

```bash
BRANCH=feat/transelec-ui-reference-parity-v1
for f in package.json vite.config.ts vitest.config.ts tsconfig.json tsconfig.app.json \
         tsconfig.node.json .oxlintrc.json index.html src/main.tsx src/App.css \
         src/test/setup.ts; do
  mkdir -p "products/transelect/dashboard/$(dirname "$f")"
  git show "$BRANCH:products/transelect/dashboard/$f" > "products/transelect/dashboard/$f"
done
```

- [ ] **Step 2: Trim dependencies**

Read the copied `package.json`. This app needs no xlsx-parsing or file-upload dependency (`python_calamine` is backend-only and irrelevant here; check for any JS-side upload helper library and drop it along with `SourceManager`/`SourceStatusCard` in Task 11). Ensure `"test": "vitest run"` is present.

- [ ] **Step 3: Placeholder `App.tsx`, verify build**

```tsx
// products/transelect/dashboard/src/App.tsx (placeholder — Task 12 replaces this)
export default function App() {
  return <div>Transelec demo — under construction</div>
}
```

Run: `cd products/transelect/dashboard && npm install && npm run build && npm test`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add products/transelect/dashboard
git commit -m "chore(transelect-dashboard): scaffold new demo-only Vite app"
```

---

### Task 10: Author Transelec demo rows + port the PMF-view aggregation logic to TS

**Files:**
- Create: `products/transelect/dashboard/src/demoData.ts`
- Create: `products/transelect/dashboard/src/demoPmfView.ts`
- Create: `products/transelect/dashboard/src/demoPmfView.test.ts`

**Interfaces:**
- Produces: `DemoResumenRow` interface, `DEMO_ROWS: DemoResumenRow[]`, and pure functions `listFilterOptions`, `filterRows`, `listPmfs`, `getPmfDetail`, `buildSummary` — ported from `apps/transelec_ingestion/pmf_view.py`'s logic (same grouping/filtering semantics, translated to TypeScript) — consumed by Task 13's `api.ts`.

- [ ] **Step 1: Write `demoData.ts` — 18 fabricated rows across 6 PMFs**

```ts
// products/transelect/dashboard/src/demoData.ts
//
// Fully synthetic PMF/predio tracking rows. No PMF id, predio id, empresa,
// or role name here corresponds to a real Transelec workbook row. See
// docs/adr/ADR-008-hosted-demo-data-v1.md.
export interface DemoResumenRow {
  sourceRowNumber: number
  pmf: string
  provisionalPredioId: string | null
  estado: string
  estadoResumido: string
  superficieCorta: number | null
  numeroIngreso: string | null
  fechaIngreso: string | null
  rol: string | null
  empresa: string
  sector: string
  tramite: string | null
  tipoPropietario: string
  pas: string
  tipoRechazo: string | null
  numeroAreaCorta: string | null
}

const EMPRESAS = ['Empresa Demo Uno', 'Empresa Demo Dos', 'Empresa Demo Tres'] as const
const SECTORES = ['Sector Norte', 'Sector Centro', 'Sector Sur'] as const
const PAS_VALUES = ['PAS Ambiental', 'PAS Forestal'] as const

function row(
  n: number,
  pmf: string,
  predio: string,
  estadoResumido: string,
  overrides: Partial<DemoResumenRow> = {},
): DemoResumenRow {
  return {
    sourceRowNumber: n,
    pmf,
    provisionalPredioId: predio,
    estado: estadoResumido,
    estadoResumido,
    superficieCorta: null,
    numeroIngreso: `ING-DEMO-${String(n).padStart(3, '0')}`,
    fechaIngreso: '2026-07-01',
    rol: `ROL-DEMO-${String(n).padStart(3, '0')}`,
    empresa: EMPRESAS[n % EMPRESAS.length],
    sector: SECTORES[n % SECTORES.length],
    tramite: 'Corta',
    tipoPropietario: n % 3 === 0 ? 'Empresa' : 'Particular',
    pas: PAS_VALUES[n % PAS_VALUES.length],
    tipoRechazo: estadoResumido === 'Rechazado' ? 'Antecedentes incompletos (demo)' : null,
    numeroAreaCorta: `AC-${String(n).padStart(2, '0')}`,
    ...overrides,
  }
}

export const DEMO_ROWS: DemoResumenRow[] = [
  row(1, 'PMF-DEMO-01', 'PRED-DEMO-001', 'Aprobado', { superficieCorta: 4.2 }),
  row(2, 'PMF-DEMO-01', 'PRED-DEMO-001', 'Aprobado', { superficieCorta: 1.8, numeroAreaCorta: 'AC-02b' }),
  row(3, 'PMF-DEMO-01', 'PRED-DEMO-002', 'En tramitación', { superficieCorta: 3.1 }),
  row(4, 'PMF-DEMO-02', 'PRED-DEMO-003', 'Aprobado', { superficieCorta: 6.5 }),
  row(5, 'PMF-DEMO-02', 'PRED-DEMO-004', 'Ingresado', { superficieCorta: 2.4 }),
  row(6, 'PMF-DEMO-02', 'PRED-DEMO-004', 'Ingresado', { superficieCorta: 2.0, numeroAreaCorta: 'AC-06b' }),
  row(7, 'PMF-DEMO-03', 'PRED-DEMO-005', 'Rechazado', { superficieCorta: 1.1 }),
  row(8, 'PMF-DEMO-03', 'PRED-DEMO-006', 'Aprobado', { superficieCorta: 5.3 }),
  row(9, 'PMF-DEMO-03', 'PRED-DEMO-007', 'En tramitación', { superficieCorta: 3.9 }),
  row(10, 'PMF-DEMO-04', 'PRED-DEMO-008', 'Aprobado', { superficieCorta: 2.7 }),
  row(11, 'PMF-DEMO-04', 'PRED-DEMO-009', 'Aprobado', { superficieCorta: 4.4 }),
  row(12, 'PMF-DEMO-04', 'PRED-DEMO-010', 'Ingresado', { superficieCorta: 1.6 }),
  row(13, 'PMF-DEMO-05', 'PRED-DEMO-011', 'En tramitación', { superficieCorta: 2.2 }),
  row(14, 'PMF-DEMO-05', 'PRED-DEMO-012', 'Aprobado', { superficieCorta: 3.3 }),
  row(15, 'PMF-DEMO-06', 'PRED-DEMO-013', 'Rechazado', { superficieCorta: 0.9 }),
  row(16, 'PMF-DEMO-06', 'PRED-DEMO-014', 'Aprobado', { superficieCorta: 5.0 }),
  row(17, 'PMF-DEMO-06', 'PRED-DEMO-014', 'Aprobado', { superficieCorta: 1.5, numeroAreaCorta: 'AC-17b' }),
  row(18, 'PMF-DEMO-06', 'PRED-DEMO-015', 'Ingresado', { superficieCorta: 2.9 }),
]
```

- [ ] **Step 2: Write the failing test for the ported aggregation logic**

Read `products/transelect/tests/test_pmf_view.py` on the `feat/transelec-ui-reference-parity-v1` branch first (`git show feat/transelec-ui-reference-parity-v1:products/transelect/tests/test_pmf_view.py`) to confirm the exact grouping/filtering semantics being translated (OR-within-dimension, AND-across-dimensions multi-select; search matches `pmf`, `provisionalPredioId`, `rol`, `numeroPredio`).

```ts
// products/transelect/dashboard/src/demoPmfView.test.ts
import { describe, expect, it } from 'vitest'
import { DEMO_ROWS } from './demoData'
import { buildSummary, filterRows, getPmfDetail, listFilterOptions, listPmfs } from './demoPmfView'

describe('demoPmfView (ported from pmf_view.py)', () => {
  it('lists all 6 distinct PMFs sorted', () => {
    const items = listPmfs(DEMO_ROWS)
    expect(items.map((i) => i.pmf)).toEqual([
      'PMF-DEMO-01', 'PMF-DEMO-02', 'PMF-DEMO-03', 'PMF-DEMO-04', 'PMF-DEMO-05', 'PMF-DEMO-06',
    ])
  })

  it('filters rows by multi-select status with OR semantics within the dimension', () => {
    const filtered = filterRows(DEMO_ROWS, { status: ['Aprobado', 'Rechazado'] })
    expect(filtered.every((r) => r.estadoResumido === 'Aprobado' || r.estadoResumido === 'Rechazado')).toBe(true)
  })

  it('combines dimensions with AND semantics', () => {
    const filtered = filterRows(DEMO_ROWS, { status: ['Aprobado'], sector: ['Sector Norte'] })
    expect(filtered.every((r) => r.estadoResumido === 'Aprobado' && r.sector === 'Sector Norte')).toBe(true)
  })

  it('getPmfDetail groups rows by provisional predio id', () => {
    const detail = getPmfDetail(DEMO_ROWS, 'PMF-DEMO-01')
    expect(detail?.predios.map((p) => p.provisionalPredioId)).toEqual(['PRED-DEMO-001', 'PRED-DEMO-002'])
  })

  it('getPmfDetail returns null for an unknown PMF', () => {
    expect(getPmfDetail(DEMO_ROWS, 'does-not-exist')).toBeNull()
  })

  it('buildSummary sums surface and counts distinct PMFs/predios', () => {
    const summary = buildSummary(DEMO_ROWS)
    expect(summary.distinctPmf).toBe(6)
    expect(summary.businessRows).toBe(DEMO_ROWS.length)
  })

  it('listFilterOptions returns the distinct sorted values per dimension', () => {
    const options = listFilterOptions(DEMO_ROWS)
    expect(options.empresas).toEqual(['Empresa Demo Dos', 'Empresa Demo Tres', 'Empresa Demo Uno'])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd products/transelect/dashboard && npm test`
Expected: FAIL — `./demoPmfView` doesn't exist.

- [ ] **Step 4: Write `demoPmfView.ts`, translating `pmf_view.py`'s pure functions**

```ts
// products/transelect/dashboard/src/demoPmfView.ts
//
// TypeScript port of transelec_ingestion/pmf_view.py's pure grouping/filtering
// logic, operating on the demo-only DemoResumenRow shape instead of the real
// xlsx-derived ResumenSourceRow. See docs/adr/ADR-008-hosted-demo-data-v1.md.
import type { DemoResumenRow } from './demoData'

export interface PmfListItem {
  pmf: string
  rowCount: number
  predioCount: number
  sectors: string[]
  empresas: string[]
  statuses: string[]
  surfaceTotal: number | null
}

export interface PredioGroup {
  provisionalPredioId: string | null
  rows: DemoResumenRow[]
}

export interface PmfDetail {
  pmf: string
  rowCount: number
  statuses: string[]
  predios: PredioGroup[]
}

export interface FilterOptions {
  statuses: string[]
  sectors: string[]
  empresas: string[]
  pas: string[]
  tiposPropietario: string[]
}

export interface Summary {
  businessRows: number
  distinctPmf: number
  distinctProvisionalPredioIds: number
  distinctRoles: number
  surfaceTotal: number
  statusBreakdown: [string, number][]
}

export interface ActiveFilters {
  search?: string
  status?: string[]
  sector?: string[]
  empresa?: string[]
  pas?: string[]
  tipoPropietario?: string[]
}

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort()
}

function matchesSelection(value: string | null, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true
  return value !== null && allowed.map((v) => v.toLowerCase()).includes(value.toLowerCase())
}

export function filterRows(rows: DemoResumenRow[], filters: ActiveFilters): DemoResumenRow[] {
  const needle = filters.search?.trim().toLowerCase()

  return rows.filter((r) => {
    if (!matchesSelection(r.estadoResumido, filters.status)) return false
    if (!matchesSelection(r.sector, filters.sector)) return false
    if (!matchesSelection(r.empresa, filters.empresa)) return false
    if (!matchesSelection(r.pas, filters.pas)) return false
    if (!matchesSelection(r.tipoPropietario, filters.tipoPropietario)) return false

    if (needle) {
      const haystacks = [r.pmf, r.provisionalPredioId ?? '', r.rol ?? '']
      if (!haystacks.some((h) => h.toLowerCase().includes(needle))) return false
    }

    return true
  })
}

export function listFilterOptions(rows: DemoResumenRow[]): FilterOptions {
  return {
    statuses: sortedUnique(rows.map((r) => r.estadoResumido)),
    sectors: sortedUnique(rows.map((r) => r.sector)),
    empresas: sortedUnique(rows.map((r) => r.empresa)),
    pas: sortedUnique(rows.map((r) => r.pas)),
    tiposPropietario: sortedUnique(rows.map((r) => r.tipoPropietario)),
  }
}

export function listPmfs(rows: DemoResumenRow[], filters: ActiveFilters = {}): PmfListItem[] {
  const matched = filterRows(rows, filters)
  const grouped = new Map<string, DemoResumenRow[]>()

  for (const r of matched) {
    const bucket = grouped.get(r.pmf) ?? []
    bucket.push(r)
    grouped.set(r.pmf, bucket)
  }

  return Array.from(grouped.keys())
    .sort()
    .map((pmf) => {
      const pmfRows = grouped.get(pmf)!
      const predios = new Set(pmfRows.map((r) => r.provisionalPredioId).filter((v): v is string => v !== null))
      const surfaces = pmfRows.map((r) => r.superficieCorta).filter((v): v is number => v !== null)

      return {
        pmf,
        rowCount: pmfRows.length,
        predioCount: predios.size,
        sectors: sortedUnique(pmfRows.map((r) => r.sector)),
        empresas: sortedUnique(pmfRows.map((r) => r.empresa)),
        statuses: sortedUnique(pmfRows.map((r) => r.estadoResumido)),
        surfaceTotal: surfaces.length ? surfaces.reduce((a, b) => a + b, 0) : null,
      }
    })
}

export function getPmfDetail(rows: DemoResumenRow[], pmf: string): PmfDetail | null {
  const pmfRows = rows.filter((r) => r.pmf === pmf)
  if (pmfRows.length === 0) return null

  const byPredio = new Map<string | null, DemoResumenRow[]>()
  for (const r of pmfRows) {
    const bucket = byPredio.get(r.provisionalPredioId) ?? []
    bucket.push(r)
    byPredio.set(r.provisionalPredioId, bucket)
  }

  const orderedIds = Array.from(byPredio.keys())
    .filter((id): id is string => id !== null)
    .sort()
  if (byPredio.has(null)) orderedIds.push(null as unknown as string)

  return {
    pmf,
    rowCount: pmfRows.length,
    statuses: sortedUnique(pmfRows.map((r) => r.estadoResumido)),
    predios: orderedIds.map((id) => ({
      provisionalPredioId: id,
      rows: [...byPredio.get(id)!].sort(
        (a, b) => (a.numeroAreaCorta ?? '').localeCompare(b.numeroAreaCorta ?? '') || a.sourceRowNumber - b.sourceRowNumber,
      ),
    })),
  }
}

export function buildSummary(rows: DemoResumenRow[]): Summary {
  if (rows.length === 0) {
    return {
      businessRows: 0,
      distinctPmf: 0,
      distinctProvisionalPredioIds: 0,
      distinctRoles: 0,
      surfaceTotal: 0,
      statusBreakdown: [],
    }
  }

  const surfaceTotal = rows.reduce((sum, r) => sum + (r.superficieCorta ?? 0), 0)
  const statusCounts = new Map<string, number>()
  for (const r of rows) {
    statusCounts.set(r.estadoResumido, (statusCounts.get(r.estadoResumido) ?? 0) + 1)
  }

  return {
    businessRows: rows.length,
    distinctPmf: new Set(rows.map((r) => r.pmf)).size,
    distinctProvisionalPredioIds: new Set(rows.map((r) => r.provisionalPredioId).filter(Boolean)).size,
    distinctRoles: new Set(rows.map((r) => r.rol).filter(Boolean)).size,
    surfaceTotal,
    statusBreakdown: Array.from(statusCounts.entries()).sort(([a], [b]) => a.localeCompare(b)),
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd products/transelect/dashboard && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add products/transelect/dashboard/src/demoData.ts products/transelect/dashboard/src/demoPmfView.ts \
  products/transelect/dashboard/src/demoPmfView.test.ts
git commit -m "feat(transelect-dashboard): author synthetic PMF rows, port pmf_view aggregation to TS"
```

---

### Task 11: Port Transelec presentational components (exclude admin/upload)

**Files:**
- Create: `products/transelect/dashboard/src/components/{AppHeader→skip,ExecutiveKpis,StatusDistribution,FilterPanel,MultiSelectField,Pagination,PmfExplorer,PmfDetailDrawer,StatusPills,icons,format}.tsx/.ts` and their `.test.tsx` files
- Do NOT create: `SourceManager.tsx`, `SourceStatusCard.tsx`, `AppHeader.tsx` (Task 12 writes a new `DemoHeader.tsx` instead — `AppHeader` bundles a live "Gestionar fuente" admin button with no useful action in a static demo)

**Interfaces:**
- Produces: same exported component names/props as the source branch for everything ported, so `App.tsx` (Task 12) needs no prop-shape changes beyond removing the components this task deliberately excludes.

- [ ] **Step 1: Copy the components and their tests**

```bash
BRANCH=feat/transelec-ui-reference-parity-v1
mkdir -p products/transelect/dashboard/src/components

for c in ExecutiveKpis StatusDistribution FilterPanel MultiSelectField Pagination \
         PmfExplorer PmfDetailDrawer StatusPills icons format; do
  ext="tsx"
  [ "$c" = "format" ] && ext="ts"
  git show "$BRANCH:products/transelect/dashboard/src/components/$c.$ext" \
    > "products/transelect/dashboard/src/components/$c.$ext"
  git show "$BRANCH:products/transelect/dashboard/src/components/$c.test.$ext" \
    > "products/transelect/dashboard/src/components/$c.test.$ext" 2>/dev/null || true
done
# MultiSelectField.tsx lives at src/, not src/components/, per the earlier find listing.
mv products/transelect/dashboard/src/components/MultiSelectField.tsx \
   products/transelect/dashboard/src/MultiSelectField.tsx
```

- [ ] **Step 2: Remove any empty files from a mis-pathed copy**

Run: `find products/transelect/dashboard/src -size 0 -type f`
Expected: no output — fix any that appear (re-check the exact source path with `git show $BRANCH:products/transelect/dashboard/src/... | head`).

- [ ] **Step 3: Confirm none of the ported files import `AppHeader`, `SourceManager`, or `SourceStatusCard`**

Run: `grep -rl "AppHeader\|SourceManager\|SourceStatusCard" products/transelect/dashboard/src/components products/transelect/dashboard/src/MultiSelectField.tsx`
Expected: no output (confirmed clean during planning — `AppHeader`/`SourceManager`/`SourceStatusCard` are referenced only from the source branch's `App.tsx`, which this plan does not copy verbatim; Task 12 writes a fresh one).

- [ ] **Step 4: Commit**

```bash
git add products/transelect/dashboard/src/components products/transelect/dashboard/src/MultiSelectField.tsx
git commit -m "feat(transelect-dashboard): port read-only PMF explorer components"
```

---

### Task 12: Transelec `api.ts`, `DemoHeader.tsx`, `App.tsx`, demo banner

**Files:**
- Create: `products/transelect/dashboard/src/api.ts`
- Create: `products/transelect/dashboard/src/components/DemoHeader.tsx`
- Create: `products/transelect/dashboard/src/App.tsx` (replace Task 9's placeholder)
- Create: `products/transelect/dashboard/src/App.test.tsx`

**Interfaces:**
- Consumes: `DEMO_ROWS` (Task 10), `listFilterOptions`/`listPmfs`/`getPmfDetail`/`buildSummary` (Task 10).
- Produces: `getSummary`, `getFilters`, `listPmfs`, `getPmfDetail` matching the field names (`pmf`, `row_count`, `predio_count`, `sectors`, `empresas`, `statuses`, `surface_total`, etc. — snake_case, matching what `PmfExplorer.tsx`/`PmfDetailDrawer.tsx`/`ExecutiveKpis.tsx`/`StatusDistribution.tsx` expect, per the `PmfListItem`/`PmfDetail`/`TranselecSummary`/`TranselecFilterOptions` interfaces read from the source branch's `api.ts` during planning) that Task 11's ported components already expect.

- [ ] **Step 1: Write `api.ts`, adapting Task 10's camelCase results to the snake_case wire shape the ported components expect**

```ts
// products/transelect/dashboard/src/api.ts
//
// Demo-only data layer: no live backend exists for this app. Every function
// below runs the ported pmf_view logic (./demoPmfView) over the bundled
// synthetic rows (./demoData). See docs/adr/ADR-008-hosted-demo-data-v1.md.
import { DEMO_ROWS } from './demoData'
import {
  buildSummary,
  getPmfDetail as getPmfDetailPure,
  listFilterOptions,
  listPmfs as listPmfsPure,
  type ActiveFilters as PureActiveFilters,
} from './demoPmfView'

export interface PredioAreaRow {
  source_row_number: number
  numero_area_corta: string | null
  estado: string | null
  estado_resumido: string | null
  superficie_corta: number | null
  numero_ingreso: string | null
  fecha_ingreso: string | null
  rol: string | null
  empresa: string | null
  sector: string | null
  tramite: string | null
  tipo_propietario: string | null
  pas: string | null
  tipo_rechazo: string | null
}

export interface PredioGroup {
  provisional_predio_id: string | null
  rows: PredioAreaRow[]
}

export interface PmfListItem {
  pmf: string
  row_count: number
  predio_count: number
  sectors: string[]
  empresas: string[]
  statuses: string[]
  surface_total: number | null
}

export interface PmfDetail {
  pmf: string
  row_count: number
  statuses: string[]
  predios: PredioGroup[]
}

export interface TranselecFilterOptions {
  statuses: string[]
  sectors: string[]
  empresas: string[]
  pas: string[]
  tipos_propietario: string[]
}

export interface TranselecSummary {
  business_rows: number
  distinct_pmf: number
  distinct_provisional_predio_ids: number
  distinct_roles: number
  surface_total: number
  status_breakdown: [string, number][]
}

export interface ActiveFilters {
  search?: string
  status?: string[]
  sector?: string[]
  empresa?: string[]
  pas?: string[]
  tipoPropietario?: string[]
}

function toPure(filters: ActiveFilters): PureActiveFilters {
  return {
    search: filters.search,
    status: filters.status,
    sector: filters.sector,
    empresa: filters.empresa,
    pas: filters.pas,
    tipoPropietario: filters.tipoPropietario,
  }
}

export function getFilters(): Promise<TranselecFilterOptions> {
  const options = listFilterOptions(DEMO_ROWS)
  return Promise.resolve({
    statuses: options.statuses,
    sectors: options.sectors,
    empresas: options.empresas,
    pas: options.pas,
    tipos_propietario: options.tiposPropietario,
  })
}

export function listPmfs(filters: ActiveFilters = {}): Promise<PmfListItem[]> {
  const items = listPmfsPure(DEMO_ROWS, toPure(filters))
  return Promise.resolve(
    items.map((item) => ({
      pmf: item.pmf,
      row_count: item.rowCount,
      predio_count: item.predioCount,
      sectors: item.sectors,
      empresas: item.empresas,
      statuses: item.statuses,
      surface_total: item.surfaceTotal,
    })),
  )
}

export function getSummary(filters: ActiveFilters = {}): Promise<TranselecSummary> {
  const { filterRows } = require('./demoPmfView') as typeof import('./demoPmfView')
  const summary = buildSummary(filterRows(DEMO_ROWS, toPure(filters)))
  return Promise.resolve({
    business_rows: summary.businessRows,
    distinct_pmf: summary.distinctPmf,
    distinct_provisional_predio_ids: summary.distinctProvisionalPredioIds,
    distinct_roles: summary.distinctRoles,
    surface_total: summary.surfaceTotal,
    status_breakdown: summary.statusBreakdown,
  })
}

export function getPmfDetail(pmf: string): Promise<PmfDetail> {
  const detail = getPmfDetailPure(DEMO_ROWS, pmf)
  if (!detail) {
    return Promise.reject(new Error('PMF no encontrado en la fuente de demostración.'))
  }
  return Promise.resolve({
    pmf: detail.pmf,
    row_count: detail.rowCount,
    statuses: detail.statuses,
    predios: detail.predios.map((group) => ({
      provisional_predio_id: group.provisionalPredioId,
      rows: group.rows.map((r) => ({
        source_row_number: r.sourceRowNumber,
        numero_area_corta: r.numeroAreaCorta,
        estado: r.estado,
        estado_resumido: r.estadoResumido,
        superficie_corta: r.superficieCorta,
        numero_ingreso: r.numeroIngreso,
        fecha_ingreso: r.fechaIngreso,
        rol: r.rol,
        empresa: r.empresa,
        sector: r.sector,
        tramite: r.tramite,
        tipo_propietario: r.tipoPropietario,
        pas: r.pas,
        tipo_rechazo: r.tipoRechazo,
      })),
    })),
  })
}
```

Replace the `require(...)` inline import in `getSummary` with a proper top-level `import { filterRows } from './demoPmfView'` alongside the other named imports — it's written inline above only to keep this step's diff readable; use a normal ES import in the actual file.

- [ ] **Step 2: Write `DemoHeader.tsx`**

```tsx
// products/transelect/dashboard/src/components/DemoHeader.tsx
export function DemoHeader() {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <strong>Campo Digital</strong>
          <span className="brand-client">Transelec</span>
          <span className="brand-subtitle">Estado operativo de PMF y predios (demo)</span>
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Write `App.tsx`, trimmed from the source branch**

Read `products/transelect/dashboard/src/App.tsx` on `feat/transelec-ui-reference-parity-v1` again (already read during planning). Write a new version that keeps: `search`/`status`/`sector`/`empresa`/`pas`/`tipoPropietario` filter state, the debounced `listPmfs`/`getSummary` effect, `page`/`pageSize`, `selectedPmf`/`pmfDetail`/`detailError`/`loadingDetail` and its fetch effect, the arrow-key PMF navigation effect, `clearFilters`, `handlePageSizeChange`, `goToPrevPmf`/`goToNextPmf`, `exportCsv` (unchanged — it only reads `pmfs` and `surfaceFormatter`), and the full JSX tree — but:
- Import `DemoHeader` instead of `AppHeader`; render `<DemoHeader />` instead of `<AppHeader sourceAvailable={...} ... />` (drop all `AppHeader` props).
- Delete every piece of state/effect/handler that exists only for `snapshots`/`snapshotHistoryAvailable`/`activeSnapshot`/`managerOpen`/`adminToken`/`selectedFile`/`uploading`/`adminMessage`/`adminError`/`restoreCandidate`/`fileInputRef`/`handleFileChange`/`handlePublish`/`handleRestore`.
- Delete the `<SourceStatusCard ... />` and `{managerOpen && <SourceManager ... />}` JSX blocks and their imports.
- Drop `getSnapshots`/`activateSnapshot`/`publishWorkbook` from the `./api` import (Task 12 Step 1's `api.ts` doesn't export them).
- Add the demo banner as the first child inside the root `<div className="app-shell">`:

```tsx
<div className="demo-banner" role="status">
  DEMO — DATOS DE DEMOSTRACIÓN. Los PMF y predios mostrados son sintéticos.
</div>
```

Add the matching `.demo-banner` CSS rule to `App.css`.

- [ ] **Step 4: Write a smoke test**

```tsx
// products/transelect/dashboard/src/App.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Transelec demo App', () => {
  it('renders the DEMO banner and the demo PMF list', async () => {
    render(<App />)
    expect(screen.getByText(/DATOS DE DEMOSTRACIÓN/i)).toBeInTheDocument()
    expect(await screen.findByText('PMF-DEMO-01')).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run tests and build**

Run: `cd products/transelect/dashboard && npm test && npm run build`
Expected: PASS, clean build.

- [ ] **Step 6: Commit**

```bash
git add products/transelect/dashboard/src/api.ts products/transelect/dashboard/src/components/DemoHeader.tsx \
  products/transelect/dashboard/src/App.tsx products/transelect/dashboard/src/App.css \
  products/transelect/dashboard/src/App.test.tsx
git commit -m "feat(transelect-dashboard): wire demo API layer, trim App shell, add DEMO banner"
```

---

## Part D — Portal composition

### Task 13: Extend `ModuleRuntimeStatus` with a `demo` flag

**Files:**
- Modify: `apps/portal/src/runtime/runtimeConfig.ts`
- Modify: `apps/portal/src/runtime/runtimeConfig.test.ts`

**Interfaces:**
- Produces: `ModuleRuntimeStatus.demo?: boolean`, read by Task 16's `ModuleHeader`.

- [ ] **Step 1: Write the failing test**

Read `apps/portal/src/runtime/runtimeConfig.test.ts` first to match its existing style. Add:

```ts
it('buildStagingRuntimeConfig marks every hosted module as demo:true', () => {
  vi.stubEnv('VITE_LIDAR_HOSTED_URL', 'https://campo-digital-lidar-staging.onrender.com')
  vi.stubEnv('VITE_FORESTAL_HOSTED_URL', 'https://campo-digital-forestal-staging.onrender.com')
  vi.stubEnv('VITE_TRANSELEC_HOSTED_URL', 'https://campo-digital-transelec-staging.onrender.com')

  const config = buildStagingRuntimeConfig()

  expect(config.modules.lidar).toEqual({
    status: 'available',
    url: 'https://campo-digital-lidar-staging.onrender.com',
    demo: true,
  })
  vi.unstubAllEnvs()
})

it('parseRuntimeConfig passes through an explicit demo:false from the LOCAL launcher', () => {
  const config = parseRuntimeConfig({ modules: { lidar: { status: 'available', demo: false } } })
  expect(config.modules.lidar?.demo).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/portal && npm test`
Expected: FAIL — `demo` is `undefined`, not `true`/`false`.

- [ ] **Step 3: Add the field**

In `apps/portal/src/runtime/runtimeConfig.ts`:

```ts
export interface ModuleRuntimeStatus {
  status: ModuleStatus
  url?: string
  owned?: boolean
  measurementCount?: number
  demo?: boolean
}
```

In `normalizeModule`, add after the existing `measurementCount` line:

```ts
demo: typeof record.demo === 'boolean' ? record.demo : undefined,
```

In `buildStagingRuntimeConfig`, change the loop body:

```ts
for (const moduleId of ['lidar', 'forestal', 'transelec'] as const) {
  const url = hosted[moduleId]
  modules[moduleId] = url ? { status: 'available', url, demo: true } : { status: 'unavailable' }
}
```

(All three STAGING hosted modules are demo-only for this slice — see ADR-008. When a real, Entra-authenticated hosted build eventually replaces one, that module's `demo` flag flips to `false` alongside whatever change wires in real auth.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/portal && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/runtime/runtimeConfig.ts apps/portal/src/runtime/runtimeConfig.test.ts
git commit -m "feat(portal): add a demo flag to module runtime status"
```

---

### Task 14: Extend `hostedModuleUrls()` for Forestry and Transelec

**Files:**
- Modify: `apps/portal/src/runtime/hostedModules.ts`
- Modify: `apps/portal/src/runtime/hostedModules.test.ts`

- [ ] **Step 1: Write the failing test**

Read the existing `hostedModules.test.ts` first. Add cases mirroring the existing `lidar` one for `forestal`/`transelec`, asserting `hostedModuleUrls()` picks up `VITE_FORESTAL_HOSTED_URL`/`VITE_TRANSELEC_HOSTED_URL` and that omitting them leaves those keys absent (same "deliberately absent, not empty" contract the file already documents for the other two today).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/portal && npm test`
Expected: FAIL.

- [ ] **Step 3: Update `hostedModules.ts`**

```ts
export function hostedModuleUrls(): Partial<Record<ModuleId, string>> {
  const urls: Partial<Record<ModuleId, string>> = {}

  const lidarUrl = import.meta.env.VITE_LIDAR_HOSTED_URL
  if (lidarUrl) {
    urls.lidar = lidarUrl
  }

  const forestalUrl = import.meta.env.VITE_FORESTAL_HOSTED_URL
  if (forestalUrl) {
    urls.forestal = forestalUrl
  }

  const transelecUrl = import.meta.env.VITE_TRANSELEC_HOSTED_URL
  if (transelecUrl) {
    urls.transelec = transelecUrl
  }

  return urls
}
```

Update the file's leading comment: it currently says Forestry/Transelec are "deliberately never populated here... add their key only alongside a real deployed static site" — replace with a note that both now point at demo-only static sites (Task 19), not the real backend, and that the "closed set, baked in at build time" property is unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/portal && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/runtime/hostedModules.ts apps/portal/src/runtime/hostedModules.test.ts
git commit -m "feat(portal): read Forestry and Transelec hosted demo URLs"
```

---

### Task 15: Extend the `safeUrl` staging allowlist

**Files:**
- Modify: `apps/portal/src/lib/safeUrl.ts`
- Modify: `apps/portal/src/lib/safeUrl.test.ts`

- [ ] **Step 1: Write the failing test**

Add cases to the existing `safeUrl.test.ts` asserting `isSafeIframeUrl('https://campo-digital-forestal-staging.onrender.com/...', 'staging')` and the `transelec` equivalent both return `true`, and that a lookalike host (e.g. `campo-digital-forestal-staging.onrender.com.evil.example`) still returns `false`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/portal && npm test`
Expected: FAIL.

- [ ] **Step 3: Update the allowlist**

```ts
const ALLOWED_STAGING_HOSTNAMES = new Set([
  'campo-digital-lidar-staging.onrender.com',
  'campo-digital-forestal-staging.onrender.com',
  'campo-digital-transelec-staging.onrender.com',
])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/portal && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/lib/safeUrl.ts apps/portal/src/lib/safeUrl.test.ts
git commit -m "feat(portal): allowlist the Forestry and Transelec demo hostnames"
```

---

### Task 16: Demo badge in `ModuleHeader`

**Files:**
- Modify: `apps/portal/src/components/ModuleHeader.tsx`
- Modify: `apps/portal/src/components/ModuleHeader.test.tsx`
- Modify: `apps/portal/src/pages/Module.tsx`
- Modify: `apps/portal/src/pages/Module.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `ModuleHeader.test.tsx`: rendering with a new `demo` prop set to `true` shows text matching `/DEMO/i`; `demo={false}` (or omitted) shows no such text.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/portal && npm test`
Expected: FAIL.

- [ ] **Step 3: Add the prop and badge to `ModuleHeader.tsx`**

```ts
interface ModuleHeaderProps {
  module: ModuleDefinition
  url: string | undefined
  environment: CampoEnvironment
  demo?: boolean
}

export function ModuleHeader({ module, url, environment, demo }: ModuleHeaderProps) {
```

Inside the returned `<header>`, add as the first child of `module-header__left` (before the "← Campo Digital" link), or as a small pill next to `module-header__title` — place it next to the title:

```tsx
{demo ? <span className="module-header__demo-badge">DEMO</span> : null}
```

Add a CSS rule for `.module-header__demo-badge` in the portal's stylesheet (check `App.css`/`index.css` for where `.module-header` rules live) — small, high-contrast pill badge.

- [ ] **Step 4: Wire `Module.tsx` to pass the flag through**

```tsx
<ModuleHeader module={module} url={safeUrl} environment={config.environment} demo={runtimeStatus.demo} />
```

Update `Module.test.tsx` to cover: when `moduleStatusFor` returns `demo: true`, the rendered page includes the DEMO badge text.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/portal && npm test`
Expected: PASS.

- [ ] **Step 6: Run the portal build**

Run: `cd apps/portal && npm run build`
Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/components/ModuleHeader.tsx apps/portal/src/components/ModuleHeader.test.tsx \
  apps/portal/src/pages/Module.tsx apps/portal/src/pages/Module.test.tsx apps/portal/src/index.css
git commit -m "feat(portal): show a DEMO badge on demo-flagged modules"
```

---

## Part E — Render infra and documentation

### Task 17: `render.yaml` — demo env vars, two new free static sites, fix stale branch refs

**Files:**
- Modify: `render.yaml`

- [ ] **Step 1: Add the LiDAR demo flag**

In the `campo-digital-lidar-staging` service block, add to `envVars`:

```yaml
    envVars:
      - key: VITE_CAMPO_DEMO
        value: "true"
```

Update that service's comment block: it currently says this site "adds a second free static site and zero new backend surface, zero new data" because `/runs` resolved to `[]` — that assumption is now false (RBAC makes `/runs` 401 unauthenticated). Replace with a note that this build now runs in `VITE_CAMPO_DEMO=true` mode (see Task 2/`docs/adr/ADR-008-hosted-demo-data-v1.md`) and never calls the real API at all, so the `/api/*` rewrite in this block's `routes` is now dead weight for the demo build but harmless to leave in place (it becomes load-bearing again the day this flag flips off for real Entra-authenticated hosting).

- [ ] **Step 2: Add portal env vars for the two new hosted URLs**

In `campo-digital-portal-staging`'s `envVars`, add after `VITE_LIDAR_HOSTED_URL`:

```yaml
      - key: VITE_FORESTAL_HOSTED_URL
        value: https://campo-digital-forestal-staging.onrender.com
      - key: VITE_TRANSELEC_HOSTED_URL
        value: https://campo-digital-transelec-staging.onrender.com
```

- [ ] **Step 3: Add the two new static services**

Append after the `campo-digital-lidar-staging` block:

```yaml
  # Static build of the Forestry product dashboard (products/forestry/dashboard).
  # Demo-only: this app has no live backend at all (see
  # docs/adr/ADR-008-hosted-demo-data-v1.md) — it serves a bundled synthetic
  # 6-predio fixture, so there is no /api/* rewrite and no dependency on
  # campo-digital-api-staging or campo-digital-db-staging.
  - name: campo-digital-forestal-staging
    type: web
    runtime: static
    repo: https://github.com/rafaelRojasVi/campo-digital-platform.git
    branch: main
    buildCommand: cd products/forestry/dashboard && npm ci && npm run build
    staticPublishPath: products/forestry/dashboard/dist
    routes:
      - type: rewrite
        source: /*
        destination: /index.html

  # Static build of the Transelec product dashboard (products/transelect/dashboard).
  # Demo-only, same rationale as campo-digital-forestal-staging above.
  - name: campo-digital-transelec-staging
    type: web
    runtime: static
    repo: https://github.com/rafaelRojasVi/campo-digital-platform.git
    branch: main
    buildCommand: cd products/transelect/dashboard && npm ci && npm run build
    staticPublishPath: products/transelect/dashboard/dist
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

- [ ] **Step 4: Fix the stale `branch:` fields on the three pre-existing services**

`campo-digital-api-staging`, `campo-digital-portal-staging`, and `campo-digital-lidar-staging` all currently say `branch: feat/hosted-composition-v1`, which is fully merged into `main` (confirmed during planning: `git diff main..feat/hosted-composition-v1 --stat` is empty). Change all three to `branch: main`.

- [ ] **Step 5: Validate the YAML is well-formed**

Run: `python -c "import yaml; yaml.safe_load(open('render.yaml'))"`
Expected: no error. (There is no `render` CLI available in this environment for a full Blueprint sync-preview — that validation happens at deploy time against the real Render account, which Task 21 explicitly does not do. Note this gap in the final report.)

- [ ] **Step 6: Commit**

```bash
git add render.yaml
git commit -m "feat(render): add demo-mode env var and two new free static sites for Forestry/Transelec"
```

---

### Task 18: ADR-008

**Files:**
- Create: `docs/adr/ADR-008-hosted-demo-data-v1.md`

- [ ] **Step 1: Write the ADR**

Follow the existing ADR format (read `docs/adr/ADR-007-hosted-product-composition-v1.md` first for structure/tone). Cover:
- **Status:** Accepted.
- **Context:** Javier needs a demonstrable public staging portal without Entra login; the real `/runs` route is now RBAC-protected (401/403 unauthenticated) and must stay that way; ADR-007 explicitly deferred Forestry (no offline data path, declined to fabricate polygon geometry) and Transelec (needs live Postgres+object store) and called for "a task explicitly scoped to build a synthetic dataset" — this is that task.
- **Decision:** Extend the ADR-007 hosted-composition pattern (closed `hostedModuleUrls`/`safeUrl` allowlist, portal iframe) to all three products. LiDAR's existing dashboard gets a build-time `VITE_CAMPO_DEMO` branch in `api.ts` that resolves bundled fixtures instead of calling `/api/runs`. Forestry and Transelec get new, product-owned, demo-only dashboards (`products/forestry/dashboard`, `products/transelect/dashboard`) ported from the read-only presentation layer on `feat/forestry-dashboard-v1`/`feat/transelec-ui-reference-parity-v1`, stripped of admin/upload/draft-editing affordances, wired to hand-authored synthetic fixtures — no PostGIS, no Alembic migration, no object storage, no new backend route for either. All fixture identifiers/coordinates are fabricated (cite the "HT"/"Hacienda Trinidad" fixture-contamination finding from `feat/forestry-dashboard-v1`'s own `src/test/fixtures.ts` as the specific real-data risk this plan avoided).
- **Consequences:** Two new free Render static services (no paid resources); the pre-existing Forestry/Transelec `migrations/versions/0003_*` revision-id collision (both branches declare `revision="0003"`, `down_revision="0002"`) is untouched and remains unresolved, since this plan deploys neither product's real backend; `/runs` and all other RBAC-protected routes are unaffected; when Entra auth eventually lands, `VITE_CAMPO_DEMO` flips off for LiDAR and Forestry/Transelec each get their own future hosted-composition slice wired to real data; the portal's pre-existing "159 PMF"/"1.568 polígonos" marketing facts (`apps/portal/src/data/modules.ts`) describe the real platform's evidence-backed scale and are intentionally left unchanged even though the demo datasets are much smaller — flagged here as a judgment call, not a business decision this ADR resolves.

- [ ] **Step 2: Commit**

```bash
git add docs/adr/ADR-008-hosted-demo-data-v1.md
git commit -m "docs: record ADR-008 hosted demo data v1"
```

---

## Part F — Verification

### Task 19: Real-data audit

**Files:** none modified — read-only checks.

- [ ] **Step 1: Grep for known real-data markers across everything this plan touched**

```bash
grep -rn "Hacienda Trinidad\|'HT'\|\"HT\"" products/forestry products/lidar products/transelect apps/portal render.yaml docs/adr/ADR-008-hosted-demo-data-v1.md
grep -rn "620000\|5490000" products/forestry
```

Expected: no output. If anything matches, stop and fix before proceeding — this is the one check in this plan that must be zero-tolerance.

- [ ] **Step 2: Confirm no new file under `products/*/dashboard` imports from or references `CAMPO_DIGITAL_SOURCE_ROOT`, real shapefile paths, or a real xlsx workbook path**

```bash
grep -rn "CAMPO_DIGITAL_SOURCE_ROOT\|03_Proyecto_Transelec\|\.shp\|\.dbf" products/forestry/dashboard products/transelect/dashboard
```

Expected: no output.

- [ ] **Step 3: Diff review**

Run: `git diff main --stat` (from this feature branch) and manually scan the file list for anything unexpected (a stray `node_modules` commit, a `.env`, a real data file accidentally staged).

---

### Task 20: Cross-cutting checks

**Files:** none modified.

- [ ] **Step 1: LiDAR real API still 401s unauthenticated**

Run: `uv run pytest apps/api/tests -k lidar`
Expected: PASS, including whatever test already asserts `require_lidar_view` rejects an unauthenticated request. Additionally spin up the local API (`make platform-local` or equivalent per existing docs) and run `curl -i http://127.0.0.1:8000/api/runs` without any auth header/cookie — expect `401` or `403`, not `200`.

- [ ] **Step 2: Full JS build/test/lint for all four frontends**

```bash
for app in apps/portal products/lidar/dashboard products/forestry/dashboard products/transelect/dashboard; do
  (cd "$app" && npm run build && npm test && npm run lint)
done
```

Expected: all green.

- [ ] **Step 3: `make check`**

Run: `make check`
Expected: PASS (`format-check lint typecheck architecture-check test docs-check`). This covers `scripts/check_architecture_boundaries.py` and the full Python test suite — neither should see any change from this plan (no Python source was touched), so this is primarily a regression guard.

- [ ] **Step 4: Security/dependency checks**

```bash
make secret-check
make dependency-audit
```

Expected: PASS. If `dependency-audit` flags a new npm dependency pulled in by one of the ported dashboards (leaflet, testing-library, etc.), evaluate the finding on its own merits — do not suppress it reflexively.

- [ ] **Step 5: `scripts/check_doc_links.py` and nav update, per the repo's documentation workflow**

```bash
uv run python scripts/update_doc_nav.py
uv run python scripts/check_doc_links.py
```

Expected: no broken links introduced by the new ADR.

- [ ] **Step 6: Browser QA — all four apps, local `vite preview`**

For each of the four apps, build and preview locally, then visually confirm in a browser:
- `cd products/lidar/dashboard && npm run build && VITE_CAMPO_DEMO=true npm run preview` → confirm the red DEMO banner, all 3 demo runs listed (one completed/fully validated, one partial/blocked, one failed), and that opening each run shows plausible metrics with no network calls to `/api/*` (check the browser network tab).
- `cd products/forestry/dashboard && npm run build && npm run preview` → confirm the DEMO banner, the satellite/OSM basemap renders, all 6 demo predios appear as polygons with distinct colors by use-code, clicking a polygon opens the Inspector, the quality panel shows 1 invalid-geometry flag, the comparison panel shows the 2024→2026 change for `DEMO-03`.
- `cd products/transelect/dashboard && npm run build && npm run preview` → confirm the DEMO banner, KPIs, status distribution, all 6 demo PMFs in the explorer, filtering by empresa/sector/estado works, opening a PMF detail drawer groups by predio, CSV export produces a file with only demo values.
- `cd apps/portal && npm run build && VITE_CAMPO_ENV=staging VITE_LIDAR_HOSTED_URL=http://127.0.0.1:4173 npm run preview` (repeat/adjust per module, or run all three previews on different ports and point each `VITE_*_HOSTED_URL` at the right port) → confirm the portal Home page still shows all three modules, each module page shows the DEMO badge next to its title, and the iframe loads the corresponding demo dashboard.
- `cd apps/portal && npm run dev` (LOCAL mode, no `VITE_CAMPO_ENV`) → confirm LOCAL behavior is unchanged (this plan touched `parseRuntimeConfig`, so specifically re-check that a missing `campo-runtime.json` or one without a `demo` field still renders the existing "Demo no iniciada" / unavailable states exactly as before).

Record actual findings from this step (not a prediction) in the final report to the user.

- [ ] **Step 7: `git status` review before any final commit**

Run: `git status` and `git diff --stat main`
Confirm nothing unexpected is staged (no `node_modules`, no `.env`, no real data file). This plan's individual tasks already commit incrementally — this step is a final sanity pass, not a place to `git add -A`.

---

## Execution Handoff

Given the plan's independent, product-scoped task groups (Parts A/B/C can run in parallel once Part A's pattern is validated; Part D depends on B and C's hostnames but not their internals), **subagent-driven-development** is the better fit here and is what this plan will use — a fresh subagent per task with two-stage review between tasks, rather than one long inline session. Tasks 1–3 (LiDAR) go first to validate the demo-mode pattern once; Tasks 4–8 (Forestry) and 9–12 (Transelec) can then run as two parallel tracks; Tasks 13–20 are sequential and come last.
