import { useEffect, useState } from 'react'
import './App.css'
import {
  getFilters,
  getPmfDetail,
  getSummary,
  listPmfs,
  type PmfDetail,
  type PmfListItem,
  type TranselecFilterOptions,
  type TranselecSummary,
} from './api'
import { DemoHeader } from './components/DemoHeader'
import { ExecutiveKpis } from './components/ExecutiveKpis'
import { FilterPanel } from './components/FilterPanel'
import { PmfDetailDrawer } from './components/PmfDetailDrawer'
import { PmfExplorer } from './components/PmfExplorer'
import { StatusDistribution } from './components/StatusDistribution'
import { surfaceFormatter } from './components/format'

function App() {
  const [summary, setSummary] = useState<TranselecSummary | null>(null)
  const [filters, setFilters] = useState<TranselecFilterOptions | null>(null)
  const [pmfs, setPmfs] = useState<PmfListItem[] | null>(null)

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

  const selectedPmfIndex =
    selectedPmf !== null ? (pmfs?.findIndex((item) => item.pmf === selectedPmf) ?? -1) : -1
  const hasPrevPmf = selectedPmfIndex > 0
  const hasNextPmf = selectedPmfIndex >= 0 && selectedPmfIndex < (pmfs?.length ?? 0) - 1
  const pmfPositionLabel =
    selectedPmfIndex >= 0 && pmfs ? `${selectedPmfIndex + 1} de ${pmfs.length}` : null

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
    if (selectedPmf === null) return

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedPmf(null)
        return
      }

      if (!pmfs) return
      // Don't hijack arrow keys while the user is typing/selecting elsewhere.
      const activeTag = document.activeElement?.tagName
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return

      const index = pmfs.findIndex((item) => item.pmf === selectedPmf)
      if (index < 0) return

      if (event.key === 'ArrowLeft' && index > 0) {
        setSelectedPmf(pmfs[index - 1].pmf)
      } else if (event.key === 'ArrowRight' && index < pmfs.length - 1) {
        setSelectedPmf(pmfs[index + 1].pmf)
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedPmf, pmfs])

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

  const goToPrevPmf = () => {
    if (hasPrevPmf && pmfs) setSelectedPmf(pmfs[selectedPmfIndex - 1].pmf)
  }

  const goToNextPmf = () => {
    if (hasNextPmf && pmfs) setSelectedPmf(pmfs[selectedPmfIndex + 1].pmf)
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

  return (
    <div className="app-shell">
      <div className="demo-banner" role="status">
        DEMO — DATOS DE DEMOSTRACIÓN. Los PMF y predios mostrados son sintéticos.
      </div>

      <DemoHeader />

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
            <StatusDistribution summary={summary} />

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
          </div>
        </section>
      </main>

      {selectedPmf && (
        <PmfDetailDrawer
          selectedPmf={selectedPmf}
          pmfDetail={pmfDetail}
          loadingDetail={loadingDetail}
          detailError={detailError}
          onClose={() => setSelectedPmf(null)}
          positionLabel={pmfPositionLabel}
          hasPrev={hasPrevPmf}
          hasNext={hasNextPmf}
          onPrev={goToPrevPmf}
          onNext={goToNextPmf}
        />
      )}
    </div>
  )
}

export default App
