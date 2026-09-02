/**
 * Transelec dashboard API client.
 *
 * Every value this application renders comes from one of the real,
 * authenticated platform endpoints below. There is deliberately no fixture,
 * demo-data, or client-side workbook-parsing module in this product surface:
 * the ADR-008 synthetic demo app is a separate application in a separate
 * worktree, and TR-FUNC-040's in-browser XLSX reader is replaced end-to-end
 * by the upload -> validate -> publish pipeline (see `/transelec/importar`).
 *
 * Contracts are taken verbatim from the two backend task reports:
 *  - reads (summary/pmfs/pending/owner-status/report/export/imports)  — Task 4
 *  - mutations (uploads/validate-and-project/publish/restore) + CSRF  — Task 3
 *
 * Transport conventions, matching apps/portal/src/lib/platformApi.ts:
 *  - the browser only ever calls same-origin `/api/*`; the dev proxy (and the
 *    hosting rewrite in production) strips the prefix. No base URL, no CORS.
 *  - `credentials: 'include'` so the HttpOnly `campo_session` cookie rides.
 *  - nothing throws to the UI: failures come back as `{ ok: false }`.
 *  - the CSRF token is fetched at runtime from `GET /auth/csrf` and held only
 *    in memory. It is never compiled into this bundle and never read from a
 *    cookie; it is dropped whenever the session may have changed.
 */

// ---------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

export const NETWORK_ERROR = 'No se pudo contactar la plataforma.'

// ---------------------------------------------------------------------------
// Session / identity
// ---------------------------------------------------------------------------

export type Role = 'admin' | 'operator' | 'viewer'

export interface ProductGrant {
  product_key: string
  role: Role
}

export interface Me {
  identity_key: string
  display_name: string
  product_grants: ProductGrant[]
}

// ---------------------------------------------------------------------------
// Read contracts — Task 4 report, section 2
// ---------------------------------------------------------------------------

export interface Bucket3WayCounts {
  aprobado: number
  en_tramite: number
  pendiente_o_tachado: number
}

export interface HeroStateCounts {
  aprobado: number
  en_tramite: number
  pendiente: number
  tachado: number
  sin_estado: number
}

export interface TranselecSummary {
  import_id: number
  row_count: number
  pmf_count: number
  predio_count: number
  rol_count: number
  surface_total: number
  basis_estado_resumido: string
  aprobados_pmf_count: number
  en_tramite_pmf_count: number
  basis_pending_priority: string
  pendientes_prioritarios_pmf_count: number
  con_servidumbre_predio_count: number
  avance_por_predio: Bucket3WayCounts
  avance_por_pmf: Bucket3WayCounts
  estado_resumido_hero_predio: HeroStateCounts
  predios_reforestacion: string[]
  calidad_filas_sin_id_predial_unico: number
  calidad_pmf_sin_numero_ingreso: number
  calidad_numero_resolucion: string
}

/** All 30 A:AD contract fields plus the two derived/technical columns. */
export interface ResumenRow {
  source_row_number: number
  predio_ref: string | null
  rol_ref: string | null
  area_ref: string | null
  pmf: string
  carpeta_source: string | null
  carpeta_normalizada: string | null
  pas: string | null
  estado: string | null
  estado_resumido: string | null
  tipo_rechazo: string | null
  reingreso_tec: string | null
  reingreso_legal: string | null
  reingreso_recrep: string | null
  tipo_propietario: string | null
  id_transelec: string | null
  rol: string | null
  numero_predio: string | null
  numero_area_corta: string | null
  superficie_corta: number | null
  superficie_total_corta: number | null
  fecha_ingreso: string | null
  numero_ingreso: string | null
  fecha_90_dias: string | null
  hoy_raw: string | null
  empresa: string | null
  id_predio_unico_ii: string | null
  id_pmf: string | null
  id_predio_unico: string | null
  predio_group_key: string
  tramite: string | null
  sector: string | null
}

export interface TranselecRowsPage {
  items: ResumenRow[]
  next_cursor: string | null
  has_more: boolean
  total_count: number
}

export interface TranselecPmfDetail {
  pmf: string
  row_count: number
  basis_estado_resumido: string
  estado_resumido: string | null
  rows: ResumenRow[]
}

export type PendingStage = 'preparacion' | 'recurso_rechazo' | 'otros'

export interface PendingStageCounts {
  preparacion: number
  recurso_rechazo: number
  otros: number
}

export type PendingRow = ResumenRow & { pending_stage: PendingStage }

export interface TranselecPending {
  basis: string
  pending_pmf_count: number
  total_pmf_count: number
  pending_pmf_percentage: number
  stage_basis: string
  stages: PendingStageCounts
  rows: PendingRow[]
}

export interface OwnerStatusRow {
  tipo_propietario: string | null
  owner_stage: string | null
  predio_count: number
}

export interface TranselecOwnerStatus {
  basis: string
  total_predio_count: number
  rows: OwnerStatusRow[]
}

export interface TranselecReport {
  generated_at: string
  basis_estado_resumido: string
  basis_pending_priority: string
  text: string
}

export interface TranselecImportHistoryRow {
  publish_event_id: number
  import_id: number
  event_type: 'publish' | 'restore'
  occurred_at: string
  actor_app_user_id: number
  actor_display_name: string | null
  filename: string | null
  sha256: string
  business_rows: number
  distinct_pmf: number
  distinct_provisional_predio_ids: number
  surface_total: number
  is_active: boolean
}

export interface TranselecActiveImport {
  import_id: number
  sha256: string
  byte_size: number
  filename: string | null
  schema_contract_version: string
  parser_version: string
  business_rows: number
  distinct_pmf: number
  distinct_provisional_predio_ids: number
  surface_total: number
  validated_at: string
  published_event_type: 'publish' | 'restore'
  published_at: string
  published_by_app_user_id: number
  published_by_display_name: string | null
}

export interface TranselecRecentRun {
  ingestion_run_id: number
  source_snapshot_id: number
  filename: string | null
  sha256: string
  requested_by_app_user_id: number
  created_at: string
  import_id: number | null
  is_active: boolean
}

// ---------------------------------------------------------------------------
// Mutation contracts — Task 3 report, section 2
// ---------------------------------------------------------------------------

export interface UploadResult {
  source_snapshot_id: number
  sha256: string
  byte_size: number
  validation_evidence: Record<string, unknown>
  job_id: number
}

export type ValidateStatus = 'validated' | 'already_imported' | 'already_current'

export interface ValidateAndProjectResult {
  status: ValidateStatus
  import_id: number
  source_snapshot_id: number
  ingestion_run_id: number
  schema_contract_version: string
  parser_version: string
  business_rows: number
  distinct_pmf: number
  distinct_provisional_predio_ids: number
  surface_total: number
  validated_at: string
  is_active: boolean
}

export interface ActivationResult {
  status: 'published' | 'restored'
  event_type: 'publish' | 'restore'
  import_id: number
  previous_import_id: number | null
  publish_event_id: number
  occurred_at: string
  active_import_id: number
}

// ---------------------------------------------------------------------------
// Filters — TR-FUNC-017-022. One shared contract for every read endpoint, so
// KPIs, charts, hero and tables can never disagree under a filter state.
// ---------------------------------------------------------------------------

export interface TranselecFilterState {
  q: string
  estado_resumido: string[]
  empresa: string[]
  pas: string[]
  sector: string[]
  tipo_propietario: string[]
}

export const EMPTY_FILTERS: TranselecFilterState = {
  q: '',
  estado_resumido: [],
  empresa: [],
  pas: [],
  sector: [],
  tipo_propietario: [],
}

export const MULTISELECT_FIELDS = [
  'estado_resumido',
  'empresa',
  'pas',
  'sector',
  'tipo_propietario',
] as const

export type MultiselectField = (typeof MULTISELECT_FIELDS)[number]

export function filtersActive(filters: TranselecFilterState): boolean {
  return (
    filters.q.trim() !== '' ||
    MULTISELECT_FIELDS.some((field) => filters[field].length > 0)
  )
}

/** Serialize a filter state into the API's repeated-query-param contract. */
export function filterParams(filters: TranselecFilterState): URLSearchParams {
  const params = new URLSearchParams()
  const q = filters.q.trim()
  if (q) params.set('q', q)
  for (const field of MULTISELECT_FIELDS) {
    for (const value of filters[field]) params.append(field, value)
  }
  return params
}

function withParams(path: string, params: URLSearchParams): string {
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const CSRF_REJECTED = 'CSRF verification failed.'
const DEFAULT_CSRF_HEADER = 'X-CSRF-Token'

interface CsrfToken {
  token: string
  headerName: string
}

let csrfToken: CsrfToken | null = null

/**
 * The most recent `Date` response header observed from the platform API.
 *
 * TR-FUNC-031's one mechanical bug fix needs a reference "today" that
 * actually advances, and the source-ingestion rule is that observation time
 * is platform infrastructure, never workbook data. The read API exposes no
 * "server now" endpoint, but every response carries the server's own `Date`
 * header — that is the reference this app uses, so "today" is the API
 * process's clock rather than the viewer's. Null until the first response.
 */
let serverClock: Date | null = null

export function observedServerNow(): Date | null {
  return serverClock
}

/** Test seam: reset the module's cached session/clock observations. */
export function resetApiClientState(): void {
  csrfToken = null
  serverClock = null
}

function rememberServerClock(response: Response): void {
  const header = response.headers.get('date')
  if (!header) return
  const parsed = new Date(header)
  if (!Number.isNaN(parsed.getTime())) serverClock = parsed
}

async function fetchCsrfToken(): Promise<CsrfToken | null> {
  try {
    const response = await fetch('/api/auth/csrf', { credentials: 'include' })
    rememberServerClock(response)
    if (!response.ok) return null
    const body = (await response.json()) as { csrf_token?: string; header_name?: string }
    if (!body.csrf_token) return null
    return { token: body.csrf_token, headerName: body.header_name ?? DEFAULT_CSRF_HEADER }
  } catch {
    return null
  }
}

async function ensureCsrfToken(): Promise<CsrfToken | null> {
  if (csrfToken !== null) return csrfToken
  csrfToken = await fetchCsrfToken()
  return csrfToken
}

function forgetCsrfToken(): void {
  csrfToken = null
}

async function send(path: string, init: RequestInit | undefined): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (SAFE_METHODS.has(method)) {
    const response = await fetch(path, { credentials: 'include', ...init })
    rememberServerClock(response)
    return response
  }

  const token = await ensureCsrfToken()
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) }
  if (token !== null) headers[token.headerName] = token.token

  const response = await fetch(path, { credentials: 'include', ...init, headers })
  rememberServerClock(response)
  return response
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === 'string' && body.detail) return body.detail
  } catch {
    // no JSON body on this error response; fall through to the status text
  }
  return response.statusText || `HTTP ${response.status}`
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    let response = await send(path, init)

    // A cached token can go stale when the session is replaced elsewhere.
    // Refresh and retry exactly once, and only for that specific rejection —
    // an ordinary authorization 403 is not fixable by retrying.
    if (response.status === 403) {
      const error = await readError(response)
      if (error !== CSRF_REJECTED) return { ok: false, status: 403, error }
      forgetCsrfToken()
      response = await send(path, init)
    }

    if (!response.ok) {
      return { ok: false, status: response.status, error: await readError(response) }
    }

    if (response.status === 204) return { ok: true, data: undefined as T }

    const data = (await response.json()) as T
    return { ok: true, data }
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR }
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export function getMe(): Promise<ApiResult<Me>> {
  return request<Me>('/api/auth/me')
}

export function transelecRole(me: Me | null): Role | null {
  if (!me) return null
  const grant = me.product_grants.find((entry) => entry.product_key === 'transelect')
  return grant ? grant.role : null
}

/** OPERATOR/ADMIN gate for the import and version pages (server re-enforces). */
export function canPublish(me: Me | null): boolean {
  const role = transelecRole(me)
  return role === 'admin' || role === 'operator'
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getSummary(filters: TranselecFilterState): Promise<ApiResult<TranselecSummary>> {
  return request<TranselecSummary>(withParams('/api/transelec/summary', filterParams(filters)))
}

export function listRows(
  filters: TranselecFilterState,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<ApiResult<TranselecRowsPage>> {
  const params = filterParams(filters)
  if (options.cursor) params.set('cursor', options.cursor)
  if (options.limit) params.set('limit', String(options.limit))
  return request<TranselecRowsPage>(withParams('/api/transelec/pmfs', params))
}

export function getPmfDetail(pmf: string): Promise<ApiResult<TranselecPmfDetail>> {
  return request<TranselecPmfDetail>(`/api/transelec/pmfs/${encodeURIComponent(pmf)}`)
}

export function getPending(filters: TranselecFilterState): Promise<ApiResult<TranselecPending>> {
  return request<TranselecPending>(withParams('/api/transelec/pending', filterParams(filters)))
}

export function getOwnerStatus(
  filters: TranselecFilterState,
): Promise<ApiResult<TranselecOwnerStatus>> {
  return request<TranselecOwnerStatus>(
    withParams('/api/transelec/owner-status', filterParams(filters)),
  )
}

export function getReport(filters: TranselecFilterState): Promise<ApiResult<TranselecReport>> {
  return request<TranselecReport>(withParams('/api/transelec/report', filterParams(filters)))
}

export function getActiveImport(): Promise<ApiResult<TranselecActiveImport>> {
  return request<TranselecActiveImport>('/api/transelec/imports/active')
}

export function listImportHistory(): Promise<ApiResult<TranselecImportHistoryRow[]>> {
  return request<TranselecImportHistoryRow[]>('/api/transelec/imports')
}

export function listRecentUploads(limit = 20): Promise<ApiResult<TranselecRecentRun[]>> {
  return request<TranselecRecentRun[]>(`/api/transelec/uploads/recent?limit=${limit}`)
}

/**
 * The CSV export URL for the current filter state (TR-FUNC-037).
 *
 * Export is a backend endpoint: the 18-column field set, the `;` delimiter,
 * the UTF-8 BOM, the always-blank reserved column and the formula-injection
 * hardening all live server-side, and the response already carries
 * `Content-Type: text/csv; charset=utf-8` plus an attachment
 * `Content-Disposition`. This app only navigates to that URL — it never
 * assembles CSV text from workbook-derived values itself.
 */
export function exportCsvUrl(filters: TranselecFilterState): string {
  return withParams('/api/transelec/export.csv', filterParams(filters))
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function uploadWorkbook(file: File): Promise<ApiResult<UploadResult>> {
  const formData = new FormData()
  // `product_key` is fixed to `transelect` server-side and is deliberately
  // not sent by this client (Task 3 report, section 2.1).
  formData.append('file', file)
  return request<UploadResult>('/api/transelec/uploads', { method: 'POST', body: formData })
}

export function validateAndProject(
  ingestionRunId: number,
): Promise<ApiResult<ValidateAndProjectResult>> {
  return request<ValidateAndProjectResult>(
    `/api/transelec/imports/${ingestionRunId}/validate-and-project`,
    { method: 'POST' },
  )
}

export function publishImport(importId: number): Promise<ApiResult<ActivationResult>> {
  return request<ActivationResult>(`/api/transelec/imports/${importId}/publish`, { method: 'POST' })
}

export function restoreImport(importId: number): Promise<ApiResult<ActivationResult>> {
  return request<ActivationResult>(`/api/transelec/imports/${importId}/restore`, { method: 'POST' })
}
