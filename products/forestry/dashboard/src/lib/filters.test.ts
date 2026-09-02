import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  applyFilters,
  countActiveFilters,
  filterOptions,
  type FilterState,
} from './filters.ts'
import { DEMO_COLLECTION } from '../demoData.ts'

// Uses this task's own synthetic 6-predio fixture (DEMO-01..DEMO-06) instead
// of the real-client predio names the source branch's test hardcoded.

const FEATURES = DEMO_COLLECTION.features

function codes(features: typeof FEATURES): (string | null)[] {
  return features.map((feature) => feature.properties.cod_predial)
}

describe('applyFilters', () => {
  it('filters by exact predio code', () => {
    const result = applyFilters(FEATURES, { ...EMPTY_FILTERS, codPredial: 'DEMO-01' })
    expect(codes(result)).toEqual(['DEMO-01'])
  })

  it('filters by uso_2026', () => {
    const result = applyFilters(FEATURES, { ...EMPTY_FILTERS, uso2026: 'PL' })
    expect(codes(result).sort()).toEqual(['DEMO-02', 'DEMO-03', 'DEMO-04'])
  })

  it('filters by rodal', () => {
    const result = applyFilters(FEATURES, { ...EMPTY_FILTERS, nRodal: 'R2' })
    expect(codes(result)).toEqual(['DEMO-05'])
  })

  it('filters by a 2024->2026 use-code change (DEMO-03 flips BN to PL)', () => {
    const result = applyFilters(FEATURES, { ...EMPTY_FILTERS, usoChange: 'changed' })
    expect(codes(result)).toEqual(['DEMO-03'])
  })

  it('filters by unchanged uso as the complement of the change filter', () => {
    const result = applyFilters(FEATURES, { ...EMPTY_FILTERS, usoChange: 'unchanged' })
    expect(codes(result).sort()).toEqual(['DEMO-01', 'DEMO-02', 'DEMO-04', 'DEMO-05', 'DEMO-06'])
  })

  it('filters by quality-flag presence (DEMO-06 carries duplicate_predio_rodal_key)', () => {
    const result = applyFilters(FEATURES, { ...EMPTY_FILTERS, quality: 'any' })
    expect(codes(result)).toEqual(['DEMO-06'])
  })

  it('filters by a specific quality flag value', () => {
    const result = applyFilters(FEATURES, {
      ...EMPTY_FILTERS,
      quality: 'duplicate_predio_rodal_key',
    })
    expect(codes(result)).toEqual(['DEMO-06'])
  })

  it('filters by geometry validity', () => {
    const validResult = applyFilters(FEATURES, { ...EMPTY_FILTERS, geometryValid: true })
    const invalidResult = applyFilters(FEATURES, { ...EMPTY_FILTERS, geometryValid: false })

    expect(codes(invalidResult)).toEqual(['DEMO-06'])
    expect(codes(validResult)).toHaveLength(5)
  })

  it('filters by free-text search, case- and accent-insensitive', () => {
    const result = applyFilters(FEATURES, { ...EMPTY_FILTERS, searchText: 'AROMOS' })
    expect(codes(result)).toEqual(['DEMO-01'])
  })

  it('matches free-text search against a numeric source_objectid', () => {
    const result = applyFilters(FEATURES, { ...EMPTY_FILTERS, searchText: '1005' })
    expect(codes(result)).toEqual(['DEMO-05'])
  })

  it('combines multiple active filters with AND semantics', () => {
    const result = applyFilters(FEATURES, { ...EMPTY_FILTERS, uso2026: 'PL', nRodal: 'R1' })
    expect(codes(result).sort()).toEqual(['DEMO-02', 'DEMO-03', 'DEMO-04'])
  })

  it('returns every feature for the empty filter state', () => {
    expect(applyFilters(FEATURES, EMPTY_FILTERS)).toHaveLength(6)
  })
})

describe('countActiveFilters', () => {
  it('counts zero for the empty filter state', () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0)
  })

  it('counts each non-null/non-empty field once', () => {
    const filters: FilterState = {
      ...EMPTY_FILTERS,
      codPredial: 'DEMO-01',
      geometryValid: true,
      searchText: 'aromos',
    }
    expect(countActiveFilters(filters)).toBe(3)
  })

  it('ignores a search box containing only whitespace', () => {
    expect(countActiveFilters({ ...EMPTY_FILTERS, searchText: '   ' })).toBe(0)
  })
})

describe('filterOptions', () => {
  it('lists distinct uso_2026 values ordered by descending feature count', () => {
    const options = filterOptions(FEATURES, 'uso_2026')

    expect(options[0]).toEqual({ value: 'PL', count: 3 })
    expect(options.map((option) => option.value).sort()).toEqual(['AG', 'BN', 'PL'])
  })

  it('lists distinct cod_predial values, one per predio', () => {
    const options = filterOptions(FEATURES, 'cod_predial')
    expect(options).toHaveLength(6)
    expect(options.every((option) => option.count === 1)).toBe(true)
  })
})
