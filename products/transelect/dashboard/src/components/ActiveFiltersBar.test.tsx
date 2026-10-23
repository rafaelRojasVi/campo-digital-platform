import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_FILTERS, type TranselecFilterState } from '../api'
import type { FilterController } from '../lib/useFilters'
import { ActiveFiltersBar } from './ActiveFiltersBar'

function controller(filters: Partial<TranselecFilterState>): FilterController {
  return {
    filters: { ...EMPTY_FILTERS, ...filters },
    draftQuery: filters.q ?? '',
    setQuery: vi.fn(),
    setField: vi.fn(),
    replaceFilters: vi.fn(),
    reset: vi.fn(),
  }
}

describe('ActiveFiltersBar', () => {
  it('says nothing while no filter is set', () => {
    const { container } = render(<ActiveFiltersBar filterController={controller({})} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names each shared filter and says it applies to every section', () => {
    render(<ActiveFiltersBar filterController={controller({ estado_resumido: ['Aprobado'] })} />)
    const bar = screen.getByRole('region', { name: 'Filtros activos' })
    expect(bar).toHaveTextContent('Filtro activo')
    expect(bar).toHaveTextContent('en todas las secciones')
    expect(bar).toHaveTextContent('Estado resumido: Aprobado')
  })

  it('removes one filter, or all of them', async () => {
    const filters = controller({ estado_resumido: ['Aprobado'], empresa: ['Ecores'] })
    render(<ActiveFiltersBar filterController={filters} />)
    expect(screen.getByText('2 filtros activos')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Quitar el filtro Estado resumido: Aprobado' }),
    )
    expect(filters.replaceFilters).toHaveBeenCalledWith(
      expect.objectContaining({ estado_resumido: [], empresa: ['Ecores'] }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Quitar todos' }))
    expect(filters.reset).toHaveBeenCalled()
  })
})
