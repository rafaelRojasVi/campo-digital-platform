// Where to write a polygon's label: a point well inside it. The bbox centre
// of a C-shaped or holed rodal can fall outside the shape, so the largest
// part is sampled on a grid and the point farthest from every edge wins (a
// cheap stand-in for a pole of inaccessibility). Coordinates are EPSG:32718.

type Ring = number[][]
type Polygon = Ring[]

function ringContains(ring: Ring, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi = 0, yi = 0] = ring[i] ?? []
    const [xj = 0, yj = 0] = ring[j] ?? []
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function polygonContains(polygon: Polygon, x: number, y: number): boolean {
  const [exterior, ...holes] = polygon
  if (exterior === undefined || !ringContains(exterior, x, y)) return false
  return !holes.some((hole) => ringContains(hole, x, y))
}

export function pointInMultiPolygon(coordinates: Polygon[], x: number, y: number): boolean {
  return coordinates.some((polygon) => polygonContains(polygon, x, y))
}

function segmentDistance(x: number, y: number, a: number[], b: number[]): number {
  const [ax = 0, ay = 0] = a
  const [bx = 0, by = 0] = b
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared))
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

function edgeDistance(polygon: Polygon, x: number, y: number): number {
  let best = Infinity
  for (const ring of polygon) {
    for (let i = 1; i < ring.length; i += 1) {
      best = Math.min(best, segmentDistance(x, y, ring[i - 1] ?? [], ring[i] ?? []))
    }
  }
  return best
}

function ringArea(ring: Ring): number {
  let twice = 0
  for (let i = 0; i < ring.length; i += 1) {
    const [x1 = 0, y1 = 0] = ring[i] ?? []
    const [x2 = 0, y2 = 0] = ring[(i + 1) % ring.length] ?? []
    twice += x1 * y2 - x2 * y1
  }
  return Math.abs(twice / 2)
}

const GRID = 12

export function labelPoint(coordinates: Polygon[]): [number, number] {
  let largest: Polygon | undefined
  let largestArea = -1
  for (const polygon of coordinates) {
    const area = ringArea(polygon[0] ?? [])
    if (area > largestArea) {
      largest = polygon
      largestArea = area
    }
  }
  const exterior = largest?.[0] ?? []
  let minx = Infinity
  let miny = Infinity
  let maxx = -Infinity
  let maxy = -Infinity
  for (const [x = 0, y = 0] of exterior) {
    minx = Math.min(minx, x)
    miny = Math.min(miny, y)
    maxx = Math.max(maxx, x)
    maxy = Math.max(maxy, y)
  }
  const centre: [number, number] = [(minx + maxx) / 2, (miny + maxy) / 2]
  if (largest === undefined || !Number.isFinite(minx)) return centre

  let best = centre
  let bestDistance = polygonContains(largest, ...centre) ? edgeDistance(largest, ...centre) : -1
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      const x = minx + ((i + 0.5) / GRID) * (maxx - minx)
      const y = miny + ((j + 0.5) / GRID) * (maxy - miny)
      if (!polygonContains(largest, x, y)) continue
      const distance = edgeDistance(largest, x, y)
      if (distance > bestDistance) {
        best = [x, y]
        bestDistance = distance
      }
    }
  }
  return best
}
