import { describe, expect, it } from 'vitest'
import {
  cloneCoordinates,
  moveDraftVertex,
  multiPolygonAreaSquareMeters,
} from './draftGeometry.ts'

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
