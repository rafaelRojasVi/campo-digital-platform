/**
 * The report being edited, as an immutable value: every operation returns a
 * new draft, so undo/redo is a stack of drafts (history.ts).
 *
 * Untouched polygons are sent without geometry (the server copies the base
 * exactly); split pieces carry their coordinates. After a split with a
 * chosen managed part there are exactly two features for that rodal: the
 * managed union with the next free code (17 → 17-1) and the rest, which
 * keeps the code (Javier, 2026-10-15).
 */
import { multiPolygonAreaSquareMeters } from './draftGeometry.ts'
import { unionPieces, type Coordinates } from './splitGeometry.ts'
import type { Attributes, ReportDetail, SaveFeatureInput } from '../reportsApi.ts'

/** What the web may change, with each field's DBF width in UTF-8 bytes. */
export const EDITABLE_ATTRIBUTES: { key: string; label: string; bytes: number }[] = [
  { key: 'n_rodal', label: 'N.º rodal', bytes: 10 },
  { key: 'cod_uso', label: 'Código de uso', bytes: 25 },
  { key: 'uso_2026', label: 'Uso 2026', bytes: 50 },
  { key: 'cod_uso_2026', label: 'Código de uso 2026', bytes: 25 },
  { key: 'uso_2024', label: 'Uso 2024', bytes: 50 },
  { key: 'desc_uso', label: 'Descripción', bytes: 50 },
  { key: 'n_rodal_te', label: 'N_Rodal_te', bytes: 3 },
]

const EDITABLE_KEYS = new Set(EDITABLE_ATTRIBUTES.map((attribute) => attribute.key))

export interface DraftFeature {
  key: string
  source_feature_ordinal: number
  in_report: boolean
  geometry_changed: boolean
  /** Everything shown in the panel (base values with the edits applied). */
  attributes: Attributes
  /** Editable values that differ from the base polygon (what is sent). */
  edits: Record<string, string | null>
  coordinates: Coordinates
  /** Per-polygon planning fields (migration 0018). */
  sector: string | null
  reforest_species: string[] | null
  reforest_density: number | null
}

export interface ReportDraft {
  features: DraftFeature[]
  nextKey: number
}

export interface PasteSource {
  ordinal: number
  attributes: Attributes
  coordinates: Coordinates
}

function textValue(value: Attributes[string] | undefined): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

export function featureCode(feature: { attributes: Attributes }): string | null {
  return textValue(feature.attributes.n_rodal)
}

export function draftFromDetail(detail: ReportDetail): ReportDraft {
  const base = new Map(detail.sources.map((source) => [source.source_feature_ordinal, source]))
  const features = detail.features.map((feature, index): DraftFeature => {
    const source = base.get(feature.source_feature_ordinal)
    const edits: Record<string, string | null> = {}
    for (const key of EDITABLE_KEYS) {
      const value = textValue(feature.attributes[key])
      if (source !== undefined && value !== textValue(source.attributes[key])) edits[key] = value
    }
    return {
      key: `f${index + 1}`,
      source_feature_ordinal: feature.source_feature_ordinal,
      in_report: feature.in_report,
      geometry_changed: feature.geometry_changed,
      attributes: feature.attributes,
      edits,
      coordinates: feature.geometry.coordinates,
      sector: feature.sector ?? null,
      reforest_species: feature.reforest_species ?? null,
      reforest_density: feature.reforest_density ?? null,
    }
  })
  return { features, nextKey: features.length + 1 }
}

export function pasteSources(
  draft: ReportDraft,
  sources: PasteSource[],
): { draft: ReportDraft; added: number; skipped: number } {
  const present = new Set(draft.features.map((feature) => feature.source_feature_ordinal))
  let nextKey = draft.nextKey
  const added: DraftFeature[] = []
  let skipped = 0
  for (const source of sources) {
    if (present.has(source.ordinal)) {
      skipped += 1
      continue
    }
    present.add(source.ordinal)
    added.push({
      key: `f${nextKey}`,
      source_feature_ordinal: source.ordinal,
      // A rodal is added to be managed (2026-10-19 walkthrough: an unmarked
      // addition read as «not in the report»). Only the rest of a split is
      // left outside the management area.
      in_report: true,
      geometry_changed: false,
      attributes: { ...source.attributes },
      edits: {},
      coordinates: source.coordinates,
      sector: null,
      reforest_species: null,
      reforest_density: null,
    })
    nextKey += 1
  }
  return {
    draft: { features: [...draft.features, ...added], nextKey },
    added: added.length,
    skipped,
  }
}

/** Root code without a «-N» suffix: «17-1» → «17». */
function rootCode(code: string): string {
  return code.replace(/-\d+$/, '')
}

export function nextRodalCode(code: string | null, draft: ReportDraft): string | null {
  if (code === null || code.trim() === '') return null
  const root = rootCode(code)
  const taken = new Set(draft.features.map((feature) => featureCode(feature)))
  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const candidate = `${root}-${suffix}`
    if (new TextEncoder().encode(candidate).length > 10) return code
    if (!taken.has(candidate)) return candidate
  }
  return code
}

function withArea(attributes: Attributes, coordinates: Coordinates): Attributes {
  const area = multiPolygonAreaSquareMeters(coordinates)
  return { ...attributes, sup_ha: area / 10_000, shape_area: area }
}

/**
 * Replace the feature `key` by the result of a split. `managed` lists the
 * indexes of the pieces chosen as «área de manejo».
 */
export function applySplit(
  draft: ReportDraft,
  key: string,
  pieces: Coordinates[],
  managed: number[],
): ReportDraft {
  const index = draft.features.findIndex((feature) => feature.key === key)
  const feature = draft.features[index]
  if (feature === undefined || pieces.length < 2) return draft

  const chosen = new Set(managed.filter((piece) => piece >= 0 && piece < pieces.length))
  if (chosen.size === pieces.length) {
    return replaceAt(draft, index, [{ ...feature, in_report: true }], draft.nextKey)
  }

  let nextKey = draft.nextKey
  const makeKey = () => {
    const made = `f${nextKey}`
    nextKey += 1
    return made
  }

  if (chosen.size === 0) {
    const kept = pieces.map(
      (coordinates): DraftFeature => ({
        ...feature,
        key: makeKey(),
        in_report: false,
        geometry_changed: true,
        attributes: withArea(feature.attributes, coordinates),
        coordinates,
        // DECISION (2026-10-19): split pieces inherit planning fields from parent.
        sector: feature.sector,
        reforest_species: feature.reforest_species,
        reforest_density: feature.reforest_density,
      }),
    )
    return replaceAt(draft, index, kept, nextKey)
  }

  const managedCoordinates = unionPieces(pieces.filter((_, piece) => chosen.has(piece)))
  const restCoordinates = unionPieces(pieces.filter((_, piece) => !chosen.has(piece)))
  const code = nextRodalCode(featureCode(feature), draft)
  const managedFeature: DraftFeature = {
    ...feature,
    key: makeKey(),
    in_report: true,
    geometry_changed: true,
    attributes: withArea({ ...feature.attributes, n_rodal: code }, managedCoordinates),
    edits: code === featureCode(feature) ? feature.edits : { ...feature.edits, n_rodal: code },
    coordinates: managedCoordinates,
    // DECISION (2026-10-19): split pieces inherit planning fields from parent.
    sector: feature.sector,
    reforest_species: feature.reforest_species,
    reforest_density: feature.reforest_density,
  }
  const restFeature: DraftFeature = {
    ...feature,
    key: makeKey(),
    in_report: false,
    geometry_changed: true,
    attributes: withArea(feature.attributes, restCoordinates),
    coordinates: restCoordinates,
    sector: feature.sector,
    reforest_species: feature.reforest_species,
    reforest_density: feature.reforest_density,
  }
  return replaceAt(draft, index, [managedFeature, restFeature], nextKey)
}

function replaceAt(
  draft: ReportDraft,
  index: number,
  replacement: DraftFeature[],
  nextKey: number,
): ReportDraft {
  return {
    features: [
      ...draft.features.slice(0, index),
      ...replacement,
      ...draft.features.slice(index + 1),
    ],
    nextKey,
  }
}

function updateFeature(
  draft: ReportDraft,
  key: string,
  change: (feature: DraftFeature) => DraftFeature,
): ReportDraft {
  return {
    ...draft,
    features: draft.features.map((feature) => (feature.key === key ? change(feature) : feature)),
  }
}

export function toggleInReport(draft: ReportDraft, key: string): ReportDraft {
  return updateFeature(draft, key, (feature) => ({ ...feature, in_report: !feature.in_report }))
}

export interface PlanningFields {
  sector: string | null
  reforest_species: string[] | null
  reforest_density: number | null
}

/**
 * Apply planning fields to all features whose keys are in the set.
 * Fields left undefined in the patch are not changed.
 */
export function setPlanningFields(
  draft: ReportDraft,
  keys: Set<string>,
  fields: Partial<PlanningFields>,
): ReportDraft {
  if (keys.size === 0) return draft
  return {
    ...draft,
    features: draft.features.map((feature) => {
      if (!keys.has(feature.key)) return feature
      return {
        ...feature,
        sector: 'sector' in fields ? (fields.sector ?? null) : feature.sector,
        reforest_species:
          'reforest_species' in fields
            ? (fields.reforest_species ?? null)
            : feature.reforest_species,
        reforest_density:
          'reforest_density' in fields
            ? (fields.reforest_density ?? null)
            : feature.reforest_density,
      }
    }),
  }
}

/**
 * Change one editable attribute. `baseValue` is the base polygon's value:
 * an edit back to it is no longer an edit.
 */
export function setAttribute(
  draft: ReportDraft,
  key: string,
  name: string,
  value: string,
  baseValue: string | null,
): ReportDraft {
  if (!EDITABLE_KEYS.has(name)) return draft
  const clean = value.trim() === '' ? null : value.trim()
  return updateFeature(draft, key, (feature) => {
    const edits = { ...feature.edits }
    if (clean === baseValue) delete edits[name]
    else edits[name] = clean
    return { ...feature, attributes: { ...feature.attributes, [name]: clean }, edits }
  })
}

export function removeSources(draft: ReportDraft, ordinals: number[]): ReportDraft {
  const removed = new Set(ordinals)
  return {
    ...draft,
    features: draft.features.filter((feature) => !removed.has(feature.source_feature_ordinal)),
  }
}

export function toSaveFeatures(draft: ReportDraft): SaveFeatureInput[] {
  return draft.features.map((feature) => ({
    source_feature_ordinal: feature.source_feature_ordinal,
    in_report: feature.in_report,
    attributes: feature.edits,
    geometry: feature.geometry_changed
      ? { type: 'MultiPolygon', coordinates: feature.coordinates }
      : null,
    sector: feature.sector,
    reforest_species: feature.reforest_species,
    reforest_density: feature.reforest_density,
  }))
}

export function draftSummary(draft: ReportDraft): {
  count: number
  managedCount: number
  managedHa: number
} {
  const managed = draft.features.filter((feature) => feature.in_report)
  return {
    count: draft.features.length,
    managedCount: managed.length,
    managedHa: managed.reduce((total, feature) => total + Number(feature.attributes.sup_ha ?? 0), 0),
  }
}
