import { describe, expect, it } from 'vitest'
import {
  metersPerPixel,
  multiPolygonToLatLngs,
  nonOverlapping,
  predioLabels,
  rodalLabelHtml,
  tooltipHtml,
} from './mapData.ts'
import { utmToLonLat } from './proj.ts'
import { makeFeature } from '../test/fixtures.ts'

describe('tooltipHtml', () => {
  it('shows predio, rodal, uso and area', () => {
    const html = tooltipHtml(
      makeFeature({ nom_predio: 'Lumaco', cod_predial: 'LUM', n_rodal: '7', sup_ha: 1.5 })
        .properties,
    )

    expect(html).toContain('Lumaco (LUM)')
    expect(html).toContain('Rodal 7')
    expect(html).toContain('PLANTACION')
    expect(html).toContain('1,50 ha')
  })

  it('escapes HTML in source values', () => {
    const html = tooltipHtml(makeFeature({ nom_predio: '<img src=x>' }).properties)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x&gt;')
  })

  it('names the species read from the 2026 code', () => {
    const html = tooltipHtml(makeFeature({ cod_uso_2026: 'Pi06' }).properties)
    expect(html).toContain('Pino radiata')
    expect(tooltipHtml(makeFeature({ cod_uso_2026: 'BN' }).properties)).not.toContain('especie')
  })

  it('labels blank rodal explicitly', () => {
    const html = tooltipHtml(makeFeature({ n_rodal: '' }).properties)
    expect(html).toContain('Sin rodal')
  })
})

describe('multiPolygonToLatLngs', () => {
  it('reprojects every stored vertex to [lat, lng] without mutating the source', () => {
    const geometry = {
      type: 'MultiPolygon' as const,
      coordinates: [
        [
          [
            [620000, 5490000],
            [620100, 5490000],
            [620100, 5490100],
            [620000, 5490000],
          ],
        ],
      ],
    }
    const originalJson = JSON.stringify(geometry)

    const latLngs = multiPolygonToLatLngs(geometry)

    expect(latLngs).toHaveLength(1)
    expect(latLngs[0]).toHaveLength(1)
    expect(latLngs[0]?.[0]).toHaveLength(4)

    const [expectedLon, expectedLat] = utmToLonLat(620000, 5490000)
    expect(latLngs[0]?.[0]?.[0]?.[0]).toBeCloseTo(expectedLat, 10)
    expect(latLngs[0]?.[0]?.[0]?.[1]).toBeCloseTo(expectedLon, 10)

    expect(JSON.stringify(geometry)).toBe(originalJson)
  })
})

describe('metersPerPixel', () => {
  it('matches the web mercator ground resolution at the equator', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03392, 3)
  })

  it('shrinks with latitude and zoom', () => {
    const atEstate = metersPerPixel(-40.45, 10)
    expect(atEstate).toBeGreaterThan(100)
    expect(atEstate).toBeLessThan(130)
    expect(metersPerPixel(-40.45, 11)).toBeCloseTo(atEstate / 2, 6)
  })
})

describe('predioLabels', () => {
  const square = (x: number, y: number, side: number) => ({
    type: 'MultiPolygon' as const,
    coordinates: [[[[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]]]],
  })

  it('places one escaped label per predio at its largest polygon', () => {
    const small = { ...makeFeature({ nom_predio: 'A<b>', sup_ha: 1 }), geometry: square(0, 0, 10) }
    const large = { ...makeFeature({ nom_predio: 'A<b>', sup_ha: 50 }), geometry: square(1000, 2000, 100) }
    const other = { ...makeFeature({ nom_predio: 'Millantue', sup_ha: 8 }), geometry: square(0, 0, 20) }

    expect(predioLabels([small, large, other])).toEqual([
      { name: 'A<b>', html: 'A&lt;b&gt;', x: 1050, y: 2050, areaHa: 51 },
      { name: 'Millantue', html: 'Millantue', x: 10, y: 10, areaHa: 8 },
    ])
  })

  it('skips polygons without a predio name', () => {
    expect(predioLabels([makeFeature({ nom_predio: null })])).toEqual([])
  })
})

describe('nonOverlapping', () => {
  it('keeps the first of two clashing labels and any label clear of both', () => {
    const boxes = [
      { left: 0, top: 0, right: 100, bottom: 20 },
      { left: 50, top: 10, right: 150, bottom: 30 },
      { left: 0, top: 40, right: 100, bottom: 60 },
    ]
    expect(nonOverlapping(boxes)).toEqual([true, false, true])
  })

  it('drops labels under a blocked area', () => {
    const box = { left: 0, top: 0, right: 100, bottom: 20 }
    expect(nonOverlapping([box], 4, [{ left: 90, top: 0, right: 200, bottom: 50 }])).toEqual([false])
  })
})

describe('rodalLabelHtml', () => {
  it('writes the rodal in bold over its code, escaped', () => {
    expect(rodalLabelHtml(makeFeature({ n_rodal: '766', cod_uso_2026: 'Pi06' }).properties)).toBe(
      '<b>766</b><small>Pi06</small>',
    )
    expect(rodalLabelHtml(makeFeature({ n_rodal: '<1>', cod_uso_2026: null }).properties)).toBe(
      '<b>&lt;1&gt;</b>',
    )
  })

  it('falls back to the code alone, or nothing', () => {
    expect(rodalLabelHtml(makeFeature({ n_rodal: ' ', cod_uso_2026: 'BN' }).properties)).toBe(
      '<small>BN</small>',
    )
    expect(rodalLabelHtml(makeFeature({ n_rodal: null, cod_uso_2026: null }).properties)).toBeNull()
  })
})
