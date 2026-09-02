import { statusTone } from './format'

export function StatusPills({
  statuses,
  compact = false,
}: {
  statuses: string[]
  compact?: boolean
}) {
  if (statuses.length === 0) {
    return <span className="status-pill neutral">Sin estado</span>
  }

  return (
    <div className={`status-pills${compact ? ' compact' : ''}`}>
      {statuses.map((status) => (
        <span key={status} className={`status-pill ${statusTone(status)}`}>
          <span className="status-dot" />
          {status}
        </span>
      ))}
    </div>
  )
}
