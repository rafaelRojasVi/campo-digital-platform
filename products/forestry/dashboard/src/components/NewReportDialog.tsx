import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import { mutationMessage } from '../api.ts'
import { REPORT_TYPES, TYPE_LABELS, createReport, type ReportType } from '../reportsApi.ts'
import { navigate, reportPath } from '../router.ts'
import { Notice } from './PageShell.tsx'

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function NewReportDialog({
  onCancel,
  openPath = reportPath,
}: {
  onCancel: () => void
  /** Where to go once created; the map's «Agregar a un informe» pastes on arrival. */
  openPath?: (reportId: number) => string
}) {
  const [name, setName] = useState('')
  const [reportType, setReportType] = useState<ReportType>('cosecha')
  const [month, setMonth] = useState(currentMonth)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setBusy(true)
      setError(null)
      try {
        const reportId = await createReport(name.trim(), reportType, month)
        navigate(openPath(reportId))
      } catch (caught) {
        setError(mutationMessage(caught, 'No fue posible crear el informe.'))
        setBusy(false)
      }
    },
    [name, reportType, month, openPath],
  )

  return (
    <div className="dialog-backdrop" role="presentation" onClick={busy ? undefined : onCancel}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-report-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <h2 id="new-report-title" className="dialog__title">
          Nuevo informe
        </h2>
        <div className="dialog__body report-form">
          <label className="report-form__field">
            <span>Nombre</span>
            <input
              id="report-name"
              value={name}
              maxLength={120}
              required
              placeholder="Cosecha pino enero 2027"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="report-form__field">
            <span>Tipo</span>
            <select
              id="report-type"
              value={reportType}
              onChange={(event) => setReportType(event.target.value as ReportType)}
            >
              {REPORT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="report-form__field">
            <span>Mes</span>
            <input
              id="report-month"
              type="month"
              value={month}
              required
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          {error !== null ? <Notice tone="error">{error}</Notice> : null}
        </div>
        <div className="dialog__actions">
          <button type="button" className="button button--ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="button" disabled={busy || name.trim() === ''}>
            {busy ? 'Creando…' : 'Crear informe'}
          </button>
        </div>
      </form>
    </div>
  )
}
