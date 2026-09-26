import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AefPage } from './AefPage'
import { EMPTY_FILTERS, type TranselecAef } from '../api'
import type { FilterController } from '../lib/useFilters'
import { ROUTES, RouterProvider } from '../router'
import { makeRow } from '../test/factories'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, getAef: vi.fn(), getPmfDetail: vi.fn() }
})

const { getAef, getPmfDetail } = await import('../api')

const controller: FilterController = {
  filters: EMPTY_FILTERS,
  draftQuery: '',
  setQuery: () => {},
  setField: () => {},
  replaceFilters: () => {},
  reset: () => {},
}

const ALL_FIELDS = ['aef', 'quien_solicita', 'fecha_solicitud', 'fecha_corta', 'fecha_termino']

function aef(overrides: Partial<TranselecAef> = {}): TranselecAef {
  return {
    basis: 'row_level_source_values',
    source_fields: ALL_FIELDS,
    row_count: 5,
    pmf_count: 3,
    rows_with_any_tracking: 2,
    rows_with_aef: 2,
    rows_with_quien_solicita: 1,
    rows_with_fecha_solicitud: 2,
    rows_with_fecha_corta: 2,
    rows_with_fecha_termino: 2,
    pmf_with_aef: 1,
    pmf_with_partial_aef: 1,
    rows_with_chronology_warning: 1,
    por_aef: [
      { label: 'Presentado', count: 1 },
      { label: 'Solicitado, se puede cortar', count: 1 },
    ],
    por_solicitante: [
      { label: 'Persona A', count: 1 },
      { label: null, count: 1 },
    ],
    pmf_coverage: [{ pmf: 'MP001', total_rows: 3, rows_with_aef: 2, rows_with_any_tracking: 2 }],
    rows: [
      makeRow({
        source_row_number: 2,
        pmf: 'MP001',
        aef: 'Presentado',
        quien_solicita: 'Persona A',
        fecha_solicitud: '2026-07-03',
        fecha_corta: '2026-07-09',
        fecha_termino: '2026-09-01',
      }),
      makeRow({
        source_row_number: 3,
        pmf: 'MP001',
        aef: 'Solicitado, se puede cortar',
        fecha_solicitud: '2026-08-20',
        fecha_corta: '2026-08-19',
        fecha_termino: '2026-09-01',
        chronology_flags: ['cronologia_corta_antes_de_solicitud'],
      }),
    ],
    ...overrides,
  }
}

function renderPage(sourceFields: string[] | null = ALL_FIELDS) {
  render(
    <RouterProvider initialPath={ROUTES.aef}>
      <AefPage filterController={controller} sourceFields={sourceFields} />
    </RouterProvider>,
  )
}

describe('AefPage', () => {
  beforeEach(() => {
    vi.mocked(getAef).mockReset()
    vi.mocked(getPmfDetail).mockReset()
  })

  it('counts rows, calls out partial PMF coverage, and keeps blanks blank', async () => {
    vi.mocked(getAef).mockResolvedValue({ ok: true, data: aef() })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('aef-kpis')).toBeInTheDocument())
    expect(screen.getByTestId('kpi-aef-rows')).toHaveTextContent('2 de 5')
    expect(screen.getByTestId('kpi-aef-pmf')).toHaveTextContent('1 de 3')
    expect(screen.getByText('1 con AEF solo en parte de sus filas')).toBeInTheDocument()
    expect(screen.getByText('Registro por fila, no por PMF')).toBeInTheDocument()

    const second = screen.getByTestId('aef-row-3')
    expect(second).toHaveTextContent('Sin solicitante')
    expect(second).toHaveTextContent('19-08-2026')
    expect(second).toHaveTextContent('Fecha corta anterior a la solicitud')

    expect(within(screen.getByTestId('aef-by-requester')).getByText('Sin solicitante')).toBeTruthy()
    expect(within(screen.getByTestId('aef-coverage')).getByText('Parcial')).toBeTruthy()
  })

  it('says the version has no AEF columns instead of reporting zero AEF rows', async () => {
    vi.mocked(getAef).mockResolvedValue({
      ok: true,
      data: aef({ source_fields: [], rows: [], rows_with_aef: 0, rows_with_any_tracking: 0 }),
    })
    renderPage([])

    await waitFor(() =>
      expect(screen.getByText('Esta versión no incluye columnas AEF')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('aef-kpis')).not.toBeInTheDocument()
  })

  it('opens the row drawer, which never borrows AEF from a sibling row', async () => {
    vi.mocked(getAef).mockResolvedValue({ ok: true, data: aef() })
    vi.mocked(getPmfDetail).mockResolvedValue({
      ok: true,
      data: {
        pmf: 'MP001',
        row_count: 3,
        basis_estado_resumido: 'estado_resumido_first_row',
        estado_resumido: 'Aprobado',
        rows: [
          makeRow({ source_row_number: 2, pmf: 'MP001', aef: 'Presentado' }),
          makeRow({ source_row_number: 3, pmf: 'MP001', aef: 'Solicitado, se puede cortar' }),
          makeRow({ source_row_number: 4, pmf: 'MP001', aef: null }),
        ],
      },
    })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('aef-row-3')).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('aef-row-3'))

    const drawer = await screen.findByTestId('drawer-aef')
    expect(drawer).toHaveTextContent('Fechas a revisar en la planilla')
    expect(drawer).toHaveTextContent('Quién solicitaSin registro en esta fila')
    await waitFor(() =>
      expect(screen.getByTestId('drawer-aef-coverage')).toHaveTextContent(
        '2 de 3 filas de MP001 tienen registro AEF.',
      ),
    )
  })
})
