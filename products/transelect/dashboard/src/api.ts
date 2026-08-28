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
}

export interface TranselecSummary {
  business_rows: number
  distinct_pmf: number
  distinct_provisional_predio_ids: number
  surface_total: number
  status_breakdown: [string, number][]
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`)

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`

    try {
      const payload = (await response.json()) as { detail?: string }

      if (payload.detail) {
        detail = payload.detail
      }
    } catch {
      // Preserve the HTTP fallback.
    }

    throw new Error(detail)
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
  status?: string
  sector?: string
  empresa?: string
}

export function listPmfs(
  params: ListPmfsParams = {},
): Promise<PmfListItem[]> {
  const query = new URLSearchParams()

  if (params.search) query.set('search', params.search)
  if (params.status) query.set('status', params.status)
  if (params.sector) query.set('sector', params.sector)
  if (params.empresa) query.set('empresa', params.empresa)

  const queryString = query.toString()

  return getJson<PmfListItem[]>(
    `/transelec/pmfs${queryString ? `?${queryString}` : ''}`,
  )
}

export function getPmfDetail(pmf: string): Promise<PmfDetail> {
  return getJson<PmfDetail>(`/transelec/pmfs/${encodeURIComponent(pmf)}`)
}
