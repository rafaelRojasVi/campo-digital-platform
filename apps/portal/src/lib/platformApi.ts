export type ProductKey = 'lidar' | 'forestry' | 'transelect'
export type Role = 'admin' | 'operator' | 'viewer'

export interface ProductGrant {
  product_key: ProductKey
  role: Role
}

export interface Me {
  identity_key: string
  display_name: string
  product_grants: ProductGrant[]
}

export interface UploadResult {
  source_snapshot_id: number
  sha256: string
  byte_size: number
  validation_evidence: Record<string, unknown>
  job_id: number
}

export interface JobView {
  id: number
  product_key: string
  status: string
  attempt_count: number
  created_at: string
  error_summary: string | null
}

export interface AuditEventView {
  id: number
  occurred_at: string
  actor_app_user_id: number | null
  event_type: string
  product_key: string | null
  subject_kind: string | null
  subject_id: string | null
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

export const DEV_IDENTITIES = ['dev-admin', 'dev-operator', 'dev-viewer'] as const

/**
 * All requests go through /api, proxied in dev (see vite.config.ts) to the
 * standalone platform API process started by `make platform-local`. Never
 * throws to the caller: network/parse failures come back as `{ ok: false }`,
 * mirroring runtimeConfig.ts's never-throw-to-the-UI convention.
 */
async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, { credentials: 'include', ...init })

    if (!response.ok) {
      let error = response.statusText || `HTTP ${response.status}`
      try {
        const body = (await response.json()) as { detail?: string }
        if (body.detail) error = body.detail
      } catch {
        // no JSON body on this error response; keep the status-text fallback
      }
      return { ok: false, status: response.status, error }
    }

    if (response.status === 204) {
      return { ok: true, data: undefined as T }
    }

    const data = (await response.json()) as T
    return { ok: true, data }
  } catch {
    return { ok: false, status: 0, error: 'No se pudo contactar la plataforma.' }
  }
}

export function devLogin(identityKey: string): Promise<ApiResult<Me>> {
  return request<Me>('/api/auth/dev-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity_key: identityKey }),
  })
}

export function getMe(): Promise<ApiResult<Me>> {
  return request<Me>('/api/auth/me')
}

export function logout(): Promise<ApiResult<void>> {
  return request<void>('/api/auth/logout', { method: 'POST' })
}

export function uploadFile(productKey: ProductKey, file: File): Promise<ApiResult<UploadResult>> {
  const formData = new FormData()
  formData.append('product_key', productKey)
  formData.append('file', file)
  return request<UploadResult>('/api/ingesta/upload', { method: 'POST', body: formData })
}

export function listJobs(): Promise<ApiResult<JobView[]>> {
  return request<JobView[]>('/api/ingesta/jobs')
}

export function retryJob(jobId: number): Promise<ApiResult<JobView>> {
  return request<JobView>(`/api/ingesta/jobs/${jobId}/retry`, { method: 'POST' })
}

export function getAuditLog(): Promise<ApiResult<AuditEventView[]>> {
  return request<AuditEventView[]>('/api/ingesta/audit')
}
