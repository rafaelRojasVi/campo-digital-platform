import { multiPolygonUtmBbox, utmToLonLat } from './proj.ts'
import { formatHa } from './format.ts'
import { NO_SPECIES_GROUP, ENSAYO_GROUP, speciesGroup } from './species.ts'
import type { GeoFeature, SourceFeatureProperties } from '../types.ts'

// Pure map-data helpers, kept out of the Leaflet component so the display
// transformation is unit-testable.

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function tooltipHtml(properties: SourceFeatureProperties): string {
  const predio = properties.nom_predio ?? 'Predio sin nombre'
  const code = properties.cod_predial !== null ? ` (${properties.cod_predial})` : ''
  const rodal =
    properties.n_rodal !== null && properties.n_rodal !== ''
      ? `Rodal ${properties.n_rodal}`
      : 'Sin rodal'
  const uso = properties.uso_2026 ?? 'Sin uso 2026'
  const area = properties.sup_ha !== null ? `${formatHa(properties.sup_ha)} ha` : ''
  const species = speciesGroup(properties.cod_uso_2026)
  const speciesLine =
    species === NO_SPECIES_GROUP || species === ENSAYO_GROUP
      ? ''
      : `<br/>${escapeHtml(species.label)}`

  return (
    `<strong>${escapeHtml(predio)}${escapeHtml(code)}</strong><br/>` +
    `${escapeHtml(rodal)} · ${escapeHtml(uso)}${area === '' ? '' : ` · ${escapeHtml(area)}`}` +
    speciesLine
  )
}

/**
 * Convert one stored MultiPolygon (EPSG:32718 coordinates, exactly as served)
 * to Leaflet [lat, lng] rings. Display-only reprojection; the source
 * geometry object is not modified.
 */
// Reprojection is the costly part of drawing ~1,600 polygons; the same
// geometry objects come back from the in-memory collection cache, so each is
// reprojected once per page session.
const latLngCache = new WeakMap<GeoFeature['geometry'], [number, number][][][]>()

export function multiPolygonToLatLngs(geometry: GeoFeature['geometry']): [number, number][][][] {
  const cached = latLngCache.get(geometry)
  if (cached !== undefined) return cached
  const latLngs = projectMultiPolygon(geometry)
  latLngCache.set(geometry, latLngs)
  return latLngs
}

function projectMultiPolygon(geometry: GeoFeature['geometry']): [number, number][][][] {
  return geometry.coordinates.map((polygon) =>
    polygon.map((ring) =>
      ring.flatMap((position): [number, number][] => {
        const [x, y] = position
        if (x === undefined || y === undefined) {
          return []
        }
        const [lon, lat] = utmToLonLat(x, y)
        return [[lat, lon]]
      }),
    ),
  )
}

/** Ground resolution of one screen pixel (web mercator approximation). */
export function metersPerPixel(latitude: number, zoom: number): number {
  return (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom
}

export interface PredioLabel {
  /** The predio name as in the source (Nom_Predio). */
  name: string
  /** Escaped predio name. */
  html: string
  /** Label anchor in EPSG:32718: the bbox centre of the predio's largest polygon. */
  x: number
  y: number
  /** Sup_ha of the predio's polygons; bigger predios win label collisions. */
  areaHa: number
}

/**
 * One label per predio, anchored on its largest polygon so it sits on the
 * main block instead of between scattered parts.
 */
export function predioLabels(features: GeoFeature[]): PredioLabel[] {
  const largest = new Map<string, GeoFeature>()
  const areas = new Map<string, number>()
  for (const feature of features) {
    const name = feature.properties.nom_predio
    if (name === null || name === '') continue
    areas.set(name, (areas.get(name) ?? 0) + (feature.properties.sup_ha ?? 0))
    const current = largest.get(name)
    if (current === undefined || (feature.properties.sup_ha ?? 0) > (current.properties.sup_ha ?? 0)) {
      largest.set(name, feature)
    }
  }

  return [...largest.entries()]
    .map(([name, feature]) => {
      const [minx, miny, maxx, maxy] = multiPolygonUtmBbox(feature.geometry)
      return {
        name,
        html: escapeHtml(name),
        x: (minx + maxx) / 2,
        y: (miny + maxy) / 2,
        areaHa: areas.get(name) ?? 0,
      }
    })
    .sort((a, b) => b.areaHa - a.areaHa)
}

export interface LabelBox {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Greedy placement: keep each box unless it overlaps one already kept or a
 * blocked area (the map's own controls). Boxes come biggest predio first, so
 * the main predios keep their names.
 */
export function nonOverlapping(boxes: LabelBox[], gap = 4, blocked: LabelBox[] = []): boolean[] {
  const kept: LabelBox[] = [...blocked]
  return boxes.map((box) => {
    const clash = kept.some(
      (other) =>
        box.left < other.right + gap &&
        box.right + gap > other.left &&
        box.top < other.bottom + gap &&
        box.bottom + gap > other.top,
    )
    if (!clash) kept.push(box)
    return !clash
  })
}

/**
 * Label of one polygon on the map: the rodal number in bold and the 2026
 * use code under it (Pi06), or only the code when there is no rodal.
 * Null when there is nothing to write.
 */
export function rodalLabelHtml(properties: SourceFeatureProperties): string | null {
  const rodal = properties.n_rodal !== null && properties.n_rodal.trim() !== '' ? properties.n_rodal.trim() : null
  const code = properties.cod_uso_2026 !== null && properties.cod_uso_2026.trim() !== '' ? properties.cod_uso_2026.trim() : null
  if (rodal === null && code === null) return null
  const parts = [
    rodal !== null ? `<b>${escapeHtml(rodal)}</b>` : '',
    code !== null ? `<small>${escapeHtml(code)}</small>` : '',
  ]
  return parts.filter((part) => part !== '').join('')
}
