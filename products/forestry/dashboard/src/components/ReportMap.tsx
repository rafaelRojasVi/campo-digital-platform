/**
 * The report editor's map. Draws the report's base snapshot (thin outlines,
 * clickable to select polygons to copy), the report's own polygons on top
 * (managed parts in harvest orange), the polyline being drawn, and the
 * pieces to choose after a split. Coordinates arrive in EPSG:32718; Leaflet
 * draws reprojected copies, and a clicked point is converted once to UTM.
 */
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { multiPolygonToLatLngs } from '../lib/mapData.ts'
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
}

const SATELLITE_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SATELLITE_ATTRIBUTION =
  'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community'

const HARVEST = '#e8a33d'
const REPORT = '#2f9e6a'
const SELECTED = '#3b8fd6'
const CUT = '#ffd84d'

function latLngs(coordinates: Coordinates): [number, number][][][] {
  return multiPolygonToLatLngs({ type: 'MultiPolygon', coordinates })
}

function featureStyle(feature: DraftFeature, selected: boolean): L.PathOptions {
  const color = feature.in_report ? HARVEST : REPORT
  return {
    color: selected ? SELECTED : '#ffffff',
    weight: selected ? 4 : 2.5,
    fillColor: color,
    fillOpacity: feature.in_report ? 0.6 : 0.4,
  }
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
  const reportLayerRef = useRef<L.LayerGroup | null>(null)
  const drawLayerRef = useRef<L.LayerGroup | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current
    if (container === null || mapRef.current !== null) return
    const map = L.map(container, { zoomControl: true, doubleClickZoom: false, preferCanvas: false })
    L.tileLayer(SATELLITE_TILE_URL, { attribution: SATELLITE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
    baseLayerRef.current = L.layerGroup().addTo(map)
    reportLayerRef.current = L.layerGroup().addTo(map)
    drawLayerRef.current = L.layerGroup().addTo(map)

    map.on('click', (event: L.LeafletMouseEvent) => {
      if (propsRef.current.mode === 'split') addLinePoint(event, propsRef.current.onLinePoint)
    })
    map.on('dblclick', () => {
      if (propsRef.current.mode === 'split') propsRef.current.onFinishLine()
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Fit to the report (or the base when the report is empty).
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

  // Base polygons: outlines, selectable in «Seleccionar».
  useEffect(() => {
    const layer = baseLayerRef.current
    if (layer === null) return
    layer.clearLayers()
    for (const feature of props.base.features) {
      const ordinal = feature.properties.feature_ordinal
      const selected = props.selectedOrdinals.has(ordinal)
      const polygon = L.polygon(latLngs(feature.geometry.coordinates), {
        color: selected ? SELECTED : '#ffffff',
        weight: selected ? 3 : 1,
        opacity: selected ? 1 : 0.7,
        fillColor: selected ? SELECTED : '#ffffff',
        fillOpacity: selected ? 0.25 : 0.04,
      })
      const rodal = feature.properties.n_rodal
      polygon.bindTooltip(rodal === null ? `Polígono ${feature.properties.source_objectid ?? ordinal}` : `Rodal ${rodal}`, {
        sticky: true,
      })
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
    }
  }, [props.base, props.selectedOrdinals])

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
        const polygon = L.polygon(latLngs(feature.coordinates), featureStyle(feature, props.selectedKeys.has(feature.key)))
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
  }, [props.features, props.selectedKeys, props.mode, props.linePoints, props.choosePieces, props.overlay])

  // Cursor follows the mode.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    container.dataset.mode = props.mode
  }, [props.mode])

  return <div ref={containerRef} className="report-map" role="application" aria-label="Mapa del informe" />
}
