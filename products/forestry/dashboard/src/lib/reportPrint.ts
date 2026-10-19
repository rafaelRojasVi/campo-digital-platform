import type { ReportFeature } from '../reportsApi.ts'
import { multiPolygonAreaSquareMeters } from './draftGeometry.ts'
import { speciesGroup, NO_SPECIES_GROUP } from './species.ts'

// The table of the printable report («Imprimir / PDF»): one row per report
// polygon, managed areas first, with the totals a Plan de Manejo needs.

export interface PrintRow {
  ordinal: number
  rodal: string
  code: string
  predio: string
  sector: string | null
  uso: string
  species: string
  ha: number
  managed: boolean
  reforestSpecies: string | null
  reforestDensity: number | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

export function printRows(features: ReportFeature[]): {
  rows: PrintRow[]
  totalHa: number
  managedHa: number
} {
  const rows = features.map((feature): PrintRow => {
    const a = feature.attributes
    const supHa = typeof a.sup_ha === 'number' ? a.sup_ha : Number.parseFloat(text(a.sup_ha))
    const group = speciesGroup(text(a.cod_uso_2026) || null)
    return {
      ordinal: feature.position,
      rodal: text(a.n_rodal) || '—',
      code: text(a.cod_uso_2026) || '—',
      predio: text(a.nom_predio) || '—',
      sector: feature.sector ?? null,
      uso: text(a.uso_2026) || '—',
      species: group === NO_SPECIES_GROUP ? '—' : group.label,
      ha: Number.isFinite(supHa)
        ? supHa
        : multiPolygonAreaSquareMeters(feature.geometry.coordinates) / 10_000,
      managed: feature.in_report,
      reforestSpecies:
        feature.reforest_species != null && feature.reforest_species.length > 0
          ? feature.reforest_species.join(' + ')
          : null,
      reforestDensity: feature.reforest_density ?? null,
    }
  })
  rows.sort(
    (a, b) =>
      Number(b.managed) - Number(a.managed) ||
      a.rodal.localeCompare(b.rodal, 'es', { numeric: true }) ||
      a.ordinal - b.ordinal,
  )
  return {
    rows,
    totalHa: rows.reduce((sum, row) => sum + row.ha, 0),
    managedHa: rows.filter((row) => row.managed).reduce((sum, row) => sum + row.ha, 0),
  }
}
