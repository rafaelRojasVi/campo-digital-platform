import type { ModuleStatus } from '../runtime/runtimeConfig'

const LABELS: Record<ModuleStatus, string> = {
  available: 'Disponible',
  unavailable: 'Demo no iniciada',
}

export function StatusBadge({ status }: { status: ModuleStatus }) {
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  )
}
