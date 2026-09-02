/**
 * TR-FUNC-011 — "Estado resumido" hero, predio grain.
 *
 * The counts come from `summary.estado_resumido_hero_predio`, which is a
 * *predio-grain* rollup — a different denominator from the PMF-grain KPI
 * cards above, using the same `Estado resumido` field. That is easy to
 * misread as agreeing with the KPI row, so the grain is stated explicitly in
 * the heading, exactly as the matrix requires.
 *
 * `sin_estado` is the API's defensive bucket for a blank or unrecognised
 * value. It is rendered only when non-zero, so the four visible counts still
 * sum to the predio total for the reviewed vocabulary while a future import
 * with an unexpected value cannot silently lose predios.
 */
import type { TranselecSummary } from '../api'
import { formatInteger } from '../format'

export function StatusHero({ summary }: { summary: TranselecSummary }) {
  const hero = summary.estado_resumido_hero_predio
  const items: { key: string; label: string; value: number; tone: string }[] = [
    { key: 'aprobado', label: 'Aprobado', value: hero.aprobado, tone: 'approved' },
    { key: 'en-tramite', label: 'En trámite', value: hero.en_tramite, tone: 'progress' },
    { key: 'pendiente', label: 'Pendiente', value: hero.pendiente, tone: 'pending' },
    { key: 'tachado', label: 'Tachado', value: hero.tachado, tone: 'struck' },
  ]

  if (hero.sin_estado > 0) {
    items.push({ key: 'sin-estado', label: 'Sin estado', value: hero.sin_estado, tone: '' })
  }

  return (
    <section className="panel statushero" aria-labelledby="statushero-title" data-testid="status-hero">
      <div className="statusherohead">
        <h2 id="statushero-title">Estado resumido</h2>
        <span>
          Predios únicos del alcance seleccionado ({formatInteger(summary.predio_count)} predios) ·{' '}
          <span className="basis-tag">{summary.basis_estado_resumido}</span>
        </span>
      </div>
      <div className="statusheroitems">
        {items.map((item) => (
          <div className={`statusheroitem ${item.tone}`} key={item.key}>
            <b data-testid={`hero-${item.key}`}>{formatInteger(item.value)}</b>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
