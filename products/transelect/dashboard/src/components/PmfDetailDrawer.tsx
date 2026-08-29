import type { PmfDetail } from '../api'
import { numberFormatter, surfaceFormatter } from './format'
import { CloseIcon } from './icons'
import { StatusPills } from './StatusPills'

interface PmfDetailDrawerProps {
  selectedPmf: string
  pmfDetail: PmfDetail | null
  loadingDetail: boolean
  detailError: string | null
  onClose: () => void
}

export function PmfDetailDrawer({
  selectedPmf,
  pmfDetail,
  loadingDetail,
  detailError,
  onClose,
}: PmfDetailDrawerProps) {
  return (
    <div className="overlay" role="presentation" onMouseDown={onClose}>
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
            onClick={onClose}
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
                          statuses={row.estado_resumido ? [row.estado_resumido] : []}
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
  )
}
