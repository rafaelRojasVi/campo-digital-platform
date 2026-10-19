import { describe, expect, it } from 'vitest'
import { formatArea, formatDistance, measurePath } from './measure.ts'

describe('measurePath', () => {
  it('sums the segments in order; two points have no area', () => {
    expect(measurePath([[0, 0], [300, 400]])).toEqual({ lengthM: 500, areaM2: null })
    expect(measurePath([[0, 0], [300, 400], [300, 1400]])).toEqual({
      lengthM: 1500,
      areaM2: 150_000,
    })
  })

  it('closes three or more points into an area', () => {
    const result = measurePath([[0, 0], [100, 0], [100, 100], [0, 100]])
    expect(result.lengthM).toBe(300)
    expect(result.areaM2).toBe(10_000)
  })

  it('has nothing to say about one point', () => {
    expect(measurePath([[5, 5]])).toEqual({ lengthM: 0, areaM2: null })
  })
})

describe('formats', () => {
  it('writes metres below a kilometre and km above', () => {
    expect(formatDistance(850.4)).toBe('850 m')
    expect(formatDistance(1234)).toBe('1,23 km')
  })

  it('writes hectares with two decimals', () => {
    expect(formatArea(45_678)).toBe('4,57 ha')
  })
})
