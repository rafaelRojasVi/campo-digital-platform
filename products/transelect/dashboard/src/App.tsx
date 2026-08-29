import { useEffect, useRef, useState } from 'react'
import './App.css'
import {
  activateSnapshot,
  getFilters,
  getPmfDetail,
  getSnapshots,
  getSummary,
  listPmfs,
  publishWorkbook,
  type PmfDetail,
  type PmfListItem,
  type TranselecFilterOptions,
  type TranselecSnapshotRecord,
  type TranselecSummary,
} from './api'
import { AppHeader } from './components/AppHeader'
import { ExecutiveKpis } from './components/ExecutiveKpis'
import { FilterPanel } from './components/FilterPanel'
import { PmfDetailDrawer } from './components/PmfDetailDrawer'
import { PmfExplorer } from './components/PmfExplorer'
import { SourceManager } from './components/SourceManager'
import { SourceStatusCard } from './components/SourceStatusCard'
import { StatusDistribution } from './components/StatusDistribution'
import { QuickActions } from './components/QuickActions'
import { ViewSummaryPanel } from './components/ViewSummaryPanel'
import { surfaceFormatter } from './components/format'

function App() {
  const [summary, setSummary] = useState<TranselecSummary | null>(null)
  const [filters, setFilters] = useState<TranselecFilterOptions | null>(null)
  const [pmfs, setPmfs] = useState<PmfListItem[] | null>(null)
  const [snapshots, setSnapshots] = useState<TranselecSnapshotRecord[]>([])
  const [snapshotHistoryAvailable, setSnapshotHistoryAvailable] = useState(true)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string[]>([])
  const [sector, setSector] = useState<string[]>([])
  const [empresa, setEmpresa] = useState<string[]>([])
  const [pas, setPas] = useState<string[]>([])
  const [tipoPropietario, setTipoPropietario] = useState<string[]>([])

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const [selectedPmf, setSelectedPmf] = useState<string | null>(null)
  const [pmfDetail, setPmfDetail] = useState<PmfDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const [loading, setLoading] = useState(true)
  const [listLoading, setListLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const [managerOpen, setManagerOpen] = useState(false)
  const [adminToken, setAdminToken] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [adminMessage, setAdminMessage] = useState<string | null>(null)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [restoreCandidate, setRestoreCandidate] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const statusSectionRef = useRef<HTMLElement>(null)

  const activeSnapshot =
    snapshots.find((snapshot) => snapshot.active) ?? null

  const filtersActive = Boolean(
    search ||
      status.length ||
      sector.length ||
      empresa.length ||
      pas.length ||
      tipoPropietario.length,
  )

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    getFilters()
      .then((filtersResult) => {
        if (cancelled) return
        setFilters(filtersResult)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error desconocido')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    getSnapshots()
      .then((result) => {
        if (cancelled) return
        setSnapshots(result)
        setSnapshotHistoryAvailable(true)
      })
      .catch(() => {
        if (cancelled) return
        setSnapshots([])
        setSnapshotHistoryAvailable(false)
      })

    return () => {
      cancelled = true
    }
  }, [refreshToken])

  useEffect(() => {
    let cancelled = false
    setListLoading(true)

    const handle = window.setTimeout(() => {
      const activeFilters = {
        search: search.trim() || undefined,
        status,
        sector,
        empresa,
        pas,
        tipoPropietario,
      }

      // KPIs and the PMF table always share the same active filters.
      Promise.all([listPmfs(activeFilters), getSummary(activeFilters)])
        .then(([pmfsResult, summaryResult]) => {
          if (!cancelled) {
            setPmfs(pmfsResult)
            setSummary(summaryResult)
            setError(null)
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Error desconocido')
          }
        })
        .finally(() => {
          if (!cancelled) setListLoading(false)
        })
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [search, status, sector, empresa, pas, tipoPropietario, refreshToken])

  // A manual refresh keeps the reader's place; an actual filter/search change
  // starts back at page 1 since the result set is effectively a new list.
  useEffect(() => {
    setPage(1)
  }, [search, status, sector, empresa, pas, tipoPropietario])

  useEffect(() => {
    if (selectedPmf === null) return

    let cancelled = false
    setLoadingDetail(true)
    setPmfDetail(null)
    setDetailError(null)

    getPmfDetail(selectedPmf)
      .then((detail) => {
        if (!cancelled) setPmfDetail(detail)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDetailError(err instanceof Error ? err.message : 'Error desconocido')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedPmf, refreshToken])

  useEffect(() => {
    if (!managerOpen && selectedPmf === null) return

    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (managerOpen) setManagerOpen(false)
      else setSelectedPmf(null)
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [managerOpen, selectedPmf])

  const refreshAll = () => {
    setError(null)
    setRefreshToken((token) => token + 1)
  }

  const clearFilters = () => {
    setSearch('')
    setStatus([])
    setSector([])
    setEmpresa([])
    setPas([])
    setTipoPropietario([])
  }

  const handlePageSizeChange = (size: number) => {
    setPageSize(size)
    setPage(1)
  }

  const focusSearch = () => {
    searchInputRef.current?.focus()
  }

  const reviewStatuses = () => {
    statusSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    statusSectionRef.current?.focus({ preventScroll: true })
  }

  const exportCsv = () => {
    if (!pmfs || pmfs.length === 0) return

    const headers = [
      'PMF',
      'Estado(s)',
      'Predios',
      'Sector',
      'Empresa',
      'Superficie (ha)',
    ]

    const escapeCell = (value: string) => `"${value.replace(/"/g, '""')}"`

    const rows = pmfs.map((item) =>
      [
        item.pmf,
        item.statuses.join(' / '),
        String(item.predio_count),
        item.sectors.join(' / '),
        item.empresas.join(' / '),
        item.surface_total === null
          ? ''
          : surfaceFormatter.format(item.surface_total),
      ]
        .map(escapeCell)
        .join(','),
    )

    const csvContent = [headers.map(escapeCell).join(','), ...rows].join(
      '\r\n',
    )
    const blob = new Blob(['﻿', csvContent], {
      type: 'text/csv;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const timestamp = new Date().toISOString().slice(0, 10)

    link.href = url
    link.download = `transelec-pmf-${timestamp}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleFileChange = (file: File | null) => {
    setSelectedFile(file)
    setAdminMessage(null)
    setAdminError(null)
  }

  const handlePublish = async () => {
    if (!selectedFile) {
      setAdminError('Seleccione primero una planilla Excel.')
      return
    }
    if (!adminToken.trim()) {
      setAdminError('Ingrese la clave de administración para publicar.')
      return
    }

    setUploading(true)
    setAdminError(null)
    setAdminMessage(null)

    try {
      const result = await publishWorkbook(selectedFile, adminToken.trim())
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setAdminMessage(
        result.duplicate
          ? 'La planilla es idéntica a una versión existente. No se creó ni activó una copia.'
          : 'Planilla validada y publicada correctamente.',
      )
      refreshAll()
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'No fue posible publicar la planilla.')
    } finally {
      setUploading(false)
    }
  }

  const handleRestore = async (snapshotId: number) => {
    if (restoreCandidate !== snapshotId) {
      setRestoreCandidate(snapshotId)
      setAdminMessage(null)
      setAdminError(null)
      return
    }
    if (!adminToken.trim()) {
      setAdminError('Ingrese la clave de administración para restaurar una versión.')
      return
    }

    setUploading(true)
    setAdminError(null)
    setAdminMessage(null)

    try {
      await activateSnapshot(snapshotId, adminToken.trim())
      setRestoreCandidate(null)
      setAdminMessage('Versión restaurada. El tablero ya apunta a esta planilla.')
      refreshAll()
    } catch (err: unknown) {
      setAdminError(err instanceof Error ? err.message : 'No fue posible restaurar la versión.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="app-shell">
      <AppHeader
        sourceAvailable={!error}
        onManageSource={() => setManagerOpen(true)}
        onRefresh={refreshAll}
      />

      <main className="page">
        {error && (
          <div className="alert alert-error" role="alert">
            <div>
              <strong>No pudimos leer la fuente de Transelec.</strong>
              <span>
                El tablero mantiene la última vista cargada, pero no puede
                confirmar datos nuevos.
              </span>
            </div>
            <button type="button" className="text-button" onClick={refreshAll}>
              Reintentar
            </button>
          </div>
        )}

        <ExecutiveKpis summary={summary} />

        <section className="workspace-grid">
          <FilterPanel
            search={search}
            onSearchChange={setSearch}
            searchInputRef={searchInputRef}
            filters={filters}
            status={status}
            onStatusChange={setStatus}
            sector={sector}
            onSectorChange={setSector}
            empresa={empresa}
            onEmpresaChange={setEmpresa}
            pas={pas}
            onPasChange={setPas}
            tipoPropietario={tipoPropietario}
            onTipoPropietarioChange={setTipoPropietario}
            filtersActive={filtersActive}
            onClearFilters={clearFilters}
          />

          <div className="workspace-main">
            <StatusDistribution summary={summary} sectionRef={statusSectionRef} />

            <div className="workspace-secondary-grid">
              <SourceStatusCard
                activeSnapshot={activeSnapshot}
                snapshotHistoryAvailable={snapshotHistoryAvailable}
                snapshotsCount={snapshots.length}
                onManage={() => setManagerOpen(true)}
              />
              <ViewSummaryPanel summary={summary} />
            </div>

            <QuickActions
              onFocusSearch={focusSearch}
              onReviewStatuses={reviewStatuses}
              filtersActive={filtersActive}
              onClearFilters={clearFilters}
              onExportCsv={exportCsv}
              exportDisabled={!pmfs || pmfs.length === 0}
              onPrint={() => window.print()}
              onOpenHistory={() => setManagerOpen(true)}
            />
          </div>
        </section>

        <PmfExplorer
          pmfs={pmfs}
          listLoading={listLoading}
          loading={loading}
          onOpenPmf={setSelectedPmf}
          onClearFilters={clearFilters}
          onExportCsv={exportCsv}
          exportDisabled={!pmfs || pmfs.length === 0}
          onPrint={() => window.print()}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
        />
      </main>

      {selectedPmf && (
        <PmfDetailDrawer
          selectedPmf={selectedPmf}
          pmfDetail={pmfDetail}
          loadingDetail={loadingDetail}
          detailError={detailError}
          onClose={() => setSelectedPmf(null)}
        />
      )}

      {managerOpen && (
        <SourceManager
          onClose={() => setManagerOpen(false)}
          snapshotHistoryAvailable={snapshotHistoryAvailable}
          snapshots={snapshots}
          selectedFile={selectedFile}
          onFileChange={handleFileChange}
          fileInputRef={fileInputRef}
          adminToken={adminToken}
          onAdminTokenChange={(value) => {
            setAdminToken(value)
            setAdminError(null)
          }}
          uploading={uploading}
          onPublish={handlePublish}
          adminMessage={adminMessage}
          adminError={adminError}
          restoreCandidate={restoreCandidate}
          onRestoreClick={handleRestore}
          onCancelRestore={() => setRestoreCandidate(null)}
          onRefreshHistory={refreshAll}
        />
      )}
    </div>
  )
}

export default App
