/**
 * TR-FUNC-001-008 — the eight KPI cards.
 *
 * Labels and sub-labels are the source dashboards' own. Every value comes
 * from `GET /transelec/summary` under the current filter state; nothing is
 * recomputed here.
 *
 * The two status-dependent groups name the legacy rule that produced them.
 * "Aprobados"/"En trámite" use `estado_resumido_first_row`; "Pendientes
 * prioritarios" uses `pending_priority_legacy`, a genuinely different rule
 * that can disagree with the first about the same rows (TR-FUNC-007). The
 * matrix asks for that divergence to be flagged in UI copy rather than
 * silently reconciled, so both identifiers are printed under the grid.
 */
import type { TranselecSummary } from '../api'
import { formatInteger, formatNumber } from '../format'

interface KpiCard {
  id: string
  label: string
  value: string
  sub: string
}

export function buildKpiCards(summary: TranselecSummary): KpiCard[] {
  return [
    {
      id: 'pmf',
      label: 'PMF',
      value: formatInteger(summary.pmf_count),
      sub: 'planes únicos',
    },
    {
      id: 'predios',
      label: 'Predios',
      value: formatInteger(summary.predio_count),
      sub: 'identificadores únicos',
    },
    {
      id: 'roles',
      label: 'Roles',
      value: formatInteger(summary.rol_count),
      sub: 'roles distintos',
    },
    {
      id: 'superficie',
      label: 'Superficie',
      value: `${formatNumber(summary.surface_total)} ha`,
      sub: 'suma de áreas de corta',
    },
    {
      id: 'aprobados',
      label: 'Aprobados',
      value: formatInteger(summary.aprobados_pmf_count),
      sub: 'PMF',
    },
    {
      id: 'en-tramite',
      label: 'En trámite',
      value: formatInteger(summary.en_tramite_pmf_count),
      sub: 'PMF',
    },
    {
      id: 'pendientes',
      label: 'Pendientes prioritarios',
      value: formatInteger(summary.pendientes_prioritarios_pmf_count),
      sub: 'no presentados o rechazados',
    },
    {
      id: 'servidumbre',
      label: 'Con servidumbre',
      value: formatInteger(summary.con_servidumbre_predio_count),
      sub: 'predios únicos',
    },
  ]
}

export function KpiRow({ summary }: { summary: TranselecSummary }) {
  return (
    <>
      <div className="kpis" id="kpis" data-testid="kpi-row">
        {buildKpiCards(summary).map((kpi) => (
          <div className="card kpi" key={kpi.id} data-kpi={kpi.id}>
            <div className="lab">{kpi.label}</div>
            <div className="val" data-testid={`kpi-${kpi.id}`}>
              {kpi.value}
            </div>
            <div className="sub">{kpi.sub}</div>
          </div>
        ))}
      </div>
      <p className="hint" style={{ margin: '-8px 0 18px' }}>
        «Aprobados» y «En trámite» aplican la regla{' '}
        <span className="basis-tag">{summary.basis_estado_resumido}</span>. «Pendientes
        prioritarios» aplica una regla distinta,{' '}
        <span className="basis-tag">{summary.basis_pending_priority}</span>, que puede clasificar
        el mismo PMF de otra forma: las dos cifras no son subconjuntos una de la otra.
      </p>
    </>
  )
}
