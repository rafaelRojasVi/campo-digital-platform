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

const numberFormatter = new Intl.NumberFormat('es-CL')
const surfaceFormatter = new Intl.NumberFormat('es-CL', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
})

function formatStatuses(statuses: string[]): string {
  if (statuses.length === 0) return 'Sin estado'
  if (statuses.length === 1) return statuses[0]
  return `Múltiples (${statuses.join(', ')})`
}

function App() {
  const [summary, setSummary] = useState<TranselecSummary | null>(null)
  const [filters, setFilters] = useState<TranselecFilterOptions | null>(null)
  const [pmfs, setPmfs] = useState<PmfListItem[] | null>(null)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sector, setSector] = useState('')
  const [empresa, setEmpresa] = useState('')

  const [selectedPmf, setSelectedPmf] = useState<string | null>(null)
  const [pmfDetail, setPmfDetail] = useState<PmfDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    Promise.all([getSummary(), getFilters()])
      .then(([summaryResult, filtersResult]) => {
        if (cancelled) return
        setSummary(summaryResult)
        setFilters(filtersResult)
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

    const handle = setTimeout(() => {
      listPmfs({
        search: search.trim() || undefined,
        status: status || undefined,
        sector: sector || undefined,
        empresa: empresa || undefined,
      })
        .then((result) => {
          if (!cancelled) setPmfs(result)
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Error desconocido')
          }
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [search, status, sector, empresa, refreshToken])

  useEffect(() => {
    if (selectedPmf === null) return

    let cancelled = false

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
  }, [selectedPmf])

  const handleRefresh = () => {
    setLoading(true)
    setError(null)
    setRefreshToken((token) => token + 1)
  }

  const handleSelectPmf = (pmf: string) => {
    setSelectedPmf(pmf)
    setPmfDetail(null)
    setDetailError(null)
    setLoadingDetail(true)
  }

  const handleCloseDetail = () => {
    setSelectedPmf(null)
    setPmfDetail(null)
    setDetailError(null)
    setLoadingDetail(false)
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Transelec — Estado de Trámites</h1>
        <button type="button" className="refresh-button" onClick={handleRefresh}>
          Actualizar
        </button>
      </header>

      {error && (
        <div className="banner banner-error">
          <strong>Fuente no disponible.</strong> No fue posible leer el
          archivo fuente de Transelec. Verifique que esté disponible e
          intente nuevamente.
          <div className="banner-detail">{error}</div>
        </div>
      )}

      {loading && !error && <p className="status-line">Cargando…</p>}

      {summary && !error && (
        <section className="kpi-grid">
          <article className="kpi-card">
            <span className="kpi-value">{numberFormatter.format(summary.distinct_pmf)}</span>
            <span className="kpi-label">PMFs totales</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-value">
              {numberFormatter.format(summary.distinct_provisional_predio_ids)}
            </span>
            <span className="kpi-label">Predios provisionales</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-value">{numberFormatter.format(summary.business_rows)}</span>
            <span className="kpi-label">Filas de fuente vigentes</span>
          </article>
          <article className="kpi-card">
            <span className="kpi-value">{surfaceFormatter.format(summary.surface_total)}</span>
            <span className="kpi-label">Superficie total de corta (ha)</span>
          </article>
        </section>
      )}

      {!error && (
        <section className="controls">
          <input
            type="search"
            placeholder="Buscar PMF, predio o rol…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Estado (todos)</option>
            {filters?.statuses.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select value={sector} onChange={(event) => setSector(event.target.value)}>
            <option value="">Sector (todos)</option>
            {filters?.sectors.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select value={empresa} onChange={(event) => setEmpresa(event.target.value)}>
            <option value="">Empresa (todas)</option>
            {filters?.empresas.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </section>
      )}

      {pmfs && !error && (
        <section className="pmf-table-wrapper">
          <table className="pmf-table">
            <thead>
              <tr>
                <th>PMF</th>
                <th>Predios</th>
                <th>Filas</th>
                <th>Sector</th>
                <th>Empresa</th>
                <th>Estado</th>
                <th>Superficie (ha)</th>
              </tr>
            </thead>
            <tbody>
              {pmfs.map((item) => (
                <tr
                  key={item.pmf}
                  className={item.pmf === selectedPmf ? 'selected-row' : undefined}
                  onClick={() => handleSelectPmf(item.pmf)}
                >
                  <td>{item.pmf}</td>
                  <td>{item.predio_count}</td>
                  <td>{item.row_count}</td>
                  <td>{item.sectors.join(', ') || '—'}</td>
                  <td>{item.empresas.join(', ') || '—'}</td>
                  <td>{formatStatuses(item.statuses)}</td>
                  <td>
                    {item.surface_total === null
                      ? '—'
                      : surfaceFormatter.format(item.surface_total)}
                  </td>
                </tr>
              ))}
              {pmfs.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-row">
                    No hay PMFs que coincidan con la búsqueda/filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {selectedPmf && (
        <section className="pmf-detail">
          <div className="pmf-detail-header">
            <h2>Detalle PMF {selectedPmf}</h2>
            <button type="button" onClick={handleCloseDetail}>
              Cerrar detalle
            </button>
          </div>

          {loadingDetail && <p className="status-line">Cargando detalle…</p>}

          {detailError && (
            <div className="banner banner-error">
              No fue posible cargar el detalle de este PMF.
              <div className="banner-detail">{detailError}</div>
            </div>
          )}

          {pmfDetail && !loadingDetail && !detailError && (
            <>
              <p className="pmf-detail-summary">
                {pmfDetail.row_count} filas de fuente · Estado:{' '}
                {formatStatuses(pmfDetail.statuses)}
              </p>

              {pmfDetail.predios.map((group) => (
                <div key={group.provisional_predio_id ?? '__sin_id__'} className="predio-group">
                  <h3>
                    {group.provisional_predio_id ?? 'Sin ID_Predo_Unico (provisional)'}
                  </h3>
                  <table className="predio-table">
                    <thead>
                      <tr>
                        <th>N° Área de Corta</th>
                        <th>Estado</th>
                        <th>Estado resumido</th>
                        <th>Superficie (ha)</th>
                        <th>N° Ingreso</th>
                        <th>Fecha ingreso</th>
                        <th>Rol</th>
                        <th>Trámite</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={row.source_row_number}>
                          <td>{row.numero_area_corta ?? '—'}</td>
                          <td>{row.estado ?? '—'}</td>
                          <td>{row.estado_resumido ?? '—'}</td>
                          <td>
                            {row.superficie_corta === null
                              ? '—'
                              : surfaceFormatter.format(row.superficie_corta)}
                          </td>
                          <td>{row.numero_ingreso ?? '—'}</td>
                          <td>{row.fecha_ingreso ?? '—'}</td>
                          <td>{row.rol ?? '—'}</td>
                          <td>{row.tramite ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          )}
        </section>
      )}
    </div>
  )
}

export default App
