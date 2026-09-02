import { describe, expect, it } from 'vitest'
import {
  lonLatToUtm,
  multiPolygonUtmBbox,
  utmBboxToLonLatBounds,
  utmToLonLat,
  type MultiPolygonLike,
} from './proj.ts'

// These coordinate pairs are invented for this test only. They are chosen to
// sit numerically far away from the real Degenfeld estate's UTM envelope
// (`620000, 5490000` / `617298.09, 5484858.7`) so they can never be confused
// with, or accidentally validated against, real client geometry. No pyproj
// cross-check is claimed here — only internal round-trip consistency.

describe('utmToLonLat / lonLatToUtm', () => {
  it('round-trips a synthetic coordinate pair back to itself', () => {
    const [lon, lat] = utmToLonLat(300_000, 9_000_000)
    const [easting, northing] = lonLatToUtm(lon, lat)

    expect(easting).toBeCloseTo(300_000, 3)
    expect(northing).toBeCloseTo(9_000_000, 3)
  })

  it('round-trips a second, distinct synthetic coordinate pair', () => {
    const [lon, lat] = utmToLonLat(410_500, 8_725_250)
    const [easting, northing] = lonLatToUtm(lon, lat)

    expect(easting).toBeCloseTo(410_500, 3)
    expect(northing).toBeCloseTo(8_725_250, 3)
  })

  it('throws when reprojection cannot produce a finite result', () => {
    expect(() => utmToLonLat(Number.NaN, 9_000_000)).toThrow()
  })
})

describe('utmBboxToLonLatBounds', () => {
  it('reprojects all four corners of a synthetic bbox into a consistent envelope', () => {
    const bbox: [number, number, number, number] = [300_000, 9_000_000, 320_000, 9_020_000]
    const bounds = utmBboxToLonLatBounds(bbox)

    const corners = [
      utmToLonLat(300_000, 9_000_000),
      utmToLonLat(300_000, 9_020_000),
      utmToLonLat(320_000, 9_000_000),
      utmToLonLat(320_000, 9_020_000),
    ]
    const lons = corners.map((corner) => corner[0])
    const lats = corners.map((corner) => corner[1])

    expect(bounds.west).toBeCloseTo(Math.min(...lons), 9)
    expect(bounds.east).toBeCloseTo(Math.max(...lons), 9)
    expect(bounds.south).toBeCloseTo(Math.min(...lats), 9)
    expect(bounds.north).toBeCloseTo(Math.max(...lats), 9)
    expect(bounds.west).toBeLessThan(bounds.east)
    expect(bounds.south).toBeLessThan(bounds.north)
  })
})

describe('multiPolygonUtmBbox', () => {
  it('computes the raw-CRS envelope of a synthetic multipolygon without reprojecting', () => {
    const geometry: MultiPolygonLike = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [100, 200],
            [500, 200],
            [500, 600],
            [100, 600],
            [100, 200],
          ],
        ],
      ],
    }

    expect(multiPolygonUtmBbox(geometry)).toEqual([100, 200, 500, 600])
  })

  it('takes the envelope across multiple polygons/rings', () => {
    const geometry: MultiPolygonLike = {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]]],
        [[[900, 900], [950, 900], [950, 950], [900, 950], [900, 900]]],
      ],
    }

    expect(multiPolygonUtmBbox(geometry)).toEqual([0, 0, 950, 950])
  })

  it('throws when the geometry has no coordinates', () => {
    const empty: MultiPolygonLike = { type: 'MultiPolygon', coordinates: [] }
    expect(() => multiPolygonUtmBbox(empty)).toThrow()
  })
})
