import type { ReactNode } from 'react'
import type { FailureView } from '../lib/apiState'

/** Full-page state block: empty, unauthorized, unavailable, or an error. */
export function StateBlock({
  view,
  children,
}: {
  view: FailureView
  children?: ReactNode
}) {
  return (
    <section className="panel state-block" data-state-kind={view.kind} aria-live="polite">
      <h2>{view.title}</h2>
      <p>{view.message}</p>
      {children}
    </section>
  )
}

/** Inline banner for a recoverable failure that leaves the page usable. */
export function AlertBanner({
  tone = 'error',
  title,
  children,
}: {
  tone?: 'error' | 'warn' | 'ok' | 'info'
  title: string
  children?: ReactNode
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <strong>{title}</strong>
      {children}
    </div>
  )
}

export function LoadingBlock({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div className="loading-block" role="status" aria-live="polite" aria-busy="true">
      <span className="loading-row">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <span className="skeleton" key={index} aria-hidden="true" />
      ))}
    </div>
  )
}
