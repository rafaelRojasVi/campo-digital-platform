import type { TranselecSummary } from '../api'
import { numberFormatter, surfaceFormatter } from './format'

interface ExecutiveKpisProps {
  summary: TranselecSummary | null
}

const KPI_DEFS: {
  index: string
  title: string
  label: string
  primary?: boolean
  value: (summary: TranselecSummary) => string
  suffix?: string
}[] = [
  {
    index: '01',
    title: 'PMF',
    label: 'PMF con registros vigentes',
    primary: true,
    value: (summary) => numberFormatter.format(summary.distinct_pmf),
  },
  {
    index: '02',
    title: 'Predios',
    label: 'Identificadores provisionales',
    value: (summary) =>
      numberFormatter.format(summary.distinct_provisional_predio_ids),
  },
  {
    index: '03',
    title: 'Superficie',
    label: 'Superficie de corta registrada',
    value: (summary) => surfaceFormatter.format(summary.surface_total),
    suffix: 'ha',
  },
  {
    index: '04',
    title: 'Registros',
    label: 'Filas operativas en la fuente',
    value: (summary) => numberFormatter.format(summary.business_rows),
  },
  {
    index: '05',
    title: 'Roles',
    label: 'Roles de propiedad distintos',
    value: (summary) => numberFormatter.format(summary.distinct_roles),
  },
]

export function ExecutiveKpis({ summary }: ExecutiveKpisProps) {
  return (
    <section className="kpi-grid" aria-label="Indicadores principales">
      {KPI_DEFS.map((kpi) => (
        <article
          className={`kpi-card${kpi.primary ? ' primary' : ''}`}
          key={kpi.title}
        >
          <div className="kpi-topline">
            <span>{kpi.title}</span>
            <span className="kpi-index">{kpi.index}</span>
          </div>
          <strong className="kpi-value">
            {summary ? kpi.value(summary) : '—'}
            {summary && kpi.suffix && <small>{kpi.suffix}</small>}
          </strong>
          <span className="kpi-label">{kpi.label}</span>
        </article>
      ))}
    </section>
  )
}
