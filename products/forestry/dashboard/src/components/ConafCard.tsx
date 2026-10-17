/**
 * «Estado en CONAF» for a management report: what CONAF's public consulta
 * says for the report's solicitud number, how fresh that is, and
 * «Actualizar desde CONAF». Reading the card refreshes data older than
 * 12 hours on the server. The same states and messages as Transelec's card.
 */
import { useEffect, useState } from 'react'
import { mutationMessage } from '../api.ts'
import {
  conafMessage,
  conafTone,
  freshness,
  hasData,
  normalizeSolicitud,
  TONE_LABELS,
  TONE_PILL,
} from '../lib/conafEstado.ts'
import {
  fetchConafSolicitud,
  refreshConafSolicitud,
  type ConafSolicitud,
} from '../reportsApi.ts'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function date(value: string | null): string {
  if (!value) return '—'
  const [y, m, d] = value.split('-')
  return `${d}/${m}/${y}`
}

type State =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; record: ConafSolicitud }

export function ConafCard({ numero }: { numero: string | null }) {
  const normalized = normalizeSolicitud(numero)
  const [state, setState] = useState<State>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (normalized === null) return
    let cancelled = false
    fetchConafSolicitud(normalized)
      .then((record) => {
        if (!cancelled) setState({ status: 'ready', record })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', error: mutationMessage(error, 'No se pudo consultar CONAF ahora.') })
        }
      })
    return () => {
      cancelled = true
    }
  }, [normalized])

  if (normalized === null) {
    return <p className="muted">Este N.º no se puede consultar en CONAF (solo dígitos).</p>
  }

  const refresh = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const record = await refreshConafSolicitud(normalized)
      setState({ status: 'ready', record })
      setNotice(record.lookup_status === 'found' ? 'Estado actualizado desde CONAF.' : null)
    } catch (error) {
      setNotice(mutationMessage(error, 'No se pudo consultar CONAF ahora.'))
    } finally {
      setBusy(false)
    }
  }

  if (state.status === 'loading') return <p className="muted">Consultando CONAF…</p>
  if (state.status === 'error') return <p className="conaf-warn">{state.error}</p>

  const { record } = state
  const message = conafMessage(record)
  const tone = conafTone(record)
  return (
    <div className="conaf-card" data-testid="conaf-card">
      {hasData(record) ? (
        <div className="conaf-card__head">
          <span className={TONE_PILL[tone]}>{TONE_LABELS[tone]}</span>
          {record.recently_changed ? <span className="conaf-changed">Cambió</span> : null}
          <span className="conaf-card__raw">{record.estado}</span>
        </div>
      ) : null}
      {message !== null ? (
        <p className={record.lookup_status === 'found' ? 'muted' : 'conaf-warn'}>{message}</p>
      ) : null}
      {hasData(record) ? (
        <dl className="conaf-card__facts">
          <div>
            <dt>Tipo</dt>
            <dd>{record.tipo ?? '—'}</dd>
          </div>
          <div>
            <dt>Superficie</dt>
            <dd>{record.superficie_ha === null ? '—' : `${ha.format(record.superficie_ha)} ha`}</dd>
          </div>
          <div>
            <dt>Ingreso</dt>
            <dd>{date(record.fecha_ingreso)}</dd>
          </div>
          <div>
            <dt>Resolución</dt>
            <dd>{date(record.fecha_resolucion)}</dd>
          </div>
        </dl>
      ) : null}
      <div className="conaf-card__foot">
        <span className="muted">
          {freshness(record)}
          {record.stale ? ' · Sin actualizar' : ''}
        </span>
        <button type="button" className="button button--ghost" onClick={() => void refresh()} disabled={busy}>
          {busy ? 'Consultando…' : 'Actualizar desde CONAF'}
        </button>
        <a href={record.conaf_url} target="_blank" rel="noreferrer">
          Ver en CONAF ↗
        </a>
      </div>
      <p role="status" aria-atomic="true" className="muted">
        {notice ?? ''}
      </p>
    </div>
  )
}
