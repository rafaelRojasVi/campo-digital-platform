# Estado CONAF — Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show CONAF's live status in Transelec (an «Estado CONAF» column on the Estado page and a card in the PMF drawer) and in Rodales (a «N.º solicitud CONAF» field and card in the report editor, and a column in the Informes list).

**Architecture:** Each dashboard gets a small pure module (`lib/conafEstado.ts`) that turns a stored result into a tone, a short label, a freshness line and a message; the two copies are identical in logic because the products stay separate packages. Components render it: a compact cell for tables and a card with «Actualizar desde CONAF» for details. Lists read the bulk route (stored data only); details read the single route (refreshes old data).

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library; existing dashboard styles (Transelec `pill-*`, Rodales `report-*`).

**Spec:** `docs/superpowers/specs/2026-10-16-conaf-estado-design.md`; server plan `docs/superpowers/plans/2026-10-16-conaf-estado-server.md`.

## Global Constraints

- Never colour alone: every state shows text (UI/UX guideline «Color Only»); contrast ≥ 4.5:1 (existing pill colours already meet it).
- Short labels by tone: «Aprobada», «En evaluación», «Rechazada», «No vigente», «Otro estado»; the raw CONAF text is always visible in the card and as the cell's `title`.
- Freshness: «Consultado hace N min / h / días»; «Sin actualizar» when `stale`; «Cambió» when `recently_changed`.
- Messages: not_found «CONAF no encuentra esa solicitud.»; mismatch «CONAF respondió otra solicitud ({n}); revise el número.»; unavailable without data «No se pudo consultar CONAF ahora.»; unavailable with data «No se pudo actualizar; se muestra el último dato.»
- «Actualizar desde CONAF» shows «Consultando…» while busy and a `role="status"` result line after (UI/UX «Submit Feedback», «Contextual Live Badge Updates»).
- A number that does not normalize (planilla `n/n-n/n`) shows «Sin N.º consultable» and is never sent.
- Lists never call CONAF; they read stored data in chunks of at most 500 numbers.
- Spanish copy; commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A planilla-style number must never produce a request — Task 1 `normalizes like the server`, Task 2 `skips numbers CONAF cannot answer`.
- «Actualizar» must not hammer CONAF (button disabled while busy; the server's 60 s guard) — Task 3 `disables refresh while busy`.
- A failed refresh must keep showing the last data with the warning — Task 3 `keeps the last data when the refresh fails`.
- The Rodales number edit must not lose other unsaved draft edits (it saves only the header through PATCH with the current revision) — Task 5 `saves the number without touching the draft`.
- More than 500 numbers on the Estado page must be read in several requests — Task 2 `reads in chunks of 500`.

## File Structure

| File | Responsibility |
|---|---|
| Create `products/transelect/dashboard/src/lib/conafEstado.ts` (+ test) | tone, labels, freshness, messages, normalization |
| Modify `products/transelect/dashboard/src/api.ts` | `ConafSolicitud`, `getConafSolicitud`, `getConafSolicitudes`, `refreshConafSolicitud` |
| Create `products/transelect/dashboard/src/components/ConafEstadoCell.tsx`, `ConafCard.tsx` (+ tests) | table cell, drawer card |
| Create `products/transelect/dashboard/src/lib/conafColumn.tsx` | Estado table column |
| Modify `products/transelect/dashboard/src/pages/EstadoPage.tsx`, `components/RowDetailDrawer.tsx`, `styles/*.css` | wiring and styles |
| Create `products/forestry/dashboard/src/lib/conafEstado.ts` (+ test) | same logic for Rodales |
| Modify `products/forestry/dashboard/src/reportsApi.ts` | `conaf_solicitud`, CONAF calls |
| Create `products/forestry/dashboard/src/components/ConafCard.tsx` | card |
| Modify `products/forestry/dashboard/src/pages/InformeEditorPage.tsx`, `InformesPage.tsx`, `reports.css`, `reports.test.tsx` | field, card, column |
| Docs | Spanish sections in `products/forestry/docs/es/informes-de-manejo.md` and a Transelec Spanish note; `docs/platform/conaf-estado.md` status |

---

### Task 1: Transelec `conafEstado` and API calls

**Files:** Create `products/transelect/dashboard/src/lib/conafEstado.ts`, `products/transelect/dashboard/src/lib/conafEstado.test.ts`; Modify `products/transelect/dashboard/src/api.ts`.

- [ ] **Step 1: Failing tests** — create `src/lib/conafEstado.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ConafSolicitud } from '../api'
import { conafMessage, conafTone, freshness, normalizeSolicitud, TONE_LABELS } from './conafEstado'

const NOW = new Date('2026-10-16T15:00:00Z')

function record(overrides: Partial<ConafSolicitud> = {}): ConafSolicitud {
  return {
    numero: '090663',
    lookup_status: 'found',
    tipo: 'PLAN DE MANEJO',
    estado: 'EN EVALUACION',
    superficie_ha: 3,
    fecha_ingreso: '2026-09-01',
    fecha_resolucion: null,
    returned_solicitud: null,
    checked_at: '2026-10-16T12:00:00Z',
    found_at: '2026-10-16T12:00:00Z',
    estado_changed_at: null,
    stale: false,
    recently_changed: false,
    conaf_url: 'https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=090663',
    ...overrides,
  }
}

describe('conafEstado', () => {
  it('normalizes like the server', () => {
    expect(normalizeSolicitud(' 90663 ')).toBe('090663')
    expect(normalizeSolicitud('123456789')).toBe('123456789')
    expect(normalizeSolicitud('12/34-5/26')).toBeNull()
    expect(normalizeSolicitud('1234567890')).toBeNull()
    expect(normalizeSolicitud(null)).toBeNull()
  })

  it.each([
    ['P.M. APROBADA', 'ok'],
    ['APROBADA', 'ok'],
    ['P.M. APROBADA NO VIGENTE', 'muted'],
    ['EN EVALUACION', 'progress'],
    ['EN TRAMITE', 'progress'],
    ['RECHAZADA', 'danger'],
    ['DENEGADA', 'danger'],
    ['DESISTIDA', 'danger'],
    ['ALGO NUEVO', 'neutral'],
  ])('tone of %s is %s', (estado, tone) => {
    expect(conafTone(record({ estado }))).toBe(tone)
  })

  it('labels every tone with text, not colour alone', () => {
    expect(TONE_LABELS).toEqual({
      ok: 'Aprobada',
      progress: 'En evaluación',
      danger: 'Rechazada',
      muted: 'No vigente',
      neutral: 'Otro estado',
    })
  })

  it('says how fresh the data is', () => {
    expect(freshness(record(), NOW)).toBe('Consultado hace 3 h')
    expect(freshness(record({ checked_at: '2026-10-16T14:58:00Z' }), NOW)).toBe('Consultado hace 2 min')
    expect(freshness(record({ checked_at: '2026-10-16T14:59:40Z' }), NOW)).toBe('Consultado hace un momento')
    expect(freshness(record({ checked_at: '2026-10-13T15:00:00Z' }), NOW)).toBe('Consultado hace 3 días')
  })

  it('explains each non-found result', () => {
    expect(conafMessage(record({ lookup_status: 'not_found', estado: null }))).toBe(
      'CONAF no encuentra esa solicitud.',
    )
    expect(conafMessage(record({ lookup_status: 'mismatch', returned_solicitud: '069025' }))).toBe(
      'CONAF respondió otra solicitud (069025); revise el número.',
    )
    expect(conafMessage(record({ lookup_status: 'unavailable', found_at: null, estado: null }))).toBe(
      'No se pudo consultar CONAF ahora.',
    )
    expect(conafMessage(record({ lookup_status: 'unavailable' }))).toBe(
      'No se pudo actualizar; se muestra el último dato.',
    )
    expect(conafMessage(record())).toBeNull()
  })
})
```

Run `npx vitest run src/lib/conafEstado.test.ts`; expected FAIL (module missing).

- [ ] **Step 2: API types and calls** — in `src/api.ts`, after the plazo types add:

```ts
/** One CONAF solicitud as the platform last read it (Estado CONAF). */
export interface ConafSolicitud {
  numero: string
  lookup_status: 'found' | 'not_found' | 'mismatch' | 'unavailable'
  tipo: string | null
  estado: string | null
  superficie_ha: number | null
  fecha_ingreso: string | null
  fecha_resolucion: string | null
  returned_solicitud: string | null
  checked_at: string
  found_at: string | null
  estado_changed_at: string | null
  stale: boolean
  recently_changed: boolean
  conaf_url: string
}
```

and after `getPlazos`:

```ts
/** `GET /conaf/solicitudes/{n}` — refreshed from CONAF when the stored result is old. */
export function getConafSolicitud(numero: string): Promise<ApiResult<ConafSolicitud>> {
  return request<ConafSolicitud>(`/api/conaf/solicitudes/${encodeURIComponent(numero)}`)
}

/** `POST /conaf/solicitudes/{n}/refresh` — «Actualizar desde CONAF». */
export function refreshConafSolicitud(numero: string): Promise<ApiResult<ConafSolicitud>> {
  return request<ConafSolicitud>(`/api/conaf/solicitudes/${encodeURIComponent(numero)}/refresh`, {
    method: 'POST',
  })
}

const CONAF_BULK_LIMIT = 500

/** Stored results for many numbers (never calls CONAF), in chunks of 500. */
export async function getConafSolicitudes(
  numeros: readonly string[],
): Promise<ApiResult<ConafSolicitud[]>> {
  const unique = [...new Set(numeros)]
  const all: ConafSolicitud[] = []
  for (let start = 0; start < unique.length; start += CONAF_BULK_LIMIT) {
    const chunk = unique.slice(start, start + CONAF_BULK_LIMIT)
    const result = await request<{ solicitudes: ConafSolicitud[] }>(
      withParams('/api/conaf/solicitudes', new URLSearchParams({ numeros: chunk.join(',') })),
    )
    if (!result.ok) return result
    all.push(...result.data.solicitudes)
  }
  return { ok: true, data: all }
}
```

- [ ] **Step 3: Implement** — create `src/lib/conafEstado.ts`:

```ts
/**
 * Estado CONAF, as the dashboard shows it: a tone with a text label (never
 * colour alone), how fresh the read is, and a plain message for every
 * result that is not a found solicitud. Same logic as Rodales' copy; the
 * products stay separate packages.
 */
import type { ConafSolicitud } from '../api'

export type ConafTone = 'ok' | 'progress' | 'danger' | 'muted' | 'neutral'

export const TONE_LABELS: Record<ConafTone, string> = {
  ok: 'Aprobada',
  progress: 'En evaluación',
  danger: 'Rechazada',
  muted: 'No vigente',
  neutral: 'Otro estado',
}

/** Transelec's existing status pills, by tone. */
export const TONE_PILL: Record<ConafTone, string> = {
  ok: 'pill-aprobado',
  progress: 'pill-en-tramite',
  danger: 'pill-pendiente',
  muted: 'pill-tachado',
  neutral: 'pill-otro',
}

/** 1–9 ASCII digits, padded to six (the server's rule); otherwise null. */
export function normalizeSolicitud(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!/^[0-9]{1,9}$/.test(value)) return null
  return value.padStart(6, '0')
}

export function conafTone(record: ConafSolicitud): ConafTone {
  const estado = (record.estado ?? '').toUpperCase()
  if (estado.includes('NO VIGENTE')) return 'muted'
  if (/RECHAZ|DENEG|DESIST|CADUC/.test(estado)) return 'danger'
  if (estado.includes('APROB')) return 'ok'
  if (/EVALUAC|TRAMIT|INGRES|REVISI|RECURSO/.test(estado)) return 'progress'
  return 'neutral'
}

export function freshness(record: ConafSolicitud, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(record.checked_at).getTime()) / 1000)
  if (seconds < 60) return 'Consultado hace un momento'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Consultado hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `Consultado hace ${hours} h`
  return `Consultado hace ${Math.floor(hours / 24)} días`
}

export function hasData(record: ConafSolicitud): boolean {
  return record.found_at !== null && record.estado !== null
}

export function conafMessage(record: ConafSolicitud): string | null {
  switch (record.lookup_status) {
    case 'not_found':
      return 'CONAF no encuentra esa solicitud.'
    case 'mismatch':
      return `CONAF respondió otra solicitud (${record.returned_solicitud ?? '?'}); revise el número.`
    case 'unavailable':
      return hasData(record)
        ? 'No se pudo actualizar; se muestra el último dato.'
        : 'No se pudo consultar CONAF ahora.'
    default:
      return null
  }
}
```

- [ ] **Step 4: Run** — the test file passes; `npx tsc -b` and `npm run lint` clean.
- [ ] **Step 5: Commit** — `feat(transelec): Estado CONAF model and API calls`.

---

### Task 2: Transelec «Estado CONAF» column

**Files:** Create `src/components/ConafEstadoCell.tsx`, `src/lib/conafColumn.tsx`, `src/components/ConafEstadoCell.test.tsx`; Modify `src/pages/EstadoPage.tsx`, `src/styles/base.css` (or the stylesheet that holds `.plazo-cell`).

- [ ] **Step 1: Failing tests** — `src/components/ConafEstadoCell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConafSolicitud } from '../api'
import { ConafEstadoCell } from './ConafEstadoCell'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, request: vi.fn() }
})

const base: ConafSolicitud = {
  numero: '090663', lookup_status: 'found', tipo: 'PLAN DE MANEJO', estado: 'APROBADA',
  superficie_ha: 3, fecha_ingreso: '2026-09-01', fecha_resolucion: '2026-10-10',
  returned_solicitud: null, checked_at: new Date().toISOString(), found_at: new Date().toISOString(),
  estado_changed_at: null, stale: false, recently_changed: false,
  conaf_url: 'https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=090663',
}

describe('ConafEstadoCell', () => {
  it('shows a text label and keeps the raw CONAF text in the title', () => {
    render(<ConafEstadoCell numero="90663" record={base} />)
    const pill = screen.getByText('Aprobada')
    expect(pill).toHaveClass('pill', 'pill-aprobado')
    expect(pill.closest('[title]')).toHaveAttribute('title', 'APROBADA · Consultado hace un momento')
  })

  it('marks a recent change and stale data', () => {
    render(<ConafEstadoCell numero="90663" record={{ ...base, recently_changed: true, stale: true }} />)
    expect(screen.getByText('Cambió')).toBeInTheDocument()
    expect(screen.getByText('Sin actualizar')).toBeInTheDocument()
  })

  it('skips numbers CONAF cannot answer', () => {
    render(<ConafEstadoCell numero="12/34-5/26" record={undefined} />)
    expect(screen.getByText('Sin N.º consultable')).toBeInTheDocument()
  })

  it('says when a number has not been read yet', () => {
    render(<ConafEstadoCell numero="090663" record={undefined} />)
    expect(screen.getByText('Sin consultar')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Implement** — `src/components/ConafEstadoCell.tsx`:

```tsx
/**
 * One PMF's CONAF status in a table: a pill with a text label, «Cambió» and
 * «Sin actualizar» when they apply, the raw CONAF text in the title.
 * Lists show stored data only; «Sin consultar» until the nightly read or a
 * detail view reads it.
 */
import type { ConafSolicitud } from '../api'
import {
  conafTone,
  freshness,
  hasData,
  normalizeSolicitud,
  TONE_LABELS,
  TONE_PILL,
} from '../lib/conafEstado'

export function ConafEstadoCell({
  numero,
  record,
}: {
  numero: string | null
  record: ConafSolicitud | undefined
}) {
  if (normalizeSolicitud(numero) === null) return <span className="hint">Sin N.º consultable</span>
  if (!record) return <span className="hint">Sin consultar</span>
  if (!hasData(record)) {
    const text = record.lookup_status === 'not_found' ? 'No existe en CONAF' : 'Revisar N.º'
    return <span className="hint conaf-warn">{text}</span>
  }
  const tone = conafTone(record)
  return (
    <span className="conaf-cell" title={`${record.estado} · ${freshness(record)}`}>
      <span className={`pill ${TONE_PILL[tone]}`}>{TONE_LABELS[tone]}</span>
      {record.recently_changed && <span className="chip conaf-changed">Cambió</span>}
      {record.stale && <span className="hint conaf-warn">Sin actualizar</span>}
    </span>
  )
}
```

`src/lib/conafColumn.tsx`:

```tsx
/**
 * The «Estado CONAF» column of the «Estado» table, after «Plazo CONAF». It
 * reads the most recent ingreso, the number the 90-day term counts from.
 */
import type { ConafSolicitud, LifecycleRow } from '../api'
import { ConafEstadoCell } from '../components/ConafEstadoCell'
import { normalizeSolicitud } from './conafEstado'
import type { EstadoColumn } from './estadoColumns'

export function conafNumero(row: Pick<LifecycleRow, 'numero_ingreso' | 'numero_ingreso_2'>): string | null {
  return row.numero_ingreso_2 ?? row.numero_ingreso
}

export function conafColumn(byNumero: ReadonlyMap<string, ConafSolicitud>): EstadoColumn {
  return {
    key: 'conaf',
    header: 'Estado CONAF',
    after: 'pmf',
    webFields: ['numero_ingreso', 'numero_ingreso_2'],
    render: (row) => {
      const numero = conafNumero(row)
      const normalized = normalizeSolicitud(numero)
      return <ConafEstadoCell numero={numero} record={normalized ? byNumero.get(normalized) : undefined} />
    },
  }
}
```

In `EstadoPage.tsx`: after the lifecycle read, add a CONAF read keyed on the numbers of the loaded rows, and pass the column after the plazo column:

```tsx
  const conafNumeros = useMemo(
    () =>
      (data?.rows ?? [])
        .map((row) => normalizeSolicitud(conafNumero(row)))
        .filter((numero): numero is string => numero !== null),
    [data],
  )
  const conafKey = conafNumeros.join(',')
  const conaf = useReads<ConafSolicitud[]>(
    useCallback(
      () => getConafSolicitudes(conafNumeros),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [conafKey],
    ),
    [conafKey],
  )
  const conafIndex = useMemo(
    () => new Map((conaf.data ?? []).map((record) => [record.numero, record])),
    [conaf.data],
  )
```

and `extraColumns={[plazoColumn(plazoIndex, plazos.loading), conafColumn(conafIndex)]}`. (Use the lifecycle response's row list field name as the page already does for the table; if it is not `rows`, use that name.) A failed CONAF read leaves the column at «Sin consultar»; it never blocks the table.

Styles (next to `.plazo-cell`):

```css
.conaf-cell {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-2);
}

.conaf-changed {
  border-color: #9cc3e6;
  background: #e8f2fb;
  color: #0b4f86;
}

.conaf-warn {
  color: #8a6100;
}
```

Add a test to the Estado page test (or `EstadoTable.test.tsx`) proving the column header «Estado CONAF» renders and that `getConafSolicitudes` is called once with normalized numbers only, and a unit test for `getConafSolicitudes` that 1,001 numbers make 3 requests (`reads in chunks of 500`), mocking `fetch`.

- [ ] **Step 3: Run** — new tests and the existing Estado tests pass; `npx tsc -b`, `npm run lint` clean.
- [ ] **Step 4: Commit** — `feat(transelec): Estado CONAF column on the Estado page`.

---

### Task 3: Transelec drawer card

**Files:** Create `src/components/ConafCard.tsx`, `src/components/ConafCard.test.tsx`; Modify `src/components/RowDetailDrawer.tsx`, styles.

- [ ] **Step 1: Failing tests** — `src/components/ConafCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConafSolicitud } from '../api'
import { ConafCard } from './ConafCard'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, getConafSolicitud: vi.fn(), refreshConafSolicitud: vi.fn() }
})
const api = vi.mocked(await import('../api'))

const found: ConafSolicitud = {
  numero: '090663', lookup_status: 'found', tipo: 'PLAN DE MANEJO', estado: 'EN EVALUACION',
  superficie_ha: 3.5, fecha_ingreso: '2026-09-01', fecha_resolucion: null, returned_solicitud: null,
  checked_at: new Date().toISOString(), found_at: new Date().toISOString(), estado_changed_at: null,
  stale: false, recently_changed: false,
  conaf_url: 'https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=090663',
}

beforeEach(() => vi.clearAllMocks())

describe('ConafCard', () => {
  it('shows the CONAF status, raw text, dates and a link', async () => {
    api.getConafSolicitud.mockResolvedValue({ ok: true, data: found })
    render(<ConafCard numero="90663" />)
    expect(await screen.findByText('En evaluación')).toBeInTheDocument()
    expect(screen.getByText('EN EVALUACION')).toBeInTheDocument()
    expect(screen.getByText('PLAN DE MANEJO')).toBeInTheDocument()
    expect(screen.getByText('3,50 ha')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver en CONAF/ })).toHaveAttribute('href', found.conaf_url)
    expect(api.getConafSolicitud).toHaveBeenCalledWith('090663')
  })

  it('disables refresh while busy and announces the result', async () => {
    const user = userEvent.setup()
    api.getConafSolicitud.mockResolvedValue({ ok: true, data: found })
    let resolve: (value: { ok: true; data: ConafSolicitud }) => void = () => {}
    api.refreshConafSolicitud.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<ConafCard numero="090663" />)
    await user.click(await screen.findByRole('button', { name: 'Actualizar desde CONAF' }))
    expect(screen.getByRole('button', { name: 'Consultando…' })).toBeDisabled()
    resolve({ ok: true, data: { ...found, estado: 'APROBADA' } })
    expect(await screen.findByRole('status')).toHaveTextContent('Estado actualizado desde CONAF.')
    expect(screen.getByText('Aprobada')).toBeInTheDocument()
  })

  it('keeps the last data when the refresh fails', async () => {
    const user = userEvent.setup()
    api.getConafSolicitud.mockResolvedValue({ ok: true, data: found })
    api.refreshConafSolicitud.mockResolvedValue({
      ok: true,
      data: { ...found, lookup_status: 'unavailable', stale: true },
    })
    render(<ConafCard numero="090663" />)
    await user.click(await screen.findByRole('button', { name: 'Actualizar desde CONAF' }))
    expect(await screen.findByText('No se pudo actualizar; se muestra el último dato.')).toBeInTheDocument()
    expect(screen.getByText('EN EVALUACION')).toBeInTheDocument()
  })

  it('never asks CONAF for a planilla-style number', () => {
    render(<ConafCard numero="12/34-5/26" />)
    expect(screen.getByText(/no se puede consultar en CONAF/)).toBeInTheDocument()
    expect(api.getConafSolicitud).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Implement** — `src/components/ConafCard.tsx`:

```tsx
/**
 * «Estado en CONAF» in the PMF drawer: what CONAF's public consulta says for
 * the most recent ingreso, how fresh that is, and «Actualizar desde CONAF».
 * Reading the card refreshes data older than 12 hours on the server.
 */
import { useEffect, useState } from 'react'
import { getConafSolicitud, refreshConafSolicitud, type ConafSolicitud } from '../api'
import {
  conafMessage,
  conafTone,
  freshness,
  hasData,
  normalizeSolicitud,
  TONE_LABELS,
  TONE_PILL,
} from '../lib/conafEstado'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function date(value: string | null): string {
  if (!value) return '—'
  const [y, m, d] = value.split('-')
  return `${d}/${m}/${y}`
}

type State = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; record: ConafSolicitud }

export function ConafCard({ numero }: { numero: string | null }) {
  const normalized = normalizeSolicitud(numero)
  const [state, setState] = useState<State>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (normalized === null) return
    let cancelled = false
    void getConafSolicitud(normalized).then((result) => {
      if (cancelled) return
      setState(result.ok ? { status: 'ready', record: result.data } : { status: 'error', error: result.error })
    })
    return () => {
      cancelled = true
    }
  }, [normalized])

  if (normalized === null) {
    return (
      <p className="hint">Este N.º no se puede consultar en CONAF (solo dígitos).</p>
    )
  }

  const refresh = async () => {
    setBusy(true)
    setNotice(null)
    const result = await refreshConafSolicitud(normalized)
    setBusy(false)
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    setState({ status: 'ready', record: result.data })
    setNotice(result.data.lookup_status === 'found' ? 'Estado actualizado desde CONAF.' : null)
  }

  if (state.status === 'loading') return <p className="hint">Consultando CONAF…</p>
  if (state.status === 'error') return <p className="hint conaf-warn">{state.error}</p>

  const { record } = state
  const message = conafMessage(record)
  const tone = conafTone(record)
  return (
    <div className="conaf-card" data-testid="conaf-card">
      {hasData(record) && (
        <div className="conaf-card__head">
          <span className={`pill ${TONE_PILL[tone]}`}>{TONE_LABELS[tone]}</span>
          {record.recently_changed && <span className="chip conaf-changed">Cambió</span>}
          <span className="conaf-card__raw">{record.estado}</span>
        </div>
      )}
      {message && <p className={record.lookup_status === 'found' ? 'hint' : 'hint conaf-warn'}>{message}</p>}
      {hasData(record) && (
        <dl className="conaf-card__facts">
          <div><dt>Tipo</dt><dd>{record.tipo ?? '—'}</dd></div>
          <div><dt>Superficie</dt><dd>{record.superficie_ha === null ? '—' : `${ha.format(record.superficie_ha)} ha`}</dd></div>
          <div><dt>Ingreso</dt><dd>{date(record.fecha_ingreso)}</dd></div>
          <div><dt>Resolución</dt><dd>{date(record.fecha_resolucion)}</dd></div>
        </dl>
      )}
      <div className="conaf-card__foot">
        <span className="hint">
          {freshness(record)}
          {record.stale ? ' · Sin actualizar' : ''}
        </span>
        <button type="button" className="btn btn-ghost" onClick={() => void refresh()} disabled={busy}>
          {busy ? 'Consultando…' : 'Actualizar desde CONAF'}
        </button>
        <a href={record.conaf_url} target="_blank" rel="noreferrer">
          Ver en CONAF ↗
        </a>
      </div>
      <p role="status" aria-atomic="true" className="hint">
        {notice ?? ''}
      </p>
    </div>
  )
}
```

(Use the dashboard's existing button classes; if they differ from `btn btn-ghost`, use the ones `OficinaVirtualLink` / the drawer use.)

In `RowDetailDrawer.tsx`, add after the «Tramitación» section:

```tsx
        <section className="drawer-section" aria-labelledby="drawer-conaf">
          <h3 id="drawer-conaf">Estado en CONAF</h3>
          <ConafCard
            key={current.numero_ingreso_2 ?? current.numero_ingreso ?? ''}
            numero={current.numero_ingreso_2 ?? current.numero_ingreso}
          />
        </section>
```

Styles:

```css
.conaf-card {
  display: grid;
  gap: var(--s-3);
}

.conaf-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-2);
}

.conaf-card__raw {
  font-size: var(--t-micro);
  color: var(--ink-2);
  letter-spacing: 0.02em;
}

.conaf-card__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--s-2) var(--s-4);
  margin: 0;
}

.conaf-card__facts dt {
  font-size: var(--t-micro);
  color: var(--ink-3);
}

.conaf-card__facts dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.conaf-card__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-3);
}
```

- [ ] **Step 3: Run** — card tests pass; drawer tests still pass; `tsc`, `lint` clean.
- [ ] **Step 4: Commit** — `feat(transelec): Estado en CONAF card in the PMF drawer`.

---

### Task 4: Rodales `conafEstado`, API and card

**Files:** Create `products/forestry/dashboard/src/lib/conafEstado.ts` and `.test.ts` (the Task 1 module and tests, with `ConafSolicitud` imported from `../reportsApi` and `TONE_PILL` mapping to Rodales classes `conaf-pill--ok|progress|danger|muted|neutral`); Modify `products/forestry/dashboard/src/reportsApi.ts`; Create `products/forestry/dashboard/src/components/ConafCard.tsx`; Modify `reports.css`.

- [ ] **Step 1** — copy Task 1's test as `src/lib/conafEstado.test.ts` (import paths `../reportsApi`); run, expect FAIL.
- [ ] **Step 2** — in `reportsApi.ts` add the `ConafSolicitud` interface (as Task 1), `conaf_solicitud: string | null` on `Report`, `conaf_solicitud?: string | null` in `updateReport`'s `changes`, and:

```ts
export function fetchConafSolicitud(numero: string): Promise<ConafSolicitud> {
  return getConafJson<ConafSolicitud>(`/api/conaf/solicitudes/${encodeURIComponent(numero)}`)
}

export async function refreshConafSolicitud(numero: string): Promise<ConafSolicitud> {
  return mutateAbsolute<ConafSolicitud>(`/api/conaf/solicitudes/${encodeURIComponent(numero)}/refresh`)
}

export async function fetchConafSolicitudes(numeros: string[]): Promise<ConafSolicitud[]> {
  const unique = [...new Set(numeros)]
  const all: ConafSolicitud[] = []
  for (let start = 0; start < unique.length; start += 500) {
    const chunk = unique.slice(start, start + 500).join(',')
    const body = await getConafJson<{ solicitudes: ConafSolicitud[] }>(
      `/api/conaf/solicitudes?numeros=${encodeURIComponent(chunk)}`,
    )
    all.push(...body.solicitudes)
  }
  return all
}
```

`api.ts`'s `getJson` and `mutate` prefix `/api/forestry`; add to `api.ts` two exported helpers without the prefix — `getConafJson<T>(absolutePath)` (same as `getJson` but with the path as given) and `mutateAbsolute<T>(absolutePath)` (a POST through the same CSRF logic: refactor `mutate` to take a full URL internally, keeping its current signature for `/api/forestry` paths).
- [ ] **Step 3** — `src/lib/conafEstado.ts` as Task 1 with:

```ts
export const TONE_PILL: Record<ConafTone, string> = {
  ok: 'conaf-pill conaf-pill--ok',
  progress: 'conaf-pill conaf-pill--progress',
  danger: 'conaf-pill conaf-pill--danger',
  muted: 'conaf-pill conaf-pill--muted',
  neutral: 'conaf-pill conaf-pill--neutral',
}
```

- [ ] **Step 4** — `src/components/ConafCard.tsx`: the Task 3 component with Rodales classes (`button button--ghost` for the refresh button; `report-section`-compatible markup; fetch via `fetchConafSolicitud` / `refreshConafSolicitud`, catching `ApiError` and showing `mutationMessage(error, 'No se pudo consultar CONAF ahora.')`).
- [ ] **Step 5** — `reports.css`:

```css
.conaf-pill {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
}

.conaf-pill--ok { background: var(--green-tint); color: var(--green-900); border-color: var(--green-line); }
.conaf-pill--progress { background: #fbefd9; color: #7a4f00; border-color: #e6c48a; }
.conaf-pill--danger { background: var(--flag-tint); color: var(--flag-ink); border-color: #e3b8ad; }
.conaf-pill--muted { background: var(--panel-2); color: var(--ink-3); border-color: var(--border-strong); }
.conaf-pill--neutral { background: var(--panel-2); color: var(--ink-2); border-color: var(--border); }

.conaf-card { display: grid; gap: 8px; font-size: 13px; }
.conaf-card__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.conaf-card__raw { color: var(--ink-2); font-size: 12px; }
.conaf-card__facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin: 0; }
.conaf-card__facts dt { color: var(--ink-3); font-size: 12px; }
.conaf-card__facts dd { margin: 0; font-variant-numeric: tabular-nums; }
.conaf-card__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.conaf-changed { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; background: #e3f0f8; color: #0b5c8c; }
.conaf-warn { color: #8a5300; }
```

- [ ] **Step 6: Run** — `conafEstado.test.ts` passes; `tsc`, `lint` clean.
- [ ] **Step 7: Commit** — `feat(rodales): Estado CONAF model, API and card`.

---

### Task 5: Rodales editor field and list column

**Files:** Modify `products/forestry/dashboard/src/pages/InformeEditorPage.tsx`, `src/pages/InformesPage.tsx`, `src/reports.test.tsx`.

- [ ] **Step 1: Failing tests** (append to `reports.test.tsx`; mock `fetchConafSolicitud`, `fetchConafSolicitudes`, `updateReport` in the existing `reportsApi` mock):

```tsx
describe('Estado CONAF in Rodales', () => {
  beforeEach(() => {
    api.fetchFeatureCollection.mockResolvedValue(baseCollection())
  })

  it('saves the number without touching the draft', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    reportsApi.updateReport.mockResolvedValue({ report_id: 7, status: 'borrador', revision: 2 })
    reportsApi.fetchConafSolicitud.mockResolvedValue(conafFound())
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.type(screen.getByLabelText('N.º solicitud CONAF'), '90663')
    await user.click(screen.getByRole('button', { name: 'Guardar N.º' }))
    expect(reportsApi.updateReport).toHaveBeenCalledWith(7, 1, { conaf_solicitud: '090663' })
    expect(await screen.findByText('En evaluación')).toBeInTheDocument()
    // The unsaved mark is still unsaved.
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })

  it('refuses a number CONAF cannot answer before saving', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    render(<RealEditor role="operator" reportId={7} />)
    await user.type(await screen.findByLabelText('N.º solicitud CONAF'), '12/34')
    await user.click(screen.getByRole('button', { name: 'Guardar N.º' }))
    expect(screen.getByText('Solo dígitos, hasta 9.')).toBeInTheDocument()
    expect(reportsApi.updateReport).not.toHaveBeenCalled()
  })

  it('shows the CONAF column in the list from stored data', async () => {
    reportsApi.fetchReports.mockResolvedValue({
      reports: [listedReport({ conaf_solicitud: '090663' })],
      pending_review_count: 0,
    })
    reportsApi.fetchConafSolicitudes.mockResolvedValue([conafFound()])
    render(<RealInformesPage role="viewer" />)
    expect(await screen.findByText('En evaluación')).toBeInTheDocument()
    expect(reportsApi.fetchConafSolicitudes).toHaveBeenCalledWith(['090663'])
  })
})
```

with a `conafFound()` helper returning a found `ConafSolicitud` for `090663` estado `EN EVALUACION`.

- [ ] **Step 2: Implement**
  - Editor panel (under the title block): a small form «N.º solicitud CONAF» with an input (id `report-conaf`, `inputMode="numeric"`, `maxLength=9`) and «Guardar N.º» (editable reports only; read-only text otherwise). On save: `normalizeSolicitud`; invalid → inline «Solo dígitos, hasta 9.»; empty → clears (`null`); else `updateReport(id, revision, { conaf_solicitud })`, then set the new revision in state (the draft is untouched) and show the card. The editor's `revision` state is the one both save paths use, so a later «Guardar» sends the bumped revision.
  - Below it, when a number is set: `<ConafCard numero={number} />` inside a `report-section` titled «Estado en CONAF».
  - Informes list: a «CONAF» column; after the list loads, call `fetchConafSolicitudes` with the reports' `conaf_solicitud` values (non-null); render a pill (`TONE_PILL` + `TONE_LABELS`) or «—»; a failed read leaves «—».
- [ ] **Step 3: Run** — `reports.test.tsx` all pass; `npm test`, `tsc`, `lint`, `build` clean.
- [ ] **Step 4: Commit** — `feat(rodales): CONAF number and status in reports`.

---

### Task 6: Browser verification and docs

- [ ] Local stack (`make forestry-dev` in this worktree with the copied `.env`): open a Rodales report, save number `090663`, see the card read CONAF (one real request, public data), press «Actualizar desde CONAF» (second press within 60 s answers from storage), check the list column. Transelec: if a local import is active, open the Estado page and a drawer; otherwise verify with the component tests and note it.
- [ ] Spanish docs: add «Estado CONAF» to `products/forestry/docs/es/informes-de-manejo.md` (what is shown, freshness, «Actualizar», the open question about the number); a short Spanish note for Transelec users in `products/transelect/docs/es/` (create `estado-conaf.md` and link it from the Transelec README's Spanish list); update `docs/platform/conaf-estado.md` Status.
- [ ] `make forestry-frontend-check`, the Transelec dashboard check (`cd products/transelect/dashboard && npm test && npx tsc -b && npm run lint && npm run build`), `make check`.
- [ ] Commit — `docs(conaf): Estado CONAF for users (es) and status`.
