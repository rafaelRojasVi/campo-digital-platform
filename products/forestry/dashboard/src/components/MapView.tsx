import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { metersPerPixel, multiPolygonToLatLngs, tooltipHtml } from '../lib/mapData.ts'
import { multiPolygonUtmBbox, utmToLonLat } from '../lib/proj.ts'
import type { ColorEncoding } from '../lib/palette.ts'
import type { FeatureCollection, GeoFeature } from '../types.ts'
import type { ZoomRequest } from '../App.tsx'

interface MapViewProps {
  collection: FeatureCollection
  filteredFeatures: GeoFeature[]
  encoding: ColorEncoding | null
  selectedOrdinal: number | null
  onSelect: (featureOrdinal: number | null) => void
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
  visible: boolean
  /* Representative point for polygons too small to see at the current zoom. */
  centroid: L.LatLng
  maxExtentMeters: number
  marker: L.CircleMarker | null
}

const MARKER_MAX_SUBSET = 200
const MARKER_MIN_POLYGON_PX = 8

function markFeatureClick(event: L.LeafletMouseEvent): void {
  const original = event.originalEvent as MouseEvent & { _forestryFeatureClick?: boolean }
  original._forestryFeatureClick = true
}

export function MapView({
  collection,
  filteredFeatures,
  encoding,
  selectedOrdinal,
  onSelect,
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
  const baseLayerRef = useRef<L.TileLayer | null>(null)
  const layersRef = useRef<Map<number, FeatureLayer>>(new Map())
  const styleForRef = useRef<(featureOrdinal: number) => L.PathOptions>(() => ({}))
  const onSelectRef = useRef(onSelect)

  // Targeted-restyle bookkeeping: avoids re-applying setStyle to every
  // visible layer (measured 1,568 calls) when only the selection changes.
  const prevVisibleRef = useRef<Set<number>>(new Set())
  const prevSelectedRef = useRef<number | null>(null)
  const prevEncodingRef = useRef<ColorEncoding | null>(null)

  const [basemapMode, setBasemapMode] = useState<BasemapMode>('map')

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // Map lifecycle.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    const map = L.map(container, {
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true,
      zoomSnap: 0.25,
    })
    map.setView([-40.45, -73.35], 10)
    L.control.scale({ metric: true, imperial: false }).addTo(map)

    const handleBackgroundClick = (event: L.LeafletMouseEvent) => {
      const original = event.originalEvent as MouseEvent & { _forestryFeatureClick?: boolean }
      if (original._forestryFeatureClick !== true) onSelectRef.current(null)
    }
    map.on('click', handleBackgroundClick)

    mapRef.current = map

    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      groupRef.current = null
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
    baseLayerRef.current = L.tileLayer(satellite ? SATELLITE_TILE_URL : OSM_TILE_URL, {
      maxZoom: 19,
      attribution: satellite ? SATELLITE_ATTRIBUTION : OSM_ATTRIBUTION,
      crossOrigin: true,
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
        markFeatureClick(event)
        onSelectRef.current(featureOrdinal)
      })

      layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.92, weight: 2 }))
      layer.on('mouseout', () => layer.setStyle(styleForRef.current(featureOrdinal)))

      const [minx, miny, maxx, maxy] = multiPolygonUtmBbox(feature.geometry)
      const [lon, lat] = utmToLonLat((minx + maxx) / 2, (miny + maxy) / 2)

      layers.set(featureOrdinal, {
        layer,
        feature,
        visible: false,
        centroid: L.latLng(lat, lon),
        maxExtentMeters: Math.max(maxx - minx, maxy - miny),
        marker: null,
      })
    }

    layersRef.current = layers
    prevVisibleRef.current = new Set()
    prevSelectedRef.current = null
    prevEncodingRef.current = null

    return () => {
      group.remove()
      markerGroup.remove()
      groupRef.current = null
      markerGroupRef.current = null
      layersRef.current = new Map()
    }
  }, [collection])

  // Visibility + style: driven by filters, color encoding and selection. Only
  // layers whose visibility or role actually changed get restyled — measured
  // to cut ~1,568 setStyle calls down to a handful when the selection changes.
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
      const selected = featureOrdinal === selectedOrdinal
      const zoom = mapRef.current?.getZoom() ?? 12
      const strokeWeight = zoom >= 12 || visibleOrdinals.size <= 200 ? 0.8 : 0

      return {
        color: selected ? '#14130f' : '#ffffff',
        weight: selected ? 2.5 : strokeWeight,
        opacity: selected ? 1 : 0.85,
        fillColor: color,
        fillOpacity: 0.78,
      }
    }
    styleForRef.current = styleFor

    const previouslyVisible = prevVisibleRef.current
    const encodingChanged = prevEncodingRef.current !== encoding
    const touchedOrdinals = new Set<number>()
    if (prevSelectedRef.current !== null) touchedOrdinals.add(prevSelectedRef.current)
    if (selectedOrdinal !== null) touchedOrdinals.add(selectedOrdinal)

    let selectedLayer: L.Polygon | null = null
    for (const [featureOrdinal, entry] of layersRef.current) {
      const visible = visibleOrdinals.has(featureOrdinal)
      const wasVisible = previouslyVisible.has(featureOrdinal)
      if (visible && !entry.visible) {
        group.addLayer(entry.layer)
        entry.visible = true
      } else if (!visible && entry.visible) {
        group.removeLayer(entry.layer)
        entry.visible = false
      }
      if (visible && (!wasVisible || encodingChanged || touchedOrdinals.has(featureOrdinal))) {
        entry.layer.setStyle(styleFor(featureOrdinal))
      }
      if (visible && featureOrdinal === selectedOrdinal) selectedLayer = entry.layer
    }
    if (selectedLayer !== null) selectedLayer.bringToFront()

    prevVisibleRef.current = visibleOrdinals
    prevSelectedRef.current = selectedOrdinal
    prevEncodingRef.current = encoding

    const syncMarkers = () => {
      const map = mapRef.current
      const markerGroup = markerGroupRef.current
      if (map === null || markerGroup === null) return

      const useMarkers = visibleOrdinals.size <= MARKER_MAX_SUBSET
      const resolution = metersPerPixel(map.getCenter().lat, map.getZoom())

      for (const [featureOrdinal, entry] of layersRef.current) {
        const wantMarker =
          useMarkers && entry.visible && entry.maxExtentMeters / resolution < MARKER_MIN_POLYGON_PX

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
              markFeatureClick(event)
              onSelectRef.current(featureOrdinal)
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
      const restyleOnZoom = () => {
        for (const [featureOrdinal, entry] of layersRef.current) {
          if (entry.visible) entry.layer.setStyle(styleFor(featureOrdinal))
        }
        syncMarkers()
      }
      map.on('zoomend', restyleOnZoom)
      return () => {
        map.off('zoomend', restyleOnZoom)
      }
    }
  }, [filteredFeatures, encoding, selectedOrdinal])

  // Initial fit to the whole loaded collection (once per collection object).
  const fittedCollectionRef = useRef<FeatureCollection | null>(null)
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
    const entry = layersRef.current.get(zoomRequest.featureOrdinal)
    if (map === null || entry === undefined) return
    const bounds = entry.layer.getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 })
  }, [zoomRequest])

  return (
    <div className="map">
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
        <button type="button" className="map__control-button" onClick={onFitToResults}>
          Ajustar a resultados
        </button>
        <button
          type="button"
          className="map__control-button map__control-button--focus"
          aria-pressed={mapFocus}
          onClick={onToggleMapFocus}
        >
          {mapFocus ? 'Salir de modo mapa' : 'Modo mapa'}
        </button>
      </div>

      {filteredFeatures.length === 0 ? (
        <div className="map__empty" role="status">
          <p>Ningún polígono coincide con los filtros actuales.</p>
        </div>
      ) : null}
    </div>
  )
}
