import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, resetCsrfForTests } from './api.ts'
import {
  createReport,
  deleteReport,
  exportUrl,
  fetchConafSolicitudes,
  fetchReports,
  saveReportFeatures,
  transitionReport,
} from './reportsApi.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  resetCsrfForTests()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function csrfThen(...responses: Response[]): void {
  fetchMock.mockResolvedValueOnce(json({ csrf_token: 't', header_name: 'X-CSRF-Token' }))
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
}

describe('reports API', () => {
  it('lists reports', async () => {
    fetchMock.mockResolvedValueOnce(json({ reports: [], pending_review_count: 2 }))
    await expect(fetchReports()).resolves.toEqual({ reports: [], pending_review_count: 2 })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/forestry/reports')
  })

  it('creates a report with POST and the CSRF header', async () => {
    csrfThen(json({ report_id: 7 }, 201))
    await expect(createReport('Cosecha', 'cosecha', '2027-01')).resolves.toBe(7)
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('/api/forestry/reports')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('t')
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'Cosecha',
      report_type: 'cosecha',
      report_month: '2027-01',
    })
  })

  it('saves features with PUT on the fixed path', async () => {
    csrfThen(json({ revision: 3, feature_count: 1, warnings: [] }))
    await saveReportFeatures(7, 2, [
      { source_feature_ordinal: 1, in_report: true, attributes: {}, geometry: null },
    ])
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('/api/forestry/reports/features')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toMatchObject({ report_id: 7, revision: 2 })
  })

  it('reads a structured error: code, Spanish message and polygon', async () => {
    csrfThen(
      json(
        {
          detail: {
            code: 'split_coverage',
            message: 'Las partes no cubren el rodal.',
            source_feature_ordinal: 4,
          },
        },
        422,
      ),
    )
    const error = await saveReportFeatures(7, 2, []).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 422,
      reason: 'split_coverage',
      detail: 'Las partes no cubren el rodal.',
      sourceFeatureOrdinal: 4,
    })
  })

  it('posts transitions to the action path', async () => {
    csrfThen(json({ report_id: 7, status: 'cambios_solicitados', revision: 4 }))
    await transitionReport(7, 'request-changes', 3, 'Saca el 18.')
    const [url, init] = fetchMock.mock.calls[1] ?? []
    expect(url).toBe('/api/forestry/reports/7/request-changes')
    expect(JSON.parse(String(init?.body))).toEqual({ revision: 3, note: 'Saca el 18.' })
  })

  it('treats 204 as success', async () => {
    csrfThen(new Response(null, { status: 204 }))
    await expect(deleteReport(7)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })

  it('builds export links', () => {
    expect(exportUrl(7, 'shp', 'all')).toBe('/api/forestry/reports/7/export?format=shp&scope=all')
    expect(exportUrl(7, 'csv', 'marked')).toBe(
      '/api/forestry/reports/7/export?format=csv&scope=marked',
    )
  })

  it('reads CONAF in chunks of 500 and keeps the chunks that answered', async () => {
    const numeros = Array.from({ length: 600 }, (_, i) => String(100000 + i))
    fetchMock.mockResolvedValueOnce(json({ solicitudes: [{ numero: '100000' }] }))
    fetchMock.mockResolvedValueOnce(json({ detail: 'boom' }, 500))
    const records = await fetchConafSolicitudes(numeros)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(records.map((record) => record.numero)).toEqual(['100000'])
  })
})
