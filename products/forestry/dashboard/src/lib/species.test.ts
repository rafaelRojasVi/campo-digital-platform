import { describe, expect, it } from 'vitest'
import {
  ENSAYO_GROUP,
  NO_SPECIES_GROUP,
  speciesGroup,
  speciesLabel,
  speciesTokens,
} from './species.ts'

describe('speciesTokens', () => {
  it.each([
    ['Pi06', ['Pi']],
    ['Pi?? Rzg', ['Pi']],
    ['Pi24??', ['Pi']],
    ['En?? Rzg', ['En']],
    ['Ro', ['Ro']],
    ['Ar Rn', ['Ar']],
    ['Ar Ro', ['Ar']],
    ['Eg91 Pi Rn', ['Eg']],
    ['Co02 Ar Rn', ['Co']],
    ['PiPo98', ['Pi', 'Po']],
    ['Po99Eg97', ['Po', 'Eg']],
    ['CoRa04En08', ['Co', 'Ra', 'En']],
    ['RaCoRo01P*', ['Ra', 'Co', 'Ro']],
    ['UlTe02', ['Ul', 'Te']],
    ['CPLCo06', ['Co']],
    ['PoSs05', ['Po', 'Ss']],
    ['Al97', ['Al']],
  ])('reads %s as %j', (code, expected) => {
    expect(speciesTokens(code)).toEqual(expected)
  })

  it.each(['BN', 'VN', 'Ve', 'Ve PLT', 'Prot', 'Mat', 'Mx', 'Ali', 'Adm', 'APF06', 'CCV En', 'CAS Ar Rn', 'CL', 'Escuela', 'ES98 PoRa', ''])(
    'finds no planted species in %j',
    (code) => {
      expect(speciesTokens(code)).toEqual([])
    },
  )

  it('does not repeat a species that appears twice', () => {
    expect(speciesTokens('PiPi03')).toEqual(['Pi'])
  })
})

describe('speciesGroup', () => {
  it('names a single species', () => {
    expect(speciesGroup('Pi06')).toEqual({ key: 'Pi', label: 'Pino radiata' })
    expect(speciesGroup('Eg97 Rzg')).toEqual({
      key: 'Eg',
      label: 'Eucalyptus globulus',
    })
  })

  it('names the species Campo Digital confirmed on 2026-10-19', () => {
    expect(speciesGroup('Se18')).toEqual({ key: 'Se', label: 'Secuoya' })
    expect(speciesGroup('Al05').label).toBe('Aliso')
    expect(speciesGroup('Ci10').label).toBe('Ciprés')
  })

  it('keeps a mixed plantation as its own group, whatever order the code uses', () => {
    expect(speciesGroup('PoRaCo98')).toEqual({
      key: 'Po+Co+Ra',
      label: 'Mixta: pino oregón + coigüe + raulí',
    })
    expect(speciesGroup('RaCo07')).toEqual(speciesGroup('CoRa03'))
    expect(speciesGroup('Co06Po06').key).toBe('Po+Co')
    expect(speciesGroup('PoSs05')).toEqual({
      key: 'Po+Ss',
      label: 'Mixta: pino oregón + Sequoia sempervirens',
    })
  })

  it('groups species trials apart from polygons without a species', () => {
    expect(speciesGroup('ES98 PoRa')).toBe(ENSAYO_GROUP)
    expect(speciesGroup('ES')).toBe(ENSAYO_GROUP)
    expect(speciesGroup('BN')).toBe(NO_SPECIES_GROUP)
    expect(speciesGroup(null)).toBe(NO_SPECIES_GROUP)
  })
})

describe('speciesLabel', () => {
  it('names a group from its key', () => {
    expect(speciesLabel('Po')).toBe('Pino oregón')
    expect(speciesLabel('Co+Ra')).toBe('Mixta: coigüe + raulí')
    expect(speciesLabel(ENSAYO_GROUP.key)).toBe('Ensayo (varias especies)')
    expect(speciesLabel(NO_SPECIES_GROUP.key)).toBe('Sin especie en el código')
  })
})
