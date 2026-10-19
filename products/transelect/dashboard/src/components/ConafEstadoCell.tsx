/**
 * One PMF's CONAF status in a table: a pill with a text label, «Cambió» and
 * «Sin actualizar» when they apply, the raw CONAF text in the title.
 * Lists show stored data only; «Sin consultar» until the nightly read or a
 * detail view reads it.
 */
import type { ConafSolicitud } from '../api'
import {
  conafTone,
  contradictsPlanilla,
  freshness,
  hasData,
  normalizeSolicitud,
  REVISAR_HINT,
  REVISAR_LABEL,
  TONE_LABELS,
  TONE_PILL,
} from '../lib/conafEstado'

export function ConafEstadoCell({
  numero,
  record,
  estadoResumido,
}: {
  numero: string | null
  record: ConafSolicitud | undefined
  /** The planilla's «Estado resumido», to flag an approved plan CONAF shows denied. */
  estadoResumido?: string | null
}) {
  if (normalizeSolicitud(numero) === null) return <span className="hint">Sin N.º consultable</span>
  if (!record) return <span className="hint">Sin consultar</span>
  if (!hasData(record)) {
    const text =
      record.lookup_status === 'not_found'
        ? 'No existe en CONAF'
        : record.lookup_status === 'unavailable'
          ? 'CONAF no respondió'
          : 'Revisar N.º'
    return <span className="hint conaf-warn">{text}</span>
  }
  const tone = conafTone(record)
  const revisar = contradictsPlanilla(record, estadoResumido)
  return (
    <span
      className="conaf-cell"
      title={revisar ? `${REVISAR_HINT} CONAF: ${record.estado}.` : `${record.estado} · ${freshness(record)}`}
    >
      {revisar ? (
        <span className="pill pill-otro">{REVISAR_LABEL}</span>
      ) : (
        <span className={`pill ${TONE_PILL[tone]}`}>{TONE_LABELS[tone]}</span>
      )}
      {record.recently_changed && <span className="chip conaf-changed">Cambió</span>}
      {record.stale && <span className="hint conaf-warn">Sin actualizar</span>}
    </span>
  )
}
