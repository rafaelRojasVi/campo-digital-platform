// products/transelect/dashboard/src/demoPmfView.ts
//
// TypeScript port of transelec_ingestion/pmf_view.py's pure grouping/filtering
// logic, operating on the demo-only DemoResumenRow shape instead of the real
// xlsx-derived ResumenSourceRow. See docs/adr/ADR-008-hosted-demo-data-v1.md.
import type { DemoResumenRow } from './demoData'

export interface PmfListItem {
  pmf: string
  rowCount: number
  predioCount: number
  sectors: string[]
  empresas: string[]
  statuses: string[]
  surfaceTotal: number | null
}

export interface PredioGroup {
  provisionalPredioId: string | null
  rows: DemoResumenRow[]
}

export interface PmfDetail {
  pmf: string
  rowCount: number
  statuses: string[]
  predios: PredioGroup[]
}

export interface FilterOptions {
  statuses: string[]
  sectors: string[]
  empresas: string[]
  pas: string[]
  tiposPropietario: string[]
}

export interface Summary {
  businessRows: number
  distinctPmf: number
  distinctProvisionalPredioIds: number
  distinctRoles: number
  surfaceTotal: number
  statusBreakdown: [string, number][]
}

export interface ActiveFilters {
  search?: string
  status?: string[]
  sector?: string[]
  empresa?: string[]
  pas?: string[]
  tipoPropietario?: string[]
}

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort()
}

function matchesSelection(value: string | null, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true
  return value !== null && allowed.map((v) => v.toLowerCase()).includes(value.toLowerCase())
}

export function filterRows(rows: DemoResumenRow[], filters: ActiveFilters): DemoResumenRow[] {
  const needle = filters.search?.trim().toLowerCase()

  return rows.filter((r) => {
    if (!matchesSelection(r.estadoResumido, filters.status)) return false
    if (!matchesSelection(r.sector, filters.sector)) return false
    if (!matchesSelection(r.empresa, filters.empresa)) return false
    if (!matchesSelection(r.pas, filters.pas)) return false
    if (!matchesSelection(r.tipoPropietario, filters.tipoPropietario)) return false

    if (needle) {
      const haystacks = [r.pmf, r.provisionalPredioId ?? '', r.rol ?? '']
      if (!haystacks.some((h) => h.toLowerCase().includes(needle))) return false
    }

    return true
  })
}

export function listFilterOptions(rows: DemoResumenRow[]): FilterOptions {
  return {
    statuses: sortedUnique(rows.map((r) => r.estadoResumido)),
    sectors: sortedUnique(rows.map((r) => r.sector)),
    empresas: sortedUnique(rows.map((r) => r.empresa)),
    pas: sortedUnique(rows.map((r) => r.pas)),
    tiposPropietario: sortedUnique(rows.map((r) => r.tipoPropietario)),
  }
}

export function listPmfs(rows: DemoResumenRow[], filters: ActiveFilters = {}): PmfListItem[] {
  const matched = filterRows(rows, filters)
  const grouped = new Map<string, DemoResumenRow[]>()

  for (const r of matched) {
    const bucket = grouped.get(r.pmf) ?? []
    bucket.push(r)
    grouped.set(r.pmf, bucket)
  }

  return Array.from(grouped.keys())
    .sort()
    .map((pmf) => {
      const pmfRows = grouped.get(pmf)!
      const predios = new Set(pmfRows.map((r) => r.provisionalPredioId).filter((v): v is string => v !== null))
      const surfaces = pmfRows.map((r) => r.superficieCorta).filter((v): v is number => v !== null)

      return {
        pmf,
        rowCount: pmfRows.length,
        predioCount: predios.size,
        sectors: sortedUnique(pmfRows.map((r) => r.sector)),
        empresas: sortedUnique(pmfRows.map((r) => r.empresa)),
        statuses: sortedUnique(pmfRows.map((r) => r.estadoResumido)),
        surfaceTotal: surfaces.length ? surfaces.reduce((a, b) => a + b, 0) : null,
      }
    })
}

export function getPmfDetail(rows: DemoResumenRow[], pmf: string): PmfDetail | null {
  const pmfRows = rows.filter((r) => r.pmf === pmf)
  if (pmfRows.length === 0) return null

  const byPredio = new Map<string | null, DemoResumenRow[]>()
  for (const r of pmfRows) {
    const bucket = byPredio.get(r.provisionalPredioId) ?? []
    bucket.push(r)
    byPredio.set(r.provisionalPredioId, bucket)
  }

  const orderedIds = Array.from(byPredio.keys())
    .filter((id): id is string => id !== null)
    .sort()
  if (byPredio.has(null)) orderedIds.push(null as unknown as string)

  return {
    pmf,
    rowCount: pmfRows.length,
    statuses: sortedUnique(pmfRows.map((r) => r.estadoResumido)),
    predios: orderedIds.map((id) => ({
      provisionalPredioId: id,
      rows: [...byPredio.get(id)!].sort(
        (a, b) => (a.numeroAreaCorta ?? '').localeCompare(b.numeroAreaCorta ?? '') || a.sourceRowNumber - b.sourceRowNumber,
      ),
    })),
  }
}

export function buildSummary(rows: DemoResumenRow[]): Summary {
  if (rows.length === 0) {
    return {
      businessRows: 0,
      distinctPmf: 0,
      distinctProvisionalPredioIds: 0,
      distinctRoles: 0,
      surfaceTotal: 0,
      statusBreakdown: [],
    }
  }

  const surfaceTotal = rows.reduce((sum, r) => sum + (r.superficieCorta ?? 0), 0)
  const statusCounts = new Map<string, number>()
  for (const r of rows) {
    statusCounts.set(r.estadoResumido, (statusCounts.get(r.estadoResumido) ?? 0) + 1)
  }

  return {
    businessRows: rows.length,
    distinctPmf: new Set(rows.map((r) => r.pmf)).size,
    distinctProvisionalPredioIds: new Set(rows.map((r) => r.provisionalPredioId).filter(Boolean)).size,
    distinctRoles: new Set(rows.map((r) => r.rol).filter(Boolean)).size,
    surfaceTotal,
    statusBreakdown: Array.from(statusCounts.entries()).sort(([a], [b]) => a.localeCompare(b)),
  }
}
