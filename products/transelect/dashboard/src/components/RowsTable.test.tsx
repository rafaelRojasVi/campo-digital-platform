import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RowsTable } from './RowsTable'
import { makeRow } from '../test/factories'

describe('RowsTable (TR-FUNC-039)', () => {
  it('renders Actualizable’s column set with the two Carpeta columns kept apart', () => {
    render(<RowsTable rows={[makeRow()]} totalCount={1} loading={false} />)
    const headers = screen.getAllByRole('columnheader').map((node) => node.textContent)
    expect(headers).toEqual([
      'PMF',
      'Predio de reforestación',
      'Carpeta (col. E)',
      'Carpeta (col. AC)',
      'Rol',
      'Predio',
      'Área corta',
      'Sup. ha',
      'Estado resumido',
      'N.º ingreso',
      'Empresa',
      'Propietario',
      'Sector',
    ])
  })

  it('shows both source Carpeta values instead of collapsing them to one', () => {
    render(<RowsTable rows={[makeRow()]} totalCount={1} loading={false} />)
    const row = within(screen.getByTestId('rows-body')).getAllByRole('row')[0]
    const cells = within(row).getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells[2]).toBe('CARP-E-01')
    expect(cells[3]).toBe('CARP-AC-01')
  })

  it('reports the API’s true filtered total, not the number of rows on this page', () => {
    render(<RowsTable rows={[makeRow()]} totalCount={729} loading={false} />)
    expect(screen.getByTestId('rows-total')).toHaveTextContent('(729 áreas de corta)')
  })

  it('renders a blank workbook value as an empty cell, never as "null"', () => {
    render(
      <RowsTable
        rows={[makeRow({ predio_ref: null, rol: null, superficie_corta: null })]}
        totalCount={1}
        loading={false}
      />,
    )
    const row = within(screen.getByTestId('rows-body')).getAllByRole('row')[0]
    const cells = within(row).getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells[1]).toBe('Sin información')
    expect(cells[4]).toBe('')
    expect(cells[7]).toBe('0')
    expect(row.textContent).not.toContain('null')
  })

  it('escapes workbook-derived text rather than interpreting it as markup', () => {
    render(
      <RowsTable
        rows={[makeRow({ empresa: '<img src=x onerror="alert(1)">' })]}
        totalCount={1}
        loading={false}
      />,
    )
    const body = screen.getByTestId('rows-body')
    expect(body.querySelector('img')).toBeNull()
    expect(body.textContent).toContain('<img src=x onerror="alert(1)">')
  })

  it('shows an empty state only when it is not still loading', () => {
    const { rerender } = render(<RowsTable rows={[]} totalCount={0} loading />)
    expect(screen.queryByText('No hay registros para los filtros aplicados.')).not.toBeInTheDocument()

    rerender(<RowsTable rows={[]} totalCount={0} loading={false} />)
    expect(screen.getByText('No hay registros para los filtros aplicados.')).toBeInTheDocument()
  })
})
