export interface PredioAreaRow {
  source_row_number: number
  numero_area_corta: string | null
  estado: string | null
  estado_resumido: string | null
  superficie_corta: number | null
  numero_ingreso: string | null
  fecha_ingreso: string | null
  rol: string | null
  empresa: string | null
  sector: string | null
  tramite: string | null
  tipo_propietario: string | null
  pas: string | null
  tipo_rechazo: string | null
}

export interface PredioGroup {
  provisional_predio_id: string | null
  rows: PredioAreaRow[]
}

export interface PmfListItem {
  pmf: string
  row_count: number
  predio_count: number
  sectors: string[]
  empresas: string[]
  statuses: string[]
  surface_total: number | null
}

export interface PmfDetail {
  pmf: string
  row_count: number
  statuses: string[]
  predios: PredioGroup[]
}

export interface TranselecFilterOptions {
  statuses: string[]
  sectors: string[]
  empresas: string[]
  pas: string[]
  tipos_propietario: string[]
}

export interface TranselecSummary {
  business_rows: number
  distinct_pmf: number
  distinct_provisional_predio_ids: number
  distinct_roles: number
  surface_total: number
  status_breakdown: [string, number][]
}

export interface TranselecSnapshotRecord {
  source_snapshot_id: number
  filename: string
  media_type: string | null
  content_sha256: string
  byte_size: number
  business_rows: number
  distinct_pmf: number
  distinct_provisional_predio_ids: number
  surface_total: number
  created_at: string
  active: boolean
}

export interface PublishWorkbookResponse {
  duplicate: boolean
  snapshot: TranselecSnapshotRecord
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function parseError(response: Response): Promise<string> {
  let detail = `${response.status} ${response.statusText}`

  try {
    const payload = (await response.json()) as { detail?: string }
    if (payload.detail) detail = payload.detail
  } catch {
    // Preserve the HTTP fallback when the body is not JSON.
  }

  return detail
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`)

  if (!response.ok) {
    throw new ApiError(response.status, await parseError(response))
  }

  return response.json() as Promise<T>
}

export function getSummary(): Promise<TranselecSummary> {
  return getJson<TranselecSummary>('/transelec/summary')
}

export function getFilters(): Promise<TranselecFilterOptions> {
  return getJson<TranselecFilterOptions>('/transelec/filters')
}

export interface ListPmfsParams {
  search?: string
  status?: string[]
  sector?: string[]
  empresa?: string[]
  pas?: string[]
  tipoPropietario?: string[]
}

function appendMultiSelect(
  query: URLSearchParams,
  key: string,
  values: string[] | undefined,
): void {
  for (const value of values ?? []) {
    query.append(key, value)
  }
}

export function listPmfs(
  params: ListPmfsParams = {},
): Promise<PmfListItem[]> {
  const query = new URLSearchParams()

  if (params.search) query.set('search', params.search)
  appendMultiSelect(query, 'status', params.status)
  appendMultiSelect(query, 'sector', params.sector)
  appendMultiSelect(query, 'empresa', params.empresa)
  appendMultiSelect(query, 'pas', params.pas)
  appendMultiSelect(query, 'tipo_propietario', params.tipoPropietario)

  const queryString = query.toString()

  return getJson<PmfListItem[]>(
    `/transelec/pmfs${queryString ? `?${queryString}` : ''}`,
  )
}

export function getPmfDetail(pmf: string): Promise<PmfDetail> {
  return getJson<PmfDetail>(`/transelec/pmfs/${encodeURIComponent(pmf)}`)
}

export function getSnapshots(): Promise<TranselecSnapshotRecord[]> {
  return getJson<TranselecSnapshotRecord[]>('/transelec/snapshots')
}

export async function publishWorkbook(
  file: File,
  adminToken: string,
): Promise<PublishWorkbookResponse> {
  const response = await fetch('/api/transelec/snapshots', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': file.name,
      'X-Transelec-Admin-Token': adminToken,
    },
    body: file,
  })

  if (!response.ok) {
    throw new ApiError(response.status, await parseError(response))
  }

  return response.json() as Promise<PublishWorkbookResponse>
}

export async function activateSnapshot(
  sourceSnapshotId: number,
  adminToken: string,
): Promise<TranselecSnapshotRecord> {
  const response = await fetch(
    `/api/transelec/snapshots/${sourceSnapshotId}/activate`,
    {
      method: 'POST',
      headers: {
        'X-Transelec-Admin-Token': adminToken,
      },
    },
  )

  if (!response.ok) {
    throw new ApiError(response.status, await parseError(response))
  }

  return response.json() as Promise<TranselecSnapshotRecord>
}
