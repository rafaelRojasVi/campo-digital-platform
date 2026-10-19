import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { labelPoint } from '../lib/labelPoint.ts'
import { multiPolygonToLatLngs } from '../lib/mapData.ts'
import { utmToLonLat } from '../lib/proj.ts'
import type { ReportFeature } from '../reportsApi.ts'

// A still map for the printed report: the report's polygons over the
// satellite image, managed areas in harvest orange, each labeled with its
// rodal; framed on the managed areas (all polygons when none is marked).

const SATELLITE_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SATELLITE_ATTRIBUTION =
  'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community'
export const PRINT_MANAGED = '#e8a33d'
export const PRINT_OTHER = '#2f9e6a'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function PrintMap({ features }: { features: ReportFeature[] }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const map = L.map(container, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      zoomSnap: 0.25,
    })
    L.tileLayer(SATELLITE_TILE_URL, {
      attribution: SATELLITE_ATTRIBUTION,
      maxZoom: 19,
      crossOrigin: true,
      referrerPolicy: 'strict-origin',
    }).addTo(map)
    L.control.scale({ metric: true, imperial: false, maxWidth: 160 }).addTo(map)

    const managedBounds = L.latLngBounds([])
    const allBounds = L.latLngBounds([])
    for (const feature of features) {
      const polygon = L.polygon(multiPolygonToLatLngs(feature.geometry), {
        color: '#ffffff',
        weight: 1.5,
        fillColor: feature.in_report ? PRINT_MANAGED : PRINT_OTHER,
        fillOpacity: feature.in_report ? 0.6 : 0.35,
        interactive: false,
      }).addTo(map)
      allBounds.extend(polygon.getBounds())
      if (feature.in_report) managedBounds.extend(polygon.getBounds())
      const rodal = feature.attributes.n_rodal
      if (typeof rodal === 'string' && rodal.trim() !== '') {
        const [x, y] = labelPoint(feature.geometry.coordinates)
        const [lon, lat] = utmToLonLat(x, y)
        L.marker([lat, lon], {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: 'map-rodal-label',
            html: `<span><b>${escapeHtml(rodal.trim())}</b></span>`,
            iconSize: undefined,
          }),
        }).addTo(map)
      }
    }
    const frame = managedBounds.isValid() ? managedBounds : allBounds
    if (frame.isValid()) map.fitBounds(frame, { padding: [28, 28], maxZoom: 17 })
    else map.setView([-40.45, -73.35], 10)
    return () => {
      map.remove()
    }
  }, [features])

  return (
    <div className="print-map">
      <div ref={containerRef} className="print-map__canvas" />
      <div className="print-map__north" aria-label="Norte">
        <svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true">
          <path d="M12 2 L20 26 L12 20 L4 26 Z" fill="#14130f" stroke="#ffffff" strokeWidth="1.5" />
        </svg>
        <span>N</span>
      </div>
    </div>
  )
}
