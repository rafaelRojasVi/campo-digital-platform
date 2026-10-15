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

export function countDraftVertices(coordinates: DraftCoordinates): number {
  let total = 0
  for (const polygon of coordinates) {
    for (const ring of polygon) {
      total += isClosedRing(ring) ? Math.max(0, ring.length - 1) : ring.length
    }
  }
  return total
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

function squaredDistance(a: number[], b: number[]): number {
  const dx = (a[0] ?? 0) - (b[0] ?? 0)
  const dy = (a[1] ?? 0) - (b[1] ?? 0)
  return dx * dx + dy * dy
}

function squaredSegmentDistance(point: number[], start: number[], end: number[]): number {
  const px = point[0] ?? 0
  const py = point[1] ?? 0
  const sx = start[0] ?? 0
  const sy = start[1] ?? 0
  const ex = end[0] ?? 0
  const ey = end[1] ?? 0
  const dx = ex - sx
  const dy = ey - sy

  if (dx === 0 && dy === 0) return squaredDistance(point, start)

  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)))
  const qx = sx + t * dx
  const qy = sy + t * dy
  const qdx = px - qx
  const qdy = py - qy
  return qdx * qdx + qdy * qdy
}

function simplifyOpenLine(points: number[][], toleranceSquared: number): number[][] {
  if (points.length <= 2) return points.map((point) => [...point])

  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) return points.map((point) => [...point])

  let maxDistance = 0
  let splitIndex = 0
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]
    if (point === undefined) continue
    const distance = squaredSegmentDistance(point, first, last)
    if (distance > maxDistance) {
      maxDistance = distance
      splitIndex = index
    }
  }

  if (maxDistance <= toleranceSquared || splitIndex === 0) {
    return [[...first], [...last]]
  }

  const left = simplifyOpenLine(points.slice(0, splitIndex + 1), toleranceSquared)
  const right = simplifyOpenLine(points.slice(splitIndex), toleranceSquared)
  return [...left.slice(0, -1), ...right]
}

/**
 * Simplify one closed ring without changing its closure. The ring is split at
 * the vertex farthest from the first vertex, then each arc is simplified
 * independently so the cyclic boundary does not collapse into one segment.
 */
function simplifyClosedRing(ring: number[][], toleranceMeters: number): number[][] {
  const open = isClosedRing(ring) ? ring.slice(0, -1) : ring.slice()
  if (open.length <= 4 || toleranceMeters <= 0) return ring.map((point) => [...point])

  const first = open[0]
  if (first === undefined) return ring.map((point) => [...point])

  let splitIndex = 1
  let farthest = -1
  for (let index = 1; index < open.length; index += 1) {
    const point = open[index]
    if (point === undefined) continue
    const distance = squaredDistance(point, first)
    if (distance > farthest) {
      farthest = distance
      splitIndex = index
    }
  }

  if (splitIndex <= 0 || splitIndex >= open.length) return ring.map((point) => [...point])

  const toleranceSquared = toleranceMeters * toleranceMeters
  const firstArc = simplifyOpenLine(open.slice(0, splitIndex + 1), toleranceSquared)
  const secondArc = simplifyOpenLine([...open.slice(splitIndex), first], toleranceSquared)
  const combined = [...firstArc, ...secondArc.slice(1, -1)]

  if (combined.length < 3) return ring.map((point) => [...point])
  return [...combined.map((point) => [...point]), [...combined[0]!]]
}

/**
 * Reduce draft vertices using a tolerance measured in source-CRS metres.
 * This is local display/edit geometry only and never mutates the source array.
 */
export function simplifyDraftCoordinates(
  coordinates: DraftCoordinates,
  toleranceMeters: number,
): DraftCoordinates {
  return coordinates.map((polygon) =>
    polygon.map((ring) => simplifyClosedRing(ring, toleranceMeters)),
  )
}

function simplifyOpenLineIndices(points: number[][], toleranceSquared: number): number[] {
  if (points.length <= 2) return points.map((_, index) => index)

  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) return points.map((_, index) => index)

  let maxDistance = 0
  let splitIndex = 0
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]
    if (point === undefined) continue
    const distance = squaredSegmentDistance(point, first, last)
    if (distance > maxDistance) {
      maxDistance = distance
      splitIndex = index
    }
  }

  if (maxDistance <= toleranceSquared || splitIndex === 0) {
    return [0, points.length - 1]
  }

  const left = simplifyOpenLineIndices(points.slice(0, splitIndex + 1), toleranceSquared)
  const right = simplifyOpenLineIndices(points.slice(splitIndex), toleranceSquared).map(
    (index) => index + splitIndex,
  )
  return Array.from(new Set([...left, ...right])).sort((a, b) => a - b)
}

/**
 * Same farthest-point split as {@link simplifyClosedRing}, but returns the
 * *indices* of surviving vertices (relative to the open ring, no duplicate
 * closing point) instead of new coordinates. Used to pick a reduced set of
 * editable handles without mutating the draft geometry itself.
 */
function significantRingIndices(open: number[][], toleranceMeters: number): number[] {
  if (open.length <= 4 || toleranceMeters <= 0) return open.map((_, index) => index)

  const first = open[0]
  if (first === undefined) return open.map((_, index) => index)

  let splitIndex = 1
  let farthest = -1
  for (let index = 1; index < open.length; index += 1) {
    const point = open[index]
    if (point === undefined) continue
    const distance = squaredDistance(point, first)
    if (distance > farthest) {
      farthest = distance
      splitIndex = index
    }
  }

  if (splitIndex <= 0 || splitIndex >= open.length) return open.map((_, index) => index)

  const toleranceSquared = toleranceMeters * toleranceMeters
  const firstArc = simplifyOpenLineIndices(open.slice(0, splitIndex + 1), toleranceSquared)
  const secondArcPoints = [...open.slice(splitIndex), first]
  const secondArc = simplifyOpenLineIndices(secondArcPoints, toleranceSquared).map((index) =>
    index === secondArcPoints.length - 1 ? 0 : splitIndex + index,
  )

  return Array.from(new Set([...firstArc, ...secondArc])).sort((a, b) => a - b)
}

/**
 * Pick a bounded subset of "significant" vertex indices (Douglas-Peucker
 * corners) from a closed ring, for use as editable handles. Purely a display
 * decision: the draft coordinates are never mutated, and every index refers
 * to a real vertex, so dragging a handle still moves that exact vertex.
 */
export function pickHandleIndices(ring: number[][], maxHandles: number): number[] {
  const open = isClosedRing(ring) ? ring.slice(0, -1) : ring.slice()
  if (open.length <= maxHandles || open.length <= 4) {
    return open.map((_, index) => index)
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of open) {
    const x = point[0] ?? 0
    const y = point[1] ?? 0
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY) || 1

  let tolerance = diagonal * 0.0004
  let indices = significantRingIndices(open, tolerance)
  let guard = 0
  while (indices.length > maxHandles && guard < 30) {
    tolerance *= 1.6
    indices = significantRingIndices(open, tolerance)
    guard += 1
  }

  return indices
}

interface SegmentIntersection {
  point: [number, number]
  edgeIndex: number
  edgeT: number
  cutT: number
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx
}

function segmentIntersection(
  start: number[],
  end: number[],
  cutStart: [number, number],
  cutEnd: [number, number],
  edgeIndex: number,
): SegmentIntersection | null {
  const px = start[0] ?? 0
  const py = start[1] ?? 0
  const rx = (end[0] ?? 0) - px
  const ry = (end[1] ?? 0) - py
  const qx = cutStart[0]
  const qy = cutStart[1]
  const sx = cutEnd[0] - qx
  const sy = cutEnd[1] - qy
  const denominator = cross(rx, ry, sx, sy)
  const epsilon = 1e-9

  if (Math.abs(denominator) < epsilon) return null

  const qmpx = qx - px
  const qmpy = qy - py
  const edgeT = cross(qmpx, qmpy, sx, sy) / denominator
  const cutT = cross(qmpx, qmpy, rx, ry) / denominator

  if (edgeT < -epsilon || edgeT > 1 + epsilon || cutT < -epsilon || cutT > 1 + epsilon) {
    return null
  }

  return {
    point: [px + edgeT * rx, py + edgeT * ry],
    edgeIndex,
    edgeT,
    cutT,
  }
}

/** Open boundary arc from one crossing to the next, following ring order. */
function ringArc(
  vertices: number[][],
  start: SegmentIntersection,
  end: SegmentIntersection,
): number[][] {
  const arc: number[][] = [[...start.point]]
  const vertexCount = vertices.length
  let index = (start.edgeIndex + 1) % vertexCount
  const stop = (end.edgeIndex + 1) % vertexCount
  let guard = 0

  while (index !== stop && guard <= vertexCount) {
    const vertex = vertices[index]
    if (vertex !== undefined) arc.push([...vertex])
    index = (index + 1) % vertexCount
    guard += 1
  }

  arc.push([...end.point])
  return arc
}

export type StraightCutResult =
  | {
      ok: true
      /** Index 0 is left of the drawn line (start → end), index 1 is right. */
      pieces: [DraftCoordinates, DraftCoordinates]
      /** Parts the line does not cross; they stay whichever side is kept. */
      untouched: DraftCoordinates
      areasSquareMeters: [number, number]
      largerPieceIndex: 0 | 1
    }
  | { ok: false; reason: string }

type CutSide = 0 | 1

interface RingCrossing extends SegmentIntersection {
  /** Ring index within the polygon part (0 = exterior). */
  ring: number
  /** Position among that ring's crossings, in ring order. */
  order: number
}

interface CutFace {
  side: CutSide
  ring: number[][]
}

function pointInRing(point: number[], ring: number[][]): boolean {
  const x = point[0] ?? 0
  const y = point[1] ?? 0
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const xi = ring[index]?.[0] ?? 0
    const yi = ring[index]?.[1] ?? 0
    const xj = ring[previous]?.[0] ?? 0
    const yj = ring[previous]?.[1] ?? 0
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function locateInPart(part: number[][][], point: number[]): 'outside' | 'inside' | 'hole' {
  if (!pointInRing(point, part[0]!)) return 'outside'
  return part.slice(1).some((hole) => pointInRing(point, hole)) ? 'hole' : 'inside'
}

/** Copy of a closed ring, reversed if needed to get the requested winding. */
function orientRing(ring: number[][], counterClockwise: boolean): number[][] {
  const copy = ring.map((point) => [...point])
  return signedRingArea(ring) > 0 === counterClockwise ? copy : copy.reverse()
}

/** Crossings of the cut with one closed ring, or null if it hits a vertex. */
function ringCrossings(
  ring: number[][],
  cutStart: [number, number],
  cutEnd: [number, number],
): SegmentIntersection[] | null {
  const vertices = ring.slice(0, -1)
  const crossings: SegmentIntersection[] = []
  for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex += 1) {
    const start = vertices[edgeIndex]
    const end = vertices[(edgeIndex + 1) % vertices.length]
    if (start === undefined || end === undefined) continue
    const intersection = segmentIntersection(start, end, cutStart, cutEnd, edgeIndex)
    if (intersection === null) continue
    // A line through an existing vertex touches two adjoining edges and is
    // ambiguous. Ask the user to draw a cleaner cut instead.
    if (intersection.edgeT < 1e-7 || intersection.edgeT > 1 - 1e-7) return null
    crossings.push(intersection)
  }
  return crossings.sort((a, b) => a.edgeIndex + a.edgeT - (b.edgeIndex + b.edgeT))
}

/**
 * Split one polygon part along the drawn segment. The exterior is wound
 * counter-clockwise and holes clockwise, so the interior is always on the
 * left of a ring. Sorted along the line, crossings pair up into chords that
 * lie inside the part. Each piece is traced by following a ring to its next
 * crossing, jumping along that crossing's chord, and repeating until the
 * walk closes. The direction a piece walks its chords says which side of the
 * line it is on. Holes the line misses go to the piece that contains them.
 *
 * Returns null when the line misses the part, or a reason when it cannot be
 * cut safely.
 */
function cutPart(
  part: number[][][],
  cutStart: [number, number],
  cutEnd: [number, number],
): { pieces: [DraftCoordinates, DraftCoordinates] } | { reason: string } | null {
  const rings = part.map((ring, index) => orientRing(ring, index === 0))
  const crossingsByRing: RingCrossing[][] = []
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const found = ringCrossings(rings[ringIndex]!, cutStart, cutEnd)
    if (found === null) {
      return { reason: 'El corte pasa exactamente por un vértice; muévelo un poco.' }
    }
    crossingsByRing.push(found.map((crossing, order) => ({ ...crossing, ring: ringIndex, order })))
  }

  const crossings = crossingsByRing.flat()
  if (crossings.length === 0) return null

  const endpoints = [locateInPart(part, cutStart), locateInPart(part, cutEnd)]
  if (endpoints.includes('hole')) {
    return { reason: 'La línea no puede empezar ni terminar dentro de un hueco.' }
  }
  if (endpoints.includes('inside')) {
    return { reason: 'La línea debe empezar y terminar fuera del polígono.' }
  }

  // With both ends outside, the line alternates out → in → out, so
  // consecutive crossings along it bound the chords inside the part.
  const alongLine = [...crossings].sort((a, b) => a.cutT - b.cutT)
  const partner = new Map<RingCrossing, RingCrossing>()
  for (let index = 0; index + 1 < alongLine.length; index += 2) {
    partner.set(alongLine[index]!, alongLine[index + 1]!)
    partner.set(alongLine[index + 1]!, alongLine[index]!)
  }
  const nextOnRing = (crossing: RingCrossing): RingCrossing => {
    const ringCrossingsList = crossingsByRing[crossing.ring]!
    return ringCrossingsList[(crossing.order + 1) % ringCrossingsList.length]!
  }

  const faces: CutFace[] = []
  const visited = new Set<RingCrossing>()
  for (const start of crossings) {
    if (visited.has(start)) continue
    const ring: number[][] = []
    let side: CutSide | null = null
    let current = start
    let steps = 0

    do {
      visited.add(current)
      const end = nextOnRing(current)
      const vertices = rings[current.ring]!.slice(0, -1)
      for (const point of ringArc(vertices, current, end)) ring.push(point)

      const across = partner.get(end)
      if (across === undefined) {
        return { reason: 'No se pudo calcular el corte; prueba otra línea.' }
      }
      // Walking the chord with the piece on the left: forward along the
      // line means the piece is left of it.
      const chordSide: CutSide = across.cutT > end.cutT ? 0 : 1
      if (side === null) {
        side = chordSide
      } else if (side !== chordSide) {
        return { reason: 'La línea rodea una parte del polígono; prueba otra línea.' }
      }

      current = across
      steps += 1
      if (steps > crossings.length) {
        return { reason: 'No se pudo calcular el corte; prueba otra línea.' }
      }
    } while (current !== start)

    ring.push([...ring[0]!])
    faces.push({ side: side!, ring })
  }

  const polygons = faces.map((face) => [face.ring])
  part.slice(1).forEach((hole, index) => {
    if (crossingsByRing[index + 1]!.length > 0) return
    const owner = faces.findIndex((face) => pointInRing(hole[0]!, face.ring))
    polygons[owner === -1 ? 0 : owner]!.push(hole.map((point) => [...point]))
  })

  const pieces: [DraftCoordinates, DraftCoordinates] = [[], []]
  faces.forEach((face, index) => pieces[face.side].push(polygons[index]!))
  return { pieces }
}

/**
 * Split a draft with a user-drawn straight segment. Every polygon part the
 * line crosses is cut, however many times the line enters and leaves it and
 * including through holes; each resulting piece belongs to the left or right
 * side of the line. Parts the line misses are returned untouched. The line
 * must start and end outside the polygon, so the result never depends on
 * guessing topology.
 */
export function straightCutCandidates(
  coordinates: DraftCoordinates,
  cutStart: [number, number],
  cutEnd: [number, number],
): StraightCutResult {
  if (squaredDistance(cutStart, cutEnd) < 1) {
    return { ok: false, reason: 'La línea de corte es demasiado corta.' }
  }

  const pieces: [DraftCoordinates, DraftCoordinates] = [[], []]
  const untouched: DraftCoordinates = []

  for (const part of coordinates) {
    const exterior = part[0]
    if (exterior === undefined || !isClosedRing(exterior) || exterior.length < 4) {
      return { ok: false, reason: 'La geometría del borrador no tiene un anillo simple cerrado.' }
    }

    const result = cutPart(part, cutStart, cutEnd)
    if (result === null) {
      untouched.push(part.map((ring) => ring.map((point) => [...point])))
      continue
    }
    if ('reason' in result) return { ok: false, reason: result.reason }
    pieces[0].push(...result.pieces[0])
    pieces[1].push(...result.pieces[1])
  }

  if (pieces[0].length === 0 && pieces[1].length === 0) {
    const startsInside = coordinates.some((part) => locateInPart(part, cutStart) !== 'outside')
    return {
      ok: false,
      reason: startsInside
        ? 'La línea debe empezar y terminar fuera del polígono.'
        : 'La línea no cruza el polígono.',
    }
  }

  const areaA = multiPolygonAreaSquareMeters(pieces[0])
  const areaB = multiPolygonAreaSquareMeters(pieces[1])
  if (areaA < 1 || areaB < 1) {
    return { ok: false, reason: 'El corte produciría una pieza prácticamente vacía.' }
  }
  return {
    ok: true,
    pieces,
    untouched,
    areasSquareMeters: [areaA, areaB],
    largerPieceIndex: areaA >= areaB ? 0 : 1,
  }
}
