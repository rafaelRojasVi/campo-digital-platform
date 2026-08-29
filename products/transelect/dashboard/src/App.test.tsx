import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import * as api from './api'
import type {
  PmfDetail,
  PmfListItem,
  TranselecFilterOptions,
  TranselecSnapshotRecord,
  TranselecSummary,
} from './api'

vi.mock('./api')

const mockedApi = vi.mocked(api)

const filters: TranselecFilterOptions = {
  statuses: ['Aprobado', 'Pendiente'],
  sectors: ['Sur'],
  empresas: ['Empresa A'],
  pas: ['PAS 1'],
  tipos_propietario: ['Servidumbre firmada'],
}

const allPmfs: PmfListItem[] = [
  {
    pmf: 'PL001',
    row_count: 3,
    predio_count: 2,
    sectors: ['Sur'],
    empresas: ['Empresa A'],
    statuses: ['Aprobado'],
    surface_total: 6.2,
  },
  {
    pmf: 'PL002',
    row_count: 2,
    predio_count: 1,
    sectors: ['Sur'],
    empresas: ['Empresa A'],
    statuses: ['Pendiente'],
    surface_total: 3.1,
  },
]

const allSummary: TranselecSummary = {
  business_rows: 5,
  distinct_pmf: 2,
  distinct_provisional_predio_ids: 3,
  distinct_roles: 3,
  surface_total: 9.3,
  status_breakdown: [
    ['Aprobado', 3],
    ['Pendiente', 2],
  ],
}

const approvedOnlySummary: TranselecSummary = {
  business_rows: 3,
  distinct_pmf: 1,
  distinct_provisional_predio_ids: 2,
  distinct_roles: 2,
  surface_total: 6.2,
  status_breakdown: [['Aprobado', 3]],
}

const snapshots: TranselecSnapshotRecord[] = [
  {
    source_snapshot_id: 1,
    filename: 'PlanillaMaestra.xlsx',
    media_type: null,
    content_sha256: 'abc123',
    byte_size: 245_000,
    business_rows: 5,
    distinct_pmf: 2,
    distinct_provisional_predio_ids: 3,
    surface_total: 9.3,
    created_at: '2026-08-20T10:00:00Z',
    active: true,
  },
]

const pl001Detail: PmfDetail = {
  pmf: 'PL001',
  row_count: 3,
  statuses: ['Aprobado'],
  predios: [
    {
      provisional_predio_id: 'PL001-152-5-2',
      rows: [
        {
          source_row_number: 2,
          numero_area_corta: '1',
          estado: 'Aprobado',
          estado_resumido: 'Aprobado',
          superficie_corta: 1.2,
          numero_ingreso: '73/38-7/24',
          fecha_ingreso: '2024-04-17',
          rol: '152-5',
          empresa: 'Empresa A',
          sector: 'Sur',
          tramite: 'Servidumbre',
          tipo_propietario: 'Servidumbre firmada',
          pas: 'PAS 1',
          tipo_rechazo: null,
        },
      ],
    },
  ],
}

function isFilteredToApproved(f: api.ActiveFilters): boolean {
  return Boolean(f.status && f.status.includes('Aprobado'))
}

function setupHappyPath() {
  mockedApi.getFilters.mockResolvedValue(filters)
  mockedApi.getSnapshots.mockResolvedValue(snapshots)
  mockedApi.listPmfs.mockImplementation((params = {}) =>
    Promise.resolve(isFilteredToApproved(params) ? [allPmfs[0]] : allPmfs),
  )
  mockedApi.getSummary.mockImplementation((params = {}) =>
    Promise.resolve(isFilteredToApproved(params) ? approvedOnlySummary : allSummary),
  )
  mockedApi.getPmfDetail.mockResolvedValue(pl001Detail)
}

async function selectStatusFilter(status: string) {
  const label = screen.getByText('Estado resumido')
  const field = label.closest('.multi-select')
  if (!field) throw new Error('Estado resumido field not found')
  const trigger = within(field as HTMLElement).getByRole('button')
  await userEvent.click(trigger)
  const option = await within(field as HTMLElement).findByText(status)
  await userEvent.click(option)
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads filters, KPIs and the PMF list on initial render', async () => {
    setupHappyPath()
    render(<App />)

    expect(await screen.findByText('Datos disponibles')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'PL001' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PL002' })).toBeInTheDocument()

    const kpiGrid = screen.getByLabelText('Indicadores principales')
    expect(within(kpiGrid).getByText('2')).toBeInTheDocument()
  })

  it('shows the source-unavailable state when the source cannot be read', async () => {
    mockedApi.getFilters.mockRejectedValue(new Error('workbook inválido'))
    mockedApi.getSnapshots.mockResolvedValue(snapshots)
    mockedApi.listPmfs.mockRejectedValue(new Error('workbook inválido'))
    mockedApi.getSummary.mockRejectedValue(new Error('workbook inválido'))

    render(<App />)

    expect(await screen.findByText('Fuente no disponible')).toBeInTheDocument()
    expect(
      await screen.findByText('No pudimos leer la fuente de Transelec.'),
    ).toBeInTheDocument()
  })

  it('keeps KPIs and the PMF list consistent with the active filter, and clears them together', async () => {
    setupHappyPath()
    render(<App />)

    await screen.findByRole('button', { name: 'PL002' })

    await selectStatusFilter('Aprobado')

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'PL002' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'PL001' })).toBeInTheDocument()

    const kpiGrid = screen.getByLabelText('Indicadores principales')
    await waitFor(() => {
      expect(within(kpiGrid).getByText('1')).toBeInTheDocument()
    })

    const clearButton = screen.getByRole('button', { name: 'Limpiar filtros' })
    expect(clearButton).toBeEnabled()
    await userEvent.click(clearButton)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'PL002' })).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(within(kpiGrid).getByText('2')).toBeInTheDocument()
    })
  })

  it('opens and closes the PMF detail drawer, including via Escape', async () => {
    setupHappyPath()
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'PL001' }))

    const dialog = await screen.findByRole('dialog', { name: 'Detalle PMF PL001' })
    expect(within(dialog).getByText('PL001-152-5-2')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar detalle' }))
    expect(screen.queryByRole('dialog', { name: 'Detalle PMF PL001' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'PL001' }))
    await screen.findByRole('dialog', { name: 'Detalle PMF PL001' })

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Detalle PMF PL001' })).not.toBeInTheDocument()
    })
  })

  it('preserves the mixed-status notice without applying automatic precedence', async () => {
    setupHappyPath()
    mockedApi.getPmfDetail.mockResolvedValue({
      ...pl001Detail,
      statuses: ['Aprobado', 'Pendiente'],
    })

    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'PL001' }))

    expect(
      await screen.findByText(/No se aplica una\s*precedencia automática entre ellos\./),
    ).toBeInTheDocument()
  })

  it('opens and closes the source manager', async () => {
    setupHappyPath()
    render(<App />)
    await screen.findByRole('button', { name: 'PL001' })

    await userEvent.click(screen.getByRole('button', { name: /gestionar fuente/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Fuente de datos Transelec')).toBeInTheDocument()
    expect(within(dialog).getByText('PlanillaMaestra.xlsx')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar administrador' }))
    expect(screen.queryByText('Fuente de datos Transelec')).not.toBeInTheDocument()
  })

  it('keeps the CSV export action available once results are loaded', async () => {
    setupHappyPath()
    render(<App />)
    await screen.findByRole('button', { name: 'PL001' })

    const exportButtons = screen.getAllByRole('button', { name: /exportar/i })
    expect(exportButtons.length).toBeGreaterThan(0)
    for (const button of exportButtons) {
      expect(button).toBeEnabled()
    }
  })
})
