import type { PmfListItem } from '../api'
import { numberFormatter, surfaceFormatter } from './format'
import { ChevronIcon, DownloadIcon, PrintIcon, SearchIcon } from './icons'
import { StatusPills } from './StatusPills'

interface PmfExplorerProps {
  pmfs: PmfListItem[] | null
  listLoading: boolean
  loading: boolean
  onOpenPmf: (pmf: string) => void
  onClearFilters: () => void
  onExportCsv: () => void
  exportDisabled: boolean
  onPrint: () => void
}

export function PmfExplorer({
  pmfs,
  listLoading,
  loading,
  onOpenPmf,
  onClearFilters,
  onExportCsv,
  exportDisabled,
  onPrint,
}: PmfExplorerProps) {
  return (
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
            onClick={onExportCsv}
            disabled={exportDisabled}
          >
            <DownloadIcon />
            <span>Exportar CSV</span>
          </button>
          <button
            type="button"
            className="button button-secondary compact no-print"
            onClick={onPrint}
          >
            <PrintIcon />
            <span>Imprimir</span>
          </button>
        </div>
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
                      onClick={() => onOpenPmf(item.pmf)}
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
                      onClick={() => onOpenPmf(item.pmf)}
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
                      <button type="button" onClick={onClearFilters}>
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
  )
}
