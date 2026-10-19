/**
 * «Abrir Oficina Virtual CONAF» and «Copiar N.º», beside an N.º de ingreso.
 *
 * CONAF's consulta page is a form that POSTs `nsolicitud` to `action.php`,
 * and `action.php` answers the same number sent by GET. FACT (2026-10-18):
 * that includes the planilla's slashed numbers (12/345-6/24, slashes
 * URL-encoded); the 2026-10-05 note that they failed was wrong. So a
 * queryable number (the most recent in a two-number cell) opens its result
 * already entered; anything else opens the empty consulta page.
 *
 * Used inside clickable table rows: a click here belongs to the link or the
 * button, never to the row behind it. Enter and Space are stopped for the same
 * reason; every other key (Escape, Tab) must still reach the drawer's
 * document-level handlers, so they are not.
 */
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { solicitudesInCell } from '../lib/conafEstado'

export const OFICINA_VIRTUAL_CONAF_URL = 'https://oficinavirtual.conaf.cl/consultas/index.php'
const OFICINA_VIRTUAL_RESULT_URL = 'https://oficinavirtual.conaf.cl/consultas/action.php'

function oficinaVirtualHref(value: string): string {
  const found = solicitudesInCell(value)
  if (found.length === 0) return OFICINA_VIRTUAL_CONAF_URL
  return `${OFICINA_VIRTUAL_RESULT_URL}?${new URLSearchParams({ nsolicitud: found[found.length - 1] })}`
}

function keepActivationKeys(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

export function OficinaVirtualLink({
  numero,
  compact = false,
  testId = 'oficina-virtual',
  withLink = true,
}: {
  numero: string | null
  /** Show «Abrir Oficina Virtual CONAF» beside «Copiar N.º». */
  withLink?: boolean
  /** «Abrir» instead of the full label, for a table cell. */
  compact?: boolean
  testId?: string
}) {
  const [copied, setCopied] = useState<'ok' | 'err' | null>(null)
  const timeoutRef = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timeoutRef.current), [])

  const value = numero?.trim() ?? ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied('ok')
    } catch {
      setCopied('err')
    }
    window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => setCopied(null), 4000)
  }

  return (
    <span
      className="oficina-virtual no-print"
      data-testid={testId}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={keepActivationKeys}
    >
      {withLink && (
      <a
        href={oficinaVirtualHref(value)}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`${testId}-link`}
      >
        {compact ? 'Abrir' : 'Abrir Oficina Virtual CONAF'}{' '}
        <span className="sr-only">
          {compact ? 'Oficina Virtual CONAF ' : ''}(se abre en una pestaña nueva)
        </span>
      </a>
      )}
      {value !== '' && (
        <button
          type="button"
          className="btn-link"
          onClick={() => void copy()}
          aria-label={`Copiar N.º ${value}`}
          data-testid={`${testId}-copy`}
        >
          Copiar N.º
        </button>
      )}
      <span role="status" aria-live="polite" className="hint">
        {copied === 'ok' ? 'N.º copiado.' : copied === 'err' ? 'El navegador no permitió copiar.' : ''}
      </span>
    </span>
  )
}
