import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { QuickActions } from './QuickActions'

function renderActions(overrides: Partial<Parameters<typeof QuickActions>[0]> = {}) {
  const handlers = {
    onFocusSearch: vi.fn(),
    onReviewStatuses: vi.fn(),
    filtersActive: true,
    onClearFilters: vi.fn(),
    onExportCsv: vi.fn(),
    exportDisabled: false,
    onPrint: vi.fn(),
    onOpenHistory: vi.fn(),
    ...overrides,
  }
  render(<QuickActions {...handlers} />)
  return handlers
}

describe('QuickActions', () => {
  it('wires each action to its real handler', async () => {
    const user = userEvent.setup()
    const handlers = renderActions()

    await user.click(screen.getByRole('button', { name: /buscar pmf, predio o rol/i }))
    expect(handlers.onFocusSearch).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /revisar estados/i }))
    expect(handlers.onReviewStatuses).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /limpiar filtros/i }))
    expect(handlers.onClearFilters).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /exportar selección/i }))
    expect(handlers.onExportCsv).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /imprimir/i }))
    expect(handlers.onPrint).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /ver historial de fuente/i }))
    expect(handlers.onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('disables clear filters when no filter is active', () => {
    renderActions({ filtersActive: false })
    expect(screen.getByRole('button', { name: /limpiar filtros/i })).toBeDisabled()
  })

  it('disables export when there is nothing to export', () => {
    renderActions({ exportDisabled: true })
    expect(screen.getByRole('button', { name: /exportar selección/i })).toBeDisabled()
  })
})
