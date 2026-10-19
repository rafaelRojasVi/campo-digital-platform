import { describe, expect, it } from 'vitest'
import { multiPolygonAreaSquareMeters } from './draftGeometry.ts'

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
})
