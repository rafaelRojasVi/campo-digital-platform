import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KpiRow } from './KpiRow'
import { makeSummary } from '../test/factories'

describe('KpiRow (TR-FUNC-001-008)', () => {
  it('renders the eight source KPI cards with their own labels', () => {
    render(<KpiRow summary={makeSummary()} />)
    const labels = [...screen.getByTestId('kpi-row').querySelectorAll('.lab')].map(
      (node) => node.textContent,
    )

    expect(labels).toEqual([
      'PMF',
      'Predios',
      'Roles',
      'Superficie',
      'Aprobados',
      'En trámite',
      'Pendientes prioritarios',
      'Con servidumbre',
    ])
  })

  it('shows every value from the summary response, formatted es-CL', () => {
    render(
      <KpiRow
        summary={makeSummary({
          pmf_count: 159,
          predio_count: 272,
          rol_count: 221,
          surface_total: 164.6288,
          aprobados_pmf_count: 108,
          en_tramite_pmf_count: 48,
          pendientes_prioritarios_pmf_count: 9,
          con_servidumbre_predio_count: 148,
        })}
      />,
    )

    expect(screen.getByTestId('kpi-pmf')).toHaveTextContent('159')
    expect(screen.getByTestId('kpi-predios')).toHaveTextContent('272')
    expect(screen.getByTestId('kpi-roles')).toHaveTextContent('221')
    expect(screen.getByTestId('kpi-superficie')).toHaveTextContent('164,63 ha')
    expect(screen.getByTestId('kpi-aprobados')).toHaveTextContent('108')
    expect(screen.getByTestId('kpi-en-tramite')).toHaveTextContent('48')
    expect(screen.getByTestId('kpi-pendientes')).toHaveTextContent('9')
    expect(screen.getByTestId('kpi-servidumbre')).toHaveTextContent('148')
  })

  it('names both disagreeing status rules instead of presenting one number as a subset of the other', () => {
    render(<KpiRow summary={makeSummary()} />)
    expect(screen.getByText('estado_resumido_first_row')).toBeInTheDocument()
    expect(screen.getByText('pending_priority_legacy')).toBeInTheDocument()
    expect(screen.getByText(/no son subconjuntos una de la otra/)).toBeInTheDocument()
  })

  it('renders zeros rather than blanks for an empty filtered scope', () => {
    render(
      <KpiRow
        summary={makeSummary({
          pmf_count: 0,
          predio_count: 0,
          rol_count: 0,
          surface_total: 0,
          aprobados_pmf_count: 0,
        })}
      />,
    )
    expect(screen.getByTestId('kpi-pmf')).toHaveTextContent('0')
    expect(screen.getByTestId('kpi-superficie')).toHaveTextContent('0 ha')
  })
})
