import type { Ref } from 'react'
import type { TranselecSnapshotRecord } from '../api'
import { formatBytes, formatDate, surfaceFormatter } from './format'
import { CloseIcon, DatabaseIcon, RefreshIcon, UploadIcon } from './icons'

interface SourceManagerProps {
  onClose: () => void
  snapshotHistoryAvailable: boolean
  snapshots: TranselecSnapshotRecord[]
  selectedFile: File | null
  onFileChange: (file: File | null) => void
  fileInputRef: Ref<HTMLInputElement>
  adminToken: string
  onAdminTokenChange: (value: string) => void
  uploading: boolean
  onPublish: () => void
  adminMessage: string | null
  adminError: string | null
  restoreCandidate: number | null
  onRestoreClick: (snapshotId: number) => void
  onCancelRestore: () => void
  onRefreshHistory: () => void
}

export function SourceManager({
  onClose,
  snapshotHistoryAvailable,
  snapshots,
  selectedFile,
  onFileChange,
  fileInputRef,
  adminToken,
  onAdminTokenChange,
  uploading,
  onPublish,
  adminMessage,
  adminError,
  restoreCandidate,
  onRestoreClick,
  onCancelRestore,
  onRefreshHistory,
}: SourceManagerProps) {
  return (
    <div className="overlay manager-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="manager-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="manager-header">
          <div>
            <span className="section-kicker">Administración</span>
            <h2 id="manager-title">Fuente de datos Transelec</h2>
            <p>
              Publique una planilla validada o vuelva a una versión anterior.
              El tablero cambia solo después de una validación completa.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Cerrar administrador"
          >
            <CloseIcon />
          </button>
        </div>

        {!snapshotHistoryAvailable ? (
          <div className="local-mode-card">
            <DatabaseIcon />
            <div>
              <strong>Historial no disponible en este entorno</strong>
              <span>
                El tablero está leyendo una fuente local. La publicación de
                versiones requiere la base de datos del piloto alojado.
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="publish-card">
              <div className="publish-copy">
                <span className="step-number">01</span>
                <div>
                  <strong>Publicar nueva versión</strong>
                  <span>
                    Acepta .xlsx o .xlsm hasta 64 MB. Si el contenido es
                    idéntico, no se crea otra versión.
                  </span>
                </div>
              </div>

              <label className={`drop-zone${selectedFile ? ' has-file' : ''}`}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xlsm"
                  onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
                />
                <UploadIcon />
                <div>
                  <strong>
                    {selectedFile ? selectedFile.name : 'Seleccionar planilla'}
                  </strong>
                  <span>
                    {selectedFile
                      ? formatBytes(selectedFile.size)
                      : 'Excel · validación antes de publicar'}
                  </span>
                </div>
                <span className="choose-file">
                  {selectedFile ? 'Cambiar' : 'Examinar'}
                </span>
              </label>

              <div className="admin-row">
                <label className="admin-token-field">
                  <span>Clave de administración</span>
                  <input
                    type="password"
                    value={adminToken}
                    autoComplete="off"
                    placeholder="Ingrese la clave"
                    onChange={(event) => onAdminTokenChange(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={uploading || !selectedFile}
                  onClick={onPublish}
                >
                  {uploading ? 'Procesando…' : 'Validar y publicar'}
                </button>
              </div>

              {adminMessage && (
                <div className="inline-message success">{adminMessage}</div>
              )}
              {adminError && (
                <div className="inline-message error">{adminError}</div>
              )}
            </div>

            <div className="history-section">
              <div className="history-heading">
                <div>
                  <span className="step-number">02</span>
                  <div>
                    <strong>Historial de versiones</strong>
                    <span>{snapshots.length} versión{snapshots.length === 1 ? '' : 'es'} validada{snapshots.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-button small"
                  onClick={onRefreshHistory}
                  aria-label="Actualizar historial"
                >
                  <RefreshIcon />
                </button>
              </div>

              <div className="history-list">
                {snapshots.map((snapshot) => (
                  <article
                    className={`history-item${snapshot.active ? ' active' : ''}`}
                    key={snapshot.source_snapshot_id}
                  >
                    <div className="history-file">
                      <div className="file-type">XLSX</div>
                      <div>
                        <div className="history-title-row">
                          <strong>{snapshot.filename}</strong>
                          {snapshot.active && (
                            <span className="current-badge">Activa</span>
                          )}
                        </div>
                        <span>
                          {formatDate(snapshot.created_at)} · {formatBytes(snapshot.byte_size)}
                        </span>
                      </div>
                    </div>

                    <div className="history-stats">
                      <span><strong>{snapshot.distinct_pmf}</strong> PMF</span>
                      <span><strong>{snapshot.distinct_provisional_predio_ids}</strong> predios</span>
                      <span><strong>{surfaceFormatter.format(snapshot.surface_total)}</strong> ha</span>
                    </div>

                    <div className="history-action">
                      {snapshot.active ? (
                        <span className="active-label">En uso</span>
                      ) : restoreCandidate === snapshot.source_snapshot_id ? (
                        <div className="restore-confirm">
                          <span>¿Restaurar esta versión?</span>
                          <button
                            type="button"
                            disabled={uploading}
                            onClick={() => onRestoreClick(snapshot.source_snapshot_id)}
                          >
                            Confirmar
                          </button>
                          <button type="button" onClick={onCancelRestore}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="restore-button"
                          onClick={() => onRestoreClick(snapshot.source_snapshot_id)}
                        >
                          Restaurar
                        </button>
                      )}
                    </div>
                  </article>
                ))}

                {snapshots.length === 0 && (
                  <div className="history-empty">
                    <DatabaseIcon />
                    <strong>Aún no hay versiones publicadas.</strong>
                    <span>La primera planilla validada aparecerá aquí.</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
