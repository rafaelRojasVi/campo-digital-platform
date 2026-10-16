import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Root from './Root.tsx'
import { reportParam, reportPath } from './router.ts'

vi.mock('./api.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api.ts')>()
  return { ...original, fetchForestryRole: vi.fn() }
})
vi.mock('./App.tsx', () => ({ default: () => <p>mapa-stub</p> }))
vi.mock('./pages/InformesPage.tsx', () => ({ InformesPage: () => <p>informes-stub</p> }))
vi.mock('./pages/InformeEditorPage.tsx', () => ({
  InformeEditorPage: ({ reportId }: { reportId: number | null }) => <p>editor-stub {reportId}</p>,
}))

const api = vi.mocked(await import('./api.ts'))

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchForestryRole.mockResolvedValue('operator')
})

afterEach(() => {
  window.history.replaceState(null, '', '/rodales/')
})

describe('report routes', () => {
  it('parses and builds the editor link', () => {
    expect(reportParam(new URLSearchParams('informe=12'))).toBe(12)
    expect(reportParam(new URLSearchParams('informe=x'))).toBeNull()
    expect(reportPath(12)).toBe('/rodales/informes/editar?informe=12')
  })

  it('routes /rodales/informes to the list', async () => {
    window.history.replaceState(null, '', '/rodales/informes')
    render(<Root />)
    expect(await screen.findByText('informes-stub')).toBeInTheDocument()
  })

  it('routes the editor with its report id', async () => {
    window.history.replaceState(null, '', '/rodales/informes/editar?informe=5')
    render(<Root />)
    expect(await screen.findByText('editor-stub 5')).toBeInTheDocument()
  })
})

vi.mock('./reportsApi.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./reportsApi.ts')>()
  return { ...original, fetchReports: vi.fn(), createReport: vi.fn() }
})

const reportsApi = vi.mocked(await import('./reportsApi.ts'))
const { InformesPage: RealInformesPage } = await vi.importActual<
  typeof import('./pages/InformesPage.tsx')
>('./pages/InformesPage.tsx')

function listedReport(overrides: Partial<import('./reportsApi.ts').Report> = {}) {
  return {
    report_id: 7,
    name: 'Cosecha pino enero 2027',
    report_type: 'cosecha' as const,
    report_month: '2027-01',
    status: 'enviado' as const,
    base_snapshot_id: 3,
    revision: 3,
    created_by_display_name: 'Marco',
    created_at: '2026-10-15T10:00:00Z',
    updated_at: '2026-10-15T10:00:00Z',
    submitted_at: '2026-10-15T10:00:00Z',
    decided_at: null,
    decided_by_display_name: null,
    feature_count: 2,
    managed_feature_count: 1,
    managed_area_ha: 4.05,
    ...overrides,
  }
}

describe('Informes list', () => {
  it('shows reports with status, managed hectares and the pending count', async () => {
    reportsApi.fetchReports.mockResolvedValue({ reports: [listedReport()], pending_review_count: 1 })
    render(<RealInformesPage role="admin" />)
    expect(await screen.findByText('Cosecha pino enero 2027')).toBeInTheDocument()
    expect(screen.getByText('Enviado')).toBeInTheDocument()
    expect(screen.getByText('4,05 ha')).toBeInTheDocument()
    expect(screen.getByText('Pendientes de revisión: 1')).toBeInTheDocument()
  })

  it('creates a report and opens it', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReports.mockResolvedValue({ reports: [], pending_review_count: 0 })
    reportsApi.createReport.mockResolvedValue(9)
    render(<RealInformesPage role="operator" />)
    await user.click(await screen.findByRole('button', { name: 'Nuevo informe' }))
    await user.type(screen.getByLabelText('Nombre'), 'Raleo Purretrun')
    await user.selectOptions(screen.getByLabelText('Tipo'), 'manejo')
    await user.clear(screen.getByLabelText('Mes'))
    await user.type(screen.getByLabelText('Mes'), '2026-12')
    await user.click(screen.getByRole('button', { name: 'Crear informe' }))
    expect(reportsApi.createReport).toHaveBeenCalledWith('Raleo Purretrun', 'manejo', '2026-12')
    expect(window.location.pathname + window.location.search).toBe(
      '/rodales/informes/editar?informe=9',
    )
  })

  it('offers no «Nuevo informe» to a viewer and explains the empty list', async () => {
    reportsApi.fetchReports.mockResolvedValue({ reports: [], pending_review_count: 0 })
    render(<RealInformesPage role="viewer" />)
    expect(await screen.findByText('Aún no hay informes aprobados.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo informe' })).not.toBeInTheDocument()
  })
})
