import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import {
  metersPerPixel,
  multiPolygonToLatLngs,
  nonOverlapping,
  predioLabels,
  rodalLabelHtml,
  tooltipHtml,
  type LabelBox,
} from '../lib/mapData.ts'
import { labelPoint, pointInMultiPolygon } from '../lib/labelPoint.ts'
import { lonLatToUtm, multiPolygonUtmBbox, utmToLonLat } from '../lib/proj.ts'
import { formatArea, formatDistance, measurePath } from '../lib/measure.ts'
import { installKeyboardZoom } from '../lib/keyboardZoom.ts'
import type { ColorEncoding } from '../lib/palette.ts'
import type { FeatureCollection, GeoFeature } from '../types.ts'
import type { ZoomRequest } from '../App.tsx'
import { Hint } from './Hint.tsx'

interface MapViewProps {
  collection: FeatureCollection
  filteredFeatures: GeoFeature[]
  encoding: ColorEncoding | null
  selectedOrdinals: number[]
  /** `additive`: Mayús/Ctrl held — add or remove instead of replacing. */
  onSelect: (featureOrdinal: number | null, additive: boolean) => void
  /** Mayús + drag: the polygons whose label point falls in the box. */
  onSelectMany: (featureOrdinals: number[]) => void
  zoomRequest: ZoomRequest | null
  fitNonce: number
  onFitToResults: () => void
  sidebarCollapsed: boolean
  mapFocus: boolean
  activeFilterCount: number
  onToggleSidebar: () => void
  onToggleMapFocus: () => void
}

type BasemapMode = 'map' | 'satellite' | 'none'

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION = '© OpenStreetMap contributors'
const SATELLITE_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SATELLITE_ATTRIBUTION =
  'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community'

interface FeatureLayer {
  layer: L.Polygon
  feature: GeoFeature
  /* Representative point for polygons too small to see at the current zoom. */
  centroid: L.LatLng
  maxExtentMeters: number
  /** EPSG:32718 bbox, computed once: [minx, miny, maxx, maxy]. */
  bbox: [number, number, number, number]
  marker: L.CircleMarker | null
}

const MARKER_MAX_SUBSET = 200
const MARKER_MIN_POLYGON_PX = 8

/** Default fill opacity for source polygons; the "Opacidad" slider overrides it. */
const DEFAULT_FILL_OPACITY = 0.78

/**
 * Below this fill opacity the outline takes the use color, so the borders
 * between uses stay readable over the satellite image.
 */
const COLORED_OUTLINE_BELOW = 0.5

/**
 * The estate spans about 45 × 70 km, so at the zoom that fits it the smaller
 * predios are specks. Below this zoom each predio shows its name.
 */
const PREDIO_LABELS_BELOW_ZOOM = 13

/** From this zoom each rodal big enough on screen shows its number and code. */
const RODAL_LABELS_FROM_ZOOM = 14
const RODAL_LABEL_MIN_POLYGON_PX = 44
const RODAL_LABEL_MAX = 300

const TOOLS_PANE = 'herramientas'

/** From this zoom polygons get a thin white outline. */
const STROKE_ZOOM = 12

/** Screen boxes of the controls floating over the map; labels avoid them. */
function controlBoxes(map: L.Map): LabelBox[] {
  const container = map.getContainer()
  const origin = container.getBoundingClientRect()
  return [...(container.parentElement?.querySelectorAll('.map__controls, .leaflet-control') ?? [])].map(
    (element) => {
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left - origin.left,
        right: rect.right - origin.left,
        top: rect.top - origin.top,
        bottom: rect.bottom - origin.top,
      }
    },
  )
}

function isAdditive(event: Event): boolean {
  const mouse = event as MouseEvent
  return mouse.shiftKey || mouse.ctrlKey || mouse.metaKey
}

function markFeatureClick(event: L.LeafletMouseEvent): void {
  const original = event.originalEvent as MouseEvent & { _forestryFeatureClick?: boolean }
  original._forestryFeatureClick = true
}

// The map is for looking and choosing. Splitting and reporting happen in a
// named report (Informes); the V1 local «Simular ajuste» was removed on
// 2026-10-18 because it duplicated the report editor and saved nothing.
export function MapView({
  collection,
  filteredFeatures,
  encoding,
  selectedOrdinals,
  onSelect,
  onSelectMany,
  zoomRequest,
  fitNonce,
  onFitToResults,
  sidebarCollapsed,
  mapFocus,
  activeFilterCount,
  onToggleSidebar,
  onToggleMapFocus,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const groupRef = useRef<L.FeatureGroup | null>(null)
  const markerGroupRef = useRef<L.FeatureGroup | null>(null)
  const labelGroupRef = useRef<L.LayerGroup | null>(null)
  const rodalLabelGroupRef = useRef<L.LayerGroup | null>(null)
  // Interior label points, computed once per polygon when first needed.
  const labelPointsRef = useRef<Map<number, [number, number]>>(new Map())
  const baseLayerRef = useRef<L.TileLayer | null>(null)
  const layersRef = useRef<Map<number, FeatureLayer>>(new Map())
  const styleForRef = useRef<(featureOrdinal: number) => L.PathOptions>(() => ({}))
  const onSelectRef = useRef(onSelect)
  const onSelectManyRef = useRef(onSelectMany)

  // Targeted-restyle bookkeeping: avoids re-applying setStyle to every
  // visible layer (measured 1,568 calls) when only the selection changes.
  const prevVisibleRef = useRef<Set<number>>(new Set())
  const prevSelectedRef = useRef<ReadonlySet<number>>(new Set())
  const prevEncodingRef = useRef<ColorEncoding | null>(null)
  const prevFillOpacityRef = useRef(DEFAULT_FILL_OPACITY)
  const fittedCollectionRef = useRef<FeatureCollection | null>(null)

  // Satellite by default, as in the report editor: Campo Digital asked for
  // the imagery (Esri or Google Earth), not a street map.
  const [basemapMode, setBasemapMode] = useState<BasemapMode>('satellite')
  const [fillOpacity, setFillOpacity] = useState(DEFAULT_FILL_OPACITY)
  // «Medir»: points in EPSG:32718 metres, clicked in order.
  const [measuring, setMeasuring] = useState(false)
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([])
  const measuringRef = useRef(false)
  const measureGroupRef = useRef<L.LayerGroup | null>(null)
  const locationGroupRef = useRef<L.LayerGroup | null>(null)
  const collectionRef = useRef(collection)
  // Cursor position in UTM 18S (desktop), and a short message for «Mi ubicación».
  const [cursorUtm, setCursorUtm] = useState<[number, number] | null>(null)
  const [mapStatus, setMapStatus] = useState<string | null>(null)
  const selectedSet = useMemo<ReadonlySet<number>>(() => new Set(selectedOrdinals), [selectedOrdinals])

  useEffect(() => {
    onSelectRef.current = onSelect
    onSelectManyRef.current = onSelectMany
    collectionRef.current = collection
  }, [onSelect, onSelectMany, collection])

  useEffect(() => {
    measuringRef.current = measuring
    const map = mapRef.current
    if (map === null) return
    // A double click adds points while measuring; it must not zoom.
    if (measuring) map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
  }, [measuring])

  // Map lifecycle.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    const map = L.map(container, {
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true,
      zoomSnap: 0.25,
      // Mayús + drag selects rodales (below) instead of Leaflet's box zoom.
      boxZoom: false,
    })
    map.setView([-40.45, -73.35], 10)
    L.control.scale({ metric: true, imperial: false }).addTo(map)
    labelGroupRef.current = L.layerGroup().addTo(map)
    rodalLabelGroupRef.current = L.layerGroup().addTo(map)
    // Measurements and the position draw on their own pane, above the rodales.
    map.createPane(TOOLS_PANE)
    const toolsPane = map.getPane(TOOLS_PANE)
    if (toolsPane !== undefined) toolsPane.style.zIndex = '640'
    measureGroupRef.current = L.layerGroup().addTo(map)
    locationGroupRef.current = L.layerGroup().addTo(map)

    let cursorFrame = 0
    map.on('mousemove', (event: L.LeafletMouseEvent) => {
      cancelAnimationFrame(cursorFrame)
      cursorFrame = requestAnimationFrame(() =>
        setCursorUtm(lonLatToUtm(event.latlng.lng, event.latlng.lat)),
      )
    })
    map.on('mouseout', () => {
      cancelAnimationFrame(cursorFrame)
      setCursorUtm(null)
    })

    map.on('locationfound', (event: L.LocationEvent) => {
      const group = locationGroupRef.current
      group?.clearLayers()
      if (group !== null) {
        L.circle(event.latlng, {
          pane: TOOLS_PANE,
          radius: event.accuracy,
          color: '#ffffff',
          weight: 1.5,
          fillColor: '#ffffff',
          fillOpacity: 0.18,
          interactive: false,
        }).addTo(group)
        L.circleMarker(event.latlng, {
          pane: TOOLS_PANE,
          radius: 8,
          color: '#ffffff',
          weight: 3,
          fillColor: '#d6247a',
          fillOpacity: 1,
          interactive: false,
        }).addTo(group)
      }
      const [x, y] = lonLatToUtm(event.latlng.lng, event.latlng.lat)
      const here = collectionRef.current.features.find((feature) => {
        const [minx, miny, maxx, maxy] = multiPolygonUtmBbox(feature.geometry)
        return (
          x >= minx && x <= maxx && y >= miny && y <= maxy &&
          pointInMultiPolygon(feature.geometry.coordinates, x, y)
        )
      })
      const accuracy = `precisión ±${Math.round(event.accuracy)} m`
      if (here === undefined) {
        setMapStatus(`Está fuera de los rodales (${accuracy}).`)
        return
      }
      const p = here.properties
      const rodal = p.n_rodal !== null && p.n_rodal !== '' ? `el rodal ${p.n_rodal}` : 'un polígono sin rodal'
      setMapStatus(`Está en ${rodal} de ${p.nom_predio ?? 'un predio sin nombre'} (${accuracy}).`)
      onSelectRef.current(p.feature_ordinal, false)
    })
    map.on('locationerror', () => {
      setMapStatus('No se pudo obtener la ubicación: revise el permiso del navegador o la señal.')
    })

    const handleBackgroundClick = (event: L.LeafletMouseEvent) => {
      if (measuringRef.current) {
        const point = lonLatToUtm(event.latlng.lng, event.latlng.lat)
        setMeasurePoints((points) => [...points, point])
        return
      }
      const original = event.originalEvent as MouseEvent & { _forestryFeatureClick?: boolean }
      if (original._forestryFeatureClick !== true) onSelectRef.current(null, isAdditive(original))
    }
    map.on('click', handleBackgroundClick)

    // Mayús + drag draws a box; on release, every visible polygon whose label
    // point lies inside it joins the selection.
    let boxStart: L.LatLng | null = null
    let boxLayer: L.Rectangle | null = null
    map.on('mousedown', (event: L.LeafletMouseEvent) => {
      if (measuringRef.current || !(event.originalEvent as MouseEvent).shiftKey) return
      boxStart = event.latlng
      map.dragging.disable()
      boxLayer = L.rectangle(L.latLngBounds(boxStart, boxStart), {
        color: '#0b6ea8',
        weight: 1.5,
        dashArray: '4 3',
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(map)
    })
    map.on('mousemove', (event: L.LeafletMouseEvent) => {
      if (boxStart !== null) boxLayer?.setBounds(L.latLngBounds(boxStart, event.latlng))
    })
    map.on('mouseup', (event: L.LeafletMouseEvent) => {
      if (boxStart === null) return
      const start = boxStart
      boxStart = null
      boxLayer?.remove()
      boxLayer = null
      map.dragging.enable()
      const from = map.latLngToContainerPoint(start)
      const to = map.latLngToContainerPoint(event.latlng)
      if (Math.abs(from.x - to.x) < 6 && Math.abs(from.y - to.y) < 6) return // a Mayús + clic
      const box = L.latLngBounds(start, event.latlng)
      const picked: number[] = []
      for (const [featureOrdinal, entry] of layersRef.current) {
        if (!groupRef.current?.hasLayer(entry.layer)) continue
        let point = labelPointsRef.current.get(featureOrdinal)
        if (point === undefined) {
          point = labelPoint(entry.feature.geometry.coordinates)
          labelPointsRef.current.set(featureOrdinal, point)
        }
        const [lon, lat] = utmToLonLat(point[0], point[1])
        if (box.contains([lat, lon])) picked.push(featureOrdinal)
      }
      if (picked.length > 0) onSelectManyRef.current(picked)
    })

    mapRef.current = map
    const uninstallKeyboardZoom = installKeyboardZoom(map)

    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)

    return () => {
      uninstallKeyboardZoom()
      observer.disconnect()
      map.remove()
      mapRef.current = null
      groupRef.current = null
      labelGroupRef.current = null
      rodalLabelGroupRef.current = null
      measureGroupRef.current = null
      locationGroupRef.current = null
      baseLayerRef.current = null
      layersRef.current = new Map()
      fittedCollectionRef.current = null
    }
  }, [])

  // Basemap is presentation only. Forestry geometry remains the source layer.
  useEffect(() => {
    const map = mapRef.current
    if (map === null) return

    if (baseLayerRef.current !== null) {
      baseLayerRef.current.remove()
      baseLayerRef.current = null
    }
    if (basemapMode === 'none') return

    const satellite = basemapMode === 'satellite'
    // The platform sends `Referrer-Policy: same-origin`, so tile requests
    // would carry no Referer; OpenStreetMap's tile usage policy requires one.
    // `strict-origin` sends only the platform origin (never the page path)
    // and only over HTTPS. The API's CSP allows exactly these two tile
    // origins on /rodales (app.http_hardening.RODALES_TILE_ORIGINS).
    baseLayerRef.current = L.tileLayer(satellite ? SATELLITE_TILE_URL : OSM_TILE_URL, {
      maxZoom: 19,
      attribution: satellite ? SATELLITE_ATTRIBUTION : OSM_ATTRIBUTION,
      crossOrigin: true,
      referrerPolicy: 'strict-origin',
    }).addTo(map)
  }, [basemapMode])

  // Build one Leaflet polygon per source feature, once per collection.
  useEffect(() => {
    const map = mapRef.current
    if (map === null) return

    const group = L.featureGroup().addTo(map)
    groupRef.current = group
    const markerGroup = L.featureGroup().addTo(map)
    markerGroupRef.current = markerGroup
    const layers = new Map<number, FeatureLayer>()

    for (const feature of collection.features) {
      const featureOrdinal = feature.properties.feature_ordinal
      const latLngs = multiPolygonToLatLngs(feature.geometry)
      const layer = L.polygon(latLngs, styleForRef.current(featureOrdinal))

      layer.bindTooltip(tooltipHtml(feature.properties), {
        sticky: true,
        direction: 'top',
        className: 'map-tooltip',
      })

      layer.on('click', (event: L.LeafletMouseEvent) => {
        // While measuring, a click on a rodal is a point, not a selection.
        if (measuringRef.current) return
        markFeatureClick(event)
        onSelectRef.current(featureOrdinal, isAdditive(event.originalEvent))
      })

      layer.on('mouseover', () => {
        const base = styleForRef.current(featureOrdinal).fillOpacity ?? DEFAULT_FILL_OPACITY
        layer.setStyle({ fillOpacity: Math.min(0.92, base + 0.25), weight: 2 })
      })
      layer.on('mouseout', () => layer.setStyle(styleForRef.current(featureOrdinal)))

      const [minx, miny, maxx, maxy] = multiPolygonUtmBbox(feature.geometry)
      const [lon, lat] = utmToLonLat((minx + maxx) / 2, (miny + maxy) / 2)

      layers.set(featureOrdinal, {
        layer,
        feature,
        centroid: L.latLng(lat, lon),
        maxExtentMeters: Math.max(maxx - minx, maxy - miny),
        bbox: [minx, miny, maxx, maxy],
        marker: null,
      })
    }

    layersRef.current = layers
    labelPointsRef.current = new Map()
    prevVisibleRef.current = new Set()
    prevSelectedRef.current = new Set()
    prevEncodingRef.current = null

    return () => {
      group.remove()
      markerGroup.remove()
      groupRef.current = null
      markerGroupRef.current = null
      layersRef.current = new Map()
    }
  }, [collection])

  // Visibility + style: driven by filters, color encoding and selection. Only layers whose visibility or role actually changed get
  // restyled — measured to cut ~1,568 setStyle calls down to a handful when
  // the selection changes.
  useEffect(() => {
    const group = groupRef.current
    if (group === null) return

    const visibleOrdinals = new Set(
      filteredFeatures.map((feature) => feature.properties.feature_ordinal),
    )

    const styleFor = (featureOrdinal: number): L.PathOptions => {
      const entry = layersRef.current.get(featureOrdinal)
      const color =
        entry !== undefined && encoding !== null ? encoding.colorFor(entry.feature) : '#9a9890'
      const selected = selectedSet.has(featureOrdinal)
      const zoom = mapRef.current?.getZoom() ?? 12
      const coloredOutline = fillOpacity < COLORED_OUTLINE_BELOW
      const strokeWeight = coloredOutline
        ? 1.5
        : zoom >= STROKE_ZOOM || visibleOrdinals.size <= 200
          ? 0.8
          : 0

      return {
        color: selected ? '#14130f' : coloredOutline ? color : '#ffffff',
        weight: selected ? 2.5 : strokeWeight,
        opacity: selected || coloredOutline ? 1 : 0.85,
        fillColor: color,
        fillOpacity,
      }
    }
    styleForRef.current = styleFor

    const previouslyVisible = prevVisibleRef.current
    const encodingChanged =
      prevEncodingRef.current !== encoding || prevFillOpacityRef.current !== fillOpacity
    const touchedOrdinals = new Set<number>([...prevSelectedRef.current, ...selectedSet])

    const selectedLayers: L.Polygon[] = []
    for (const [featureOrdinal, entry] of layersRef.current) {
      const visible = visibleOrdinals.has(featureOrdinal)
      const wasVisible = previouslyVisible.has(featureOrdinal)
      // The feature group is the record of what is on the map.
      const shown = group.hasLayer(entry.layer)
      if (visible && !shown) {
        group.addLayer(entry.layer)
      } else if (!visible && shown) {
        group.removeLayer(entry.layer)
      }
      if (visible && (!wasVisible || encodingChanged || touchedOrdinals.has(featureOrdinal))) {
        entry.layer.setStyle(styleFor(featureOrdinal))
      }
      if (visible && selectedSet.has(featureOrdinal)) selectedLayers.push(entry.layer)
    }
    for (const layer of selectedLayers) layer.bringToFront()

    prevVisibleRef.current = visibleOrdinals
    prevSelectedRef.current = selectedSet
    prevEncodingRef.current = encoding
    prevFillOpacityRef.current = fillOpacity

    const syncMarkers = () => {
      const map = mapRef.current
      const markerGroup = markerGroupRef.current
      if (map === null || markerGroup === null) return

      const useMarkers = visibleOrdinals.size <= MARKER_MAX_SUBSET
      const resolution = metersPerPixel(map.getCenter().lat, map.getZoom())

      for (const [featureOrdinal, entry] of layersRef.current) {
        const wantMarker =
          useMarkers &&
          group.hasLayer(entry.layer) &&
          entry.maxExtentMeters / resolution < MARKER_MIN_POLYGON_PX

        if (wantMarker) {
          const color = encoding !== null ? encoding.colorFor(entry.feature) : '#9a9890'
          if (entry.marker === null) {
            const marker = L.circleMarker(entry.centroid, {
              radius: 4,
              weight: 1,
              color: '#ffffff',
              opacity: 0.9,
              fillColor: color,
              fillOpacity: 0.95,
            })
            marker.bindTooltip(tooltipHtml(entry.feature.properties), {
              sticky: true,
              direction: 'top',
              className: 'map-tooltip',
            })
            marker.on('click', (event: L.LeafletMouseEvent) => {
              if (measuringRef.current) return
              markFeatureClick(event)
              onSelectRef.current(featureOrdinal, isAdditive(event.originalEvent))
            })
            entry.marker = marker
          }
          entry.marker.setStyle({ fillColor: color })
          if (!markerGroup.hasLayer(entry.marker)) markerGroup.addLayer(entry.marker)
        } else if (entry.marker !== null && markerGroup.hasLayer(entry.marker)) {
          markerGroup.removeLayer(entry.marker)
        }
      }
    }

    syncMarkers()
    const map = mapRef.current
    if (map !== null) {
      // The stroke only changes when the zoom crosses STROKE_ZOOM; restyling
      // all ~1,600 polygons on every zoom step made zooming stutter.
      let strokeBand = map.getZoom() >= STROKE_ZOOM
      const restyleOnZoom = () => {
        const band = map.getZoom() >= STROKE_ZOOM
        if (band !== strokeBand) {
          strokeBand = band
          for (const [featureOrdinal, entry] of layersRef.current) {
            if (group.hasLayer(entry.layer)) entry.layer.setStyle(styleFor(featureOrdinal))
          }
        }
        syncMarkers()
      }
      map.on('zoomend', restyleOnZoom)
      return () => {
        map.off('zoomend', restyleOnZoom)
      }
    }
  }, [filteredFeatures, encoding, selectedSet, fillOpacity])

  // Predio names over the overview, for the predios that have visible polygons.
  useEffect(() => {
    const map = mapRef.current
    const labelGroup = labelGroupRef.current
    if (map === null || labelGroup === null) return

    const labels = predioLabels(filteredFeatures)
    const fitPredio = (name: string) => {
      const bounds = L.latLngBounds([])
      for (const entry of layersRef.current.values()) {
        if (entry.feature.properties.nom_predio !== name) continue
        if (!groupRef.current?.hasLayer(entry.layer)) continue
        bounds.extend(entry.layer.getBounds())
      }
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 })
    }
    const sync = () => {
      labelGroup.clearLayers()
      if (map.getZoom() >= PREDIO_LABELS_BELOW_ZOOM) return
      // Approximate label boxes in screen pixels (12px bold ≈ 7.2px a letter).
      const placed = labels.map((label) => {
        const [lon, lat] = utmToLonLat(label.x, label.y)
        const point = map.latLngToContainerPoint([lat, lon])
        const halfWidth = (label.html.length * 7.2 + 18) / 2
        return {
          label,
          lat,
          lon,
          box: { left: point.x - halfWidth, right: point.x + halfWidth, top: point.y - 12, bottom: point.y + 12 },
        }
      })
      // The toolbar, zoom buttons and credits float over the map: no names under them.
      const keep = nonOverlapping(
        placed.map((entry) => entry.box),
        4,
        controlBoxes(map),
      )
      placed.forEach((entry, index) => {
        if (!keep[index]) return
        // A predio name is a button: it fits the map to that predio.
        const marker = L.marker([entry.lat, entry.lon], {
          keyboard: true,
          title: `Acercar a ${entry.label.name}`,
          alt: `Acercar a ${entry.label.name}`,
          icon: L.divIcon({
            className: 'map-predio-label',
            html: `<span>${entry.label.html}</span>`,
            iconSize: undefined,
          }),
        }).addTo(labelGroup)
        marker.on('click', (event: L.LeafletMouseEvent) => {
          markFeatureClick(event)
          fitPredio(entry.label.name)
        })
        marker.on('keypress', (event: L.LeafletKeyboardEvent) => {
          if (event.originalEvent.key === 'Enter') fitPredio(entry.label.name)
        })
      })
    }
    sync()
    map.on('zoomend moveend', sync)
    return () => {
      map.off('zoomend moveend', sync)
    }
  }, [filteredFeatures])

  // Rodal number and code over each polygon big enough to hold them.
  useEffect(() => {
    const map = mapRef.current
    const labelGroup = rodalLabelGroupRef.current
    if (map === null || labelGroup === null) return

    const sync = () => {
      labelGroup.clearLayers()
      if (map.getZoom() < RODAL_LABELS_FROM_ZOOM) return
      const view = map.getBounds()
      const resolution = metersPerPixel(map.getCenter().lat, map.getZoom())
      const candidates: { html: string; lat: number; lon: number; box: LabelBox; size: number }[] = []
      // The view in EPSG:32718, padded a little: UTM and lat/lon grids are
      // not exactly parallel.
      const [vx1, vy1] = lonLatToUtm(view.getWest(), view.getSouth())
      const [vx2, vy2] = lonLatToUtm(view.getEast(), view.getNorth())
      const padX = (vx2 - vx1) * 0.05
      const padY = (vy2 - vy1) * 0.05
      for (const feature of filteredFeatures) {
        const ordinal = feature.properties.feature_ordinal
        const entry = layersRef.current.get(ordinal)
        if (entry === undefined) continue
        const [minx, miny, maxx, maxy] = entry.bbox
        // Cheap checks first: off screen or too small to hold a label.
        if (maxx < vx1 - padX || minx > vx2 + padX || maxy < vy1 - padY || miny > vy2 + padY) continue
        const size = entry.maxExtentMeters / resolution
        if (size < RODAL_LABEL_MIN_POLYGON_PX) continue
        const html = rodalLabelHtml(feature.properties)
        if (html === null) continue
        let point = labelPointsRef.current.get(ordinal)
        if (point === undefined) {
          point = labelPoint(feature.geometry.coordinates)
          labelPointsRef.current.set(ordinal, point)
        }
        const [lon, lat] = utmToLonLat(point[0], point[1])
        if (!view.contains([lat, lon])) continue
        const at = map.latLngToContainerPoint([lat, lon])
        const text = html.replace(/<[^>]+>/g, ' ')
        const halfWidth = (Math.max(...text.trim().split(/\s+/).map((word) => word.length)) * 7 + 10) / 2
        candidates.push({
          html,
          lat,
          lon,
          size,
          box: { left: at.x - halfWidth, right: at.x + halfWidth, top: at.y - 15, bottom: at.y + 15 },
        })
      }
      // Bigger polygons first: they are the ones people look for.
      candidates.sort((a, b) => b.size - a.size)
      const shown = candidates.slice(0, RODAL_LABEL_MAX)
      const keep = nonOverlapping(
        shown.map((entry) => entry.box),
        2,
        controlBoxes(map),
      )
      shown.forEach((entry, index) => {
        if (!keep[index]) return
        L.marker([entry.lat, entry.lon], {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({ className: 'map-rodal-label', html: `<span>${entry.html}</span>`, iconSize: undefined }),
        }).addTo(labelGroup)
      })
    }
    sync()
    map.on('zoomend moveend', sync)
    return () => {
      map.off('zoomend moveend', sync)
    }
  }, [filteredFeatures])

  // Initial fit to the whole loaded collection (once per collection object).
  useEffect(() => {
    const map = mapRef.current
    const group = groupRef.current
    if (map === null || group === null || fittedCollectionRef.current === collection) return
    const bounds = group.getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [16, 16] })
      fittedCollectionRef.current = collection
    }
  }, [collection, filteredFeatures])

  useEffect(() => {
    if (fitNonce === 0) return
    const map = mapRef.current
    const group = groupRef.current
    if (map === null || group === null) return
    const bounds = group.getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16] })
  }, [fitNonce])

  useEffect(() => {
    if (zoomRequest === null) return
    const map = mapRef.current
    if (map === null) return
    const bounds = L.latLngBounds([])
    for (const featureOrdinal of zoomRequest.featureOrdinals) {
      const entry = layersRef.current.get(featureOrdinal)
      if (entry !== undefined) bounds.extend(entry.layer.getBounds())
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 })
  }, [zoomRequest])

  // Draw the measured line (and the area once there are three points).
  useEffect(() => {
    const group = measureGroupRef.current
    if (group === null) return
    group.clearLayers()
    if (measurePoints.length === 0) return
    const latLngs = measurePoints.map(([x, y]) => {
      const [lon, lat] = utmToLonLat(x, y)
      return L.latLng(lat, lon)
    })
    const style = { pane: TOOLS_PANE, color: '#ffd84d', weight: 3, dashArray: '6 4', interactive: false }
    if (latLngs.length >= 3) L.polygon(latLngs, { ...style, fillOpacity: 0.15 }).addTo(group)
    else L.polyline(latLngs, style).addTo(group)
    for (const latLng of latLngs) {
      L.circleMarker(latLng, {
        pane: TOOLS_PANE,
        radius: 4,
        color: '#14130f',
        weight: 1.5,
        fillColor: '#ffd84d',
        fillOpacity: 1,
        interactive: false,
      }).addTo(group)
    }
  }, [measurePoints])

  // Esc leaves «Medir».
  useEffect(() => {
    if (!measuring) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMeasuring(false)
      setMeasurePoints([])
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [measuring])

  const measurement = measurePath(measurePoints)

  return (
    <div className={`map${measuring ? ' map--measuring' : ''}`}>
      <div ref={containerRef} className="map__canvas" data-testid="map-canvas" />
      <div className="map__controls" aria-label="Controles del mapa">
        <button
          type="button"
          className="map__control-button"
          onClick={onToggleSidebar}
          aria-pressed={!sidebarCollapsed && !mapFocus}
        >
          {sidebarCollapsed || mapFocus ? 'Mostrar filtros' : 'Ocultar filtros'}
          {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        <label className="map__basemap-control">
          <span>Fondo</span>
          <select
            className="map__basemap-select"
            value={basemapMode}
            onChange={(event) => setBasemapMode(event.target.value as BasemapMode)}
            aria-label="Fondo del mapa"
          >
            <option value="map">Mapa</option>
            <option value="satellite">Satélite</option>
            <option value="none">Sin fondo</option>
          </select>
        </label>
        <label className="map__opacity-control">
          <span>Opacidad</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(fillOpacity * 100)}
            onChange={(event) => setFillOpacity(Number(event.target.value) / 100)}
            aria-label="Opacidad de los polígonos"
          />
          <span className="map__opacity-value">{Math.round(fillOpacity * 100)}%</span>
          <Hint text="Transparencia del relleno de los polígonos. Bájala para ver la imagen de fondo; bajo 50 % el borde toma el color del uso, así no se pierden los límites." />
        </label>
        <button type="button" className="map__control-button" onClick={onFitToResults}>
          Ajustar a resultados
        </button>
        <button
          type="button"
          className="map__control-button"
          aria-pressed={measuring}
          onClick={() => {
            setMeasuring((on) => !on)
            setMeasurePoints([])
          }}
        >
          {measuring ? 'Terminar medición' : 'Medir'}
        </button>
        <button
          type="button"
          className="map__control-button"
          onClick={() => {
            setMapStatus('Buscando su ubicación…')
            mapRef.current?.locate({ setView: true, maxZoom: 17, enableHighAccuracy: true })
          }}
        >
          Mi ubicación
        </button>
        <Hint text={'Clic: elige un rodal. Mayús + clic: agrega o quita. Mayús + arrastrar: elige un área. Ctrl + / Ctrl −: acerca o aleja el mapa.\nMedir: un clic por punto; con tres o más puntos también se ve el área. Esc termina.\nMi ubicación: usa el GPS del teléfono o la ubicación del computador; no se guarda ni se envía.'} />
        <button
          type="button"
          className="map__control-button map__control-button--focus"
          aria-pressed={mapFocus}
          onClick={onToggleMapFocus}
        >
          {mapFocus ? 'Salir de modo mapa' : 'Modo mapa'}
        </button>
      </div>

      {measuring ? (
        <div className="map__measure" role="status">
          {measurePoints.length === 0 ? (
            <span>Haga clic en el mapa para marcar puntos.</span>
          ) : (
            <span>
              Distancia <b>{formatDistance(measurement.lengthM)}</b>
              {measurement.areaM2 !== null ? (
                <>
                  {' · '}Área <b>{formatArea(measurement.areaM2)}</b>
                </>
              ) : null}
            </span>
          )}
          <button
            type="button"
            className="button button--ghost"
            disabled={measurePoints.length === 0}
            onClick={() => setMeasurePoints((points) => points.slice(0, -1))}
          >
            Deshacer punto
          </button>
          <button
            type="button"
            className="button button--ghost"
            disabled={measurePoints.length === 0}
            onClick={() => setMeasurePoints([])}
          >
            Borrar
          </button>
        </div>
      ) : null}

      {mapStatus !== null ? (
        <div className="map__status" role="status">
          <span>{mapStatus}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setMapStatus(null)}>
            ×
          </button>
        </div>
      ) : null}

      {cursorUtm !== null ? (
        <div className="map__coords" aria-hidden="true">
          UTM 18S · E {Math.round(cursorUtm[0]).toLocaleString('es-CL')} · N{' '}
          {Math.round(cursorUtm[1]).toLocaleString('es-CL')}
        </div>
      ) : null}

      {filteredFeatures.length === 0 ? (
        <div className="map__empty" role="status">
          <p>Ningún polígono coincide con los filtros actuales.</p>
        </div>
      ) : null}
    </div>
  )
}
