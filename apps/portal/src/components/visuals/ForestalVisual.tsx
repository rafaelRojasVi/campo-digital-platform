import type { CSSProperties } from 'react'

type Point = [number, number]

// A small stand mosaic: three rows of shared vertices, eight quadrilateral
// stands between them.
const TOP: Point[] = [[30, 60], [95, 40], [160, 52], [225, 34], [290, 58]]
const MID: Point[] = [[40, 120], [105, 105], [165, 118], [232, 98], [296, 122]]
const LOW: Point[] = [[55, 172], [118, 166], [178, 180], [240, 160], [285, 178]]

/** Stand c spans columns c..c+1 between two rows; the shade stands in for land use. */
const STANDS: Array<{ points: Point[]; shade: number }> = [
  ...[0, 1, 2, 3].map((c) => ({
    points: [TOP[c], TOP[c + 1], MID[c + 1], MID[c]],
    shade: [0.14, 0.3, 0.2, 0.36][c],
  })),
  ...[0, 1, 2, 3].map((c) => ({
    points: [MID[c], MID[c + 1], LOW[c + 1], LOW[c]],
    shade: [0.26, 0.12, 0.32, 0.18][c],
  })),
]

/** The two stands the hover cut line crosses (indexes into STANDS). */
const PICKED = [5, 6]

/** Planted stands show rows of pines; harvested ones show harvest lines. */
const PLANTED = [1, 3, 6]
const HARVESTED = [0, 2, 4, 5, 7]

/** Even-odd ray test: is the point inside the polygon? */
function inside([x, y]: Point, polygon: Point[]): boolean {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** Plantation rows: a regular grid of trees, kept to those well inside a stand. */
const TREES: Point[] = PLANTED.flatMap((index) => {
  const polygon = STANDS[index].points
  const trees: Point[] = []
  for (let y = 30; y <= 190; y += 15) {
    for (let x = 30; x <= 300; x += 13) {
      const point: Point = [x + ((y / 15) % 2) * 6, y]
      // The whole tree (crown tip to trunk, both sides) must sit in the stand.
      const corners: Point[] = [
        [point[0] - 7, point[1]],
        [point[0] + 7, point[1]],
        [point[0], point[1] - 8],
        [point[0], point[1] + 6],
      ]
      if (corners.every((corner) => inside(corner, polygon))) trees.push(point)
    }
  }
  return trees
})

const pointsOf = (points: Point[]) => points.map(([x, y]) => `${x},${y}`).join(' ')

/** The property's outer edge: along the top, down the right, back along the bottom. */
const BOUNDARY = pointsOf([...TOP, MID[4], ...[...LOW].reverse(), MID[0]])

/**
 * Abstract stand-map motif for the Rodales module: a mosaic of stands inside
 * a property boundary, with tree crowns. Not a real cadastral map — a
 * restrained geometric identity mark. The front door animates its parts
 * (the pv-* classes); everywhere else it is still.
 */
export function ForestalVisual() {
  return (
    <svg
      // Wider than the others' 0 0 320 200: the mosaic runs nearly edge to
      // edge and needs room for the hover zoom.
      viewBox="-24 -10 368 220"
      role="img"
      aria-label="Identidad visual de Rodales: mosaico de rodales sobre mapa"
      className="product-visual"
    >
      <g className="pv-grid" stroke="var(--cd-forestal)" strokeOpacity="0.14" strokeWidth="1">
        {Array.from({ length: 9 }, (_, index) => (
          <line key={`v${index}`} x1={index * 46 - 36} y1={-50} x2={index * 46 - 36} y2={250} />
        ))}
        {Array.from({ length: 7 }, (_, index) => (
          <line key={`h${index}`} x1={-50} y1={index * 44 - 34} x2={370} y2={index * 44 - 34} />
        ))}
      </g>
      {STANDS.map((stand, index) => (
        <polygon
          key={pointsOf(stand.points)}
          className="pv-stand"
          style={{ '--i': index } as CSSProperties}
          points={pointsOf(stand.points)}
          pathLength={1}
          fill="var(--cd-forestal)"
          fillOpacity={stand.shade}
          stroke="var(--cd-forestal)"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      ))}
      {PICKED.map((index) => (
        <polygon
          key={`pick-${index}`}
          className="pv-pick"
          points={pointsOf(STANDS[index].points)}
          fill="var(--cd-forestal)"
          fillOpacity="0.45"
          stroke="var(--cd-forestal)"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
      ))}
      <defs>
        <pattern
          id="pv-harvest-rows"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-32)"
        >
          <line x1={0} y1={0} x2={0} y2={6} stroke="var(--cd-forestal)" strokeWidth="1.3" />
        </pattern>
      </defs>
      {HARVESTED.map((index) => (
        <polygon
          key={`rows-${index}`}
          className="pv-rows"
          style={{ '--i': index } as CSSProperties}
          points={pointsOf(STANDS[index].points)}
          fill="url(#pv-harvest-rows)"
          fillOpacity="0.5"
        />
      ))}
      {TREES.map(([x, y], index) => (
        <g
          key={`${x}-${y}`}
          className="pv-tree"
          style={{ '--i': index % 12 } as CSSProperties}
          fill="var(--cd-forestal)"
        >
          <path d={`M${x} ${y - 8} L${x + 4.5} ${y + 2} H${x - 4.5} Z`} />
          <rect x={x - 0.8} y={y + 2} width={1.6} height={3} fillOpacity="0.8" />
        </g>
      ))}
      <polygon
        className="pv-boundary"
        points={BOUNDARY}
        fill="none"
        stroke="var(--cd-forestal)"
        strokeOpacity="0.9"
        strokeWidth="1.6"
        strokeDasharray="6 4"
        strokeLinejoin="round"
      />
      {/* A cut line across two stands, drawn on hover (the Rodales cut tool). */}
      <line
        className="pv-cut"
        x1={70}
        y1={196}
        x2={262}
        y2={86}
        pathLength={1}
        stroke="#0f3b2b"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  )
}
