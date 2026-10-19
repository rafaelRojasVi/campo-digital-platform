/**
 * «Estado en CONAF» in the PMF drawer: what CONAF's public consulta says for
 * the most recent ingreso, how fresh that is, and «Actualizar desde CONAF».
 * Reading the card refreshes data older than 12 hours on the server.
 */
import { useEffect, useState } from 'react'
import { getConafSolicitud, refreshConafSolicitud, type ConafSolicitud } from '../api'
import {
  conafMessage,
  conafTone,
  freshness,
  hasData,
  normalizeSolicitud,
  rawEstado,
  refreshNotice,
  TONE_LABELS,
  TONE_PILL,
} from '../lib/conafEstado'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function date(value: string | null): string {
  if (!value) return '—'
  const [y, m, d] = value.split('-')
  return `${d}/${m}/${y}`
}

type State = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; record: ConafSolicitud }

export function ConafCard({ numero }: { numero: string | null }) {
  const normalized = normalizeSolicitud(numero)
  const [state, setState] = useState<State>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // Bumped by «Reintentar» to read again after a failed first read.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (normalized === null) return
    let cancelled = false
    void getConafSolicitud(normalized).then((result) => {
      if (cancelled) return
      setState(result.ok ? { status: 'ready', record: result.data } : { status: 'error', error: result.error })
    })
    return () => {
      cancelled = true
    }
  }, [normalized, attempt])

  if (normalized === null) {
    return (
      <p className="hint">Este N.º no se puede consultar en CONAF (dígitos, o el formato 12/345-6/24).</p>
    )
  }

  const refresh = async () => {
    const before = state.status === 'ready' ? state.record : null
    setBusy(true)
    setNotice(null)
    const result = await refreshConafSolicitud(normalized)
    setBusy(false)
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    setState({ status: 'ready', record: result.data })
    setNotice(refreshNotice(before, result.data))
  }

  if (state.status === 'loading') return <p className="hint">Consultando CONAF…</p>
  if (state.status === 'error') {
    return (
      <div className="conaf-card">
        <p className="hint conaf-warn">{state.error}</p>
        <div className="conaf-card__foot">
          <button
            type="button"
            className="btn alt small"
            onClick={() => {
              setState({ status: 'loading' })
              setAttempt((n) => n + 1)
            }}
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  const { record } = state
  const message = conafMessage(record)
  const tone = conafTone(record)
  const raw = rawEstado(record)
  return (
    <div className="conaf-card" data-testid="conaf-card">
      {hasData(record) && (
        <div className="conaf-card__head">
          <span className={`pill ${TONE_PILL[tone]}`}>{TONE_LABELS[tone]}</span>
          {record.recently_changed && <span className="chip conaf-changed">Cambió</span>}
          {raw !== null && <span className="conaf-card__raw">{raw}</span>}
        </div>
      )}
      {message && <p className={record.lookup_status === 'found' ? 'hint' : 'hint conaf-warn'}>{message}</p>}
      {hasData(record) && (
        <dl className="conaf-card__facts">
          <div><dt>Tipo</dt><dd>{record.tipo ?? '—'}</dd></div>
          <div><dt>Superficie</dt><dd>{record.superficie_ha === null ? '—' : `${ha.format(record.superficie_ha)} ha`}</dd></div>
          <div><dt>Ingreso</dt><dd>{date(record.fecha_ingreso)}</dd></div>
          <div><dt>Resolución</dt><dd>{date(record.fecha_resolucion)}</dd></div>
        </dl>
      )}
      <div className="conaf-card__foot">
        <span className="hint">
          {freshness(record)}
          {record.stale ? ' · Sin actualizar' : ''}
        </span>
        <button type="button" className="btn alt small" onClick={() => void refresh()} disabled={busy}>
          {busy ? 'Consultando…' : 'Actualizar desde CONAF'}
        </button>
        <a href={record.conaf_url} target="_blank" rel="noreferrer">
          Ver en CONAF ↗
        </a>
      </div>
      <p role="status" aria-atomic="true" className="hint">
        {notice ?? ''}
      </p>
    </div>
  )
}
