import type { TranselecSnapshotRecord } from '../api'
import { formatBytes, formatDate, surfaceFormatter } from './format'
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
  return (
    <article className="panel source-status-card">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Control de fuente</span>
          <h2>Versión publicada</h2>
        </div>
        {activeSnapshot && <span className="current-badge">Activa</span>}
      </div>

      <div className="dataset-summary">
        <div className="dataset-file-icon">
          <DatabaseIcon />
        </div>
        <div>
          <strong>
            {activeSnapshot?.filename ??
              (snapshotHistoryAvailable ? 'Sin planilla publicada' : 'Fuente de desarrollo')}
          </strong>
          <span>
            {activeSnapshot
              ? `Publicada ${formatDate(activeSnapshot.created_at)}`
              : snapshotHistoryAvailable
                ? 'Publique una planilla para comenzar'
                : 'Modo de desarrollo · lectura directa'}
          </span>
        </div>
      </div>

      <div className="dataset-metrics">
        <div>
          <span>Versiones</span>
          <strong>{snapshotHistoryAvailable ? snapshotsCount : '—'}</strong>
        </div>
        <div>
          <span>Tamaño</span>
          <strong>
            {activeSnapshot ? formatBytes(activeSnapshot.byte_size) : '—'}
          </strong>
        </div>
        <div>
          <span>Superficie</span>
          <strong>
            {activeSnapshot
              ? `${surfaceFormatter.format(activeSnapshot.surface_total)} ha`
              : '—'}
          </strong>
        </div>
      </div>

      <button
        type="button"
        className="button button-dark full-width"
        onClick={onManage}
      >
        Ver historial y actualizar
        <ChevronIcon />
      </button>
    </article>
  )
}
