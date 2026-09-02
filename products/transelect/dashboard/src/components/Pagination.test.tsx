import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Pagination } from './Pagination'

describe('Pagination', () => {
  it('renders nothing when every result fits on one page', () => {
    const { container } = render(
      <Pagination
        page={1}
        pageSize={25}
        totalItems={12}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for zero results', () => {
    const { container } = render(
      <Pagination
        page={1}
        pageSize={25}
        totalItems={0}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the range label and total for a mid-set page', () => {
    render(
      <Pagination
        page={2}
        pageSize={25}
        totalItems={159}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    )
    expect(screen.getByText('Mostrando 26–50 de 159')).toBeInTheDocument()
    expect(screen.getByText('Página 2 de 7')).toBeInTheDocument()
  })

  it('builds a boundary+sibling window with ellipses instead of every page number', () => {
    render(
      <Pagination
        page={1}
        pageSize={25}
        totalItems={159}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    )
    const nav = screen.getByRole('navigation', { name: 'Paginación de resultados' })
    expect(screen.getByRole('button', { name: 'Página 1' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Página 2' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Página 3' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Página 7' })).toBeInTheDocument()
    expect(nav.textContent).toContain('…')
  })

  it('shows neighbors on both sides of the current page mid-range', () => {
    render(
      <Pagination
        page={4}
        pageSize={25}
        totalItems={159}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    )
    for (const label of ['Página 1', 'Página 3', 'Página 4', 'Página 5', 'Página 7']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Página 2' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Página 6' })).not.toBeInTheDocument()
  })

  it('disables Anterior on the first page and Siguiente on the last page', () => {
    const { rerender } = render(
      <Pagination
        page={1}
        pageSize={25}
        totalItems={159}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('button', { name: /anterior/i })[0]).toBeDisabled()

    rerender(
      <Pagination
        page={7}
        pageSize={25}
        totalItems={159}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('button', { name: /siguiente/i })[0]).toBeDisabled()
  })

  it('calls onPageChange with the clicked page number', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(
      <Pagination
        page={1}
        pageSize={25}
        totalItems={159}
        onPageChange={onPageChange}
        onPageSizeChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Página 2' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('calls onPageChange for Anterior/Siguiente relative to the current page', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(
      <Pagination
        page={3}
        pageSize={25}
        totalItems={159}
        onPageChange={onPageChange}
        onPageSizeChange={vi.fn()}
      />,
    )
    const [desktopPrev] = screen.getAllByRole('button', { name: /anterior/i })
    const [desktopNext] = screen.getAllByRole('button', { name: /siguiente/i })
    await user.click(desktopPrev)
    expect(onPageChange).toHaveBeenCalledWith(2)
    await user.click(desktopNext)
    expect(onPageChange).toHaveBeenCalledWith(4)
  })

  it('calls onPageSizeChange when a new page size is selected', async () => {
    const user = userEvent.setup()
    const onPageSizeChange = vi.fn()
    render(
      <Pagination
        page={1}
        pageSize={25}
        totalItems={159}
        onPageChange={vi.fn()}
        onPageSizeChange={onPageSizeChange}
      />,
    )
    await user.selectOptions(screen.getByLabelText('Por página'), '50')
    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })
})
