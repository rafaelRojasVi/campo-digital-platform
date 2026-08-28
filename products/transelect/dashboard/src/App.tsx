import { useEffect, useMemo, useRef, useState } from 'react'
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
import { MultiSelectField } from './MultiSelectField'

const numberFormatter = new Intl.NumberFormat('es-CL')
const surfaceFormatter = new Intl.NumberFormat('es-CL', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
})
const dateFormatter = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed)
}

function statusTone(status: string): string {
  const normalized = status.toLocaleLowerCase('es-CL')
  if (normalized.includes('aprobad') || normalized.includes('finaliz')) return 'positive'
  if (normalized.includes('rechaz')) return 'negative'
  if (normalized.includes('observ') || normalized.includes('reingres')) return 'warning'
  if (normalized.includes('tramit') || normalized.includes('revis')) return 'info'
  return 'neutral'
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6v5h-5M4 18v-5h5" />
      <path d="M6.1 9A7 7 0 0 1 18 6.8L20 11M4 13l2 4.2A7 7 0 0 0 17.9 15" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5V20h14v-5.5" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="7" ry="3" />
      <path d="M5 5v7c0 1.66 3.13 3 7 3s7-1.34 7-3V5M5 12v7c0 1.66 3.13 3 7 3s7-1.34 7-3v-7" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5M5 18.5V20h14v-1.5" />
    </svg>
  )
}

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9V4h12v5M6 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1M6 14h12v6H6z" />
    </svg>
  )
}

function StatusPills({
  statuses,
  compact = false,
}: {
  statuses: string[]
  compact?: boolean
}) {
  if (statuses.length === 0) {
    return <span className="status-pill neutral">Sin estado</span>
  }

  return (
    <div className={`status-pills${compact ? ' compact' : ''}`}>
      {statuses.map((status) => (
        <span key={status} className={`status-pill ${statusTone(status)}`}>
          <span className="status-dot" />
          {status}
        </span>
      ))}
    </div>
  )
}

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

  const activeSnapshot = useMemo(
    () => snapshots.find((snapshot) => snapshot.active) ?? null,
    [snapshots],
  )

  const totalStatusRows = useMemo(
    () =>
      summary?.status_breakdown.reduce((total, [, count]) => total + count, 0) ??
      0,
    [summary],
  )

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
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>Campo Digital</strong>
            <span>Transelec</span>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="source-health">
            <span className={`health-dot ${error ? 'offline' : 'online'}`} />
            <span>{error ? 'Fuente no disponible' : 'Datos disponibles'}</span>
          </div>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setManagerOpen(true)}
          >
            <DatabaseIcon />
            <span>Gestionar fuente</span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={refreshAll}
            aria-label="Actualizar datos"
            title="Actualizar datos"
          >
            <RefreshIcon />
          </button>
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">Control de tramitación</div>
            <h1>Estado operativo de PMF y predios</h1>
            <p>
              Una vista única para consultar avance, superficie y antecedentes
              de cada PMF sin alterar la información de origen.
            </p>
          </div>

          <div className="source-card">
            <div className="source-card-icon">
              <DatabaseIcon />
            </div>
            <div className="source-card-copy">
              <span className="source-card-label">Fuente actual</span>
              <strong>
                {activeSnapshot?.filename ??
                  (snapshotHistoryAvailable ? 'Sin versión publicada' : 'Planilla local')}
              </strong>
              <span>
                {activeSnapshot
                  ? `Publicada ${formatDate(activeSnapshot.created_at)}`
                  : snapshotHistoryAvailable
                    ? 'Use “Gestionar fuente” para publicar una planilla'
                    : 'Modo de desarrollo · lectura directa'}
              </span>
            </div>
            {activeSnapshot && <span className="current-badge">Activa</span>}
          </div>
        </section>

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

        <section className="kpi-grid" aria-label="Indicadores principales">
          <article className="kpi-card primary">
            <div className="kpi-topline">
              <span>PMF</span>
              <span className="kpi-index">01</span>
            </div>
            <strong className="kpi-value">
              {summary ? numberFormatter.format(summary.distinct_pmf) : '—'}
            </strong>
            <span className="kpi-label">PMF con registros vigentes</span>
          </article>

          <article className="kpi-card">
            <div className="kpi-topline">
              <span>Predios</span>
              <span className="kpi-index">02</span>
            </div>
            <strong className="kpi-value">
              {summary
                ? numberFormatter.format(summary.distinct_provisional_predio_ids)
                : '—'}
            </strong>
            <span className="kpi-label">Identificadores provisionales</span>
          </article>

          <article className="kpi-card">
            <div className="kpi-topline">
              <span>Superficie</span>
              <span className="kpi-index">03</span>
            </div>
            <strong className="kpi-value">
              {summary ? surfaceFormatter.format(summary.surface_total) : '—'}
              <small>ha</small>
            </strong>
            <span className="kpi-label">Superficie de corta registrada</span>
          </article>

          <article className="kpi-card">
            <div className="kpi-topline">
              <span>Registros</span>
              <span className="kpi-index">04</span>
            </div>
            <strong className="kpi-value">
              {summary ? numberFormatter.format(summary.business_rows) : '—'}
            </strong>
            <span className="kpi-label">Filas operativas en la fuente</span>
          </article>

          <article className="kpi-card">
            <div className="kpi-topline">
              <span>Roles</span>
              <span className="kpi-index">05</span>
            </div>
            <strong className="kpi-value">
              {summary ? numberFormatter.format(summary.distinct_roles) : '—'}
            </strong>
            <span className="kpi-label">Roles de propiedad distintos</span>
          </article>
        </section>

        <section className="content-grid">
          <article className="panel status-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">Distribución</span>
                <h2>Estados registrados</h2>
              </div>
              <span className="panel-note">Por fila de fuente</span>
            </div>

            <div className="status-breakdown">
              {summary?.status_breakdown.map(([statusName, count]) => {
                const percentage =
                  totalStatusRows === 0 ? 0 : Math.round((count / totalStatusRows) * 100)

                return (
                  <div className="status-breakdown-row" key={statusName}>
                    <div className="status-breakdown-meta">
                      <span>
                        <span className={`status-dot ${statusTone(statusName)}`} />
                        {statusName}
                      </span>
                      <strong>{numberFormatter.format(count)}</strong>
                    </div>
                    <div className="status-track">
                      <span style={{ width: `${Math.max(2, percentage)}%` }} />
                    </div>
                  </div>
                )
              })}
              {!summary && (
                <div className="skeleton-stack" aria-label="Cargando estados">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              )}
              {summary?.status_breakdown.length === 0 && (
                <div className="empty-compact">No hay estados informados.</div>
              )}
            </div>
          </article>

          <article className="panel dataset-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">Control de fuente</span>
                <h2>Versión publicada</h2>
              </div>
            </div>

            <div className="dataset-summary">
              <div className="dataset-file-icon">
                <span>XLSX</span>
              </div>
              <div>
                <strong>
                  {activeSnapshot?.filename ??
                    (snapshotHistoryAvailable
                      ? 'Sin planilla publicada'
                      : 'Fuente de desarrollo')}
                </strong>
                <span>
                  {activeSnapshot
                    ? `${formatBytes(activeSnapshot.byte_size)} · versión #${activeSnapshot.source_snapshot_id}`
                    : snapshotHistoryAvailable
                      ? 'Publique una planilla para comenzar'
                      : 'Sin historial persistido disponible'}
                </span>
              </div>
            </div>

            <div className="dataset-metrics">
              <div>
                <span>Versiones</span>
                <strong>{snapshotHistoryAvailable ? snapshots.length : '—'}</strong>
              </div>
              <div>
                <span>Última publicación</span>
                <strong>
                  {activeSnapshot ? formatDate(activeSnapshot.created_at).split(',')[0] : '—'}
                </strong>
              </div>
            </div>

            <button
              type="button"
              className="button button-dark full-width"
              onClick={() => setManagerOpen(true)}
            >
              Ver historial y actualizar
              <ChevronIcon />
            </button>
          </article>
        </section>

        <section className="records-section">
          <div className="records-heading">
            <div>
              <span className="section-kicker">Explorador</span>
              <h2>PMF registrados</h2>
            </div>
            <div className="records-heading-actions">
              <span className="record-count">
                {pmfs ? `${numberFormatter.format(pmfs.length)} resultados` : 'Cargando…'}
              </span>
              <button
                type="button"
                className="button button-secondary compact no-print"
                onClick={exportCsv}
                disabled={!pmfs || pmfs.length === 0}
              >
                <DownloadIcon />
                <span>Exportar CSV</span>
              </button>
              <button
                type="button"
                className="button button-secondary compact no-print"
                onClick={() => window.print()}
              >
                <PrintIcon />
                <span>Imprimir</span>
              </button>
            </div>
          </div>

          <div className="filter-bar no-print">
            <label className="search-field">
              <SearchIcon />
              <input
                type="search"
                placeholder="Buscar por PMF, predio o rol"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Limpiar búsqueda"
                >
                  <CloseIcon />
                </button>
              )}
            </label>

            <div className="select-group">
              <MultiSelectField
                label="Estado resumido"
                options={filters?.statuses ?? []}
                selected={status}
                onChange={setStatus}
              />
              <MultiSelectField
                label="Sector"
                options={filters?.sectors ?? []}
                selected={sector}
                onChange={setSector}
              />
              <MultiSelectField
                label="Empresa"
                options={filters?.empresas ?? []}
                selected={empresa}
                onChange={setEmpresa}
              />
              <MultiSelectField
                label="PAS"
                options={filters?.pas ?? []}
                selected={pas}
                onChange={setPas}
              />
              <MultiSelectField
                label="Tipo de propietario"
                options={filters?.tipos_propietario ?? []}
                selected={tipoPropietario}
                onChange={setTipoPropietario}
                placeholderAll="Todos"
              />
            </div>

            {filtersActive && (
              <button type="button" className="clear-filters" onClick={clearFilters}>
                Limpiar filtros
              </button>
            )}
          </div>

          <div className="table-card">
            <div className={`table-loading-line${listLoading ? ' visible' : ''}`} />
            <div className="table-scroll">
              <table className="pmf-table">
                <thead>
                  <tr>
                    <th>PMF</th>
                    <th>Estado</th>
                    <th>Predios</th>
                    <th>Sector</th>
                    <th>Empresa</th>
                    <th className="numeric">Superficie</th>
                    <th className="row-action" aria-label="Abrir detalle" />
                  </tr>
                </thead>
                <tbody>
                  {pmfs?.map((item) => (
                    <tr key={item.pmf}>
                      <td>
                        <button
                          type="button"
                          className="pmf-name"
                          onClick={() => setSelectedPmf(item.pmf)}
                        >
                          {item.pmf}
                        </button>
                        <span className="mobile-meta">{item.predio_count} predios</span>
                      </td>
                      <td>
                        <StatusPills statuses={item.statuses} compact />
                      </td>
                      <td>{numberFormatter.format(item.predio_count)}</td>
                      <td>{item.sectors.join(', ') || '—'}</td>
                      <td>{item.empresas.join(', ') || '—'}</td>
                      <td className="numeric">
                        {item.surface_total === null
                          ? '—'
                          : `${surfaceFormatter.format(item.surface_total)} ha`}
                      </td>
                      <td className="row-action">
                        <button
                          type="button"
                          onClick={() => setSelectedPmf(item.pmf)}
                          aria-label={`Abrir detalle de ${item.pmf}`}
                        >
                          <ChevronIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!listLoading && pmfs?.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <div className="empty-state">
                          <SearchIcon />
                          <strong>No encontramos PMF con esos filtros.</strong>
                          <span>Pruebe cambiando la búsqueda o limpiando los filtros.</span>
                          <button type="button" onClick={clearFilters}>
                            Limpiar filtros
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {(loading || (listLoading && !pmfs)) && (
                <div className="table-skeleton" aria-label="Cargando PMF">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {selectedPmf && (
        <div className="overlay" role="presentation" onMouseDown={() => setSelectedPmf(null)}>
          <aside
            className="detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Detalle PMF ${selectedPmf}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drawer-header">
              <div>
                <span className="section-kicker">Ficha operativa</span>
                <h2>{selectedPmf}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setSelectedPmf(null)}
                aria-label="Cerrar detalle"
              >
                <CloseIcon />
              </button>
            </div>

            {loadingDetail && (
              <div className="drawer-loading">
                <span />
                <span />
                <span />
              </div>
            )}

            {detailError && (
              <div className="alert alert-error">
                <div>
                  <strong>No se pudo cargar este PMF.</strong>
                  <span>{detailError}</span>
                </div>
              </div>
            )}

            {pmfDetail && !loadingDetail && !detailError && (
              <>
                <div className="detail-summary-grid">
                  <div>
                    <span>Predios</span>
                    <strong>{numberFormatter.format(pmfDetail.predios.length)}</strong>
                  </div>
                  <div>
                    <span>Registros</span>
                    <strong>{numberFormatter.format(pmfDetail.row_count)}</strong>
                  </div>
                </div>

                <div className="detail-status">
                  <span>Estados presentes en el PMF</span>
                  <StatusPills statuses={pmfDetail.statuses} />
                  {pmfDetail.statuses.length > 1 && (
                    <p>
                      Se muestran todos los estados existentes. No se aplica una
                      precedencia automática entre ellos.
                    </p>
                  )}
                </div>

                <div className="predio-list">
                  {pmfDetail.predios.map((group, predioIndex) => (
                    <article
                      className="predio-card"
                      key={group.provisional_predio_id ?? `sin-id-${predioIndex}`}
                    >
                      <div className="predio-card-header">
                        <div>
                          <span>Predio {predioIndex + 1}</span>
                          <strong>
                            {group.provisional_predio_id ?? 'Sin ID_Predo_Unico'}
                          </strong>
                        </div>
                        <span>{group.rows.length} área{group.rows.length === 1 ? '' : 's'}</span>
                      </div>

                      <div className="area-list">
                        {group.rows.map((row) => (
                          <div className="area-row" key={row.source_row_number}>
                            <div className="area-row-top">
                              <strong>
                                Área de corta {row.numero_area_corta ?? 'sin número'}
                              </strong>
                              <span>
                                {row.superficie_corta === null
                                  ? 'Superficie s/i'
                                  : `${surfaceFormatter.format(row.superficie_corta)} ha`}
                              </span>
                            </div>
                            <StatusPills
                              statuses={
                                row.estado_resumido ? [row.estado_resumido] : []
                              }
                              compact
                            />
                            <dl>
                              <div>
                                <dt>Estado detalle</dt>
                                <dd>{row.estado ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>N° ingreso</dt>
                                <dd>{row.numero_ingreso ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Fecha ingreso</dt>
                                <dd>{row.fecha_ingreso ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Rol</dt>
                                <dd>{row.rol ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Trámite</dt>
                                <dd>{row.tramite ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Sector</dt>
                                <dd>{row.sector ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Empresa</dt>
                                <dd>{row.empresa ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>PAS</dt>
                                <dd>{row.pas ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Tipo de propietario</dt>
                                <dd>{row.tipo_propietario ?? '—'}</dd>
                              </div>
                            </dl>
                            <span className="source-row">
                              Fila de origen {row.source_row_number}
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {managerOpen && (
        <div className="overlay manager-overlay" role="presentation" onMouseDown={() => setManagerOpen(false)}>
          <section
            className="manager-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manager-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="manager-header">
              <div>
                <span className="section-kicker">Administración</span>
                <h2 id="manager-title">Fuente de datos Transelec</h2>
                <p>
                  Publique una planilla validada o vuelva a una versión anterior.
                  El tablero cambia solo después de una validación completa.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setManagerOpen(false)}
                aria-label="Cerrar administrador"
              >
                <CloseIcon />
              </button>
            </div>

            {!snapshotHistoryAvailable ? (
              <div className="local-mode-card">
                <DatabaseIcon />
                <div>
                  <strong>Historial no disponible en este entorno</strong>
                  <span>
                    El tablero está leyendo una fuente local. La publicación de
                    versiones requiere la base de datos del piloto alojado.
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="publish-card">
                  <div className="publish-copy">
                    <span className="step-number">01</span>
                    <div>
                      <strong>Publicar nueva versión</strong>
                      <span>
                        Acepta .xlsx o .xlsm hasta 64 MB. Si el contenido es
                        idéntico, no se crea otra versión.
                      </span>
                    </div>
                  </div>

                  <label className={`drop-zone${selectedFile ? ' has-file' : ''}`}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xlsm"
                      onChange={(event) =>
                        handleFileChange(event.target.files?.[0] ?? null)
                      }
                    />
                    <UploadIcon />
                    <div>
                      <strong>
                        {selectedFile ? selectedFile.name : 'Seleccionar planilla'}
                      </strong>
                      <span>
                        {selectedFile
                          ? formatBytes(selectedFile.size)
                          : 'Excel · validación antes de publicar'}
                      </span>
                    </div>
                    <span className="choose-file">
                      {selectedFile ? 'Cambiar' : 'Examinar'}
                    </span>
                  </label>

                  <div className="admin-row">
                    <label className="admin-token-field">
                      <span>Clave de administración</span>
                      <input
                        type="password"
                        value={adminToken}
                        autoComplete="off"
                        placeholder="Ingrese la clave"
                        onChange={(event) => {
                          setAdminToken(event.target.value)
                          setAdminError(null)
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={uploading || !selectedFile}
                      onClick={handlePublish}
                    >
                      {uploading ? 'Procesando…' : 'Validar y publicar'}
                    </button>
                  </div>

                  {adminMessage && (
                    <div className="inline-message success">{adminMessage}</div>
                  )}
                  {adminError && (
                    <div className="inline-message error">{adminError}</div>
                  )}
                </div>

                <div className="history-section">
                  <div className="history-heading">
                    <div>
                      <span className="step-number">02</span>
                      <div>
                        <strong>Historial de versiones</strong>
                        <span>{snapshots.length} versión{snapshots.length === 1 ? '' : 'es'} validada{snapshots.length === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="icon-button small"
                      onClick={refreshAll}
                      aria-label="Actualizar historial"
                    >
                      <RefreshIcon />
                    </button>
                  </div>

                  <div className="history-list">
                    {snapshots.map((snapshot) => (
                      <article
                        className={`history-item${snapshot.active ? ' active' : ''}`}
                        key={snapshot.source_snapshot_id}
                      >
                        <div className="history-file">
                          <div className="file-type">XLSX</div>
                          <div>
                            <div className="history-title-row">
                              <strong>{snapshot.filename}</strong>
                              {snapshot.active && (
                                <span className="current-badge">Activa</span>
                              )}
                            </div>
                            <span>
                              {formatDate(snapshot.created_at)} · {formatBytes(snapshot.byte_size)}
                            </span>
                          </div>
                        </div>

                        <div className="history-stats">
                          <span><strong>{snapshot.distinct_pmf}</strong> PMF</span>
                          <span><strong>{snapshot.distinct_provisional_predio_ids}</strong> predios</span>
                          <span><strong>{surfaceFormatter.format(snapshot.surface_total)}</strong> ha</span>
                        </div>

                        <div className="history-action">
                          {snapshot.active ? (
                            <span className="active-label">En uso</span>
                          ) : restoreCandidate === snapshot.source_snapshot_id ? (
                            <div className="restore-confirm">
                              <span>¿Restaurar esta versión?</span>
                              <button
                                type="button"
                                disabled={uploading}
                                onClick={() => handleRestore(snapshot.source_snapshot_id)}
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                onClick={() => setRestoreCandidate(null)}
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="restore-button"
                              onClick={() => handleRestore(snapshot.source_snapshot_id)}
                            >
                              Restaurar
                            </button>
                          )}
                        </div>
                      </article>
                    ))}

                    {snapshots.length === 0 && (
                      <div className="history-empty">
                        <DatabaseIcon />
                        <strong>Aún no hay versiones publicadas.</strong>
                        <span>La primera planilla validada aparecerá aquí.</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default App
