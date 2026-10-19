import { describe, expect, it } from 'vitest'
import { labelPoint, pointInMultiPolygon } from './labelPoint.ts'

const square = [[[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]]]
// A «C»: the bbox centre (50, 50) is in the open notch, outside the shape.
const cShape = [[[[0, 0], [100, 0], [100, 30], [30, 30], [30, 70], [100, 70], [100, 100], [0, 100], [0, 0]]]]

describe('pointInMultiPolygon', () => {
  it('honours holes and parts', () => {
    const withHole = [
      [
        [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
        [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]],
      ],
    ]
    expect(pointInMultiPolygon(withHole, 10, 10)).toBe(true)
    expect(pointInMultiPolygon(withHole, 50, 50)).toBe(false)
    expect(pointInMultiPolygon(cShape, 50, 50)).toBe(false)
  })
})

describe('labelPoint', () => {
  it('is the centre of a square', () => {
    const [x, y] = labelPoint(square)
    expect(x).toBeCloseTo(50, 0)
    expect(y).toBeCloseTo(50, 0)
  })

  it('stays inside a C-shaped polygon, away from its edges', () => {
    const [x, y] = labelPoint(cShape)
    expect(pointInMultiPolygon(cShape, x, y)).toBe(true)
    expect(x).toBeLessThan(30)
  })

  it('uses the largest part of a multipart polygon', () => {
    const parts = [
      [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
      [[[1000, 1000], [1200, 1000], [1200, 1200], [1000, 1200], [1000, 1000]]],
    ]
    const [x, y] = labelPoint(parts)
    expect(x).toBeGreaterThan(1000)
    expect(y).toBeGreaterThan(1000)
  })
})
