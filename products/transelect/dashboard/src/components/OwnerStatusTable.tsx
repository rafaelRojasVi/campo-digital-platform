/**
 * TR-FUNC-013 — "Estado por tipo de propietario".
 *
 * This is the table whose status rule genuinely disagrees with the KPI
 * row's: `owner_stage_legacy` overrides `Estado resumido` with "Rechazado"
 * whenever the raw `Estado` contains "rechaz", so the same predio can be
 * "En trámite" in the hero above and "Rechazado" here. That is Javier's own
 * current behavior, reproduced rather than reconciled — and the design doc
 * requires the rule to be *shown*, not hidden, which is what the basis tag
 * in the heading and the note below it are for.
 */
import type { TranselecOwnerStatus } from '../api'
import { formatInteger, formatPercent } from '../format'
import { buildOwnerStatusTable } from '../lib/ownerStatus'

export function OwnerStatusTable({ ownerStatus }: { ownerStatus: TranselecOwnerStatus }) {
  const table = buildOwnerStatusTable(ownerStatus)

  return (
    <section className="panel section" aria-labelledby="owner-title" data-testid="owner-status">
      <h2 id="owner-title">
        Estado por tipo de propietario <span className="basis-tag">{table.basis}</span>
      </h2>
      <p className="section-note">
        Conteo de predios únicos ({formatInteger(ownerStatus.total_predio_count)} en el alcance
        seleccionado). «Rechazados» se identifica desde el estado vigente, aunque el estado
        resumido figure como «En trámite» — por eso esta tabla puede clasificar un predio de
        forma distinta al resto del panel. La regla aplicada es{' '}
        <span className="basis-tag">{table.basis}</span> y no se ha unificado con las demás
        (decisión pendiente de Javier).
      </p>
      <div className="tablewrap short">
        <table className="ownerstatus">
          <thead>
            <tr>
              <th scope="col">Tipo de propietario</th>
              <th scope="col">Aprobados</th>
              <th scope="col">En trámite</th>
              <th scope="col">Rechazados</th>
              <th scope="col">Pend./tach.</th>
              <th scope="col">Total</th>
              <th scope="col">% aprobado</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.tipoPropietario}>
                <td>{row.tipoPropietario}</td>
                <td className="ok">{formatInteger(row.approved)}</td>
                <td className="warn">{formatInteger(row.progress)}</td>
                <td className="bad">{formatInteger(row.rejected)}</td>
                <td>{formatInteger(row.pending)}</td>
                <td>
                  <b>{formatInteger(row.total)}</b>
                </td>
                <td className="ok">{formatPercent(row.approvedPercentage)}</td>
              </tr>
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No hay predios para los filtros aplicados.
                </td>
              </tr>
            )}
            {table.rows.length > 0 && (
              <tr className="total">
                <td>TOTAL</td>
                <td className="ok">{formatInteger(table.total.approved)}</td>
                <td className="warn">{formatInteger(table.total.progress)}</td>
                <td className="bad">{formatInteger(table.total.rejected)}</td>
                <td>{formatInteger(table.total.pending)}</td>
                <td>
                  <b data-testid="owner-status-total">{formatInteger(table.total.total)}</b>
                </td>
                <td className="ok">{formatPercent(table.total.approvedPercentage)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
