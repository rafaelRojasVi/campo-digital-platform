import type { ReactNode } from 'react'
import type { FailureView } from '../lib/apiState'

/**
 * Full-page state block: empty, unauthorized, unavailable, or an error.
 *
 * These are first-class screens, not fallbacks. The coloured rule above the
 * heading is the one signal that separates "nothing published yet, here is
 * what to do" from "something went wrong": a calm accent for the states that
 * are a normal part of the workflow, a warm one for the states that are not.
 * The distinction is carried by the heading and body copy as well, never by
 * the rule's colour alone.
 */
export function StateBlock({
  view,
  children,
}: {
  view: FailureView
  children?: ReactNode
}) {
  return (
    <section
      className="panel panel-pad state-block"
      data-state-kind={view.kind}
      aria-live="polite"
    >
      <span className="state-mark" aria-hidden="true" />
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

/**
 * A skeleton shaped like the thing it will become.
 *
 * `shape` lets a caller ask for the rhythm of the content that replaces it —
 * a composition bar is one tall block, a table is a stack of rows — so the
 * swap to real content does not move the page underneath the reader.
 */
/**
 * Transelec's network mark, drawing itself while something loads: the same
 * nodes-and-lines motif as its card on the platform's front door.
 */
function LoadingMark() {
  return (
    <svg className="loading-mark" viewBox="0 0 48 32" aria-hidden="true">
      <path className="loading-mark-line" d="M6 22 L18 8 L30 18 L42 6" pathLength={1} />
      <path className="loading-mark-line" d="M18 8 L22 26 L30 18" pathLength={1} />
      <rect className="loading-mark-node" x="3" y="19" width="6" height="6" rx="1.5" />
      <rect className="loading-mark-node" x="15" y="5" width="6" height="6" rx="1.5" />
      <rect className="loading-mark-node" x="27" y="15" width="6" height="6" rx="1.5" />
      <rect className="loading-mark-node" x="39" y="3" width="6" height="6" rx="1.5" />
      <rect className="loading-mark-node" x="19" y="23" width="6" height="6" rx="1.5" />
    </svg>
  )
}

export function LoadingBlock({
  label,
  lines = 3,
  shape = 'text',
  page = false,
}: {
  label: string
  lines?: number
  shape?: 'text' | 'bar' | 'rows'
  /** The whole screen is waiting (the session check): centred, no skeleton. */
  page?: boolean
}) {
  if (page) {
    return (
      <div className="loading-page" role="status" aria-live="polite" aria-busy="true">
        <LoadingMark />
        <span className="loading-row">{label}</span>
      </div>
    )
  }
  return (
    <div className="loading-block" role="status" aria-live="polite" aria-busy="true">
      {label && (
        <span className="loading-row">
          <LoadingMark />
          {label}
        </span>
      )}
      {Array.from({ length: shape === 'bar' ? 2 : lines }, (_, index) => (
        <span
          className={`skeleton${shape === 'text' ? '' : ' tall'}`}
          key={index}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
