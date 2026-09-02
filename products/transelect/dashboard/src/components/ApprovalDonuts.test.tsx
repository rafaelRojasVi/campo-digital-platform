import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApprovalDonuts } from './ApprovalDonuts'
import { makeSummary } from '../test/factories'

describe('ApprovalDonuts (TR-FUNC-009/010)', () => {
  it('renders one donut per grain, each summing to its own total', () => {
    render(
      <ApprovalDonuts
        summary={makeSummary({
          avance_por_predio: { aprobado: 6, en_tramite: 2, pendiente_o_tachado: 2 },
          avance_por_pmf: { aprobado: 3, en_tramite: 1, pendiente_o_tachado: 0 },
        })}
      />,
    )

    expect(screen.getByTestId('donut-predios-total')).toHaveTextContent('6 de 10 predios aprobados')
    expect(screen.getByTestId('donut-pmf-total')).toHaveTextContent('3 de 4 PMF aprobados')
  })

  it('computes each percentage against its own grain, not a shared denominator', () => {
    render(
      <ApprovalDonuts
        summary={makeSummary({
          avance_por_predio: { aprobado: 1, en_tramite: 1, pendiente_o_tachado: 2 },
          avance_por_pmf: { aprobado: 3, en_tramite: 1, pendiente_o_tachado: 0 },
        })}
      />,
    )
    expect(screen.getByTestId('donut-predios-pct')).toHaveTextContent('25%')
    expect(screen.getByTestId('donut-pmf-pct')).toHaveTextContent('75%')
  })

  it('does not divide by zero for an empty filtered scope', () => {
    render(
      <ApprovalDonuts
        summary={makeSummary({
          avance_por_predio: { aprobado: 0, en_tramite: 0, pendiente_o_tachado: 0 },
          avance_por_pmf: { aprobado: 0, en_tramite: 0, pendiente_o_tachado: 0 },
        })}
      />,
    )
    expect(screen.getByTestId('donut-predios-pct')).toHaveTextContent('0%')
    expect(screen.getByTestId('donut-pmf-total')).toHaveTextContent('0 de 0 PMF aprobados')
  })

  it('gives each donut a text alternative rather than relying on colour alone', () => {
    render(<ApprovalDonuts summary={makeSummary()} />)
    expect(
      screen.getByRole('img', { name: /Avance por predios: 3 de 6 predios aprobados/ }),
    ).toBeInTheDocument()
  })
})
