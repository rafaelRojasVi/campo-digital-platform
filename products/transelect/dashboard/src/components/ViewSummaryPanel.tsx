import type { TranselecSummary } from '../api'
import { numberFormatter, surfaceFormatter } from './format'

interface ViewSummaryPanelProps {
  summary: TranselecSummary | null
}

export function ViewSummaryPanel({ summary }: ViewSummaryPanelProps) {
  const items = summary
    ? [
        `${numberFormatter.format(summary.distinct_pmf)} PMF`,
        `${numberFormatter.format(summary.distinct_provisional_predio_ids)} predios provisionales`,
        `${numberFormatter.format(summary.distinct_roles)} roles`,
        `${surfaceFormatter.format(summary.surface_total)} ha registradas`,
        `${numberFormatter.format(summary.business_rows)} registros`,
        `${numberFormatter.format(summary.status_breakdown.length)} categoría${summary.status_breakdown.length === 1 ? '' : 's'} de estado presente${summary.status_breakdown.length === 1 ? '' : 's'}`,
      ]
    : []

  return (
    <article className="panel view-summary-card">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Resumen factual</span>
          <h2>Vista actual</h2>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="skeleton-stack view-summary-skeleton" aria-label="Cargando resumen">
          <span />
          <span />
        </div>
      ) : (
        <ul className="view-summary-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </article>
  )
}
