import { describe, expect, it } from 'vitest'
import { multiPolygonAreaSquareMeters } from './draftGeometry.ts'
import { interiorPoint, lineCrosses, splitByPolyline, unionPieces, type Coordinates } from './splitGeometry.ts'

const SQUARE: Coordinates = [[[[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]]]]
const HOLED: Coordinates = [
  [
    [[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]],
    [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]],
  ],
]
const TWO_PARTS: Coordinates = [
  [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]],
  [[[20, 0], [20, 10], [30, 10], [30, 0], [20, 0]]],
]
const BOWTIE: Coordinates = [[[[0, 0], [100, 100], [0, 100], [100, 0], [0, 0]]]]

const area = (pieces: Coordinates[]) =>
  pieces.map((piece) => Math.round(multiPolygonAreaSquareMeters(piece)))

describe('splitByPolyline', () => {
  it('splits a square with a bent line into two pieces that add up', () => {
    const result = splitByPolyline(SQUARE, [[50, -10], [55, 30], [45, 70], [50, 110]])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pieces).toHaveLength(2)
    expect(area(result.pieces).reduce((a, b) => a + b, 0)).toBe(10_000)
  })

  it('keeps the hole out of both pieces', () => {
    const result = splitByPolyline(HOLED, [[50, -10], [50, 110]])
    expect(result.ok && area(result.pieces)).toEqual([4800, 4800])
  })

  it('splits one part of a multipart rodal and keeps the other as its own piece', () => {
    const result = splitByPolyline(TWO_PARTS, [[5, -1], [5, 11]])
    expect(result.ok && area(result.pieces).sort((a, b) => a - b)).toEqual([50, 50, 100])
  })

  it('makes three pieces when the line crosses twice', () => {
    const result = splitByPolyline(SQUARE, [[-10, 20], [110, 20], [110, 40], [-10, 40]])
    expect(result.ok && result.pieces).toHaveLength(3)
  })

  it('explains a line that ends inside the rodal', () => {
    expect(splitByPolyline(SQUARE, [[50, -10], [50, 50]])).toEqual({
      ok: false,
      reason: 'not_crossing',
    })
  })

  it('refuses a single point', () => {
    expect(splitByPolyline(SQUARE, [[50, -10]])).toEqual({ ok: false, reason: 'too_short' })
  })

  it('refuses a piece under 1 m²', () => {
    expect(splitByPolyline(SQUARE, [[0.5, -1], [0.5, 1.5], [-1, 1.5]])).toEqual({
      ok: false,
      reason: 'too_small',
    })
  })

  it('refuses to split an invalid base polygon', () => {
    expect(splitByPolyline(BOWTIE, [[50, -10], [50, 110]])).toEqual({
      ok: false,
      reason: 'invalid_source',
    })
  })
})

describe('unionPieces and lineCrosses', () => {
  it('reunites pieces into the original area', () => {
    const result = splitByPolyline(SQUARE, [[50, -10], [50, 110]])
    if (!result.ok) throw new Error('split failed')
    expect(Math.round(multiPolygonAreaSquareMeters(unionPieces(result.pieces)))).toBe(10_000)
  })

  it('tells whether a line touches a polygon', () => {
    expect(lineCrosses(SQUARE, [[50, -10], [50, 110]])).toBe(true)
    expect(lineCrosses(SQUARE, [[200, -10], [200, 110]])).toBe(false)
  })
})

describe('interiorPoint', () => {
  it('places a label inside a concave piece, never in its hole', () => {
    // A «U»: the centroid falls in the notch, outside the polygon.
    const u: Coordinates = [[[[0, 0], [0, 100], [30, 100], [30, 30], [70, 30], [70, 100], [100, 100], [100, 0], [0, 0]]]]
    const [x, y] = interiorPoint(u)
    const insideNotch = x > 30 && x < 70 && y > 30
    expect(insideNotch).toBe(false)
    expect(lineCrosses(u, [[x - 0.01, y], [x + 0.01, y]])).toBe(true)
  })
})
