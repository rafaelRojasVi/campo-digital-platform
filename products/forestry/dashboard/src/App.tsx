import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  NoSnapshotError,
  canUpload,
  devLogin,
  fetchComparison,
  fetchFeatureCollection,
  fetchPublishedSnapshot,
  fetchSnapshotSummary,
  isForbidden,
  isSignedOut,
} from './api.ts'
import { Header } from './components/Header.tsx'
import { AddToReportDialog } from './components/AddToReportDialog.tsx'
import { FiltersPanel } from './components/FiltersPanel.tsx'
import { LegendPanel } from './components/LegendPanel.tsx'
import { MapView } from './components/MapView.tsx'
import { DataPanel } from './components/DataPanel.tsx'
import { Inspector } from './components/Inspector.tsx'
import { SelectionPanel } from './components/SelectionPanel.tsx'
import { ActiveFilterBar } from './components/ActiveFilterBar.tsx'
import {
  ErrorView,
  ForbiddenView,
  LoadingView,
  NoSnapshotView,
  SignedOutView,
} from './components/StatusViews.tsx'
import { PLATFORM_FRONT_DOOR_PATH, platformFrontDoorEnabled } from './runtime/frontDoor.ts'
import { EMPTY_FILTERS, applyFilters, countActiveFilters } from './lib/filters.ts'
import type { FilterState } from './lib/filters.ts'
import { selectionStats } from './lib/aggregate.ts'
import { buildColorEncoding } from './lib/palette.ts'
import type { ColorDimension } from './lib/palette.ts'
import { ROUTES, mapPath, onLinkClick } from './router.ts'
import type {
  FeatureCollection,
  ForestryRole,
  ForestrySnapshot,
  SnapshotSummary,
  SourceFieldComparison,
} from './types.ts'

type LoadPhase =
  | { status: 'loading'; step: string }
  | { status: 'no-snapshot' }
  | { status: 'signed-out' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      snapshot: ForestrySnapshot
      summary: SnapshotSummary
      collection: FeatureCollection
      comparison: SourceFieldComparison
      /** The published version's id, when the map previews another one. */
      previewOf: number | null
    }

export interface ZoomRequest {
  featureOrdinals: number[]
  nonce: number
}

interface AppProps {
  /** `?version=<id>`: preview that version instead of the published one. */
  versionId?: number | null
  role?: ForestryRole | null
}

function snapshotFromSummary(summary: SnapshotSummary): ForestrySnapshot {
  return {
    shapefile_snapshot_id: summary.shapefile_snapshot_id,
    layer_name: summary.layer_name,
    family_fingerprint: summary.family_fingerprint,
    storage_srid: summary.storage_srid,
    feature_count: summary.feature_count,
    created_at: summary.created_at,
  }
}

async function publishedIdOrNull(): Promise<number | null> {
  try {
    return (await fetchPublishedSnapshot()).shapefile_snapshot_id
  } catch (error) {
    if (error instanceof NoSnapshotError) return null
    throw error
  }
}

export default function App({ versionId = null, role = null }: AppProps) {
  const [phase, setPhase] = useState<LoadPhase>({
    status: 'loading',
    step: 'Conectando con la API…',
  })
  const [reloadNonce, setReloadNonce] = useState(0)
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [colorDimension, setColorDimension] = useState<ColorDimension>('uso2026')
  // Ordered; one polygon opens the inspector, two or more the selection panel.
  const [selection, setSelection] = useState<number[]>([])
  const [zoomRequest, setZoomRequest] = useState<ZoomRequest | null>(null)
  const [fitNonce, setFitNonce] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mapFocus, setMapFocus] = useState(false)
  const [addToReport, setAddToReport] = useState<number[] | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setPhase({ status: 'loading', step: 'Conectando con la API…' })

      try {
        let snapshot: ForestrySnapshot
        let publishedId: number | null

        if (versionId === null) {
          snapshot = await fetchPublishedSnapshot()
          publishedId = snapshot.shapefile_snapshot_id
        } else {
          const [summary, published] = await Promise.all([
            fetchSnapshotSummary(versionId),
            publishedIdOrNull(),
          ])
          snapshot = snapshotFromSummary(summary)
          publishedId = published
        }

        if (cancelled) return
        setPhase({ status: 'loading', step: 'Cargando resumen y geometría…' })

        const [summary, collection, comparison] = await Promise.all([
          fetchSnapshotSummary(snapshot.shapefile_snapshot_id),
          fetchFeatureCollection(snapshot.shapefile_snapshot_id),
          fetchComparison(snapshot.shapefile_snapshot_id),
        ])

        if (cancelled) return
        setPhase({
          status: 'ready',
          snapshot,
          summary,
          collection,
          comparison,
          previewOf: publishedId === snapshot.shapefile_snapshot_id ? null : publishedId,
        })
      } catch (error) {
        if (cancelled) return

        if (error instanceof NoSnapshotError) {
          setPhase({ status: 'no-snapshot' })
        } else if (isSignedOut(error)) {
          // On the platform, sign-in lives at the front door.
          if (platformFrontDoorEnabled()) {
            window.location.assign(PLATFORM_FRONT_DOOR_PATH)
            return
          }
          setPhase({ status: 'signed-out' })
        } else if (isForbidden(error)) {
          setPhase({ status: 'forbidden' })
        } else if (versionId !== null && error instanceof ApiError && error.status === 404) {
          setPhase({ status: 'error', message: 'No se encontró la versión solicitada.' })
        } else {
          setPhase({
            status: 'error',
            message: 'No fue posible cargar los datos desde la API.',
          })
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [reloadNonce, versionId])

  const collection = phase.status === 'ready' ? phase.collection : null

  const filteredFeatures = useMemo(
    () => (collection === null ? [] : applyFilters(collection.features, filters)),
    [collection, filters],
  )

  const encoding = useMemo(
    () =>
      collection === null
        ? null
        : buildColorEncoding(colorDimension, collection.features, filteredFeatures),
    [collection, colorDimension, filteredFeatures],
  )

  const filteredStats = useMemo(() => selectionStats(filteredFeatures), [filteredFeatures])

  const selectedFeatures = useMemo(() => {
    if (collection === null || selection.length === 0) return []
    const byOrdinal = new Map(
      collection.features.map((feature) => [feature.properties.feature_ordinal, feature]),
    )
    return selection.flatMap((ordinal) => byOrdinal.get(ordinal) ?? [])
  }, [collection, selection])
  const selectedFeature = selectedFeatures.length === 1 ? selectedFeatures[0]! : null
  const selectedOrdinal = selection.length > 0 ? selection[selection.length - 1]! : null

  const handleSelect = useCallback((featureOrdinal: number | null, additive: boolean) => {
    setSelection((current) => {
      if (featureOrdinal === null) return additive ? current : []
      if (!additive) return [featureOrdinal]
      return current.includes(featureOrdinal)
        ? current.filter((ordinal) => ordinal !== featureOrdinal)
        : [...current, featureOrdinal]
    })
  }, [])

  const handleSelectMany = useCallback((featureOrdinals: number[]) => {
    setSelection((current) => [...new Set([...current, ...featureOrdinals])])
  }, [])

  // Esc clears a selection (not while typing or inside a dialog).
  useEffect(() => {
    if (selection.length === 0) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof Element && target.closest('[role="dialog"]') !== null)
      ) {
        return
      }
      setSelection([])
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selection.length])

  const activeFilterCount = countActiveFilters(filters)

  const zoomTo = useCallback((featureOrdinals: number[]) => {
    setZoomRequest((previous) => ({ featureOrdinals, nonce: (previous?.nonce ?? 0) + 1 }))
  }, [])

  const selectAndZoom = useCallback(
    (featureOrdinal: number) => {
      setSelection([featureOrdinal])
      zoomTo([featureOrdinal])
    },
    [zoomTo],
  )

  const handleRetry = useCallback(() => setReloadNonce((nonce) => nonce + 1), [])

  const handleDevLogin = useCallback((identityKey: string) => {
    void devLogin(identityKey)
      .catch(() => undefined)
      .finally(() => setReloadNonce((nonce) => nonce + 1))
  }, [])

  const handleToggleSidebar = useCallback(() => {
    if (mapFocus) {
      setMapFocus(false)
      setSidebarCollapsed(false)
      return
    }
    setSidebarCollapsed((collapsed) => !collapsed)
  }, [mapFocus])

  const handleToggleMapFocus = useCallback(() => {
    setMapFocus((focused) => !focused)
    setSidebarOpen(false)
  }, [])

  if (phase.status === 'loading') {
    return <LoadingView step={phase.step} />
  }

  if (phase.status === 'signed-out') {
    return <SignedOutView onDevLogin={handleDevLogin} />
  }

  if (phase.status === 'forbidden') {
    return <ForbiddenView />
  }

  if (phase.status === 'no-snapshot') {
    return <NoSnapshotView onRetry={handleRetry} canUpload={canUpload(role)} />
  }

  if (phase.status === 'error') {
    return <ErrorView message={phase.message} onRetry={handleRetry} />
  }

  const { snapshot, summary, comparison, previewOf } = phase
  const previewing = versionId !== null && previewOf !== null
  // Reports are built on the published base, so a preview offers no «Agregar».
  const canAddToReport = canUpload(role) && !previewing

  return (
    <div className={`app${mapFocus ? ' app--map-focus' : ''}`}>
      <Header
        active={ROUTES.mapa}
        role={role}
        snapshot={snapshot}
        preview={previewing}
      />
      {previewing ? (
        <div className="preview-banner" role="status">
          <span>
            Está viendo la versión N.º {snapshot.shapefile_snapshot_id}, que <b>no</b> es la
            versión publicada. Los demás usuarios siguen viendo la versión N.º {previewOf}.
          </span>
          <a
            className="preview-banner__link"
            href={mapPath()}
            onClick={(event) => onLinkClick(event, mapPath())}
          >
            Ver la versión publicada
          </a>
        </div>
      ) : null}
      <div className="app__body">
        <button
          type="button"
          className="app__sidebar-toggle"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          {sidebarOpen ? 'Cerrar filtros' : 'Buscar y filtrar'}
          {activeFilterCount > 0 ? (
            <span className="app__filter-count">{activeFilterCount}</span>
          ) : null}
        </button>

        <aside
          className={`app__sidebar${sidebarOpen ? ' app__sidebar--open' : ''}${
            sidebarCollapsed ? ' app__sidebar--collapsed' : ''
          }`}
        >
          <FiltersPanel
            collection={phase.collection}
            filters={filters}
            onFiltersChange={setFilters}
            filteredStats={filteredStats}
            onAddFilteredToReport={
              canAddToReport
                ? () =>
                    setAddToReport(
                      filteredFeatures.map((feature) => feature.properties.feature_ordinal),
                    )
                : undefined
            }
          />
          {encoding !== null ? (
            <LegendPanel
              encoding={encoding}
              colorDimension={colorDimension}
              onColorDimensionChange={setColorDimension}
              filters={filters}
              onFiltersChange={setFilters}
            />
          ) : null}
        </aside>

        <main className="app__map" aria-label="Mapa del patrimonio">
          <MapView
            collection={phase.collection}
            filteredFeatures={filteredFeatures}
            encoding={encoding}
            selectedOrdinals={selection}
            onSelect={handleSelect}
            onSelectMany={handleSelectMany}
            zoomRequest={zoomRequest}
            fitNonce={fitNonce}
            onFitToResults={() => setFitNonce((nonce) => nonce + 1)}
            sidebarCollapsed={sidebarCollapsed}
            mapFocus={mapFocus}
            activeFilterCount={activeFilterCount}
            onToggleSidebar={handleToggleSidebar}
            onToggleMapFocus={handleToggleMapFocus}
          />
          <ActiveFilterBar filters={filters} onFiltersChange={setFilters} />
        </main>

        {selectedFeature !== null ? (
          <Inspector
            key={selectedFeature.properties.feature_ordinal}
            snapshotId={snapshot.shapefile_snapshot_id}
            feature={selectedFeature}
            onClose={() => setSelection([])}
            onZoom={() => selectAndZoom(selectedFeature.properties.feature_ordinal)}
            onAddToReport={
              canAddToReport
                ? () => setAddToReport([selectedFeature.properties.feature_ordinal])
                : undefined
            }
          />
        ) : null}
        {selectedFeatures.length > 1 ? (
          <SelectionPanel
            features={selectedFeatures}
            onClear={() => setSelection([])}
            onZoom={() => zoomTo(selection)}
            onSelectOne={selectAndZoom}
            onAddToReport={canAddToReport ? () => setAddToReport(selection) : undefined}
          />
        ) : null}
      </div>

      <DataPanel
        collection={phase.collection}
        filteredFeatures={filteredFeatures}
        filteredStats={filteredStats}
        comparison={comparison}
        summary={summary}
        filters={filters}
        onFiltersChange={setFilters}
        selectedOrdinal={selectedOrdinal}
        onSelectFeature={selectAndZoom}
        snapshot={snapshot}
      />
      {addToReport !== null ? (
        <AddToReportDialog
          snapshotId={snapshot.shapefile_snapshot_id}
          ordinals={addToReport}
          onClose={() => setAddToReport(null)}
        />
      ) : null}
    </div>
  )
}
