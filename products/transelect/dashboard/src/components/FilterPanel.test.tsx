import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilterPanel } from './FilterPanel'

function renderPanel(overrides: Partial<Parameters<typeof FilterPanel>[0]> = {}) {
  const props = {
    search: '',
    onSearchChange: vi.fn(),
    filters: {
      statuses: ['Aprobado'],
      sectors: [],
      empresas: [],
      pas: [],
      tipos_propietario: [],
    },
    status: [],
    onStatusChange: vi.fn(),
    sector: [],
    onSectorChange: vi.fn(),
    empresa: [],
    onEmpresaChange: vi.fn(),
    pas: [],
    onPasChange: vi.fn(),
    tipoPropietario: [],
    onTipoPropietarioChange: vi.fn(),
    filtersActive: false,
    onClearFilters: vi.fn(),
    ...overrides,
  }
  render(<FilterPanel {...props} />)
  return props
}

describe('FilterPanel', () => {
  it('keeps clear filters disabled and hides the active-count badge with no active filter', () => {
    renderPanel({ filtersActive: false })
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeDisabled()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('enables clear filters and shows an active-count badge once a filter is active', () => {
    renderPanel({ filtersActive: true, status: ['Aprobado'] })
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeEnabled()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('calls onClearFilters when the reset control is used', async () => {
    const user = userEvent.setup()
    const props = renderPanel({ filtersActive: true, search: 'PL001' })
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(props.onClearFilters).toHaveBeenCalledTimes(1)
  })

  it('reports the search value as the user types', async () => {
    const user = userEvent.setup()
    const props = renderPanel()
    await user.type(screen.getByPlaceholderText('Buscar por PMF, predio o rol'), 'PL0')
    expect(props.onSearchChange).toHaveBeenCalledTimes(3)
    expect(props.onSearchChange).toHaveBeenLastCalledWith('0')
  })
})
