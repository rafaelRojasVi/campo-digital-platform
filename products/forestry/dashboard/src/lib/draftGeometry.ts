export type DraftCoordinates = number[][][][]

export function cloneCoordinates(coordinates: DraftCoordinates): DraftCoordinates {
  return coordinates.map((polygon) =>
    polygon.map((ring) => ring.map(([x, y]) => [x ?? 0, y ?? 0])),
  )
}

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

export function isClosedRing(ring: number[][]): boolean {
  if (ring.length < 2) return false
  const first = ring[0]
  const last = ring[ring.length - 1]
  return (
    first !== undefined &&
    last !== undefined &&
    first[0] === last[0] &&
    first[1] === last[1]
  )
}

/** Mutates only the local draft coordinate copy. */
export function moveDraftVertex(
  coordinates: DraftCoordinates,
  polygonIndex: number,
  ringIndex: number,
  vertexIndex: number,
  x: number,
  y: number,
): void {
  const ring = coordinates[polygonIndex]?.[ringIndex]
  if (ring === undefined || ring[vertexIndex] === undefined) return

  const closed = isClosedRing(ring)
  const lastIndex = ring.length - 1
  ring[vertexIndex] = [x, y]

  if (closed && vertexIndex === 0) {
    ring[lastIndex] = [x, y]
  } else if (closed && vertexIndex === lastIndex) {
    ring[0] = [x, y]
  }
}
