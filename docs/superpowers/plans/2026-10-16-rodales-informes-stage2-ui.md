# Rodales management reports — Stage 2 (screens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Rodales screens for management reports: a list («Informes»),
an editor (select, copy/paste, split with a polyline, mark, edit, save,
submit) and a review view (change list, «Pedir cambios», «Aprobar»), on top
of the stage 1 API.

**Architecture:** Pure modules carry the logic and are unit-tested: the API
client (`reportsApi.ts`), the JSTS split (`splitGeometry.ts`), the report
draft model with undo/redo (`reportDraft.ts`, `history.ts`) and the plain
Spanish change list (`reportChanges.ts`). Two pages compose them; one
Leaflet component (`ReportMap.tsx`) draws the report's base, the report and
the split interaction. Page tests stub the map; the map is verified in a
browser.

**Tech Stack:** React 19, TypeScript (strict, `noUncheckedIndexedAccess`),
Vite, Vitest + Testing Library, Leaflet 1.9, proj4, JSTS 2.12 (new).

**Spec:** `docs/superpowers/specs/2026-10-16-rodales-informes-de-manejo-design.md`
(stage 1 API: `products/forestry/docs/management-reports-v1.md`).

## Global Constraints

- Spanish UI copy; English code and docs. Labels as in the design: «Informes», «Nuevo informe», «Seleccionar», «Copiar», «Pegar al informe», «Dividir con línea», «Terminar línea», «Toca la parte que se cosecha», «Ninguna por ahora», «Guardar», «Enviar a revisión», «Pedir cambios», «Aprobar», «Mostrar base original», «Duplicar como borrador», «Exportar».
- Geometry in the client is EPSG:32718 metres, exactly as the API serves it; Leaflet draws reprojected copies (`utmToLonLat`); edits never round-trip through lat/lon (clicked points are converted once with `lonLatToUtm`).
- Untouched copies are sent with `geometry: null`; only split pieces carry coordinates.
- After a split with a chosen managed part: exactly two features per split rodal — the managed union (new code, `in_report: true`) and the rest union (original code, `in_report: false`). New code = next free `-N` suffix of the root code in the report (`17` → `17-1`, then `17-2`).
- Roles: editors are `operator` and `admin` (`canUpload`); only `admin` approves, requests changes and archives. Viewers see approved reports read-only and **no review notes** (user question pending; default chosen here).
- The editor shows the report's own base snapshot (`/snapshots/{base}/feature-collection`), not necessarily the published one.
- Platform palette and components (`button`, `notice`, `data-table`, `page`, `dialog`); light theme only, like the rest of the dashboard; keyboard focus visible.
- No new runtime dependency besides `jsts@2.12.1`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings against the spec (made while planning)

1. **«Copiar» / «Pegar al informe» use a session clipboard** (`sessionStorage`, keyed by base snapshot) so polygons copied in one report can be pasted into another report on the same base; paste skips polygons already in the report (a duplicate would be refused as `overlap`).
2. **One line splits every report polygon it crosses** (or only the selected ones); the choose step then lists the pieces of every split rodal and each tap toggles a piece as managed.
3. **Choosing every piece as managed** marks the whole rodal instead of splitting it; **«Ninguna por ahora»** keeps the pieces as separate unmarked features with the original code.
4. **Viewers never see notes** (decided here pending the user's answer; the API still returns them).
5. **No snapping, no vertex editing, no drawing new polygons** (spec out of scope).

## Review Focus

- A line that ends inside a rodal, or splits it into a piece under 1 m², must explain itself and leave the report unchanged — Task 3 tests `not_crossing`, `too_small`.
- Paste of a polygon already in the report must be skipped with a message, never sent (the server would refuse the whole save) — Task 4 `pasteOrdinals skips ordinals already in the report`.
- Unsaved edits must survive a failed save and must not be lost on «Enviar a revisión» (save first, then submit) — Task 7 `submits after saving unsaved changes` and `keeps the draft when a save fails`.
- `stale_revision` must offer «Recargar» instead of silently overwriting — Task 7 `offers reload on stale_revision`.
- Undo after a split must restore the exact previous feature set (including codes) — Task 4 `undo restores the feature set before a split`.

## File Structure

| File | Responsibility |
|---|---|
| Modify `src/api.ts` | `mutate` gains methods, 204 and structured `{code, message}` errors; export `getJson`, `mutate` |
| Create `src/reportsApi.ts` | report types, labels and API calls |
| Modify `src/router.ts`, `src/Root.tsx`, `src/components/Header.tsx`; `apps/api/app/main.py` | routes `/rodales/informes`, `/rodales/informes/editar?informe=<id>`; nav «Informes» |
| Create `src/types/jsts.d.ts`, `src/lib/splitGeometry.ts` | JSTS polyline split, union, crossing test |
| Create `src/lib/history.ts`, `src/lib/reportDraft.ts` | draft model, codes, save payload, undo/redo |
| Create `src/lib/reportChanges.ts` | plain-Spanish change list |
| Create `src/pages/InformesPage.tsx` | list + «Nuevo informe» |
| Create `src/components/ReportMap.tsx` | Leaflet map for the editor and review |
| Create `src/pages/InformeEditorPage.tsx` | editor, review, export |
| Create `src/reports.css` (imported in `main.tsx`) | layout and styles |
| Tests | `src/reportsApi.test.ts`, `src/lib/splitGeometry.test.ts`, `src/lib/reportDraft.test.ts`, `src/lib/reportChanges.test.ts`, `src/reports.test.tsx` |
| Docs | `products/forestry/docs/management-reports-v1.md` (status), `products/forestry/docs/es/informes-de-manejo.md` (Spanish) |

## Commands used throughout

From `products/forestry/dashboard`: `npx vitest run <file>`, `npm run lint`, `npx tsc -b`, `npm run build`. From the repo root: `make forestry-frontend-check`, `uv run --extra api --extra transelec pytest -q apps/api/tests/test_dashboard_static.py`.

---

### Task 1: API client for reports

**Files:**
- Modify: `products/forestry/dashboard/src/api.ts` (`ApiError`, `getJson`, `mutate`)
- Create: `products/forestry/dashboard/src/reportsApi.ts`
- Test: `products/forestry/dashboard/src/reportsApi.test.ts`

**Interfaces:**
- Produces: `ApiError.sourceFeatureOrdinal: number | null`; exported `getJson<T>(path)` and `mutate<T>(path, init & { method? })` (204 → `undefined`); from `reportsApi.ts`: types `ReportType`, `ReportStatus`, `Report`, `ReportList`, `ReportFeature`, `ReportSource`, `ReportNote`, `ReportDetail`, `SaveFeatureInput`, `ReportWarning`, `SaveResult`, `StatusResult`, `ReportAction`; constants `TYPE_LABELS`, `STATUS_LABELS`, `REPORT_TYPES`, `EDITABLE_STATUSES`; functions `fetchReports()`, `fetchReport(id)`, `createReport(name, type, month)`, `saveReportFeatures(id, revision, features)`, `updateReport(id, revision, changes)`, `transitionReport(id, action, revision, note?)`, `duplicateReport(id)`, `deleteReport(id)`, `exportUrl(id, format, scope)`, `isEditableStatus(status)`.

- [ ] **Step 1: Write the failing tests**

Create `src/reportsApi.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, resetCsrfForTests } from './api.ts'
import {
  createReport,
  deleteReport,
  exportUrl,
  fetchReports,
  saveReportFeatures,
  transitionReport,
} from './reportsApi.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  resetCsrfForTests()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function csrfThen(...responses: Response[]): void {
  fetchMock.mockResolvedValueOnce(json({ csrf_token: 't', header_name: 'X-CSRF-Token' }))
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
}

describe('reports API', () => {
  it('lists reports', async () => {
    fetchMock.mockResolvedValueOnce(json({ reports: [], pending_review_count: 2 }))
    await expect(fetchReports()).resolves.toEqual({ reports: [], pending_review_count: 2 })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/forestry/reports')
  })

  it('creates a report with POST and the CSRF header', async () => {
    csrfThen(json({ report_id: 7 }, 201))
    await expect(createReport('Cosecha', 'cosecha', '2027-01')).resolves.toBe(7)
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('/api/forestry/reports')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('t')
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'Cosecha',
      report_type: 'cosecha',
      report_month: '2027-01',
    })
  })

  it('saves features with PUT on the fixed path', async () => {
    csrfThen(json({ revision: 3, feature_count: 1, warnings: [] }))
    await saveReportFeatures(7, 2, [
      { source_feature_ordinal: 1, in_report: true, attributes: {}, geometry: null },
    ])
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('/api/forestry/reports/features')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toMatchObject({ report_id: 7, revision: 2 })
  })

  it('reads a structured error: code, Spanish message and polygon', async () => {
    csrfThen(
      json(
        {
          detail: {
            code: 'split_coverage',
            message: 'Las partes no cubren el rodal.',
            source_feature_ordinal: 4,
          },
        },
        422,
      ),
    )
    const error = await saveReportFeatures(7, 2, []).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 422,
      reason: 'split_coverage',
      detail: 'Las partes no cubren el rodal.',
      sourceFeatureOrdinal: 4,
    })
  })

  it('posts transitions to the action path', async () => {
    csrfThen(json({ report_id: 7, status: 'cambios_solicitados', revision: 4 }))
    await transitionReport(7, 'request-changes', 3, 'Saca el 18.')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('/api/forestry/reports/7/request-changes')
    expect(JSON.parse(String(init?.body))).toEqual({ revision: 3, note: 'Saca el 18.' })
  })

  it('treats 204 as success', async () => {
    csrfThen(new Response(null, { status: 204 }))
    await expect(deleteReport(7)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })

  it('builds export links', () => {
    expect(exportUrl(7, 'shp', 'all')).toBe('/api/forestry/reports/7/export?format=shp&scope=all')
    expect(exportUrl(7, 'csv', 'marked')).toBe(
      '/api/forestry/reports/7/export?format=csv&scope=marked',
    )
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/reportsApi.test.ts`
Expected: FAIL — `Failed to resolve import "./reportsApi.ts"`.

- [ ] **Step 3: Generalize `api.ts`**

In `src/api.ts`:

1. Replace the `ApiError` class with:

```ts
export class ApiError extends Error {
  readonly status: number
  readonly detail: string | null
  readonly reason: string | null
  readonly sourceFeatureOrdinal: number | null

  constructor(
    status: number,
    message: string,
    detail: string | null = null,
    reason: string | null = null,
    sourceFeatureOrdinal: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.reason = reason
    this.sourceFeatureOrdinal = sourceFeatureOrdinal
  }
}
```

2. Change `async function getJson<T>` to `export async function getJson<T>`.

3. Replace the whole `mutate` function with:

```ts
type MutationInit = RequestInit & { method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE' }

export async function mutate<T>(path: string, init: MutationInit, retried = false): Promise<T> {
  const token = await csrfHeader()
  const headers = new Headers(init.headers)
  headers.set(token.header, token.token)
  headers.set('Accept', 'application/json')

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      method: init.method ?? 'POST',
      headers,
    })
  } catch {
    throw new ApiError(0, 'network unreachable')
  }

  if (response.ok) {
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  let detail: string | null = null
  let reason: string | null = null
  let sourceFeatureOrdinal: number | null = null
  try {
    const body = (await response.json()) as { detail?: unknown; reason?: unknown }
    if (typeof body.detail === 'string') {
      detail = body.detail
    } else if (typeof body.detail === 'object' && body.detail !== null) {
      // Management reports answer {code, message, source_feature_ordinal?}.
      const structured = body.detail as {
        code?: unknown
        message?: unknown
        source_feature_ordinal?: unknown
      }
      detail = typeof structured.message === 'string' ? structured.message : null
      reason = typeof structured.code === 'string' ? structured.code : null
      sourceFeatureOrdinal =
        typeof structured.source_feature_ordinal === 'number'
          ? structured.source_feature_ordinal
          : null
    }
    if (reason === null && typeof body.reason === 'string') reason = body.reason
  } catch {
    // Not JSON (a proxy error page): keep the status only.
  }

  // A token minted for an earlier session: fetch a fresh one once.
  if (response.status === 403 && detail === CSRF_REJECTED && !retried) {
    csrf = null
    return mutate<T>(path, init, true)
  }

  throw new ApiError(
    response.status,
    `request failed (${response.status})`,
    detail,
    reason,
    sourceFeatureOrdinal,
  )
}
```

- [ ] **Step 4: Create `src/reportsApi.ts`**

```ts
/**
 * Rodales management reports (informes de manejo): types and calls for
 * /api/forestry/reports (stage 1 API, products/forestry/docs/management-reports-v1.md).
 * Geometry is EPSG:32718 metres, exactly as served.
 */
import { getJson, mutate } from './api.ts'
import type { MultiPolygonGeometry } from './types.ts'

export type ReportType = 'cosecha' | 'manejo' | 'reforestacion' | 'plantacion' | 'otro'
export type ReportStatus =
  | 'borrador'
  | 'enviado'
  | 'aprobado'
  | 'cambios_solicitados'
  | 'archivado'
export type ReportAction = 'submit' | 'approve' | 'request-changes' | 'archive'
export type ExportFormat = 'shp' | 'gpkg' | 'csv'
export type ExportScope = 'all' | 'marked'

export const REPORT_TYPES: ReportType[] = [
  'cosecha',
  'manejo',
  'reforestacion',
  'plantacion',
  'otro',
]

export const TYPE_LABELS: Record<ReportType, string> = {
  cosecha: 'Cosecha',
  manejo: 'Manejo',
  reforestacion: 'Reforestación',
  plantacion: 'Plantación',
  otro: 'Otro',
}

export const STATUS_LABELS: Record<ReportStatus, string> = {
  borrador: 'Borrador',
  enviado: 'Enviado',
  aprobado: 'Aprobado',
  cambios_solicitados: 'Cambios solicitados',
  archivado: 'Archivado',
}

export const EDITABLE_STATUSES: ReportStatus[] = ['borrador', 'cambios_solicitados']

export function isEditableStatus(status: ReportStatus): boolean {
  return EDITABLE_STATUSES.includes(status)
}

export type Attributes = Record<string, string | number | boolean | null>

export interface Report {
  report_id: number
  name: string
  report_type: ReportType
  report_month: string
  status: ReportStatus
  base_snapshot_id: number
  revision: number
  created_by_display_name: string
  created_at: string
  updated_at: string
  submitted_at: string | null
  decided_at: string | null
  decided_by_display_name: string | null
  feature_count: number
  managed_feature_count: number
  managed_area_ha: number
}

export interface ReportList {
  reports: Report[]
  pending_review_count: number
}

export interface ReportFeature {
  position: number
  source_feature_ordinal: number
  in_report: boolean
  geometry_changed: boolean
  attributes: Attributes
  geometry: MultiPolygonGeometry
}

export interface ReportSource {
  source_feature_ordinal: number
  attributes: Attributes
  geometry: MultiPolygonGeometry
  is_valid: boolean
}

export interface ReportNote {
  kind: 'cambios_solicitados' | 'aprobado'
  body: string
  author_display_name: string
  created_at: string
}

export interface ReportDetail {
  report: Report
  features: ReportFeature[]
  sources: ReportSource[]
  notes: ReportNote[]
  srid: number
  published_snapshot_id: number | null
}

export interface SaveFeatureInput {
  source_feature_ordinal: number
  in_report: boolean
  attributes: Record<string, string | null>
  geometry: MultiPolygonGeometry | null
}

export interface ReportWarning {
  code: string
  message: string
  source_feature_ordinal: number | null
}

export interface SaveResult {
  revision: number
  feature_count: number
  warnings: ReportWarning[]
}

export interface StatusResult {
  report_id: number
  status: ReportStatus
  revision: number
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function fetchReports(): Promise<ReportList> {
  return getJson<ReportList>('/reports')
}

export function fetchReport(reportId: number): Promise<ReportDetail> {
  return getJson<ReportDetail>(`/reports/${reportId}`)
}

export async function createReport(
  name: string,
  reportType: ReportType,
  reportMonth: string,
): Promise<number> {
  const created = await mutate<{ report_id: number }>('/reports', {
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, report_type: reportType, report_month: reportMonth }),
  })
  return created.report_id
}

export function saveReportFeatures(
  reportId: number,
  revision: number,
  features: SaveFeatureInput[],
): Promise<SaveResult> {
  return mutate<SaveResult>('/reports/features', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ report_id: reportId, revision, features }),
  })
}

export function updateReport(
  reportId: number,
  revision: number,
  changes: { name?: string; report_type?: ReportType; report_month?: string },
): Promise<StatusResult> {
  return mutate<StatusResult>(`/reports/${reportId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ revision, ...changes }),
  })
}

export function transitionReport(
  reportId: number,
  action: ReportAction,
  revision: number,
  note?: string,
): Promise<StatusResult> {
  return mutate<StatusResult>(`/reports/${reportId}/${action}`, {
    headers: JSON_HEADERS,
    body: JSON.stringify(note === undefined ? { revision } : { revision, note }),
  })
}

export async function duplicateReport(reportId: number): Promise<number> {
  const created = await mutate<{ report_id: number }>(`/reports/${reportId}/duplicate`, {})
  return created.report_id
}

export function deleteReport(reportId: number): Promise<void> {
  return mutate<void>(`/reports/${reportId}`, { method: 'DELETE' })
}

export function exportUrl(reportId: number, format: ExportFormat, scope: ExportScope): string {
  return `/api/forestry/reports/${reportId}/export?format=${format}&scope=${scope}`
}
```

- [ ] **Step 5: Run the tests (new and existing)**

Run: `npx vitest run src/reportsApi.test.ts src/api.workflow.test.ts`
Expected: all pass (7 new; the existing workflow API tests still pass).

- [ ] **Step 6: Commit**

```bash
git add products/forestry/dashboard/src/api.ts products/forestry/dashboard/src/reportsApi.ts products/forestry/dashboard/src/reportsApi.test.ts
git commit -m "feat(rodales): API client for management reports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Routes and navigation

**Files:**
- Modify: `products/forestry/dashboard/src/router.ts` (`ROUTES`, helpers)
- Modify: `products/forestry/dashboard/src/components/Header.tsx` (`NAV`)
- Modify: `products/forestry/dashboard/src/Root.tsx` (switch)
- Modify: `apps/api/app/main.py` (`RODALES_SPA_PAGE_PATHS`)
- Test: `products/forestry/dashboard/src/reports.test.tsx` (created here, extended later); `apps/api/tests/test_dashboard_static.py` (existing)

**Interfaces:**
- Produces: `ROUTES.informes = '/rodales/informes'`, `ROUTES.informe = '/rodales/informes/editar'`; `reportParam(search): number | null`; `reportPath(id): string`. Pages `InformesPage({ role })` and `InformeEditorPage({ role, reportId })` are created in Tasks 6 and 8; this task adds placeholders exported from those files so Root compiles.

- [ ] **Step 1: Write the failing test**

Create `src/reports.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Root from './Root.tsx'
import { reportParam, reportPath } from './router.ts'

vi.mock('./api.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api.ts')>()
  return { ...original, fetchForestryRole: vi.fn() }
})
vi.mock('./App.tsx', () => ({ default: () => <p>mapa-stub</p> }))
vi.mock('./pages/InformesPage.tsx', () => ({ InformesPage: () => <p>informes-stub</p> }))
vi.mock('./pages/InformeEditorPage.tsx', () => ({
  InformeEditorPage: ({ reportId }: { reportId: number | null }) => <p>editor-stub {reportId}</p>,
}))

const api = vi.mocked(await import('./api.ts'))

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchForestryRole.mockResolvedValue('operator')
})

afterEach(() => {
  window.history.replaceState(null, '', '/rodales/')
})

describe('report routes', () => {
  it('parses and builds the editor link', () => {
    expect(reportParam(new URLSearchParams('informe=12'))).toBe(12)
    expect(reportParam(new URLSearchParams('informe=x'))).toBeNull()
    expect(reportPath(12)).toBe('/rodales/informes/editar?informe=12')
  })

  it('routes /rodales/informes to the list', async () => {
    window.history.replaceState(null, '', '/rodales/informes')
    render(<Root />)
    expect(await screen.findByText('informes-stub')).toBeInTheDocument()
  })

  it('routes the editor with its report id', async () => {
    window.history.replaceState(null, '', '/rodales/informes/editar?informe=5')
    render(<Root />)
    expect(await screen.findByText('editor-stub 5')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/reports.test.tsx`
Expected: FAIL — `reportParam` is not exported (and the page modules do not exist).

- [ ] **Step 3: Implement**

`src/router.ts` — extend `ROUTES` and add helpers:

```ts
export const ROUTES = {
  mapa: '/rodales',
  versiones: '/rodales/versiones',
  importar: '/rodales/importar',
  revision: '/rodales/revision',
  informes: '/rodales/informes',
  informe: '/rodales/informes/editar',
} as const
```

```ts
/** `?informe=<id>` as a positive integer, or null. */
export function reportParam(search: URLSearchParams): number | null {
  const raw = search.get('informe')
  if (raw === null || !/^[1-9][0-9]*$/.test(raw)) return null
  return Number(raw)
}

export function reportPath(reportId: number): string {
  return `${ROUTES.informe}?informe=${reportId}`
}
```

`src/components/Header.tsx` — add after the «Versiones» entry of `NAV`:

```ts
  { route: ROUTES.informes, href: ROUTES.informes, label: 'Informes', uploadersOnly: false },
```

and change the `aria-current` test so the editor also highlights «Informes»:

```tsx
              aria-current={
                item.route === active ||
                (item.route === ROUTES.informes && active === ROUTES.informe)
                  ? 'page'
                  : undefined
              }
```

`src/Root.tsx` — import the pages and `reportParam`, and add before `default:`:

```tsx
    case ROUTES.informes:
      return <InformesPage role={role} />
    case ROUTES.informe:
      return (
        <InformeEditorPage
          key={location.search.toString()}
          role={role}
          reportId={reportParam(location.search)}
        />
      )
```

Create placeholders so the app compiles until Tasks 6 and 8 replace them:

`src/pages/InformesPage.tsx`:

```tsx
import type { ForestryRole } from '../types.ts'

export function InformesPage(_props: { role: ForestryRole }) {
  return null
}
```

`src/pages/InformeEditorPage.tsx`:

```tsx
import type { ForestryRole } from '../types.ts'

export function InformeEditorPage(_props: { role: ForestryRole; reportId: number | null }) {
  return null
}
```

`apps/api/app/main.py` — extend `RODALES_SPA_PAGE_PATHS`:

```python
RODALES_SPA_PAGE_PATHS = frozenset(
    {
        "rodales",
        "rodales/versiones",
        "rodales/importar",
        "rodales/revision",
        "rodales/informes",
        "rodales/informes/editar",
    }
)
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/reports.test.tsx src/workflow.test.tsx src/App.test.tsx`
Expected: PASS.
Run (repo root): `uv run --extra api --extra transelec pytest -q apps/api/tests/test_dashboard_static.py`
Expected: PASS (the route/path consistency test sees both new paths). If a test enumerates `RODALES_PAGES` for reload checks, add the two new paths to it.

- [ ] **Step 5: Commit**

```bash
git add products/forestry/dashboard/src apps/api/app/main.py apps/api/tests/test_dashboard_static.py
git commit -m "feat(rodales): routes and navigation for management reports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Polyline split with JSTS

**Files:**
- Modify: `products/forestry/dashboard/package.json`, `package-lock.json` (`jsts@2.12.1`)
- Create: `products/forestry/dashboard/src/types/jsts.d.ts`
- Create: `products/forestry/dashboard/src/lib/splitGeometry.ts`
- Test: `products/forestry/dashboard/src/lib/splitGeometry.test.ts`

**Interfaces:**
- Produces: `type Coordinates = number[][][][]`, `type Position = [number, number]`; `type SplitFailure = 'too_short' | 'not_crossing' | 'invalid_source' | 'too_small' | 'unreadable'`; `type SplitResult = { ok: true; pieces: Coordinates[] } | { ok: false; reason: SplitFailure }`; `splitByPolyline(coordinates, line): SplitResult`; `unionPieces(pieces: Coordinates[]): Coordinates`; `lineCrosses(coordinates, line): boolean`; `SPLIT_MESSAGES: Record<SplitFailure, string>`; `MIN_PIECE_M2 = 1`.

- [ ] **Step 1: Add the dependency**

Run (in `products/forestry/dashboard`): `npm install jsts@2.12.1 --save-exact`
Expected: `package.json` lists `"jsts": "2.12.1"` under `dependencies`.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/splitGeometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { multiPolygonAreaSquareMeters } from './draftGeometry.ts'
import { lineCrosses, splitByPolyline, unionPieces, type Coordinates } from './splitGeometry.ts'

const SQUARE: Coordinates = [[[[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]]]]
const HOLED: Coordinates = [
  [
    [[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]],
    [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]],
  ],
]
const TWO_PARTS: Coordinates = [
  [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]],
  [[[20, 0], [20, 10], [30, 10], [30, 0], [20, 0]]],
]
const BOWTIE: Coordinates = [[[[0, 0], [100, 100], [0, 100], [100, 0], [0, 0]]]]

const area = (pieces: Coordinates[]) =>
  pieces.map((piece) => Math.round(multiPolygonAreaSquareMeters(piece)))

describe('splitByPolyline', () => {
  it('splits a square with a bent line into two pieces that add up', () => {
    const result = splitByPolyline(SQUARE, [[50, -10], [55, 30], [45, 70], [50, 110]])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pieces).toHaveLength(2)
    expect(area(result.pieces).reduce((a, b) => a + b, 0)).toBe(10_000)
  })

  it('keeps the hole out of both pieces', () => {
    const result = splitByPolyline(HOLED, [[50, -10], [50, 110]])
    expect(result.ok && area(result.pieces)).toEqual([4800, 4800])
  })

  it('splits one part of a multipart rodal and keeps the other as its own piece', () => {
    const result = splitByPolyline(TWO_PARTS, [[5, -1], [5, 11]])
    expect(result.ok && area(result.pieces).sort((a, b) => a - b)).toEqual([50, 50, 100])
  })

  it('makes three pieces when the line crosses twice', () => {
    const result = splitByPolyline(SQUARE, [[-10, 20], [110, 20], [110, 40], [-10, 40]])
    expect(result.ok && result.pieces).toHaveLength(3)
  })

  it('explains a line that ends inside the rodal', () => {
    expect(splitByPolyline(SQUARE, [[50, -10], [50, 50]])).toEqual({
      ok: false,
      reason: 'not_crossing',
    })
  })

  it('refuses a single point', () => {
    expect(splitByPolyline(SQUARE, [[50, -10]])).toEqual({ ok: false, reason: 'too_short' })
  })

  it('refuses a piece under 1 m²', () => {
    expect(splitByPolyline(SQUARE, [[0.5, -1], [0.5, 1.5], [-1, 1.5]])).toEqual({
      ok: false,
      reason: 'too_small',
    })
  })

  it('refuses to split an invalid base polygon', () => {
    expect(splitByPolyline(BOWTIE, [[50, -10], [50, 110]])).toEqual({
      ok: false,
      reason: 'invalid_source',
    })
  })
})

describe('unionPieces and lineCrosses', () => {
  it('reunites pieces into the original area', () => {
    const result = splitByPolyline(SQUARE, [[50, -10], [50, 110]])
    if (!result.ok) throw new Error('split failed')
    expect(Math.round(multiPolygonAreaSquareMeters(unionPieces(result.pieces)))).toBe(10_000)
  })

  it('tells whether a line touches a polygon', () => {
    expect(lineCrosses(SQUARE, [[50, -10], [50, 110]])).toBe(true)
    expect(lineCrosses(SQUARE, [[200, -10], [200, 110]])).toBe(false)
  })
})
```

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run src/lib/splitGeometry.test.ts`
Expected: FAIL — cannot resolve `./splitGeometry.ts`.

- [ ] **Step 4: Type declarations for the JSTS modules we use**

Create `src/types/jsts.d.ts`:

```ts
// Minimal types for the JSTS 2.12 modules Rodales uses (the package ships
// none). Methods are added to Geometry by 'jsts/org/locationtech/jts/monkey.js'.
interface JstsGeometry {
  getBoundary(): JstsGeometry
  union(other: JstsGeometry): JstsGeometry
  contains(other: JstsGeometry): boolean
  intersects(other: JstsGeometry): boolean
  getInteriorPoint(): JstsGeometry
  getArea(): number
  isValid(): boolean
}

declare module 'jsts/org/locationtech/jts/monkey.js' {}

declare module 'jsts/org/locationtech/jts/io/GeoJSONReader.js' {
  export default class GeoJSONReader {
    read(geometry: object): JstsGeometry
  }
}

declare module 'jsts/org/locationtech/jts/io/GeoJSONWriter.js' {
  export default class GeoJSONWriter {
    write(geometry: JstsGeometry): { type: string; coordinates: unknown }
  }
}

declare module 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js' {
  export default class Polygonizer {
    add(geometry: JstsGeometry): void
    getPolygons(): { toArray(): JstsGeometry[] }
  }
}
```

- [ ] **Step 5: Implement the split**

Create `src/lib/splitGeometry.ts`:

```ts
/**
 * «Dividir con línea»: split a rodal with a polyline (QGIS «Dividir objetos
 * espaciales»), in EPSG:32718 metres, with JSTS.
 *
 * The polygon's boundary and the line are noded together, the result is
 * polygonized, and the faces inside the original polygon are the pieces
 * (holes stay holes; untouched parts of a multipart rodal become their own
 * pieces). The server re-checks every piece on save.
 */
import 'jsts/org/locationtech/jts/monkey.js'
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js'
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js'

export type Coordinates = number[][][][]
export type Position = [number, number]
export type SplitFailure = 'too_short' | 'not_crossing' | 'invalid_source' | 'too_small' | 'unreadable'
export type SplitResult = { ok: true; pieces: Coordinates[] } | { ok: false; reason: SplitFailure }

export const MIN_PIECE_M2 = 1

export const SPLIT_MESSAGES: Record<SplitFailure, string> = {
  too_short: 'Haga clic en al menos dos puntos para dibujar la línea.',
  not_crossing: 'La línea debe cruzar el rodal de lado a lado.',
  invalid_source: 'Esta geometría tiene un error en la base original; corríjanla en ArcMap.',
  too_small: 'Una de las partes es demasiado pequeña (menos de 1 m²). Ajuste la línea.',
  unreadable: 'No se pudo leer la forma del rodal.',
}

const reader = new GeoJSONReader()
const writer = new GeoJSONWriter()

function toCoordinates(geometry: JstsGeometry): Coordinates {
  const written = writer.write(geometry)
  if (written.type === 'Polygon') return [written.coordinates as number[][][]]
  return written.coordinates as Coordinates
}

function readPolygon(coordinates: Coordinates): JstsGeometry {
  return reader.read({ type: 'MultiPolygon', coordinates })
}

export function splitByPolyline(coordinates: Coordinates, line: Position[]): SplitResult {
  if (line.length < 2) return { ok: false, reason: 'too_short' }

  let polygon: JstsGeometry
  let cut: JstsGeometry
  try {
    polygon = readPolygon(coordinates)
    cut = reader.read({ type: 'LineString', coordinates: line })
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  if (!polygon.isValid()) return { ok: false, reason: 'invalid_source' }

  const polygonizer = new Polygonizer()
  polygonizer.add(polygon.getBoundary().union(cut))
  const faces = polygonizer
    .getPolygons()
    .toArray()
    .filter((face) => polygon.contains(face.getInteriorPoint()))

  if (faces.length < 2) return { ok: false, reason: 'not_crossing' }
  if (faces.some((face) => face.getArea() < MIN_PIECE_M2)) return { ok: false, reason: 'too_small' }
  return { ok: true, pieces: faces.map(toCoordinates) }
}

export function unionPieces(pieces: Coordinates[]): Coordinates {
  const [first, ...rest] = pieces.map(readPolygon)
  if (first === undefined) return []
  return toCoordinates(rest.reduce((joined, piece) => joined.union(piece), first))
}

export function lineCrosses(coordinates: Coordinates, line: Position[]): boolean {
  if (line.length < 2) return false
  try {
    return readPolygon(coordinates).intersects(
      reader.read({ type: 'LineString', coordinates: line }),
    )
  } catch {
    return false
  }
}
```

- [ ] **Step 6: Run the tests, types and lint**

Run: `npx vitest run src/lib/splitGeometry.test.ts && npx tsc -b && npm run lint`
Expected: 10 passed; no type or lint errors.

- [ ] **Step 7: Commit**

```bash
git add products/forestry/dashboard/package.json products/forestry/dashboard/package-lock.json products/forestry/dashboard/src/types/jsts.d.ts products/forestry/dashboard/src/lib/splitGeometry.ts products/forestry/dashboard/src/lib/splitGeometry.test.ts
git commit -m "feat(rodales): split a rodal with a polyline (JSTS)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Report draft model and undo/redo

**Files:**
- Create: `products/forestry/dashboard/src/lib/history.ts`
- Create: `products/forestry/dashboard/src/lib/reportDraft.ts`
- Test: `products/forestry/dashboard/src/lib/reportDraft.test.ts`

**Interfaces:**
- Consumes: `ReportDetail`, `Attributes`, `SaveFeatureInput` (Task 1); `Coordinates`, `unionPieces` (Task 3); `multiPolygonAreaSquareMeters` (`draftGeometry.ts`).
- Produces:
  - `history.ts`: `interface History<T> { past: T[]; future: T[] }`, `createHistory<T>()`, `recordHistory(history, previous)`, `undoHistory(history, current) → { history, value } | null`, `redoHistory(...)`, `MAX_HISTORY = 100`.
  - `reportDraft.ts`: `EDITABLE_ATTRIBUTES: { key: string; label: string; bytes: number }[]`; `interface DraftFeature { key: string; source_feature_ordinal: number; in_report: boolean; geometry_changed: boolean; attributes: Attributes; edits: Record<string, string | null>; coordinates: Coordinates }`; `interface ReportDraft { features: DraftFeature[]; nextKey: number }`; `interface PasteSource { ordinal: number; attributes: Attributes; coordinates: Coordinates }`; functions `draftFromDetail(detail)`, `pasteSources(draft, sources) → { draft, added, skipped }`, `applySplit(draft, key, pieces, managed: number[])`, `toggleInReport(draft, key)`, `setAttribute(draft, key, name, value)`, `removeSources(draft, ordinals)`, `nextRodalCode(root, draft)`, `toSaveFeatures(draft)`, `draftSummary(draft) → { count, managedCount, managedHa }`, `featureCode(feature)`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reportDraft.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createHistory, recordHistory, redoHistory, undoHistory } from './history.ts'
import {
  applySplit,
  draftFromDetail,
  draftSummary,
  nextRodalCode,
  pasteSources,
  removeSources,
  setAttribute,
  toSaveFeatures,
  toggleInReport,
  type ReportDraft,
} from './reportDraft.ts'
import { splitByPolyline, type Coordinates } from './splitGeometry.ts'
import type { ReportDetail } from '../reportsApi.ts'

const SQUARE: Coordinates = [[[[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]]]]
const OTHER: Coordinates = [[[[200, 0], [200, 100], [300, 100], [300, 0], [200, 0]]]]

function attributes(rodal: string, extra: Record<string, string | number | null> = {}) {
  return { objectid: 11, n_rodal: rodal, sup_ha: 1, cod_uso: 'Pi06', editada: null, ...extra }
}

function detail(): ReportDetail {
  return {
    report: {
      report_id: 7,
      name: 'Cosecha',
      report_type: 'cosecha',
      report_month: '2027-01',
      status: 'borrador',
      base_snapshot_id: 3,
      revision: 2,
      created_by_display_name: 'Marco',
      created_at: '2026-10-16T10:00:00Z',
      updated_at: '2026-10-16T10:00:00Z',
      submitted_at: null,
      decided_at: null,
      decided_by_display_name: null,
      feature_count: 1,
      managed_feature_count: 0,
      managed_area_ha: 0,
    },
    features: [
      {
        position: 1,
        source_feature_ordinal: 1,
        in_report: false,
        geometry_changed: false,
        attributes: attributes('17', { cod_uso: 'Eg03', editada: 'wb' }),
        geometry: { type: 'MultiPolygon', coordinates: SQUARE },
      },
    ],
    sources: [
      {
        source_feature_ordinal: 1,
        attributes: attributes('17'),
        geometry: { type: 'MultiPolygon', coordinates: SQUARE },
        is_valid: true,
      },
    ],
    notes: [],
    srid: 32718,
    published_snapshot_id: 3,
  }
}

function emptyDraft(): ReportDraft {
  return { features: [], nextKey: 1 }
}

function halves(): Coordinates[] {
  const result = splitByPolyline(SQUARE, [[60, -10], [60, 110]])
  if (!result.ok) throw new Error('split failed')
  return result.pieces
}

describe('report draft', () => {
  it('loads a saved report and remembers edits made before', () => {
    const draft = draftFromDetail(detail())
    expect(draft.features).toHaveLength(1)
    expect(draft.features[0]?.edits).toEqual({ cod_uso: 'Eg03' })
    expect(toSaveFeatures(draft)).toEqual([
      { source_feature_ordinal: 1, in_report: false, attributes: { cod_uso: 'Eg03' }, geometry: null },
    ])
  })

  it('pasteOrdinals skips ordinals already in the report', () => {
    const first = pasteSources(emptyDraft(), [{ ordinal: 1, attributes: attributes('17'), coordinates: SQUARE }])
    const second = pasteSources(first.draft, [
      { ordinal: 1, attributes: attributes('17'), coordinates: SQUARE },
      { ordinal: 2, attributes: attributes('18'), coordinates: OTHER },
    ])
    expect([second.added, second.skipped]).toEqual([1, 1])
    expect(second.draft.features.map((f) => f.source_feature_ordinal)).toEqual([1, 2])
  })

  it('a split with a managed piece leaves the managed union and the rest, with codes', () => {
    const pasted = pasteSources(emptyDraft(), [{ ordinal: 1, attributes: attributes('17'), coordinates: SQUARE }]).draft
    const key = pasted.features[0]?.key ?? ''
    const split = applySplit(pasted, key, halves(), [0])
    expect(split.features).toHaveLength(2)
    const managed = split.features.find((f) => f.in_report)
    const rest = split.features.find((f) => !f.in_report)
    expect(managed?.attributes.n_rodal).toBe('17-1')
    expect(managed?.edits).toEqual({ n_rodal: '17-1' })
    expect(rest?.attributes.n_rodal).toBe('17')
    expect(split.features.every((f) => f.geometry_changed)).toBe(true)
    expect(draftSummary(split).managedCount).toBe(1)
    expect(toSaveFeatures(split).every((f) => f.geometry !== null)).toBe(true)
  })

  it('a second split of the managed piece takes the next free code', () => {
    let draft = pasteSources(emptyDraft(), [{ ordinal: 1, attributes: attributes('17'), coordinates: SQUARE }]).draft
    draft = applySplit(draft, draft.features[0]?.key ?? '', halves(), [0])
    const managed = draft.features.find((f) => f.in_report)
    const again = splitByPolyline(managed?.coordinates ?? [], [[30, -10], [30, 110]])
    if (!again.ok) throw new Error('split failed')
    draft = applySplit(draft, managed?.key ?? '', again.pieces, [0])
    expect(draft.features.map((f) => f.attributes.n_rodal).sort()).toEqual(['17', '17-1', '17-2'])
  })

  it('«Ninguna por ahora» keeps the pieces unmarked with the original code', () => {
    const pasted = pasteSources(emptyDraft(), [{ ordinal: 1, attributes: attributes('17'), coordinates: SQUARE }]).draft
    const split = applySplit(pasted, pasted.features[0]?.key ?? '', halves(), [])
    expect(split.features.map((f) => [f.attributes.n_rodal, f.in_report])).toEqual([
      ['17', false],
      ['17', false],
    ])
  })

  it('choosing every piece marks the whole rodal instead of splitting it', () => {
    const pasted = pasteSources(emptyDraft(), [{ ordinal: 1, attributes: attributes('17'), coordinates: SQUARE }]).draft
    const split = applySplit(pasted, pasted.features[0]?.key ?? '', halves(), [0, 1])
    expect(split.features).toHaveLength(1)
    expect(split.features[0]?.in_report).toBe(true)
    expect(split.features[0]?.geometry_changed).toBe(false)
  })

  it('codes: next free suffix of the root; blank rodal stays blank', () => {
    const draft = pasteSources(emptyDraft(), [
      { ordinal: 1, attributes: attributes('17-1'), coordinates: SQUARE },
    ]).draft
    expect(nextRodalCode('17', draft)).toBe('17-2')
    expect(nextRodalCode('17-1', draft)).toBe('17-2')
    expect(nextRodalCode(null, draft)).toBeNull()
  })

  it('marks, edits and removes', () => {
    let draft = pasteSources(emptyDraft(), [
      { ordinal: 1, attributes: attributes('17'), coordinates: SQUARE },
      { ordinal: 2, attributes: attributes('18'), coordinates: OTHER },
    ]).draft
    const key = draft.features[0]?.key ?? ''
    draft = toggleInReport(draft, key)
    draft = setAttribute(draft, key, 'cod_uso', 'Eg03', 'Pi06')
    draft = setAttribute(draft, key, 'cod_uso', 'Pi06', 'Pi06')
    expect(draft.features[0]?.in_report).toBe(true)
    expect(draft.features[0]?.edits).toEqual({})
    draft = removeSources(draft, [2])
    expect(draft.features).toHaveLength(1)
  })

  it('undo restores the feature set before a split', () => {
    const before = pasteSources(emptyDraft(), [{ ordinal: 1, attributes: attributes('17'), coordinates: SQUARE }]).draft
    const after = applySplit(before, before.features[0]?.key ?? '', halves(), [0])
    const history = recordHistory(createHistory<ReportDraft>(), before)
    const undone = undoHistory(history, after)
    expect(undone?.value).toBe(before)
    const redone = redoHistory(undone?.history ?? createHistory(), before)
    expect(redone?.value).toBe(after)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/reportDraft.test.ts`
Expected: FAIL — cannot resolve `./history.ts`.

- [ ] **Step 3: Implement `history.ts`**

```ts
/** Undo/redo over immutable snapshots (the report draft is small). */
export const MAX_HISTORY = 100

export interface History<T> {
  past: T[]
  future: T[]
}

export function createHistory<T>(): History<T> {
  return { past: [], future: [] }
}

/** Record `previous` (the state right before a just-applied change). */
export function recordHistory<T>(history: History<T>, previous: T): History<T> {
  return { past: [...history.past, previous].slice(-MAX_HISTORY), future: [] }
}

export function undoHistory<T>(
  history: History<T>,
  current: T,
): { history: History<T>; value: T } | null {
  const value = history.past.at(-1)
  if (value === undefined) return null
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future] }, value }
}

export function redoHistory<T>(
  history: History<T>,
  current: T,
): { history: History<T>; value: T } | null {
  const value = history.future[0]
  if (value === undefined) return null
  return { history: { past: [...history.past, current], future: history.future.slice(1) }, value }
}
```

- [ ] **Step 4: Implement `reportDraft.ts`**

```ts
/**
 * The report being edited, as an immutable value: every operation returns a
 * new draft, so undo/redo is a stack of drafts (history.ts).
 *
 * Untouched polygons are sent without geometry (the server copies the base
 * exactly); split pieces carry their coordinates. After a split with a
 * chosen managed part there are exactly two features for that rodal: the
 * managed union with the next free code (17 → 17-1) and the rest, which
 * keeps the code (Javier, 2026-10-15).
 */
import { multiPolygonAreaSquareMeters } from './draftGeometry.ts'
import { unionPieces, type Coordinates } from './splitGeometry.ts'
import type { Attributes, ReportDetail, SaveFeatureInput } from '../reportsApi.ts'

/** What the web may change, with each field's DBF width in UTF-8 bytes. */
export const EDITABLE_ATTRIBUTES: { key: string; label: string; bytes: number }[] = [
  { key: 'n_rodal', label: 'N.º rodal', bytes: 10 },
  { key: 'cod_uso', label: 'Código de uso', bytes: 25 },
  { key: 'uso_2026', label: 'Uso 2026', bytes: 50 },
  { key: 'cod_uso_2026', label: 'Código de uso 2026', bytes: 25 },
  { key: 'uso_2024', label: 'Uso 2024', bytes: 50 },
  { key: 'desc_uso', label: 'Descripción', bytes: 50 },
  { key: 'n_rodal_te', label: 'N_Rodal_te', bytes: 3 },
]

const EDITABLE_KEYS = new Set(EDITABLE_ATTRIBUTES.map((attribute) => attribute.key))

export interface DraftFeature {
  key: string
  source_feature_ordinal: number
  in_report: boolean
  geometry_changed: boolean
  /** Everything shown in the panel (base values with the edits applied). */
  attributes: Attributes
  /** Editable values that differ from the base polygon (what is sent). */
  edits: Record<string, string | null>
  coordinates: Coordinates
}

export interface ReportDraft {
  features: DraftFeature[]
  nextKey: number
}

export interface PasteSource {
  ordinal: number
  attributes: Attributes
  coordinates: Coordinates
}

function textValue(value: Attributes[string] | undefined): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

export function featureCode(feature: { attributes: Attributes }): string | null {
  return textValue(feature.attributes.n_rodal)
}

export function draftFromDetail(detail: ReportDetail): ReportDraft {
  const base = new Map(detail.sources.map((source) => [source.source_feature_ordinal, source]))
  const features = detail.features.map((feature, index): DraftFeature => {
    const source = base.get(feature.source_feature_ordinal)
    const edits: Record<string, string | null> = {}
    for (const key of EDITABLE_KEYS) {
      const value = textValue(feature.attributes[key])
      if (source !== undefined && value !== textValue(source.attributes[key])) edits[key] = value
    }
    return {
      key: `f${index + 1}`,
      source_feature_ordinal: feature.source_feature_ordinal,
      in_report: feature.in_report,
      geometry_changed: feature.geometry_changed,
      attributes: feature.attributes,
      edits,
      coordinates: feature.geometry.coordinates,
    }
  })
  return { features, nextKey: features.length + 1 }
}

export function pasteSources(
  draft: ReportDraft,
  sources: PasteSource[],
): { draft: ReportDraft; added: number; skipped: number } {
  const present = new Set(draft.features.map((feature) => feature.source_feature_ordinal))
  let nextKey = draft.nextKey
  const added: DraftFeature[] = []
  let skipped = 0
  for (const source of sources) {
    if (present.has(source.ordinal)) {
      skipped += 1
      continue
    }
    present.add(source.ordinal)
    added.push({
      key: `f${nextKey}`,
      source_feature_ordinal: source.ordinal,
      in_report: false,
      geometry_changed: false,
      attributes: { ...source.attributes },
      edits: {},
      coordinates: source.coordinates,
    })
    nextKey += 1
  }
  return {
    draft: { features: [...draft.features, ...added], nextKey },
    added: added.length,
    skipped,
  }
}

/** Root code without a «-N» suffix: «17-1» → «17». */
function rootCode(code: string): string {
  return code.replace(/-\d+$/, '')
}

export function nextRodalCode(code: string | null, draft: ReportDraft): string | null {
  if (code === null || code.trim() === '') return null
  const root = rootCode(code)
  const taken = new Set(draft.features.map((feature) => featureCode(feature)))
  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const candidate = `${root}-${suffix}`
    if (new TextEncoder().encode(candidate).length > 10) return code
    if (!taken.has(candidate)) return candidate
  }
  return code
}

function withArea(attributes: Attributes, coordinates: Coordinates): Attributes {
  const area = multiPolygonAreaSquareMeters(coordinates)
  return { ...attributes, sup_ha: area / 10_000, shape_area: area }
}

/**
 * Replace the feature `key` by the result of a split. `managed` lists the
 * indexes of the pieces chosen as «área de manejo».
 */
export function applySplit(
  draft: ReportDraft,
  key: string,
  pieces: Coordinates[],
  managed: number[],
): ReportDraft {
  const index = draft.features.findIndex((feature) => feature.key === key)
  const feature = draft.features[index]
  if (feature === undefined || pieces.length < 2) return draft

  const chosen = new Set(managed.filter((piece) => piece >= 0 && piece < pieces.length))
  if (chosen.size === pieces.length) {
    return replaceAt(draft, index, [{ ...feature, in_report: true }], draft.nextKey)
  }

  let nextKey = draft.nextKey
  const makeKey = () => {
    const made = `f${nextKey}`
    nextKey += 1
    return made
  }

  if (chosen.size === 0) {
    const kept = pieces.map(
      (coordinates): DraftFeature => ({
        ...feature,
        key: makeKey(),
        in_report: false,
        geometry_changed: true,
        attributes: withArea(feature.attributes, coordinates),
        coordinates,
      }),
    )
    return replaceAt(draft, index, kept, nextKey)
  }

  const managedCoordinates = unionPieces(pieces.filter((_, piece) => chosen.has(piece)))
  const restCoordinates = unionPieces(pieces.filter((_, piece) => !chosen.has(piece)))
  const code = nextRodalCode(featureCode(feature), draft)
  const managedFeature: DraftFeature = {
    ...feature,
    key: makeKey(),
    in_report: true,
    geometry_changed: true,
    attributes: withArea({ ...feature.attributes, n_rodal: code }, managedCoordinates),
    edits: code === featureCode(feature) ? feature.edits : { ...feature.edits, n_rodal: code },
    coordinates: managedCoordinates,
  }
  const restFeature: DraftFeature = {
    ...feature,
    key: makeKey(),
    in_report: false,
    geometry_changed: true,
    attributes: withArea(feature.attributes, restCoordinates),
    coordinates: restCoordinates,
  }
  return replaceAt(draft, index, [managedFeature, restFeature], nextKey)
}

function replaceAt(
  draft: ReportDraft,
  index: number,
  replacement: DraftFeature[],
  nextKey: number,
): ReportDraft {
  return {
    features: [
      ...draft.features.slice(0, index),
      ...replacement,
      ...draft.features.slice(index + 1),
    ],
    nextKey,
  }
}

function updateFeature(
  draft: ReportDraft,
  key: string,
  change: (feature: DraftFeature) => DraftFeature,
): ReportDraft {
  return {
    ...draft,
    features: draft.features.map((feature) => (feature.key === key ? change(feature) : feature)),
  }
}

export function toggleInReport(draft: ReportDraft, key: string): ReportDraft {
  return updateFeature(draft, key, (feature) => ({ ...feature, in_report: !feature.in_report }))
}

/**
 * Change one editable attribute. `baseValue` is the base polygon's value:
 * an edit back to it is no longer an edit.
 */
export function setAttribute(
  draft: ReportDraft,
  key: string,
  name: string,
  value: string,
  baseValue: string | null,
): ReportDraft {
  if (!EDITABLE_KEYS.has(name)) return draft
  const clean = value.trim() === '' ? null : value.trim()
  return updateFeature(draft, key, (feature) => {
    const edits = { ...feature.edits }
    if (clean === baseValue) delete edits[name]
    else edits[name] = clean
    return { ...feature, attributes: { ...feature.attributes, [name]: clean }, edits }
  })
}

export function removeSources(draft: ReportDraft, ordinals: number[]): ReportDraft {
  const removed = new Set(ordinals)
  return {
    ...draft,
    features: draft.features.filter((feature) => !removed.has(feature.source_feature_ordinal)),
  }
}

export function toSaveFeatures(draft: ReportDraft): SaveFeatureInput[] {
  return draft.features.map((feature) => ({
    source_feature_ordinal: feature.source_feature_ordinal,
    in_report: feature.in_report,
    attributes: feature.edits,
    geometry: feature.geometry_changed
      ? { type: 'MultiPolygon', coordinates: feature.coordinates }
      : null,
  }))
}

export function draftSummary(draft: ReportDraft): {
  count: number
  managedCount: number
  managedHa: number
} {
  const managed = draft.features.filter((feature) => feature.in_report)
  return {
    count: draft.features.length,
    managedCount: managed.length,
    managedHa: managed.reduce((total, feature) => total + Number(feature.attributes.sup_ha ?? 0), 0),
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/reportDraft.test.ts && npx tsc -b && npm run lint`
Expected: 9 passed; no type or lint errors.

- [ ] **Step 6: Commit**

```bash
git add products/forestry/dashboard/src/lib/history.ts products/forestry/dashboard/src/lib/reportDraft.ts products/forestry/dashboard/src/lib/reportDraft.test.ts
git commit -m "feat(rodales): report draft model with codes and undo/redo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Plain-Spanish change list

**Files:**
- Create: `products/forestry/dashboard/src/lib/reportChanges.ts`
- Test: `products/forestry/dashboard/src/lib/reportChanges.test.ts`

**Interfaces:**
- Consumes: `Attributes` (Task 1); `EDITABLE_ATTRIBUTES` (Task 4).
- Produces: `interface ChangeItem { title: string; detail: string; ordinal: number }`; `describeChanges(features: { source_feature_ordinal: number; in_report: boolean; geometry_changed: boolean; attributes: Attributes }[], sources: { source_feature_ordinal: number; attributes: Attributes }[]): ChangeItem[]`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reportChanges.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { describeChanges } from './reportChanges.ts'

const base = (ordinal: number, rodal: string | null, extra = {}) => ({
  source_feature_ordinal: ordinal,
  attributes: { objectid: 10 + ordinal, n_rodal: rodal, cod_uso: 'Pi06', sup_ha: 8.09, ...extra },
})

describe('describeChanges', () => {
  it('describes a split with codes and hectares, managed piece first', () => {
    const changes = describeChanges(
      [
        { source_feature_ordinal: 1, in_report: false, geometry_changed: true, attributes: { n_rodal: '17', sup_ha: 4.04 } },
        { source_feature_ordinal: 1, in_report: true, geometry_changed: true, attributes: { n_rodal: '17-1', sup_ha: 4.05 } },
      ],
      [base(1, '17')],
    )
    expect(changes).toEqual([
      {
        ordinal: 1,
        title: 'Rodal 17 dividido en 2',
        detail: '17-1 (4,05 ha, área de manejo) · 17 (4,04 ha)',
      },
    ])
  })

  it('describes a whole rodal and an edited attribute', () => {
    const changes = describeChanges(
      [
        { source_feature_ordinal: 2, in_report: true, geometry_changed: false, attributes: { n_rodal: '21', sup_ha: 12.4, cod_uso: 'Eg03' } },
      ],
      [base(2, '21', { sup_ha: 12.4 })],
    )
    expect(changes.map((change) => change.title)).toEqual(['Rodal 21 agregado completo'])
    expect(changes[0]?.detail).toBe('12,40 ha · área de manejo · Código de uso: «Pi06» → «Eg03»')
  })

  it('names a polygon without rodal by its OBJECTID', () => {
    const changes = describeChanges(
      [{ source_feature_ordinal: 3, in_report: false, geometry_changed: false, attributes: { n_rodal: null, sup_ha: 2 } }],
      [base(3, null)],
    )
    expect(changes[0]?.title).toBe('Polígono 13 agregado completo')
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/reportChanges.test.ts`
Expected: FAIL — cannot resolve `./reportChanges.ts`.

- [ ] **Step 3: Implement**

```ts
/**
 * What a report changes, in words a reviewer reads without GIS: one item per
 * base polygon («Rodal 17 dividido en 2», «Rodal 21 agregado completo»),
 * with hectares, the management mark and edited fields.
 */
import { EDITABLE_ATTRIBUTES } from './reportDraft.ts'
import type { Attributes } from '../reportsApi.ts'

export interface ChangeItem {
  ordinal: number
  title: string
  detail: string
}

interface FeatureLike {
  source_feature_ordinal: number
  in_report: boolean
  geometry_changed: boolean
  attributes: Attributes
}

interface SourceLike {
  source_feature_ordinal: number
  attributes: Attributes
}

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function hectares(attributes: Attributes): string {
  return `${ha.format(Number(attributes.sup_ha ?? 0))} ha`
}

function text(value: Attributes[string] | undefined): string | null {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function sourceName(source: SourceLike | undefined, ordinal: number): string {
  const rodal = text(source?.attributes.n_rodal)
  if (rodal !== null) return `Rodal ${rodal}`
  const objectid = text(source?.attributes.objectid)
  return `Polígono ${objectid ?? ordinal}`
}

export function describeChanges(features: FeatureLike[], sources: SourceLike[]): ChangeItem[] {
  const bySource = new Map(sources.map((source) => [source.source_feature_ordinal, source]))
  const groups = new Map<number, FeatureLike[]>()
  for (const feature of features) {
    const group = groups.get(feature.source_feature_ordinal) ?? []
    group.push(feature)
    groups.set(feature.source_feature_ordinal, group)
  }

  const items: ChangeItem[] = []
  for (const [ordinal, group] of groups) {
    const source = bySource.get(ordinal)
    const name = sourceName(source, ordinal)
    if (group.length > 1) {
      const ordered = [...group].sort((a, b) => Number(b.in_report) - Number(a.in_report))
      items.push({
        ordinal,
        title: `${name} dividido en ${group.length}`,
        detail: ordered
          .map((piece) => {
            const code = text(piece.attributes.n_rodal) ?? 'sin rodal'
            const mark = piece.in_report ? ', área de manejo' : ''
            return `${code} (${hectares(piece.attributes)}${mark})`
          })
          .join(' · '),
      })
      continue
    }
    const [feature] = group
    if (feature === undefined) continue
    const parts = [hectares(feature.attributes)]
    if (feature.in_report) parts.push('área de manejo')
    for (const { key, label } of EDITABLE_ATTRIBUTES) {
      const before = text(source?.attributes[key])
      const after = text(feature.attributes[key])
      if (before !== after) parts.push(`${label}: «${before ?? ''}» → «${after ?? ''}»`)
    }
    items.push({ ordinal, title: `${name} agregado completo`, detail: parts.join(' · ') })
  }
  return items
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/reportChanges.test.ts && npx tsc -b && npm run lint`
Expected: 3 passed; clean.

- [ ] **Step 5: Commit**

```bash
git add products/forestry/dashboard/src/lib/reportChanges.ts products/forestry/dashboard/src/lib/reportChanges.test.ts
git commit -m "feat(rodales): plain-Spanish change list for report review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: «Informes» list and «Nuevo informe»

**Files:**
- Modify: `products/forestry/dashboard/src/pages/InformesPage.tsx` (replace the placeholder)
- Create: `products/forestry/dashboard/src/reports.css`; Modify `src/main.tsx` (import it)
- Test: `products/forestry/dashboard/src/reports.test.tsx` (add a `describe`)

**Interfaces:**
- Consumes: `fetchReports`, `createReport`, `TYPE_LABELS`, `STATUS_LABELS`, `REPORT_TYPES` (Task 1); `reportPath`, `navigate`, `ROUTES` (Task 2); `PageShell`, `Notice`; `canUpload`, `mutationMessage`.
- Produces: `InformesPage({ role }: { role: ForestryRole })`; `ReportStatusChip({ status })` (exported for the editor).

- [ ] **Step 1: Write the failing tests**

Append to `src/reports.test.tsx` (add these imports at the top: `import userEvent from '@testing-library/user-event'`, `import { InformesPage } from './pages/InformesPage.tsx'` is mocked for Root — so import the real page with `vi.importActual` inside the describe):

```tsx
vi.mock('./reportsApi.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./reportsApi.ts')>()
  return { ...original, fetchReports: vi.fn(), createReport: vi.fn() }
})

const reportsApi = vi.mocked(await import('./reportsApi.ts'))
const { InformesPage: RealInformesPage } = await vi.importActual<
  typeof import('./pages/InformesPage.tsx')
>('./pages/InformesPage.tsx')

function listedReport(overrides: Partial<import('./reportsApi.ts').Report> = {}) {
  return {
    report_id: 7,
    name: 'Cosecha pino enero 2027',
    report_type: 'cosecha' as const,
    report_month: '2027-01',
    status: 'enviado' as const,
    base_snapshot_id: 3,
    revision: 3,
    created_by_display_name: 'Marco',
    created_at: '2026-10-15T10:00:00Z',
    updated_at: '2026-10-15T10:00:00Z',
    submitted_at: '2026-10-15T10:00:00Z',
    decided_at: null,
    decided_by_display_name: null,
    feature_count: 2,
    managed_feature_count: 1,
    managed_area_ha: 4.05,
    ...overrides,
  }
}

describe('Informes list', () => {
  it('shows reports with status, managed hectares and the pending count', async () => {
    reportsApi.fetchReports.mockResolvedValue({ reports: [listedReport()], pending_review_count: 1 })
    render(<RealInformesPage role="admin" />)
    expect(await screen.findByText('Cosecha pino enero 2027')).toBeInTheDocument()
    expect(screen.getByText('Enviado')).toBeInTheDocument()
    expect(screen.getByText('4,05 ha')).toBeInTheDocument()
    expect(screen.getByText('Pendientes de revisión: 1')).toBeInTheDocument()
  })

  it('creates a report and opens it', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReports.mockResolvedValue({ reports: [], pending_review_count: 0 })
    reportsApi.createReport.mockResolvedValue(9)
    render(<RealInformesPage role="operator" />)
    await user.click(await screen.findByRole('button', { name: 'Nuevo informe' }))
    await user.type(screen.getByLabelText('Nombre'), 'Raleo Purretrun')
    await user.selectOptions(screen.getByLabelText('Tipo'), 'manejo')
    await user.clear(screen.getByLabelText('Mes'))
    await user.type(screen.getByLabelText('Mes'), '2026-12')
    await user.click(screen.getByRole('button', { name: 'Crear informe' }))
    expect(reportsApi.createReport).toHaveBeenCalledWith('Raleo Purretrun', 'manejo', '2026-12')
    expect(window.location.pathname + window.location.search).toBe(
      '/rodales/informes/editar?informe=9',
    )
  })

  it('offers no «Nuevo informe» to a viewer and explains the empty list', async () => {
    reportsApi.fetchReports.mockResolvedValue({ reports: [], pending_review_count: 0 })
    render(<RealInformesPage role="viewer" />)
    expect(await screen.findByText('Aún no hay informes aprobados.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo informe' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/reports.test.tsx`
Expected: the three new tests FAIL (the placeholder renders nothing).

- [ ] **Step 3: Implement the page**

Replace `src/pages/InformesPage.tsx`:

```tsx
/**
 * «Informes»: management reports (informes de manejo). Editors see every
 * report and start new ones; viewers see approved reports only (the API
 * filters). Submitted reports come first; admins see how many wait for them.
 */
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { canUpload, mutationMessage } from '../api.ts'
import { Notice, PageShell } from '../components/PageShell.tsx'
import { formatDate } from '../lib/format.ts'
import {
  REPORT_TYPES,
  STATUS_LABELS,
  TYPE_LABELS,
  createReport,
  fetchReports,
  type ReportList,
  type ReportStatus,
  type ReportType,
} from '../reportsApi.ts'
import { ROUTES, navigate, onLinkClick, reportPath } from '../router.ts'
import type { ForestryRole } from '../types.ts'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ReportStatusChip({ status }: { status: ReportStatus }) {
  return <span className={`report-chip report-chip--${status}`}>{STATUS_LABELS[status]}</span>
}

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; list: ReportList }

export function InformesPage({ role }: { role: ForestryRole }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [creating, setCreating] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchReports()
      .then((list) => {
        if (!cancelled) setLoad({ status: 'ready', list })
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  const editor = canUpload(role)

  return (
    <PageShell active={ROUTES.informes} role={role}>
      <div className="page__heading">
        <h2 className="page__title">Informes de manejo</h2>
        <p className="page__lead">
          {editor
            ? 'Elija rodales, divídalos si hace falta y envíe el informe a revisión. Una vez aprobado, expórtelo para Campo Digital.'
            : 'Informes aprobados por Campo Digital.'}
        </p>
      </div>

      {editor ? (
        <div className="page__actions">
          <button type="button" className="button" onClick={() => setCreating(true)}>
            Nuevo informe
          </button>
        </div>
      ) : null}

      {load.status === 'loading' ? <p className="page__busy">Cargando informes…</p> : null}
      {load.status === 'error' ? (
        <Notice tone="error" title="No fue posible cargar los informes.">
          <button type="button" className="button button--ghost" onClick={() => setNonce((n) => n + 1)}>
            Reintentar
          </button>
        </Notice>
      ) : null}

      {load.status === 'ready' ? (
        <>
          {load.list.pending_review_count > 0 ? (
            <Notice tone="info">{`Pendientes de revisión: ${load.list.pending_review_count}`}</Notice>
          ) : null}
          {load.list.reports.length === 0 ? (
            <p className="muted">
              {editor
                ? 'Aún no hay informes. Use «Nuevo informe» para empezar.'
                : 'Aún no hay informes aprobados.'}
            </p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Informe</th>
                    <th>Tipo · mes</th>
                    <th>Estado</th>
                    <th>Creado por</th>
                    <th className="numeric">Área de manejo</th>
                    <th>Actualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {load.list.reports.map((report) => (
                    <tr key={report.report_id}>
                      <td>
                        <a
                          href={reportPath(report.report_id)}
                          onClick={(event) => onLinkClick(event, reportPath(report.report_id))}
                        >
                          {report.name}
                        </a>
                      </td>
                      <td>{`${TYPE_LABELS[report.report_type]} · ${report.report_month}`}</td>
                      <td>
                        <ReportStatusChip status={report.status} />
                      </td>
                      <td>{report.created_by_display_name}</td>
                      <td className="numeric">{`${ha.format(report.managed_area_ha)} ha`}</td>
                      <td>{formatDate(report.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {creating ? <NewReportDialog onCancel={() => setCreating(false)} /> : null}
    </PageShell>
  )
}

function NewReportDialog({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState('')
  const [reportType, setReportType] = useState<ReportType>('cosecha')
  const [month, setMonth] = useState(currentMonth)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setBusy(true)
      setError(null)
      try {
        const reportId = await createReport(name.trim(), reportType, month)
        navigate(reportPath(reportId))
      } catch (caught) {
        setError(mutationMessage(caught, 'No fue posible crear el informe.'))
        setBusy(false)
      }
    },
    [name, reportType, month],
  )

  return (
    <div className="dialog-backdrop" role="presentation" onClick={busy ? undefined : onCancel}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-report-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <h2 id="new-report-title" className="dialog__title">
          Nuevo informe
        </h2>
        <div className="dialog__body report-form">
          <label className="report-form__field">
            <span>Nombre</span>
            <input
              id="report-name"
              value={name}
              maxLength={120}
              required
              placeholder="Cosecha pino enero 2027"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="report-form__field">
            <span>Tipo</span>
            <select
              id="report-type"
              value={reportType}
              onChange={(event) => setReportType(event.target.value as ReportType)}
            >
              {REPORT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="report-form__field">
            <span>Mes</span>
            <input
              id="report-month"
              type="month"
              value={month}
              required
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          {error !== null ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="dialog__actions">
          <button type="button" className="button button--ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="button" disabled={busy || name.trim() === ''}>
            {busy ? 'Creando…' : 'Crear informe'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

Create `src/reports.css` (shared by the list and the editor; Task 8 appends the editor rules):

```css
/* Rodales management reports (informes de manejo). */

.report-chip {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  background: var(--panel-2);
  color: var(--ink-2);
}

.report-chip--enviado {
  background: #e3f0f8;
  color: #0b5c8c;
}

.report-chip--aprobado {
  background: var(--green-tint);
  color: var(--green-900);
}

.report-chip--cambios_solicitados {
  background: #fbefd9;
  color: #8a5300;
}

.report-chip--archivado {
  background: var(--panel-2);
  color: var(--ink-3);
}

.report-form {
  display: grid;
  gap: 14px;
  min-width: min(420px, 80vw);
}

.report-form__field {
  display: grid;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}

.report-form__field input,
.report-form__field select,
.report-form__field textarea {
  font: inherit;
  font-weight: 400;
  color: var(--ink);
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: #fff;
}

.report-form__field input:focus-visible,
.report-form__field select:focus-visible,
.report-form__field textarea:focus-visible {
  outline: none;
  border-color: var(--focus);
  box-shadow: var(--focus-ring);
}
```

In `src/main.tsx`, add `import './reports.css'` after `import './workflow.css'`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/reports.test.tsx && npx tsc -b && npm run lint`
Expected: 6 passed; clean.

- [ ] **Step 5: Commit**

```bash
git add products/forestry/dashboard/src/pages/InformesPage.tsx products/forestry/dashboard/src/reports.css products/forestry/dashboard/src/main.tsx products/forestry/dashboard/src/reports.test.tsx
git commit -m "feat(rodales): Informes list and Nuevo informe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The editor map (`ReportMap`)

**Files:**
- Create: `products/forestry/dashboard/src/components/ReportMap.tsx`

**Interfaces:**
- Consumes: `FeatureCollection` (types), `DraftFeature` (Task 4), `Coordinates`, `Position` (Task 3), `utmToLonLat`, `lonLatToUtm`, `multiPolygonUtmBbox`, `utmBboxToLonLatBounds` (`lib/proj.ts`), `multiPolygonToLatLngs` (`lib/mapData.ts`).
- Produces: `type MapMode = 'select' | 'split' | 'choose' | 'view'`; `interface ChoosePiece { featureKey: string; index: number; coordinates: Coordinates; label: string; managed: boolean }`; `ReportMap(props: ReportMapProps)` with props `base: FeatureCollection; features: DraftFeature[]; mode: MapMode; selectedOrdinals: ReadonlySet<number>; selectedKeys: ReadonlySet<string>; linePoints: Position[]; choosePieces: ChoosePiece[]; overlay: { ordinal: number; coordinates: Coordinates }[]; onBaseClick(ordinal: number, additive: boolean): void; onFeatureClick(key: string, additive: boolean): void; onLinePoint(point: Position): void; onFinishLine(): void; onPieceClick(featureKey: string, index: number): void; fitNonce: number`.

This component is verified in the browser (Task 9); page tests replace it with a stub. It has no test file of its own: jsdom has no layout, so Leaflet geometry clicks cannot be exercised meaningfully there.

- [ ] **Step 1: Implement**

Create `src/components/ReportMap.tsx`:

```tsx
/**
 * The report editor's map. Draws the report's base snapshot (thin outlines,
 * clickable to select polygons to copy), the report's own polygons on top
 * (managed parts in harvest orange), the polyline being drawn, and the
 * pieces to choose after a split. Coordinates arrive in EPSG:32718; Leaflet
 * draws reprojected copies, and a clicked point is converted once to UTM.
 */
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { multiPolygonToLatLngs } from '../lib/mapData.ts'
import { lonLatToUtm, multiPolygonUtmBbox, utmBboxToLonLatBounds, utmToLonLat } from '../lib/proj.ts'
import type { DraftFeature } from '../lib/reportDraft.ts'
import type { Coordinates, Position } from '../lib/splitGeometry.ts'
import type { FeatureCollection } from '../types.ts'

export type MapMode = 'select' | 'split' | 'choose' | 'view'

export interface ChoosePiece {
  featureKey: string
  index: number
  coordinates: Coordinates
  label: string
  managed: boolean
}

interface ReportMapProps {
  base: FeatureCollection
  features: DraftFeature[]
  mode: MapMode
  selectedOrdinals: ReadonlySet<number>
  selectedKeys: ReadonlySet<string>
  linePoints: Position[]
  choosePieces: ChoosePiece[]
  overlay: { ordinal: number; coordinates: Coordinates }[]
  onBaseClick: (ordinal: number, additive: boolean) => void
  onFeatureClick: (key: string, additive: boolean) => void
  onLinePoint: (point: Position) => void
  onFinishLine: () => void
  onPieceClick: (featureKey: string, index: number) => void
  fitNonce: number
}

const SATELLITE_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SATELLITE_ATTRIBUTION =
  'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community'

const HARVEST = '#e8a33d'
const REPORT = '#2f9e6a'
const SELECTED = '#3b8fd6'
const CUT = '#ffd84d'

function latLngs(coordinates: Coordinates): [number, number][][][] {
  return multiPolygonToLatLngs({ type: 'MultiPolygon', coordinates })
}

function featureStyle(feature: DraftFeature, selected: boolean): L.PathOptions {
  const color = feature.in_report ? HARVEST : REPORT
  return {
    color: selected ? SELECTED : '#ffffff',
    weight: selected ? 4 : 2.5,
    fillColor: color,
    fillOpacity: feature.in_report ? 0.6 : 0.4,
  }
}

export function ReportMap(props: ReportMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const baseLayerRef = useRef<L.LayerGroup | null>(null)
  const reportLayerRef = useRef<L.LayerGroup | null>(null)
  const drawLayerRef = useRef<L.LayerGroup | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current
    if (container === null || mapRef.current !== null) return
    const map = L.map(container, { zoomControl: true, doubleClickZoom: false, preferCanvas: false })
    L.tileLayer(SATELLITE_TILE_URL, { attribution: SATELLITE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
    baseLayerRef.current = L.layerGroup().addTo(map)
    reportLayerRef.current = L.layerGroup().addTo(map)
    drawLayerRef.current = L.layerGroup().addTo(map)

    map.on('click', (event: L.LeafletMouseEvent) => {
      if (propsRef.current.mode !== 'split') return
      const [easting, northing] = lonLatToUtm(event.latlng.lng, event.latlng.lat)
      propsRef.current.onLinePoint([easting, northing])
    })
    map.on('dblclick', () => {
      if (propsRef.current.mode === 'split') propsRef.current.onFinishLine()
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Fit to the report (or the base when the report is empty).
  useEffect(() => {
    const map = mapRef.current
    if (map === null) return
    const geometries =
      props.features.length > 0
        ? props.features.map((feature) => ({ coordinates: feature.coordinates }))
        : props.base.features.map((feature) => feature.geometry)
    if (geometries.length === 0) return
    const boxes = geometries.map((geometry) =>
      multiPolygonUtmBbox({ type: 'MultiPolygon', coordinates: geometry.coordinates }),
    )
    const bbox: [number, number, number, number] = [
      Math.min(...boxes.map((box) => box[0])),
      Math.min(...boxes.map((box) => box[1])),
      Math.max(...boxes.map((box) => box[2])),
      Math.max(...boxes.map((box) => box[3])),
    ]
    const bounds = utmBboxToLonLatBounds(bbox)
    map.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { padding: [24, 24] },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitNonce])

  // Base polygons: outlines, selectable in «Seleccionar».
  useEffect(() => {
    const layer = baseLayerRef.current
    if (layer === null) return
    layer.clearLayers()
    for (const feature of props.base.features) {
      const ordinal = feature.properties.feature_ordinal
      const selected = props.selectedOrdinals.has(ordinal)
      const polygon = L.polygon(latLngs(feature.geometry.coordinates), {
        color: selected ? SELECTED : '#ffffff',
        weight: selected ? 3 : 1,
        opacity: selected ? 1 : 0.7,
        fillColor: selected ? SELECTED : '#ffffff',
        fillOpacity: selected ? 0.25 : 0.04,
      })
      const rodal = feature.properties.n_rodal
      polygon.bindTooltip(rodal === null ? `Polígono ${feature.properties.source_objectid ?? ordinal}` : `Rodal ${rodal}`, {
        sticky: true,
      })
      polygon.on('click', (event: L.LeafletMouseEvent) => {
        if (propsRef.current.mode !== 'select') return
        L.DomEvent.stopPropagation(event)
        propsRef.current.onBaseClick(ordinal, event.originalEvent.shiftKey || event.originalEvent.ctrlKey)
      })
      polygon.addTo(layer)
    }
  }, [props.base, props.selectedOrdinals])

  // The report's polygons, the overlay of the original base, the line and the pieces.
  useEffect(() => {
    const layer = reportLayerRef.current
    const draw = drawLayerRef.current
    if (layer === null || draw === null) return
    layer.clearLayers()
    draw.clearLayers()

    for (const item of props.overlay) {
      L.polygon(latLngs(item.coordinates), {
        color: '#ffffff',
        weight: 2,
        dashArray: '6 5',
        fill: false,
        interactive: false,
      }).addTo(draw)
    }

    if (props.mode !== 'choose') {
      for (const feature of props.features) {
        const polygon = L.polygon(latLngs(feature.coordinates), featureStyle(feature, props.selectedKeys.has(feature.key)))
        const code = feature.attributes.n_rodal
        polygon.bindTooltip(code === null || code === undefined ? 'Sin rodal' : String(code), {
          sticky: true,
        })
        polygon.on('click', (event: L.LeafletMouseEvent) => {
          const mode = propsRef.current.mode
          if (mode === 'split') return // let the map add a line point
          L.DomEvent.stopPropagation(event)
          if (mode === 'select' || mode === 'view') {
            propsRef.current.onFeatureClick(feature.key, event.originalEvent.shiftKey || event.originalEvent.ctrlKey)
          }
        })
        polygon.addTo(layer)
      }
    }

    for (const piece of props.choosePieces) {
      const polygon = L.polygon(latLngs(piece.coordinates), {
        color: '#ffffff',
        weight: 3,
        fillColor: piece.managed ? HARVEST : REPORT,
        fillOpacity: piece.managed ? 0.65 : 0.35,
      })
      polygon.bindTooltip(piece.label, { permanent: true, direction: 'center', className: 'report-map__piece-label' })
      polygon.on('click', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event)
        propsRef.current.onPieceClick(piece.featureKey, piece.index)
      })
      polygon.addTo(layer)
    }

    if (props.linePoints.length > 0) {
      const points = props.linePoints.map(([x, y]) => {
        const [lon, lat] = utmToLonLat(x, y)
        return L.latLng(lat, lon)
      })
      L.polyline(points, { color: CUT, weight: 3, dashArray: '8 6', interactive: false }).addTo(draw)
      for (const point of points) {
        L.circleMarker(point, { radius: 4, color: CUT, fillColor: CUT, fillOpacity: 1, interactive: false }).addTo(draw)
      }
    }
  }, [props.features, props.selectedKeys, props.mode, props.linePoints, props.choosePieces, props.overlay])

  // Cursor follows the mode.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    container.dataset.mode = props.mode
  }, [props.mode])

  return <div ref={containerRef} className="report-map" role="application" aria-label="Mapa del informe" />
}
```

- [ ] **Step 2: Types and lint**

Run: `npx tsc -b && npm run lint`
Expected: clean. If oxlint flags the `eslint-disable` comment as unknown, remove the comment (oxlint does not run react-hooks exhaustive-deps here) and record a ruling.

- [ ] **Step 3: Commit**

```bash
git add products/forestry/dashboard/src/components/ReportMap.tsx
git commit -m "feat(rodales): editor map for management reports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The editor and review page

**Files:**
- Modify: `products/forestry/dashboard/src/pages/InformeEditorPage.tsx` (replace the placeholder)
- Modify: `products/forestry/dashboard/src/reports.css` (append editor rules)
- Test: `products/forestry/dashboard/src/reports.test.tsx` (add a `describe`)

**Interfaces:**
- Consumes: everything in Tasks 1–7; `fetchFeatureCollection(snapshotId)` from `api.ts`; `ConfirmDialog`, `Notice`, `Header`; `ReportStatusChip` (Task 6).
- Produces: `InformeEditorPage({ role, reportId })`.

- [ ] **Step 1: Write the failing tests**

Append to `src/reports.test.tsx`. Extend the `reportsApi` mock factory created in Task 6 so it also mocks `fetchReport`, `saveReportFeatures`, `transitionReport`, `updateReport`, `duplicateReport`, `deleteReport`; extend the `api.ts` mock with `fetchFeatureCollection: vi.fn()`. Add a `ReportMap` stub that exposes the callbacks as buttons:

```tsx
vi.mock('./components/ReportMap.tsx', () => ({
  ReportMap: (props: {
    base: { features: { properties: { feature_ordinal: number } }[] }
    onBaseClick: (ordinal: number, additive: boolean) => void
    onLinePoint: (point: [number, number]) => void
    onFinishLine: () => void
    onPieceClick: (key: string, index: number) => void
    choosePieces: { featureKey: string; index: number; label: string }[]
  }) => (
    <div>
      {props.base.features.map((feature) => (
        <button
          key={feature.properties.feature_ordinal}
          type="button"
          onClick={() => props.onBaseClick(feature.properties.feature_ordinal, false)}
        >
          {`base-${feature.properties.feature_ordinal}`}
        </button>
      ))}
      <button type="button" onClick={() => props.onLinePoint([60, -10])}>punto-1</button>
      <button type="button" onClick={() => props.onLinePoint([60, 110])}>punto-2</button>
      <button type="button" onClick={() => props.onFinishLine()}>terminar</button>
      {props.choosePieces.map((piece) => (
        <button
          key={`${piece.featureKey}-${piece.index}`}
          type="button"
          onClick={() => props.onPieceClick(piece.featureKey, piece.index)}
        >
          {`pieza-${piece.label}`}
        </button>
      ))}
    </div>
  ),
}))

const { InformeEditorPage: RealEditor } = await vi.importActual<
  typeof import('./pages/InformeEditorPage.tsx')
>('./pages/InformeEditorPage.tsx')

const SQUARE = [[[[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]]]]

function baseCollection() {
  return {
    type: 'FeatureCollection' as const,
    shapefile_snapshot_id: 3,
    storage_srid: 32718,
    feature_count: 1,
    features: [
      {
        type: 'Feature' as const,
        properties: {
          feature_ordinal: 1,
          source_objectid: 11,
          cod_predial: 'PU1',
          nom_predio: 'Purretrun',
          n_rodal: '17',
          cod_uso: 'Pi06',
          uso_2024: null,
          desc_uso: null,
          uso_2026: null,
          cod_uso_2026: null,
          sup_ha: 1,
          geometry_is_valid: true,
          geometry_area_source_units: 10000,
          quality_flags: [],
        },
        geometry: { type: 'MultiPolygon' as const, coordinates: SQUARE },
      },
    ],
  }
}

function reportDetail(overrides: Partial<import('./reportsApi.ts').Report> = {}, withFeature = false) {
  return {
    report: listedReport({ status: 'borrador', revision: 1, feature_count: 0, ...overrides }),
    features: withFeature
      ? [
          {
            position: 1,
            source_feature_ordinal: 1,
            in_report: true,
            geometry_changed: false,
            attributes: { objectid: 11, n_rodal: '17', sup_ha: 1 },
            geometry: { type: 'MultiPolygon' as const, coordinates: SQUARE },
          },
        ]
      : [],
    sources: withFeature
      ? [
          {
            source_feature_ordinal: 1,
            attributes: { objectid: 11, n_rodal: '17', sup_ha: 1 },
            geometry: { type: 'MultiPolygon' as const, coordinates: SQUARE },
            is_valid: true,
          },
        ]
      : [],
    notes: [
      {
        kind: 'cambios_solicitados' as const,
        body: 'Saca el rodal 18.',
        author_display_name: 'Javier',
        created_at: '2026-10-15T12:00:00Z',
      },
    ],
    srid: 32718,
    published_snapshot_id: 3,
  }
}

describe('Informe editor', () => {
  beforeEach(() => {
    api.fetchFeatureCollection.mockResolvedValue(baseCollection())
    window.sessionStorage.clear()
  })

  it('copies a base polygon, pastes it and saves it without geometry', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail())
    reportsApi.saveReportFeatures.mockResolvedValue({ revision: 2, feature_count: 1, warnings: [] })
    render(<RealEditor role="operator" reportId={7} />)

    await user.click(await screen.findByRole('button', { name: 'base-1' }))
    await user.click(screen.getByRole('button', { name: 'Copiar' }))
    await user.click(screen.getByRole('button', { name: 'Pegar al informe' }))
    expect(screen.getByText('1 polígono · 0 en el área de manejo')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(reportsApi.saveReportFeatures).toHaveBeenCalledWith(7, 1, [
      { source_feature_ordinal: 1, in_report: false, attributes: {}, geometry: null },
    ])
    expect(await screen.findByText('Informe guardado.')).toBeInTheDocument()
  })

  it('splits with a line, marks the harvested piece and names it 17-1', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    render(<RealEditor role="operator" reportId={7} />)

    await user.click(await screen.findByRole('button', { name: 'Dividir con línea' }))
    await user.click(screen.getByRole('button', { name: 'punto-1' }))
    await user.click(screen.getByRole('button', { name: 'punto-2' }))
    await user.click(screen.getByRole('button', { name: 'Terminar línea' }))
    expect(screen.getByText('Toca la parte que se cosecha.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'pieza-A' }))
    await user.click(screen.getByRole('button', { name: 'Listo' }))

    expect(screen.getByText('2 polígonos · 1 en el área de manejo')).toBeInTheDocument()
    expect(screen.getByText(/^17-1/)).toBeInTheDocument()
  })

  it('explains a line that does not cross the rodal and keeps drawing', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('button', { name: 'Dividir con línea' }))
    await user.click(screen.getByRole('button', { name: 'punto-1' }))
    await user.click(screen.getByRole('button', { name: 'Terminar línea' }))
    expect(screen.getByText('Haga clic en al menos dos puntos para dibujar la línea.')).toBeInTheDocument()
  })

  it('undo restores the report before the split', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('button', { name: 'Dividir con línea' }))
    await user.click(screen.getByRole('button', { name: 'punto-1' }))
    await user.click(screen.getByRole('button', { name: 'punto-2' }))
    await user.click(screen.getByRole('button', { name: 'Terminar línea' }))
    await user.click(screen.getByRole('button', { name: 'pieza-A' }))
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    await user.click(screen.getByRole('button', { name: 'Deshacer' }))
    expect(screen.getByText('1 polígono · 1 en el área de manejo')).toBeInTheDocument()
  })

  it('submits after saving unsaved changes', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport
      .mockResolvedValueOnce(reportDetail({}, true))
      .mockResolvedValueOnce(reportDetail({ status: 'enviado', revision: 3 }, true))
    reportsApi.saveReportFeatures.mockResolvedValue({ revision: 2, feature_count: 1, warnings: [] })
    reportsApi.transitionReport.mockResolvedValue({ report_id: 7, status: 'enviado', revision: 3 })
    render(<RealEditor role="operator" reportId={7} />)

    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.click(screen.getByRole('button', { name: 'Enviar a revisión' }))

    expect(reportsApi.saveReportFeatures).toHaveBeenCalledWith(7, 1, expect.any(Array))
    expect(reportsApi.transitionReport).toHaveBeenCalledWith(7, 'submit', 2)
  })

  it('keeps the draft when a save fails and shows the server message', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    reportsApi.saveReportFeatures.mockRejectedValue(
      new ApiError(422, 'x', 'Dos polígonos del informe se superponen.', 'overlap', 1),
    )
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Dos polígonos del informe se superponen.')).toBeInTheDocument()
    expect(screen.getByText('1 polígono · 0 en el área de manejo')).toBeInTheDocument()
  })

  it('offers reload on stale_revision', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    reportsApi.saveReportFeatures.mockRejectedValue(
      new ApiError(409, 'x', 'Otra persona guardó cambios en este informe; recárguelo.', 'stale_revision'),
    )
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('button', { name: 'Recargar' })).toBeInTheDocument()
  })

  it('lets an admin review: change list, then request changes with a note', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({ status: 'enviado', revision: 3 }, true))
    reportsApi.transitionReport.mockResolvedValue({
      report_id: 7,
      status: 'cambios_solicitados',
      revision: 4,
    })
    render(<RealEditor role="admin" reportId={7} />)

    expect(await screen.findByText('Rodal 17 agregado completo')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pedir cambios' }))
    const send = screen.getByRole('button', { name: 'Enviar nota' })
    expect(send).toBeDisabled()
    await user.type(screen.getByLabelText('Qué hay que cambiar'), 'Saca el rodal 18.')
    await user.click(send)
    expect(reportsApi.transitionReport).toHaveBeenCalledWith(7, 'request-changes', 3, 'Saca el rodal 18.')
  })

  it('shows the returned note to the editor', async () => {
    reportsApi.fetchReport.mockResolvedValue(reportDetail({ status: 'cambios_solicitados', revision: 4 }, true))
    render(<RealEditor role="operator" reportId={7} />)
    expect(await screen.findByText('Saca el rodal 18.')).toBeInTheDocument()
  })

  it('is read-only for a viewer and hides review notes', async () => {
    reportsApi.fetchReport.mockResolvedValue(reportDetail({ status: 'aprobado', revision: 5 }, true))
    render(<RealEditor role="viewer" reportId={7} />)
    expect(await screen.findByRole('link', { name: 'Shapefile (.zip)' })).toHaveAttribute(
      'href',
      '/api/forestry/reports/7/export?format=shp&scope=all',
    )
    expect(screen.queryByRole('button', { name: 'Dividir con línea' })).not.toBeInTheDocument()
    expect(screen.queryByText('Saca el rodal 18.')).not.toBeInTheDocument()
  })
})
```

Also add `import { ApiError } from './api.ts'` at the top of the test file if it is not there.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/reports.test.tsx`
Expected: the ten new tests FAIL (the placeholder renders nothing).

- [ ] **Step 3: Implement the page**

Replace `src/pages/InformeEditorPage.tsx`:

```tsx
/**
 * One management report: the editor (operator, admin; borrador or
 * cambios_solicitados), the review (admin; enviado) and the read-only view
 * (everyone else). Layout A of the design: toolbar, map, report panel.
 *
 * The report's base snapshot is shown, not necessarily the published one.
 * Edits stay in an immutable draft with undo/redo until «Guardar»;
 * «Enviar a revisión» saves first.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, canUpload, fetchFeatureCollection, mutationMessage } from '../api.ts'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import { Header } from '../components/Header.tsx'
import { Notice } from '../components/PageShell.tsx'
import { ReportMap, type ChoosePiece, type MapMode } from '../components/ReportMap.tsx'
import { createHistory, recordHistory, redoHistory, undoHistory, type History } from '../lib/history.ts'
import { describeChanges } from '../lib/reportChanges.ts'
import {
  EDITABLE_ATTRIBUTES,
  applySplit,
  draftFromDetail,
  draftSummary,
  featureCode,
  pasteSources,
  removeSources,
  setAttribute,
  toSaveFeatures,
  toggleInReport,
  type DraftFeature,
  type ReportDraft,
} from '../lib/reportDraft.ts'
import { SPLIT_MESSAGES, lineCrosses, splitByPolyline, type Coordinates, type Position } from '../lib/splitGeometry.ts'
import {
  TYPE_LABELS,
  duplicateReport,
  deleteReport,
  exportUrl,
  fetchReport,
  isEditableStatus,
  saveReportFeatures,
  transitionReport,
  type ReportDetail,
  type ReportWarning,
} from '../reportsApi.ts'
import { ROUTES, navigate, onLinkClick, reportPath } from '../router.ts'
import type { FeatureCollection, ForestryRole } from '../types.ts'
import { ReportStatusChip } from './InformesPage.tsx'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const CLIPBOARD_KEY = 'rodales.informes.portapapeles'

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; detail: ReportDetail; base: FeatureCollection }

interface Clipboard {
  base_snapshot_id: number
  ordinals: number[]
}

interface Pending {
  pieces: { featureKey: string; coordinates: Coordinates[] }[]
  managed: Set<string>
}

function readClipboard(): Clipboard | null {
  try {
    const raw = window.sessionStorage.getItem(CLIPBOARD_KEY)
    return raw === null ? null : (JSON.parse(raw) as Clipboard)
  } catch {
    return null
  }
}

function writeClipboard(clipboard: Clipboard): void {
  try {
    window.sessionStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clipboard))
  } catch {
    // Storage blocked: copy/paste still works inside this page.
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function InformeEditorPage({ role, reportId }: { role: ForestryRole; reportId: number | null }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (reportId === null) {
      setLoad({ status: 'missing' })
      return
    }
    let cancelled = false
    setLoad({ status: 'loading' })
    fetchReport(reportId)
      .then(async (detail) => {
        const base = await fetchFeatureCollection(detail.report.base_snapshot_id)
        if (!cancelled) setLoad({ status: 'ready', detail, base })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoad(error instanceof ApiError && error.status === 404 ? { status: 'missing' } : { status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [reportId, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return (
    <div className="page-app report-app">
      <Header active={ROUTES.informe} role={role} />
      {load.status === 'loading' ? <p className="page__busy report-app__status">Cargando informe…</p> : null}
      {load.status === 'missing' ? (
        <div className="report-app__status">
          <Notice tone="warn" title="No se encontró el informe.">
            <a href={ROUTES.informes} onClick={(event) => onLinkClick(event, ROUTES.informes)}>
              Volver a Informes
            </a>
          </Notice>
        </div>
      ) : null}
      {load.status === 'error' ? (
        <div className="report-app__status">
          <Notice tone="error" title="No fue posible cargar el informe.">
            <button type="button" className="button button--ghost" onClick={reload}>
              Reintentar
            </button>
          </Notice>
        </div>
      ) : null}
      {load.status === 'ready' ? (
        <Editor key={`${load.detail.report.report_id}-${load.detail.report.revision}-${nonce}`} role={role} detail={load.detail} base={load.base} onReload={reload} />
      ) : null}
    </div>
  )
}

function Editor({
  role,
  detail,
  base,
  onReload,
}: {
  role: ForestryRole
  detail: ReportDetail
  base: FeatureCollection
  onReload: () => void
}) {
  const report = detail.report
  const editable = canUpload(role) && isEditableStatus(report.status)
  const reviewing = role === 'admin' && report.status === 'enviado'

  const [draft, setDraft] = useState<ReportDraft>(() => draftFromDetail(detail))
  const [history, setHistory] = useState<History<ReportDraft>>(createHistory)
  const [revision, setRevision] = useState(report.revision)
  const [dirty, setDirty] = useState(false)
  const [mode, setMode] = useState<MapMode>(editable ? 'select' : 'view')
  const [selectedOrdinals, setSelectedOrdinals] = useState<Set<number>>(new Set())
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [linePoints, setLinePoints] = useState<Position[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [message, setMessage] = useState<{ tone: 'info' | 'success' | 'warn' | 'error'; text: string; stale?: boolean } | null>(null)
  const [warnings, setWarnings] = useState<ReportWarning[]>([])
  const [busy, setBusy] = useState(false)
  const [showBase, setShowBase] = useState(false)
  const [dialog, setDialog] = useState<'approve' | 'changes' | 'archive' | 'delete' | null>(null)
  const [note, setNote] = useState('')
  const [onlyMarked, setOnlyMarked] = useState(false)
  const [fitNonce, setFitNonce] = useState(0)

  const baseByOrdinal = useMemo(
    () => new Map(base.features.map((feature) => [feature.properties.feature_ordinal, feature])),
    [base],
  )
  const sourceValues = useMemo(() => {
    const values = new Map<number, Record<string, string | null>>()
    for (const source of detail.sources) {
      values.set(source.source_feature_ordinal, Object.fromEntries(
        Object.entries(source.attributes).map(([key, value]) => [key, value === null ? null : String(value)]),
      ))
    }
    for (const feature of base.features) {
      if (values.has(feature.properties.feature_ordinal)) continue
      const p = feature.properties
      values.set(p.feature_ordinal, {
        n_rodal: p.n_rodal, cod_uso: p.cod_uso, uso_2024: p.uso_2024, desc_uso: p.desc_uso,
        uso_2026: p.uso_2026, cod_uso_2026: p.cod_uso_2026, n_rodal_te: null,
      })
    }
    return values
  }, [detail.sources, base])

  useEffect(() => setFitNonce((n) => n + 1), [])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const change = useCallback(
    (next: ReportDraft) => {
      setHistory((current) => recordHistory(current, draft))
      setDraft(next)
      setDirty(true)
    },
    [draft],
  )

  const undo = useCallback(() => {
    const step = undoHistory(history, draft)
    if (step === null) return
    setHistory(step.history)
    setDraft(step.value)
    setDirty(true)
  }, [history, draft])

  const redo = useCallback(() => {
    const step = redoHistory(history, draft)
    if (step === null) return
    setHistory(step.history)
    setDraft(step.value)
    setDirty(true)
  }, [history, draft])

  // --- Selection, copy, paste -------------------------------------------------

  const onBaseClick = useCallback((ordinal: number, additive: boolean) => {
    setSelectedOrdinals((current) => {
      const next = new Set(additive ? current : [])
      if (current.has(ordinal) && additive) next.delete(ordinal)
      else next.add(ordinal)
      return next
    })
  }, [])

  const onFeatureClick = useCallback((key: string, additive: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(additive ? current : [])
      if (current.has(key) && additive) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const copy = useCallback(() => {
    const ordinals = [...selectedOrdinals]
    writeClipboard({ base_snapshot_id: report.base_snapshot_id, ordinals })
    setMessage({ tone: 'info', text: `${plural(ordinals.length, 'polígono copiado', 'polígonos copiados')}. Use «Pegar al informe».` })
  }, [selectedOrdinals, report.base_snapshot_id])

  const paste = useCallback(() => {
    const clipboard = readClipboard()
    if (clipboard === null || clipboard.ordinals.length === 0) {
      setMessage({ tone: 'warn', text: 'No hay polígonos copiados. Seleccione rodales en el mapa y use «Copiar».' })
      return
    }
    if (clipboard.base_snapshot_id !== report.base_snapshot_id) {
      setMessage({ tone: 'warn', text: 'Los polígonos copiados son de otra versión de la base.' })
      return
    }
    const sources = clipboard.ordinals.flatMap((ordinal) => {
      const feature = baseByOrdinal.get(ordinal)
      if (feature === undefined) return []
      const p = feature.properties
      return [{
        ordinal,
        attributes: {
          objectid: p.source_objectid, nom_predio: p.nom_predio, n_rodal: p.n_rodal, cod_uso: p.cod_uso,
          uso_2024: p.uso_2024, desc_uso: p.desc_uso, uso_2026: p.uso_2026, cod_uso_2026: p.cod_uso_2026,
          sup_ha: p.sup_ha, cod_predial: p.cod_predial,
        },
        coordinates: feature.geometry.coordinates,
      }]
    })
    const result = pasteSources(draft, sources)
    if (result.added > 0) change(result.draft)
    setSelectedOrdinals(new Set())
    setMessage({
      tone: result.skipped > 0 ? 'warn' : 'info',
      text:
        result.skipped > 0
          ? `${plural(result.added, 'polígono agregado', 'polígonos agregados')}; ${plural(result.skipped, 'ya estaba', 'ya estaban')} en el informe.`
          : `${plural(result.added, 'polígono agregado', 'polígonos agregados')} al informe.`,
    })
  }, [draft, change, report.base_snapshot_id, baseByOrdinal])

  const removeSelected = useCallback(() => {
    const ordinals = draft.features.filter((f) => selectedKeys.has(f.key)).map((f) => f.source_feature_ordinal)
    if (ordinals.length === 0) return
    change(removeSources(draft, ordinals))
    setSelectedKeys(new Set())
  }, [draft, selectedKeys, change])

  // --- Split -------------------------------------------------------------------

  const startSplit = useCallback(() => {
    setMode('split')
    setLinePoints([])
    setPending(null)
    setMessage(null)
  }, [])

  const cancelSplit = useCallback(() => {
    setMode('select')
    setLinePoints([])
    setPending(null)
  }, [])

  const finishLine = useCallback(() => {
    if (linePoints.length < 2) {
      setMessage({ tone: 'warn', text: SPLIT_MESSAGES.too_short })
      return
    }
    const targets = draft.features.filter(
      (feature) =>
        (selectedKeys.size === 0 || selectedKeys.has(feature.key)) && lineCrosses(feature.coordinates, linePoints),
    )
    if (targets.length === 0) {
      setMessage({ tone: 'warn', text: draft.features.length === 0 ? 'Primero pegue el rodal al informe.' : SPLIT_MESSAGES.not_crossing })
      return
    }
    const pieces: Pending['pieces'] = []
    for (const feature of targets) {
      const result = splitByPolyline(feature.coordinates, linePoints)
      if (!result.ok) {
        if (result.reason === 'not_crossing' && targets.length > 1) continue
        setMessage({ tone: 'warn', text: SPLIT_MESSAGES[result.reason] })
        return
      }
      pieces.push({ featureKey: feature.key, coordinates: result.pieces })
    }
    if (pieces.length === 0) {
      setMessage({ tone: 'warn', text: SPLIT_MESSAGES.not_crossing })
      return
    }
    setPending({ pieces, managed: new Set() })
    setMode('choose')
    setLinePoints([])
    setMessage(null)
  }, [linePoints, draft, selectedKeys])

  const choosePieces = useMemo((): ChoosePiece[] => {
    if (pending === null) return []
    let letter = 0
    return pending.pieces.flatMap((group) =>
      group.coordinates.map((coordinates, index) => {
        const label = String.fromCharCode(65 + letter)
        letter += 1
        return { featureKey: group.featureKey, index, coordinates, label, managed: pending.managed.has(`${group.featureKey}:${index}`) }
      }),
    )
  }, [pending])

  const onPieceClick = useCallback((featureKey: string, index: number) => {
    setPending((current) => {
      if (current === null) return current
      const managed = new Set(current.managed)
      const id = `${featureKey}:${index}`
      if (managed.has(id)) managed.delete(id)
      else managed.add(id)
      return { ...current, managed }
    })
  }, [])

  const confirmPieces = useCallback(
    (keepNone: boolean) => {
      if (pending === null) return
      let next = draft
      for (const group of pending.pieces) {
        const managed = keepNone
          ? []
          : group.coordinates.map((_, index) => index).filter((index) => pending.managed.has(`${group.featureKey}:${index}`))
        next = applySplit(next, group.featureKey, group.coordinates, managed)
      }
      change(next)
      setPending(null)
      setMode('select')
      setSelectedKeys(new Set())
      const count = pending.pieces.length
      setMessage({ tone: 'success', text: `${plural(count, 'rodal dividido', 'rodales divididos')}.` })
    },
    [pending, draft, change],
  )

  // --- Keyboard ----------------------------------------------------------------

  useEffect(() => {
    if (!editable) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (mode !== 'split') return
      if (event.key === 'Enter') finishLine()
      else if (event.key === 'Backspace') setLinePoints((points) => points.slice(0, -1))
      else if (event.key === 'Escape') cancelSplit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable, mode, undo, redo, finishLine, cancelSplit])

  // --- Save, submit, review -----------------------------------------------------

  const fail = useCallback((error: unknown, fallback: string) => {
    const stale = error instanceof ApiError && error.reason === 'stale_revision'
    setMessage({ tone: 'error', text: mutationMessage(error, fallback), stale })
  }, [])

  const save = useCallback(async (): Promise<number | null> => {
    setBusy(true)
    try {
      const result = await saveReportFeatures(report.report_id, revision, toSaveFeatures(draft))
      setRevision(result.revision)
      setWarnings(result.warnings)
      setDirty(false)
      setMessage({ tone: 'success', text: 'Informe guardado.' })
      return result.revision
    } catch (error) {
      fail(error, 'No fue posible guardar el informe.')
      return null
    } finally {
      setBusy(false)
    }
  }, [report.report_id, revision, draft, fail])

  const submit = useCallback(async () => {
    const saved = dirty ? await save() : revision
    if (saved === null) return
    setBusy(true)
    try {
      await transitionReport(report.report_id, 'submit', saved)
      onReload()
    } catch (error) {
      fail(error, 'No fue posible enviar el informe.')
      setBusy(false)
    }
  }, [dirty, save, revision, report.report_id, onReload, fail])

  const decide = useCallback(
    async (action: 'approve' | 'request-changes' | 'archive', text?: string) => {
      setBusy(true)
      try {
        await transitionReport(report.report_id, action, revision, text)
        setDialog(null)
        onReload()
      } catch (error) {
        fail(error, 'No fue posible completar la acción.')
        setBusy(false)
        setDialog(null)
      }
    },
    [report.report_id, revision, onReload, fail],
  )

  const duplicate = useCallback(async () => {
    setBusy(true)
    try {
      navigate(reportPath(await duplicateReport(report.report_id)))
    } catch (error) {
      fail(error, 'No fue posible duplicar el informe.')
      setBusy(false)
    }
  }, [report.report_id, fail])

  const remove = useCallback(async () => {
    setBusy(true)
    try {
      await deleteReport(report.report_id)
      navigate(ROUTES.informes)
    } catch (error) {
      fail(error, 'No fue posible borrar el borrador.')
      setBusy(false)
      setDialog(null)
    }
  }, [report.report_id, fail])

  // --- Derived ------------------------------------------------------------------

  const summary = draftSummary(draft)
  const changes = useMemo(() => describeChanges(draft.features, detail.sources), [draft.features, detail.sources])
  const latestChangeNote = [...detail.notes].reverse().find((n) => n.kind === 'cambios_solicitados')
  const showNotes = canUpload(role)
  const overlay = useMemo(
    () => (showBase ? detail.sources.map((s) => ({ ordinal: s.source_feature_ordinal, coordinates: s.geometry.coordinates })) : []),
    [showBase, detail.sources],
  )
  const hint =
    mode === 'split'
      ? 'Haga clic para cada quiebre; empiece y termine fuera del rodal. «Terminar línea», doble clic o Enter para cortar.'
      : mode === 'choose'
        ? 'Toca la parte que se cosecha.'
        : editable
          ? 'Seleccione rodales en el mapa y use «Copiar» y «Pegar al informe». Mayús + clic agrega a la selección.'
          : null

  return (
    <div className="report-editor">
      {editable ? (
        <div className="report-toolbar" role="toolbar" aria-label="Herramientas del informe">
          <button type="button" className={`report-tool${mode === 'select' ? ' report-tool--on' : ''}`} aria-pressed={mode === 'select'} onClick={cancelSplit}>Seleccionar</button>
          <button type="button" className="report-tool" onClick={copy} disabled={selectedOrdinals.size === 0}>Copiar</button>
          <button type="button" className="report-tool" onClick={paste}>Pegar al informe</button>
          <button type="button" className={`report-tool${mode === 'split' || mode === 'choose' ? ' report-tool--on' : ''}`} aria-pressed={mode === 'split'} onClick={startSplit} disabled={draft.features.length === 0}>Dividir con línea</button>
          <button type="button" className="report-tool" onClick={removeSelected} disabled={selectedKeys.size === 0}>Quitar del informe</button>
          <span className="report-toolbar__sep" aria-hidden="true" />
          <button type="button" className="report-tool" onClick={undo} disabled={history.past.length === 0}>Deshacer</button>
          <button type="button" className="report-tool" onClick={redo} disabled={history.future.length === 0}>Rehacer</button>
        </div>
      ) : null}

      <div className="report-editor__body">
        <div className="report-editor__map">
          <ReportMap
            base={base}
            features={draft.features}
            mode={mode}
            selectedOrdinals={selectedOrdinals}
            selectedKeys={selectedKeys}
            linePoints={linePoints}
            choosePieces={choosePieces}
            overlay={overlay}
            onBaseClick={onBaseClick}
            onFeatureClick={onFeatureClick}
            onLinePoint={(point) => setLinePoints((points) => [...points, point])}
            onFinishLine={finishLine}
            onPieceClick={onPieceClick}
            fitNonce={fitNonce}
          />
          {mode === 'split' ? (
            <div className="report-sheet">
              <span>{plural(linePoints.length, 'punto', 'puntos')}</span>
              <button type="button" className="button button--ghost" onClick={() => setLinePoints((p) => p.slice(0, -1))} disabled={linePoints.length === 0}>Quitar último punto</button>
              <button type="button" className="button button--ghost" onClick={cancelSplit}>Cancelar</button>
              <button type="button" className="button" onClick={finishLine}>Terminar línea</button>
            </div>
          ) : null}
          {mode === 'choose' ? (
            <div className="report-sheet">
              <strong>Toca la parte que se cosecha.</strong>
              <button type="button" className="button button--ghost" onClick={() => confirmPieces(true)}>Ninguna por ahora</button>
              <button type="button" className="button button--ghost" onClick={cancelSplit}>Cancelar</button>
              <button type="button" className="button" onClick={() => confirmPieces(false)}>Listo</button>
            </div>
          ) : null}
        </div>

        <aside className="report-panel" aria-label="Informe">
          <div className="report-panel__head">
            <a className="report-panel__back" href={ROUTES.informes} onClick={(event) => onLinkClick(event, ROUTES.informes)}>← Informes</a>
            <h2 className="report-panel__title">{report.name}</h2>
            <p className="report-panel__meta">
              {`${TYPE_LABELS[report.report_type]} · ${report.report_month} · `}
              <ReportStatusChip status={report.status} />
            </p>
          </div>

          {showNotes && latestChangeNote !== undefined && report.status === 'cambios_solicitados' ? (
            <Notice tone="warn" title={`${latestChangeNote.author_display_name} pidió cambios`}>
              <p>{latestChangeNote.body}</p>
            </Notice>
          ) : null}

          {message !== null ? (
            <Notice tone={message.tone}>
              <p>{message.text}</p>
              {message.stale ? (
                <button type="button" className="button button--ghost" onClick={onReload}>Recargar</button>
              ) : null}
            </Notice>
          ) : null}

          {warnings.length > 0 ? (
            <ul className="report-warnings">
              {warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`}>{warning.message}</li>
              ))}
            </ul>
          ) : null}

          {hint !== null ? <p className="report-hint">{hint}</p> : null}

          {reviewing ? (
            <section className="report-section" aria-label="Cambios del informe">
              <h3 className="report-section__title">Cambios</h3>
              <ul className="report-changes">
                {changes.map((item) => (
                  <li key={item.ordinal}>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </li>
                ))}
              </ul>
              <label className="report-check">
                <input type="checkbox" checked={showBase} onChange={(event) => setShowBase(event.target.checked)} />
                Mostrar base original
              </label>
            </section>
          ) : null}

          {editable && draft.features.length === 0 ? (
            <ol className="report-steps">
              <li>Seleccione rodales en el mapa.</li>
              <li>Use «Copiar» y luego «Pegar al informe».</li>
              <li>Divida con una línea si solo se maneja una parte.</li>
            </ol>
          ) : null}

          <ul className="report-features">
            {draft.features.map((feature) => (
              <FeatureRow
                key={feature.key}
                feature={feature}
                editable={editable}
                selected={selectedKeys.has(feature.key)}
                baseValues={sourceValues.get(feature.source_feature_ordinal) ?? {}}
                onSelect={() => onFeatureClick(feature.key, false)}
                onToggle={() => change(toggleInReport(draft, feature.key))}
                onEdit={(name, value, baseValue) => change(setAttribute(draft, feature.key, name, value, baseValue))}
              />
            ))}
          </ul>

          <p className="report-total">
            {`${plural(summary.count, 'polígono', 'polígonos')} · ${summary.managedCount} en el área de manejo`}
            {summary.managedCount > 0 ? ` · ${ha.format(summary.managedHa)} ha` : ''}
          </p>

          <div className="report-actions">
            {editable ? (
              <>
                <button type="button" className="button button--ghost" onClick={() => void save()} disabled={busy || !dirty}>Guardar</button>
                <button type="button" className="button" onClick={() => void submit()} disabled={busy || summary.managedCount === 0}>Enviar a revisión</button>
              </>
            ) : null}
            {reviewing ? (
              <>
                <button type="button" className="button button--ghost" onClick={() => setDialog('changes')} disabled={busy}>Pedir cambios</button>
                <button type="button" className="button" onClick={() => setDialog('approve')} disabled={busy}>Aprobar</button>
              </>
            ) : null}
            {canUpload(role) && report.status !== 'archivado' ? (
              <button type="button" className="button button--ghost" onClick={() => void duplicate()} disabled={busy}>Duplicar como borrador</button>
            ) : null}
            {role === 'admin' && report.status !== 'archivado' && !editable ? (
              <button type="button" className="button button--ghost" onClick={() => setDialog('archive')} disabled={busy}>Archivar</button>
            ) : null}
            {editable && report.status === 'borrador' && report.submitted_at === null ? (
              <button type="button" className="button button--ghost report-actions__danger" onClick={() => setDialog('delete')} disabled={busy}>Borrar borrador</button>
            ) : null}
          </div>

          <section className="report-section" aria-label="Exportar">
            <h3 className="report-section__title">Exportar</h3>
            {dirty ? <p className="muted">Guarde los cambios antes de exportar.</p> : null}
            <label className="report-check">
              <input type="checkbox" checked={onlyMarked} onChange={(event) => setOnlyMarked(event.target.checked)} />
              Solo áreas de manejo
            </label>
            <div className="report-export">
              {(['shp', 'gpkg', 'csv'] as const).map((format) => (
                <a
                  key={format}
                  className={`button button--ghost${dirty ? ' is-disabled' : ''}`}
                  aria-disabled={dirty}
                  href={dirty ? undefined : exportUrl(report.report_id, format, onlyMarked ? 'marked' : 'all')}
                >
                  {format === 'shp' ? 'Shapefile (.zip)' : format === 'gpkg' ? 'GeoPackage (.gpkg)' : 'CSV'}
                </a>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {dialog === 'approve' ? (
        <ConfirmDialog title="Aprobar informe" confirmLabel="Aprobar" busy={busy} onConfirm={() => void decide('approve')} onCancel={() => setDialog(null)}>
          <p>{`«${report.name}» quedará aprobado y fijo. Para cambiarlo después habrá que duplicarlo.`}</p>
        </ConfirmDialog>
      ) : null}
      {dialog === 'archive' ? (
        <ConfirmDialog title="Archivar informe" confirmLabel="Archivar" busy={busy} onConfirm={() => void decide('archive')} onCancel={() => setDialog(null)}>
          <p>El informe dejará de aparecer como activo. Su nombre quedará libre.</p>
        </ConfirmDialog>
      ) : null}
      {dialog === 'delete' ? (
        <ConfirmDialog title="Borrar borrador" confirmLabel="Borrar" busy={busy} onConfirm={() => void remove()} onCancel={() => setDialog(null)}>
          <p>Se borrará este borrador y sus polígonos. No se puede deshacer.</p>
        </ConfirmDialog>
      ) : null}
      {dialog === 'changes' ? (
        <div className="dialog-backdrop" role="presentation" onClick={busy ? undefined : () => setDialog(null)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="changes-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="changes-title" className="dialog__title">Pedir cambios</h2>
            <div className="dialog__body report-form">
              <label className="report-form__field">
                <span>Qué hay que cambiar</span>
                <textarea id="changes-note" rows={4} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
            </div>
            <div className="dialog__actions">
              <button type="button" className="button button--ghost" onClick={() => setDialog(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="button" onClick={() => void decide('request-changes', note.trim())} disabled={busy || note.trim() === ''}>Enviar nota</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function FeatureRow({
  feature,
  editable,
  selected,
  baseValues,
  onSelect,
  onToggle,
  onEdit,
}: {
  feature: DraftFeature
  editable: boolean
  selected: boolean
  baseValues: Record<string, string | null>
  onSelect: () => void
  onToggle: () => void
  onEdit: (name: string, value: string, baseValue: string | null) => void
}) {
  const code = featureCode(feature) ?? 'Sin rodal'
  const use = feature.attributes.cod_uso === null || feature.attributes.cod_uso === undefined ? '' : ` · ${String(feature.attributes.cod_uso)}`
  return (
    <li className={`report-feature${feature.in_report ? ' report-feature--managed' : ''}${selected ? ' report-feature--selected' : ''}`}>
      <button type="button" className="report-feature__main" onClick={onSelect} aria-expanded={selected}>
        <span>{`${code}${use}`}</span>
        <span className="report-feature__ha">{`${ha.format(Number(feature.attributes.sup_ha ?? 0))} ha`}</span>
      </button>
      <label className="report-check">
        <input type="checkbox" checked={feature.in_report} disabled={!editable} onChange={onToggle} />
        {`Área de manejo · ${code}`}
      </label>
      {selected && editable ? (
        <div className="report-feature__fields">
          {EDITABLE_ATTRIBUTES.map((attribute) => (
            <label key={attribute.key} className="report-form__field">
              <span>{attribute.label}</span>
              <input
                defaultValue={feature.attributes[attribute.key] === null || feature.attributes[attribute.key] === undefined ? '' : String(feature.attributes[attribute.key])}
                onBlur={(event) => {
                  const value = event.target.value
                  const current = feature.attributes[attribute.key]
                  if (value.trim() !== (current === null || current === undefined ? '' : String(current))) {
                    onEdit(attribute.key, value, baseValues[attribute.key] ?? null)
                  }
                }}
              />
            </label>
          ))}
        </div>
      ) : null}
    </li>
  )
}
```

Append the editor rules to `src/reports.css`:

```css
.report-app {
  height: 100%;
}

.report-app__status {
  padding: 24px;
}

.report-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.report-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}

.report-tool {
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 7px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: #fff;
  color: var(--ink-2);
  cursor: pointer;
}

.report-tool:hover:not(:disabled) {
  border-color: var(--green-700);
  color: var(--green-900);
}

.report-tool:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.report-tool:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.report-tool--on {
  background: var(--green-tint);
  border-color: var(--green-700);
  color: var(--green-900);
}

.report-toolbar__sep {
  width: 1px;
  margin: 2px 4px;
  background: var(--border);
}

.report-editor__body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
}

.report-editor__map {
  position: relative;
  min-height: 420px;
}

.report-map {
  position: absolute;
  inset: 0;
  background: #56664a;
}

.report-map[data-mode='split'] {
  cursor: crosshair;
}

.report-map__piece-label {
  font-weight: 700;
  font-size: 14px;
  background: rgb(22 33 29 / 0.75);
  color: #fff;
  border: none;
  box-shadow: none;
}

.report-sheet {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 16px;
  z-index: 500;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-surface);
  background: var(--panel);
  box-shadow: var(--shadow-float);
}

.report-sheet > :first-child {
  margin-right: auto;
}

.report-panel {
  border-left: 1px solid var(--border);
  background: var(--panel);
  padding: 14px 16px 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.report-panel__back {
  font-size: 13px;
  color: var(--green-700);
}

.report-panel__title {
  margin: 4px 0 2px;
  font-size: 17px;
  text-wrap: balance;
}

.report-panel__meta {
  margin: 0;
  font-size: 13px;
  color: var(--ink-3);
}

.report-hint {
  margin: 0;
  padding: 9px 11px;
  border: 1px solid var(--green-line);
  border-radius: var(--radius);
  background: var(--green-tint);
  color: var(--green-900);
  font-size: 13px;
}

.report-steps {
  margin: 0;
  padding-left: 20px;
  color: var(--ink-2);
  font-size: 13px;
  display: grid;
  gap: 4px;
}

.report-features {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.report-feature {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
  padding: 6px 10px 8px;
  display: grid;
  gap: 4px;
}

.report-feature--managed {
  border-left: 4px solid #e8a33d;
}

.report-feature--selected {
  border-color: #3b8fd6;
  box-shadow: 0 0 0 1px #3b8fd6;
}

.report-feature__main {
  font: inherit;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
  border: none;
  background: none;
  color: var(--ink);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.report-feature__ha {
  font-variant-numeric: tabular-nums;
  color: var(--ink-2);
}

.report-feature__fields {
  display: grid;
  gap: 8px;
  padding-top: 6px;
}

.report-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-2);
}

.report-total {
  margin: 0;
  font-size: 13px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

.report-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.report-actions__danger {
  color: var(--danger);
}

.report-section {
  display: grid;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.report-section__title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-2);
}

.report-changes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
  font-size: 13px;
}

.report-changes li {
  display: grid;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
}

.report-changes span {
  color: var(--ink-3);
}

.report-warnings {
  margin: 0;
  padding: 8px 10px 8px 26px;
  border: 1px solid #e6c48a;
  border-radius: var(--radius);
  background: #fbefd9;
  color: #6b4300;
  font-size: 13px;
}

.report-export {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.report-export .is-disabled {
  opacity: 0.45;
  pointer-events: none;
}

@media (max-width: 900px) {
  .report-editor__body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 55vh) auto;
  }

  .report-panel {
    border-left: none;
    border-top: 1px solid var(--border);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/reports.test.tsx && npx tsc -b && npm run lint`
Expected: all pass (16 in the file); clean. Fix the code, not the tests, for behaviour; if a test's query text does not match the implemented copy exactly, align the copy with the design labels in Global Constraints and ledger it.

- [ ] **Step 5: Full frontend suite and build**

Run: `npm test && npm run build`
Expected: every test passes; build succeeds. Report the bundle-size warning if Vite prints one (JSTS adds weight) and ledger it.

- [ ] **Step 6: Commit**

```bash
git add products/forestry/dashboard/src/pages/InformeEditorPage.tsx products/forestry/dashboard/src/reports.css products/forestry/dashboard/src/reports.test.tsx
git commit -m "feat(rodales): report editor and review screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Browser verification and documentation

**Files:**
- Modify: `products/forestry/docs/management-reports-v1.md` (Status; screens)
- Create: `products/forestry/docs/es/informes-de-manejo.md`
- Modify: `products/forestry/README.md` (link the Spanish page)

- [ ] **Step 1: Run the local stack**

Run (repo root of the worktree; copy `.env` from the main checkout first and set `POSTGRES_PORT` to the dev container's port if 5432 is taken, as the earlier Rodales worktree did): `make forestry-dev`
Expected: the launcher prints the API and frontend URLs and the dev sign-in works (`Dev Operator`, `Dev Admin`). If no base is published locally, publish the ingested snapshot from «Versiones» as Dev Admin.

- [ ] **Step 2: Walk the flow in a browser (playwright-cli)**

As Dev Operator: «Informes» → «Nuevo informe» («Prueba cosecha», Cosecha, current month) → select two rodales on the map → «Copiar» → «Pegar al informe» → «Dividir con línea» across one rodal with three clicks → «Terminar línea» → tap the piece → «Listo» → check the panel shows `N-1` and the totals → «Deshacer» / «Rehacer» → «Guardar» → «Enviar a revisión».
As Dev Admin: open the report → check «Cambios» and «Mostrar base original» → «Pedir cambios» with a note → as Dev Operator check the note banner → save → submit → as Dev Admin «Aprobar» → «Shapefile (.zip)» downloads.
Take a screenshot of the editor after the split and of the review panel; check the console has no errors; check at 1280 px and at 800 px width.
Expected: every step behaves as described in the design; record any defect, fix it test-first, and re-run the step.

- [ ] **Step 3: Documentation**

`management-reports-v1.md`: change Status to "Stage 1 (API) and stage 2 (screens) implemented …" and add a "Screens" section listing the two pages, the routes, the role behaviour (viewers see no notes) and the rulings of this plan.

Create `products/forestry/docs/es/informes-de-manejo.md` (Spanish, stakeholder level): what a report is, who does what (Marco crea y envía; Javier aprueba o pide cambios; los dueños ven los aprobados), the steps in the editor, how to export, and what stays in ArcMap. Link it from `products/forestry/README.md` under the Spanish summaries.

Run: `uv run python scripts/update_doc_nav.py && uv run python scripts/check_doc_links.py`
Expected: "Documentation links OK".

- [ ] **Step 4: Final checks**

Run: `make forestry-frontend-check` and `make check`
Expected: both green; report failures by name.

- [ ] **Step 5: Commit**

```bash
git add products/forestry/docs products/forestry/README.md
git commit -m "docs(rodales): management report screens; Spanish guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

- **Spec coverage:** list (Task 6), editor layout A with toolbar and panel (Task 8), polyline split with drawing/choose/errors/multi-rodal (Tasks 3, 4, 7, 8), codes 17 → 17-1 (Task 4), undo/redo (Task 4, 8), review layout A with change list and base overlay (Tasks 5, 7, 8), returned note (Task 8), export links and «Solo áreas de manejo» (Task 8), duplicate/archive/delete (Task 8), empty state and hint box (Task 8), roles (Tasks 6, 8).
- **Type consistency:** `DraftFeature`, `ReportDraft`, `Coordinates`, `Position`, `ChoosePiece`, `MapMode` keep the same names across Tasks 3–8; `transitionReport(id, action, revision, note?)` matches Task 1.
