import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TranselecSummary } from '../api'
import { StatusDistribution } from './StatusDistribution'

const summary: TranselecSummary = {
  business_rows: 10,
  distinct_pmf: 4,
  distinct_provisional_predio_ids: 6,
  distinct_roles: 5,
  surface_total: 20,
  status_breakdown: [
    ['Aprobado', 6],
    ['Pendiente', 4],
  ],
}

describe('StatusDistribution', () => {
  it('labels the chart as a distribution of source records, never a completion metric', () => {
    render(<StatusDistribution summary={summary} />)
    expect(
      screen.getByText('Distribución de registros por estado resumido'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/avance/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/completad/i)).not.toBeInTheDocument()
  })

  it('renders each status with its exact count and a rounded percentage of the total', () => {
    render(<StatusDistribution summary={summary} />)

    expect(screen.getByText('Aprobado')).toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('shows the total record count at the center of the ring, not a percentage', () => {
    render(<StatusDistribution summary={summary} />)
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('registros')).toBeInTheDocument()
  })

  it('states the distinct category count as a factual note, absorbing the old Vista actual bullet', () => {
    render(<StatusDistribution summary={summary} />)
    expect(screen.getByText('2 categorías · por fila de fuente')).toBeInTheDocument()
  })

  it('uses singular phrasing for exactly one category', () => {
    render(
      <StatusDistribution
        summary={{ ...summary, status_breakdown: [['Aprobado', 10]] }}
      />,
    )
    expect(screen.getByText('1 categoría · por fila de fuente')).toBeInTheDocument()
  })

  it('renders an empty state when there are no status-informed rows', () => {
    render(
      <StatusDistribution
        summary={{ ...summary, status_breakdown: [] }}
      />,
    )
    expect(screen.getByText('No hay estados informados.')).toBeInTheDocument()
  })

  it('renders a loading skeleton while summary is not yet available', () => {
    render(<StatusDistribution summary={null} />)
    expect(screen.getByLabelText('Cargando estados')).toBeInTheDocument()
  })
})
