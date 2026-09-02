import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_FILTERS } from '../api'
import { FilterPanel } from './FilterPanel'

const options = {
  estado_resumido: ['Aprobado', 'En tramite', 'Pendiente', 'Tachado'],
  empresa: ['Austral', 'Ñuble Forestal'],
  pas: ['PAS 148'],
  sector: ['Norte', 'Sur'],
  tipo_propietario: ['Particular', 'Servidumbre firmada'],
}

const base = {
  filters: EMPTY_FILTERS,
  options,
  optionsLoading: false,
  searchPlaceholder: 'PMF, rol, ingreso, predio…',
  onChange: () => {},
  onReset: () => {},
  onExportCsv: () => {},
  onPrint: () => {},
}

describe('FilterPanel (TR-FUNC-017-023)', () => {
  it('renders the source’s six filter controls', () => {
    render(<FilterPanel {...base} />)
    expect(screen.getByLabelText('Búsqueda general')).toBeInTheDocument()
    for (const label of ['Estado resumido', 'Empresa', 'PAS', 'Sector', 'Tipo de propietario']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
  })

  it('reports free-text search changes to the caller (TR-FUNC-017)', async () => {
    const onChange = vi.fn()
    render(<FilterPanel {...base} onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Búsqueda general'), 'r')
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, q: 'r' })
  })

  it('ORs selections within one multi-select (TR-FUNC-018)', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<FilterPanel {...base} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: /Estado resumido/ }))
    await userEvent.click(screen.getByLabelText('Aprobado'))
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, estado_resumido: ['Aprobado'] })

    rerender(
      <FilterPanel
        {...base}
        filters={{ ...EMPTY_FILTERS, estado_resumido: ['Aprobado'] }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByLabelText('Tachado'))
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTERS,
      estado_resumido: ['Aprobado', 'Tachado'],
    })
  })

  it('keeps different fields independent so the API can AND them (TR-FUNC-019-022)', async () => {
    const onChange = vi.fn()
    render(
      <FilterPanel
        {...base}
        filters={{ ...EMPTY_FILTERS, estado_resumido: ['Aprobado'] }}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Sector/ }))
    await userEvent.click(screen.getByLabelText('Norte'))

    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTERS,
      estado_resumido: ['Aprobado'],
      sector: ['Norte'],
    })
  })

  it('exposes Limpiar, Exportar CSV and Imprimir (TR-FUNC-023/037/038)', async () => {
    const onReset = vi.fn()
    const onExportCsv = vi.fn()
    const onPrint = vi.fn()
    render(<FilterPanel {...base} onReset={onReset} onExportCsv={onExportCsv} onPrint={onPrint} />)

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir / PDF' }))

    expect(onReset).toHaveBeenCalledTimes(1)
    expect(onExportCsv).toHaveBeenCalledTimes(1)
    expect(onPrint).toHaveBeenCalledTimes(1)
  })

  it('shows the swapped placeholder the lookup quick action installs (TR-FUNC-025)', () => {
    render(
      <FilterPanel
        {...base}
        searchPlaceholder="Escriba el N.º de ingreso para ver su PMF, rol y predio"
      />,
    )
    expect(
      screen.getByPlaceholderText('Escriba el N.º de ingreso para ver su PMF, rol y predio'),
    ).toBeInTheDocument()
  })

  it('disables a field with no options and says while the lists are still loading', () => {
    render(
      <FilterPanel
        {...base}
        options={{ ...options, pas: [] }}
        optionsLoading
      />,
    )
    expect(screen.getByRole('button', { name: /PAS/ })).toBeDisabled()
    expect(screen.getByText(/Cargando las opciones de filtro/)).toBeInTheDocument()
  })
})
