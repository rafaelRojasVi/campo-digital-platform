// products/forestry/dashboard/src/demoData.ts
//
// Fully synthetic demo estate: 6 fictitious predios in a local, non-georeferenced
// coordinate grid (storage_srid: 0 — deliberately not a real CRS). No name, code,
// or coordinate here corresponds to any real Campo Digital client. See
// docs/adr/ADR-008-hosted-demo-data-v1.md.
import type {
  FeatureCollection,
  ForestrySnapshot,
  GeoFeature,
  SnapshotSummary,
  SourceFeatureDetail,
  SourceFieldComparison,
} from './types'

function rectangle(x0: number, y0: number, x1: number, y1: number): number[][][][] {
  return [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]]
}

// P5 is an L-shape: a 400x300 block with a 150x150 notch removed from its
// top-right corner (both rings share the multipolygon's single polygon here
// as one non-rectangular ring rather than two rings, since it's a single
// simple concave polygon, not a polygon-with-hole).
const P5_L_SHAPE: number[][][][] = [
  [
    [
      [350, 350],
      [750, 350],
      [750, 500],
      [600, 500],
      [600, 650],
      [350, 650],
      [350, 350],
    ],
  ],
]

interface DemoFeatureSpec {
  ordinal: number
  objectId: number
  codPredial: string
  nomPredio: string
  nRodal: string
  codUso: string
  uso2024: string
  descUso: string
  uso2026: string
  codUso2026: string
  coordinates: number[][][][]
  geometryValid: boolean
  qualityFlags: string[]
}

// A precise (non-index-signature) object type, rather than Record<string, string>,
// so that USE_LABELS.BN/PL/AG resolve to `string` (not `string | undefined`) under
// this project's `noUncheckedIndexedAccess` tsconfig setting. Same three labels the
// brief specifies; only the type annotation differs.
const USE_LABELS: { BN: string; PL: string; AG: string } = {
  BN: 'Bosque nativo',
  PL: 'Plantación forestal',
  AG: 'Uso agrícola',
}

const SPECS: DemoFeatureSpec[] = [
  {
    ordinal: 0,
    objectId: 1001,
    codPredial: 'DEMO-01',
    nomPredio: 'Predio Los Aromos',
    nRodal: 'R1',
    codUso: 'BN',
    uso2024: 'BN',
    descUso: USE_LABELS.BN,
    uso2026: 'BN',
    codUso2026: 'BN',
    coordinates: rectangle(0, 0, 400, 300),
    geometryValid: true,
    qualityFlags: [],
  },
  {
    ordinal: 1,
    objectId: 1002,
    codPredial: 'DEMO-02',
    nomPredio: 'Predio El Sauce',
    nRodal: 'R1',
    codUso: 'PL',
    uso2024: 'PL',
    descUso: USE_LABELS.PL,
    uso2026: 'PL',
    codUso2026: 'PL',
    coordinates: rectangle(450, 0, 800, 300),
    geometryValid: true,
    qualityFlags: [],
  },
  {
    ordinal: 2,
    objectId: 1003,
    codPredial: 'DEMO-03',
    nomPredio: 'Predio Vista Hermosa',
    nRodal: 'R1',
    codUso: 'BN',
    uso2024: 'BN',
    descUso: USE_LABELS.PL,
    uso2026: 'PL',
    codUso2026: 'PL',
    coordinates: rectangle(850, 0, 1300, 250),
    geometryValid: true,
    qualityFlags: [],
  },
  {
    ordinal: 3,
    objectId: 1004,
    codPredial: 'DEMO-04',
    nomPredio: 'Predio Las Rosas',
    nRodal: 'R1',
    codUso: 'PL',
    uso2024: 'PL',
    descUso: USE_LABELS.PL,
    uso2026: 'PL',
    codUso2026: 'PL',
    coordinates: rectangle(0, 350, 300, 650),
    geometryValid: true,
    qualityFlags: [],
  },
  {
    ordinal: 4,
    objectId: 1005,
    codPredial: 'DEMO-05',
    nomPredio: 'Predio Alto Verde',
    nRodal: 'R2',
    codUso: 'AG',
    uso2024: 'AG',
    descUso: USE_LABELS.AG,
    uso2026: 'AG',
    codUso2026: 'AG',
    coordinates: P5_L_SHAPE,
    geometryValid: true,
    qualityFlags: [],
  },
  {
    ordinal: 5,
    objectId: 1006,
    codPredial: 'DEMO-06',
    nomPredio: 'Predio Mirador del Bosque',
    nRodal: 'R1',
    codUso: 'BN',
    uso2024: 'BN',
    descUso: USE_LABELS.BN,
    uso2026: 'BN',
    codUso2026: 'BN',
    coordinates: rectangle(800, 300, 1300, 650),
    geometryValid: false,
    qualityFlags: ['duplicate_predio_rodal_key'],
  },
]

function shoelaceArea(ring: number[][]): number {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i += 1) {
    // Non-null: `i` and `i + 1` are both within `ring`'s bounds by the loop
    // condition. Assertions are needed only because of this project's
    // `noUncheckedIndexedAccess` tsconfig setting; the arithmetic is
    // unchanged from the brief.
    const [x1, y1] = ring[i]!
    const [x2, y2] = ring[i + 1]!
    sum += x1! * y2! - x2! * y1!
  }
  return Math.abs(sum) / 2
}

function featureArea(spec: DemoFeatureSpec): number {
  // Non-null: every spec's `coordinates` is a non-empty MultiPolygon literal
  // defined above (`rectangle(...)` or `P5_L_SHAPE`), so index 0 always exists.
  return spec.coordinates[0]!.reduce((total, ring) => total + shoelaceArea(ring), 0)
}

function toFeature(spec: DemoFeatureSpec): GeoFeature {
  const areaSquareUnits = featureArea(spec)
  return {
    type: 'Feature',
    properties: {
      feature_ordinal: spec.ordinal,
      source_objectid: spec.objectId,
      cod_predial: spec.codPredial,
      nom_predio: spec.nomPredio,
      n_rodal: spec.nRodal,
      cod_uso: spec.codUso,
      uso_2024: spec.uso2024,
      desc_uso: spec.descUso,
      uso_2026: spec.uso2026,
      cod_uso_2026: spec.codUso2026,
      sup_ha: areaSquareUnits / 10000,
      geometry_is_valid: spec.geometryValid,
      geometry_area_source_units: areaSquareUnits,
      quality_flags: spec.qualityFlags,
    },
    geometry: { type: 'MultiPolygon', coordinates: spec.coordinates },
  }
}

const FEATURES: GeoFeature[] = SPECS.map(toFeature)

export const DEMO_SNAPSHOT: ForestrySnapshot = {
  shapefile_snapshot_id: 1,
  layer_name: 'predios_demo',
  family_fingerprint: 'demo-fixture-v1',
  storage_srid: 0,
  feature_count: FEATURES.length,
  created_at: '2026-08-15T00:00:00Z',
}

const totalArea = FEATURES.reduce((sum, f) => sum + f.properties.geometry_area_source_units, 0)
const invalidCount = FEATURES.filter((f) => !f.properties.geometry_is_valid).length

export const DEMO_SUMMARY: SnapshotSummary = {
  shapefile_snapshot_id: DEMO_SNAPSHOT.shapefile_snapshot_id,
  layer_name: DEMO_SNAPSHOT.layer_name,
  family_fingerprint: DEMO_SNAPSHOT.family_fingerprint,
  storage_srid: DEMO_SNAPSHOT.storage_srid,
  bbox: [0, 0, 1300, 650],
  feature_count: FEATURES.length,
  total_geometry_area_source_units: totalArea,
  total_sup_ha: totalArea / 10000,
  geometry_valid_count: FEATURES.length - invalidCount,
  geometry_invalid_count: invalidCount,
  quality_flag_counts: { duplicate_predio_rodal_key: 1 },
  n_rodal_te_non_blank_count: FEATURES.length,
  created_at: DEMO_SNAPSHOT.created_at,
}

export const DEMO_COLLECTION: FeatureCollection = {
  type: 'FeatureCollection',
  shapefile_snapshot_id: DEMO_SNAPSHOT.shapefile_snapshot_id,
  storage_srid: DEMO_SNAPSHOT.storage_srid,
  feature_count: FEATURES.length,
  features: FEATURES,
}

export const DEMO_COMPARISON: SourceFieldComparison = {
  shapefile_snapshot_id: DEMO_SNAPSHOT.shapefile_snapshot_id,
  semantics: 'Comparación sintética de demostración entre uso 2024 y uso 2026.',
  uso_2024_vs_uso_2026: {
    changed_feature_count: 1,
    changes: [
      { feature_ordinal: 2, source_objectid: 1003, before: 'BN', after: 'PL' },
    ],
  },
  cod_uso_vs_cod_uso_2026: {
    changed_feature_count: 1,
    changes: [
      { feature_ordinal: 2, source_objectid: 1003, before: 'BN', after: 'PL' },
    ],
  },
}

export function demoFeatureDetail(featureOrdinal: number): SourceFeatureDetail | null {
  const feature = FEATURES.find((f) => f.properties.feature_ordinal === featureOrdinal)
  if (!feature) return null

  return {
    ...feature.properties,
    shapefile_snapshot_id: DEMO_SNAPSHOT.shapefile_snapshot_id,
    storage_srid: DEMO_SNAPSHOT.storage_srid,
    shape_area: feature.properties.geometry_area_source_units,
    geometry_invalid_reason: feature.properties.geometry_is_valid
      ? null
      : 'Geometría de demostración marcada inválida para exhibir el panel de calidad.',
    source_attributes: {},
    geometry: feature.geometry,
  }
}
