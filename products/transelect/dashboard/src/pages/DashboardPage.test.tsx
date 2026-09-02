import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'
import { ROUTES, RouterProvider } from '../router'
import {
  makeActiveImport,
  makeOwnerStatus,
  makePending,
  makeReport,
  makeRow,
  makeSummary,
} from '../test/factories'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    getSummary: vi.fn(),
    getPending: vi.fn(),
    getOwnerStatus: vi.fn(),
    getReport: vi.fn(),
    listRows: vi.fn(),
    observedServerNow: vi.fn(() => new Date('2026-09-02T21:10:00Z')),
  }
})

const api = await import('../api')

function page(items = [makeRow()], total = items.length, hasMore = false, cursor: string | null = null) {
  return { ok: true as const, data: { items, next_cursor: cursor, has_more: hasMore, total_count: total } }
}

function stubHappyPath() {
  vi.mocked(api.getSummary).mockResolvedValue({ ok: true, data: makeSummary() })
  vi.mocked(api.getPending).mockResolvedValue({ ok: true, data: makePending() })
  vi.mocked(api.getOwnerStatus).mockResolvedValue({ ok: true, data: makeOwnerStatus() })
  vi.mocked(api.getReport).mockResolvedValue({ ok: true, data: makeReport() })
  vi.mocked(api.listRows).mockResolvedValue(page([makeRow()], 7))
}

function renderDashboard(canPublish = true) {
  render(
    <RouterProvider initialPath={ROUTES.dashboard}>
      <DashboardPage activeImport={makeActiveImport()} canPublish={canPublish} />
    </RouterProvider>,
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    for (const fn of [api.getSummary, api.getPending, api.getOwnerStatus, api.getReport, api.listRows]) {
      vi.mocked(fn).mockReset()
    }
  })

  it('shows a loading state before the first response arrives', async () => {
    stubHappyPath()
    renderDashboard()
    expect(screen.getByText('Cargando el alcance seleccionado…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())
  })

  it('renders every section once the data lands', async () => {
    stubHappyPath()
    renderDashboard()

    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())
    for (const id of [
      'notice-banner',
      'kpi-row',
      'status-hero',
      'reforestation',
      'owner-status',
      'pending-zone',
      'report-panel',
      'rows-body',
      'quality-panel',
      'provenance-footer',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
    expect(screen.getByRole('heading', { name: 'Avance de aprobación' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Preguntas frecuentes' })).toBeInTheDocument()
  })

  it('shows the empty state, not an error, when nothing has been published', async () => {
    const notPublished = {
      ok: false as const,
      status: 404,
      error: 'No hay una versión publicada de Transelec.',
    }
    vi.mocked(api.getSummary).mockResolvedValue(notPublished)
    vi.mocked(api.getPending).mockResolvedValue(notPublished)
    vi.mocked(api.getOwnerStatus).mockResolvedValue(notPublished)
    vi.mocked(api.getReport).mockResolvedValue(notPublished)
    vi.mocked(api.listRows).mockResolvedValue(notPublished)

    renderDashboard()

    await waitFor(() => expect(screen.getByText('Sin versión publicada')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Importar planilla' })).toBeInTheDocument()
    expect(screen.queryByTestId('kpi-row')).not.toBeInTheDocument()
  })

  it('offers no import shortcut from the empty state to a viewer', async () => {
    const notPublished = { ok: false as const, status: 404, error: 'No hay una versión publicada de Transelec.' }
    for (const fn of [api.getSummary, api.getPending, api.getOwnerStatus, api.getReport, api.listRows]) {
      vi.mocked(fn).mockResolvedValue(notPublished as never)
    }

    renderDashboard(false)

    await waitFor(() => expect(screen.getByText('Sin versión publicada')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: 'Importar planilla' })).not.toBeInTheDocument()
  })

  it('shows the unauthorized state for a 403', async () => {
    const forbidden = { ok: false as const, status: 403, error: 'Not permitted for this product.' }
    for (const fn of [api.getSummary, api.getPending, api.getOwnerStatus, api.getReport, api.listRows]) {
      vi.mocked(fn).mockResolvedValue(forbidden as never)
    }

    renderDashboard()
    await waitFor(() => expect(screen.getByText('Sin autorización')).toBeInTheDocument())
  })

  it('shows the platform-unavailable state when the API cannot be reached', async () => {
    const offline = { ok: false as const, status: 0, error: 'No se pudo contactar la plataforma.' }
    for (const fn of [api.getSummary, api.getPending, api.getOwnerStatus, api.getReport, api.listRows]) {
      vi.mocked(fn).mockResolvedValue(offline as never)
    }

    renderDashboard()
    await waitFor(() => expect(screen.getByText('Plataforma no disponible')).toBeInTheDocument())
  })

  it('sends the same filter state to every read endpoint and updates them together (TR-FUNC-017)', async () => {
    stubHappyPath()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())

    vi.mocked(api.getSummary).mockResolvedValue({
      ok: true,
      data: makeSummary({
        pmf_count: 2,
        predio_count: 2,
        avance_por_pmf: { aprobado: 1, en_tramite: 1, pendiente_o_tachado: 0 },
        avance_por_predio: { aprobado: 1, en_tramite: 1, pendiente_o_tachado: 0 },
        estado_resumido_hero_predio: {
          aprobado: 1,
          en_tramite: 1,
          pendiente: 0,
          tachado: 0,
          sin_estado: 0,
        },
      }),
    })
    vi.mocked(api.listRows).mockResolvedValue(page([makeRow()], 2))

    await userEvent.type(screen.getByLabelText('Búsqueda general'), 'rechaz')

    await waitFor(() => expect(screen.getByTestId('kpi-pmf')).toHaveTextContent('2'))

    // One filter state, every section: the KPI row, both donuts, the hero and
    // the table's own total all reflect the same response.
    expect(screen.getByTestId('donut-pmf-total')).toHaveTextContent('1 de 2 PMF aprobados')
    expect(screen.getByTestId('donut-predios-total')).toHaveTextContent('1 de 2 predios aprobados')
    expect(screen.getByTestId('hero-aprobado')).toHaveTextContent('1')
    expect(screen.getByTestId('rows-total')).toHaveTextContent('(2 áreas de corta)')

    const applied = { ...api.EMPTY_FILTERS, q: 'rechaz' }
    expect(api.getSummary).toHaveBeenLastCalledWith(applied)
    expect(api.getPending).toHaveBeenLastCalledWith(applied)
    expect(api.getOwnerStatus).toHaveBeenLastCalledWith(applied)
    expect(api.getReport).toHaveBeenLastCalledWith(applied)
    expect(vi.mocked(api.listRows).mock.lastCall?.[0]).toEqual(applied)
  })

  it('the rejected quick action applies the source’s literal substring search (TR-FUNC-028)', async () => {
    stubHappyPath()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())

    await userEvent.click(screen.getByText('¿Qué expedientes tienen rechazo?'))

    await waitFor(() =>
      expect(api.getSummary).toHaveBeenLastCalledWith({ ...api.EMPTY_FILTERS, q: 'rechaz' }),
    )
    expect(screen.getByLabelText('Búsqueda general')).toHaveValue('rechaz')
  })

  it('the legal quick action applies its own literal substring search (TR-FUNC-029)', async () => {
    stubHappyPath()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())

    await userEvent.click(screen.getByText('¿Dónde está el principal cuello de botella?'))

    await waitFor(() =>
      expect(api.getSummary).toHaveBeenLastCalledWith({ ...api.EMPTY_FILTERS, q: 'legal' }),
    )
  })

  it('the easement quick action selects exactly that owner type (TR-FUNC-026)', async () => {
    stubHappyPath()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())

    await userEvent.click(screen.getByText('¿Cuáles tienen servidumbre?'))

    await waitFor(() =>
      expect(api.getSummary).toHaveBeenLastCalledWith({
        ...api.EMPTY_FILTERS,
        tipo_propietario: ['Servidumbre firmada'],
      }),
    )
  })

  it('the lookup quick action focuses the search box and swaps its placeholder (TR-FUNC-025)', async () => {
    stubHappyPath()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())

    await userEvent.click(screen.getByText('¿A qué PMF corresponde un N.º de ingreso?'))

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText('Escriba el N.º de ingreso para ver su PMF, rol y predio'),
      ).toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Búsqueda general')),
    )
  })

  it('the surface quick action resets the filters and adds no filter of its own (TR-FUNC-027)', async () => {
    stubHappyPath()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())

    // Start from a genuinely filtered state: a test that starts empty cannot
    // tell "resets the filters" apart from "leaves them alone".
    await userEvent.type(screen.getByLabelText('Búsqueda general'), 'legal')
    await waitFor(() =>
      expect(api.getSummary).toHaveBeenLastCalledWith({ ...api.EMPTY_FILTERS, q: 'legal' }),
    )

    await userEvent.click(screen.getByText('¿Cuál es la superficie de corta?'))

    // The source's quick() resets the filters before every branch, surface
    // included — so the filter really is cleared, and nothing else changes.
    await waitFor(() => expect(api.getSummary).toHaveBeenLastCalledWith(api.EMPTY_FILTERS))
    expect(screen.getByLabelText('Búsqueda general')).toHaveValue('')
    expect(screen.getByTestId('kpi-row')).toBeInTheDocument()
  })

  it('the surface quick action introduces no filter when nothing was filtered', async () => {
    stubHappyPath()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())
    const callsBefore = vi.mocked(api.getSummary).mock.calls.length

    await userEvent.click(screen.getByText('¿Cuál es la superficie de corta?'))

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(vi.mocked(api.getSummary).mock.calls.length).toBe(callsBefore)
    expect(screen.getByLabelText('Búsqueda general')).toHaveValue('')
  })

  it('the company quick action opens and focuses the Empresa filter only (TR-FUNC-030)', async () => {
    stubHappyPath()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())

    await userEvent.click(screen.getByText('¿Cómo avanza cada empresa?'))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Empresa' })).toHaveAttribute(
        'aria-expanded',
        'true',
      ),
    )
  })

  it('both reset entry points restore the unfiltered view (TR-FUNC-023)', async () => {
    stubHappyPath()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Búsqueda general'), 'rechaz')
    await waitFor(() =>
      expect(api.getSummary).toHaveBeenLastCalledWith({ ...api.EMPTY_FILTERS, q: 'rechaz' }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar' }))
    await waitFor(() => expect(api.getSummary).toHaveBeenLastCalledWith(api.EMPTY_FILTERS))

    await userEvent.type(screen.getByLabelText('Búsqueda general'), 'legal')
    await waitFor(() =>
      expect(api.getSummary).toHaveBeenLastCalledWith({ ...api.EMPTY_FILTERS, q: 'legal' }),
    )

    // The pending zone's "Volver al total" is the same reset code path.
    await userEvent.click(screen.getByTestId('back-to-total'))
    await waitFor(() => expect(api.getSummary).toHaveBeenLastCalledWith(api.EMPTY_FILTERS))
    expect(screen.getByLabelText('Búsqueda general')).toHaveValue('')
  })

  it('the pending quick action and the pending-zone button share one code path (TR-FUNC-024/032)', async () => {
    stubHappyPath()
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())
    const zone = () => screen.getByTestId('pending-zone')

    await userEvent.type(screen.getByLabelText('Búsqueda general'), 'legal')
    await waitFor(() => expect(screen.getByLabelText('Búsqueda general')).toHaveValue('legal'))
    await userEvent.click(screen.getByText('¿Qué falta presentar a CONAF?'))
    await waitFor(() => expect(zone()).toHaveClass('focused'))
    expect(screen.getByLabelText('Búsqueda general')).toHaveValue('')

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar' }))
    await waitFor(() => expect(zone()).not.toHaveClass('focused'))

    await userEvent.type(screen.getByLabelText('Búsqueda general'), 'legal')
    await userEvent.click(screen.getByTestId('show-pending'))
    await waitFor(() => expect(zone()).toHaveClass('focused'))
    expect(screen.getByLabelText('Búsqueda general')).toHaveValue('')
  })

  it('the overdue quick action lists rows against the observed server clock (TR-FUNC-031)', async () => {
    stubHappyPath()
    vi.mocked(api.listRows).mockResolvedValue(
      page(
        [
          makeRow({ source_row_number: 1, pmf: 'MP-OLD', estado_resumido: 'En tramite', fecha_90_dias: '2026-01-05' }),
          makeRow({ source_row_number: 2, pmf: 'MP-OK', estado_resumido: 'Aprobado', fecha_90_dias: '2026-01-05' }),
          makeRow({ source_row_number: 3, pmf: 'MP-FUTURE', estado_resumido: 'Pendiente', fecha_90_dias: '2027-01-05' }),
        ],
        3,
      ),
    )

    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())

    await userEvent.click(screen.getByText('¿Qué ingresos superaron 90 días?'))

    await waitFor(() => expect(screen.getByTestId('overdue-panel')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('overdue-count')).toHaveTextContent('(1'))

    const panel = within(screen.getByTestId('overdue-panel'))
    expect(panel.getByText('MP-OLD')).toBeInTheDocument()
    expect(panel.queryByText('MP-OK')).not.toBeInTheDocument()
    expect(panel.queryByText('MP-FUTURE')).not.toBeInTheDocument()
    expect(panel.getByText(/02-09-2026/)).toBeInTheDocument()
  })

  it('the overdue panel re-runs against a filter change instead of showing stale rows (TR-FUNC-017/031)', async () => {
    stubHappyPath()
    vi.mocked(api.listRows).mockResolvedValue(
      page(
        [
          makeRow({
            source_row_number: 1,
            pmf: 'MP-ANTES',
            estado_resumido: 'En tramite',
            fecha_90_dias: '2026-01-05',
          }),
        ],
        1,
      ),
    )

    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('kpi-row')).toBeInTheDocument())
    await userEvent.click(screen.getByText('¿Qué ingresos superaron 90 días?'))
    await waitFor(() =>
      expect(within(screen.getByTestId('overdue-panel')).getByText('MP-ANTES')).toBeInTheDocument(),
    )

    // The panel's own copy claims its scope is the active filters, so a
    // filter change must move it too — the rest of the page already has.
    vi.mocked(api.listRows).mockResolvedValue(
      page(
        [
          makeRow({
            source_row_number: 2,
            pmf: 'MP-DESPUES',
            estado_resumido: 'Pendiente',
            fecha_90_dias: '2026-01-05',
          }),
        ],
        1,
      ),
    )
    await userEvent.type(screen.getByLabelText('Búsqueda general'), 'legal')

    await waitFor(() =>
      expect(
        within(screen.getByTestId('overdue-panel')).getByText('MP-DESPUES'),
      ).toBeInTheDocument(),
    )
    const panel = within(screen.getByTestId('overdue-panel'))
    expect(panel.queryByText('MP-ANTES')).not.toBeInTheDocument()
    // And it was re-collected under the new filter state, not the old one.
    expect(vi.mocked(api.listRows).mock.lastCall?.[0]).toEqual({
      ...api.EMPTY_FILTERS,
      q: 'legal',
    })
  })

  it('pages the detail table forward and back with the API’s cursor (TR-FUNC-039)', async () => {
    stubHappyPath()
    vi.mocked(api.listRows).mockResolvedValue(
      page([makeRow({ source_row_number: 1, pmf: 'MP-P1' })], 60, true, 'cursor-2'),
    )

    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('rows-body')).toBeInTheDocument())
    expect(screen.getByTestId('pagination-range')).toHaveTextContent('Mostrando 1–1 de 60')

    vi.mocked(api.listRows).mockResolvedValue(
      page([makeRow({ source_row_number: 30, pmf: 'MP-P2' })], 60, false, null),
    )
    await userEvent.click(screen.getByTestId('page-next'))

    await waitFor(() => expect(screen.getByText('MP-P2')).toBeInTheDocument())
    expect(vi.mocked(api.listRows).mock.lastCall?.[1]).toEqual({ cursor: 'cursor-2', limit: 25 })

    vi.mocked(api.listRows).mockResolvedValue(
      page([makeRow({ source_row_number: 1, pmf: 'MP-P1' })], 60, true, 'cursor-2'),
    )
    await userEvent.click(screen.getByTestId('page-prev'))
    await waitFor(() => expect(screen.getByText('MP-P1')).toBeInTheDocument())
    expect(vi.mocked(api.listRows).mock.lastCall?.[1]).toEqual({ cursor: null, limit: 25 })
  })
})
