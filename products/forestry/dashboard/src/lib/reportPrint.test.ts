import { describe, expect, it } from 'vitest'
import { printRows } from './reportPrint.ts'
import type { ReportFeature } from '../reportsApi.ts'

const square = { type: 'MultiPolygon' as const, coordinates: [[[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]]] }

function feature(position: number, attributes: ReportFeature['attributes'], inReport: boolean): ReportFeature {
  return { position, source_feature_ordinal: position, in_report: inReport, geometry_changed: false, attributes, geometry: square, sector: null, reforest_species: null, reforest_density: null }
}

describe('printRows', () => {
  it('lists managed polygons first, by rodal, with species and totals', () => {
    const { rows, totalHa, managedHa } = printRows([
      feature(1, { n_rodal: '766', cod_uso_2026: 'BN', nom_predio: 'Hacienda Trinidad', uso_2026: 'BOSQUE NATIVO', sup_ha: 295.35 }, false),
      feature(2, { n_rodal: '766-1', cod_uso_2026: 'Pi06', nom_predio: 'Hacienda Trinidad', uso_2026: 'PLANTACION', sup_ha: 132.21 }, true),
      feature(3, { n_rodal: '17', cod_uso_2026: 'Po99Eg97', nom_predio: 'Lumaco', uso_2026: 'PLANTACION', sup_ha: 4 }, true),
    ])
    expect(rows.map((row) => [row.rodal, row.managed, row.species])).toEqual([
      ['17', true, 'Mixta: pino oregón + Eucalyptus globulus'],
      ['766-1', true, 'Pino radiata'],
      ['766', false, '—'],
    ])
    expect(totalHa).toBeCloseTo(431.56, 2)
    expect(managedHa).toBeCloseTo(136.21, 2)
  })

  it('falls back to the drawn area when Sup_ha is missing', () => {
    const { rows } = printRows([feature(1, { n_rodal: null }, true)])
    expect(rows[0]).toMatchObject({ rodal: '—', code: '—', ha: 1 })
  })
})
