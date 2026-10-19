/**
 * The report editor's three steps, always in the same place: «1 Rodales»,
 * «2 Planificación», «3 Revisar y exportar». A tab list (arrow keys move
 * between steps); the active step's underline slides to it.
 */
import type { KeyboardEvent } from 'react'

import { EDITOR_STEPS, type EditorStep } from '../../lib/editorSteps.ts'

export function EditorSteps({
  step,
  onChange,
}: {
  step: EditorStep
  onChange: (step: EditorStep) => void
}) {
  const index = EDITOR_STEPS.findIndex((item) => item.id === step)

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const next = EDITOR_STEPS[(index + delta + EDITOR_STEPS.length) % EDITOR_STEPS.length]
    if (next === undefined) return
    onChange(next.id)
    document.getElementById(`editor-step-${next.id}`)?.focus()
  }

  return (
    <div className="editor-steps" role="tablist" aria-label="Pasos del informe">
      {EDITOR_STEPS.map((item, position) => {
        const active = item.id === step
        return (
          <button
            key={item.id}
            id={`editor-step-${item.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls="editor-step-panel"
            tabIndex={active ? 0 : -1}
            className={`editor-steps__tab${active ? ' editor-steps__tab--on' : ''}`}
            onClick={() => onChange(item.id)}
            onKeyDown={onKeyDown}
          >
            <span className="editor-steps__n" aria-hidden="true">{position + 1}</span>
            <span className="editor-steps__label">{item.label}</span>
          </button>
        )
      })}
      <span
        className="editor-steps__bar"
        aria-hidden="true"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
    </div>
  )
}
