/**
 * TR-FUNC-014 / 015 / 016 — source-quality indicators.
 *
 * 014 counts rows with a blank `ID_Predo_Unico`. 015 counts PMFs with no
 * `N Ingreso`, PMF-deduped under the same first-row-wins rule as the approval
 * figures. 016 is a permanent static literal — the source has no resolution
 * number field at all, so the control cannot be computed rather than merely
 * happening to be empty.
 *
 * An indicator reading zero renders calm; only a non-zero count escalates to
 * the warning treatment. That is the whole point of grouping quality here
 * rather than on the Resumen: a healthy source should not spend the page's
 * alert vocabulary on saying that nothing is wrong. The tone is never the
 * only signal — each indicator states its count and its consequence in text.
 */
import type { TranselecSummary } from '../api'
import { formatInteger } from '../format'

export function QualityPanel({ summary }: { summary: TranselecSummary }) {
  const sinId = summary.calidad_filas_sin_id_predial_unico
  const sinIngreso = summary.calidad_pmf_sin_numero_ingreso

  return (
    <div data-testid="quality-panel">
      <div className="quality">
        <div className="quality-item" data-tone={sinId > 0 ? 'warn' : 'calm'}>
          <b data-testid="quality-sin-id">{formatInteger(sinId)}</b>
          <span>filas sin ID predial único</span>
          <i>
            {sinId > 0
              ? 'Esas filas no pueden atribuirse a un predio identificado.'
              : 'Todas las filas de la versión activa tienen identificador predial.'}
          </i>
        </div>
        <div className="quality-item" data-tone={sinIngreso > 0 ? 'warn' : 'calm'}>
          <b data-testid="quality-sin-ingreso">{formatInteger(sinIngreso)}</b>
          <span>PMF sin N.º de ingreso</span>
          <i>
            {sinIngreso > 0
              ? 'No es posible vincularlos a un expediente CONAF.'
              : 'Todos los PMF de la versión activa tienen N.º de ingreso.'}
          </i>
        </div>
        <div className="quality-item" data-tone="calm">
          <b data-testid="quality-resolucion">{summary.calidad_numero_resolucion}</b>
          <span>campo N.º de resolución</span>
          <i>La planilla no incluye ese campo, por lo que el control no puede calcularse.</i>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 'var(--s-4)' }}>
        El conteo de PMF sin N.º de ingreso deduplica por PMF con la regla{' '}
        <span className="basis-tag">{summary.basis_estado_resumido}</span> (primera fila de
        origen).
      </p>
    </div>
  )
}
