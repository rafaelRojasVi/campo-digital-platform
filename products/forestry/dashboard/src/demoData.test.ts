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
    expect(DEMO_SNAPSHOT.feature_count).toBe(6)
  })

  it('demoFeatureDetail resolves a known ordinal and rejects an unknown one', () => {
    expect(demoFeatureDetail(0)?.cod_predial).toBe('DEMO-01')
    expect(demoFeatureDetail(999)).toBeNull()
  })

  it('the source-field comparison shows at least one 2024->2026 use-code change', () => {
    expect(DEMO_COMPARISON.uso_2024_vs_uso_2026.changed_feature_count).toBeGreaterThan(0)
  })
})
