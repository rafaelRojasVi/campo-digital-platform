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
}

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION = '© OpenStreetMap contributors'

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

export function MapView({
  collection,
  filteredFeatures,
  encoding,
  selectedOrdinal,
  onSelect,
  zoomRequest,
  fitNonce,
  onFitToResults,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const groupRef = useRef<L.FeatureGroup | null>(null)
  const markerGroupRef = useRef<L.FeatureGroup | null>(null)
  const baseLayerRef = useRef<L.TileLayer | null>(null)
  const layersRef = useRef<Map<number, FeatureLayer>>(new Map())
  const styleForRef = useRef<(featureOrdinal: number) => L.PathOptions>(() => ({}))
  const onSelectRef = useRef(onSelect)
  const [basemapVisible, setBasemapVisible] = useState(true)

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // Map + basemap lifecycle.
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
      layersRef.current = new Map()
      // A fresh map instance starts at the default view, so the initial
      // collection fit must run again on the next mount.
      fittedCollectionRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (map === null) {
      return
    }

    if (basemapVisible && baseLayerRef.current === null) {
      baseLayerRef.current = L.tileLayer(OSM_TILE_URL, {
        maxZoom: 19,
        attribution: OSM_ATTRIBUTION,
      }).addTo(map)
    } else if (!basemapVisible && baseLayerRef.current !== null) {
      baseLayerRef.current.remove()
      baseLayerRef.current = null
    }
  }, [basemapVisible])

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

  // Visibility + style: driven by filters, color encoding, and selection.
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

      // At estate scale the 1,568 polygons are only a few pixels each and a
      // white stroke would wash them out, so the boundary gap appears from
      // zoom 12 up. Small filtered subsets keep their stroke at any zoom so
      // isolated polygons stay findable.
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
          entry.maxExtentMeters / resolution < MARKER_MIN_POLYGON_PX

        if (wantMarker) {
          const color =
            encoding !== null ? encoding.colorFor(entry.feature) : '#9a9890'

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
  }, [filteredFeatures, encoding, selectedOrdinal])

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

  return (
    <div className="map">
      <div ref={containerRef} className="map__canvas" data-testid="map-canvas" />
      <div className="map__controls">
        <button
          type="button"
          className="map__control-button"
          onClick={onFitToResults}
          title="Ajustar la vista a los polígonos filtrados"
        >
          Ajustar a resultados
        </button>
        <button
          type="button"
          className="map__control-button"
          aria-pressed={basemapVisible}
          onClick={() => setBasemapVisible((visible) => !visible)}
          title="Mostrar u ocultar el mapa base OpenStreetMap"
        >
          {basemapVisible ? 'Ocultar mapa base' : 'Mostrar mapa base'}
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
