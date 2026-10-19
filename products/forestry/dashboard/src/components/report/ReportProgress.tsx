/**
 * A guide at the top of the report (option A's cards, kept on the one-screen
 * editor): where the report stands in its three parts, each with an icon,
 * a one-line status and a check once done. Not tabs: everything stays on the
 * screen, and a card only takes you to its part.
 */
import { Icon, type IconName } from './Icon.tsx'

export interface ProgressPart {
  id: 'rodales' | 'planificacion' | 'exportar'
  label: string
  icon: IconName
  status: string
  done: boolean
  /** 0–1, drawn as a small bar under the status (planning). */
  progress?: number
  onGo: () => void
}

export function ReportProgress({ parts }: { parts: ProgressPart[] }) {
  return (
    <nav className="report-progress" aria-label="Avance del informe">
      <ol>
        {parts.map((part) => (
          <li key={part.id}>
            <button
              type="button"
              className={`report-progress__part${part.done ? ' report-progress__part--done' : ''}`}
              onClick={part.onGo}
            >
              <span className="report-progress__icon" aria-hidden="true">
                <Icon name={part.done ? 'check' : part.icon} size={16} />
              </span>
              <span className="report-progress__text">
                <strong>{part.label}</strong>
                <span className="report-progress__status">
                  {part.progress !== undefined ? (
                    <span className="report-progress__bar" aria-hidden="true">
                      <span style={{ transform: `scaleX(${part.progress})` }} />
                    </span>
                  ) : null}
                  {part.status}
                </span>
              </span>
              <span className="sr-only">{part.done ? ' (listo)' : ''}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
