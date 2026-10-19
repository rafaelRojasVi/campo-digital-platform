import { NO_SPECIES_GROUP, speciesGroup } from './species.ts'

/** «Pino radiata», or the base's own use when the code names no species. */
export function rodalKind(attributes: Record<string, unknown>): string {
  const raw = attributes.cod_uso_2026 ?? attributes.cod_uso
  const group = speciesGroup(raw === null || raw === undefined ? null : String(raw))
  const use = String(attributes.uso_2026 ?? attributes.desc_uso ?? '').trim()
  if (group.key === NO_SPECIES_GROUP.key && use !== '') {
    return use.charAt(0).toUpperCase() + use.slice(1).toLowerCase()
  }
  return group.label
}
