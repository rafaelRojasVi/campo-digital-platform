/**
 * TR-FUNC-014 / 015 / 016 — "Controles de calidad y gestión".
 *
 * 014 counts rows with a blank `ID_Predo_Unico` (0 in the reviewed snapshot,
 * which is exactly why the indicator exists: a future workbook may not be).
 * 015 counts PMFs with no `N Ingreso`, PMF-deduped under the same
 * first-row-wins rule as the KPI row. 016 is a permanent static literal —
 * the source has no resolution-number field at all.
 */
import type { TranselecSummary } from '../api'
import { formatInteger } from '../format'

export function QualityPanel({ summary }: { summary: TranselecSummary }) {
  return (
    <section className="panel section" aria-labelledby="quality-title" data-testid="quality-panel">
      <h2 id="quality-title">Controles de calidad y gestión</h2>
      <div className="quality">
        <div>
          <b data-testid="quality-sin-id">
            {formatInteger(summary.calidad_filas_sin_id_predial_unico)}
          </b>
          filas sin ID predial único
        </div>
        <div>
          <b data-testid="quality-sin-ingreso">
            {formatInteger(summary.calidad_pmf_sin_numero_ingreso)}
          </b>
          PMF sin N.º de ingreso
        </div>
        <div>
          <b data-testid="quality-resolucion">{summary.calidad_numero_resolucion}</b>
          campo N.º de resolución
        </div>
      </div>
      <p className="section-note" style={{ margin: '12px 0 0' }}>
        El conteo de PMF sin N.º de ingreso deduplica por PMF con la regla{' '}
        <span className="basis-tag">{summary.basis_estado_resumido}</span> (primera fila de
        origen). La planilla no incluye un campo de N.º de resolución, por lo que ese control no
        puede calcularse.
      </p>
    </section>
  )
}
