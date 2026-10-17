import { STATUS_LABELS, type ReportStatus } from '../reportsApi.ts'

/** A report's status as a coloured chip (styles in reports.css). */
export function ReportStatusChip({ status }: { status: ReportStatus }) {
  return <span className={`report-chip report-chip--${status}`}>{STATUS_LABELS[status]}</span>
}
