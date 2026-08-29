import type { TranselecSnapshotRecord } from '../api'
import { formatDateOnly } from './format'
import { DatabaseIcon, RefreshIcon } from './icons'

interface AppHeaderProps {
  sourceAvailable: boolean
  activeSnapshot: TranselecSnapshotRecord | null
  snapshotHistoryAvailable: boolean
  onManageSource: () => void
  onRefresh: () => void
}

function provenanceLabel(
  activeSnapshot: TranselecSnapshotRecord | null,
  snapshotHistoryAvailable: boolean,
): string {
  if (activeSnapshot) return `Publicado ${formatDateOnly(activeSnapshot.created_at)}`
  if (snapshotHistoryAvailable) return 'Sin planilla publicada'
  return 'Modo de desarrollo'
}

export function AppHeader({
  sourceAvailable,
  activeSnapshot,
  snapshotHistoryAvailable,
  onManageSource,
  onRefresh,
}: AppHeaderProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <strong>Campo Digital</strong>
          <span className="brand-client">Transelec</span>
          <span className="brand-subtitle">Estado operativo de PMF y predios</span>
        </div>
      </div>

      <div className="topbar-actions">
        <span className="source-provenance">
          {provenanceLabel(activeSnapshot, snapshotHistoryAvailable)}
        </span>
        <div className="source-health">
          <span className={`health-dot ${sourceAvailable ? 'online' : 'offline'}`} />
          <span>{sourceAvailable ? 'Datos disponibles' : 'Fuente no disponible'}</span>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={onManageSource}
          aria-label="Gestionar fuente"
        >
          <DatabaseIcon />
          <span aria-hidden="true">Gestionar fuente</span>
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onRefresh}
          aria-label="Actualizar datos"
          title="Actualizar datos"
        >
          <RefreshIcon />
        </button>
      </div>
    </header>
  )
}
