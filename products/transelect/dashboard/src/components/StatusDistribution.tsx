import { useMemo, type Ref } from 'react'
import type { TranselecSummary } from '../api'
import { numberFormatter, statusTone, toneColor } from './format'

interface StatusDistributionProps {
  summary: TranselecSummary | null
  sectionRef?: Ref<HTMLElement>
}

interface Segment {
  status: string
  count: number
  percentage: number
  color: string
}

function buildSegments(summary: TranselecSummary | null): {
  segments: Segment[]
  total: number
} {
  if (!summary) return { segments: [], total: 0 }

  const total = summary.status_breakdown.reduce((sum, [, count]) => sum + count, 0)
  if (total === 0) return { segments: [], total: 0 }

  const segments = summary.status_breakdown.map(([status, count]) => ({
    status,
    count,
    percentage: (count / total) * 100,
    color: toneColor(status),
  }))

  return { segments, total }
}

function conicGradient(segments: Segment[]): string {
  let cursor = 0
  const stops = segments.map((segment) => {
    const start = cursor
    cursor += segment.percentage
    return `${segment.color} ${start}% ${cursor}%`
  })
  return `conic-gradient(${stops.join(', ')})`
}

export function StatusDistribution({ summary, sectionRef }: StatusDistributionProps) {
  const { segments, total } = useMemo(() => buildSegments(summary), [summary])

  return (
    <article className="panel status-panel" ref={sectionRef} tabIndex={-1}>
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Distribución</span>
          <h2>Distribución de registros por estado resumido</h2>
        </div>
        <span className="panel-note">Por fila de fuente</span>
      </div>

      {!summary && (
        <div className="skeleton-stack" aria-label="Cargando estados">
          <span />
          <span />
          <span />
          <span />
        </div>
      )}

      {summary && segments.length === 0 && (
        <div className="empty-compact">No hay estados informados.</div>
      )}

      {segments.length > 0 && (
        <div className="donut-widget">
          <div
            className="donut-ring"
            style={{ background: conicGradient(segments) }}
            role="img"
            aria-label={`Distribución de ${numberFormatter.format(total)} registros por estado resumido, detallada en la lista siguiente`}
          >
            <div className="donut-center">
              <strong>{numberFormatter.format(total)}</strong>
              <span>registros</span>
            </div>
          </div>

          <ul className="donut-legend">
            {segments.map((segment) => (
              <li key={segment.status}>
                <span className={`status-dot ${statusTone(segment.status)}`} />
                <span className="donut-legend-label">{segment.status}</span>
                <strong>{numberFormatter.format(segment.count)}</strong>
                <span className="donut-legend-pct">
                  {Math.round(segment.percentage)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}
