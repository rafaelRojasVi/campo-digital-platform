import { useState } from 'react'
import { ComparisonPanel } from './ComparisonPanel.tsx'
import { FeatureTable } from './FeatureTable.tsx'
import { KpiStrip } from './KpiStrip.tsx'
import { QualityPanel } from './QualityPanel.tsx'
import type { FilterState } from '../lib/filters.ts'
import type { SelectionStats } from '../lib/aggregate.ts'
import { formatDate, formatInt, shortFingerprint } from '../lib/format.ts'
import type {
  FeatureCollection,
  ForestrySnapshot,
  GeoFeature,
  SnapshotSummary,
  SourceFieldComparison,
} from '../types.ts'

interface DataPanelProps {
  collection: FeatureCollection
  filteredFeatures: GeoFeature[]
  filteredStats: SelectionStats
  comparison: SourceFieldComparison
  summary: SnapshotSummary
  filters: FilterState
  onFiltersChange: (filters: FilterState) => void
  selectedOrdinal: number | null
  onSelectFeature: (featureOrdinal: number) => void
  snapshot: ForestrySnapshot
}

type TabId = 'tabla' | 'comparacion' | 'revision'

// Closed on arrival so the map gets the screen; any tab opens it. Technical
// evidence about the base (counts, CRS, fingerprint, quality cases) lives in
// «Revisión de la base», away from the everyday view.

export function DataPanel({
  collection,
  filteredFeatures,
  filteredStats,
  comparison,
  summary,
  filters,
  onFiltersChange,
  selectedOrdinal,
  onSelectFeature,
  snapshot,
}: DataPanelProps) {
  const [tab, setTab] = useState<TabId>('tabla')
  const [collapsed, setCollapsed] = useState(true)
  const snapshotId = snapshot.shapefile_snapshot_id

  const tabs: { id: TabId; label: string }[] = [
    { id: 'tabla', label: `Tabla (${formatInt(filteredStats.featureCount)})` },
    {
      id: 'comparacion',
      label: `Cambios 2024 → 2026 (${formatInt(
        comparison.cod_uso_vs_cod_uso_2026.changed_feature_count,
      )})`,
    },
    { id: 'revision', label: 'Revisión de la base' },
  ]

  return (
    <section
      className={`data-panel${collapsed ? ' data-panel--collapsed' : ''}`}
      aria-label="Datos de los polígonos filtrados"
    >
      <div className="data-panel__bar">
        <div role="tablist" className="data-panel__tabs" aria-label="Vistas de datos">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={!collapsed && tab === entry.id}
              className={`data-panel__tab${
                !collapsed && tab === entry.id ? ' data-panel__tab--active' : ''
              }`}
              onClick={() => {
                setTab(entry.id)
                setCollapsed(false)
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="data-panel__collapse"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? 'Abrir panel' : 'Cerrar panel'}
        </button>
      </div>

      {!collapsed ? (
        <div className="data-panel__content">
          {tab === 'tabla' ? (
            <FeatureTable
              features={filteredFeatures}
              selectedOrdinal={selectedOrdinal}
              onSelectFeature={onSelectFeature}
              snapshotId={snapshotId}
            />
          ) : null}
          {tab === 'comparacion' ? (
            <ComparisonPanel
              comparison={comparison}
              collection={collection}
              filters={filters}
              onFiltersChange={onFiltersChange}
              onSelectFeature={onSelectFeature}
            />
          ) : null}
          {tab === 'revision' ? (
            <div className="base-review">
              <dl className="base-review__provenance" aria-label="Procedencia de la versión">
                <div>
                  <dt>Versión</dt>
                  <dd>
                    N.º {snapshotId} · cargada el {formatDate(snapshot.created_at)}
                  </dd>
                </div>
                <div>
                  <dt>Capa de origen</dt>
                  <dd>{snapshot.layer_name}</dd>
                </div>
                <div>
                  <dt>Sistema de coordenadas</dt>
                  <dd>EPSG:{summary.storage_srid}</dd>
                </div>
                <div>
                  <dt>Huella del archivo</dt>
                  <dd>
                    <code>{shortFingerprint(snapshot.family_fingerprint)}</code>
                  </dd>
                </div>
              </dl>
              <KpiStrip summary={summary} comparison={comparison} collection={collection} />
              <QualityPanel summary={summary} filters={filters} onFiltersChange={onFiltersChange} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
