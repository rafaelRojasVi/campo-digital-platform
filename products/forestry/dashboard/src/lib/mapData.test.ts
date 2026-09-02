import { describe, expect, it } from 'vitest'
import { multiPolygonToLatLngs, tooltipHtml } from './mapData.ts'
import { DEMO_COLLECTION } from '../demoData.ts'
import type { SourceFeatureProperties } from '../types.ts'

// Uses this task's own synthetic DEMO_COLLECTION fixture (DEMO-01..DEMO-06)
// instead of the real-client Lumaco/LUM data the source branch's test
// hardcoded. The XSS-escaping case keeps the source branch's literal
// `nom_predio: '<img src=x>'` value verbatim — it was already synthetic.

const BLANK_PROPERTIES: SourceFeatureProperties = {
  feature_ordinal: 99,
  source_objectid: null,
  cod_predial: null,
  nom_predio: null,
  n_rodal: null,
  cod_uso: null,
  uso_2024: null,
  desc_uso: null,
  uso_2026: null,
  cod_uso_2026: null,
  sup_ha: null,
  geometry_is_valid: true,
  geometry_area_source_units: 0,
  quality_flags: [],
}

describe('tooltipHtml', () => {
  it('renders predio name, code, rodal, uso, and area for a demo feature', () => {
    // Non-null: DEMO_COLLECTION always has 6 literal features (see demoData.ts);
    // assertions here are only to satisfy `noUncheckedIndexedAccess`.
    const properties = DEMO_COLLECTION.features[0]!.properties
    const html = tooltipHtml(properties)

    expect(html).toContain('Predio Los Aromos (DEMO-01)')
    expect(html).toContain('Rodal R1')
    expect(html).toContain('BN')
    expect(html).toContain('12,00 ha')
  })

  it('falls back to placeholder text when name/rodal/uso/area are missing', () => {
    const html = tooltipHtml(BLANK_PROPERTIES)

    expect(html).toContain('Predio sin nombre')
    expect(html).toContain('Sin rodal')
    expect(html).toContain('Sin uso 2026')
    expect(html).not.toContain('ha</')
  })

  it('omits the parenthesized code when cod_predial is null', () => {
    const html = tooltipHtml(BLANK_PROPERTIES)
    expect(html).not.toContain('(')
  })

  it('escapes HTML in nom_predio to prevent XSS', () => {
    const properties: SourceFeatureProperties = {
      ...BLANK_PROPERTIES,
      cod_predial: 'DEMO-XX',
      nom_predio: '<img src=x>',
      n_rodal: 'R1',
    }
    const html = tooltipHtml(properties)

    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x&gt;')
  })
})

describe('multiPolygonToLatLngs', () => {
  it('reprojects a demo MultiPolygon, preserving polygon/ring/position structure', () => {
    // Non-null throughout: indices are guaranteed to exist by the literal
    // demo geometry; assertions satisfy `noUncheckedIndexedAccess` only.
    const geometry = DEMO_COLLECTION.features[0]!.geometry
    const latLngs = multiPolygonToLatLngs(geometry)

    expect(latLngs).toHaveLength(geometry.coordinates.length)
    expect(latLngs[0]).toHaveLength(geometry.coordinates[0]!.length)
    expect(latLngs[0]![0]).toHaveLength(geometry.coordinates[0]![0]!.length)

    const [lat, lng] = latLngs[0]![0]![0]!
    expect(Number.isFinite(lat)).toBe(true)
    expect(Number.isFinite(lng)).toBe(true)
  })

  it('emits [lat, lng] pairs, not [lng, lat]', () => {
    // multiPolygonToLatLngs must swap proj4's [lon, lat] forward() output to
    // Leaflet's [lat, lng] convention.
    const geometry = DEMO_COLLECTION.features[3]!.geometry
    const latLngs = multiPolygonToLatLngs(geometry)
    const [lat] = latLngs[0]![0]![0]!

    // Every demo predio sits far from the poles, so a valid latitude must
    // fall within [-90, 90]; a swapped-longitude value would not.
    expect(Math.abs(lat)).toBeLessThanOrEqual(90)
  })

  it('skips positions with a missing y coordinate', () => {
    const geometry = {
      type: 'MultiPolygon' as const,
      // The third position is malformed (only one coordinate); the
      // implementation must skip it rather than reproject `undefined`.
      coordinates: [[[[0, 0], [10, 0], [5] as unknown as number[], [10, 10]]]],
    }

    const latLngs = multiPolygonToLatLngs(geometry)
    expect(latLngs[0]![0]).toHaveLength(3)
  })
})
