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
      report_date: '2027-01-15' as string | null,
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
      conaf_solicitud: null,
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
