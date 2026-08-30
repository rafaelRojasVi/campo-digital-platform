import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { metersPerPixel, multiPolygonToLatLngs, tooltipHtml } from '../lib/mapData.ts'
import { lonLatToUtm, multiPolygonUtmBbox, utmToLonLat } from '../lib/proj.ts'
import {
  cloneCoordinates,
  isClosedRing,
  moveDraftVertex,
  multiPolygonAreaSquareMeters,
  type DraftCoordinates,
} from '../lib/draftGeometry.ts'
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

function formatHa(value: number): string {
  return value.toLocaleString('es-CL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
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
  const draftLayerRef = useRef<L.Polygon | null>(null)
  const draftMarkerGroupRef = useRef<L.LayerGroup | null>(null)
  const draftCoordinatesRef = useRef<DraftCoordinates | null>(null)
  const [basemapMode, setBasemapMode] = useState<BasemapMode>('map')
  const [draftFeatureOrdinal, setDraftFeatureOrdinal] = useState<number | null>(null)
  const [draftAreaHa, setDraftAreaHa] = useState<number | null>(null)
  const [draftResetNonce, setDraftResetNonce] = useState(0)

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // Map lifecycle.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) {
      return
    }

    const map = L.map(container, {
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true,
      // Fractional zoom lets fitBounds fill the viewport with the sparse
      // estate envelope instead of snapping a full level out.
      zoomSnap: 0.25,
    })
    map.setView([-40.45, -73.35], 10)
    L.control.scale({ metric: true, imperial: false }).addTo(map)

    const handleBackgroundClick = (event: L.LeafletMouseEvent) => {
      const original = event.originalEvent as MouseEvent & { _forestryFeatureClick?: boolean }
      if (original._forestryFeatureClick !== true) {
        onSelectRef.current(null)
      }
    }
    map.on('click', handleBackgroundClick)

    mapRef.current = map

    const observer = new ResizeObserver(() => {
      map.invalidateSize()
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      groupRef.current = null
      baseLayerRef.current = null
      draftLayerRef.current = null
      draftMarkerGroupRef.current = null
      draftCoordinatesRef.current = null
      layersRef.current = new Map()
      // A fresh map instance starts at the default view, so the initial
      // collection fit must run again on the next mount.
      fittedCollectionRef.current = null
    }
  }, [])

  // Basemap is presentation only. Forestry geometry remains the source layer.
  useEffect(() => {
    const map = mapRef.current
    if (map === null) {
      return
    }

    if (baseLayerRef.current !== null) {
      baseLayerRef.current.remove()
      baseLayerRef.current = null
    }

    if (basemapMode === 'none') {
      return
    }

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
    if (map === null) {
      return
    }

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
        const original = event.originalEvent as MouseEvent & { _forestryFeatureClick?: boolean }
        original._forestryFeatureClick = true
        onSelectRef.current(featureOrdinal)
      })

      layer.on('mouseover', () => {
        layer.setStyle({ fillOpacity: 0.92, weight: 2 })
      })

      layer.on('mouseout', () => {
        layer.setStyle(styleForRef.current(featureOrdinal))
      })

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

    return () => {
      group.remove()
      markerGroup.remove()
      groupRef.current = null
      markerGroupRef.current = null
      layersRef.current = new Map()
    }
  }, [collection])

  // If selection moves away from the locally edited polygon, discard the draft.
  useEffect(() => {
    if (draftFeatureOrdinal !== null && selectedOrdinal !== draftFeatureOrdinal) {
      setDraftFeatureOrdinal(null)
    }
  }, [draftFeatureOrdinal, selectedOrdinal])

  // Visibility + style: driven by filters, color encoding, selection and draft state.
  useEffect(() => {
    const group = groupRef.current
    if (group === null) {
      return
    }

    const visibleOrdinals = new Set(
      filteredFeatures.map((feature) => feature.properties.feature_ordinal),
    )

    const styleFor = (featureOrdinal: number): L.PathOptions => {
      const entry = layersRef.current.get(featureOrdinal)
      const color =
        entry !== undefined && encoding !== null ? encoding.colorFor(entry.feature) : '#9a9890'
      const selected = featureOrdinal === selectedOrdinal
      const editing = featureOrdinal === draftFeatureOrdinal

      // At estate scale the 1,568 polygons are only a few pixels each and a
      // white stroke would wash them out, so the boundary gap appears from
      // zoom 12 up. Small filtered subsets keep their stroke at any zoom so
      // isolated polygons stay findable.
      const zoom = mapRef.current?.getZoom() ?? 12
      const strokeWeight = zoom >= 12 || visibleOrdinals.size <= 200 ? 0.8 : 0

      return {
        color: editing || selected ? '#14130f' : '#ffffff',
        weight: editing ? 2 : selected ? 2.5 : strokeWeight,
        opacity: editing || selected ? 1 : 0.85,
        fillColor: color,
        fillOpacity: editing ? 0.12 : 0.78,
        dashArray: editing ? '5 4' : undefined,
      }
    }
    styleForRef.current = styleFor

    let selectedLayer: L.Polygon | null = null

    for (const [featureOrdinal, entry] of layersRef.current) {
      const visible = visibleOrdinals.has(featureOrdinal)

      if (visible && !entry.visible) {
        group.addLayer(entry.layer)
        entry.visible = true
      } else if (!visible && entry.visible) {
        group.removeLayer(entry.layer)
        entry.visible = false
      }

      if (visible) {
        entry.layer.setStyle(styleFor(featureOrdinal))
        if (featureOrdinal === selectedOrdinal) {
          selectedLayer = entry.layer
        }
      }
    }

    if (selectedLayer !== null) {
      selectedLayer.bringToFront()
    }

    // Representative point markers: in a small filtered subset, a polygon of
    // a few hectares is sub-pixel at estate zoom; a centroid dot keeps it
    // findable. Dots disappear once the polygon itself is readable.
    const syncMarkers = () => {
      const map = mapRef.current
      const markerGroup = markerGroupRef.current
      if (map === null || markerGroup === null) {
        return
      }

      const useMarkers = visibleOrdinals.size <= MARKER_MAX_SUBSET
      const resolution = metersPerPixel(map.getCenter().lat, map.getZoom())

      for (const [featureOrdinal, entry] of layersRef.current) {
        const wantMarker =
          useMarkers &&
          entry.visible &&
          featureOrdinal !== draftFeatureOrdinal &&
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
              const original = event.originalEvent as MouseEvent & {
                _forestryFeatureClick?: boolean
              }
              original._forestryFeatureClick = true
              onSelectRef.current(featureOrdinal)
            })
            entry.marker = marker
          }

          entry.marker.setStyle({ fillColor: color })
          if (!markerGroup.hasLayer(entry.marker)) {
            markerGroup.addLayer(entry.marker)
          }
        } else if (entry.marker !== null && markerGroup.hasLayer(entry.marker)) {
          markerGroup.removeLayer(entry.marker)
        }
      }
    }

    syncMarkers()

    // Re-derive stroke weight and marker visibility on zoom changes.
    const map = mapRef.current
    if (map !== null) {
      const restyleOnZoom = () => {
        for (const [featureOrdinal, entry] of layersRef.current) {
          if (entry.visible) {
            entry.layer.setStyle(styleFor(featureOrdinal))
          }
        }
        syncMarkers()
      }
      map.on('zoomend', restyleOnZoom)
      return () => {
        map.off('zoomend', restyleOnZoom)
      }
    }
  }, [filteredFeatures, encoding, selectedOrdinal, draftFeatureOrdinal])

  // Local-only draft geometry editor. The source layer remains untouched and
  // is shown beneath the draft as a dashed outline for comparison.
  useEffect(() => {
    const map = mapRef.current
    if (map === null || draftFeatureOrdinal === null) return

    const entry = layersRef.current.get(draftFeatureOrdinal)
    if (entry === undefined || !entry.feature.properties.geometry_is_valid) return

    const coordinates = cloneCoordinates(entry.feature.geometry.coordinates)
    draftCoordinatesRef.current = coordinates
    setDraftAreaHa(multiPolygonAreaSquareMeters(coordinates) / 10_000)

    const draftLayer = L.polygon(
      multiPolygonToLatLngs({ type: 'MultiPolygon', coordinates }),
      {
        color: '#f3a712',
        weight: 3,
        opacity: 1,
        fillColor: '#f3a712',
        fillOpacity: 0.18,
      },
    ).addTo(map)
    draftLayerRef.current = draftLayer

    const markerGroup = L.layerGroup().addTo(map)
    draftMarkerGroupRef.current = markerGroup

    for (let polygonIndex = 0; polygonIndex < coordinates.length; polygonIndex += 1) {
      const polygon = coordinates[polygonIndex]
      if (polygon === undefined) continue

      for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
        const ring = polygon[ringIndex]
        if (ring === undefined) continue
        const markerCount = isClosedRing(ring) ? ring.length - 1 : ring.length

        for (let vertexIndex = 0; vertexIndex < markerCount; vertexIndex += 1) {
          const position = ring[vertexIndex]
          if (position === undefined) continue
          const x = position[0]
          const y = position[1]
          if (x === undefined || y === undefined) continue
          const [lon, lat] = utmToLonLat(x, y)

          const marker = L.marker([lat, lon], {
            draggable: true,
            keyboard: false,
            icon: L.divIcon({
              className: 'draft-vertex',
              html: '<span></span>',
              iconSize: [12, 12],
              iconAnchor: [6, 6],
            }),
          }).addTo(markerGroup)

          marker.on('drag', () => {
            const point = marker.getLatLng()
            const [nextX, nextY] = lonLatToUtm(point.lng, point.lat)
            moveDraftVertex(
              coordinates,
              polygonIndex,
              ringIndex,
              vertexIndex,
              nextX,
              nextY,
            )
            draftLayer.setLatLngs(
              multiPolygonToLatLngs({ type: 'MultiPolygon', coordinates }),
            )
            setDraftAreaHa(multiPolygonAreaSquareMeters(coordinates) / 10_000)
          })
        }
      }
    }

    draftLayer.bringToFront()

    return () => {
      markerGroup.remove()
      draftLayer.remove()
      draftMarkerGroupRef.current = null
      draftLayerRef.current = null
      draftCoordinatesRef.current = null
    }
  }, [draftFeatureOrdinal, draftResetNonce])

  // Initial fit to the whole loaded collection (once per collection object).
  const fittedCollectionRef = useRef<FeatureCollection | null>(null)
  useEffect(() => {
    const map = mapRef.current
    const group = groupRef.current
    if (map === null || group === null || fittedCollectionRef.current === collection) {
      return
    }
    const bounds = group.getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [16, 16] })
      fittedCollectionRef.current = collection
    }
  }, [collection, filteredFeatures])

  // Explicit "fit to filtered results".
  useEffect(() => {
    if (fitNonce === 0) {
      return
    }
    const map = mapRef.current
    const group = groupRef.current
    if (map === null || group === null) {
      return
    }
    const bounds = group.getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [16, 16] })
    }
  }, [fitNonce])

  // Zoom to one selected feature (table row click, inspector button).
  useEffect(() => {
    if (zoomRequest === null) {
      return
    }
    const map = mapRef.current
    const entry = layersRef.current.get(zoomRequest.featureOrdinal)
    if (map === null || entry === undefined) {
      return
    }
    const bounds = entry.layer.getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 })
    }
  }, [zoomRequest])

  const draftFeature =
    draftFeatureOrdinal === null
      ? null
      : collection.features.find(
          (feature) => feature.properties.feature_ordinal === draftFeatureOrdinal,
        ) ?? null
  const originalAreaHa =
    draftFeature === null ? null : draftFeature.properties.geometry_area_source_units / 10_000
  const areaDifferenceHa =
    originalAreaHa === null || draftAreaHa === null ? null : draftAreaHa - originalAreaHa
  const areaDifferencePercent =
    originalAreaHa === null || originalAreaHa === 0 || areaDifferenceHa === null
      ? null
      : (areaDifferenceHa / originalAreaHa) * 100

  const selectedFeature =
    selectedOrdinal === null
      ? null
      : collection.features.find(
          (feature) => feature.properties.feature_ordinal === selectedOrdinal,
        ) ?? null

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
        <button
          type="button"
          className="map__control-button"
          onClick={onFitToResults}
          title="Ajustar la vista a los polígonos filtrados"
        >
          Ajustar a resultados
        </button>
        {selectedFeature !== null && draftFeatureOrdinal === null ? (
          <button
            type="button"
            className="map__control-button map__control-button--draft"
            disabled={!selectedFeature.properties.geometry_is_valid}
            onClick={() => setDraftFeatureOrdinal(selectedFeature.properties.feature_ordinal)}
            title={
              selectedFeature.properties.geometry_is_valid
                ? 'Crear un borrador local moviendo vértices; no modifica la fuente'
                : 'La simulación requiere una geometría fuente válida'
            }
          >
            Simular ajuste
          </button>
        ) : null}
        <button
          type="button"
          className="map__control-button map__control-button--focus"
          aria-pressed={mapFocus}
          onClick={onToggleMapFocus}
          title="Dar prioridad visual al mapa"
        >
          {mapFocus ? 'Salir de modo mapa' : 'Modo mapa'}
        </button>
      </div>

      {draftFeature !== null && originalAreaHa !== null && draftAreaHa !== null ? (
        <section className="draft-edit" aria-label="Simulación local de límite">
          <div className="draft-edit__heading">
            <div>
              <strong>Simulación de límite</strong>
              <span>
                {draftFeature.properties.n_rodal !== null
                  ? `Rodal ${draftFeature.properties.n_rodal}`
                  : `Polígono #${draftFeature.properties.feature_ordinal}`}
              </span>
            </div>
            <span className="draft-edit__badge">Borrador local</span>
          </div>
          <div className="draft-edit__metrics">
            <div>
              <span>Área original</span>
              <strong>{formatHa(originalAreaHa)} ha</strong>
            </div>
            <div>
              <span>Área estimada</span>
              <strong>{formatHa(draftAreaHa)} ha</strong>
            </div>
            <div>
              <span>Diferencia</span>
              <strong>
                {areaDifferenceHa !== null && areaDifferenceHa >= 0 ? '+' : ''}
                {areaDifferenceHa === null ? '—' : formatHa(areaDifferenceHa)} ha
                {areaDifferencePercent === null
                  ? ''
                  : ` (${areaDifferencePercent >= 0 ? '+' : ''}${areaDifferencePercent.toFixed(1)}%)`}
              </strong>
            </div>
          </div>
          <p>
            Arrastra los puntos del límite. El cálculo usa la geometría del borrador en EPSG:32718.
            No guarda ni modifica la fuente.
          </p>
          <div className="draft-edit__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setDraftResetNonce((nonce) => nonce + 1)}
            >
              Reiniciar
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setDraftFeatureOrdinal(null)}
            >
              Descartar borrador
            </button>
          </div>
        </section>
      ) : null}

      {filteredFeatures.length === 0 ? (
        <div className="map__empty" role="status">
          <p>Ningún polígono coincide con los filtros actuales.</p>
        </div>
      ) : null}
    </div>
  )
}
