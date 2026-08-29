import type { TranselecSnapshotRecord } from '../api'
import { formatBytes, formatDate } from './format'
import { ChevronIcon, DatabaseIcon } from './icons'

interface SourceStatusCardProps {
  activeSnapshot: TranselecSnapshotRecord | null
  snapshotHistoryAvailable: boolean
  snapshotsCount: number
  onManage: () => void
}

export function SourceStatusCard({
  activeSnapshot,
  snapshotHistoryAvailable,
  snapshotsCount,
  onManage,
}: SourceStatusCardProps) {
  const primaryText =
    activeSnapshot?.filename ??
    (snapshotHistoryAvailable ? 'Sin planilla publicada' : 'Fuente de desarrollo')

  const secondaryText = activeSnapshot
    ? `Publicada ${formatDate(activeSnapshot.created_at)} · ${formatBytes(activeSnapshot.byte_size)} · ${snapshotsCount} versión${snapshotsCount === 1 ? '' : 'es'}`
    : snapshotHistoryAvailable
      ? 'Publique una planilla para comenzar'
      : 'Modo de desarrollo · lectura directa'

  return (
    <article className="panel source-status-strip">
      <div className="source-status-strip-icon">
        <DatabaseIcon />
      </div>

      <div className="source-status-strip-info">
        <strong>{primaryText}</strong>
        <span>{secondaryText}</span>
      </div>

      {activeSnapshot && <span className="current-badge">Activa</span>}

      <button
        type="button"
        className="button button-secondary compact no-print"
        onClick={onManage}
      >
        Ver historial y actualizar
        <ChevronIcon />
      </button>
    </article>
  )
}
