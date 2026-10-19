// The «Medir» tool: lengths and areas of points clicked on the map, computed
// in EPSG:32718 metres (planar, the same CRS as Sup_ha), not on the sphere.

export interface Measurement {
  /** Along the clicked points, in order (the closing edge is not counted). */
  lengthM: number
  /** The area the points enclose, from three points on; null before. */
  areaM2: number | null
}

export function measurePath(points: [number, number][]): Measurement {
  let lengthM = 0
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i - 1]!
    const [x2, y2] = points[i]!
    lengthM += Math.hypot(x2 - x1, y2 - y1)
  }
  if (points.length < 3) return { lengthM, areaM2: null }
  let twice = 0
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]!
    const [x2, y2] = points[(i + 1) % points.length]!
    twice += x1 * y2 - x2 * y1
  }
  return { lengthM, areaM2: Math.abs(twice) / 2 }
}

const decimals = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const whole = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 })

export function formatDistance(metres: number): string {
  return metres < 1000 ? `${whole.format(metres)} m` : `${decimals.format(metres / 1000)} km`
}

export function formatArea(squareMetres: number): string {
  return `${decimals.format(squareMetres / 10_000)} ha`
}
