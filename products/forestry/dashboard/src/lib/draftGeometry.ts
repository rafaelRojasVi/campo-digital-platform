export type DraftCoordinates = number[][][][]

function signedRingArea(ring: number[][]): number {
  if (ring.length < 3) return 0

  let twiceArea = 0
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]
    if (current === undefined || next === undefined) continue
    const x1 = current[0] ?? 0
    const y1 = current[1] ?? 0
    const x2 = next[0] ?? 0
    const y2 = next[1] ?? 0
    twiceArea += x1 * y2 - x2 * y1
  }
  return twiceArea / 2
}

/**
 * Planar area in the storage CRS (EPSG:32718 metres). The source decoder
 * represents each polygon as exterior ring first, followed by zero or more holes.
 */
export function multiPolygonAreaSquareMeters(coordinates: DraftCoordinates): number {
  let total = 0

  for (const polygon of coordinates) {
    const exterior = polygon[0]
    if (exterior === undefined) continue

    let polygonArea = Math.abs(signedRingArea(exterior))
    for (const hole of polygon.slice(1)) {
      polygonArea -= Math.abs(signedRingArea(hole))
    }
    total += Math.max(0, polygonArea)
  }

  return total
}
