/**
 * Rodales management reports (informes de manejo): types and calls for
 * /api/forestry/reports (stage 1 API, products/forestry/docs/management-reports-v1.md).
 * Geometry is EPSG:32718 metres, exactly as served.
 */
import { getConafJson, getJson, mutate, mutateAbsolute } from './api.ts'
import type { MultiPolygonGeometry } from './types.ts'

export type ReportType = 'cosecha' | 'manejo' | 'reforestacion' | 'plantacion' | 'otro'
export type ReportStatus =
  | 'borrador'
  | 'enviado'
  | 'aprobado'
  | 'cambios_solicitados'
  | 'archivado'
export type ReportAction = 'submit' | 'approve' | 'request-changes' | 'archive'
export type ExportFormat = 'shp' | 'gpkg' | 'csv'
export type ExportScope = 'all' | 'marked'

export const REPORT_TYPES: ReportType[] = [
  'cosecha',
  'manejo',
  'reforestacion',
  'plantacion',
  'otro',
]

export const TYPE_LABELS: Record<ReportType, string> = {
  cosecha: 'Cosecha',
  manejo: 'Manejo',
  reforestacion: 'Reforestación',
  plantacion: 'Plantación',
  otro: 'Otro',
}

export const STATUS_LABELS: Record<ReportStatus, string> = {
  borrador: 'Borrador',
  enviado: 'Enviado',
  aprobado: 'Aprobado',
  cambios_solicitados: 'Cambios solicitados',
  archivado: 'Archivado',
}

export const EDITABLE_STATUSES: ReportStatus[] = ['borrador', 'cambios_solicitados']

export function isEditableStatus(status: ReportStatus): boolean {
  return EDITABLE_STATUSES.includes(status)
}

export type Attributes = Record<string, string | number | boolean | null>

export interface Report {
  report_id: number
  name: string
  report_type: ReportType
  report_month: string
  status: ReportStatus
  base_snapshot_id: number
  revision: number
  created_by_display_name: string
  created_at: string
  updated_at: string
  submitted_at: string | null
  decided_at: string | null
  decided_by_display_name: string | null
  feature_count: number
  managed_feature_count: number
  managed_area_ha: number
  conaf_solicitud: string | null
}

/** One CONAF solicitud as the platform last read it (Estado CONAF). */
export interface ConafSolicitud {
  numero: string
  lookup_status: 'found' | 'not_found' | 'mismatch' | 'unavailable'
  tipo: string | null
  estado: string | null
  superficie_ha: number | null
  fecha_ingreso: string | null
  fecha_resolucion: string | null
  returned_solicitud: string | null
  checked_at: string
  found_at: string | null
  estado_changed_at: string | null
  stale: boolean
  recently_changed: boolean
  conaf_url: string
}

export interface ReportList {
  reports: Report[]
  pending_review_count: number
}

export interface ReportFeature {
  position: number
  source_feature_ordinal: number
  in_report: boolean
  geometry_changed: boolean
  attributes: Attributes
  geometry: MultiPolygonGeometry
}

export interface ReportSource {
  source_feature_ordinal: number
  attributes: Attributes
  geometry: MultiPolygonGeometry
  is_valid: boolean
}

export interface ReportNote {
  kind: 'cambios_solicitados' | 'aprobado'
  body: string
  author_display_name: string
  created_at: string
}

export interface ReportDetail {
  report: Report
  features: ReportFeature[]
  sources: ReportSource[]
  notes: ReportNote[]
  srid: number
  published_snapshot_id: number | null
}

export interface SaveFeatureInput {
  source_feature_ordinal: number
  in_report: boolean
  attributes: Record<string, string | null>
  geometry: MultiPolygonGeometry | null
}

export interface ReportWarning {
  code: string
  message: string
  source_feature_ordinal: number | null
}

export interface SaveResult {
  revision: number
  feature_count: number
  warnings: ReportWarning[]
}

export interface StatusResult {
  report_id: number
  status: ReportStatus
  revision: number
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function fetchReports(): Promise<ReportList> {
  return getJson<ReportList>('/reports')
}

export function fetchReport(reportId: number): Promise<ReportDetail> {
  return getJson<ReportDetail>(`/reports/${reportId}`)
}

export async function createReport(
  name: string,
  reportType: ReportType,
  reportMonth: string,
): Promise<number> {
  const created = await mutate<{ report_id: number }>('/reports', {
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, report_type: reportType, report_month: reportMonth }),
  })
  return created.report_id
}

export function saveReportFeatures(
  reportId: number,
  revision: number,
  features: SaveFeatureInput[],
): Promise<SaveResult> {
  return mutate<SaveResult>('/reports/features', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ report_id: reportId, revision, features }),
  })
}

export function updateReport(
  reportId: number,
  revision: number,
  changes: {
    name?: string
    report_type?: ReportType
    report_month?: string
    conaf_solicitud?: string | null
  },
): Promise<StatusResult> {
  return mutate<StatusResult>(`/reports/${reportId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ revision, ...changes }),
  })
}

export function transitionReport(
  reportId: number,
  action: ReportAction,
  revision: number,
  note?: string,
): Promise<StatusResult> {
  return mutate<StatusResult>(`/reports/${reportId}/${action}`, {
    headers: JSON_HEADERS,
    body: JSON.stringify(note === undefined ? { revision } : { revision, note }),
  })
}

export async function duplicateReport(reportId: number): Promise<number> {
  const created = await mutate<{ report_id: number }>(`/reports/${reportId}/duplicate`, {})
  return created.report_id
}

export function deleteReport(reportId: number): Promise<void> {
  return mutate<void>(`/reports/${reportId}`, { method: 'DELETE' })
}

export function exportUrl(reportId: number, format: ExportFormat, scope: ExportScope): string {
  return `/api/forestry/reports/${reportId}/export?format=${format}&scope=${scope}`
}

// Estado CONAF (shared routes, /api/conaf).

export function fetchConafSolicitud(numero: string): Promise<ConafSolicitud> {
  return getConafJson<ConafSolicitud>(`/api/conaf/solicitudes/${encodeURIComponent(numero)}`)
}

export async function refreshConafSolicitud(numero: string): Promise<ConafSolicitud> {
  return mutateAbsolute<ConafSolicitud>(`/api/conaf/solicitudes/${encodeURIComponent(numero)}/refresh`)
}

export async function fetchConafSolicitudes(numeros: string[]): Promise<ConafSolicitud[]> {
  const unique = [...new Set(numeros)]
  const all: ConafSolicitud[] = []
  for (let start = 0; start < unique.length; start += 500) {
    const chunk = unique.slice(start, start + 500).join(',')
    const body = await getConafJson<{ solicitudes: ConafSolicitud[] }>(
      `/api/conaf/solicitudes?numeros=${encodeURIComponent(chunk)}`,
    )
    all.push(...body.solicitudes)
  }
  return all
}
