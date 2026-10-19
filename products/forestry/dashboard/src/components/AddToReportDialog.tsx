import { useEffect, useState } from 'react'
import { fetchReports, isEditableStatus, STATUS_LABELS, type Report } from '../reportsApi.ts'
import { navigate } from '../router.ts'
import { pastePath, writeClipboard } from '../lib/reportClipboard.ts'
import { NewReportDialog } from './NewReportDialog.tsx'
import { Notice } from './PageShell.tsx'

interface AddToReportDialogProps {
  /** The base version the map shows; a report only takes polygons of its own base. */
  snapshotId: number
  ordinals: number[]
  onClose: () => void
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; reports: Report[] }

function polygons(count: number): string {
  return `${count} ${count === 1 ? 'polígono' : 'polígonos'}`
}

// The bridge from the map to the report editor: the chosen polygons go to
// the editor's clipboard and the editor pastes them on arrival.
export function AddToReportDialog({ snapshotId, ordinals, onClose }: AddToReportDialogProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [chosen, setChosen] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchReports()
      .then((list) => {
        if (cancelled) return
        const reports = list.reports.filter(
          (report) => isEditableStatus(report.status) && report.base_snapshot_id === snapshotId,
        )
        setLoad({ status: 'ready', reports })
        if (reports.length === 1) setChosen(reports[0]!.report_id)
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [snapshotId])

  const copy = () => writeClipboard({ base_snapshot_id: snapshotId, ordinals })

  if (creating) {
    return <NewReportDialog onCancel={() => setCreating(false)} openPath={pastePath} />
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-report-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="add-to-report-title" className="dialog__title">
          Agregar a un informe
        </h2>
        <div className="dialog__body add-to-report">
          <p>
            {polygons(ordinals.length)} se agregan a un informe en borrador; ahí se pueden
            dividir y enviar a revisión.
          </p>
          {load.status === 'loading' ? <p>Cargando informes…</p> : null}
          {load.status === 'error' ? (
            <Notice tone="error">No fue posible cargar los informes.</Notice>
          ) : null}
          {load.status === 'ready' && load.reports.length === 0 ? (
            <p className="add-to-report__empty">No hay informes en borrador.</p>
          ) : null}
          {load.status === 'ready' && load.reports.length > 0 ? (
            <fieldset className="add-to-report__list">
              <legend>Informes en borrador</legend>
              {load.reports.map((report) => (
                <label key={report.report_id} className="add-to-report__option">
                  <input
                    type="radio"
                    name="add-to-report"
                    checked={chosen === report.report_id}
                    onChange={() => setChosen(report.report_id)}
                  />
                  <span>
                    {report.name}
                    <small>
                      {STATUS_LABELS[report.status]} · {polygons(report.feature_count)}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>
        <div className="dialog__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              copy()
              setCreating(true)
            }}
          >
            Crear un informe nuevo
          </button>
          <button
            type="button"
            className="button"
            disabled={chosen === null}
            onClick={() => {
              if (chosen === null) return
              copy()
              navigate(pastePath(chosen))
            }}
          >
            Agregar {polygons(ordinals.length)}
          </button>
        </div>
      </div>
    </div>
  )
}
