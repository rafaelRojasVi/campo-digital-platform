import { describe, expect, it } from 'vitest'
import {
  BLANK_COLOR,
  CATEGORICAL_COLORS,
  CHANGED_COLOR,
  OTHER_COLOR,
  QUALITY_COLOR,
  UNCHANGED_COLOR,
  buildColorEncoding,
} from './palette.ts'
import { makeFeature, testFeatures } from '../test/fixtures.ts'

describe('categorical encoding', () => {
  it('assigns distinct colors by descending area, largest first', () => {
    const features = testFeatures()
    const encoding = buildColorEncoding('uso2026', features)

    const first = encoding.legend[0]
    expect(first?.label).toBe('PLANTACION')
    expect(first?.color).toBe(CATEGORICAL_COLORS[0])

    const plantacion = features.find((f) => f.properties.uso_2026 === 'PLANTACION')
    expect(encoding.colorFor(plantacion!)).toBe(CATEGORICAL_COLORS[0])
  })

  it('folds categories beyond the validated 8 slots into a gray "Otros" entry', () => {
    const features = Array.from({ length: 12 }, (_, index) =>
      makeFeature({
        feature_ordinal: index + 1,
        uso_2026: `USO ${String.fromCharCode(65 + index)}`,
        sup_ha: 100 - index,
      }),
    )

    const encoding = buildColorEncoding('uso2026', features)
    const foldEntry = encoding.legend.find((entry) => entry.isFold)

    expect(foldEntry).toBeDefined()
    expect(foldEntry?.color).toBe(OTHER_COLOR)
    expect(foldEntry?.featureCount).toBe(12 - CATEGORICAL_COLORS.length)
    expect(foldEntry?.filterValue).toBeNull()

    const smallest = features[features.length - 1]
    expect(encoding.colorFor(smallest!)).toBe(OTHER_COLOR)
  })

  it('does not fold when the vocabulary fits the palette', () => {
    const encoding = buildColorEncoding('uso2026', testFeatures())
    expect(encoding.legend.some((entry) => entry.isFold)).toBe(false)
  })

  it('groups blank source values separately', () => {
    const features = [makeFeature({ uso_2026: null }), makeFeature({ uso_2026: 'VEGA' })]
    const encoding = buildColorEncoding('uso2026', features)

    expect(encoding.colorFor(features[0]!)).toBe(BLANK_COLOR)
    expect(encoding.legend.find((entry) => entry.key === '__blank__')).toBeDefined()
  })
})

describe('cambio encoding', () => {
  it('marks literal field differences without business semantics', () => {
    const features = testFeatures()
    const encoding = buildColorEncoding('cambio', features)

    const changed = features.find((f) => f.properties.feature_ordinal === 2)
    const unchanged = features.find((f) => f.properties.feature_ordinal === 1)

    expect(encoding.colorFor(changed!)).toBe(CHANGED_COLOR)
    expect(encoding.colorFor(unchanged!)).toBe(UNCHANGED_COLOR)

    const changedEntry = encoding.legend.find((entry) => entry.key === 'changed')
    expect(changedEntry?.featureCount).toBe(2)
  })
})

describe('calidad encoding', () => {
  it('marks features with any quality evidence', () => {
    const features = testFeatures()
    const encoding = buildColorEncoding('calidad', features)

    const withEvidence = features.find((f) => f.properties.feature_ordinal === 5)
    const clean = features.find((f) => f.properties.feature_ordinal === 1)

    expect(encoding.colorFor(withEvidence!)).toBe(QUALITY_COLOR)
    expect(encoding.colorFor(clean!)).not.toBe(QUALITY_COLOR)

    const evidenceEntry = encoding.legend.find((entry) => entry.key === 'with-evidence')
    expect(evidenceEntry?.featureCount).toBe(4)
  })
})

describe('especie encoding', () => {
  const stand = (ordinal: number, code: string | null, supHa: number, predio = 'HT') =>
    makeFeature({ feature_ordinal: ordinal, cod_uso_2026: code, sup_ha: supHa, cod_predial: predio })

  it('colors and sums by species read from the 2026 code, largest first', () => {
    const features = [stand(1, 'Pi06', 30), stand(2, 'Pi26', 10), stand(3, 'En22', 25), stand(4, 'BN', 50)]
    const encoding = buildColorEncoding('especie', features)

    expect(encoding.legend.map((entry) => [entry.label, entry.supHaTotal, entry.featureCount])).toEqual([
      ['Pino radiata', 40, 2],
      ['Eucalyptus nitens', 25, 1],
      ['Sin especie en el código', 50, 1],
    ])
    expect(encoding.colorFor(features[1]!)).toBe(CATEGORICAL_COLORS[0])
    expect(encoding.colorFor(features[3]!)).toBe(BLANK_COLOR)
    expect(encoding.legend[0]?.filterValue).toBe('Pi')
  })

  it('sums the filtered polygons while keeping colors from the whole base', () => {
    const features = [stand(1, 'Pi06', 40), stand(2, 'En22', 25, 'SS'), stand(3, 'En23', 5, 'SS')]
    const filtered = features.filter((feature) => feature.properties.cod_predial === 'SS')
    const encoding = buildColorEncoding('especie', features, filtered)

    expect(encoding.legend.map((entry) => [entry.key, entry.supHaTotal])).toEqual([['En', 30]])
    expect(encoding.colorFor(features[1]!)).toBe(CATEGORICAL_COLORS[1])
  })

  it('lists every species beyond the 8 colors instead of folding them', () => {
    const codes = ['Pi', 'En', 'Po', 'Eg', 'Ro', 'Co', 'Ar', 'Ra', 'UlTe', 'Se']
    const features = codes.map((code, index) => stand(index + 1, `${code}01`, 100 - index))
    const encoding = buildColorEncoding('especie', features)

    expect(encoding.legend.some((entry) => entry.isFold)).toBe(false)
    expect(encoding.legend).toHaveLength(10)
    expect(encoding.legend[9]).toMatchObject({ label: 'Secuoya', color: OTHER_COLOR })
    expect(encoding.colorFor(features[9]!)).toBe(OTHER_COLOR)
  })
})
