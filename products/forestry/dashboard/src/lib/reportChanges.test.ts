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

  it('includes planning fields in the review detail when set', () => {
    const changes = describeChanges(
      [
        {
          source_feature_ordinal: 4,
          in_report: true,
          geometry_changed: false,
          attributes: { n_rodal: '22', sup_ha: 5.0 },
          sector: 'Norte',
          reforest_species: ['pino radiata', 'coigüe'],
          reforest_density: 850,
        },
      ],
      [base(4, '22')],
    )
    expect(changes[0]?.detail).toContain('Sector: Norte')
    expect(changes[0]?.detail).toContain('Esp. reforestar: pino radiata + coigüe')
    expect(changes[0]?.detail).toContain('Dens. refor.: 850 pl/ha')
  })
})
