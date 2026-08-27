export type WarningSeverity = 'info' | 'warning' | 'blocker'

export interface MeasurementWarning {
  code: string
  severity: WarningSeverity
  message: string
}

export interface MeasurementArtifact {
  kind: string
  path: string
  media_type: string | null
  description: string | null
}

export interface CoordinateMetadata {
  crs_wkt: string | null
  crs_epsg: number | null
  crs_source: string | null
  is_explicit: boolean
  vertical_datum: string | null
  horizontal_units: string | null
}

export type MeasurementReadinessStage =
  | 'not_ready'
  | 'observable_geometry'
  | 'physical_face_area'
  | 'geometric_volume'
  | 'reference_validated'

export interface MeasurementReadiness {
  stage: MeasurementReadinessStage
  pipeline_completed: boolean
  observable_geometry_ready: boolean
  physical_face_area_ready: boolean
  geometric_volume_ready: boolean
  reference_validated: boolean
  blocker_codes: string[]
}

export interface TimberStackSummary {
  localization_mode: string
  point_count_input: number
  point_count_selected: number
  selected_fraction: number
  detected_components: number | null
  longitudinal_coverage: number | null
  vertical_extent_fraction: number | null
  transverse_extent_fraction: number | null
  parameters: Record<string, unknown>
}

export interface FrontCrossSectionSummary {
  longitudinal_span: number
  median_height: number
  maximum_height: number
  rectangle_area: number
  trapezoid_area: number
  valid_bin_fraction: number
  parameters: Record<string, unknown>
}

export interface ProjectedFaceRasterSummary {
  area_source_units_squared: number

  cell_size_u: number
  cell_size_z: number

  raster_rows: number
  raster_cols: number

  u_min: number
  u_max: number
  z_min: number
  z_max: number

  projected_point_count: number

  raw_occupied_cell_count: number
  denoised_occupied_cell_count: number
  retained_component_cell_count: number
  filled_cell_count: number
  component_count: number

  scanline_disagreement_fraction: number | null

  parameters: Record<string, unknown>
}

export interface RecessedRegionSummary {
  rank: number
  cell_count: number

  area_source_units_squared: number

  median_recession_source_units: number
  max_recession_source_units: number

  recession_score_source_units_cubed: number

  u_min: number
  u_max: number
  z_min: number
  z_max: number

  u_centroid: number
  z_centroid: number
}

export interface FrontDepthSummary {
  front_side: string

  cell_size_u: number
  cell_size_z: number

  raster_rows: number
  raster_cols: number

  u_min: number
  u_max: number
  z_min: number
  z_max: number

  projected_point_count: number
  valid_cell_count: number

  surface_scale_u: number
  surface_scale_z: number

  recession_threshold_source_units: number

  candidate_count: number

  front_depth_runtime_seconds: number | null
  recession_runtime_seconds: number | null

  regions: RecessedRegionSummary[]

  parameters: Record<string, unknown>
}

export type FaceAreaUnit =
  | 'source_units_squared'
  | 'square_metres'

export interface FaceAreaReference {
  label: string
  value: number
  unit: FaceAreaUnit
  method: string
  source: string | null
  same_pile_confirmed: boolean
  notes: string | null
}

export interface FaceAreaComparison {
  estimate_method: string
  estimate_value: number
  estimate_unit: FaceAreaUnit

  reference: FaceAreaReference

  comparison_ready: boolean
  blocker_codes: string[]

  signed_error: number | null
  absolute_error: number | null

  relative_error: number | null
  absolute_relative_error: number | null

  percent_error: number | null
  absolute_percent_error: number | null
}

export interface LogDetectionSummary {
  method: string
  candidate_count: number
  parameters: Record<string, unknown>
}

export interface VolumeResult {
  method: string
  volume: number
  volume_unit: 'm3' | 'cubic_units_unspecified'
  point_count_input: number
  point_count_used: number
  parameters: Record<string, unknown>
  warnings: string[]
  runtime_seconds: number
  provenance: Record<string, unknown>
}

export interface MeasurementRun {
  schema_version: string
  run_id: string
  source_path: string
  source_sha256: string | null

  status: 'started' | 'completed' | 'failed'
  readiness: MeasurementReadiness | null

  started_at: string
  completed_at: string | null

  code_version: string | null
  coordinate_metadata: CoordinateMetadata | null

  timber_stack: TimberStackSummary | null
  front_cross_section: FrontCrossSectionSummary | null
  projected_face_raster: ProjectedFaceRasterSummary | null
  front_depth: FrontDepthSummary | null
  face_area_comparison: FaceAreaComparison | null
  log_detection: LogDetectionSummary | null

  results: VolumeResult[]
  reference: ReferenceMeasurement | null

  warnings: MeasurementWarning[]
  artifacts: MeasurementArtifact[]

  provenance: Record<string, unknown>
  notes: string | null
}

export interface ReferenceMeasurement {
  label: string
  value: number
  unit: 'm3' | 'cubic_units_unspecified'
  method: string
  recorded_at: string | null
  notes: string | null
}

export interface VolumeComparison {
  estimate_method: string
  estimate_value: number
  reference: ReferenceMeasurement
  unit: 'm3' | 'cubic_units_unspecified'
  signed_error: number
  absolute_error: number
  relative_error: number | null
  absolute_relative_error: number | null
  percent_error: number | null
  absolute_percent_error: number | null
}

export interface VolumeComparisonRecord {
  schema_version: string
  comparison_id: string
  run_id: string
  estimate_result_index: number
  comparison: VolumeComparison
  created_at: string
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

export function listRuns(): Promise<MeasurementRun[]> {
  return getJson<MeasurementRun[]>('/runs')
}

export function getRun(
  runId: string,
): Promise<MeasurementRun> {
  return getJson<MeasurementRun>(
    `/runs/${encodeURIComponent(runId)}`,
  )
}

export function listComparisons(
  runId: string,
): Promise<VolumeComparisonRecord[]> {
  return getJson<VolumeComparisonRecord[]>(
    `/runs/${encodeURIComponent(runId)}/comparisons`,
  )
}

export function artifactUrl(
  runId: string,
  artifactPath: string,
): string {
  return `/api/runs/${encodeURIComponent(runId)}/artifacts/${artifactPath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
}
