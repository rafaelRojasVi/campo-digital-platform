/**
 * What a report changes, in words a reviewer reads without GIS: one item per
 * base polygon («Rodal 17 dividido en 2», «Rodal 21 agregado completo»),
 * with hectares, the management mark and edited fields.
 */
import { EDITABLE_ATTRIBUTES } from './reportDraft.ts'
import type { Attributes } from '../reportsApi.ts'

export interface ChangeItem {
  ordinal: number
  title: string
  detail: string
}

interface FeatureLike {
  source_feature_ordinal: number
  in_report: boolean
  geometry_changed: boolean
  attributes: Attributes
}

interface SourceLike {
  source_feature_ordinal: number
  attributes: Attributes
}

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function hectares(attributes: Attributes): string {
  return `${ha.format(Number(attributes.sup_ha ?? 0))} ha`
}

function text(value: Attributes[string] | undefined): string | null {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function sourceName(source: SourceLike | undefined, ordinal: number): string {
  const rodal = text(source?.attributes.n_rodal)
  if (rodal !== null) return `Rodal ${rodal}`
  const objectid = text(source?.attributes.objectid)
  return `Polígono ${objectid ?? ordinal}`
}

export function describeChanges(features: FeatureLike[], sources: SourceLike[]): ChangeItem[] {
  const bySource = new Map(sources.map((source) => [source.source_feature_ordinal, source]))
  const groups = new Map<number, FeatureLike[]>()
  for (const feature of features) {
    const group = groups.get(feature.source_feature_ordinal) ?? []
    group.push(feature)
    groups.set(feature.source_feature_ordinal, group)
  }

  const items: ChangeItem[] = []
  for (const [ordinal, group] of groups) {
    const source = bySource.get(ordinal)
    const name = sourceName(source, ordinal)
    if (group.length > 1) {
      const ordered = [...group].sort((a, b) => Number(b.in_report) - Number(a.in_report))
      items.push({
        ordinal,
        title: `${name} dividido en ${group.length}`,
        detail: ordered
          .map((piece) => {
            const code = text(piece.attributes.n_rodal) ?? 'sin rodal'
            const mark = piece.in_report ? ', área de manejo' : ''
            return `${code} (${hectares(piece.attributes)}${mark})`
          })
          .join(' · '),
      })
      continue
    }
    const [feature] = group
    if (feature === undefined) continue
    const parts = [hectares(feature.attributes)]
    if (feature.in_report) parts.push('área de manejo')
    for (const { key, label } of EDITABLE_ATTRIBUTES) {
      const before = text(source?.attributes[key])
      const after = text(feature.attributes[key])
      if (before !== after) parts.push(`${label}: «${before ?? ''}» → «${after ?? ''}»`)
    }
    items.push({ ordinal, title: `${name} agregado completo`, detail: parts.join(' · ') })
  }
  return items
}
