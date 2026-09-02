/**
 * TR-FUNC-007 / 032 / 033 — the pending-priority zone.
 *
 * Everything here is computed by `GET /transelec/pending` under the current
 * filter state, using `pending_priority_legacy` (`isPendingPMF`: blank
 * `N Ingreso` OR raw `Estado` containing "rechaz"). That rule genuinely
 * disagrees with the `Estado resumido`-based approval counts in the KPI row
 * — the same PMF can be "En trámite" up there and "pendiente prioritario"
 * here. The matrix requires that divergence to be flagged in UI copy rather
 * than silently reconciled, which the note below does, alongside the two
 * basis identifiers.
 *
 * The three stage buckets come from the API's `pending_stage_legacy`
 * heuristic, which the matrix itself characterises as INFERENCE-quality and
 * not a confirmed CONAF taxonomy — stated in the copy, not implied.
 */
import type { TranselecPending } from '../api'
import { cell, formatInteger, formatNumber } from '../format'
import { PENDING_STAGE_ORDER, pendingStageLabel } from '../lib/pendingStage'
import { StatusPill } from './StatusPill'

export function PendingZone({
  pending,
  focused,
  onShowPending,
  onReset,
}: {
  pending: TranselecPending
  focused: boolean
  onShowPending: () => void
  onReset: () => void
}) {
  const maxStage = Math.max(
    1,
    ...PENDING_STAGE_ORDER.map((stage) => pending.stages[stage]),
  )

  return (
    <section
      id="pendingzone"
      className={`panel section pendingzone${focused ? ' focused' : ''}`}
      aria-labelledby="pending-title"
      data-testid="pending-zone"
    >
      <div className="pendinghead">
        <div>
          <h2 id="pending-title" style={{ marginBottom: 4 }}>
            PMF pendientes · control prioritario
          </h2>
          <p>
            Incluye PMF no presentados a CONAF y aquellos cuyo estado vigente indica rechazo
            (regla <span className="basis-tag">{pending.basis}</span>). Esta regla no es la misma
            que la de los indicadores «Aprobados» y «En trámite», por lo que un PMF puede aparecer
            en trámite arriba y como pendiente prioritario aquí.
          </p>
        </div>
        <div className="pendingtotal">
          <b data-testid="pending-count">
            {formatInteger(pending.pending_pmf_count)} de {formatInteger(pending.total_pmf_count)}
          </b>
          <span>
            {formatNumber(pending.pending_pmf_percentage)}% de los PMF del alcance seleccionado
          </span>
        </div>
      </div>

      <div className="stagegrid">
        {PENDING_STAGE_ORDER.map((stage) => (
          <div className="stage" key={stage}>
            <b data-testid={`pending-stage-${stage}`}>{formatInteger(pending.stages[stage])}</b>
            <span>{pendingStageLabel(stage)} · PMF</span>
          </div>
        ))}
      </div>

      <div>
        {PENDING_STAGE_ORDER.map((stage) => (
          <div className="progressrow" key={stage}>
            <span>{pendingStageLabel(stage)}</span>
            <div className="track">
              <i style={{ width: `${(pending.stages[stage] / maxStage) * 100}%` }} />
            </div>
            <b>{formatInteger(pending.stages[stage])}</b>
          </div>
        ))}
      </div>

      <p className="section-note">
        La subdivisión por etapa usa la heurística{' '}
        <span className="basis-tag">{pending.stage_basis}</span>, inferida del texto de «Estado».
        No es una taxonomía CONAF confirmada.
      </p>

      <div className="btns no-print" style={{ margin: '14px 0 12px' }}>
        <button type="button" className="btn" onClick={onShowPending} data-testid="show-pending">
          Ver sólo PMF pendientes
        </button>
        <button type="button" className="btn alt" onClick={onReset} data-testid="back-to-total">
          Volver al total
        </button>
      </div>

      <div className="tablewrap short">
        <table>
          <thead>
            <tr>
              <th scope="col">PMF</th>
              <th scope="col">Predio de reforestación</th>
              <th scope="col">Carpeta (col. E)</th>
              <th scope="col">Carpeta (col. AC)</th>
              <th scope="col">Predio</th>
              <th scope="col">Rol</th>
              <th scope="col">Estado resumido</th>
              <th scope="col">Motivo</th>
              <th scope="col">N.º ingreso</th>
              <th scope="col">Empresa</th>
            </tr>
          </thead>
          <tbody>
            {pending.rows.map((row) => (
              <tr key={row.source_row_number}>
                <td>
                  <b>{row.pmf}</b>
                </td>
                <td>{cell(row.predio_ref, 'Sin información')}</td>
                <td>{cell(row.carpeta_source)}</td>
                <td>{cell(row.carpeta_normalizada)}</td>
                <td>{cell(row.numero_predio)}</td>
                <td>{cell(row.rol)}</td>
                <td>
                  <StatusPill value={row.estado_resumido} />
                </td>
                <td>{cell(row.tipo_rechazo, '—')}</td>
                <td>{cell(row.numero_ingreso, 'Sin ingreso')}</td>
                <td>{cell(row.empresa)}</td>
              </tr>
            ))}
            {pending.rows.length === 0 && (
              <tr>
                <td colSpan={10} className="empty">
                  No hay PMF pendientes prioritarios para el alcance seleccionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
