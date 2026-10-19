/**
 * The report editor's map. Draws the report's base snapshot (thin outlines,
 * clickable to select polygons to copy), the report's own polygons on top
 * (managed parts in harvest orange), the polyline being drawn, and the
 * pieces to choose after a split. Coordinates arrive in EPSG:32718; Leaflet
 * draws reprojected copies, and a clicked point is converted once to UTM.
 */
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { metersPerPixel, multiPolygonToLatLngs, nonOverlapping, type LabelBox } from '../lib/mapData.ts'
import { labelPoint } from '../lib/labelPoint.ts'
import { installKeyboardZoom } from '../lib/keyboardZoom.ts'
import { lonLatToUtm, multiPolygonUtmBbox, utmBboxToLonLatBounds, utmToLonLat } from '../lib/proj.ts'
import type { DraftFeature } from '../lib/reportDraft.ts'
import type { Coordinates, Position } from '../lib/splitGeometry.ts'
import type { FeatureCollection } from '../types.ts'

export type MapMode = 'select' | 'split' | 'choose' | 'view'

export interface ChoosePiece {
  featureKey: string
  index: number
  coordinates: Coordinates
  label: string
  /** Where the label goes (UTM), inside the piece. */
  labelAt: Position
  managed: boolean
}

interface ReportMapProps {
  base: FeatureCollection
  features: DraftFeature[]
  mode: MapMode
  selectedOrdinals: ReadonlySet<number>
  selectedKeys: ReadonlySet<string>
  linePoints: Position[]
  choosePieces: ChoosePiece[]
  overlay: { ordinal: number; coordinates: Coordinates }[]
  onBaseClick: (ordinal: number, additive: boolean) => void
  onFeatureClick: (key: string, additive: boolean) => void
  onLinePoint: (point: Position) => void
  onFinishLine: () => void
  onPieceClick: (featureKey: string, index: number) => void
  fitNonce: number
  /** A click on the map outside every polygon (closes the rodal card). */
  onBackgroundClick?: () => void
  /** Fill opacity of the report's polygons (0–1), from the «Opacidad» slider. */
  fillOpacity?: number
  /** Rodal numbers over the map: the report's always, the base's when zoomed in. */
  showLabels?: boolean
  /** Fly to these polygons whenever `focus.nonce` changes (search, list click). */
  focus?: { nonce: number; coordinates: Coordinates[] }
}

const SATELLITE_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SATELLITE_ATTRIBUTION =
  'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community'

const BASE_PANE = 'rodales-base'
const HARVEST = '#e8a33d'
const REPORT = '#2f9e6a'
const SELECTED = '#3b8fd6'
const CUT = '#ffd84d'

/** Below this fill opacity the outline takes the fill color, so edges stay readable. */
const COLORED_OUTLINE_BELOW = 0.35
/** Base rodal numbers appear from this zoom, on polygons at least this big on screen. */
const BASE_LABELS_FROM_ZOOM = 15
const BASE_LABEL_MIN_PX = 44
const BASE_LABEL_MAX = 200

function latLngs(coordinates: Coordinates): [number, number][][][] {
  return multiPolygonToLatLngs({ type: 'MultiPolygon', coordinates })
}

function baseStyle(selected: boolean): L.PathOptions {
  return {
    color: selected ? SELECTED : '#ffffff',
    weight: selected ? 3 : 1,
    opacity: selected ? 1 : 0.7,
    fillColor: selected ? SELECTED : '#ffffff',
    fillOpacity: selected ? 0.25 : 0.04,
  }
}

function featureStyle(feature: DraftFeature, selected: boolean, opacity: number): L.PathOptions {
  const color = feature.in_report ? HARVEST : REPORT
  const fill = feature.in_report ? opacity : opacity * 0.65
  return {
    color: selected ? SELECTED : opacity < COLORED_OUTLINE_BELOW ? color : '#ffffff',
    weight: selected ? 4 : opacity < COLORED_OUTLINE_BELOW ? 3 : 2.5,
    fillColor: color,
    fillOpacity: fill,
  }
}

function labelMarker(lat: number, lon: number, html: string, className: string): L.Marker {
  return L.marker([lat, lon], {
    interactive: false,
    keyboard: false,
    icon: L.divIcon({ className, html: `<span>${html}</span>`, iconSize: undefined }),
  })
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** A click in «Dividir con línea»: one line vertex, in UTM, from wherever it lands. */
function addLinePoint(event: L.LeafletMouseEvent, onLinePoint: (point: Position) => void): void {
  L.DomEvent.stopPropagation(event)
  const [easting, northing] = lonLatToUtm(event.latlng.lng, event.latlng.lat)
  onLinePoint([easting, northing])
}

export function ReportMap(props: ReportMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const baseLayerRef = useRef<L.LayerGroup | null>(null)
  const baseRendererRef = useRef<L.Canvas | null>(null)
  const basePolygonsRef = useRef<Map<number, L.Polygon>>(new Map())
  const shownSelectionRef = useRef<Set<number>>(new Set())
  const reportLayerRef = useRef<L.LayerGroup | null>(null)
  const drawLayerRef = useRef<L.LayerGroup | null>(null)
  const labelLayerRef = useRef<L.LayerGroup | null>(null)
  // Interior label points and UTM boxes, computed once per base polygon.
  const baseGeomRef = useRef<Map<number, { point: [number, number]; box: [number, number, number, number] }>>(new Map())
  const propsRef = useRef(props)
  propsRef.current = props

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current
    if (container === null || mapRef.current !== null) return
    // Half-level steps and a slower wheel: one notch no longer jumps past the
    // rodal (2026-10-19 walkthrough).
    const map = L.map(container, {
      zoomControl: true,
      doubleClickZoom: false,
      preferCanvas: false,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 140,
      maxZoom: 19,
    })
    // Imagery stops at level 18 in the south; beyond it the last tiles are
    // enlarged instead of showing «Map data not yet available».
    L.tileLayer(SATELLITE_TILE_URL, {
      attribution: SATELLITE_ATTRIBUTION,
      maxZoom: 19,
      maxNativeZoom: 18,
    }).addTo(map)
    // The ~1,600 base polygons draw on one canvas, in a pane under the report
    // (SVG), so report polygons stay clickable on top.
    map.createPane(BASE_PANE)
    const basePane = map.getPane(BASE_PANE)
    if (basePane !== undefined) basePane.style.zIndex = '350'
    baseRendererRef.current = L.canvas({ pane: BASE_PANE, padding: 0.5 })
    baseLayerRef.current = L.layerGroup().addTo(map)
    reportLayerRef.current = L.layerGroup().addTo(map)
    drawLayerRef.current = L.layerGroup().addTo(map)
    labelLayerRef.current = L.layerGroup().addTo(map)

    map.on('click', (event: L.LeafletMouseEvent) => {
      if (propsRef.current.mode === 'split') addLinePoint(event, propsRef.current.onLinePoint)
      else propsRef.current.onBackgroundClick?.()
    })
    map.on('dblclick', () => {
      if (propsRef.current.mode === 'split') propsRef.current.onFinishLine()
    })
    mapRef.current = map
    const uninstallKeyboardZoom = installKeyboardZoom(map)
    // The panel widens in «Planificación»: redraw tiles for the new size
    // instead of leaving a grey band.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => map.invalidateSize())
    resize?.observe(container)
    return () => {
      resize?.disconnect()
      uninstallKeyboardZoom()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Fit to the report (or the base when the report is empty), on mount and
  // whenever `fitNonce` changes («Ver todo el informe»).
  useEffect(() => {
    const map = mapRef.current
    if (map === null) return
    const geometries =
      props.features.length > 0
        ? props.features.map((feature) => ({ coordinates: feature.coordinates }))
        : props.base.features.map((feature) => feature.geometry)
    if (geometries.length === 0) return
    const boxes = geometries.map((geometry) =>
      multiPolygonUtmBbox({ type: 'MultiPolygon', coordinates: geometry.coordinates }),
    )
    const bbox: [number, number, number, number] = [
      Math.min(...boxes.map((box) => box[0])),
      Math.min(...boxes.map((box) => box[1])),
      Math.max(...boxes.map((box) => box[2])),
      Math.max(...boxes.map((box) => box[3])),
    ]
    const bounds = utmBboxToLonLatBounds(bbox)
    map.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { padding: [24, 24] },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitNonce])

  // Fly to the focused polygons (search result or a rodal chosen in the list).
  useEffect(() => {
    const map = mapRef.current
    const focus = props.focus
    if (map === null || focus === undefined || focus.coordinates.length === 0) return
    const boxes = focus.coordinates.map((coordinates) =>
      multiPolygonUtmBbox({ type: 'MultiPolygon', coordinates }),
    )
    const bounds = utmBboxToLonLatBounds([
      Math.min(...boxes.map((box) => box[0])),
      Math.min(...boxes.map((box) => box[1])),
      Math.max(...boxes.map((box) => box[2])),
      Math.max(...boxes.map((box) => box[3])),
    ])
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    map.flyToBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { padding: [60, 60], maxZoom: 17, duration: reduce ? 0 : 0.6, animate: !reduce },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus?.nonce])

  // Base polygons: built once per base snapshot, selectable in «Seleccionar».
  useEffect(() => {
    const layer = baseLayerRef.current
    const renderer = baseRendererRef.current
    if (layer === null || renderer === null) return
    layer.clearLayers()
    const polygons = new Map<number, L.Polygon>()
    for (const feature of props.base.features) {
      const ordinal = feature.properties.feature_ordinal
      const polygon = L.polygon(latLngs(feature.geometry.coordinates), {
        ...baseStyle(false),
        renderer,
        pane: BASE_PANE,
      })
      const rodal = feature.properties.n_rodal
      polygon.bindTooltip(
        rodal === null ? `Polígono ${feature.properties.source_objectid ?? ordinal}` : `Rodal ${rodal}`,
        { sticky: true },
      )
      polygon.on('click', (event: L.LeafletMouseEvent) => {
        if (propsRef.current.mode === 'split') {
          addLinePoint(event, propsRef.current.onLinePoint)
          return
        }
        if (propsRef.current.mode !== 'select') return
        L.DomEvent.stopPropagation(event)
        propsRef.current.onBaseClick(ordinal, event.originalEvent.shiftKey || event.originalEvent.ctrlKey)
      })
      polygon.addTo(layer)
      polygons.set(ordinal, polygon)
    }
    basePolygonsRef.current = polygons
    shownSelectionRef.current = new Set()
  }, [props.base])

  // Selection: restyle only the polygons whose selection changed.
  useEffect(() => {
    const polygons = basePolygonsRef.current
    const shown = shownSelectionRef.current
    for (const ordinal of shown) {
      if (!props.selectedOrdinals.has(ordinal)) polygons.get(ordinal)?.setStyle(baseStyle(false))
    }
    for (const ordinal of props.selectedOrdinals) {
      if (!shown.has(ordinal)) polygons.get(ordinal)?.setStyle(baseStyle(true))
    }
    shownSelectionRef.current = new Set(props.selectedOrdinals)
  }, [props.selectedOrdinals, props.base])

  // The report's polygons, the overlay of the original base, the line and the pieces.
  useEffect(() => {
    const layer = reportLayerRef.current
    const draw = drawLayerRef.current
    if (layer === null || draw === null) return
    layer.clearLayers()
    draw.clearLayers()

    for (const item of props.overlay) {
      L.polygon(latLngs(item.coordinates), {
        color: '#ffffff',
        weight: 2,
        dashArray: '6 5',
        fill: false,
        interactive: false,
      }).addTo(draw)
    }

    if (props.mode !== 'choose') {
      for (const feature of props.features) {
        const polygon = L.polygon(latLngs(feature.coordinates), featureStyle(feature, props.selectedKeys.has(feature.key), props.fillOpacity ?? 0.6))
        const code = feature.attributes.n_rodal
        polygon.bindTooltip(code === null || code === undefined ? 'Sin rodal' : String(code), {
          sticky: true,
        })
        polygon.on('click', (event: L.LeafletMouseEvent) => {
          const mode = propsRef.current.mode
          if (mode === 'split') {
            addLinePoint(event, propsRef.current.onLinePoint)
            return
          }
          L.DomEvent.stopPropagation(event)
          if (mode === 'select' || mode === 'view') {
            propsRef.current.onFeatureClick(feature.key, event.originalEvent.shiftKey || event.originalEvent.ctrlKey)
          }
        })
        polygon.addTo(layer)
      }
    }

    for (const piece of props.choosePieces) {
      const polygon = L.polygon(latLngs(piece.coordinates), {
        color: '#ffffff',
        weight: 3,
        fillColor: piece.managed ? HARVEST : REPORT,
        fillOpacity: piece.managed ? 0.65 : 0.35,
      })
      const [labelLon, labelLat] = utmToLonLat(piece.labelAt[0], piece.labelAt[1])
      polygon.bindTooltip(piece.label, { permanent: true, direction: 'center', className: 'report-map__piece-label' })
      polygon.on('click', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event)
        propsRef.current.onPieceClick(piece.featureKey, piece.index)
      })
      polygon.addTo(layer)
      polygon.openTooltip(L.latLng(labelLat, labelLon))
    }

    if (props.linePoints.length > 0) {
      const points = props.linePoints.map(([x, y]) => {
        const [lon, lat] = utmToLonLat(x, y)
        return L.latLng(lat, lon)
      })
      L.polyline(points, { color: CUT, weight: 3, dashArray: '8 6', interactive: false }).addTo(draw)
      for (const point of points) {
        L.circleMarker(point, { radius: 4, color: CUT, fillColor: CUT, fillOpacity: 1, interactive: false }).addTo(draw)
      }
    }
  }, [props.features, props.selectedKeys, props.mode, props.linePoints, props.choosePieces, props.overlay, props.fillOpacity])

  // Rodal numbers: every report polygon, plus base polygons big enough on
  // screen once zoomed in. Report labels win; overlapping ones are dropped.
  useEffect(() => {
    const map = mapRef.current
    const layer = labelLayerRef.current
    if (map === null || layer === null) return
    const sync = () => {
      layer.clearLayers()
      if (!(propsRef.current.showLabels ?? true) || propsRef.current.mode === 'choose') return
      const view = map.getBounds()
      const entries: { lat: number; lon: number; html: string; className: string; box: LabelBox }[] = []
      const push = (point: [number, number], html: string, className: string, width: number) => {
        const [lon, lat] = utmToLonLat(point[0], point[1])
        if (!view.contains([lat, lon])) return
        const at = map.latLngToContainerPoint([lat, lon])
        entries.push({ lat, lon, html, className, box: { left: at.x - width / 2, right: at.x + width / 2, top: at.y - 10, bottom: at.y + 10 } })
      }
      const inReport = new Set<number>()
      for (const feature of propsRef.current.features) {
        inReport.add(feature.source_feature_ordinal)
        const code = feature.attributes.n_rodal
        if (code === null || code === undefined || String(code).trim() === '') continue
        const text = String(code)
        push(labelPoint(feature.coordinates), `<b>${escapeHtml(text)}</b>`, 'report-map__label', text.length * 8 + 12)
      }
      if (map.getZoom() >= BASE_LABELS_FROM_ZOOM) {
        const resolution = metersPerPixel(map.getCenter().lat, map.getZoom())
        const [vx1, vy1] = lonLatToUtm(view.getWest(), view.getSouth())
        const [vx2, vy2] = lonLatToUtm(view.getEast(), view.getNorth())
        let count = 0
        for (const feature of propsRef.current.base.features) {
          const ordinal = feature.properties.feature_ordinal
          const rodal = feature.properties.n_rodal
          if (inReport.has(ordinal) || rodal === null || rodal.trim() === '') continue
          let geom = baseGeomRef.current.get(ordinal)
          if (geom === undefined) {
            geom = {
              point: labelPoint(feature.geometry.coordinates),
              box: multiPolygonUtmBbox({ type: 'MultiPolygon', coordinates: feature.geometry.coordinates }),
            }
            baseGeomRef.current.set(ordinal, geom)
          }
          const [minx, miny, maxx, maxy] = geom.box
          if (maxx < vx1 || minx > vx2 || maxy < vy1 || miny > vy2) continue
          if (Math.max(maxx - minx, maxy - miny) / resolution < BASE_LABEL_MIN_PX) continue
          push(geom.point, escapeHtml(rodal.trim()), 'report-map__label report-map__label--base', rodal.trim().length * 7 + 10)
          count += 1
          if (count >= BASE_LABEL_MAX) break
        }
      }
      const keep = nonOverlapping(entries.map((entry) => entry.box), 2)
      entries.forEach((entry, index) => {
        if (keep[index]) labelMarker(entry.lat, entry.lon, entry.html, entry.className).addTo(layer)
      })
    }
    sync()
    map.on('zoomend moveend', sync)
    return () => {
      map.off('zoomend moveend', sync)
    }
  }, [props.features, props.base, props.showLabels, props.mode])

  // Cursor follows the mode.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    container.dataset.mode = props.mode
  }, [props.mode])

  return <div ref={containerRef} className="report-map" role="application" aria-label="Mapa del informe" />
}
