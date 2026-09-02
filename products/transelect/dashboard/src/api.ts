// products/transelect/dashboard/src/api.ts
//
// Demo-only data layer: no live backend exists for this app. Every function
// below runs the ported pmf_view logic (./demoPmfView) over the bundled
// synthetic rows (./demoData). See docs/adr/ADR-008-hosted-demo-data-v1.md.
import { DEMO_ROWS } from './demoData'
import {
  buildSummary,
  filterRows,
  getPmfDetail as getPmfDetailPure,
  listFilterOptions,
  listPmfs as listPmfsPure,
  type ActiveFilters as PureActiveFilters,
} from './demoPmfView'

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

export interface ActiveFilters {
  search?: string
  status?: string[]
  sector?: string[]
  empresa?: string[]
  pas?: string[]
  tipoPropietario?: string[]
}

function toPure(filters: ActiveFilters): PureActiveFilters {
  return {
    search: filters.search,
    status: filters.status,
    sector: filters.sector,
    empresa: filters.empresa,
    pas: filters.pas,
    tipoPropietario: filters.tipoPropietario,
  }
}

export function getFilters(): Promise<TranselecFilterOptions> {
  const options = listFilterOptions(DEMO_ROWS)
  return Promise.resolve({
    statuses: options.statuses,
    sectors: options.sectors,
    empresas: options.empresas,
    pas: options.pas,
    tipos_propietario: options.tiposPropietario,
  })
}

export function listPmfs(filters: ActiveFilters = {}): Promise<PmfListItem[]> {
  const items = listPmfsPure(DEMO_ROWS, toPure(filters))
  return Promise.resolve(
    items.map((item) => ({
      pmf: item.pmf,
      row_count: item.rowCount,
      predio_count: item.predioCount,
      sectors: item.sectors,
      empresas: item.empresas,
      statuses: item.statuses,
      surface_total: item.surfaceTotal,
    })),
  )
}

export function getSummary(filters: ActiveFilters = {}): Promise<TranselecSummary> {
  const summary = buildSummary(filterRows(DEMO_ROWS, toPure(filters)))
  return Promise.resolve({
    business_rows: summary.businessRows,
    distinct_pmf: summary.distinctPmf,
    distinct_provisional_predio_ids: summary.distinctProvisionalPredioIds,
    distinct_roles: summary.distinctRoles,
    surface_total: summary.surfaceTotal,
    status_breakdown: summary.statusBreakdown,
  })
}

export function getPmfDetail(pmf: string): Promise<PmfDetail> {
  const detail = getPmfDetailPure(DEMO_ROWS, pmf)
  if (!detail) {
    return Promise.reject(new Error('PMF no encontrado en la fuente de demostración.'))
  }
  return Promise.resolve({
    pmf: detail.pmf,
    row_count: detail.rowCount,
    statuses: detail.statuses,
    predios: detail.predios.map((group) => ({
      provisional_predio_id: group.provisionalPredioId,
      rows: group.rows.map((r) => ({
        source_row_number: r.sourceRowNumber,
        numero_area_corta: r.numeroAreaCorta,
        estado: r.estado,
        estado_resumido: r.estadoResumido,
        superficie_corta: r.superficieCorta,
        numero_ingreso: r.numeroIngreso,
        fecha_ingreso: r.fechaIngreso,
        rol: r.rol,
        empresa: r.empresa,
        sector: r.sector,
        tramite: r.tramite,
        tipo_propietario: r.tipoPropietario,
        pas: r.pas,
        tipo_rechazo: r.tipoRechazo,
      })),
    })),
  })
}
