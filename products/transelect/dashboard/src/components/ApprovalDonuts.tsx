/**
 * TR-FUNC-009 / TR-FUNC-010 — "Avance de aprobación", two CSS donuts.
 *
 * Both read the same 3-bucket split (`Aprobado` / `En trámite` /
 * `Pendiente-o-Tachado`) the API already computed under
 * `estado_resumido_first_row`: one at predio grain (009), one at PMF grain
 * (010). Each donut's three segments sum to its own grain's total, which is
 * why the two charts can legitimately show different percentages.
 */
import type { Bucket3WayCounts, TranselecSummary } from '../api'
import { formatInteger, formatNumber } from '../format'

const APPROVED_COLOR = '#278760'
const PROGRESS_COLOR = '#d68c16'
const REST_COLOR = '#cfd9de'

interface DonutProps {
  id: string
  title: string
  noun: string
  counts: Bucket3WayCounts
}

function DonutCard({ id, title, noun, counts }: DonutProps) {
  const total = counts.aprobado + counts.en_tramite + counts.pendiente_o_tachado
  const percentage = total ? (counts.aprobado / total) * 100 : 0
  const approvedDegrees = total ? (counts.aprobado / total) * 360 : 0
  const progressDegrees = total
    ? ((counts.aprobado + counts.en_tramite) / total) * 360
    : approvedDegrees

  const background =
    `conic-gradient(${APPROVED_COLOR} 0deg ${approvedDegrees}deg, ` +
    `${PROGRESS_COLOR} ${approvedDegrees}deg ${progressDegrees}deg, ` +
    `${REST_COLOR} ${progressDegrees}deg 360deg)`

  return (
    <div className="donutcard" data-testid={`donut-${id}`}>
      <div
        className="donut"
        style={{ background }}
        role="img"
        aria-label={`${title}: ${formatInteger(counts.aprobado)} de ${formatInteger(total)} ${noun} (${formatNumber(percentage)}%)`}
      >
        <div className="donutcenter">
          <b data-testid={`donut-${id}-pct`}>{formatNumber(percentage)}%</b>
          <span>aprobado</span>
        </div>
      </div>
      <div className="donutcopy">
        <h3>{title}</h3>
        <div className="bigline" data-testid={`donut-${id}-total`}>
          {formatInteger(counts.aprobado)} de {formatInteger(total)} {noun}
        </div>
        <p>
          {formatInteger(counts.en_tramite)} en trámite
          {counts.pendiente_o_tachado
            ? `, ${formatInteger(counts.pendiente_o_tachado)} pendientes/tachados`
            : ''}
          . El porcentaje usa unidades únicas, no filas de áreas de corta.
        </p>
      </div>
    </div>
  )
}

export function ApprovalDonuts({ summary }: { summary: TranselecSummary }) {
  return (
    <section className="panel section" aria-labelledby="chart-title">
      <h2 id="chart-title">Avance de aprobación</h2>
      <div className="donutgrid">
        <DonutCard
          id="predios"
          title="Avance por predios"
          noun="predios aprobados"
          counts={summary.avance_por_predio}
        />
        <DonutCard
          id="pmf"
          title="Avance por planes de manejo"
          noun="PMF aprobados"
          counts={summary.avance_por_pmf}
        />
      </div>
      <div className="legend">
        <span>
          <i className="dot" style={{ background: APPROVED_COLOR }} />
          Aprobado
        </span>
        <span>
          <i className="dot" style={{ background: PROGRESS_COLOR }} />
          En trámite
        </span>
        <span>
          <i className="dot" style={{ background: REST_COLOR }} />
          Pendiente o tachado
        </span>
        <span className="basis-tag">{summary.basis_estado_resumido}</span>
      </div>
    </section>
  )
}
