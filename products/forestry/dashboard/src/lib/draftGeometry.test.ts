import { describe, expect, it } from 'vitest'
import {
  cloneCoordinates,
  countDraftVertices,
  moveDraftVertex,
  multiPolygonAreaSquareMeters,
  pickHandleIndices,
  simplifyDraftCoordinates,
  straightCutCandidates,
} from './draftGeometry.ts'

function circleRing(pointCount: number, radius = 1000): number[][] {
  const ring: number[][] = []
  for (let index = 0; index < pointCount; index += 1) {
    const angle = (index / pointCount) * Math.PI * 2
    ring.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
  }
  ring.push(ring[0]!)
  return ring
}

describe('draft geometry area', () => {
  it('calculates exterior area in source metres', () => {
    const coordinates = [[[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]]]
    expect(multiPolygonAreaSquareMeters(coordinates)).toBe(10_000)
  })

  it('subtracts holes and sums polygon parts', () => {
    const coordinates = [
      [
        [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
        [[25, 25], [75, 25], [75, 75], [25, 75], [25, 25]],
      ],
      [[[200, 0], [250, 0], [250, 50], [200, 50], [200, 0]]],
    ]
    expect(multiPolygonAreaSquareMeters(coordinates)).toBe(10_000)
  })

  it('moves a closed-ring first vertex without mutating the source copy', () => {
    const source = [[[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]]]
    const draft = cloneCoordinates(source)

    moveDraftVertex(draft, 0, 0, 0, 10, 20)

    expect(draft[0]?.[0]?.[0]).toEqual([10, 20])
    expect(draft[0]?.[0]?.[4]).toEqual([10, 20])
    expect(source[0]?.[0]?.[0]).toEqual([0, 0])
  })
})

describe('draft point reduction', () => {
  it('reduces near-collinear vertices while preserving closure and source geometry', () => {
    const source = [[[[0, 0], [25, 0.2], [50, -0.1], [75, 0.1], [100, 0], [100, 100], [0, 100], [0, 0]]]]
    const simplified = simplifyDraftCoordinates(source, 1)

    expect(countDraftVertices(simplified)).toBeLessThan(countDraftVertices(source))
    expect(simplified[0]?.[0]?.[0]).toEqual(simplified[0]?.[0]?.at(-1))
    expect(source[0]?.[0]).toHaveLength(8)
    expect(multiPolygonAreaSquareMeters(simplified)).toBeCloseTo(10_000, -1)
  })
})

describe('handle index reduction', () => {
  it('keeps every index when the ring is already small', () => {
    const square = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]
    expect(pickHandleIndices(square, 180)).toEqual([0, 1, 2, 3])
  })

  it('caps handle count for a large ring without exceeding the max', () => {
    const ring = circleRing(960)
    const indices = pickHandleIndices(ring, 180)

    expect(indices.length).toBeLessThanOrEqual(180)
    expect(indices.length).toBeGreaterThan(0)
    expect(new Set(indices).size).toBe(indices.length)
    for (const index of indices) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(960)
    }
  })

  it('returns indices into the real vertex array, not new coordinates', () => {
    const ring = circleRing(500)
    const indices = pickHandleIndices(ring, 50)

    for (const index of indices) {
      expect(ring[index]).toBeDefined()
    }
  })
})

describe('straight draft cuts', () => {
  const square = [[[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]]]

  it('splits a simple polygon into two pieces with conserved area', () => {
    const result = straightCutCandidates(square, [-10, 40], [110, 40])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.areasSquareMeters[0] + result.areasSquareMeters[1]).toBeCloseTo(10_000)
    expect(result.areasSquareMeters.sort((a, b) => a - b)).toEqual([4000, 6000])
    expect(result.largerPieceIndex).toBe(0)
  })

  it('keeps a hole the line does not touch on the side that contains it', () => {
    const withHole = [[
      [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
      [[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]],
    ]]
    const result = straightCutCandidates(withHole, [-10, 40], [110, 40])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Left of the left-to-right line is the upper side; the hole sits below.
    expect(result.areasSquareMeters).toEqual([6000, 3900])
    expect(result.pieces[0][0]).toHaveLength(1)
    expect(result.pieces[1][0]).toHaveLength(2)
    expect(result.untouched).toEqual([])
  })

  it('cuts through a hole, leaving a notch in both pieces', () => {
    const withHole = [[
      [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
      [[40, 30], [60, 30], [60, 50], [40, 50], [40, 30]],
    ]]
    const result = straightCutCandidates(withHole, [-10, 40], [110, 40])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.areasSquareMeters[0]).toBeCloseTo(5800)
    expect(result.areasSquareMeters[1]).toBeCloseTo(3800)
    // Each side is one simple ring; the hole became part of its outline.
    for (const piece of result.pieces) {
      expect(piece).toHaveLength(1)
      expect(piece[0]).toHaveLength(1)
    }
  })

  it('cuts only the part of a multipart polygon the line crosses', () => {
    const multipart = [
      [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]],
      [[[200, 0], [250, 0], [250, 50], [200, 50], [200, 0]]],
    ]
    const result = straightCutCandidates(multipart, [-10, 40], [110, 40])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.areasSquareMeters).toEqual([6000, 4000])
    expect(result.untouched).toEqual([multipart[1]])
  })

  it('cuts every part the line crosses and keeps sides consistent', () => {
    const multipart = [
      [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]],
      [[[200, 0], [250, 0], [250, 50], [200, 50], [200, 0]]],
    ]
    const result = straightCutCandidates(multipart, [-10, 40], [260, 40])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.pieces[0]).toHaveLength(2)
    expect(result.pieces[1]).toHaveLength(2)
    expect(result.areasSquareMeters).toEqual([6000 + 500, 4000 + 2000])
    expect(result.untouched).toEqual([])
  })

  it('refuses a line that ends inside a hole', () => {
    const withHole = [[
      [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
      [[40, 30], [60, 30], [60, 50], [40, 50], [40, 30]],
    ]]
    const result = straightCutCandidates(withHole, [-10, 40], [50, 40])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/hueco/)
  })

  it('cuts a concave outline the line crosses four times into three pieces', () => {
    const uShape = [[[[0, 0], [100, 0], [100, 100], [70, 100], [70, 30], [30, 30], [30, 100], [0, 100], [0, 0]]]]
    const result = straightCutCandidates(uShape, [-10, 60], [110, 60])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Both arm tops are above (left of) the line; the base is below.
    expect(result.pieces[0]).toHaveLength(2)
    expect(result.pieces[1]).toHaveLength(1)
    expect(result.areasSquareMeters[0]).toBeCloseTo(2400)
    expect(result.areasSquareMeters[1]).toBeCloseTo(4800)
  })

  it('cuts through a notch and a hole in the same stroke', () => {
    // A square with a notch cut into its bottom edge and a hole above it.
    const notched = [[
      [[0, 0], [40, 0], [40, 30], [60, 30], [60, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
      [[45, 50], [55, 50], [55, 70], [45, 70], [45, 50]],
    ]]
    const result = straightCutCandidates(notched, [50, 110], [50, -10])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const total = 100 * 100 - 20 * 30 - 10 * 20
    expect(result.areasSquareMeters[0] + result.areasSquareMeters[1]).toBeCloseTo(total)
    expect(result.areasSquareMeters[0]).toBeCloseTo(total / 2)
    expect(result.pieces[0]).toHaveLength(1)
    expect(result.pieces[1]).toHaveLength(1)
  })

  it('handles a clockwise exterior the same as a counter-clockwise one', () => {
    const clockwise = [[[[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]]]]
    const result = straightCutCandidates(clockwise, [-10, 40], [110, 40])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.areasSquareMeters).toEqual([6000, 4000])
  })

  it('refuses a line that starts inside the polygon', () => {
    const result = straightCutCandidates(square, [50, 50], [110, 50])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/fuera del polígono/)
  })

  it('requires the line to cross the boundary', () => {
    const result = straightCutCandidates(square, [-10, -10], [-5, -5])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/no cruza/)
  })
})
